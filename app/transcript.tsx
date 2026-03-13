// ============================================================================
// Transcript Screen — Scrolling transcript view for current session
// Shows live transcript with timestamps, speaker labels, and status.
// Toggle between Timeline view and Conversational (chat bubble) view.
// ============================================================================

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  Share,
  Modal,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { TranscriptList } from '../src/components/TranscriptList';
import { ConversationalView } from '../src/components/ConversationalView';
import { useTranscriptStore } from '../src/stores/useTranscriptStore';
import { useSettingsStore } from '../src/stores/useSettingsStore';
import {
  exportTranscript,
  getFormatLabel,
} from '../src/services/exportService';
import type { ExportFormat, TranscriptSegment } from '../src/types';

type ViewMode = 'timeline' | 'chat';

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const EXPORT_FORMATS: ExportFormat[] = ['txt', 'srt', 'vtt', 'json', 'md'];

export default function TranscriptScreen() {
  const { segments, speakers, status, currentSession, updateSegment } = useTranscriptStore();
  const { settings } = useSettingsStore();
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [showExport, setShowExport] = useState(false);
  const [editingSegment, setEditingSegment] = useState<TranscriptSegment | null>(null);
  const [editText, setEditText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const isActive = status === 'active' || status === 'loading-model';
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null;
  const duration = lastSegment ? lastSegment.endMs : 0;

  // Filter segments by search query
  const filteredSegments = searchQuery.trim()
    ? segments.filter(s =>
        s.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.translatedText && s.translatedText.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : segments;

  const handleSegmentPress = useCallback((segment: TranscriptSegment) => {
    setEditingSegment(segment);
    setEditText(segment.text);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingSegment && editText.trim()) {
      updateSegment(editingSegment.id, editText.trim());
      setEditingSegment(null);
    }
  }, [editingSegment, editText, updateSegment]);

  const handleExport = useCallback(async (format: ExportFormat) => {
    if (!currentSession || segments.length === 0) {
      Alert.alert('Nothing to Export', 'Start a captioning session first.');
      return;
    }

    const session = {
      ...currentSession,
      endedAt: currentSession.endedAt || new Date().toISOString(),
      segmentCount: segments.length,
      durationMs: duration,
    };

    const { content, filename, mimeType } = exportTranscript(format, {
      session,
      segments,
      speakers,
    });

    try {
      const filePath = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(filePath, content, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, { mimeType });
      } else {
        await Share.share({ message: content });
      }
    } catch (err) {
      Alert.alert('Export Failed', String(err));
    }

    setShowExport(false);
  }, [currentSession, segments, speakers, duration]);

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

      {/* Toolbar: view toggle + actions */}
      <View style={styles.toolbar}>
        <View style={styles.viewToggle}>
          <TouchableOpacity
            style={[styles.toggleBtn, viewMode === 'timeline' && styles.toggleBtnActive]}
            onPress={() => setViewMode('timeline')}
          >
            <Text style={[styles.toggleText, viewMode === 'timeline' && styles.toggleTextActive]}>
              Timeline
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, viewMode === 'chat' && styles.toggleBtnActive]}
            onPress={() => setViewMode('chat')}
          >
            <Text style={[styles.toggleText, viewMode === 'chat' && styles.toggleTextActive]}>
              Chat
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => setShowSearch(s => !s)}
          >
            <Text style={styles.actionBtnText}>Search</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, segments.length === 0 && styles.actionBtnDisabled]}
            onPress={() => setShowExport(true)}
            disabled={segments.length === 0}
          >
            <Text style={styles.actionBtnText}>Export</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search bar */}
      {showSearch && (
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search transcript..."
            placeholderTextColor="#666"
            autoFocus
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <Text style={styles.searchCount}>
              {filteredSegments.length} result{filteredSegments.length !== 1 ? 's' : ''}
            </Text>
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
      ) : viewMode === 'chat' ? (
        <ConversationalView
          segments={filteredSegments}
          speakers={speakers}
          onSegmentPress={handleSegmentPress}
        />
      ) : (
        <TranscriptList
          segments={filteredSegments}
          speakers={speakers}
          onSegmentPress={handleSegmentPress}
        />
      )}

      {/* Segment Edit Modal */}
      <Modal visible={!!editingSegment} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Segment</Text>
            {editingSegment && (
              <Text style={styles.modalTimestamp}>
                {formatDuration(editingSegment.startMs)} - {formatDuration(editingSegment.endMs)}
              </Text>
            )}
            <TextInput
              style={styles.editInput}
              value={editText}
              onChangeText={setEditText}
              multiline
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEditingSegment(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveEdit}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Export Format Modal */}
      <Modal visible={showExport} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Export Transcript</Text>
            {EXPORT_FORMATS.map(fmt => (
              <TouchableOpacity
                key={fmt}
                style={styles.exportOption}
                onPress={() => handleExport(fmt)}
              >
                <Text style={styles.exportOptionText}>{getFormatLabel(fmt)}</Text>
                <Text style={styles.exportOptionExt}>.{fmt}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setShowExport(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  viewToggle: {
    flexDirection: 'row',
    gap: 6,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  actionBtnText: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 4,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 10,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#333',
  },
  searchCount: {
    color: '#888',
    fontSize: 12,
  },
  toggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
  },
  toggleBtnActive: {
    backgroundColor: '#1A3040',
    borderColor: '#4FC3F7',
  },
  toggleText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#4FC3F7',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  modalTimestamp: {
    fontSize: 12,
    color: '#888',
    marginBottom: 12,
    fontVariant: ['tabular-nums'],
  },
  editInput: {
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#333',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '600',
  },
  modalSaveBtn: {
    flex: 1,
    backgroundColor: '#4FC3F7',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  modalSaveText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
  exportOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  exportOptionText: {
    color: '#fff',
    fontSize: 16,
  },
  exportOptionExt: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'SF Mono',
  },
});
