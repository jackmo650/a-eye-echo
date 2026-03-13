// ============================================================================
// Caption Share Panel — Host or join a caption sharing session
//
// Host: generates a 6-digit room code, broadcasts segments to receivers.
// Receiver: enters room code, receives and displays live captions.
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
} from 'react-native';
import {
  getCaptionNetworkService,
  type NetworkStatus,
} from '../services/captionNetworkService';
import { useTranscriptStore } from '../stores/useTranscriptStore';

interface CaptionSharePanelProps {
  onReceivedSegment?: () => void;
}

export function CaptionSharePanel({ onReceivedSegment }: CaptionSharePanelProps) {
  const [status, setStatus] = useState<NetworkStatus>({
    role: 'disconnected',
    roomCode: null,
    connectedPeers: 0,
    isConnected: false,
  });
  const [joinCode, setJoinCode] = useState('');
  const addSegment = useTranscriptStore(s => s.addSegment);

  const service = getCaptionNetworkService();

  useEffect(() => {
    const unsub = service.onStatusChange(setStatus);
    return unsub;
  }, []);

  // When receiving, add segments to the transcript store
  useEffect(() => {
    if (status.role !== 'receiver') return;

    const unsub = service.onSegment((segment) => {
      addSegment(segment);
      onReceivedSegment?.();
    });
    return unsub;
  }, [status.role]);

  const handleStartHosting = useCallback(async () => {
    try {
      await service.startHosting();
    } catch (err) {
      Alert.alert('Connection Failed', 'Could not connect to caption relay. Check your internet connection.');
    }
  }, []);

  const handleJoinRoom = useCallback(async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      Alert.alert('Invalid Code', 'Room codes are 6 characters.');
      return;
    }
    try {
      await service.joinRoom(code);
    } catch (err) {
      Alert.alert('Connection Failed', 'Could not connect to caption relay. Check your internet connection.');
    }
  }, [joinCode]);

  const handleDisconnect = useCallback(() => {
    service.disconnect();
  }, []);

  const handleShareCode = useCallback(async () => {
    if (!status.roomCode) return;
    await Share.share({
      message: `Join my live captions in A.EYE.ECHO!\nRoom code: ${status.roomCode}`,
    });
  }, [status.roomCode]);

  // ── Hosting View ─────────────────────────────────────────────────────────

  if (status.role === 'host') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Broadcasting Captions</Text>
        <View style={styles.codeContainer}>
          <Text style={styles.codeLabel}>Room Code</Text>
          <Text style={styles.code}>{status.roomCode}</Text>
        </View>
        <Text style={styles.peerCount}>
          {status.connectedPeers} {status.connectedPeers === 1 ? 'viewer' : 'viewers'} connected
        </Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.shareButton} onPress={handleShareCode}>
            <Text style={styles.shareButtonText}>Share Code</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnect}>
            <Text style={styles.disconnectButtonText}>Stop Sharing</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Receiving View ───────────────────────────────────────────────────────

  if (status.role === 'receiver') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Receiving Captions</Text>
        <View style={styles.codeContainer}>
          <Text style={styles.codeLabel}>Room</Text>
          <Text style={styles.code}>{status.roomCode}</Text>
        </View>
        <View style={styles.statusDot}>
          <View style={[styles.dot, status.isConnected ? styles.dotGreen : styles.dotRed]} />
          <Text style={styles.statusText}>
            {status.isConnected ? 'Connected' : 'Reconnecting...'}
          </Text>
        </View>
        <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnect}>
          <Text style={styles.disconnectButtonText}>Disconnect</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Disconnected View (Setup) ────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Caption Sharing</Text>
      <Text style={styles.description}>
        Share live captions with nearby devices. One device captures audio, others receive captions.
      </Text>

      <TouchableOpacity style={styles.hostButton} onPress={handleStartHosting}>
        <Text style={styles.hostButtonText}>Start Broadcasting</Text>
        <Text style={styles.hostButtonSub}>Share your captions with others</Text>
      </TouchableOpacity>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>OR</Text>
        <View style={styles.dividerLine} />
      </View>

      <Text style={styles.joinLabel}>Join a Room</Text>
      <View style={styles.joinRow}>
        <TextInput
          style={styles.joinInput}
          value={joinCode}
          onChangeText={setJoinCode}
          placeholder="ABCD23"
          placeholderTextColor="#666"
          autoCapitalize="characters"
          maxLength={6}
        />
        <TouchableOpacity
          style={[styles.joinButton, joinCode.length < 6 && styles.joinButtonDisabled]}
          onPress={handleJoinRoom}
          disabled={joinCode.length < 6}
        >
          <Text style={styles.joinButtonText}>Join</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    margin: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 20,
    lineHeight: 20,
  },
  codeContainer: {
    alignItems: 'center',
    paddingVertical: 16,
    marginBottom: 8,
  },
  codeLabel: {
    fontSize: 12,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 4,
  },
  code: {
    fontSize: 36,
    fontWeight: '800',
    color: '#4FC3F7',
    letterSpacing: 8,
    fontVariant: ['tabular-nums'],
  },
  peerCount: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  hostButton: {
    backgroundColor: '#4FC3F7',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  hostButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  hostButtonSub: {
    fontSize: 12,
    color: '#333',
    marginTop: 4,
  },
  shareButton: {
    flex: 1,
    backgroundColor: '#4FC3F7',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  shareButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  disconnectButton: {
    flex: 1,
    backgroundColor: '#333',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  disconnectButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E57373',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#333',
  },
  dividerText: {
    color: '#666',
    marginHorizontal: 12,
    fontSize: 12,
    fontWeight: '600',
  },
  joinLabel: {
    fontSize: 14,
    color: '#ccc',
    marginBottom: 8,
    fontWeight: '600',
  },
  joinRow: {
    flexDirection: 'row',
    gap: 12,
  },
  joinInput: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  joinButton: {
    backgroundColor: '#4FC3F7',
    borderRadius: 10,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  joinButtonDisabled: {
    backgroundColor: '#333',
  },
  joinButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
  },
  statusDot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotGreen: {
    backgroundColor: '#81C784',
  },
  dotRed: {
    backgroundColor: '#E57373',
  },
  statusText: {
    fontSize: 14,
    color: '#aaa',
  },
});
