# LLM vs Hardcoding: When to Use Each Approach

## 🎯 Answer: **NO, You Should NOT Hardcode All Cases**

### The Right Approach: **LLM-First with Regex Fallback**

Your system should work in **3 layers**:

1. **LLM-Based Detection** (Primary - 90% of cases)
2. **Context Extractor Service** (Secondary - handles edge cases)
3. **Regex Patterns** (Fallback - safety net only)

## 📊 Current Architecture

### ✅ What's Already Working (LLM-Based)

The planner LLM receives comprehensive instructions about:
- Employee name detection
- Company name detection
- Query intent understanding
- Entity extraction rules

**The LLM should naturally understand:**
- "analysis of Casey Nolte profile" → Extract "Casey Nolte", use `fullName` field
- "give me Francis Dayapan's company" → Extract "Francis Dayapan", fetch employee, hop to company
- "rewrite Email 1" → Content modification query, not action query

### ⚠️ Current Issue: Regex Override

The problem is that **regex patterns are overriding LLM decisions**. The regex runs AFTER the LLM, which can:
- Override correct LLM decisions
- Miss cases the LLM would catch
- Require constant updates for new patterns

## 🔧 Solution: Trust the LLM More

### Step 1: Enhance LLM Instructions (Already Done ✅)

I've added to the planner prompt:
- Explicit instructions for employee name detection
- Examples of employee name queries
- Field name guidance (`fullName` vs `name`)
- Pattern variations the LLM should recognize

### Step 2: Make Regex Optional (Recommended)

**Current Flow:**
```
LLM generates plan → Regex detects name → Regex overrides plan
```

**Better Flow:**
```
LLM generates plan → Check if LLM already extracted name → Only use regex if LLM missed it
```

### Step 3: Use Regex as Validation, Not Override

Instead of overriding, use regex to:
- **Validate** LLM's extraction
- **Warn** if LLM missed something
- **Log** for debugging
- **Only override** if confidence is very low

## 📝 Example: Employee Name Detection

### Query: "give analysis of Casey Nolte profile and his company"

**LLM Should Generate:**
```json
{
  "intent": {
    "type": "analyze",
    "entities": [
      {
        "type": "employee",
        "value": "Casey Nolte",
        "field": "fullName",
        "collectionHint": "employees"
      }
    ]
  },
  "plan": {
    "steps": [
      {
        "action": "fetch",
        "collection": "employees",
        "query": {
          "userId": "USERID_PLACEHOLDER",
          "fullName": {"$regex": "Casey Nolte", "$options": "i"}
        }
      },
      {
        "action": "hop",
        "collection": "companies",
        "dependencies": ["step_1"]
      }
    ]
  }
}
```

**Regex Should:**
- ✅ Validate that LLM extracted "Casey Nolte"
- ✅ Log if extraction looks correct
- ❌ NOT override if LLM already has it
- ⚠️ Only add if LLM completely missed it

## 🚀 Recommended Changes

### 1. Check LLM First, Regex Second

```typescript
// In planner.ts
const llmExtractedEmployeeName = response.intent?.entities?.find(
  e => e.type === 'employee' && e.field === 'fullName'
)?.value;

if (llmExtractedEmployeeName) {
  // LLM already extracted it - use that
  detectedEmployeeName = llmExtractedEmployeeName;
  logger.info('Using LLM-extracted employee name', { name: detectedEmployeeName });
} else {
  // LLM missed it - use regex as fallback
  detectedEmployeeName = extractWithRegex(state.originalQuery);
  if (detectedEmployeeName) {
    logger.warn('LLM missed employee name, using regex fallback', { name: detectedEmployeeName });
  }
}
```

### 2. Enhance LLM Prompt (Already Done ✅)

The prompt now includes:
- Employee name extraction examples
- Field name guidance (`fullName`)
- Pattern variations
- Query structure examples

### 3. Reduce Regex Patterns

Keep only the most critical patterns:
- Common edge cases
- Safety validation
- Fallback for LLM failures

Remove patterns that:
- Duplicate LLM capabilities
- Are too specific
- Require constant updates

## 🎯 When to Use Each Approach

### Use LLM For:
- ✅ Semantic understanding ("analysis of [Name] profile")
- ✅ Context-aware extraction
- ✅ Handling variations naturally
- ✅ Understanding user intent
- ✅ Complex queries with multiple entities

### Use Regex For:
- ⚠️ Safety validation
- ⚠️ Fallback when LLM fails
- ⚠️ Very specific edge cases
- ⚠️ Performance-critical paths (if needed)

### Use Context Extractor For:
- ✅ Extracting previous content
- ✅ Understanding requirements
- ✅ Section identification (Email 1, Email 2)

## 📋 Summary

**You DON'T need to hardcode all cases because:**

1. **LLM is Primary** - The planner LLM receives comprehensive instructions
2. **Regex is Fallback** - Only used when LLM fails
3. **Context Extractor** - Handles previous content extraction
4. **Prompt Engineering** - Better prompts = better LLM understanding

**The fix for "Casey Nolte" issue:**
- ✅ Enhanced LLM prompt with employee name examples
- ✅ Added field name guidance (`fullName`)
- ✅ Added query pattern examples
- ⚠️ Regex still runs as fallback (but shouldn't override if LLM got it)

**Next step:** Trust the LLM more, use regex less. The LLM should handle 90% of cases naturally.

