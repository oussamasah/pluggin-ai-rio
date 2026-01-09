// src/services/SchemaService.ts
import { HoppingPath } from '../types';
import { logger } from '../core/logger';

export interface CollectionSchema {
  name: string;
  fields: FieldDefinition[];
  relationships: Relationship[];
  indexes: string[];
  embeddingField?: string;
  searchableFields: string[];
}

export interface FieldDefinition {
  name: string;
  type: string;
  isArray: boolean;
  isRequired: boolean;
  description?: string;
  // NEW: Dynamic field metadata for intelligent matching
  synonyms?: string[]; // Alternative names users might use
  category?: string; // Field category (e.g., 'scoring', 'contact', 'financial')
  importance?: 'high' | 'medium' | 'low'; // Field importance for analysis
  searchable?: boolean; // Whether field should be included in semantic search
  analyzable?: boolean; // Whether field should be included in analysis
  examples?: string[]; // Example values or queries
  nestedFields?: string[]; // For nested objects, list of child field paths
}

export interface Relationship {
  field: string;
  targetCollection: string;
  type: "one-to-one" | "one-to-many" | "many-to-many" | "many-to-one";
  via?: string;
}

export class SchemaService {
  private schemas: Map<string, CollectionSchema> = new Map();

  constructor() {
    this.initializeSchemas();
  }

