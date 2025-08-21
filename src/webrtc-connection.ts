/**
 * WebRTC Connection Management with Data Channels
 *
 * Implements peer-to-peer transport using `node-datachannel` for log
 * forwarding between appenders and readers. Signaling is performed over
 * a WebSocket connection to the OpenPull signaling server.
 *
 * FUNCTIONAL APPROACH - NO CLASSES
 */

import * as nodeDataChannel from 'node-datachannel';
import { createHmac } from 'crypto';
import { WebSocket } from 'ws';
import type {
  ConnectionInfo,
  LogData,
  NodeDataChannelDataChannel,
  NodeDataChannelPeerConnection,
  WebSocketMessage,
} from './types.js';

/**
 * Minimal peer descriptor as reported by the signaling server.
 * @internal
 */
export interface PeerInfo {
  peerId: string;
  role: 'appender' | 'reader';
}

/**
 * Tracks an active or in-progress WebRTC connection to a peer.
 * @internal
 */
export interface RTCConnection {
  peerId: string;
  role: 'appender' | 'reader';
  peerConnection: NodeDataChannelPeerConnection;
  dataChannel?: NodeDataChannelDataChannel;
  isConnected: boolean;
}

/**
 * Mutable state for a WebRTC manager instance.
 * @internal
 */
export interface WebRTCManagerState {
  signalingWs: WebSocket | null;
  myPeerId: string | null;
  myRole: 'appender' | 'reader' | null;
  myPublicToken: string | null;
  myKeyHex: string | null;
  peers: Map<string, PeerInfo>;
  rtcConnections: Map<string, RTCConnection>;
  logHandlers: Set<(logData: LogData) => void>;
  connectionHandlers: Set<(peerId: string, connected: boolean) => void>;
  pingInterval: NodeJS.Timeout | null;
  cleanupInterval: NodeJS.Timeout | null;
  reconnectionAttempts: number;
  maxReconnectionAttempts: number;
  defaultFields?: Record<string, unknown>;
}

/**
 * Facade for managing signaling, peer discovery, and data channels.
 */
export interface WebRTCManager {
  connect: (connectionString: string, defaultFields?: Record<string, unknown>) => Promise<void>;
  sendLog: (logData: LogData) => void;
  onLog: (handler: (logData: LogData) => void) => () => void;
  onConnection: (handler: (peerId: string, connected: boolean) => void) => () => void;
  disconnect: () => void;
  getConnectionCount: () => number;
  isConnected: () => boolean;
  getReconnectionInfo: () => { attempts: number; maxAttempts: number; willReconnect: boolean };
}

/** @internal */
function createWebRTCManagerState(): WebRTCManagerState {
  return {
    signalingWs: null,
    myPeerId: null,
    myRole: null,
    myPublicToken: null,
    myKeyHex: null,
    peers: new Map(),
    rtcConnections: new Map(),
    logHandlers: new Set(),
    connectionHandlers: new Set(),
    pingInterval: null,
    cleanupInterval: null,
    reconnectionAttempts: 0,
    maxReconnectionAttempts: 5,
  };
}

