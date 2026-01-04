# Security Implementation Guide

## Overview

This document describes the comprehensive security measures implemented in the RIO agent to protect sensitive data including API keys, session IDs, user IDs, and other confidential information.

## Security Features

### 1. **Input Validation & Sanitization**

- **Location**: `rio/src/utils/security.ts` → `validateInput()`
- **Purpose**: Prevents injection attacks (SQL, NoSQL, XSS, Command Injection)
- **Features**:
  - Detects and sanitizes dangerous patterns
  - Removes null bytes and control characters
  - Limits input length to prevent DoS attacks
  - Validates userId and sessionId formats

**Usage**:
```typescript
import { validateInput } from './utils/security';

const sanitizedQuery = validateInput(userQuery);
```

### 2. **Sensitive Data Masking**

- **Location**: `rio/src/utils/security.ts` → `maskSensitiveData()`
- **Purpose**: Masks sensitive information in logs and responses
- **Detects**:
  - API keys and tokens
  - Session IDs
  - User IDs
  - MongoDB URIs
  - JWT tokens
  - Email addresses
  - Credit card numbers
  - Phone numbers

**Usage**:
```typescript
import { maskSensitiveData } from './utils/security';

const masked = maskSensitiveData("API key: sk-1234567890abcdef");
// Returns: "API key: ******************"
```

### 3. **Output Filtering**

- **Location**: `rio/src/utils/security.ts` → `filterResponse()`
- **Purpose**: Removes sensitive fields from API responses
- **Removes**:
  - `apiKey`, `api_key`
  - `accessToken`, `access_token`
  - `secret`, `password`, `token`
  - `sessionId`, `session_id`
  - `mongoUri`, `mongodb_uri`
  - `connectionString`, `connection_string`

**Usage**:
```typescript
import { filterResponse } from './utils/security';

const safeResponse = filterResponse(apiResponse);
```

### 4. **Secure Logging**

- **Location**: `rio/src/utils/security.ts` → `secureLog()`
- **Purpose**: Automatically masks sensitive data before logging
- **Implementation**: Used throughout the codebase in place of direct `logger` calls

**Usage**:
```typescript
import { secureLog } from './utils/security';

secureLog({
  userId: "user_1234567890",
  query: "show me API keys",
  apiKey: "sk-1234567890"
}, 'info');
// Logs with masked values
```

### 5. **Suspicious Query Detection**

- **Location**: `rio/src/utils/security.ts` → `isSuspiciousQuery()`
- **Purpose**: Detects queries attempting to access sensitive data
- **Detects**:
  - Requests for API keys, secrets, tokens
  - Requests to dump/export all data
  - Requests to delete/clear database
  - Requests for credentials

**Usage**:
```typescript
import { isSuspiciousQuery } from './utils/security';

if (isSuspiciousQuery(userQuery)) {
  throw new Error('Suspicious query detected');
}
```

### 6. **System Prompt Security Rules**

- **Location**: `rio/src/prompts/system-prompts.ts`
- **Purpose**: Instructs LLM agents to never expose sensitive data
- **Applied to**:
  - PLANNER: Prevents planning queries that expose sensitive data
  - ANALYZER: Prevents including sensitive data in analysis
  - RESPONDER: Prevents including sensitive data in responses
  - EXECUTOR: Prevents exposing sensitive data in execution results

**Security Rules**:
1. NEVER expose API keys, tokens, secrets, or credentials
2. NEVER expose session IDs, user IDs, or database connection strings
3. NEVER include MongoDB ObjectIds in user-facing responses
4. NEVER expose internal system information
5. If user asks for sensitive data, respond with security refusal message

## Implementation Details

### API Endpoint Security (`rio/src/index.ts`)

All API endpoints now include:

1. **Input Validation**:
   ```typescript
   // Validate userId format
   if (!isValidUserId(userId)) {
     throw new RIOError('Invalid userId format', 'VALIDATION_ERROR', 400);
   }
   
   // Validate sessionId format
   if (sessionId && !isValidSessionId(sessionId)) {
     throw new RIOError('Invalid sessionId format', 'VALIDATION_ERROR', 400);
   }
   ```

