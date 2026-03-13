// ============================================================================
// Speaker Identification Service — Camera face detection + lip-sync correlation
//
// Phase 2: Real implementation using react-native-vision-camera + MLKit
//
// Pipeline:
//   Camera frame → MLKit Face Detection (landmarks + tracking) →
//   Lip movement delta → Correlate with audio amplitude →
//   Speaker attribution → Emit speaker ID with transcript segment
//
// All processing on-device. No photos uploaded. Face data stays local.
//
// Dependencies:
//   - react-native-vision-camera (camera access + frame processors)
//   - react-native-vision-camera-face-detector (MLKit face detection plugin)
//   - react-native-worklets-core (frame processor worklets)
// ============================================================================

import type { Speaker, FaceDetection, FaceLandmarks, CameraPosition } from '../types';

export type SpeakerDetectionCallback = (
  speakerId: string,
  face: FaceDetection,
) => void;

// ── Face Tracking State ─────────────────────────────────────────────────────

interface TrackedFace {
  trackingId: number;
  speakerId: string;
  speaker: Speaker;
  mouthOpennessHistory: number[];
  lipSyncScore: number;
  lastSeenMs: number;
}

// ── Speaker Colors ──────────────────────────────────────────────────────────

const SPEAKER_COLORS = [
  '#4FC3F7', '#FFB74D', '#81C784', '#E57373',
  '#BA68C8', '#FFD54F', '#4DB6AC', '#F06292',
];

export class SpeakerService {
  private _active = false;
  private _cameraPosition: CameraPosition = 'front';
  private _trackedFaces: Map<number, TrackedFace> = new Map();
  private _callbacks: SpeakerDetectionCallback[] = [];
  private _nextSpeakerId = 1;

  // Audio amplitude for lip-sync correlation
  private _audioAmplitudeHistory: number[] = [];
  private _isSpeechActive = false;
  private _lastFaceBounds: Map<number, { x: number; y: number; width: number; height: number }> = new Map();

  // Stale face cleanup interval
  private _cleanupTimer: ReturnType<typeof setInterval> | null = null;

  get isActive(): boolean { return this._active; }
  get cameraPosition(): CameraPosition { return this._cameraPosition; }

  /**
   * Start camera-based speaker detection.
   * The actual camera + frame processor is managed by the CameraFaceDetector
   * component — this service handles the logic layer.
   */
  start(cameraPosition: CameraPosition = 'front'): void {
    this._cameraPosition = cameraPosition;
    this._active = true;

    // Clean up stale faces every 5 seconds
    this._cleanupTimer = setInterval(() => this._cleanupStaleFaces(), 5000);

    console.log(`[SpeakerService] Started with ${cameraPosition} camera`);
  }

  stop(): void {
    this._active = false;
    this._trackedFaces.clear();
    this._audioAmplitudeHistory = [];

    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }

    console.log('[SpeakerService] Stopped');
  }

  /**
   * Process detected faces from MLKit frame processor.
   * Called by the CameraFaceDetector component with each frame's results.
   *
   * MLKit Face object shape (from react-native-vision-camera-face-detector):
   *   { bounds, landmarks, trackingId, smilingProbability, ... }
   */
  processFaces(faces: MLKitFace[]): FaceDetection[] {
    if (!this._active) return [];

    const now = Date.now();
    const detections: FaceDetection[] = [];

    for (const face of faces) {
      const trackingId = face.trackingId ?? -1;
      if (trackingId === -1) continue; // Skip faces without tracking ID

      // Get or create tracked face
      let tracked = this._trackedFaces.get(trackingId);
      if (!tracked) {
        tracked = this._createTrackedFace(trackingId);
        this._trackedFaces.set(trackingId, tracked);
        console.log(`[SpeakerService] New face detected: ${tracked.speaker.label}`);
      }

      tracked.lastSeenMs = now;

      // Store face bounds for subtitle anchoring
      this._lastFaceBounds.set(trackingId, {
        x: face.bounds.x,
        y: face.bounds.y,
        width: face.bounds.width,
        height: face.bounds.height,
      });

      // Compute mouth openness from landmarks
      const landmarks = this._extractLandmarks(face);
      const mouthOpenness = landmarks
        ? this._computeMouthOpenness(landmarks.mouthTop, landmarks.mouthBottom)
        : 0;

      // Track mouth movement history for lip-sync
      tracked.mouthOpennessHistory.push(mouthOpenness);
      if (tracked.mouthOpennessHistory.length > 15) {
        tracked.mouthOpennessHistory.shift(); // ~1 second window at 15fps
      }

      // Compute lip-sync correlation score
      tracked.lipSyncScore = this._computeLipSyncScore(tracked);

      // Determine if this face is currently speaking
      const isSpeaking = tracked.lipSyncScore > 0.3 && this._isSpeechActive;

      const detection: FaceDetection = {
        bounds: {
          x: face.bounds.x,
          y: face.bounds.y,
          width: face.bounds.width,
          height: face.bounds.height,
        },
        landmarks,
        isSpeaking,
        embedding: null, // Phase 3: face embedding for re-identification
      };

      detections.push(detection);

      // Emit speaker detection if this face is speaking
      if (isSpeaking) {
        for (const cb of this._callbacks) {
          cb(tracked.speakerId, detection);
        }
      }
    }

    return detections;
  }

  /**
   * Feed audio amplitude for lip-sync correlation.
   * Cross-references mouth movement timing with audio peaks.
   */
  feedAudioAmplitude(rmsDb: number): void {
    this._audioAmplitudeHistory.push(rmsDb);
    if (this._audioAmplitudeHistory.length > 30) {
      this._audioAmplitudeHistory.shift();
    }
    this._isSpeechActive = rmsDb > -40;
  }

  /**
   * Get the most likely current speaker based on lip-sync scores.
   */
  getActiveSpeaker(): { speakerId: string; speaker: Speaker } | null {
    if (!this._active || this._trackedFaces.size === 0) return null;

    let bestScore = 0;
    let bestFace: TrackedFace | null = null;

    for (const tracked of this._trackedFaces.values()) {
      if (tracked.lipSyncScore > bestScore && this._isSpeechActive) {
        bestScore = tracked.lipSyncScore;
        bestFace = tracked;
      }
    }

    if (!bestFace || bestScore < 0.3) return null;

    return {
      speakerId: bestFace.speakerId,
      speaker: bestFace.speaker,
    };
  }

  /**
   * Get face bounding box of the active speaker (normalized 0-1).
   * Used for subtitle anchoring near the speaker's face.
   */
  getActiveSpeakerBounds(): { x: number; y: number; width: number; height: number } | null {
    const active = this.getActiveSpeaker();
    if (!active) return null;

    for (const tracked of this._trackedFaces.values()) {
      if (tracked.speakerId === active.speakerId) {
        // Return the last known face bounds
        return this._lastFaceBounds.get(tracked.trackingId) ?? null;
      }
    }
    return null;
  }

  /** Get all tracked speakers. */
  getSpeakers(): Speaker[] {
    return Array.from(this._trackedFaces.values()).map(f => f.speaker);
  }

  /** Rename a speaker (user taps avatar). */
  renameSpeaker(speakerId: string, newLabel: string): void {
    for (const tracked of this._trackedFaces.values()) {
      if (tracked.speakerId === speakerId) {
        tracked.speaker.label = newLabel;
        break;
      }
    }
  }

  onSpeakerDetected(cb: SpeakerDetectionCallback): () => void {
    this._callbacks.push(cb);
    return () => { this._callbacks = this._callbacks.filter(c => c !== cb); };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private _createTrackedFace(trackingId: number): TrackedFace {
    const index = this._nextSpeakerId - 1;
    const letter = String.fromCharCode(65 + (index % 26));
    const speakerId = `speaker_${this._nextSpeakerId++}`;

    return {
      trackingId,
      speakerId,
      speaker: {
        id: speakerId,
        label: `Speaker ${letter}`,
        color: SPEAKER_COLORS[index % SPEAKER_COLORS.length],
        thumbnailUri: null,
        embedding: null,
      },
      mouthOpennessHistory: [],
      lipSyncScore: 0,
      lastSeenMs: Date.now(),
    };
  }

  /**
   * Extract landmarks from MLKit face result into our normalized format.
   */
  private _extractLandmarks(face: MLKitFace): FaceLandmarks | null {
    const lm = face.landmarks;
    if (!lm) return null;

    // MLKit provides landmarks as { x, y } in frame coordinates
    // Normalize to 0-1 range using face bounds
    const b = face.bounds;
    const norm = (point: { x: number; y: number }) => ({
      x: b.width > 0 ? (point.x - b.x) / b.width : 0,
      y: b.height > 0 ? (point.y - b.y) / b.height : 0,
    });

    return {
      leftEye: lm.LEFT_EYE ? norm(lm.LEFT_EYE) : { x: 0.3, y: 0.35 },
      rightEye: lm.RIGHT_EYE ? norm(lm.RIGHT_EYE) : { x: 0.7, y: 0.35 },
      nose: lm.NOSE_BASE ? norm(lm.NOSE_BASE) : { x: 0.5, y: 0.55 },
      mouthTop: lm.MOUTH_TOP ? norm(lm.MOUTH_TOP) : { x: 0.5, y: 0.7 },
      mouthBottom: lm.MOUTH_BOTTOM ? norm(lm.MOUTH_BOTTOM) : { x: 0.5, y: 0.8 },
    };
  }

  /**
   * Compute mouth openness from landmarks.
   * Returns 0 (closed) to 1 (wide open).
   */
  private _computeMouthOpenness(
    mouthTop: { x: number; y: number },
    mouthBottom: { x: number; y: number },
  ): number {
    const dy = Math.abs(mouthBottom.y - mouthTop.y);
    return Math.min(1, dy * 6);
  }

  /**
   * Compute lip-sync correlation score.
   * High mouth movement variance during audio activity = likely speaking.
   */
  private _computeLipSyncScore(tracked: TrackedFace): number {
    const history = tracked.mouthOpennessHistory;
    if (history.length < 3) return 0;

    // Compute variance of mouth openness
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length;

    // Scale: variance > 0.01 with audio = high confidence
    return Math.min(1, variance * 50);
  }

  /**
   * Remove faces not seen for > 3 seconds.
   */
  private _cleanupStaleFaces(): void {
    const now = Date.now();
    for (const [trackingId, tracked] of this._trackedFaces) {
      if (now - tracked.lastSeenMs > 3000) {
        console.log(`[SpeakerService] Face lost: ${tracked.speaker.label}`);
        this._trackedFaces.delete(trackingId);
      }
    }
  }
}

// ── MLKit Face Type (from react-native-vision-camera-face-detector) ─────────

interface MLKitFace {
  bounds: { x: number; y: number; width: number; height: number };
  trackingId?: number;
  smilingProbability?: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
  landmarks?: Record<string, { x: number; y: number }>;
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _instance: SpeakerService | null = null;

export function getSpeakerService(): SpeakerService {
  if (!_instance) _instance = new SpeakerService();
  return _instance;
}
