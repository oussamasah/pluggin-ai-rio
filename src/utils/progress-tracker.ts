// src/utils/progress-tracker.ts
import { logger } from '../core/logger';
import { config } from '../core/config';
import { GraphState } from '../graph/state';

/**
 * Node execution order and estimated durations (in milliseconds)
 */
const NODE_DURATIONS: Record<string, number> = {
  planner: 5000,      // ~5s
  retriever: 3000,    // ~3s
  hopper: 2000,       // ~2s
  analyzer: 10000,    // ~10s
  critic: 5000,      // ~5s
  executor: 8000,     // ~8s
  responder: 5000,    // ~5s
};

const NODE_ORDER = ['planner', 'retriever', 'hopper', 'analyzer', 'critic', 'executor', 'responder'];

/**
 * Calculates progress percentage based on completed nodes
 */
export function calculateProgress(
  completedNodes: string[],
  currentNode: string
): number {
  const currentIndex = NODE_ORDER.indexOf(currentNode);
  const completedCount = completedNodes.length;
  const totalNodes = NODE_ORDER.length;
  
  // Base progress from completed nodes
  const baseProgress = (completedCount / totalNodes) * 80; // 80% for node completion
  
  // Add progress for current node (estimate 20% remaining)
  const currentNodeProgress = currentIndex >= 0 ? (20 / totalNodes) : 0;
  
  return Math.min(100, Math.round(baseProgress + currentNodeProgress));
}

/**
 * Estimates time remaining based on completed nodes and elapsed time
 */
export function estimateTimeRemaining(
  completedNodes: string[],
  currentNode: string,
  elapsedTime: number
): number | undefined {
  if (completedNodes.length === 0) return undefined;
  
  const completedDurations = completedNodes.reduce((sum, node) => {
    return sum + (NODE_DURATIONS[node] || 5000);
  }, 0);
  
  const avgNodeTime = completedDurations / completedNodes.length;
  const remainingNodes = NODE_ORDER.filter(
    node => !completedNodes.includes(node) && node !== currentNode
  );
  
  return remainingNodes.length * avgNodeTime;
}

/**
 * Updates progress state
 */
export function updateProgress(state: GraphState): Partial<GraphState> {
  if (!config.execution.enableProgressTracking) {
    return {};
  }
  
  const completedNodes = state.progress?.completedNodes || [];
  const currentNode = state.currentNode || 'start';
  
  // Add current node to completed if it's not already there and we've moved on
  const lastCompleted = completedNodes[completedNodes.length - 1];
  if (lastCompleted && lastCompleted !== currentNode && !completedNodes.includes(currentNode)) {
    // Node completed, add to completed list
    completedNodes.push(lastCompleted);
  }
  
  const progressPercentage = calculateProgress(completedNodes, currentNode);
  const elapsedTime = Date.now() - state.startTime;
  const estimatedTimeRemaining = estimateTimeRemaining(completedNodes, currentNode, elapsedTime);
  
  const progress = {
    currentNode,
    completedNodes: [...completedNodes],
    progressPercentage,
    estimatedTimeRemaining,
    lastUpdate: Date.now(),
  };
  
  // Log progress every interval
  const lastUpdate = state.progress?.lastUpdate || state.startTime;
  if (Date.now() - lastUpdate >= config.execution.progressInterval) {
    logger.info('Execution progress', {
      currentNode,
      progressPercentage: `${progressPercentage}%`,
      completedNodes: completedNodes.length,
      elapsedTime: `${Math.round(elapsedTime / 1000)}s`,
      estimatedTimeRemaining: estimatedTimeRemaining 
        ? `${Math.round(estimatedTimeRemaining / 1000)}s` 
        : 'calculating...'
    });
  }
  
  return { progress };
}

