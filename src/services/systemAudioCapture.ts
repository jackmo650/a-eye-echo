// ============================================================================
// System Audio Capture — Capture audio from other apps (Meet, Discord, Zoom)
//
// On iOS:  Uses Broadcast Upload Extension (RPSystemBroadcastPickerView)
//          which captures system audio via ReplayKit. User taps a button
//          to start system-wide audio capture, then A.EYE.ECHO receives
//          the audio buffer via an app group shared buffer.
//
// On Android: Uses AudioPlaybackCapture API (Android 10+) which can capture
//             audio from other apps. Requires FOREGROUND_SERVICE + permission.
//
// Both platforms deliver 16-bit PCM audio that we convert to Float32
// and feed into the same transcription pipeline as the microphone.
//
// This enables live captioning of:
//   - Google Meet / Zoom / Teams calls
//   - Discord voice channels
//   - YouTube / Twitch streams in browser
//   - Any app playing audio on the device
//
// NOTE: This is a conceptual implementation. The native modules for
// system audio capture require custom native code (Broadcast Extension
// on iOS, AudioPlaybackCapture on Android) that must be built with
// `expo prebuild` and native project modifications.
// ============================================================================

import { Platform, NativeModules, NativeEventEmitter } from 'react-native';
import { Buffer } from 'buffer';

type PCMCallback = (samples: Float32Array, sampleRate: number) => void;

// ── Types ───────────────────────────────────────────────────────────────────

export type SystemAudioStatus =
  | 'unavailable'    // Platform doesn't support system audio capture
  | 'idle'           // Ready to capture
  | 'requesting'     // Waiting for user to grant permission/start broadcast
  | 'capturing'      // Actively capturing system audio
  | 'error';

export interface SystemAudioInfo {
  /** Whether system audio capture is available on this device */
  isAvailable: boolean;
  /** Platform-specific requirements */
  requirements: string;
  /** Minimum OS version needed */
  minOsVersion: string;
}

// ── State ───────────────────────────────────────────────────────────────────

let _status: SystemAudioStatus = 'idle';
let _capturing = false;
let _pcmCallbacks: PCMCallback[] = [];
let _emitter: NativeEventEmitter | null = null;
let _subscription: { remove(): void } | null = null;

const SAMPLE_RATE = 16000;

// ── Platform Detection ──────────────────────────────────────────────────────

/**
 * Check if system audio capture is available on this device.
 *
 * iOS: Requires iOS 12+ and a Broadcast Upload Extension.
 * Android: Requires Android 10+ (API 29) and FOREGROUND_SERVICE permission.
 */
export function getSystemAudioInfo(): SystemAudioInfo {
  if (Platform.OS === 'ios') {
    const version = parseInt(Platform.Version as string, 10);
    return {
      isAvailable: version >= 12,
      requirements: 'Requires starting a Screen Broadcast from Control Center. Only the audio is captured — screen recording is not saved.',
      minOsVersion: 'iOS 12+',
    };
  }

  if (Platform.OS === 'android') {
    const version = Platform.Version;
    return {
      isAvailable: typeof version === 'number' && version >= 29,
      requirements: 'Requires Android 10 or later. A notification will appear while capturing.',
      minOsVersion: 'Android 10 (API 29)',
    };
  }

  return {
    isAvailable: false,
    requirements: 'System audio capture is not available on this platform.',
    minOsVersion: 'N/A',
  };
}

// ── Int16 → Float32 ─────────────────────────────────────────────────────────

function int16ToFloat32(int16Buffer: Buffer): Float32Array {
  const numSamples = int16Buffer.length / 2;
  const float32 = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    float32[i] = int16Buffer.readInt16LE(i * 2) / 32768;
  }
  return float32;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Start capturing system audio.
 *
 * On iOS: Triggers the RPSystemBroadcastPickerView which shows the system
 *         broadcast picker. User must tap "A.EYE.ECHO" to start.
 *
 * On Android: Starts a foreground service with AudioPlaybackCapture.
 *             User sees a system dialog to grant permission.
 */
export async function startSystemAudioCapture(): Promise<void> {
  const info = getSystemAudioInfo();
  if (!info.isAvailable) {
    throw new Error(`System audio capture not available. ${info.requirements}`);
  }

  if (_capturing) return;

  _status = 'requesting';

  try {
    // Access the native module for system audio capture
    // This requires a custom native module to be implemented:
    //   iOS: AEyeEchoBroadcastExtension (Broadcast Upload Extension)
    //   Android: AEyeEchoAudioCaptureService (Foreground Service)
    const SystemAudioModule = NativeModules.AEyeEchoSystemAudio;

    if (!SystemAudioModule) {
      console.warn(
        '[SystemAudio] Native module not available. ' +
        'System audio capture requires native code. ' +
        'Run `expo prebuild` and add the native broadcast extension.',
      );
      _status = 'unavailable';
      throw new Error(
        'System audio capture requires a development build. ' +
        'This feature is not available in Expo Go.',
      );
    }

    // Set up event listener for PCM data from native module
    _emitter = new NativeEventEmitter(SystemAudioModule);
    _subscription = _emitter.addListener('onSystemAudioData', (event: { data: string }) => {
      if (!_capturing || _pcmCallbacks.length === 0) return;

      const rawBuffer = Buffer.from(event.data, 'base64');
      const float32Samples = int16ToFloat32(rawBuffer);

      for (const cb of _pcmCallbacks) {
        cb(float32Samples, SAMPLE_RATE);
      }
    });

    // Start the native capture
    await SystemAudioModule.startCapture({
      sampleRate: SAMPLE_RATE,
      channels: 1,
      bitsPerSample: 16,
    });

    _capturing = true;
    _status = 'capturing';
    console.log('[SystemAudio] Capturing system audio');

  } catch (err) {
    _status = 'error';
    console.error('[SystemAudio] Failed to start:', err);
    throw err;
  }
}

/**
 * Stop capturing system audio.
 */
export async function stopSystemAudioCapture(): Promise<void> {
  if (!_capturing) return;

  try {
    const SystemAudioModule = NativeModules.AEyeEchoSystemAudio;
    if (SystemAudioModule) {
      await SystemAudioModule.stopCapture();
    }
  } catch (err) {
    console.error('[SystemAudio] Failed to stop:', err);
  }

  _subscription?.remove();
  _subscription = null;
  _emitter = null;
  _capturing = false;
  _status = 'idle';
  console.log('[SystemAudio] Stopped');
}

/**
 * Register a callback to receive system audio PCM data.
 * Same interface as audioCapture.ts onPCMData for drop-in replacement.
 */
export function onSystemAudioData(cb: PCMCallback): () => void {
  _pcmCallbacks.push(cb);
  return () => {
    _pcmCallbacks = _pcmCallbacks.filter(c => c !== cb);
  };
}

/**
 * Get current capture status.
 */
export function getSystemAudioStatus(): SystemAudioStatus {
  return _status;
}

/**
 * Check if system audio capture is currently active.
 */
export function isSystemAudioCapturing(): boolean {
  return _capturing;
}
