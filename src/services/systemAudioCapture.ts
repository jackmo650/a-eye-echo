// ============================================================================
// System Audio Capture — Stub (feature deferred)
//
// System audio capture requires a Broadcast Upload Extension (iOS) or
// AudioPlaybackCapture (Android). Deferred to a future release.
// These no-op exports prevent import errors in transcriptionService.ts.
// ============================================================================

export type SystemAudioStatus = 'unavailable';

export function isSystemAudioAvailable(): boolean {
  return false;
}

export async function startSystemAudioCapture(_language?: string): Promise<void> {
  throw new Error('System audio capture is not available in this build.');
}

export async function stopSystemAudioCapture(): Promise<void> {}

export function onSystemAudioResult(
  _cb: (text: string, isFinal: boolean, confidence: number) => void,
): () => void {
  return () => {};
}

export function onSystemAudioEnd(_cb: () => void): () => void {
  return () => {};
}
