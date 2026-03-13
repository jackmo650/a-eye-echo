// ============================================================================
// Video Stream Service — Send camera video to WallSpace.Studio
//
// Connects directly to WallSpace's video signaling WebSocket server.
// Captures camera frames as JPEG and sends them over WebSocket binary.
// Uses the signaling server for connection management and can optionally
// upgrade to WebRTC if react-native-webrtc is available in the future.
//
// Current transport: WebSocket binary (JPEG frames at 10-15fps)
// This is simpler than WebRTC and works great on local networks.
// For 720p JPEG at quality 0.7: ~30-80KB per frame = ~0.5-1.2MB/s at 15fps.
//
// Usage:
//   const service = new VideoStreamService();
//   await service.connect('192.168.1.100', 8765);
//   service.sendFrame(jpegBase64);  // from vision-camera snapshot
//   service.disconnect();
// ============================================================================

export type VideoStreamStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

type StatusCallback = (status: VideoStreamStatus, error?: string) => void;

interface SignalingMessage {
  type: string;
  [key: string]: any;
}

export class VideoStreamService {
  private _ws: WebSocket | null = null;
  private _status: VideoStreamStatus = 'disconnected';
  private _peerId: string | null = null;
  private _host: string | null = null;
  private _port: number = 8765;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempts = 0;
  private _maxReconnectAttempts = 10;
  private _statusCallbacks: StatusCallback[] = [];
  private _frameCount = 0;
  private _name: string;

  constructor(name = 'A.EYE.ECHO') {
    this._name = name;
  }

  get status(): VideoStreamStatus {
    return this._status;
  }

  get peerId(): string | null {
    return this._peerId;
  }

  get frameCount(): number {
    return this._frameCount;
  }

  get isConnected(): boolean {
    return this._status === 'connected' && this._ws?.readyState === WebSocket.OPEN;
  }

  // ── Connection ────────────────────────────────────────────────────────────

  /** Connect to WallSpace signaling server. */
  async connect(host: string, port = 8765): Promise<void> {
    this.disconnect();

    this._host = host;
    this._port = port;
    this._setStatus('connecting');

    return new Promise((resolve, reject) => {
      try {
        const url = `ws://${host}:${port}`;
        console.log(`[VideoStream] Connecting to ${url}`);

        this._ws = new WebSocket(url);

        this._ws.onopen = () => {
          console.log('[VideoStream] WebSocket connected');
          this._reconnectAttempts = 0;

          // Register as a video sender
          this._send({
            type: 'register',
            name: this._name,
            clientType: 'mobile',
            direction: 'send',
          });

          this._setStatus('connected');
          resolve();
        };

        this._ws.onmessage = (event: WebSocketMessageEvent) => {
          try {
            const msg: SignalingMessage = JSON.parse(
              typeof event.data === 'string' ? event.data : ''
            );
            this._handleMessage(msg);
          } catch {
            // Binary frame or unparseable — ignore
          }
        };

        this._ws.onerror = (error: Event) => {
          console.warn('[VideoStream] WebSocket error:', error);
          if (this._status === 'connecting') {
            this._setStatus('error', 'Connection failed');
            reject(new Error('WebSocket connection failed'));
          }
        };

        this._ws.onclose = () => {
          console.log('[VideoStream] WebSocket closed');
          if (this._status === 'connected') {
            // Unexpected close — try to reconnect
            this._scheduleReconnect();
          }
          if (this._status !== 'connecting') {
            this._setStatus('disconnected');
          }
        };
      } catch (err: any) {
        this._setStatus('error', err.message);
        reject(err);
      }
    });
  }

  /** Disconnect from the signaling server. */
  disconnect(): void {
    this._cancelReconnect();

    if (this._ws) {
      try {
        this._ws.close();
      } catch { /* ignore */ }
      this._ws = null;
    }

    this._peerId = null;
    this._frameCount = 0;
    this._setStatus('disconnected');
  }

  // ── Frame Sending ─────────────────────────────────────────────────────────

  /**
   * Send a JPEG frame to WallSpace.
   * @param jpegBase64 - Base64-encoded JPEG image data (from vision-camera takeSnapshot)
   */
  sendFrame(jpegBase64: string): void {
    if (!this.isConnected || !this._ws) return;

    try {
      // Send as a JSON message with the frame data
      // WallSpace will decode this and draw to the remote camera canvas
      this._ws.send(JSON.stringify({
        type: 'video-frame',
        peerId: this._peerId,
        frame: jpegBase64,
        timestamp: Date.now(),
        frameIndex: this._frameCount,
      }));
      this._frameCount++;
    } catch (err) {
      console.warn('[VideoStream] Failed to send frame:', err);
    }
  }

  /**
   * Send a raw binary JPEG frame (more efficient than base64).
   * @param jpegBuffer - ArrayBuffer containing JPEG image data
   */
  sendFrameBinary(jpegBuffer: ArrayBuffer): void {
    if (!this.isConnected || !this._ws) return;

    try {
      this._ws.send(jpegBuffer);
      this._frameCount++;
    } catch (err) {
      console.warn('[VideoStream] Failed to send binary frame:', err);
    }
  }

  // ── Status Callbacks ──────────────────────────────────────────────────────

  onStatusChange(callback: StatusCallback): () => void {
    this._statusCallbacks.push(callback);
    return () => {
      this._statusCallbacks = this._statusCallbacks.filter(cb => cb !== callback);
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _handleMessage(msg: SignalingMessage): void {
    switch (msg.type) {
      case 'registered':
        this._peerId = msg.peerId;
        console.log(`[VideoStream] Registered as peer ${this._peerId}`);
        break;

      case 'peer-list':
        console.log(`[VideoStream] Peers: ${msg.peers?.length ?? 0}`);
        break;

      default:
        // Ignore other message types for now
        break;
    }
  }

  private _send(msg: SignalingMessage): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  }

  private _setStatus(status: VideoStreamStatus, error?: string): void {
    this._status = status;
    for (const cb of this._statusCallbacks) {
      try { cb(status, error); } catch { /* ignore */ }
    }
  }

  private _scheduleReconnect(): void {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      console.warn('[VideoStream] Max reconnect attempts reached');
      this._setStatus('error', 'Max reconnect attempts reached');
      return;
    }

    this._reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), 30000);
    console.log(`[VideoStream] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);

    this._reconnectTimer = setTimeout(async () => {
      if (this._host) {
        try {
          await this.connect(this._host, this._port);
        } catch {
          // connect() handles its own errors
        }
      }
    }, delay);
  }

  private _cancelReconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._reconnectAttempts = 0;
  }
}

// Singleton
let _instance: VideoStreamService | null = null;
export function getVideoStreamService(): VideoStreamService {
  if (!_instance) {
    _instance = new VideoStreamService();
  }
  return _instance;
}
