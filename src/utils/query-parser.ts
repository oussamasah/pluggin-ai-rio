// src/utils/query-parser.ts
import { DetectedEntity } from '../types';
import { logger } from '../core/logger';
import nlp from 'compromise';
import { COLLECTION_FIELDS } from '../graph/state';

export interface ParsedQuery {
  entities: DetectedEntity[];
  filters: FieldFilter[];
  metrics: Record<string, any>;
  keywords: string[];
  sort?: Record<string, 1 | -1>;
  topN?: { limit: number; sortBy: string };
  intent?: string;
  collections: string[];
  confidence: number;
}

export interface FieldFilter {
  collection: string;
  field: string;
  operator: string;
  value: any;
  originalText: string;
  confidence: number;
  mongoQuery: Record<string, any>;
  source: 'semantic' | 'regex' | 'ner' | 'text-search';
}

export class QueryParser {
  private companyPatterns = [
    /(?:company|companies|firm|organization|business|enterprise)\s+(?:called|named|is|are|like|including)\s*["']([^"'\n]+)["']/i,
    /(?:at|from|of|in|working at|employed at)\s+(?:the\s+)?["']?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*(?:Inc\.?|Corp\.?|LLC|Ltd\.?|GmbH|AG|Pvt\.?\s+Ltd\.?)?)["']?/i,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Company|Corporation|Inc\.?|Corp\.?|Ltd\.?|Technologies|Solutions|Systems|Software|Hardware|Services|Consulting)\b/i,
    /["']([^"'\n]+)["']\s+(?:company|corporation|firm|business|enterprise)/i,
  ];

  private employeePatterns = [
    /(?:employee|person|contact|individual|staff member|team member|representative)\s+(?:called|named|is|are|like)\s*["']([^"'\n]+)["']/i,
    /(?:employee|person|contact|individual|staff member)\s+(?:called|named|is|are)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /(?:Mr\.|Ms\.|Mrs\.|Miss|Dr\.|Prof\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:works at|employed at|from|at|is at)\b/i,
  ];

  // Text search patterns for common filter phrases
  private filterPatterns = {
    // Revenue patterns - improved to catch "over $10M", "revenue over $10M"
    revenue: [
      /(?:revenue|sales|income|turnover|annual\s+revenue)\s*(?:>|greater\s+than|above|over|at\s+least|more\s+than|exceeding|higher\s+than)\s+\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(million|billion|thousand|m|b|k)?/i,
      /(?:revenue|sales|income)\s+(?:between|from|range)\s+\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:and|to|-)\s+\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(million|billion|thousand|m|b|k)?/i,
      /(?:revenue|sales|income)\s*(?:<|less\s+than|below|under|lower\s+than)\s+\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(million|billion|thousand|m|b|k)?/i,
      /\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(million|billion|thousand|m|b|k)?\s+(?:in\s+)?(?:revenue|sales|income)/i,
      // New patterns for "over $10M", "revenue over $10M"
      /(?:over|above|more\s+than|greater\s+than)\s+\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*(million|billion|thousand|m|b|k)/i,
      /(?:over|above|more\s+than|greater\s+than)\s+\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*(million|billion|thousand|m|b|k)?/i,
    ],
    
    // Employee count patterns - improved to catch "over 1000", "with 50-500 employees"
    employees: [
      /(?:employee\s+count|employees|staff|headcount|workforce|personnel|team\s+size)\s*(?:>|greater\s+than|above|over|at\s+least|more\s+than|exceeding)\s+(\d+(?:,\d{3})*)/i,
      /(?:employee\s+count|employees)\s+(?:between|from|range)\s+(\d+(?:,\d{3})*)\s*(?:and|to|-)\s+(\d+(?:,\d{3})*)/i,
      /(?:employee\s+count|employees)\s*(?:<|less\s+than|below|under)\s+(\d+(?:,\d{3})*)/i,
      /(\d+(?:,\d{3})*)\s+(?:employees|staff|people)/i,
      // New patterns for "over 1000 employees", "with 50-500 employees"
      /(?:over|above|more\s+than|greater\s+than)\s+(\d+(?:,\d{3})*)\s+(?:employees|employee|staff)/i,
      /(?:with|having)\s+(\d+(?:,\d{3})*)\s*(?:-|to)\s*(\d+(?:,\d{3})*)\s+(?:employees|employee|staff)/i,
      /(\d+(?:,\d{3})*)\s*(?:-|to)\s*(\d+(?:,\d{3})*)\s+(?:employees|employee|staff)/i,
    ],
    
    // Industry patterns
    industry: [
      /(?:in|from)\s+the\s+(\w+)\s+(?:industry|sector|vertical)/i,
      /(?:industry|sector|vertical)\s+(?:is|of|like)\s+["']?([^"'\s]+(?:\s+[^"'\s]+)*)["']?/i,
      /(\w+)\s+(?:companies|businesses|firms)/i,
    ],
    
