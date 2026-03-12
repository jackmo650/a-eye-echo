// ============================================================================
// CaptionCast — Default Values
// Accessibility-first defaults: high contrast, large text, clear fonts.
// ============================================================================

import type {
  AppSettings,
  CaptionStyle,
  CaptionTheme,
  TranscriptionConfig,
  VibrationConfig,
} from './index';

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontSize: 48,
  fontFamily: 'System',
  color: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 3,
  bgColor: '#000000',
  bgOpacity: 70,
  position: 'bottom',
  maxLines: 3,
};

export const DEFAULT_TRANSCRIPTION_CONFIG: TranscriptionConfig = {
  source: { type: 'microphone' },
  chunkDurationSec: 4,
  modelSize: 'base.en',
  language: 'en',
};

export const DEFAULT_VIBRATION_CONFIG: VibrationConfig = {
  onSpeechStart: true,
  onSpeechEnd: false,
  onSpeakerChange: true,
  intensity: 'medium',
  debounceMs: 2000,
};

export const DEFAULT_SETTINGS: AppSettings = {
  transcription: DEFAULT_TRANSCRIPTION_CONFIG,
  caption: DEFAULT_CAPTION_STYLE,
  vibration: DEFAULT_VIBRATION_CONFIG,
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
];

// ── Whisper Model Info ──────────────────────────────────────────────────────

export const WHISPER_MODELS = {
  'tiny.en':   { label: 'Tiny',   size: '~75 MB',  speed: 'Fastest',  quality: 'Basic',     recommended: 'Older devices / long sessions' },
  'base.en':   { label: 'Base',   size: '~142 MB', speed: 'Fast',     quality: 'Good',      recommended: 'Most devices (default)' },
  'small.en':  { label: 'Small',  size: '~466 MB', speed: 'Moderate', quality: 'Very good', recommended: 'Newer devices / short sessions' },
  'medium.en': { label: 'Medium', size: '~1.5 GB', speed: 'Slow',    quality: 'Excellent',  recommended: 'Best accuracy, needs A15+ chip' },
} as const;
