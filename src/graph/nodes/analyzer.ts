import { llmService } from '../../services/llm.service';
import { dynamicPromptBuilder } from '../../prompts/dynamic-builder';
import { logger } from '../../core/logger';
import { GraphState } from '../state';
import { config } from '../../core/config';
import { secureLog, maskSensitiveData } from '../../utils/security';
import { getStreamCallbacks } from '../graph-stream';

export async function analyzerNode(state: GraphState): Promise<Partial<GraphState>> {
  // Send progress update when node starts
  const streamCallbacks = getStreamCallbacks();
  if (streamCallbacks?.onProgress) {
    streamCallbacks.onProgress('analyzer', 'Analyzing data and generating insights...', 60);
  }
  try {
    // Secure logging - mask sensitive data and IDs
    secureLog({
      dataPoints: state.flattenedData.length,
      isAggregation: state.flattenedData.length > 0 && state.flattenedData[0]._id !== undefined,
      collections: state.retrievedData.map(r => `${r.collection}(${r.documents.length})`).join(', '),
      originalQuery: maskSensitiveData(state.originalQuery || ''),
      retrievedDataSummary: state.retrievedData.map(r => ({
        collection: r.collection,
        count: r.documents.length,
        sampleIds: r.documents.slice(0, 3).map((d: any) => maskSensitiveData(d._id?.toString() || '')),
        sampleNames: r.documents.slice(0, 3).map((d: any) => d.name || d.fullName || 'no-name')
      }))
    }, 'info');

    // Secure logging - mask IDs in debug logs
    secureLog({
      retrievedDataCollections: state.retrievedData.map(r => ({
        collection: r.collection,
        count: r.documents.length,
        sampleIds: r.documents.slice(0, 3).map((d: any) => maskSensitiveData(d._id?.toString() || 'no-id'))
      })),
      flattenedDataCount: state.flattenedData.length,
      flattenedDataSample: state.flattenedData.slice(0, 2).map((d: any) => ({
        _id: maskSensitiveData(d._id?.toString() || ''),
        collection: d.collection || 'unknown',
        name: d.name || d.fullName || 'no-name'
      }))
    }, 'debug');

    // Extract "top N" from query to limit data analysis
    const topNMatch = state.originalQuery?.match(/\b(top|find|get|show)\s+(\d+)\b/i);
    const requestedCount = topNMatch ? parseInt(topNMatch[2], 10) : null;
    
    // Limit flattenedData to requested count if "top N" is specified
    let dataToAnalyze = state.flattenedData;
    if (requestedCount && dataToAnalyze.length > requestedCount) {
      logger.info('Analyzer: Limiting data to requested top N', {
        requestedCount,
        totalDataCount: dataToAnalyze.length,
        originalQuery: state.originalQuery
      });
      dataToAnalyze = dataToAnalyze.slice(0, requestedCount);
    }
    
    if (dataToAnalyze.length === 0) {
      logger.warn('Analyzer: No data to analyze', {
        retrievedDataCount: state.retrievedData.length,
        retrievedDataDetails: state.retrievedData.map(r => ({
          collection: r.collection,
          documentCount: r.documents.length
        }))
      });
      return {
        analysis: 'No data found matching your query. Please refine your search criteria.',
        currentNode: 'responder',
        confidence: 0,
      };
    }

    // Detect if this is aggregation data
    const isAggregation = state.flattenedData[0] && 
      ('count' in state.flattenedData[0] || 'sum' in state.flattenedData[0] || 'avg' in state.flattenedData[0]);

    // For decision maker queries, we need to pass retrievedData (structured) not flattenedData
    // so the prompt builder can properly count companies vs employees
    const systemPrompt = dynamicPromptBuilder.buildAnalyzerPrompt(
      state.query,
      state.retrievedData, // Pass structured retrievedData, not flattenedData
      state.intent?.type || 'search',
      isAggregation
    );

    // Detect if this is a decision maker table query
    const isDecisionMakerTableQuery = /\b(decision\s+maker|decision\s+makers)\b/i.test(state.originalQuery) &&
                                      /\b(table|in\s+table|as\s+table)\b/i.test(state.originalQuery);
    
    const userPrompt = isDecisionMakerTableQuery
      ? 'Create a table of decision makers with columns: Decision Maker Name | Company Name | Industry | Title. Match employees to companies using companyId field.'
      : (isAggregation 
          ? 'Format this aggregated data as a clear table with insights and totals.' 
          : 'Analyze this data and provide insights.');
    
    const response = await llmService.chat([
      { role: 'system', content: systemPrompt },
      { 
        role: 'user', 
        content: userPrompt
      },
    ], {
      model: config.models.planner,
      temperature: 0.3,
      maxTokens: 3000,
    });

    logger.info('Analysis generated', { 
      length: response.content.length,
      isAggregation,
      preview: response.content.substring(0, 200),
      dataPointsAnalyzed: dataToAnalyze.length,
      requestedCount: requestedCount || 'none',
      totalDataAvailable: state.flattenedData.length
    });

    // Only route to executor for external actions (not fetch/hop/aggregate)
    const hasExternalActions = state.intent?.actions && 
                                state.intent.actions.length > 0 &&
                                state.intent.actions.some((a: string) => 
                                  !['fetch', 'hop', 'aggregate'].includes(a)
                                );
    
    const nextNode = state.plan?.requiresCritic ? 'critic' : 
      (hasExternalActions ? 'executor' : 'responder');

    // Update lastViewedCompanyIds, lastViewedEmployeeIds, and lastViewedIcpModelIds from retrieved data
    const companyIds: string[] = [...(state.lastViewedCompanyIds || [])];
    const employeeIds: string[] = [...(state.lastViewedEmployeeIds || [])];
    const icpModelIds: string[] = [...(state.lastViewedIcpModelIds || [])];
    
    state.retrievedData.forEach(retrieved => {
      if (retrieved.collection === 'companies') {
        retrieved.documents.forEach((doc: any) => {
          const id = doc._id?.toString();
          if (id && !companyIds.includes(id)) {
            companyIds.push(id);
          }
          // Also extract icpModelId from companies
          const icpModelId = doc.icpModelId?.toString();
          if (icpModelId && !icpModelIds.includes(icpModelId)) {
            icpModelIds.push(icpModelId);
          }
        });
      } else if (retrieved.collection === 'employees') {
        retrieved.documents.forEach((doc: any) => {
          const id = doc._id?.toString();
          if (id && !employeeIds.includes(id)) {
            employeeIds.push(id);
          }
        });
      } else if (retrieved.collection === 'icp_models') {
        retrieved.documents.forEach((doc: any) => {
          const id = doc._id?.toString();
          if (id && !icpModelIds.includes(id)) {
            icpModelIds.push(id);
          }
        });
      }
    });

    logger.debug('Analyzer: Updated last viewed IDs', {
      companyIdsCount: companyIds.length,
      employeeIdsCount: employeeIds.length,
      icpModelIdsCount: icpModelIds.length
    });

    return {
      analysis: response.content,
      currentNode: nextNode,
      confidence: isAggregation ? 1.0 : 0.8, // Aggregations are deterministic
      lastViewedCompanyIds: companyIds,
      lastViewedEmployeeIds: employeeIds,
      lastViewedIcpModelIds: icpModelIds,
    };
  } catch (error: any) {
    logger.error('Analyzer node failed', { error: error.message, stack: error.stack });
    
    return {
      errors: [...state.errors, `Analysis failed: ${error.message}`],
      analysis: 'I encountered an error while analyzing the data.',
      currentNode: 'responder',
      confidence: 0,
    };
  }
}