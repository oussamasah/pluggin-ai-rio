import { ActionRequest, ActionResult, CriticResult, QueryIntent, RetrievalPlan, RetrievedData } from ".";

export interface GraphState {
    // Input
    query: string;
    userId: string;
    sessionId?: string;
    
    // Context
    memory: MemoryContext;
    intent: QueryIntent | null;
    plan: RetrievalPlan | null;
    
    // Data
    retrievedData: RetrievedData[];
    flattenedData: Record<string, any>[];
    
    // Analysis
    analysis: string | null;
    criticResult: CriticResult | null;
    
    // Actions
    pendingActions: ActionRequest[];
    executedActions: ActionResult[];
    
    // Response
    finalAnswer: string | null;
    confidence: number;
    
    // Flow Control
    currentNode: string;
    errors: string[];
    requiresUserInput: boolean;
    userInputPrompt?: string;
    
    // Metadata
    startTime: number;
    iterations: number;
    maxIterations: number;
  }
  
  export interface MemoryContext {
    facts: MemoryFact[];
    entities: Record<string, any>;
    preferences: Record<string, any>;
    conversationHistory: ConversationEntry[];
  }
  
  export interface MemoryFact {
    id: string;
    content: string;
    type: string;
    confidence: number;
    createdAt: Date;
  }
  
  export interface ConversationEntry {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }