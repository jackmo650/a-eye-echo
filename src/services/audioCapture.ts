// ============================================================================
// Audio Capture — Amplitude metering stub
//
// expo-speech-recognition handles all actual mic capture + transcription.
// This module is only used for the visual amplitude meter (level bar).
// It gracefully returns no-op when the native audio stream isn't available,
// since amplitude metering is non-essential.
// ============================================================================

import { Platform, PermissionsAndroid } from 'react-native';

type PCMCallback = (samples: Float32Array, sampleRate: number) => void;

let _capturing = false;
let _pcmCallbacks: PCMCallback[] = [];

export async function requestMicrophonePermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'A.EYE.ECHO needs microphone access to transcribe live speech into captions.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }
  return true;
}

export async function initAudioCapture(): Promise<void> {
  // No-op — expo-speech-recognition handles mic capture
  console.log('[AudioCapture] Amplitude metering not available (native module removed)');
}

export async function startCapture(): Promise<void> {
  _capturing = true;
}

export function stopCapture(): void {
  _capturing = false;
}

export function onPCMData(cb: PCMCallback): () => void {
  _pcmCallbacks.push(cb);
  return () => { _pcmCallbacks = _pcmCallbacks.filter(c => c !== cb); };
}

export function isCapturing(): boolean {
  return _capturing;
}

export function getSampleRate(): number {
  return 16000;
}
