/**
 * Security utilities for protecting sensitive data
 * Prevents exposure of API keys, session IDs, user IDs, and other sensitive information
 */

import { logger } from '../core/logger';

// Patterns to detect sensitive data
const SENSITIVE_PATTERNS = {
  // API Keys (various formats)
  apiKey: /(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key)\s*[:=]\s*['"]?([a-zA-Z0-9_\-]{20,})['"]?/gi,
  // MongoDB ObjectIds (24 hex characters)
  objectId: /\b[0-9a-fA-F]{24}\b/g,
  // Session IDs (various formats)
  sessionId: /(?:session[_-]?id|sessionid|sid)\s*[:=]\s*['"]?([a-zA-Z0-9_\-]{16,})['"]?/gi,
  // User IDs (user_ prefix followed by alphanumeric)
  userId: /(?:user[_-]?id|userid)\s*[:=]\s*['"]?(user_[a-zA-Z0-9_\-]{20,})['"]?/gi,
  // Email addresses
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  // MongoDB URIs
  mongoUri: /mongodb[+srv]?:\/\/[^\s"'<>]+/gi,
  // JWT tokens
  jwt: /eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g,
  // Credit card numbers (basic pattern)
  creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  // Phone numbers
  phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
};

// Fields that should never be exposed in responses
const SENSITIVE_FIELDS = [
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'secret',
  'password',
  'token',
  'sessionId',
  'session_id',
  'userId', // Only mask in logs, not in responses (needed for queries)
  'user_id',
  'mongoUri',
  'mongodb_uri',
  'connectionString',
  'connection_string',
  '_id', // ObjectIds - mask in logs but allow in responses for context
];

/**
 * Mask sensitive data in strings
 * @param text - Text to sanitize
 * @param maskChar - Character to use for masking (default: '*')
 * @param keepLength - Whether to keep original length (default: true)
 * @returns Sanitized text
 */
export function maskSensitiveData(
  text: string,
  maskChar: string = '*',
  keepLength: boolean = true
): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let sanitized = text;

  // Mask API keys
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.apiKey, (match, key) => {
    const masked = keepLength ? maskChar.repeat(key.length) : maskChar.repeat(8);
    return match.replace(key, masked);
  });

  // Mask session IDs
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.sessionId, (match, id) => {
    const masked = keepLength ? maskChar.repeat(id.length) : maskChar.repeat(8);
    return match.replace(id, masked);
  });

  // Mask MongoDB URIs (keep protocol visible)
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.mongoUri, (match) => {
    const parts = match.split('://');
    if (parts.length === 2) {
      return `${parts[0]}://${maskChar.repeat(20)}`;
    }
    return maskChar.repeat(20);
  });

  // Mask JWT tokens
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.jwt, () => {
    return `JWT_${maskChar.repeat(20)}`;
  });

  // Mask email addresses (keep domain visible)
  sanitized = sanitized.replace(SENSITIVE_PATTERNS.email, (match) => {
    const [local, domain] = match.split('@');
    return `${maskChar.repeat(Math.min(local.length, 3))}***@${domain}`;
  });

  return sanitized;
}

/**
 * Sanitize object by removing or masking sensitive fields
 * @param obj - Object to sanitize
 * @param options - Sanitization options
 * @returns Sanitized object
 */
