import { composioService } from '../../services/composio.service';
import { llmService } from '../../services/llm.service';
import { dynamicPromptBuilder } from '../../prompts/dynamic-builder';
import { logger } from '../../core/logger';
import { GraphState } from '../state';
import { RESPONSE_TEMPLATES } from '../../prompts/templates';

export async function executorNode(state: GraphState): Promise<Partial<GraphState>> {
  try {
    logger.info('Executor node executing', { 
      actions: state.intent?.actions 
    });

    if (!state.intent?.actions || state.intent.actions.length === 0) {
      return {
        currentNode: 'responder',
      };
    }

    const systemPrompt = dynamicPromptBuilder.buildExecutorPrompt(
      state.query,
      state.analysis || '',
      state.intent,
      state.retrievedData // Pass retrieved data for CRM actions
    );

    let actionPlan: any;
    try {
      actionPlan = await llmService.chatWithJSON({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Generate the action execution plan.' },
        ],
      });
    } catch (error: any) {
      logger.error('Executor LLM call failed', { error: error.message });
      // If LLM fails, skip execution and go to responder
      return {
        currentNode: 'responder',
        errors: [...state.errors, `Action planning failed: ${error.message}`],
      };
    }

    // Validate actionPlan structure
    if (!actionPlan || !actionPlan.actions || !Array.isArray(actionPlan.actions)) {
      logger.warn('Invalid action plan structure, skipping execution', {
        hasActionPlan: !!actionPlan,
        hasActions: !!actionPlan?.actions,
        actionPlanKeys: actionPlan ? Object.keys(actionPlan) : [],
        actionPlanPreview: actionPlan ? JSON.stringify(actionPlan).substring(0, 200) : 'null'
      });
      
      // If no valid actions, just go to responder
      return {
        currentNode: 'responder',
      };
    }

    const requiresConfirmation = actionPlan.actions.some(
      (a: any) => a.requiresConfirmation
    );

    if (requiresConfirmation) {
      logger.info('Actions require user confirmation');
      
      return {
        pendingActions: actionPlan.actions,
        requiresUserInput: true,
        userInputPrompt: RESPONSE_TEMPLATES.ACTION_CONFIRMATION(actionPlan.actions),
        currentNode: 'awaiting_confirmation',
      };
    }

    const executedActions: any[] = [];

    for (const action of actionPlan.actions) {
      try {
        const result = await composioService.executeAction(action, state.userId);
        executedActions.push({ ...action, ...result });
      } catch (error: any) {
        logger.error('Action execution failed', { 
          action: action.action,
          error: error.message 
        });
        executedActions.push({ 
          ...action, 
          success: false, 
          error: error.message 
        });
      }
    }

    return {
      executedActions,
      currentNode: 'responder',
    };
  } catch (error: any) {
    logger.error('Executor node failed', { error: error.message });
    
    return {
      errors: [...state.errors, `Execution failed: ${error.message}`],
      currentNode: 'responder',
    };
  }
}