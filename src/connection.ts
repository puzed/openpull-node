/**
 * Connection implementation - provides the actual runtime functions
 * declared in connection.d.ts.
 */

import { WebRTCManager, type WebRTCManager as WebRTCManagerType } from './webrtc-connection.js';
import { getBufferedLogs } from './log-buffer.js';
import type { LogData } from './types.js';

/** Global active WebRTC manager instance */
let activeManager: WebRTCManagerType | null = null;

/** Establish or reuse a connection based on the provided URL. */
export async function connect(connectionString: string): Promise<void> {
  if (!activeManager) {
    activeManager = WebRTCManager();

    // Set up connection handler to send buffered logs when any WebRTC connects
    activeManager.onConnection((peerId, connected) => {
      if (connected) {
        // Get buffered logs WITHOUT clearing them (multiple clients can connect)
        const bufferedLogs = getBufferedLogs();
        if (bufferedLogs.length > 0) {
          console.log(`[OpenPull] Sending ${bufferedLogs.length} buffered logs to new connection ${peerId}`);
          bufferedLogs.forEach(logData => {
            activeManager?.sendLog(logData);
          });
        }
      }
    });
  }

  // If already connected to the same connection string, reuse
  if (activeManager.isConnected()) {
    return;
  }

  await activeManager.connect(connectionString);
}

/** Send a structured log via the active connection, if available. */
export function sendLog(logData: LogData): void {
  if (activeManager) {
    activeManager.sendLog(logData);
  }
}

/** Get the active WebRTC manager instance, if any. */
export function getActiveWebRTCManager(): WebRTCManagerType | null {
  return activeManager;
}