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

    if (!state.analysis) {
      return {
        finalAnswer: 'I was unable to process your request. Please try again with a different query.',
        currentNode: 'end',
        confidence: 0,
      };
    }

    const systemPrompt = dynamicPromptBuilder.buildResponderPrompt(
      state.query,
      state.analysis,
      state.executedActions,
      state.retrievedData // Pass actual retrieved data for validation
    );

    // Check if streaming is enabled (via callbacks)
    const streamCallbacks = getStreamCallbacks();
    const useStreaming = !!streamCallbacks?.onChunk;

    // Send progress update when starting to generate response
    if (useStreaming && streamCallbacks.onProgress) {
      streamCallbacks.onProgress('responder', 'Generating response...', 90);
    }

    // Use streaming if callbacks are available, otherwise use regular chat
    // IMPORTANT: chatStream() will call onChunk for each chunk as it arrives
    // The node will still await the full stream, but chunks are sent in real-time
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