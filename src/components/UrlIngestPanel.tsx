// ============================================================================
// URL Ingest Panel — Paste a URL, play in embedded WebView, transcribe via mic
//
// Instead of downloading and extracting audio (which YouTube blocks), we:
//   1. Open the URL in an embedded WebView
//   2. The video/audio plays through the device speaker
//   3. User taps Start → mic-based speech recognition transcribes the audio
//
// This works with ANY URL: YouTube, Twitch, podcasts, news sites, etc.
// ============================================================================

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Linking,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as ExpoClipboard from 'expo-clipboard';
import { detectUrlType, type UrlType } from '../services/urlIngestService';
import type { WhisperLanguage } from '../types';

interface UrlIngestPanelProps {
  language: WhisperLanguage;
  translationEnabled: boolean;
  translationTarget: string;
  onTranscriptReady: () => void;
  onModelDownloadProgress?: (percent: number) => void;
}

const URL_TYPE_LABELS: Record<UrlType, string> = {
  youtube: 'YouTube',
  audio: 'Audio File',
  video: 'Video File',
  stream: 'Live Stream',
  unknown: 'URL',
};

// Mobile browser user agent — YouTube allows playback from mobile Safari
const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Extract YouTube video ID from various URL formats
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// Build playable URL — YouTube uses an HTML wrapper with iframe embed
function getPlayableUrl(url: string, urlType: UrlType): string {
  if (urlType === 'youtube') {
    const videoId = extractYouTubeId(url);
    if (videoId) {
      // Return a data URI with an HTML page that embeds the YouTube iframe API
      // This avoids YouTube's WebView detection that blocks m.youtube.com
      return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
    }
  }
  return url;
}

// Injected JS: auto-resume video/audio when iOS pauses it due to audio session changes
const KEEP_PLAYING_JS = `
(function() {
  var _userPaused = false;
  var _lastUserTouch = 0;

  // Monitor all media elements for pause/play
  function hookMedia(el) {
    if (el._hooked) return;
    el._hooked = true;
    el.addEventListener('pause', function() {
      // If user touched within last 2s, treat as intentional pause
      if (Date.now() - _lastUserTouch < 2000) {
        _userPaused = true;
        return;
      }
      // Auto-resume after a short delay (audio session change)
      if (!el.ended) {
        setTimeout(function() {
          if (el.paused && !el.ended && !_userPaused) {
            el.play().catch(function(){});
          }
        }, 400);
      }
    });
    el.addEventListener('play', function() { _userPaused = false; });
  }

  // Track user touches globally
  document.addEventListener('touchstart', function() {
    _lastUserTouch = Date.now();
  }, true);

  // Hook existing and future media elements
  document.querySelectorAll('video, audio').forEach(hookMedia);
  var obs = new MutationObserver(function(muts) {
    muts.forEach(function(m) {
      m.addedNodes.forEach(function(n) {
        if (n.tagName === 'VIDEO' || n.tagName === 'AUDIO') hookMedia(n);
        if (n.querySelectorAll) n.querySelectorAll('video, audio').forEach(hookMedia);
      });
    });
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Polling fallback: check every 800ms for paused media and resume
  setInterval(function() {
    if (_userPaused) return;
    document.querySelectorAll('video, audio').forEach(function(el) {
      if (el.paused && !el.ended && el.readyState >= 2) {
        el.play().catch(function(){});
      }
    });
  }, 800);

  true;
})();
`;

