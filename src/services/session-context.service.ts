import { logger } from '../core/logger';
import { RetrievedData } from '../types';
import { memoryService } from './memory.service';

export interface PreviousQueryResult {
  query: string;
  timestamp: Date;
  retrievedData: RetrievedData[];
  flattenedData: Record<string, any>[];
  analysis?: string; // Store the analysis text for context
  summary: {
    companies: number;
    employees: number;
    other: number;
  };
}

export class SessionContextService {
  private sessionCache: Map<string, PreviousQueryResult[]> = new Map();
  private cacheTTL = 3600000; // 1 hour
  private useMem0: boolean = true; // Use Mem0 for persistence

  /**
   * Retrieve previous query results from the same session
   * Uses in-memory cache (fast, session-scoped) or Mem0 (persistent, cross-session)
   */
  async getPreviousResults(
    sessionId: string | undefined,
    userId: string,
    currentQuery: string,
    forceLoadFromMem0: boolean = false
  ): Promise<PreviousQueryResult[]> {
    // Method 1: In-memory cache (fast, session-scoped) - DEFAULT
    // Skip if forcing Mem0 load (e.g., for "this context" queries)
    if (sessionId && !forceLoadFromMem0) {
      const cacheKey = `${sessionId}:${userId}`;
      const cached = this.sessionCache.get(cacheKey);
      if (cached && cached.length > 0) {
        logger.debug('Using cached previous results (in-memory)', { 
          sessionId, 
          count: cached.length,
          mostRecentQuery: cached[0]?.query?.substring(0, 50)
        });
        return cached;
      }
    }

    // Method 2: Mem0 (persistent, cross-session) - OPTIONAL
    // Always try Mem0 if enabled, especially for "this context" queries
    if (this.useMem0) {
      try {
        const mem0Results = await this.getFromMem0(userId, currentQuery, sessionId || '');
        if (mem0Results.length > 0) {
          logger.debug('Using previous results from Mem0', {
            sessionId: sessionId || 'none',
            count: mem0Results.length,
            forceLoad: forceLoadFromMem0
          });
          // Cache in memory for faster access
          if (sessionId) {
            const cacheKey = `${sessionId}:${userId}`;
            this.sessionCache.set(cacheKey, mem0Results);
          }
          return mem0Results;
        }
      } catch (error: any) {
        logger.warn('Failed to retrieve from Mem0, using in-memory only', {
          error: error.message
        });
      }
    }

    logger.debug('No previous results found', { sessionId: sessionId || 'none' });
    return [];
  }

