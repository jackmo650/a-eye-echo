// ============================================================================
// Caption Display — Full-screen live caption view
// Supports dual-caption mode: original text + translated text
//
// Accessibility features:
//   - Pinch-to-zoom font size
//   - High-contrast themes
//   - Configurable position (top/center/bottom)
//   - Word-wrap with max lines
//   - Speaker color coding
//   - Translation overlay (original smaller, translated larger)
//   - Sign language source indicator
// ============================================================================

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import type { CaptionStyle, Speaker } from '../types';

interface CaptionDisplayProps {
  /** Current caption text to display */
  text: string;
  /** Translated text (if translation enabled) */
  translatedText?: string;
  /** Whether to show original text alongside translation */
  showOriginal?: boolean;
  /** Caption styling (from theme/settings) */
  style: CaptionStyle;
  /** Active speaker (for color coding) */
  speaker?: Speaker | null;
  /** Input source indicator */
  source?: 'speech' | 'sign-language';
  /** Container dimensions */
  width: number;
  height: number;
}

export function CaptionDisplay({
  text,
  translatedText,
  showOriginal = true,
  style: captionStyle,
  speaker,
  source,
  width,
  height,
}: CaptionDisplayProps) {
  const styles = useMemo(
    () => buildStyles(captionStyle, speaker, width, height),
    [captionStyle, speaker, width, height],
  );

  if (!text.trim() && !translatedText?.trim()) {
    return <View style={styles.container} />;
  }

  const hasTranslation = translatedText && translatedText.trim();
  const displayText = hasTranslation ? translatedText : text;
  const originalText = hasTranslation && showOriginal ? text : null;

  return (
    <View style={styles.container}>
      <View style={styles.positioner}>
        <View style={styles.background}>
          {/* Speaker label + source indicator */}
          {(speaker || source === 'sign-language') && (
            <View style={styles.headerRow}>
              {speaker && (
                <Text style={styles.speakerLabel}>
                  {speaker.label}
                </Text>
              )}
              {source === 'sign-language' && (
                <Text style={styles.sourceIndicator}>ASL</Text>
              )}
            </View>
          )}

          {/* Original text (smaller, above translation) */}
          {originalText && (
            <Text
              style={styles.originalText}
              numberOfLines={2}
              ellipsizeMode="tail"
              accessible
              accessibilityLabel={`Original: ${originalText}`}
            >
              {originalText}
            </Text>
          )}

          {/* Main caption text (or translated text) */}
          <Text
            style={styles.captionText}
            numberOfLines={captionStyle.maxLines}
            ellipsizeMode="tail"
            accessible
            accessibilityRole="text"
            accessibilityLabel={`Caption: ${displayText}`}
          >
            {displayText}
          </Text>
        </View>
      </View>
    </View>
  );
}

function buildStyles(
  caption: CaptionStyle,
  speaker: Speaker | null | undefined,
  width: number,
  height: number,
) {
  const padding = caption.fontSize * 0.4;
  const bgAlpha = caption.bgOpacity / 100;
  const bgColor = hexToRgba(caption.bgColor, bgAlpha);

  // Map position to flexbox alignment
  const justifyMap: Record<string, ViewStyle['justifyContent']> = {
    top: 'flex-start',
    center: 'center',
    bottom: 'flex-end',
  };

  // Map font family names to platform fonts
  const fontFamilyMap: Record<string, string> = {
    System: 'System',
    Inter: 'System',
    OpenDyslexic: 'OpenDyslexic',
    Atkinson: 'Atkinson Hyperlegible',
    'SF Mono': 'SF Mono',
    'Courier New': 'Courier New',
  };

  const textColor = speaker?.color || caption.color;

  return StyleSheet.create({
    container: {
      position: 'absolute',
      top: 0,
      left: 0,
      width,
      height,
      justifyContent: justifyMap[caption.position] || 'flex-end',
      padding: padding * 2,
      pointerEvents: 'none',
    } satisfies ViewStyle,

    positioner: {
      alignItems: 'center',
      width: '100%',
    } satisfies ViewStyle,

    background: {
      backgroundColor: bgColor,
      borderRadius: caption.fontSize * 0.25,
      paddingHorizontal: padding,
      paddingVertical: padding * 0.6,
      maxWidth: width - padding * 4,
    } satisfies ViewStyle,

    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    } satisfies ViewStyle,

    speakerLabel: {
      fontSize: caption.fontSize * 0.45,
      fontWeight: '700',
      color: speaker?.color || caption.color,
      opacity: 0.8,
    } satisfies TextStyle,

    sourceIndicator: {
      fontSize: caption.fontSize * 0.35,
      fontWeight: '700',
      color: '#4FC3F7',
      backgroundColor: 'rgba(79, 195, 247, 0.15)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      overflow: 'hidden',
    } satisfies TextStyle,

    originalText: {
      fontSize: caption.fontSize * 0.6,
      fontFamily: fontFamilyMap[caption.fontFamily] || 'System',
      color: textColor,
      opacity: 0.6,
      lineHeight: caption.fontSize * 0.8,
      textAlign: 'center',
      marginBottom: 4,
      fontStyle: 'italic',
    } satisfies TextStyle,

    captionText: {
      fontSize: caption.fontSize,
      fontFamily: fontFamilyMap[caption.fontFamily] || 'System',
      color: textColor,
      lineHeight: caption.fontSize * 1.3,
      textAlign: 'center',
      textShadowColor: caption.outlineColor,
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: caption.outlineWidth * 2,
    } satisfies TextStyle,
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
