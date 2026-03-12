// ============================================================================
// Transcription Service — Audio capture → Whisper → transcript segments
// Phase 2: Full native integration via whisper.rn + react-native-audio-pcm-stream
//
// Pipeline:
//   audioCapture (16kHz PCM) → accumulate chunks → pcmToWav → whisperEngine.transcribe
//   → filterHallucinations → emit TranscriptSegment → UI
//
// The resampling step from WallSpace (48kHz → 16kHz) is eliminated because
// we capture at 16kHz natively on mobile. The silence detection, hallucination
// filtering, and chunk accumulation patterns are preserved from the original.
// ============================================================================

import * as FileSystem from 'expo-file-system';
import type {
  TranscriptionStatus,
  TranscriptionConfig,
  TranscriptSegment,
} from '../types';
import { DEFAULT_TRANSCRIPTION_CONFIG } from '../types/defaults';
import * as WhisperEngine from './whisperEngine';
import * as AudioCapture from './audioCapture';

type TranscriptCallback = (segment: TranscriptSegment) => void;
type StatusCallback = (status: TranscriptionStatus) => void;
type AmplitudeCallback = (rmsDb: number) => void;

let _nextSegmentId = 1;
function nextId(): string {
  return `seg_${_nextSegmentId++}`;
}

// ── Audio Processing Utils (ported from WallSpace) ──────────────────────────

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

  return trimmed.replace(/^>>?\s*/, '');
}

/** Convert Float32 PCM [-1, 1] to 16-bit WAV file.
 *  Ported from WallSpace whisperBridge.ts pcmToWav, adapted to write to filesystem. */
