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
 * Normalize logger arguments to support both (message, extra) and (extra) patterns.
 * @internal
 */
function normalizeArgs(
  message: string | Record<string, unknown>,
  extra: Record<string, unknown>
): { actualMessage: string; actualExtra: Record<string, unknown> } {
  if (typeof message === 'string') {
    return { actualMessage: message, actualExtra: extra };
  } else {
    // If first argument is an object, use it as extra and generate a default message
    const messageFromObject = message.message as string || '';
    const restOfObject = { ...message };
    delete restOfObject.message;
    
    return {
      actualMessage: messageFromObject,
      actualExtra: { ...restOfObject, ...extra }
    };
  }
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
    span(message: string | Record<string, unknown>, extra: Record<string, unknown> = {}): Tracer {
      const { actualMessage, actualExtra } = normalizeArgs(message, extra);
      const logData: LogData = {
        type: 'trace',
        message: actualMessage,
        traceId,
        spanId: generateSpanId(),
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...traceFields,
        ...actualExtra,
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
    info: (message: string | Record<string, unknown>, extra: Record<string, unknown> = {}): void => {
      const { actualMessage, actualExtra } = normalizeArgs(message, extra);
      const logData: LogData = {
        type: 'info',
        message: actualMessage,
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...actualExtra,
      };

      outputLog(logData);
    },

    error: (message: string | Record<string, unknown>, extra: Record<string, unknown> = {}): void => {
      const { actualMessage, actualExtra } = normalizeArgs(message, extra);
      const logData: LogData = {
        type: 'error',
        message: actualMessage,
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...actualExtra,
      };

      outputLog(logData);
    },

    debug: (message: string | Record<string, unknown>, extra: Record<string, unknown> = {}): void => {
      const { actualMessage, actualExtra } = normalizeArgs(message, extra);
      const logData: LogData = {
        type: 'debug',
        message: actualMessage,
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...actualExtra,
      };

      outputLog(logData);
    },

    warning: (message: string | Record<string, unknown>, extra: Record<string, unknown> = {}): void => {
      const { actualMessage, actualExtra } = normalizeArgs(message, extra);
      const logData: LogData = {
        type: 'warning',
        message: actualMessage,
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...actualExtra,
      };

      outputLog(logData);
    },

    warn: (message: string | Record<string, unknown>, extra: Record<string, unknown> = {}): void => {
      const { actualMessage, actualExtra } = normalizeArgs(message, extra);
      const logData: LogData = {
        type: 'warning',
        message: actualMessage,
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...actualExtra,
      };

      outputLog(logData);
    },

    trace: (message: string | Record<string, unknown>, extra: Record<string, unknown> = {}): Tracer => {
      const { actualMessage, actualExtra } = normalizeArgs(message, extra);
      const traceId = generateTraceId();
      const tracer = createTracer(traceId, defaultFields, actualExtra);
      
      // Log the initial trace
      const logData: LogData = {
        type: 'trace',
        message: actualMessage,
        traceId,
        spanId: generateSpanId(),
        timestamp: new Date().toISOString(),
        ...defaultFields,
        ...actualExtra,
      };

      outputLog(logData);
      return tracer;
    },

    startTrace: (message: string | Record<string, unknown>, extra: Record<string, unknown> = {}): Tracer => {
      const { actualMessage, actualExtra } = normalizeArgs(message, extra);
      const traceId = generateTraceId();
      return createTracer(traceId, defaultFields, actualExtra);
    },
  };
}
