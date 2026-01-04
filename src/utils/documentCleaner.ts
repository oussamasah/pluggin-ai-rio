// src/utils/documentCleaner.ts
import { logger } from '../core/logger';
import { config } from '../core/config';

export interface CleanerOptions {
  maxTokens?: number;
  removeEmptyFields?: boolean;
  truncateStrings?: boolean;
  maxStringLength?: number;
  maxArrayItems?: number;
  excludeFields?: string[];
  includeFields?: string[];
  flattenNested?: boolean;
  compressNumbers?: boolean;
  preserveDocumentCount?: boolean; // NEW: Try to keep all documents
  priorityFields?: string[]; // NEW: Fields to preserve at all costs
  queryIntent?: string; // NEW: Pass query intent for better optimization
}

export class DocumentCleaner {
  private defaultOptions: CleanerOptions = {
    maxTokens: config.llm?.maxInputTokens ? Math.floor(config.llm.maxInputTokens * 0.6) : 4000,
    removeEmptyFields: true,
    truncateStrings: true,
    maxStringLength: 300,
    maxArrayItems: 10,
    excludeFields: ['__v', 'embedding', 'searchKeywords', 'semanticSummary'],
    includeFields: [],
    flattenNested: false,
    compressNumbers: false,
    preserveDocumentCount: false, // Default: allow reduction
    priorityFields: ['_id', 'name', 'score'], // Fields to preserve
    queryIntent: 'search'
  };

  /**
   * Clean a single document based on query context
   */
  cleanDocument(
    document: any, 
    queryContext?: string,
    options?: Partial<CleanerOptions>
  ): any {
    const opts = { ...this.defaultOptions, ...options };
    const contextAwareExclusions = this.getContextAwareExclusions(queryContext, opts);
    
    // Deep clone to avoid mutating original
    let cleaned = JSON.parse(JSON.stringify(document));
    
    // Apply cleaning steps
    cleaned = this.removeExcludedFields(cleaned, contextAwareExclusions);
    cleaned = this.removeEmptyFields(cleaned, opts.removeEmptyFields);
    cleaned = this.truncateStrings(cleaned, opts.maxStringLength);
    cleaned = this.limitArrays(cleaned, opts.maxArrayItems);
    cleaned = this.compressNestedObjects(cleaned, queryContext, opts);
    
    // Apply field selection if specified
    if (opts.includeFields.length > 0) {
      cleaned = this.selectFields(cleaned, opts.includeFields, opts.priorityFields);
    }
    
    return cleaned;
  }

  /**
   * Clean an array of documents with intelligent optimization
   */
  cleanDocuments(
    documents: any[], 
    queryContext?: string,
    options?: Partial<CleanerOptions>
  ): any[] {
    const opts = { ...this.defaultOptions, ...options };
    
    if (documents.length === 0) {
      return [];
    }

    // Apply progressive cleaning strategy
    const strategies = this.getCleaningStrategies(opts.preserveDocumentCount);
    
    for (const strategy of strategies) {
      const attemptOptions = { ...opts, ...strategy };
      const cleanedDocs = documents.map(doc => 
        this.cleanDocument(doc, queryContext, attemptOptions)
      );
      
      const totalTokens = this.estimateTokens(JSON.stringify(cleanedDocs));
      
      if (totalTokens <= opts.maxTokens) {
        logger.debug('Cleaning strategy successful', {
          strategy: strategy.name,
          originalCount: documents.length,
          finalCount: cleanedDocs.length,
          tokens: totalTokens,
          maxTokens: opts.maxTokens
        });
        return cleanedDocs;
      }
      
      logger.debug('Cleaning strategy insufficient', {
        strategy: strategy.name,
        tokens: totalTokens,
        maxTokens: opts.maxTokens
      });
    }
    
    // If all strategies fail, apply aggressive reduction
    return this.applyAggressiveReduction(documents, queryContext, opts);
  }

