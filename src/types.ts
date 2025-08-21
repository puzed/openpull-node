/**
 * OpenPull Node.js Library Types
 *
 * Centralized TypeScript types used by the OpenPull Node.js library.
 * These types model the logging payloads, tracing helpers, connection
 * primitives, WebRTC signaling messages, and minimal shims for the
 * `node-datachannel` API used internally.
 *
 * The library intentionally keeps the log schema flexible — logs are
 * arbitrary JSON objects with a handful of commonly recognized fields
 * like `type`, `message`, `timestamp`, and optionally `traceId`/`spanId`.
 *
 * @packageDocumentation
 */

/**
 * Parsed connection details from an `openpull://` connection string.
 */
export interface ConnectionInfo {
  /** Host (and optional port) for the signaling server. */
  host: string;
  /** Client role. `appender` sends logs; `reader` receives logs. */
  role: 'appender' | 'reader';
  /** Authentication key derived from the session. */
  key: string;
  /** Optional public token identifying the session. */
  publicToken?: string;
}

/**
 * Canonical log entry structure forwarded through OpenPull.
 *
 * While the shape is open (index signature), the fields below are
 * commonly used by the library and dashboard.
 */
export interface LogData {
  /** Severity or category of the log entry. */
  type: 'info' | 'error' | 'warning' | 'debug' | 'trace';
  /** Human-readable message for the log entry. */
  message: string;
  /** ISO 8601 timestamp when the log event occurred. */
  timestamp: string;
  /** Optional distributed tracing correlation ID. */
  traceId?: string;
  /** Optional span ID for trace sub-steps. */
  spanId?: string;
  /** Open shape for arbitrary structured data. */
  [key: string]: unknown;
}

/**
 * Options for trace creation helpers.
 */
export interface TraceOptions {
  /** Default fields added to every trace span. */
  defaultFields?: Record<string, unknown>;
}

/**
 * Options for the standalone logger factory.
 */
export interface LoggerOptions {
  /** Default fields included in every log event. */
  defaultFields?: Record<string, unknown>;
}

/**
 * Options controlling how raw streams are forwarded.
 *
 * @remarks
 * These options are primarily used by the CLI and may be expanded
 * in the future for additional parsing/transform behaviors.
 */
export interface ForwardOptions {
  /** Explicit URL for the connection (overrides environment). */
  url?: string;
  /** Attempt to parse lines as JSON before falling back to text. */
  parseJson?: boolean;
}

/**
 * Fluent interface for recording trace spans.
 */
export interface Tracer {
  /**
   * Record a span within the current trace.
   * @param message Short description of the operation, or an object with structured fields.
   * @param extra Additional structured fields merged into the span.
   * @returns The same tracer, enabling chaining.
   */
  span: (message: string | Record<string, unknown>, extra?: Record<string, unknown>) => Tracer;
  /** Mark the end of the current trace. */
  finish: () => void;
}

/**
 * Minimal standalone logger resembling pino/winston APIs.
 *
 * @remarks
 * This logger only writes JSON to stdout; it does not perform any
 * network I/O. Forwarding to OpenPull is handled separately by the
 * connection utilities.
 */
export interface Logger {
  /** Log an informational message. */
  info: (message: string | Record<string, unknown>, extra?: Record<string, unknown>) => void;
  /** Log an error message. */
  error: (message: string | Record<string, unknown>, extra?: Record<string, unknown>) => void;
  /** Log a debug message. */
  debug: (message: string | Record<string, unknown>, extra?: Record<string, unknown>) => void;
  /** Log a warning message. */
  warning: (message: string | Record<string, unknown>, extra?: Record<string, unknown>) => void;
  /** Alias for `warning`. */
  warn: (message: string | Record<string, unknown>, extra?: Record<string, unknown>) => void;
  /** Start a new trace and log its first span. */
  trace: (message: string | Record<string, unknown>, extra?: Record<string, unknown>) => Tracer;
  /** Start a new trace with a message or structured fields. */
  startTrace: (message: string | Record<string, unknown>, extra?: Record<string, unknown>) => Tracer;
}

