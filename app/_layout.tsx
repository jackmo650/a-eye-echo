// ============================================================================
// Root Layout — App-level navigation structure
// Tab-based navigation: Live | Transcript | Sessions | Settings
// ============================================================================

import React from 'react';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
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
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Live',
            headerTitle: 'CaptionCast',
            tabBarLabel: 'Live',
          }}
        />
        <Tabs.Screen
          name="transcript"
          options={{
            title: 'Transcript',
            tabBarLabel: 'Transcript',
          }}
        />
        <Tabs.Screen
          name="sessions"
          options={{
            title: 'Sessions',
            tabBarLabel: 'Sessions',
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarLabel: 'Settings',
          }}
        />
      </Tabs>
    </>
  );
}