  /**
   * Get progressive cleaning strategies
   */
  private getCleaningStrategies(preserveCount: boolean): Array<Partial<CleanerOptions> & { name: string }> {
    const strategies = [
      {
        name: 'minimal',
        maxStringLength: 500,
        maxArrayItems: 15,
        removeEmptyFields: true,
        excludeFields: ['embedding', 'searchKeywords', 'semanticSummary', '__v', 'createdAt', 'updatedAt']
      },
      {
        name: 'moderate',
        maxStringLength: 300,
        maxArrayItems: 10,
        removeEmptyFields: true,
        excludeFields: ['embedding', 'searchKeywords', 'semanticSummary', '__v', 'createdAt', 'updatedAt', 'relationships', 'intentSignals.details']
      },
      {
        name: 'aggressive',
        maxStringLength: 200,
        maxArrayItems: 5,
        removeEmptyFields: true,
        excludeFields: ['embedding', 'searchKeywords', 'semanticSummary', '__v', 'createdAt', 'updatedAt', 'relationships', 'intentSignals', 'description', 'logoUrl']
      }
    ];

    if (preserveCount) {
      // Add extra aggressive strategies that preserve count
      strategies.push(
        {
          name: 'preserve_count_1',
          maxStringLength: 150,
          maxArrayItems: 3,
          removeEmptyFields: true,
          excludeFields: ['embedding', 'searchKeywords', 'semanticSummary', '__v', 'createdAt', 'updatedAt', 'relationships', 'intentSignals', 'description', 'logoUrl', 'technologies', 'contactEmail', 'contactPhone'],
          includeFields: ['_id', 'name', 'score', 'scoringMetrics', 'industry', 'employeeCount', 'annualRevenue']
        },
        {
          name: 'preserve_count_2',
          maxStringLength: 100,
          maxArrayItems: 2,
          removeEmptyFields: true,
          excludeFields: ['embedding', 'searchKeywords', 'semanticSummary', '__v', 'createdAt', 'updatedAt', 'relationships', 'intentSignals', 'description', 'logoUrl', 'technologies', 'contactEmail', 'contactPhone', 'summary'],
          includeFields: ['_id', 'name', 'scoringMetrics.score', 'scoringMetrics.confidence', 'industry.0', 'employeeCount']
        }
      );
    }

    return strategies;
  }

  /**
   * Apply aggressive reduction when all else fails
   */
  private applyAggressiveReduction(
    documents: any[], 
    queryContext?: string,
    options?: CleanerOptions
  ): any[] {
    const opts = options || this.defaultOptions;
    
    // Start with minimal cleaning - PRESERVE CRITICAL FIELDS
    const minimallyCleaned = documents.map(doc => 
      this.cleanDocument(doc, queryContext, {
        maxStringLength: 200, // Increased to preserve names
        maxArrayItems: 5,
        excludeFields: ['embedding', 'searchKeywords', 'semanticSummary', '__v', 'createdAt', 'updatedAt', 'relationships', 'intentSignals', 'logoUrl', 'technologies'],
        // CRITICAL: Always preserve name fields for companies and employees
        priorityFields: ['_id', 'name', 'fullName', 'firstName', 'lastName', 'activeExperienceTitle', 'companyId', 'scoringMetrics', 'industry', 'employeeCount', 'annualRevenue']
      })
    );

    // Check if we're under token limit
    let totalTokens = this.estimateTokens(JSON.stringify(minimallyCleaned));
    
    if (totalTokens <= opts.maxTokens) {
      logger.warn('Applied aggressive cleaning to preserve document count', {
        originalCount: documents.length,
        preservedCount: minimallyCleaned.length,
        tokens: totalTokens,
        maxTokens: opts.maxTokens
      });
      return minimallyCleaned;
    }

    // If still too large, we need to reduce document count
    const maxDocuments = this.calculateMaxDocuments(minimallyCleaned, opts.maxTokens);
    const reducedDocs = minimallyCleaned.slice(0, maxDocuments);
    
    logger.warn('Token limit exceeded, had to reduce documents', {
      originalCount: documents.length,
      reducedCount: reducedDocs.length,
      originalTokens: this.estimateTokens(JSON.stringify(documents)),
      finalTokens: this.estimateTokens(JSON.stringify(reducedDocs)),
      maxTokens: opts.maxTokens
    });
    
    return reducedDocs;
  }

