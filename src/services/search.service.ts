// src/services/SearchService.ts
import mongoose from 'mongoose';
import { config } from '../core/config';
import { logger } from '../core/logger';
import { RetrievalError } from '../core/errors';

// Import your models
import { Company } from '../models/Company';
import { Employee } from '../models/Employee';
import { Session } from '../models/Session';
import { ICPModel } from '../models/ICPModel';
import { Enrichment } from '../models/Enrichment';
import { GTMIntelligence } from '../models/GTMIntelligence';
import { GTMPersonaIntelligence } from '../models/GTMPersonaIntelligence';
import { documentCleaner } from '../utils/documentCleaner';
import OpenAI from 'openai';
import { queryEnhancer } from './QueryEnhancerService';

export interface SearchQuery {
  collection: string;
  userId: string;
  filter?: Record<string, any>;
  vectorQuery?: string;
  textQuery?: string;
  limit?: number;
  skip?: number;
  sort?: Record<string, 1 | -1>;
  populate?: string[];
}

export interface SearchResult {
  documents: any[] | Record<string, any>[];
  total: number;
  method: 'vector' | 'text' | 'metadata' | 'hybrid';
  confidence: number;
}

export class SearchService {
  private db: mongoose.Connection;
  private modelMap: Map<string, mongoose.Model<any>> = new Map();

  constructor() {
    this.db = mongoose.connection;
    this.initializeModels();
  }

  private initializeModels(): void {
    this.modelMap.set('companies', Company);
    this.modelMap.set('employees', Employee);
    this.modelMap.set('sessions', Session);
    this.modelMap.set('icp_models', ICPModel);
    this.modelMap.set('enrichments', Enrichment);
    this.modelMap.set('gtm_intelligence', GTMIntelligence);
    this.modelMap.set('gtm_persona_intelligence', GTMPersonaIntelligence);

    logger.info('SearchService models initialized', {
      collections: Array.from(this.modelMap.keys())
    });
  }

  private getModel(collectionName: string): mongoose.Model<any> {
    const model = this.modelMap.get(collectionName);
    if (!model) {
      throw new RetrievalError(`Model not found for collection: ${collectionName}`);
    }
    return model;
  }

  async search(query: SearchQuery, limit = 10): Promise<SearchResult> {
    try {
      const { collection, userId, filter = {}, limit = 10, skip = 0, textQuery } = query;
      
      if (!this.modelMap.has(collection)) {
        throw new RetrievalError(`Collection not found: ${collection}`);
      }
      
      const Model = this.getModel(collection);
      
      // Enhance filter with query parser if textQuery exists
      let enhancedFilter = { ...filter };
      if (textQuery) {
        const enhancedQuery = queryEnhancer.enhance(textQuery, userId);
        enhancedFilter = this.enhanceFilterWithParsedQuery(enhancedFilter, enhancedQuery, collection);
      }

      // Sanitize filter before validation to remove invalid values
      enhancedFilter = this.sanitizeFilter(enhancedFilter, collection);
      
      this.validateQueryParameters(collection, enhancedFilter);
      
      // Add userId filter for collections that have userId field
      if (Model.schema.paths.userId) {
        enhancedFilter.userId = userId;
      }

      logger.debug('Executing search with enhanced filter', {
        collection,
        userId,
        originalFilter: filter,
        enhancedFilter: JSON.stringify(enhancedFilter),
        hasVectorQuery: !!query.vectorQuery,
        hasTextQuery: !!query.textQuery
      });

      // CRITICAL: If we have specific filters (beyond just userId), use metadata search
      // This happens when planner generates a query with specific field filters
      // textQuery is still passed for context detection (e.g., intent_score_query) but not for search
      const hasSpecificFilters = Object.keys(enhancedFilter).some(key => 
        key !== 'userId' && 
        enhancedFilter[key] !== undefined && 
        enhancedFilter[key] !== null
      );
      
      if (query.sort && Object.keys(query.sort).length > 0) {
        logger.info('Performing sorted metadata search', { sort: query.sort });
        return await this.metadataSearch({ ...query, filter: enhancedFilter });
      }
      
      // If we have specific filters from planner, use metadata search (even if textQuery exists)
      // textQuery is used for context detection, not for search
      if (hasSpecificFilters) {
        logger.debug('Using metadata search due to specific filters', {
          filterKeys: Object.keys(enhancedFilter),
          hasTextQuery: !!query.textQuery,
          textQueryPurpose: 'context_detection_only'
        });
        return await this.metadataSearch({ ...query, filter: enhancedFilter });
      }
      
      if (query.vectorQuery && query.textQuery) {
        return await this.hybridSearch({ ...query, filter: enhancedFilter });
      } else if (query.vectorQuery) {
        return await this.vectorSearch({ ...query, filter: enhancedFilter });
      } else if (query.textQuery) {
        return await this.textSearch({ ...query, filter: enhancedFilter });
      } else {
        return await this.metadataSearch({ ...query, filter: enhancedFilter });
      }
    } catch (error: any) {
      logger.error('Search failed', { query, error: error.message, stack: error.stack });
      throw new RetrievalError(`Search failed: ${error.message}`, { query });
    }
  }

