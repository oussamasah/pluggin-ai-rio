import axios, { AxiosInstance } from 'axios';
import { config } from '../core/config';
import { logger } from '../core/logger';
import { ActionRequest, ActionResult } from '../types';
import { ExecutionError } from '../core/errors';

export interface ComposioAction {
  name: string;
  appName: string;
  description: string;
  parameters: Record<string, any>;
}

export class ComposioService {
  private client: AxiosInstance;
  private availableActions: Map<string, ComposioAction> = new Map();

  constructor() {
    this.client = axios.create({
      baseURL: config.composio.baseUrl,
      headers: {
        'X-API-Key': config.composio.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });
  }

  async executeAction(
    actionRequest: ActionRequest,
    userId: string
  ): Promise<ActionResult> {
    try {
      logger.info('Executing Composio action', { 
        tool: actionRequest.tool,
        action: actionRequest.action,
        userId 
      });

      const response = await this.client.post('/actions/execute', {
        appName: actionRequest.tool,
        actionName: actionRequest.action,
        input: actionRequest.parameters,
        entityId: userId,
      });

      if (response.data.executionStatus === 'success') {
        return {
          success: true,
          result: response.data.response,
          metadata: {
            executionId: response.data.executionId,
            timestamp: new Date().toISOString(),
          },
        };
      } else {
        return {
          success: false,
          error: response.data.error || 'Unknown execution error',
          metadata: {
            executionId: response.data.executionId,
          },
        };
      }
    } catch (error: any) {
      logger.error('Composio action failed', { 
        action: actionRequest.action,
        error: error.message 
      });

      throw new ExecutionError(
        `Failed to execute ${actionRequest.action}: ${error.message}`,
        { actionRequest, originalError: error.response?.data }
      );
    }
  }

  async listAvailableActions(appName?: string): Promise<ComposioAction[]> {
    try {
      const params = appName ? { appName } : {};
      const response = await this.client.get('/actions', { params });

      return response.data.items || [];
    } catch (error: any) {
      logger.error('Failed to list Composio actions', { error: error.message });
      return [];
    }
  }

  async sendSlackMessage(
    userId: string,
    channel: string,
    message: string
  ): Promise<ActionResult> {
    return this.executeAction({
      tool: 'slack',
      action: 'SLACK_CHAT_POST_MESSAGE',
      parameters: {
        channel,
        text: message,
      },
      requiresConfirmation: false,
    }, userId);
  }

  async sendEmail(
    userId: string,
    to: string,
    subject: string,
    body: string
  ): Promise<ActionResult> {
    return this.executeAction({
      tool: 'gmail',
      action: 'GMAIL_SEND_EMAIL',
      parameters: {
        to,
        subject,
        message_body: body,
      },
      requiresConfirmation: true,
    }, userId);
  }

  async createCRMContact(
    userId: string,
    crmType: 'salesforce' | 'hubspot',
    contactData: Record<string, any>
  ): Promise<ActionResult> {
    const actionMap = {
      salesforce: 'SALESFORCE_CREATE_CONTACT',
      hubspot: 'HUBSPOT_CREATE_CONTACT',
    };

    return this.executeAction({
      tool: crmType,
      action: actionMap[crmType],
      parameters: contactData,
      requiresConfirmation: false,
    }, userId);
  }

  async createJiraIssue(
    userId: string,
    project: string,
    summary: string,
    description: string,
    issueType: string = 'Task'
  ): Promise<ActionResult> {
    return this.executeAction({
      tool: 'jira',
      action: 'JIRA_CREATE_ISSUE',
      parameters: {
        project,
        summary,
        description,
        issuetype: issueType,
      },
      requiresConfirmation: false,
    }, userId);
  }
}

export const composioService = new ComposioService();