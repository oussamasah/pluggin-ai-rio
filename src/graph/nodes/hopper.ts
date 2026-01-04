import { hoppingEngine } from '../../retrieval/hopping-engine';
import { logger } from '../../core/logger';
import { GraphState } from '../state';
import { hybridRetriever } from '../../retrieval/hybrid-retriever';
import { getStreamCallbacks } from '../graph-stream';

export async function hopperNode(state: GraphState): Promise<Partial<GraphState>> {
  // Send progress update when node starts
  const streamCallbacks = getStreamCallbacks();
  if (streamCallbacks?.onProgress) {
    streamCallbacks.onProgress('hopper', 'Gathering related information...', 40);
  }
  
  try {
    logger.info('Hopper node executing', { userId: state.userId });

    if (!state.plan) {
      throw new Error('No plan available for hopping');
    }

    const hopSteps = state.plan.steps.filter(step => step.action === 'hop');
    
    if (hopSteps.length === 0) {
      return {
        currentNode: 'analyzer',
      };
    }

    const additionalData: any[] = [];

    for (const step of hopSteps) {
      // If hoppingPath is missing, try to infer it from the step's query
      let hoppingPath = step.hoppingPath;
      
      // Try to infer hopping path if missing
      if (!hoppingPath) {
        // If query has companyId, infer companies -> employees
        if (step.query && step.query.companyId) {
          hoppingPath = {
            from: 'companies',
            to: step.collection,
            via: 'companyId',
            cardinality: 'one-to-many'
          };
          logger.info('Inferred hopping path from query', { hoppingPath, stepId: step.stepId });
        } else if (step.collection === 'employees') {
          // Default: if target is employees and no explicit path, assume companies -> employees
          hoppingPath = {
            from: 'companies',
            to: 'employees',
            via: 'companyId',
            cardinality: 'one-to-many'
          };
          logger.info('Inferred default hopping path for employees', { hoppingPath, stepId: step.stepId });
        } else if (step.collection === 'companies') {
          // If target is companies and we have employees data, infer employees -> companies (reverse hop)
          const hasEmployees = state.retrievedData.some(d => d.collection === 'employees' && d.documents.length > 0);
          if (hasEmployees) {
            hoppingPath = {
              from: 'employees',
              to: 'companies',
              via: 'companyId',
              cardinality: 'many-to-one'
            };
            logger.info('Inferred reverse hopping path - employees to companies', { hoppingPath, stepId: step.stepId });
          }
        }
      }

      if (!hoppingPath) {
        // Try to infer from employeeId field (for gtm_persona_intelligence)
        if (step.query && step.query.employeeId) {
          const hasEmployees = state.retrievedData.some(d => d.collection === 'employees' && d.documents.length > 0);
          if (hasEmployees && step.collection === 'gtm_persona_intelligence') {
            hoppingPath = {
              from: 'employees',
              to: 'gtm_persona_intelligence',
              via: 'employeeId',
              cardinality: 'one-to-one'
            };
            logger.info('Inferred hopping path - employees to gtm_persona_intelligence', { hoppingPath, stepId: step.stepId });
          }
        }
        
        if (!hoppingPath) {
          logger.warn('No hopping path available for step', { 
            stepId: step.stepId, 
            collection: step.collection,
            queryKeys: step.query ? Object.keys(step.query) : []
          });
          continue;
        }
      }

      // Find source data - try to use data from the specific dependency step if available
      let sourceData: any = null;
      
      // If step has dependencies, try to find data from the dependency step
      if (step.dependencies && step.dependencies.length > 0) {
        // Find the dependency step in the plan
        const dependencyStep = state.plan?.steps?.find((s: any) => 
          step.dependencies?.includes(s.stepId)
        );
        
        if (dependencyStep) {
          // Try to find data that matches the dependency step's collection
          sourceData = state.retrievedData.find(
            d => d.collection === dependencyStep.collection
          );
          
          logger.info('Hopper: Using source data from dependency step', {
            stepId: step.stepId,
            dependencyStepId: dependencyStep.stepId,
            dependencyCollection: dependencyStep.collection,
            sourceDataCount: sourceData?.documents?.length || 0
          });
        }
      }
      
      // If not found from dependencies, try hoppingPath.from
      if (!sourceData || sourceData.documents.length === 0) {
        sourceData = state.retrievedData.find(
          d => d.collection === hoppingPath!.from
        );
      }

      // If still not found, try to find any data that could be the source
      if (!sourceData || sourceData.documents.length === 0) {
        // For employees hop, look for companies data
        if (step.collection === 'employees' && hoppingPath.from === 'companies') {
          sourceData = state.retrievedData.find(d => d.collection === 'companies');
        }
        // For companies hop, look for employees data (reverse hop)
        else if (step.collection === 'companies' && hoppingPath.from === 'employees') {
          sourceData = state.retrievedData.find(d => d.collection === 'employees');
        }
      }
      
      // CRITICAL: If we have dependencies and sourceData, ensure we only use documents from the dependency step
      // This prevents using companies from previous queries or other steps
      if (sourceData && step.dependencies && step.dependencies.length > 0 && sourceData.documents.length > 0) {
        const dependencyStep = state.plan?.steps?.find((s: any) => 
          step.dependencies?.includes(s.stepId)
        );
        
        if (dependencyStep && dependencyStep.collection === sourceData.collection) {
          // Log the filtering to help debug
          logger.info('Hopper: Source data found from dependency step', {
            stepId: step.stepId,
            dependencyStepId: dependencyStep.stepId,
            sourceCollection: sourceData.collection,
            sourceDocumentCount: sourceData.documents.length,
            sourceCompanyNames: sourceData.collection === 'companies' 
              ? sourceData.documents.slice(0, 5).map((d: any) => d.name || 'no-name')
              : []
          });
        }
      }
      
      // Handle reverse hop: employees → companies using companyId field
      if (hoppingPath.from === 'employees' && hoppingPath.to === 'companies' && sourceData && sourceData.documents.length > 0) {
        // Extract companyIds from employee documents
        const companyIds = sourceData.documents
          .map((doc: any) => doc.companyId?.toString())
          .filter((id: string | undefined): id is string => !!id && id !== 'undefined');
        
        if (companyIds.length > 0) {
          logger.info('Hopper: Reverse hop - employees to companies using companyId', {
            employeeCount: sourceData.documents.length,
            companyIdsCount: companyIds.length,
            companyIds: companyIds.slice(0, 5)
          });
          
          // Build query to fetch companies by their IDs
          const companyQuery = {
            ...step.query,
            userId: state.userId,
            _id: { $in: companyIds }
          };
          
          const companyData = await hybridRetriever.retrieveWithPlan(
            companyQuery,
            'companies',
            state.userId,
            {
              limit: step.limit || companyIds.length,
              sort: step.sort,
              includeRelated: false
            }
          );
          
          if (companyData.length > 0 && companyData[0].documents.length > 0) {
            const hoppedCompanies = companyData[0].documents;
            
            const existingCollection = state.retrievedData.find(
              d => d.collection === 'companies'
            );
            
            if (existingCollection) {
              // Merge companies, avoiding duplicates
              const existingIds = new Set(existingCollection.documents.map((d: any) => d._id.toString()));
              const newCompanies = hoppedCompanies.filter((c: any) => !existingIds.has(c._id.toString()));
              existingCollection.documents.push(...newCompanies);
              existingCollection.metadata.count += newCompanies.length;
            } else {
              state.retrievedData.push({
                collection: 'companies',
                documents: hoppedCompanies,
                limit: step.limit,
                sort: step.sort,
                metadata: {
                  count: hoppedCompanies.length,
                  searchMethod: 'metadata',
                  confidence: 0.9,
                },
              });
            }
            
            logger.info('Hopper: Reverse hop completed - employees to companies', {
              companiesFound: hoppedCompanies.length
            });
            
            continue; // Skip to next hop step
          }
        }
      }
      
      // Handle employees → gtm_persona_intelligence using employeeId field
      if (hoppingPath.from === 'employees' && hoppingPath.to === 'gtm_persona_intelligence' && sourceData && sourceData.documents.length > 0) {
        // Extract employeeIds from employee documents
        const employeeIds = sourceData.documents
          .map((doc: any) => doc._id?.toString())
          .filter((id: string | undefined): id is string => !!id && id !== 'undefined');
        
        if (employeeIds.length > 0) {
          logger.info('Hopper: Reverse hop - employees to gtm_persona_intelligence using employeeId', {
            employeeCount: sourceData.documents.length,
            employeeIdsCount: employeeIds.length,
            employeeIds: employeeIds.slice(0, 5)
          });
          
          // Build query to fetch persona intelligence by employee IDs
          const personaQuery = {
            ...step.query,
            userId: state.userId,
            employeeId: { $in: employeeIds }
          };
          
          const personaData = await hybridRetriever.retrieveWithPlan(
            personaQuery,
            'gtm_persona_intelligence',
            state.userId,
            {
              limit: step.limit || employeeIds.length,
              sort: step.sort,
              includeRelated: false
            }
          );
          
          if (personaData.length > 0 && personaData[0].documents.length > 0) {
            const hoppedPersonas = personaData[0].documents;
            
            const existingCollection = state.retrievedData.find(
              d => d.collection === 'gtm_persona_intelligence'
            );
            
            if (existingCollection) {
              // Merge personas, avoiding duplicates
              const existingIds = new Set(existingCollection.documents.map((d: any) => d._id.toString()));
              const newPersonas = hoppedPersonas.filter((p: any) => !existingIds.has(p._id.toString()));
              existingCollection.documents.push(...newPersonas);
              existingCollection.metadata.count += newPersonas.length;
            } else {
              state.retrievedData.push({
                collection: 'gtm_persona_intelligence',
                documents: hoppedPersonas,
                limit: step.limit,
                sort: step.sort,
                metadata: {
                  count: hoppedPersonas.length,
                  searchMethod: 'metadata',
                  confidence: 0.9,
                },
              });
            }
            
            logger.info('Hopper: Reverse hop completed - employees to gtm_persona_intelligence', {
              personasFound: hoppedPersonas.length
            });
            
            continue; // Skip to next hop step
          }
        }
      }
      
      // Handle employees → gtm_persona_intelligence using employeeId field
      if (hoppingPath.from === 'employees' && hoppingPath.to === 'gtm_persona_intelligence' && sourceData && sourceData.documents.length > 0) {
        // Extract employeeIds from employee documents
        const employeeIds = sourceData.documents
          .map((doc: any) => doc._id?.toString())
          .filter((id: string | undefined): id is string => !!id && id !== 'undefined');
        
        if (employeeIds.length > 0) {
          logger.info('Hopper: Reverse hop - employees to gtm_persona_intelligence using employeeId', {
            employeeCount: sourceData.documents.length,
            employeeIdsCount: employeeIds.length,
            employeeIds: employeeIds.slice(0, 5)
          });
          
          // Build query to fetch persona intelligence by employee IDs
          const personaQuery = {
            ...step.query,
            userId: state.userId,
            employeeId: { $in: employeeIds }
          };
          
          const personaData = await hybridRetriever.retrieveWithPlan(
            personaQuery,
            'gtm_persona_intelligence',
            state.userId,
            {
              limit: step.limit || employeeIds.length,
              sort: step.sort,
              includeRelated: false
            }
          );
          
          if (personaData.length > 0 && personaData[0].documents.length > 0) {
            const hoppedPersonas = personaData[0].documents;
            
            const existingCollection = state.retrievedData.find(
              d => d.collection === 'gtm_persona_intelligence'
            );
            
            if (existingCollection) {
              // Merge personas, avoiding duplicates
              const existingIds = new Set(existingCollection.documents.map((d: any) => d._id.toString()));
              const newPersonas = hoppedPersonas.filter((p: any) => !existingIds.has(p._id.toString()));
              existingCollection.documents.push(...newPersonas);
              existingCollection.metadata.count += newPersonas.length;
            } else {
              state.retrievedData.push({
                collection: 'gtm_persona_intelligence',
                documents: hoppedPersonas,
                limit: step.limit,
                sort: step.sort,
                metadata: {
                  count: hoppedPersonas.length,
                  searchMethod: 'metadata',
                  confidence: 0.9,
                },
              });
            }
            
            logger.info('Hopper: Reverse hop completed - employees to gtm_persona_intelligence', {
              personasFound: hoppedPersonas.length
            });
            
            continue; // Skip to next hop step
          }
        }
      }

      // If no source data but step has a direct query, try to execute it anyway
      // This handles cases where companies query returned 0 results but we still want to query employees
      if (!sourceData || sourceData.documents.length === 0) {
        // If step has a query with filters (not just companyId), try direct query
        if (step.query && Object.keys(step.query).length > 1) {
          // Check if query has filters beyond companyId
          const hasOtherFilters = Object.keys(step.query).some(key => 
            key !== 'companyId' && key !== 'userId'
          );
          
          if (hasOtherFilters) {
            logger.info('No source data for hop, but step has filters - executing direct query', {
              collection: step.collection,
              queryKeys: Object.keys(step.query)
            });
            
            // Execute query directly without companyId filter
            const directQuery = { ...step.query };
            // Remove companyId if it's using FROM_STEP placeholder
            if (directQuery.companyId && typeof directQuery.companyId === 'object' && 
                directQuery.companyId.$in && Array.isArray(directQuery.companyId.$in) &&
                directQuery.companyId.$in.some((id: string) => id.includes('FROM_STEP'))) {
              delete directQuery.companyId;
            }
            
            const directData = await hybridRetriever.retrieveWithPlan(
              directQuery,
              step.collection,
              state.userId,
              {
                limit: step.limit || 50,
                sort: step.sort,
                includeRelated: false
              }
            );
            
            if (directData.length > 0 && directData[0].documents.length > 0) {
              const hoppedDocs = directData[0].documents;
              
              const existingCollection = state.retrievedData.find(
                d => d.collection === step.collection
              );

              if (existingCollection) {
                existingCollection.documents.push(...hoppedDocs);
                existingCollection.metadata.count += hoppedDocs.length;
              } else {
                state.retrievedData.push({
                  collection: step.collection,
                  documents: hoppedDocs,
                  limit: step.limit,
                  sort: step.sort,
                  metadata: {
                    count: hoppedDocs.length,
                    searchMethod: 'metadata',
                    confidence: 0.9,
                  },
                });
              }
              continue;
            }
          }
        }
        
        logger.warn('No source data found for hop and no alternative query available', { 
          from: hoppingPath.from, 
          to: step.collection,
          availableCollections: state.retrievedData.map(d => d.collection)
        });
        continue;
      }

      // If step has a query with companyId $in, use that directly instead of hopping engine
      if (step.query && step.query.companyId && step.query.companyId.$in) {
        // Handle placeholder replacement first (FROM_STEP_X_COMPANY_IDS)
        let companyIds: string[] = [];
        
        // Check if companyId.$in contains placeholder strings
        const companyIdIn = step.query.companyId.$in;
        if (Array.isArray(companyIdIn)) {
          // Check if it contains placeholder strings
          const hasPlaceholder = companyIdIn.some((id: any) => 
            typeof id === 'string' && id.includes('FROM_STEP') && id.includes('COMPANY')
          );
          
          if (hasPlaceholder) {
            // Extract company IDs from source data (from dependency step)
            companyIds = sourceData.documents
              .map((doc: any) => doc._id?.toString())
              .filter((id: string | undefined): id is string => !!id && id !== 'undefined');
            
            logger.info('Hopper: Replaced company ID placeholder from source data', {
              stepId: step.stepId,
              companyIdsCount: companyIds.length,
              sourceDataCount: sourceData.documents.length
            });
          } else {
            // Already has real IDs, use them
            companyIds = companyIdIn
              .map((id: any) => id?.toString())
              .filter((id: string | undefined): id is string => !!id && id !== 'undefined');
          }
        } else {
          // Not an array, extract from source data
          companyIds = sourceData.documents
            .map((doc: any) => doc._id?.toString())
            .filter((id: string | undefined): id is string => !!id && id !== 'undefined');
        }
        
        // Build query with company IDs
        const hopQuery = {
          ...step.query,
          companyId: { $in: companyIds }
        };

        logger.info('Hopper: Executing hop query with company IDs', {
          collection: step.collection,
          mongoQuery: JSON.stringify(hopQuery),
          companyIds: companyIds.slice(0, 5),
          companyIdsCount: companyIds.length,
          sourceCompanyNames: sourceData.documents.slice(0, 3).map((d: any) => d.name || 'no-name')
        });

        // Execute query directly
        // For "all" queries, use higher limit (500) if step limit is not set or is too low
        // The planner should set step.limit to 500 for "all" queries, but ensure we use at least 500
        const effectiveLimit = step.limit && step.limit >= 500 ? step.limit : Math.max(step.limit || 500, 500);
        const hopData = await hybridRetriever.retrieveWithPlan(
          hopQuery,
          step.collection,
          state.userId,
          {
            limit: effectiveLimit,
            sort: step.sort,
            includeRelated: false
          }
        );

        if (hopData.length > 0 && hopData[0].documents.length > 0) {
          const hoppedDocs = hopData[0].documents;
          
          // Update lastViewedEmployeeIds if we hopped to employees
          const newEmployeeIds = step.collection === 'employees' 
            ? hoppedDocs.map((doc: any) => doc._id?.toString()).filter(Boolean)
            : [];
          
          // Update lastViewedCompanyIds if we hopped to companies
          const newCompanyIds = step.collection === 'companies'
            ? hoppedDocs.map((doc: any) => doc._id?.toString()).filter(Boolean)
            : [];
          
          // Update lastViewedIcpModelIds if we hopped to companies (extract from company documents)
          const newIcpModelIds = step.collection === 'companies'
            ? hoppedDocs.map((doc: any) => doc.icpModelId?.toString()).filter(Boolean)
            : step.collection === 'icp_models'
            ? hoppedDocs.map((doc: any) => doc._id?.toString()).filter(Boolean)
            : [];
          
          logger.info('Hopper: Updating last viewed IDs from hop', {
            collection: step.collection,
            newEmployeeIdsCount: newEmployeeIds.length,
            newCompanyIdsCount: newCompanyIds.length,
            newIcpModelIdsCount: newIcpModelIds.length
          });
          
          const existingCollection = state.retrievedData.find(
            d => d.collection === step.collection
          );

          if (existingCollection) {
            existingCollection.documents.push(...hoppedDocs);
            existingCollection.metadata.count += hoppedDocs.length;
          } else {
            state.retrievedData.push({
              collection: step.collection,
              documents: hoppedDocs,
              limit: step.limit,
              sort: step.sort,
              metadata: {
                count: hoppedDocs.length,
                searchMethod: 'metadata',
                confidence: 0.9,
              },
            });
          }
          continue;
        }
      }

      // Fall back to hopping engine
      const hoppedDocs = await hoppingEngine.executeHop(
        { ...step, hoppingPath },
        state.userId,
        sourceData.documents
      );

      if (hoppedDocs.length > 0) {
        additionalData.push(...hoppedDocs);
        
        const existingCollection = state.retrievedData.find(
          d => d.collection === step.collection
        );

        if (existingCollection) {
          existingCollection.documents.push(...hoppedDocs);
        } else {
          state.retrievedData.push({
            collection: step.collection,
            documents: hoppedDocs,
            metadata: {
              count: hoppedDocs.length,
              searchMethod: 'metadata',
              confidence: 0.9,
            },
          });
        }
      }
    }

    const updatedFlattenedData = hybridRetriever.flattenResults(state.retrievedData);

    // Update lastViewedCompanyIds, lastViewedEmployeeIds, and lastViewedIcpModelIds from all retrieved data
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

    logger.info('Hopping completed', { 
      additionalDocs: additionalData.length,
      updatedCompanyIdsCount: companyIds.length,
      updatedEmployeeIdsCount: employeeIds.length,
      updatedIcpModelIdsCount: icpModelIds.length
    });

    return {
      retrievedData: state.retrievedData,
      flattenedData: updatedFlattenedData,
      lastViewedCompanyIds: companyIds,
      lastViewedEmployeeIds: employeeIds,
      lastViewedIcpModelIds: icpModelIds,
      currentNode: 'analyzer',
    };
  } catch (error: any) {
    logger.error('Hopper node failed', { error: error.message });
    
    return {
      errors: [...state.errors, `Hopping failed: ${error.message}`],
      currentNode: 'analyzer',
    };
  }
}
