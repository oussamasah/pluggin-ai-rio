import { llmService } from '../../services/llm.service';
import { memoryService } from '../../services/memory.service';
import { dynamicPromptBuilder } from '../../prompts/dynamic-builder';
import { RESPONSE_TEMPLATES } from '../../prompts/templates';
import { logger } from '../../core/logger';
import { GraphState } from '../state';
import { config } from '../../core/config';
import { secureLog, maskSensitiveData } from '../../utils/security';
import { getStreamCallbacks } from '../graph-stream';

export async function responderNode(state: GraphState): Promise<Partial<GraphState>> {
  // Send progress update when node starts
  const streamCallbacks = getStreamCallbacks();
  if (streamCallbacks?.onProgress) {
    streamCallbacks.onProgress('responder', 'Crafting your response...', 95);
  }
  
  try {
    // Log actual retrieved companies for debugging
    const companies = state.retrievedData.find(r => r.collection === 'companies');
    const companyNames = companies?.documents?.map((d: any) => d.name) || [];
    
    // Secure logging - mask sensitive data
    secureLog({
      hasAnalysis: !!state.analysis,
      analysisLength: state.analysis?.length || 0,
      analysisPreview: state.analysis?.substring(0, 150) || 'none',
      dataPoints: state.flattenedData.length,
      retrievedDataCount: state.retrievedData.length,
      companiesRetrieved: companies?.documents?.length || 0,
      companyNames: companyNames.slice(0, 10), // Log first 10 company names
      confidence: state.confidence,
      originalQuery: maskSensitiveData(state.originalQuery || ''),
      errors: state.errors.length
    }, 'info');

    if (state.errors.length > 0) {
      const errorMessage = state.errors.join('\n');
      const suggestions = [
        'Rephrase your query with more specific terms',
        'Check if the data exists in your account',
        'Try searching for related information',
      ];

      return {
        finalAnswer: RESPONSE_TEMPLATES.ERROR_RESPONSE(errorMessage, suggestions),
        currentNode: 'end',
        confidence: 0,
      };
    }

    // Handle informational/clarification queries that don't need data or analysis
    // Check intent type as string to handle any type values
    const intentTypeStr = state.intent?.type as string;
    const isInformationalQuery = intentTypeStr === 'informational' || 
                                 intentTypeStr === 'clarification' ||
                                 (!state.analysis && 
                                  state.retrievedData.length > 0 &&
                                  state.retrievedData.every(r => r.documents.length === 0) &&
                                  /\b(what|who|how|when|where|why|can you|do you|are you|your mission|your purpose|help me|what can|what do|what data|what information|access to)\b/i.test(state.originalQuery || ''));
    
    // Check if streaming is enabled (via callbacks)
    const streamCallbacks = getStreamCallbacks();
    const useStreaming = !!streamCallbacks?.onChunk;
    
    if (isInformationalQuery && !state.analysis) {
      logger.info('Responder: Handling informational query without analysis', {
        intentType: state.intent?.type,
        query: state.originalQuery?.substring(0, 50)
      });
      
      // For informational queries, generate response directly without analysis
      const informationalPrompt = `You are RIO (Revenue Intelligence Operating System), an AI assistant that helps revenue teams make data-driven decisions.

Your capabilities:
- Search and analyze company data
- Find decision makers and executives
- Analyze ICP (Ideal Customer Profile) fit scores
- Generate insights about companies and employees
- Create personalized email sequences
- Help with account-based selling strategies
- Execute actions like sending data to CRM systems

You have access to:
- Company databases (with industry, revenue, employee count, fit scores)
- Employee/decision maker profiles
- ICP models
- GTM intelligence data
- Persona intelligence data

User Query: ${state.originalQuery}

Provide a helpful, concise response about your mission and how you can help the user. Be friendly and professional.`;

      const response = useStreaming
        ? await llmService.chatStream(
            [
              { role: 'system', content: informationalPrompt },
              { role: 'user', content: state.originalQuery || 'How can you help me?' },
            ],
            {
              model: config.models.planner,
              temperature: 0.4,
              onChunk: (chunk: string) => {
                if (streamCallbacks?.onChunk) {
                  streamCallbacks.onChunk(chunk);
                }
              },
            }
          )
        : await llmService.chat(
            [
              { role: 'system', content: informationalPrompt },
              { role: 'user', content: state.originalQuery || 'How can you help me?' },
            ],
            {
              model: config.models.planner,
              temperature: 0.4,
            }
          );

      return {
        finalAnswer: response.content,
        currentNode: 'end',
        confidence: 0.9,
      };
    }

    if (!state.analysis) {
      return {
        finalAnswer: 'I was unable to process your request. Please try again with a different query.',
        currentNode: 'end',
        confidence: 0,
      };
    }

    // OPTIMIZATION: Use context extractor service for smarter content extraction
    // This handles rewrite, edit, explain, extract queries dynamically
    const { contextExtractorService } = await import('../../services/context-extractor.service');
    const extractedContext = await contextExtractorService.extractContext(
      state.originalQuery || state.query,
      state.previousResults || []
    );
    
    let previousEmailContent: string | undefined;
    let extractedData: any = {};
    let senderName: string | undefined;
    
    if (extractedContext) {
      previousEmailContent = extractedContext.targetContent;
      extractedData = extractedContext.referencedData || {};
      
      // Extract sender name from requirements (e.g., "sender_name:Oussama Sahraoui")
      const requirements = extractedContext.requirements || [];
      const senderNameReq = requirements.find((r: string) => r.startsWith('sender_name:'));
      if (senderNameReq) {
        senderName = senderNameReq.replace('sender_name:', '');
        logger.info('Responder: Extracted sender name from requirements', {
          senderName,
          query: state.originalQuery
        });
      }
      
      // Also check memory for user's name if not found in requirements
      if (!senderName && state.memory?.preferences?.user_name) {
        senderName = state.memory.preferences.user_name as string;
        logger.info('Responder: Using sender name from memory', { senderName });
      }
      
      logger.info('Responder: Context extracted from previous results', {
        type: extractedContext.type,
        hasTargetContent: !!extractedContext.targetContent,
        targetSection: extractedContext.targetSection,
        requirements: extractedContext.requirements,
        hasReferencedData: !!extractedContext.referencedData,
        senderName
      });
    } else {
      // Fallback: Simple extraction for rewrite queries
      const isRewriteQuery = /\b(rewrite|regenerate|recreate|re-?write|re-?generate|edit|modify|revise|update)\s+(email|template|message|content|text)\b/i.test(state.originalQuery || '') ||
                             /\b(rewrite|regenerate|recreate|re-?write|re-?generate|edit|modify|revise)\s+(email\s+\d+|Email\s+\d+)\b/i.test(state.originalQuery || '');
      
      if (isRewriteQuery && state.previousResults && state.previousResults.length > 0) {
        const previousAnswer = state.previousResults[0]?.finalAnswer || '';
        if (previousAnswer) {
          const emailNumberMatch = state.originalQuery?.match(/\b(?:email|Email)\s+(\d+)/i);
          if (emailNumberMatch) {
            const emailNum = parseInt(emailNumberMatch[1], 10);
            const emailPattern = new RegExp(`(?:##|###|Email\\s+${emailNum}|Email\\s+${emailNum}:)[^#]*(?=##|###|Email\\s+${emailNum + 1}|$)`, 'is');
            const emailMatch = previousAnswer.match(emailPattern);
            if (emailMatch) {
              previousEmailContent = emailMatch[0];
            }
          }
          if (!previousEmailContent) {
            previousEmailContent = previousAnswer.substring(0, 2000);
          }
        }
      }
    }
    
    // OPTIMIZATION 13: Include memory context in responder for personalized responses
    const systemPrompt = dynamicPromptBuilder.buildResponderPrompt(
      state.query,
      state.analysis,
      state.executedActions,
      state.retrievedData, // Pass actual retrieved data for validation
      state.memory, // Pass memory context for personalization
      state.previousResults, // Pass previous results for context-aware responses
      previousEmailContent, // OPTIMIZATION: Pass previous email content for rewrite queries
      senderName // OPTIMIZATION: Pass sender name for email signature replacement
    );

    // Use streaming if callbacks are available, otherwise use regular chat
    // IMPORTANT: chatStream() will call onChunk for each chunk as it arrives
    // Chunks are sent in real-time via the callback, even though we await the full response
    let firstChunkReceived = false;
    const response = useStreaming
      ? await llmService.chatStream(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Craft the final response.' },
          ],
          {
            model: config.models.planner,
            temperature: 0.4,
            onChunk: (chunk: string) => {
              // Mark that we've started receiving chunks
              if (!firstChunkReceived) {
                firstChunkReceived = true;
                logger.debug('First streaming chunk received', { chunkLength: chunk.length });
                // Update progress to indicate streaming has started
                if (streamCallbacks.onProgress) {
                  streamCallbacks.onProgress('responder', 'Streaming response...', 92);
                }
              }
              
              // Call the chunk callback immediately - this should flush to client
              if (streamCallbacks.onChunk) {
                streamCallbacks.onChunk(chunk);
              }
            },
          }
        )
      : await llmService.chat(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Craft the final response.' },
          ],
          {
            model: config.models.planner,
            temperature: 0.4,
          }
        );

    await memoryService.extractAndStoreEntities(
      state.userId,
      state.query,
      {
        companies: state.retrievedData.find(r => r.collection === 'companies')?.documents || [],
        employees: state.retrievedData.find(r => r.collection === 'employees')?.documents || [],
      }
    );
    
    // OPTIMIZATION: Store final answer in memory for conversation history
    if (response.content && response.content.length > 0) {
      try {
        await memoryService.addMemory(
          state.userId,
          `Assistant response: ${response.content.substring(0, 500)}`,
          {
            query: state.originalQuery || state.query,
            timestamp: new Date().toISOString(),
            type: 'session_response',
            answerSummary: response.content.substring(0, 1000),
          }
        );
      } catch (error: any) {
        logger.debug('Failed to store answer in memory', { error: error.message });
        // Don't fail the response if memory storage fails
      }
    }

    logger.info('Response generated', { 
      length: response.content.length,
      confidence: state.confidence,
      preview: response.content.substring(0, 200),
      hasLimitedData: response.content.toLowerCase().includes('limited') || 
                     response.content.toLowerCase().includes('no data') ||
                     response.content.toLowerCase().includes('no results')
    });

    return {
      finalAnswer: response.content,
      currentNode: 'end',
    };
  } catch (error: any) {
    logger.error('Responder node failed', { error: error.message });
    
    return {
      finalAnswer: 'An error occurred while generating the response. Please try again.',
      currentNode: 'end',
      confidence: 0,
    };
  }
}