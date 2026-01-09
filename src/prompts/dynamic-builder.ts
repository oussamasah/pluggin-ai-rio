import { GraphState, MemoryContext } from '../types/graph';
import { SYSTEM_PROMPTS } from './system-prompts';
import { schemaService } from '../services/schema.service';
import { logger } from '../core/logger';

export class DynamicPromptBuilder {
  buildPlannerPrompt(
    query: string,
    memory: MemoryContext,
    userId: string,
    queryContext?: string,
    previousResults?: Array<{
      query: string;
      timestamp: Date;
      retrievedData: any[];
      flattenedData: Record<string, any>[];
      analysis?: string;
      summary: { companies: number; employees: number; other: number };
    }>
  ): string {
    let prompt = SYSTEM_PROMPTS.PLANNER;

    // OPTIMIZATION 7: Enhanced memory context in prompts
    if (memory.facts.length > 0) {
      prompt += '\n\n=== RELEVANT MEMORY (User Context) ===\n';
      memory.facts.slice(0, 5).forEach(fact => {
        prompt += `- ${fact.content} (confidence: ${(fact.confidence * 100).toFixed(0)}%)\n`;
      });
    }

    if (Object.keys(memory.entities).length > 0) {
      prompt += '\n\n=== KNOWN ENTITIES ===\n';
      Object.entries(memory.entities).forEach(([type, values]) => {
        const valuesList = Array.isArray(values) ? values : [values];
        const uniqueValues = valuesList
          .map((v: any) => typeof v === 'object' ? v.value : v)
          .filter((v: any, idx: number, arr: any[]) => arr.indexOf(v) === idx)
          .slice(0, 5);
        prompt += `- ${type}: ${uniqueValues.join(', ')}\n`;
      });
    }

    // OPTIMIZATION 8: Include user preferences and personal info
    if (Object.keys(memory.preferences).length > 0) {
      prompt += '\n\n=== USER PREFERENCES & PERSONAL INFO ===\n';
      Object.entries(memory.preferences).forEach(([key, value]) => {
        prompt += `- ${key}: ${value}\n`;
      });
      prompt += '\nIMPORTANT: Use this information to personalize responses. For example, if user_name is stored, use it in greetings.\n';
    }

    // OPTIMIZATION 9: Include conversation history for context
    if (memory.conversationHistory && memory.conversationHistory.length > 0) {
      prompt += '\n\n=== RECENT CONVERSATION HISTORY ===\n';
      memory.conversationHistory.slice(0, 5).forEach((turn, idx) => {
        prompt += `${idx + 1}. ${turn.role}: "${turn.content.substring(0, 150)}${turn.content.length > 150 ? '...' : ''}"\n`;
      });
      prompt += '\nUse this history to understand the conversation flow and provide context-aware responses.\n';
    }

    // Add previous query results context
    if (previousResults && previousResults.length > 0) {
      prompt += '\n\n=== PREVIOUS QUERY RESULTS ===\n';
      prompt += 'The user may reference data from previous queries. Here are the most recent results:\n\n';
      
      previousResults.slice(0, 3).forEach((result, idx) => {
        prompt += `Previous Query ${idx + 1}: "${result.query}"\n`;
        prompt += `Summary: ${result.summary.companies} companies, ${result.summary.employees} employees\n`;
        
        // OPTIMIZATION 10: Enhanced analysis context for better reuse
        if (result.analysis) {
          prompt += `Analysis Preview: ${result.analysis.substring(0, 500)}...\n`;
          prompt += `Analysis Length: ${result.analysis.length} characters\n`;
          // Extract key insights from analysis
          const insights = result.analysis.match(/(?:##|###|Key|Finding|Insight|Summary)[^\n]+/gi);
          if (insights && insights.length > 0) {
            prompt += `Key Insights: ${insights.slice(0, 3).join('; ')}\n`;
          }
        }
        
        // Extract key entities from previous results
        const companies = result.retrievedData.find(r => r.collection === 'companies');
        const employees = result.retrievedData.find(r => r.collection === 'employees');
        
        if (companies && companies.documents.length > 0) {
          prompt += `Companies found:\n`;
          companies.documents.slice(0, 5).forEach((doc: any) => {
            if (doc.name) {
              prompt += `  - ${doc.name} (ID: ${doc._id})\n`;
            }
          });
        }
        
        if (employees && employees.documents.length > 0) {
          prompt += `Employees found:\n`;
          employees.documents.slice(0, 5).forEach((doc: any) => {
            if (doc.fullName) {
              prompt += `  - ${doc.fullName}${doc.activeExperienceTitle ? ` (${doc.activeExperienceTitle})` : ''} (ID: ${doc._id})\n`;
            }
          });
        }
        prompt += '\n';
      });
      
      prompt += 'IMPORTANT: If the user says "this ceo", "that company", "the employee", "previous results", "previous answer", "the analysis", "those results", etc.,\n';
      prompt += 'they are referring to the entities and data listed above. Use the IDs from previous results in your query filters.\n';
      prompt += 'If user asks about "previous answer" or "the analysis", use the analysis preview above to understand what was discussed.\n';
      prompt += '\n=== CRITICAL: EMPLOYEE NAME DETECTION ===\n';
      prompt += 'When the user mentions a specific person\'s name (e.g., "Casey Nolte", "Francis Dayapan", "John Smith"),\n';
      prompt += 'you MUST:\n';
      prompt += '1. Extract the full name from the query\n';
      prompt += '2. Add it to the employee query as: {"fullName": {"$regex": "Extracted Name", "$options": "i"}}\n';
      prompt += '3. Use "fullName" field (NOT "name" - employees use "fullName")\n';
      prompt += '4. If query also mentions company, you may need to fetch employee first, then hop to company\n';
      prompt += 'Examples:\n';
      prompt += '  - "analysis of Casey Nolte profile" → Extract "Casey Nolte", add {"fullName": {"$regex": "Casey Nolte", "$options": "i"}}\n';
      prompt += '  - "give analysis of John Smith and his company" → Extract "John Smith", fetch employee, then hop to company\n';
      prompt += '  - "Francis Dayapan profile" → Extract "Francis Dayapan", add {"fullName": {"$regex": "Francis Dayapan", "$options": "i"}}\n';
    }

    if (queryContext) {
      prompt += `\n\nPARSED QUERY CONTEXT:\n${queryContext}`;
    }

    prompt += `\n\nUSER ID: ${userId}`;
    prompt += `\n\nCURRENT QUERY: "${query}"`;

    prompt += '\n\nAnalyze this query and respond with the JSON plan.';

    return prompt;
  }

  buildRetrieverPrompt(
    state: GraphState,
    retrievedData: any[]
  ): string {
    let prompt = 'RETRIEVED DATA SUMMARY:\n\n';

    state.retrievedData.forEach(result => {
      prompt += `Collection: ${result.collection}\n`;
      prompt += `Documents: ${result.documents.length}\n`;
      prompt += `Search Method: ${result.metadata.searchMethod}\n`;
      prompt += `Confidence: ${result.metadata.confidence}\n\n`;
    });

    prompt += `Total documents retrieved: ${retrievedData.length}\n`;
    
    return prompt;
  }

  buildAnalyzerPrompt(
    query: string,
    retrievedData: any[],
    intent: string,
    isAggregation: boolean = false
  ): string {
    let prompt = SYSTEM_PROMPTS.ANALYZER;

    prompt += `\n\nUSER QUERY: "${query}"`;
    prompt += `\n\nQUERY INTENT: ${intent}`;
    prompt += `\n\nIS AGGREGATION: ${isAggregation}`;
    
    // DYNAMIC FIELD MATCHING: Use field matcher to detect relevant fields
    let fieldDescriptions = '';
    let isIntentScoreQuery = false;
    let isFitScoreQuery = false;
    let queryContext = 'general_query';
    
    try {
      const { getFieldMatcher } = require('../services/field-matcher.service');
      const { schemaService } = require('../services/schema.service');
      const fieldMatcher = getFieldMatcher(schemaService);
      
      const matches = fieldMatcher.matchQueryToFields(query, ['companies', 'employees']);
      if (matches.length > 0 && matches[0].matchedFields.length > 0) {
        // Get field descriptions for prompt
        fieldDescriptions = fieldMatcher.getFieldDescriptionsForPrompt(
          matches[0].collection,
          matches[0].matchedFields
        );
        
        // Determine query context
        queryContext = matches[0].queryContext;
        isIntentScoreQuery = queryContext === 'intent_score_query';
        isFitScoreQuery = queryContext === 'fit_score_query';
        
        logger.debug('Dynamic field matching completed', {
          collection: matches[0].collection,
          matchedFieldsCount: matches[0].matchedFields.length,
          queryContext,
          topFields: matches[0].matchedFields.slice(0, 3).map(m => m.field.name)
        });
      }
    } catch (error) {
      // Fallback to pattern matching
      logger.debug('Field matcher not available, using fallback pattern matching', { error: (error as Error).message });
      isFitScoreQuery = /\b(fit\s+score|sorted\s+by\s+fit|fit\s+sorted)\b/i.test(query);
      isIntentScoreQuery = /\b(intent\s+score|intent_score|buying\s+intent|intent\s+analysis|intent\s+signals|details.*intent|about.*intent)\b/i.test(query);
    }
    
    // Add field descriptions to prompt if available
    if (fieldDescriptions) {
      prompt += fieldDescriptions;
    }
    
    // Extract "top N" from query to enforce limit
    const topNMatch = query.match(/\b(top|find|get|show)\s+(\d+)\b/i);
    const requestedCount = topNMatch ? parseInt(topNMatch[2], 10) : null;
    
    // Check if this is a decision maker query
    const isDecisionMakerQuery = /\b(decision\s+maker|decision\s+makers|executive|executives|ceo|cto|cfo|manager|director)\b/i.test(query);
    const requestsTable = /\b(table|in\s+table|as\s+table|format.*table)\b/i.test(query);
    
    if (requestedCount) {
      prompt += `\n\n⚠️⚠️⚠️ CRITICAL: USER REQUESTED TOP ${requestedCount} ⚠️⚠️⚠️`;
      prompt += `\n- You MUST analyze ONLY the first ${requestedCount} items from retrievedData`;
      prompt += `\n- If retrievedData has more than ${requestedCount} items, IGNORE the rest`;
      prompt += `\n- NEVER mention "Total Companies Analyzed: X" if X > ${requestedCount}`;
      prompt += `\n- If you have fewer than ${requestedCount} items, report the exact count you have`;
      prompt += `\n- Example: If user asks "top 5" but you have 18 items, analyze ONLY the first 5 (sorted by fit score)`;
    }
    
    if (isDecisionMakerQuery && requestsTable) {
      prompt += `\n\n⚠️⚠️⚠️ DECISION MAKER TABLE QUERY - CRITICAL FORMATTING REQUIREMENTS ⚠️⚠️⚠️`;
      prompt += `\n- User requested a TABLE of decision makers with company name and industry`;
      prompt += `\n- You MUST create a markdown table with columns: Decision Maker Name | Company Name | Industry | Title (if available)`;
      prompt += `\n- Match each employee (decision maker) with their company using companyId field`;
      prompt += `\n- If retrievedData has both companies and employees collections, join them by companyId`;
      prompt += `\n- Show ALL decision makers found, not just companies`;
      prompt += `\n- If company name or industry is missing, show "N/A"`;
      prompt += `\n- Example table format:`;
      prompt += `\n| Decision Maker Name | Company Name | Industry | Title |`;
      prompt += `\n|-------------------|--------------|----------|-------|`;
      prompt += `\n| John Doe | Acme Corp | Technology | CEO |`;
    }
    
    if (isIntentScoreQuery) {
      prompt += `\n\n🚨🚨🚨 INTENT SCORE QUERY - CRITICAL FOCUS REQUIREMENTS 🚨🚨🚨`;
      prompt += `\n- User specifically asked for "intent_score" details - you MUST focus EXCLUSIVELY on scoringMetrics.intent_score data`;
      prompt += `\n- DO NOT mention fit_score, fit score, or any other scoring metrics - ONLY intent_score`;
      prompt += `\n- DO NOT provide fit_score information as a substitute for missing intent_score data`;
      prompt += `\n- If intent_score data is missing: Clearly state it's not available and DO NOT discuss fit_score`;
      prompt += `\n- If intent_score data exists: Analyze and present the following intent_score components:`;
      prompt += `\n  1. analysis_metadata: final_intent_score, overall_confidence, total_events_detected, timeframe_analyzed`;
      prompt += `\n  2. signal_breakdown: Each signal's event_type, signal_name, weight_percentage, raw_score, weighted_contribution, confidence_level, events_detected`;
      prompt += `\n  3. gtm_intelligence: overall_buying_readiness (readiness_level, stage_in_buyers_journey, estimated_decision_timeline), timing_recommendation, messaging_strategy, stakeholder_targeting, risk_assessment`;
      prompt += `\n  4. offer_alignment_playbook: positioning_strategy, key_features_to_emphasize, relevant_use_case, objection_handling`;
      prompt += `\n- Present intent signals in a structured format (tables or sections)`;
      prompt += `\n- Include specific event details from signal_breakdown[].events_detected.events[]`;
      prompt += `\n- Provide actionable insights from gtm_intelligence recommendations`;
      prompt += `\n- If intent_score data is missing: State clearly that intent_score is not available and explain what it would contain. DO NOT mention fit_score.`;
      prompt += `\n- You can include brief company context (name, industry) but the PRIMARY focus must be on intent_score analysis ONLY`;
    }
    
    if (isFitScoreQuery) {
      prompt += `\n\n⚠️⚠️⚠️ FIT SCORE QUERY - CRITICAL FORMATTING REQUIREMENTS ⚠️⚠️⚠️`;
      prompt += `\n- You MUST create a table with columns: Rank | Company Name | Fit Score | Industry | Employees | Revenue (if available)`;
      prompt += `\n- Fit scores are NUMBERS (e.g., 62) NOT percentages (NOT 62%)`;
      prompt += `\n- Sort companies by fit score (highest first)`;
      prompt += `\n- Show fit scores clearly in the table`;
      prompt += `\n- If fit score is missing for a company, show "N/A" or exclude it`;
    }
    
    if (isAggregation) {
      prompt += '\n\n⚠️ THIS IS AGGREGATED DATA - Format as a clear table with totals and percentages';
    }

    // Count total documents by collection
    let totalDocs = 0;
    let companiesCount = 0;
    let employeesCount = 0;
    retrievedData.forEach((item: any) => {
      if (Array.isArray(item)) {
        totalDocs += item.length;
      } else if (item.documents && Array.isArray(item.documents)) {
        totalDocs += item.documents.length;
        if (item.collection === 'companies') {
          companiesCount = item.documents.length;
        } else if (item.collection === 'employees') {
          employeesCount = item.documents.length;
        }
      } else if (item.collection === 'companies' && item.documents) {
        companiesCount = item.documents.length;
        totalDocs += item.documents.length;
      } else if (item.collection === 'employees' && item.documents) {
        employeesCount = item.documents.length;
        totalDocs += item.documents.length;
      }
    });
    
    prompt += `\n\n⚠️⚠️⚠️ CRITICAL COUNT VERIFICATION ⚠️⚠️⚠️`;
    prompt += `\n- Total documents in retrievedData: ${totalDocs}`;
    if (companiesCount > 0) {
      prompt += `\n- Companies found: ${companiesCount} - DO NOT say "Zero Companies Found"`;
    }
    if (employeesCount > 0) {
      prompt += `\n- Employees/Decision Makers found: ${employeesCount}`;
    }
    prompt += `\n- You MUST report EXACTLY ${totalDocs} total items in your analysis`;
    if (companiesCount > 0) {
      prompt += `\n- If you say "Total Companies Analyzed: X", X MUST equal ${companiesCount}`;
    }
    prompt += `\n- NEVER report "Zero Companies Found" if companies exist in retrievedData (${companiesCount} companies found)`;
    prompt += `\n- NEVER report a different count (e.g., ${totalDocs + 1} or ${totalDocs - 1})`;
    prompt += `\n- Count the documents yourself: ${totalDocs} documents = ${totalDocs} items`;
    prompt += `\n\nRETRIEVED DATA (Total documents: ${totalDocs}, Companies: ${companiesCount}, Employees: ${employeesCount}):\n`;
    
    // If "top N" is requested, limit the data shown to first N
    if (requestedCount && totalDocs > requestedCount) {
      prompt += `\n⚠️ WARNING: ${totalDocs} documents retrieved, but user requested top ${requestedCount}. `;
      prompt += `You MUST analyze ONLY the first ${requestedCount} items (sorted by fit score).\n`;
      
      // Limit the data to first N items
      const limitedData = retrievedData.map((item: any) => {
        if (Array.isArray(item)) {
          return item.slice(0, requestedCount);
        } else if (item.documents && Array.isArray(item.documents)) {
          return { ...item, documents: item.documents.slice(0, requestedCount) };
        }
        return item;
      });
      prompt += JSON.stringify(limitedData, null, 2);
    } else {
      prompt += JSON.stringify(retrievedData, null, 2);
    }

    prompt += '\n\nProvide your analysis in markdown format.';
    prompt += '\n\nREMEMBER: Only use data from the retrievedData above. NEVER invent companies or numbers.';

    return prompt;
  }

  buildCriticPrompt(
    proposedAnswer: string,
    rawData: any[]
  ): string {
    let prompt = SYSTEM_PROMPTS.CRITIC;

    prompt += '\n\nPROPOSED ANSWER:\n';
    prompt += proposedAnswer;

    prompt += '\n\nRAW DATA FOR VERIFICATION:\n';
    prompt += JSON.stringify(rawData, null, 2);

    prompt += '\n\nValidate the answer and respond with the JSON validation result.';

    return prompt;
  }

  buildExecutorPrompt(
    query: string,
    analysis: string,
    intent: any,
    retrievedData?: any[],
    previousAnalysis?: string // OPTIMIZATION: Pass previous analysis for email generation from reports
  ): string {
    let prompt = SYSTEM_PROMPTS.EXECUTOR;

    prompt += `\n\nUSER QUERY: "${query}"`;
    
    // OPTIMIZATION: Use previous analysis if query references it (e.g., "create email from this analysis")
    const referencesPreviousAnalysis = /\b(this|that|the|previous)\s+(analysis|report|answer|context)\b/i.test(query) ||
                                       /\b(from|based on|using)\s+(this|that|the|previous)\s+(analysis|report|answer)\b/i.test(query);
    
    if (referencesPreviousAnalysis && previousAnalysis) {
      prompt += `\n\n⚠️⚠️⚠️ CRITICAL: User is requesting action based on PREVIOUS ANALYSIS/REPORT ⚠️⚠️⚠️`;
      prompt += `\nThe user wants to use the following previous analysis/report for this action:\n\n`;
      prompt += `PREVIOUS ANALYSIS:\n${previousAnalysis.substring(0, 2000)}\n\n`;
      prompt += `\nYou MUST use this previous analysis as the primary context for generating the requested output (e.g., email sequence).\n`;
      prompt += `The current analysis below is from the current query, but the user wants output based on the PREVIOUS analysis above.\n\n`;
    }
    
    prompt += `\n\nCURRENT ANALYSIS: ${analysis}`;
    prompt += `\n\nREQUIRED ACTIONS: ${JSON.stringify(intent.actions)}`;
    
    // Include retrieved data for CRM actions
    if (retrievedData && retrievedData.length > 0) {
      prompt += `\n\nRETRIEVED DATA FOR ACTION:\n`;
      const companies = retrievedData.find((r: any) => r.collection === 'companies');
      if (companies && companies.documents) {
        prompt += `\nCompanies to process (${companies.documents.length}):\n`;
        companies.documents.slice(0, 10).forEach((doc: any) => {
          prompt += `- ${doc.name || 'Unknown'} (ID: ${doc._id})\n`;
          if (doc.industry) prompt += `  Industry: ${Array.isArray(doc.industry) ? doc.industry.join(', ') : doc.industry}\n`;
          if (doc.employeeCount) prompt += `  Employees: ${doc.employeeCount}\n`;
          if (doc.annualRevenue) prompt += `  Revenue: $${doc.annualRevenue}\n`;
        });
      }
    }
    
    // Add CRM-specific instructions
    if (intent.actions && intent.actions.includes('crm_create_contact')) {
      prompt += `\n\n⚠️⚠️⚠️ CRM ACTION REQUIRED ⚠️⚠️⚠️`;
      prompt += `\n- You need to create CRM contacts for the companies listed above`;
      prompt += `\n- Use the Composio service: composioService.createCRMContact()`;
      prompt += `\n- CRM Type: ${intent.crmType || 'salesforce'}`;
      prompt += `\n- For each company, create a contact with: name, industry, employeeCount, annualRevenue`;
      prompt += `\n- Format: { tool: 'salesforce' or 'hubspot', action: 'SALESFORCE_CREATE_CONTACT' or 'HUBSPOT_CREATE_CONTACT', parameters: { ...company data }, requiresConfirmation: true }`;
      prompt += `\n- CRITICAL: ALL CRM actions MUST have requiresConfirmation: true`;
      prompt += `\n- Generate one action per company in the retrieved data`;
    }

    prompt += '\n\nGenerate the action execution plan as JSON.';

    return prompt;
  }

/**
 * Enhanced buildResponderPrompt with output format detection
 * Adapts to user needs: emails, templates, tables, breakdowns, etc.
 */

/**
 * Detects what OUTPUT the user actually wants
 */
private detectOutputRequirement(query: string): {
  outputType: 'email' | 'template' | 'table' | 'breakdown' | 'report' | 'script' | 'strategy' | 'data_display';
  requiresCreativeWork: boolean;
  requiresPersonalization: boolean;
  actionVerbs: string[];
  context: string;
} {
  const lowerQuery = query.toLowerCase();
  
  // Email/message generation
  const emailPatterns = [
    /generate.*email/i, /create.*email/i, /write.*email/i, /draft.*email/i,
    /email.*sequence/i, /cold.*email/i, /outreach.*email/i, /personalized.*email/i,
    /send.*email/i, /email.*template/i, /compose.*email/i
  ];
  
  // Template/document generation
  const templatePatterns = [
    /generate.*template/i, /create.*template/i, /build.*template/i,
    /template.*for/i, /draft.*template/i, /design.*template/i
  ];
  
  // Table/structured output
  const tablePatterns = [
    /\bin.*table/i, /as.*table/i, /show.*table/i, /create.*table/i,
    /table.*format/i, /tabular/i, /spreadsheet/i
  ];
  
  // Breakdown/summary
  const breakdownPatterns = [
    /break.*down/i, /breakdown/i, /step.*by.*step/i, /outline/i,
    /summarize/i, /summary/i, /key.*points/i
  ];
  
  // Script/sequence generation
  const scriptPatterns = [
    /script/i, /sequence/i, /cadence/i, /workflow/i, /playbook/i
  ];
  
  // Strategy/plan generation
  const strategyPatterns = [
    /strategy/i, /plan/i, /approach/i, /tactic/i, /campaign/i
  ];
  
  // Check for personalization requirements
  const needsPersonalization = /personalized|customize|tailor|specific to|based on|using.*profile|depends on/i.test(lowerQuery);
  
  // Check for action verbs that indicate creative work
  const creativeVerbs = lowerQuery.match(/\b(generate|create|write|draft|build|design|compose|craft|develop)\b/gi) || [];
  
  // Detect output type
  for (const pattern of emailPatterns) {
    if (pattern.test(lowerQuery)) {
      return {
        outputType: 'email',
        requiresCreativeWork: true,
        requiresPersonalization: needsPersonalization,
        actionVerbs: creativeVerbs,
        context: 'User wants a complete, ready-to-send email'
      };
    }
  }
  
  for (const pattern of templatePatterns) {
    if (pattern.test(lowerQuery)) {
      return {
        outputType: 'template',
        requiresCreativeWork: true,
        requiresPersonalization: needsPersonalization,
        actionVerbs: creativeVerbs,
        context: 'User wants a reusable template structure'
      };
    }
  }
  
  for (const pattern of tablePatterns) {
    if (pattern.test(lowerQuery)) {
      return {
        outputType: 'table',
        requiresCreativeWork: false,
        requiresPersonalization: false,
        actionVerbs: creativeVerbs,
        context: 'User wants structured tabular data'
      };
    }
  }
  
  for (const pattern of breakdownPatterns) {
    if (pattern.test(lowerQuery)) {
      return {
        outputType: 'breakdown',
        requiresCreativeWork: false,
        requiresPersonalization: false,
        actionVerbs: creativeVerbs,
        context: 'User wants organized breakdown/summary'
      };
    }
  }
  
  for (const pattern of scriptPatterns) {
    if (pattern.test(lowerQuery)) {
      return {
        outputType: 'script',
        requiresCreativeWork: true,
        requiresPersonalization: needsPersonalization,
        actionVerbs: creativeVerbs,
        context: 'User wants a sequential script/cadence'
      };
    }
  }
  
  for (const pattern of strategyPatterns) {
    if (pattern.test(lowerQuery)) {
      return {
        outputType: 'strategy',
        requiresCreativeWork: true,
        requiresPersonalization: needsPersonalization,
        actionVerbs: creativeVerbs,
        context: 'User wants strategic plan/approach'
      };
    }
  }
  
  // Default to data display
  return {
    outputType: 'data_display',
    requiresCreativeWork: false,
    requiresPersonalization: false,
    actionVerbs: creativeVerbs,
    context: 'User wants information displayed'
  };
}

/**
 * Extracts personalization context from query
 */
private extractPersonalizationContext(query: string, retrievedData?: any[]): {
  targetPerson?: { name: string; title?: string; company?: string };
  targetCompany?: { name: string; industry?: string };
  productInfo?: string;
  useCase?: string;
} {
  const context: any = {};
  
  // Extract product/solution info
  const productMatch = query.match(/(?:selling|offer|provide|solution|product)[\s\S]*?(?:ai|automation|software|platform|tool|service)[\s\S]{0,100}/i);
  if (productMatch) {
    context.productInfo = productMatch[0];
  }
  
  // Extract person from retrieved data
  if (retrievedData) {
    const employees = retrievedData.find((item: any) => item.collection === 'employees');
    if (employees && employees.documents && employees.documents.length > 0) {
      const person = employees.documents[0];
      context.targetPerson = {
        name: person.fullName || person.name,
        title: person.activeExperienceTitle || person.title,
        company: person.activeExperienceCompany || person.company
      };
    }
    
    // Extract company
    const companies = retrievedData.find((item: any) => item.collection === 'companies');
    if (companies && companies.documents && companies.documents.length > 0) {
      const company = companies.documents[0];
      context.targetCompany = {
        name: company.name,
        industry: Array.isArray(company.industry) ? company.industry[0] : company.industry
      };
    }
  }
  
  return context;
}

/**
 * Builds output-specific guidance
 */
private buildOutputSpecificGuidance(
  outputReq: ReturnType<typeof this.detectOutputRequirement>,
  personalizationContext: ReturnType<typeof this.extractPersonalizationContext>,
  dataMetrics: ReturnType<typeof this.extractDataMetrics>
): string {
  let guidance = '\n\n🎯 OUTPUT REQUIREMENT DETECTED';
  guidance += '\n' + '═'.repeat(70);
  guidance += `\n\nUser wants: ${outputReq.outputType.toUpperCase()}`;
  guidance += `\nContext: ${outputReq.context}`;
  guidance += `\nRequires Creative Work: ${outputReq.requiresCreativeWork ? 'YES' : 'NO'}`;
  guidance += `\nRequires Personalization: ${outputReq.requiresPersonalization ? 'YES' : 'NO'}`;
  guidance += '\n';
  
  switch (outputReq.outputType) {
    case 'email':
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n📧 EMAIL GENERATION REQUIREMENTS';
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n';
      guidance += '\n✅ WHAT TO DELIVER:';
      guidance += '\n   • Complete, ready-to-send email (not a description of an email)';
      guidance += '\n   • Subject line + email body';
      guidance += '\n   • Professional formatting with proper structure';
      guidance += '\n   • Personalized content based on recipient data';
      guidance += '\n   • Clear call-to-action';
      guidance += '\n';
      guidance += '\n📝 EMAIL STRUCTURE:';
      guidance += '\n';
      guidance += '\n**Subject:** [Compelling, personalized subject line]';
      guidance += '\n';
      guidance += '\nHi [Name],';
      guidance += '\n';
      guidance += '\n[Opening paragraph: Personalized hook based on their profile/company]';
      guidance += '\n';
      guidance += '\n[Body paragraph 1: Relevant pain point or opportunity]';
      guidance += '\n';
      guidance += '\n[Body paragraph 2: Solution positioning with value proposition]';
      guidance += '\n';
      guidance += '\n[Closing: Clear, specific call-to-action]';
      guidance += '\n';
      guidance += '\nBest regards,';
      guidance += '\n[Sender signature]';
      guidance += '\n';
      
      if (personalizationContext.targetPerson) {
        guidance += '\n🎯 PERSONALIZATION REQUIREMENTS:';
        guidance += `\n   • Recipient: ${personalizationContext.targetPerson.name}`;
        if (personalizationContext.targetPerson.title) {
          guidance += `\n   • Title: ${personalizationContext.targetPerson.title}`;
        }
        if (personalizationContext.targetPerson.company) {
          guidance += `\n   • Company: ${personalizationContext.targetPerson.company}`;
        }
        guidance += '\n';
        guidance += '\n   → Reference their specific role and responsibilities';
        guidance += '\n   → Mention their company by name';
        guidance += '\n   → Connect solution to their industry/use case';
      }
      
      if (personalizationContext.targetCompany) {
        guidance += '\n';
        guidance += '\n🏢 COMPANY CONTEXT TO USE:';
        guidance += `\n   • Company: ${personalizationContext.targetCompany.name}`;
        if (personalizationContext.targetCompany.industry) {
          guidance += `\n   • Industry: ${personalizationContext.targetCompany.industry}`;
        }
        guidance += '\n   → Reference industry-specific challenges';
        guidance += '\n   → Mention company size/scale implications';
      }
      
      if (personalizationContext.productInfo) {
        guidance += '\n';
        guidance += '\n💼 PRODUCT/SOLUTION INFO:';
        guidance += `\n   ${personalizationContext.productInfo}`;
        guidance += '\n';
        guidance += '\n   → Position product benefits for their specific needs';
        guidance += '\n   → Use industry-appropriate language';
        guidance += '\n   → Quantify value when possible';
      }
      
      guidance += '\n';
      guidance += '\n⚡ COLD EMAIL BEST PRACTICES:';
      guidance += '\n   1. Keep it under 150 words (short & scannable)';
      guidance += '\n   2. Lead with value, not features';
      guidance += '\n   3. Include ONE clear ask/CTA';
      guidance += '\n   4. Use conversational, professional tone';
      guidance += '\n   5. Avoid salesy language and hype';
      guidance += '\n   6. Make it about THEM, not you';
      guidance += '\n';
      guidance += '\n❌ DO NOT:';
      guidance += '\n   • Write "Here\'s an email template..." - WRITE THE ACTUAL EMAIL';
      guidance += '\n   • Use [PLACEHOLDER] - use actual names/data from retrieved info';
      guidance += '\n   • Describe what the email should contain - CREATE IT';
      guidance += '\n   • Include meta-commentary about the email';
      guidance += '\n';
      guidance += '\n✅ EXAMPLE FORMAT:';
      guidance += '\n';
      guidance += '\n**Subject:** Quick question about [Company]\'s [relevant process]';
      guidance += '\n';
      guidance += '\nHi Francis,';
      guidance += '\n';
      guidance += '\nI noticed Salama is expanding in [specific area]. Most [role] leaders';
      guidance += '\nwe work with struggle with [specific pain point].';
      guidance += '\n';
      guidance += '\nWe help [similar companies] [specific outcome] through [brief solution].';
      guidance += '\n[Company X] saw [specific result] in [timeframe].';
      guidance += '\n';
      guidance += '\nWorth a 15-minute conversation next week?';
      guidance += '\n';
      guidance += '\nBest,';
      guidance += '\n[Name]';
      break;
      
    case 'template':
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n📄 TEMPLATE GENERATION REQUIREMENTS';
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n';
      guidance += '\n✅ WHAT TO DELIVER:';
      guidance += '\n   • Reusable template structure with [PLACEHOLDERS]';
      guidance += '\n   • Clear instructions for customization';
      guidance += '\n   • Multiple variations if applicable';
      guidance += '\n   • Example of filled-out version';
      guidance += '\n';
      guidance += '\n📝 Include:';
      guidance += '\n   • [RECIPIENT_NAME], [COMPANY_NAME], etc. placeholders';
      guidance += '\n   • Instructions: "Replace [X] with..."';
      guidance += '\n   • Customization tips';
      break;
      
    case 'table':
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n📊 TABLE FORMAT REQUIREMENTS';
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n';
      guidance += '\n✅ WHAT TO DELIVER:';
      guidance += '\n   • Properly formatted markdown table';
      guidance += '\n   • All relevant data columns';
      guidance += '\n   • Clear headers';
      guidance += '\n   • Optional: Brief context before/after table';
      guidance += '\n';
      guidance += '\n📝 Table Format:';
      guidance += '\n   | Column 1 | Column 2 | Column 3 |';
      guidance += '\n   |----------|----------|----------|';
      guidance += '\n   | Data     | Data     | Data     |';
      break;
      
    case 'breakdown':
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n📋 BREAKDOWN FORMAT REQUIREMENTS';
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n';
      guidance += '\n✅ WHAT TO DELIVER:';
      guidance += '\n   • Organized bullet points or numbered steps';
      guidance += '\n   • Clear sections with headers';
      guidance += '\n   • Scannable, easy-to-follow format';
      guidance += '\n   • Actionable items when relevant';
      guidance += '\n';
      guidance += '\n📝 Use Structure:';
      guidance += '\n   ## Main Category';
      guidance += '\n   - Item 1: Description';
      guidance += '\n   - Item 2: Description';
      break;
      
    case 'script':
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n🎬 SCRIPT/SEQUENCE REQUIREMENTS';
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n';
      guidance += '\n✅ WHAT TO DELIVER:';
      guidance += '\n   • Step-by-step sequence or cadence';
      guidance += '\n   • Numbered steps in order';
      guidance += '\n   • Timing/triggers for each step';
      guidance += '\n   • Actual content for each touchpoint';
      guidance += '\n';
      guidance += '\n📝 Sequence Format:';
      guidance += '\n   **Day 1:** [Action] - [Content/Template]';
      guidance += '\n   **Day 3:** [Follow-up] - [Content/Template]';
      guidance += '\n   **Day 7:** [Next step] - [Content/Template]';
      break;
      
    case 'strategy':
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n🎯 STRATEGY/PLAN REQUIREMENTS';
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n';
      guidance += '\n✅ WHAT TO DELIVER:';
      guidance += '\n   • Strategic approach outline';
      guidance += '\n   • Clear objectives';
      guidance += '\n   • Tactical recommendations';
      guidance += '\n   • Implementation steps';
      guidance += '\n   • Success metrics';
      guidance += '\n';
      guidance += '\n📝 Include Sections:';
      guidance += '\n   ## Objective';
      guidance += '\n   ## Strategy';
      guidance += '\n   ## Tactics';
      guidance += '\n   ## Timeline';
      guidance += '\n   ## Success Metrics';
      break;
      
    case 'data_display':
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n📊 DATA DISPLAY REQUIREMENTS';
      guidance += '\n' + '─'.repeat(70);
      guidance += '\n';
      guidance += '\n✅ WHAT TO DELIVER:';
      guidance += '\n   • Information from retrieved data';
      guidance += '\n   • Format based on complexity (prose, bullets, table)';
      guidance += '\n   • Context and insights';
      guidance += '\n   • Actionable recommendations';
      break;
  }
  
  return guidance;
}

/**
 * Extracts key metrics from retrieved data
 */
private extractDataMetrics(retrievedData?: any[]): {
  totalCompanies: number;
  totalEmployees: number;
  totalOpportunities: number;
  fitScoreRange: { min: number; max: number; avg: number } | null;
  industries: string[];
  topCompanies: Array<{ name: string; fitScore?: number }>;
  hasDecisionMakers: boolean;
  hasPipelineData: boolean;
} {
  const metrics = {
    totalCompanies: 0,
    totalEmployees: 0,
    totalOpportunities: 0,
    fitScoreRange: null as any,
    industries: [] as string[],
    topCompanies: [] as any[],
    hasDecisionMakers: false,
    hasPipelineData: false
  };

  if (!retrievedData) return metrics;

  const fitScores: number[] = [];
  const industriesSet = new Set<string>();
  const companiesWithScores: any[] = [];

  retrievedData.forEach((item: any) => {
    if (item.collection === 'companies' && item.documents) {
      metrics.totalCompanies = item.documents.length;
      item.documents.forEach((doc: any) => {
        if (doc.scoringMetrics?.fit_score?.score !== undefined) {
          fitScores.push(doc.scoringMetrics.fit_score.score);
          companiesWithScores.push({ name: doc.name, fitScore: doc.scoringMetrics.fit_score.score });
        }
        if (doc.industry) {
          const inds = Array.isArray(doc.industry) ? doc.industry : [doc.industry];
          inds.forEach((i: string) => industriesSet.add(i));
        }
      });
    } else if (item.collection === 'employees' && item.documents) {
      metrics.totalEmployees = item.documents.length;
      metrics.hasDecisionMakers = true;
    } else if (item.collection === 'opportunities' && item.documents) {
      metrics.totalOpportunities = item.documents.length;
      metrics.hasPipelineData = true;
    }
  });

  if (fitScores.length > 0) {
    metrics.fitScoreRange = {
      min: Math.min(...fitScores),
      max: Math.max(...fitScores),
      avg: Math.round(fitScores.reduce((a, b) => a + b, 0) / fitScores.length)
    };
  }

  metrics.topCompanies = companiesWithScores.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0)).slice(0, 5);
  metrics.industries = Array.from(industriesSet);

  return metrics;
}

/**
 * Detects query intent for format
 */
private detectQueryIntent(query: string): {
  type: 'analysis' | 'comparison' | 'recommendation' | 'list' | 'profile' | 'overview';
  keywords: string[];
  requiresNarrative: boolean;
} {
  const lowerQuery = query.toLowerCase();
  const analysisKeywords = ['analyze', 'analysis', 'insights', 'examine', 'assess', 'evaluate'];
  const comparisonKeywords = ['compare', 'vs', 'rank', 'top', 'best'];
  const recommendationKeywords = ['recommend', 'advise', 'suggest', 'prioritize'];
  const listKeywords = ['list', 'show me', 'find', 'display'];
  const profileKeywords = ['tell me about', 'profile', 'who is'];
  const overviewKeywords = ['overview', 'summary', 'snapshot'];
  
  for (const kw of analysisKeywords) {
    if (lowerQuery.includes(kw)) {
      return { type: 'analysis', keywords: [kw], requiresNarrative: true };
    }
  }
  for (const kw of comparisonKeywords) {
    if (lowerQuery.includes(kw)) return { type: 'comparison', keywords: [kw], requiresNarrative: false };
  }
  for (const kw of recommendationKeywords) {
    if (lowerQuery.includes(kw)) return { type: 'recommendation', keywords: [kw], requiresNarrative: false };
  }
  for (const kw of profileKeywords) {
    if (lowerQuery.includes(kw)) return { type: 'profile', keywords: [kw], requiresNarrative: false };
  }
  for (const kw of overviewKeywords) {
    if (lowerQuery.includes(kw)) return { type: 'overview', keywords: [kw], requiresNarrative: false };
  }
  for (const kw of listKeywords) {
    if (lowerQuery.includes(kw)) return { type: 'list', keywords: [kw], requiresNarrative: false };
  }
  
  return { type: 'list', keywords: [], requiresNarrative: false };
}

/**
 * Formats retrieved data
 */
private formatRetrievedData(retrievedData: any[]): string {
  let dataSection = '\n\n═══════════════════════════════════════════════════';
  dataSection += '\n      RETRIEVED DATA FOR PERSONALIZATION';
  dataSection += '\n═══════════════════════════════════════════════════\n';

  retrievedData.forEach((item: any) => {
    if (item.collection === 'companies' && item.documents) {
      dataSection += `\n📊 COMPANIES (${item.documents.length}):\n`;
      item.documents.forEach((doc: any, idx: number) => {
        dataSection += `\n${idx + 1}. **${doc.name || 'Unknown'}**`;
        if (doc.industry) dataSection += `\n   Industry: ${Array.isArray(doc.industry) ? doc.industry.join(', ') : doc.industry}`;
        if (doc.employeeCount) dataSection += `\n   Employees: ${doc.employeeCount}`;
        if (doc.annualRevenue) dataSection += `\n   Revenue: $${doc.annualRevenue}`;
        if (doc.description) dataSection += `\n   Description: ${doc.description.substring(0, 150)}...`;
        dataSection += '\n';
      });
    } else if (item.collection === 'employees' && item.documents) {
      dataSection += `\n👤 DECISION MAKERS (${item.documents.length}):\n`;
      item.documents.forEach((doc: any, idx: number) => {
        dataSection += `\n${idx + 1}. **${doc.fullName || doc.name || 'Unknown'}**`;
        if (doc.activeExperienceTitle) dataSection += `\n   Title: ${doc.activeExperienceTitle}`;
        if (doc.activeExperienceCompany) dataSection += `\n   Company: ${doc.activeExperienceCompany}`;
        if (doc.seniority) dataSection += `\n   Seniority: ${doc.seniority}`;
        if (doc.linkedInUrl) dataSection += `\n   LinkedIn: ${doc.linkedInUrl}`;
        dataSection += '\n';
      });
    }
  });

  return dataSection;
}

/**
 * Main buildResponderPrompt - output-aware
 */
buildResponderPrompt(
  query: string,
  analysis: string,
  executedActions: any[],
  retrievedData?: any[],
  memory?: MemoryContext,
  previousResults?: Array<{
    query: string;
    timestamp: Date;
    retrievedData: any[];
    flattenedData: Record<string, any>[];
    analysis?: string;
    finalAnswer?: string; // OPTIMIZATION: Include finalAnswer for rewrite queries
    summary: { companies: number; employees: number; other: number };
  }>,
  previousEmailContent?: string, // OPTIMIZATION: Previous email content for rewrite queries
  senderName?: string // OPTIMIZATION: Sender name for email signature replacement
): string {
  let prompt = SYSTEM_PROMPTS.RESPONDER;

  // OPTIMIZATION 14: Include memory context for personalized responses
  if (memory) {
    if (memory.preferences && Object.keys(memory.preferences).length > 0) {
      prompt += '\n\n=== USER CONTEXT ===\n';
      if (memory.preferences.user_name) {
        prompt += `User's name: ${memory.preferences.user_name}\n`;
        prompt += 'IMPORTANT: Use the user\'s name naturally in your response when appropriate.\n';
      }
      if (memory.preferences.user_company) {
        prompt += `User's company: ${memory.preferences.user_company}\n`;
      }
      if (memory.preferences.user_role) {
        prompt += `User's role: ${memory.preferences.user_role}\n`;
      }
      Object.entries(memory.preferences).forEach(([key, value]) => {
        if (!['user_name', 'user_company', 'user_role'].includes(key)) {
          prompt += `${key}: ${value}\n`;
        }
      });
    }

    if (memory.conversationHistory && memory.conversationHistory.length > 0) {
      prompt += '\n\n=== CONVERSATION CONTEXT ===\n';
      prompt += 'Recent conversation turns:\n';
      memory.conversationHistory.slice(0, 3).forEach((turn, idx) => {
        prompt += `${idx + 1}. ${turn.role}: "${turn.content.substring(0, 100)}"\n`;
      });
    }
  }

  // OPTIMIZATION 15: Include previous analysis when generating emails from reports
  if (previousResults && previousResults.length > 0) {
    const referencesPrevious = /\b(?:previous|last|earlier|that|this)\s+(?:analysis|answer|report|result|context)\b/i.test(query);
    if (referencesPrevious && previousResults[0].analysis) {
      prompt += '\n\n=== PREVIOUS ANALYSIS CONTEXT ===\n';
      prompt += `From query: "${previousResults[0].query}"\n`;
      prompt += `Analysis: ${previousResults[0].analysis.substring(0, 800)}...\n`;
      prompt += 'IMPORTANT: Use this previous analysis as context when generating emails or responses.\n';
    }
  }
  
  // OPTIMIZATION 16: Handle content modification queries dynamically
  // This handles rewrite, edit, explain, extract queries based on extracted context
  if (previousEmailContent) {
    const isRewrite = /\b(rewrite|regenerate|recreate|re-?write|re-?generate)\b/i.test(query);
    const isEdit = /\b(edit|modify|change|update|revise|adjust|improve|enhance)\b/i.test(query);
    const isExplain = /\b(explain|clarify|elaborate|detail|describe|what\s+does|how\s+does)\b/i.test(query);
    const isExtract = /\b(extract|get|show\s+me|give\s+me|provide)\s+(?:the|that|this|previous)\b/i.test(query);
    
    if (isRewrite || isEdit) {
      prompt += '\n\n⚠️⚠️⚠️ CONTENT MODIFICATION QUERY DETECTED ⚠️⚠️⚠️\n';
      prompt += `The user wants to ${isRewrite ? 'REWRITE' : 'EDIT/MODIFY'} previous content. Here is the original:\n\n`;
      prompt += '=== ORIGINAL CONTENT ===\n';
      prompt += `${previousEmailContent}\n\n`;
      prompt += '=== MODIFICATION INSTRUCTIONS ===\n';
      prompt += `User Query: "${query}"\n\n`;
      prompt += 'CRITICAL REQUIREMENTS:\n';
      prompt += '1. Modify the content based on the user\'s specific instructions\n';
      prompt += '2. Keep the same structure and format as the original (unless user requests format change)\n';
      prompt += '3. If user says "only without extra analysis or data", provide ONLY the modified content, no explanations\n';
      prompt += '4. Maintain the same tone and style as the original\n';
      prompt += '5. Apply user-specified changes (e.g., "make it shorter", "add more details", "change the tone")\n';
      prompt += '6. DO NOT include analysis, data, or extra context unless explicitly requested\n';
      prompt += '7. If user asks to modify a specific section (e.g., "Email 1"), modify ONLY that section\n';
      prompt += '\n🚨🚨🚨 CRITICAL: SENDER vs RECIPIENT NAME DISTINCTION 🚨🚨🚨\n';
      prompt += 'When user says "set my name" or "use my name" or mentions a name in the signature:\n';
      prompt += '- "my name" = SENDER NAME (the person writing the email) - replace "[Your Name]" placeholder\n';
      prompt += '- "target name" / "recipient name" = RECIPIENT NAME (the person receiving the email) - DO NOT change this\n';
      prompt += '- If user says "not to change the name of the target profile", preserve the recipient\'s name\n';
      prompt += '- Examples:\n';
      prompt += '  * "set my name oussama sahraoui" → Replace "[Your Name]" with "Oussama Sahraoui" in signature\n';
      prompt += '  * "best, oussama sahraoui" → Change signature to "Best, Oussama Sahraoui"\n';
      prompt += '  * "not to change the name of the target profile" → Keep recipient name (Casey Nolte) unchanged\n';
      prompt += '- Placeholders like "[Your Name]", "[Name]", "Best, [Your Name]" should be replaced with user\'s name\n';
      prompt += '- Recipient names (in "Hi [Name]" or "Subject: [Name]") should NOT be changed unless explicitly requested\n';
      
      // If sender name is provided, explicitly instruct to use it
      if (senderName) {
        prompt += `\n🎯 SENDER NAME PROVIDED: "${senderName}"\n`;
        prompt += `- Replace ALL instances of "[Your Name]", "[Name]", "Best, [Your Name]" with "${senderName}"\n`;
        prompt += `- Use "${senderName}" in the email signature (e.g., "Best, ${senderName}")\n`;
        prompt += `- DO NOT change the recipient's name (the person the email is TO)\n`;
        prompt += `- DO NOT change names in the email body (e.g., "Hi Casey" should stay "Hi Casey")\n`;
      }
      prompt += '\n';
    } else if (isExplain) {
      prompt += '\n\n⚠️⚠️⚠️ EXPLANATION QUERY DETECTED ⚠️⚠️⚠️\n';
      prompt += 'The user wants MORE DETAILS or EXPLANATION about previous content:\n\n';
      prompt += '=== PREVIOUS CONTENT ===\n';
      prompt += `${previousEmailContent.substring(0, 1500)}\n\n`;
      prompt += '=== USER REQUEST ===\n';
      prompt += `"${query}"\n\n`;
      prompt += 'CRITICAL REQUIREMENTS:\n';
      prompt += '1. Provide detailed explanation or elaboration based on the user\'s request\n';
      prompt += '2. Use the previous content as context for your explanation\n';
      prompt += '3. If user asks "what does this mean", explain the key concepts and implications\n';
      prompt += '4. If user asks "tell me more", provide additional relevant details\n';
      prompt += '5. Be thorough but concise - focus on what the user is asking about\n\n';
    } else if (isExtract) {
      prompt += '\n\n⚠️⚠️⚠️ DATA EXTRACTION QUERY DETECTED ⚠️⚠️⚠️\n';
      prompt += 'The user wants to EXTRACT specific data from previous results:\n\n';
      prompt += '=== PREVIOUS CONTENT ===\n';
      prompt += `${previousEmailContent.substring(0, 1000)}\n\n`;
      prompt += '=== EXTRACTION REQUEST ===\n';
      prompt += `"${query}"\n\n`;
      prompt += 'CRITICAL REQUIREMENTS:\n';
      prompt += '1. Extract ONLY the data the user is asking for\n';
      prompt += '2. Format it clearly (table, list, or structured format)\n';
      prompt += '3. If user asks for specific fields (e.g., "company names", "fit scores"), extract those fields\n';
      prompt += '4. Do not include extra analysis or explanations unless requested\n\n';
    }
  }

  // Detect what user actually wants as output
  const outputReq = this.detectOutputRequirement(query);
  const personalizationCtx = this.extractPersonalizationContext(query, retrievedData);
  const dataMetrics = this.extractDataMetrics(retrievedData);
  const intent = this.detectQueryIntent(query);

  prompt += '\n\n═══════════════════════════════════════════════════';
  prompt += '\n                  USER QUERY';
  prompt += '\n═══════════════════════════════════════════════════';
  prompt += `\n\n"${query}"\n`;

  prompt += '\n═══════════════════════════════════════════════════';
  prompt += '\n              INITIAL ANALYSIS';
  prompt += '\n═══════════════════════════════════════════════════';
  prompt += `\n\n${analysis}\n`;

  if (retrievedData && retrievedData.length > 0) {
    prompt += this.formatRetrievedData(retrievedData);
  }

  // Add output-specific guidance (email, template, table, etc.)
  prompt += this.buildOutputSpecificGuidance(outputReq, personalizationCtx, dataMetrics);

  if (executedActions.length > 0) {
    prompt += '\n\n═══════════════════════════════════════════════════';
    prompt += '\n              EXECUTED ACTIONS';
    prompt += '\n═══════════════════════════════════════════════════\n';
    executedActions.forEach(action => {
      const status = action.success ? '✅' : '❌';
      prompt += `\n${status} ${action.tool}.${action.action}`;
    });
  }

  prompt += '\n\n═══════════════════════════════════════════════════';
  prompt += '\n              CRITICAL INSTRUCTIONS';
  prompt += '\n═══════════════════════════════════════════════════\n';
  
  if (outputReq.requiresCreativeWork) {
    prompt += '\n🎨 CREATIVE OUTPUT REQUIRED:';
    prompt += `\n   → Deliver: ${outputReq.outputType.toUpperCase()}`;
    prompt += '\n   → DO NOT describe what to create - CREATE IT';
    prompt += '\n   → Use actual names/data from retrieved information';
    prompt += '\n   → Make it ready to use immediately';
    
    if (outputReq.requiresPersonalization) {
      prompt += '\n   → PERSONALIZE using recipient/company data above';
    }
  } else {
    prompt += '\n📊 DATA DISPLAY REQUIRED:';
    prompt += `\n   → Format: ${outputReq.outputType.toUpperCase()}`;
    prompt += '\n   → Present information clearly';
    prompt += '\n   → Add strategic context';
  }

  prompt += '\n\n═══════════════════════════════════════════════════';
  prompt += '\n            BEGIN YOUR RESPONSE';
  prompt += '\n═══════════════════════════════════════════════════';
  prompt += '\n\nDeliver the requested output in markdown format.';
  
  if (outputReq.outputType === 'email') {
    prompt += '\n\n🚨 REMINDER: Write the ACTUAL EMAIL, not a description of it!';
  }

  return prompt;
}

