// ============================================================================
// Live Screen — Primary caption display with one-tap start
// Phase 2: Full native pipeline — Whisper + mic capture + camera face detection
//
// "No access = no participation" — this screen must be dead simple.
//
// Layout:
//   - Full-screen caption display area (majority of screen)
//   - Camera preview (small corner, when enabled)
//   - Model download modal (first-time setup)
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
import { CameraFaceDetector } from '../src/components/CameraFaceDetector';
import { ModelDownloadModal } from '../src/components/ModelDownloadModal';
import { useTranscriptStore } from '../src/stores/useTranscriptStore';
import { useSettingsStore } from '../src/stores/useSettingsStore';
import {
  getTranscriptionService,
  type TranscriptionService,
} from '../src/services/transcriptionService';
import { getVibrationService } from '../src/services/vibrationService';
import { getSpeakerService } from '../src/services/speakerService';
import * as db from '../src/services/database';
import type { TranscriptSegment } from '../src/types';

export default function LiveScreen() {
  const { width, height } = useWindowDimensions();
  const { settings } = useSettingsStore();
  const {
    status,
    currentText,
    speakers,
    segments,
    currentSession,
    setStatus,
    startSession,
    endSession,
    addSegment,
    addOrUpdateSpeaker,
  } = useTranscriptStore();

  const [audioLevel, setAudioLevel] = useState(-Infinity);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);

  const serviceRef = useRef<TranscriptionService | null>(null);

  // Current speaker from most recent segment or camera detection
  const speakerService = getSpeakerService();
  const activeSpeaker = settings.cameraEnabled
    ? speakerService.getActiveSpeaker()?.speaker ?? null
    : null;

  const currentSpeaker = activeSpeaker
    ?? (segments.length > 0
      ? speakers.find(s => s.id === segments[segments.length - 1].speakerId)
      : null)
    ?? null;

  const isActive = status === 'active' || status === 'loading-model';

  const handleStart = useCallback(async () => {
    const service = getTranscriptionService();
    serviceRef.current = service;

    // Configure from settings
    service.configure(settings.transcription);

    // Start session
    const sessionId = `session_${Date.now()}`;
    startSession({
      id: sessionId,
      title: new Date().toLocaleString(),
      startedAt: new Date().toISOString(),
      audioSource: settings.transcription.source,
      modelUsed: settings.transcription.modelSize,
    });

    // Set up vibration service
    const vibration = getVibrationService();
    vibration.configure(settings.vibration);

    // Register transcript callback
    service.onTranscript((segment: TranscriptSegment) => {
      // Attach speaker from camera if available
      if (settings.cameraEnabled) {
        const active = speakerService.getActiveSpeaker();
        if (active) {
          segment = { ...segment, speakerId: active.speakerId };
          addOrUpdateSpeaker(active.speakerId, active.speaker);
          vibration.onSpeakerChange(active.speakerId);
        }
      }

      addSegment(segment);

      // Auto-save segment to database
      if (settings.autoSaveSession) {
        db.saveSegment(sessionId, segment).catch(console.error);
      }
    });

    service.onStatusChange(setStatus);

    service.onAmplitude((rmsDb) => {
      setAudioLevel(rmsDb);
      vibration.onAmplitude(rmsDb);

      // Feed amplitude to speaker service for lip-sync correlation
      if (settings.cameraEnabled) {
        speakerService.feedAudioAmplitude(rmsDb);
      }
    });

    // Start camera-based speaker detection if enabled
    if (settings.cameraEnabled) {
      speakerService.start(settings.cameraPosition);
    }

    try {
      // Start transcription — handles model download, Whisper init, mic capture
      await service.start((percent) => {
        setIsDownloading(true);
        setDownloadProgress(percent);
      });
      setIsDownloading(false);
    } catch (err) {
      console.error('[LiveScreen] Start failed:', err);
      setIsDownloading(false);
      endSession();
    }
  }, [settings, startSession, addSegment, setStatus, addOrUpdateSpeaker, endSession, speakerService]);

  const handleStop = useCallback(async () => {
    serviceRef.current?.stop();
    serviceRef.current = null;
    speakerService.stop();
    setAudioLevel(-Infinity);
    getVibrationService().reset();

    // Save session to database
    const { currentSession, segments, speakers } = useTranscriptStore.getState();
    if (currentSession && settings.autoSaveSession) {
      const endedSession = {
        ...currentSession,
        endedAt: new Date().toISOString(),
        segmentCount: segments.length,
        durationMs: segments.length > 0 ? segments[segments.length - 1].endMs : 0,
      };
      await db.saveSession(endedSession);
      for (const speaker of speakers) {
        await db.saveSpeaker(currentSession.id, speaker);
      }
    }

    endSession();
  }, [endSession, settings.autoSaveSession, speakerService]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      serviceRef.current?.stop();
      speakerService.stop();
    };
  }, [speakerService]);

  // Audio level indicator width (0-100%)
  const levelWidth = Math.max(0, Math.min(100, ((audioLevel + 60) / 60) * 100));

  return (
    <View style={styles.container}>
      {/* Model download modal */}
      <ModelDownloadModal
        visible={isDownloading}
        modelId={settings.transcription.modelSize}
        progress={downloadProgress}
      />

      {/* Camera face detector (small preview in corner) */}
      {settings.cameraEnabled && isActive && (
        <CameraFaceDetector
          cameraPosition={settings.cameraPosition}
          isActive={isActive}
          showPreview={true}
        />
      )}

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
        {status === 'loading-model' && !isDownloading && (
          <View style={styles.statusBanner}>
            <Text style={styles.statusText}>Initializing Whisper...</Text>
          </View>
        )}

        {status === 'error' && (
          <View style={[styles.statusBanner, styles.errorBanner]}>
            <Text style={[styles.statusText, styles.errorText]}>
              Error — check microphone permissions
            </Text>
          </View>
        )}

        {status === 'idle' && !isActive && (
          <View style={styles.idlePrompt}>
            <Text style={styles.idleTitle}>CaptionCast</Text>
            <Text style={styles.idleSubtitle}>
              Tap Start to begin live captioning
            </Text>
            <Text style={styles.idleModel}>
              Model: {settings.transcription.modelSize}
              {settings.cameraEnabled ? ' + Camera' : ''}
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

        {/* Speaker indicator */}
        {isActive && currentSpeaker && (
          <Text style={[styles.speakerIndicator, { color: currentSpeaker.color }]}>
            {currentSpeaker.label} speaking
          </Text>
        )}

        {/* Start/Stop button */}
        <TouchableOpacity
          style={[styles.mainButton, isActive && styles.mainButtonActive]}
          onPress={isActive ? handleStop : handleStart}
          activeOpacity={0.7}
          accessible
          accessibilityRole="button"
          accessibilityLabel={isActive ? 'Stop captioning' : 'Start captioning'}
          accessibilityHint={
            isActive
              ? 'Double tap to stop live captioning'
              : 'Double tap to start live captioning from microphone'
          }
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
  errorBanner: {
    backgroundColor: '#4A1A1A',
  },
  statusText: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    color: '#E53935',
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
  idleModel: {
    color: '#555',
    fontSize: 13,
    marginTop: 16,
  },
  controls: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    paddingTop: 12,
    alignItems: 'center',
    gap: 10,
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
  speakerIndicator: {
    fontSize: 13,
    fontWeight: '600',
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
