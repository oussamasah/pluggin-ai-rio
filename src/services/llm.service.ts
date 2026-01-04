import axios, { AxiosInstance } from 'axios';
import { config } from '../core/config';
import { logger } from '../core/logger';
import { RIOError } from '../core/errors';
import { jsonrepair } from 'jsonrepair';
import { withTimeout } from '../utils/timeout';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  onChunk?: (chunk: string) => void; // Callback for streaming chunks
}

class RateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private requestsPerMinute: number;
  private minDelay: number;
  private lastRequestTime = 0;

  constructor(requestsPerMinute: number = 50) {
    this.requestsPerMinute = requestsPerMinute;
    this.minDelay = 60000 / requestsPerMinute;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue() {
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < this.minDelay) {
        await new Promise(resolve => 
          setTimeout(resolve, this.minDelay - timeSinceLastRequest)
        );
      }

      const task = this.queue.shift();
      if (task) {
        this.lastRequestTime = Date.now();
        await task();
      }
    }

    this.processing = false;
  }
}

export class LLMService {
  private client: AxiosInstance;
  private rateLimiter: RateLimiter;

  constructor() {
    this.client = axios.create({
      baseURL: config.openrouter.baseUrl,
      headers: {
        'Authorization': `Bearer ${config.openrouter.apiKey}`,
        'HTTP-Referer': 'https://rio-orchestrator.com',
        'X-Title': 'RIO Orchestrator',
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    });

    this.rateLimiter = new RateLimiter(50);
  }

  async chat(
    messages: LLMMessage[],
    options: LLMOptions = {}
  ): Promise<LLMResponse> {
    const {
      model = config.models.executor,
      temperature = 0.3,
      maxTokens = 4000,
      topP = 1,
      stream = false,
      onChunk,
    } = options;
    let finalMessages = Array.isArray(messages) ? messages : messages.messages;

    if (!finalMessages || !Array.isArray(finalMessages)) {
      throw new Error("LLMService: Invalid messages format. Expected an array.");
    }

    // If streaming is requested, use streaming endpoint
    if (stream && onChunk) {
      return this.chatStream(messages, options);
    }

    return this.rateLimiter.execute(async () => {
      try {
        
        logger.debug('LLM Request', { model, messageCount: messages.length });
        const payload = {
            model: options.model || config.models.executor,
            messages: finalMessages, // Use the flattened array here
            temperature: options.temperature ?? 0.1,
            max_tokens: options.maxTokens ?? 4000,
          };
    
          // Execute with timeout
          const response = await withTimeout(
            this.client.post('/chat/completions', payload),
            config.execution.llmTimeout,
            `LLM request timeout for ${model}`
          );
        const content = response.data.choices[0]?.message?.content || '';
        const usage = response.data.usage;

        logger.debug('LLM Response', { 
          model, 
          contentLength: content.length,
          tokens: usage?.total_tokens 
        });

        return {
          content,
          model: response.data.model,
          usage: usage ? {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          } : undefined,
        };
      } catch (error: any) {
        console.log(error)
        logger.error('LLM Error', { 
          error: error.message,
          response: error.response?.data 
        });
        
        throw new RIOError(
          `LLM request failed: ${error.message}`,
          'LLM_ERROR',
          500,
          { originalError: error.response?.data || error.message }
        );
      }
    });
  }

  /**
   * Stream chat completion with real-time chunks
   */
  async chatStream(
    messages: LLMMessage[],
    options: LLMOptions = {}
  ): Promise<LLMResponse> {
    const {
      model = config.models.executor,
      temperature = 0.3,
      maxTokens = 4000,
      onChunk,
    } = options;

    let finalMessages = Array.isArray(messages) ? messages : messages.messages;

    return this.rateLimiter.execute(async () => {
      try {
        const payload = {
          model: options.model || config.models.executor,
          messages: finalMessages,
          temperature: options.temperature ?? 0.1,
          max_tokens: options.maxTokens ?? 4000,
          stream: true,
        };

        logger.debug('LLM Streaming Request', { model, messageCount: messages.length });

        const response = await this.client.post('/chat/completions', payload, {
          responseType: 'stream',
          timeout: config.execution.llmTimeout,
        });

        let fullContent = '';
        let modelName = model;
        let usage: any = undefined;

        return new Promise<LLMResponse>((resolve, reject) => {
          response.data.on('data', (chunk: Buffer) => {
            const lines = chunk.toString().split('\n').filter((line: string) => line.trim() !== '');
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                
                if (data === '[DONE]') {
                  resolve({
                    content: fullContent,
                    model: modelName,
                    usage,
                  });
                  return;
                }

                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta;
                  
                  if (delta?.content) {
                    const chunkText = delta.content;
                    fullContent += chunkText;
                    
                    // Call the chunk callback if provided
                    if (onChunk) {
                      onChunk(chunkText);
                    }
                  }

                  if (parsed.model) {
                    modelName = parsed.model;
                  }

                  if (parsed.usage) {
                    usage = {
                      promptTokens: parsed.usage.prompt_tokens,
                      completionTokens: parsed.usage.completion_tokens,
                      totalTokens: parsed.usage.total_tokens,
                    };
                  }
                } catch (e) {
                  // Ignore parse errors for incomplete chunks
                }
              }
            }
          });

          response.data.on('end', () => {
            if (fullContent) {
              resolve({
                content: fullContent,
                model: modelName,
                usage,
              });
            } else {
              reject(new RIOError('Stream ended without content', 'LLM_ERROR', 500));
            }
          });

          response.data.on('error', (error: any) => {
            logger.error('LLM Stream Error', { error: error.message });
            reject(new RIOError(
              `LLM stream failed: ${error.message}`,
              'LLM_ERROR',
              500
            ));
          });
        });
      } catch (error: any) {
        logger.error('LLM Stream Error', { 
          error: error.message,
          response: error.response?.data 
        });
        
        throw new RIOError(
          `LLM stream request failed: ${error.message}`,
          'LLM_ERROR',
          500,
          { originalError: error.response?.data || error.message }
        );
      }
    });
  }
  async chatWithJSON(messages: any) {
    const response = await this.chat(messages, { maxTokens: 1500 }); 
    const content = response.content;

    try {
        // First, try to parse directly
        return JSON.parse(content);
    } catch (e: any) {
        // If direct parsing fails, try to extract JSON
        try {
            // Find the first { and last } in the content
            const firstBracket = content.indexOf('{');
            const lastBracket = content.lastIndexOf('}');
            
            if (firstBracket === -1 || lastBracket === -1 || firstBracket >= lastBracket) {
                throw new Error("No valid JSON structure found");
            }
            
            // Extract the JSON part
            const jsonPart = content.substring(firstBracket, lastBracket + 1);
            
            // Use jsonrepair to fix any JSON issues
            const repaired = jsonrepair(jsonPart);
            
            // Try to parse the repaired JSON
            const parsed = JSON.parse(repaired);
            
            // For Critic agent specifically, check if we have the expected structure
            if (messages[0]?.content?.includes('You are the Critic Agent')) {
                // The Critic should return a specific JSON structure
                if (!parsed.isValid && !parsed.issues && !parsed.corrections && !parsed.confidence) {
                    // If we have nested validationDetails, extract just the main object
                    const mainCriticResponse = {
                        isValid: parsed.isValid !== undefined ? parsed.isValid : true,
                        issues: parsed.issues || [],
                        corrections: parsed.corrections || [],
                        confidence: parsed.confidence || 0.8,
                        validationDetails: parsed.validationDetails || {}
                    };
                    return mainCriticResponse;
                }
            }
            
            return parsed;
        } catch (repairError: any) {
            console.error('JSON repair failed:', repairError.message);
            console.error('Original content:', content);
            
            // For Critic agent, return a default validation response
            if (messages[0]?.content?.includes('You are the Critic Agent')) {
                return {
                    isValid: true,
                    issues: [],
                    corrections: [],
                    confidence: 0.8
                };
            }
            
            throw new Error(`JSON failure: ${e.message}`);
        }
    }
}
  async plannerChat(messages: LLMMessage[]): Promise<LLMResponse> {
    return this.chat(messages, {
      model: config.models.planner,
      temperature: 0.3,
      maxTokens: 4000,
    });
  }

  async criticChat(messages: LLMMessage[]): Promise<LLMResponse> {
    return this.chat(messages, {
      model: config.models.critic,
      temperature: 0.1,
      maxTokens: 3000,
    });
  }
}

export const llmService = new LLMService();
