// ============================================================================
// A.EYE.ECHO — Default Values
// Accessibility-first defaults: high contrast, large text, clear fonts.
// ============================================================================

import type {
  AppSettings,
  CaptionStyle,
  CaptionTheme,
  TranscriptionConfig,
  TranscriptionEngine,
  TranslationConfig,
  SignLanguageConfig,
  VibrationConfig,
  WhisperLanguage,
} from './index';

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontSize: 48,
  fontFamily: 'System',
  color: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 3,
  bgColor: '#1A1A2E',
  bgOpacity: 85,
  position: 'center',
  maxLines: 4,
};

export const DEFAULT_TRANSCRIPTION_CONFIG: TranscriptionConfig = {
  engine: 'speech-recognition',
  source: { type: 'microphone' },
  chunkDurationSec: 4,
  modelSize: 'base.en',
  language: 'en',
  autoDetectLanguage: false,
};

export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  enabled: false,
  targetLanguage: 'en',
  showOriginal: true,
  deeplApiKey: '',
};

export const DEFAULT_SIGN_LANGUAGE_CONFIG: SignLanguageConfig = {
  enabled: false,
  language: 'asl',
  showHandPreview: true,
};

export const DEFAULT_VIBRATION_CONFIG: VibrationConfig = {
  onSpeechStart: true,
  onSpeechEnd: false,
  onSpeakerChange: true,
  onQuestion: true,
  onExclamation: true,
  onPause: false,
  intensity: 'medium',
  debounceMs: 2000,
};

export const DEFAULT_SETTINGS: AppSettings = {
  transcription: DEFAULT_TRANSCRIPTION_CONFIG,
  caption: DEFAULT_CAPTION_STYLE,
  vibration: DEFAULT_VIBRATION_CONFIG,
  translation: DEFAULT_TRANSLATION_CONFIG,
  signLanguage: DEFAULT_SIGN_LANGUAGE_CONFIG,
  activeThemeId: 'white-on-black',
  cameraEnabled: false,
  cameraPosition: 'front',
  keepScreenAwake: true,
  autoSaveSession: true,
};

// ── Built-in Themes ─────────────────────────────────────────────────────────

export const PRESET_THEMES: CaptionTheme[] = [
  {
    id: 'white-on-black',
    name: 'White on Black',
    isPreset: true,
    style: {
      ...DEFAULT_CAPTION_STYLE,
      color: '#FFFFFF',
      outlineColor: '#000000',
      bgColor: '#000000',
      bgOpacity: 80,
    },
  },
  {
    id: 'yellow-on-black',
    name: 'Yellow on Black',
    isPreset: true,
    style: {
      ...DEFAULT_CAPTION_STYLE,
      color: '#FFD700',
      outlineColor: '#000000',
      bgColor: '#000000',
      bgOpacity: 80,
    },
  },
  {
    id: 'black-on-white',
    name: 'Black on White',
    isPreset: true,
    style: {
      ...DEFAULT_CAPTION_STYLE,
      color: '#000000',
      outlineColor: '#FFFFFF',
      bgColor: '#FFFFFF',
      bgOpacity: 90,
    },
  },
  {
    id: 'green-on-black',
    name: 'Green on Black',
    isPreset: true,
    style: {
      ...DEFAULT_CAPTION_STYLE,
      color: '#00FF41',
      outlineColor: '#003300',
      bgColor: '#000000',
      bgOpacity: 85,
    },
  },
  {
    id: 'high-contrast-cyan',
    name: 'Cyan on Dark',
    isPreset: true,
    style: {
      ...DEFAULT_CAPTION_STYLE,
      color: '#00FFFF',
      outlineColor: '#000000',
      bgColor: '#1A1A2E',
      bgOpacity: 85,
    },
  },
  // ── Accessibility Presets (Matt's feedback) ──
  {
    id: 'cinema',
    name: 'Cinema',
    isPreset: true,
    style: {
      ...DEFAULT_CAPTION_STYLE,
      fontSize: 56,
      fontFamily: 'System',
      color: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 4,
      bgColor: '#000000',
      bgOpacity: 70,
      position: 'bottom',
      maxLines: 2,
    },
  },
  {
    id: 'conference',
    name: 'Conference',
    isPreset: true,
    style: {
      ...DEFAULT_CAPTION_STYLE,
      fontSize: 42,
      fontFamily: 'System',
      color: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 3,
      bgColor: '#1A1A2E',
      bgOpacity: 85,
      position: 'center',
      maxLines: 4,
    },
  },
  {
    id: 'stage',
    name: 'Stage',
    isPreset: true,
    style: {
      ...DEFAULT_CAPTION_STYLE,
      fontSize: 72,
      fontFamily: 'System',
      color: '#FFD700',
      outlineColor: '#000000',
      outlineWidth: 5,
      bgColor: '#000000',
      bgOpacity: 90,
      position: 'bottom',
      maxLines: 2,
    },
  },
  {
    id: 'classroom',
    name: 'Classroom',
    isPreset: true,
    style: {
      ...DEFAULT_CAPTION_STYLE,
      fontSize: 38,
      fontFamily: 'Atkinson',
      color: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 2,
      bgColor: '#1A1A2E',
      bgOpacity: 80,
      position: 'center',
      maxLines: 6,
    },
  },
];

