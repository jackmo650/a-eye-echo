// ============================================================================
// Caption Network Service — Share live captions between devices
//
// Host device captures audio and broadcasts TranscriptSegments.
// Receivers connect via a 6-digit room code and receive live captions.
// Uses WebSocket relay for NAT traversal (no port forwarding needed).
//
// Architecture:
//   Host: transcription → captionNetworkService.broadcast(segment)
//         → WebSocket relay → all connected receivers
//   Receiver: captionNetworkService.join(roomCode)
//         → WebSocket relay → onSegment callback → display
// ============================================================================

import type { TranscriptSegment } from '../types';

export type NetworkRole = 'host' | 'receiver' | 'disconnected';

export interface NetworkStatus {
  role: NetworkRole;
  roomCode: string | null;
  connectedPeers: number;
  isConnected: boolean;
}

type SegmentCallback = (segment: TranscriptSegment) => void;
type StatusCallback = (status: NetworkStatus) => void;

// Message types sent over WebSocket
interface NetworkMessage {
  type: 'segment' | 'join' | 'leave' | 'peer-count' | 'style-sync';
  roomCode: string;
  payload?: any;
}

// ── Relay URL ──────────────────────────────────────────────────────────────
// Uses a simple WebSocket relay. In production, deploy your own relay server.
// For now, uses a free public relay or local fallback.
const DEFAULT_RELAY_URL = 'wss://caption-relay.glitch.me';

export class CaptionNetworkService {
  private _ws: WebSocket | null = null;
  private _role: NetworkRole = 'disconnected';
  private _roomCode: string | null = null;
  private _connectedPeers = 0;
  private _relayUrl: string;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempts = 0;
  private _maxReconnectAttempts = 5;

  private _segmentCallbacks: SegmentCallback[] = [];
  private _statusCallbacks: StatusCallback[] = [];

  constructor(relayUrl?: string) {
    this._relayUrl = relayUrl || DEFAULT_RELAY_URL;
  }

  get status(): NetworkStatus {
    return {
      role: this._role,
      roomCode: this._roomCode,
      connectedPeers: this._connectedPeers,
      isConnected: this._ws?.readyState === WebSocket.OPEN,
    };
  }

  // ── Host: Start broadcasting ─────────────────────────────────────────────

  async startHosting(): Promise<string> {
    this.disconnect();

    const roomCode = this._generateRoomCode();
    this._roomCode = roomCode;
    this._role = 'host';

    await this._connect();
    this._emitStatus();

    console.log(`[CaptionNet] Hosting room: ${roomCode}`);
    return roomCode;
  }

  /** Broadcast a segment to all receivers */
  broadcast(segment: TranscriptSegment): void {
    if (this._role !== 'host' || !this._roomCode) return;
    this._send({
      type: 'segment',
      roomCode: this._roomCode,
      payload: segment,
    });
  }

  // ── Receiver: Join a room ────────────────────────────────────────────────

  async joinRoom(roomCode: string): Promise<void> {
    this.disconnect();

    this._roomCode = roomCode.toUpperCase();
    this._role = 'receiver';

    await this._connect();

    // Announce join
    this._send({
      type: 'join',
      roomCode: this._roomCode,
    });

    this._emitStatus();
    console.log(`[CaptionNet] Joined room: ${this._roomCode}`);
  }

  // ── Disconnect ───────────────────────────────────────────────────────────

  disconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._ws) {
      if (this._roomCode && this._role === 'receiver') {
        this._send({ type: 'leave', roomCode: this._roomCode });
      }
      this._ws.close();
      this._ws = null;
    }

    this._role = 'disconnected';
    this._roomCode = null;
    this._connectedPeers = 0;
    this._reconnectAttempts = 0;
    this._emitStatus();
  }

  // ── Callbacks ────────────────────────────────────────────────────────────

  onSegment(cb: SegmentCallback): () => void {
    this._segmentCallbacks.push(cb);
    return () => { this._segmentCallbacks = this._segmentCallbacks.filter(c => c !== cb); };
  }

  onStatusChange(cb: StatusCallback): () => void {
    this._statusCallbacks.push(cb);
    return () => { this._statusCallbacks = this._statusCallbacks.filter(c => c !== cb); };
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const url = `${this._relayUrl}?room=${this._roomCode}&role=${this._role}`;
        this._ws = new WebSocket(url);

        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timed out'));
          this._ws?.close();
        }, 10000);

        this._ws.onopen = () => {
          clearTimeout(timeout);
          this._reconnectAttempts = 0;
          console.log('[CaptionNet] Connected to relay');
          resolve();
        };

        this._ws.onmessage = (event) => {
          try {
            const msg: NetworkMessage = JSON.parse(event.data as string);
            this._handleMessage(msg);
          } catch {
            // Ignore malformed messages
          }
        };

        this._ws.onerror = (error) => {
          clearTimeout(timeout);
          console.warn('[CaptionNet] WebSocket error:', error);
        };

        this._ws.onclose = () => {
          console.log('[CaptionNet] Disconnected from relay');
          if (this._role !== 'disconnected') {
            this._attemptReconnect();
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private _handleMessage(msg: NetworkMessage): void {
    if (msg.roomCode !== this._roomCode) return;

    switch (msg.type) {
      case 'segment':
        if (this._role === 'receiver' && msg.payload) {
          const segment = msg.payload as TranscriptSegment;
          for (const cb of this._segmentCallbacks) cb(segment);
        }
        break;

      case 'peer-count':
        this._connectedPeers = msg.payload?.count ?? 0;
        this._emitStatus();
        break;

      case 'join':
        if (this._role === 'host') {
          this._connectedPeers++;
          this._emitStatus();
          console.log(`[CaptionNet] Peer joined (${this._connectedPeers} connected)`);
        }
        break;

      case 'leave':
        if (this._role === 'host') {
          this._connectedPeers = Math.max(0, this._connectedPeers - 1);
          this._emitStatus();
          console.log(`[CaptionNet] Peer left (${this._connectedPeers} connected)`);
        }
        break;
    }
  }

  private _send(msg: NetworkMessage): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  }

  private _attemptReconnect(): void {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      console.warn('[CaptionNet] Max reconnect attempts reached');
      this.disconnect();
      return;
    }

    this._reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30000);

    console.log(`[CaptionNet] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);
    this._reconnectTimer = setTimeout(() => {
      this._connect().catch(() => {
        this._attemptReconnect();
      });
    }, delay);
  }

  private _emitStatus(): void {
    const status = this.status;
    for (const cb of this._statusCallbacks) cb(status);
  }

  private _generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance: CaptionNetworkService | null = null;

export function getCaptionNetworkService(): CaptionNetworkService {
  if (!_instance) _instance = new CaptionNetworkService();
  return _instance;
}