  private enhanceFilterWithParsedQuery(
    baseFilter: Record<string, any>,
    enhancedQuery: any,
    collection: string
  ): Record<string, any> {
    const enhancedFilter = { ...baseFilter };
    const Model = this.getModel(collection);
    const schema = Model.schema;

    // Add entity filters from parsed query
    enhancedQuery.parsed.entities.forEach((entity: any) => {
      if (entity.type === 'company' && schema.paths.name && !enhancedFilter.name) {
        enhancedFilter.name = { $regex: entity.value, $options: 'i' };
      } else if (entity.type === 'employee' && schema.paths.fullName && !enhancedFilter.fullName) {
        enhancedFilter.fullName = { $regex: entity.value, $options: 'i' };
      }
    });

    // Add metric filters from parsed query
    Object.keys(enhancedQuery.parsed.metrics).forEach(metricKey => {
      const metricValue = enhancedQuery.parsed.metrics[metricKey];
      let fieldName = metricKey;
      
      // Map to actual field names
      if (metricKey === 'annualRevenue') fieldName = 'annualRevenue';
      if (metricKey === 'employeeCount') fieldName = 'employeeCount';
      
      if (schema.paths[fieldName] && !enhancedFilter[fieldName]) {
        enhancedFilter[fieldName] = metricValue;
      }
    });

    logger.debug('Filter enhanced with parsed query', {
      original: Object.keys(baseFilter).length,
      enhanced: Object.keys(enhancedFilter).length,
      addedEntities: enhancedQuery.parsed.entities.length,
      addedMetrics: Object.keys(enhancedQuery.parsed.metrics).length
    });

    return enhancedFilter;
  }

  async aggregate(
    collectionName: string,
    pipeline: any[],
    userId: string
  ): Promise<any[]> {
    try {
      logger.info('Executing aggregation', { 
        collection: collectionName,
        userId,
        pipelineSteps: pipeline.length 
      });

      const Model = this.getModel(collectionName);

      if (Model.schema.paths.userId) {
        const hasUserIdMatch = pipeline.some(stage => 
          stage.$match && stage.$match.userId === userId
        );

        if (!hasUserIdMatch) {
          pipeline.unshift({
            $match: { userId }
          });
        }
      }

      const results = await Model.aggregate(pipeline);

      logger.info('Aggregation completed', { 
        collection: collectionName,
        resultCount: results.length 
      });

      return results;
    } catch (error: any) {
      logger.error('Aggregation failed', { 
        collection: collectionName,
        error: error.message,
        stack: error.stack 
      });
      throw new RetrievalError(`Aggregation failed: ${error.message}`, {
        collection: collectionName,
        pipeline,
      });
    }
  }

