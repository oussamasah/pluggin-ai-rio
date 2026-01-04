// src/services/QueryEnhancerService.ts
import { queryParser } from '../utils/query-parser';
import { logger } from '../core/logger';

// Import the correct types from query-parser
import type { ParsedQuery, FieldFilter } from '../utils/query-parser';

export interface EnhancedQuery {
  original: string;
  parsed: ParsedQuery;
  mongoFilter: Record<string, any>;
  collectionHints: string[];
  searchKeywords: string;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  intent?: string;
  confidence: number;
}

export class QueryEnhancerService {
  enhance(query: string, userId: string): EnhancedQuery {
    // Parse query with enhanced parser
    const parsed = queryParser.parseQuery(query);
    
    // Build MongoDB filter from parsed query
    const mongoFilter = this.buildMongoFilter(parsed, userId);
    
    // Determine target collections
    const collectionHints = this.inferCollections(parsed);
    
    // Enhance search keywords
    const searchKeywords = this.enhanceKeywords(query, parsed.keywords, parsed.intent);
    
    // Handle sort and limit
    let sort = parsed.sort;
    let limit = 10;
    let intent = parsed.intent;
    
    if (parsed.topN) {
      sort = parsed.sort || { [parsed.topN.sortBy]: -1 };
      limit = parsed.topN.limit;
      intent = 'top_n';
    }
    
    logger.info('Query enhanced with semantic filters', {
      original: query,
      intent,
      confidence: parsed.confidence,
      filters: parsed.filters.length,
      collections: collectionHints,
      hasSort: !!sort
    });
    
    return {
      original: query,
      parsed,
      mongoFilter,
      collectionHints,
      searchKeywords,
      sort,
      limit,
      intent,
      confidence: parsed.confidence
    };
  }
  
  private buildMongoFilter(parsed: ParsedQuery, userId: string): Record<string, any> {
    const filter: Record<string, any> = {};
    
    // Always add userId
    filter.userId = userId;
    
    // Add entity filters from query parser
    parsed.entities.forEach(entity => {
      if (entity.type === 'company') {
        filter.name = (entity as any).queryValue || { $regex: entity.value, $options: 'i' };
      } else if (entity.type === 'employee') {
        filter.fullName = (entity as any).queryValue || { $regex: entity.value, $options: 'i' };
      } else if ((entity.type as string) === 'location') {
        // Add location search
        if (!filter.$or) filter.$or = [];
        filter.$or.push(
          { city: { $regex: entity.value, $options: 'i' } },
          { country: { $regex: entity.value, $options: 'i' } },
          { headquarters: { $regex: entity.value, $options: 'i' } }
        );
      }
    });
    
    // Add semantic filters from parser
    parsed.filters.forEach((fieldFilter: FieldFilter) => {
      // Merge with existing filter for same field
      if (filter[fieldFilter.field]) {
        if (typeof filter[fieldFilter.field] === 'object') {
          Object.assign(filter[fieldFilter.field], fieldFilter.mongoQuery);
        }
      } else {
        filter[fieldFilter.field] = fieldFilter.mongoQuery;
      }
    });
    
    // Add metrics
    Object.keys(parsed.metrics).forEach(metricKey => {
      const metricValue = parsed.metrics[metricKey];
      if (typeof metricValue === 'object') {
        filter[metricKey] = metricValue;
      }
    });
    
    logger.debug('Built Mongo filter from parsed query', {
      filterKeys: Object.keys(filter),
      entities: parsed.entities.length,
      filters: parsed.filters.length,
      metrics: Object.keys(parsed.metrics).length
    });
    
    return filter;
  }
  
  private inferCollections(parsed: ParsedQuery): string[] {
    const collections = new Set<string>();
    
    // Add collections from parsed query
    if (parsed.collections && parsed.collections.length > 0) {
      parsed.collections.forEach(col => collections.add(col));
    }
    
    // Add collections from entities
    parsed.entities.forEach(entity => {
      if (entity.collectionHint) {
        collections.add(entity.collectionHint);
      }
    });
    
    // Add collections from filters
    parsed.filters.forEach(filter => {
      collections.add(filter.collection);
    });
    
    // Default to companies if no collection detected
    if (collections.size === 0) {
      collections.add('companies');
    }
    
    return Array.from(collections);
  }
  
  private enhanceKeywords(original: string, parsedKeywords: string[], intent?: string): string {
    const keywords = new Set<string>();
    
    // Add parsed keywords (handle undefined/null)
    if (parsedKeywords && Array.isArray(parsedKeywords)) {
      parsedKeywords.forEach(kw => keywords.add(kw));
    }
    
    // Add intent-specific terms
    if (intent === 'top_n') {
      keywords.add('top');
      keywords.add('highest');
      keywords.add('maximum');
    }
    
    if (intent === 'decision_maker_search') {
      keywords.add('decision');
      keywords.add('maker');
      keywords.add('executive');
    }
    
    if (intent === 'industry_search') {
      keywords.add('industry');
      keywords.add('sector');
    }
    
    // Clean the original query for additional context
    const cleanQuery = original
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    
    // Add significant words from original query
    cleanQuery.split(' ')
      .filter(w => w.length > 2 && !this.isStopWord(w))
      .forEach(w => keywords.add(w));
    
    return Array.from(keywords).join(' ');
  }
  
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'this', 'that', 'from', 
      'have', 'has', 'had', 'what', 'when', 'where', 'which'
    ]);
    return stopWords.has(word);
  }
}

export const queryEnhancer = new QueryEnhancerService();