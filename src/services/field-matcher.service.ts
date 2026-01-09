// src/services/field-matcher.service.ts
import { SchemaService, CollectionSchema, FieldDefinition } from './schema.service';
import { logger } from '../core/logger';

export interface MatchedField {
  field: FieldDefinition;
  relevanceScore: number;
  matchReason: string;
  matchedTerms: string[];
}

export interface FieldMatchResult {
  collection: string;
  matchedFields: MatchedField[];
  queryContext: string;
  suggestedFields: string[]; // Field paths to include in queries
}

export class FieldMatcherService {
  private schemaService: SchemaService;

  constructor(schemaService: SchemaService) {
    this.schemaService = schemaService;
  }

  /**
   * Dynamically match user query to relevant schema fields
   * This replaces hardcoded field detection with intelligent schema-based matching
   */
  matchQueryToFields(
    query: string,
    collections: string[] = ['companies', 'employees']
  ): FieldMatchResult[] {
    const queryLower = query.toLowerCase();
    const results: FieldMatchResult[] = [];

    logger.debug('FieldMatcher: Starting field matching', {
      query: query.substring(0, 100),
      collections,
      queryLower: queryLower.substring(0, 100)
    });

    for (const collectionName of collections) {
      const schema = this.schemaService.getSchema(collectionName);
      if (!schema) {
        logger.debug('FieldMatcher: Schema not found', { collectionName });
        continue;
      }

      const matchedFields = this.matchFieldsInSchema(queryLower, schema);
      
      logger.debug('FieldMatcher: Field matching results', {
        collection: collectionName,
        totalFields: schema.fields.length,
        matchedFieldsCount: matchedFields.length,
        topMatches: matchedFields.slice(0, 5).map(m => ({
          field: m.field.name,
          score: m.relevanceScore,
          reason: m.matchReason
        }))
      });
      
      if (matchedFields.length > 0) {
        // Determine query context from matched fields
        const queryContext = this.determineQueryContext(matchedFields, queryLower);
        
        // Get suggested fields to include (prioritize high-relevance fields)
        const suggestedFields = matchedFields
          .filter(m => m.relevanceScore > 0.3)
          .sort((a, b) => b.relevanceScore - a.relevanceScore)
          .slice(0, 10)
          .map(m => m.field.name);

        logger.info('FieldMatcher: Field matching completed', {
          collection: collectionName,
          queryContext,
          matchedFieldsCount: matchedFields.length,
          topField: matchedFields[0]?.field.name,
          topScore: matchedFields[0]?.relevanceScore,
          suggestedFieldsCount: suggestedFields.length
        });

        results.push({
          collection: collectionName,
          matchedFields,
          queryContext,
          suggestedFields
        });
      } else {
        logger.debug('FieldMatcher: No fields matched', { collection: collectionName, query: query.substring(0, 50) });
      }
    }

    return results;
  }

