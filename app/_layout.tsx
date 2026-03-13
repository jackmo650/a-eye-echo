// ============================================================================
// Root Layout — App-level navigation + initialization
// Tab-based navigation: Live | Transcript | Sessions | Settings
// Handles: settings persistence, onboarding, keep-awake, error boundary
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { OnboardingModal } from '../src/components/OnboardingModal';
import { useSettingsStore } from '../src/stores/useSettingsStore';
import {
  loadPersistedSettings,
  persistSettings,
  persistThemes,
  isOnboardingComplete,
  completeOnboarding,
  resetOnboarding,
} from '../src/services/settingsPersistence';

function AppContent() {
  const { settings, themes, loadSettings } = useSettingsStore();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Keep screen awake when enabled
  useKeepAwake(settings.keepScreenAwake ? 'aeyeecho' : undefined);

  // Load persisted settings on mount
  useEffect(() => {
    (async () => {
      const { settings: loaded, themes: loadedThemes } = await loadPersistedSettings();
      loadSettings(loaded);

      // Reset onboarding to show updated pages (remove after first launch)
      await resetOnboarding();
      const onboarded = await isOnboardingComplete();
      if (!onboarded) {
        setShowOnboarding(true);
      }
      setInitialized(true);
    })();
  }, [loadSettings]);

  // Auto-save settings when they change (after initial load)
  useEffect(() => {
    if (!initialized) return;
    persistSettings(settings);
  }, [settings, initialized]);

  // Auto-save themes when they change
  useEffect(() => {
    if (!initialized) return;
    persistThemes(themes);
  }, [themes, initialized]);

  const handleOnboardingComplete = useCallback(async () => {
    setShowOnboarding(false);
    await completeOnboarding();
  }, []);

  return (
    <>
      <StatusBar style="light" />

      <OnboardingModal
        visible={showOnboarding}
        onComplete={handleOnboardingComplete}
      />

      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: '#0A0A0A' },
          headerTintColor: '#FFF',
          tabBarStyle: {
            backgroundColor: '#0A0A0A',
            borderTopColor: '#222',
          },
          tabBarActiveTintColor: '#4FC3F7',
          tabBarInactiveTintColor: '#666',
          tabBarAccessibilityLabel: 'Main navigation',
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Live',
            headerTitle: 'A.EYE.ECHO',
            tabBarLabel: 'Live',
            tabBarAccessibilityLabel: 'Live captioning screen',
          }}
        />
        <Tabs.Screen
          name="transcript"
          options={{
            title: 'Transcript',
            tabBarLabel: 'Transcript',
            tabBarAccessibilityLabel: 'Current session transcript',
          }}
        />
        <Tabs.Screen
          name="sessions"
          options={{
            title: 'Sessions',
            tabBarLabel: 'Sessions',
            tabBarAccessibilityLabel: 'Past transcription sessions',
          }}
        />
        <Tabs.Screen
          name="share"
          options={{
            title: 'Share',
            tabBarLabel: 'Share',
            tabBarAccessibilityLabel: 'Share captions with other devices',
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarLabel: 'Settings',
            tabBarAccessibilityLabel: 'App settings and customization',
          }}
        />
      </Tabs>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