/** Parse an `openpull://` connection string into components. */
export function parseConnectionString(connectionString: string): ConnectionInfo {
  try {
    const url = new URL(connectionString);

    if (url.protocol !== 'openpull:') {
      throw new Error('Invalid protocol. Expected openpull://');
    }

    const role = url.username as 'appender' | 'reader';
    const key = url.password;
    const host = url.host;
    const publicToken = url.pathname.length > 1 ? url.pathname.substring(1) : undefined;

    if (!role || !key || !host) {
      throw new Error('Invalid connection string format');
    }

    if (role !== 'appender' && role !== 'reader') {
      throw new Error('Invalid role. Must be "appender" or "reader"');
    }

    const result: ConnectionInfo = { host, role, key };
    if (publicToken !== undefined) {
      result.publicToken = publicToken;
    }
    return result;
  } catch (error) {
    throw new Error(
      `Failed to parse connection string: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Send a signaling message if the socket is open. @internal */
function sendMessage(state: WebRTCManagerState, message: WebSocketMessage): void {
  if (state.signalingWs?.readyState === WebSocket.OPEN) {
    state.signalingWs.send(JSON.stringify(message));
  }
}

/** Notify registered connection observers. @internal */
function notifyConnectionChange(state: WebRTCManagerState, peerId: string, connected: boolean): void {
  state.connectionHandlers.forEach((handler) => {
    try {
      handler(peerId, connected);
    } catch (error) {
      console.error('Error in connection handler:', error);
    }
  });
}

/** Decide whether to connect to the given peer based on our role. @internal */
function shouldConnectToPeer(myRole: string | null, peerRole: 'appender' | 'reader'): boolean {
  // Readers connect to appenders, appenders connect to readers
  if (myRole === 'reader' && peerRole === 'appender') return true;
  if (myRole === 'appender' && peerRole === 'reader') return true;
  return false;
}

/** Set up handlers for a newly created or received data channel. @internal */
function setupDataChannel(
  state: WebRTCManagerState,
  rtcConnection: RTCConnection,
  dataChannel: NodeDataChannelDataChannel
): void {
  rtcConnection.dataChannel = dataChannel;

  dataChannel.onOpen(() => {
    rtcConnection.isConnected = true;
    notifyConnectionChange(state, rtcConnection.peerId, true);
  });

  dataChannel.onMessage((message) => {
    try {
      // Convert incoming payload to string (handles Buffer and ArrayBuffer)
      let messageString: string;
      if (typeof message === 'string') {
        messageString = message;
      } else if (message instanceof ArrayBuffer) {
        messageString = Buffer.from(message).toString();
      } else {
        // Treat as Node.js Buffer
        messageString = (message as Buffer).toString();
      }
      const logData: LogData = JSON.parse(messageString);
      state.logHandlers.forEach((handler) => {
        try {
          handler(logData);
        } catch (error) {
          console.error('Error in log handler:', error);
        }
      });
    } catch (error) {
      console.error('Failed to parse received log data:', error);
    }
  });

  dataChannel.onError((error: string) => {
    console.error(`Data channel error with ${rtcConnection.peerId}:`, error);
  });

  dataChannel.onClosed(() => {
    rtcConnection.isConnected = false;
    notifyConnectionChange(state, rtcConnection.peerId, false);
  });
}

/** Create and configure a new peer connection for a remote peer. @internal */
function initiatePeerConnection(
  state: WebRTCManagerState,
  peerId: string,
  role: 'appender' | 'reader',
  isInitiator: boolean
): void {
  if (state.rtcConnections.has(peerId)) {
    return; // Already connecting/connected
  }


  try {
    // Initialize node-datachannel
    nodeDataChannel.initLogger('Error');

    const config = {
      iceServers: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:global.stun.twilio.com:3478',
        'stun:stun.cloudflare.com:3478',
      ],
    };

    const peerConnection = new nodeDataChannel.PeerConnection(`peer-${state.myPeerId}`, config);

    const rtcConnection: RTCConnection = {
      peerId,
      role,
      peerConnection,
      isConnected: false,
    };

    state.rtcConnections.set(peerId, rtcConnection);

    // Set up peer connection event handlers
    peerConnection.onStateChange((connectionState: string) => {
      if (connectionState === 'connected') {
        rtcConnection.isConnected = true;
        notifyConnectionChange(state, peerId, true);
      } else if (connectionState === 'disconnected' || connectionState === 'failed') {
        rtcConnection.isConnected = false;
        notifyConnectionChange(state, peerId, false);
      }
    });

    peerConnection.onGatheringStateChange((gatheringState: string) => {
      // ICE gathering state changes - no logging needed
    });

    // Handle incoming data channels
    peerConnection.onDataChannel((dataChannel) => {
      setupDataChannel(state, rtcConnection, dataChannel);
    });

    // Set up signaling
    peerConnection.onLocalDescription((sdp: string, type: string) => {
      const messageType = type === 'offer' ? 'webrtc_offer' : 'webrtc_answer';
      const message: WebSocketMessage = {
        type: messageType as 'webrtc_offer' | 'webrtc_answer',
        targetPeerId: peerId,
      };

      // Create proper RTCSessionDescription format for browser
      message[type] = {
        type: type,
        sdp: sdp,
      };

      sendMessage(state, message);
    });

    peerConnection.onLocalCandidate((candidate: string, mid: string) => {
      sendMessage(state, {
        type: 'webrtc_ice_candidate',
        targetPeerId: peerId,
        candidate: {
          candidate: candidate,
          sdpMLineIndex: 0,
          sdpMid: mid || '0',
        },
      });
    });

    // Create data channel and offer if we're the initiator
    if (isInitiator) {
      const dataChannel = peerConnection.createDataChannel('logs', { unordered: false });
      setupDataChannel(state, rtcConnection, dataChannel);
      // The offer will be created automatically by node-datachannel when we have a data channel
      // The onLocalDescription callback will handle sending it
    }
  } catch (error) {
    console.error(`Failed to create WebRTC connection to ${peerId}:`, error);
    state.rtcConnections.delete(peerId);
  }
}

/** Tear down all resources related to a disconnected peer. @internal */
function handlePeerDisconnected(state: WebRTCManagerState, peerId: string): void {

  state.peers.delete(peerId);

  // Clean up WebRTC connection
  const rtcConnection = state.rtcConnections.get(peerId);
  if (rtcConnection) {
    // Close data channel first
    if (rtcConnection.dataChannel) {
      try {
        rtcConnection.dataChannel.close();
      } catch (error) {
        console.log(`Error closing data channel for ${peerId}:`, error);
      }
      delete rtcConnection.dataChannel;
    }

    // Close peer connection
    if (rtcConnection.peerConnection) {
      try {
        rtcConnection.peerConnection.close();
      } catch (error) {
        console.log(`Error closing peer connection for ${peerId}:`, error);
      }
    }

    // Mark as disconnected and remove from connections map
    rtcConnection.isConnected = false;
    state.rtcConnections.delete(peerId);
    notifyConnectionChange(state, peerId, false);
  }
}

/** Close all connections, timers, and signaling. @internal */
function cleanup(state: WebRTCManagerState): void {
  // Stop cleanup interval
  if (state.cleanupInterval) {
    clearInterval(state.cleanupInterval);
    state.cleanupInterval = null;
  }

  // Close all WebRTC connections
  state.rtcConnections.forEach((connection, _peerId) => {
    if (connection.dataChannel) {
      try {
        connection.dataChannel.close();
      } catch (error) {
        console.log(`Error closing data channel during cleanup:`, error);
      }
    }
    if (connection.peerConnection) {
      try {
        connection.peerConnection.close();
      } catch (error) {
        console.log(`Error closing peer connection during cleanup:`, error);
      }
    }
  });
  state.rtcConnections.clear();

  // Clear peers
  state.peers.clear();

  // Close signaling connection
  if (state.signalingWs) {
    state.signalingWs.close();
    state.signalingWs = null;
  }

  state.myPeerId = null;
  state.myRole = null;
}

/**
 * Construct a new WebRTC manager instance.
 *
 * @returns A facade exposing connection setup, log sending,
 *          observers, and cleanup utilities.
 */
export function WebRTCManager(): WebRTCManager {
  const state = createWebRTCManagerState();

  return {
    async connect(connectionString: string, defaultFields?: Record<string, unknown>): Promise<void> {
      const { host, role, key, publicToken } = parseConnectionString(connectionString);
      state.myRole = role;
      state.myPublicToken = publicToken || null;
      state.myKeyHex = key;
      // Respect exactOptionalPropertyTypes: delete property when undefined
      if (defaultFields === undefined) {
        delete (state as { defaultFields?: Record<string, unknown> }).defaultFields;
      } else {
        state.defaultFields = defaultFields;
      }

      return new Promise((resolve, reject) => {
        try {
          const wsUrl = publicToken ? `wss://${host}/${publicToken}` : `wss://${host}/`;
          const wsOptions = host.includes('localhost')
            ? {
                rejectUnauthorized: false,
              }
            : {};

          console.log(`DEBUG: Attempting to connect to WebSocket URL: ${wsUrl}`);
          console.log(`DEBUG: WebSocket options:`, wsOptions);

          state.signalingWs = new WebSocket(wsUrl, wsOptions);

          state.signalingWs.on('open', () => {
            // Wait for auth_challenge before sending proof
          });

          state.signalingWs.on('message', (data: Buffer) => {
            try {
              const message: WebSocketMessage = JSON.parse(data.toString());
              handleMessage(state, message, resolve, reject);
            } catch (error) {
              reject(new Error(`Failed to parse signaling message: ${error}`));
            }
          });

          state.signalingWs.on('error', (error: Error) => {
            reject(new Error(`Signaling connection failed: ${error.message}`));
          });

          state.signalingWs.on('close', () => {
            console.log('Signaling connection closed');
            cleanup(state);
          });

          // Start periodic cleanup of stale connections
          startCleanupInterval(state);
        } catch (error) {
          reject(error);
        }
      });
    },

    sendLog(logData: LogData): void {
      if (state.myRole !== 'appender') {
        console.warn('Only appenders can send logs');
        return;
      }

      const logMessage = JSON.stringify(logData);
      let sentCount = 0;

      // Send to all connected readers via WebRTC data channels
      state.rtcConnections.forEach((connection) => {
        if (connection.role === 'reader' && connection.isConnected && connection.dataChannel) {
          try {
            // Check if data channel is actually open before sending
            if (connection.dataChannel.isOpen?.()) {
              connection.dataChannel.sendMessage(logMessage);
              sentCount++;
            } else {
              console.log(`Data channel to ${connection.peerId} is closed, skipping log send`);
              // Don't cleanup here - wait for proper peer_disconnected message from signaling server
            }
          } catch (error) {
            console.error(`Failed to send log to peer ${connection.peerId}:`, error);
            // Don't cleanup here - wait for proper peer_disconnected message from signaling server
          }
        }
      });

      // Fallback to console if no readers connected
      if (sentCount === 0) {
        console.log('[OpenPull Log]', logMessage);
      }
    },

    onLog(handler: (logData: LogData) => void): () => void {
      state.logHandlers.add(handler);
      return () => state.logHandlers.delete(handler);
    },

    onConnection(handler: (peerId: string, connected: boolean) => void): () => void {
      state.connectionHandlers.add(handler);
      return () => state.connectionHandlers.delete(handler);
    },

    disconnect(): void {
      cleanup(state);
    },

    getConnectionCount(): number {
      return Array.from(state.rtcConnections.values()).filter((conn) => conn.isConnected).length;
    },

    isConnected(): boolean {
      return state.signalingWs?.readyState === WebSocket.OPEN && state.myPeerId !== null;
    },

    getReconnectionInfo(): {
      attempts: number;
      maxAttempts: number;
      willReconnect: boolean;
    } {
      return {
        attempts: state.reconnectionAttempts,
        maxAttempts: state.maxReconnectionAttempts,
        willReconnect: state.reconnectionAttempts < state.maxReconnectionAttempts,
      };
    },
  };
}

