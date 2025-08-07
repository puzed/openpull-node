/**
 * OpenPull Node.js Library
 *
 * Main public entry points for the OpenPull Node.js package. Exposes
 * the standalone JSON logger and the stream-forwarding connection API.
 *
 * @remarks
 * - The logger only writes JSON to stdout.
 * - The connection API forwards stdout/stderr over WebRTC to OpenPull.
 */

// Core functions - Clean API only
export { createLogger } from './logger.js';
export { createConnection } from './connection-manager.js';
export { parseConnectionString } from './webrtc-connection.js';
// Type exports
export type {
  Connection,
  LogData,
  Logger,
  LoggerOptions,
  TraceOptions,
  Tracer,
} from './types.js';
