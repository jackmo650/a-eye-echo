// ============================================================================
// A.EYE.ECHO — Core Types
// Ported from WallSpace.Studio captionRenderer.ts + transcriptionService.ts
// and expanded for mobile accessibility use cases.
// ============================================================================

// ── Transcription ───────────────────────────────────────────────────────────

export type TranscriptionEngine = 'speech-recognition' | 'whisper';

export type TranscriptionStatus =
  | 'idle'
  | 'loading-model'
  | 'active'
  | 'paused'
  | 'error';

export type WhisperModel =
  | 'tiny.en' | 'base.en' | 'small.en' | 'medium.en'
  | 'tiny' | 'base' | 'small' | 'medium';

// Top 30 languages supported by Whisper (of 99 total)
export type WhisperLanguage =
  | 'auto' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'nl' | 'pl' | 'ru'
  | 'uk' | 'zh' | 'ja' | 'ko' | 'ar' | 'hi' | 'bn' | 'tr' | 'vi' | 'th'
  | 'sv' | 'da' | 'fi' | 'no' | 'el' | 'he' | 'id' | 'ms' | 'ro' | 'cs'
  | 'hu';

export type AudioSource =
  | { type: 'microphone'; deviceId?: string }
  | { type: 'system-audio' }          // Capture audio from other apps (Meet, Discord, Zoom)
  | { type: 'bluetooth' }
  | { type: 'url'; url: string }      // Video/audio URL → download → transcribe
  | { type: 'youtube'; url: string }   // YouTube URL → resolve → transcribe
  | { type: 'stream'; url: string };   // HLS/DASH live stream

export interface TranscriptionConfig {
  /** Transcription engine: 'speech-recognition' (iOS native) or 'whisper' (on-device model) */
  engine?: TranscriptionEngine;
  /** Audio source to capture from */
  source: AudioSource;
  /** Chunk duration in seconds (3-10, whisper only) */
  chunkDurationSec: number;
  /** Whisper model size (whisper engine only) */
  modelSize: WhisperModel;
  /** Language code (default 'en', 'auto' for detection) */
  language: WhisperLanguage;
  /** Auto-detect spoken language (overrides language setting) */
  autoDetectLanguage: boolean;
}

// ── Transcript Segments ─────────────────────────────────────────────────────

export interface TranscriptSegment {
  id: string;
  /** The transcribed text */
  text: string;
  /** Translated text (if translation enabled) */
  translatedText?: string;
  /** Detected language code (when auto-detect is on) */
  detectedLanguage?: WhisperLanguage;
  /** Input source: speech (Whisper), sign-language (MediaPipe) */
  source?: 'speech' | 'sign-language';
  /** Timestamp from session start (ms) */
  startMs: number;
  /** Timestamp end (ms) */
  endMs: number;
  /** Speaker identifier (from diarization or camera) */
  speakerId: string | null;
  /** Whether this is a final or interim result */
  isFinal: boolean;
  /** Confidence score 0-1 (from Whisper) */
  confidence: number;
}

// ── Speaker Identification ──────────────────────────────────────────────────

export interface Speaker {
  id: string;
  /** User-assigned label (default: "Speaker A", "Speaker B", etc.) */
  label: string;
  /** Display color for transcript segments */
  color: string;
  /** Face thumbnail (base64 or local URI) from camera identification */
  thumbnailUri: string | null;
  /** Face embedding vector for re-identification */
  embedding: number[] | null;
}

// ── Caption Styling ─────────────────────────────────────────────────────────
// Ported from WallSpace CaptionStyle, expanded for accessibility

export interface CaptionStyle {
  /** Font size in points (24-120, default 48 for mobile readability) */
  fontSize: number;
  /** Font family */
  fontFamily: CaptionFont;
  /** Text color (hex) */
  color: string;
  /** Text outline color (hex) */
  outlineColor: string;
  /** Outline width in pixels (0-8) */
  outlineWidth: number;
  /** Background color (hex) */
  bgColor: string;
  /** Background opacity (0-100) */
  bgOpacity: number;
  /** Caption position on screen */
  position: 'top' | 'center' | 'bottom';
  /** Maximum visible lines (1-8) */
  maxLines: number;
}

