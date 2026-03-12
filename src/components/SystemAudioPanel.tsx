// ============================================================================
// System Audio Panel — Capture audio from Google Meet, Discord, Zoom, etc.
//
// Shows platform-specific instructions and a start/stop button for
// system-wide audio capture. Feeds captured audio to the transcription
// pipeline for real-time captioning of calls and streams.
// ============================================================================

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import {
  getSystemAudioInfo,
  startSystemAudioCapture,
  stopSystemAudioCapture,
  getSystemAudioStatus,
  type SystemAudioStatus,
} from '../services/systemAudioCapture';

interface SystemAudioPanelProps {
  isActive: boolean;
  onCaptureStart: () => void;
  onCaptureStop: () => void;
}

const APP_EXAMPLES = [
  { name: 'Google Meet', icon: 'video call' },
  { name: 'Discord', icon: 'voice chat' },
  { name: 'Zoom', icon: 'meeting' },
  { name: 'FaceTime', icon: 'call' },
  { name: 'YouTube', icon: 'video' },
  { name: 'Twitch', icon: 'stream' },
];

export function SystemAudioPanel({
  isActive,
  onCaptureStart,
  onCaptureStop,
}: SystemAudioPanelProps) {
  const info = getSystemAudioInfo();
  const [status, setStatus] = useState<SystemAudioStatus>(getSystemAudioStatus());

  const handleStart = useCallback(async () => {
    try {
      setStatus('requesting');
      await startSystemAudioCapture();
      setStatus('capturing');
      onCaptureStart();
    } catch (err) {
      setStatus('error');
      Alert.alert(
        'System Audio Unavailable',
        String(err) + '\n\nTip: Place your phone near the speaker and use microphone capture instead.',
      );
    }
  }, [onCaptureStart]);

  const handleStop = useCallback(async () => {
    await stopSystemAudioCapture();
    setStatus('idle');
    onCaptureStop();
  }, [onCaptureStop]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>App Audio Capture</Text>
      <Text style={styles.subtitle}>
        Capture audio from other apps for real-time transcription
      </Text>

      {/* Supported apps */}
      <View style={styles.appGrid}>
        {APP_EXAMPLES.map(app => (
          <View key={app.name} style={styles.appChip}>
            <Text style={styles.appName}>{app.name}</Text>
          </View>
        ))}
      </View>

      {/* Platform info */}
      <View style={styles.infoBox}>
        <Text style={styles.infoLabel}>
          {Platform.OS === 'ios' ? 'iOS' : 'Android'} Requirements
        </Text>
        <Text style={styles.infoText}>{info.requirements}</Text>
        <Text style={styles.infoVersion}>{info.minOsVersion}</Text>
      </View>

      {/* How it works */}
      <View style={styles.stepsBox}>
        <Text style={styles.stepsTitle}>How it works</Text>
        {Platform.OS === 'ios' ? (
          <>
            <Text style={styles.stepText}>1. Tap "Start Capture" below</Text>
            <Text style={styles.stepText}>2. Select "A.EYE.ECHO" from the broadcast picker</Text>
            <Text style={styles.stepText}>3. Open Google Meet, Discord, or any app</Text>
            <Text style={styles.stepText}>4. Audio from that app will be live-transcribed</Text>
          </>
        ) : (
          <>
            <Text style={styles.stepText}>1. Tap "Start Capture" below</Text>
            <Text style={styles.stepText}>2. Grant audio capture permission</Text>
            <Text style={styles.stepText}>3. Open Google Meet, Discord, or any app</Text>
            <Text style={styles.stepText}>4. Audio will be captured via a notification service</Text>
          </>
        )}
      </View>

      {/* Action button */}
      {!info.isAvailable ? (
        <View style={styles.unavailableBox}>
          <Text style={styles.unavailableText}>
            System audio capture requires {info.minOsVersion}.
          </Text>
          <Text style={styles.unavailableTip}>
            Alternative: Place your phone near the speaker and use the microphone.
          </Text>
        </View>
      ) : (
        <TouchableOpacity
          style={[
            styles.captureButton,
            isActive && styles.captureButtonActive,
          ]}
          onPress={isActive ? handleStop : handleStart}
          disabled={status === 'requesting'}
        >
          <Text style={styles.captureButtonText}>
            {status === 'requesting'
              ? 'Starting...'
              : isActive
              ? 'Stop Capture'
              : 'Start Capture'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Status */}
      {isActive && (
        <View style={styles.activeIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.activeText}>
            Capturing system audio — open any app to transcribe
          </Text>
        </View>
      )}

      <Text style={styles.privacyNote}>
        Audio is processed entirely on-device. Nothing is sent to the cloud.
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
    gap: 14,
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
  appGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  appChip: {
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  appName: {
    color: '#AAA',
    fontSize: 13,
    fontWeight: '500',
  },
  infoBox: {
    backgroundColor: '#0A0A1A',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1A1A3A',
    gap: 4,
  },
  infoLabel: {
    color: '#4FC3F7',
    fontSize: 13,
    fontWeight: '700',
  },
  infoText: {
    color: '#999',
    fontSize: 13,
    lineHeight: 19,
  },
  infoVersion: {
    color: '#666',
    fontSize: 12,
  },
  stepsBox: {
    gap: 4,
  },
  stepsTitle: {
    color: '#CCC',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  stepText: {
    color: '#888',
    fontSize: 13,
    lineHeight: 20,
  },
  captureButton: {
    backgroundColor: '#4FC3F7',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  captureButtonActive: {
    backgroundColor: '#E53935',
  },
  captureButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  unavailableBox: {
    backgroundColor: '#1A1A1A',
    padding: 14,
    borderRadius: 10,
    gap: 6,
  },
  unavailableText: {
    color: '#E53935',
    fontSize: 13,
    fontWeight: '500',
  },
  unavailableTip: {
    color: '#888',
    fontSize: 13,
  },
  activeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E53935',
  },
  activeText: {
    color: '#81C784',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  privacyNote: {
    color: '#444',
    fontSize: 11,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
