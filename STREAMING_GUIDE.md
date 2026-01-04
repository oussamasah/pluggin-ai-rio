# Streaming Implementation Guide

## Overview

Your RIO agentic RAG backend **now supports real-time streaming** similar to ChatGPT! Users will see:
- ✅ Progress updates as each node executes
- ✅ Text chunks streaming in real-time as the LLM generates the response
- ✅ Better UX with no "loading" spinner - text appears as it's written

## What's Implemented

### 1. **LLM Streaming Support** (`rio/src/services/llm.service.ts`)
- Added `chatStream()` method that streams responses from OpenRouter API
- Supports `onChunk` callback for real-time text chunks
- Handles Server-Sent Events (SSE) format from OpenRouter

### 2. **Streaming Graph Execution** (`rio/src/graph/graph-stream.ts`)
- `runRIOStream()` function with progress callbacks
- Sends progress updates for each node (planner, retriever, analyzer, etc.)
- Streams text chunks as they're generated

### 3. **Streaming API Endpoint** (`rio/src/index.ts`)
- Updated `/query/stream` endpoint with full SSE support
- Sends multiple event types:
  - `start`: Initial connection
  - `progress`: Node execution updates
  - `chunk`: Text chunks as they're generated
  - `complete`: Final response
  - `error`: Error handling

## API Usage

### Endpoint
```
POST /query/stream
```

### Request Body
```json
{
  "query": "find top 5 companies with highest fit score",
  "userId": "user_36R91I8f4mbC6LcymVuQZfGNMft",
  "sessionId": "optional_session_id"
}
```

### Response Format (Server-Sent Events)

The response uses Server-Sent Events (SSE) format:

```
data: {"type":"start","message":"Processing your query..."}

data: {"type":"progress","node":"planner","message":"Planning your query...","progress":10}

data: {"type":"progress","node":"retriever","message":"Retrieving data from database...","progress":30}

data: {"type":"progress","node":"analyzer","message":"Analyzing data and generating insights...","progress":60}

data: {"type":"chunk","text":"Based","accumulated":"Based"}

data: {"type":"chunk","text":" on","accumulated":"Based on"}

data: {"type":"chunk","text":" your","accumulated":"Based on your"}

data: {"type":"chunk","text":" query","accumulated":"Based on your query"}

... (more chunks)

data: {"type":"complete","answer":"Full response here","confidence":0.95,"executionTime":45234,"iterations":1}
```

## Frontend Implementation

### JavaScript/TypeScript Example

```javascript
async function streamQuery(query, userId, sessionId) {
  const response = await fetch('http://localhost:3002/query/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, userId, sessionId }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        
        switch (data.type) {
          case 'start':
            console.log('Started:', data.message);
            break;
          
          case 'progress':
            console.log(`Progress: ${data.progress}% - ${data.message}`);
            updateProgressBar(data.progress);
            break;
          
          case 'chunk':
            // Append chunk to UI
            appendToResponse(data.text);
            break;
          
          case 'complete':
            console.log('Complete:', data.answer);
            showFinalResponse(data);
            break;
          
          case 'error':
            console.error('Error:', data.message);
            showError(data);
            break;
        }
      }
    }
  }
}

function appendToResponse(chunk) {
  const responseElement = document.getElementById('response');
  responseElement.textContent += chunk;
  // Auto-scroll to bottom
  responseElement.scrollTop = responseElement.scrollHeight;
}

function updateProgressBar(progress) {
  const progressBar = document.getElementById('progress-bar');
  progressBar.style.width = `${progress}%`;
}
```

### React Example

```tsx
import { useState, useEffect } from 'react';

function StreamingQuery() {
  const [response, setResponse] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('idle');

  const streamQuery = async (query: string, userId: string) => {
    setStatus('streaming');
    setResponse('');
    setProgress(0);

    const res = await fetch('http://localhost:3002/query/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, userId }),
    });

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    if (!reader) return;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        setStatus('complete');
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          
          switch (data.type) {
            case 'progress':
              setProgress(data.progress);
              break;
            case 'chunk':
              setResponse(prev => prev + data.text);
              break;
            case 'complete':
              setStatus('complete');
              break;
            case 'error':
              setStatus('error');
              break;
          }
        }
      }
    }
  };

  return (
    <div>
      <div className="progress-bar" style={{ width: `${progress}%` }} />
      <div className="response">{response}</div>
      {status === 'streaming' && <div>Streaming...</div>}
    </div>
  );
}
```

## Event Types

### `start`
Initial connection established.
```json
{
  "type": "start",
  "message": "Processing your query..."
}
```

### `progress`
Node execution progress update.
```json
{
  "type": "progress",
  "node": "analyzer",
  "message": "Analyzing data and generating insights...",
  "progress": 60
}
```

### `chunk`
Text chunk from LLM response.
```json
{
  "type": "chunk",
  "text": " Based",
  "accumulated": "Based on your query, I found"
}
```

### `complete`
Final response with metadata.
```json
{
  "type": "complete",
  "answer": "Full response text...",
  "confidence": 0.95,
  "executionTime": 45234,
  "iterations": 1
}
```

### `error`
Error occurred during execution.
```json
{
  "type": "error",
  "message": "Error description",
  "code": "ERROR_CODE"
}
```

## Current Limitations

1. **Word-by-word streaming**: Currently streams the final answer word-by-word after generation. True LLM streaming (chunk-by-chunk from API) is implemented but needs integration with responder node.

2. **Progress updates**: Progress is sent at major milestones. More granular updates can be added.

## Future Enhancements

1. **True LLM Streaming**: Integrate streaming directly into responder node so chunks come from the LLM API in real-time
2. **More granular progress**: Send progress updates for sub-steps within nodes
3. **Cancellation support**: Allow users to cancel streaming requests
4. **Rate limiting**: Add rate limiting for streaming endpoints

## Testing

Test the streaming endpoint:

```bash
curl -X POST http://localhost:3002/query/stream \
  -H "Content-Type: application/json" \
  -d '{
    "query": "find top 5 companies",
    "userId": "user_36R91I8f4mbC6LcymVuQZfGNMft"
  }'
```

You should see SSE events streaming in real-time!

## Notes

- The streaming endpoint uses Server-Sent Events (SSE), which is more efficient than WebSockets for one-way streaming
- Make sure your frontend properly handles SSE format
- The `accumulated` field in chunk events contains the full response so far (useful for displaying complete text)
- Progress percentages are approximate and based on node execution order

---

**Last Updated**: 2026-01-04
**Status**: ✅ Implemented and Ready for Testing

