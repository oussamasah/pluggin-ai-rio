import express, { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { config } from './core/config';
import { logger } from './core/logger';
import { runRIO } from './graph/graph';
import { RIOError } from './core/errors';
import cors from 'cors';
import './models';
import { 
  validateInput, 
  filterResponse, 
  secureLog, 
  isSuspiciousQuery, 
  isValidUserId, 
  isValidSessionId,
  maskSensitiveData 
} from './utils/security';
const app = express();
app.use(cors({
    origin: '*', // For development; specify your domain in production
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'x-user-id']
  }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req: Request, res: Response, next: NextFunction) => {
  // Secure logging - mask sensitive data
  secureLog({
    method: req.method,
    path: req.path,
    userId: req.headers['x-user-id'],
    ip: req.ip,
  }, 'info');
  next();
});

async function connectDatabase() {
  try {
    await mongoose.connect(config.mongodb.uri, {
      dbName: config.mongodb.dbName,
    });
    // Secure logging - mask MongoDB URI (contains credentials)
    secureLog({
      message: 'Connected to MongoDB',
      dbName: config.mongodb.dbName,
      uri: maskSensitiveData(config.mongodb.uri), // Mask URI to hide credentials
    }, 'info');
  } catch (error: any) {
    secureLog({
      message: 'MongoDB connection failed',
      error: error.message,
    }, 'error');
    process.exit(1);
  }
}

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.post('/query', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let { query, userId, sessionId } = req.body;

    // Validate input
    if (!query || !userId) {
      throw new RIOError('Query and userId are required', 'VALIDATION_ERROR', 400);
    }

    // Validate userId format
    if (!isValidUserId(userId)) {
      throw new RIOError('Invalid userId format', 'VALIDATION_ERROR', 400);
    }

    // Validate sessionId if provided
    if (sessionId && !isValidSessionId(sessionId)) {
      throw new RIOError('Invalid sessionId format', 'VALIDATION_ERROR', 400);
    }

    // Check for suspicious queries
    if (isSuspiciousQuery(query)) {
      secureLog({
        message: 'Suspicious query detected',
        userId: maskSensitiveData(userId),
        queryPreview: maskSensitiveData(query.substring(0, 100)),
      }, 'warn');
      throw new RIOError(
        'I cannot provide API keys, tokens, session data, or other sensitive information for security reasons. Please contact your system administrator if you need access to this information.',
        'SECURITY_ERROR',
        403
      );
    }

    // Sanitize input to prevent injection attacks
    query = validateInput(query);

    // Secure logging - mask sensitive data
    secureLog({
      action: 'Processing query',
      queryPreview: query.substring(0, 100),
      userId: maskSensitiveData(userId),
      sessionId: sessionId ? maskSensitiveData(sessionId) : undefined,
    }, 'info');

    const result = await runRIO(query, userId, sessionId);

    // Filter response to remove sensitive data
    const filteredResult = filterResponse({
      success: true,
      data: {
        answer: result.finalAnswer,
        confidence: result.confidence,
        executionTime: Date.now() - result.startTime,
        iterations: result.iterations,
        dataRetrieved: {
          collections: result.retrievedData.length,
          documents: result.flattenedData.length,
        },
        requiresUserInput: result.requiresUserInput,
        userInputPrompt: result.userInputPrompt,
        progress: result.progress ? {
          currentNode: result.progress.currentNode,
          progressPercentage: result.progress.progressPercentage,
          estimatedTimeRemaining: result.progress.estimatedTimeRemaining,
        } : undefined,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        userId: maskSensitiveData(userId), // Mask userId in response
        sessionId: sessionId ? maskSensitiveData(sessionId) : undefined,
      },
    });

    res.json(filteredResult);
  } catch (error) {
    next(error);
  }
});

