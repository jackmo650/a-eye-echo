// ============================================================================
// Speech Recognition Engine — expo-speech-recognition wrapper
//
// Wraps Apple's SFSpeechRecognizer via expo-speech-recognition for continuous
// streaming transcription. Auto-restarts every ~55s to handle the 60-second
// session limit. Uses a generation counter to discard stale results.
// ============================================================================

import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Audio, InterruptionModeIOS } from 'expo-av';
import type { WhisperLanguage } from '../types';

type ResultCallback = (text: string, isFinal: boolean, confidence: number) => void;
type ErrorCallback = (error: string, message: string) => void;
type EndCallback = () => void;
type SpeechCallback = (speaking: boolean) => void;

// Map WhisperLanguage codes to BCP-47 locales for SFSpeechRecognizer
const LANGUAGE_MAP: Record<string, string> = {
  en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT',
  pt: 'pt-BR', nl: 'nl-NL', pl: 'pl-PL', ru: 'ru-RU', uk: 'uk-UA',
  zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', ar: 'ar-SA', hi: 'hi-IN',
  bn: 'bn-IN', tr: 'tr-TR', vi: 'vi-VN', th: 'th-TH', sv: 'sv-SE',
  da: 'da-DK', fi: 'fi-FI', no: 'nb-NO', el: 'el-GR', he: 'he-IL',
  id: 'id-ID', ms: 'ms-MY', ro: 'ro-RO', cs: 'cs-CZ', hu: 'hu-HU',
};

// Auto-restart interval (55s, before Apple's ~60s limit)
const SESSION_RESTART_MS = 55_000;

export class SpeechRecognitionEngine {
  private _active = false;
  private _language = 'en-US';
  private _generation = 0; // Discard results from stale sessions
  private _restartTimer: ReturnType<typeof setTimeout> | null = null;
  private _restarting = false;

  private _resultCallbacks: ResultCallback[] = [];
  private _errorCallbacks: ErrorCallback[] = [];
  private _endCallbacks: EndCallback[] = [];
  private _speechCallbacks: SpeechCallback[] = [];
  private _sessionRestartCallbacks: EndCallback[] = [];

  private _resultSub: { remove(): void } | null = null;
  private _errorSub: { remove(): void } | null = null;
  private _endSub: { remove(): void } | null = null;
  private _speechStartSub: { remove(): void } | null = null;
  private _speechEndSub: { remove(): void } | null = null;

  get isActive(): boolean { return this._active; }

  /** Map a WhisperLanguage code to a BCP-47 locale */
  static mapLanguage(lang: WhisperLanguage): string {
    if (lang === 'auto') return 'en-US'; // SFSpeechRecognizer doesn't support auto-detect
    return LANGUAGE_MAP[lang] || 'en-US';
  }

  /** Check if on-device recognition is available */
  static isAvailable(): boolean {
    try {
      return ExpoSpeechRecognitionModule.isRecognitionAvailable();
    } catch {
      return false;
    }
  }

  /** Check if on-device (offline) recognition is supported */
  static supportsOnDevice(): boolean {
    try {
      return ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
    } catch {
      return false;
    }
  }

  /** Request speech recognition + microphone permissions */
  async requestPermissions(): Promise<boolean> {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return result.granted;
  }

