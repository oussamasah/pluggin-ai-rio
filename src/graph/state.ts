import { Annotation } from '@langchain/langgraph';
import { 
  QueryIntent, 
  RetrievalPlan, 
  RetrievedData, 
  CriticResult,
  ActionRequest,
  ActionResult 
} from '../types';
import { MemoryContext } from '../types/graph';
import { EnhancedQuery } from '../services/QueryEnhancerService';

export const GraphStateAnnotation = Annotation.Root({
  query: Annotation<string>,
  userId: Annotation<string>,
  sessionId: Annotation<string | undefined>,
  originalQuery: Annotation<string>,
  enhancedQuery: Annotation<EnhancedQuery>,
  memory: Annotation<MemoryContext>,
  intent: Annotation<QueryIntent | null>,
  plan: Annotation<RetrievalPlan | null>,
  
  retrievedData: Annotation<RetrievedData[]>,
  flattenedData: Annotation<Record<string, any>[]>,
  previousResults: Annotation<Array<{
    query: string;
    timestamp: Date;
    retrievedData: RetrievedData[];
    flattenedData: Record<string, any>[];
    analysis?: string;
    finalAnswer?: string; // OPTIMIZATION: Store final answer for conversation history and rewrite queries
    summary: { companies: number; employees: number; other: number };
  }>>,
  lastViewedCompanyIds: Annotation<string[]>,
  lastViewedEmployeeIds: Annotation<string[]>,
  lastViewedIcpModelIds: Annotation<string[]>,
  
  analysis: Annotation<string | null>,
  criticResult: Annotation<CriticResult | null>,
  
  pendingActions: Annotation<ActionRequest[]>,
  executedActions: Annotation<ActionResult[]>,
  
  finalAnswer: Annotation<string | null>,
  confidence: Annotation<number>,
  
  currentNode: Annotation<string>,
  errors: Annotation<string[]>,
  requiresUserInput: Annotation<boolean>,
  userInputPrompt: Annotation<string | undefined>,
  
  startTime: Annotation<number>,
  iterations: Annotation<number>,
  maxIterations: Annotation<number>,
  
  // Progress tracking
  progress: Annotation<{
    currentNode: string;
    completedNodes: string[];
    progressPercentage: number;
    estimatedTimeRemaining?: number;
    lastUpdate: number;
  }>,
  
  // Timeout tracking
  nodeStartTimes: Annotation<Record<string, number>>,
});

export type GraphState = typeof GraphStateAnnotation.State;
export interface DetectedEntity {
    type: 'company' | 'employee' | 'location' | 'product' | 'industry';
    value: string;
    field: string;
    collectionHint: string;
    confidence: number;
    source?: 'ner' | 'regex' | 'fuzzy';
    queryValue?: any; // For complex query values like { $regex: ..., $options: 'i' }
    fuzzyMatches?: string[]; // For fuzzy matching suggestions
  }

