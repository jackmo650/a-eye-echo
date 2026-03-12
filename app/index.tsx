// ============================================================================
// Live Screen — Primary caption display with one-tap start
// "No access = no participation" — this screen must be dead simple.
//
// Layout:
//   - Full-screen caption display area (majority of screen)
//   - Big Start/Stop button at bottom
//   - Audio level indicator
//   - Speaker indicator (when camera enabled)
// ============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { CaptionDisplay } from '../src/components/CaptionDisplay';
import { useTranscriptStore } from '../src/stores/useTranscriptStore';
import { useSettingsStore } from '../src/stores/useSettingsStore';
import {
  getTranscriptionService,
  type TranscriptionService,
} from '../src/services/transcriptionService';
import { getVibrationService } from '../src/services/vibrationService';
import type { TranscriptSegment } from '../src/types';

export default function LiveScreen() {
  const { width, height } = useWindowDimensions();
  const { settings } = useSettingsStore();
  const {
    status,
    currentText,
    speakers,
    segments,
    setStatus,
    startSession,
    endSession,
    addSegment,
    setCurrentText,
    addOrUpdateSpeaker,
  } = useTranscriptStore();

  const [audioLevel, setAudioLevel] = useState(-Infinity);
  const serviceRef = useRef<TranscriptionService | null>(null);

  // Current speaker from most recent segment
  const currentSpeaker = segments.length > 0
    ? speakers.find(s => s.id === segments[segments.length - 1].speakerId)
    : null;

  const isActive = status === 'active' || status === 'loading-model';

  const handleStart = useCallback(async () => {
    const service = getTranscriptionService();
    serviceRef.current = service;

    // Configure from settings
    service.configure(settings.transcription);

    // Start session
    startSession({
      id: `session_${Date.now()}`,
      title: new Date().toLocaleString(),
      startedAt: new Date().toISOString(),
      audioSource: settings.transcription.source,
      modelUsed: settings.transcription.modelSize,
    });

    // Register callbacks
    const vibration = getVibrationService();
    vibration.configure(settings.vibration);

    service.onTranscript((segment: TranscriptSegment) => {
      addSegment(segment);

      if (segment.speakerId) {
        const speaker = addOrUpdateSpeaker(segment.speakerId);
        vibration.onSpeakerChange(speaker.id);
      }
    });

    service.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    service.onAmplitude((rmsDb) => {
      setAudioLevel(rmsDb);
      vibration.onAmplitude(rmsDb);
    });

    await service.start();
  }, [settings, startSession, addSegment, setStatus, addOrUpdateSpeaker]);

  const handleStop = useCallback(() => {
    serviceRef.current?.stop();
    serviceRef.current = null;
    endSession();
    setAudioLevel(-Infinity);
    getVibrationService().reset();
  }, [endSession]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      serviceRef.current?.stop();
    };
  }, []);

  // Audio level indicator width (0-100%)
  const levelWidth = Math.max(0, Math.min(100, ((audioLevel + 60) / 60) * 100));

  return (
    <View style={styles.container}>
      {/* Caption display area */}
      <View style={styles.captionArea}>
        <CaptionDisplay
          text={currentText}
          style={settings.caption}
          speaker={currentSpeaker}
          width={width}
          height={height - 180}
        />

        {/* Status indicator */}
        {status === 'loading-model' && (
          <View style={styles.statusBanner}>
            <Text style={styles.statusText}>Loading model...</Text>
          </View>
        )}

        {status === 'idle' && !isActive && (
          <View style={styles.idlePrompt}>
            <Text style={styles.idleTitle}>CaptionCast</Text>
            <Text style={styles.idleSubtitle}>
              Tap Start to begin live captioning
            </Text>
          </View>
        )}
      </View>

      {/* Bottom controls */}
      <View style={styles.controls}>
        {/* Audio level bar */}
        {isActive && (
          <View style={styles.levelContainer}>
            <View style={[styles.levelBar, { width: `${levelWidth}%` }]} />
          </View>
        )}

        {/* Start/Stop button */}
        <TouchableOpacity
          style={[styles.mainButton, isActive && styles.mainButtonActive]}
          onPress={isActive ? handleStop : handleStart}
          activeOpacity={0.7}
          accessible
          accessibilityRole="button"
          accessibilityLabel={isActive ? 'Stop captioning' : 'Start captioning'}
        >
          <Text style={styles.mainButtonText}>
            {isActive ? 'STOP' : 'START'}
          </Text>
        </TouchableOpacity>

        {/* Segment count */}
        {isActive && (
          <Text style={styles.segmentCount}>
            {segments.length} segment{segments.length !== 1 ? 's' : ''}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  captionArea: {
    flex: 1,
    position: 'relative',
  },
  statusBanner: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    backgroundColor: '#333',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  statusText: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '600',
  },
  idlePrompt: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  idleTitle: {
    color: '#FFF',
    fontSize: 36,
    fontWeight: '700',
    marginBottom: 12,
  },
  idleSubtitle: {
    color: '#888',
    fontSize: 18,
    textAlign: 'center',
  },
  controls: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    paddingTop: 12,
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0A0A0A',
  },
  levelContainer: {
    width: '100%',
    height: 4,
    backgroundColor: '#222',
    borderRadius: 2,
    overflow: 'hidden',
  },
  levelBar: {
    height: '100%',
    backgroundColor: '#4FC3F7',
    borderRadius: 2,
  },
  mainButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#4FC3F7',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#4FC3F7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  mainButtonActive: {
    backgroundColor: '#E53935',
    shadowColor: '#E53935',
  },
  mainButtonText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 2,
  },
  segmentCount: {
    color: '#666',
    fontSize: 13,
  },
});
