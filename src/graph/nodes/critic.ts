import { llmService } from '../../services/llm.service';
import { dynamicPromptBuilder } from '../../prompts/dynamic-builder';
import { logger } from '../../core/logger';
import { GraphState } from '../state';

export async function criticNode(state: GraphState): Promise<Partial<GraphState>> {
  try {
    logger.info('Critic node executing', {
      analysisLength: state.analysis?.length || 0,
      dataPoints: state.flattenedData.length,
      retrievedDataCount: state.retrievedData.length,
      originalQuery: state.originalQuery
    });

    if (!state.analysis) {
      throw new Error('No analysis to critique');
    }

    const systemPrompt = dynamicPromptBuilder.buildCriticPrompt(
      state.analysis,
      state.flattenedData
    );

    let response;
    try {
      response = await llmService.chatWithJSON({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Validate this analysis. Respond with valid JSON only.' },
        ],
      });
    } catch (error: any) {
      // If JSON parsing fails, create a default response
      logger.error('Critic JSON parsing failed', { error: error.message });
      response = {
        isValid: false,
        confidence: 0.3,
        issues: ['Failed to parse critic response. Analysis may contain errors.'],
        suggestions: ['Please review the analysis manually.']
      };
    }

    // Support both response formats: isValid or overallValidity
    const isValid = response.isValid !== undefined 
      ? response.isValid 
      : (response.overallValidity !== undefined ? response.overallValidity >= 0.8 : true);
    
    // Build normalized critic result
    const criticResult = {
      isValid,
      confidence: response.confidence || response.overallValidity || 0.5,
      issues: response.issues || response.claimValidation?.map((c: any) => c.issue || c.claim).filter(Boolean) || [],
      corrections: response.corrections || [],
    };

    logger.info('Critic validation result', { 
      isValid: criticResult.isValid,
      confidence: criticResult.confidence,
      issuesCount: criticResult.issues.length,
      issues: criticResult.issues.slice(0, 3),
      overallValidity: response.overallValidity,
      canProceed: response.canProceed,
      dataPointsValidated: state.flattenedData.length
    });

    if (!isValid && state.iterations < state.maxIterations) {
      logger.warn('Analysis failed validation, re-analyzing', { 
        issues: criticResult.issues,
        overallValidity: response.overallValidity,
        isValid
      });
      
      return {
        criticResult,
        currentNode: 'analyzer',
        iterations: state.iterations + 1,
      };
    }

    // Only route to executor if there are actual external actions (not just "fetch")
    const hasExternalActions = state.intent?.actions && 
                                state.intent.actions.length > 0 &&
                                state.intent.actions.some((a: string) => 
                                  !['fetch', 'hop', 'aggregate'].includes(a)
                                );
    
    const nextNode = hasExternalActions 
      ? 'executor' 
      : 'responder';

    return {
      criticResult,
      currentNode: nextNode,
      confidence: criticResult.confidence,
    };
  } catch (error: any) {
    logger.error('Critic node failed', { error: error.message });
    
    return {
      errors: [...state.errors, `Criticism failed: ${error.message}`],
      currentNode: 'responder',
    };
  }
}
