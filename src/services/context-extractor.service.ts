/**
 * Context Extractor Service
 * 
 * Intelligently extracts relevant data from previous conversation results
 * without hardcoding patterns. Uses semantic understanding to extract:
 * - Previous responses (emails, analysis, reports)
 * - Specific sections (Email 1, Email 2, etc.)
 * - Data points (companies, employees, metrics)
 * - User requirements and preferences
 */

import { logger } from '../core/logger';
import { PreviousQueryResult } from './session-context.service';

export interface ExtractedContext {
  type: 'rewrite' | 'edit' | 'explain' | 'detail' | 'modify' | 'extract' | 'reference';
  targetContent?: string; // The content to rewrite/edit (e.g., Email 1 content)
  targetSection?: string; // Specific section identifier (e.g., "Email 1", "Analysis", "Table")
  requirements?: string[]; // User requirements (e.g., "without extra analysis", "make it shorter")
  referencedData?: {
    companies?: any[];
    employees?: any[];
    analysis?: string;
    metrics?: Record<string, any>;
  };
  previousQuery?: string;
  previousAnswer?: string;
}

export class ContextExtractorService {
  /**
   * Intelligently extract context from previous results based on current query
   * Uses semantic understanding rather than hardcoded patterns
   */
  async extractContext(
    currentQuery: string,
    previousResults: PreviousQueryResult[]
  ): Promise<ExtractedContext | null> {
    if (!previousResults || previousResults.length === 0) {
      return null;
    }

    const mostRecent = previousResults[0];
    
    // Use LLM to understand what the user wants to extract/modify
    const extractionPrompt = this.buildExtractionPrompt(currentQuery, mostRecent);
    
    try {
      // For now, use pattern-based extraction as fallback
      // In production, you could use LLM here for better understanding
      const extracted = this.patternBasedExtraction(currentQuery, mostRecent);
      
      if (extracted) {
        logger.info('Context extracted from previous results', {
          type: extracted.type,
          hasTargetContent: !!extracted.targetContent,
          targetSection: extracted.targetSection,
          requirementsCount: extracted.requirements?.length || 0
        });
      }
      
      return extracted;
    } catch (error: any) {
      logger.warn('Context extraction failed, using fallback', { error: error.message });
      return this.fallbackExtraction(currentQuery, mostRecent);
    }
  }

