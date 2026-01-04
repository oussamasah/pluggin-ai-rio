import { GraphState, MemoryContext } from '../types/graph';
import { SYSTEM_PROMPTS } from './system-prompts';
import { schemaService } from '../services/schema.service';

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

    if (memory.facts.length > 0) {
      prompt += '\n\nRELEVANT MEMORY:\n';
      memory.facts.slice(0, 5).forEach(fact => {
        prompt += `- ${fact.content}\n`;
      });
    }

    if (Object.keys(memory.entities).length > 0) {
      prompt += '\n\nKNOWN ENTITIES:\n';
      Object.entries(memory.entities).forEach(([type, values]) => {
        prompt += `- ${type}: ${JSON.stringify(values)}\n`;
      });
    }

    // Add previous query results context
    if (previousResults && previousResults.length > 0) {
      prompt += '\n\n=== PREVIOUS QUERY RESULTS ===\n';
      prompt += 'The user may reference data from previous queries. Here are the most recent results:\n\n';
      
      previousResults.slice(0, 3).forEach((result, idx) => {
        prompt += `Previous Query ${idx + 1}: "${result.query}"\n`;
        prompt += `Summary: ${result.summary.companies} companies, ${result.summary.employees} employees\n`;
        
        // Include analysis if available (for "previous answer" or "the analysis" references)
        if (result.analysis) {
          prompt += `Analysis Preview: ${result.analysis.substring(0, 300)}...\n`;
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
    
    // Extract "top N" from query to enforce limit
    const topNMatch = query.match(/\b(top|find|get|show)\s+(\d+)\b/i);
    const requestedCount = topNMatch ? parseInt(topNMatch[2], 10) : null;
    
    // Check if this is a fit score query
    const isFitScoreQuery = /\b(fit\s+score|sorted\s+by\s+fit|fit\s+sorted)\b/i.test(query);
    
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
    retrievedData?: any[]
  ): string {
    let prompt = SYSTEM_PROMPTS.EXECUTOR;

    prompt += `\n\nUSER QUERY: "${query}"`;
    prompt += `\n\nANALYSIS: ${analysis}`;
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
  retrievedData?: any[]
): string {
  let prompt = SYSTEM_PROMPTS.RESPONDER;

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
