// ============================================================================
// Transcription Service — Audio capture → Whisper → transcript segments
// Ported from WallSpace.Studio src/renderer/services/transcriptionService.ts
//
// Mobile adaptation:
//   - Electron IPC → WhisperModule native bridge (Phase 2)
//   - AudioWorklet → expo-av Recording API with PCM extraction
//   - Same resampling, silence detection, chunk accumulation logic
// ============================================================================

import type {
  TranscriptionStatus,
  TranscriptionConfig,
  TranscriptSegment,
  AudioSource,
} from '../types';
import { DEFAULT_TRANSCRIPTION_CONFIG } from '../types/defaults';

type TranscriptCallback = (segment: TranscriptSegment) => void;
type StatusCallback = (status: TranscriptionStatus) => void;
type AmplitudeCallback = (rmsDb: number) => void;

let _nextSegmentId = 1;
function nextId(): string {
  return `seg_${_nextSegmentId++}`;
}

/** Resample Float32 PCM from srcRate to dstRate using linear interpolation.
 *  Ported directly from WallSpace transcriptionService.ts */
export function resampleLinear(
  input: Float32Array,
  srcRate: number,
  dstRate: number,
): Float32Array {
  if (srcRate === dstRate) return input;
  const ratio = srcRate / dstRate;
  const outputLen = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLen);
  for (let i = 0; i < outputLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = srcIdx - lo;
    output[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return output;
}

/** Compute RMS level in dB from Float32 PCM buffer.
 *  Ported from WallSpace _flushPCMToWhisper silence detection. */
export function computeRmsDb(samples: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/** Filter Whisper hallucinations on silence.
 *  Ported from WallSpace whisperBridge.ts HALLUCINATION_PATTERNS + NOISE_PATTERNS. */
export function filterHallucinations(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const NOISE_PATTERNS = [
    /^\[.*?\]$/,          // [BLANK_AUDIO], [MUSIC], etc.
    /^\(.*?\)$/,          // (music), (applause), etc.
    /^>>?\s*/,            // >> speaker indicators
  ];

  const HALLUCINATION_PATTERNS = [
    /^\(.*\)$/,
    /^you$/i,
    /^\.+$/,
    /^thank you\.?$/i,
    /^thanks for watching\.?$/i,
    /^please subscribe\.?$/i,
  ];

  if (NOISE_PATTERNS.some(p => p.test(trimmed))) return null;
  if (HALLUCINATION_PATTERNS.some(p => p.test(trimmed))) return null;

  // Strip >> speaker prefix markers
  return trimmed.replace(/^>>?\s*/, '');
}

/** Convert Float32 PCM to 16-bit WAV ArrayBuffer.
 *  Ported from WallSpace whisperBridge.ts pcmToWav. */
export function pcmToWavBuffer(
  pcmFloat32: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const numSamples = pcmFloat32.length;
  const bytesPerSample = 2;
  const numChannels = 1;
  const dataSize = numSamples * bytesPerSample;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, headerSize + dataSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Convert Float32 [-1, 1] to Int16
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcmFloat32[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(headerSize + i * 2, Math.round(val), true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ── TranscriptionService ────────────────────────────────────────────────────

export class TranscriptionService {
  private _config: TranscriptionConfig = { ...DEFAULT_TRANSCRIPTION_CONFIG };
  private _status: TranscriptionStatus = 'idle';
  private _active = false;
  private _sessionStartMs = 0;

  // Callbacks
  private _transcriptCallbacks: TranscriptCallback[] = [];
  private _statusCallbacks: StatusCallback[] = [];
  private _amplitudeCallbacks: AmplitudeCallback[] = [];

  // PCM accumulation buffer (same pattern as WallSpace)
  private _pcmBuffer: Float32Array[] = [];
  private _pcmSampleCount = 0;
  private _chunkTimer: ReturnType<typeof setInterval> | null = null;
  private _sampleRate = 44100;

  // ── Public API ──────────────────────────────────────────────────────────

  get status(): TranscriptionStatus { return this._status; }
  get isActive(): boolean { return this._active; }
  get config(): TranscriptionConfig { return { ...this._config }; }

  configure(partial: Partial<TranscriptionConfig>): void {
    this._config = { ...this._config, ...partial };
  }

  /**
   * Start transcription. On mobile, this will:
   * 1. Request mic permission
   * 2. Load Whisper model via native bridge
   * 3. Start audio capture
   * 4. Begin chunk accumulation → Whisper pipeline
   *
   * TODO: Phase 2 — integrate with WhisperModule native bridge
   * Currently sets up the pipeline structure with placeholder inference.
   */
  async start(): Promise<void> {
    if (this._active) return;
    this._active = true;
    this._sessionStartMs = Date.now();

    this._setStatus('loading-model');

    // TODO: Phase 2 — Load Whisper model via native module
    // const result = await WhisperModule.loadModel(this._config.modelSize);
    console.log(`[CaptionCast] Loading model: ${this._config.modelSize}`);

    // Simulate model load for scaffolding
    await new Promise(resolve => setTimeout(resolve, 100));

    if (!this._active) return;

    // Start audio capture and chunk timer
    this._startCapture();
    this._setStatus('active');
    console.log('[CaptionCast] Transcription active');
  }

  stop(): void {
    this._active = false;
    this._stopCapture();

    // TODO: Phase 2 — Unload model
    // WhisperModule.unloadModel();

    this._transcriptCallbacks = [];
    this._statusCallbacks = [];
    this._amplitudeCallbacks = [];
    this._setStatus('idle');
    console.log('[CaptionCast] Transcription stopped');
  }

  pause(): void {
    this._stopCapture();
    if (this._status === 'active') this._setStatus('paused');
  }

  resume(): void {
    if (this._status !== 'paused') return;
    this._startCapture();
    this._setStatus('active');
  }

  /** Register callback for new transcript segments */
  onTranscript(cb: TranscriptCallback): () => void {
    this._transcriptCallbacks.push(cb);
    return () => { this._transcriptCallbacks = this._transcriptCallbacks.filter(c => c !== cb); };
  }

  /** Register callback for status changes */
  onStatusChange(cb: StatusCallback): () => void {
    this._statusCallbacks.push(cb);
    return () => { this._statusCallbacks = this._statusCallbacks.filter(c => c !== cb); };
  }

  /** Register callback for real-time amplitude (for vibration manager) */
  onAmplitude(cb: AmplitudeCallback): () => void {
    this._amplitudeCallbacks.push(cb);
    return () => { this._amplitudeCallbacks = this._amplitudeCallbacks.filter(c => c !== cb); };
  }

  /**
   * Feed PCM samples from audio capture.
   * Called by the audio capture hook/module when new samples are available.
   */
  feedPCM(samples: Float32Array, sampleRate: number): void {
    if (!this._active) return;
    this._sampleRate = sampleRate;
    this._pcmBuffer.push(new Float32Array(samples));
    this._pcmSampleCount += samples.length;

    // Compute amplitude for vibration
    const rmsDb = computeRmsDb(samples);
    for (const cb of this._amplitudeCallbacks) cb(rmsDb);
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private _setStatus(status: TranscriptionStatus): void {
    this._status = status;
    for (const cb of this._statusCallbacks) cb(status);
  }

  private _startCapture(): void {
    this._stopCapture();
    this._pcmBuffer = [];
    this._pcmSampleCount = 0;

    // Flush accumulated PCM to Whisper at chunk intervals
    // Same pattern as WallSpace transcriptionService.ts
    const chunkMs = this._config.chunkDurationSec * 1000;
    this._chunkTimer = setInterval(() => {
      this._flushToWhisper();
    }, chunkMs);
  }

  private _stopCapture(): void {
    if (this._chunkTimer) {
      clearInterval(this._chunkTimer);
      this._chunkTimer = null;
    }
    this._pcmBuffer = [];
    this._pcmSampleCount = 0;
  }

  /**
   * Concatenate buffered PCM, resample to 16kHz, send to Whisper.
   * Ported from WallSpace _flushPCMToWhisper with segment timestamp tracking.
   */
  private _flushToWhisper(): void {
    if (!this._active || this._pcmSampleCount < 100) return;

    const srcRate = this._sampleRate;
    const buffers = this._pcmBuffer;
    const totalSamples = this._pcmSampleCount;

    // Reset buffer
    this._pcmBuffer = [];
    this._pcmSampleCount = 0;

    // Concatenate all chunks
    const combined = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of buffers) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // RMS silence detection (ported from WallSpace)
    const rmsDb = computeRmsDb(combined);
    if (rmsDb < -60) {
      console.log(`[CaptionCast] Skipping silent chunk (${rmsDb.toFixed(1)}dB)`);
      return;
    }

    // Resample to 16kHz for Whisper
    const pcm16k = resampleLinear(combined, srcRate, 16000);

    // Timestamp this segment relative to session start
    const nowMs = Date.now();
    const startMs = nowMs - (this._config.chunkDurationSec * 1000) - this._sessionStartMs;
    const endMs = nowMs - this._sessionStartMs;

    // TODO: Phase 2 — Send to native Whisper module
    // const wavBuffer = pcmToWavBuffer(pcm16k, 16000);
    // const result = await WhisperModule.transcribeChunk(wavBuffer);
    // const text = filterHallucinations(result.text);

    console.log(
      `[CaptionCast] Would send ${(pcm16k.length / 16000).toFixed(1)}s chunk ` +
      `(${totalSamples} samples @ ${srcRate}Hz → ${pcm16k.length} @ 16kHz, ` +
      `level: ${rmsDb.toFixed(1)}dB)`,
    );

    // Placeholder: emit a segment so the UI pipeline works end-to-end
    // Remove this once WhisperModule is integrated
    const placeholderText = `[Awaiting Whisper integration — ${(pcm16k.length / 16000).toFixed(1)}s audio captured]`;
    const segment: TranscriptSegment = {
      id: nextId(),
      text: placeholderText,
      startMs: Math.max(0, startMs),
      endMs: Math.max(0, endMs),
      speakerId: null,
      isFinal: true,
      confidence: 0,
    };

    for (const cb of this._transcriptCallbacks) cb(segment);
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _instance: TranscriptionService | null = null;

export function getTranscriptionService(): TranscriptionService {
  if (!_instance) _instance = new TranscriptionService();
  return _instance;
}