  private initializeSchemas(): void {
    // Company Schema - FIXED with correct searchable fields
    this.schemas.set('companies', {
      name: 'companies',
      fields: [
        { name: '_id', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'sessionId', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'icpModelId', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'name', type: 'String', isArray: false, isRequired: true },
        { name: 'userId', type: 'String', isArray: false, isRequired: true },
        { name: 'domain', type: 'String', isArray: false, isRequired: false },
        { name: 'website', type: 'String', isArray: false, isRequired: false },
        { name: 'description', type: 'String', isArray: false, isRequired: false },
        { name: 'foundedYear', type: 'Number', isArray: false, isRequired: false },
        { name: 'city', type: 'String', isArray: false, isRequired: false },
        { name: 'country', type: 'String', isArray: false, isRequired: false },
        { name: 'countryCode', type: 'String', isArray: false, isRequired: false },
        { name: 'contactEmail', type: 'String', isArray: false, isRequired: false },
        { name: 'contactPhone', type: 'String', isArray: false, isRequired: false },
        { name: 'linkedinUrl', type: 'String', isArray: false, isRequired: false },
        { 
          name: 'industry', 
          type: 'String', 
          isArray: true, 
          isRequired: false,
          description: 'Industry sectors the company operates in',
          category: 'classification',
          importance: 'high',
          searchable: true,
          analyzable: true,
          synonyms: ['sector', 'industries', 'business sector', 'market'],
          examples: ['technology companies', 'companies in healthcare industry']
        },
        { 
          name: 'targetMarket', 
          type: 'String', 
          isArray: false, 
          isRequired: false,
          description: 'Target market segment',
          category: 'classification',
          importance: 'medium',
          searchable: true
        },
        { 
          name: 'ownershipType', 
          type: 'String', 
          isArray: false, 
          isRequired: false,
          description: 'Company ownership structure',
          category: 'classification',
          importance: 'low',
          searchable: true
        },
        { 
          name: 'employeeCount', 
          type: 'Number', 
          isArray: false, 
          isRequired: false,
          description: 'Number of employees',
          category: 'financial',
          importance: 'high',
          searchable: true,
          analyzable: true,
          synonyms: ['employees', 'headcount', 'team size', 'workforce'],
          examples: ['companies with more than 500 employees', 'large companies']
        },
        { 
          name: 'annualRevenue', 
          type: 'Number', 
          isArray: false, 
          isRequired: false,
          description: 'Annual revenue in base currency',
          category: 'financial',
          importance: 'high',
          searchable: true,
          analyzable: true,
          synonyms: ['revenue', 'annual revenue', 'sales', 'income'],
          examples: ['companies with revenue over 100M', 'high revenue companies']
        },
        { 
          name: 'annualRevenueCurrency', 
          type: 'String', 
          isArray: false, 
          isRequired: false,
          description: 'Currency for annual revenue',
          category: 'financial',
          importance: 'low'
        },
        { 
          name: 'fundingStage', 
          type: 'String', 
          isArray: false, 
          isRequired: false,
          description: 'Current funding stage',
          category: 'financial',
          importance: 'medium',
          searchable: true,
          synonyms: ['funding', 'investment stage', 'capital stage']
        },
        { 
          name: 'technologies', 
          type: 'String', 
          isArray: true, 
          isRequired: false,
          description: 'Technologies and tools used by the company',
          category: 'technology',
          importance: 'high',
          searchable: true,
          analyzable: true,
          synonyms: ['tech stack', 'technology stack', 'tools', 'software', 'platforms'],
          examples: ['companies using Salesforce', 'Python companies']
        },
        { 
          name: 'scoringMetrics', 
          type: 'Mixed', 
          isArray: false, 
          isRequired: false,
          description: 'Performance and scoring metrics including fit scores and intent analysis',
          category: 'scoring',
          importance: 'high',
          searchable: true,
          analyzable: true,
          nestedFields: [
            'scoringMetrics.fit_score.score',
            'scoringMetrics.fit_score.confidence',
            'scoringMetrics.intent_score',
            'scoringMetrics.intent_score.analysis_metadata',
            'scoringMetrics.intent_score.signal_breakdown',
            'scoringMetrics.intent_score.gtm_intelligence',
            'scoringMetrics.intent_score.offer_alignment_playbook'
          ]
        },
        { 
          name: 'scoringMetrics.fit_score.score', 
          type: 'Number', 
          isArray: false, 
          isRequired: false, 
          description: 'Fit score value indicating ICP alignment (0-100)',
          category: 'scoring',
          importance: 'high',
          synonyms: ['fit score', 'fit_score', 'icp fit', 'fit', 'icp score'],
          examples: ['top 5 companies by fit score', 'companies with high fit score']
        },
        { 
          name: 'scoringMetrics.fit_score.confidence', 
          type: 'Number', 
          isArray: false, 
          isRequired: false, 
          description: 'Confidence level for fit score calculation (0-100)',
          category: 'scoring',
          importance: 'medium',
          synonyms: ['fit confidence', 'fit_score confidence']
        },
        { 
          name: 'scoringMetrics.intent_score', 
          type: 'Mixed', 
          isArray: false, 
          isRequired: false, 
          description: 'Buying intent analysis with signals, GTM intelligence, and recommendations',
          category: 'scoring',
          importance: 'high',
          searchable: true,
          analyzable: true,
          synonyms: ['intent score', 'intent_score', 'buying intent', 'intent analysis', 'intent signals', 'buying signals'],
          examples: ['intent score details', 'buying intent analysis', 'intent signals for company'],
          nestedFields: [
            'scoringMetrics.intent_score.analysis_metadata.final_intent_score',
            'scoringMetrics.intent_score.analysis_metadata.overall_confidence',
            'scoringMetrics.intent_score.signal_breakdown',
            'scoringMetrics.intent_score.gtm_intelligence.overall_buying_readiness',
            'scoringMetrics.intent_score.gtm_intelligence.timing_recommendation',
            'scoringMetrics.intent_score.gtm_intelligence.messaging_strategy',
            'scoringMetrics.intent_score.offer_alignment_playbook'
          ]
        },
        { name: 'embedding', type: 'Number', isArray: true, isRequired: false },
        { name: 'searchKeywords', type: 'String', isArray: true, isRequired: false },
        { name: 'semanticSummary', type: 'String', isArray: false, isRequired: false },
      ],
      relationships: [
        { field: 'sessionId', targetCollection: 'sessions', type: 'many-to-one' },
        { field: 'icpModelId', targetCollection: 'icp_models', type: 'many-to-one' },
        { field: '_id', targetCollection: 'employees', type: 'one-to-many', via: 'companyId' },
        { field: '_id', targetCollection: 'enrichments', type: 'one-to-many', via: 'companyId' },
        { field: '_id', targetCollection: 'gtm_intelligence', type: 'one-to-one', via: 'companyId' },
        { field: '_id', targetCollection: 'gtm_persona_intelligence', type: 'one-to-many', via: 'companyId' },
      ],
      indexes: ['name', 'domain', 'industry', 'sessionId', 'icpModelId', 'userId'],
      embeddingField: 'embedding',
      // FIX: Add all text searchable fields from your Mongoose schema
      searchableFields: ['name', 'domain', 'description', 'industry', 'technologies', 'searchKeywords'],
    });

    // Employee Schema - FIXED with correct searchable fields
    this.schemas.set('employees', {
      name: 'employees',
      fields: [
        { name: '_id', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'companyId', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'userId', type: 'String', isArray: false, isRequired: true },
        { name: 'coresignalEmployeeId', type: 'Number', isArray: false, isRequired: true },
        { name: 'fullName', type: 'String', isArray: false, isRequired: true },
        { name: 'firstName', type: 'String', isArray: false, isRequired: true },
        { name: 'lastName', type: 'String', isArray: false, isRequired: true },
        { name: 'headline', type: 'String', isArray: false, isRequired: false },
        { name: 'summary', type: 'String', isArray: false, isRequired: false },
        { name: 'isDecisionMaker', type: 'Boolean', isArray: false, isRequired: false },
        { name: 'isWorking', type: 'Boolean', isArray: false, isRequired: false },
        { name: 'activeExperienceTitle', type: 'String', isArray: false, isRequired: false },
        { name: 'activeExperienceDepartment', type: 'String', isArray: false, isRequired: false },
        { name: 'locationCountry', type: 'String', isArray: false, isRequired: false },
        { name: 'locationCity', type: 'String', isArray: false, isRequired: false },
        { name: 'primaryProfessionalEmail', type: 'String', isArray: false, isRequired: false },
        { name: 'inferredSkills', type: 'String', isArray: true, isRequired: false },
        { name: 'totalExperienceDurationMonths', type: 'Number', isArray: false, isRequired: false },
        { name: 'connectionsCount', type: 'Number', isArray: false, isRequired: false },
        { name: 'followersCount', type: 'Number', isArray: false, isRequired: false },
        { name: 'embedding', type: 'Number', isArray: true, isRequired: false },
        { name: 'searchKeywords', type: 'String', isArray: true, isRequired: false },
      ],
      relationships: [
        { field: 'companyId', targetCollection: 'companies', type: 'many-to-one' },
        { field: '_id', targetCollection: 'gtm_persona_intelligence', type: 'one-to-one', via: 'employeeId' },
      ],
      indexes: ['companyId', 'fullName', 'isDecisionMaker', 'userId', 'coresignalEmployeeId'],
      embeddingField: 'embedding',
      // FIX: Add all text searchable fields
      searchableFields: ['fullName', 'headline', 'summary', 'activeExperienceTitle', 'searchKeywords', 'inferredSkills'],
    });

    // Enrichment Schema - FIXED
    this.schemas.set('enrichments', {
      name: 'enrichments',
      fields: [
        { name: '_id', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'companyId', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'sessionId', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'userId', type: 'String', isArray: false, isRequired: true },
        { name: 'icpModelId', type: 'ObjectId', isArray: false, isRequired: false },
        { name: 'data', type: 'Mixed', isArray: false, isRequired: true },
        { name: 'source', type: 'String', isArray: false, isRequired: true },
        { name: 'embedding', type: 'Number', isArray: true, isRequired: false },
        { name: 'searchKeywords', type: 'String', isArray: true, isRequired: false },
      ],
      relationships: [
        { field: 'companyId', targetCollection: 'companies', type: 'many-to-one' },
        { field: 'sessionId', targetCollection: 'sessions', type: 'many-to-one' },
        { field: 'icpModelId', targetCollection: 'icp_models', type: 'many-to-one' },
      ],
      indexes: ['companyId', 'sessionId', 'source', 'userId'],
      embeddingField: 'embedding',
      searchableFields: ['source', 'searchKeywords'],
    });

    // GTM Intelligence Schema - FIXED
    this.schemas.set('gtm_intelligence', {
      name: 'gtm_intelligence',
      fields: [
        { name: '_id', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'companyId', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'sessionId', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'icpModelId', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'userId', type: 'String', isArray: false, isRequired: true },
        { name: 'overview', type: 'String', isArray: false, isRequired: true },
        { name: 'embedding', type: 'Number', isArray: true, isRequired: false },
        { name: 'searchKeywords', type: 'String', isArray: true, isRequired: false },
      ],
      relationships: [
        { field: 'companyId', targetCollection: 'companies', type: 'one-to-one' },
        { field: 'sessionId', targetCollection: 'sessions', type: 'many-to-one' },
        { field: 'icpModelId', targetCollection: 'icp_models', type: 'many-to-one' },
      ],
      indexes: ['companyId', 'sessionId', 'icpModelId', 'userId'],
      embeddingField: 'embedding',
      searchableFields: ['overview', 'searchKeywords'],
    });

    // GTM Persona Intelligence Schema - FIXED
    this.schemas.set('gtm_persona_intelligence', {
      name: 'gtm_persona_intelligence',
      fields: [
        { name: '_id', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'companyId', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'employeeId', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'sessionId', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'icpModelId', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'userId', type: 'String', isArray: false, isRequired: true },
        { name: 'overview', type: 'String', isArray: false, isRequired: true },
        { name: 'embedding', type: 'Number', isArray: true, isRequired: false },
        { name: 'searchKeywords', type: 'String', isArray: true, isRequired: false },
      ],
      relationships: [
        { field: 'employeeId', targetCollection: 'employees', type: 'one-to-one' },
        { field: 'companyId', targetCollection: 'companies', type: 'many-to-one' },
        { field: 'sessionId', targetCollection: 'sessions', type: 'many-to-one' },
        { field: 'icpModelId', targetCollection: 'icp_models', type: 'many-to-one' },
      ],
      indexes: ['employeeId', 'companyId', 'sessionId', 'icpModelId', 'userId'],
      embeddingField: 'embedding',
      searchableFields: ['overview', 'searchKeywords'],
    });

    // ICP Models Schema - FIXED
    this.schemas.set('icp_models', {
      name: 'icp_models',
      fields: [
        { name: '_id', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'name', type: 'String', isArray: false, isRequired: true },
        { name: 'isPrimary', type: 'Boolean', isArray: false, isRequired: false },
        { name: 'userId', type: 'String', isArray: false, isRequired: true },
        { name: 'config', type: 'Mixed', isArray: false, isRequired: true },
      ],
      relationships: [
        { field: '_id', targetCollection: 'companies', type: 'one-to-many', via: 'icpModelId' },
        { field: '_id', targetCollection: 'sessions', type: 'one-to-many', via: 'icpModelId' },
        { field: '_id', targetCollection: 'enrichments', type: 'one-to-many', via: 'icpModelId' },
        { field: '_id', targetCollection: 'gtm_intelligence', type: 'one-to-many', via: 'icpModelId' },
        { field: '_id', targetCollection: 'gtm_persona_intelligence', type: 'one-to-many', via: 'icpModelId' },
      ],
      indexes: ['userId', 'isPrimary'],
      searchableFields: ['name'],
    });

    // Sessions Schema - FIXED
    this.schemas.set('sessions', {
      name: 'sessions',
      fields: [
        { name: '_id', type: 'ObjectId', isArray: false, isRequired: true },
        { name: 'name', type: 'String', isArray: false, isRequired: true },
        { name: 'query', type: 'String', isArray: true, isRequired: false },
        { name: 'userId', type: 'String', isArray: false, isRequired: true },
        { name: 'icpModelId', type: 'ObjectId', isArray: false, isRequired: false },
        { name: 'resultsCount', type: 'Number', isArray: false, isRequired: false },
      ],
      relationships: [
        { field: '_id', targetCollection: 'companies', type: 'one-to-many', via: 'sessionId' },
        { field: '_id', targetCollection: 'enrichments', type: 'one-to-many', via: 'sessionId' },
        { field: '_id', targetCollection: 'gtm_intelligence', type: 'one-to-many', via: 'sessionId' },
        { field: '_id', targetCollection: 'gtm_persona_intelligence', type: 'one-to-many', via: 'sessionId' },
        { field: 'icpModelId', targetCollection: 'icp_models', type: 'many-to-one' },
      ],
      indexes: ['userId', 'icpModelId', 'createdAt'],
      searchableFields: ['name', 'query'],
    });

    logger.info(`Schema service initialized with ${this.schemas.size} collections`);
  }

