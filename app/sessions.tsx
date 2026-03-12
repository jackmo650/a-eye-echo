// ============================================================================
// Sessions Screen — Past session list with export capabilities
// Browse, search, export, and delete previous transcription sessions.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  type ListRenderItem,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { useTranscriptStore } from '../src/stores/useTranscriptStore';
import * as db from '../src/services/database';
import { exportTranscript, getFormatLabel } from '../src/services/exportService';
import type { TranscriptSession, ExportFormat } from '../src/types';

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SessionsScreen() {
  const { pastSessions, loadPastSessions } = useTranscriptStore();
  const [loading, setLoading] = useState(true);

  // Load sessions from database on mount
  useEffect(() => {
    (async () => {
      const sessions = await db.getSessions();
      loadPastSessions(sessions);
      setLoading(false);
    })();
  }, [loadPastSessions]);

  const handleExport = useCallback(async (session: TranscriptSession) => {
    const formats: ExportFormat[] = ['txt', 'srt', 'vtt', 'json', 'md'];

    Alert.alert(
      'Export Transcript',
      'Choose export format:',
      [
        ...formats.map(format => ({
          text: getFormatLabel(format),
          onPress: async () => {
            try {
              const segments = await db.getSegments(session.id);
              const speakers = await db.getSpeakers(session.id);

              const { content, filename, mimeType } = exportTranscript(
                format,
                { session, segments, speakers },
              );

              const filePath = `${FileSystem.cacheDirectory}${filename}`;
              await FileSystem.writeAsStringAsync(filePath, content);

              if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(filePath, { mimeType });
              }
            } catch (err) {
              Alert.alert('Export Failed', String(err));
            }
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, []);

  const handleDelete = useCallback((session: TranscriptSession) => {
    Alert.alert(
      'Delete Session',
      `Delete "${session.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await db.deleteSession(session.id);
            const sessions = await db.getSessions();
            loadPastSessions(sessions);
          },
        },
      ],
    );
  }, [loadPastSessions]);

  const renderItem: ListRenderItem<TranscriptSession> = useCallback(
    ({ item }) => (
      <View style={styles.sessionCard}>
        <View style={styles.sessionHeader}>
          <Text style={styles.sessionTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.sessionDate}>{formatDate(item.startedAt)}</Text>
        </View>

        <View style={styles.sessionMeta}>
          <Text style={styles.metaText}>
            {item.segmentCount} segments
          </Text>
          <Text style={styles.metaDot}>.</Text>
          <Text style={styles.metaText}>
            {formatDuration(item.durationMs)}
          </Text>
          <Text style={styles.metaDot}>.</Text>
          <Text style={styles.metaText}>
            {item.modelUsed}
          </Text>
        </View>

        <View style={styles.sessionActions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handleExport(item)}
          >
            <Text style={styles.actionText}>Export</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={() => handleDelete(item)}
          >
            <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    ),
    [handleExport, handleDelete],
  );

  if (loading) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>Loading sessions...</Text>
      </View>
    );
  }

  if (pastSessions.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No Sessions Yet</Text>
        <Text style={styles.emptyText}>
          Completed transcription sessions will appear here.
          You can export them as TXT, SRT, VTT, JSON, or Markdown.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={pastSessions}
      renderItem={renderItem}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.listContent}
      style={styles.container}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#0A0A0A',
  },
  emptyTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyText: {
    color: '#888',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  sessionCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessionTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  sessionDate: {
    color: '#888',
    fontSize: 13,
  },
  sessionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    color: '#666',
    fontSize: 13,
  },
  metaDot: {
    color: '#444',
    fontSize: 13,
  },
  sessionActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionButton: {
    backgroundColor: '#2A2A2A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  actionText: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: 'transparent',
  },
  deleteText: {
    color: '#E53935',
  },
});
