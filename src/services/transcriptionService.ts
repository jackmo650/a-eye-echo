// ============================================================================
// Transcription Service — Multi-source audio transcription
//
// All modes use expo-speech-recognition (SFSpeechRecognizer):
//   1. Microphone → streaming speech recognition
//   2. System Audio → capture → speech recognition (requires native module)
//   3. URL ingest → handled by urlIngestService (also uses speech recognition)
//
// AudioCapture kept for amplitude metering.
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
import {
  startSystemAudioCapture,
  stopSystemAudioCapture,
  onSystemAudioResult,
  onSystemAudioEnd,
} from './systemAudioCapture';

export type AudioSourceMode = 'microphone' | 'system-audio' | 'url';

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
  private _sourceMode: AudioSourceMode = 'microphone';
  private _systemAudioUnsubs: Array<() => void> = [];

  // Track current partial for live caption display
  private _currentPartialText = '';
  private _silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastPartialText = '';
  private _pendingRestart = false;
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

  async start(_onModelDownloadProgress?: (percent: number) => void, sourceMode: AudioSourceMode = 'microphone', forceSkipAmplitude = false): Promise<void> {
    if (this._active) return;
    this._active = true;
    this._sourceMode = sourceMode;
    this._sessionStartMs = Date.now();

    if (sourceMode === 'system-audio') {
      await this._startSystemAudioMode();
    } else {
      // 'microphone' and 'url' both use mic-based speech recognition
      // URL mode skips AudioCapture to avoid reconfiguring the audio session
      // which would freeze the WebView. Also skip in battery saver mode.
      await this._startMicMode(sourceMode === 'url' || forceSkipAmplitude);
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

    try {
      await AudioCapture.startCapture();
    } catch { /* Non-fatal */ }

    const language: WhisperLanguage = this._config.language || 'en';
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

  // ── Microphone Mode (SFSpeechRecognizer) ────────────────────────────────

  private async _startMicMode(skipAudioCapture = false): Promise<void> {
    this._setStatus('loading-model');

    try {
      const language: WhisperLanguage = this._config.language || 'en';

      if (!SpeechRecognitionEngine.isAvailable()) {
        throw new Error('Speech recognition is not available on this device');
      }

      console.log(`[A.EYE.ECHO] Starting speech recognition, language: ${language}, skipAudioCapture: ${skipAudioCapture}`);

      // Start audio capture for amplitude metering only (skip in URL mode to avoid freezing WebView)
      if (!skipAudioCapture) {
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
        }
      }

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

  // ── Speech Recognition Engine Listeners ─────────────────────────────────

  private _setupEngineListeners(): void {
    if (!this._engine) return;

    for (const unsub of this._engineUnsubs) unsub();
    this._engineUnsubs = [];

    const SILENCE_SEGMENT_MS = 1500;
    const isUrlMode = this._sourceMode === 'url';

    this._engineUnsubs.push(
      this._engine.onResult((text, isFinal, confidence) => {
        if (!this._active || this._pendingRestart) return;

        const trimmed = text.trim();
        if (!trimmed) return;

        this._currentPartialText = trimmed;
        for (const cb of this._partialCallbacks) cb(trimmed);

        if (this._silenceTimer) {
          clearTimeout(this._silenceTimer);
          this._silenceTimer = null;
        }

        if (isUrlMode) {
          // URL mode: emit segments on final results but NEVER force a
          // session restart — that reconfigures the audio session and
          // pauses the WebView video. Let the session run until iOS
          // naturally ends it at ~60s.
          if (isFinal) {
            this._emitSegment(trimmed, confidence);
          }
          return;
        }

        if (!isFinal) {
          this._lastPartialText = trimmed;
          this._silenceTimer = setTimeout(() => {
            if (!this._active) return;
            this._finalizeAndRestart(trimmed, confidence);
          }, SILENCE_SEGMENT_MS);
          return;
        }

        this._emitSegment(trimmed, confidence);
      }),
    );

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

    this._engineUnsubs.push(
      this._engine.onError((error, message) => {
        console.error(`[A.EYE.ECHO] Recognition error: ${error} — ${message}`);
      }),
    );
  }

  private _finalizeAndRestart(text: string, confidence: number): void {
    this._emitSegment(text, confidence);

    this._pendingRestart = true;
    this._currentPartialText = '';
    for (const cb of this._partialCallbacks) cb('');

    if (this._engine) {
      console.log('[A.EYE.ECHO] Restarting session for next segment');
      try {
        const { ExpoSpeechRecognitionModule } = require('expo-speech-recognition');
        ExpoSpeechRecognitionModule.stop();
      } catch {
        this._pendingRestart = false;
      }
    }
  }

  // ── System Audio Mode ──────────────────────────────────────────────────

  private async _startSystemAudioMode(): Promise<void> {
    this._setStatus('loading-model');

    try {
      const language = this._config.language || 'en';
      console.log(`[A.EYE.ECHO] Starting system audio capture, language: ${language}`);

      // Register for text results from native module
      this._systemAudioUnsubs.push(
        onSystemAudioResult((text, isFinal, confidence) => {
          if (!this._active) return;

          const trimmed = text.trim();
          if (!trimmed) return;

          // Feed partials to live caption display
          this._currentPartialText = trimmed;
          for (const cb of this._partialCallbacks) cb(trimmed);

          if (isFinal) {
            this._emitSegment(trimmed, confidence);
          }
        }),
      );

      // Handle broadcast ending (user stopped from Control Center)
      this._systemAudioUnsubs.push(
        onSystemAudioEnd(() => {
          if (this._active) {
            console.log('[A.EYE.ECHO] System audio broadcast ended');
            this._active = false;
            this._cleanup();
            this._setStatus('idle');
          }
        }),
      );

      // Start native capture + recognition
      await startSystemAudioCapture(language);

      if (!this._active) return;
      this._setStatus('active');
      console.log('[A.EYE.ECHO] Active — system audio capture + recognition');
    } catch (err) {
      console.error('[A.EYE.ECHO] System audio start failed:', err);
      this._setStatus('error');
      this._active = false;
      this._cleanup();
      throw err;
    }
  }

  // ── Shared ──────────────────────────────────────────────────────────────

  private _setStatus(status: TranscriptionStatus): void {
    this._status = status;
    for (const cb of this._statusCallbacks) cb(status);
  }

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
      this._translateAndEmit(segment, cleanText).catch(() => {
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
    // Stop speech recognition (mic mode)
    for (const unsub of this._engineUnsubs) unsub();
    this._engineUnsubs = [];
    this._engine?.stop();
    this._engine = null;

    // Stop audio capture (mic mode)
    AudioCapture.stopCapture();
    if (this._audioCaptureUnsub) {
      this._audioCaptureUnsub();
      this._audioCaptureUnsub = null;
    }

    // Stop system audio capture
    for (const unsub of this._systemAudioUnsubs) unsub();
    this._systemAudioUnsubs = [];
    stopSystemAudioCapture().catch(() => {});

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
