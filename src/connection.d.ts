/**
 * Local type shim for the runtime-only connection helpers.
 *
 * The implementation is provided at runtime (built output), but we
 * declare the surface here to enable type-checking during development.
 */
import type { LogData } from './types.js';
import type { WebRTCManager } from './webrtc-connection.js';

/** Establish or reuse a connection based on the provided URL. */
export function connect(connectionString: string): Promise<void>;

/** Send a structured log via the active connection, if available. */
export function sendLog(logData: LogData): void;

/** Get the active WebRTC manager instance, if any. */
export function getActiveWebRTCManager(): WebRTCManager | null;
