// ============================================================================
// Transcription Service — Streaming via expo-speech-recognition
//
// Uses Apple's SFSpeechRecognizer for continuous streaming transcription.
// No model downloads, no WAV files, no setTimeout chains.
// AudioCapture kept for amplitude metering only.
// ============================================================================

import type {
  TranscriptionStatus,
  TranscriptionConfig,
  TranslationConfig,
  TranscriptSegment,
  WhisperLanguage,
} from '../types';
import { DEFAULT_TRANSCRIPTION_CONFIG, DEFAULT_TRANSLATION_CONFIG } from '../types/defaults';
import { SpeechRecognitionEngine, getSpeechRecognitionEngine } from './speechRecognitionEngine';
import * as AudioCapture from './audioCapture';
import { getTranslationService } from './translationService';

type TranscriptCallback = (segment: TranscriptSegment) => void;
type StatusCallback = (status: TranscriptionStatus) => void;
type AmplitudeCallback = (rmsDb: number) => void;
type PartialCallback = (text: string) => void;

let _nextSegmentId = 1;
function nextId(): string {
  return `seg_${_nextSegmentId++}`;
}

// ── Utils (kept for reuse) ──────────────────────────────────────────────────

export function computeRmsDb(samples: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

export function filterHallucinations(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const GARBAGE_WORDS = new Set([
    'you', 'the', 'i', 'a', 'is', 'it', 'so', 'and', 'but',
    'oh', 'uh', 'um', 'ah', 'huh', 'bye', 'ok', 'okay',
  ]);

  const lower = trimmed.toLowerCase().replace(/[.,!?]+$/, '');
  if (GARBAGE_WORDS.has(lower)) return null;

  if (/^\[.*?\]$/.test(trimmed)) return null;   // [BLANK_AUDIO]
  if (/^\(.*?\)$/.test(trimmed)) return null;   // (music)
  if (/^\.+$/.test(trimmed)) return null;        // ...
  if (/^thanks for watching\.?$/i.test(trimmed)) return null;
  if (/^please subscribe\.?$/i.test(trimmed)) return null;

  return trimmed.replace(/^>>?\s*/, '');
}

// ── TranscriptionService ────────────────────────────────────────────────────

export class TranscriptionService {
  private _config: TranscriptionConfig = { ...DEFAULT_TRANSCRIPTION_CONFIG };
  private _translationConfig: TranslationConfig = { ...DEFAULT_TRANSLATION_CONFIG };
  private _status: TranscriptionStatus = 'idle';
  private _active = false;
  private _sessionStartMs = 0;

  private _transcriptCallbacks: TranscriptCallback[] = [];
  private _statusCallbacks: StatusCallback[] = [];
  private _amplitudeCallbacks: AmplitudeCallback[] = [];
  private _partialCallbacks: PartialCallback[] = [];

  private _audioCaptureUnsub: (() => void) | null = null;
  private _engine: SpeechRecognitionEngine | null = null;

  // Track current partial for live caption display
  private _currentPartialText = '';
  // Silence timer: when partial text stops changing, finalize as segment
  private _silenceTimer: ReturnType<typeof setTimeout> | null = null;
  // Last partial text received (for silence detection)
  private _lastPartialText = '';
  // Whether we're in a restart cycle (suppress stale results)
  private _pendingRestart = false;

  // Cleanup functions for engine event listeners
  private _engineUnsubs: Array<() => void> = [];

  get status(): TranscriptionStatus { return this._status; }
  get isActive(): boolean { return this._active; }
  get config(): TranscriptionConfig { return { ...this._config }; }

  configure(partial: Partial<TranscriptionConfig>): void {
    this._config = { ...this._config, ...partial };
  }

  configureTranslation(partial: Partial<TranslationConfig>): void {
    this._translationConfig = { ...this._translationConfig, ...partial };
  }

  async start(_onModelDownloadProgress?: (percent: number) => void): Promise<void> {
    if (this._active) return;
    this._active = true;
    this._sessionStartMs = Date.now();
    this._setStatus('loading-model');

    try {
      // SFSpeechRecognizer doesn't support auto-detect — always use explicit language
      const language: WhisperLanguage = this._config.language || 'en';

      // Check availability
      if (!SpeechRecognitionEngine.isAvailable()) {
        throw new Error('Speech recognition is not available on this device');
      }

      console.log(`[A.EYE.ECHO] Starting speech recognition, language: ${language}`);

      // Start audio capture for amplitude metering only
      try {
        await AudioCapture.initAudioCapture();
        this._audioCaptureUnsub = AudioCapture.onPCMData((samples, _sr) => {
          if (!this._active) return;
          const rmsDb = computeRmsDb(samples);
          for (const cb of this._amplitudeCallbacks) cb(rmsDb);
        });
        await AudioCapture.startCapture();
      } catch (audioErr) {
        console.warn('[A.EYE.ECHO] Audio capture for amplitude failed (non-fatal):', audioErr);
        // Non-fatal: amplitude bars won't work but transcription will
      }

      // Start speech recognition engine
      this._engine = getSpeechRecognitionEngine();
      this._setupEngineListeners();
      await this._engine.start(language);

      if (!this._active) return;
      this._setStatus('active');
      console.log('[A.EYE.ECHO] Active — streaming speech recognition');
    } catch (err) {
      console.error('[A.EYE.ECHO] Start failed:', err);
      this._setStatus('error');
      this._active = false;
      this._cleanup();
      throw err;
    }
  }

  async stop(): Promise<void> {
    this._active = false;
    this._cleanup();
    this._setStatus('idle');
  }

  pause(): void {
    this._engine?.stop();
    AudioCapture.stopCapture();
    if (this._status === 'active') this._setStatus('paused');
  }

  async resume(): Promise<void> {
    if (this._status !== 'paused') return;
    const language: WhisperLanguage = this._config.language || 'en';

    try {
      await AudioCapture.startCapture();
    } catch {
      // Non-fatal
    }

    if (this._engine) {
      await this._engine.start(language);
    }
    this._setStatus('active');
  }

  onTranscript(cb: TranscriptCallback): () => void {
    this._transcriptCallbacks.push(cb);
    return () => { this._transcriptCallbacks = this._transcriptCallbacks.filter(c => c !== cb); };
  }

  onSegmentUpdate(_cb: any): () => void { return () => {}; }

  onStatusChange(cb: StatusCallback): () => void {
    this._statusCallbacks.push(cb);
    return () => { this._statusCallbacks = this._statusCallbacks.filter(c => c !== cb); };
  }

  onAmplitude(cb: AmplitudeCallback): () => void {
    this._amplitudeCallbacks.push(cb);
    return () => { this._amplitudeCallbacks = this._amplitudeCallbacks.filter(c => c !== cb); };
  }

  onPartialResult(cb: PartialCallback): () => void {
    this._partialCallbacks.push(cb);
    return () => { this._partialCallbacks = this._partialCallbacks.filter(c => c !== cb); };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private _setStatus(status: TranscriptionStatus): void {
    this._status = status;
    for (const cb of this._statusCallbacks) cb(status);
  }

  private _setupEngineListeners(): void {
    if (!this._engine) return;

    // Clean up old listeners
    for (const unsub of this._engineUnsubs) unsub();
    this._engineUnsubs = [];

    // Result handler — silence-based segmentation with session restart.
    // When you pause for 1.5s, we emit the full text as a segment then
    // restart the recognition session for a clean slate.
    const SILENCE_SEGMENT_MS = 1500;

    this._engineUnsubs.push(
      this._engine.onResult((text, isFinal, confidence) => {
        if (!this._active || this._pendingRestart) return;

        const trimmed = text.trim();
        if (!trimmed) return;

        // Update live caption with the full current text
        this._currentPartialText = trimmed;
        for (const cb of this._partialCallbacks) cb(trimmed);

        // Reset silence timer on every new partial
        if (this._silenceTimer) {
          clearTimeout(this._silenceTimer);
          this._silenceTimer = null;
        }

        if (!isFinal) {
          // Schedule: if text doesn't change for 1.5s, finalize and restart
          this._lastPartialText = trimmed;
          this._silenceTimer = setTimeout(() => {
            if (!this._active) return;
            this._finalizeAndRestart(trimmed, confidence);
          }, SILENCE_SEGMENT_MS);
          return;
        }

        // isFinal — session ending (55s restart or stop)
        // Emit whatever text we have
        this._emitSegment(trimmed, confidence);
      }),
    );

    // Session restart handler — clear state for new session
    this._engineUnsubs.push(
      this._engine.onSessionRestart(() => {
        console.log('[A.EYE.ECHO] Session restarted');
        this._lastPartialText = '';
        this._pendingRestart = false;
        if (this._silenceTimer) {
          clearTimeout(this._silenceTimer);
          this._silenceTimer = null;
        }
      }),
    );

    // Error handler
    this._engineUnsubs.push(
      this._engine.onError((error, message) => {
        console.error(`[A.EYE.ECHO] Recognition error: ${error} — ${message}`);
        // The engine auto-restarts on 'end' event, so most errors recover automatically
      }),
    );
  }

  /** Emit text as a segment then restart the recognition session for a clean slate. */
  private _finalizeAndRestart(text: string, confidence: number): void {
    this._emitSegment(text, confidence);

    // Restart session so the next utterance starts fresh (no accumulated text)
    this._pendingRestart = true;
    this._currentPartialText = '';
    for (const cb of this._partialCallbacks) cb('');

    // Use the engine's internal restart which handles stop→start cleanly
    if (this._engine) {
      console.log('[A.EYE.ECHO] Restarting session for next segment');
      // Stop triggers end event → auto-restart in engine
      try {
        const { ExpoSpeechRecognitionModule } = require('expo-speech-recognition');
        ExpoSpeechRecognitionModule.stop();
      } catch {
        this._pendingRestart = false;
      }
    }
  }

  /** Create and emit a TranscriptSegment from recognized text. */
  private _emitSegment(text: string, confidence: number): void {
    const cleanText = filterHallucinations(text);
    if (!cleanText) {
      console.log(`[A.EYE.ECHO] Filtered: "${text}"`);
      return;
    }

    const nowMs = Date.now();
    const endMs = Math.max(0, nowMs - this._sessionStartMs);
    const wordCount = cleanText.split(/\s+/).length;
    const estimatedDurationMs = wordCount * 150;
    const startMs = Math.max(0, endMs - estimatedDurationMs);

    const segment: TranscriptSegment = {
      id: nextId(),
      text: cleanText,
      source: 'speech',
      startMs,
      endMs,
      speakerId: null,
      isFinal: true,
      confidence: confidence >= 0 ? confidence : 0.9,
    };

    if (this._translationConfig.enabled) {
      // Fire-and-forget but with guaranteed segment emission
      this._translateAndEmit(segment, cleanText).catch(() => {
        // Ensure segment is emitted even if translation throws unexpectedly
        console.log(`[A.EYE.ECHO] → "${cleanText}" (translation failed)`);
        for (const cb of this._transcriptCallbacks) cb(segment);
      });
    } else {
      console.log(`[A.EYE.ECHO] → "${cleanText}"`);
      for (const cb of this._transcriptCallbacks) cb(segment);
    }
  }

  private async _translateAndEmit(segment: TranscriptSegment, cleanText: string): Promise<void> {
    try {
      const ts = getTranslationService();
      const src = (this._config.language || 'en') as string;
      const tgt = this._translationConfig.targetLanguage;
      if (src !== tgt) {
        segment.translatedText = await ts.translate(cleanText, src, tgt);
      }
    } catch {
      // Translation failed — still emit the segment
    }

    console.log(`[A.EYE.ECHO] → "${cleanText}"`);
    for (const cb of this._transcriptCallbacks) cb(segment);
  }

  private _cleanup(): void {
    // Stop speech recognition
    for (const unsub of this._engineUnsubs) unsub();
    this._engineUnsubs = [];
    this._engine?.stop();
    this._engine = null;

    // Stop audio capture
    AudioCapture.stopCapture();
    if (this._audioCaptureUnsub) {
      this._audioCaptureUnsub();
      this._audioCaptureUnsub = null;
    }

    this._currentPartialText = '';
    this._lastPartialText = '';
    this._pendingRestart = false;
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
    this._transcriptCallbacks = [];
    this._statusCallbacks = [];
    this._amplitudeCallbacks = [];
    this._partialCallbacks = [];
  }
}

let _instance: TranscriptionService | null = null;

export function getTranscriptionService(): TranscriptionService {
  if (!_instance) _instance = new TranscriptionService();
  return _instance;
}