  /**
   * Retrieve previous results from Mem0 (optional, for cross-session persistence)
   */
  private async getFromMem0(
    userId: string,
    currentQuery: string,
    sessionId: string
  ): Promise<PreviousQueryResult[]> {
    try {
      // Search Mem0 for recent query results
      const memories = await memoryService.searchMemories(
        userId,
        `query results companies employees session`,
        10
      );

      if (memories.length === 0) {
        return [];
      }

      // Parse Mem0 memories back into PreviousQueryResult format
      // Note: We don't store full retrievedData/flattenedData in Mem0 to avoid size limits
      // Instead, we reconstruct minimal PreviousQueryResult objects from metadata
      const results: PreviousQueryResult[] = [];
      
      for (const memory of memories) {
        if (memory.metadata?.type === 'session_query') {
          try {
            // Reconstruct minimal PreviousQueryResult from metadata
            // We can't fully reconstruct retrievedData, but we can create a summary
            const retrievedData: RetrievedData[] = [];
            
            // Add companies if we have IDs
            if (memory.metadata.lastViewedCompanyIds && Array.isArray(memory.metadata.lastViewedCompanyIds)) {
              retrievedData.push({
                collection: 'companies',
                documents: memory.metadata.lastViewedCompanyIds.map((id: string) => ({ _id: id })),
                limit: memory.metadata.lastViewedCompanyIds.length,
                metadata: {
                  count: memory.metadata.lastViewedCompanyIds.length,
                  searchMethod: 'metadata',
                  confidence: 0.8,
                },
              });
            }
            
            // Add employees if we have IDs
            if (memory.metadata.lastViewedEmployeeIds && Array.isArray(memory.metadata.lastViewedEmployeeIds)) {
              retrievedData.push({
                collection: 'employees',
                documents: memory.metadata.lastViewedEmployeeIds.map((id: string) => ({ _id: id })),
                limit: memory.metadata.lastViewedEmployeeIds.length,
                metadata: {
                  count: memory.metadata.lastViewedEmployeeIds.length,
                  searchMethod: 'metadata',
                  confidence: 0.8,
                },
              });
            }
            
            // Add ICP models if we have IDs
            if (memory.metadata.lastViewedIcpModelIds && Array.isArray(memory.metadata.lastViewedIcpModelIds)) {
              retrievedData.push({
                collection: 'icp_models',
                documents: memory.metadata.lastViewedIcpModelIds.map((id: string) => ({ _id: id })),
                limit: memory.metadata.lastViewedIcpModelIds.length,
                metadata: {
                  count: memory.metadata.lastViewedIcpModelIds.length,
                  searchMethod: 'metadata',
                  confidence: 0.8,
                },
              });
            }

            results.push({
              query: memory.metadata.query || memory.memory.substring(0, 200),
              timestamp: memory.metadata.timestamp ? new Date(memory.metadata.timestamp) : new Date(),
              retrievedData,
              flattenedData: [], // Empty since we don't store full data
              summary: {
                companies: memory.metadata.companiesCount || 0,
                employees: memory.metadata.employeesCount || 0,
                other: memory.metadata.otherCount || 0,
              },
            });
          } catch (parseError: any) {
            logger.warn('Failed to parse Mem0 memory data', {
              memoryId: memory.id,
              error: parseError.message
            });
          }
        }
      }

      // Sort by timestamp (most recent first) and limit to 5
      return results
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, 5);
    } catch (error: any) {
      logger.warn('Failed to retrieve from Mem0', { error: error.message });
      return [];
    }
  }

  /**
   * Store query results for future reference
   * Uses in-memory cache (default) and optionally Mem0 for persistence
   */
  async storeQueryResults(
    sessionId: string | undefined,
    userId: string,
    query: string,
    retrievedData: RetrievedData[],
    flattenedData: Record<string, any>[],
    analysis?: string // Optional: store analysis text for context
  ): Promise<void> {
    if (!sessionId) {
      return;
    }

    const cacheKey = `${sessionId}:${userId}`;
    const existing = this.sessionCache.get(cacheKey) || [];

    const summary = {
      companies: retrievedData.find(r => r.collection === 'companies')?.documents.length || 0,
      employees: retrievedData.find(r => r.collection === 'employees')?.documents.length || 0,
      other: retrievedData.filter(r => 
        r.collection !== 'companies' && r.collection !== 'employees'
      ).reduce((sum, r) => sum + r.documents.length, 0),
    };

    const newResult: PreviousQueryResult = {
      query,
      timestamp: new Date(),
      retrievedData,
      flattenedData,
      analysis: analysis ? analysis.substring(0, 2000) : undefined, // Store analysis (truncated to 2000 chars)
      summary,
    };

    // Method 1: Store in in-memory cache (fast, session-scoped) - DEFAULT
    const updated = [newResult, ...existing].slice(0, 5);
    this.sessionCache.set(cacheKey, updated);

    logger.debug('Stored query results in session cache (in-memory)', {
      sessionId,
      query: query.substring(0, 50),
      summary,
    });

    // Method 2: Optionally store in Mem0 for cross-session persistence
    if (this.useMem0) {
      try {
        await this.storeInMem0(userId, query, sessionId, summary, retrievedData, flattenedData);
      } catch (error: any) {
        logger.warn('Failed to store in Mem0, using in-memory only', {
          error: error.message
        });
      }
    }
  }

  /**
   * Get last viewed IDs from Mem0 for a user
   */
  async getLastViewedIds(userId: string): Promise<{
    lastViewedCompanyIds: string[];
    lastViewedEmployeeIds: string[];
    lastViewedIcpModelIds: string[];
  }> {
    const result = {
      lastViewedCompanyIds: [] as string[],
      lastViewedEmployeeIds: [] as string[],
      lastViewedIcpModelIds: [] as string[],
    };

    if (!this.useMem0) {
      return result;
    }

    try {
      // Search Mem0 for recent query results to extract IDs
      const memories = await memoryService.searchMemories(
        userId,
        'query results companies employees',
        5
      );

      for (const memory of memories) {
        if (memory.metadata?.type === 'session_query') {
          // Extract IDs from metadata
          if (memory.metadata.lastViewedCompanyIds && Array.isArray(memory.metadata.lastViewedCompanyIds)) {
            const ids = memory.metadata.lastViewedCompanyIds.filter((id: any) => 
              typeof id === 'string' && id.length > 0 && !result.lastViewedCompanyIds.includes(id)
            );
            result.lastViewedCompanyIds.push(...ids);
          }
          if (memory.metadata.lastViewedEmployeeIds && Array.isArray(memory.metadata.lastViewedEmployeeIds)) {
            const ids = memory.metadata.lastViewedEmployeeIds.filter((id: any) => 
              typeof id === 'string' && id.length > 0 && !result.lastViewedEmployeeIds.includes(id)
            );
            result.lastViewedEmployeeIds.push(...ids);
          }
          if (memory.metadata.lastViewedIcpModelIds && Array.isArray(memory.metadata.lastViewedIcpModelIds)) {
            const ids = memory.metadata.lastViewedIcpModelIds.filter((id: any) => 
              typeof id === 'string' && id.length > 0 && !result.lastViewedIcpModelIds.includes(id)
            );
            result.lastViewedIcpModelIds.push(...ids);
          }
        }
      }
      
      // Limit total IDs to prevent memory issues
      result.lastViewedCompanyIds = result.lastViewedCompanyIds.slice(0, 100);
      result.lastViewedEmployeeIds = result.lastViewedEmployeeIds.slice(0, 100);
      result.lastViewedIcpModelIds = result.lastViewedIcpModelIds.slice(0, 50);

      logger.debug('Retrieved last viewed IDs from Mem0', {
        userId,
        companyIdsCount: result.lastViewedCompanyIds.length,
        employeeIdsCount: result.lastViewedEmployeeIds.length,
        icpModelIdsCount: result.lastViewedIcpModelIds.length,
      });
    } catch (error: any) {
      logger.warn('Failed to retrieve last viewed IDs from Mem0', {
        error: error.message
      });
    }

    return result;
  }

  /**
   * Store query results in Mem0 (optional, for cross-session persistence)
   */
  private async storeInMem0(
    userId: string,
    query: string,
    sessionId: string,
    summary: { companies: number; employees: number; other: number },
    retrievedData: RetrievedData[],
    flattenedData?: Record<string, any>[]
  ): Promise<void> {
    try {
      // Extract key entities for Mem0 storage
      const companies = retrievedData.find(r => r.collection === 'companies')?.documents || [];
      const employees = retrievedData.find(r => r.collection === 'employees')?.documents || [];
      const icpModels = retrievedData.find(r => r.collection === 'icp_models')?.documents || [];

      // Build comprehensive memory text (keep it concise)
      const companyNames = companies.slice(0, 5).map((c: any) => c.name).filter(Boolean).join(', ');
      const employeeNames = employees.slice(0, 5).map((e: any) => e.fullName).filter(Boolean).join(', ');
      
      const memoryText = `User queried "${query.substring(0, 200)}" and found ${summary.companies} companies${companyNames ? `: ${companyNames}` : ''} and ${summary.employees} employees${employeeNames ? `: ${employeeNames}` : ''}.`;

      // Extract IDs for context persistence (limit to prevent metadata size issues)
      const lastViewedCompanyIds = companies
        .map((c: any) => c._id?.toString())
        .filter(Boolean)
        .slice(0, 50); // Limit to 50 IDs
      
      const lastViewedEmployeeIds = employees
        .map((e: any) => e._id?.toString())
        .filter(Boolean)
        .slice(0, 50); // Limit to 50 IDs
      
      const lastViewedIcpModelIds = [
        ...icpModels.map((m: any) => m._id?.toString()),
        ...companies.map((c: any) => c.icpModelId?.toString())
      ]
        .filter(Boolean)
        .filter((id, index, self) => self.indexOf(id) === index) // Remove duplicates
        .slice(0, 20); // Limit to 20 IDs

      // Build metadata object (keep it small - Mem0 may have size limits)
      const metadata: Record<string, any> = {
        type: 'session_query',
        sessionId: sessionId.substring(0, 100), // Limit sessionId length
        query: query.substring(0, 500), // Limit query length
        companiesCount: summary.companies,
        employeesCount: summary.employees,
        otherCount: summary.other,
        timestamp: new Date().toISOString(),
        // Store IDs for context persistence (arrays are fine)
        lastViewedCompanyIds: lastViewedCompanyIds.length > 0 ? lastViewedCompanyIds : undefined,
        lastViewedEmployeeIds: lastViewedEmployeeIds.length > 0 ? lastViewedEmployeeIds : undefined,
        lastViewedIcpModelIds: lastViewedIcpModelIds.length > 0 ? lastViewedIcpModelIds : undefined,
      };

      // Remove undefined values to reduce payload size
      Object.keys(metadata).forEach(key => {
        if (metadata[key] === undefined) {
          delete metadata[key];
        }
      });

      // Store in Mem0 (without full retrievedData/flattenedData to avoid size issues)
      await memoryService.addMemory(userId, memoryText, metadata);

      logger.debug('Stored query results in Mem0', {
        userId,
        sessionId,
        query: query.substring(0, 50),
        summary,
        companyIdsCount: lastViewedCompanyIds.length,
        employeeIdsCount: lastViewedEmployeeIds.length,
        icpModelIdsCount: lastViewedIcpModelIds.length
      });
    } catch (error: any) {
      logger.warn('Failed to store in Mem0', { 
        error: error.message,
        userId,
        sessionId 
      });
      // Don't throw - allow system to continue without Mem0 storage
    }
  }

  /**
   * Extract entities from previous results that match the current query
   */
  extractRelevantEntities(
    previousResults: PreviousQueryResult[],
    currentQuery: string
  ): {
    companies: Array<{ _id: string; name: string }>;
    employees: Array<{ _id: string; fullName: string; activeExperienceTitle?: string }>;
    icpModels: Array<{ _id: string; name?: string }>;
  } {
    const companies: Array<{ _id: string; name: string }> = [];
    const employees: Array<{ _id: string; fullName: string; activeExperienceTitle?: string }> = [];
    const icpModels: Array<{ _id: string; name?: string }> = [];

    // Check if query contains references like "this", "that", "the", "previous", "this company", "that company"
    // Also check for references to previous answers, analysis, results, searches
    const hasReference = /\b(this|that|the|previous|last|earlier|those|these|mentioned|above)\b/i.test(currentQuery) ||
                         /\b(this|that|the|those|these|previous|last|earlier)\s+(company|companies|employee|employees|ceo|executive|manager|icp|model)\b/i.test(currentQuery) ||
                         /\b(all\s+)?(those|these|previous|last|earlier)\s+compan(?:y|ies)\b/i.test(currentQuery) ||
                         /\b(previous|last|earlier|above|mentioned)\s+(answer|result|results|analysis|search|query|data)\b/i.test(currentQuery) ||
                         /\b(those|these|the)\s+(results|companies|employees|answers|analyses|searches)\b/i.test(currentQuery);

    if (!hasReference && previousResults.length === 0) {
      return { companies, employees, icpModels };
    }

    // Extract from most recent results
    const mostRecent = previousResults[0];
    if (!mostRecent) {
      return { companies, employees, icpModels };
    }

    // Extract companies
    const companyData = mostRecent.retrievedData.find(r => r.collection === 'companies');
    if (companyData) {
      companyData.documents.forEach((doc: any) => {
        if (doc._id && doc.name) {
          companies.push({
            _id: doc._id.toString(),
            name: doc.name,
          });
        }
      });
    }

    // Extract employees
    const employeeData = mostRecent.retrievedData.find(r => r.collection === 'employees');
    if (employeeData) {
      employeeData.documents.forEach((doc: any) => {
        if (doc._id && doc.fullName) {
          employees.push({
            _id: doc._id.toString(),
            fullName: doc.fullName,
            activeExperienceTitle: doc.activeExperienceTitle,
          });
        }
      });
    }

    // Extract ICP models
    const icpModelData = mostRecent.retrievedData.find(r => r.collection === 'icp_models');
    if (icpModelData) {
      icpModelData.documents.forEach((doc: any) => {
        if (doc._id) {
          icpModels.push({
            _id: doc._id.toString(),
            name: doc.name,
          });
        }
      });
    }

    logger.debug('Extracted relevant entities from previous results', {
      companiesCount: companies.length,
      employeesCount: employees.length,
      icpModelsCount: icpModels.length,
      hasReference,
    });

    return { companies, employees, icpModels };
  }
}

export const sessionContextService = new SessionContextService();

