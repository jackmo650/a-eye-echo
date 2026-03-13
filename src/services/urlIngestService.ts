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
//   URL → resolve (if YouTube) → download to temp file
//     → expo-speech-recognition (SFSpeechURLRecognitionRequest) → segments
//
// Uses the same speech recognition engine as live mic mode — no Whisper needed.
// ============================================================================

import * as FileSystem from 'expo-file-system';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { TranscriptSegment, WhisperLanguage } from '../types';
import { filterHallucinations } from './transcriptionService';
import { getTranslationService } from './translationService';
import { SpeechRecognitionEngine } from './speechRecognitionEngine';

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

      // Step 3: Transcribe using expo-speech-recognition's audioSource
      // Uses SFSpeechURLRecognitionRequest — same engine as live mic mode
      // No Whisper model download needed
      this._setStatus('transcribing');

      const language = this._config.language;
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
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch { /* may not be recognizing */ }
    this._setStatus('idle');
    this._cleanupTempFiles();
  }

  // ── YouTube Resolution ──────────────────────────────────────────────────

  /**
   * Resolve a YouTube URL to a direct audio stream URL.
   * Uses react-native-ytdl for URL extraction.
   */
  /**
   * Extract video ID from YouTube URL variants:
   *   youtube.com/watch?v=ID, youtu.be/ID, youtube.com/live/ID, youtube.com/shorts/ID
   */
  private _extractYouTubeId(url: string): string | null {
    const patterns = [
      /[?&]v=([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  /**
   * Resolve a YouTube URL to a direct audio stream URL.
   * Uses Piped API (privacy-respecting YouTube frontend) for reliable extraction.
   * Falls back to react-native-ytdl if Piped fails.
   */
  private async _resolveYouTubeUrl(youtubeUrl: string): Promise<string> {
    const videoId = this._extractYouTubeId(youtubeUrl);
    if (!videoId) {
      throw new Error('Could not extract video ID from YouTube URL');
    }

    // Try multiple Piped API instances for reliability
    const pipedInstances = [
      'https://pipedapi.kavin.rocks',
      'https://pipedapi.adminforge.de',
      'https://api.piped.yt',
    ];

    for (const instance of pipedInstances) {
      try {
        console.log(`[UrlIngest] Trying Piped instance: ${instance}`);
        const response = await fetch(`${instance}/streams/${videoId}`);
        if (!response.ok) continue;

        const data = await response.json();
        const audioStreams = data.audioStreams;

        if (!audioStreams || audioStreams.length === 0) continue;

        // Pick highest bitrate audio stream
        const best = audioStreams.sort(
          (a: { bitrate?: number }, b: { bitrate?: number }) =>
            (b.bitrate || 0) - (a.bitrate || 0),
        )[0];

        if (best.url) {
          console.log(`[UrlIngest] YouTube audio via Piped: ${best.mimeType}, ${best.bitrate}bps`);
          return best.url;
        }
      } catch (err) {
        console.warn(`[UrlIngest] Piped instance ${instance} failed:`, err);
        continue;
      }
    }

    // Fallback to react-native-ytdl
    try {
      const ytdl = require('react-native-ytdl');
      const info = await ytdl.getInfo(youtubeUrl);
      const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

      if (audioFormats.length > 0) {
        const best = audioFormats.sort(
          (a: { audioBitrate?: number }, b: { audioBitrate?: number }) =>
            (b.audioBitrate || 0) - (a.audioBitrate || 0),
        )[0];
        console.log(`[UrlIngest] YouTube audio via ytdl: ${best.mimeType}, ${best.audioBitrate}kbps`);
        return best.url;
      }
    } catch (err) {
      console.warn('[UrlIngest] ytdl fallback also failed:', err);
    }

    throw new Error(
      'Could not extract audio from YouTube URL. ' +
      'YouTube may be blocking extraction. Try downloading the video first.',
    );
  }

  // ── Download ────────────────────────────────────────────────────────────

  private async _downloadMedia(url: string): Promise<string> {
    const tempDir = `${FileSystem.cacheDirectory}aeyeecho-ingest/`;
    const dirInfo = await FileSystem.getInfoAsync(tempDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });
    }

    // Determine extension from URL (safe parse)
    let ext = '.mp4';
    try {
      const urlPath = new URL(url).pathname;
      ext = urlPath.match(/\.\w+$/)?.[0] || '.mp4';
    } catch {
      // Malformed URL — use default extension
    }
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
   * Transcribe a local audio/video file using expo-speech-recognition.
   *
   * Uses SFSpeechURLRecognitionRequest via the `audioSource` option —
   * same Apple speech engine as live mic mode, but fed from a file.
   * No Whisper model needed, no JSI crash risk.
   */
  private async _transcribeFile(
    filePath: string,
    language: WhisperLanguage,
  ): Promise<void> {
    console.log(`[UrlIngest] Transcribing file via speech recognition: ${filePath}, language: ${language}`);

    const locale = SpeechRecognitionEngine.mapLanguage(language);
    let segmentCount = 0;

    return new Promise<void>((resolve, reject) => {
      // Track accumulated text for final segment emission
      let lastText = '';

      const resultSub = ExpoSpeechRecognitionModule.addListener('result', async (event: any) => {
        if (!this._active) return;

        const transcript = event.results?.[0]?.transcript || '';
        const isFinal = event.isFinal ?? false;

        if (!transcript.trim()) return;

        if (!isFinal) {
          // Show partial progress
          this._emitProgress({
            downloadPercent: 100,
            transcribePercent: 50, // Indeterminate during streaming
            currentChunkSec: 0,
            totalDurationSec: null,
          });
          lastText = transcript;
          return;
        }

        // Final result — emit as segment
        const cleanText = filterHallucinations(transcript);
        if (!cleanText) return;

        let translatedText: string | undefined;
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

        segmentCount++;
        const segment: TranscriptSegment = {
          id: `url_${_nextSegId++}`,
          text: cleanText,
          translatedText,
          detectedLanguage: language === 'auto' ? undefined : language,
          source: 'speech',
          startMs: 0,
          endMs: 0,
          speakerId: null,
          isFinal: true,
          confidence: event.results?.[0]?.confidence ?? 0.9,
        };

        for (const cb of this._transcriptCallbacks) cb(segment);

        this._emitProgress({
          downloadPercent: 100,
          transcribePercent: 90,
          currentChunkSec: 0,
          totalDurationSec: null,
        });
      });

      const errorSub = ExpoSpeechRecognitionModule.addListener('error', (event: any) => {
        const errorCode = event.error || 'unknown';
        const message = event.message || '';
        console.error(`[UrlIngest] Speech recognition error: ${errorCode} — ${message}`);

        // 'no-speech' is not fatal — file may have silent sections
        if (errorCode === 'no-speech') return;

        cleanup();
        reject(new Error(`Speech recognition error: ${errorCode} — ${message}`));
      });

      const endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
        console.log(`[UrlIngest] Speech recognition ended, ${segmentCount} segments emitted`);

        // If we had partial text that never became final, emit it
        if (lastText.trim() && segmentCount === 0) {
          const cleanText = filterHallucinations(lastText);
          if (cleanText) {
            const segment: TranscriptSegment = {
              id: `url_${_nextSegId++}`,
              text: cleanText,
              source: 'speech',
              startMs: 0,
              endMs: 0,
              speakerId: null,
              isFinal: true,
              confidence: 0.8,
            };
            for (const cb of this._transcriptCallbacks) cb(segment);
          }
        }

        cleanup();
        resolve();
      });

      const cleanup = () => {
        resultSub.remove();
        errorSub.remove();
        endSub.remove();
      };

      // Ensure any previous recognition session is stopped
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch { /* may not be recognizing */ }

      // Small delay to let previous session fully tear down
      setTimeout(() => {
        try {
          // filePath from expo-file-system is already a file:// URI
          console.log(`[UrlIngest] Starting speech recognition on: ${filePath}`);
          ExpoSpeechRecognitionModule.start({
            lang: locale,
            interimResults: true,
            continuous: true,
            requiresOnDeviceRecognition: SpeechRecognitionEngine.supportsOnDevice(),
            addsPunctuation: true,
            audioSource: {
              uri: filePath,
            },
          });
        } catch (err) {
          cleanup();
          reject(err);
        }
      }, 300);
    });
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
