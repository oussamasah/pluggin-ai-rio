// src/utils/timeout.ts
import { logger } from '../core/logger';
import { config } from '../core/config';

/**
 * Creates a timeout promise that rejects after specified time
 */
export function createTimeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Timeout: ${message} (${ms}ms)`));
    }, ms);
  });
}

/**
 * Wraps a promise with a timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  return Promise.race([
    promise,
    createTimeout(timeoutMs, errorMessage)
  ]);
}

/**
 * Checks if execution has exceeded total timeout
 */
export function checkTotalTimeout(startTime: number): void {
  const elapsed = Date.now() - startTime;
  const totalTimeout = config.execution.totalTimeout;
  
  if (elapsed > totalTimeout) {
    throw new Error(`Total execution timeout exceeded: ${elapsed}ms > ${totalTimeout}ms`);
  }
  
  const remaining = totalTimeout - elapsed;
  if (remaining < 10000) { // Less than 10s remaining
    logger.warn('Approaching total timeout', {
      elapsed,
      remaining,
      totalTimeout
    });
  }
}

/**
 * Tracks node execution time and checks for timeout
 */
export function trackNodeExecution(
  nodeName: string,
  nodeStartTimes: Record<string, number>,
  timeoutMs: number = config.execution.nodeTimeout
): void {
  const now = Date.now();
  const startTime = nodeStartTimes[nodeName] || now;
  const elapsed = now - startTime;
  
  if (elapsed > timeoutMs) {
    throw new Error(`Node ${nodeName} exceeded timeout: ${elapsed}ms > ${timeoutMs}ms`);
  }
  
  logger.debug('Node execution time', {
    node: nodeName,
    elapsed,
    timeout: timeoutMs,
    remaining: timeoutMs - elapsed
  });
}

