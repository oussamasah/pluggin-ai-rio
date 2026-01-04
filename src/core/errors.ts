export class RIOError extends Error {
    constructor(
      message: string,
      public code: string,
      public statusCode: number = 500,
      public details?: any
    ) {
      super(message);
      this.name = 'RIOError';
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  export class AuthenticationError extends RIOError {
    constructor(message: string = 'Authentication failed', details?: any) {
      super(message, 'AUTH_ERROR', 401, details);
      this.name = 'AuthenticationError';
    }
  }
  
  export class ValidationError extends RIOError {
    constructor(message: string = 'Validation failed', details?: any) {
      super(message, 'VALIDATION_ERROR', 400, details);
      this.name = 'ValidationError';
    }
  }
  
  export class RetrievalError extends RIOError {
    constructor(message: string = 'Data retrieval failed', details?: any) {
      super(message, 'RETRIEVAL_ERROR', 500, details);
      this.name = 'RetrievalError';
    }
  }
  
  export class ExecutionError extends RIOError {
    constructor(message: string = 'Action execution failed', details?: any) {
      super(message, 'EXECUTION_ERROR', 500, details);
      this.name = 'ExecutionError';
    }
  }
  