function pcmToWavBuffer(pcmFloat32: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = pcmFloat32.length;
  const bytesPerSample = 2;
  const numChannels = 1;
  const dataSize = numSamples * bytesPerSample;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  function writeStr(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeStr(0, 'RIFF');
  view.setUint32(4, headerSize + dataSize - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcmFloat32[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(headerSize + i * 2, Math.round(val), true);
  }

  return buffer;
}

/** Write WAV ArrayBuffer to a temporary file and return the path. */
async function writeWavToTempFile(wavBuffer: ArrayBuffer): Promise<string> {
  const tempDir = `${FileSystem.cacheDirectory}captioncast-audio/`;
  const dirInfo = await FileSystem.getInfoAsync(tempDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });
  }

  const filename = `chunk_${Date.now()}.wav`;
  const filePath = `${tempDir}${filename}`;

  // Convert ArrayBuffer to base64 for FileSystem API
  const uint8 = new Uint8Array(wavBuffer);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  const base64 = btoa(binary);

  await FileSystem.writeAsStringAsync(filePath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return filePath;
}

/** Clean up a temporary WAV file. */
async function cleanupWav(filePath: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(filePath, { idempotent: true });
  } catch { /* ignore */ }
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
  private _sampleRate = 16000;

  // Audio capture subscription
  private _audioCaptureUnsub: (() => void) | null = null;

  // Prevent concurrent transcriptions
  private _isTranscribing = false;

  // ── Public API ──────────────────────────────────────────────────────────

  get status(): TranscriptionStatus { return this._status; }
  get isActive(): boolean { return this._active; }
  get config(): TranscriptionConfig { return { ...this._config }; }

  configure(partial: Partial<TranscriptionConfig>): void {
    this._config = { ...this._config, ...partial };
  }

  /**
   * Start transcription with full native pipeline:
   * 1. Download model if needed
   * 2. Initialize Whisper context (with GPU)
   * 3. Start microphone audio capture at 16kHz
   * 4. Begin chunk accumulation → Whisper inference pipeline
   */
  async start(
    onModelDownloadProgress?: (percent: number) => void,
  ): Promise<void> {
    if (this._active) return;
    this._active = true;
    this._sessionStartMs = Date.now();

    this._setStatus('loading-model');

    try {
      const modelId = this._config.modelSize;

      // Step 1: Download model if not cached
      const isDownloaded = await WhisperEngine.isModelDownloaded(modelId);
      if (!isDownloaded) {
        console.log(`[CaptionCast] Downloading model ${modelId}...`);
        await WhisperEngine.downloadModel(modelId, (progress) => {
          onModelDownloadProgress?.(progress.percent);
        });
      }

      if (!this._active) return; // Cancelled during download

      // Step 2: Initialize Whisper context with GPU acceleration
      console.log(`[CaptionCast] Loading model ${modelId}...`);
      await WhisperEngine.loadModel(modelId);

      if (!this._active) return; // Cancelled during model load

      // Step 3: Initialize audio capture at 16kHz (Whisper's native rate)
      await AudioCapture.initAudioCapture();

      // Step 4: Register PCM data handler
      this._audioCaptureUnsub = AudioCapture.onPCMData(
        (samples, sampleRate) => {
          this._feedPCM(samples, sampleRate);
        },
      );

      // Step 5: Start microphone capture
      await AudioCapture.startCapture();

      // Step 6: Start chunk flush timer
      this._startChunkTimer();

      this._setStatus('active');
      console.log('[CaptionCast] Transcription active (native Whisper + mic capture)');

    } catch (err) {
      console.error('[CaptionCast] Failed to start transcription:', err);
      this._setStatus('error');
      this._active = false;
      this._cleanup();
      throw err;
    }
  }

  /** Stop transcription and release all resources. */
  stop(): void {
    this._active = false;
    this._cleanup();
    this._setStatus('idle');
    console.log('[CaptionCast] Transcription stopped');
  }

  /** Pause audio capture (model stays loaded for fast resume). */
  pause(): void {
    AudioCapture.stopCapture();
    this._stopChunkTimer();
    if (this._status === 'active') this._setStatus('paused');
  }

  /** Resume from pause (model already loaded). */
  async resume(): Promise<void> {
    if (this._status !== 'paused') return;
    await AudioCapture.startCapture();
    this._startChunkTimer();
    this._setStatus('active');
  }

  /** Register callback for new transcript segments. */
  onTranscript(cb: TranscriptCallback): () => void {
    this._transcriptCallbacks.push(cb);
    return () => { this._transcriptCallbacks = this._transcriptCallbacks.filter(c => c !== cb); };
  }

  /** Register callback for status changes. */
  onStatusChange(cb: StatusCallback): () => void {
    this._statusCallbacks.push(cb);
    return () => { this._statusCallbacks = this._statusCallbacks.filter(c => c !== cb); };
  }

  /** Register callback for real-time amplitude (for vibration manager). */
  onAmplitude(cb: AmplitudeCallback): () => void {
    this._amplitudeCallbacks.push(cb);
    return () => { this._amplitudeCallbacks = this._amplitudeCallbacks.filter(c => c !== cb); };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private _setStatus(status: TranscriptionStatus): void {
    this._status = status;
    for (const cb of this._statusCallbacks) cb(status);
  }

  /**
   * Receive PCM samples from audio capture.
   * Accumulates into buffer for chunk-based Whisper inference.
   */
  private _feedPCM(samples: Float32Array, sampleRate: number): void {
    if (!this._active) return;
    this._sampleRate = sampleRate;
    this._pcmBuffer.push(new Float32Array(samples));
    this._pcmSampleCount += samples.length;

    // Compute amplitude for vibration service
    const rmsDb = computeRmsDb(samples);
    for (const cb of this._amplitudeCallbacks) cb(rmsDb);
  }

  private _startChunkTimer(): void {
    this._stopChunkTimer();
    this._pcmBuffer = [];
    this._pcmSampleCount = 0;

    const chunkMs = this._config.chunkDurationSec * 1000;
    this._chunkTimer = setInterval(() => {
      this._flushToWhisper();
    }, chunkMs);
  }

  private _stopChunkTimer(): void {
    if (this._chunkTimer) {
      clearInterval(this._chunkTimer);
      this._chunkTimer = null;
    }
    this._pcmBuffer = [];
    this._pcmSampleCount = 0;
  }

  /**
   * Concatenate buffered PCM, write WAV, send to Whisper for inference.
   * Ported from WallSpace _flushPCMToWhisper with real native Whisper calls.
   */
  private async _flushToWhisper(): Promise<void> {
    if (!this._active || this._pcmSampleCount < 100 || this._isTranscribing) return;

    const srcRate = this._sampleRate;
    const buffers = this._pcmBuffer;
    const totalSamples = this._pcmSampleCount;

    // Reset buffer immediately (don't lose incoming samples during transcription)
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
      return; // Skip silent chunks — saves Whisper CPU + battery
    }

    // Timestamp this segment relative to session start
    const nowMs = Date.now();
    const startMs = Math.max(0, nowMs - (this._config.chunkDurationSec * 1000) - this._sessionStartMs);
    const endMs = Math.max(0, nowMs - this._sessionStartMs);

    this._isTranscribing = true;
    let wavPath: string | null = null;

    try {
      // Convert PCM to WAV and write to temp file
      // Audio is already at 16kHz from native capture — no resampling needed
      const wavBuffer = pcmToWavBuffer(combined, srcRate);
      wavPath = await writeWavToTempFile(wavBuffer);

      console.log(
        `[CaptionCast] Transcribing ${(totalSamples / srcRate).toFixed(1)}s chunk ` +
        `(${totalSamples} samples @ ${srcRate}Hz, level: ${rmsDb.toFixed(1)}dB)`,
      );

      // Run Whisper inference via native module
      const result = await WhisperEngine.transcribeFile(
        wavPath,
        this._config.language,
      );

      // Filter hallucinations (same patterns as WallSpace whisperBridge)
      const cleanText = filterHallucinations(result.text);

      if (cleanText && this._active) {
        const segment: TranscriptSegment = {
          id: nextId(),
          text: cleanText,
          startMs,
          endMs,
          speakerId: null, // Speaker ID will be set by speakerService if camera active
          isFinal: true,
          confidence: 1.0,
        };

        console.log(`[CaptionCast] Transcript: "${cleanText}"`);

        for (const cb of this._transcriptCallbacks) cb(segment);
      }
    } catch (err) {
      console.error('[CaptionCast] Transcription error:', err);
    } finally {
      this._isTranscribing = false;
      if (wavPath) await cleanupWav(wavPath);
    }
  }

  private _cleanup(): void {
    this._stopChunkTimer();

    // Stop audio capture
    AudioCapture.stopCapture();
    if (this._audioCaptureUnsub) {
      this._audioCaptureUnsub();
      this._audioCaptureUnsub = null;
    }

    // Release Whisper context
    WhisperEngine.releaseContext();

    this._transcriptCallbacks = [];
    this._statusCallbacks = [];
    this._amplitudeCallbacks = [];
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _instance: TranscriptionService | null = null;

export function getTranscriptionService(): TranscriptionService {
  if (!_instance) _instance = new TranscriptionService();
  return _instance;
}
