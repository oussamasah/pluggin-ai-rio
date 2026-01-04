import { Types } from 'mongoose';

export interface UserContext {
  userId: string;
  sessionId?: string;
  preferences?: Record<string, any>;
}

export interface QueryIntent {
  type: 'search' | 'analyze' | 'recommend' | 'execute' | 'hybrid';
  confidence: number;
  entities: DetectedEntity[];
  actions: string[];
  requiresHopping: boolean;
  collections: string[];
  aggregation?: {
    operation?: string;
    field?: string;
    groupBy?: string;
    pipeline?: any[];
  };
}

export interface DetectedEntity {
  type: 'company' | 'employee' | 'icp_model' | 'session' | 'custom';
  value: string;
  field?: string;
  collectionHint?: string;
  confidence: number;
  source?: 'ner' | 'regex' | 'fuzzy' | 'semantic';
  queryValue?: any;
}

export interface RetrievalPlan {
  steps: RetrievalStep[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  requiresCritic: boolean;
}

export interface RetrievalStep {
  stepId: string;
  action: 'fetch' | 'hop' | 'filter' | 'aggregate';
  collection: string;
  query: Record<string, any>;
  limit?: number;
  sort?: Record<string, any>;
  dependencies?: string[];
  hoppingPath?: HoppingPath;
  aggregation?: {
    operation?: string;
    pipeline?: any[];
  };
  producesOutputFor?: string;
}

export interface HoppingPath {
  from: string;
  to: string;
  via: string;
  cardinality: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

export interface RetrievedData {
  collection: string;
  documents: any[];
  limit?: number;
  sort?: Record<string, any>;
  includeRelated?: boolean;
  metadata: {
    count: number;
    searchMethod: 'vector' | 'metadata' | 'hybrid' | 'text';
    confidence: number;
  };
}

export interface CriticResult {
  isValid: boolean;
  issues: string[];
  corrections?: string[];
  confidence: number;
}

export interface ActionRequest {
  tool: string;
  action: string;
  parameters: Record<string, any>;
  requiresConfirmation: boolean;
}

export interface ActionResult {
  success: boolean;
  result?: any;
  error?: string;
  metadata?: Record<string, any>;
}