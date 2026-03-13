// ============================================================================
// Vibration Service — Haptic feedback for speech events
// Provides tactile notifications for deaf users:
//   - Single pulse when someone starts speaking
//   - Double pulse when speech ends
//   - Triple pulse on speaker change
//   - Two short + one long on question marks
//   - Three rapid on exclamation marks
//   - Gentle double on ellipsis/pauses
// ============================================================================

import * as Haptics from 'expo-haptics';
import type { VibrationConfig, VibrationIntensity } from '../types';
import { DEFAULT_VIBRATION_CONFIG } from '../types/defaults';

const INTENSITY_MAP: Record<VibrationIntensity, Haptics.ImpactFeedbackStyle> = {
  off: Haptics.ImpactFeedbackStyle.Light, // unused when off
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  strong: Haptics.ImpactFeedbackStyle.Heavy,
};

export class VibrationService {
  private _config: VibrationConfig = { ...DEFAULT_VIBRATION_CONFIG };
  private _lastVibrationMs = 0;
  private _wasSpeaking = false;
  private _lastSpeakerId: string | null = null;
  private _lastPunctuationMs = 0;

  /** Silence threshold in dB — below this = silence */
  private readonly SPEECH_THRESHOLD_DB = -40;
  /** Minimum time between punctuation vibrations (separate from main debounce) */
  private readonly PUNCTUATION_DEBOUNCE_MS = 1500;

  configure(config: Partial<VibrationConfig>): void {
    this._config = { ...this._config, ...config };
  }

  get config(): VibrationConfig {
    return { ...this._config };
  }

  /**
   * Called with real-time amplitude from transcription service.
   * Triggers speech start/end haptics based on RMS level.
   */
  onAmplitude(rmsDb: number): void {
    if (this._config.intensity === 'off') return;

    const isSpeaking = rmsDb > this.SPEECH_THRESHOLD_DB;

    if (isSpeaking && !this._wasSpeaking && this._config.onSpeechStart) {
      this._triggerSpeechStart();
    }

    if (!isSpeaking && this._wasSpeaking && this._config.onSpeechEnd) {
      this._triggerSpeechEnd();
    }

    this._wasSpeaking = isSpeaking;
  }

  /**
   * Called when a new speaker is detected (from diarization or camera).
   */
  onSpeakerChange(speakerId: string): void {
    if (this._config.intensity === 'off') return;
    if (!this._config.onSpeakerChange) return;
    if (speakerId === this._lastSpeakerId) return;

    this._lastSpeakerId = speakerId;
    this._triggerSpeakerChange();
  }

  /**
   * Called when a final segment is emitted — analyzes punctuation for
   * vibration grammar (questions, exclamations, pauses).
   */
  onSegmentText(text: string): void {
    if (this._config.intensity === 'off') return;
    if (!text) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    // Check punctuation debounce separately from main debounce
    const now = Date.now();
    if (now - this._lastPunctuationMs < this.PUNCTUATION_DEBOUNCE_MS) return;

    if (this._config.onQuestion && trimmed.endsWith('?')) {
      this._lastPunctuationMs = now;
      this._triggerQuestion();
    } else if (this._config.onExclamation && trimmed.endsWith('!')) {
      this._lastPunctuationMs = now;
      this._triggerExclamation();
    } else if (this._config.onPause && (trimmed.endsWith('...') || trimmed.endsWith('…'))) {
      this._lastPunctuationMs = now;
      this._triggerPause();
    }
  }

  /** Reset state (e.g., when session ends) */
  reset(): void {
    this._wasSpeaking = false;
    this._lastSpeakerId = null;
    this._lastVibrationMs = 0;
    this._lastPunctuationMs = 0;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private _canVibrate(): boolean {
    const now = Date.now();
    if (now - this._lastVibrationMs < this._config.debounceMs) return false;
    this._lastVibrationMs = now;
    return true;
  }

  /** Single pulse — someone started speaking */
  private _triggerSpeechStart(): void {
    if (!this._canVibrate()) return;
    const style = INTENSITY_MAP[this._config.intensity];
    Haptics.impactAsync(style);
  }

  /** Double pulse — speech ended */
  private async _triggerSpeechEnd(): Promise<void> {
    if (!this._canVibrate()) return;
    const style = INTENSITY_MAP[this._config.intensity];
    await Haptics.impactAsync(style);
    await sleep(100);
    await Haptics.impactAsync(style);
  }

  /** Triple pulse — speaker changed */
  private async _triggerSpeakerChange(): Promise<void> {
    if (!this._canVibrate()) return;
    const style = INTENSITY_MAP[this._config.intensity];
    await Haptics.impactAsync(style);
    await sleep(80);
    await Haptics.impactAsync(style);
    await sleep(80);
    await Haptics.impactAsync(style);
  }

  /** Two short + one long — question detected */
  private async _triggerQuestion(): Promise<void> {
    const style = INTENSITY_MAP[this._config.intensity];
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await sleep(60);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await sleep(120);
    await Haptics.impactAsync(style);
  }

  /** Three rapid pulses — exclamation detected */
  private async _triggerExclamation(): Promise<void> {
    const style = INTENSITY_MAP[this._config.intensity];
    await Haptics.impactAsync(style);
    await sleep(50);
    await Haptics.impactAsync(style);
    await sleep(50);
    await Haptics.impactAsync(style);
  }

  /** Gentle double pulse — pause/ellipsis detected */
  private async _triggerPause(): Promise<void> {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await sleep(200);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Singleton
let _instance: VibrationService | null = null;

export function getVibrationService(): VibrationService {
  if (!_instance) _instance = new VibrationService();
  return _instance;
}
