/**
 * Streaming version of RIO graph execution
 * Supports real-time progress updates and text streaming
 */

import { GraphState } from './state';
import { logger } from '../core/logger';
import { queryEnhancer } from '../services/QueryEnhancerService';
import { memoryService } from '../services/memory.service';
import { runRIO } from './graph';
import { llmService } from '../services/llm.service';
import { config } from '../core/config';
import { dynamicPromptBuilder } from '../prompts/dynamic-builder';

export interface StreamCallbacks {
  onProgress?: (node: string, message: string, progress: number) => void;
  onChunk?: (chunk: string) => void;
  onError?: (error: Error) => void;
}

// Store callbacks globally for this execution (in production, use a Map with request ID)
let currentCallbacks: StreamCallbacks | null = null;

export function setStreamCallbacks(callbacks: StreamCallbacks) {
  currentCallbacks = callbacks;
}

export function getStreamCallbacks(): StreamCallbacks | null {
  return currentCallbacks;
}

/**
 * Streaming version of runRIO with real-time callbacks
 * This intercepts the graph execution and sends progress updates
 */
export async function runRIOStream(
  query: string,
  userId: string,
  sessionId: string | undefined,
  callbacks: StreamCallbacks
): Promise<GraphState> {
  const { onProgress, onChunk, onError } = callbacks;

  try {
    // Set callbacks for this execution
    setStreamCallbacks(callbacks);

    // Node progress mapping
    const nodeProgress: Record<string, number> = {
      planner: 10,
      retriever: 30,
      hopper: 40,
      analyzer: 60,
      critic: 75,
      executor: 80,
      responder: 95,
    };

    // Progress messages
    const nodeMessages: Record<string, string> = {
      planner: 'Planning your query...',
      retriever: 'Retrieving data from database...',
      hopper: 'Gathering related information...',
      analyzer: 'Analyzing data and generating insights...',
      critic: 'Validating analysis...',
      executor: 'Executing actions...',
      responder: 'Crafting your response...',
    };

    // Intercept node execution by wrapping the graph
    // For now, we'll use a modified version that sends progress
    // and streams the responder node's LLM call
    
    onProgress?.('planner', nodeMessages.planner, nodeProgress.planner);
    
    // Enhance query
    const enhancedQuery = queryEnhancer.enhance(query, userId);
    
    // Get previous results (same as regular runRIO)
    const referencesContext = /\b(this|that|the|previous)\s+context\b/i.test(query);
    const { sessionContextService } = await import('../services/session-context.service');
    const previousResults = await sessionContextService.getPreviousResults(
      sessionId || '', 
      userId, 
      query,
      referencesContext
    );
    
    const mem0Ids = await sessionContextService.getLastViewedIds(userId);
    const lastViewedCompanyIds: string[] = [...mem0Ids.lastViewedCompanyIds];
    const lastViewedEmployeeIds: string[] = [...mem0Ids.lastViewedEmployeeIds];
    const lastViewedIcpModelIds: string[] = [...mem0Ids.lastViewedIcpModelIds];
    
    // Continue with regular execution but intercept responder
    // The responder node will automatically use streaming if callbacks are set
    onProgress?.('retriever', nodeMessages.retriever, nodeProgress.retriever);
    const result = await runRIO(query, userId, sessionId);
    
    // If streaming was used, the chunks were already sent via onChunk callback
    // No need to simulate streaming here
    
    onProgress?.('complete', 'Response complete', 100);
    
    // Clear callbacks
    setStreamCallbacks(null);
    
    return result;
  } catch (error: any) {
    setStreamCallbacks(null);
    onError?.(error);
    throw error;
  }
}

/**
 * Streaming version of responder node that uses LLM streaming
 */
export async function responderNodeStream(
  state: GraphState,
  onChunk?: (chunk: string) => void
): Promise<Partial<GraphState>> {
  const systemPrompt = dynamicPromptBuilder.buildResponderPrompt(
    state.query,
    state.analysis || '',
    state.executedActions || [],
    state.retrievedData
  );

  // Use streaming LLM call
  const response = await llmService.chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Craft the final response.' },
    ],
    {
      model: config.models.planner,
      temperature: 0.4,
      stream: !!onChunk,
      onChunk: onChunk,
    }
  );

  return {
    finalAnswer: response.content,
    currentNode: 'end',
  };
}