  getSchema(collectionName: string): CollectionSchema | undefined {
    return this.schemas.get(collectionName);
  }

  getAllSchemas(): CollectionSchema[] {
    return Array.from(this.schemas.values());
  }

  findHoppingPath(from: string, to: string): HoppingPath | null {
    const fromSchema = this.schemas.get(from);
    const toSchema = this.schemas.get(to);

    if (!fromSchema || !toSchema) {
      return null;
    }

    const directPath = fromSchema.relationships.find(
      rel => rel.targetCollection === to
    );

    if (directPath) {
      // Map relationship type to HoppingPath cardinality
      let cardinality: 'one-to-one' | 'one-to-many' | 'many-to-many';
      if (directPath.type === 'many-to-one') {
        cardinality = 'one-to-many'; // Reverse the direction
      } else {
        cardinality = directPath.type as 'one-to-one' | 'one-to-many' | 'many-to-many';
      }
      
      return {
        from,
        to,
        via: directPath.via || directPath.field,
        cardinality,
      };
    }

    const reversePath = toSchema.relationships.find(
      rel => rel.targetCollection === from
    );

    if (reversePath) {
      // Map relationship type to HoppingPath cardinality
      let cardinality: 'one-to-one' | 'one-to-many' | 'many-to-many';
      if (reversePath.type === 'many-to-one') {
        cardinality = 'one-to-many'; // Reverse the direction
      } else {
        cardinality = reversePath.type as 'one-to-one' | 'one-to-many' | 'many-to-many';
      }
      
      return {
        from: to,
        to: from,
        via: reversePath.via || reversePath.field,
        cardinality,
      };
    }

    return null;
  }

  getSearchableFields(collectionName: string): string[] {
    const schema = this.schemas.get(collectionName);
    return schema?.searchableFields || [];
  }

  hasEmbedding(collectionName: string): boolean {
    const schema = this.schemas.get(collectionName);
    return !!schema?.embeddingField;
  }

  getRelatedCollections(collectionName: string): string[] {
    const schema = this.schemas.get(collectionName);
    if (!schema) return [];

    return schema.relationships.map(rel => rel.targetCollection);
  }
}

export const schemaService = new SchemaService();