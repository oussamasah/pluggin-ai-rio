import axios, { AxiosInstance } from 'axios';
import { config } from '../core/config';
import { logger } from '../core/logger';
import { MemoryContext, MemoryFact } from '../types/graph';

export interface Mem0Memory {
  id: string;
  memory: string;
  hash: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Mem0SearchResult {
  id: string;
  memory: string;
  hash: string;
  metadata?: Record<string, any>;
  score: number;
  created_at: string;
  updated_at: string;
}

export class MemoryService {
  private client: AxiosInstance;
  private cache: Map<string, MemoryContext> = new Map();
  private cacheTTL = 300000; // 5 minutes

  constructor() {
    this.client = axios.create({
      baseURL: config.mem0.baseUrl,
      headers: {
        'Authorization': `Token ${config.mem0.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  async addMemory(
    userId: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      await this.client.post('/v1/memories/', {
        messages: [
          {
            role: 'user',
            content,
          },
        ],
        user_id: userId,
        metadata: metadata || {},
      });

      this.cache.delete(userId);
      logger.debug('Memory added', { userId, content: content.substring(0, 50) });
    } catch (error: any) {
      // Log more details for 400 errors (likely validation/size issues)
      if (error.response?.status === 400) {
        logger.error('Failed to add memory - Bad Request (400)', { 
          userId, 
          error: error.message,
          responseData: error.response?.data,
          metadataKeys: metadata ? Object.keys(metadata) : [],
          metadataSize: metadata ? JSON.stringify(metadata).length : 0,
          contentLength: content.length
        });
      } else {
        logger.error('Failed to add memory', { 
          userId, 
          error: error.message 
        });
      }
      // Don't throw - allow system to continue without Mem0 storage
    }
  }

  async searchMemories(
    userId: string,
    query: string,
    limit: number = 10
  ): Promise<Mem0SearchResult[]> {
    try {
      const response = await this.client.post('/v1/memories/search/', {
        query,
        user_id: userId,
        limit,
      });

      return response.data.results || [];
    } catch (error: any) {
      logger.error('Memory search failed', { 
        userId, 
        query, 
        error: error.message 
      });
      return [];
    }
  }

  async getAllMemories(userId: string): Promise<Mem0Memory[]> {
    try {
      const response = await this.client.get('/v1/memories/', {
        params: { user_id: userId },
      });

      return response.data.results || [];
    } catch (error: any) {
      logger.error('Failed to fetch memories', { 
        userId, 
        error: error.message 
      });
      return [];
    }
  }

  async deleteMemory(memoryId: string): Promise<void> {
    try {
      await this.client.delete(`/v1/memories/${memoryId}/`);
      logger.debug('Memory deleted', { memoryId });
    } catch (error: any) {
      logger.error('Failed to delete memory', { 
        memoryId, 
        error: error.message 
      });
    }
  }

  async buildMemoryContext(
    userId: string,
    query: string
  ): Promise<MemoryContext> {
    const cacheKey = `${userId}:${query}`;
    const cached = this.cache.get(cacheKey);
    
    // Check cache validity (timestamp is stored in the context object)
    if (cached) {
      return cached;
    }

    try {
      // OPTIMIZATION 3: Enhanced memory search with multiple query variations
      const queryVariations = [
        query, // Original query
        query.toLowerCase(), // Lowercase version
        query.split(' ').slice(0, 5).join(' '), // First 5 words
        query.split(' ').slice(-5).join(' '), // Last 5 words
      ].filter((q, idx, arr) => arr.indexOf(q) === idx); // Remove duplicates

      const [searchResults, allMemories] = await Promise.all([
        // Search with best matching query variation
        Promise.all(queryVariations.slice(0, 2).map(q => 
          this.searchMemories(userId, q, 5)
        )).then(results => {
          // Merge and deduplicate results, sort by score
          const merged = results.flat();
          const seen = new Set<string>();
          return merged
            .filter(r => {
              if (seen.has(r.id)) return false;
              seen.add(r.id);
              return true;
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
        }),
        this.getAllMemories(userId),
      ]);

      const facts: MemoryFact[] = searchResults.map(result => ({
        id: result.id,
        content: result.memory,
        type: result.metadata?.type || 'general',
        confidence: result.score,
        createdAt: new Date(result.created_at),
      }));

      const entities: Record<string, any> = {};
      const preferences: Record<string, any> = {};

      // OPTIMIZATION 4: Prioritize recent and high-confidence memories
      const sortedMemories = allMemories.sort((a, b) => {
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        return bTime - aTime; // Most recent first
      });

      sortedMemories.forEach(mem => {
        if (mem.metadata?.entity_type && mem.metadata?.entity_value) {
          entities[mem.metadata.entity_type] = 
            entities[mem.metadata.entity_type] || [];
          entities[mem.metadata.entity_type].push({
            value: mem.metadata.entity_value,
            context: mem.memory,
            timestamp: mem.created_at,
          });
        }

        if (mem.metadata?.preference_key) {
          // Keep most recent preference value
          if (!preferences[mem.metadata.preference_key] || 
              new Date(mem.created_at) > new Date(preferences[mem.metadata.preference_key].timestamp || 0)) {
            preferences[mem.metadata.preference_key] = {
              value: mem.metadata.preference_value,
              timestamp: mem.created_at,
            };
          }
        }
      });

      // OPTIMIZATION 5: Build conversation history from recent memories
      // Enhanced to include both query and answer for full conversation context
      const conversationHistory = sortedMemories
        .filter(mem => mem.metadata?.type === 'session_query' || mem.metadata?.query)
        .slice(0, 10) // Last 10 conversation turns
        .map(mem => {
          const query = mem.metadata?.query || mem.memory.substring(0, 200);
          const answer = mem.metadata?.answerSummary || mem.metadata?.analysisSummary;
          
          // Build conversation turn with both query and answer
          const turn: any = {
            role: 'user' as const,
            content: query,
            timestamp: new Date(mem.created_at),
          };
          
          // OPTIMIZATION: Include answer if available for full conversation context
          if (answer) {
            turn.answer = answer.substring(0, 300);
          }
          
          return turn;
        });

      const context: MemoryContext = {
        facts,
        entities,
        preferences: Object.fromEntries(
          Object.entries(preferences).map(([k, v]: [string, any]) => [k, v.value || v])
        ),
        conversationHistory,
      };

      this.cache.set(cacheKey, context);
      return context;
    } catch (error: any) {
      logger.error('Failed to build memory context', { 
        userId, 
        error: error.message 
      });
      
      return {
        facts: [],
        entities: {},
        preferences: {},
        conversationHistory: [],
      };
    }
  }

  async extractAndStoreEntities(
    userId: string,
    query: string,
    extractedData: Record<string, any>
  ): Promise<void> {
    const memories: string[] = [];

    // OPTIMIZATION 1: Extract user personal information (name, preferences, etc.)
    const personalInfoPatterns = [
      { pattern: /\b(?:my name is|I am|call me|I'm|my name's)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/i, type: 'user_name', key: 'user_name' },
      { pattern: /\b(?:I work at|I'm at|my company is|I work for)\s+([A-Z][a-zA-Z0-9\s&|]+?)(?:\s|$|,|\.)/i, type: 'user_company', key: 'user_company' },
      { pattern: /\b(?:I'm a|I am a|my role is|my title is|I work as)\s+([A-Z][a-zA-Z\s]+?)(?:\s|$|,|\.)/i, type: 'user_role', key: 'user_role' },
      { pattern: /\b(?:I prefer|I like|I want|I need)\s+([^.!?]+?)(?:\.|$|,)/i, type: 'user_preference', key: 'preference' },
      { pattern: /\b(?:my goal is|I want to|I'm trying to|my objective is)\s+([^.!?]+?)(?:\.|$|,)/i, type: 'user_goal', key: 'goal' },
    ];

    for (const { pattern, type, key } of personalInfoPatterns) {
      const match = query.match(pattern);
      if (match && match[1]) {
        const value = match[1].trim();
        if (value.length > 1 && value.length < 100) {
          memories.push(`User ${key}: ${value}`);
          await this.addMemory(userId, `User ${key}: ${value}`, {
            query,
            timestamp: new Date().toISOString(),
            type,
            entity_type: type,
            entity_value: value,
            preference_key: key,
            preference_value: value,
          });
          logger.debug('Extracted and stored user personal info', { type, value, userId });
        }
      }
    }

    // OPTIMIZATION 2: Extract query intent and context for better memory
    const intentPatterns = [
      { pattern: /\b(?:analyze|analysis|report|insights)\b/i, type: 'query_intent', value: 'analysis' },
      { pattern: /\b(?:email|template|sequence|outreach)\b/i, type: 'query_intent', value: 'email_generation' },
      { pattern: /\b(?:competitor|competition|compare)\b/i, type: 'query_intent', value: 'competitive_analysis' },
      { pattern: /\b(?:decision maker|executive|ceo|cto|cfo)\b/i, type: 'query_intent', value: 'decision_maker_search' },
    ];

    for (const { pattern, type, value } of intentPatterns) {
      if (pattern.test(query)) {
        await this.addMemory(userId, `User frequently asks for ${value}`, {
          query,
          timestamp: new Date().toISOString(),
          type,
          preference_key: 'common_query_type',
          preference_value: value,
        });
        break; // Only store one intent per query
      }
    }
    
    // OPTIMIZATION 7: Store query as conversation history memory
    await this.addMemory(userId, `User query: ${query.substring(0, 300)}`, {
      query,
      timestamp: new Date().toISOString(),
      type: 'session_query',
    });

    if (extractedData.companies && extractedData.companies.length > 0) {
      extractedData.companies.forEach((company: any) => {
        memories.push(
          `User is interested in company "${company.name}" (${company.domain || 'N/A'})`
        );
      });
    }

    if (extractedData.employees && extractedData.employees.length > 0) {
      extractedData.employees.forEach((employee: any) => {
        memories.push(
          `User mentioned employee "${employee.fullName}" who works at ${employee.company?.company_name || 'unknown company'}`
        );
      });
    }

    if (extractedData.preferences) {
      Object.entries(extractedData.preferences).forEach(([key, value]) => {
        memories.push(`User preference: ${key} = ${value}`);
      });
    }

    for (const memory of memories) {
      await this.addMemory(userId, memory, {
        query,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const memoryService = new MemoryService();