// Helper functions for message handling
/** Dispatch signaling messages from the server. @internal */
function handleMessage(
  state: WebRTCManagerState,
  message: WebSocketMessage,
  resolve?: (value: undefined) => void,
  reject?: (reason: Error) => void
): void {
  switch (message.type) {
    case 'auth_challenge': {
      const { nonce, timestamp } = message as unknown as { nonce: string; timestamp: number };
      if (!state.myRole || !state.myPublicToken || !state.myKeyHex) {
        console.error('Missing connection details for auth proof');
        return;
      }
      const payload = `openpull-auth|v1|${state.myPublicToken}|${state.myRole}|${nonce}|${timestamp}`;
      const proof = createHmac('sha256', Buffer.from(state.myKeyHex, 'hex')).update(payload).digest('hex');
      const authMessage: WebSocketMessage = {
        type: 'auth',
        role: state.myRole,
        proof,
      };
      if (state.defaultFields && Object.keys(state.defaultFields).length > 0) {
        authMessage.defaultFields = state.defaultFields;
      }
      sendMessage(state, authMessage);
      break;
    }
    case 'auth_success':
      state.myPeerId = message.peerId!;
      console.log(`Authenticated as ${state.myRole} with peerId: ${state.myPeerId}`);

      // Request peer discovery
      sendMessage(state, { type: 'peer_discovery' });

      if (resolve) resolve(undefined);
      break;

    case 'peer_list':
      handlePeerList(state, message.peers || []);
      break;

    case 'peer_joined':
      if (message.peerId && message.role) {
        handlePeerJoined(state, message.peerId, message.role);
      }
      break;

    case 'peer_disconnected':
      if (message.peerId) {
        handlePeerDisconnected(state, message.peerId);
      }
      break;

    case 'webrtc_offer':
      handleWebRTCOffer(state, message);
      break;

    case 'webrtc_answer':
      handleWebRTCAnswer(state, message);
      break;

    case 'webrtc_ice_candidate':
      handleWebRTCIceCandidate(state, message);
      break;

    case 'error':
      console.error('Signaling error:', message.message);
      if (reject) reject(new Error(message.message));
      break;
  }
}

