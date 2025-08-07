/**
 * Log Buffer Module
 * 
 * Provides in-memory buffering for logs with automatic 1-minute retention.
 * Handles buffering logs when WebRTC connection is not yet established,
 * and flushes buffered logs once connection is ready.
 */

import type { LogData } from './types.js';

interface BufferedLog {
  logData: LogData;
  timestamp: number;
}

const BUFFER_RETENTION_MS = 60 * 1000; // 1 minute

/**
 * In-memory log buffer that automatically purges old entries
 */
const createLogBuffer = () => {
  const buffer: BufferedLog[] = [];
  
  /**
   * Add a log entry to the buffer
   */
  const addLog = (logData: LogData): void => {
    buffer.push({
      logData,
      timestamp: Date.now()
    });
    
    // Clean up old entries (older than 1 minute)
    purgeOldLogs();
  };
  
  /**
   * Remove logs older than the retention period
   */
  const purgeOldLogs = (): void => {
    const cutoff = Date.now() - BUFFER_RETENTION_MS;
    let removeCount = 0;
    
    // Find first non-expired log
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i].timestamp >= cutoff) {
        break;
      }
      removeCount++;
    }
    
    // Remove expired logs
    if (removeCount > 0) {
      buffer.splice(0, removeCount);
    }
  };
  
  /**
   * Get all buffered logs and optionally clear the buffer
   */
  const getAndClearLogs = (): LogData[] => {
    purgeOldLogs(); // Clean up first
    const logs = buffer.map(entry => entry.logData);
    buffer.length = 0; // Clear the buffer
    return logs;
  };
  
  /**
   * Get buffered logs without clearing them
   */
  const getLogs = (): LogData[] => {
    purgeOldLogs(); // Clean up first
    return buffer.map(entry => entry.logData);
  };
  
  /**
   * Clear all buffered logs
   */
  const clear = (): void => {
    buffer.length = 0;
  };
  
  /**
   * Get the current buffer size
   */
  const size = (): number => {
    purgeOldLogs(); // Clean up first
    return buffer.length;
  };
  
  return {
    addLog,
    getAndClearLogs,
    getLogs,
    clear,
    size
  };
};

/** Global log buffer instance */
const globalLogBuffer = createLogBuffer();

/**
 * Add a log to the global buffer
 */
export function bufferLog(logData: LogData): void {
  globalLogBuffer.addLog(logData);
}

/**
 * Get all buffered logs WITHOUT clearing the buffer
 * Used when WebRTC connection is established - multiple clients can connect
 */
export function getBufferedLogs(): LogData[] {
  return globalLogBuffer.getLogs();
}

/**
 * Get all buffered logs and clear the buffer
 * Used when WebRTC connection is established
 * @deprecated Use getBufferedLogs() instead to support multiple clients
 */
export function flushBufferedLogs(): LogData[] {
  return globalLogBuffer.getAndClearLogs();
}

/**
 * Get current buffer size (for debugging)
 */
export function getBufferSize(): number {
  return globalLogBuffer.size();
}

/**
 * Clear all buffered logs
 */
export function clearBuffer(): void {
  globalLogBuffer.clear();
}