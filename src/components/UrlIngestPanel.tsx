// ============================================================================
// URL Ingest Panel — Paste a video/audio URL to transcribe
//
// Supports: YouTube, direct video/audio URLs, HLS streams, Google Meet
// recordings, Discord clips — anything with an audio track.
//
// Shown as a collapsible panel on the Live screen when source is URL-based.
// ============================================================================

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
  Clipboard,
} from 'react-native';
import {
  getUrlIngestService,
  detectUrlType,
  type IngestProgress,
  type IngestStatus,
  type UrlType,
} from '../services/urlIngestService';
import type { WhisperLanguage } from '../types';

interface UrlIngestPanelProps {
  language: WhisperLanguage;
  translationEnabled: boolean;
  translationTarget: string;
  onTranscriptReady: () => void;
  onModelDownloadProgress?: (percent: number) => void;
}

const URL_TYPE_LABELS: Record<UrlType, string> = {
  youtube: 'YouTube',
  audio: 'Audio File',
  video: 'Video File',
  stream: 'Live Stream',
  unknown: 'URL',
};

const STATUS_LABELS: Record<IngestStatus, string> = {
  idle: '',
  resolving: 'Resolving URL...',
  downloading: 'Downloading media...',
  extracting: 'Preparing audio...',
  transcribing: 'Transcribing...',
  complete: 'Done!',
  error: 'Error',
};

export function UrlIngestPanel({
  language,
  translationEnabled,
  translationTarget,
  onTranscriptReady,
  onModelDownloadProgress,
}: UrlIngestPanelProps) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<IngestStatus>('idle');
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [detectedType, setDetectedType] = useState<UrlType>('unknown');

  const handleUrlChange = useCallback((text: string) => {
    setUrl(text.trim());
    if (text.trim()) {
      setDetectedType(detectUrlType(text.trim()));
    } else {
      setDetectedType('unknown');
    }
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      const text = await Clipboard.getString();
      if (text) {
        handleUrlChange(text);
      }
    } catch {
      // Clipboard access may be denied
    }
  }, [handleUrlChange]);

  const handleStart = useCallback(async () => {
    if (!url) return;

    const service = getUrlIngestService();
    service.configure({
      language,
      translationEnabled,
      translationTarget,
    });

    service.onStatusChange((s) => setStatus(s));
    service.onProgress((p) => setProgress(p));
    service.onTranscript(() => {
      // Segments are emitted to the transcript store by the Live screen
    });

    try {
      await service.ingest(url, onModelDownloadProgress);
      onTranscriptReady();
    } catch (err) {
      Alert.alert('Ingest Failed', String(err));
    }
  }, [url, language, translationEnabled, translationTarget, onModelDownloadProgress, onTranscriptReady]);

  const handleCancel = useCallback(() => {
    getUrlIngestService().cancel();
    setStatus('idle');
    setProgress(null);
  }, []);

  const isProcessing = status !== 'idle' && status !== 'complete' && status !== 'error';
  const showProgress = isProcessing && progress;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Transcribe from URL</Text>
      <Text style={styles.subtitle}>
        Paste a video or audio URL to transcribe and translate
      </Text>

      {/* URL input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.urlInput}
          placeholder="https://youtube.com/watch?v=..."
          placeholderTextColor="#444"
          value={url}
          onChangeText={handleUrlChange}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={!isProcessing}
          accessible
          accessibilityLabel="Video or audio URL"
        />
        <TouchableOpacity
          style={styles.pasteButton}
          onPress={handlePaste}
          disabled={isProcessing}
        >
          <Text style={styles.pasteText}>Paste</Text>
        </TouchableOpacity>
      </View>

      {/* Detected URL type badge */}
      {url.length > 0 && (
        <View style={styles.detectedRow}>
          <View style={[styles.typeBadge, detectedType === 'youtube' && styles.youtubeBadge]}>
            <Text style={[styles.typeBadgeText, detectedType === 'youtube' && styles.youtubeText]}>
              {URL_TYPE_LABELS[detectedType]}
            </Text>
          </View>
          {detectedType === 'youtube' && (
            <Text style={styles.noteText}>
              Audio will be extracted automatically
            </Text>
          )}
        </View>
      )}

      {/* Progress */}
      {showProgress && progress && (
        <View style={styles.progressSection}>
          <Text style={styles.statusText}>{STATUS_LABELS[status]}</Text>

          {/* Download progress bar */}
          {(status === 'downloading' || status === 'resolving') && (
            <View style={styles.progressBar}>
              <View
                style={[styles.progressFill, { width: `${progress.downloadPercent}%` }]}
              />
            </View>
          )}

          {/* Transcription progress bar */}
          {status === 'transcribing' && (
            <>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    styles.transcribeProgressFill,
                    { width: `${progress.transcribePercent}%` },
                  ]}
                />
              </View>
              {progress.totalDurationSec != null && (
                <Text style={styles.progressDetail}>
                  {Math.round(progress.currentChunkSec)}s / {Math.round(progress.totalDurationSec)}s
                </Text>
              )}
            </>
          )}
        </View>
      )}

      {/* Error */}
      {status === 'error' && progress?.error && (
        <Text style={styles.errorText}>{progress.error}</Text>
      )}

      {/* Action buttons */}
      <View style={styles.actionRow}>
        {isProcessing ? (
          <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.startButton, !url && styles.startButtonDisabled]}
            onPress={handleStart}
            disabled={!url}
          >
            <Text style={styles.startText}>
              {status === 'complete' ? 'Transcribe Again' : 'Transcribe'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Supported sources hint */}
      <Text style={styles.hintText}>
        Supports: YouTube, MP4, MP3, WAV, HLS streams, and more
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 20,
    margin: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#222',
  },
  title: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    color: '#888',
    fontSize: 14,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  urlInput: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    color: '#FFF',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pasteButton: {
    backgroundColor: '#1A3A4A',
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: 'center',
  },
  pasteText: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '600',
  },
  detectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeBadge: {
    backgroundColor: '#252525',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  youtubeBadge: {
    backgroundColor: '#3A1A1A',
  },
  typeBadgeText: {
    color: '#999',
    fontSize: 12,
    fontWeight: '600',
  },
  youtubeText: {
    color: '#E53935',
  },
  noteText: {
    color: '#666',
    fontSize: 12,
  },
  progressSection: {
    gap: 6,
  },
  statusText: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '600',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#222',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4FC3F7',
    borderRadius: 3,
  },
  transcribeProgressFill: {
    backgroundColor: '#81C784',
  },
  progressDetail: {
    color: '#666',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  errorText: {
    color: '#E53935',
    fontSize: 13,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  startButton: {
    backgroundColor: '#4FC3F7',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 10,
  },
  startButtonDisabled: {
    opacity: 0.4,
  },
  startText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButton: {
    backgroundColor: '#333',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 10,
  },
  cancelText: {
    color: '#E53935',
    fontSize: 16,
    fontWeight: '600',
  },
  hintText: {
    color: '#444',
    fontSize: 11,
    textAlign: 'center',
  },
});