/**
 * Active OpenPull connection that can forward process streams.
 */
export interface Connection {
  /**
   * Intercepts `stdout`/`stderr` writes and forwards them as logs.
   * @returns Cleanup function restoring original streams.
   */
  forward: (stdout: NodeJS.WriteStream, stderr: NodeJS.WriteStream) => Promise<() => void>;
  /**
   * Forwards provided readable streams (e.g., a child process) as logs.
   * @returns Cleanup function detaching listeners.
   */
  forwardStreams: (stdout: NodeJS.ReadableStream, stderr: NodeJS.ReadableStream) => Promise<() => void>;
}

/**
 * Signaling protocol messages exchanged with the OpenPull server.
 *
 * @internal
 */
export interface WebSocketMessage {
  type:
    | 'auth'
    | 'auth_challenge'
    | 'auth_success'
    | 'error'
    | 'webrtc_offer'
    | 'webrtc_answer'
    | 'webrtc_ice_candidate'
    | 'peer_discovery'
    | 'peer_list'
    | 'peer_joined'
    | 'peer_disconnected'
    | 'ping'
    | 'pong'
    | 'log';
  role?: 'appender' | 'reader';
  // Zero-knowledge auth fields
  proof?: string;
  nonce?: string;
  timestamp?: number;
  algo?: 'hmac-sha256';
  version?: 'v1';
  /** Default fields included with all logs for this session. */
  defaultFields?: Record<string, unknown>;
  /** Optional log payload when using log-level signaling. */
  data?: LogData;
  message?: string;
  /** The peer ID assigned by the signaling server. */
  peerId?: string;
  /** Explicit target peer for a signaling message. */
  targetPeerId?: string;
  /** Source peer for inbound signaling messages. */
  fromPeerId?: string;
  /** List of active peers currently known to the server. */
  peers?: Array<{ peerId: string; role: 'appender' | 'reader' }>;
  /** Session description offer (browser-compatible format). */
  offer?: RTCSessionDescriptionInit;
  /** Session description answer (browser-compatible format). */
  answer?: RTCSessionDescriptionInit;
  /** ICE candidate details. */
  candidate?: RTCIceCandidateInit;
  [key: string]: unknown;
}

/**
 * Structured representation of a parsed log line.
 *
 * @remarks
 * Used internally when converting raw text lines to structured logs prior
 * to type-narrowing into {@link LogData}.
 */
export interface ParsedLogLine {
  type: string;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

// Minimal types for node-datachannel library - matching actual API
/**
 * Minimal PeerConnection surface used from `node-datachannel`.
 *
 * @internal
 */
export interface NodeDataChannelPeerConnection {
  setRemoteDescription(sdp: string, type: string): void;
  addRemoteCandidate(candidate: string, sdpMid: string): void;
  createDataChannel(label: string, options?: any): NodeDataChannelDataChannel;
  onDataChannel(callback: (dataChannel: NodeDataChannelDataChannel) => void): void;
  onLocalDescription(callback: (sdp: string, type: string) => void): void;
  onLocalCandidate(callback: (candidate: string, sdpMid: string) => void): void;
  onStateChange(callback: (state: string) => void): void;
  onGatheringStateChange(callback: (state: string) => void): void;
  state(): string;
  close(): void;
}

/**
 * Minimal DataChannel surface used from `node-datachannel`.
 *
 * @internal
 */
export interface NodeDataChannelDataChannel {
  sendMessage(message: string): void;
  onMessage(callback: (message: string | ArrayBuffer | Buffer<ArrayBufferLike>) => void): void;
  onOpen(callback: () => void): void;
  onClosed(callback: () => void): void;
  onError(callback: (error: string) => void): void;
  isOpen?(): boolean;
  close(): void;
}
