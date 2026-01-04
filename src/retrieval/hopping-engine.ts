import { searchService } from '../services/search.service';
import { schemaService } from '../services/schema.service';
import { logger } from '../core/logger';
import { RetrievalStep, HoppingPath } from '../types';
import mongoose from 'mongoose';

export interface HopResult {
  collection: string;
  documents: any[];
  path: HoppingPath[];
}

export class HoppingEngine {
  async executeHop(
    step: RetrievalStep,
    userId: string,
    previousResults?: any[]
  ): Promise<any[]> {
    if (!step.hoppingPath) {
      return [];
    }

    const { from, to, via } = step.hoppingPath;
    
    const sourceIds = previousResults 
      ? previousResults.map(doc => doc._id.toString())
      : [];

    if (sourceIds.length === 0) {
      logger.warn('No source IDs for hopping', { from, to });
      return [];
    }

    try {
      const results = await searchService.hop(from, sourceIds, to, via, userId);
      
      logger.info('Hop executed', { 
        from, 
        to, 
        sourceCount: sourceIds.length,
        resultCount: results.length 
      });

      return results;
    } catch (error: any) {
      logger.error('Hop execution failed', { 
        from, 
        to, 
        error: error.message 
      });
      return [];
    }
  }

  async executeMultiHop(
    startCollection: string,
    startIds: string[],
    targetCollection: string,
    userId: string
  ): Promise<HopResult> {
    const path = this.findPath(startCollection, targetCollection);
    
    if (path.length === 0) {
      logger.warn('No path found', { startCollection, targetCollection });
      return {
        collection: targetCollection,
        documents: [],
        path: [],
      };
    }

    let currentIds = startIds;
    let currentCollection = startCollection;
    const executedPath: HoppingPath[] = [];

    for (const hop of path) {
      const results = await searchService.hop(
        currentCollection,
        currentIds,
        hop.to,
        hop.via,
        userId
      );

      executedPath.push(hop);
      currentIds = results.map(doc => doc._id.toString());
      currentCollection = hop.to;

      if (currentIds.length === 0) {
        logger.warn('Hop chain broken - no results', { 
          at: hop.to,
          from: hop.from 
        });
        break;
      }
    }

    // CRITICAL: Always include userId filter for security
    const TargetModel = (searchService as any).getModel(targetCollection);
    const finalFilter: any = {
      _id: { $in: currentIds.map(id => new mongoose.Types.ObjectId(id)) },
    };
    
    // CRITICAL: Always add userId if the model has userId field
    if (TargetModel.schema.paths.userId) {
      finalFilter.userId = userId;
    }
    
    const finalDocs = await TargetModel.find(finalFilter).lean();

    return {
      collection: targetCollection,
      documents: finalDocs,
      path: executedPath,
    };
  }

  private findPath(
    start: string,
    target: string,
    visited: Set<string> = new Set()
  ): HoppingPath[] {
    if (start === target) {
      return [];
    }

    visited.add(start);

    const directPath = schemaService.findHoppingPath(start, target);
    if (directPath) {
      return [directPath];
    }

    const relatedCollections = schemaService.getRelatedCollections(start);
    
    for (const intermediate of relatedCollections) {
      if (visited.has(intermediate)) continue;

      const firstHop = schemaService.findHoppingPath(start, intermediate);
      if (!firstHop) continue;

      const remainingPath = this.findPath(intermediate, target, visited);
      
      if (remainingPath.length > 0) {
        return [firstHop, ...remainingPath];
      }
    }

    return [];
  }

  buildHoppingPlan(
    collection: string,
    targetCollections: string[]
  ): RetrievalStep[] {
    const steps: RetrievalStep[] = [];

    targetCollections.forEach((target, index) => {
      const path = schemaService.findHoppingPath(collection, target);
      
      if (path) {
        steps.push({
          stepId: `hop_${index}`,
          action: 'hop',
          collection: target,
          query: {},
          hoppingPath: path,
          dependencies: index > 0 ? [`hop_${index - 1}`] : undefined,
        });
      }
    });

    return steps;
  }
}

export const hoppingEngine = new HoppingEngine();