app.post('/query/stream', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let { query, userId, sessionId } = req.body;

    // Validate input
    if (!query || !userId) {
      throw new RIOError('Query and userId are required', 'VALIDATION_ERROR', 400);
    }

    // Validate userId format
    if (!isValidUserId(userId)) {
      throw new RIOError('Invalid userId format', 'VALIDATION_ERROR', 400);
    }

    // Validate sessionId if provided
    if (sessionId && !isValidSessionId(sessionId)) {
      throw new RIOError('Invalid sessionId format', 'VALIDATION_ERROR', 400);
    }

    // Check for suspicious queries
    if (isSuspiciousQuery(query)) {
      secureLog({
        message: 'Suspicious query detected in stream',
        userId: maskSensitiveData(userId),
        queryPreview: maskSensitiveData(query.substring(0, 100)),
      }, 'warn');
      throw new RIOError(
        'I cannot provide API keys, tokens, session data, or other sensitive information for security reasons.',
        'SECURITY_ERROR',
        403
      );
    }

    // Sanitize input
    query = validateInput(query);

    // Set up Server-Sent Events (SSE) headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Helper function to send SSE events with immediate flushing
    const sendEvent = (type: string, data: any) => {
      try {
        const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
        res.write(message);
        // Force flush to ensure chunks are sent immediately (not buffered)
        if (typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
      } catch (error) {
        // Client disconnected, stop sending
        return false;
      }
      return true;
    };

    // Send initial event
    sendEvent('start', { message: 'Processing your query...' });

    // Import streaming graph
    const { runRIOStream } = await import('./graph/graph-stream');
    const { llmService } = await import('./services/llm.service');

    // Track accumulated response text for streaming
    let accumulatedText = '';

    // Execute with streaming callbacks
    const result = await runRIOStream(
      query,
      userId,
      sessionId,
      {
        onProgress: (node, message, progress) => {
          sendEvent('progress', {
            node,
            message,
            progress,
          });
        },
        onChunk: (chunk) => {
          accumulatedText += chunk;
          // Send chunk immediately - flush is handled in sendEvent
          sendEvent('chunk', {
            text: chunk,
            accumulated: accumulatedText,
          });
          // Log first few chunks for debugging
          if (accumulatedText.length < 100) {
            logger.debug('Streaming chunk received', { 
              chunkLength: chunk.length, 
              accumulatedLength: accumulatedText.length 
            });
          }
        },
        onError: (error) => {
          sendEvent('error', {
            message: error.message,
            code: error instanceof RIOError ? (error as any).code : 'INTERNAL_ERROR',
          });
        },
      }
    );

    // If streaming was used, chunks were already sent via onChunk callback
    // Only simulate streaming if no chunks were received (fallback for non-streaming mode)
    if (result.finalAnswer && !accumulatedText) {
      // This should rarely happen if streaming is working correctly
      // But keep as fallback for non-streaming responses
      logger.warn('No streaming chunks received, using fallback word-by-word streaming');
      const answer = result.finalAnswer;
      const words = answer.split(' ');
      
      for (let i = 0; i < words.length; i++) {
        const chunk = (i === 0 ? '' : ' ') + words[i];
        accumulatedText += chunk;
        if (!sendEvent('chunk', { text: chunk, accumulated: accumulatedText })) {
          break;
        }
        // Small delay to simulate real streaming
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    // Filter response before sending final event
    const filteredAnswer = filterResponse({
      answer: result.finalAnswer || accumulatedText,
      confidence: result.confidence,
    });

    // Send completion event
    sendEvent('complete', {
      ...filteredAnswer,
      executionTime: Date.now() - result.startTime,
      iterations: result.iterations,
    });

    res.end();
  } catch (error) {
    // Send error event before closing
    try {
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        message: error instanceof Error ? error.message : 'Unknown error',
        code: error instanceof RIOError ? error.code : 'INTERNAL_ERROR',
      })}\n\n`);
    } catch (e) {
      // Client may have disconnected
    }
    res.end();
  }
});

app.get('/memory/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const { memoryService } = await import('./services/memory.service');
    
    const memories = await memoryService.getAllMemories(userId);

    res.json({
      success: true,
      data: {
        memories,
        count: memories.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post('/memory/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;
    const { content, metadata } = req.body;
    const { memoryService } = await import('./services/memory.service');

    await memoryService.addMemory(userId, content, metadata);

    res.json({
      success: true,
      message: 'Memory added successfully',
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/memory/:memoryId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { memoryId } = req.params;
    const { memoryService } = await import('./services/memory.service');

    await memoryService.deleteMemory(memoryId);

    res.json({
      success: true,
      message: 'Memory deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  // Secure error logging - mask sensitive data
  secureLog({
    message: error.message || 'An error occurred',
    error: error.message,
    stack: error.stack,
    path: req.path,
    userId: req.headers['x-user-id'] ? maskSensitiveData(req.headers['x-user-id'] as string) : undefined,
  }, 'error');

  if (error instanceof RIOError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message, // Add message at top level for easier frontend access
      error: {
        message: error.message,
        code: error.code,
        details: error.details,
      },
    });
  } else {
    res.status(500).json({
      success: false,
      message: 'Internal server error', // Add message at top level
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
    });
  }
});

async function startServer() {
  await connectDatabase();

  app.listen(config.server.port, () => {
    logger.info(`RIO server started`, {
      port: config.server.port,
      env: config.server.env,
      nodeVersion: process.version,
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    secureLog({
      message: 'Failed to start server',
      error: error.message,
    }, 'error');
    process.exit(1);
  });
}

export { app, startServer };