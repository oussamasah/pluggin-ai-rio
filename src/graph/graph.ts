// src/graph/rio.ts
import { StateGraph, END, START } from '@langchain/langgraph';
import { GraphStateAnnotation, GraphState } from './state';
import { plannerNode } from './nodes/planner';
import { retrieverNode } from './nodes/retriever';
import { hopperNode } from './nodes/hopper';
import { analyzerNode } from './nodes/analyzer';
import { criticNode } from './nodes/critic';
import { executorNode } from './nodes/executor';
import { responderNode } from './nodes/responder';
import { memoryService } from '../services/memory.service';
import { logger } from '../core/logger';
import { queryEnhancer } from '../services/QueryEnhancerService';
import { withTimeout } from '../utils/timeout';
import { config } from '../core/config';

function shouldContinueAfterRetriever(state: GraphState): string {
  if (state.errors.length > 0) return 'error';
  
  // CRITICAL: Check for execute intent FIRST - action queries should skip analyzer/critic
  const isExecuteIntent = state.intent?.type === 'execute';
  const hasExternalActions = state.intent?.actions && 
                            state.intent.actions.length > 0 &&
                            state.intent.actions.some((a: string) => 
                              !['fetch', 'hop', 'aggregate'].includes(a)
                            );
  
  if (isExecuteIntent || hasExternalActions) {
    logger.debug('Routing to executor (action query detected)', {
      intentType: state.intent?.type,
      actions: state.intent?.actions,
      isExecuteIntent,
      hasExternalActions
    });
    return 'executor';
  }
  
  // Check if there are hop steps in the plan (more reliable than requiresHopping flag)
  const hasHopSteps = state.plan?.steps?.some(step => step.action === 'hop') || false;
  
  // Also check if retriever explicitly set currentNode to hopper
  if (state.currentNode === 'hopper' || hasHopSteps || state.intent?.requiresHopping) {
    logger.debug('Routing to hopper', {
      currentNode: state.currentNode,
      hasHopSteps,
      requiresHopping: state.intent?.requiresHopping,
      planSteps: state.plan?.steps?.map(s => ({ action: s.action, collection: s.collection }))
    });
    return 'hopper';
  }
  
  return 'analyzer';
}

function shouldContinueAfterAnalyzer(state: GraphState): string {
  if (state.errors.length > 0) return 'responder';
  if (state.plan?.requiresCritic) return 'critic';
  
  // Only route to executor for external actions (not fetch/hop/aggregate)
  const hasExternalActions = state.intent?.actions && 
                              state.intent.actions.length > 0 &&
                              state.intent.actions.some((a: string) => 
                                !['fetch', 'hop', 'aggregate'].includes(a)
                              );
  if (hasExternalActions) return 'executor';
  return 'responder';
}

function shouldContinueAfterCritic(state: GraphState): string {
  // Check validity - support both isValid and overallValidity
  const isValid = state.criticResult?.isValid !== undefined 
    ? state.criticResult.isValid 
    : ((state.criticResult as any)?.overallValidity !== undefined 
        ? (state.criticResult as any).overallValidity >= 0.8 
        : true);
  
  if (!isValid && state.iterations < state.maxIterations) {
    return 'analyzer';
  }
  
  // Only route to executor for external actions (not fetch/hop/aggregate)
  const hasExternalActions = state.intent?.actions && 
                              state.intent.actions.length > 0 &&
                              state.intent.actions.some((a: string) => 
                                !['fetch', 'hop', 'aggregate'].includes(a)
                              );
  if (hasExternalActions) return 'executor';
  return 'responder';
}

function shouldContinueAfterExecutor(state: GraphState): string {
  if (state.requiresUserInput) return 'awaiting_confirmation';
  return 'responder';
}

export function createRIOGraph() {
  const workflow = new StateGraph(GraphStateAnnotation)
    .addNode('planner', plannerNode)
    .addNode('retriever', retrieverNode)
    .addNode('hopper', hopperNode)
    .addNode('analyzer', analyzerNode)
    .addNode('critic', criticNode)
    .addNode('executor', executorNode)
    .addNode('responder', responderNode);

  workflow.addEdge(START, 'planner');
  workflow.addEdge('planner', 'retriever');
  
  workflow.addConditionalEdges('retriever', shouldContinueAfterRetriever, {
    executor: 'executor',
    hopper: 'hopper',
    analyzer: 'analyzer',
    error: 'responder',
  });

  workflow.addEdge('hopper', 'analyzer');
  
  workflow.addConditionalEdges('analyzer', shouldContinueAfterAnalyzer, {
    critic: 'critic',
    executor: 'executor',
    responder: 'responder',
  });

  workflow.addConditionalEdges('critic', shouldContinueAfterCritic, {
    analyzer: 'analyzer',
    executor: 'executor',
    responder: 'responder',
  });

  workflow.addConditionalEdges('executor', shouldContinueAfterExecutor, {
    awaiting_confirmation: END,
    responder: 'responder',
  });

  workflow.addEdge('responder', END);

  return workflow.compile();
}

