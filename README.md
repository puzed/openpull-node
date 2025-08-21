# OpenPull Node.js Library

A TypeScript/JavaScript library for streaming application logs to OpenPull via WebRTC. Start fast with the logger, then dive deeper as needed.

## Quick Start

### 1) Install

```bash
npm install openpull
```

### 2) Minimal Library Usage (Logger first)

```typescript
import { createLogger, createConnection } from 'openpull';

// JSON logger to stdout (pino-like)
const log = createLogger();
log.info('App started');
log.trace('request').span('db-query').finish();

// Forward stdout/stderr to OpenPull (separate from logger)
const connection = await createConnection(process.env.OPENPULL_URL!);
await connection.forward(process.stdout, process.stderr);
```

You can also keep your existing logger (pino/winston/console) and just add a `trace_id` when you want correlation.

### 3) Minimal CLI Usage (Any language)

```bash
# One-time global install for the CLI (optional)
npm install -g openpull

# Wrap any command; uses OPENPULL_URL if set
openpull -- node app.js
openpull -- python app.py
```

Example minimal Node.js file (app.js):

```javascript
// app.js
const traceId = 'trace-' + Date.now();

console.log(JSON.stringify({ level: 'info', message: 'Server starting', port: 3000 }));
console.log(JSON.stringify({ level: 'info', message: 'Database connected', db: 'postgres' }));

// Three trace logs sharing the same trace_id (correlated)
console.log(JSON.stringify({ level: 'trace', message: 'Checkout flow', step: 'begin', trace_id: traceId }));
console.log(JSON.stringify({ level: 'trace', message: 'Payment processed', amount: 99.99, trace_id: traceId }));
console.log(JSON.stringify({ level: 'trace', message: 'Order completed', order_id: '12345', trace_id: traceId }));
```

That’s it—you’re sending logs to OpenPull.

## Concepts

- **Everything is a log entry:** Logs, metrics, and traces are just JSON log entries. Tracing is simply adding a shared field (commonly `trace_id`).
- **No schema required:** Log any JSON. The dashboard discovers fields dynamically and lets you filter, group, and search by anything you emit.

Example entries you might emit:

```javascript
log.info('User action', { userId: 123, action: 'login', region: 'us-east' });
log.info('Database query', { query: 'SELECT * FROM users', duration: 45, rows: 150 });
// Grouping can be by any field you choose, not only trace_id
log.info('Processing request', { request_id: 'req-123', service: 'api', endpoint: '/users' });
```

## Features

- **Unified observability:** logs, metrics, and traces as log entries
- **Works with any logger:** pino, winston, console.log, or custom
- **Real-time streaming:** WebRTC connection to OpenPull
- **Standalone structured logger:** optional, pino-like ergonomics
- **Clean separation:** logger writes to stdout; connection forwards
- **CLI tool:** wrap any language/executable
- **TypeScript:** full typings, no classes

## How It Works

The magic is in the **ultra-flexible parsing**. Here's what happens under the hood:

### 1. No Schema Validation
When you log anything, OpenPull just:
```javascript  
// From connection-manager.ts:12
function parseLogLine(line: string, defaultLevel: string = 'info'): any {
  try {
    const parsed = JSON.parse(trimmedLine);
    return {
      type: parsed.level || parsed.type || defaultLevel,
      message: parsed.message || parsed.msg || trimmedLine,
      timestamp: parsed.timestamp || parsed.time || new Date().toISOString(),
      ...parsed,  // ← ALL your fields get preserved
    };
  } catch {
    // Plain text becomes a log entry too
    return {
      type: defaultLevel,
      message: trimmedLine,
      timestamp: new Date().toISOString(),
    };
  }
}
```

### 2. Dynamic Field Discovery
The dashboard uses DuckDB's JSON operators to discover fields at runtime:
```sql
-- Gets ALL unique field names across your logs
WITH json_keys AS (
  SELECT DISTINCT json_keys(data) as keys FROM logs
)
SELECT key, COUNT(*) as count 
FROM json_keys jk, UNNEST(jk.keys) as t(key), logs l
GROUP BY key ORDER BY count DESC
```

### 3. Flexible Grouping
You can group by ANY field, not just `trace_id`:
```sql
-- Group by trace_id (traditional)
WHERE json_extract(data, '$.trace_id') = 'abc123'

-- Or group by request_id 
WHERE json_extract(data, '$.request_id') = 'req-456'

-- Or group by user_id
WHERE json_extract(data, '$.user_id') = '789'

-- Or any custom field you invent
WHERE json_extract(data, '$.workflow_id') = 'deploy-123'
```

**`trace_id` is a convention**, not a requirement. Correlate by any shared field.


## API Reference

### Library API

#### `createLogger(options?: LoggerOptions): Logger`

Creates a standalone logger that outputs JSON to stdout (competes with pino):

```javascript
const log = createLogger({
  defaultFields: {
    service: 'my-app',
    version: '1.0.0'
  }
});

// Basic logging
log.info('User logged in', { userId: '123' });
log.error('Database error', { query: 'SELECT * FROM users' });
log.debug('Processing request', { requestId: 'req-456' });
log.warning('Rate limit approaching', { current: 95, limit: 100 });

// Distributed tracing with trace_id correlation
log.trace('request').span('db-query').span('validation').finish();

// Each span gets the same trace_id automatically:
// {"level":"trace","message":"request","trace_id":"abc123","span_id":"span1"...}
// {"level":"trace","message":"db-query","trace_id":"abc123","span_id":"span2"...}
// {"level":"trace","message":"validation","trace_id":"abc123","span_id":"span3"...}

// Or traditional approach
const trace = log.startTrace({ operation: 'checkout' });
trace.span('Validate cart');    // Same trace_id
trace.span('Process payment');  // Same trace_id
trace.finish();
```