/** Handle the full peer list snapshot from the server. @internal */
function handlePeerList(state: WebRTCManagerState, peers: Array<{ peerId: string; role: 'appender' | 'reader' }>): void {

  state.peers.clear();
  peers.forEach((peer) => {
    state.peers.set(peer.peerId, peer);
    // Start WebRTC connection to relevant peers
    if (shouldConnectToPeer(state.myRole, peer.role)) {
      // Determine who should be initiator: peer with smaller peerId initiates
      const shouldBeInitiator = Boolean(state.myPeerId && state.myPeerId < peer.peerId);
      initiatePeerConnection(state, peer.peerId, peer.role, shouldBeInitiator);
    }
  });
}

/** Handle notification that a peer joined. @internal */
function handlePeerJoined(state: WebRTCManagerState, peerId: string, role: 'appender' | 'reader'): void {
  console.log(`Peer joined: ${peerId} (${role})`);

  state.peers.set(peerId, { peerId, role });

  // Start WebRTC connection to relevant peers
  if (shouldConnectToPeer(state.myRole, role)) {
    // Wait a bit to let the other peer settle
    setTimeout(() => {
      // Don't create duplicate connections
      if (state.rtcConnections.has(peerId)) {
        console.log(`Connection to ${peerId} already exists, skipping`);
        return;
      }

      // Determine who should be initiator: peer with smaller peerId initiates
      const shouldBeInitiator = Boolean(state.myPeerId && state.myPeerId < peerId);
      console.log(
        `Connecting to ${peerId}, shouldBeInitiator: ${shouldBeInitiator} (${state.myPeerId} vs ${peerId})`
      );
      initiatePeerConnection(state, peerId, role, shouldBeInitiator);
    }, 1000);
  }
}

