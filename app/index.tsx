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
import { UrlIngestPanel } from '../src/components/UrlIngestPanel';
// SystemAudioPanel removed — system audio capture deferred to future release
import { useTranscriptStore } from '../src/stores/useTranscriptStore';
import { useSettingsStore } from '../src/stores/useSettingsStore';
import { runOnJS } from 'react-native-reanimated';
import {
  getTranscriptionService,
  type TranscriptionService,
} from '../src/services/transcriptionService';
import { getVibrationService } from '../src/services/vibrationService';
import { getPowerManager, type PowerMode } from '../src/services/powerManager';
import { getSpeakerService } from '../src/services/speakerService';
import { getSignLanguageService } from '../src/services/signLanguageService';
// URL mode uses WebView + mic transcription, no separate ingest service needed
import * as db from '../src/services/database';
import { getCaptionNetworkService } from '../src/services/captionNetworkService';
import type { TranscriptSegment } from '../src/types';

type AudioSourceMode = 'microphone' | 'url';

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
  const [sourceMode, setSourceMode] = useState<AudioSourceMode>('microphone');
  const [showRewind, setShowRewind] = useState(false);
  const [speechPace, setSpeechPace] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [powerMode, setPowerMode] = useState<PowerMode>('full');
  const lastPartialTimeRef = useRef(Date.now());
  const wordCountRef = useRef(0);
  // systemAudioActive state removed — system audio deferred

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

  // Face-anchored caption position
  const faceBounds = settings.cameraEnabled && settings.anchorCaptionsToFace
    ? speakerService.getActiveSpeakerBounds()
    : null;

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

    // Configure from settings
    service.configure({ ...settings.transcription });
    service.configureTranslation(settings.translation);

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

    // Apply power manager recommendations
    const pm = getPowerManager();
    const powerRec = pm.getRecommendations();

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

      // Vibration grammar — detect punctuation patterns in final segments
      if (segment.isFinal) {
        vibration.onSegmentText(segment.text);
      }

      addSegment(segment);

      // Broadcast to caption network receivers (if hosting)
      getCaptionNetworkService().broadcast(segment);

      // Auto-save segment to database
      if (settings.autoSaveSession) {
        db.saveSegment(sessionId, segment).catch(console.error);
      }
    });

    // Register segment update callback (same slice re-transcribed → update in place)
    service.onSegmentUpdate((id: string, text: string, translatedText?: string) => {
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

    // Register partial result callback for live streaming captions + pace tracking
    service.onPartialResult((text) => {
      setCurrentText(text);

      // Track speech pace (words per minute) from partial updates
      const now = Date.now();
      const words = text.trim().split(/\s+/).length;
      const elapsed = (now - lastPartialTimeRef.current) / 1000; // seconds

      if (elapsed > 0.5 && words > wordCountRef.current) {
        const newWords = words - wordCountRef.current;
        const wpm = (newWords / elapsed) * 60;
        if (wpm < 80) setSpeechPace('slow');
        else if (wpm > 180) setSpeechPace('fast');
        else setSpeechPace('normal');
      }

      wordCountRef.current = words;
      lastPartialTimeRef.current = now;
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
        // Show in live caption area
        setCurrentText(`🤟 ${segment.text}`);
        addSegment(segment);
        if (settings.autoSaveSession) {
          db.saveSegment(sessionId, segment).catch(console.error);
        }
      });
    }

    try {
      // Start transcription — mic mode or system audio mode
      // In saver mode, skip amplitude capture to save battery
      await service.start(undefined, sourceMode, !powerRec.enableAmplitude);
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
    setShowRewind(false);
    setSpeechPace('normal');
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

  // URL mode: transcription handled by mic (same as microphone mode)
  // WebView plays the media, mic picks up the audio

  // Start power manager + cleanup on unmount
  useEffect(() => {
    const pm = getPowerManager();
    pm.start();
    const unsub = pm.onModeChange(setPowerMode);
    return () => {
      unsub();
      pm.stop();
      serviceRef.current?.stop();
      speakerService.stop();
      getSignLanguageService().stop();
    };
  }, [speakerService]);

  // Audio level indicator width (0-100%)
  const levelWidth = Math.max(0, Math.min(100, ((audioLevel + 60) / 60) * 100));

  // Speech intensity classification for visual indicator
  const getSpeechIntensity = (): { label: string; color: string; bgColor: string } => {
    if (audioLevel <= -50) return { label: 'Silent', color: '#555', bgColor: '#1A1A1A' };
    if (audioLevel <= -35) return { label: 'Quiet', color: '#81C784', bgColor: '#1A2E1A' };
    if (audioLevel <= -20) return { label: 'Normal', color: '#4FC3F7', bgColor: '#1A2A3A' };
    return { label: 'Loud', color: '#E53935', bgColor: '#3A1A1A' };
  };
  const intensity = isActive ? getSpeechIntensity() : null;

  return (
    <View style={styles.container}>
      {/* Camera face detector (small preview in corner) — only in mic mode */}
      {(settings.cameraEnabled || settings.signLanguage.enabled) && isActive && sourceMode === 'microphone' && (
        <CameraFaceDetector
          cameraPosition={settings.cameraPosition}
          isActive={isActive}
          showPreview={settings.cameraEnabled}
          signLanguageEnabled={settings.signLanguage.enabled}
        />
      )}

      {/* URL Player — single instance, persists across idle/active to keep WebView state */}
      {sourceMode === 'url' && (
        <View style={styles.urlSection}>
          {/* Compact source switcher */}
          {!isActive && (
            <View style={styles.urlSourceRow}>
              <TouchableOpacity
                style={styles.sourceChip}
                onPress={() => setSourceMode('microphone')}
              >
                <Text style={styles.sourceChipText}>Microphone</Text>
              </TouchableOpacity>
              <View style={[styles.sourceChip, styles.sourceChipActive]}>
                <Text style={[styles.sourceChipText, styles.sourceChipTextActive]}>URL / Video</Text>
              </View>
            </View>
          )}
          <UrlIngestPanel
            language={settings.transcription.language}
            translationEnabled={settings.translation.enabled}
            translationTarget={settings.translation.targetLanguage}
            onTranscriptReady={() => {}}
          />
          {/* Live captions below video when active */}
          {isActive && currentText.trim() !== '' && (
            <View style={styles.urlCaptionBar}>
              <Text style={styles.urlCaptionText} numberOfLines={3}>
                {currentText}
              </Text>
            </View>
          )}
          {isActive && segments.length > 0 && (
            <ScrollView style={styles.urlTranscriptScroll} showsVerticalScrollIndicator={false}>
              {segments.slice(-8).map((seg) => (
                <Text key={seg.id} style={styles.urlTranscriptLine}>
                  <Text style={styles.urlTranscriptTime}>
                    {Math.floor((seg.startMs || 0) / 60000).toString().padStart(2, '0')}:
                    {Math.floor(((seg.startMs || 0) % 60000) / 1000).toString().padStart(2, '0')}
                  </Text>
                  {'  '}{seg.translatedText || seg.text}
                </Text>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* Rewind overlay — last 5 seconds of segments */}
      {showRewind && isActive && sourceMode !== 'url' && (
        <View style={styles.rewindOverlay}>
          <Text style={styles.rewindTitle}>Last 5 seconds</Text>
          {segments
            .filter(s => s.endMs >= (segments.length > 0 ? segments[segments.length - 1].endMs : 0) - 5000)
            .slice(-5)
            .map(seg => (
              <Text key={seg.id} style={styles.rewindSegText}>
                {seg.translatedText || seg.text}
              </Text>
            ))}
          {segments.filter(s => s.endMs >= (segments.length > 0 ? segments[segments.length - 1].endMs : 0) - 5000).length === 0 && (
            <Text style={styles.rewindEmpty}>No recent captions</Text>
          )}
        </View>
      )}

      {/* Caption display area — pinch to zoom (hidden in URL mode) */}
      {sourceMode !== 'url' && (
      <GestureDetector gesture={pinchGesture}>
      <View style={styles.captionArea}>
        {/* Live caption text */}
        {isActive && currentText.trim() !== '' && (
          <View style={[
            styles.liveCaptionContainer,
            faceBounds && {
              position: 'absolute',
              top: faceBounds.y * height + faceBounds.height * height + 8,
              left: Math.max(8, faceBounds.x * width - 40),
              right: undefined,
              maxWidth: width * 0.8,
            },
          ]}>
            {currentSpeaker && (
              <Text style={[styles.liveSpeakerLabel, currentSpeaker.color ? { color: currentSpeaker.color } : null]}>
                {currentSpeaker.label}
              </Text>
            )}
            <Text
              style={[
                styles.liveCaptionText,
                {
                  fontSize: speechPace === 'fast'
                    ? settings.caption.fontSize * 0.85
                    : speechPace === 'slow'
                    ? settings.caption.fontSize * 1.1
                    : settings.caption.fontSize,
                  letterSpacing: speechPace === 'fast' ? -0.5 : speechPace === 'slow' ? 1 : 0,
                },
                currentSpeaker?.color ? { color: currentSpeaker.color } : null,
              ]}
              numberOfLines={settings.caption.maxLines}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`Caption: ${currentText}`}
            >
              {currentText}
            </Text>
            {speechPace !== 'normal' && (
              <Text style={[styles.paceIndicator, { color: speechPace === 'fast' ? '#FFB74D' : '#81C784' }]}>
                {speechPace === 'fast' ? 'Fast speech' : 'Slow / emphatic'}
              </Text>
            )}
            {settings.translation.enabled && latestSegment?.translatedText && latestSegment.translatedText !== latestSegment.text && (
              <Text style={[styles.liveOriginalText, { fontSize: settings.caption.fontSize * 0.45 }]}>
                {latestSegment.text}
              </Text>
            )}
          </View>
        )}

        {/* Status indicator */}
        {status === 'loading-model' && (
          <View style={styles.statusBanner}>
            <Text style={styles.statusText}>Initializing...</Text>
          </View>
        )}

        {status === 'error' && (
          <View style={[styles.statusBanner, styles.errorBanner]}>
            <Text style={[styles.statusText, styles.errorText]}>
              Error — check microphone permissions
            </Text>
          </View>
        )}

        {status === 'idle' && !isActive && (sourceMode as string) !== 'url' && (
          <ScrollView
            style={styles.idleScroll}
            contentContainerStyle={styles.idleScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.idleTitle}>A.EYE.ECHO</Text>
            <Text style={styles.idleSubtitle}>
              {sourceMode === 'microphone' && 'Tap Start to begin live captioning'}
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
                style={[styles.sourceChip, (sourceMode as string) === 'url' && styles.sourceChipActive]}
                onPress={() => setSourceMode('url')}
              >
                <Text style={[styles.sourceChipText, (sourceMode as string) === 'url' && styles.sourceChipTextActive]}>
                  URL / Video
                </Text>
              </TouchableOpacity>
            </View>

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
      )}

      {/* Bottom controls */}
      <View style={styles.controls}>
        {/* Speech intensity indicator */}
        {isActive && intensity && (
          <View style={[styles.intensityContainer, { backgroundColor: intensity.bgColor }]}>
            <View style={[styles.levelBar, { width: `${levelWidth}%`, backgroundColor: intensity.color }]} />
            <Text style={[styles.intensityLabel, { color: intensity.color }]}>
              {intensity.label}
            </Text>
          </View>
        )}

        {/* Speaker indicator + Rewind button */}
        {isActive && (
          <View style={styles.indicatorRow}>
            {currentSpeaker && (
              <Text style={[styles.speakerIndicator, { color: currentSpeaker.color }]}>
                {currentSpeaker.label} speaking
              </Text>
            )}
            <TouchableOpacity
              style={[styles.rewindBtn, showRewind && styles.rewindBtnActive]}
              onPress={() => setShowRewind(v => !v)}
              accessibilityLabel="Show last 5 seconds"
            >
              <Text style={[styles.rewindBtnText, showRewind && styles.rewindBtnTextActive]}>
                Rewind
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Start/Stop button — always visible, transcribes via mic in all modes */}
        {(
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

        {/* Segment count + power mode */}
        {isActive && (
          <View style={styles.statusRow}>
            <Text style={styles.segmentCount}>
              {segments.length} segment{segments.length !== 1 ? 's' : ''}
            </Text>
            {powerMode !== 'full' && (
              <Text style={[styles.powerBadge, powerMode === 'saver' && styles.powerBadgeSaver]}>
                {powerMode === 'saver' ? 'Battery Saver' : 'Balanced'}
              </Text>
            )}
          </View>
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
  paceIndicator: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.7,
    marginTop: 4,
  },
  liveOriginalText: {
    color: '#4FC3F7',
    opacity: 0.7,
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
    paddingBottom: 10,
    paddingTop: 4,
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0A0A0A',
  },
  intensityContainer: {
    width: '100%',
    height: 20,
    borderRadius: 6,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  levelBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: '100%',
    borderRadius: 6,
    opacity: 0.3,
  },
  intensityLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
    width: '100%',
  },
  indicatorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  speakerIndicator: {
    fontSize: 13,
    fontWeight: '600',
  },
  rewindBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
  },
  rewindBtnActive: {
    backgroundColor: '#1A3040',
    borderColor: '#4FC3F7',
  },
  rewindBtnText: {
    color: '#666',
    fontSize: 11,
    fontWeight: '600',
  },
  rewindBtnTextActive: {
    color: '#4FC3F7',
  },
  rewindOverlay: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(10, 10, 20, 0.95)',
    borderRadius: 12,
    padding: 14,
    zIndex: 10,
    borderWidth: 1,
    borderColor: '#4FC3F7',
    gap: 6,
  },
  rewindTitle: {
    color: '#4FC3F7',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  rewindSegText: {
    color: '#DDD',
    fontSize: 15,
    lineHeight: 20,
  },
  rewindEmpty: {
    color: '#555',
    fontSize: 13,
    fontStyle: 'italic',
  },
  mainButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
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
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  segmentCount: {
    color: '#666',
    fontSize: 11,
  },
  powerBadge: {
    color: '#FFB74D',
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: '#2A1F0A',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  powerBadgeSaver: {
    color: '#E53935',
    backgroundColor: '#2A0A0A',
  },
  urlSection: {
    flex: 1,
  },
  urlSourceRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  urlCaptionBar: {
    backgroundColor: 'rgba(26, 26, 46, 0.9)',
    marginHorizontal: 16,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  urlCaptionText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  urlTranscriptScroll: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 4,
  },
  urlTranscriptLine: {
    color: '#CCC',
    fontSize: 13,
    lineHeight: 20,
    paddingVertical: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
  },
  urlTranscriptTime: {
    color: '#666',
    fontSize: 11,
  },
});