export function UrlIngestPanel({
  language,
  translationEnabled,
  translationTarget,
  onTranscriptReady,
  onModelDownloadProgress,
}: UrlIngestPanelProps) {
  const [url, setUrl] = useState('');
  const [detectedType, setDetectedType] = useState<UrlType>('unknown');
  const [isPlaying, setIsPlaying] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');

  const handleUrlChange = useCallback((text: string) => {
    setUrl(text.trim());
    if (text.trim()) {
      setDetectedType(detectUrlType(text.trim()));
    } else {
      setDetectedType('unknown');
    }
    setIsPlaying(false);
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      const text = await ExpoClipboard.getStringAsync();
      if (text) {
        handleUrlChange(text);
      }
    } catch {
      // Clipboard access may be denied
    }
  }, [handleUrlChange]);

  const handlePlay = useCallback(() => {
    if (!url) return;
    setIsPlaying(true);
  }, [url]);

  const handleClose = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleOpenExternal = useCallback(() => {
    if (url) Linking.openURL(url);
  }, [url]);

  const playUrl = url ? getPlayableUrl(url, detectedType) : '';

  return (
    <View style={styles.container}>
      {!isPlaying ? (
        <>
          <Text style={styles.title}>Play & Transcribe</Text>
          <Text style={styles.subtitle}>
            Paste a URL — play it here, then tap Start to caption via mic
          </Text>

          {/* URL input */}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.urlInput}
              placeholder="https://youtube.com/watch?v=..."
              placeholderTextColor="#444"
              value={url}
              onChangeText={handleUrlChange}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessible
              accessibilityLabel="Video or audio URL"
            />
            <TouchableOpacity style={styles.pasteButton} onPress={handlePaste}>
              <Text style={styles.pasteText}>Paste</Text>
            </TouchableOpacity>
          </View>

          {/* Detected URL type badge */}
          {url.length > 0 && (
            <View style={styles.detectedRow}>
              <View style={[styles.typeBadge, detectedType === 'youtube' && styles.youtubeBadge]}>
                <Text style={[styles.typeBadgeText, detectedType === 'youtube' && styles.youtubeText]}>
                  {URL_TYPE_LABELS[detectedType]}
                </Text>
              </View>
            </View>
          )}

          {/* Play button */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.playButton, !url && styles.playButtonDisabled]}
              onPress={handlePlay}
              disabled={!url}
            >
              <Text style={styles.playText}>Open Player</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.hintText}>
            Play the video here, then tap Start below to caption the audio via mic.
            {'\n'}Works with YouTube, Twitch, podcasts, news — any URL with audio.
          </Text>
        </>
      ) : (
        <>
          {/* WebView player header with navigation */}
          <View style={styles.playerHeader}>
            <View style={styles.navButtons}>
              <TouchableOpacity
                onPress={() => webViewRef.current?.goBack()}
                style={[styles.navBtn, !canGoBack && styles.navBtnDisabled]}
                disabled={!canGoBack}
              >
                <Text style={[styles.navBtnText, !canGoBack && styles.navBtnTextDisabled]}>{'<'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => webViewRef.current?.goForward()}
                style={[styles.navBtn, !canGoForward && styles.navBtnDisabled]}
                disabled={!canGoForward}
              >
                <Text style={[styles.navBtnText, !canGoForward && styles.navBtnTextDisabled]}>{'>'}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.playerActions}>
              <TouchableOpacity onPress={handleOpenExternal} style={styles.headerBtn}>
                <Text style={styles.headerBtnText}>External</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* URL bar */}
          <View style={styles.urlBar}>
            <Text style={styles.urlBarText} numberOfLines={1}>
              {currentUrl || playUrl}
            </Text>
          </View>

          <View style={styles.webViewContainer}>
            <WebView
              ref={webViewRef}
              source={{ uri: playUrl }}
              style={styles.webView}
              userAgent={MOBILE_USER_AGENT}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              onLoadEnd={() => {
                // Inject keep-playing script AFTER page fully loads to avoid
                // interfering with sites like Dailymotion during initialization
                webViewRef.current?.injectJavaScript(KEEP_PLAYING_JS);
              }}
              allowsFullscreenVideo={true}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              startInLoadingState={true}
              allowsBackForwardNavigationGestures={true}
              mixedContentMode="always"
              sharedCookiesEnabled={true}
              allowsProtectedMedia={true}
              onNavigationStateChange={(navState) => {
                setCanGoBack(navState.canGoBack || false);
                setCanGoForward(navState.canGoForward || false);
                setCurrentUrl(navState.url || '');
              }}
              onError={(e) => console.log('[WebView] Error:', e.nativeEvent.description)}
              onHttpError={(e) => console.log('[WebView] HTTP Error:', e.nativeEvent.statusCode, e.nativeEvent.url)}
            />
          </View>

          <Text style={styles.playerHint}>
            Tap Start below to begin captioning the audio
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 20,
    margin: 16,
    gap: 12,
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
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  urlInput: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    color: '#FFF',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pasteButton: {
    backgroundColor: '#1A3A4A',
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: 'center',
  },
  pasteText: {
    color: '#4FC3F7',
    fontSize: 14,
    fontWeight: '600',
  },
  detectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeBadge: {
    backgroundColor: '#252525',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  youtubeBadge: {
    backgroundColor: '#3A1A1A',
  },
  typeBadgeText: {
    color: '#999',
    fontSize: 12,
    fontWeight: '600',
  },
  youtubeText: {
    color: '#E53935',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  playButton: {
    backgroundColor: '#4FC3F7',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 10,
  },
  playButtonDisabled: {
    opacity: 0.4,
  },
  playText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  hintText: {
    color: '#444',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
  // Player mode
  playerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  navBtn: {
    width: 32,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#252525',
    justifyContent: 'center',
    alignItems: 'center',
  },
  navBtnDisabled: {
    opacity: 0.3,
  },
  navBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  navBtnTextDisabled: {
    color: '#666',
  },
  urlBar: {
    backgroundColor: '#1A1A1A',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  urlBarText: {
    color: '#666',
    fontSize: 11,
  },
  playerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerBtn: {
    backgroundColor: '#252525',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  headerBtnText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  closeBtn: {
    backgroundColor: '#3A1A1A',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  closeBtnText: {
    color: '#E53935',
    fontSize: 12,
    fontWeight: '600',
  },
  webViewContainer: {
    height: 340,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  webView: {
    flex: 1,
    backgroundColor: '#000',
  },
  playerHint: {
    color: '#4FC3F7',
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
});