  /**
   * Calculate maximum number of documents that fit within token limit
   */
  private calculateMaxDocuments(documents: any[], maxTokens: number): number {
    if (documents.length === 0) return 0;
    
    // Calculate average tokens per document
    const avgTokensPerDoc = this.estimateTokens(JSON.stringify(documents)) / documents.length;
    
    // Estimate max documents
    const estimatedMax = Math.floor(maxTokens / avgTokensPerDoc);
    
    // Ensure at least 1 document and not more than we have
    return Math.max(1, Math.min(estimatedMax, documents.length));
  }

  /**
   * Extract context from query to optimize cleaning
   */
  private extractQueryContext(query: string, intent?: string): string {
    const queryLower = query.toLowerCase();
    
    // Detect specific query types
    if (queryLower.includes('industry') || queryLower.includes('sector')) {
      return 'industry_query';
    } else if (queryLower.includes('revenue') || queryLower.includes('financial')) {
      return 'revenue_query';
    } else if (queryLower.includes('employee') || queryLower.includes('team')) {
      return 'employee_query';
    } else if (queryLower.includes('technology') || queryLower.includes('tech')) {
      return 'technology_query';
    } else if (queryLower.includes('competitor') || queryLower.includes('competition')) {
      return 'competitor_query';
    } else if (queryLower.includes('fit') && queryLower.includes('score')) {
      return 'fit_score_query';
    } else if (queryLower.includes('top') && /\d+/.test(queryLower)) {
      return 'top_n_query';
    } else if (intent === 'search') {
      return 'general_search';
    }
    
    return 'unknown';
  }

  /**
   * Get optimization options based on query context
   */
  private getOptimizationOptions(context: string): Partial<CleanerOptions> {
    const options: Record<string, Partial<CleanerOptions>> = {
      industry_query: {
        includeFields: ['name', 'industry', 'description'],
        maxStringLength: 200,
        maxArrayItems: 5,
        priorityFields: ['_id', 'name', 'industry']
      },
      revenue_query: {
        includeFields: ['name', 'annualRevenue', 'revenueCurrency', 'employeeCount', 'foundedYear'],
        maxStringLength: 100,
        priorityFields: ['_id', 'name', 'annualRevenue']
      },
      employee_query: {
        includeFields: ['name', 'employeeCount', 'headquarters', 'locations'],
        maxArrayItems: 3,
        priorityFields: ['_id', 'name', 'employeeCount']
      },
      technology_query: {
        includeFields: ['name', 'technologies', 'industry'],
        maxArrayItems: 15,
        maxStringLength: 100,
        priorityFields: ['_id', 'name', 'technologies']
      },
      competitor_query: {
        includeFields: ['name', 'competitors', 'industry', 'marketPosition'],
        maxArrayItems: 8,
        maxStringLength: 150,
        priorityFields: ['_id', 'name', 'competitors']
      },
      fit_score_query: {
        includeFields: ['name', 'scoringMetrics.score', 'scoringMetrics.confidence', 'industry', 'employeeCount'],
        maxStringLength: 150,
        maxArrayItems: 8,
        priorityFields: ['_id', 'name', 'scoringMetrics.score', 'scoringMetrics.confidence'],
        preserveDocumentCount: true // Especially important for "top N" queries
      },
      top_n_query: {
        includeFields: ['name', 'scoringMetrics.score', 'scoringMetrics.confidence', 'industry', 'employeeCount'],
        maxStringLength: 150,
        maxArrayItems: 8,
        priorityFields: ['_id', 'name', 'scoringMetrics.score', 'scoringMetrics.confidence'],
        preserveDocumentCount: true
      },
      general_search: {
        maxStringLength: 300,
        maxArrayItems: 8,
        priorityFields: ['_id', 'name', 'score']
      }
    };
    
    return options[context] || {};
  }

  /**
   * Get context-aware field exclusions
   */
  private getContextAwareExclusions(
    context: string,
    baseOptions: CleanerOptions
  ): string[] {
    const contextExclusions: Record<string, string[]> = {
      industry_query: ['technologies', 'competitors', 'intentSignals', 'scoringMetrics.details', 'relationships.details'],
      revenue_query: ['technologies', 'competitors', 'description', 'intentSignals', 'relationships'],
      employee_query: ['technologies', 'scoringMetrics', 'financialDetails', 'intentSignals'],
      technology_query: ['competitors', 'scoringMetrics.details', 'financials', 'intentSignals'],
      competitor_query: ['technologies', 'scoringMetrics.details', 'intentSignals.details'],
      fit_score_query: ['description', 'logoUrl', 'contactDetails', 'relationships.details', 'intentSignals.details'],
      top_n_query: ['description', 'logoUrl', 'contactDetails', 'relationships.details', 'intentSignals.details', 'technologies']
    };
    
    const extraExclusions = contextExclusions[context] || [];
    return [...baseOptions.excludeFields, ...extraExclusions];
  }

