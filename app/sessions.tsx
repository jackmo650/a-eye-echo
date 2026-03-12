// ============================================================================
// Sessions Screen — Past session list with export capabilities
// Browse, export, and delete previous transcription sessions.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
  type ListRenderItem,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { useTranscriptStore } from '../src/stores/useTranscriptStore';
import * as db from '../src/services/database';
import { exportTranscript, getFormatLabel } from '../src/services/exportService';
import type { TranscriptSession, ExportFormat } from '../src/types';

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);

  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'short' }) + ` ${time}`;
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  }) + ` ${time}`;
}

function formatModelLabel(model: string): string {
  return model.replace('.en', ' EN').replace('tiny', 'Tiny').replace('base', 'Base')
    .replace('small', 'Small').replace('medium', 'Medium');
}

export default function SessionsScreen() {
  const { pastSessions, loadPastSessions } = useTranscriptStore();
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

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
      `Export "${session.title}" as:`,
      [
        ...formats.map(format => ({
          text: getFormatLabel(format),
          onPress: async () => {
            try {
              setExporting(session.id);
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
            } finally {
              setExporting(null);
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
      `Delete "${session.title}"?\n\nThis includes all transcript segments and speaker data. This cannot be undone.`,
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
    ({ item }) => {
      const isExporting = exporting === item.id;

      return (
        <View
          style={styles.sessionCard}
          accessible
          accessibilityLabel={`Session: ${item.title}, ${formatDate(item.startedAt)}, ${item.segmentCount} segments, ${formatDuration(item.durationMs)}`}
        >
          <View style={styles.sessionHeader}>
            <Text style={styles.sessionTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.sessionDate}>{formatDate(item.startedAt)}</Text>
          </View>

          <View style={styles.sessionMeta}>
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>
                {item.segmentCount} segment{item.segmentCount !== 1 ? 's' : ''}
              </Text>
            </View>
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>
                {formatDuration(item.durationMs)}
              </Text>
            </View>
            <View style={[styles.metaChip, styles.modelChip]}>
              <Text style={[styles.metaChipText, styles.modelChipText]}>
                {formatModelLabel(item.modelUsed)}
              </Text>
            </View>
          </View>

          <View style={styles.sessionActions}>
            <TouchableOpacity
              style={styles.exportButton}
              onPress={() => handleExport(item)}
              disabled={isExporting}
              accessible
              accessibilityRole="button"
              accessibilityLabel={`Export ${item.title}`}
            >
              {isExporting ? (
                <ActivityIndicator size="small" color="#4FC3F7" />
              ) : (
                <Text style={styles.exportText}>Export</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => handleDelete(item)}
              accessible
              accessibilityRole="button"
              accessibilityLabel={`Delete ${item.title}`}
            >
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [handleExport, handleDelete, exporting],
  );

  if (loading) {
    return (
      <View style={styles.emptyState}>
        <ActivityIndicator size="large" color="#4FC3F7" />
        <Text style={styles.emptyText}>Loading sessions...</Text>
      </View>
    );
  }

  if (pastSessions.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>-</Text>
        <Text style={styles.emptyTitle}>No Sessions Yet</Text>
        <Text style={styles.emptyText}>
          Completed transcription sessions will appear here.{'\n'}
          You can export them as TXT, SRT, VTT, JSON, or Markdown.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sessionCount}>
        {pastSessions.length} session{pastSessions.length !== 1 ? 's' : ''}
      </Text>
      <FlatList
        data={pastSessions}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
      />
    </View>
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
    paddingBottom: 32,
  },
  sessionCount: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    paddingTop: 12,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#0A0A0A',
    gap: 12,
  },
  emptyIcon: {
    color: '#333',
    fontSize: 48,
    fontWeight: '200',
  },
  emptyTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
  },
  emptyText: {
    color: '#888',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  sessionCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#222',
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
    flexWrap: 'wrap',
    gap: 6,
  },
  metaChip: {
    backgroundColor: '#252525',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  metaChipText: {
    color: '#999',
    fontSize: 12,
    fontWeight: '500',
  },
  modelChip: {
    backgroundColor: '#1A2A3A',
  },
  modelChipText: {
    color: '#4FC3F7',
  },
  sessionActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  exportButton: {
    backgroundColor: '#1A3A4A',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  exportText: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  deleteText: {
    color: '#E53935',
    fontSize: 14,
    fontWeight: '500',
  },
});
