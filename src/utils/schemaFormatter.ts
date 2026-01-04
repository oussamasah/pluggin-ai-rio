import { COLLECTION_FIELDS } from "../graph/state";

// src/utils/schemaFormatter.ts
export function prepareSchemaForPrompt(): string {
  const collections = Object.entries(COLLECTION_FIELDS);
  
  let schemaText = "=== DATABASE SCHEMA - USE EXACT FIELD NAMES & CORRECT TYPES ===\n\n";
  
  const collectionDescriptions: Record<string, string> = {
    companies: 'Company records with industry, revenue, employee count, technologies, and ICP fit scores',
    employees: 'Employee profiles with roles, skills, decision-maker status (isDecisionMaker: boolean)',
    enrichments: 'Additional company data from external sources (nested JSON objects)',
    gtm_intelligence: 'Go-To-Market analysis and recommendations for companies',
    gtm_persona_intelligence: 'Persona-level intelligence and engagement strategies for employees',
    icp_models: 'Ideal Customer Profile configurations with scoring criteria',
    sessions: 'Search sessions, query history, and refinement state'
  };

  collections.forEach(([collectionName, fields], colIndex) => {
    const collectionTitle = collectionName.toUpperCase();
    schemaText += `${collectionTitle} COLLECTION:\n`;
    schemaText += `Description: ${collectionDescriptions[collectionName] || `Data for ${collectionName}`}\n\n`;
    
    // Group by importance
    const byImportance: Record<string, Array<[string, any]>> = {
      high: [],
      medium: [],
      low: []
    };
    
    Object.entries(fields).forEach(([fieldName, fieldInfo]) => {
      byImportance[fieldInfo.importance].push([fieldName, fieldInfo]);
    });
    
    // Format fields with types and examples
    schemaText += formatFieldsSection("HIGH IMPORTANCE (Required fields)", byImportance.high);
    schemaText += formatFieldsSection("MEDIUM IMPORTANCE (Common query fields)", byImportance.medium.slice(0, 10));
    schemaText += formatFieldsSection("SPECIAL FIELDS (Critical for certain queries)", 
      [...byImportance.low, ...byImportance.medium.slice(10)].filter(([fieldName]) => 
        fieldName.includes('score') || 
        fieldName.includes('Decision') || 
        fieldName.includes('email') ||
        fieldName.includes('phone')
      ).slice(0, 5)
    );
    
    // Add critical collection-specific notes
    schemaText += getCollectionCriticalNotes(collectionName);
    
    // Add collection separator
    if (colIndex < collections.length - 1) {
      schemaText += "=".repeat(60) + "\n\n";
    }
  });
  
  // Add type-based query construction rules
  schemaText += "=== TYPE-BASED QUERY CONSTRUCTION RULES ===\n\n";
  schemaText += "BOOLEAN FIELDS (MUST use true/false):\n";
  schemaText += "- isDecisionMaker: true (for decision makers), false (otherwise)\n";
  schemaText += "- isWorking: true (currently employed), false (not employed)\n";
  schemaText += "- isDeleted: false (active profiles only)\n";
  schemaText += "EXAMPLE: {\"isDecisionMaker\": true}  ✓ CORRECT\n";
  schemaText += "WRONG: {\"isDecisionMaker\": \"decision makers\"}  ✗ INCORRECT\n\n";
  
  schemaText += "STRING FIELDS:\n";
  schemaText += "- Exact: {\"country\": \"United States\"}\n";
  schemaText += "- Partial: {\"name\": {\"$regex\": \"Tech\", \"$options\": \"i\"}}\n";
  schemaText += "- Multiple: {\"industry\": {\"$in\": [\"Technology\", \"Software\"]}}\n\n";
  
  schemaText += "NUMBER FIELDS:\n";
  schemaText += "- Exact: {\"employeeCount\": 100}\n";
  schemaText += "- Range: {\"annualRevenue\": {\"$gt\": 10000000, \"$lt\": 50000000}}\n";
  schemaText += "- Comparisons: $gt, $lt, $gte, $lte, $eq\n\n";
  
  schemaText += "ARRAY FIELDS:\n";
  schemaText += "- Any match: {\"technologies\": {\"$in\": [\"React\", \"Node.js\"]}}\n";
  schemaText += "- All matches: {\"inferredSkills\": {\"$all\": [\"leadership\", \"management\"]}}\n\n";
  
  schemaText += "NESTED FIELDS (dot notation):\n";
  schemaText += "- {\"scoringMetrics.fit_score.score\": {\"$gt\": 50}}\n";
  schemaText += "- Sort: {\"sort\": {\"scoringMetrics.fit_score.score\": -1}}\n";
  schemaText += "- {\"relationships.competitors.name\": \"Competitor A\"}\n\n";
  
  schemaText += "=== REQUIRED FOR ALL QUERIES ===\n";
  schemaText += "- ALWAYS include userId filter: {\"userId\": \"USERID_PLACEHOLDER\"}\n";
  schemaText += "- Validate field exists in schema before using\n";
  schemaText += "- Use exact field names from this schema\n\n";
  
  return schemaText;
}

