// ============================================================================
// Camera Face Detector — Vision Camera + MLKit face detection + hand landmarks
//
// Renders a small camera preview (PiP style) and runs frame processors for:
//   1. Face detection → SpeakerService (lip-sync correlation)
//   2. Hand landmarks → SignLanguageService (ASL/BSL recognition) [future]
//
// Requires native build (expo prebuild) with:
//   - react-native-vision-camera
//   - react-native-vision-camera-face-detector
//   - react-native-worklets-core
// ============================================================================

import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { CameraPosition } from '../types';
import { getSpeakerService } from '../services/speakerService';

let Camera: any = null;
let useCameraDevice: any = null;
let useCameraPermission: any = null;
let useFrameProcessor: any = null;
let detectFaces: any = null;
let Worklets: any = null;

// Load native modules — fail gracefully if not available
let _nativeAvailable = false;
try {
  const vc = require('react-native-vision-camera');
  Camera = vc.Camera;
  useCameraDevice = vc.useCameraDevice;
  useCameraPermission = vc.useCameraPermission;
  useFrameProcessor = vc.useFrameProcessor;

  const fd = require('react-native-vision-camera-face-detector');
  detectFaces = fd.detectFaces;

  Worklets = require('react-native-worklets-core');
  _nativeAvailable = true;
} catch {
  console.warn('[CameraFaceDetector] Native vision modules not available');
}

interface CameraFaceDetectorProps {
  cameraPosition: CameraPosition;
  isActive: boolean;
  showPreview?: boolean;
}

// Placeholder for when native modules aren't available
function PlaceholderCamera({ showPreview }: { showPreview: boolean }) {
  if (!showPreview) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.placeholderText}>Camera{'\n'}(rebuilding...)</Text>
    </View>
  );
}

// Real camera implementation
function RealCamera({ cameraPosition, isActive, showPreview = true }: CameraFaceDetectorProps) {
  const device = useCameraDevice(cameraPosition === 'front' ? 'front' : 'back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const speakerService = useRef(getSpeakerService());

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // Bridge function to call speakerService from worklet thread
  const processFacesJS = Worklets.createRunOnJS((facesJSON: string) => {
    try {
      const faces = JSON.parse(facesJSON);
      speakerService.current.processFaces(faces);
    } catch {
      // Parse error — skip frame
    }
  });

  const frameProcessor = useFrameProcessor((frame: any) => {
    'worklet';
    try {
      const faces = detectFaces(frame, {
        performanceMode: 'fast',
        landmarkMode: 'all',
        classificationMode: 'all',
        trackingEnabled: true,
        minFaceSize: 0.15,
      });

      if (faces && faces.length > 0) {
        // Serialize for JS thread — worklet can't pass complex objects directly
        const simplified = faces.map((f: any) => ({
          bounds: f.bounds || { x: 0, y: 0, width: 0, height: 0 },
          trackingId: f.trackingId ?? -1,
          smilingProbability: f.smilingProbability ?? undefined,
          leftEyeOpenProbability: f.leftEyeOpenProbability ?? undefined,
          rightEyeOpenProbability: f.rightEyeOpenProbability ?? undefined,
          landmarks: f.landmarks ? Object.fromEntries(
            Object.entries(f.landmarks).map(([k, v]: [string, any]) => [k, { x: v.x, y: v.y }])
          ) : undefined,
        }));
        processFacesJS(JSON.stringify(simplified));
      }
    } catch {
      // Frame processor error — skip frame
    }
  }, [processFacesJS]);

  if (!isActive || !showPreview) return null;
  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.placeholderText}>Camera{'\n'}permission needed</Text>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.placeholderText}>No camera{'\n'}available</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        frameProcessor={frameProcessor}
        fps={15}
        pixelFormat="yuv"
      />
      {/* Speaking indicator overlay */}
      <View style={styles.overlay}>
        <SpeakingIndicator />
      </View>
    </View>
  );
}

// Small indicator dot that shows when a speaker is detected
function SpeakingIndicator() {
  const service = getSpeakerService();
  const active = service.getActiveSpeaker();
  if (!active) return null;

  return (
    <View style={styles.speakingBadge}>
      <View style={[styles.speakingDot, { backgroundColor: active.speaker.color }]} />
      <Text style={styles.speakingLabel} numberOfLines={1}>
        {active.speaker.label}
      </Text>
    </View>
  );
}

export function CameraFaceDetector(props: CameraFaceDetectorProps) {
  if (!_nativeAvailable) {
    return <PlaceholderCamera showPreview={props.showPreview ?? true} />;
  }
  return <RealCamera {...props} />;
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
  placeholderText: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 4,
  },
  speakingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 4,
  },
  speakingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  speakingLabel: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '600',
    flex: 1,
  },
});