/** Process an incoming WebRTC offer and respond appropriately. @internal */
function handleWebRTCOffer(state: WebRTCManagerState, message: WebSocketMessage): void {
  const fromPeerId = message.fromPeerId!;
  const offer = message.offer!;

  console.log(`Received WebRTC offer from ${fromPeerId}`);

  let rtcConnection = state.rtcConnections.get(fromPeerId);

  // If no connection exists, create one (incoming connection)
  if (!rtcConnection) {
    console.log(`Creating new WebRTC connection for incoming offer from ${fromPeerId}`);

    // Determine the role of the peer sending the offer
    const peerInfo = state.peers.get(fromPeerId);
    const peerRole = peerInfo ? peerInfo.role : 'reader'; // Default to reader if not found

    try {
      // Initialize node-datachannel
      nodeDataChannel.initLogger('Error');

      const config = {
        iceServers: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
          'stun:global.stun.twilio.com:3478',
          'stun:stun.cloudflare.com:3478',
        ],
      };

      const peerConnection = new nodeDataChannel.PeerConnection(`peer-${state.myPeerId}`, config);

      const newRtcConnection: RTCConnection = {
        peerId: fromPeerId,
        role: peerRole,
        peerConnection,
        isConnected: false,
      };

      state.rtcConnections.set(fromPeerId, newRtcConnection);
      rtcConnection = newRtcConnection;

      // Set up peer connection event handlers
      peerConnection.onStateChange((connectionState: string) => {
        console.log(`WebRTC state with ${fromPeerId}: ${connectionState}`);
        if (connectionState === 'connected') {
          rtcConnection!.isConnected = true;
          notifyConnectionChange(state, fromPeerId, true);
        } else if (connectionState === 'disconnected' || connectionState === 'failed') {
          rtcConnection!.isConnected = false;
          notifyConnectionChange(state, fromPeerId, false);
        }
      });

      // Handle incoming data channels
      peerConnection.onDataChannel((dataChannel) => {
        console.log(`Received data channel from ${fromPeerId}`);
        setupDataChannel(state, rtcConnection!, dataChannel);
      });

      // Set up signaling
      peerConnection.onLocalDescription((sdp: string, type: string) => {
        console.log(`Sending ${type} to ${fromPeerId}`);

        const messageType = type === 'offer' ? 'webrtc_offer' : 'webrtc_answer';
        const message: WebSocketMessage = {
          type: messageType as 'webrtc_offer' | 'webrtc_answer',
          targetPeerId: fromPeerId,
        };

        // Create proper RTCSessionDescription format for browser
        message[type] = {
          type: type,
          sdp: sdp,
        };

        sendMessage(state, message);
      });

      peerConnection.onLocalCandidate((candidate: string, mid: string) => {
        sendMessage(state, {
          type: 'webrtc_ice_candidate',
          targetPeerId: fromPeerId,
          candidate: {
            candidate: candidate,
            sdpMLineIndex: 0,
            sdpMid: mid || '0',
          },
        });
      });
    } catch (error) {
      console.error(`Failed to create WebRTC connection for offer from ${fromPeerId}:`, error);
      return;
    }
  }

  if (rtcConnection?.peerConnection && offer.sdp && offer.type) {
    try {
      // node-datachannel expects SDP string and type
      rtcConnection.peerConnection.setRemoteDescription(offer.sdp, offer.type);
    } catch (error) {
      console.error(`Failed to set remote description for ${fromPeerId}:`, error);
    }
  } else {
    console.error(`Failed to create or find WebRTC connection for ${fromPeerId}`);
  }
}

