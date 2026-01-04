import axios, { AxiosInstance } from 'axios';
import { config } from '../core/config';
import { logger } from '../core/logger';
import { MemoryFact, MemoryContext } from '../types';

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
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached;
    }

    try {
      const [searchResults, allMemories] = await Promise.all([
        this.searchMemories(userId, query, 10),
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

      allMemories.forEach(mem => {
        if (mem.metadata?.entity_type && mem.metadata?.entity_value) {
          entities[mem.metadata.entity_type] = 
            entities[mem.metadata.entity_type] || [];
          entities[mem.metadata.entity_type].push({
            value: mem.metadata.entity_value,
            context: mem.memory,
          });
        }

        if (mem.metadata?.preference_key) {
          preferences[mem.metadata.preference_key] = 
            mem.metadata.preference_value;
        }
      });

      const context: MemoryContext = {
        facts,
        entities,
        preferences,
        conversationHistory: [],
        timestamp: Date.now(),
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