export async function runRIO(
  query: string,
  userId: string,
  sessionId?: string
  
): Promise<GraphState> {
  logger.info('Starting RIO execution', { query, userId });
  
  // Enhance query before processing
  const enhancedQuery = queryEnhancer.enhance(query, userId);
  
  const memory = await memoryService.buildMemoryContext(userId, query);

  // Retrieve previous query results from session
  // Check if query references "this context" - if so, force load from Mem0
  const referencesContext = /\b(this|that|the|previous)\s+context\b/i.test(query);
  const { sessionContextService } = await import('../services/session-context.service');
  const previousResults = await sessionContextService.getPreviousResults(
    sessionId, 
    userId, 
    query,
    referencesContext // Force load from Mem0 if "this context" is detected
  );
  
  // Get last viewed IDs from Mem0 (persistent storage)
  const mem0Ids = await sessionContextService.getLastViewedIds(userId);
  
  // Extract last viewed IDs from previous results (in-memory cache)
  const lastViewedCompanyIds: string[] = [...mem0Ids.lastViewedCompanyIds];
  const lastViewedEmployeeIds: string[] = [...mem0Ids.lastViewedEmployeeIds];
  const lastViewedIcpModelIds: string[] = [...mem0Ids.lastViewedIcpModelIds];
  
  if (previousResults && previousResults.length > 0) {
    // Get the most recent result
    const mostRecent = previousResults[previousResults.length - 1];
    
    // Extract IDs from the most recent query and merge with Mem0 IDs
    mostRecent.retrievedData.forEach(retrieved => {
      if (retrieved.collection === 'companies') {
        retrieved.documents.forEach((doc: any) => {
          const id = doc._id?.toString();
          if (id && !lastViewedCompanyIds.includes(id)) {
            lastViewedCompanyIds.push(id);
          }
          // Also extract icpModelId from companies
          const icpModelId = doc.icpModelId?.toString();
          if (icpModelId && !lastViewedIcpModelIds.includes(icpModelId)) {
            lastViewedIcpModelIds.push(icpModelId);
          }
        });
      } else if (retrieved.collection === 'employees') {
        retrieved.documents.forEach((doc: any) => {
          const id = doc._id?.toString();
          if (id && !lastViewedEmployeeIds.includes(id)) {
            lastViewedEmployeeIds.push(id);
          }
        });
      } else if (retrieved.collection === 'icp_models') {
        retrieved.documents.forEach((doc: any) => {
          const id = doc._id?.toString();
          if (id && !lastViewedIcpModelIds.includes(id)) {
            lastViewedIcpModelIds.push(id);
          }
        });
      }
    });
  }
  
  logger.debug('Initializing state with last viewed IDs', {
    lastViewedCompanyIdsCount: lastViewedCompanyIds.length,
    lastViewedEmployeeIdsCount: lastViewedEmployeeIds.length,
    lastViewedIcpModelIdsCount: lastViewedIcpModelIds.length,
    lastViewedCompanyIds: lastViewedCompanyIds.slice(0, 3),
    lastViewedEmployeeIds: lastViewedEmployeeIds.slice(0, 3),
    lastViewedIcpModelIds: lastViewedIcpModelIds.slice(0, 3)
  });

  const initialState: GraphState = {
    query: enhancedQuery.searchKeywords, // Use enhanced keywords
    originalQuery: query,
    enhancedQuery, // Store enhanced query for reference
    userId,
    sessionId,
    memory,
    intent: null,
    plan: null,
    retrievedData: [],
    flattenedData: [],
    previousResults,
    lastViewedCompanyIds,
    lastViewedEmployeeIds,
    lastViewedIcpModelIds,
    analysis: null,
    criticResult: null,
    pendingActions: [],
    executedActions: [],
    finalAnswer: null,
    confidence: 0,
    currentNode: 'start',
    errors: [],
    requiresUserInput: false,
    userInputPrompt: undefined,
    startTime: Date.now(),
    iterations: 0,
    maxIterations: 3,
    progress: {
      currentNode: 'start',
      completedNodes: [],
      progressPercentage: 0,
      lastUpdate: Date.now()
    },
    nodeStartTimes: {},
  };

  const graph = createRIOGraph();
  
  try {
    // Wrap graph execution with total timeout
    const result = await withTimeout(
      graph.invoke(initialState),
      config.execution.totalTimeout,
      'Total execution timeout exceeded'
    );

    const executionTime = Date.now() - result.startTime;
    
    // Store query results for future reference
    // OPTIMIZATION: Store both analysis and finalAnswer for complete conversation history
    const { sessionContextService } = await import('../services/session-context.service');
    if (sessionId && result.retrievedData.length > 0) {
      sessionContextService.storeQueryResults(
        sessionId,
        userId,
        query,
        result.retrievedData,
        result.flattenedData,
        result.analysis || undefined, // Store analysis text for context awareness
        result.finalAnswer || undefined // OPTIMIZATION: Store final answer for conversation history
      );
    }
    
    logger.info('RIO execution completed', { 
      userId,
      executionTime,
      iterations: result.iterations,
      confidence: result.confidence,
      queryEnhancementUsed: !!enhancedQuery
    });

    return result;
  } catch (error: any) {
    logger.error('RIO execution failed', { 
      userId,
      error: error.message,
      stack: error.stack 
    });

    return {
      ...initialState,
      finalAnswer: `An unexpected error occurred: ${error.message}`,
      errors: [error.message],
      currentNode: 'end',
    };
  }
}