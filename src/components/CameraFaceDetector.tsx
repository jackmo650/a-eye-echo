// ============================================================================
// Camera Face Detector — Vision Camera + MLKit face detection component
//
// NOTE: Requires native build (expo prebuild) with:
//   - react-native-vision-camera
//   - react-native-vision-camera-face-detector
//   - react-native-worklets-core
//
// In managed Expo builds, this renders a placeholder.
// ============================================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { CameraPosition } from '../types';

interface CameraFaceDetectorProps {
  cameraPosition: CameraPosition;
  isActive: boolean;
  showPreview?: boolean;
}

export function CameraFaceDetector({
  isActive,
  showPreview = true,
}: CameraFaceDetectorProps) {
  if (!isActive || !showPreview) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Camera{'\n'}(dev build)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    right: 12,
    width: 100,
    height: 130,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#333',
    zIndex: 10,
    backgroundColor: '#1A1A1A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center',
  },
});