  /**
   * Remove specified fields from document
   */
  private removeExcludedFields(doc: any, excludedFields: string[]): any {
    if (!doc || typeof doc !== 'object') return doc;
    
    const cleanDoc = Array.isArray(doc) ? [...doc] : { ...doc };
    
    excludedFields.forEach(fieldPath => {
      if (fieldPath.includes('.')) {
        // Handle nested paths
        const parts = fieldPath.split('.');
        this.removeNestedField(cleanDoc, parts);
      } else {
        delete cleanDoc[fieldPath];
      }
    });
    
    return cleanDoc;
  }

  private removeNestedField(obj: any, pathParts: string[]): void {
    if (!obj || pathParts.length === 0) return;
    
    if (pathParts.length === 1) {
      if (Array.isArray(obj)) {
        obj.forEach(item => {
          if (item && typeof item === 'object') {
            delete item[pathParts[0]];
          }
        });
      } else {
        delete obj[pathParts[0]];
      }
    } else if (obj[pathParts[0]]) {
      this.removeNestedField(obj[pathParts[0]], pathParts.slice(1));
    }
  }

  /**
   * Remove null/undefined/empty fields
   */
  private removeEmptyFields(doc: any, enabled: boolean): any {
    if (!enabled || !doc || typeof doc !== 'object') return doc;
    
    if (Array.isArray(doc)) {
      return doc.map(item => this.removeEmptyFields(item, enabled));
    }
    
    const cleaned: any = {};
    
    Object.entries(doc).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') {
        return;
      }
      
      if (Array.isArray(value) && value.length === 0) {
        return;
      }
      
