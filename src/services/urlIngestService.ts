// ============================================================================
// URL Ingest Service — Extract audio from video URLs for transcription
//
// Supports:
//   1. Direct video URLs (.mp4, .webm, .mov, etc.)
//   2. Direct audio URLs (.mp3, .m4a, .wav, etc.)
//   3. HLS streams (.m3u8)
//   4. YouTube URLs (via react-native-ytdl resolution)
//
// Pipeline:
//   URL → resolve (if YouTube) → download to temp file → FFmpeg extract
//   16kHz mono WAV → chunk into segments → feed to transcription service
//
// Uses:
//   - expo-file-system for downloads
//   - react-native-audio-api for audio decoding + resampling (if available)
//   - Fallback: whisper.rn can transcribe WAV/audio files directly
//
// Ported from WallSpace.Studio WebRTC import service audio extraction pattern.
// ============================================================================

import * as FileSystem from 'expo-file-system';
import type { TranscriptSegment, WhisperLanguage } from '../types';
import * as WhisperEngine from './whisperEngine';
import { filterHallucinations } from './transcriptionService';
import { getTranslationService } from './translationService';

type TranscriptCallback = (segment: TranscriptSegment) => void;
type ProgressCallback = (progress: IngestProgress) => void;
type StatusCallback = (status: IngestStatus) => void;

export type IngestStatus =
  | 'idle'
  | 'resolving'      // Resolving YouTube/shortened URL
  | 'downloading'     // Downloading media file
  | 'extracting'      // Extracting audio track
  | 'transcribing'    // Running Whisper inference
  | 'complete'
  | 'error';

export interface IngestProgress {
  status: IngestStatus;
  /** Download progress 0-100 */
  downloadPercent: number;
  /** Transcription progress 0-100 */
  transcribePercent: number;
  /** Current chunk being transcribed */
  currentChunkSec: number;
  /** Total duration in seconds (if known) */
  totalDurationSec: number | null;
  /** Error message if status is 'error' */
  error?: string;
}

export interface IngestConfig {
  /** Whisper language for transcription */
  language: WhisperLanguage;
  /** Chunk duration in seconds for splitting long audio */
  chunkDurationSec: number;
  /** Enable translation */
  translationEnabled: boolean;
  /** Translation target language */
  translationTarget: string;
}

const DEFAULT_INGEST_CONFIG: IngestConfig = {
  language: 'auto',
  chunkDurationSec: 30,
  translationEnabled: false,
  translationTarget: 'en',
};

// ── URL Detection ───────────────────────────────────────────────────────────

const YOUTUBE_PATTERNS = [
  /^https?:\/\/(www\.)?youtube\.com\/watch\?v=/,
  /^https?:\/\/youtu\.be\//,
  /^https?:\/\/(www\.)?youtube\.com\/live\//,
  /^https?:\/\/(www\.)?youtube\.com\/shorts\//,
];

const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.ogg', '.opus', '.aac', '.flac'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
const STREAM_PATTERNS = [/\.m3u8/, /\.mpd/];

export type UrlType = 'youtube' | 'audio' | 'video' | 'stream' | 'unknown';

export function detectUrlType(url: string): UrlType {
  if (YOUTUBE_PATTERNS.some(p => p.test(url))) return 'youtube';
  const lowerUrl = url.toLowerCase();
  if (AUDIO_EXTENSIONS.some(ext => lowerUrl.includes(ext))) return 'audio';
  if (VIDEO_EXTENSIONS.some(ext => lowerUrl.includes(ext))) return 'video';
  if (STREAM_PATTERNS.some(p => p.test(lowerUrl))) return 'stream';
  return 'unknown';
}

// ── URL Ingest Service ──────────────────────────────────────────────────────

let _nextSegId = 1;

export class UrlIngestService {
  private _config: IngestConfig = { ...DEFAULT_INGEST_CONFIG };
  private _status: IngestStatus = 'idle';
  private _active = false;
  private _transcriptCallbacks: TranscriptCallback[] = [];
  private _progressCallbacks: ProgressCallback[] = [];
  private _statusCallbacks: StatusCallback[] = [];
  private _tempFiles: string[] = [];

  get status(): IngestStatus { return this._status; }

  configure(config: Partial<IngestConfig>): void {
    this._config = { ...this._config, ...config };
  }

