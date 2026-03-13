// ============================================================================
// Share Screen — Caption networking (host/join live caption sessions)
// ============================================================================

import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { CaptionSharePanel } from '../src/components/CaptionSharePanel';

export default function ShareScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <CaptionSharePanel />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  content: {
    paddingBottom: 40,
  },
});
