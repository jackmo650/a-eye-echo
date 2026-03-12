// ============================================================================
// Camera Face Detector — Vision Camera + MLKit face detection component
//
// Renders a small camera preview in the corner of the screen and runs
// face detection via MLKit frame processor. Detected faces are fed to
// SpeakerService for lip-sync correlation and speaker identification.
//
// Dependencies:
//   - react-native-vision-camera
//   - react-native-vision-camera-face-detector
//   - react-native-worklets-core
// ============================================================================

import React, { useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useFrameProcessor,
  runAsync,
} from 'react-native-vision-camera';
import {
  useFaceDetector,
  type Face,
  type FaceDetectionOptions,
} from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';
import { getSpeakerService } from '../services/speakerService';
import type { CameraPosition } from '../types';

interface CameraFaceDetectorProps {
  /** Which camera to use */
  cameraPosition: CameraPosition;
  /** Whether detection is active */
  isActive: boolean;
  /** Show camera preview (small corner overlay) */
  showPreview?: boolean;
}

export function CameraFaceDetector({
  cameraPosition,
  isActive,
  showPreview = true,
}: CameraFaceDetectorProps) {
  const device = useCameraDevice(cameraPosition);

  const faceDetectionOptions = useRef<FaceDetectionOptions>({
    performanceMode: 'fast',
    landmarkMode: 'all',        // Need mouth landmarks for lip-sync
    classificationMode: 'all',  // Smiling probability useful for UX
    trackingEnabled: true,      // Track faces across frames
    minFaceSize: 0.15,
    cameraFacing: cameraPosition,
  }).current;

  const { detectFaces, stopListeners } = useFaceDetector(faceDetectionOptions);

  // Cleanup on unmount or camera disable
  useEffect(() => {
    return () => {
      stopListeners();
    };
  }, [stopListeners]);

  // Request camera permission
  useEffect(() => {
    if (!device || !isActive) {
      stopListeners();
      return;
    }

    (async () => {
      const status = await Camera.requestCameraPermission();
      console.log(`[CameraFaceDetector] Permission: ${status}`);
    })();
  }, [device, isActive, stopListeners]);

  // Handle detected faces — runs on JS thread via worklet bridge
  const handleDetectedFaces = Worklets.createRunOnJS((faces: Face[]) => {
    if (!isActive) return;

    const speakerService = getSpeakerService();
    // MLKit Face objects map to our MLKitFace interface
    speakerService.processFaces(faces as unknown[]);
  });

  // Frame processor — runs on camera thread
  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      runAsync(frame, () => {
        'worklet';
        const faces = detectFaces(frame);
        if (faces.length > 0) {
          handleDetectedFaces(faces);
        }
      });
    },
    [handleDetectedFaces, detectFaces],
  );

  if (!device || !isActive) return null;

  return (
    <View style={[styles.container, !showPreview && styles.hidden]}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        frameProcessor={frameProcessor}
        // Low resolution is fine for face detection — saves battery
        photo={false}
        video={false}
        audio={false}
        fps={15} // 15fps is plenty for face detection
      />
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
  },
  hidden: {
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
});
