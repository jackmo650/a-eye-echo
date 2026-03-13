// ============================================================================
// Live Screen — Primary caption display with one-tap start
// Phase 3: Multi-language, translation, sign language recognition
// Phase 4: URL ingest, system audio capture, source selector
//
// "No access = no participation" — this screen must be dead simple.
//
// Layout:
//   - Source selector chips (Mic / URL / App Audio)
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
  ScrollView,
  Alert,
  useWindowDimensions,
} from 'react-native';
import {
  GestureDetector,
  Gesture,
} from 'react-native-gesture-handler';
import { CaptionDisplay } from '../src/components/CaptionDisplay';
import { CameraFaceDetector } from '../src/components/CameraFaceDetector';
import { ModelDownloadModal } from '../src/components/ModelDownloadModal';
import { UrlIngestPanel } from '../src/components/UrlIngestPanel';
import { SystemAudioPanel } from '../src/components/SystemAudioPanel';
import { useTranscriptStore } from '../src/stores/useTranscriptStore';
import { useSettingsStore } from '../src/stores/useSettingsStore';
import { runOnJS } from 'react-native-reanimated';
import {
  getTranscriptionService,
  type TranscriptionService,
} from '../src/services/transcriptionService';
import { getVibrationService } from '../src/services/vibrationService';
import { getSpeakerService } from '../src/services/speakerService';
import { getSignLanguageService } from '../src/services/signLanguageService';
import { getUrlIngestService } from '../src/services/urlIngestService';
import * as db from '../src/services/database';
import type { TranscriptSegment } from '../src/types';

