# Dynamic Context Extraction Guide

## Overview

Your agent now has **dynamic context extraction** capabilities that allow it to intelligently understand and extract data from previous conversations without hardcoding patterns. This makes the agent smarter and more flexible.

## 🎯 How It Works

### 1. **LLM-Based Intent Detection** (Primary Method)

The planner uses **LLM to understand user intent** from the prompt, not just regex patterns. The system prompt includes instructions for detecting:
- Content modification queries (rewrite, edit, modify)
- Explanation queries (explain, clarify, elaborate)
- Data extraction queries (extract, get, show me)
- Follow-up queries (this company, those companies)

**The LLM in the planner is instructed to:**
- Detect when a query references previous content
- Set `intent.type = "analyze"` for content modification queries (NOT "execute")
- Understand user requirements (e.g., "only without extra analysis", "make it shorter")

### 2. **Context Extractor Service** (Secondary Method)

A new `ContextExtractorService` provides intelligent extraction:
- **Pattern-based extraction** (current implementation)
- **LLM-based extraction** (future enhancement - can be added)

**What it extracts:**
- Previous email/content to rewrite
- Specific sections (Email 1, Email 2, Analysis, Table)
- User requirements (shorter, longer, no extra content)
- Referenced data (companies, employees, metrics)

### 3. **Enhanced System Prompts**

The planner prompt now includes explicit instructions for:
- **Content Modification Queries**: `intent.type = "analyze"` (NOT "execute")
- **Explanation Queries**: Use previous analysis/data for detailed explanations
- **Data Extraction Queries**: Extract and format specific data points

## 📊 Current Implementation

### ✅ What's Working

1. **LLM-Based Detection in Planner**
   - Planner LLM receives instructions about content modification queries
   - LLM sets `intent.type = "analyze"` for rewrite/edit queries
   - Regex patterns are used as **fallback only**

2. **Context Extractor Service**
   - Extracts previous content from `previousResults[0].finalAnswer`
   - Detects specific sections (e.g., "Email 1")
   - Extracts user requirements (e.g., "without extra analysis")
   - Provides fallback extraction if service fails

3. **Enhanced Responder**
   - Uses context extractor to get previous content
   - Passes extracted content to prompt builder
   - Handles rewrite, edit, explain, extract queries dynamically

### ⚠️ Current Limitations

1. **Pattern-Based Extraction** (Not Fully LLM-Based Yet)
   - Context extractor currently uses regex patterns
   - Can be enhanced to use LLM for better understanding

2. **Regex Fallbacks**
   - Still uses regex as fallback in planner
   - LLM should handle most cases, but regex provides safety net

## 🚀 How to Make It Fully Dynamic (Future Enhancement)

### Option 1: LLM-Based Context Extraction

Enhance `context-extractor.service.ts` to use LLM:

```typescript
async extractContext(
  currentQuery: string,
  previousResults: PreviousQueryResult[]
): Promise<ExtractedContext | null> {
  // Use LLM to understand what user wants
  const extractionPrompt = this.buildExtractionPrompt(currentQuery, mostRecent);
  
  const llmResponse = await llmService.chatWithJSON([
    { role: 'system', content: extractionPrompt },
    { role: 'user', content: currentQuery }
  ]);
  
  // LLM returns structured extraction
  return {
    type: llmResponse.type, // 'rewrite' | 'edit' | 'explain' | etc.
    targetContent: llmResponse.targetContent,
    targetSection: llmResponse.targetSection,
    requirements: llmResponse.requirements
  };
}
```

### Option 2: Enhanced Planner Prompt

The planner LLM already receives:
- Previous query results with full context
- Instructions about content modification queries
- Examples of how to handle rewrite/edit queries

**The LLM should naturally detect these queries** based on the prompt instructions.

## 📝 Examples

### Example 1: Rewrite Query
```
User: "can you rewrite Email 1: Partnership Scaling Hook only without extra analysis or data"

Flow:
1. Planner LLM detects: intent.type = "analyze" (NOT "execute")
2. Goes through analyzer to get context
3. Context extractor extracts "Email 1" from previousResults[0].finalAnswer
4. Responder receives extracted content and rewrite instructions
5. Responder generates rewritten email
```

### Example 2: Explanation Query
```
User: "explain this analysis in more detail"

Flow:
1. Planner LLM detects: intent.type = "analyze"
2. Context extractor extracts previous analysis
3. Responder provides detailed explanation using previous analysis
```

### Example 3: Data Extraction Query
```
User: "extract just the company names from that report"

Flow:
1. Planner LLM detects: intent.type = "search" or "analyze"
2. Context extractor extracts previous data
3. Responder formats extracted data as requested (table/list)
```

## 🔧 Why This Approach is Better

### Before (Hardcoded):
- ❌ Regex patterns for every query type
- ❌ Need to add new patterns for each new requirement
- ❌ Limited flexibility
- ❌ Misses variations in user language

### After (Dynamic):
- ✅ LLM understands user intent semantically
- ✅ No need to hardcode every pattern
- ✅ Handles variations naturally
- ✅ Can understand context and requirements
- ✅ Regex as fallback for safety

## 🎯 Answer to Your Question

**"Why my agent not smarter to detect those type of user query like rewrite or other requirement should i hardcoded it to be able to detect this"**

**Answer: You DON'T need to hardcode it!**

The system now works in **3 layers**:

1. **LLM-Based Detection** (Primary)
   - Planner LLM receives instructions about rewrite/edit/explain queries
   - LLM naturally understands these queries from the prompt
   - No hardcoding needed - LLM handles variations

2. **Context Extractor Service** (Secondary)
   - Intelligently extracts previous content
   - Can be enhanced with LLM for even better understanding
   - Provides structured extraction

3. **Regex Fallbacks** (Safety Net)
   - Only used as fallback
   - Provides safety if LLM fails
   - Not the primary detection method

## 🚀 Next Steps to Make It Even Smarter

1. **Enhance Context Extractor with LLM**
   - Replace pattern-based extraction with LLM-based
   - Better understanding of user requirements

2. **Add More Query Types to Prompt**
   - The planner prompt already includes instructions
   - Can add more examples for better LLM understanding

3. **Remove Regex Fallbacks** (Optional)
   - Once LLM-based detection is reliable
   - Keep as safety net for now

## 📋 Summary

Your agent **CAN** handle rewrite/edit/explain queries dynamically:
- ✅ LLM in planner understands these queries
- ✅ Context extractor extracts previous content
- ✅ Responder modifies content based on requirements
- ✅ No hardcoding needed for basic cases

**To make it even smarter:**
- Enhance context extractor with LLM
- Add more examples to planner prompt
- Trust the LLM more, use regex less

The system is designed to be **dynamic and flexible**, not hardcoded!

