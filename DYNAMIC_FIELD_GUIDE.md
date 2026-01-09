# Dynamic Field System Guide

## Overview

Your RIO agentic system is now **fully dynamic** and **schema-driven**. You no longer need to hardcode field detection or update multiple files when adding new fields. The system automatically:

1. **Detects relevant fields** from user queries using semantic matching
2. **Preserves important fields** during document cleaning
3. **Enhances prompts** with relevant field information
4. **Adapts to new fields** automatically when added to schema

## How It Works

### 1. Schema-Driven Field Metadata

Fields in `schema.service.ts` now include rich metadata:

```typescript
{
  name: 'scoringMetrics.intent_score',
  type: 'Mixed',
  description: 'Buying intent analysis with signals and GTM intelligence',
  category: 'scoring',
  importance: 'high',
  synonyms: ['intent score', 'intent_score', 'buying intent', 'intent analysis'],
  examples: ['intent score details', 'buying intent analysis'],
  nestedFields: [
    'scoringMetrics.intent_score.analysis_metadata.final_intent_score',
    'scoringMetrics.intent_score.signal_breakdown',
    // ... more nested fields
  ]
}
```

### 2. Field Matcher Service

The `FieldMatcherService` automatically:
- Matches user queries to schema fields using:
  - Direct name matching
  - Synonym matching
  - Description matching
  - Category matching
  - Nested field matching
- Scores field relevance (0.0 - 1.0)
- Determines query context (e.g., `intent_score_query`, `fit_score_query`)
- Suggests fields to preserve

### 3. Automatic Integration

All components now use the field matcher:
- **Document Cleaner**: Preserves relevant fields based on query
- **Search Service**: Detects query context and prioritizes fields
- **Dynamic Prompt Builder**: Adds field descriptions to prompts
- **No hardcoding needed!**

## Adding New Fields - Zero Code Changes Required

### Step 1: Add Field to Schema with Metadata

In `rio/src/services/schema.service.ts`, add your new field with metadata:

```typescript
{
  name: 'scoringMetrics.new_score', // Your new field
  type: 'Mixed', // or 'Number', 'String', etc.
  isArray: false,
  isRequired: false,
  description: 'Description of what this field contains',
  category: 'scoring', // or 'financial', 'contact', 'technology', etc.
  importance: 'high', // 'high', 'medium', or 'low'
  searchable: true, // Should it be searchable?
  analyzable: true, // Should it be included in analysis?
  synonyms: ['new score', 'new_score', 'alternative name'], // What users might call it
  examples: ['show me new score', 'companies with high new score'],
  nestedFields: [ // If it's a nested object
    'scoringMetrics.new_score.value',
    'scoringMetrics.new_score.confidence'
  ]
}
```

### Step 2: That's It!

The system will automatically:
- ✅ Detect when users ask for "new score"
- ✅ Preserve `scoringMetrics.new_score` in document cleaning
- ✅ Include it in prompts when relevant
- ✅ Prioritize it in search results
- ✅ Analyze it when requested

**No code changes needed in:**
- `documentCleaner.ts` ❌
- `search.service.ts` ❌
- `dynamic-builder.ts` ❌
- `planner.ts` ❌

## Field Metadata Properties

### Required Properties
- `name`: Field path (e.g., `scoringMetrics.intent_score`)
- `type`: Field type (`String`, `Number`, `Mixed`, `Boolean`, etc.)
- `isArray`: Whether it's an array
- `isRequired`: Whether it's required

### Optional Properties (for Dynamic Matching)
- `description`: Human-readable description
- `category`: Field category (`scoring`, `financial`, `contact`, `technology`, `classification`)
- `importance`: `high`, `medium`, or `low`
- `searchable`: Should field be included in semantic search? (default: `false`)
- `analyzable`: Should field be included in analysis? (default: `false`)
- `synonyms`: Array of alternative names users might use
- `examples`: Example queries that use this field
- `nestedFields`: Array of child field paths (for nested objects)

## How Field Matching Works