  private async vectorSearch(query: SearchQuery): Promise<SearchResult> {
    const { collection, vectorQuery, filter, limit = 10, userId } = query;
    
    const embeddingVector = await this.generateEmbedding(vectorQuery!);
    const Model = this.getModel(collection);

    if (!Model.schema.paths.embedding) {
      logger.warn(`Collection ${collection} has no embedding field, falling back to text search`);
      return await this.textSearch({ ...query, vectorQuery: undefined });
    }

    // CRITICAL: Ensure userId is in filter for vector search
    const vectorFilter = { ...filter };
    if (Model.schema.paths.userId && !vectorFilter.userId) {
      vectorFilter.userId = userId;
    }

    if (config.mongodb?.vectorSearchEnabled) {
      const pipeline = [
        {
          $vectorSearch: {
            index: 'vector',
            path: 'embedding',
            queryVector: embeddingVector,
            numCandidates: limit * 10,
            limit,
            filter: vectorFilter, // Use filter with userId
          },
        },
        {
          $project: {
            embedding: 0,
            embeddingText: 0,
            searchKeywords: 0,
            semanticSummary: 0
          }
        },
        {
          $addFields: {
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ];

      try {
        const results = await Model.aggregate(pipeline);
        return {
          documents: results,
          total: results.length,
          method: 'vector',
          confidence: results.length > 0 ? results[0]?.score || 0.5 : 0,
        };
      } catch (error: any) {
        logger.warn('Vector search failed, falling back to similarity search', { error: error.message });
      }
    }

    // CRITICAL: Ensure userId is in filter for similarity search fallback
    const similarityFilter = { ...filter };
    if (Model.schema.paths.userId && !similarityFilter.userId && userId) {
      similarityFilter.userId = userId;
    }
    
    const allDocs = await Model.find(similarityFilter)
      .select('-embedding -searchKeywords -embeddingText').limit(100).lean();
    
    const docsWithSimilarity = allDocs.map(doc => {
      if (!doc.embedding || !Array.isArray(doc.embedding)) {
        return { ...doc, similarity: 0 };
      }
      
      const similarity = this.cosineSimilarity(embeddingVector, doc.embedding);
      return { ...doc, similarity };
    });

    const results = docsWithSimilarity
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map(({ similarity, ...doc }) => ({ ...doc, score: similarity }));

    return {
      documents: results,
      total: results.length,
      method: 'vector',
      confidence: results.length > 0 ? results[0].score || 0.5 : 0,
    };
  }

  private sanitizeFilter(filter: Record<string, any>, collection: string): Record<string, any> {
    const sanitized: Record<string, any> = {};
    const Model = this.getModel(collection);
    const schema = Model.schema;
    
    // Generic terms that should never be filter values
    const genericTerms = new Set([
      'all', 'any', 'every', 'each', 'none', 'some',
      'revenue', 'revenu', 'income', 'sales', 'turnover',
      'employees', 'employee', 'employee count', 'staff', 'people', 'headcount',
      'company', 'companies', 'business', 'businesses',
      'sorted', 'order', 'list', 'top', 'max', 'highest', 'give', 'show', 'get',
      'sector', 'sectors', 'all sectors', 'industry', 'industries',
      'count', 'number', 'amount', 'size', 'total', 'sum', 'average',
      'active', 'experience', 'title', 'job', 'position', 'role',
      'has', 'with', 'by', 'for', 'from', 'to'
    ]);
    
    for (const [key, value] of Object.entries(filter)) {
      // Always keep userId
      if (key === 'userId') {
        sanitized[key] = value;
        continue;
      }
      
      // Check if field exists in schema (handle both direct fields and dot-notation nested fields)
      let path = schema.paths[key];
      
      // If not found as direct field, check if it's a nested field (dot notation)
      // For nested fields like "scoringMetrics.fit_score.score", check if parent exists
      if (!path && key.includes('.')) {
        const parentField = key.split('.')[0];
        const parentPath = schema.paths[parentField];
        if (parentPath && (parentPath.instance === 'Mixed' || parentPath.instance === 'Object' || parentPath.schema)) {
          // Nested field in Mixed/Object type - allow it
          // For nested numeric fields like scoringMetrics.fit_score.score, treat as Number
          const isNestedNumeric = key.includes('score') || key.includes('confidence');
          if (isNestedNumeric) {
            // Allow nested numeric fields - they're valid in MongoDB
            sanitized[key] = value;
            continue;
          }
          // For other nested fields, allow them too (MongoDB supports dot notation)
          sanitized[key] = value;
          continue;
        }
      }
      
      if (!path) {
        logger.warn(`Field ${key} does not exist in collection ${collection}, removing from filter`, { value });
        continue;
      }
      
      // Handle numeric fields
      if (path.instance === 'Number') {
        if (typeof value === 'string') {
          const lowerValue = value.toLowerCase().trim();
          // Reject generic terms
          if (genericTerms.has(lowerValue) || 
              lowerValue === key.toLowerCase() || 
              lowerValue.includes(key.toLowerCase())) {
            logger.warn(`Removing generic term "${value}" from numeric field ${key}`, { value, collection });
            continue;
          }
          // Try to parse as number
          const numValue = parseFloat(value);
          if (isNaN(numValue)) {
            logger.warn(`Cannot parse "${value}" as number for field ${key}, removing`, { value });
            continue;
          }
          sanitized[key] = numValue;
        } else if (typeof value === 'object' && value !== null) {
          // Validate MongoDB operators
          const hasValidNumeric = Object.values(value).some(v => 
            typeof v === 'number' || (typeof v === 'string' && !isNaN(parseFloat(v)) && !genericTerms.has(String(v).toLowerCase()))
          );
          if (hasValidNumeric) {
            sanitized[key] = value;
          } else {
            logger.warn(`Invalid numeric operator for field ${key}`, { value });
            continue;
          }
        } else if (typeof value === 'number') {
          sanitized[key] = value;
        } else {
          logger.warn(`Invalid type for numeric field ${key}: ${typeof value}`, { value });
          continue;
        }
        continue;
      }
      
      // Handle boolean fields
      if (path.instance === 'Boolean') {
        if (typeof value === 'string') {
          const lowerValue = value.toLowerCase().trim();
          if (genericTerms.has(lowerValue)) {
            logger.warn(`Removing generic term "${value}" from boolean field ${key}`, { value });
            continue;
          }
          if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes') {
            sanitized[key] = true;
          } else if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no') {
            sanitized[key] = false;
          } else {
            logger.warn(`Cannot convert "${value}" to boolean for field ${key}, removing`, { value });
            continue;
          }
        } else if (typeof value === 'boolean') {
          sanitized[key] = value;
        } else {
          logger.warn(`Invalid type for boolean field ${key}: ${typeof value}`, { value });
          continue;
        }
        continue;
      }
      
      // Handle string fields
      if (path.instance === 'String') {
        if (typeof value === 'string') {
          const lowerValue = value.toLowerCase().trim();
          // Reject generic terms
          if (genericTerms.has(lowerValue) || 
              lowerValue === key.toLowerCase() ||
              lowerValue.startsWith('all ') ||
              lowerValue.includes('all ')) {
            logger.warn(`Removing generic term "${value}" from string field ${key}`, { value, collection });
            continue;
          }
          sanitized[key] = value;
        } else if (typeof value === 'object' && value !== null) {
          // Handle regex and $in operators
          if (value.$regex) {
            const regexStr = String(value.$regex).toLowerCase().trim();
            if (genericTerms.has(regexStr) || regexStr === key.toLowerCase()) {
              logger.warn(`Removing generic term from regex for field ${key}`, { value });
              continue;
            }
            sanitized[key] = value;
          } else if (value.$in && Array.isArray(value.$in)) {
            const filtered = value.$in.filter((item: any) => {
              if (typeof item === 'string') {
                const lowerItem = item.toLowerCase().trim();
                return !genericTerms.has(lowerItem) && lowerItem !== key.toLowerCase();
              }
              return true;
            });
            if (filtered.length === 0) {
              logger.warn(`All items filtered out from $in for field ${key}`, { original: value.$in });
              continue;
            }
            sanitized[key] = { ...value, $in: filtered };
          } else {
            sanitized[key] = value;
          }
        } else {
          sanitized[key] = value;
        }
        continue;
      }
      
      // Handle array fields
      if (path.instance === 'Array') {
        if (Array.isArray(value)) {
          const filtered = value.filter((item: any) => {
            if (typeof item === 'string') {
              const lowerItem = item.toLowerCase().trim();
              return !genericTerms.has(lowerItem) && lowerItem !== key.toLowerCase();
            }
            return true;
          });
          if (filtered.length === 0) {
            logger.warn(`All items filtered out from array for field ${key}`, { original: value });
            continue;
          }
          sanitized[key] = filtered;
        } else if (typeof value === 'object' && value !== null) {
          if (value.$in || value.$all) {
            const operator = value.$in ? '$in' : '$all';
            const filtered = value[operator].filter((item: any) => {
              if (typeof item === 'string') {
                const lowerItem = item.toLowerCase().trim();
                return !genericTerms.has(lowerItem) && lowerItem !== key.toLowerCase();
              }
              return true;
            });
            if (filtered.length === 0) {
              logger.warn(`All items filtered out from ${operator} for field ${key}`, { original: value[operator] });
              continue;
            }
            sanitized[key] = { ...value, [operator]: filtered };
          } else {
            sanitized[key] = value;
          }
        } else {
          sanitized[key] = value;
        }
        continue;
      }
      
      // For other types, keep as is
      sanitized[key] = value;
    }
    
    logger.debug('Filter sanitized', {
      collection,
      originalKeys: Object.keys(filter).length,
      sanitizedKeys: Object.keys(sanitized).length
    });
    
    return sanitized;
  }

  private validateQueryParameters(collection: string, filter: Record<string, any>): void {
    const Model = this.getModel(collection);
    const schema = Model.schema;
    
    for (const [field, value] of Object.entries(filter)) {
      const path = schema.paths[field];
      if (!path) continue;
      
      if (path.instance === 'Boolean') {
        if (typeof value !== 'boolean') {
          logger.warn('Boolean field has non-boolean value', {
            collection,
            field,
            value,
            expected: 'boolean',
            actual: typeof value
          });
          
          if (field === 'isDecisionMaker') {
            filter[field] = true;
            logger.info(`Converted ${field} to boolean true`, { originalValue: value });
          } else if (typeof value === 'string') {
            if (value.toLowerCase() === 'true' || value.toLowerCase() === 'yes' || value === '1') {
              filter[field] = true;
            } else if (value.toLowerCase() === 'false' || value.toLowerCase() === 'no' || value === '0') {
              filter[field] = false;
            } else {
              filter[field] = true;
            }
          } else if (typeof value === 'number') {
            filter[field] = value === 1;
          }
        }
      }
      
      if (path.instance === 'ObjectId') {
        if (typeof value === 'string' && !mongoose.Types.ObjectId.isValid(value)) {
          if (value.includes('previous') || value.includes('FROM_STEP')) {
            logger.warn(`Invalid ObjectId placeholder in ${field}`, { value });
            delete filter[field];
          }
        }
      }
    }
  }