  buildContextualPrompt(
    basePrompt: string,
    activeCollections: string[],
    activeIds: string[]
  ): string {
    let prompt = basePrompt;

    if (activeCollections.length > 0) {
      prompt += '\n\nACTIVE CONTEXT:\n';
      prompt += `Collections in focus: ${activeCollections.join(', ')}\n`;
      
      activeCollections.forEach(collection => {
        const schema = schemaService.getSchema(collection);
        if (schema) {
          prompt += `\n${collection} schema:\n`;
          prompt += `- Searchable fields: ${schema.searchableFields.join(', ')}\n`;
          prompt += `- Related collections: ${schema.relationships.map(r => r.targetCollection).join(', ')}\n`;
        }
      });
    }

    if (activeIds.length > 0) {
      prompt += `\nActive document IDs: ${activeIds.slice(0, 5).join(', ')}`;
      if (activeIds.length > 5) {
        prompt += ` (and ${activeIds.length - 5} more)`;
      }
    }

    return prompt;
  }

  buildSchemaContextPrompt(collections: string[]): string {
    let prompt = 'SCHEMA INFORMATION:\n\n';

    collections.forEach(collection => {
      const schema = schemaService.getSchema(collection);
      if (!schema) return;

      prompt += `## ${collection}\n`;
      prompt += `Searchable: ${schema.searchableFields.join(', ')}\n`;
      prompt += `Has embedding: ${schema.embeddingField ? 'Yes' : 'No'}\n`;
      prompt += 'Relationships:\n';
      
      schema.relationships.forEach(rel => {
        prompt += `  - ${rel.field} → ${rel.targetCollection} (${rel.type})\n`;
      });
      
      prompt += '\n';
    });

    return prompt;
  }
  
}

export const dynamicPromptBuilder = new DynamicPromptBuilder();
