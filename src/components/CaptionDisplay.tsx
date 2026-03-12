// ============================================================================
// Caption Display — Full-screen live caption view
// Ported from WallSpace.Studio captionRenderer.ts styling system.
// Adapted from canvas rendering to React Native Text components.
//
// Accessibility features:
//   - Pinch-to-zoom font size
//   - High-contrast themes
//   - Configurable position (top/center/bottom)
//   - Word-wrap with max lines
//   - Speaker color coding
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
  /** Caption styling (from theme/settings) */
  style: CaptionStyle;
  /** Active speaker (for color coding) */
  speaker?: Speaker | null;
  /** Container dimensions */
  width: number;
  height: number;
}

export function CaptionDisplay({
  text,
  style: captionStyle,
  speaker,
  width,
  height,
}: CaptionDisplayProps) {
  const styles = useMemo(
    () => buildStyles(captionStyle, speaker, width, height),
    [captionStyle, speaker, width, height],
  );

  if (!text.trim()) {
    return <View style={styles.container} />;
  }

  // Truncate to max lines using numberOfLines prop
  return (
    <View style={styles.container}>
      <View style={styles.positioner}>
        <View style={styles.background}>
          {speaker && (
            <Text style={styles.speakerLabel}>
              {speaker.label}
            </Text>
          )}
          <Text
            style={styles.captionText}
            numberOfLines={captionStyle.maxLines}
            ellipsizeMode="tail"
            accessible
            accessibilityRole="text"
            accessibilityLabel={`Caption: ${text}`}
          >
            {text}
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
    Inter: 'System', // Will use platform default if Inter not installed
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

    speakerLabel: {
      fontSize: caption.fontSize * 0.45,
      fontWeight: '700',
      color: speaker?.color || caption.color,
      marginBottom: 4,
      opacity: 0.8,
    } satisfies TextStyle,

    captionText: {
      fontSize: caption.fontSize,
      fontFamily: fontFamilyMap[caption.fontFamily] || 'System',
      color: textColor,
      lineHeight: caption.fontSize * 1.3,
      textAlign: 'center',
      // Text outline simulation via shadow (RN doesn't support strokeText)
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
