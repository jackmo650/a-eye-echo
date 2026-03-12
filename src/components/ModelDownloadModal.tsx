// ============================================================================
// Model Download Modal — Shows download progress when Whisper model is needed
// Provides clear feedback during first-time setup or model switching.
// ============================================================================

import React from 'react';
import { View, Text, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import type { WhisperModel } from '../types';
import { WHISPER_MODELS } from '../types/defaults';

interface ModelDownloadModalProps {
  visible: boolean;
  modelId: WhisperModel;
  progress: number; // 0-100
}

export function ModelDownloadModal({
  visible,
  modelId,
  progress,
}: ModelDownloadModalProps) {
  const modelInfo = WHISPER_MODELS[modelId];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color="#4FC3F7" />
          <Text style={styles.title}>Downloading Model</Text>
          <Text style={styles.subtitle}>
            {modelInfo.label} ({modelInfo.size})
          </Text>
          <Text style={styles.description}>
            First-time setup — this only happens once per model.
          </Text>

          {/* Progress bar */}
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { width: `${Math.min(100, progress)}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {Math.round(progress)}%
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
    gap: 12,
  },
  title: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 8,
  },
  subtitle: {
    color: '#4FC3F7',
    fontSize: 16,
    fontWeight: '600',
  },
  description: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
  },
  progressContainer: {
    width: '100%',
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 8,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#4FC3F7',
    borderRadius: 3,
  },
  progressText: {
    color: '#888',
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
});