  /** Start speech recognition */
  async start(language: WhisperLanguage): Promise<void> {
    if (this._active) return;

    const granted = await this.requestPermissions();
    if (!granted) {
      throw new Error('Speech recognition permissions not granted');
    }

    // Configure audio session ONCE via expo-av — this persists across
    // speech recognition restarts and prevents WebView media interruption
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    });

    this._language = SpeechRecognitionEngine.mapLanguage(language);
    this._active = true;
    this._generation++;

    this._setupListeners();
    this._startSession();
  }

  /** Stop speech recognition */
  stop(): void {
    this._active = false;
    this._clearRestartTimer();
    this._removeListeners();

    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // May not be recognizing
    }
  }

  // ── Event registration ──

  onResult(cb: ResultCallback): () => void {
    this._resultCallbacks.push(cb);
    return () => { this._resultCallbacks = this._resultCallbacks.filter(c => c !== cb); };
  }

  onError(cb: ErrorCallback): () => void {
    this._errorCallbacks.push(cb);
    return () => { this._errorCallbacks = this._errorCallbacks.filter(c => c !== cb); };
  }

  onEnd(cb: EndCallback): () => void {
    this._endCallbacks.push(cb);
    return () => { this._endCallbacks = this._endCallbacks.filter(c => c !== cb); };
  }

  onSpeechChange(cb: SpeechCallback): () => void {
    this._speechCallbacks.push(cb);
    return () => { this._speechCallbacks = this._speechCallbacks.filter(c => c !== cb); };
  }

  onSessionRestart(cb: EndCallback): () => void {
    this._sessionRestartCallbacks.push(cb);
    return () => { this._sessionRestartCallbacks = this._sessionRestartCallbacks.filter(c => c !== cb); };
  }

  // ── Private ──

  private _startSession(): void {
    this._clearRestartTimer();
    const gen = this._generation;

    console.log(`[SpeechEngine] Starting session gen=${gen}, lang=${this._language}`);

    try {
      const opts: any = {
        lang: this._language,
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: SpeechRecognitionEngine.supportsOnDevice(),
        addsPunctuation: true,
        iosTaskHint: 'dictation',
        // ALWAYS pass iosCategory with mixWithOthers so that every session
        // start (including restarts) keeps the audio session in mix mode.
        // Without this, expo-speech-recognition uses a default config that
        // interrupts WebView media playback.
        iosCategory: {
          category: 'playAndRecord',
          categoryOptions: ['mixWithOthers', 'allowBluetooth', 'defaultToSpeaker'],
          mode: 'default',
        },
      };

      ExpoSpeechRecognitionModule.start(opts);
    } catch (err) {
      console.error('[SpeechEngine] Failed to start:', err);
      for (const cb of this._errorCallbacks) cb('start-failed', String(err));
      return;
    }

    // Schedule auto-restart before Apple's ~60s limit
    this._restartTimer = setTimeout(() => {
      if (this._active && this._generation === gen) {
        console.log(`[SpeechEngine] Auto-restarting at 55s (gen=${gen})`);
        this._restartSession();
      }
    }, SESSION_RESTART_MS);
  }

  private _restartSession(): void {
    if (!this._active || this._restarting) return;
    this._restarting = true;
    this._generation++;

    try {
      // stop() triggers a final result then end event
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // If stop fails, just start a new session
      this._restarting = false;
      this._startSession();
    }
    // The 'end' handler will call _startSession() because _active is still true
  }

  private _setupListeners(): void {
    this._removeListeners();

    this._resultSub = ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
      if (!this._active) return;
      const transcript = event.results?.[0]?.transcript || '';
      const confidence = event.results?.[0]?.confidence ?? -1;
      const isFinal = event.isFinal ?? false;

      for (const cb of this._resultCallbacks) {
        cb(transcript, isFinal, confidence);
      }
    });

    this._errorSub = ExpoSpeechRecognitionModule.addListener('error', (event: any) => {
      const errorCode = event.error || 'unknown';
      const message = event.message || '';
      console.warn(`[SpeechEngine] Error: ${errorCode} — ${message}`);

      // Don't treat 'no-speech' as fatal — just means silence
      if (errorCode === 'no-speech') return;

      for (const cb of this._errorCallbacks) cb(errorCode, message);
    });

    this._endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
      console.log(`[SpeechEngine] Session ended (active=${this._active}, restarting=${this._restarting})`);
      this._restarting = false;

      if (this._active) {
        // Auto-restart: session ended but we're still supposed to be running
        // Notify listeners so they can reset tracking state
        for (const cb of this._sessionRestartCallbacks) cb();
        // Small delay to avoid hammering the recognizer
        setTimeout(() => {
          if (this._active) {
            this._startSession();
          }
        }, 200);
      } else {
        for (const cb of this._endCallbacks) cb();
      }
    });

    this._speechStartSub = ExpoSpeechRecognitionModule.addListener('speechstart', () => {
      for (const cb of this._speechCallbacks) cb(true);
    });

    this._speechEndSub = ExpoSpeechRecognitionModule.addListener('speechend', () => {
      for (const cb of this._speechCallbacks) cb(false);
    });
  }

  private _removeListeners(): void {
    this._resultSub?.remove();
    this._errorSub?.remove();
    this._endSub?.remove();
    this._speechStartSub?.remove();
    this._speechEndSub?.remove();
    this._resultSub = null;
    this._errorSub = null;
    this._endSub = null;
    this._speechStartSub = null;
    this._speechEndSub = null;
  }

  private _clearRestartTimer(): void {
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
  }

  /** Clean up all state */
  cleanup(): void {
    this.stop();
    this._resultCallbacks = [];
    this._errorCallbacks = [];
    this._endCallbacks = [];
    this._speechCallbacks = [];
    this._sessionRestartCallbacks = [];
  }
}

// Singleton
let _instance: SpeechRecognitionEngine | null = null;

export function getSpeechRecognitionEngine(): SpeechRecognitionEngine {
  if (!_instance) _instance = new SpeechRecognitionEngine();
  return _instance;
}
