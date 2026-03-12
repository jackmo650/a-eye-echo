// ============================================================================
// Sign Language Service — MediaPipe hand landmarks → ASL/BSL recognition
//
// Pipeline:
//   Camera Frame → MediaPipe Hand Landmarker (21 keypoints × 2 hands)
//     → Landmark Buffer (rolling window)
//       → ASL Classifier (distance-based heuristic + learned patterns)
//         → Recognized sign (letter/word)
//           → Text assembly → Translation (optional) → Caption
//
// Phase 1: ASL fingerspelling alphabet (A-Z) via static gesture classification
// using hand landmark geometry (angles, distances, finger states).
//
// Dependencies:
//   - react-native-vision-camera (frame processor)
//   - MediaPipe hand landmark model (bundled or loaded via TFLite)
// ============================================================================

import type {
  HandLandmark,
  HandLandmarks,
  SignLanguageType,
  SignRecognition,
  TranscriptSegment,
} from '../types';

type RecognitionCallback = (segment: TranscriptSegment) => void;

// ── ASL Fingerspelling Classifier ───────────────────────────────────────────

// MediaPipe hand landmark indices
const WRIST = 0;
const THUMB_CMC = 1, THUMB_MCP = 2, THUMB_IP = 3, THUMB_TIP = 4;
const INDEX_MCP = 5, INDEX_PIP = 6, INDEX_DIP = 7, INDEX_TIP = 8;
const MIDDLE_MCP = 9, MIDDLE_PIP = 10, MIDDLE_DIP = 11, MIDDLE_TIP = 12;
const RING_MCP = 13, RING_PIP = 14, RING_DIP = 15, RING_TIP = 16;
const PINKY_MCP = 17, PINKY_PIP = 18, PINKY_DIP = 19, PINKY_TIP = 20;

interface FingerState {
  isExtended: boolean;
  curl: number; // 0 = straight, 1 = fully curled
}

