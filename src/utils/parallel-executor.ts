// src/utils/parallel-executor.ts
import { logger } from '../core/logger';
import { config } from '../core/config';
import { hybridRetriever } from '../retrieval/hybrid-retriever';

/**
 * Executes independent fetch steps in parallel
 */
export async function executeParallelFetches(
  steps: any[],
  userId: string,
  allRetrievedData: any[]
): Promise<any[]> {
  if (!config.execution.enableParallelExecution) {
    // Sequential execution (original behavior)
    return [];
  }
  
  // Find independent fetch steps (no dependencies)
  const independentSteps = steps.filter(step => 
    step.action === 'fetch' && 
    (!step.dependencies || step.dependencies.length === 0)
  );
  
  if (independentSteps.length <= 1) {
    // No parallelization needed
    return [];
  }
  
  // Limit parallel execution
  const maxParallel = config.execution.maxParallelFetches;
  const stepsToParallelize = independentSteps.slice(0, maxParallel);
  
  logger.info('Executing parallel fetches', {
    totalIndependentSteps: independentSteps.length,
    parallelizing: stepsToParallelize.length,
    maxParallel
  });
  
  // Execute in parallel
  const parallelResults = await Promise.all(
    stepsToParallelize.map(async (step) => {
      try {
        const startTime = Date.now();
        const data = await hybridRetriever.retrieveWithPlan(
          step.query,
          step.collection,
          userId,
          {
            limit: step.limit || 20,
            sort: step.sort,
            includeRelated: false
          }
        );
        
        const duration = Date.now() - startTime;
        logger.debug('Parallel fetch completed', {
          stepId: step.stepId,
          collection: step.collection,
          duration: `${duration}ms`,
          count: data[0]?.documents?.length || 0
        });
        
        return {
          stepId: step.stepId,
          collection: step.collection,
          data: data[0] || { collection: step.collection, documents: [], metadata: { count: 0 } }
        };
      } catch (error: any) {
        logger.error('Parallel fetch failed', {
          stepId: step.stepId,
          collection: step.collection,
          error: error.message
        });
        return {
          stepId: step.stepId,
          collection: step.collection,
          data: { collection: step.collection, documents: [], metadata: { count: 0 } },
          error: error.message
        };
      }
    })
  );
  
  // Add results to allRetrievedData
  parallelResults.forEach(result => {
    if (result.data && !result.error) {
      const existing = allRetrievedData.find(d => d.collection === result.collection);
      if (existing) {
        // Merge documents
        const existingIds = new Set(existing.documents.map((d: any) => d._id.toString()));
        const newDocs = result.data.documents.filter((d: any) => 
          !existingIds.has(d._id.toString())
        );
        existing.documents.push(...newDocs);
        existing.metadata.count += newDocs.length;
      } else {
        allRetrievedData.push(result.data);
      }
    }
  });
  
  logger.info('Parallel fetches completed', {
    successful: parallelResults.filter(r => !r.error).length,
    failed: parallelResults.filter(r => r.error).length,
    totalDocuments: allRetrievedData.reduce((sum, d) => sum + (d.documents?.length || 0), 0)
  });
  
  // Return step IDs that were executed in parallel (so retriever can skip them)
  return parallelResults.map(r => r.stepId);
}

