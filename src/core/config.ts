import dotenv from 'dotenv';

dotenv.config();

export const config = {
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/rio',
    dbName: process.env.MONGODB_DB_NAME || 'rio',
    vectorSearchEnabled: process.env.VECTOR_SEARCH_ENABLED === 'true',
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  },
  mem0: {
    apiKey: process.env.MEM0_API_KEY || '',
    baseUrl: process.env.MEM0_BASE_URL || 'https://api.mem0.ai',
  },
  composio: {
    apiKey: process.env.COMPOSIO_API_KEY || '',
    baseUrl: process.env.COMPOSIO_BASE_URL || 'https://backend.composio.dev/api/v1',
  },
  server: {
    port: parseInt(process.env.PORT || '3002'),
    env: process.env.NODE_ENV || 'development',
  },
  models: {
    planner: process.env.PLANNER_MODEL || 'anthropic/claude-3.5-haiku',
    executor: process.env.EXECUTOR_MODEL || 'anthropic/claude-3.5-haiku',
    critic: process.env.CRITIC_MODEL || 'anthropic/claude-3.5-haiku',
  },
  search: {
    vectorLimit: parseInt(process.env.VECTOR_SEARCH_LIMIT || '20'),
    hybridWeight: parseFloat(process.env.HYBRID_SEARCH_WEIGHT || '0.7'),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
  },
  execution: {
    // Timeout settings (in milliseconds)
    nodeTimeout: parseInt(process.env.NODE_TIMEOUT || '30000'), // 30s per node
    totalTimeout: parseInt(process.env.TOTAL_TIMEOUT || '120000'), // 2min total
    llmTimeout: parseInt(process.env.LLM_TIMEOUT || '60000'), // 60s for LLM calls
    dbTimeout: parseInt(process.env.DB_TIMEOUT || '10000'), // 10s for DB queries
    
    // Progress tracking
    enableProgressTracking: process.env.ENABLE_PROGRESS_TRACKING === 'true',
    progressInterval: parseInt(process.env.PROGRESS_INTERVAL || '5000'), // Log progress every 5s
    
    // Parallel execution
    enableParallelExecution: process.env.ENABLE_PARALLEL_EXECUTION === 'true',
    maxParallelFetches: parseInt(process.env.MAX_PARALLEL_FETCHES || '3'), // Max 3 parallel fetches
  },
};