  private async textSearch(query: SearchQuery): Promise<SearchResult> {
    const { collection, textQuery, filter, limit = 10, skip = 0 } = query;
    const Model = this.getModel(collection);
    
    try {
      const indexes = await Model.listIndexes();
      const hasTextIndex = indexes.some((idx: any) => idx.textSearchVersion);
      
      if (hasTextIndex) {
        const searchFilter = {
          ...filter,
          $text: { $search: textQuery },
        };

        const [documents, total] = await Promise.all([
          Model.find(searchFilter)
            .select({ score: { $meta: 'textScore' } })
            .sort({ score: { $meta: 'textScore' } })
            .limit(limit)
            .skip(skip)
            .lean(),
          Model.countDocuments(searchFilter),
        ]);

        return {
          documents,
          total,
          method: 'text',
          confidence: 0.7,
        };
      }
    } catch (error: any) {
      logger.warn('MongoDB text search failed, using fallback', { error: error.message });
    }

    return this.fallbackTextSearch(query);
  }

  private async fallbackTextSearch(query: SearchQuery): Promise<SearchResult> {
    const { collection, textQuery, filter, limit = 10, skip = 0 } = query;
    const Model = this.getModel(collection);
    
    const schema = Model.schema;
    const textFields: string[] = [];
    
    Object.keys(schema.paths).forEach(path => {
      const pathObj = schema.paths[path];
      if (pathObj.instance === 'String' && pathObj.options?.select !== false) {
        textFields.push(path);
      }
    });

    if (textFields.length === 0) {
      return await this.metadataSearch({ ...query, textQuery: undefined });
    }

    const orConditions = textFields.map(field => ({
      [field]: { $regex: textQuery, $options: 'i' }
    }));

    const searchFilter = {
      ...filter,
      $or: orConditions,
    };

    const [documents, total] = await Promise.all([
      Model.find(searchFilter)
        .limit(limit)
        .skip(skip)
        .lean(),
      Model.countDocuments(searchFilter),
    ]);

    return {
      documents,
      total,
      method: 'text',
      confidence: 0.5,
    };
  }