type AudioSourceMode = 'microphone' | 'url' | 'system-audio';

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
    updateSegment,
    setCurrentText,
  } = useTranscriptStore();

  const [audioLevel, setAudioLevel] = useState(-Infinity);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [sourceMode, setSourceMode] = useState<AudioSourceMode>('microphone');
  const [systemAudioActive, setSystemAudioActive] = useState(false);

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

  // Get the latest segment for translation display
  const latestSegment = segments.length > 0 ? segments[segments.length - 1] : null;

  // Pinch-to-zoom font size
  const { setFontSize } = useSettingsStore();
  const baseFontSizeRef = useRef(settings.caption.fontSize);

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      baseFontSizeRef.current = settings.caption.fontSize;
    })
    .onUpdate((e) => {
      const newSize = Math.round(baseFontSizeRef.current * e.scale);
      const clamped = Math.max(24, Math.min(120, newSize));
      runOnJS(setFontSize)(clamped);
    });

  const handleStart = useCallback(async () => {
    const service = getTranscriptionService();
    serviceRef.current = service;

    // Configure from settings, overriding source based on selected mode
    const sourceOverride = sourceMode === 'system-audio'
      ? { type: 'system-audio' as const }
      : settings.transcription.source;
    service.configure({ ...settings.transcription, source: sourceOverride });
    service.configureTranslation(settings.translation);

    // Start session
    const sessionId = `session_${Date.now()}`;
    startSession({
      id: sessionId,
      title: new Date().toLocaleString(),
      startedAt: new Date().toISOString(),
      audioSource: sourceOverride,
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

    // Register segment update callback (same slice re-transcribed → update in place)
    service.onSegmentUpdate((id, text, translatedText) => {
      updateSegment(id, text, translatedText);
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

    // Register partial result callback for live streaming captions
    service.onPartialResult((text) => {
      setCurrentText(text);
    });

    // Start camera-based speaker detection if enabled
    if (settings.cameraEnabled) {
      speakerService.start(settings.cameraPosition);
    }

    // Start sign language recognition if enabled
    if (settings.signLanguage.enabled) {
      const signService = getSignLanguageService();
      signService.start(settings.signLanguage.language, Date.now());
      signService.onRecognition((segment: TranscriptSegment) => {
        addSegment(segment);
        if (settings.autoSaveSession) {
          db.saveSegment(sessionId, segment).catch(console.error);
        }
      });
    }

    try {
      // Start transcription — uses native speech recognition (no model download)
      await service.start();
    } catch (err: any) {
      console.error('[LiveScreen] Start failed:', err);
      endSession();
      const msg = err?.message || String(err);
      if (msg.includes('not available') || msg.includes('not granted') || msg.includes('is null')) {
        Alert.alert(
          'Speech Recognition Unavailable',
          'Live transcription requires speech recognition and microphone permissions. ' +
          'Please enable them in Settings, or ensure you are running a development build.',
          [{ text: 'OK' }],
        );
      } else {
        Alert.alert('Start Failed', msg, [{ text: 'OK' }]);
      }
    }
  }, [settings, sourceMode, startSession, addSegment, updateSegment, setStatus, setCurrentText, addOrUpdateSpeaker, endSession, speakerService]);

  const handleStop = useCallback(async () => {
    serviceRef.current?.stop();
    serviceRef.current = null;
    speakerService.stop();
    getSignLanguageService().stop();
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

  // Wire URL ingest service transcript output into the store
  useEffect(() => {
    if (sourceMode !== 'url') return;

    const ingestService = getUrlIngestService();
    const unsub = ingestService.onTranscript((segment: TranscriptSegment) => {
      addSegment(segment);
    });
    return unsub;
  }, [sourceMode, addSegment]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      serviceRef.current?.stop();
      speakerService.stop();
      getSignLanguageService().stop();
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

      {/* Caption display area — pinch to zoom */}
      <GestureDetector gesture={pinchGesture}>
      <View style={styles.captionArea}>
        {/* Live caption text */}
        {isActive && currentText.trim() !== '' && (
          <View style={styles.liveCaptionContainer}>
            {currentSpeaker && (
              <Text style={[styles.liveSpeakerLabel, currentSpeaker.color ? { color: currentSpeaker.color } : null]}>
                {currentSpeaker.label}
              </Text>
            )}
            <Text
              style={[
                styles.liveCaptionText,
                { fontSize: settings.caption.fontSize },
                currentSpeaker?.color ? { color: currentSpeaker.color } : null,
              ]}
              numberOfLines={settings.caption.maxLines}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`Caption: ${currentText}`}
            >
              {currentText}
            </Text>
            {latestSegment?.translatedText && settings.translation.showOriginal && (
              <Text style={[styles.liveTranslatedText, { fontSize: settings.caption.fontSize * 0.6 }]}>
                {latestSegment.translatedText}
              </Text>
            )}
          </View>
        )}

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
          <ScrollView
            style={styles.idleScroll}
            contentContainerStyle={styles.idleScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.idleTitle}>A.EYE.ECHO</Text>
            <Text style={styles.idleSubtitle}>
              {sourceMode === 'microphone' && 'Tap Start to begin live captioning'}
              {sourceMode === 'url' && 'Paste a URL to transcribe video or audio'}
              {sourceMode === 'system-audio' && 'Capture audio from other apps'}
            </Text>

            {/* Source selector chips */}
            <View style={styles.sourceSelector}>
              <TouchableOpacity
                style={[styles.sourceChip, sourceMode === 'microphone' && styles.sourceChipActive]}
                onPress={() => setSourceMode('microphone')}
              >
                <Text style={[styles.sourceChipText, sourceMode === 'microphone' && styles.sourceChipTextActive]}>
                  Microphone
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sourceChip, sourceMode === 'url' && styles.sourceChipActive]}
                onPress={() => setSourceMode('url')}
              >
                <Text style={[styles.sourceChipText, sourceMode === 'url' && styles.sourceChipTextActive]}>
                  URL / Video
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sourceChip, sourceMode === 'system-audio' && styles.sourceChipActive]}
                onPress={() => setSourceMode('system-audio')}
              >
                <Text style={[styles.sourceChipText, sourceMode === 'system-audio' && styles.sourceChipTextActive]}>
                  App Audio
                </Text>
              </TouchableOpacity>
            </View>

            {/* URL Ingest Panel */}
            {sourceMode === 'url' && (
              <UrlIngestPanel
                language={settings.transcription.language}
                translationEnabled={settings.translation.enabled}
                translationTarget={settings.translation.targetLanguage}
                onTranscriptReady={() => {
                  // Segments are emitted via the service callbacks
                }}
                onModelDownloadProgress={(percent) => {
                  setIsDownloading(true);
                  setDownloadProgress(percent);
                }}
              />
            )}

            {/* System Audio Panel */}
            {sourceMode === 'system-audio' && (
              <SystemAudioPanel
                isActive={systemAudioActive}
                onCaptureStart={() => setSystemAudioActive(true)}
                onCaptureStop={() => setSystemAudioActive(false)}
              />
            )}

            {/* Model info (microphone mode) */}
            {sourceMode === 'microphone' && (
              <Text style={styles.idleModel}>
                Model: {settings.transcription.modelSize}
                {' · '}{settings.transcription.language === 'auto' ? 'Auto-detect' : settings.transcription.language.toUpperCase()}
                {settings.translation.enabled ? ` → ${settings.translation.targetLanguage.toUpperCase()}` : ''}
                {settings.cameraEnabled ? ' + Camera' : ''}
                {settings.signLanguage.enabled ? ' + Sign Language' : ''}
              </Text>
            )}
          </ScrollView>
        )}
      </View>
      </GestureDetector>

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

        {/* Start/Stop button (hidden for URL mode which has its own controls) */}
        {(sourceMode !== 'url' || isActive) && (
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
        )}

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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  liveCaptionContainer: {
    backgroundColor: 'rgba(26, 26, 46, 0.85)',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    maxWidth: '95%',
    alignItems: 'center',
  },
  liveCaptionText: {
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 62,
  },
  liveSpeakerLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4FC3F7',
    marginBottom: 4,
    opacity: 0.8,
  },
  liveTranslatedText: {
    color: '#FFFFFF',
    opacity: 0.6,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
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
  idleScroll: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  idleScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    paddingBottom: 48,
  },
  sourceSelector: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
    marginBottom: 8,
  },
  sourceChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
  },
  sourceChipActive: {
    backgroundColor: '#1A3040',
    borderColor: '#4FC3F7',
  },
  sourceChipText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  sourceChipTextActive: {
    color: '#4FC3F7',
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
    textAlign: 'center',
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