/** Apply an incoming WebRTC answer to a pending connection. @internal */
function handleWebRTCAnswer(state: WebRTCManagerState, message: WebSocketMessage): void {
  const fromPeerId = message.fromPeerId!;
  const answer = message.answer!;

  console.log(`Received WebRTC answer from ${fromPeerId}`);

  const rtcConnection = state.rtcConnections.get(fromPeerId);
  if (rtcConnection?.peerConnection && answer.sdp && answer.type) {
    try {
      // node-datachannel expects SDP string and type
      rtcConnection.peerConnection.setRemoteDescription(answer.sdp, answer.type);
    } catch (error) {
      console.error(`Failed to set remote description (answer) for ${fromPeerId}:`, error);
    }
  } else {
    console.error(`No connection found or invalid answer for ${fromPeerId}`);
  }
}

/** Add a remote ICE candidate to a connection. @internal */
function handleWebRTCIceCandidate(state: WebRTCManagerState, message: WebSocketMessage): void {
  const fromPeerId = message.fromPeerId!;
  const candidate = message.candidate!;

  const rtcConnection = state.rtcConnections.get(fromPeerId);
  if (rtcConnection?.peerConnection && candidate.candidate && candidate.sdpMid) {
    try {
      // node-datachannel expects candidate string and sdpMid
      rtcConnection.peerConnection.addRemoteCandidate(candidate.candidate, candidate.sdpMid);
    } catch (error) {
      console.error(`Failed to add ICE candidate for ${fromPeerId}:`, error);
    }
  }
}

/** Start a periodic cleanup as a safety net when signaling is unavailable. @internal */
function startCleanupInterval(state: WebRTCManagerState): void {
  // Fallback cleanup every 5 seconds in case signaling server is down
  // This should rarely do anything if signaling server is working properly
  state.cleanupInterval = setInterval(() => {
    cleanupStaleConnections(state);
  }, 5000);
}

/** Identify and remove clearly failed/closed connections. @internal */
function cleanupStaleConnections(state: WebRTCManagerState): void {
  const staleConnections: string[] = [];

  state.rtcConnections.forEach((connection, peerId) => {
    // Only clean up connections that are definitively broken
    // Rely on signaling server for normal disconnections

    // Check if peer connection is in failed/closed state
    if (connection.peerConnection) {
      try {
        const connectionState = connection.peerConnection.state();
        if (connectionState === 'closed' || connectionState === 'failed') {
          staleConnections.push(peerId);
        }
      } catch (_error) {
        // If we can't get the state, the connection is broken
        staleConnections.push(peerId);
      }
    } else {
      // No peer connection at all
      staleConnections.push(peerId);
    }
  });

  // Clean up stale connections (fallback only)
  if (staleConnections.length > 0) {
    console.log(
      `Fallback cleanup: found ${staleConnections.length} stale connections (signaling server may be down)`
    );
    staleConnections.forEach((peerId) => {
      console.log(`Fallback cleanup of connection to peer ${peerId}`);
      handlePeerDisconnected(state, peerId);
    });
  }
}