// ── Whisper Model Info ──────────────────────────────────────────────────────

export const WHISPER_MODELS = {
  'tiny.en':   { label: 'Tiny (English)',      size: '~75 MB',  speed: 'Fastest',  quality: 'Basic',     recommended: 'Older devices / long sessions' },
  'tiny':      { label: 'Tiny (Multilingual)',  size: '~75 MB',  speed: 'Fastest',  quality: 'Basic',     recommended: 'Non-English, older devices' },
  'base.en':   { label: 'Base (English)',       size: '~142 MB', speed: 'Fast',     quality: 'Good',      recommended: 'Most devices (default)' },
  'base':      { label: 'Base (Multilingual)',  size: '~142 MB', speed: 'Fast',     quality: 'Good',      recommended: 'Non-English, most devices' },
  'small.en':  { label: 'Small (English)',      size: '~466 MB', speed: 'Moderate', quality: 'Very good', recommended: 'Newer devices / short sessions' },
  'small':     { label: 'Small (Multilingual)', size: '~466 MB', speed: 'Moderate', quality: 'Very good', recommended: 'Non-English, newer devices' },
  'medium.en': { label: 'Medium (English)',     size: '~1.5 GB', speed: 'Slow',     quality: 'Excellent', recommended: 'Best accuracy, needs A15+ chip' },
  'medium':    { label: 'Medium (Multilingual)',size: '~1.5 GB', speed: 'Slow',     quality: 'Excellent', recommended: 'Best non-English, A15+ chip' },
} as const;

// ── Whisper Languages ──────────────────────────────────────────────────────

export interface LanguageInfo {
  code: WhisperLanguage;
  label: string;
  nativeName: string;
}

export const WHISPER_LANGUAGES: LanguageInfo[] = [
  { code: 'auto', label: 'Auto-detect',    nativeName: 'Auto' },
  { code: 'en',   label: 'English',        nativeName: 'English' },
  { code: 'es',   label: 'Spanish',        nativeName: 'Español' },
  { code: 'fr',   label: 'French',         nativeName: 'Français' },
  { code: 'de',   label: 'German',         nativeName: 'Deutsch' },
  { code: 'it',   label: 'Italian',        nativeName: 'Italiano' },
  { code: 'pt',   label: 'Portuguese',     nativeName: 'Português' },
  { code: 'nl',   label: 'Dutch',          nativeName: 'Nederlands' },
  { code: 'pl',   label: 'Polish',         nativeName: 'Polski' },
  { code: 'ru',   label: 'Russian',        nativeName: 'Русский' },
  { code: 'uk',   label: 'Ukrainian',      nativeName: 'Українська' },
  { code: 'zh',   label: 'Chinese',        nativeName: '中文' },
  { code: 'ja',   label: 'Japanese',       nativeName: '日本語' },
  { code: 'ko',   label: 'Korean',         nativeName: '한국어' },
  { code: 'ar',   label: 'Arabic',         nativeName: 'العربية' },
  { code: 'hi',   label: 'Hindi',          nativeName: 'हिन्दी' },
  { code: 'bn',   label: 'Bengali',        nativeName: 'বাংলা' },
  { code: 'tr',   label: 'Turkish',        nativeName: 'Türkçe' },
  { code: 'vi',   label: 'Vietnamese',     nativeName: 'Tiếng Việt' },
  { code: 'th',   label: 'Thai',           nativeName: 'ไทย' },
  { code: 'sv',   label: 'Swedish',        nativeName: 'Svenska' },
  { code: 'da',   label: 'Danish',         nativeName: 'Dansk' },
  { code: 'fi',   label: 'Finnish',        nativeName: 'Suomi' },
  { code: 'no',   label: 'Norwegian',      nativeName: 'Norsk' },
  { code: 'el',   label: 'Greek',          nativeName: 'Ελληνικά' },
  { code: 'he',   label: 'Hebrew',         nativeName: 'עברית' },
  { code: 'id',   label: 'Indonesian',     nativeName: 'Bahasa Indonesia' },
  { code: 'ms',   label: 'Malay',          nativeName: 'Bahasa Melayu' },
  { code: 'ro',   label: 'Romanian',       nativeName: 'Română' },
  { code: 'cs',   label: 'Czech',          nativeName: 'Čeština' },
  { code: 'hu',   label: 'Hungarian',      nativeName: 'Magyar' },
];

// ── Translation Languages (ML Kit supported) ───────────────────────────────

export const TRANSLATION_LANGUAGES = WHISPER_LANGUAGES.filter(l => l.code !== 'auto');