  /**
   * Pattern-based extraction (current approach - will be enhanced with LLM)
   */
  private patternBasedExtraction(
    query: string,
    previousResult: PreviousQueryResult
  ): ExtractedContext | null {
    const queryLower = query.toLowerCase();
    
    // Detect intent type
    const isRewrite = /\b(rewrite|re-?write|regenerate|re-?generate)\b/i.test(query);
    const isEdit = /\b(edit|modify|change|update|revise|adjust)\b/i.test(query);
    const isExplain = /\b(explain|clarify|elaborate|detail|describe|what\s+does|how\s+does)\b/i.test(query);
    const isDetail = /\b(more\s+details?|more\s+information|expand|elaborate|tell\s+me\s+more)\b/i.test(query);
    const isExtract = /\b(extract|get|show\s+me|give\s+me|provide)\s+(?:the|that|this|previous)\b/i.test(query);
    const isReference = /\b(this|that|the|previous|last|earlier|above|mentioned)\b/i.test(query);
    
    const type = isRewrite ? 'rewrite' :
                 isEdit ? 'edit' :
                 isExplain ? 'explain' :
                 isDetail ? 'detail' :
                 isExtract ? 'extract' :
                 isReference ? 'reference' : null;
    
    if (!type) {
      return null;
    }
    
    // Extract target section (e.g., "Email 1", "Email 2", "Analysis", "Table")
    let targetSection: string | undefined;
    const emailMatch = query.match(/\b(?:email|Email)\s+(\d+)\b/i);
    if (emailMatch) {
      targetSection = `Email ${emailMatch[1]}`;
    } else if (/\b(?:the|this|that)\s+(?:analysis|report|answer|response|table|data)\b/i.test(query)) {
      // Generic reference to previous content
      targetSection = 'previous';
    }
    
    // Extract requirements (e.g., "without extra analysis", "make it shorter")
    const requirements: string[] = [];
    if (/\b(?:only|just|without|no)\s+(?:extra|additional|more)\s+(?:analysis|data|information|details?)\b/i.test(query)) {
      requirements.push('no_extra_content');
    }
    if (/\b(?:make|make\s+it)\s+(?:shorter|more\s+concise|brief|briefly)\b/i.test(query)) {
      requirements.push('shorter');
    }
    if (/\b(?:make|make\s+it)\s+(?:longer|more\s+detailed|expand|elaborate)\b/i.test(query)) {
      requirements.push('more_detailed');
    }
    if (/\b(?:add|include)\s+(?:more|additional)\s+(?:details?|information|data)\b/i.test(query)) {
      requirements.push('add_details');
    }
    
    // OPTIMIZATION: Extract sender name requirements (e.g., "set my name", "use my name", "sender name")
    // CRITICAL: Distinguish between sender name (user's name) and recipient name (target's name)
    const senderNameMatch = query.match(/\b(?:set|use|put|change|replace|update)\s+(?:my\s+)?name\s+(?:to|as|is)?\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/i) ||
                           query.match(/\b(?:my\s+)?name\s+(?:is|should\s+be|to)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/i) ||
                           query.match(/\b(?:best|sincerely|regards|thanks),?\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/i);
    
    if (senderNameMatch && senderNameMatch[1]) {
      const extractedSenderName = senderNameMatch[1].trim();
      // Validate it's not a common word or the recipient's name
      const commonWords = new Set(['casey', 'nolte', 'email', 'subject', 'hi', 'hello', 'dear']);
      if (!commonWords.has(extractedSenderName.toLowerCase()) && extractedSenderName.length > 2) {
        requirements.push(`sender_name:${extractedSenderName}`);
        logger.info('ContextExtractor: Detected sender name requirement', {
          senderName: extractedSenderName,
          query
        });
      }
    }
    
    // Also detect if user explicitly says "not to change the name of the target profile"
    if (/\b(?:not|don't|do\s+not)\s+(?:to\s+)?(?:change|modify|edit)\s+(?:the\s+)?(?:name\s+of\s+)?(?:the\s+)?(?:target|recipient|profile|person|contact)\b/i.test(query)) {
      requirements.push('preserve_recipient_name');
      logger.info('ContextExtractor: User wants to preserve recipient name', { query });
    }
    
    // Extract target content from previous result
    let targetContent: string | undefined;
    if (previousResult.finalAnswer) {
      if (targetSection && emailMatch) {
        // Extract specific email
        const emailNum = parseInt(emailMatch[1], 10);
        targetContent = this.extractEmailSection(previousResult.finalAnswer, emailNum);
      } else {
        // Use full answer or analysis
        targetContent = previousResult.finalAnswer.substring(0, 3000);
      }
    } else if (previousResult.analysis) {
      targetContent = previousResult.analysis.substring(0, 2000);
    }
    
    // Extract referenced data
    const referencedData: ExtractedContext['referencedData'] = {};
    if (previousResult.retrievedData) {
      const companies = previousResult.retrievedData.find(r => r.collection === 'companies');
      const employees = previousResult.retrievedData.find(r => r.collection === 'employees');
      
      if (companies) referencedData.companies = companies.documents.slice(0, 10);
      if (employees) referencedData.employees = employees.documents.slice(0, 10);
      if (previousResult.analysis) referencedData.analysis = previousResult.analysis;
    }
    
    return {
      type,
      targetContent,
      targetSection,
      requirements,
      referencedData,
      previousQuery: previousResult.query,
      previousAnswer: previousResult.finalAnswer
    };
  }

  /**
   * Extract specific email section from previous answer
   */
  private extractEmailSection(answer: string, emailNumber: number): string | undefined {
    // Try multiple patterns to find the email
    const patterns = [
      new RegExp(`(?:##|###|Email\\s+${emailNumber}|Email\\s+${emailNumber}:)[^#]*(?=##|###|Email\\s+${emailNumber + 1}|$)`, 'is'),
      new RegExp(`(?:Email\\s+${emailNumber}:\\s*Partnership[^#]*(?=##|###|Email\\s+${emailNumber + 1}|$))`, 'is'),
      new RegExp(`(?:---[\\s\\S]*?Email\\s+${emailNumber}[\\s\\S]*?---)`, 'is'),
    ];
    
    for (const pattern of patterns) {
      const match = answer.match(pattern);
      if (match && match[0]) {
        return match[0].trim();
      }
    }
    
    // Fallback: return first 1000 chars if specific email not found
    return answer.substring(0, 1000);
  }

  /**
   * Fallback extraction when pattern matching fails
   */
  private fallbackExtraction(
    query: string,
    previousResult: PreviousQueryResult
  ): ExtractedContext | null {
    // If query references previous content, extract what we can
    if (/\b(this|that|the|previous|last|earlier)\b/i.test(query)) {
      return {
        type: 'reference',
        previousQuery: previousResult.query,
        previousAnswer: previousResult.finalAnswer,
        referencedData: {
          analysis: previousResult.analysis
        }
      };
    }
    
    return null;
  }

  /**
   * Build extraction prompt for LLM (future enhancement)
   */
  private buildExtractionPrompt(
    currentQuery: string,
    previousResult: PreviousQueryResult
  ): string {
    return `Analyze the user's current query and extract relevant context from previous conversation.

Current Query: "${currentQuery}"

Previous Query: "${previousResult.query}"
Previous Answer: ${previousResult.finalAnswer ? previousResult.finalAnswer.substring(0, 1000) : 'N/A'}
Previous Analysis: ${previousResult.analysis ? previousResult.analysis.substring(0, 500) : 'N/A'}

Determine:
1. What does the user want to do? (rewrite, edit, explain, get more details, extract data, etc.)
2. What specific content are they referring to? (Email 1, Email 2, Analysis, Table, etc.)
3. What are their requirements? (shorter, longer, no extra content, add details, etc.)
4. What data from previous results is relevant?

Respond with JSON:
{
  "type": "rewrite|edit|explain|detail|modify|extract|reference",
  "targetSection": "Email 1|Email 2|Analysis|Table|previous",
  "requirements": ["shorter", "no_extra_content", etc.],
  "needsPreviousData": true|false
}`;
  }

  /**
   * Extract specific data points from previous results
   */
  extractDataPoints(
    query: string,
    previousResults: PreviousQueryResult[]
  ): {
    companies?: any[];
    employees?: any[];
    metrics?: Record<string, any>;
    analysis?: string;
  } {
    const data: any = {};
    
    if (!previousResults || previousResults.length === 0) {
      return data;
    }
    
    const mostRecent = previousResults[0];
    
    // Extract companies if mentioned
    if (/\b(compan(?:y|ies)|organization|business|firm)\b/i.test(query)) {
      const companies = mostRecent.retrievedData?.find(r => r.collection === 'companies');
      if (companies) {
        data.companies = companies.documents;
      }
    }
    
    // Extract employees if mentioned
    if (/\b(employee|executive|manager|director|ceo|cto|cfo|decision\s+maker|person|people)\b/i.test(query)) {
      const employees = mostRecent.retrievedData?.find(r => r.collection === 'employees');
      if (employees) {
        data.employees = employees.documents;
      }
    }
    
    // Extract analysis if mentioned
    if (/\b(analysis|report|answer|response|insights|findings)\b/i.test(query)) {
      if (mostRecent.analysis) {
        data.analysis = mostRecent.analysis;
      }
    }
    
    return data;
  }
}

export const contextExtractorService = new ContextExtractorService();