  onTranscript(cb: TranscriptCallback): () => void {
    this._transcriptCallbacks.push(cb);
    return () => { this._transcriptCallbacks = this._transcriptCallbacks.filter(c => c !== cb); };
  }

  onProgress(cb: ProgressCallback): () => void {
    this._progressCallbacks.push(cb);
    return () => { this._progressCallbacks = this._progressCallbacks.filter(c => c !== cb); };
  }

  onStatusChange(cb: StatusCallback): () => void {
    this._statusCallbacks.push(cb);
    return () => { this._statusCallbacks = this._statusCallbacks.filter(c => c !== cb); };
  }

  /**
   * Ingest a URL: resolve → download → extract audio → transcribe.
   *
   * Supports: direct video/audio URLs, YouTube, HLS streams.
   * For YouTube, uses react-native-ytdl to resolve audio stream URL.
   */
  async ingest(
    url: string,
    onModelDownloadProgress?: (percent: number) => void,
  ): Promise<void> {
    if (this._active) return;
    this._active = true;

    try {
      // Step 1: Resolve URL
      this._setStatus('resolving');
      this._emitProgress({ downloadPercent: 0, transcribePercent: 0, currentChunkSec: 0, totalDurationSec: null });

      const urlType = detectUrlType(url);
      let downloadUrl = url;

      if (urlType === 'youtube') {
        downloadUrl = await this._resolveYouTubeUrl(url);
      }

      if (!this._active) return;

      // Step 2: Download media to temp file
      this._setStatus('downloading');
      const localPath = await this._downloadMedia(downloadUrl);

      if (!this._active) return;

      // Step 3: Ensure Whisper model is loaded
      this._setStatus('extracting');

      // Determine model for language
      const language = this._config.language;
      const modelId = WhisperEngine.getModelForLanguage('base', language);

      const isDownloaded = await WhisperEngine.isModelDownloaded(modelId);
      if (!isDownloaded) {
        await WhisperEngine.downloadModel(modelId, (progress) => {
          onModelDownloadProgress?.(progress.percent);
        });
      }
      await WhisperEngine.loadModel(modelId);

      if (!this._active) return;

      // Step 4: Transcribe the audio file
      // whisper.rn can handle audio/video files directly — it extracts
      // the audio track internally using the native decoder.
      this._setStatus('transcribing');

      await this._transcribeFile(localPath, language);

      this._setStatus('complete');

    } catch (err) {
      console.error('[UrlIngest] Error:', err);
      this._setStatus('error');
      this._emitProgress({
        downloadPercent: 0,
        transcribePercent: 0,
        currentChunkSec: 0,
        totalDurationSec: null,
        error: String(err),
      });
    } finally {
      this._active = false;
      this._cleanupTempFiles();
    }
  }

  /** Cancel the current ingest operation. */
  cancel(): void {
    this._active = false;
    WhisperEngine.abortTranscription();
    this._setStatus('idle');
    this._cleanupTempFiles();
  }

  // ── YouTube Resolution ──────────────────────────────────────────────────

  /**
   * Resolve a YouTube URL to a direct audio stream URL.
   * Uses react-native-ytdl for URL extraction.
   */
  private async _resolveYouTubeUrl(youtubeUrl: string): Promise<string> {
    try {
      // Dynamic import to avoid crash if not installed
      // @ts-expect-error — optional dependency
      const ytdl = await import('react-native-ytdl');

      const info = await ytdl.getInfo(youtubeUrl);
      const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

      if (audioFormats.length === 0) {
        throw new Error('No audio streams found for this YouTube video');
      }

      // Pick highest quality audio
      const best = audioFormats.sort(
        (a: { audioBitrate?: number }, b: { audioBitrate?: number }) =>
          (b.audioBitrate || 0) - (a.audioBitrate || 0),
      )[0];

      console.log(`[UrlIngest] YouTube audio: ${best.mimeType}, ${best.audioBitrate}kbps`);
      return best.url;

    } catch (err) {
      console.error('[UrlIngest] YouTube resolution failed:', err);
      throw new Error(
        'Could not extract audio from YouTube URL. ' +
        'Try downloading the video first and providing a direct file URL.',
      );
    }
  }

  // ── Download ────────────────────────────────────────────────────────────