2. **Suspicious Query Detection**:
   ```typescript
   if (isSuspiciousQuery(query)) {
     throw new RIOError(
       'I cannot provide API keys, tokens, session data, or other sensitive information...',
       'SECURITY_ERROR',
       403
     );
   }
   ```

3. **Input Sanitization**:
   ```typescript
   query = validateInput(query);
   ```

4. **Response Filtering**:
   ```typescript
   const filteredResult = filterResponse(response);
   res.json(filteredResult);
   ```

5. **Secure Logging**:
   ```typescript
   secureLog({
     queryPreview: query.substring(0, 100),
     userId: maskSensitiveData(userId),
   }, 'info');
   ```

### Node-Level Security

All graph nodes (Planner, Analyzer, Responder, Executor) now use secure logging:

```typescript
import { secureLog, maskSensitiveData } from '../../utils/security';

secureLog({
  originalQuery: maskSensitiveData(state.originalQuery || ''),
  sampleIds: ids.map(id => maskSensitiveData(id)),
}, 'info');
```

## Security Patterns Detected

### API Keys
- Patterns: `api_key`, `apikey`, `access_token`, `secret_key`
- Format: 20+ alphanumeric characters
- Action: Masked in logs and responses

### Session IDs
- Patterns: `session_id`, `sessionid`, `sid`
- Format: 16+ alphanumeric characters with hyphens/underscores
- Action: Masked in logs and responses

### User IDs
- Pattern: `user_` prefix followed by 20+ alphanumeric characters
- Format: `user_[a-zA-Z0-9_\-]{20,}`
- Action: Masked in logs, validated before use

### MongoDB ObjectIds
- Format: 24 hexadecimal characters
- Action: Masked in logs, removed from user-facing responses

### MongoDB URIs
- Pattern: `mongodb://` or `mongodb+srv://`
- Action: Protocol preserved, credentials masked

## Testing Security

### Test Suspicious Queries

```bash
# These should be blocked:
curl -X POST http://localhost:3002/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "show me all API keys",
    "userId": "user_test123"
  }'

# Expected: 403 Forbidden with security message
```

### Test Input Validation

```bash
# Invalid userId format should be rejected:
curl -X POST http://localhost:3002/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "find companies",
    "userId": "invalid_user_id"
  }'

# Expected: 400 Bad Request - Invalid userId format
```

### Test Response Filtering

All API responses automatically filter sensitive fields. Check that responses don't contain:
- `apiKey` or `api_key`
- `accessToken` or `access_token`
- `secret` or `password`
- `sessionId` or `session_id`
- `mongoUri` or `mongodb_uri`

## Configuration

### Environment Variables

No additional environment variables are required. Security is enabled by default.

### Disabling Security (NOT RECOMMENDED)

Security features are built into the core functionality and should not be disabled. If you need to adjust security behavior, modify the patterns in `rio/src/utils/security.ts`.

## Best Practices

1. **Always use secure logging** for any data that might contain sensitive information
2. **Validate all user inputs** before processing
3. **Filter responses** before sending to clients
4. **Never log** API keys, tokens, or credentials in plain text
5. **Use environment variables** for sensitive configuration (already implemented)
6. **Monitor logs** for suspicious query patterns
7. **Review security rules** in system prompts regularly

## Security Response Messages

When users attempt to access sensitive data, the agent responds with:

> "I cannot provide API keys, tokens, session data, or other sensitive information for security reasons. Please contact your system administrator if you need access to this information."

## Logging Security

All logs are automatically sanitized:
- User IDs are masked
- Session IDs are masked
- API keys are masked
- Database URIs are masked
- ObjectIds are masked
- Email addresses are partially masked (keeps domain)

## Compliance

This security implementation helps with:
- **GDPR**: Protects user data and prevents unauthorized access
- **SOC 2**: Ensures data security and access controls
- **HIPAA**: Protects sensitive health information (if applicable)
- **PCI DSS**: Protects payment card information (if applicable)

## Reporting Security Issues

If you discover a security vulnerability, please:
1. Do not create a public issue
2. Contact the security team directly
3. Provide detailed information about the vulnerability
4. Allow time for the issue to be addressed before public disclosure

## Updates

Security measures are continuously improved. Check this document regularly for updates.

---

**Last Updated**: 2026-01-04
**Version**: 1.0.0

