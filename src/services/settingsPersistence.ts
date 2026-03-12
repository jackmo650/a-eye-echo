// ============================================================================
// Settings Persistence — Save/restore settings via AsyncStorage
// Loads on app start, saves on every change (debounced).
// ============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppSettings, CaptionTheme } from '../types';
import { DEFAULT_SETTINGS } from '../types/defaults';

const SETTINGS_KEY = '@aeyeecho/settings';
const THEMES_KEY = '@aeyeecho/themes';
const ONBOARDING_KEY = '@aeyeecho/onboarding_complete';

/**
 * Load persisted settings from AsyncStorage.
 * Returns defaults if nothing saved yet.
 */
export async function loadPersistedSettings(): Promise<{
  settings: AppSettings;
  themes: CaptionTheme[] | null;
}> {
  try {
    const [settingsJson, themesJson] = await Promise.all([
      AsyncStorage.getItem(SETTINGS_KEY),
      AsyncStorage.getItem(THEMES_KEY),
    ]);

    const settings = settingsJson
      ? { ...DEFAULT_SETTINGS, ...JSON.parse(settingsJson) }
      : DEFAULT_SETTINGS;

    const themes = themesJson ? JSON.parse(themesJson) : null;

    return { settings, themes };
  } catch (err) {
    console.error('[Settings] Failed to load:', err);
    return { settings: DEFAULT_SETTINGS, themes: null };
  }
}

/**
 * Persist settings to AsyncStorage.
 */
export async function persistSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('[Settings] Failed to save:', err);
  }
}

/**
 * Persist custom themes to AsyncStorage.
 */
export async function persistThemes(themes: CaptionTheme[]): Promise<void> {
  try {
    await AsyncStorage.setItem(THEMES_KEY, JSON.stringify(themes));
  } catch (err) {
    console.error('[Settings] Failed to save themes:', err);
  }
}

/**
 * Check if onboarding has been completed.
 */
export async function isOnboardingComplete(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(ONBOARDING_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

/**
 * Mark onboarding as complete.
 */
export async function completeOnboarding(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
  } catch (err) {
    console.error('[Settings] Failed to save onboarding state:', err);
  }
}
