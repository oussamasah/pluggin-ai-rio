import { hybridRetriever } from '../../retrieval/hybrid-retriever';
import { searchService } from '../../services/search.service';
import { logger } from '../../core/logger';
import { GraphState } from '../state';
import { withTimeout, checkTotalTimeout, trackNodeExecution } from '../../utils/timeout';
import { updateProgress } from '../../utils/progress-tracker';
import { executeParallelFetches } from '../../utils/parallel-executor';
import { config } from '../../core/config';

import { getStreamCallbacks } from '../graph-stream';

export async function retrieverNode(state: GraphState): Promise<Partial<GraphState>> {
  // Send progress update when node starts
  const streamCallbacks = getStreamCallbacks();
  if (streamCallbacks?.onProgress) {
    streamCallbacks.onProgress('retriever', 'Retrieving data from database...', 30);
  }
  const nodeStartTime = Date.now();
  
  try {
    // Check total timeout
    checkTotalTimeout(state.startTime);
    
    // Track node execution
    const nodeStartTimes = { ...(state.nodeStartTimes || {}), retriever: nodeStartTime };
    trackNodeExecution('retriever', nodeStartTimes);
    
    logger.info('Retriever node executing', { 
      collections: state.intent?.collections,
      userId: state.userId,
      hasAggregation: !!state.intent?.aggregation 
    });

    if (!state.intent || !state.plan) {
      throw new Error('No intent or plan available for retrieval');
    }

    // Check if this is an aggregation query
    const hasAggregationStep = state.plan.steps.some(step => step.action === 'aggregate');
    const aggregationStep = hasAggregationStep ? state.plan.steps.find(step => step.action === 'aggregate') : null;

    if (hasAggregationStep) {
      if (aggregationStep?.aggregation?.pipeline) {
        logger.info('Detected aggregation query, executing aggregation pipeline');
        
        const aggregationResults = await executeAggregationPlan(
          state.plan.steps,
          state.userId
        );
        const fetchStep = state.plan.steps.find(s => s.action === 'fetch');
        return {
          retrievedData: [{
            collection: state.plan.steps[0].collection,
            documents: aggregationResults,
            limit: fetchStep?.limit || 10,
            sort: fetchStep?.sort || { "scoringMetrics.fitScore.score": -1 },
            metadata: {
              count: aggregationResults.length,
              searchMethod: 'metadata',
              confidence: 1.0,
            },
          }],
          flattenedData: aggregationResults,
          currentNode: 'analyzer',
        };
      } else {
        // Aggregation step without pipeline - this is likely a classification/analysis query
        // Convert to fetch instead
        logger.warn('Retriever: Aggregation step found but no pipeline specified - converting to fetch', {
          stepId: aggregationStep?.stepId,
          collection: aggregationStep?.collection,
          query: aggregationStep?.query
        });
        
        // Remove the invalid aggregation step and treat it as a fetch
        const fetchSteps = state.plan.steps.filter(s => s.action === 'fetch');
        const classificationStep = {
          ...aggregationStep,
          action: 'fetch' as const,
          limit: aggregationStep?.limit || 100, // Default limit for classification queries
          query: aggregationStep?.query || { userId: state.userId }
        };
        
        // Continue with fetch steps (including the converted classification step)
        const allFetchSteps = [...fetchSteps, classificationStep];
        
        // Execute fetch steps
        const allRetrievedData: any[] = [];
        for (const fetchStep of allFetchSteps) {
          const stepData = await hybridRetriever.retrieveWithPlan(
            fetchStep.query || { userId: state.userId },
            fetchStep.collection,
            state.userId,
            {
              limit: fetchStep.limit || 100,
              sort: fetchStep.sort,
              includeRelated: false
            }
          );
          allRetrievedData.push(...stepData);
        }
        
        const flattenedData = hybridRetriever.flattenResults(allRetrievedData);
        
        // Extract IDs
        const companyIds: string[] = [...(state.lastViewedCompanyIds || [])];
        allRetrievedData.forEach(retrieved => {
          if (retrieved.collection === 'companies') {
            retrieved.documents.forEach((doc: any) => {
              const id = doc._id?.toString();
              if (id && !companyIds.includes(id)) {
                companyIds.push(id);
              }
            });
          }
        });
        
        return {
          retrievedData: allRetrievedData,
          flattenedData,
          lastViewedCompanyIds: companyIds,
          lastViewedEmployeeIds: state.lastViewedEmployeeIds || [],
          lastViewedIcpModelIds: state.lastViewedIcpModelIds || [],
          currentNode: 'analyzer',
        };
      }
    }
    logger.info('DEBUG: Planner Output', {
        intentType: state.intent?.type,
        requiresHopping: state.intent?.requiresHopping,
        totalSteps: state.plan?.steps?.length || 0,
        stepActions: state.plan?.steps?.map(s => ({ action: s.action, collection: s.collection })),
        firstStepAction: state.plan?.steps[0]?.action,
        rawQuery: JSON.stringify(state.plan?.steps[0]?.query),
        rawLimit: JSON.stringify(state.plan?.steps[0]?.limit),
        rawSort: JSON.stringify(state.plan?.steps[0]?.sort)
      });
    
    // Handle multi-step plans: execute fetch steps, then hop steps
    const allRetrievedData: any[] = [];
    
    // First, execute all fetch steps
    const fetchSteps = state.plan.steps.filter(s => s.action === 'fetch');
    const hopSteps = state.plan.steps.filter(s => s.action === 'hop');
    
    if (fetchSteps.length === 0) {
      // If there are no fetch steps but there are hop steps, that's okay - hopper will handle it
      if (hopSteps.length > 0) {
        logger.warn('Retriever: No fetch steps but hop steps exist - proceeding to hopper', {
          hopStepsCount: hopSteps.length
        });
        return {
          retrievedData: [],
          flattenedData: [],
          lastViewedCompanyIds: state.lastViewedCompanyIds || [],
          lastViewedEmployeeIds: state.lastViewedEmployeeIds || [],
          lastViewedIcpModelIds: state.lastViewedIcpModelIds || [],
          currentNode: 'hopper',
        };
      }
      
      // If there are no steps at all, this might be a generation-only query
      // Check if we have previous results we can use
      if (state.previousResults && state.previousResults.length > 0) {
        logger.info('Retriever: No steps in plan but previous results available - using previous data', {
          previousResultsCount: state.previousResults.length
        });
        
        // Use the most recent previous result's data
        const mostRecent = state.previousResults[state.previousResults.length - 1];
        return {
          retrievedData: mostRecent.retrievedData || [],
          flattenedData: mostRecent.flattenedData || [],
          lastViewedCompanyIds: state.lastViewedCompanyIds || [],
          lastViewedEmployeeIds: state.lastViewedEmployeeIds || [],
          lastViewedIcpModelIds: state.lastViewedIcpModelIds || [],
          currentNode: 'analyzer',
        };
      }
      
      // Check if this is an informational/clarification query that doesn't need data
      const isInformationalQuery = state.intent?.type === 'informational' || 
                                   state.intent?.type === 'clarification' ||
                                   /\b(what|who|how|when|where|why|can you|do you|are you|your mission|your purpose|help me|what can|what do)\b/i.test(state.originalQuery || '');
      
      if (isInformationalQuery) {
        logger.info('Retriever: Informational/clarification query detected - routing directly to responder', {
          intentType: state.intent?.type,
          query: state.originalQuery?.substring(0, 50)
        });
        
        // Route directly to responder for informational queries
        return {
          retrievedData: [],
          flattenedData: [],
          lastViewedCompanyIds: state.lastViewedCompanyIds || [],
          lastViewedEmployeeIds: state.lastViewedEmployeeIds || [],
          lastViewedIcpModelIds: state.lastViewedIcpModelIds || [],
          currentNode: 'responder',
          // Mark as informational so responder knows to handle it without analysis
          intent: { ...state.intent, type: 'informational' },
        };
      }
      
      // If no fetch steps and no previous results, handle gracefully instead of crashing
      logger.warn('Retriever: No fetch steps and no previous results - routing to responder with empty data', {
        intentType: state.intent?.type,
        hasPlan: !!state.plan,
        planSteps: state.plan?.steps?.length || 0,
        query: state.originalQuery?.substring(0, 50)
      });
      
      // Return empty state and route to responder (which will handle the "no data" case gracefully)
      return {
        ...state,
        retrievedData: [],
        currentNode: 'responder'
      };
    }

    // Execute independent fetch steps in parallel (if enabled)
    const parallelStepIds = config.execution.enableParallelExecution
      ? await executeParallelFetches(fetchSteps, state.userId, allRetrievedData)
      : [];
    
    // Filter out steps that were executed in parallel
    const remainingFetchSteps = fetchSteps.filter(step => 
      !parallelStepIds.includes(step.stepId)
    );
    
    // Execute remaining fetch steps sequentially
    for (const fetchStep of remainingFetchSteps) {
      // Handle placeholders in query (e.g., FROM_STEP_0_ICP_MODEL_ID, FROM_STEP_1_EMPLOYEE_IDS, FROM_STEP_1_COMPANY_IDS)
      let queryToExecute = { ...fetchStep.query };
      
      // Replace ICP model ID placeholder if present
      if (queryToExecute.icpModelId === 'FROM_STEP_0_ICP_MODEL_ID' || 
          (typeof queryToExecute.icpModelId === 'object' && 
           queryToExecute.icpModelId.$in && 
           queryToExecute.icpModelId.$in.includes('FROM_STEP_0_ICP_MODEL_ID'))) {
        // Find ICP model from previous steps
        const icpModelData = allRetrievedData.find(d => d.collection === 'icp_models');
        if (icpModelData && icpModelData.documents.length > 0) {
          const icpModelId = icpModelData.documents[0]._id?.toString();
          if (icpModelId) {
            if (typeof queryToExecute.icpModelId === 'object' && queryToExecute.icpModelId.$in) {
              // Replace placeholder in $in array
              queryToExecute.icpModelId.$in = queryToExecute.icpModelId.$in
                .filter((id: string) => id !== 'FROM_STEP_0_ICP_MODEL_ID')
                .concat(icpModelId);
            } else {
              queryToExecute.icpModelId = icpModelId;
            }
            logger.info('Retriever: Replaced ICP model ID placeholder', {
              stepId: fetchStep.stepId,
              icpModelId,
              collection: fetchStep.collection
            });
          } else {
            logger.warn('Retriever: ICP model ID placeholder found but no ICP model data available', {
              stepId: fetchStep.stepId
            });
            // Remove invalid placeholder
            delete queryToExecute.icpModelId;
          }
        } else {
          logger.warn('Retriever: ICP model ID placeholder found but no ICP model step executed yet', {
            stepId: fetchStep.stepId,
            dependencies: fetchStep.dependencies
          });
          // Remove invalid placeholder
          delete queryToExecute.icpModelId;
        }
      }
      
      // Replace employee ID placeholder if present (FROM_STEP_1_EMPLOYEE_IDS)
      if (queryToExecute.employeeId && typeof queryToExecute.employeeId === 'object' && 
          queryToExecute.employeeId.$in && 
          Array.isArray(queryToExecute.employeeId.$in) &&
          queryToExecute.employeeId.$in.some((id: string) => id.includes('FROM_STEP') && id.includes('EMPLOYEE'))) {
        // Find employees from previous steps
        const employeeData = allRetrievedData.find(d => d.collection === 'employees');
        if (employeeData && employeeData.documents.length > 0) {
          const employeeIds = employeeData.documents
            .map((doc: any) => doc._id?.toString())
            .filter((id: string | undefined): id is string => !!id);
          
          if (employeeIds.length > 0) {
            // Replace placeholder in $in array
            queryToExecute.employeeId.$in = queryToExecute.employeeId.$in
              .filter((id: string) => !id.includes('FROM_STEP') || !id.includes('EMPLOYEE'))
              .concat(employeeIds);
            logger.info('Retriever: Replaced employee ID placeholder', {
              stepId: fetchStep.stepId,
              employeeIdsCount: employeeIds.length,
              collection: fetchStep.collection
            });
          } else {
            logger.warn('Retriever: Employee ID placeholder found but no employee IDs available', {
              stepId: fetchStep.stepId
            });
            // Remove invalid placeholder
            delete queryToExecute.employeeId;
          }
        } else {
          logger.warn('Retriever: Employee ID placeholder found but no employee step executed yet', {
            stepId: fetchStep.stepId,
            dependencies: fetchStep.dependencies
          });
          // Remove invalid placeholder
          delete queryToExecute.employeeId;
        }
      }
      
      // Replace company ID placeholder if present (FROM_STEP_1_COMPANY_IDS)
      // Check both _id.$in (for companies collection) and companyId.$in (for other collections)
      const hasCompanyIdPlaceholderInId = queryToExecute._id && typeof queryToExecute._id === 'object' && 
          queryToExecute._id.$in && 
          Array.isArray(queryToExecute._id.$in) &&
          queryToExecute._id.$in.some((id: any) => typeof id === 'string' && (id.includes('FROM_STEP') && id.includes('COMPANY')));
      
      const hasCompanyIdPlaceholderInCompanyId = queryToExecute.companyId && typeof queryToExecute.companyId === 'object' && 
          queryToExecute.companyId.$in && 
          Array.isArray(queryToExecute.companyId.$in) &&
          queryToExecute.companyId.$in.some((id: any) => typeof id === 'string' && (id.includes('FROM_STEP') && id.includes('COMPANY')));
      
      logger.debug('Retriever: Checking for company ID placeholders', {
        stepId: fetchStep.stepId,
        collection: fetchStep.collection,
        hasCompanyIdPlaceholderInId,
        hasCompanyIdPlaceholderInCompanyId,
        companyIdQuery: queryToExecute.companyId ? JSON.stringify(queryToExecute.companyId) : undefined,
        _idQuery: queryToExecute._id ? JSON.stringify(queryToExecute._id) : undefined
      });
      
      if (hasCompanyIdPlaceholderInId || hasCompanyIdPlaceholderInCompanyId) {
        logger.info('Retriever: Company ID placeholder detected, attempting replacement', {
          stepId: fetchStep.stepId,
          collection: fetchStep.collection,
          hasCompanyIdPlaceholderInId,
          hasCompanyIdPlaceholderInCompanyId,
          dependencies: fetchStep.dependencies,
          allRetrievedDataCount: allRetrievedData.length,
          allRetrievedDataCollections: allRetrievedData.map((d: any) => d.collection)
        });
        // Find companies from previous steps or from dependency step
        let companyIds: string[] = [];
        
        // First, try to get company IDs from the dependency step (more accurate)
        if (fetchStep.dependencies && fetchStep.dependencies.length > 0) {
          for (const depStepId of fetchStep.dependencies) {
            const depStep = state.plan?.steps?.find((s: any) => s.stepId === depStepId);
            if (depStep && depStep.collection === 'companies') {
              // Find data from this dependency step - look for companies collection data
              // Since steps execute sequentially, the dependency step's data should already be in allRetrievedData
              const depStepData = allRetrievedData.find((d: any) => 
                d.collection === 'companies' && d.documents && d.documents.length > 0
              );
              if (depStepData && depStepData.documents && depStepData.documents.length > 0) {
                companyIds = depStepData.documents
                  .map((doc: any) => doc._id?.toString())
                  .filter((id: string | undefined): id is string => !!id);
                logger.info('Retriever: Extracted company IDs from dependency step', {
                  stepId: fetchStep.stepId,
                  dependencyStepId: depStepId,
                  dependencyCollection: depStep.collection,
                  companyIdsCount: companyIds.length,
                  companyIds: companyIds.slice(0, 3)
                });
                break;
              } else {
                logger.warn('Retriever: Dependency step data not found yet', {
                  stepId: fetchStep.stepId,
                  dependencyStepId: depStepId,
                  dependencyCollection: depStep.collection,
                  allRetrievedDataCollections: allRetrievedData.map((d: any) => d.collection)
                });
              }
            }
          }
        }
        
        // If no company IDs from dependency, try allRetrievedData
        if (companyIds.length === 0) {
          const companyData = allRetrievedData.find(d => d.collection === 'companies');
          if (companyData && companyData.documents.length > 0) {
            companyIds = companyData.documents
              .map((doc: any) => doc._id?.toString())
              .filter((id: string | undefined): id is string => !!id);
          }
        }
        
        // If still no company IDs, try to get from employees
        if (companyIds.length === 0) {
          const employeeData = allRetrievedData.find(d => d.collection === 'employees');
          if (employeeData && employeeData.documents.length > 0) {
            companyIds = employeeData.documents
              .map((doc: any) => doc.companyId?.toString())
              .filter((id: string | undefined): id is string => !!id && id !== 'undefined');
          }
        }
        
        if (companyIds.length > 0) {
          // Replace placeholder in _id.$in (for companies collection)
          if (hasCompanyIdPlaceholderInId) {
            queryToExecute._id.$in = queryToExecute._id.$in
              .filter((id: string) => !id.includes('FROM_STEP') || !id.includes('COMPANY'))
              .concat(companyIds);
            logger.info('Retriever: Replaced company ID placeholder in _id', {
              stepId: fetchStep.stepId,
              companyIdsCount: companyIds.length,
              collection: fetchStep.collection
            });
          }
          
          // Replace placeholder in companyId.$in (for enrichments, gtm_intelligence, etc.)
          if (hasCompanyIdPlaceholderInCompanyId) {
            queryToExecute.companyId.$in = queryToExecute.companyId.$in
              .filter((id: string) => !id.includes('FROM_STEP') || !id.includes('COMPANY'))
              .concat(companyIds);
            logger.info('Retriever: Replaced company ID placeholder in companyId', {
              stepId: fetchStep.stepId,
              companyIdsCount: companyIds.length,
              collection: fetchStep.collection
            });
          }
        } else {
          logger.warn('Retriever: Company ID placeholder found but no company IDs available', {
            stepId: fetchStep.stepId,
            hasDependencies: !!(fetchStep.dependencies && fetchStep.dependencies.length > 0),
            dependencies: fetchStep.dependencies
          });
          // Remove invalid placeholder
          if (hasCompanyIdPlaceholderInId) {
            delete queryToExecute._id;
          }
          if (hasCompanyIdPlaceholderInCompanyId) {
            delete queryToExecute.companyId;
          }
        }
      }
      
      logger.debug('Retriever: About to execute fetch step', {
        stepId: fetchStep.stepId,
        collection: fetchStep.collection,
        mongoQuery: JSON.stringify(queryToExecute),
        limit: fetchStep.limit,
        hasCompanyId: !!(queryToExecute._id || queryToExecute.companyId),
        hasIcpModelId: !!queryToExecute.icpModelId
      });
      
      // Execute with timeout
      const stepData = await withTimeout(
        hybridRetriever.retrieveWithPlan(
          queryToExecute,
          fetchStep.collection,
          state.userId,
          {
            limit: fetchStep.limit || 20,
            sort: fetchStep.sort,
            includeRelated: false
          }
        ),
        config.execution.dbTimeout,
        `Database query timeout for ${fetchStep.collection}`
      );
      allRetrievedData.push(...stepData);
      
      logger.info(`Executed fetch step for ${fetchStep.collection}`, {
        collection: fetchStep.collection,
        count: stepData[0]?.documents?.length || 0,
        stepId: fetchStep.stepId,
        mongoQuery: JSON.stringify(fetchStep.query || {}),
        queryKeys: Object.keys(fetchStep.query || {}),
        limit: fetchStep.limit,
        sort: fetchStep.sort ? JSON.stringify(fetchStep.sort) : undefined,
        sampleData: stepData[0]?.documents?.slice(0, 3).map((d: any) => ({
          _id: d._id?.toString(),
          name: d.name || d.fullName || 'no-name',
          collection: fetchStep.collection,
          companyId: d.companyId?.toString() || undefined
        }))
      });
    }

    // If there are hop steps, prepare company IDs for them
    // The hopper node will handle the actual hopping
    const flattenedData = hybridRetriever.flattenResults(allRetrievedData);

    logger.info('Data retrieved from fetch steps', { 
      collections: allRetrievedData.length,
      totalDocs: flattenedData.length,
      hasHopSteps: hopSteps.length > 0
    });

    // Extract and update lastViewedCompanyIds, lastViewedEmployeeIds, and lastViewedIcpModelIds
    // Always preserve existing IDs and add new ones
    const companyIds: string[] = [...(state.lastViewedCompanyIds || [])];
    const employeeIds: string[] = [...(state.lastViewedEmployeeIds || [])];
    const icpModelIds: string[] = [...(state.lastViewedIcpModelIds || [])];
    
    allRetrievedData.forEach(retrieved => {
      if (retrieved.collection === 'companies') {
        retrieved.documents.forEach((doc: any) => {
          const id = doc._id?.toString();
          if (id && !companyIds.includes(id)) {
            companyIds.push(id);
          }
          // Also extract icpModelId from companies
          const icpModelId = doc.icpModelId?.toString();
          if (icpModelId && !icpModelIds.includes(icpModelId)) {
            icpModelIds.push(icpModelId);
          }
        });
      } else if (retrieved.collection === 'employees') {
        retrieved.documents.forEach((doc: any) => {
          const id = doc._id?.toString();
          if (id && !employeeIds.includes(id)) {
            employeeIds.push(id);
          }
        });
      } else if (retrieved.collection === 'icp_models') {
        retrieved.documents.forEach((doc: any) => {
          const id = doc._id?.toString();
          if (id && !icpModelIds.includes(id)) {
            icpModelIds.push(id);
          }
        });
      }
    });

    logger.info('Updated last viewed IDs', {
      companyIdsCount: companyIds.length,
      employeeIdsCount: employeeIds.length,
      icpModelIdsCount: icpModelIds.length,
      companyIds: companyIds.slice(0, 5),
      employeeIds: employeeIds.slice(0, 5),
      icpModelIds: icpModelIds.slice(0, 5)
    });

    // CRITICAL: For action queries (execute intent), route directly to executor (skip analyzer/critic)
    const isExecuteIntent = state.intent?.type === 'execute';
    const hasExternalActions = state.intent?.actions && 
                              state.intent.actions.length > 0 &&
                              state.intent.actions.some((a: string) => 
                                !['fetch', 'hop', 'aggregate'].includes(a)
                              );
    
    if (isExecuteIntent || hasExternalActions) {
      logger.info('Retriever: Action query detected - routing to executor (skipping analyzer)', {
        intentType: state.intent?.type,
        actions: state.intent?.actions,
        companiesRetrieved: allRetrievedData.find(r => r.collection === 'companies')?.documents.length || 0
      });
        return {
          retrievedData: allRetrievedData,
          flattenedData,
          lastViewedCompanyIds: companyIds,
          lastViewedEmployeeIds: employeeIds,
          lastViewedIcpModelIds: icpModelIds,
          currentNode: 'executor', // Route directly to executor for action queries
          nodeStartTimes: { ...nodeStartTimes, retriever: nodeStartTime },
          ...progressUpdate
        };
    }

    // If there are hop steps, ALWAYS go to hopper (regardless of requiresHopping flag)
    // The hopper will handle the case where source data is empty
    const nextNode = hopSteps.length > 0
      ? 'hopper'
      : 'analyzer';

    // Update progress
    const progressUpdate = updateProgress({
      ...state,
      currentNode: 'retriever',
      progress: state.progress || {
        currentNode: 'retriever',
        completedNodes: ['planner'],
        progressPercentage: 0,
        lastUpdate: Date.now()
      }
    });
    
    return {
      retrievedData: allRetrievedData,
      flattenedData,
      lastViewedCompanyIds: companyIds,
      lastViewedEmployeeIds: employeeIds,
      lastViewedIcpModelIds: icpModelIds,
      currentNode: nextNode,
      nodeStartTimes: { ...nodeStartTimes, retriever: nodeStartTime },
      ...progressUpdate
    };
  } catch (error: any) {
    logger.error('Retriever node failed', { error: error.message, stack: error.stack });
    
    return {
      errors: [...state.errors, `Retrieval failed: ${error.message}`],
      currentNode: 'error',
    };
  }
}

async function executeAggregationPlan(
  steps: any[],
  userId: string
): Promise<any[]> {
  const aggregationStep = steps.find(s => s.action === 'aggregate');
  
  if (!aggregationStep) {
    throw new Error('No aggregation step found in plan');
  }

  const { collection, aggregation } = aggregationStep;

  if (!aggregation?.pipeline) {
    throw new Error('No aggregation pipeline specified');
  }

  // Replace USERID_PLACEHOLDER with actual userId in pipeline
  const pipeline = JSON.parse(
    JSON.stringify(aggregation.pipeline).replace(/USERID_PLACEHOLDER/g, userId)
  );

  logger.debug('Executing aggregation', { 
    collection, 
    pipeline: JSON.stringify(pipeline) 
  });

  const results = await searchService.aggregate(collection, pipeline, userId);

  logger.info('Aggregation completed', { 
    collection, 
    resultCount: results.length 
  });

  return results;
}
