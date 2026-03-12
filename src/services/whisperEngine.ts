// ============================================================================
// Whisper Engine — Native whisper.cpp integration via whisper.rn
//
// Replaces the Electron subprocess bridge (whisperBridge.ts) with direct
// native module calls. Uses whisper.rn which wraps whisper.cpp with
// CoreML/Metal acceleration on iOS and GPU support on Android.
//
// Architecture:
//   initWhisper(modelPath) → WhisperContext
//   WhisperContext.transcribe(wavPath, options) → { result }
//
// Model management: download from HuggingFace, cache in app documents dir.
// ============================================================================

import { initWhisper, type WhisperContext } from 'whisper.rn';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import type { WhisperModel } from '../types';

// ── Model Registry ──────────────────────────────────────────────────────────

const MODEL_URLS: Record<WhisperModel, string> = {
  'tiny.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  'base.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  'small.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  'medium.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
};

const MODEL_SIZES: Record<WhisperModel, number> = {
  'tiny.en': 75_000_000,
  'base.en': 142_000_000,
  'small.en': 466_000_000,
  'medium.en': 1_500_000_000,
};

export type ModelDownloadProgress = {
  modelId: WhisperModel;
  bytesWritten: number;
  totalBytes: number;
  percent: number;
};

type ProgressCallback = (progress: ModelDownloadProgress) => void;

// ── State ───────────────────────────────────────────────────────────────────

let _context: WhisperContext | null = null;
let _currentModelId: WhisperModel | null = null;
let _isTranscribing = false;
let _transcribeAbort: (() => void) | null = null;

// ── Model Directory ─────────────────────────────────────────────────────────

function getModelsDir(): string {
  return `${FileSystem.documentDirectory}whisper-models/`;
}

function getModelPath(modelId: WhisperModel): string {
  return `${getModelsDir()}ggml-${modelId}.bin`;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if a model is already downloaded and valid.
 */
export async function isModelDownloaded(modelId: WhisperModel): Promise<boolean> {
  const path = getModelPath(modelId);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return false;
  // Check file size is reasonable (> 1MB = not a partial download)
  return (info as { size?: number }).size !== undefined
    && (info as { size: number }).size > 1_000_000;
}

/**
 * Download a Whisper model from HuggingFace.
 * Shows progress via callback for UI download indicator.
 */
export async function downloadModel(
  modelId: WhisperModel,
  onProgress?: ProgressCallback,
): Promise<string> {
  const modelPath = getModelPath(modelId);

  // Already downloaded
  if (await isModelDownloaded(modelId)) {
    console.log(`[Whisper] Model ${modelId} already downloaded`);
    return modelPath;
  }

  // Ensure models directory exists
  const dirInfo = await FileSystem.getInfoAsync(getModelsDir());
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(getModelsDir(), { intermediates: true });
  }

  const url = MODEL_URLS[modelId];
  const expectedSize = MODEL_SIZES[modelId];

  console.log(`[Whisper] Downloading model ${modelId} from ${url}`);

  const downloadResumable = FileSystem.createDownloadResumable(
    url,
    modelPath,
    {},
    (downloadProgress) => {
      const percent = downloadProgress.totalBytesExpectedToWrite > 0
        ? (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100
        : (downloadProgress.totalBytesWritten / expectedSize) * 100;

      onProgress?.({
        modelId,
        bytesWritten: downloadProgress.totalBytesWritten,
        totalBytes: downloadProgress.totalBytesExpectedToWrite || expectedSize,
        percent: Math.min(100, percent),
      });
    },
  );

  const result = await downloadResumable.downloadAsync();
  if (!result?.uri) {
    throw new Error(`Download failed for model ${modelId}`);
  }

  console.log(`[Whisper] Model ${modelId} downloaded to ${result.uri}`);
  return modelPath;
}

/**
 * Delete a downloaded model to free storage.
 */
export async function deleteModel(modelId: WhisperModel): Promise<void> {
  const path = getModelPath(modelId);
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) {
    await FileSystem.deleteAsync(path, { idempotent: true });
    console.log(`[Whisper] Deleted model ${modelId}`);
  }

  // If this was the loaded model, release context
  if (_currentModelId === modelId) {
    await releaseContext();
  }
}

