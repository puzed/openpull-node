/**
 * Mock WebSocket implementation for testing.
 *
 * Provides a minimal subset of the `ws` API sufficient for local
 * development and unit tests. Not intended for production use.
 *
 * FUNCTIONAL APPROACH - NO CLASSES
 * @internal
 */

type EventListener = (...args: unknown[]) => void;

interface WebSocketMockState {
  url: string;
  readyState: number;
  eventListeners: Map<string, EventListener[]>;
}

interface WebSocketMock {
  readonly CONNECTING: number;
  readonly OPEN: number;
  readonly CLOSING: number;
  readonly CLOSED: number;
  url: string;
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  terminate: () => void;
  on: (event: string, listener: EventListener) => void;
}

function createWebSocketMockState(url: string): WebSocketMockState {
  return {
    url,
    readyState: 0, // CONNECTING
    eventListeners: new Map(),
  };
}

function emit(state: WebSocketMockState, event: string, ...args: unknown[]): void {
  const listeners = state.eventListeners.get(event);
  if (listeners) {
    listeners.forEach((listener) => listener(...args));
  }
}

/**
 * Construct a new mock WebSocket that opens asynchronously.
 * @param url Target URL (recorded for inspection only).
 */
export function WebSocket(url: string): WebSocketMock {
  const state = createWebSocketMockState(url);

  // Simulate async connection
  setTimeout(() => {
    state.readyState = 1; // OPEN
    emit(state, 'open');
  }, 100);

  return {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,

    get url() { return state.url; },
    get readyState() { return state.readyState; },

    send(data: string): void {
      console.log(`[WebSocket Mock] Send: ${data}`);
    },

    close(): void {
      state.readyState = 3; // CLOSED
      emit(state, 'close', 1000, Buffer.from('Normal closure'));
    },

    terminate(): void {
      state.readyState = 3; // CLOSED
      emit(state, 'close', 1006, Buffer.from('Terminated'));
    },

    on(event: string, listener: EventListener): void {
      if (!state.eventListeners.has(event)) {
        state.eventListeners.set(event, []);
      }
      state.eventListeners.get(event)!.push(listener);
    },
  };
}