    // Location patterns
    location: [
      /(?:in|at|from|based\s+in|located\s+in|headquartered\s+in)\s+["']?([^"'\.,]+(?:\s+[^"'\.,]+)*)["']?/i,
      /(?:companies|businesses)\s+(?:in|at|from)\s+["']?([^"'\.,]+)["']?/i,
    ],
    
    // Date patterns
    date: [
      /(?:founded|established|created)\s+(?:in|on|during)\s+(\d{4})/i,
      /(?:since|from)\s+(\d{4})/i,
      /(\d{4})\s+(?:to|until)\s+(\d{4})/i,
    ],
    
    // Job title patterns
    jobTitle: [
      /(?:job|title|position|role)\s+(?:is|as|of)\s+["']?([^"'\.,]+(?:\s+[^"'\.,]+)*)["']?/i,
      /(?:works\s+as|working\s+as)\s+["']?([^"'\.,]+(?:\s+[^"'\.,]+)*)["']?/i,
      /(?:ceo|cto|cfo|director|manager|engineer|developer)/i,
    ],
    
    // Technology patterns
    technology: [
      /(?:uses|using|built\s+with)\s+["']?([^"'\.,]+(?:\s+[^"'\.,]+)*)["']?/i,
      /(?:tech\s+stack|technologies|tools)\s+(?:include|including|are)\s+["']?([^"'\.,]+(?:\s+[^"'\.,]+)*)["']?/i,
    ],
    
    // Decision maker patterns
    decisionMaker: [
      /(?:decision\s+maker|decision-maker|decision\s+making)/i,
      /(?:senior|executive|c-level|c-suite|director|vp)/i,
      /(?:makes\s+decisions|decision\s+authority)/i,
    ],
  };

  // Operator mappings
  private operatorMappings: Record<string, string> = {
    'greater than': '$gt', 'more than': '$gt', 'above': '$gt', 'over': '$gt',
    'less than': '$lt', 'below': '$lt', 'under': '$lt',
    'at least': '$gte', 'minimum': '$gte',
    'at most': '$lte', 'maximum': '$lte', 'up to': '$lte',
    'equals': '$eq', 'equal to': '$eq', 'is': '$eq',
    'not equals': '$ne', 'not equal to': '$ne',
    'between': 'between', 'from': 'between', 'range': 'between',
    'contains': '$regex', 'including': '$regex', 'with': '$regex',
    'starts with': '$regex', 'begins with': '$regex',
    'ends with': '$regex',
  };

  // Number multipliers
  private numberMultipliers: Record<string, number> = {
    'thousand': 1000, 'k': 1000,
    'million': 1000000, 'm': 1000000,
    'billion': 1000000000, 'b': 1000000000,
  };

  // Common stop words for keyword extraction
  private stopWords = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'has', 'had',
    'what', 'when', 'where', 'which', 'give', 'show', 'list', 'find', 'get',
    'me', 'my', 'has', 'have', 'having', 'with', 'by', 'at', 'in', 'on', 'to',
    'for', 'of', 'a', 'an', 'the', 'please', 'can', 'could', 'would', 'should'
  ]);

  // Generic terms that should NOT be used as filter values
  private genericTerms = new Set([
    'revenue', 'revenu', 'income', 'sales', 'turnover',
    'employees', 'staff', 'people', 'headcount', 'employee', 'employee count',
    'company', 'companies', 'business', 'businesses',
    'sorted', 'order', 'list', 'top', 'max', 'highest', 'give', 'show', 'get',
    'sector', 'industry', 'consulting', 'sectors', 'all sectors',
    'has', 'with', 'by', 'for', 'all', 'any', 'every', 'each',
    'count', 'number', 'amount', 'size', 'total', 'sum', 'average',
    'active', 'experience', 'title', 'job', 'position', 'role'
  ]);

  parseQuery(query: string): ParsedQuery {
    logger.info('Parsing query with enhanced filter extraction', { query });

    const baseResult: ParsedQuery = {
      entities: [],
      filters: [],
      metrics: {},
      keywords: [],
      collections: [],
      confidence: 1.0,
    };

    try {
      // Step 1: Detect sorted queries
      const sortInfo = this.detectSortedQueries(query);
      if (sortInfo) {
        baseResult.sort = { [sortInfo.field]: sortInfo.order };
      }

      // Step 2: Extract entities with NER
      const entities = this.extractEntitiesWithNER(query);
      baseResult.entities = entities;

      // Step 3: Extract filters using text patterns (only with numbers)
      const textFilters = this.extractFiltersWithTextPatterns(query);
      baseResult.filters = textFilters;

      // Step 4: Extract semantic filters (using compromise for deeper understanding)
      const semanticFilters = this.extractSemanticFilters(query);
      // Filter out any problematic semantic filters
      const safeSemanticFilters = semanticFilters.filter(filter => {
        return this.validateFilterAgainstSchema(filter);
      });
      baseResult.filters.push(...safeSemanticFilters);

      // Step 5: Extract metrics from filters
      baseResult.metrics = this.extractMetricsFromFilters(baseResult.filters);

      // Step 6: Detect top N queries
      const topNResult = this.detectTopNQuery(query);
      if (topNResult) {
        baseResult.sort = topNResult.sort;
        baseResult.topN = topNResult.topN;
        baseResult.intent = 'top_n';
      } else {
        baseResult.intent = this.determineIntent(query, baseResult.filters);
      }

      // Step 7: Determine target collections
      baseResult.collections = this.determineCollections(baseResult.entities, baseResult.filters);

      // Step 8: Extract keywords
      baseResult.keywords = this.extractKeywords(query, baseResult.intent, baseResult.entities);

      // Step 9: Calculate confidence
      baseResult.confidence = this.calculateConfidence(baseResult);

      logger.debug('Query parsed successfully', {
        query,
        entities: baseResult.entities.length,
        filters: baseResult.filters.length,
        sort: baseResult.sort,
        collections: baseResult.collections,
        confidence: baseResult.confidence
      });

    } catch (error: any) {
      logger.error('Query parsing failed', { query, error: error.message });
      baseResult.confidence = 0.3;
    }

    return baseResult;
  }

  private extractFiltersWithTextPatterns(query: string): FieldFilter[] {
    const filters: FieldFilter[] = [];

    // Check each pattern category
    for (const [category, patterns] of Object.entries(this.filterPatterns)) {
      for (const pattern of patterns) {
        const matches = query.match(pattern);
        if (matches) {
          const filter = this.createFilterFromPattern(category, matches, pattern, query);
          if (filter && this.validateFilterAgainstSchema(filter)) {
            filters.push(filter);
          }
        }
      }
    }

    return filters;
  }

  private validateFilterAgainstSchema(filter: FieldFilter): boolean {
    // Get field definition from schema
    const fieldDef = COLLECTION_FIELDS[filter.collection]?.[filter.field];
    if (!fieldDef) {
      logger.warn(`Field ${filter.field} not found in collection ${filter.collection} schema`);
      return false;
    }

    // Check if field is filterable
    if (!fieldDef.filterable) {
      logger.warn(`Field ${filter.field} is not filterable in collection ${filter.collection}`);
      return false;
    }

    // Validate value type based on field type
    switch (fieldDef.type) {
      case 'number':
        // For numeric fields, value must be numeric
        if (typeof filter.value === 'string') {
          const numValue = parseFloat(filter.value);
          if (isNaN(numValue)) {
            // Check if it's a generic term
            if (this.genericTerms.has(filter.value.toLowerCase())) {
              logger.warn(`Skipping generic term "${filter.value}" for numeric field ${filter.field}`);
              return false;
            }
            logger.warn(`Non-numeric value "${filter.value}" for numeric field ${filter.field}`);
            return false;
          }
        }
        break;

      case 'boolean':
        // For boolean fields, validate based on common patterns
        if (filter.field === 'isDecisionMaker') {
          // isDecisionMaker should always be boolean true for decision maker queries
          if (typeof filter.value !== 'boolean') {
            logger.warn(`Non-boolean value for isDecisionMaker field: ${filter.value}`);
            return false;
          }
        }
        break;

      case 'string':
        // For string fields, check if value is not a generic term
        if (this.genericTerms.has(filter.value.toLowerCase())) {
          logger.warn(`Generic term "${filter.value}" used as filter value for string field ${filter.field}`);
          return false;
        }
        break;
    }

    return true;
  }

  private createFilterFromPattern(
    category: string, 
    matches: RegExpMatchArray, 
    pattern: RegExp, 
    originalText: string
  ): FieldFilter | null {
    switch (category) {
      case 'revenue':
        return this.createRevenueFilter(matches, originalText);
      case 'employees':
        return this.createEmployeeFilter(matches, originalText);
      case 'industry':
        return this.createIndustryFilter(matches, originalText);
      case 'location':
        return this.createLocationFilter(matches, originalText);
      case 'date':
        return this.createFoundedYearFilter(matches, originalText);
      case 'jobTitle':
        return this.createJobTitleFilter(matches, originalText);
      case 'technology':
        return this.createTechnologyFilter(matches, originalText);
      case 'decisionMaker':
        return this.createDecisionMakerFilter(matches, originalText);
      default:
        return null;
    }
  }

  private createRevenueFilter(matches: RegExpMatchArray, originalText: string): FieldFilter | null {
    try {
      let value: number;
      let operator = '$gt';
      let fieldValue: any;

      // Determine operator from pattern
      if (originalText.includes('between') || originalText.includes('from') || originalText.includes('range')) {
        // Range pattern - must have two numbers
        if (matches.length < 3) return null;
        const min = this.parseNumber(matches[1], matches[3] || matches[matches.length - 1]);
        const max = this.parseNumber(matches[2], matches[3] || matches[matches.length - 1]);
        if (isNaN(min) || isNaN(max)) return null;
        operator = 'between';
        value = (min + max) / 2;
        fieldValue = { $gte: min, $lte: max };
      } else if (originalText.includes('<') || originalText.includes('less than') || originalText.includes('below')) {
        operator = '$lt';
        const numStr = matches[1] || matches[matches.length - 1];
        if (!numStr) return null;
        value = this.parseNumber(numStr, matches[2]);
        if (isNaN(value)) return null;
        fieldValue = { [operator]: value };
      } else {
        // Handle "over $10M", "revenue over $10M", "$10M revenue"
        const numStr = matches[1] || matches[matches.length - 1];
        if (!numStr) return null;
        const unit = matches[2] || matches[matches.length - 1];
        value = this.parseNumber(numStr, unit);
        if (isNaN(value)) return null;
        // Default to $gt for "over", "above", "more than"
        if (originalText.toLowerCase().includes('over') || 
            originalText.toLowerCase().includes('above') ||
            originalText.toLowerCase().includes('more than') ||
            originalText.toLowerCase().includes('greater than')) {
          operator = '$gt';
        }
        fieldValue = { [operator]: value };
      }

      return {
        collection: 'companies',
        field: 'annualRevenue',
        operator,
        value,
        originalText,
        confidence: 0.85,
        mongoQuery: fieldValue,
        source: 'text-search'
      };
    } catch (error) {
      logger.warn('Failed to create revenue filter', { matches, error });
      return null;
    }
  }

  private createEmployeeFilter(matches: RegExpMatchArray, originalText: string): FieldFilter | null {
    try {
      let value: number;
      let operator = '$gt';
      let fieldValue: any;

      if (originalText.includes('between') || originalText.includes('range')) {
        if (matches.length < 3) return null;
        const min = parseInt(matches[1].replace(/,/g, ''));
        const max = parseInt(matches[2].replace(/,/g, ''));
        operator = 'between';
        value = (min + max) / 2;
        fieldValue = { $gte: min, $lte: max };
      } else if (originalText.includes('<') || originalText.includes('less than')) {
        operator = '$lt';
        value = parseInt(matches[1].replace(/,/g, ''));
        fieldValue = { [operator]: value };
      } else {
        value = parseInt(matches[1].replace(/,/g, ''));
        fieldValue = { [operator]: value };
      }

      return {
        collection: 'companies',
        field: 'employeeCount',
        operator,
        value,
        originalText,
        confidence: 0.8,
        mongoQuery: fieldValue,
        source: 'text-search'
      };
    } catch (error) {
      logger.warn('Failed to create employee filter', { matches, error });
      return null;
    }
  }

  private createIndustryFilter(matches: RegExpMatchArray, originalText: string): FieldFilter | null {
    const industry = matches[1]?.trim();
    if (!industry || this.genericTerms.has(industry.toLowerCase())) return null;

    return {
      collection: 'companies',
      field: 'industry',
      operator: '$regex',
      value: industry,
      originalText,
      confidence: 0.7,
      mongoQuery: { $regex: industry, $options: 'i' },
      source: 'text-search'
    };
  }

  private createLocationFilter(matches: RegExpMatchArray, originalText: string): FieldFilter | null {
    const location = matches[1]?.trim();
    if (!location || this.genericTerms.has(location.toLowerCase())) return null;

    return {
      collection: 'companies',
      field: 'country',
      operator: '$regex',
      value: location,
      originalText,
      confidence: 0.6,
      mongoQuery: { $regex: location, $options: 'i' },
      source: 'text-search'
    };
  }

  private createJobTitleFilter(matches: RegExpMatchArray, originalText: string): FieldFilter | null {
    const title = matches[1]?.trim() || originalText.toLowerCase();
    if (!title || this.genericTerms.has(title.toLowerCase())) return null;

    return {
      collection: 'employees',
      field: 'activeExperienceTitle',
      operator: '$regex',
      value: title,
      originalText,
      confidence: 0.75,
      mongoQuery: { $regex: title, $options: 'i' },
      source: 'text-search'
    };
  }

  private createDecisionMakerFilter(matches: RegExpMatchArray, originalText: string): FieldFilter | null {
    return {
      collection: 'employees',
      field: 'isDecisionMaker',
      operator: '$eq',
      value: true,
      originalText,
      confidence: 0.8,
      mongoQuery: true, // Boolean value, not object
      source: 'text-search'
    };
  }

  private createFoundedYearFilter(matches: RegExpMatchArray, originalText: string): FieldFilter | null {
    try {
      const yearStr = matches[1] || (matches.length > 1 ? matches[matches.length - 1] : null);
      if (!yearStr) return null;
      const year = parseInt(yearStr);
      if (isNaN(year) || year < 1800 || year > 2100) return null;

      let operator = '$eq';
      let fieldValue: any = year;

      if (originalText.includes('after') || originalText.includes('since')) {
        operator = '$gte';
        fieldValue = { [operator]: year };
      } else if (originalText.includes('before')) {
        operator = '$lt';
        fieldValue = { [operator]: year };
      } else {
        fieldValue = year; // Exact match
      }

      return {
        collection: 'companies',
        field: 'foundedYear',
        operator,
        value: year,
        originalText,
        confidence: 0.8,
        mongoQuery: fieldValue,
        source: 'text-search'
      };
    } catch (error) {
      logger.warn('Failed to create founded year filter', { matches, error });
      return null;
    }
  }

  private parseNumber(valueStr: string, unit?: string): number {
    const cleanValue = parseFloat(valueStr.replace(/,/g, ''));
    if (!unit) return cleanValue;

    const multiplier = this.numberMultipliers[unit.toLowerCase()] || 1;
    return cleanValue * multiplier;
  }

  private extractSemanticFilters(query: string): FieldFilter[] {
    const filters: FieldFilter[] = [];
    
    try {
      const doc = nlp(query);
      
      // Use compromise to understand the query structure
      const sentences = doc.sentences().out('array');
      
      sentences.forEach((sentence: string) => {
        try {
          // Look for number comparisons - ONLY create filters for actual numbers
          const numbers = doc.numbers();
          numbers.forEach((num: { text: () => string; value: () => number }) => {
            try {
              const context = this.getNumberContext(sentence, numText);
              const fieldCandidate = this.inferFieldFromContext(context);
              
              if (fieldCandidate) {
                const filter = this.createSemanticFilter(fieldCandidate, numValue, context, sentence);
                if (filter && this.validateFilterAgainstSchema(filter)) {
                  // Additional check: ensure value is not a generic term
                  const filterValue = String(filter.value).toLowerCase();
                  if (!this.genericTerms.has(filterValue) && filterValue !== filter.field.toLowerCase()) {
                    filters.push(filter);
                  } else {
                    logger.debug('Rejected semantic filter with generic term', { filter, value: filter.value });
                  }
                }
              }
            } catch (err: any) {
              logger.debug('Error processing number in semantic extraction', { error: err?.message || String(err) });
            }
          });

          // Look for text concepts - be very selective
          const textFilters = this.extractTextSemanticFilters(sentence);
          // Filter out problematic text filters
          const safeTextFilters = textFilters.filter(filter => {
            if (!this.validateFilterAgainstSchema(filter)) {
              return false;
            }
            // Additional generic term check
            const filterValue = String(filter.value).toLowerCase();
            if (this.genericTerms.has(filterValue) || filterValue === filter.field.toLowerCase()) {
              logger.debug('Rejected text filter with generic term', { filter, value: filter.value });
              return false;
            }
            return true;
          });
          filters.push(...safeTextFilters);
        } catch (err: any) {
          logger.debug('Error processing sentence in semantic extraction', { 
            sentence, 
            error: err?.message || String(err) 
          });
        }
      });

    } catch (error: any) {
      logger.warn('Semantic filter extraction failed', { 
        error: error?.message || String(error),
        stack: error?.stack 
      });
    }

    return filters;
  }

  private getNumberContext(sentence: string, numberText: string): {
    before: string;
    after: string;
    operator?: string;
    fieldHint?: string;
    unit?: string;
  } {
    const lowerSentence = sentence.toLowerCase();
    const lowerNumber = numberText.toLowerCase();
    const index = lowerSentence.indexOf(lowerNumber);
    
    const before = lowerSentence.substring(Math.max(0, index - 50), index).trim();
    const after = lowerSentence.substring(index + lowerNumber.length, Math.min(sentence.length, index + lowerNumber.length + 50)).trim();
    
    // Extract operator
    let operator: string | undefined;
    for (const [phrase, op] of Object.entries(this.operatorMappings)) {
      if (before.includes(phrase)) {
        operator = op;
        break;
      }
    }
    
    // Extract field hint
    const fieldHint = this.extractFieldHint(before + ' ' + after);
    
    // Extract unit
    const unit = this.extractUnit(after);
    
    return { before, after, operator, fieldHint, unit };
  }

  private extractFieldHint(text: string): string | undefined {
    const fieldKeywords = {
      'revenue': ['revenue', 'sales', 'income', 'turnover'],
      'employees': ['employee', 'staff', 'people', 'headcount'],
      'year': ['founded', 'established', 'year', 'since'],
      'growth': ['growth', 'increase', 'decrease'],
      'connections': ['connections', 'network'],
      'experience': ['experience', 'years', 'career']
    };
    
    for (const [field, keywords] of Object.entries(fieldKeywords)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        return field;
      }
    }
    
    return undefined;
  }

  private extractUnit(text: string): string | undefined {
    for (const unit of Object.keys(this.numberMultipliers)) {
      if (text.includes(unit)) {
        return unit;
      }
    }
    return undefined;
  }

  private inferFieldFromContext(context: any): { collection: string; field: string; confidence: number } | null {
    if (!context.fieldHint) return null;

    const candidates: Array<{ collection: string; field: string; confidence: number }> = [];

    // Check against COLLECTION_FIELDS
    for (const [collection, fields] of Object.entries(COLLECTION_FIELDS)) {
      for (const [fieldName, fieldDef] of Object.entries(fields)) {
        if (fieldDef.filterable) {
          let confidence = 0;
          
          // Check field description
          const description = fieldDef.description.toLowerCase();
          if (description.includes(context.fieldHint)) {
            confidence += 0.3;
          }
          
          // Check field type matches context
          if (context.unit === 'dollars' && fieldName === 'annualRevenue') {
            confidence += 0.4;
          }
          if (context.fieldHint === 'employees' && fieldName === 'employeeCount') {
            confidence += 0.4;
          }
          if (context.fieldHint === 'year' && fieldName === 'foundedYear') {
            confidence += 0.4;
          }
          
          if (confidence > 0.5) {
            candidates.push({ collection, field: fieldName, confidence });
          }
        }
      }
    }
    
    // Return best candidate
    return candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
  }

  private createSemanticFilter(
    fieldCandidate: { collection: string; field: string; confidence: number },
    value: number,
    context: any,
    originalText: string
  ): FieldFilter | null {
    const fieldDef = COLLECTION_FIELDS[fieldCandidate.collection]?.[fieldCandidate.field];
    if (!fieldDef) return null;

    // Apply unit multiplier
    let finalValue = value;
    if (context.unit && this.numberMultipliers[context.unit]) {
      finalValue *= this.numberMultipliers[context.unit];
    }

    // Create MongoDB query based on field type
    let mongoQuery: Record<string, any> = {};
    const operator = context.operator || '$eq';

    if (fieldDef.type === 'number') {
      // For numeric fields
      if (operator === 'between') {
        // For ranges, create a small range around the value
        mongoQuery = { $gte: finalValue * 0.9, $lte: finalValue * 1.1 };
      } else if (operator.startsWith('$')) {
        mongoQuery[operator] = finalValue;
      } else {
        // Default to equality for numbers
        mongoQuery.$eq = finalValue;
      }
    } else if (fieldDef.type === 'string' && operator === '$regex') {
      // For text fields with regex
      mongoQuery = { $regex: finalValue.toString(), $options: 'i' };
    } else {
      // Default fallback
      mongoQuery[operator] = finalValue;
    }

    return {
      collection: fieldCandidate.collection,
      field: fieldCandidate.field,
      operator,
      value: finalValue,
      originalText,
      confidence: fieldCandidate.confidence,
      mongoQuery,
      source: 'semantic'
    };
  }

  private extractTextSemanticFilters(sentence: string): FieldFilter[] {
    const filters: FieldFilter[] = [];
    const lowerSentence = sentence.toLowerCase();

    // IMPORTANT: DO NOT create filters from generic terms
    // Only create filters when we have specific, non-generic terms
    
    // Check for industry mentions - only if not generic
    const industryKeywords = ['consulting', 'technology', 'software', 'saas', 'fintech', 'healthtech', 'ecommerce'];
    industryKeywords.forEach(industry => {
      // Skip if industry is a generic term
      if (this.genericTerms.has(industry)) {
        return;
      }
      
      // Only create filter if industry is mentioned AND not a generic part of the query
      if (lowerSentence.includes(industry) && 
          (lowerSentence.includes('industry') || lowerSentence.includes('sector') || 
           lowerSentence.includes('in the') || lowerSentence.includes('from the'))) {
        // Verify it's not just part of a generic phrase
        if (!this.isGenericPhrase(industry, lowerSentence)) {
          // Double-check it's not a generic term
          if (!this.genericTerms.has(industry.toLowerCase())) {
            filters.push({
              collection: 'companies',
              field: 'industry',
              operator: '$regex',
              value: industry,
              originalText: sentence,
              confidence: 0.7,
              mongoQuery: { $regex: industry, $options: 'i' },
              source: 'semantic'
            });
          }
        }
      }
    });

    // Check for job titles - only in specific contexts
    const titles = ['ceo', 'cto', 'cfo', 'director', 'manager', 'vp', 'executive'];
    titles.forEach(title => {
      if (lowerSentence.includes(title) && 
          (lowerSentence.includes('title') || lowerSentence.includes('role') || 
           lowerSentence.includes('position') || lowerSentence.includes('job'))) {
        filters.push({
          collection: 'employees',
          field: 'activeExperienceTitle',
          operator: '$regex',
          value: title,
          originalText: sentence,
          confidence: 0.75,
          mongoQuery: { $regex: title, $options: 'i' },
          source: 'semantic'
        });
      }
    });

    // Check for decision maker indicators
    const decisionIndicators = ['decision maker', 'decision-maker', 'c-level', 'c-suite', 'executive'];
    decisionIndicators.forEach(indicator => {
      if (lowerSentence.includes(indicator)) {
        filters.push({
          collection: 'employees',
          field: 'isDecisionMaker',
          operator: '$eq',
          value: true,
          originalText: sentence,
          confidence: 0.8,
          mongoQuery: true,
          source: 'semantic'
        });
      }
    });

    return filters;
  }

  private isGenericPhrase(term: string, sentence: string): boolean {
    const genericPatterns = [
      `sorted ${term}`,
      `${term} sorted`,
      `order by ${term}`,
      `sorted by ${term}`,
      `list by ${term}`,
      `top ${term}`,
      `has ${term}`,
      `with ${term}`
    ];
    
    return genericPatterns.some(pattern => sentence.includes(pattern));
  }

  private extractEntitiesWithNER(query: string): DetectedEntity[] {
    const entities: DetectedEntity[] = [];
    
    try {
      const doc = nlp(query);
      
      // Extract organizations
      const organizations = doc.match('#Organization+').out('array');
      organizations.forEach((org: string) => {
        if (this.isValidEntityName(org, query)) {
          entities.push({
            type: 'company',
            value: org,
            field: 'name',
            collectionHint: 'companies',
            confidence: 0.9,
            source: 'ner'
          });
        }
      });

      // Extract people
      const people = doc.match('#Person+').out('array');
      people.forEach((person: string) => {
        if (this.isValidPersonName(person)) {
          entities.push({
            type: 'employee',
            value: person,
            field: 'fullName',
            collectionHint: 'employees',
            confidence: 0.85,
            source: 'ner'
          });
        }
      });

    } catch (error) {
      logger.warn('NER extraction failed', { error });
    }

    return entities;
  }

  private extractMetricsFromFilters(filters: FieldFilter[]): Record<string, any> {
    const metrics: Record<string, any> = {};

    filters.forEach(filter => {
      if (filter.collection === 'companies') {
        if (filter.field === 'annualRevenue') {
          metrics.annualRevenue = filter.mongoQuery;
        } else if (filter.field === 'employeeCount') {
          metrics.employeeCount = filter.mongoQuery;
        }
      }
    });

    return metrics;
  }

  private detectTopNQuery(query: string): { sort: Record<string, 1 | -1>; topN: { limit: number; sortBy: string } } | null {
    const patterns = [
      /(?:show|list|find|get|give)\s+(?:me\s+)?(?:the\s+)?(top|highest|maximum|max|biggest)\s+(\d+)?\s*(companies?|businesses?)\s+(?:with|having|by)?\s*(?:the\s+)?(?:highest|maximum|max|biggest)?\s*(revenue|sales|income|employees?)/i,
      /(?:companies?|businesses?)\s+(?:with|having)\s+(?:the\s+)?(highest|maximum|max|biggest)\s*(revenue|sales|income|employees?)/i,
      /(?:top|highest|maximum|max|biggest)\s+(\d+)?\s*(?:companies?|businesses?)\s+by\s+(revenue|sales|income|employees?)/i,
    ];

    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) {
        const limit = match[2] ? parseInt(match[2]) : 10;
        const sortBy = match[4] || match[3] || 'revenue';
        const field = sortBy.includes('revenue') || sortBy.includes('sales') || sortBy.includes('income') 
          ? 'annualRevenue' 
          : 'employeeCount';
        
        return {
          sort: { [field]: -1 },
          topN: { limit, sortBy: field }
        };
      }
    }
    
    return null;
  }

  private detectSortedQueries(query: string): { field: string; order: 1 | -1 } | null {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('sorted') || lowerQuery.includes('order by') || lowerQuery.includes('sort by')) {
      if (lowerQuery.includes('revenue') || lowerQuery.includes('revenu') || lowerQuery.includes('income')) {
        return { field: 'annualRevenue', order: -1 }; // Default descending for revenue
      } else if (lowerQuery.includes('employee') || lowerQuery.includes('staff')) {
        return { field: 'employeeCount', order: -1 };
      } else if (lowerQuery.includes('fit score') || lowerQuery.includes('fitscore')) {
        return { field: 'scoringMetrics.fit_score.score', order: -1 };
      } else if (lowerQuery.includes('company') || lowerQuery.includes('name')) {
        return { field: 'name', order: 1 };
      }
    }
    
    return null;
  }

  private determineIntent(query: string, filters: FieldFilter[]): string {
    if (filters.some(f => f.field === 'isDecisionMaker')) {
      return 'decision_maker_search';
    }
    if (filters.some(f => f.field === 'industry')) {
      return 'industry_search';
    }
    if (filters.some(f => f.field === 'annualRevenue' || f.field === 'employeeCount')) {
      return 'metric_search';
    }
    return 'general_search';
  }

  private determineCollections(entities: DetectedEntity[], filters: FieldFilter[]): string[] {
    const collections = new Set<string>();

    // Add collections from entities
    entities.forEach(entity => {
      if (entity.collectionHint) {
        collections.add(entity.collectionHint);
      }
    });

    // Add collections from filters
    filters.forEach(filter => {
      collections.add(filter.collection);
    });

    // Default to companies if no collection detected
    if (collections.size === 0) {
      collections.add('companies');
    }

    return Array.from(collections);
  }

  private extractKeywords(query: string, intent: string, entities: DetectedEntity[]): string[] {
    const keywords = new Set<string>();
    
    // Remove entity names
    let cleanQuery = query.toLowerCase();
    entities.forEach(entity => {
      cleanQuery = cleanQuery.replace(new RegExp(entity.value.toLowerCase(), 'g'), '');
    });
    
    // Add meaningful words, excluding generic terms
    cleanQuery.split(/\s+/)
      .filter(word => word.length > 2 && !this.stopWords.has(word) && !this.genericTerms.has(word))
      .forEach(word => keywords.add(word));
    
    // Add intent-specific terms
    if (intent === 'top_n') keywords.add('top');
    if (intent.includes('revenue')) keywords.add('revenue');
    if (intent.includes('employee')) keywords.add('employee');
    
    return Array.from(keywords);
  }

  private calculateConfidence(result: ParsedQuery): number {
    let confidence = 0.5; // Base confidence
    
    // Entities increase confidence
    if (result.entities.length > 0) {
      const entityConfidence = result.entities.reduce((sum, e) => sum + (e.confidence || 0.7), 0) / result.entities.length;
      confidence = Math.max(confidence, entityConfidence * 0.7);
    }
    
    // Valid filters increase confidence
    if (result.filters.length > 0) {
      const filterConfidence = result.filters.reduce((sum, f) => sum + f.confidence, 0) / result.filters.length;
      confidence = Math.max(confidence, filterConfidence * 0.8);
    }
    
    // Clear intent increases confidence
    if (result.intent && result.intent !== 'general_search') {
      confidence += 0.1;
    }
    
    return Math.min(confidence, 1.0);
  }

  private isValidEntityName(name: string, query: string): boolean {
    const lowerName = name.toLowerCase();
    const genericPhrases = [
      'max revenue', 'highest revenue', 'top revenue',
      'has max revenue', 'give top companies', 'companies with'
    ];
    
    return !genericPhrases.some(phrase => lowerName.includes(phrase)) &&
           /^[A-Z]/.test(name) && name.length > 1;
  }

  private isValidPersonName(name: string): boolean {
    const parts = name.split(' ');
    return parts.length >= 1 && parts.length <= 3 && 
           parts.every(part => /^[A-Z]/.test(part));
  }

  private createTechnologyFilter(matches: RegExpMatchArray, originalText: string): FieldFilter | null {
    const technology = matches[1]?.trim();
    if (!technology || this.genericTerms.has(technology.toLowerCase())) return null;

    return {
      collection: 'companies',
      field: 'technologies',
      operator: '$regex',
      value: technology,
      originalText,
      confidence: 0.6,
      mongoQuery: { $regex: technology, $options: 'i' },
      source: 'text-search'
    };
  }
}

export const queryParser = new QueryParser();