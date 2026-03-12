// ============================================================================
// Audio Capture — Raw PCM microphone capture via react-native-audio-pcm-stream
//
// Replaces the Electron AudioWorklet approach with native audio capture.
// Same author as whisper.rn (mybigday), so they integrate well.
//
// Captures 16-bit PCM at 16kHz mono (Whisper's native rate) — no resampling
// needed on mobile since we control the capture sample rate directly.
//
// Architecture:
//   LiveAudioStream.init({ sampleRate: 16000, ... })
//   LiveAudioStream.on('data', base64chunk => convert → Float32 → feedPCM)
//   LiveAudioStream.start() / .stop()
// ============================================================================

import LiveAudioStream from 'react-native-live-audio-stream';
import { Buffer } from 'buffer';
import { Platform, PermissionsAndroid } from 'react-native';

type PCMCallback = (samples: Float32Array, sampleRate: number) => void;

// ── Config ──────────────────────────────────────────────────────────────────

const SAMPLE_RATE = 16000;   // 16kHz — Whisper's native rate, no resampling
const CHANNELS = 1;           // Mono
const BITS_PER_SAMPLE = 16;   // 16-bit PCM
const BUFFER_SIZE = 4096;     // ~256ms at 16kHz

// ── State ───────────────────────────────────────────────────────────────────

let _initialized = false;
let _capturing = false;
let _pcmCallbacks: PCMCallback[] = [];

// ── Permission ──────────────────────────────────────────────────────────────

/**
 * Request microphone permission.
 * iOS: handled via Info.plist (NSMicrophoneUsageDescription in app.json)
 * Android: runtime permission request
 */
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
  // iOS: permission is requested automatically on first use
  return true;
}

// ── Int16 → Float32 Conversion ──────────────────────────────────────────────

/**
 * Convert 16-bit signed integer PCM buffer to Float32 [-1, 1] range.
 * This is the reverse of WallSpace's whisperBridge.ts pcmToWav Int16 conversion.
 */
function int16ToFloat32(int16Buffer: Buffer): Float32Array {
  const numSamples = int16Buffer.length / 2; // 2 bytes per 16-bit sample
  const float32 = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    // Read signed 16-bit little-endian
    const sample = int16Buffer.readInt16LE(i * 2);
    // Normalize to [-1, 1]
    float32[i] = sample / 32768;
  }

  return float32;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize audio capture with optimal settings for Whisper transcription.
 * Must be called before start().
 */
export async function initAudioCapture(): Promise<void> {
  if (_initialized) return;

  await LiveAudioStream.init({
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE,
    audioSource: Platform.OS === 'android' ? 6 : undefined, // VOICE_RECOGNITION on Android
    bufferSize: BUFFER_SIZE,
  });

  // Register data handler — converts base64 → Int16 → Float32 → callbacks
  LiveAudioStream.on('data', (base64Data: string) => {
    if (!_capturing || _pcmCallbacks.length === 0) return;

    const rawBuffer = Buffer.from(base64Data, 'base64');
    const float32Samples = int16ToFloat32(rawBuffer);

    for (const cb of _pcmCallbacks) {
      cb(float32Samples, SAMPLE_RATE);
    }
  });

  _initialized = true;
  console.log(
    `[AudioCapture] Initialized: ${SAMPLE_RATE}Hz, ${CHANNELS}ch, ` +
    `${BITS_PER_SAMPLE}bit, buffer: ${BUFFER_SIZE}`,
  );
}

/**
 * Start capturing audio from microphone.
 * PCM data will be delivered to registered callbacks as Float32 arrays.
 */
export async function startCapture(): Promise<void> {
  if (_capturing) return;

  if (!_initialized) {
    await initAudioCapture();
  }

  const hasPermission = await requestMicrophonePermission();
  if (!hasPermission) {
    throw new Error('Microphone permission denied');
  }

  LiveAudioStream.start();
  _capturing = true;
  console.log('[AudioCapture] Started');
}

/**
 * Stop capturing audio.
 */
export function stopCapture(): void {
  if (!_capturing) return;

  LiveAudioStream.stop();
  _capturing = false;
  console.log('[AudioCapture] Stopped');
}

/**
 * Register a callback to receive raw PCM Float32 samples.
 * Returns an unsubscribe function.
 *
 * Samples are delivered at 16kHz mono — same rate Whisper expects,
 * so no resampling is needed (unlike WallSpace's 48kHz → 16kHz path).
 */
export function onPCMData(cb: PCMCallback): () => void {
  _pcmCallbacks.push(cb);
  return () => {
    _pcmCallbacks = _pcmCallbacks.filter(c => c !== cb);
  };
}

/**
 * Check if audio capture is currently active.
 */
export function isCapturing(): boolean {
  return _capturing;
}

/**
 * Get the capture sample rate (always 16kHz for Whisper compatibility).
 */
export function getSampleRate(): number {
  return SAMPLE_RATE;
}
