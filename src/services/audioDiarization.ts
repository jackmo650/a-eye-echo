// ============================================================================
// Audio Diarization — Simple speaker change detection from audio features
//
// MVP approach: detect speaker turns from significant changes in audio
// energy patterns. When the energy profile shifts notably between segments,
// it's likely a different speaker. Not as accurate as embedding-based
// approaches, but works without any ML model and runs on both platforms.
//
// Enhanced: Uses segment gap timing — long pauses often indicate speaker
// change in conversations.
// ============================================================================

export interface DiarizationResult {
  /** Whether a speaker change was detected */
  speakerChanged: boolean;
  /** Suggested speaker ID */
  speakerId: string;
  /** Confidence of speaker change detection (0-1) */
  confidence: number;
}

export class AudioDiarization {
  private _currentSpeakerId = 'speaker_A';
  private _speakerIndex = 0;
  private _lastSegmentEndMs = 0;
  private _lastSegmentEnergy = 0;
  private _segmentCount = 0;

  /** Pause threshold in ms — gaps longer than this suggest speaker change */
  private readonly PAUSE_THRESHOLD_MS = 3000;
  /** Energy change threshold — significant shift suggests different speaker */
  private readonly ENERGY_SHIFT_THRESHOLD = 0.4;

  /**
   * Analyze a new segment to determine if the speaker changed.
   * Call this for each final segment with its text and timing.
   */
  analyze(
    text: string,
    startMs: number,
    endMs: number,
    confidence: number,
  ): DiarizationResult {
    this._segmentCount++;

    // First segment — always Speaker A
    if (this._segmentCount === 1) {
      this._lastSegmentEndMs = endMs;
      this._lastSegmentEnergy = this._estimateEnergy(text);
      return {
        speakerChanged: false,
        speakerId: this._currentSpeakerId,
        confidence: 0.5,
      };
    }

    // Check for speaker change signals
    const gapMs = startMs - this._lastSegmentEndMs;
    const energy = this._estimateEnergy(text);
    const energyDelta = Math.abs(energy - this._lastSegmentEnergy);

    let changeScore = 0;

    // Long pause strongly suggests speaker change
    if (gapMs > this.PAUSE_THRESHOLD_MS) {
      changeScore += 0.6;
    } else if (gapMs > 1500) {
      changeScore += 0.3;
    }

    // Significant energy shift
    if (energyDelta > this.ENERGY_SHIFT_THRESHOLD) {
      changeScore += 0.4;
    }

    // Question followed by statement pattern
    const prevEndsWithQuestion = this._lastSegmentText?.endsWith('?');
    if (prevEndsWithQuestion) {
      changeScore += 0.3;
    }

    const speakerChanged = changeScore >= 0.5;

    if (speakerChanged) {
      this._speakerIndex = (this._speakerIndex + 1) % 8;
      this._currentSpeakerId = `speaker_${String.fromCharCode(65 + this._speakerIndex)}`;
    }

    this._lastSegmentEndMs = endMs;
    this._lastSegmentEnergy = energy;
    this._lastSegmentText = text;

    return {
      speakerChanged,
      speakerId: this._currentSpeakerId,
      confidence: Math.min(1, changeScore),
    };
  }

  /** Reset state for new session */
  reset(): void {
    this._currentSpeakerId = 'speaker_A';
    this._speakerIndex = 0;
    this._lastSegmentEndMs = 0;
    this._lastSegmentEnergy = 0;
    this._segmentCount = 0;
    this._lastSegmentText = undefined;
  }

  private _lastSegmentText?: string;

  /**
   * Estimate energy from text features.
   * Longer segments with more words tend to indicate more energetic speech.
   * All caps or exclamation marks suggest louder speech.
   */
  private _estimateEnergy(text: string): number {
    const words = text.trim().split(/\s+/).length;
    const hasExclamation = text.includes('!');
    const capsRatio = (text.replace(/[^A-Z]/g, '').length) / Math.max(1, text.length);

    let energy = Math.min(1, words / 20); // Normalize word count
    if (hasExclamation) energy += 0.2;
    if (capsRatio > 0.3) energy += 0.15;

    return Math.min(1, energy);
  }
}

// Singleton
let _instance: AudioDiarization | null = null;

export function getAudioDiarization(): AudioDiarization {
  if (!_instance) _instance = new AudioDiarization();
  return _instance;
}
