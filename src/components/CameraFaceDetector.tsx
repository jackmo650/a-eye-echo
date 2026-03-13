// ============================================================================
// Camera Face Detector — Vision Camera + MLKit face detection + hand landmarks
//
// Renders a small camera preview (PiP style) and runs frame processors for:
//   1. Face detection → SpeakerService (lip-sync correlation)
//   2. Hand landmarks → SignLanguageService (ASL/BSL recognition)
//
// Requires native build (expo prebuild) with:
//   - react-native-vision-camera
//   - react-native-vision-camera-face-detector
//   - react-native-worklets-core
//   - MediaPipeTasksVision (hand_landmarker.task bundled in iOS)
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { CameraPosition } from '../types';
import { getSpeakerService } from '../services/speakerService';
import { getSignLanguageService } from '../services/signLanguageService';

let Camera: any = null;
let useCameraDevice: any = null;
let useCameraPermission: any = null;
let useFrameProcessor: any = null;
let detectFaces: any = null;
let WorkletsAPI: any = null;

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

  const wm = require('react-native-worklets-core');
  WorkletsAPI = wm.Worklets;
  _nativeAvailable = true;
} catch {
  console.warn('[CameraFaceDetector] Native vision modules not available');
}

// Get hand landmark plugin handle — used directly in frame processor worklet
let _handPlugin: any = null;
let _handPluginStatus = 'not-init';
try {
  const vc = require('react-native-vision-camera');
  if (vc.VisionCameraProxy) {
    _handPlugin = vc.VisionCameraProxy.initFrameProcessorPlugin('detectHandLandmarks', {});
    _handPluginStatus = _handPlugin ? 'LOADED' : 'NULL-plugin';
    console.log(`[CameraFD] Hand landmark plugin: ${_handPluginStatus}`);
  } else {
    _handPluginStatus = 'no-proxy';
  }
} catch (e: any) {
  _handPluginStatus = `ERR:${e?.message?.slice(0, 30) || 'unknown'}`;
  console.warn('[CameraFD] Hand landmark plugin load failed:', e);
}

interface CameraFaceDetectorProps {
  cameraPosition: CameraPosition;
  isActive: boolean;
  showPreview?: boolean;
  signLanguageEnabled?: boolean;
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
function RealCamera({ cameraPosition, isActive, showPreview = true, signLanguageEnabled = false }: CameraFaceDetectorProps) {
  const device = useCameraDevice(cameraPosition === 'front' ? 'front' : 'back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const speakerService = useRef(getSpeakerService());
  const signLanguageService = useRef(getSignLanguageService());
  const [handDebug, setHandDebug] = useState<string>('init');

  // Verify overlay renders — set a timestamp every 2s
  useEffect(() => {
    const t = setInterval(() => {
      setHandDebug(prev => prev.startsWith('init') || prev.startsWith('waiting')
        ? `waiting...${Date.now() % 10000}`
        : prev);
    }, 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // Bridge functions to call services from worklet thread (must be memoized)
  const processFacesJS = useMemo(() => WorkletsAPI.createRunOnJS((facesJSON: string) => {
    try {
      const faces = JSON.parse(facesJSON);
      speakerService.current.processFaces(faces);
    } catch {
      // Parse error — skip frame
    }
  }), []);

  const processHandsJS = useMemo(() => WorkletsAPI.createRunOnJS((handsJSON: string) => {
    try {
      // Debug messages from worklet start with "DBG:"
      if (handsJSON.startsWith('DBG:')) {
        setHandDebug(handsJSON.slice(4));
        return;
      }
      const hands = JSON.parse(handsJSON);
      const ptCount = hands[0]?.points?.length || 0;
      setHandDebug(`H:${hands.length} P:${ptCount}`);
      signLanguageService.current.processHandLandmarks(hands);
    } catch (e) {
      setHandDebug(`PARSE-ERR`);
      console.warn('[CameraFD] Hand parse error:', e);
    }
  }), []);

  const frameProcessor = useFrameProcessor((frame: any) => {
    'worklet';
    // Face detection — independent try block
    try {
      const faces = detectFaces(frame, {
        performanceMode: 'fast',
        landmarkMode: 'all',
        classificationMode: 'all',
        trackingEnabled: true,
        minFaceSize: 0.15,
      });

      if (faces && faces.length > 0) {
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
      // Face detection error — skip
    }

    // Hand landmark detection — separate try block
    try {
      if (_handPlugin != null) {
        // @ts-ignore — plugin.call() returns native result
        const hands = _handPlugin.call(frame);
        if (hands && Array.isArray(hands) && hands.length > 0) {
          processHandsJS(JSON.stringify(hands));
        } else {
          processHandsJS('DBG:no-hands');
        }
      } else {
        processHandsJS('DBG:no-plugin');
      }
    } catch (e: any) {
      processHandsJS('DBG:ERR:' + (e?.message || '?').substring(0, 40));
    }
  }, [processFacesJS, processHandsJS]);

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
      {/* Speaking/signing indicator overlay */}
      <View style={styles.overlay}>
        <SpeakingIndicator />
        {signLanguageEnabled && (
          <View style={styles.signBadge}>
            <Text style={styles.signBadgeText}>ASL [{_handPluginStatus}]</Text>
          </View>
        )}
        <View style={styles.signBadge}>
          <Text style={styles.signBadgeText}>{handDebug}</Text>
        </View>
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
    gap: 2,
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
  signBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(79, 195, 247, 0.3)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  signBadgeText: {
    color: '#4FC3F7',
    fontSize: 8,
    fontWeight: '700',
  },
});