export type CaptionFont =
  | 'System'             // Platform default (SF Pro / Roboto)
  | 'Inter'              // Clean sans-serif
  | 'OpenDyslexic'       // Dyslexia-friendly
  | 'Atkinson'           // Low-vision optimized (Braille Institute)
  | 'SF Mono'            // Monospaced
  | 'Courier New';       // Monospaced fallback

// ── Themes ──────────────────────────────────────────────────────────────────

export interface CaptionTheme {
  id: string;
  name: string;
  /** Whether this is a built-in preset (not deletable) */
  isPreset: boolean;
  style: CaptionStyle;
}

// ── Session ─────────────────────────────────────────────────────────────────

export interface TranscriptSession {
  id: string;
  /** User-editable session title */
  title: string;
  /** ISO timestamp */
  startedAt: string;
  /** ISO timestamp (null if still active) */
  endedAt: string | null;
  /** Audio source used */
  audioSource: AudioSource;
  /** Model used for transcription */
  modelUsed: WhisperModel;
  /** Total segment count */
  segmentCount: number;
  /** Total duration in ms */
  durationMs: number;
}

// ── Export ───────────────────────────────────────────────────────────────────

export type ExportFormat =
  | 'txt'      // Plain text
  | 'srt'      // SubRip subtitle
  | 'vtt'      // WebVTT subtitle
  | 'json'     // Structured JSON (for ChatGPT/AI processing)
  | 'md'       // Markdown with speaker headers
  | 'pdf';     // Formatted PDF

// ── Vibration ───────────────────────────────────────────────────────────────

export type VibrationIntensity = 'off' | 'light' | 'medium' | 'strong';

export interface VibrationConfig {
  /** Vibrate when speech starts after silence */
  onSpeechStart: boolean;
  /** Vibrate when speech ends (double pulse) */
  onSpeechEnd: boolean;
  /** Vibrate on speaker change (triple pulse) */
  onSpeakerChange: boolean;
  /** Haptic intensity */
  intensity: VibrationIntensity;
  /** Minimum time between vibrations (ms) to avoid fatigue */
  debounceMs: number;
}

// ── Camera / Face Detection ─────────────────────────────────────────────────

export type CameraPosition = 'front' | 'back';

export interface FaceDetection {
  /** Bounding box (normalized 0-1) */
  bounds: { x: number; y: number; width: number; height: number };
  /** Face landmark positions */
  landmarks: FaceLandmarks | null;
  /** Is mouth currently open (lip-sync detection) */
  isSpeaking: boolean;
  /** Face embedding for identification */
  embedding: number[] | null;
}

export interface FaceLandmarks {
  leftEye: { x: number; y: number };
  rightEye: { x: number; y: number };
  nose: { x: number; y: number };
  mouthTop: { x: number; y: number };
  mouthBottom: { x: number; y: number };
}

// ── Translation ──────────────────────────────────────────────────────────────

export interface TranslationConfig {
  /** Enable real-time translation */
  enabled: boolean;
  /** Target language for translation */
  targetLanguage: string;
  /** Show original text alongside translation */
  showOriginal: boolean;
  /** DeepL API key (free tier: 500K chars/month) */
  deeplApiKey: string;
}

// ── Sign Language ────────────────────────────────────────────────────────────

export type SignLanguageType = 'asl' | 'bsl';

export interface SignLanguageConfig {
  /** Enable sign language recognition */
  enabled: boolean;
  /** Which sign language system */
  language: SignLanguageType;
  /** Show hand landmark overlay on camera preview */
  showHandPreview: boolean;
}

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface HandLandmarks {
  /** 21 keypoints per hand */
  points: HandLandmark[];
  handedness: 'left' | 'right';
}

export interface SignRecognition {
  /** Recognized sign (letter or word) */
  sign: string;
  confidence: number;
  timestamp: number;
}

// ── App Settings ────────────────────────────────────────────────────────────

export interface AppSettings {
  transcription: TranscriptionConfig;
  caption: CaptionStyle;
  vibration: VibrationConfig;
  translation: TranslationConfig;
  signLanguage: SignLanguageConfig;
  /** Active theme ID */
  activeThemeId: string;
  /** Camera for speaker identification */
  cameraEnabled: boolean;
  cameraPosition: CameraPosition;
  /** Keep screen awake during transcription */
  keepScreenAwake: boolean;
  /** Auto-save sessions */
  autoSaveSession: boolean;
}