  private async metadataSearch(query: SearchQuery): Promise<SearchResult> {
    const { collection, filter, textQuery, limit = 10, skip = 0, sort, populate } = query;
    const Model = this.getModel(collection);
    
    // Fix boolean fields
    const fixedFilter = { ...filter };
    for (const [key, value] of Object.entries(fixedFilter)) {
      const path = Model.schema.paths[key];
      if (path && path.instance === 'Boolean' && typeof value === 'string') {
        if (value === 'true' || value === 'false') {
          fixedFilter[key] = value === 'true';
          logger.info('Fixed boolean string in metadata search', { 
            field: key, 
            from: value, 
            to: fixedFilter[key] 
          });
        }
      }
    }
    
    let queryBuilder = Model.find(fixedFilter).limit(limit).skip(skip);
    
    if (sort) {
      queryBuilder = queryBuilder.sort(sort);
    }
    
    if (populate) {
      populate.forEach(path => {
        queryBuilder = queryBuilder.populate(path);
      });
    }
    
    const [documents, total] = await Promise.all([
      queryBuilder.lean(),
      Model.countDocuments(fixedFilter),
    ]);
    
    // DEBUG: Log raw data for intent_score queries to verify data exists before cleaning
    if (textQuery && /\bintent_score|intent\s+score|buying\s+intent\b/i.test(textQuery) && documents.length > 0) {
      const firstDoc = documents[0];
      logger.info('SearchService: Raw data check before cleaning', {
        collection,
        hasScoringMetrics: !!firstDoc.scoringMetrics,
        scoringMetricsType: typeof firstDoc.scoringMetrics,
        scoringMetricsKeys: firstDoc.scoringMetrics ? Object.keys(firstDoc.scoringMetrics) : [],
        hasIntentScore: !!firstDoc.scoringMetrics?.intent_score,
        intentScoreType: typeof firstDoc.scoringMetrics?.intent_score,
        intentScoreKeys: firstDoc.scoringMetrics?.intent_score ? Object.keys(firstDoc.scoringMetrics.intent_score) : [],
        intentScoreSample: firstDoc.scoringMetrics?.intent_score ? 
          JSON.stringify(firstDoc.scoringMetrics.intent_score).substring(0, 200) : 'none'
      });
    }
    
    // DYNAMIC FIELD DETECTION: Use field matcher to detect relevant fields
    let queryContext = textQuery || '';
    let priorityFields: string[] = ['_id', 'name'];
    let isFitScoreQuery = false;
    let isIntentScoreQuery = false;
    
    try {
      const { getFieldMatcher } = require('../services/field-matcher.service');
      const { schemaService } = require('../services/schema.service');
      const fieldMatcher = getFieldMatcher(schemaService);
      
      if (textQuery) {
        const matches = fieldMatcher.matchQueryToFields(textQuery, [collection]);
        if (matches.length > 0 && matches[0].matchedFields.length > 0) {
          queryContext = matches[0].queryContext;
          priorityFields = fieldMatcher.getFieldsToPreserve(collection, queryContext);
          
          isIntentScoreQuery = queryContext === 'intent_score_query';
          isFitScoreQuery = queryContext === 'fit_score_query';
          
          logger.info('Dynamic field detection in search service', {
            collection,
            queryContext,
            priorityFieldsCount: priorityFields.length,
            topFields: priorityFields.slice(0, 5),
            matchedFieldsCount: matches[0].matchedFields.length,
            topMatchedField: matches[0].matchedFields[0]?.field.name,
            topMatchedScore: matches[0].matchedFields[0]?.relevanceScore
          });
        } else {
          logger.debug('Dynamic field detection: No matches found', {
            collection,
            textQuery: textQuery.substring(0, 100)
          });
        }
      }
      
      // Also check filter for field hints
      if (fixedFilter['scoringMetrics.fit_score.score'] !== undefined) {
        isFitScoreQuery = true;
        queryContext = 'fit_score_query';
      } else if (fixedFilter['scoringMetrics.intent_score'] !== undefined ||
                 fixedFilter['scoringMetrics.intent_score.analysis_metadata.final_intent_score'] !== undefined) {
        isIntentScoreQuery = true;
        queryContext = 'intent_score_query';
      }
    } catch (error) {
      // Fallback to pattern matching
      logger.debug('Field matcher not available in search service, using fallback', { error: (error as Error).message });
      isFitScoreQuery = fixedFilter['scoringMetrics.fit_score.score'] !== undefined ||
                       (textQuery && /\b(fit\s+score|classify.*fit|top.*fit)\b/i.test(textQuery));
      isIntentScoreQuery = fixedFilter['scoringMetrics.intent_score'] !== undefined ||
                          (textQuery && /\b(intent\s+score|intent_score|buying\s+intent|intent\s+analysis|intent\s+signals)\b/i.test(textQuery));
      
      queryContext = isIntentScoreQuery ? 'intent_score_query' :
                     isFitScoreQuery ? 'fit_score_query' : 
                     (textQuery?.includes('top') && /\d+/.test(textQuery || '')) ? 'top_n_query' :
                     textQuery || '';
    }
    
    const cleanedDocs = documentCleaner.cleanDocuments(documents, queryContext, {
      excludeFields: ['embedding', 'searchKeywords', 'semanticSummary', '__v'],
      queryIntent: (isFitScoreQuery || isIntentScoreQuery) ? 'analyze' : 'search',
      preserveDocumentCount: isFitScoreQuery || isIntentScoreQuery || (textQuery?.includes('top') || false),
      priorityFields: priorityFields
    });
    
    return {
      documents: cleanedDocs,
      total,
      method: 'metadata',
      confidence: 1.0,
    };
  }