### Example Query: "give me details about intent_score for company C2FO"

1. **Field Matcher** analyzes query:
   - Finds "intent_score" in query
   - Matches to `scoringMetrics.intent_score` field
   - Scores relevance: 0.9 (high)
   - Determines context: `intent_score_query`

2. **Document Cleaner**:
   - Receives context: `intent_score_query`
   - Gets fields to preserve from field matcher
   - Preserves: `scoringMetrics.intent_score` and all nested fields

3. **Search Service**:
   - Detects `intent_score_query` context
   - Prioritizes intent_score fields in cleaning

4. **Dynamic Prompt Builder**:
   - Adds field descriptions to analyzer prompt
   - Instructs LLM to focus on intent_score data
   - Provides structure information

5. **Result**: Deep analysis of intent_score, not generic company info!

## Query Context Detection

The system automatically detects query contexts:

- `intent_score_query`: User asks about intent scores
- `fit_score_query`: User asks about fit scores
- `scoring_query`: User asks about any scoring metrics
- `financial_query`: User asks about revenue, funding, etc.
- `technology_query`: User asks about tech stack
- `contact_query`: User asks about contact information
- `general_query`: General company information

## Best Practices

### 1. Always Add Metadata for Important Fields

```typescript
// ✅ GOOD: Rich metadata
{
  name: 'scoringMetrics.new_metric',
  description: 'New scoring metric',
  synonyms: ['new metric', 'new_metric'],
  category: 'scoring',
  importance: 'high'
}

// ❌ BAD: No metadata
{
  name: 'scoringMetrics.new_metric',
  type: 'Number'
  // No description, synonyms, etc. - system can't match it intelligently
}
```

### 2. Use Descriptive Categories

Categories help the system group related fields:
- `scoring`: All scoring-related fields
- `financial`: Revenue, funding, financial data
- `contact`: Email, phone, addresses
- `technology`: Tech stack, tools, platforms
- `classification`: Industry, sector, market

### 3. Add Synonyms for Common Variations

Users might use different terms:
```typescript
synonyms: [
  'intent score',      // Space
  'intent_score',      // Underscore
  'buying intent',     // Alternative term
  'intent analysis'    // Related term
]
```

### 4. Include Nested Fields

For nested objects, list all important child fields:
```typescript
nestedFields: [
  'scoringMetrics.intent_score.analysis_metadata.final_intent_score',
  'scoringMetrics.intent_score.signal_breakdown',
  'scoringMetrics.intent_score.gtm_intelligence'
]
```

## Testing New Fields

1. Add field to schema with metadata
2. Test query: "show me [field name] for company X"
3. Check logs for:
   - Field matching scores
   - Query context detection
   - Fields preserved in cleaning
4. Verify response focuses on requested field

## Troubleshooting

### Field Not Detected?

1. Check if field has `description` and `synonyms`
2. Verify synonyms match user query terms
3. Check `importance` - low importance fields may be filtered
4. Review logs for field matching scores

### Field Not Preserved?

1. Check if `analyzable: true` is set
2. Verify `importance` is `high` or `medium`
3. Check if field is in `nestedFields` of parent object
4. Review document cleaner logs

### Wrong Query Context?

1. Check field `category` matches query intent
2. Verify `synonyms` include query terms
3. Review field matcher logs for context determination

## Migration from Hardcoded System

If you have existing hardcoded field detection:

1. **Remove hardcoded patterns** from:
   - `documentCleaner.ts` (in `extractQueryContext`)
   - `search.service.ts` (field detection)
   - `dynamic-builder.ts` (field checks)

2. **Add metadata** to schema for those fields

3. **Test** - system should work automatically!

## Summary

✅ **No hardcoding needed** - just add metadata to schema  
✅ **Automatic field detection** - semantic matching  
✅ **Dynamic prompt enhancement** - relevant fields included automatically  
✅ **Self-adapting** - works with any new field you add  
✅ **Intelligent** - understands synonyms and related terms  

Your agentic system is now truly **dynamic and intelligent**! 🚀

