// src/nodes/planner.ts
import { llmService } from '../../services/llm.service';
import { dynamicPromptBuilder } from '../../prompts/dynamic-builder';
import { logger } from '../../core/logger';
import { GraphState } from '../state';
import { schemaService } from '../../services/schema.service';
import { checkTotalTimeout, trackNodeExecution } from '../../utils/timeout';
import { updateProgress } from '../../utils/progress-tracker';
import { getStreamCallbacks } from '../graph-stream';

export async function plannerNode(state: GraphState): Promise<Partial<GraphState>> {
  const nodeStartTime = Date.now();
  
  // Send progress update when node starts
  const streamCallbacks = getStreamCallbacks();
  if (streamCallbacks?.onProgress) {
    streamCallbacks.onProgress('planner', 'Planning your query...', 10);
  }
  
  try {
    // Check total timeout
    checkTotalTimeout(state.startTime);
    
    // Track node execution
    const nodeStartTimes = { ...(state.nodeStartTimes || {}), planner: nodeStartTime };
    trackNodeExecution('planner', nodeStartTimes);
    
    logger.info('Planner node executing', { 
      query: state.query, 
      userId: state.userId,
      hasEnhancedQuery: !!state.enhancedQuery 
    });

    // Use enhanced query context if available
    let queryContext = state.enhancedQuery 
      ? `Parsed Query Analysis:
         Entities: ${JSON.stringify(state.enhancedQuery.parsed.entities)}
         Metrics: ${JSON.stringify(state.enhancedQuery.parsed.metrics)}
         Keywords: ${state.enhancedQuery.parsed.keywords.join(', ')}`
      : '';

    // Extract relevant entities from previous results if query references them
    const { sessionContextService } = await import('../../services/session-context.service');
    const relevantEntities = sessionContextService.extractRelevantEntities(
      state.previousResults || [],
      state.originalQuery
    );

    // Use lastViewedCompanyIds, lastViewedEmployeeIds, and lastViewedIcpModelIds as primary source (more reliable)
    // Merge with relevantEntities from previousResults
    const allCompanyIds = [
      ...(state.lastViewedCompanyIds || []),
      ...relevantEntities.companies.map(c => c._id).filter(id => 
        !state.lastViewedCompanyIds?.includes(id)
      )
    ];
    const allEmployeeIds = [
      ...(state.lastViewedEmployeeIds || []),
      ...relevantEntities.employees.map(e => e._id).filter(id => 
        !state.lastViewedEmployeeIds?.includes(id)
      )
    ];
    const allIcpModelIds = [
      ...(state.lastViewedIcpModelIds || []),
      ...relevantEntities.icpModels.map(m => m._id).filter(id => 
        !state.lastViewedIcpModelIds?.includes(id)
      )
    ];

    logger.debug('Planner: Available IDs for context', {
      lastViewedCompanyIds: state.lastViewedCompanyIds?.length || 0,
      lastViewedEmployeeIds: state.lastViewedEmployeeIds?.length || 0,
      lastViewedIcpModelIds: state.lastViewedIcpModelIds?.length || 0,
      relevantEntitiesCompanies: relevantEntities.companies.length,
      relevantEntitiesEmployees: relevantEntities.employees.length,
      totalCompanyIds: allCompanyIds.length,
      totalEmployeeIds: allEmployeeIds.length,
      totalIcpModelIds: allIcpModelIds.length
    });

    // Check if query explicitly references previous results (pronouns or keywords)
    // Only use stored IDs if query explicitly references them
    const explicitlyReferencesPrevious = 
      /\b(this|that|the|those|these|previous|last|mentioned|above|earlier)\b/i.test(state.originalQuery) ||
      /\b(he|she|they|him|her|them|his|hers|their)\b/i.test(state.originalQuery) ||
      /\b(my|our)\s+(icp|model|primary\s+icp|icp\s+model|company|companies|employee|employees)\b/i.test(state.originalQuery) ||
      /\b(previous|last|earlier|above|mentioned)\s+(answer|result|results|analysis|search|query|data)\b/i.test(state.originalQuery) ||
      /\b(those|these|the)\s+(results|companies|employees|answers|analyses|searches)\b/i.test(state.originalQuery);
    
    // If query references previous results and we have entities, add them to the query context
    // BUT only if query explicitly references them (pronouns/keywords)
    if (explicitlyReferencesPrevious && 
        (allCompanyIds.length > 0 || allEmployeeIds.length > 0 || allIcpModelIds.length > 0 ||
         relevantEntities.companies.length > 0 || relevantEntities.employees.length > 0)) {
      // Build company context from lastViewedCompanyIds
      const companyContext = allCompanyIds.length > 0
        ? allCompanyIds.map(id => {
            const entity = relevantEntities.companies.find(c => c._id === id);
            return entity ? { id, name: entity.name } : { id, name: 'Last Viewed Company' };
          })
        : relevantEntities.companies.map(c => ({ id: c._id, name: c.name }));
      
      // Build employee context from lastViewedEmployeeIds
      const employeeContext = allEmployeeIds.length > 0
        ? allEmployeeIds.map(id => {
            const entity = relevantEntities.employees.find(e => e._id === id);
            return entity ? { id, name: entity.fullName, title: entity.activeExperienceTitle } : { id, name: 'Last Viewed Employee' };
          })
        : relevantEntities.employees.map(e => ({ id: e._id, name: e.fullName, title: e.activeExperienceTitle }));

      // Build ICP model context from lastViewedIcpModelIds
      const icpModelContext = allIcpModelIds.length > 0
        ? allIcpModelIds.map(id => ({ id, name: 'Last Viewed ICP Model' }))
        : [];

      const referenceContext = `\n\n=== PREVIOUS RESULTS CONTEXT (CRITICAL) ===
         The user is referencing data from the previous query. Use these entities:
         
         Last Viewed Company IDs: ${JSON.stringify(companyContext)}
         Last Viewed Employee IDs: ${JSON.stringify(employeeContext)}
         Last Viewed ICP Model IDs: ${JSON.stringify(icpModelContext)}
         
         IMPORTANT RULES:
         1. If user says "this company", "that company", "the company" → Use the company ID(s) from above
         2. If user says "ceo profiles working at this company" → First fetch the company by ID, then hop to employees
         3. If user says "this ICP model", "my ICP", "the model", "my primary ICP" → Use the ICP model ID(s) from above
         4. ALWAYS use companies → employees direction (NEVER employees → companies)
         5. Use the company ID in the query: {"_id": "COMPANY_ID_FROM_ABOVE"} or {"companyId": {"$in": ["COMPANY_ID_FROM_ABOVE"]}}
         6. Use the ICP model ID in the query: {"icpModelId": "ICP_MODEL_ID_FROM_ABOVE"} or {"icpModelId": {"$in": ["ICP_MODEL_ID_FROM_ABOVE"]}}
         7. If multiple company IDs, use: {"_id": {"$in": ["ID1", "ID2", ...]}}`;
      queryContext += referenceContext;
      
      logger.info('Planner: Using previous results context', {
        lastViewedCompanyIds: state.lastViewedCompanyIds?.length || 0,
        lastViewedEmployeeIds: state.lastViewedEmployeeIds?.length || 0,
        lastViewedIcpModelIds: state.lastViewedIcpModelIds?.length || 0,
        lastViewedCompanyIdsArray: state.lastViewedCompanyIds?.slice(0, 3) || [],
        lastViewedEmployeeIdsArray: state.lastViewedEmployeeIds?.slice(0, 3) || [],
        lastViewedIcpModelIdsArray: state.lastViewedIcpModelIds?.slice(0, 3) || [],
        companiesCount: companyContext.length,
        employeesCount: employeeContext.length,
        icpModelsCount: icpModelContext.length,
        companyNames: companyContext.map(c => c.name),
        query: state.originalQuery
      });
    }

    const systemPrompt = dynamicPromptBuilder.buildPlannerPrompt(
      state.query,
      state.memory,
      state.userId,
      queryContext, // Pass parsed context
      state.previousResults || [] // Pass previous results
    );

    let response: any;
    try {
      response = await llmService.chatWithJSON(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: state.query },
        ]
      );
    } catch (error: any) {
      logger.error('LLM chatWithJSON failed', { 
        error: error.message,
        stack: error.stack 
      });
      // Fall through to fallback plan generation
      response = null;
    }

    // Validate response structure
    if (!response || !response.intent || !response.plan) {
      logger.warn('Planner LLM response invalid, generating fallback plan', {
        responseKeys: response ? Object.keys(response) : [],
        hasIntent: !!response?.intent,
        hasPlan: !!response?.plan,
        responsePreview: response ? JSON.stringify(response).substring(0, 500) : 'null'
      });
      
      // Generate fallback plan from enhanced query
      response = generateFallbackPlan(state.query, state.enhancedQuery, state.userId);
    }

    // Merge parsed entities from enhanced query if available
    if (state.enhancedQuery && state.enhancedQuery.parsed.entities.length > 0) {
      response.intent.entities = [
        ...(response.intent.entities || []),
        ...state.enhancedQuery.parsed.entities
      ];
    }

    logger.info('Plan generated with enhanced context', { 
      intent: response.intent?.type,
      requiresHopping: response.intent?.requiresHopping,
      totalSteps: response.plan?.steps?.length || 0,
      stepDetails: response.plan?.steps?.map((s: any) => ({
        stepId: s.stepId,
        action: s.action,
        collection: s.collection,
        hasQuery: !!s.query,
        queryKeys: s.query ? Object.keys(s.query) : [],
        mongoQuery: s.query ? JSON.stringify(s.query) : 'no-query',
        queryPreview: s.query ? JSON.stringify(s.query).substring(0, 200) : 'no-query',
        limit: s.limit,
        hasDependencies: !!s.dependencies,
        dependencies: s.dependencies || []
      })),
      hasPreviousResults: (state.previousResults?.length || 0) > 0,
      previousResultsCount: state.previousResults?.length || 0,
      entitiesCount: response.intent?.entities?.length || 0,
      collections: response.intent?.collections || [],
      originalQuery: state.originalQuery,
      enhancedQuery: state.query
    });
    
    // Check if plan direction is wrong (employees → companies instead of companies → employees)
    const firstStep = response.plan?.steps?.[0];
    const secondStep = response.plan?.steps?.[1];
    const wrongDirection = firstStep?.collection === 'employees' && 
                          secondStep?.collection === 'companies' &&
                          firstStep?.action === 'fetch' &&
                          secondStep?.action === 'hop';
    
    // Warn if pattern suggests hopping but plan doesn't have it
    const queryLower = state.originalQuery.toLowerCase();
    
    // Detect specific company name in query (e.g., "company Salam", "Salam company", "Salam's decision makers")
    // Pattern: "company [Name]", "[Name] company", "[Name]'s", "of [Name]", "at [Name]", "from [Name]"
    const companyNamePatterns = [
      /\bcompany\s+([A-Z][a-zA-Z]+)(?:\s|$|'s|s\s|and|or)/i,  // "company Salam" - stop at space, end, 's, or conjunctions
      /\b([A-Z][a-zA-Z]+)\s+company\b/i,  // "Salam company"
      /\b([A-Z][a-zA-Z]+)'s\s+(decision|maker|employee|executive|profile)/i,  // "Salam's decision makers"
      /\bof\s+([A-Z][a-zA-Z]+)(?:\s|$|'s|s\s|and|or)/i,  // "of Salam" - stop at space, end, 's, or conjunctions
      /\b(?:at|from|for|working\s+at)\s+([A-Z][a-zA-Z]+)(?:\s|$)/i,  // "at Salam", "from Salam"
    ];
    
    let detectedCompanyName: string | null = null;
    for (const pattern of companyNamePatterns) {
      const match = state.originalQuery.match(pattern);
      if (match && match[1]) {
        detectedCompanyName = match[1].trim();
        // Remove common words that might be captured
        detectedCompanyName = detectedCompanyName.replace(/\b(the|a|an|this|that|those|these)\b/gi, '').trim();
        // Stop at common conjunctions and prepositions
        detectedCompanyName = detectedCompanyName.split(/\s+(and|or|with|in|on|at|to|for|from|of|the|a|an)\s+/i)[0].trim();
        if (detectedCompanyName.length > 1 && detectedCompanyName.length < 50) { // Reasonable name length
          break;
        }
      }
    }
    
    // Detect specific employee name in query (e.g., "Francis Dayapan", "employee John")
    const employeeNamePatterns = [
      /\b(employee|executive|manager|director|ceo|cto|cfo|person|profile)\s+([A-Z][a-zA-Z\s]+?)(?:\s|$)/i,  // "employee John Smith"
      /\b([A-Z][a-zA-Z\s]+?)\s+(profile|analysis|psychology)/i,  // "Francis Dayapan profile"
    ];
    
    let detectedEmployeeName: string | null = null;
    for (const pattern of employeeNamePatterns) {
      const match = state.originalQuery.match(pattern);
      if (match && match[2]) {
        detectedEmployeeName = match[2].trim();
        if (detectedEmployeeName.length > 1) {
          break;
        }
      }
    }
    
    // Check if query explicitly requests "all" companies/employees
    const requestsAll = /\b(all|every|each)\s+(compan(?:y|ies)|employee|employees|decision\s+maker|executive)\b/i.test(state.originalQuery) ||
                        /\b(all|every|each)\s+(of\s+)?(the|these|those|my|our)\s+(compan(?:y|ies)|employee|employees)\b/i.test(state.originalQuery);
    
    const hasCompanyName = detectedCompanyName !== null || 
                          /\b(this|that|the)\s+company\b/i.test(state.originalQuery);
    const hasEmployeeKeywords = /\b(employee|executive|manager|director|ceo|cto|cfo|staff|person|people|profiles?)\b/i.test(queryLower);
    const shouldHaveHop = hasCompanyName && hasEmployeeKeywords;
    
    logger.info('Planner: Detected specific entities in query', {
      detectedCompanyName,
      detectedEmployeeName,
      requestsAll,
      hasCompanyName,
      hasEmployeeKeywords,
      query: state.originalQuery
    });
    
    // CRITICAL: If query references "this company", "this profile/employee/person", or "this ICP model", inject IDs FIRST
    // Also use lastViewedCompanyIds/lastViewedEmployeeIds/lastViewedIcpModelIds from state if available
    // Normalize "thosecompanies" (no space) to "those companies" for detection
    const normalizedQueryForRefs = state.originalQuery.replace(/\bthosecompanies\b/gi, 'those companies');
    const referencesThisCompany = /\b(this|that|the|those|these|previous|last|earlier|mentioned)\s+compan(?:y|ies)\b/i.test(normalizedQueryForRefs) ||
                                   /\b(all\s+)?(those|these|previous|last|earlier)\s+compan(?:y|ies)\b/i.test(normalizedQueryForRefs);
    const referencesThisProfile = /\b(this|that|the|those|these|previous|last)\s+(profile|employee|person|executive|ceo|manager|director)\b/i.test(state.originalQuery);
    const referencesThisIcp = /\b(this|that|the|my|our)\s+(icp|model|icp\s+model|primary\s+icp)\b/i.test(state.originalQuery) ||
                               /\b(primary\s+icp|my\s+icp|our\s+icp)\b/i.test(state.originalQuery);
    const referencesThis = /\b(this|that|the|those|these|previous|last|earlier)\b/i.test(state.originalQuery);
    
    // Detect pronouns that refer to last viewed employee
    const referencesPronoun = /\b(he|she|they|him|her|them|his|hers|their)\b/i.test(state.originalQuery);
    
    const availableCompanyIds = state.lastViewedCompanyIds && state.lastViewedCompanyIds.length > 0
      ? state.lastViewedCompanyIds
      : relevantEntities.companies.map(c => c._id);
    
    const availableEmployeeIds = state.lastViewedEmployeeIds && state.lastViewedEmployeeIds.length > 0
      ? state.lastViewedEmployeeIds
      : relevantEntities.employees.map(e => e._id);
    
    const availableIcpModelIds = state.lastViewedIcpModelIds && state.lastViewedIcpModelIds.length > 0
      ? state.lastViewedIcpModelIds
      : [];
    
    // Detect "this analysis", "the analysis", "this context", "the context" - refers to previous results
    const referencesAnalysis = /\b(this|that|the|previous)\s+analysis\b/i.test(state.originalQuery);
    const referencesContext = /\b(this|that|the|previous)\s+context\b/i.test(state.originalQuery);
    
    // Handle pronoun references FIRST - before other plan modifications
    // If query has pronoun (he/she/they) asking about company, fetch employee then hop to company
    const askingAboutCompany = /\b(company|companies|industry|industries|organization|firm|business|where|which)\b/i.test(state.originalQuery);
    
    // If query mentions "email template", "meet", "hook", "schedule" - this is an action/generation query
    // But it still needs data (ICP model, employee, company) to generate the template
    const isGenerationQuery = /\b(email\s+template|email|template|meet|meeting|hook|schedule|outreach)\b/i.test(state.originalQuery);
    
    // Detect analysis queries that need intelligence data (psychology analysis, profile analysis, etc.)
    const isAnalysisQuery = /\b(analysis|analyze|psychology|profile\s+analysis|persona|intelligence|insights|recommendation|recommend|suggest|how\s+to|strategy|strategies)\b/i.test(state.originalQuery) ||
                            /\b(generate|create|write|draft|personalized|personalised|cold\s+email|email\s+sequence|copywriting)\b/i.test(state.originalQuery);
    
    const needsIntelligenceData = isGenerationQuery || isAnalysisQuery;
    
    // Detect action queries: "send to crm", "create contact", "add to crm", "sync to crm"
    // Also handle "thosecompanies" (no space) as "those companies"
    const normalizedQuery = state.originalQuery.replace(/\bthosecompanies\b/gi, 'those companies');
    const isActionQuery = /\b(send|add|create|sync|update|push|export)\s+(to|in|into)\s+(crm|salesforce|hubspot|slack|gmail|jira)\b/i.test(normalizedQuery) ||
                         /\b(send|add|create|sync|update|push|export)\s+(those|these|previous|last|the)\s+(compan(?:y|ies)|contacts?|leads?)\s+(to|in|into)\s+(crm|salesforce|hubspot)\b/i.test(normalizedQuery);
    
    // CRITICAL: Handle action queries FIRST - they need to execute, not analyze
    if (isActionQuery) {
      logger.info('Planner: Action query detected - preparing execution plan', {
        query: state.originalQuery,
        hasCompanyIds: availableCompanyIds.length > 0,
        referencesCompanies: referencesThisCompany
      });
      
      // Ensure intent is set to "execute"
      if (!response.intent) {
        response.intent = {};
      }
      response.intent.type = 'execute';
      
      // Detect CRM type from query
      const crmType = /\b(salesforce|hubspot)\b/i.test(state.originalQuery) 
        ? (/\bsalesforce\b/i.test(state.originalQuery) ? 'salesforce' : 'hubspot')
        : 'salesforce'; // Default to salesforce if not specified
      
      // Add external actions to intent
      if (!response.intent.actions) {
        response.intent.actions = [];
      }
      if (!response.intent.actions.includes('crm_create_contact')) {
        response.intent.actions.push('crm_create_contact');
      }
      
      // Initialize plan if missing
      if (!response.plan) {
        response.plan = { steps: [] };
      }
      if (!response.plan.steps) {
        response.plan.steps = [];
      }
      
      // If we need to fetch companies first (for "those companies"), ensure we have a fetch step
      if (referencesThisCompany && availableCompanyIds.length > 0) {
        // Check if we already have a company fetch step
        const hasCompanyFetchStep = response.plan.steps.some((s: any) => 
          s.collection === 'companies' && s.action === 'fetch'
        );
        
        if (!hasCompanyFetchStep) {
          // Add a fetch step for companies
          response.plan.steps.unshift({
            stepId: 'step_1_fetch_companies_for_crm',
            action: 'fetch',
            collection: 'companies',
            query: {
              userId: state.userId,
              _id: availableCompanyIds.length > 1 ? { $in: availableCompanyIds } : availableCompanyIds[0]
            },
            limit: availableCompanyIds.length,
            producesOutputFor: 'company_data_for_crm'
          });
          
          logger.info('Planner: Added company fetch step for CRM action', {
            companyIdsCount: availableCompanyIds.length,
            stepId: 'step_1_fetch_companies_for_crm'
          });
        }
      }
      
      // Store CRM type and action details for executor
      response.intent.crmType = crmType;
      response.intent.actionType = 'create_contact';
      
      // CRITICAL: Remove any incorrect hop steps (e.g., to enrichments) that LLM might have generated
      // For action queries, we only need to fetch companies, not hop to other collections
      if (response.plan.steps) {
        const originalStepsCount = response.plan.steps.length;
        
        // First, fix company fetch steps if "those companies" is referenced
        if (referencesThisCompany && availableCompanyIds.length > 0) {
          const companyFetchStep = response.plan.steps.find((s: any) => 
            s.collection === 'companies' && s.action === 'fetch'
          );
          
          if (companyFetchStep) {
            // Replace the query with company IDs (ignore LLM-generated filters like industry)
            companyFetchStep.query = {
              userId: state.userId,
              _id: availableCompanyIds.length > 1 ? { $in: availableCompanyIds } : availableCompanyIds[0]
            };
            companyFetchStep.limit = availableCompanyIds.length;
            
            logger.info('Planner: Fixed company fetch step query for action query', {
              originalQuery: JSON.stringify(companyFetchStep.query),
              newQuery: JSON.stringify(companyFetchStep.query),
              companyIdsCount: availableCompanyIds.length
            });
          }
        }
        
        // Then remove all non-company-fetch steps
        response.plan.steps = response.plan.steps.filter((step: any) => {
          // Keep company fetch steps
          if (step.collection === 'companies' && step.action === 'fetch') {
            return true;
          }
          // Remove all other steps (hops, enrichments, etc.) for action queries
          return false;
        });
        
        if (response.plan.steps.length < originalStepsCount) {
          logger.info('Planner: Removed incorrect steps from action query plan', {
            removedSteps: originalStepsCount - response.plan.steps.length,
            remainingSteps: response.plan.steps.map((s: any) => `${s.action} ${s.collection}`)
          });
        }
      }
      
      logger.info('Planner: Action query configured', {
        intentType: response.intent.type,
        actions: response.intent.actions,
        crmType,
        hasCompanyFetchStep: response.plan.steps.some((s: any) => s.collection === 'companies'),
        totalSteps: response.plan.steps.length
      });
    }
    
    // If this is a generation query (email template, etc.) but has no steps, we need to create steps
    // to fetch the required data (ICP model, employee, company, analysis)
    if (isGenerationQuery && (!response.plan?.steps || response.plan.steps.length === 0)) {
      logger.info('Planner: Generation query with no steps - creating data fetch steps', {
        query: state.originalQuery,
        hasIcpModelIds: availableIcpModelIds.length > 0,
        hasEmployeeIds: availableEmployeeIds.length > 0,
        hasCompanyIds: availableCompanyIds.length > 0,
        referencesIcp: referencesThisIcp,
        referencesPronoun: referencesPronoun,
        referencesAnalysis: referencesAnalysis,
        referencesContext: referencesContext,
        hasPreviousResults: (state.previousResults?.length || 0) > 0
      });
      
      // Initialize plan if missing
      if (!response.plan) {
        response.plan = { steps: [] };
      }
      
      // PRIORITY 1: If query mentions "this context" and we have previous results, use them
      if (referencesContext) {
        if (state.previousResults && state.previousResults.length > 0) {
          logger.info('Planner: "This context" detected - using previous results', {
            previousResultsCount: state.previousResults.length,
            mostRecentQuery: state.previousResults[0]?.query?.substring(0, 50)
          });
          
          // Extract IDs from previous results
          const mostRecent = state.previousResults[0];
          const prevCompanyIds: string[] = [];
          const prevEmployeeIds: string[] = [];
          const prevIcpModelIds: string[] = [];
          
          mostRecent.retrievedData.forEach(retrieved => {
            if (retrieved.collection === 'companies') {
              retrieved.documents.forEach((doc: any) => {
                const id = doc._id?.toString();
                if (id) prevCompanyIds.push(id);
                const icpModelId = doc.icpModelId?.toString();
                if (icpModelId) prevIcpModelIds.push(icpModelId);
              });
            } else if (retrieved.collection === 'employees') {
              retrieved.documents.forEach((doc: any) => {
                const id = doc._id?.toString();
                if (id) prevEmployeeIds.push(id);
              });
            } else if (retrieved.collection === 'icp_models') {
              retrieved.documents.forEach((doc: any) => {
                const id = doc._id?.toString();
                if (id) prevIcpModelIds.push(id);
              });
            }
          });
          
          // Use IDs from previous results to create fetch steps
          if (prevCompanyIds.length > 0) {
            response.plan.steps.push({
              stepId: 'step_1_fetch_companies_from_context',
              action: 'fetch',
              collection: 'companies',
              query: {
                userId: state.userId,
                _id: prevCompanyIds.length > 1 ? { $in: prevCompanyIds.slice(0, 10) } : prevCompanyIds[0]
              },
              limit: Math.min(prevCompanyIds.length, 10)
            });
          }
          
          if (prevEmployeeIds.length > 0) {
            response.plan.steps.push({
              stepId: 'step_2_fetch_employees_from_context',
              action: 'fetch',
              collection: 'employees',
              query: {
                userId: state.userId,
                _id: prevEmployeeIds.length > 1 ? { $in: prevEmployeeIds.slice(0, 10) } : prevEmployeeIds[0]
              },
              limit: Math.min(prevEmployeeIds.length, 10)
            });
          }
          
          if (prevIcpModelIds.length > 0) {
            response.plan.steps.push({
              stepId: 'step_3_fetch_icp_models_from_context',
              action: 'fetch',
              collection: 'icp_models',
              query: {
                userId: state.userId,
                _id: prevIcpModelIds.length > 1 ? { $in: prevIcpModelIds.slice(0, 5) } : prevIcpModelIds[0]
              },
              limit: Math.min(prevIcpModelIds.length, 5)
            });
          }
        } else {
          // "This context" detected but no previous results - provide fallback
          logger.warn('Planner: "This context" detected but no previous results found - using fallback', {
            query: state.originalQuery,
            hasLastViewedIds: {
              companies: availableCompanyIds.length > 0,
              employees: availableEmployeeIds.length > 0,
              icpModels: availableIcpModelIds.length > 0
            }
          });
          
          // Fallback: Use last viewed IDs if available, otherwise fetch primary ICP model
          if (availableIcpModelIds.length > 0) {
            response.plan.steps.push({
              stepId: 'step_1_fetch_icp_model_fallback',
              action: 'fetch',
              collection: 'icp_models',
              query: {
                userId: state.userId,
                _id: availableIcpModelIds[0]
              },
              limit: 1
            });
          } else {
            // Last resort: Query for primary ICP model
            response.plan.steps.push({
              stepId: 'step_1_fetch_primary_icp_fallback',
              action: 'fetch',
              collection: 'icp_models',
              query: {
                userId: state.userId,
                isPrimary: true
              },
              limit: 1
            });
          }
          
          // Also include last viewed companies/employees if available
          if (availableCompanyIds.length > 0) {
            response.plan.steps.push({
              stepId: 'step_2_fetch_companies_fallback',
              action: 'fetch',
              collection: 'companies',
              query: {
                userId: state.userId,
                _id: availableCompanyIds[0]
              },
              limit: 1
            });
          }
          
          if (availableEmployeeIds.length > 0) {
            response.plan.steps.push({
              stepId: 'step_3_fetch_employees_fallback',
              action: 'fetch',
              collection: 'employees',
              query: {
                userId: state.userId,
                _id: availableEmployeeIds[0]
              },
              limit: 1
            });
          }
        }
      }
      
      // PRIORITY 2: If still no steps and we have previous results, use them directly
      if (response.plan.steps.length === 0 && state.previousResults && state.previousResults.length > 0) {
        logger.info('Planner: No specific references detected, using previous results for context', {
          previousResultsCount: state.previousResults.length
        });
        
        // Use the most recent previous result's data
        const mostRecent = state.previousResults[0];
        if (mostRecent.retrievedData && mostRecent.retrievedData.length > 0) {
          // Extract collection types from previous results
          const collections = new Set(mostRecent.retrievedData.map(r => r.collection));
          
          collections.forEach(collection => {
            const collectionData = mostRecent.retrievedData.find(r => r.collection === collection);
            if (collectionData && collectionData.documents.length > 0) {
              const ids = collectionData.documents
                .map((doc: any) => doc._id?.toString())
                .filter(Boolean)
                .slice(0, 10);
              
              if (ids.length > 0) {
                response.plan.steps.push({
                  stepId: `step_fetch_${collection}_from_context`,
                  action: 'fetch',
                  collection: collection,
                  query: {
                    userId: state.userId,
                    _id: ids.length > 1 ? { $in: ids } : ids[0]
                  },
                  limit: ids.length
                });
              }
            }
          });
        }
      }
      
      // PRIORITY 3: If query mentions ICP model (primary ICP), fetch it
      // If we have IDs, use them; otherwise query for primary ICP model
      if (referencesThisIcp && response.plan.steps.length === 0) {
        if (availableIcpModelIds.length > 0) {
          // Use available ICP model IDs
          response.plan.steps.push({
            stepId: 'step_1_fetch_icp_model',
            action: 'fetch',
            collection: 'icp_models',
            query: {
              userId: state.userId,
              _id: availableIcpModelIds[0]
            },
            limit: 1
          });
        } else {
          // Fallback: Query for primary ICP model
          logger.info('Planner: No ICP model IDs available, querying for primary ICP model', {
            query: state.originalQuery
          });
          response.plan.steps.push({
            stepId: 'step_1_fetch_primary_icp_model',
            action: 'fetch',
            collection: 'icp_models',
            query: {
              userId: state.userId,
              isPrimary: true
            },
            limit: 1
          });
        }
      }
      
      // If query mentions employee (pronoun "him") and we have IDs, fetch employee
      if (referencesPronoun) {
        if (availableEmployeeIds.length > 0) {
          response.plan.steps.push({
            stepId: 'step_2_fetch_employee',
            action: 'fetch',
            collection: 'employees',
            query: {
              userId: state.userId,
              _id: availableEmployeeIds[0]
            },
            limit: 1
          });
          
          // If we have employee, also fetch their company
          response.plan.steps.push({
            stepId: 'step_3_hop_company',
            action: 'hop',
            collection: 'companies',
            query: {
              userId: state.userId
            },
            limit: 1,
            dependencies: ['step_2_fetch_employee'],
            hoppingPath: {
              from: 'employees',
              to: 'companies',
              via: 'companyId',
              cardinality: 'many-to-one'
            }
          });
        } else {
          logger.warn('Planner: Pronoun detected but no employee IDs available - cannot fetch employee', {
            query: state.originalQuery,
            pronoun: state.originalQuery.match(/\b(he|she|they|him|her|them|his|hers|their)\b/i)?.[0]
          });
        }
      }
      
      // PRIORITY 5: If query mentions company and we have IDs, fetch company
      if (referencesThisCompany && availableCompanyIds.length > 0 && response.plan.steps.length === 0) {
        response.plan.steps.push({
          stepId: 'step_1_fetch_company',
          action: 'fetch',
          collection: 'companies',
          query: {
            userId: state.userId,
            _id: availableCompanyIds[0]
          },
          limit: 1
        });
      }
      
      // Update intent to include fetch actions
      if (!response.intent.retrieval_actions) {
        response.intent.retrieval_actions = [];
      }
      if (!response.intent.retrieval_actions.includes('fetch')) {
        response.intent.retrieval_actions.push('fetch');
      }
      if (response.plan.steps.some((s: any) => s.action === 'hop')) {
        if (!response.intent.retrieval_actions.includes('hop')) {
          response.intent.retrieval_actions.push('hop');
        }
        response.intent.requiresHopping = true;
      }
      
      logger.info('Planner: Created data fetch steps for generation query', {
        stepsCount: response.plan.steps.length,
        steps: response.plan.steps.map((s: any) => `${s.action} ${s.collection}`)
      });
    }
    
    if (referencesPronoun && availableEmployeeIds.length > 0 && askingAboutCompany && response.plan?.steps) {
      logger.info('Planner: Pronoun detected asking about company - will fetch employee then hop to company', {
        query: state.originalQuery,
        employeeIds: availableEmployeeIds.slice(0, 3),
        pronoun: state.originalQuery.match(/\b(he|she|they|him|her|them|his|hers|their)\b/i)?.[0]
      });
      
      const employeeId = availableEmployeeIds[0];
      
      // Replace the plan with: fetch employee → hop to company
      response.plan.steps = [
        {
          stepId: 'step_1_fetch_employee',
          action: 'fetch',
          collection: 'employees',
          query: {
            userId: state.userId,
            _id: employeeId
          },
          limit: 1
        },
        {
          stepId: 'step_2_hop_company',
          action: 'hop',
          collection: 'companies',
          query: {
            userId: state.userId
          },
          limit: 1,
          dependencies: ['step_1_fetch_employee'],
          hoppingPath: {
            from: 'employees',
            to: 'companies',
            via: 'companyId',
            cardinality: 'many-to-one'
          }
        }
      ];
      
      response.intent.requiresHopping = true;
      if (!response.intent.retrieval_actions) {
        response.intent.retrieval_actions = [];
      }
      if (!response.intent.retrieval_actions.includes('fetch')) {
        response.intent.retrieval_actions.push('fetch');
      }
      if (!response.intent.retrieval_actions.includes('hop')) {
        response.intent.retrieval_actions.push('hop');
      }
      
      logger.info('Planner: Modified plan for pronoun query - fetch employee then hop to company', {
        employeeId,
        steps: response.plan.steps.map((s: any) => `${s.action} ${s.collection}`)
      });
    }
    
    // Handle "this company" references
    // SKIP if this is an action query - the action query handler already fixed the query
    if (referencesThisCompany && availableCompanyIds.length > 0 && response.plan?.steps && !isActionQuery) {
      const companyId = availableCompanyIds[0]; // Use first company ID
      const companyName = relevantEntities.companies.find(c => c._id === companyId)?.name || 
                         (state.lastViewedCompanyIds?.length > 0 ? 'Last Viewed Company' : 'Unknown');
      
      logger.info('Planner: Injecting company ID from previous results', {
        query: state.originalQuery,
        companyId,
        companyName,
        availableCompanyIds: availableCompanyIds.slice(0, 5),
        usingLastViewedIds: !!(state.lastViewedCompanyIds && state.lastViewedCompanyIds.length > 0),
        stepsBefore: response.plan.steps.map((s: any) => ({
          stepId: s.stepId,
          collection: s.collection,
          queryKeys: Object.keys(s.query || {})
        }))
      });
      
      // Find the first step that fetches companies and inject the company ID
      const companyFetchStep = response.plan.steps.find((s: any) => 
        s.collection === 'companies' && s.action === 'fetch'
      );
      
      if (companyFetchStep) {
        // If multiple companies, use $in, otherwise use _id
        if (availableCompanyIds.length > 1) {
          companyFetchStep.query = {
            ...companyFetchStep.query,
            _id: { $in: availableCompanyIds }
          };
          companyFetchStep.limit = availableCompanyIds.length;
        } else {
          // Inject company ID into the query
          companyFetchStep.query = {
            ...companyFetchStep.query,
            _id: companyId // Use the company ID from previous results
          };
          companyFetchStep.limit = 1;
        }
        
        logger.info('Planner: Injected company ID into fetch step', {
          stepId: companyFetchStep.stepId,
          companyId,
          companyName,
          updatedQuery: JSON.stringify(companyFetchStep.query),
          queryKeys: Object.keys(companyFetchStep.query),
          usingLastViewedIds: !!(state.lastViewedCompanyIds && state.lastViewedCompanyIds.length > 0)
        });
      } else {
        logger.warn('Planner: Could not find company fetch step to inject ID', {
          availableSteps: response.plan.steps.map((s: any) => ({
            stepId: s.stepId,
            action: s.action,
            collection: s.collection
          }))
        });
      }
    } else if (referencesThisCompany && availableCompanyIds.length === 0) {
      logger.warn('Planner: Query references "this company" but no previous company results found', {
        query: state.originalQuery,
        previousResultsCount: state.previousResults?.length || 0,
        lastViewedCompanyIds: state.lastViewedCompanyIds?.length || 0
      });
    }
    
    // Handle "this profile/employee/person" references
    if (referencesThisProfile && availableEmployeeIds.length > 0 && response.plan?.steps) {
      const employeeId = availableEmployeeIds[0]; // Use first employee ID
      const employeeName = relevantEntities.employees.find(e => e._id === employeeId)?.fullName || 
                          (state.lastViewedEmployeeIds?.length > 0 ? 'Last Viewed Employee' : 'Unknown');
      
      logger.info('Planner: Injecting employee ID from previous results', {
        query: state.originalQuery,
        employeeId,
        employeeName,
        availableEmployeeIds: availableEmployeeIds.slice(0, 5),
        usingLastViewedIds: !!(state.lastViewedEmployeeIds && state.lastViewedEmployeeIds.length > 0),
        stepsBefore: response.plan.steps.map((s: any) => ({
          stepId: s.stepId,
          collection: s.collection,
          queryKeys: Object.keys(s.query || {})
        }))
      });
      
      // Find the first step that fetches employees and inject the employee ID
      const employeeFetchStep = response.plan.steps.find((s: any) => 
        s.collection === 'employees' && s.action === 'fetch'
      );
      
      if (employeeFetchStep) {
        // If multiple employees, use $in, otherwise use _id
        if (availableEmployeeIds.length > 1) {
          employeeFetchStep.query = {
            ...employeeFetchStep.query,
            _id: { $in: availableEmployeeIds }
          };
          employeeFetchStep.limit = availableEmployeeIds.length;
        } else {
          // Inject employee ID into the query
          employeeFetchStep.query = {
            ...employeeFetchStep.query,
            _id: employeeId // Use the employee ID from previous results
          };
          employeeFetchStep.limit = 1;
        }
        
        logger.info('Planner: Injected employee ID into fetch step', {
          stepId: employeeFetchStep.stepId,
          employeeId,
          employeeName,
          updatedQuery: JSON.stringify(employeeFetchStep.query),
          queryKeys: Object.keys(employeeFetchStep.query),
          usingLastViewedIds: !!(state.lastViewedEmployeeIds && state.lastViewedEmployeeIds.length > 0)
        });
      } else {
        logger.warn('Planner: Could not find employee fetch step to inject ID', {
          availableSteps: response.plan.steps.map((s: any) => ({
            stepId: s.stepId,
            action: s.action,
            collection: s.collection
          }))
        });
      }
    } else if (referencesThisProfile && availableEmployeeIds.length === 0) {
      logger.warn('Planner: Query references "this profile/employee" but no previous employee results found', {
        query: state.originalQuery,
        previousResultsCount: state.previousResults?.length || 0,
        lastViewedEmployeeIds: state.lastViewedEmployeeIds?.length || 0
      });
    }
    
    // Handle "this ICP model" references
    if (referencesThisIcp && availableIcpModelIds.length > 0 && response.plan?.steps) {
      const icpModelId = availableIcpModelIds[0]; // Use first ICP model ID
      
      logger.info('Planner: Injecting ICP model ID from previous results', {
        query: state.originalQuery,
        icpModelId,
        availableIcpModelIds: availableIcpModelIds.slice(0, 5),
        usingLastViewedIds: !!(state.lastViewedIcpModelIds && state.lastViewedIcpModelIds.length > 0),
        stepsBefore: response.plan.steps.map((s: any) => ({
          stepId: s.stepId,
          collection: s.collection,
          queryKeys: Object.keys(s.query || {})
        }))
      });
      
      // Find the first step that fetches icp_models and inject the ICP model ID
      const icpModelFetchStep = response.plan.steps.find((s: any) => 
        s.collection === 'icp_models' && s.action === 'fetch'
      );
      
      if (icpModelFetchStep) {
        // If multiple ICP models, use $in, otherwise use _id
        if (availableIcpModelIds.length > 1) {
          icpModelFetchStep.query = {
            ...icpModelFetchStep.query,
            _id: { $in: availableIcpModelIds }
          };
          icpModelFetchStep.limit = availableIcpModelIds.length;
        } else {
          // Inject ICP model ID into the query
          icpModelFetchStep.query = {
            ...icpModelFetchStep.query,
            _id: icpModelId // Use the ICP model ID from previous results
          };
          icpModelFetchStep.limit = 1;
        }
        
        logger.info('Planner: Injected ICP model ID into fetch step', {
          stepId: icpModelFetchStep.stepId,
          icpModelId,
          updatedQuery: JSON.stringify(icpModelFetchStep.query),
          queryKeys: Object.keys(icpModelFetchStep.query),
          usingLastViewedIds: !!(state.lastViewedIcpModelIds && state.lastViewedIcpModelIds.length > 0)
        });
      } else {
        logger.warn('Planner: Could not find ICP model fetch step to inject ID', {
          availableSteps: response.plan.steps.map((s: any) => ({
            stepId: s.stepId,
            action: s.action,
            collection: s.collection
          }))
        });
      }
    } else if (referencesThisIcp && availableIcpModelIds.length === 0) {
      logger.warn('Planner: Query references "this ICP model" but no previous ICP model results found', {
        query: state.originalQuery,
        previousResultsCount: state.previousResults?.length || 0,
        lastViewedIcpModelIds: state.lastViewedIcpModelIds?.length || 0
      });
    }
    
    // CRITICAL: For fit score queries, filter by ICP model ONLY if query explicitly references ICP
    // Detect fit score queries: "fit score", "top companies", "max fit", "best fit", "has max fit score"
    const isFitScoreQuery = /\b(fit\s+score|top\s+companies|max\s+fit|best\s+fit|highest\s+fit|companies\s+by\s+fit|has\s+max\s+fit\s+score)\b/i.test(state.originalQuery);
    
    // Extract "top N" from query (e.g., "top 5", "top 10", "find 5 companies")
    const topNMatch = state.originalQuery.match(/\b(top|find|get|show)\s+(\d+)\b/i);
    const requestedLimit = topNMatch ? parseInt(topNMatch[2], 10) : null;
    
    // Check if query explicitly references ICP model (pronouns or keywords)
    const explicitlyReferencesIcp = referencesThisIcp || 
      /\b(my|our|this|that|the)\s+(icp|model|primary\s+icp|icp\s+model)\b/i.test(state.originalQuery);
    
    if (isFitScoreQuery && response.plan?.steps) {
      // Find all company fetch steps
      const companyFetchSteps = response.plan.steps.filter((s: any) => 
        s.collection === 'companies' && s.action === 'fetch'
      );
      
      if (companyFetchSteps.length > 0) {
        logger.info('Planner: Fit score query detected - enforcing correct sort and limit', {
          query: state.originalQuery,
          companyStepsCount: companyFetchSteps.length,
          explicitlyReferencesIcp: explicitlyReferencesIcp,
          requestedLimit: requestedLimit
        });
        
        // Only inject ICP model filter if query explicitly references ICP
        if (explicitlyReferencesIcp) {
          // Get ICP model IDs - prioritize lastViewedIcpModelIds, then try to fetch primary ICP
          let icpModelIdsToUse: string[] = [];
          
          if (availableIcpModelIds.length > 0) {
            icpModelIdsToUse = availableIcpModelIds;
            logger.info('Planner: Query explicitly references ICP - using ICP model IDs from context', {
              icpModelIds: icpModelIdsToUse.slice(0, 3)
            });
          } else {
            // If no ICP model IDs available, we need to fetch the primary ICP model first
            logger.warn('Planner: Query references ICP but no ICP model IDs available - will fetch primary ICP model first', {
              query: state.originalQuery
            });
            
            // Add a step to fetch primary ICP model BEFORE company fetch steps
            const primaryIcpStep = {
              stepId: 'step_0_fetch_primary_icp',
              action: 'fetch',
              collection: 'icp_models',
              query: {
                userId: state.userId,
                isPrimary: true
              },
              limit: 1,
              producesOutputFor: 'icp_model_id'
            };
            
            // Insert at the beginning
            response.plan.steps.unshift(primaryIcpStep);
            
            // Update dependencies for company steps
            companyFetchSteps.forEach((step: any) => {
              if (!step.dependencies) {
                step.dependencies = [];
              }
              if (!step.dependencies.includes('step_0_fetch_primary_icp')) {
                step.dependencies.push('step_0_fetch_primary_icp');
              }
            });
            
            // We'll inject the ICP model ID after fetching (handled by retriever)
            // For now, add a placeholder that will be replaced
            icpModelIdsToUse = ['FROM_STEP_0_ICP_MODEL_ID'];
          }
          
          // Inject ICP model filter into all company fetch steps
          companyFetchSteps.forEach((step: any) => {
            step.query.icpModelId = icpModelIdsToUse.length > 1 
              ? { $in: icpModelIdsToUse }
              : icpModelIdsToUse[0];
            
            logger.info('Planner: Injected ICP model filter (query explicitly references ICP)', {
              stepId: step.stepId,
              icpModelId: step.query.icpModelId,
              query: state.originalQuery
            });
          });
          
          // Update intent to include fetch for ICP models if we added a step
          if (availableIcpModelIds.length === 0 && response.plan.steps[0]?.stepId === 'step_0_fetch_primary_icp') {
            if (!response.intent.retrieval_actions) {
              response.intent.retrieval_actions = [];
            }
            if (!response.intent.retrieval_actions.includes('fetch')) {
              response.intent.retrieval_actions.push('fetch');
            }
          }
        } else {
          logger.info('Planner: Fit score query does NOT explicitly reference ICP - not injecting ICP filter', {
            query: state.originalQuery
          });
        }
        
        // ALWAYS ensure correct sort and limit for fit score queries (regardless of ICP reference)
        companyFetchSteps.forEach((step: any) => {
          // CRITICAL: Ensure we only get companies with actual numeric fit scores
          // Use $gte: 0 to ensure it's a valid number >= 0 (this also implies $exists: true and $ne: null)
          // This is more reliable than $exists + $type for nested fields
          if (step.query['scoringMetrics.fit_score.score']) {
            const fitScoreFilter = step.query['scoringMetrics.fit_score.score'];
            // If it's an object with operators like $gt, $gte, etc., check if it's valid
            if (typeof fitScoreFilter === 'object' && !fitScoreFilter.$gte && !fitScoreFilter.$gt) {
              logger.warn('Planner: Removing invalid fit score filter, replacing with strict numeric check', {
                stepId: step.stepId,
                originalFilter: fitScoreFilter,
                query: state.originalQuery
              });
              // Use strict filter: must be a number >= 0 (this ensures it exists and is numeric)
              step.query['scoringMetrics.fit_score.score'] = { 
                $gte: 0
              };
            } else if (!fitScoreFilter.$gte && !fitScoreFilter.$gt) {
              // If it doesn't have a numeric check, add it
              step.query['scoringMetrics.fit_score.score'] = { 
                $gte: 0
              };
            }
          } else {
            // Ensure fit score exists and is a valid number >= 0
            // Using $gte: 0 ensures the field exists, is not null, and is a number >= 0
            step.query['scoringMetrics.fit_score.score'] = { 
              $gte: 0
            };
          }
          
          // CRITICAL: Set limit to requested "top N" if specified, otherwise use step's limit or default based on query type
          if (requestedLimit && requestedLimit > 0) {
            step.limit = requestedLimit;
            logger.info('Planner: Set limit to requested top N', {
              stepId: step.stepId,
              limit: requestedLimit,
              query: state.originalQuery
            });
          } else if (!step.limit || step.limit > 20) {
            // If query says "list" or "all", use higher limit (500 for "all", 50 for "list")
            const isAllQuery = /\b(all|every|each)\s+(of\s+)?(my|our|the|these|those)\s+(compan(?:y|ies)|employee|employees|decision\s+maker)\b/i.test(state.originalQuery);
            const isListQuery = /\b(list|show\s+all|display\s+all)\b/i.test(state.originalQuery);
            const defaultLimit = isAllQuery ? 500 : (isListQuery ? 50 : 10);
            step.limit = defaultLimit;
            logger.info('Planner: Set default limit for fit score query', {
              stepId: step.stepId,
              limit: defaultLimit,
              isListQuery,
              query: state.originalQuery
            });
          }
          
          // ALWAYS sort by fit score (primary) and revenue (secondary if mentioned)
          if (!step.sort) {
            step.sort = {};
          }
          // Primary sort: fit score (descending - highest first)
          step.sort['scoringMetrics.fit_score.score'] = -1;
          // Secondary sort: revenue if query mentions revenue
          if (/\b(revenue|revenu|sorted\s+by\s+revenue)\b/i.test(state.originalQuery)) {
            step.sort.annualRevenue = -1;
          }
          
          logger.info('Planner: Enforced fit score sort and limit for company fetch step', {
            stepId: step.stepId,
            sort: step.sort,
            limit: step.limit,
            hasFitScoreFilter: !!step.query['scoringMetrics.fit_score.score'],
            hasIcpFilter: !!step.query.icpModelId,
            query: state.originalQuery
          });
        });
      }
    }
    
    // Handle generic "this" references - try to infer from context
    if (referencesThis && !referencesThisCompany && !referencesThisProfile && response.plan?.steps) {
      // If we have employee IDs and the plan is fetching employees, use them
      if (availableEmployeeIds.length > 0) {
        const employeeFetchStep = response.plan.steps.find((s: any) => 
          s.collection === 'employees' && s.action === 'fetch'
        );
        if (employeeFetchStep && !employeeFetchStep.query._id) {
          logger.info('Planner: Generic "this" detected, injecting employee ID from context', {
            query: state.originalQuery,
            employeeIds: availableEmployeeIds.slice(0, 3)
          });
          employeeFetchStep.query = {
            ...employeeFetchStep.query,
            _id: availableEmployeeIds.length > 1 ? { $in: availableEmployeeIds } : availableEmployeeIds[0]
          };
          employeeFetchStep.limit = availableEmployeeIds.length > 1 ? availableEmployeeIds.length : 1;
        }
      }
      // If we have company IDs and the plan is fetching companies, use them
      else if (availableCompanyIds.length > 0) {
        const companyFetchStep = response.plan.steps.find((s: any) => 
          s.collection === 'companies' && s.action === 'fetch'
        );
        if (companyFetchStep && !companyFetchStep.query._id) {
          logger.info('Planner: Generic "this" detected, injecting company ID from context', {
            query: state.originalQuery,
            companyIds: availableCompanyIds.slice(0, 3)
          });
          companyFetchStep.query = {
            ...companyFetchStep.query,
            _id: availableCompanyIds.length > 1 ? { $in: availableCompanyIds } : availableCompanyIds[0]
          };
          companyFetchStep.limit = availableCompanyIds.length > 1 ? availableCompanyIds.length : 1;
        }
      }
    }
    
    // If wrong direction AND we have company IDs available, fix the plan
    if (wrongDirection && availableCompanyIds.length > 0) {
      logger.warn('Planner: Fixing wrong plan direction - employees → companies should be companies → employees', {
        query: state.originalQuery,
        currentPlan: response.plan?.steps?.map((s: any) => `${s.action} ${s.collection}`),
        previousCompanyId: availableCompanyIds[0],
        usingLastViewedIds: !!(state.lastViewedCompanyIds && state.lastViewedCompanyIds.length > 0)
      });
      
      // Fix the plan: swap steps and use company ID from available sources
      const companyId = availableCompanyIds[0];
      const employeeQuery = firstStep.query || {};
      
      response.plan.steps = [
        {
          stepId: 'step_1_fetch_company',
          action: 'fetch',
          collection: 'companies',
          query: {
            userId: state.userId,
            _id: companyId // Use company ID from previous results
          },
          limit: 1,
          producesOutputFor: 'company_ids'
        },
        {
          stepId: 'step_2_hop_employees',
          action: 'hop',
          collection: 'employees',
          query: {
            ...employeeQuery,
            userId: state.userId,
            companyId: { $in: ['FROM_STEP_1_COMPANY_IDS'] }
          },
          limit: requestsAll ? 500 : (secondStep?.limit || 50), // Higher limit for "all" queries
          dependencies: ['step_1_fetch_company'],
          hoppingPath: {
            from: 'companies',
            to: 'employees',
            via: 'companyId',
            cardinality: 'one-to-many'
          }
        }
      ];
      
      response.intent.requiresHopping = true;
      response.intent.retrieval_actions = ['fetch', 'hop'];
      
      logger.info('Planner: Plan corrected', {
        newPlan: response.plan?.steps?.map((s: any) => `${s.action} ${s.collection}`)
      });
    } else if (wrongDirection) {
      logger.error('Planner: WRONG PLAN DIRECTION - employees → companies should be companies → employees', {
        query: state.originalQuery,
        currentPlan: response.plan?.steps?.map((s: any) => `${s.action} ${s.collection}`),
        suggestion: 'Should be: fetch companies → hop employees',
        hasPreviousResults: (relevantEntities.companies.length > 0)
      });
    }
    
    if (shouldHaveHop && (!response.intent?.requiresHopping || !response.plan?.steps?.some((s: any) => s.action === 'hop'))) {
      logger.warn('Planner: Query pattern suggests hopping but plan does not include hop step', {
        query: state.originalQuery,
        requiresHopping: response.intent?.requiresHopping,
        hasHopStep: response.plan?.steps?.some((s: any) => s.action === 'hop'),
        steps: response.plan?.steps?.map((s: any) => s.action)
      });
    }
    
    // CRITICAL: Filter by specific company/employee name if detected (unless "all" is requested)
    if (response.plan?.steps && !requestsAll) {
      // Filter company steps (both fetch and hop) by detected company name
      if (detectedCompanyName) {
        const companySteps = response.plan.steps.filter((s: any) => 
          s.collection === 'companies'
        );
        
        companySteps.forEach((step: any) => {
          // Add company name filter to the query
          if (!step.query) {
            step.query = { userId: state.userId };
          }
          // CRITICAL: Always add name filter, even if _id is present
          // This ensures we only get the specific company, not all companies
          step.query.name = { $regex: detectedCompanyName, $options: 'i' };
          step.limit = step.limit || 10; // Limit to 10 when filtering by specific company name
          
          logger.info('Planner: Added company name filter to step', {
            stepId: step.stepId,
            action: step.action,
            companyName: detectedCompanyName,
            hasIdFilter: !!step.query._id,
            updatedQuery: JSON.stringify(step.query)
          });
        });
        
        // Also filter employee hop steps that depend on company steps
        // This ensures employees are only from the specific company
        const employeeHopSteps = response.plan.steps.filter((s: any) => 
          s.collection === 'employees' && s.action === 'hop' && s.dependencies
        );
        
        employeeHopSteps.forEach((step: any) => {
          const dependsOnCompanyStep = step.dependencies?.some((depId: string) => {
            const depStep = response.plan.steps.find((s: any) => s.stepId === depId);
            return depStep && depStep.collection === 'companies';
          });
          
          if (dependsOnCompanyStep) {
            logger.info('Planner: Employee hop step depends on company step - will use filtered companies', {
              stepId: step.stepId,
              dependencies: step.dependencies,
              companyName: detectedCompanyName
            });
          }
        });
      }
      
      // Filter employee steps (both fetch and hop) by detected employee name
      if (detectedEmployeeName) {
        const employeeSteps = response.plan.steps.filter((s: any) => 
          s.collection === 'employees'
        );
        
        employeeSteps.forEach((step: any) => {
          // Add employee name filter to the query
          if (!step.query) {
            step.query = { userId: state.userId };
          }
          // If query already has _id filter (from previous results), keep it but also add name filter
          // Otherwise, replace with name filter
          if (!step.query._id) {
            step.query.fullName = { $regex: detectedEmployeeName, $options: 'i' };
          } else {
            // If _id is present, we're using previous results - don't override
            logger.info('Planner: Employee step already has _id filter, keeping it', {
              stepId: step.stepId,
              employeeName: detectedEmployeeName
            });
          }
          step.limit = step.limit || 10; // Limit to 10 when filtering by specific employee name
          
          logger.info('Planner: Added employee name filter to step', {
            stepId: step.stepId,
            action: step.action,
            employeeName: detectedEmployeeName,
            updatedQuery: JSON.stringify(step.query)
          });
        });
      }
    }
    
    // CRITICAL: For "all" queries, ensure high limits on company fetch and employee hop steps
    if (requestsAll && response.plan?.steps) {
      logger.info('Planner: "All" query detected - ensuring high limits on fetch/hop steps', {
        query: state.originalQuery,
        requestsAll
      });
      
      // Update company fetch steps to have high limit
      const companyFetchSteps = response.plan.steps.filter((s: any) => 
        s.collection === 'companies' && s.action === 'fetch'
      );
      companyFetchSteps.forEach((step: any) => {
        if (!step.limit || step.limit < 500) {
          step.limit = 500;
          logger.info('Planner: Set high limit for company fetch step in "all" query', {
            stepId: step.stepId,
            limit: step.limit
          });
        }
      });
      
      // Update employee hop/fetch steps to have high limit
      const employeeSteps = response.plan.steps.filter((s: any) => 
        s.collection === 'employees'
      );
      employeeSteps.forEach((step: any) => {
        if (!step.limit || step.limit < 500) {
          step.limit = 500;
          logger.info('Planner: Set high limit for employee step in "all" query', {
            stepId: step.stepId,
            action: step.action,
            limit: step.limit
          });
        }
        
        // Ensure isDecisionMaker filter is present if query mentions decision makers
        if (/\b(decision\s+maker|decision\s+makers)\b/i.test(state.originalQuery)) {
          if (!step.query) {
            step.query = { userId: state.userId };
          }
          step.query.isDecisionMaker = true;
          
          // CRITICAL: For "all decision makers" queries, remove activeExperienceTitle filter
          // It's too restrictive and will filter out most decision makers
          if (requestsAll && step.query.activeExperienceTitle) {
            delete step.query.activeExperienceTitle;
            logger.info('Planner: Removed activeExperienceTitle filter for "all decision makers" query', {
              stepId: step.stepId,
              action: step.action,
              reason: 'Too restrictive for "all" queries'
            });
          }
          
          logger.info('Planner: Added isDecisionMaker filter to employee step', {
            stepId: step.stepId,
            action: step.action,
            hasTitleFilter: !!step.query.activeExperienceTitle
          });
        }
      });
    }
    
    // CRITICAL: For analysis/generation queries, automatically add intelligence data retrieval
    
    if (needsIntelligenceData && response.plan?.steps) {
      // Ensure intent type is set to "analyze" for analysis queries
      if (isAnalysisQuery && response.intent && response.intent.type !== 'execute') {
        response.intent.type = 'analyze';
      }
      
      logger.info('Planner: Analysis/generation query detected - adding intelligence data retrieval', {
        query: state.originalQuery,
        isGenerationQuery,
        isAnalysisQuery,
        intentType: response.intent?.type,
        currentSteps: response.plan.steps.map((s: any) => `${s.action} ${s.collection}`)
      });
      
      const existingSteps = response.plan.steps;
      const hasEmployeeStep = existingSteps.some((s: any) => s.collection === 'employees');
      const hasPersonaIntelligenceStep = existingSteps.some((s: any) => s.collection === 'gtm_persona_intelligence');
      const hasGtmIntelligenceStep = existingSteps.some((s: any) => s.collection === 'gtm_intelligence');
      
      // If we have employee step, add gtm_persona_intelligence hop
      if (hasEmployeeStep && !hasPersonaIntelligenceStep) {
        const employeeStep = existingSteps.find((s: any) => s.collection === 'employees');
        const employeeStepId = employeeStep?.stepId || existingSteps[0]?.stepId || 'step_1_fetch_employee';
        
        // Find hopping path from employees to gtm_persona_intelligence
        const personaPath = schemaService.findHoppingPath('employees', 'gtm_persona_intelligence');
        if (personaPath) {
          response.plan.steps.push({
            stepId: `step_${response.plan.steps.length + 1}_hop_persona_intelligence`,
            action: 'hop',
            collection: 'gtm_persona_intelligence',
            query: {
              userId: state.userId,
              employeeId: { $in: ['FROM_STEP_1_EMPLOYEE_IDS'] }
            },
            limit: 5,
            dependencies: [employeeStepId],
            hoppingPath: personaPath
          });
          
          if (!response.intent.retrieval_actions) {
            response.intent.retrieval_actions = [];
          }
          if (!response.intent.retrieval_actions.includes('hop')) {
            response.intent.retrieval_actions.push('hop');
          }
          response.intent.requiresHopping = true;
          
          logger.info('Planner: Added gtm_persona_intelligence hop step', {
            employeeStepId,
            hoppingPath: personaPath
          });
        }
      }
      
      // If we have employee step, also add company hop (if not exists) then gtm_intelligence
      // Check for both fetch and hop steps for companies
      const hasCompanyStepAny = existingSteps.some((s: any) => s.collection === 'companies');
      
      if (hasEmployeeStep && !hasCompanyStepAny) {
        const employeeStep = existingSteps.find((s: any) => s.collection === 'employees');
        const employeeStepId = employeeStep?.stepId || existingSteps[0]?.stepId || 'step_1_fetch_employee';
        
        // Add company hop first
        const companyPath = schemaService.findHoppingPath('employees', 'companies');
        if (companyPath) {
          const companyHopStep = {
            stepId: `step_${response.plan.steps.length + 1}_hop_company`,
            action: 'hop',
            collection: 'companies',
            query: {
              userId: state.userId
            },
            limit: 5,
            dependencies: [employeeStepId],
            hoppingPath: companyPath
          };
          response.plan.steps.push(companyHopStep);
          
          if (!response.intent.retrieval_actions) {
            response.intent.retrieval_actions = [];
          }
          if (!response.intent.retrieval_actions.includes('hop')) {
            response.intent.retrieval_actions.push('hop');
          }
          response.intent.requiresHopping = true;
          
          logger.info('Planner: Added company hop step for intelligence data', {
            employeeStepId,
            companyStepId: companyHopStep.stepId
          });
        }
      }
      
      // Now add gtm_intelligence hop (depends on company step - either fetch or hop)
      if (!hasGtmIntelligenceStep) {
        // Find company step (either fetch or hop) - check after adding company hop if needed
        const companyStep = response.plan.steps.find((s: any) => s.collection === 'companies');
        if (companyStep) {
          const companyStepId = companyStep.stepId;
          const gtmPath = schemaService.findHoppingPath('companies', 'gtm_intelligence');
          if (gtmPath) {
            response.plan.steps.push({
              stepId: `step_${response.plan.steps.length + 1}_hop_gtm_intelligence`,
              action: 'hop',
              collection: 'gtm_intelligence',
              query: {
                userId: state.userId,
                companyId: { $in: ['FROM_STEP_1_COMPANY_IDS'] }
              },
              limit: 5,
              dependencies: [companyStepId],
              hoppingPath: gtmPath
            });
            
            if (!response.intent.retrieval_actions) {
              response.intent.retrieval_actions = [];
            }
            if (!response.intent.retrieval_actions.includes('hop')) {
              response.intent.retrieval_actions.push('hop');
            }
            response.intent.requiresHopping = true;
            
            logger.info('Planner: Added gtm_intelligence hop step', {
              companyStepId,
              hoppingPath: gtmPath
            });
          }
        }
      }
      
      // Update collections in intent
      if (!response.intent.collections) {
        response.intent.collections = [];
      }
      const allCollections = new Set(response.intent.collections);
      response.plan.steps.forEach((step: any) => {
        allCollections.add(step.collection);
      });
      response.intent.collections = Array.from(allCollections);
      
      logger.info('Planner: Intelligence data retrieval steps added', {
        totalSteps: response.plan.steps.length,
        steps: response.plan.steps.map((s: any) => `${s.action} ${s.collection}`),
        collections: response.intent.collections
      });
    }

    // Update progress
    const progressUpdate = updateProgress({
      ...state,
      currentNode: 'planner',
      progress: state.progress || {
        currentNode: 'planner',
        completedNodes: [],
        progressPercentage: 0,
        lastUpdate: Date.now()
      }
    });
    
    return {
      intent: response.intent,
      plan: response.plan,
      currentNode: 'retriever',
      iterations: state.iterations + 1,
      nodeStartTimes: { ...nodeStartTimes, planner: nodeStartTime },
      ...progressUpdate
    };
  } catch (error: any) {
    logger.error('Planner node failed', { error: error.message, stack: error.stack });
    
    // Try to generate a fallback plan even on error
    try {
      const fallbackPlan = generateFallbackPlan(state.query, state.enhancedQuery, state.userId);
      logger.info('Using fallback plan after error');
      
      return {
        intent: fallbackPlan.intent,
        plan: fallbackPlan.plan,
        currentNode: 'retriever',
        iterations: state.iterations + 1,
        errors: [...state.errors, `Planning had issues but fallback plan generated: ${error.message}`],
      };
    } catch (fallbackError: any) {
      logger.error('Fallback plan generation also failed', { error: fallbackError.message });
      return {
        errors: [...state.errors, `Planning failed: ${error.message}`],
        currentNode: 'error',
      };
    }
  }
}

