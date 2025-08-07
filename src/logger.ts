/**
 * Standalone Structured Logger
 *
 * Lightweight JSON logger with simple distributed tracing helpers.
 * The logger writes to `process.stdout` and does not perform any
 * network I/O. Combine with the connection utilities to forward
 * your stdout/stderr to OpenPull.
 */

import type { LogData, Logger, LoggerOptions, Tracer } from './types.js';

/**
 * Generate a random trace ID.
 * @internal
 */
function generateTraceId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Generate a random span ID.
 * @internal
 */
function generateSpanId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Output log data to stdout as JSON.
 * @internal
 */
function outputLog(logData: LogData): void {
  process.stdout.write(JSON.stringify(logData) + '\n');
}

/**
 * Create a tracer instance for tracking related operations.
 * @internal
 */
function createTracer(
  traceId: string,
  defaultFields: Record<string, unknown>,
  traceFields: Record<string, unknown>
): Tracer {
  return {
    span(message: string, extra: Record<string, unknown> = {}): Tracer {
      const logData: LogData = {
        type: 'trace',
        message,
        traceId,
        spanId: generateSpanId(),
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...traceFields,
        ...extra,
      };

      outputLog(logData);
      return this; // Allow chaining
    },

    finish: (): void => {
      const logData: LogData = {
        type: 'trace',
        message: 'Trace completed',
        traceId,
        spanId: generateSpanId(),
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...traceFields,
      };

      outputLog(logData);
    },
  };
}

/**
 * Create a standalone logger instance that outputs to stdout.
 *
 * @param options Configure default structured fields to include with every
 *                log entry. These are shallow-merged with per-call extras.
 *
 * @example
 * const log = createLogger({ defaultFields: { service: 'api' } });
 * log.info('Started');
 * const trace = log.trace('request', { requestId: 'req-1' });
 * trace.span('db');
 * trace.finish();
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const defaultFields = options.defaultFields ?? {};

  return {
    info: (message: string, extra: Record<string, unknown> = {}): void => {
      const logData: LogData = {
        type: 'info',
        message,
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...extra,
      };

      outputLog(logData);
    },

    error: (message: string, extra: Record<string, unknown> = {}): void => {
      const logData: LogData = {
        type: 'error',
        message,
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...extra,
      };

      outputLog(logData);
    },

    debug: (message: string, extra: Record<string, unknown> = {}): void => {
      const logData: LogData = {
        type: 'debug',
        message,
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...extra,
      };

      outputLog(logData);
    },

    warning: (message: string, extra: Record<string, unknown> = {}): void => {
      const logData: LogData = {
        type: 'warning',
        message,
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...extra,
      };

      outputLog(logData);
    },

    warn: (message: string, extra: Record<string, unknown> = {}): void => {
      const logData: LogData = {
        type: 'warning',
        message,
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...extra,
      };

      outputLog(logData);
    },

    trace: (message: string, extra: Record<string, unknown> = {}): Tracer => {
      const traceId = generateTraceId();
      const tracer = createTracer(traceId, defaultFields, extra);
      
      // Log the initial trace
      const logData: LogData = {
        type: 'trace',
        message,
        traceId,
        spanId: generateSpanId(),
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...extra,
      };

      outputLog(logData);
      return tracer;
    },

    startTrace: (extra: Record<string, unknown> = {}): Tracer => {
      const traceId = generateTraceId();
      return createTracer(traceId, defaultFields, extra);
    },
  };
}