#### `createConnection(connectionString: string): Promise<Connection>`

Creates a connection that can forward streams:

```javascript
const connection = await createConnection('openpull://appender:key@signal.openpull.com/NoDrBwJRXA8W');

// Forward process streams
await connection.forward(process.stdout, process.stderr);

// Or forward child process streams (used internally by CLI)
await connection.forwardStreams(child.stdout, child.stderr);
```

Note: The URL includes a key, but OpenPull uses a zero-knowledge handshake — the key never leaves your device.

**Connection String Format:**
```
openpull://role:key@publicToken.host:port/
```

- `role`: Either `appender` (for sending logs) or `reader` (for receiving logs)
- `key`: Authentication key derived from your session (used only locally to compute the handshake proof)
- `publicToken`: Session identifier
- `host:port`: Signaling server address

### CLI Reference

Wraps any application and forwards stdout/stderr:

```bash
export OPENPULL_URL="openpull://appender:key@signal.openpull.com/NoDrBwJRXA8W"
openpull -- node app.js       # Node
openpull -- python script.py  # Python
openpull -- go run main.go    # Go
openpull -- dotnet run        # .NET

# Help
openpull --help
```

Env vars:
- `OPENPULL_URL` – default connection URL

## TypeScript Support

The library is written in TypeScript and provides comprehensive type definitions:

```typescript
import { Logger, Tracer, LogData } from 'openpull';

const log: Logger = logger();
const trace: Tracer = log.startTrace();

// All methods are fully typed
log.info('Message', { customField: 'value' });
```

## Error Handling

The library gracefully handles connection failures:

```javascript
try {
  await connect('openpull://appender:key@signal.openpull.com/NoDrBwJRXA8W');
} catch (error) {
  console.error('Failed to connect:', error.message);
}

// Logs fall back to console if no connection
const log = logger();
log.info('This will go to console if not connected');
```

## Examples

### Library: Standalone Logger

```javascript
import { createLogger } from 'openpull';

// Pure logger that outputs JSON to stdout (like pino)
const log = createLogger({
  defaultFields: {
    service: 'user-service',
    version: '1.0.0'
  }
});

log.info('Service started', { port: 3000 });
log.error('Database error', { table: 'users' });

// Distributed tracing with trace_id correlation
log.trace('checkout')
  .span('validate-cart')     // trace_id: "xyz789", span_id: "span1"
  .span('process-payment')   // trace_id: "xyz789", span_id: "span2" 
  .span('update-inventory')  // trace_id: "xyz789", span_id: "span3"
  .finish();
```

### Library: Clean Separation

```javascript
import { createLogger, createConnection } from 'openpull';

// Logger just outputs to stdout
const log = createLogger({ defaultFields: { service: 'api' } });

// Connection handles WebRTC separately  
const connection = await createConnection(process.env.OPENPULL_URL);
await connection.forward(process.stdout, process.stderr);

// Now both structured logs AND console.log get forwarded
log.info('Structured log');
console.log('Plain console log');
```

### Express.js with Tracing

```javascript
import express from 'express';
import { createLogger, createConnection } from 'openpull';

const app = express();

// Setup separate logger and connection
const log = createLogger({ defaultFields: { service: 'api' } });
const connection = await createConnection(process.env.OPENPULL_URL);
await connection.forward(process.stdout, process.stderr);

// Request tracing middleware
app.use((req, res, next) => {
  // Start a trace for each request
  const trace = log.startTrace({ 
    method: req.method, 
    url: req.url,
    userAgent: req.headers['user-agent'] 
  });
  
  req.trace = trace;
  req.trace.span('Request started');
  next();
});

app.get('/users/:id', (req, res) => {
  req.trace.span('Fetching user', { userId: req.params.id });
  
  // All these spans share the same trace_id:
  req.trace.span('Database query');
  req.trace.span('Permission check');
  req.trace.span('Response serialization');
  
  req.trace.span('Request completed', { statusCode: res.statusCode });
  req.trace.finish();
});
```

## Why This Logger vs Existing Ones?

- **Use any logger + CLI:** Keep pino/winston/console and forward via CLI.
- **Use OpenPull logger:** If you want built-in tracing and automatic correlation.

Example with pino (manual correlation):

```javascript
import pino from 'pino';
const log = pino();
const traceId = 'trace-' + Math.random().toString(36).slice(2);
log.info({ trace_id: traceId }, 'Request started');
```

## Dynamic Dashboard

The OpenPull web dashboard has **zero configuration** - it adapts to whatever fields you actually log:

### Auto-Discovery
```javascript
// Dashboard automatically discovers these fields from your logs:
async function updateSchema() {
  const schema = await getLogSchema(db);
  
  // Finds ALL unique fields: userId, action, browser, region, customField, etc.
  state.availableFields = new Set(schema.map(s => s.key));
  
  // Auto-shows frequently used fields (> 10 occurrences)  
  schema.forEach(field => {
    if (field.count > 10 && !state.visibleColumns.has(field.key)) {
      state.visibleColumns.add(field.key);
    }
  });
}
```

### Dynamic Filtering  
The dashboard creates filters for **every field** it finds:
```javascript
// Creates dropdowns/filters for ANY field
state.availableFields.forEach(field => {
  const fieldValues = await getFieldValues(db, field);
  // Now you can filter by userId, region, cache status, etc.
});
```

### Flexible Grouping
You can group "traces" by **any field**:
- Traditional: Group by `trace_id` to see request flows
- By user: Group by `user_id` to see all user activity  
- By service: Group by `service` to see service interactions
- Custom: Group by `deployment_id`, `experiment_id`, `workflow_id`, etc.

**No schema to define upfront** — log any JSON structure and the dashboard adapts automatically.