  /**
   * Match fields in a schema based on query terms
   */
  private matchFieldsInSchema(
    queryLower: string,
    schema: CollectionSchema
  ): MatchedField[] {
    const matches: MatchedField[] = [];

    for (const field of schema.fields) {
      const match = this.scoreFieldRelevance(field, queryLower);
      if (match.relevanceScore > 0.1) { // Threshold for relevance
        matches.push(match);
      }
    }

    return matches.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Score how relevant a field is to the query
   */
  private scoreFieldRelevance(
    field: FieldDefinition,
    queryLower: string
  ): MatchedField {
    let relevanceScore = 0;
    const matchedTerms: string[] = [];
    let matchReason = '';

    // 1. Direct name match (highest weight)
    const fieldNameLower = field.name.toLowerCase();
    // Handle both "intent_score" and "intent score" variations
    // Normalize by removing dots/underscores for comparison
    const fieldNameNormalized = fieldNameLower.replace(/[._]/g, ' ').trim();
    const queryNormalized = queryLower.replace(/[._]/g, ' ').trim();
    
    // Check multiple matching strategies
    const exactMatch = queryLower.includes(fieldNameLower) || fieldNameLower.includes(queryLower);
    const normalizedMatch = queryNormalized.includes(fieldNameNormalized) || fieldNameNormalized.includes(queryNormalized);
    // Also check if query contains key parts of field name (e.g., "intent" and "score")
    const fieldParts = fieldNameNormalized.split(/\s+/).filter(p => p.length > 2);
    const queryPartsMatch = fieldParts.length > 0 && fieldParts.every(part => queryNormalized.includes(part));
    
    if (exactMatch || normalizedMatch || queryPartsMatch) {
      relevanceScore += 0.8;
      matchedTerms.push(field.name);
      matchReason = exactMatch ? 'Direct field name match' : 
                   normalizedMatch ? 'Normalized field name match' : 
                   'Field parts match';
    }

    // 2. Synonym matching
    if (field.synonyms) {
      for (const synonym of field.synonyms) {
        const synonymLower = synonym.toLowerCase();
        if (queryLower.includes(synonymLower)) {
          relevanceScore += 0.7;
          matchedTerms.push(synonym);
          matchReason = `Synonym match: "${synonym}"`;
          break;
        }
      }
    }

    // 3. Description matching
    if (field.description) {
      const descLower = field.description.toLowerCase();
      const descWords = descLower.split(/\s+/);
      const queryWords = queryLower.split(/\s+/);
      
      const matchingWords = queryWords.filter(qw => 
        descWords.some(dw => dw.includes(qw) || qw.includes(dw))
      );
      
      if (matchingWords.length > 0) {
        relevanceScore += 0.5 * (matchingWords.length / queryWords.length);
        matchedTerms.push(...matchingWords);
        if (!matchReason) matchReason = 'Description match';
      }
    }

    // 4. Category matching
    if (field.category) {
      const categoryLower = field.category.toLowerCase();
      if (queryLower.includes(categoryLower)) {
        relevanceScore += 0.4;
        matchedTerms.push(field.category);
        if (!matchReason) matchReason = `Category match: ${field.category}`;
      }
    }

    // 5. Nested field matching (for nested objects)
    if (field.nestedFields) {
      for (const nestedField of field.nestedFields) {
        const nestedLower = nestedField.toLowerCase();
        if (queryLower.includes(nestedLower.split('.').pop() || '')) {
          relevanceScore += 0.3;
          matchedTerms.push(nestedField);
          if (!matchReason) matchReason = `Nested field match: ${nestedField}`;
        }
      }
    }

    // 6. Type-based matching (for common types)
    if (field.type === 'Number' && /\b(score|count|number|amount|revenue|employees)\b/i.test(queryLower)) {
      relevanceScore += 0.2;
      if (!matchReason) matchReason = 'Type-based match (numeric field)';
    }

    // 7. Importance boost
    if (field.importance === 'high') {
      relevanceScore *= 1.2;
    } else if (field.importance === 'low') {
      relevanceScore *= 0.8;
    }

    return {
      field,
      relevanceScore: Math.min(1.0, relevanceScore), // Cap at 1.0
      matchReason: matchReason || 'Low relevance match',
      matchedTerms: [...new Set(matchedTerms)] // Remove duplicates
    };
  }

  /**
   * Determine query context from matched fields
   */
  private determineQueryContext(
    matchedFields: MatchedField[],
    queryLower: string
  ): string {
    // Check for specific query types - prioritize by relevance score
    const sortedFields = matchedFields.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    // Check for intent_score (highest priority if matched)
    // Check both field name and synonyms
    const intentScoreMatch = sortedFields.find(m => 
      m.field.name.includes('intent_score') || 
      m.field.name.includes('intent.score') ||
      (m.field.synonyms && m.field.synonyms.some(s => {
        const synLower = s.toLowerCase();
        return queryLower.includes(synLower) || synLower.includes('intent');
      }))
    );
    
    if (intentScoreMatch) {
      logger.debug('FieldMatcher: Intent_score query context detected', {
        matchedField: intentScoreMatch.field.name,
        relevanceScore: intentScoreMatch.relevanceScore,
        matchReason: intentScoreMatch.matchReason
      });
      return 'intent_score_query';
    }
    
    // Check for fit_score
    if (sortedFields.some(m => m.field.name.includes('fit_score') || m.field.name.includes('fit.score'))) {
      return 'fit_score_query';
    }
    
    // Check for scoring category
    if (sortedFields.some(m => m.field.category === 'scoring' && m.relevanceScore > 0.5)) {
      return 'scoring_query';
    }
    
    // Check for top N queries
    if (queryLower.includes('top') && /\d+/.test(queryLower)) {
      return 'top_n_query';
    }
    
    // Check for financial category
    if (sortedFields.some(m => m.field.category === 'financial' && m.relevanceScore > 0.5)) {
      return 'financial_query';
    }
    
    // Check for contact category
    if (sortedFields.some(m => m.field.category === 'contact' && m.relevanceScore > 0.5)) {
      return 'contact_query';
    }

    return 'general_query';
  }

  /**
   * Get fields that should be preserved for a given query context
   */
  getFieldsToPreserve(
    collection: string,
    queryContext: string
  ): string[] {
    const schema = this.schemaService.getSchema(collection);
    if (!schema) return [];

    const fieldsToPreserve: string[] = ['_id', 'name', 'userId']; // Always preserve these

    for (const field of schema.fields) {
      // Preserve fields based on context
      if (queryContext === 'intent_score_query' && 
          (field.name.includes('intent_score') || field.name === 'scoringMetrics')) {
        fieldsToPreserve.push(field.name);
        if (field.nestedFields) {
          fieldsToPreserve.push(...field.nestedFields);
        }
      } else if (queryContext === 'fit_score_query' && 
                 (field.name.includes('fit_score') || field.name === 'scoringMetrics')) {
        fieldsToPreserve.push(field.name);
        if (field.nestedFields) {
          fieldsToPreserve.push(...field.nestedFields.filter(nf => nf.includes('fit_score')));
        }
      } else if (queryContext === 'scoring_query' && 
                 field.category === 'scoring') {
        fieldsToPreserve.push(field.name);
        if (field.nestedFields) {
          fieldsToPreserve.push(...field.nestedFields);
        }
      } else if (field.analyzable && field.importance === 'high') {
        // Always preserve high-importance analyzable fields
        fieldsToPreserve.push(field.name);
      }
    }

    return [...new Set(fieldsToPreserve)]; // Remove duplicates
  }

  /**
   * Get field descriptions for prompt enhancement
   */
  getFieldDescriptionsForPrompt(
    collection: string,
    matchedFields: MatchedField[]
  ): string {
    if (matchedFields.length === 0) return '';

    let descriptions = '\n\n=== RELEVANT FIELDS DETECTED ===\n';
    
    for (const match of matchedFields.slice(0, 10)) { // Top 10 most relevant
      const field = match.field;
      descriptions += `\n- ${field.name} (${field.type})`;
      if (field.description) {
        descriptions += `: ${field.description}`;
      }
      if (match.relevanceScore > 0.5) {
        descriptions += ` [HIGH RELEVANCE: ${(match.relevanceScore * 100).toFixed(0)}%]`;
      }
      if (field.nestedFields && field.nestedFields.length > 0) {
        descriptions += `\n  Nested fields: ${field.nestedFields.slice(0, 5).join(', ')}`;
      }
    }

    return descriptions;
  }
}

// Export singleton instance
let fieldMatcherInstance: FieldMatcherService | null = null;

export function getFieldMatcher(schemaService: SchemaService): FieldMatcherService {
  if (!fieldMatcherInstance) {
    fieldMatcherInstance = new FieldMatcherService(schemaService);
  }
  return fieldMatcherInstance;
}

