// ============================================================================
// System Audio Capture — Capture & transcribe audio from other apps
//
// On iOS: Uses Broadcast Upload Extension (RPBroadcastSampleHandler) to capture
//         system audio. The captured audio is fed to SFSpeechRecognizer in the
//         native module — only text results cross the JS bridge.
//
// The native module (AEyeEchoSystemAudio) handles:
//   1. Showing the broadcast picker (user selects "A.EYE.ECHO")
//   2. Reading PCM from shared ring buffer (App Group)
//   3. Feeding audio to SFSpeechAudioBufferRecognitionRequest
//   4. Auto-restarting at 55s (SFSpeechRecognizer 60s limit)
//   5. Emitting text results to JS
//
// This enables live captioning of:
//   - Google Meet / Zoom / Teams calls
//   - YouTube / Twitch / podcasts in any app
//   - Discord voice channels
//   - Any app playing audio on the device
// ============================================================================

import { Platform, NativeModules, NativeEventEmitter } from 'react-native';
import { SpeechRecognitionEngine } from './speechRecognitionEngine';
import type { WhisperLanguage } from '../types';

// ── Types ───────────────────────────────────────────────────────────────────

export type SystemAudioStatus =
  | 'unavailable'    // Platform doesn't support or native module missing
  | 'idle'           // Ready to capture
  | 'requesting'     // Waiting for user to select broadcast extension
  | 'capturing'      // Actively capturing and transcribing
  | 'error';

type ResultCallback = (text: string, isFinal: boolean, confidence: number) => void;
type StatusCallback = (status: SystemAudioStatus) => void;
type EndCallback = () => void;

// ── State ───────────────────────────────────────────────────────────────────

let _status: SystemAudioStatus = 'idle';
let _capturing = false;
let _emitter: NativeEventEmitter | null = null;
let _subscriptions: Array<{ remove(): void }> = [];

let _resultCallbacks: ResultCallback[] = [];
let _statusCallbacks: StatusCallback[] = [];
let _endCallbacks: EndCallback[] = [];

// ── Native Module Access ────────────────────────────────────────────────────

function getNativeModule(): any {
  return NativeModules.AEyeEchoSystemAudio ?? null;
}

function isNativeAvailable(): boolean {
  return getNativeModule() != null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if system audio capture is available on this device.
 */
export function getSystemAudioStatus(): SystemAudioStatus {
  return _status;
}

export function isSystemAudioCapturing(): boolean {
  return _capturing;
}

/**
 * Check availability. Returns false if native module is missing.
 */
export function isSystemAudioAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
  return isNativeAvailable();
}

/**
 * Start system audio capture and transcription.
 * Shows the iOS broadcast picker — user must tap "A.EYE.ECHO" to begin.
 */
export async function startSystemAudioCapture(language: WhisperLanguage = 'en'): Promise<void> {
  const mod = getNativeModule();
  if (!mod) {
    _status = 'unavailable';
    throw new Error(
      'System audio capture requires a development build with the Broadcast Extension.',
    );
  }

  if (_capturing) return;

  _status = 'requesting';
  _notifyStatus();

  try {
    // Set up event listeners
    _emitter = new NativeEventEmitter(mod);

    _subscriptions.push(
      _emitter.addListener('onSystemAudioResult', (event: {
        text: string;
        isFinal: boolean;
        confidence: number;
      }) => {
        if (!_capturing) return;
        for (const cb of _resultCallbacks) {
          cb(event.text, event.isFinal, event.confidence);
        }
      }),
    );

    _subscriptions.push(
      _emitter.addListener('onSystemAudioStatus', (event: { status: string }) => {
        const newStatus = event.status as SystemAudioStatus;
        _status = newStatus;
        if (newStatus === 'capturing') {
          _capturing = true;
        }
        _notifyStatus();
      }),
    );

    _subscriptions.push(
      _emitter.addListener('onSystemAudioEnd', () => {
        console.log('[SystemAudio] Broadcast ended by user/system');
        _capturing = false;
        _status = 'idle';
        _notifyStatus();
        for (const cb of _endCallbacks) cb();
      }),
    );

    // Map language and start native capture + recognition
    const locale = SpeechRecognitionEngine.mapLanguage(language);
    mod.startCapture(locale);

    _capturing = true;
    _status = 'capturing';
    _notifyStatus();
    console.log('[SystemAudio] Started — waiting for user to select broadcast extension');

  } catch (err) {
    _status = 'error';
    _notifyStatus();
    _cleanup();
    console.error('[SystemAudio] Failed to start:', err);
    throw err;
  }
}

/**
 * Stop system audio capture.
 */
export async function stopSystemAudioCapture(): Promise<void> {
  if (!_capturing) return;

  try {
    const mod = getNativeModule();
    if (mod) {
      mod.stopCapture();
    }
  } catch (err) {
    console.error('[SystemAudio] Failed to stop:', err);
  }

  _cleanup();
  console.log('[SystemAudio] Stopped');
}

// ── Event Registration ──────────────────────────────────────────────────────

export function onSystemAudioResult(cb: ResultCallback): () => void {
  _resultCallbacks.push(cb);
  return () => { _resultCallbacks = _resultCallbacks.filter(c => c !== cb); };
}

export function onSystemAudioStatusChange(cb: StatusCallback): () => void {
  _statusCallbacks.push(cb);
  return () => { _statusCallbacks = _statusCallbacks.filter(c => c !== cb); };
}

export function onSystemAudioEnd(cb: EndCallback): () => void {
  _endCallbacks.push(cb);
  return () => { _endCallbacks = _endCallbacks.filter(c => c !== cb); };
}

// ── Internal ────────────────────────────────────────────────────────────────

function _notifyStatus(): void {
  for (const cb of _statusCallbacks) cb(_status);
}

function _cleanup(): void {
  for (const sub of _subscriptions) sub.remove();
  _subscriptions = [];
  _emitter = null;
  _capturing = false;
  _status = 'idle';
  _notifyStatus();
}