/**
 * Generate a fallback plan when LLM fails
 */
function generateFallbackPlan(
  query: string,
  enhancedQuery: any,
  userId: string
): { intent: any; plan: any } {
  logger.info('Generating fallback plan', { query });

  // Determine intent from query keywords
  const queryLower = query.toLowerCase();
  let intentType = 'search';
  let collections: string[] = ['companies'];
  let requiresHopping = false;

  // Check for employee/executive/manager keywords
  const hasEmployeeKeywords = queryLower.match(/\b(executive|manager|director|employee|staff|person|people|leader|ceo|cto|cfo|decision\s+maker)\b/i);
  if (hasEmployeeKeywords) {
    collections.push('employees');
    // Check for patterns: "working at", "at [company]", "from [company]", "for [company]"
    requiresHopping = /\b(?:working\s+at|at|from|for)\s+[A-Z][a-zA-Z]+\b/i.test(query);
  }

  // Check for company name - look for patterns like "at prosci", "from prosci", "for prosci", "working at prosci"
  const companyMatch = query.match(/\b(?:working\s+at|at|from|for)\s+([A-Z][a-zA-Z\s]+?)(?:\s|$)/i) || 
                       query.match(/\b([A-Z][a-zA-Z]+)\b/);
  const companyName = companyMatch ? companyMatch[1].trim() : null;
  
  logger.debug('Fallback plan: Pattern detection', {
    hasEmployeeKeywords: !!hasEmployeeKeywords,
    requiresHopping,
    companyName,
    query
  });

  // Build basic intent
  const intent = {
    type: intentType,
    confidence: 0.7,
    entities: enhancedQuery?.parsed?.entities || [],
    actions: ['fetch'],
    requiresHopping,
    collections,
  };

  // Build plan steps
  const steps: any[] = [];

  // Step 1: ALWAYS fetch companies first if company name is mentioned AND employees are requested
  if (companyName && collections.includes('employees')) {
    steps.push({
      stepId: 'step_1_fetch_company',
      action: 'fetch',
      collection: 'companies',
      query: {
        userId,
        name: { $regex: companyName, $options: 'i' }
      },
      limit: 10,
      producesOutputFor: 'company_ids'
    });
  }

  // Step 2: Fetch or hop to employees if needed
  if (collections.includes('employees')) {
    const employeeQuery: any = { userId };
    
    // Add role/title filters if mentioned
    if (queryLower.includes('ceo')) {
      employeeQuery.activeExperienceTitle = { $regex: 'CEO', $options: 'i' };
    }
    if (queryLower.includes('executive')) {
      employeeQuery.activeExperienceTitle = { $regex: '(Executive|CEO|CTO|CFO|President)', $options: 'i' };
    }
    if (queryLower.includes('manager')) {
      employeeQuery.activeExperienceTitle = { $regex: 'Manager', $options: 'i' };
    }
    
    // Add company filter if we have a company name (MUST use hop)
    if (companyName && steps.length > 0) {
      employeeQuery.companyId = { $in: ['FROM_STEP_1_COMPANY_IDS'] };
      steps.push({
        stepId: 'step_2_hop_employees',
        action: 'hop',
        collection: 'employees',
        query: employeeQuery,
        limit: 100,
        dependencies: ['step_1_fetch_company'],
        hoppingPath: {
          from: 'companies',
          to: 'employees',
          via: 'companyId',
          cardinality: 'one-to-many'
        }
      });
      requiresHopping = true;
    } else {
      // Direct fetch of employees
      // Add company name filter if mentioned
      if (companyName) {
        // We'll need to find companies first, then employees
        steps.push({
          stepId: 'step_1_fetch_companies',
          action: 'fetch',
          collection: 'companies',
          query: {
            userId,
            name: { $regex: companyName, $options: 'i' }
          },
          limit: 50,
          producesOutputFor: 'company_ids'
        });
        
        employeeQuery.companyId = { $in: ['FROM_STEP_1_COMPANY_IDS'] };
        steps.push({
          stepId: 'step_2_hop_employees',
          action: 'hop',
          collection: 'employees',
          query: employeeQuery,
          limit: 100,
          dependencies: ['step_1_fetch_companies'],
          hoppingPath: {
            from: 'companies',
            to: 'employees',
            via: 'companyId',
            cardinality: 'one-to-many'
          }
        });
      } else {
        // Add filters for managers/directors/executives
        if (queryLower.match(/\b(manager|director|executive|senior)\b/i)) {
          employeeQuery.activeExperienceTitle = {
            $regex: '(Manager|Director|Executive|Senior|VP|Vice President)',
            $options: 'i'
          };
        }
        
        if (queryLower.includes('decision maker') || queryLower.includes('decision-maker')) {
          employeeQuery.isDecisionMaker = true;
        }

        steps.push({
          stepId: 'step_1_fetch_employees',
          action: 'fetch',
          collection: 'employees',
          query: employeeQuery,
          limit: 100
        });
      }
    }
  }

  // If no steps created, create a basic companies fetch
  if (steps.length === 0) {
    steps.push({
      stepId: 'step_1_fetch_companies',
      action: 'fetch',
      collection: 'companies',
      query: { userId },
      limit: 50
    });
  }

  const plan = {
    steps,
    estimatedComplexity: steps.length > 1 ? 'medium' : 'low',
    requiresCritic: true,
    needsClarification: false
  };

  logger.info('Fallback plan generated', {
    intentType: intent.type,
    stepsCount: steps.length,
    collections: intent.collections,
    requiresHopping: intent.requiresHopping
  });

  return { intent, plan };
}