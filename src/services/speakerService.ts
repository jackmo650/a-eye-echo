// ============================================================================
// Speaker Identification Service — Camera-based face detection + lip-sync
//
// Phase 2 implementation plan:
//   - iOS: Apple Vision (VNDetectFaceRectangles + VNGenerateFaceEmbeddings)
//   - Android: ML Kit Face Detection + FaceNet (TFLite)
//
// Architecture:
//   Camera Feed → Face Detection → Face Embeddings → Clustering
//                                → Lip Movement → Correlate with Audio
//                                                → Speaker Attribution
//
// All processing on-device. No photos uploaded. Face data stays local.
// ============================================================================

import type { Speaker, FaceDetection, CameraPosition } from '../types';

export type SpeakerDetectionCallback = (
  speakerId: string,
  face: FaceDetection,
) => void;

export class SpeakerService {
  private _active = false;
  private _cameraPosition: CameraPosition = 'front';
  private _knownSpeakers: Map<string, Speaker> = new Map();
  private _callbacks: SpeakerDetectionCallback[] = [];
  private _nextSpeakerId = 1;

  // Lip-sync correlation state
  private _lastMouthOpenness: Map<string, number[]> = new Map();
  private _audioAmplitudeHistory: number[] = [];

  get isActive(): boolean { return this._active; }

  /**
   * Start camera-based speaker detection.
   * TODO: Phase 2 — integrate with native face detection module
   */
  async start(cameraPosition: CameraPosition = 'front'): Promise<void> {
    this._cameraPosition = cameraPosition;
    this._active = true;
    console.log(`[SpeakerService] Started with ${cameraPosition} camera`);

    // TODO: Phase 2
    // - Request camera permission
    // - Start face detection frame processing
    // - Initialize face embedding model
  }

  stop(): void {
    this._active = false;
    this._lastMouthOpenness.clear();
    this._audioAmplitudeHistory = [];
    console.log('[SpeakerService] Stopped');
  }

  /**
   * Process a camera frame for face detection.
   * Called by the camera capture hook at ~15fps.
   *
   * TODO: Phase 2 — implement with native face detection
   */
  processFrame(_frameData: unknown): FaceDetection[] {
    if (!this._active) return [];

    // Placeholder — Phase 2 will run face detection here
    // 1. Detect faces → bounding boxes + landmarks
    // 2. Extract face embeddings (128-dim vectors)
    // 3. Match embeddings to known speakers (cosine similarity > 0.7)
    // 4. Detect lip movement (mouth landmark delta)
    // 5. Correlate lip movement with audio amplitude
    // 6. Emit speaker identification events

    return [];
  }

  /**
   * Feed audio amplitude for lip-sync correlation.
   * Cross-references mouth movement timing with audio peaks
   * to determine who is actually speaking.
   */
  feedAudioAmplitude(rmsDb: number): void {
    this._audioAmplitudeHistory.push(rmsDb);
    // Keep last 30 samples (~2 seconds at 15fps)
    if (this._audioAmplitudeHistory.length > 30) {
      this._audioAmplitudeHistory.shift();
    }
  }

  /**
   * Register a known speaker for re-identification across frames.
   */
  registerSpeaker(speaker: Speaker): void {
    this._knownSpeakers.set(speaker.id, speaker);
  }

  /**
   * Rename a speaker (user taps on avatar to assign real name).
   */
  renameSpeaker(speakerId: string, newLabel: string): void {
    const speaker = this._knownSpeakers.get(speakerId);
    if (speaker) {
      speaker.label = newLabel;
    }
  }

  /**
   * Get all currently tracked speakers.
   */
  getSpeakers(): Speaker[] {
    return Array.from(this._knownSpeakers.values());
  }

  onSpeakerDetected(cb: SpeakerDetectionCallback): () => void {
    this._callbacks.push(cb);
    return () => { this._callbacks = this._callbacks.filter(c => c !== cb); };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Compute cosine similarity between two face embeddings.
   * Used to match detected faces to known speakers.
   */
  private _cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  /**
   * Detect lip movement from mouth landmarks.
   * Returns mouth openness ratio (0 = closed, 1 = wide open).
   */
  private _computeMouthOpenness(
    mouthTop: { x: number; y: number },
    mouthBottom: { x: number; y: number },
  ): number {
    const dy = Math.abs(mouthBottom.y - mouthTop.y);
    // Normalized by approximate face height (mouth is ~1/6 of face height)
    return Math.min(1, dy * 6);
  }

  /**
   * Correlate mouth movement with audio amplitude.
   * A face with changing mouth openness during high audio amplitude
   * is likely the active speaker.
   */
  private _correlateLipSync(faceId: string, mouthOpenness: number): number {
    const history = this._lastMouthOpenness.get(faceId) || [];
    history.push(mouthOpenness);
    if (history.length > 15) history.shift(); // ~1 second window
    this._lastMouthOpenness.set(faceId, history);

    if (history.length < 3) return 0;

    // Compute mouth movement variance
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length;

    // Compute audio activity
    const recentAudio = this._audioAmplitudeHistory.slice(-15);
    const audioActive = recentAudio.some(db => db > -40);

    // High mouth variance + audio activity = likely speaking
    return audioActive ? variance * 10 : 0;
  }

  private _generateSpeakerId(): string {
    return `speaker_${this._nextSpeakerId++}`;
  }
}

// Singleton
let _instance: SpeakerService | null = null;

export function getSpeakerService(): SpeakerService {
  if (!_instance) _instance = new SpeakerService();
  return _instance;
}