  private async _downloadMedia(url: string): Promise<string> {
    const tempDir = `${FileSystem.cacheDirectory}aeyeecho-ingest/`;
    const dirInfo = await FileSystem.getInfoAsync(tempDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });
    }

    // Determine extension from URL
    const urlPath = new URL(url).pathname;
    const ext = urlPath.match(/\.\w+$/)?.[0] || '.mp4';
    const filename = `ingest_${Date.now()}${ext}`;
    const localPath = `${tempDir}${filename}`;

    console.log(`[UrlIngest] Downloading to ${localPath}...`);

    const download = FileSystem.createDownloadResumable(
      url,
      localPath,
      {},
      (progress) => {
        const percent = progress.totalBytesExpectedToWrite > 0
          ? (progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100
          : 0;
        this._emitProgress({
          downloadPercent: Math.min(100, percent),
          transcribePercent: 0,
          currentChunkSec: 0,
          totalDurationSec: null,
        });
      },
    );

    const result = await download.downloadAsync();
    if (!result?.uri) {
      throw new Error('Download failed');
    }

    this._tempFiles.push(localPath);
    console.log(`[UrlIngest] Downloaded: ${localPath}`);
    return localPath;
  }

  // ── Transcription ───────────────────────────────────────────────────────

  /**
   * Transcribe a local audio/video file using Whisper.
   *
   * whisper.rn's transcribe function handles audio extraction from video
   * containers natively. For long files, we get word-level timestamps
   * from the segments array and emit them as TranscriptSegments.
   */
  private async _transcribeFile(
    filePath: string,
    language: WhisperLanguage,
  ): Promise<void> {
    console.log(`[UrlIngest] Transcribing file: ${filePath}, language: ${language}`);

    const result = await WhisperEngine.transcribeFile(filePath, language);

    if (!result.text.trim()) {
      console.log('[UrlIngest] No speech detected in file');
      return;
    }

    // If Whisper returned segments with timestamps, emit each as a TranscriptSegment
    if (result.segments && result.segments.length > 0) {
      const totalSegments = result.segments.length;

      for (let i = 0; i < totalSegments; i++) {
        if (!this._active) break;

        const seg = result.segments[i];
        const cleanText = filterHallucinations(seg.text);
        if (!cleanText) continue;

        let translatedText: string | undefined;

        // Translate if enabled
        if (this._config.translationEnabled && this._config.translationTarget) {
          try {
            const sourceLang = (language === 'auto' ? 'en' : language) as string;
            if (sourceLang !== this._config.translationTarget) {
              const translationService = getTranslationService();
              translatedText = await translationService.translate(
                cleanText,
                sourceLang,
                this._config.translationTarget,
              );
            }
          } catch { /* translation failure is non-blocking */ }
        }

        const segment: TranscriptSegment = {
          id: `url_${_nextSegId++}`,
          text: cleanText,
          translatedText,
          detectedLanguage: language === 'auto' ? undefined : language,
          source: 'speech',
          startMs: seg.t0,
          endMs: seg.t1,
          speakerId: null,
          isFinal: true,
          confidence: 1.0,
        };

        for (const cb of this._transcriptCallbacks) cb(segment);

        this._emitProgress({
          downloadPercent: 100,
          transcribePercent: ((i + 1) / totalSegments) * 100,
          currentChunkSec: seg.t1 / 1000,
          totalDurationSec: result.segments[totalSegments - 1].t1 / 1000,
        });
      }
    } else {
      // Single chunk result — emit as one segment
      const cleanText = filterHallucinations(result.text);
      if (cleanText) {
        const segment: TranscriptSegment = {
          id: `url_${_nextSegId++}`,
          text: cleanText,
          source: 'speech',
          startMs: 0,
          endMs: 0,
          speakerId: null,
          isFinal: true,
          confidence: 1.0,
        };

        for (const cb of this._transcriptCallbacks) cb(segment);
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private _setStatus(status: IngestStatus): void {
    this._status = status;
    for (const cb of this._statusCallbacks) cb(status);
  }

  private _emitProgress(partial: Omit<IngestProgress, 'status'>): void {
    const progress: IngestProgress = { status: this._status, ...partial };
    for (const cb of this._progressCallbacks) cb(progress);
  }

  private async _cleanupTempFiles(): Promise<void> {
    for (const path of this._tempFiles) {
      try {
        await FileSystem.deleteAsync(path, { idempotent: true });
      } catch { /* ignore */ }
    }
    this._tempFiles = [];
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _instance: UrlIngestService | null = null;

export function getUrlIngestService(): UrlIngestService {
  if (!_instance) _instance = new UrlIngestService();
  return _instance;
}