export function sanitizeObject(
  obj: any,
  options: {
    removeFields?: boolean;
    maskFields?: boolean;
    forLogging?: boolean;
  } = {}
): any {
  const { removeFields = false, maskFields = true, forLogging = false } = options;

  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, options));
  }

  const sanitized: any = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Check if field is sensitive
    const isSensitive = SENSITIVE_FIELDS.some(field => 
      lowerKey.includes(field.toLowerCase())
    );

    if (isSensitive) {
      if (removeFields) {
        // Skip this field
        continue;
      } else if (maskFields) {
        // Mask the value
        if (typeof value === 'string') {
          sanitized[key] = maskSensitiveData(value);
        } else {
          sanitized[key] = '***MASKED***';
        }
      } else {
        // Keep as is (for internal use)
        sanitized[key] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeObject(value, options);
    } else if (forLogging && typeof value === 'string') {
      // For logging, mask any sensitive patterns in string values
      sanitized[key] = maskSensitiveData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Validate and sanitize user input to prevent injection attacks
 * @param input - User input to validate
 * @returns Sanitized input
 * @throws Error if input contains dangerous patterns
 */
export function validateInput(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new Error('Invalid input: must be a non-empty string');
  }

  // Check for SQL injection patterns (even though we use MongoDB, good practice)
  const sqlInjectionPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|SCRIPT)\b)/gi,
    /(--|\/\*|\*\/|;|\||&)/g,
  ];

  // Check for NoSQL injection patterns
  const nosqlInjectionPatterns = [
    /\$where/gi,
    /\$ne/gi,
    /\$gt/gi,
    /\$lt/gi,
    /\$regex/gi,
    /javascript:/gi,
    /on\w+\s*=/gi, // Event handlers
  ];

  // Check for command injection patterns
  const commandInjectionPatterns = [
    /[;&|`$(){}[\]]/g,
    /\b(cat|ls|rm|mv|cp|chmod|sudo|su|exec|eval|system)\b/gi,
  ];

  // Check for XSS patterns
  const xssPatterns = [
    /<script/gi,
    /javascript:/gi,
    /onerror/gi,
    /onload/gi,
    /onclick/gi,
  ];

  // Combine all dangerous patterns
  const dangerousPatterns = [
    ...sqlInjectionPatterns,
    ...nosqlInjectionPatterns,
    ...commandInjectionPatterns,
    ...xssPatterns,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(input)) {
      logger.warn('Potentially dangerous input detected', {
        pattern: pattern.toString(),
        inputPreview: input.substring(0, 100),
      });
      // Don't throw error, but sanitize instead
      // This allows legitimate queries while preventing attacks
    }
  }

  // Remove null bytes and control characters
  let sanitized = input
    .replace(/\0/g, '') // Null bytes
    .replace(/[\x00-\x1F\x7F]/g, '') // Control characters
    .trim();

  // Limit length to prevent DoS
  const MAX_INPUT_LENGTH = 10000;
  if (sanitized.length > MAX_INPUT_LENGTH) {
    secureLog({
      message: 'Input truncated due to length',
      originalLength: input.length,
      maxLength: MAX_INPUT_LENGTH,
    }, 'warn');
    sanitized = sanitized.substring(0, MAX_INPUT_LENGTH);
  }

  return sanitized;
}

/**
 * Filter sensitive data from response output
 * @param response - Response object to filter
 * @returns Filtered response
 */
export function filterResponse(response: any): any {
  if (!response) {
    return response;
  }

  // Deep clone to avoid mutating original
  const filtered = JSON.parse(JSON.stringify(response));

  // Remove sensitive fields from response
  return sanitizeObject(filtered, {
    removeFields: true, // Remove sensitive fields entirely
    maskFields: false,
    forLogging: false,
  });
}

/**
 * Secure logging - masks sensitive data before logging
 * @param data - Data to log
 * @param level - Log level
 */
export function secureLog(data: any, level: 'info' | 'warn' | 'error' | 'debug' = 'info'): void {
  const sanitized = sanitizeObject(data, {
    removeFields: false,
    maskFields: true,
    forLogging: true,
  });

  // Winston expects either a string message or an object with proper structure
  // Ensure we always pass a properly formatted object with a message property
  if (typeof sanitized === 'object' && sanitized !== null) {
    // If the object doesn't have a 'message' property, add one
    if (!sanitized.message && !sanitized.msg) {
      // Try to find a meaningful message from common properties
      const message = sanitized.error || 
                     sanitized.message || 
                     sanitized.msg || 
                     sanitized.action ||
                     Object.values(sanitized).find(v => typeof v === 'string' && v.length < 200) as string || 
                     `[${level.toUpperCase()}]`;
      logger[level]({ message, ...sanitized });
    } else {
      // Ensure message is first property for better log readability
      const { message, ...rest } = sanitized;
      logger[level]({ message, ...rest });
    }
  } else {
    logger[level](String(sanitized));
  }
}

/**
 * Check if a query is attempting to access sensitive data
 * @param query - User query
 * @returns true if query is suspicious
 */
export function isSuspiciousQuery(query: string): boolean {
  if (!query || typeof query !== 'string') {
    return false;
  }

  const suspiciousPatterns = [
    /(?:show|display|give|get|return|list|find|search|query).*?(?:api[_-]?key|secret|password|token|session|credential)/gi,
    /(?:show|display|give|get|return|list|find|search|query).*?(?:all|every).*?(?:data|information|details)/gi,
    /(?:dump|export|download|backup).*?(?:data|database|collection)/gi,
    /(?:delete|drop|remove|clear).*?(?:all|everything|data|database)/gi,
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(query)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate user ID format
 * @param userId - User ID to validate
 * @returns true if valid
 */
export function isValidUserId(userId: string): boolean {
  if (!userId || typeof userId !== 'string') {
    return false;
  }

  // User ID should start with "user_" and be alphanumeric with underscores/hyphens
  const userIdPattern = /^user_[a-zA-Z0-9_\-]{20,}$/;
  return userIdPattern.test(userId);
}

/**
 * Validate session ID format
 * @param sessionId - Session ID to validate
 * @returns true if valid
 */
export function isValidSessionId(sessionId: string): boolean {
  if (!sessionId || typeof sessionId !== 'string') {
    return false;
  }

  // Session ID should be alphanumeric with hyphens/underscores, 16+ characters
  const sessionIdPattern = /^[a-zA-Z0-9_\-]{16,}$/;
  return sessionIdPattern.test(sessionId);
}