      if (typeof value === 'object' && !Array.isArray(value)) {
        const cleanedNested = this.removeEmptyFields(value, enabled);
        if (Object.keys(cleanedNested).length > 0) {
          cleaned[key] = cleanedNested;
        }
      } else {
        cleaned[key] = value;
      }
    });
    
    return cleaned;
  }

  /**
   * Truncate long string fields
   */
  private truncateStrings(doc: any, maxLength: number): any {
    if (!maxLength || !doc || typeof doc !== 'object') return doc;
    
    if (Array.isArray(doc)) {
      return doc.map(item => this.truncateStrings(item, maxLength));
    }
    
    const processed: any = { ...doc };
    
    Object.entries(processed).forEach(([key, value]) => {
      if (typeof value === 'string' && value.length > maxLength) {
        processed[key] = value.substring(0, maxLength) + '...';
      } else if (typeof value === 'object' && value !== null) {
        processed[key] = this.truncateStrings(value, maxLength);
      }
    });
    
    return processed;
  }

  /**
   * Limit array items
   */
  private limitArrays(doc: any, maxItems: number): any {
    if (!maxItems || !doc || typeof doc !== 'object') return doc;
    
    if (Array.isArray(doc)) {
      return doc.length > maxItems ? doc.slice(0, maxItems) : doc;
    }
    
    const processed: any = { ...doc };
    
    Object.entries(processed).forEach(([key, value]) => {
      if (Array.isArray(value) && value.length > maxItems) {
        processed[key] = value.slice(0, maxItems);
      } else if (typeof value === 'object' && value !== null) {
        processed[key] = this.limitArrays(value, maxItems);
      }
    });
    
    return processed;
  }

  /**
   * Compress nested objects based on context
   */
  private compressNestedObjects(doc: any, context?: string, options?: CleanerOptions): any {
    if (!doc || typeof doc !== 'object') return doc;
    
    if (Array.isArray(doc)) {
      return doc.map(item => this.compressNestedObjects(item, context, options));
    }
    
    const processed: any = { ...doc };
    
    // Special handling for scoring metrics in fit score queries
    if (processed.scoringMetrics) {
      if (context === 'fit_score_query' || context === 'top_n_query') {
        // Keep only essential scoring info
        processed.score = processed.scoringMetrics.fitScore?.score || 
                         processed.scoringMetrics.score;
        processed.scoreConfidence = processed.scoringMetrics.fitScore?.confidence ||
                                   processed.scoringMetrics.confidence;
        delete processed.scoringMetrics;
      } else {
        // Compress scoring metrics
        processed.scoringMetrics = {
          score: processed.scoringMetrics.fitScore?.score || 
                 processed.scoringMetrics.score,
          confidence: processed.scoringMetrics.fitScore?.confidence ||
                     processed.scoringMetrics.confidence
        };
      }
    }
    
    // Compress intent signals
    if (processed.intentSignals) {
      if (Array.isArray(processed.intentSignals.results)) {
        processed.intentSignals = {
          count: processed.intentSignals.results.length,
          summary: processed.intentSignals.summary?.confidence_score || 0
        };
      }
    }
    
    // Handle competitors
    if (processed.relationships?.competitors && Array.isArray(processed.relationships.competitors)) {
      processed.topCompetitors = processed.relationships.competitors
        .slice(0, options?.maxArrayItems || 3)
        .filter((comp: any) => comp.company_name && comp.similarity_score)
        .map((comp: any) => ({
          name: comp.company_name,
          similarity: comp.similarity_score
        }));
      delete processed.relationships;
    }
    
    // Handle technologies array
    if (Array.isArray(processed.technologies) && processed.technologies.length > (options?.maxArrayItems || 10)) {
      processed.technologies = processed.technologies.slice(0, options?.maxArrayItems || 10);
      processed.totalTechnologies = processed.technologies.length;
    }
    
    return processed;
  }

  /**
   * Select only specified fields with priority handling
   */
  private selectFields(doc: any, fields: string[], priorityFields?: string[]): any {
    if (!doc || typeof doc !== 'object') return doc;
    
    const selected: any = {};
    const allFields = [...(priorityFields || []), ...fields];
    
    allFields.forEach(field => {
      if (field.includes('.')) {
        const value = this.getNestedValue(doc, field);
        if (value !== undefined) {
          this.setNestedValue(selected, field, value);
        }
      } else if (doc[field] !== undefined) {
        selected[field] = doc[field];
      }
    });
    
    return Object.keys(selected).length > 0 ? selected : doc;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => {
      if (acc === null || acc === undefined) return undefined;
      return acc[part];
    }, obj);
  }

  private setNestedValue(obj: any, path: string, value: any): void {
    const parts = path.split('.');
    let current = obj;
    
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    
    current[parts[parts.length - 1]] = value;
  }

  /**
   * Estimate token count using better approximation
   */
  private estimateTokens(text: string): number {
    if (!text) return 0;
    
    // Better token estimation for LLMs
    // 1 token ≈ 4 characters for English text
    // But JSON has lots of brackets and quotes
    const jsonOverhead = 1.3; // JSON adds overhead
    
    // Count words and characters
    const wordCount = text.split(/\s+/).length;
    const charCount = text.length;
    
    // Use weighted average
    const estimatedByWords = wordCount * 1.3;
    const estimatedByChars = charCount / 4;
    
    return Math.ceil(((estimatedByWords + estimatedByChars) / 2) * jsonOverhead);
  }

  /**
   * Create optimized prompt for LLM with context
   */
  createOptimizedPrompt(
    systemPrompt: string,
    query: string,
    data: any[],
    queryIntent?: string
  ): string {
    const context = this.extractQueryContext(query, queryIntent);
    const options = this.getOptimizationOptions(context);
    
    // For "top N" queries, try to preserve document count
    if (context === 'top_n_query' || context === 'fit_score_query') {
      options.preserveDocumentCount = true;
    }
    
    const cleanedData = this.cleanDocuments(data, context, options);
    const dataStr = JSON.stringify(cleanedData, null, 2);
    
    return `${systemPrompt}\n\nUSER QUERY: "${query}"\n\nQUERY INTENT: ${queryIntent || 'search'}\n\nRETRIEVED DATA (${cleanedData.length} documents):\n${dataStr}\n\nProvide your analysis in markdown format.`;
  }
}

export const documentCleaner = new DocumentCleaner();