  private async hybridSearch(query: SearchQuery): Promise<SearchResult> {
    const [vectorResults, textResults] = await Promise.all([
      this.vectorSearch({ ...query, textQuery: undefined }).catch((error) => {
        logger.warn('Vector search in hybrid failed', { error: error.message });
        return {
          documents: [],
          total: 0,
          method: 'vector' as const,
          confidence: 0,
        };
      }),
      this.textSearch({ ...query, vectorQuery: undefined }),
    ]);

    const weight = config.search?.hybridWeight || 0.5;
    const combinedDocs = this.combineResults(
      vectorResults.documents,
      textResults.documents,
      weight
    );

    return {
      documents: combinedDocs.slice(0, query.limit || 10),
      total: combinedDocs.length,
      method: 'hybrid',
      confidence: (vectorResults.confidence + textResults.confidence) / 2,
    };
  }

  private combineResults(
    vectorDocs: any[],
    textDocs: any[],
    vectorWeight: number
  ): any[] {
    const scoreMap = new Map<string, { doc: any; score: number }>();

    vectorDocs.forEach((doc, idx) => {
      const id = doc._id.toString();
      const score = (doc.score || 1 - idx / Math.max(vectorDocs.length, 1)) * vectorWeight;
      scoreMap.set(id, { doc, score });
    });

    textDocs.forEach((doc, idx) => {
      const id = doc._id.toString();
      const textScore = (doc.score || 1 - idx / Math.max(textDocs.length, 1)) * (1 - vectorWeight);
      
      if (scoreMap.has(id)) {
        scoreMap.get(id)!.score += textScore;
      } else {
        scoreMap.set(id, { doc, score: textScore });
      }
    });

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .map(item => ({ ...item.doc, combinedScore: item.score }));
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const openai = new OpenAI({ apiKey: config.openai.apiKey });

    try {
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text.replace(/\n/g, ' '),
        dimensions: 1536
      });
      return response.data[0].embedding;
    } catch (error: any) {
      logger.error('Embedding generation failed', { error: error.message });
      throw new Error('Failed to generate vector embedding');
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async hop(
    sourceCollection: string,
    sourceIds: string[],
    targetCollection: string,
    viaField: string,
    userId: string,
    populatePaths?: string[]
  ): Promise<any[]> {
    try {
      logger.debug('Executing hop', {
        sourceCollection,
        targetCollection,
        viaField,
        sourceIdsCount: sourceIds.length
      });
      
      if (!sourceIds || sourceIds.length === 0) {
        logger.warn('Hop requested with empty sourceIds, skipping.');
        return [];
      }
      
      const SourceModel = this.getModel(sourceCollection);
      const TargetModel = this.getModel(targetCollection);
      
      if (SourceModel.schema.paths.userId) {
        const sourceDocs = await SourceModel.find({
          _id: { $in: sourceIds.map(id => new mongoose.Types.ObjectId(id)) },
          userId
        }).select('_id').lean();

        if (sourceDocs.length === 0) {
          throw new RetrievalError('No authorized source documents found');
        }

        sourceIds = sourceDocs.map(doc => doc._id.toString());
      }

      const filter: any = {
        [viaField]: { $in: sourceIds.map(id => new mongoose.Types.ObjectId(id)) },
      };

      if (TargetModel.schema.paths.userId) {
        filter.userId = userId;
      }

      let query = TargetModel.find(filter);

      if (populatePaths) {
        populatePaths.forEach(path => {
          query = query.populate(path);
        });
      }

      const results = await query.lean();
      
      logger.info('Hop completed', { 
        from: sourceCollection,
        to: targetCollection,
        sourceCount: sourceIds.length,
        resultCount: results.length 
      });

      return results;
    } catch (error: any) {
      logger.error('Hop failed', { 
        sourceCollection,
        targetCollection,
        error: error.message,
        stack: error.stack 
      });
      throw new RetrievalError(`Hop failed: ${error.message}`);
    }
  }
}

export const searchService = new SearchService();