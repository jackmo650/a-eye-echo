// ============================================================================
// Transcript Screen — Scrolling transcript view for current session
// Shows live transcript with timestamps, speaker labels, and status.
// ============================================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TranscriptList } from '../src/components/TranscriptList';
import { useTranscriptStore } from '../src/stores/useTranscriptStore';
import { useSettingsStore } from '../src/stores/useSettingsStore';

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function TranscriptScreen() {
  const { segments, speakers, status, currentSession } = useTranscriptStore();
  const { settings } = useSettingsStore();

  const isActive = status === 'active' || status === 'loading-model';
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null;
  const duration = lastSegment ? lastSegment.endMs : 0;

  return (
    <View style={styles.container}>
      {/* Session info bar */}
      {isActive && currentSession && (
        <View style={styles.sessionBar}>
          <View style={styles.sessionBarLeft}>
            <View style={[styles.liveDot, status === 'active' && styles.liveDotActive]} />
            <Text style={styles.sessionBarText}>
              {status === 'loading-model' ? 'Loading...' : 'Recording'}
            </Text>
          </View>
          <Text style={styles.sessionBarText}>
            {formatDuration(duration)}
          </Text>
          <Text style={styles.sessionBarText}>
            {segments.length} seg{segments.length !== 1 ? 's' : ''}
            {speakers.length > 0 ? ` / ${speakers.length} speaker${speakers.length !== 1 ? 's' : ''}` : ''}
          </Text>
          {settings.translation.enabled && (
            <View style={styles.translateBadge}>
              <Text style={styles.translateBadgeText}>
                {settings.transcription.language.toUpperCase()} → {settings.translation.targetLanguage.toUpperCase()}
              </Text>
            </View>
          )}
        </View>
      )}

      {status === 'idle' && segments.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No Active Session</Text>
          <Text style={styles.emptySubtitle}>
            Start captioning from the Live tab to see the transcript here.
          </Text>
          <Text style={styles.emptyHint}>
            The transcript auto-scrolls as new captions arrive.{'\n'}
            Pull up to pause auto-scroll.
          </Text>
        </View>
      ) : (
        <TranscriptList
          segments={segments}
          speakers={speakers}
          onSegmentPress={(segment) => {
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
  sessionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#111',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
    gap: 8,
  },
  sessionBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#555',
  },
  liveDotActive: {
    backgroundColor: '#E53935',
  },
  sessionBarText: {
    color: '#888',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  translateBadge: {
    backgroundColor: '#1A3A4A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  translateBadgeText: {
    color: '#4FC3F7',
    fontSize: 10,
    fontWeight: '700',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 8,
  },
  emptyTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
  },
  emptySubtitle: {
    color: '#888',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyHint: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 12,
  },
});