function distance(a: HandLandmark, b: HandLandmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function getFingerStates(points: HandLandmark[]): {
  thumb: FingerState;
  index: FingerState;
  middle: FingerState;
  ring: FingerState;
  pinky: FingerState;
} {
  const fingerExtended = (tip: number, pip: number, mcp: number): FingerState => {
    const tipToWrist = distance(points[tip], points[WRIST]);
    const pipToWrist = distance(points[pip], points[WRIST]);
    const mcpToWrist = distance(points[mcp], points[WRIST]);
    const isExtended = tipToWrist > pipToWrist;
    const maxExtension = mcpToWrist * 1.8;
    const curl = 1 - Math.min(1, tipToWrist / maxExtension);
    return { isExtended, curl };
  };

  // Thumb uses different logic (lateral movement)
  const thumbTipToIndex = distance(points[THUMB_TIP], points[INDEX_MCP]);
  const thumbIsExtended = thumbTipToIndex > distance(points[THUMB_MCP], points[INDEX_MCP]) * 0.8;
  const thumbCurl = thumbIsExtended ? 0 : 0.8;

  return {
    thumb: { isExtended: thumbIsExtended, curl: thumbCurl },
    index: fingerExtended(INDEX_TIP, INDEX_PIP, INDEX_MCP),
    middle: fingerExtended(MIDDLE_TIP, MIDDLE_PIP, MIDDLE_MCP),
    ring: fingerExtended(RING_TIP, RING_PIP, RING_MCP),
    pinky: fingerExtended(PINKY_TIP, PINKY_PIP, PINKY_MCP),
  };
}

/**
 * Classify ASL fingerspelling from hand landmark geometry.
 * Returns the letter with confidence, or null if unrecognized.
 *
 * This is a heuristic classifier based on finger extension patterns.
 * Production would use a trained CNN/LSTM on landmark sequences.
 */
function classifyASLLetter(points: HandLandmark[]): { sign: string; confidence: number } | null {
  if (points.length < 21) return null;

  const f = getFingerStates(points);
  const extCount = [f.thumb, f.index, f.middle, f.ring, f.pinky]
    .filter(s => s.isExtended).length;

  // Common ASL static signs (subset — most recognizable)

  // A: Fist with thumb alongside (all fingers curled, thumb extended slightly)
  if (!f.index.isExtended && !f.middle.isExtended && !f.ring.isExtended && !f.pinky.isExtended && f.thumb.isExtended) {
    return { sign: 'A', confidence: 0.85 };
  }

  // B: Fingers extended, thumb tucked across palm
  if (f.index.isExtended && f.middle.isExtended && f.ring.isExtended && f.pinky.isExtended && !f.thumb.isExtended) {
    return { sign: 'B', confidence: 0.88 };
  }

  // C: Curved hand (all fingers partially extended, forming C shape)
  if (extCount >= 3 && f.index.curl > 0.3 && f.index.curl < 0.7) {
    const thumbToIndex = distance(points[THUMB_TIP], points[INDEX_TIP]);
    const palmWidth = distance(points[INDEX_MCP], points[PINKY_MCP]);
    if (thumbToIndex > palmWidth * 0.5 && thumbToIndex < palmWidth * 1.5) {
      return { sign: 'C', confidence: 0.75 };
    }
  }

  // D: Index extended, others touching thumb
  if (f.index.isExtended && !f.middle.isExtended && !f.ring.isExtended && !f.pinky.isExtended) {
    const middleToThumb = distance(points[MIDDLE_TIP], points[THUMB_TIP]);
    const palmWidth = distance(points[INDEX_MCP], points[PINKY_MCP]);
    if (middleToThumb < palmWidth * 0.4) {
      return { sign: 'D', confidence: 0.82 };
    }
  }

  // E: All fingers curled, fingertips near thumb
  if (!f.index.isExtended && !f.middle.isExtended && !f.ring.isExtended && !f.pinky.isExtended && !f.thumb.isExtended) {
    return { sign: 'E', confidence: 0.7 };
  }

  // F: Index and thumb touching, other three extended
  if (f.middle.isExtended && f.ring.isExtended && f.pinky.isExtended) {
    const thumbToIndex = distance(points[THUMB_TIP], points[INDEX_TIP]);
    const palmWidth = distance(points[INDEX_MCP], points[PINKY_MCP]);
    if (thumbToIndex < palmWidth * 0.25) {
      return { sign: 'F', confidence: 0.82 };
    }
  }

  // I: Pinky extended only
  if (!f.index.isExtended && !f.middle.isExtended && !f.ring.isExtended && f.pinky.isExtended) {
    return { sign: 'I', confidence: 0.88 };
  }

  // K: Index + middle extended, spread apart
  if (f.index.isExtended && f.middle.isExtended && !f.ring.isExtended && !f.pinky.isExtended) {
    const spread = distance(points[INDEX_TIP], points[MIDDLE_TIP]);
    const palmWidth = distance(points[INDEX_MCP], points[PINKY_MCP]);
    if (spread > palmWidth * 0.3) {
      return { sign: 'K', confidence: 0.78 };
    }
  }

  // L: Index + thumb extended at right angle
  if (f.thumb.isExtended && f.index.isExtended && !f.middle.isExtended && !f.ring.isExtended && !f.pinky.isExtended) {
    return { sign: 'L', confidence: 0.88 };
  }

  // O: All fingertips touching thumb (circle shape)
  if (extCount <= 1) {
    const indexToThumb = distance(points[INDEX_TIP], points[THUMB_TIP]);
    const middleToThumb = distance(points[MIDDLE_TIP], points[THUMB_TIP]);
    const palmWidth = distance(points[INDEX_MCP], points[PINKY_MCP]);
    if (indexToThumb < palmWidth * 0.3 && middleToThumb < palmWidth * 0.3) {
      return { sign: 'O', confidence: 0.75 };
    }
  }

  // R: Index + middle crossed
  if (f.index.isExtended && f.middle.isExtended && !f.ring.isExtended && !f.pinky.isExtended) {
    const spread = distance(points[INDEX_TIP], points[MIDDLE_TIP]);
    const palmWidth = distance(points[INDEX_MCP], points[PINKY_MCP]);
    if (spread < palmWidth * 0.15) {
      return { sign: 'R', confidence: 0.75 };
    }
  }

  // U: Index + middle extended, together
  if (f.index.isExtended && f.middle.isExtended && !f.ring.isExtended && !f.pinky.isExtended) {
    return { sign: 'U', confidence: 0.72 };
  }

  // V: Index + middle extended, spread (peace sign)
  if (f.index.isExtended && f.middle.isExtended && !f.ring.isExtended && !f.pinky.isExtended) {
    const spread = distance(points[INDEX_TIP], points[MIDDLE_TIP]);
    const palmWidth = distance(points[INDEX_MCP], points[PINKY_MCP]);
    if (spread > palmWidth * 0.4) {
      return { sign: 'V', confidence: 0.85 };
    }
  }

  // W: Index + middle + ring extended, spread
  if (f.index.isExtended && f.middle.isExtended && f.ring.isExtended && !f.pinky.isExtended) {
    return { sign: 'W', confidence: 0.82 };
  }

  // Y: Thumb + pinky extended (hang loose)
  if (f.thumb.isExtended && !f.index.isExtended && !f.middle.isExtended && !f.ring.isExtended && f.pinky.isExtended) {
    return { sign: 'Y', confidence: 0.9 };
  }

  // 5 / Open hand: all fingers extended
  if (extCount === 5) {
    return { sign: '5', confidence: 0.85 };
  }

  // 1 / Index point: only index extended
  if (f.index.isExtended && !f.middle.isExtended && !f.ring.isExtended && !f.pinky.isExtended && !f.thumb.isExtended) {
    return { sign: '1', confidence: 0.85 };
  }

  return null;
}

// ── Common Word Patterns (static gestures) ──────────────────────────────────

const COMMON_SIGNS: Record<string, (points: HandLandmark[]) => number> = {
  'HELLO': (points) => {
    // Open hand near face, all fingers extended
    const f = getFingerStates(points);
    const allExtended = f.index.isExtended && f.middle.isExtended && f.ring.isExtended && f.pinky.isExtended && f.thumb.isExtended;
    return allExtended ? 0.6 : 0; // Lower confidence — needs temporal context
  },
  'YES': (points) => {
    // Fist shape (S hand) — nod detection needs temporal, this is just the handshape
    const f = getFingerStates(points);
    const fist = !f.index.isExtended && !f.middle.isExtended && !f.ring.isExtended && !f.pinky.isExtended;
    return fist ? 0.5 : 0;
  },
  'NO': (points) => {
    // Index + middle + thumb pinch together repeatedly
    const thumbToIndex = distance(points[THUMB_TIP], points[INDEX_TIP]);
    const thumbToMiddle = distance(points[THUMB_TIP], points[MIDDLE_TIP]);
    const palmWidth = distance(points[INDEX_MCP], points[PINKY_MCP]);
    return (thumbToIndex < palmWidth * 0.2 && thumbToMiddle < palmWidth * 0.2) ? 0.5 : 0;
  },
  'THANK YOU': (points) => {
    // Flat hand near chin, moving outward — handshape check only
    const f = getFingerStates(points);
    const flatHand = f.index.isExtended && f.middle.isExtended && f.ring.isExtended && f.pinky.isExtended;
    return flatHand ? 0.4 : 0; // Very low — needs motion context
  },
};

// ── Sign Language Service ───────────────────────────────────────────────────

let _nextSignSegId = 1;

export class SignLanguageService {
  private _active = false;
  private _signLanguage: SignLanguageType = 'asl';
  private _callbacks: RecognitionCallback[] = [];

  // Recognition state
  private _lastRecognition: string | null = null;
  private _sameSignCount = 0;
  private _confirmThreshold = 3; // Frames needed to confirm a letter
  private _letterBuffer: string[] = [];
  private _lastLetterTime = 0;
  private _wordTimeout = 1500; // ms pause to insert space
  private _sessionStartMs = 0;

  // Debounce
  private _lastEmitTime = 0;
  private _minEmitInterval = 500; // ms between emitted letters

  start(signLanguage: SignLanguageType = 'asl', sessionStartMs: number = Date.now()): void {
    this._active = true;
    this._signLanguage = signLanguage;
    this._sessionStartMs = sessionStartMs;
    this._letterBuffer = [];
    this._lastRecognition = null;
    this._sameSignCount = 0;
    console.log(`[SignLanguage] Started ${signLanguage.toUpperCase()} recognition`);
  }

  stop(): void {
    // Flush remaining letters as final segment
    if (this._letterBuffer.length > 0) {
      this._emitWord();
    }
    this._active = false;
    this._callbacks = [];
    console.log('[SignLanguage] Stopped');
  }

  onRecognition(cb: RecognitionCallback): () => void {
    this._callbacks.push(cb);
    return () => { this._callbacks = this._callbacks.filter(c => c !== cb); };
  }

  /**
   * Process hand landmarks from a single frame.
   * Called from Vision Camera frame processor via worklet bridge.
   *
   * @param landmarks Array of HandLandmarks (one per detected hand)
   */
  processHandLandmarks(landmarks: HandLandmarks[]): void {
    if (!this._active || landmarks.length === 0) return;

    // Use the dominant hand (right-handed default for ASL)
    const primaryHand = landmarks.find(h => h.handedness === 'right')
      || landmarks[0];

    if (primaryHand.points.length < 21) return;

    // Try letter classification first
    const letterResult = classifyASLLetter(primaryHand.points);

    // Also check common word signs
    let bestWord: { sign: string; confidence: number } | null = null;
    for (const [word, detector] of Object.entries(COMMON_SIGNS)) {
      const confidence = detector(primaryHand.points);
      if (confidence > 0.6 && (!bestWord || confidence > bestWord.confidence)) {
        bestWord = { sign: word, confidence };
      }
    }

    // Prefer high-confidence word over letter
    const result = (bestWord && bestWord.confidence > 0.7) ? bestWord : letterResult;

    if (!result || result.confidence < 0.7) {
      // No confident recognition — check if we should flush buffer
      const now = Date.now();
      if (this._letterBuffer.length > 0 && now - this._lastLetterTime > this._wordTimeout) {
        this._emitWord();
      }
      this._lastRecognition = null;
      this._sameSignCount = 0;
      return;
    }

    // Debounce: require same sign for N consecutive frames
    if (result.sign === this._lastRecognition) {
      this._sameSignCount++;
    } else {
      this._lastRecognition = result.sign;
      this._sameSignCount = 1;
    }

    if (this._sameSignCount >= this._confirmThreshold) {
      const now = Date.now();

      // Don't emit the same letter too quickly
      if (now - this._lastEmitTime < this._minEmitInterval) return;

      // Check for word timeout (insert space)
      if (this._letterBuffer.length > 0 && now - this._lastLetterTime > this._wordTimeout) {
        this._emitWord();
      }

      // Is this a word sign or a letter?
      if (result.sign.length > 1) {
        // Word sign — emit immediately
        if (this._letterBuffer.length > 0) this._emitWord();
        this._emitDirectWord(result.sign, result.confidence);
      } else {
        // Letter — add to buffer
        this._letterBuffer.push(result.sign);
        this._lastLetterTime = now;
      }

      this._lastEmitTime = now;
      this._sameSignCount = 0; // Reset to prevent rapid repeat
    }
  }

  private _emitWord(): void {
    if (this._letterBuffer.length === 0) return;

    const word = this._letterBuffer.join('');
    this._letterBuffer = [];

    const now = Date.now();
    const segment: TranscriptSegment = {
      id: `sign_${_nextSignSegId++}`,
      text: word,
      source: 'sign-language',
      startMs: Math.max(0, now - 2000 - this._sessionStartMs),
      endMs: Math.max(0, now - this._sessionStartMs),
      speakerId: null,
      isFinal: true,
      confidence: 0.8,
    };

    for (const cb of this._callbacks) cb(segment);
  }

  private _emitDirectWord(word: string, confidence: number): void {
    const now = Date.now();
    const segment: TranscriptSegment = {
      id: `sign_${_nextSignSegId++}`,
      text: word,
      source: 'sign-language',
      startMs: Math.max(0, now - 1000 - this._sessionStartMs),
      endMs: Math.max(0, now - this._sessionStartMs),
      speakerId: null,
      isFinal: true,
      confidence,
    };

    for (const cb of this._callbacks) cb(segment);
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _instance: SignLanguageService | null = null;

export function getSignLanguageService(): SignLanguageService {
  if (!_instance) _instance = new SignLanguageService();
  return _instance;
}
