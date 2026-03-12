// ============================================================================
// Transcript Store — Zustand state for live captions and session management
// Single source of truth for current transcript, speakers, and session state.
// ============================================================================

import { create } from 'zustand';
import type {
  TranscriptSegment,
  TranscriptSession,
  Speaker,
  TranscriptionStatus,
} from '../types';

const SPEAKER_COLORS = [
  '#4FC3F7', // Blue
  '#FFB74D', // Orange
  '#81C784', // Green
  '#E57373', // Red
  '#BA68C8', // Purple
  '#FFD54F', // Yellow
  '#4DB6AC', // Teal
  '#F06292', // Pink
];

interface TranscriptState {
  // ── Current session ──
  status: TranscriptionStatus;
  currentSession: TranscriptSession | null;
  segments: TranscriptSegment[];
  speakers: Speaker[];
  currentText: string;

  // ── Session history ──
  pastSessions: TranscriptSession[];

  // ── Actions ──
  setStatus: (status: TranscriptionStatus) => void;

  startSession: (session: Omit<TranscriptSession, 'segmentCount' | 'durationMs' | 'endedAt'>) => void;
  endSession: () => void;

  addSegment: (segment: TranscriptSegment) => void;
  setCurrentText: (text: string) => void;

  addOrUpdateSpeaker: (speakerId: string, updates?: Partial<Speaker>) => Speaker;
  renameSpeaker: (speakerId: string, label: string) => void;

  clearCurrentSession: () => void;
  loadPastSessions: (sessions: TranscriptSession[]) => void;
}

export const useTranscriptStore = create<TranscriptState>((set, get) => ({
  status: 'idle',
  currentSession: null,
  segments: [],
  speakers: [],
  currentText: '',
  pastSessions: [],

  setStatus: (status) => set({ status }),

  startSession: (session) => set({
    currentSession: {
      ...session,
      endedAt: null,
      segmentCount: 0,
      durationMs: 0,
    },
    segments: [],
    speakers: [],
    currentText: '',
    status: 'loading-model',
  }),

  endSession: () => {
    const { currentSession, segments } = get();
    if (!currentSession) return;

    const endedSession: TranscriptSession = {
      ...currentSession,
      endedAt: new Date().toISOString(),
      segmentCount: segments.length,
      durationMs: segments.length > 0
        ? segments[segments.length - 1].endMs
        : 0,
    };

    set(state => ({
      currentSession: null,
      status: 'idle',
      pastSessions: [endedSession, ...state.pastSessions],
    }));
  },

  addSegment: (segment) => set(state => ({
    segments: [...state.segments, segment],
    currentText: segment.text,
    currentSession: state.currentSession
      ? { ...state.currentSession, segmentCount: state.segments.length + 1 }
      : null,
  })),

  setCurrentText: (text) => set({ currentText: text }),

  addOrUpdateSpeaker: (speakerId, updates) => {
    const { speakers } = get();
    const existing = speakers.find(s => s.id === speakerId);
    if (existing) {
      if (updates) {
        const updated = { ...existing, ...updates };
        set({
          speakers: speakers.map(s => s.id === speakerId ? updated : s),
        });
        return updated;
      }
      return existing;
    }

    // New speaker
    const index = speakers.length;
    const letter = String.fromCharCode(65 + (index % 26)); // A, B, C...
    const newSpeaker: Speaker = {
      id: speakerId,
      label: `Speaker ${letter}`,
      color: SPEAKER_COLORS[index % SPEAKER_COLORS.length],
      thumbnailUri: null,
      embedding: null,
      ...updates,
    };

    set({ speakers: [...speakers, newSpeaker] });
    return newSpeaker;
  },

  renameSpeaker: (speakerId, label) => set(state => ({
    speakers: state.speakers.map(s =>
      s.id === speakerId ? { ...s, label } : s,
    ),
  })),

  clearCurrentSession: () => set({
    currentSession: null,
    segments: [],
    speakers: [],
    currentText: '',
    status: 'idle',
  }),

  loadPastSessions: (sessions) => set({ pastSessions: sessions }),
}));