function formatFieldsSection(title: string, fields: Array<[string, any]>): string {
  if (fields.length === 0) return '';
  
  let section = `${title}:\n`;
  fields.forEach(([fieldName, fieldInfo]) => {
    section += formatField(fieldName, fieldInfo);
  });
  section += "\n";
  return section;
}

function formatField(fieldName: string, fieldInfo: any): string {
  let line = `- ${fieldName} (${fieldInfo.type}`;
  if (fieldInfo.subType) line += `[${fieldInfo.subType}]`;
  line += `): ${fieldInfo.description}\n`;
  
  // Add type-specific query examples
  if (fieldInfo.queryExamples && fieldInfo.queryExamples.length > 0) {
    line += `  → Query: ${fieldInfo.queryExamples[0]}\n`;
  } else if (fieldInfo.type === 'boolean') {
    line += `  → Use: {"${fieldName}": true} or {"${fieldName}": false}\n`;
  } else if (fieldInfo.type === 'string') {
    line += `  → Use: {"${fieldName}": "value"} or {"${fieldName}": {"$regex": "text", "$options": "i"}}\n`;
  } else if (fieldInfo.type === 'number') {
    line += `  → Use: {"${fieldName}": 100} or {"${fieldName}": {"$gt": 50}}\n`;
  } else if (fieldInfo.type === 'array') {
    line += `  → Use: {"${fieldName}": {"$in": ["value1", "value2"]}}\n`;
  }
  
  return line;
}

function getCollectionCriticalNotes(collectionName: string): string {
  const notes: Record<string, string> = {
    companies: 
      "CRITICAL NOTES FOR COMPANIES:\n" +
      "- scoringMetrics.fit_score.score: NUMBER (e.g., 30) - NOT a percentage, NOT 30%\n" +
      "- scoringMetrics.fit_score.confidence: NUMBER (e.g., 70) - NOT a percentage\n" +
      "- For 'top N fit score' queries: sort by {\"scoringMetrics.fit_score.score\": -1}\n" +
      "- industry is ARRAY: use {\"$in\": [\"Technology\"]} NOT {\"industry\": \"Technology\"}\n" +
      "- technologies is ARRAY: use {\"$in\": [\"React\", \"Node.js\"]}\n" +
      "- annualRevenue: numbers (e.g., 20419462 = $20.4M)\n\n",
    
    employees:
      "CRITICAL NOTES FOR EMPLOYEES:\n" +
      "- companyId: Reference to companies._id (ObjectId)\n" +
      "- isDecisionMaker: BOOLEAN - MUST use true/false (NOT strings)\n" +
      "- For decision makers: {\"isDecisionMaker\": true}  ✓\n" +
      "- activeExperienceTitle: Current job title, use $regex for partial matches\n" +
      "- inferredSkills: ARRAY of strings, use $in or $all\n\n",
    
      enrichments:
      "CRITICAL NOTES FOR ENRICHMENTS:\n" +
      "- data: Complex nested object, not directly filterable\n" +
      "- source: External data source (e.g., Crunchbase, Clearbit)\n" +
      "- Use with companyId to find enrichments for specific companies\n\n",
    
    gtm_intelligence:
      "CRITICAL NOTES FOR GTM INTELLIGENCE:\n" +
      "- One GTM record per company per session\n" +
      "- overview: Text analysis, use $regex for keyword searches\n" +
      "- Always join with companies collection via companyId\n\n",
    
    gtm_persona_intelligence:
      "CRITICAL NOTES FOR PERSONA INTELLIGENCE:\n" +
      "- Links employees with GTM strategies\n" +
      "- employeeId references employees._id\n" +
      "- companyId references companies._id\n" +
      "- overview: Persona-specific engagement recommendations\n\n",
    
    icp_models:
      "CRITICAL NOTES FOR ICP MODELS:\n" +
      "- userId: REQUIRED, identifies model owner\n" +
      "- isPrimary: BOOLEAN, indicates default model\n" +
      "- config: Complex object with scoring criteria\n" +
      "- Use config.minEmployees, config.industry, etc. for filtering\n\n",
    
    sessions:
      "CRITICAL NOTES FOR SESSIONS:\n" +
      "- query: ARRAY of search queries used in session\n" +
      "- resultsCount: Number of companies found\n" +
      "- searchStatus: Current status object with stage and progress\n" +
      "- refinementState: Query refinement workflow state\n" +
      "- currentProposal: Latest query proposal for user review\n\n"
  };
  
  return notes[collectionName] || "";
}