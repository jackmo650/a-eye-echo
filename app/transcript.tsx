// ============================================================================
// Transcript Screen — Scrolling transcript view for current session
// Full session transcript with timestamps, speaker labels, and search.
// ============================================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TranscriptList } from '../src/components/TranscriptList';
import { useTranscriptStore } from '../src/stores/useTranscriptStore';

export default function TranscriptScreen() {
  const { segments, speakers, status } = useTranscriptStore();

  return (
    <View style={styles.container}>
      {status === 'idle' && segments.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No Active Session</Text>
          <Text style={styles.emptySubtitle}>
            Start captioning from the Live tab to see the transcript here.
          </Text>
        </View>
      ) : (
        <TranscriptList
          segments={segments}
          speakers={speakers}
          onSegmentPress={(segment) => {
            // TODO: Phase 3 — tap-to-seek (highlight caption at this timestamp)
            console.log(`Tapped segment at ${segment.startMs}ms: ${segment.text}`);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#888',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});
