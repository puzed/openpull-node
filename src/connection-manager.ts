/**
 * Connection Manager
 *
 * Attaches to stdout/stderr streams, parses lines into structured JSON
 * log entries, and forwards them through the active WebRTC connection.
 * This module focuses purely on stream interception and transformation;
 * WebRTC connectivity is handled by lower-level helpers.
 */

import { connect, getActiveWebRTCManager, sendLog } from './connection.js';
import { bufferLog } from './log-buffer.js';
import type { Connection, LogData } from './types.js';

/**
 * Parse a raw log line and extract structured data.
 *
 * Attempts to parse JSON; on failure, wraps the text in a structured
 * {@link LogData} entry with the provided default level.
 *
 * @param line Raw line from a stream (e.g., stdout/stderr).
 * @param defaultLevel Fallback `type` for non-JSON lines.
 */
function parseLogLine(line: string, defaultLevel: LogData['type'] = 'info'): LogData {
  const trimmedLine = line.trim();

  if (!trimmedLine) {
    return {
      type: defaultLevel,
      message: '',
      timestamp: new Date().toISOString(),
    };
  }

  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(trimmedLine) as Record<string, unknown>;

    const rawType = (parsed.level ?? parsed.type ?? defaultLevel) as string;
    const normalizedType: LogData['type'] =
      rawType === 'info' || rawType === 'error' || rawType === 'warning' || rawType === 'debug' || rawType === 'trace'
        ? rawType
        : defaultLevel;

    return {
      type: normalizedType,
      message: (parsed.message as string) || (parsed.msg as string) || trimmedLine,
      timestamp: (parsed.timestamp as string) || (parsed.time as string) || new Date().toISOString(),
      ...parsed,
    } as LogData;
  } catch {
    // If not JSON, treat as plain text
    return {
      type: defaultLevel,
      message: trimmedLine,
      timestamp: new Date().toISOString(),
    };
  }
}

/** Global flag to prevent recursive interception. @internal */
let isForwarding = false;

/**
 * Send log data through the active WebRTC connection AND always buffer it.
 *
 * Silently no-ops when called during forwarding (to prevent recursion).
 * Always buffers logs for 1 minute, regardless of connection state.
 */
function sendLogData(logData: LogData): void {
  if (isForwarding) {
    return; // Prevent recursion
  }
  
  // ALWAYS buffer every log for 1 minute
  bufferLog(logData);
  
  const manager = getActiveWebRTCManager();
  if (!manager) {
    return; // No manager available, log is buffered
  }

  // Try to send immediately if we have a manager
  try {
    isForwarding = true;
    sendLog(logData);
  } catch (_error) {
    // If send fails, that's okay - log is already buffered
  } finally {
    isForwarding = false;
  }
}

/**
 * Connection implementation that wraps the underlying WebRTC manager.
 */
class ConnectionImpl implements Connection {
  constructor(private connectionString: string) {}

  /**
   * Forward data from provided readable streams (e.g., a child process).
   *
   * @param stdout Readable producing standard output lines.
   * @param stderr Readable producing standard error lines.
   * @returns Cleanup function to remove listeners.
   */
  async forwardStreams(stdout: NodeJS.ReadableStream, stderr: NodeJS.ReadableStream): Promise<() => void> {
    // Ensure connection is established
    await connect(this.connectionString);

    const cleanupFunctions: (() => void)[] = [];

    // Handle stdout
    stdout.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      if (str.trim() && !isForwarding && !str.includes('[OpenPull') && !str.includes('DEBUG:')) {
        const logData = parseLogLine(str, 'info');
        if (logData.message) {
          sendLogData(logData);
        }
      }
    });

    // Handle stderr  
    stderr.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      if (str.trim() && !isForwarding && !str.includes('[OpenPull') && !str.includes('DEBUG:')) {
        const logData = parseLogLine(str, 'error');
        if (logData.message) {
          sendLogData(logData);
        }
      }
    });

    // Return cleanup function
    return (): void => {
      cleanupFunctions.forEach(cleanup => cleanup());
    };
  }

  /**
   * Intercept writes to `stdout`/`stderr` and forward as structured logs.
   *
   * @param stdout Writable stream to intercept (typically `process.stdout`).
   * @param stderr Writable stream to intercept (typically `process.stderr`).
   * @returns Cleanup function restoring the original `write` methods.
   */
  async forward(stdout: NodeJS.WriteStream, stderr: NodeJS.WriteStream): Promise<() => void> {
    // Ensure connection is established
    await connect(this.connectionString);

    // Store original write methods
    const originalStdoutWrite = stdout.write.bind(stdout);
    const originalStderrWrite = stderr.write.bind(stderr);

    // Intercept stdout
    stdout.write = (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void
    ): boolean => {
      const str = chunk.toString();

      // Parse and send log data (with better loop detection)
      if (str.trim() && !isForwarding && !str.includes('[OpenPull') && !str.includes('DEBUG:')) {
        const logData = parseLogLine(str, 'info');
        if (logData.message) {
          sendLogData(logData);
        }
      }

      // Call original write method
      if (typeof encodingOrCallback === 'function') {
        return originalStdoutWrite(chunk, encodingOrCallback);
      } else {
        return originalStdoutWrite(chunk, encodingOrCallback, callback);
      }
    };

    // Intercept stderr
    stderr.write = (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void
    ): boolean => {
      const str = chunk.toString();

      // Parse and send log data (with better loop detection)
      if (str.trim() && !isForwarding && !str.includes('[OpenPull') && !str.includes('DEBUG:')) {
        const logData = parseLogLine(str, 'error');
        if (logData.message) {
          sendLogData(logData);
        }
      }

      // Call original write method
      if (typeof encodingOrCallback === 'function') {
        return originalStderrWrite(chunk, encodingOrCallback);
      } else {
        return originalStderrWrite(chunk, encodingOrCallback, callback);
      }
    };

    // Return cleanup function
    return (): void => {
      stdout.write = originalStdoutWrite;
      stderr.write = originalStderrWrite;
    };
  }
}

/**
 * Create a connection that can forward stdout/stderr.
 *
 * @param connectionString An `openpull://` URL with role, key, host, and optional public token.
 */
export async function createConnection(connectionString: string): Promise<Connection> {
  return new ConnectionImpl(connectionString);
}
