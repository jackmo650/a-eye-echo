// ============================================================================
// Settings Store — Zustand state for app configuration
// Persists to AsyncStorage for cross-session settings retention.
// ============================================================================

import { create } from 'zustand';
import type {
  AppSettings,
  CaptionStyle,
  CaptionTheme,
  TranscriptionConfig,
  TranslationConfig,
  SignLanguageConfig,
  VibrationConfig,
  CameraPosition,
} from '../types';
import { DEFAULT_SETTINGS, PRESET_THEMES } from '../types/defaults';

interface SettingsState {
  settings: AppSettings;
  themes: CaptionTheme[];

  // ── Caption style ──
  updateCaptionStyle: (partial: Partial<CaptionStyle>) => void;
  setFontSize: (size: number) => void;
  setPosition: (position: 'top' | 'center' | 'bottom') => void;

  // ── Theme ──
  setActiveTheme: (themeId: string) => void;
  addCustomTheme: (name: string, style: CaptionStyle) => CaptionTheme;
  deleteTheme: (themeId: string) => void;

  // ── Transcription ──
  updateTranscriptionConfig: (partial: Partial<TranscriptionConfig>) => void;

  // ── Translation ──
  updateTranslationConfig: (partial: Partial<TranslationConfig>) => void;

  // ── Sign Language ──
  updateSignLanguageConfig: (partial: Partial<SignLanguageConfig>) => void;

  // ── Vibration ──
  updateVibrationConfig: (partial: Partial<VibrationConfig>) => void;

  // ── Camera ──
  setCameraEnabled: (enabled: boolean) => void;
  setCameraPosition: (position: CameraPosition) => void;

  // ── General ──
  setKeepScreenAwake: (awake: boolean) => void;
  setAnchorCaptionsToFace: (enabled: boolean) => void;

  // ── Persistence ──
  loadSettings: (settings: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  themes: [...PRESET_THEMES],

  updateCaptionStyle: (partial) => set(state => ({
    settings: {
      ...state.settings,
      caption: { ...state.settings.caption, ...partial },
    },
  })),

  setFontSize: (size) => {
    const clamped = Math.max(24, Math.min(120, size));
    get().updateCaptionStyle({ fontSize: clamped });
  },

  setPosition: (position) => get().updateCaptionStyle({ position }),

  setActiveTheme: (themeId) => {
    const theme = get().themes.find(t => t.id === themeId);
    if (!theme) return;
    set(state => ({
      settings: {
        ...state.settings,
        activeThemeId: themeId,
        caption: { ...state.settings.caption, ...theme.style },
      },
    }));
  },

  addCustomTheme: (name, style) => {
    const id = `custom-${Date.now()}`;
    const theme: CaptionTheme = { id, name, isPreset: false, style };
    set(state => ({ themes: [...state.themes, theme] }));
    return theme;
  },

  deleteTheme: (themeId) => set(state => ({
    themes: state.themes.filter(t => t.id !== themeId || t.isPreset),
  })),

  updateTranscriptionConfig: (partial) => set(state => ({
    settings: {
      ...state.settings,
      transcription: { ...state.settings.transcription, ...partial },
    },
  })),

  updateTranslationConfig: (partial) => set(state => ({
    settings: {
      ...state.settings,
      translation: { ...state.settings.translation, ...partial },
    },
  })),

  updateSignLanguageConfig: (partial) => set(state => ({
    settings: {
      ...state.settings,
      signLanguage: { ...state.settings.signLanguage, ...partial },
    },
  })),

  updateVibrationConfig: (partial) => set(state => ({
    settings: {
      ...state.settings,
      vibration: { ...state.settings.vibration, ...partial },
    },
  })),

  setCameraEnabled: (enabled) => set(state => ({
    settings: { ...state.settings, cameraEnabled: enabled },
  })),

  setCameraPosition: (position) => set(state => ({
    settings: { ...state.settings, cameraPosition: position },
  })),

  setKeepScreenAwake: (awake) => set(state => ({
    settings: { ...state.settings, keepScreenAwake: awake },
  })),

  setAnchorCaptionsToFace: (enabled) => set(state => ({
    settings: { ...state.settings, anchorCaptionsToFace: enabled },
  })),

  loadSettings: (loaded) => set(state => ({
    settings: { ...state.settings, ...loaded },
  })),
}));