export const COLLECTION_FIELDS: Record<string, Record<string, {
    description: string;
    importance: 'high' | 'medium' | 'low';
    type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'date' | 'ObjectId' | 'mixed';
    subType?: string;
    filterable: boolean;
    sortable: boolean;
    operators: string[];
    queryExamples?: string[];
  }>> = {
    companies: {
      _id: { 
        description: 'Unique MongoDB identifier for the company record', 
        importance: 'high',
        type: 'ObjectId',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$in'],
        queryExamples: ['{"_id": "6942ac0e5917cb4e472a48f7"}']
      },
      sessionId: { 
        description: 'Reference to the session that generated this company record', 
        importance: 'high',
        type: 'ObjectId',
        filterable: true,
        sortable: false,
        operators: ['$eq'],
        queryExamples: ['{"sessionId": "6942ab835917cb4e472a4853"}']
      },
      icpModelId: { 
        description: 'Reference to the Ideal Customer Profile model used for this company', 
        importance: 'high',
        type: 'ObjectId',
        filterable: true,
        sortable: false,
        operators: ['$eq'],
        queryExamples: ['{"icpModelId": "693320e235a14f258abc0f2f"}']
      },
      name: { 
        description: 'Company name. Supports $regex for partial matching', 
        importance: 'high',
        type: 'string',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$regex', '$in', '$ne'],
        queryExamples: [
          '{"name": {"$regex": "BizBuzz", "$options": "i"}}',
          '{"name": {"$in": ["Company A", "Company B"]}}'
        ]
      },
      domain: { 
        description: 'Primary domain name of the company', 
        importance: 'medium',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: ['{"domain": {"$regex": "bizbuzz", "$options": "i"}}']
      },
      website: { 
        description: 'Main website URL for the company', 
        importance: 'medium',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: ['{"website": {"$regex": "marketing", "$options": "i"}}']
      },
      logoUrl: { 
        description: 'URL to the company logo image', 
        importance: 'low',
        type: 'string',
        filterable: false,
        sortable: false,
        operators: [],
        queryExamples: []
      },
      description: { 
        description: 'Company description and overview', 
        importance: 'medium',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$regex'],
        queryExamples: ['{"description": {"$regex": "marketing", "$options": "i"}}']
      },
      foundedYear: { 
        description: 'Year the company was founded', 
        importance: 'low',
        type: 'number',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$gt', '$lt', '$gte', '$lte', '$ne'],
        queryExamples: [
          '{"foundedYear": {"$gte": 2000}}',
          '{"foundedYear": {"$lt": 2020}}'
        ]
      },
      city: { 
        description: 'City where the company is headquartered', 
        importance: 'low',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: ['{"city": "Itasca"}']
      },
      country: { 
        description: 'Country where the company is headquartered', 
        importance: 'medium',
        type: 'string',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$regex', '$in', '$ne'],
        queryExamples: [
          '{"country": {"$regex": "United States", "$options": "i"}}',
          '{"country": {"$in": ["United States", "Canada"]}}'
        ]
      },
      countryCode: { 
        description: 'ISO country code for headquarters location', 
        importance: 'low',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$ne'],
        queryExamples: ['{"countryCode": "US"}']
      },
      contactEmail: { 
        description: 'Primary contact email address for the company', 
        importance: 'medium',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: ['{"contactEmail": {"$regex": "@company.com", "$options": "i"}}']
      },
      contactPhone: { 
        description: 'Primary contact phone number for the company', 
        importance: 'medium',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: ['{"contactPhone": {"$regex": "630", "$options": "i"}}']
      },
      linkedinUrl: { 
        description: 'LinkedIn company profile URL', 
        importance: 'medium',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: ['{"linkedinUrl": {"$regex": "linkedin", "$options": "i"}}']
      },
      industry: { 
        description: 'List of industries the company operates in', 
        importance: 'high',
        type: 'array',
        subType: 'string',
        filterable: true,
        sortable: false,
        operators: ['$in', '$all', '$elemMatch', '$ne'],
        queryExamples: [
          '{"industry": {"$in": ["Advertising Services", "Marketing"]}}',
          '{"industry": "Advertising Services"}'
        ]
      },
      targetMarket: { 
        description: 'Primary target market or customer segment', 
        importance: 'medium',
        type: 'string',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$ne'],
        queryExamples: ['{"targetMarket": "SMB"}']
      },
      ownershipType: { 
        description: 'Type of company ownership (public, private, etc.)', 
        importance: 'low',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$ne'],
        queryExamples: ['{"ownershipType": "Private"}']
      },
      employeeCount: { 
        description: 'Estimated number of employees', 
        importance: 'high',
        type: 'number',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$gt', '$lt', '$gte', '$lte', '$ne'],
        queryExamples: [
          '{"employeeCount": {"$gt": 100}}',
          '{"employeeCount": {"$lt": 50}}',
          '{"employeeCount": {"$gte": 10, "$lte": 500}}'
        ]
      },
      annualRevenue: { 
        description: 'Estimated annual revenue in dollars', 
        importance: 'high',
        type: 'number',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$gt', '$lt', '$gte', '$lte', '$ne'],
        queryExamples: [
          '{"annualRevenue": {"$gt": 10000000}}',
          '{"annualRevenue": {"$gte": 5000000, "$lte": 50000000}}'
        ]
      },
      annualRevenueCurrency: { 
        description: 'Currency code for annual revenue amounts', 
        importance: 'medium',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$ne'],
        queryExamples: ['{"annualRevenueCurrency": "USD"}']
      },
      fundingStage: { 
        description: 'Current funding stage (seed, Series A, etc.)', 
        importance: 'medium',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$ne'],
        queryExamples: ['{"fundingStage": "Bootstrapped"}']
      },
      technologies: { 
        description: 'List of technologies used by the company', 
        importance: 'medium',
        type: 'array',
        subType: 'string',
        filterable: true,
        sortable: false,
        operators: ['$in', '$all', '$elemMatch', '$ne'],
        queryExamples: ['{"technologies": {"$in": ["React", "Node.js"]}}']
      },
      intentSignals: { 
        description: 'Intent signals indicating purchase or interest behavior', 
        importance: 'medium',
        type: 'object',
        filterable: false,
        sortable: false,
        operators: [],
        queryExamples: []
      },
      relationships: { 
        description: 'Relationships with other companies and entities', 
        importance: 'low',
        type: 'object',
        filterable: true,
        sortable: false,
        operators: ['$elemMatch'],
        queryExamples: ['{"relationships.competitors": {"$elemMatch": {"name": "Competitor A"}}}']
      },
      scoringMetrics: { 
        description: 'Performance metrics including fit_score', 
        importance: 'medium',
        type: 'object',
        filterable: true,
        sortable: true,
        operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
        queryExamples: [
          '{"scoringMetrics.fit_score.score": {"$gt": 50}}',
          '{"scoringMetrics.fit_score.score": {"$gte": 30, "$lte": 80}}',
          '{"sort": {"scoringMetrics.fit_score.score": -1}}'
        ]
      },
      userId: { 
        description: 'User ID who owns this company record - REQUIRED for all queries', 
        importance: 'high',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq'],
        queryExamples: ['{"userId": "user_36R91I8f4mbC6LcymVuQZfGNMft"}']
      },
      createdAt: { 
        description: 'Timestamp when this company record was created', 
        importance: 'low',
        type: 'date',
        filterable: true,
        sortable: true,
        operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
        queryExamples: [
          '{"createdAt": {"$gt": "2024-01-01T00:00:00.000Z"}}',
          '{"createdAt": {"$lt": "2024-12-31T23:59:59.999Z"}}'
        ]
      },
      updatedAt: { 
        description: 'Timestamp when this company record was last updated', 
        importance: 'low',
        type: 'date',
        filterable: true,
        sortable: true,
        operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
        queryExamples: ['{"updatedAt": {"$gt": "2024-06-01T00:00:00.000Z"}}']
      },
    },
    employees: {
      _id: { 
        description: 'Unique MongoDB identifier for the employee record', 
        importance: 'high',
        type: 'ObjectId',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$in'],
        queryExamples: ['{"_id": "6942ae8db8fd009253679d7f"}']
      },
      companyId: { 
        description: 'Reference to the parent company for this employee', 
        importance: 'high',
        type: 'ObjectId',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$in'],
        queryExamples: [
          '{"companyId": "6942ae8db8fd009253679d78"}',
          '{"companyId": {"$in": ["id1", "id2", "id3"]}}'
        ]
      },
      userId: { 
        description: 'User ID who owns this employee record - REQUIRED for all queries', 
        importance: 'high',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq'],
        queryExamples: ['{"userId": "user_36R91I8f4mbC6LcymVuQZfGNMft"}']
      },
      coresignalEmployeeId: { 
        description: 'Unique employee identifier from CoreSignal data source', 
        importance: 'high',
        type: 'number',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$gt', '$lt', '$ne'],
        queryExamples: ['{"coresignalEmployeeId": 546738}']
      },
      isDeleted: { 
        description: 'Flag indicating if employee profile is deleted in source system', 
        importance: 'medium',
        type: 'boolean',
        filterable: true,
        sortable: false,
        operators: ['$eq'],
        queryExamples: ['{"isDeleted": false}']
      },
      isParent: { 
        description: 'Flag indicating if this is a parent/primary profile', 
        importance: 'low',
        type: 'boolean',
        filterable: true,
        sortable: false,
        operators: ['$eq'],
        queryExamples: ['{"isParent": false}']
      },
      linkedinUrl: { 
        description: 'LinkedIn profile URL for the employee', 
        importance: 'high',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: ['{"linkedinUrl": {"$regex": "linkedin.com/in", "$options": "i"}}']
      },
      fullName: { 
        description: 'Full name of the employee', 
        importance: 'high',
        type: 'string',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$regex', '$in', '$ne'],
        queryExamples: [
          '{"fullName": {"$regex": "Vipin", "$options": "i"}}',
          '{"fullName": "Vipin Jain"}'
        ]
      },
      firstName: { 
        description: 'First name', 
        importance: 'high',
        type: 'string',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: ['{"firstName": {"$regex": "Vipin", "$options": "i"}}']
      },
      lastName: { 
        description: 'Last name', 
        importance: 'high',
        type: 'string',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: ['{"lastName": {"$regex": "Jain", "$options": "i"}}']
      },
      headline: { 
        description: 'Professional headline or current job title', 
        importance: 'medium',
        type: 'string',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$regex', '$in', '$ne'],
        queryExamples: [
          '{"headline": {"$regex": "CEO", "$options": "i"}}',
          '{"headline": {"$in": ["CEO", "CTO", "CFO"]}}'
        ]
      },
      summary: { 
        description: 'Professional summary or bio', 
        importance: 'medium',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$regex', '$ne'],
        queryExamples: ['{"summary": {"$regex": "marketing", "$options": "i"}}']
      },
      locationCountry: { 
        description: 'Country of residence', 
        importance: 'low',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: ['{"locationCountry": "United States"}']
      },
      locationCity: { 
        description: 'City of residence', 
        importance: 'low',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: ['{"locationCity": "New York"}']
      },
      connectionsCount: { 
        description: 'Number of LinkedIn connections', 
        importance: 'medium',
        type: 'number',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$gt', '$lt', '$gte', '$lte', '$ne'],
        queryExamples: [
          '{"connectionsCount": {"$gt": 100}}',
          '{"connectionsCount": {"$gte": 500}}'
        ]
      },
      followersCount: { 
        description: 'Number of followers on LinkedIn', 
        importance: 'medium',
        type: 'number',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$gt', '$lt', '$gte', '$lte', '$ne'],
        queryExamples: ['{"followersCount": {"$gt": 500}}']
      },
      isWorking: { 
        description: 'Flag indicating if currently employed', 
        importance: 'medium',
        type: 'boolean',
        filterable: true,
        sortable: false,
        operators: ['$eq'],
        queryExamples: ['{"isWorking": true}']
      },
      activeExperienceTitle: { 
        description: 'Current job title/position', 
        importance: 'high',
        type: 'string',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$regex', '$in', '$ne'],
        queryExamples: [
          '{"activeExperienceTitle": {"$regex": "CEO", "$options": "i"}}',
          '{"activeExperienceTitle": {"$in": ["CEO", "CTO", "Director"]}}'
        ]
      },
      activeExperienceDepartment: { 
        description: 'Department for current role', 
        importance: 'low',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: ['{"activeExperienceDepartment": "C-Suite"}']
      },
      isDecisionMaker: { 
        description: 'Flag indicating decision-making authority - MUST use boolean true/false', 
        importance: 'high',
        type: 'boolean',
        filterable: true,
        sortable: false,
        operators: ['$eq'],
        queryExamples: [
          '{"isDecisionMaker": true}',  // ✓ CORRECT: Boolean
          '{"isDecisionMaker": "decision makers"}'  // ✗ WRONG: String
        ]
      },
      inferredSkills: { 
        description: 'Skills inferred from profile and experience', 
        importance: 'medium',
        type: 'array',
        subType: 'string',
        filterable: true,
        sortable: false,
        operators: ['$in', '$all', '$elemMatch', '$ne'],
        queryExamples: [
          '{"inferredSkills": {"$in": ["marketing", "management"]}}',
          '{"inferredSkills": {"$all": ["project management", "leadership"]}}'
        ]
      },
      totalExperienceDurationMonths: { 
        description: 'Total months of professional experience', 
        importance: 'medium',
        type: 'number',
        filterable: true,
        sortable: true,
        operators: ['$eq', '$gt', '$lt', '$gte', '$lte', '$ne'],
        queryExamples: [
          '{"totalExperienceDurationMonths": {"$gt": 60}}', // 5+ years
          '{"totalExperienceDurationMonths": {"$gte": 120}}' // 10+ years
        ]
      },
      primaryProfessionalEmail: { 
        description: 'Primary professional email address', 
        importance: 'medium',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: [
          '{"primaryProfessionalEmail": "vipin@konstantinfo.com"}',
          '{"primaryProfessionalEmail": {"$regex": "@konstantinfo.com", "$options": "i"}}'
        ]
      },
      githubUrl: { 
        description: 'GitHub profile URL', 
        importance: 'low',
        type: 'string',
        filterable: true,
        sortable: false,
        operators: ['$eq', '$regex', '$ne'],
        queryExamples: ['{"githubUrl": {"$regex": "github.com", "$options": "i"}}']
      },
      createdAt: { 
        description: 'Timestamp when this employee record was created', 
        importance: 'low',
        type: 'date',
        filterable: true,
        sortable: true,
        operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
        queryExamples: ['{"createdAt": {"$gt": "2024-01-01T00:00:00.000Z"}}']
      },
      updatedAt: { 
        description: 'Timestamp when this employee record was last updated', 
        importance: 'low',
        type: 'date',
        filterable: true,
        sortable: true,
        operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
        queryExamples: ['{"updatedAt": {"$gt": "2024-06-01T00:00:00.000Z"}}']
      },
    },
    enrichments: {
        _id: { 
          description: 'Unique MongoDB identifier for the enrichment record', 
          importance: 'high',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq', '$in'],
          queryExamples: ['{"_id": "6942ae8db8fd009253679d78"}']
        },
        companyId: { 
          description: 'Reference to the company being enriched', 
          importance: 'high',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq', '$in'],
          queryExamples: [
            '{"companyId": "6942ae8db8fd009253679d78"}',
            '{"companyId": {"$in": ["id1", "id2"]}}'
          ]
        },
        sessionId: { 
          description: 'Reference to the session that generated this enrichment', 
          importance: 'medium',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"sessionId": "6942ab835917cb4e472a4853"}']
        },
        icpModelId: { 
          description: 'Reference to the ICP model used for enrichment', 
          importance: 'medium',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"icpModelId": "693320e235a14f258abc0f2f"}']
        },
        data: { 
          description: 'Enrichment data payload containing detailed company information', 
          importance: 'high',
          type: 'object',
          filterable: false,
          sortable: false,
          operators: [],
          queryExamples: []
        },
        source: { 
          description: 'Source system or API that provided the enrichment data', 
          importance: 'high',
          type: 'string',
          filterable: true,
          sortable: false,
          operators: ['$eq', '$in', '$regex', '$ne'],
          queryExamples: [
            '{"source": "Crunchbase"}',
            '{"source": {"$in": ["Clearbit", "Zoominfo"]}}'
          ]
        },
        userId: { 
          description: 'User ID who owns this enrichment record - REQUIRED for all queries', 
          importance: 'high',
          type: 'string',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"userId": "user_36R91I8f4mbC6LcymVuQZfGNMft"}']
        },
        createdAt: { 
          description: 'Timestamp when this enrichment record was created', 
          importance: 'low',
          type: 'date',
          filterable: true,
          sortable: true,
          operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
          queryExamples: ['{"createdAt": {"$gt": "2024-01-01T00:00:00.000Z"}}']
        },
        updatedAt: { 
          description: 'Timestamp when this enrichment record was last updated', 
          importance: 'low',
          type: 'date',
          filterable: true,
          sortable: true,
          operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
          queryExamples: ['{"updatedAt": {"$gt": "2024-06-01T00:00:00.000Z"}}']
        },
      },
      
      gtm_intelligence: {
        _id: { 
          description: 'Unique MongoDB identifier for the GTM intelligence record', 
          importance: 'high',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq', '$in'],
          queryExamples: ['{"_id": "6942ae8db8fd009253679d78"}']
        },
        sessionId: { 
          description: 'Reference to the session that generated this analysis', 
          importance: 'medium',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"sessionId": "6942ab835917cb4e472a4853"}']
        },
        icpModelId: { 
          description: 'Reference to the ICP model used for analysis', 
          importance: 'medium',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"icpModelId": "693320e235a14f258abc0f2f"}']
        },
        companyId: { 
          description: 'Reference to the analyzed company', 
          importance: 'high',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq', '$in'],
          queryExamples: [
            '{"companyId": "6942ae8db8fd009253679d78"}',
            '{"companyId": {"$in": ["id1", "id2"]}}'
          ]
        },
        overview: { 
          description: 'Comprehensive Go-To-Market strategy analysis and recommendations', 
          importance: 'high',
          type: 'string',
          filterable: true,
          sortable: false,
          operators: ['$regex'],
          queryExamples: ['{"overview": {"$regex": "market strategy", "$options": "i"}}']
        },
        userId: { 
          description: 'User ID who owns this GTM intelligence record - REQUIRED for all queries', 
          importance: 'high',
          type: 'string',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"userId": "user_36R91I8f4mbC6LcymVuQZfGNMft"}']
        },
        createdAt: { 
          description: 'Timestamp when this GTM intelligence record was created', 
          importance: 'low',
          type: 'date',
          filterable: true,
          sortable: true,
          operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
          queryExamples: ['{"createdAt": {"$gt": "2024-01-01T00:00:00.000Z"}}']
        },
        updatedAt: { 
          description: 'Timestamp when this GTM intelligence record was last updated', 
          importance: 'low',
          type: 'date',
          filterable: true,
          sortable: true,
          operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
          queryExamples: ['{"updatedAt": {"$gt": "2024-06-01T00:00:00.000Z"}}']
        },
      },
      
      gtm_persona_intelligence: {
        _id: { 
          description: 'Unique MongoDB identifier for the persona intelligence record', 
          importance: 'high',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq', '$in'],
          queryExamples: ['{"_id": "6942ae8db8fd009253679d78"}']
        },
        sessionId: { 
          description: 'Reference to the session that generated this analysis', 
          importance: 'medium',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"sessionId": "6942ab835917cb4e472a4853"}']
        },
        icpModelId: { 
          description: 'Reference to the ICP model used for analysis', 
          importance: 'medium',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"icpModelId": "693320e235a14f258abc0f2f"}']
        },
        companyId: { 
          description: 'Reference to the parent company', 
          importance: 'high',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq', '$in'],
          queryExamples: [
            '{"companyId": "6942ae8db8fd009253679d78"}',
            '{"companyId": {"$in": ["id1", "id2"]}}'
          ]
        },
        employeeId: { 
          description: 'Reference to the analyzed employee/persona', 
          importance: 'high',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq', '$in'],
          queryExamples: [
            '{"employeeId": "6942ae8db8fd009253679d7f"}',
            '{"employeeId": {"$in": ["id1", "id2"]}}'
          ]
        },
        overview: { 
          description: 'Persona-specific Go-To-Market strategy and engagement recommendations', 
          importance: 'high',
          type: 'string',
          filterable: true,
          sortable: false,
          operators: ['$regex'],
          queryExamples: ['{"overview": {"$regex": "engagement strategy", "$options": "i"}}']
        },
        userId: { 
          description: 'User ID who owns this persona intelligence record - REQUIRED for all queries', 
          importance: 'high',
          type: 'string',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"userId": "user_36R91I8f4mbC6LcymVuQZfGNMft"}']
        },
        createdAt: { 
          description: 'Timestamp when this persona intelligence record was created', 
          importance: 'low',
          type: 'date',
          filterable: true,
          sortable: true,
          operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
          queryExamples: ['{"createdAt": {"$gt": "2024-01-01T00:00:00.000Z"}}']
        },
        updatedAt: { 
          description: 'Timestamp when this persona intelligence record was last updated', 
          importance: 'low',
          type: 'date',
          filterable: true,
          sortable: true,
          operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
          queryExamples: ['{"updatedAt": {"$gt": "2024-06-01T00:00:00.000Z"}}']
        },
      },
      
      icp_models: {
        _id: { 
          description: 'Unique MongoDB identifier for the ICP model', 
          importance: 'high',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq', '$in'],
          queryExamples: ['{"_id": "693320e235a14f258abc0f2f"}']
        },
        name: { 
          description: 'Name of the Ideal Customer Profile model', 
          importance: 'high',
          type: 'string',
          filterable: true,
          sortable: true,
          operators: ['$eq', '$regex', '$in', '$ne'],
          queryExamples: [
            '{"name": "Enterprise SaaS ICP"}',
            '{"name": {"$regex": "SaaS", "$options": "i"}}'
          ]
        },
        isPrimary: { 
          description: 'Flag indicating if this is the primary/default ICP model for the user', 
          importance: 'medium',
          type: 'boolean',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"isPrimary": true}']
        },
        userId: { 
          description: 'User ID who created and owns this ICP model - REQUIRED for all queries', 
          importance: 'high',
          type: 'string',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"userId": "user_36R91I8f4mbC6LcymVuQZfGNMft"}']
        },
        config: { 
          description: 'Configuration parameters and criteria defining the ICP model', 
          importance: 'high',
          type: 'object',
          filterable: true,
          sortable: false,
          operators: ['$regex', '$elemMatch'],
          queryExamples: [
            '{"config.industry": {"$regex": "Technology", "$options": "i"}}',
            '{"config.minEmployees": {"$gt": 50}}'
          ]
        },
        createdAt: { 
          description: 'Timestamp when this ICP model was created', 
          importance: 'low',
          type: 'date',
          filterable: true,
          sortable: true,
          operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
          queryExamples: ['{"createdAt": {"$gt": "2024-01-01T00:00:00.000Z"}}']
        },
        updatedAt: { 
          description: 'Timestamp when this ICP model was last updated', 
          importance: 'low',
          type: 'date',
          filterable: true,
          sortable: true,
          operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
          queryExamples: ['{"updatedAt": {"$gt": "2024-06-01T00:00:00.000Z"}}']
        },
      },
      
      sessions: {
        _id: { 
          description: 'Unique MongoDB identifier for the search session', 
          importance: 'high',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq', '$in'],
          queryExamples: ['{"_id": "6942ab835917cb4e472a4853"}']
        },
        name: { 
          description: 'Session name for identification and organization', 
          importance: 'high',
          type: 'string',
          filterable: true,
          sortable: true,
          operators: ['$eq', '$regex', '$in', '$ne'],
          queryExamples: [
            '{"name": "Enterprise Search December"}',
            '{"name": {"$regex": "enterprise", "$options": "i"}}'
          ]
        },
        query: { 
          description: 'Array of search queries used in this session', 
          importance: 'high',
          type: 'array',
          subType: 'string',
          filterable: true,
          sortable: false,
          operators: ['$in', '$elemMatch', '$regex'],
          queryExamples: [
            '{"query": {"$in": ["technology companies"]}}',
            '{"query": {"$elemMatch": {"$regex": "software", "$options": "i"}}}'
          ]
        },
        resultsCount: { 
          description: 'Number of companies found in this session', 
          importance: 'medium',
          type: 'number',
          filterable: true,
          sortable: true,
          operators: ['$eq', '$gt', '$lt', '$gte', '$lte', '$ne'],
          queryExamples: [
            '{"resultsCount": {"$gt": 10}}',
            '{"resultsCount": {"$gte": 5, "$lte": 50}}'
          ]
        },
        userId: { 
          description: 'User ID who created and owns this session - REQUIRED for all queries', 
          importance: 'high',
          type: 'string',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"userId": "user_36R91I8f4mbC6LcymVuQZfGNMft"}']
        },
        icpModelId: { 
          description: 'Reference to the ICP model used for this search session', 
          importance: 'medium',
          type: 'ObjectId',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"icpModelId": "693320e235a14f258abc0f2f"}']
        },
        searchStatus: { 
          description: 'Current status and progress of the search operation', 
          importance: 'medium',
          type: 'object',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: [
            '{"searchStatus.stage": "complete"}',
            '{"searchStatus.progress": {"$gte": 100}}'
          ]
        },
        refinementState: { 
          description: 'State management for query refinement process', 
          importance: 'medium',
          type: 'object',
          filterable: true,
          sortable: false,
          operators: ['$eq'],
          queryExamples: ['{"refinementState.stage": "confirmed"}']
        },
        currentProposal: { 
          description: 'Current query proposal for user review and refinement', 
          importance: 'medium',
          type: 'string',
          filterable: true,
          sortable: false,
          operators: ['$regex'],
          queryExamples: ['{"currentProposal": {"$regex": "technology", "$options": "i"}}']
        },
        createdAt: { 
          description: 'Timestamp when this session was created', 
          importance: 'low',
          type: 'date',
          filterable: true,
          sortable: true,
          operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
          queryExamples: [
            '{"createdAt": {"$gt": "2024-12-01T00:00:00.000Z"}}',
            '{"sort": {"createdAt": -1}}'
          ]
        },
        updatedAt: { 
          description: 'Timestamp when this session was last updated', 
          importance: 'low',
          type: 'date',
          filterable: true,
          sortable: true,
          operators: ['$gt', '$lt', '$gte', '$lte', '$eq', '$ne'],
          queryExamples: ['{"updatedAt": {"$gt": "2024-12-15T00:00:00.000Z"}}']
        },
      }
  };