/**
 * Initialize a Whisper context with a downloaded model.
 * Enables GPU acceleration on iOS (Metal/CoreML).
 */
export async function loadModel(modelId: WhisperModel): Promise<void> {
  // Already loaded
  if (_context && _currentModelId === modelId) {
    console.log(`[Whisper] Model ${modelId} already loaded`);
    return;
  }

  // Release previous context if different model
  if (_context) {
    await releaseContext();
  }

  const modelPath = getModelPath(modelId);
  const isDownloaded = await isModelDownloaded(modelId);
  if (!isDownloaded) {
    throw new Error(`Model ${modelId} not downloaded. Call downloadModel() first.`);
  }

  console.log(`[Whisper] Initializing context for ${modelId}...`);

  _context = await initWhisper({
    filePath: modelPath,
    useGpu: true,          // Metal on iOS, GPU on Android
    useFlashAttn: true,    // Recommended when GPU available
  });

  _currentModelId = modelId;
  console.log(
    `[Whisper] Context initialized (id: ${_context.id}, gpu: ${_context.gpu}` +
    `${_context.reasonNoGPU ? `, reason no GPU: ${_context.reasonNoGPU}` : ''})`,
  );
}

/**
 * Transcribe a WAV file using the loaded Whisper context.
 * Returns the transcription result text.
 *
 * This is the core inference call — equivalent to WallSpace's
 * whisperBridge processWavFile() but via native module instead of subprocess.
 */
export async function transcribeFile(
  wavFilePath: string,
  language: string = 'en',
): Promise<{ text: string; segments: Array<{ text: string; t0: number; t1: number }> }> {
  if (!_context) {
    throw new Error('No Whisper context loaded. Call loadModel() first.');
  }

  if (_isTranscribing) {
    console.log('[Whisper] Already transcribing, skipping chunk');
    return { text: '', segments: [] };
  }

  _isTranscribing = true;

  try {
    const { stop, promise } = _context.transcribe(wavFilePath, {
      language,
      maxThreads: Platform.OS === 'ios' ? 4 : 2,
    });

    _transcribeAbort = stop;

    const { result, segments } = await promise;

    return {
      text: result.trim(),
      segments: segments?.map((s: { text: string; t0: number; t1: number }) => ({
        text: s.text.trim(),
        t0: s.t0,
        t1: s.t1,
      })) ?? [],
    };
  } finally {
    _isTranscribing = false;
    _transcribeAbort = null;
  }
}

/**
 * Abort current transcription (if running).
 */
export function abortTranscription(): void {
  if (_transcribeAbort) {
    _transcribeAbort();
    _transcribeAbort = null;
  }
}

/**
 * Release the Whisper context and free memory.
 */
export async function releaseContext(): Promise<void> {
  abortTranscription();

  if (_context) {
    await _context.release();
    _context = null;
    _currentModelId = null;
    console.log('[Whisper] Context released');
  }
}

/**
 * Get info about the currently loaded model.
 */
export function getCurrentModel(): { modelId: WhisperModel; gpu: boolean } | null {
  if (!_context || !_currentModelId) return null;
  return {
    modelId: _currentModelId,
    gpu: _context.gpu,
  };
}

/**
 * Check available storage vs model size.
 */
export async function getStorageInfo(modelId: WhisperModel): Promise<{
  modelSize: number;
  freeSpace: number;
  hasEnoughSpace: boolean;
}> {
  const freeSpace = await FileSystem.getFreeDiskStorageAsync();
  const modelSize = MODEL_SIZES[modelId];
  return {
    modelSize,
    freeSpace,
    hasEnoughSpace: freeSpace > modelSize * 1.2, // 20% buffer
  };
}
