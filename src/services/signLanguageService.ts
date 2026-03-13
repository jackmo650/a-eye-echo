// ============================================================================
// Sign Language Service — Apple Vision hand pose → ASL recognition
//
// Pipeline:
//   Camera Frame → Apple Vision VNDetectHumanHandPoseRequest (21 joints)
//     → Geometry-based finger state analysis
//       → ASL letter classification (finger extension patterns)
//         → Debounce + buffer → Caption segments
//
// Uses finger extension states (extended/curled) determined by comparing
// joint positions. Works with any coordinate system (Apple Vision, MediaPipe).
// ============================================================================

import type {
  HandLandmark,
  HandLandmarks,
  SignLanguageType,
  TranscriptSegment,
} from '../types';

type RecognitionCallback = (segment: TranscriptSegment) => void;

// ── Joint Indices (MediaPipe / Apple Vision mapped order) ──────────────────
// 0: wrist
// 1-4: thumb (CMC, MCP, IP, TIP)
// 5-8: index (MCP, PIP, DIP, TIP)
// 9-12: middle (MCP, PIP, DIP, TIP)
// 13-16: ring (MCP, PIP, DIP, TIP)
// 17-20: pinky (MCP, PIP, DIP, TIP)

const WRIST = 0;
const THUMB_CMC = 1, THUMB_MCP = 2, THUMB_IP = 3, THUMB_TIP = 4;
const INDEX_MCP = 5, INDEX_PIP = 6, INDEX_DIP = 7, INDEX_TIP = 8;
const MIDDLE_MCP = 9, MIDDLE_PIP = 10, MIDDLE_DIP = 11, MIDDLE_TIP = 12;
const RING_MCP = 13, RING_PIP = 14, RING_DIP = 15, RING_TIP = 16;
const PINKY_MCP = 17, PINKY_PIP = 18, PINKY_DIP = 19, PINKY_TIP = 20;

// ── Geometry Helpers ───────────────────────────────────────────────────────

function dist(a: HandLandmark, b: HandLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function dist3(a: HandLandmark, b: HandLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

interface FingerState {
  extended: boolean;    // Is the finger extended (straight)?
  curled: boolean;      // Is the finger fully curled (fist)?
  halfCurled: boolean;  // Partially curled (C/O shape)?
}

/**
 * Determine finger extension state by comparing distances.
 * A finger is extended if its TIP is farther from the wrist than its MCP.
 * A finger is curled if its TIP is close to or below its MCP.
 */
function getFingerState(p: HandLandmark[], mcp: number, pip: number, dip: number, tip: number, wrist: number): FingerState {
  const tipToWrist = dist(p[tip], p[wrist]);
  const mcpToWrist = dist(p[mcp], p[wrist]);
  const tipToMcp = dist(p[tip], p[mcp]);
  const pipToMcp = dist(p[pip], p[mcp]);
  const fingerLen = pipToMcp + dist(p[dip], p[pip]) + dist(p[tip], p[dip]);

  // Extended: tip is far from wrist relative to MCP
  const extended = tipToWrist > mcpToWrist * 1.1 && tipToMcp > fingerLen * 0.5;
  // Curled: tip is close to MCP (fist)
  const curled = tipToMcp < fingerLen * 0.35;
  // Half curled: between extended and curled
  const halfCurled = !extended && !curled;

  return { extended, curled, halfCurled };
}

function getThumbState(p: HandLandmark[]): FingerState {
  const tipToWrist = dist(p[THUMB_TIP], p[WRIST]);
  const mcpToWrist = dist(p[THUMB_MCP], p[WRIST]);
  const tipToIndex = dist(p[THUMB_TIP], p[INDEX_MCP]);
  const tipToPinky = dist(p[THUMB_TIP], p[PINKY_MCP]);
  const palmWidth = dist(p[INDEX_MCP], p[PINKY_MCP]);

  // Thumb extended: tip is far from palm center
  const extended = tipToWrist > mcpToWrist * 1.2 && tipToIndex > palmWidth * 0.6;
  // Thumb tucked: tip is close to index base
  const curled = tipToIndex < palmWidth * 0.4;
  const halfCurled = !extended && !curled;

  return { extended, curled, halfCurled };
}

// ── ASL Letter Classification ──────────────────────────────────────────────

interface ClassifyResult {
  sign: string;
  confidence: number;
}

function classifyASLGesture(points: HandLandmark[]): ClassifyResult | null {
  if (points.length < 21) return null;

  const p = points;
  const thumb = getThumbState(p);
  const index = getFingerState(p, INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP, WRIST);
  const middle = getFingerState(p, MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP, WRIST);
  const ring = getFingerState(p, RING_MCP, RING_PIP, RING_DIP, RING_TIP, WRIST);
  const pinky = getFingerState(p, PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP, WRIST);

  const palmWidth = dist(p[INDEX_MCP], p[PINKY_MCP]);

  // Count extended fingers (not counting thumb)
  const extCount = [index, middle, ring, pinky].filter(f => f.extended).length;
  const curlCount = [index, middle, ring, pinky].filter(f => f.curled).length;

  // Finger spread: distance between index and middle tips
  const indexMiddleSpread = dist(p[INDEX_TIP], p[MIDDLE_TIP]);
  const fingersSpread = indexMiddleSpread > palmWidth * 0.4;

  // Thumb-index distance
  const thumbIndexDist = dist(p[THUMB_TIP], p[INDEX_TIP]);
  const thumbIndexClose = thumbIndexDist < palmWidth * 0.3;

  // ── Pattern matching (most distinctive letters first) ──

  // L — index extended + thumb extended out, rest curled
  if (index.extended && !middle.extended && !ring.extended && !pinky.extended && thumb.extended) {
    return { sign: 'L', confidence: 0.85 };
  }

  // Y — pinky + thumb extended, rest curled
  if (!index.extended && !middle.extended && !ring.extended && pinky.extended && thumb.extended) {
    return { sign: 'Y', confidence: 0.85 };
  }

  // I — only pinky extended, thumb tucked
  if (!index.extended && !middle.extended && !ring.extended && pinky.extended && !thumb.extended) {
    return { sign: 'I', confidence: 0.8 };
  }

  // V — index + middle extended and spread, rest curled
  if (index.extended && middle.extended && !ring.extended && !pinky.extended && fingersSpread) {
    return { sign: 'V', confidence: 0.85 };
  }

  // U — index + middle extended and close together, rest curled
  if (index.extended && middle.extended && !ring.extended && !pinky.extended && !fingersSpread) {
    return { sign: 'U', confidence: 0.8 };
  }

  // R — index + middle extended and crossed (close tips), rest curled
  if (index.extended && middle.extended && !ring.extended && !pinky.extended) {
    const tipDist = dist(p[INDEX_TIP], p[MIDDLE_TIP]);
    if (tipDist < palmWidth * 0.15) {
      return { sign: 'R', confidence: 0.75 };
    }
  }

  // W — index + middle + ring extended, pinky curled
  if (index.extended && middle.extended && ring.extended && !pinky.extended) {
    return { sign: 'W', confidence: 0.85 };
  }

  // B — all 4 fingers extended, thumb tucked
  if (extCount === 4 && !thumb.extended) {
    return { sign: 'B', confidence: 0.8 };
  }

  // 5/spread hand — all 4 fingers extended + thumb extended
  if (extCount === 4 && thumb.extended) {
    return { sign: '5', confidence: 0.75 };
  }

  // D — index extended, rest curled, thumb touches middle
  if (index.extended && !middle.extended && !ring.extended && !pinky.extended && !thumb.extended) {
    return { sign: 'D', confidence: 0.8 };
  }

  // K — index + middle extended, spread, thumb between them
  if (index.extended && middle.extended && !ring.extended && !pinky.extended && thumb.halfCurled) {
    if (fingersSpread) {
      return { sign: 'K', confidence: 0.75 };
    }
  }

  // H — index + middle extended horizontally (pointing sideways)
  // Similar to U but oriented differently — hard to distinguish without orientation
  // Skip for now, covered by U

  // A — all fingers curled into fist, thumb alongside (not tucked under)
  if (curlCount >= 3 && thumb.halfCurled) {
    return { sign: 'A', confidence: 0.7 };
  }

  // S — all fingers curled, thumb over fingers
  if (curlCount >= 3 && thumb.curled) {
    return { sign: 'S', confidence: 0.7 };
  }

  // E — all fingers curled, tips touching thumb
  if (curlCount === 0 && extCount === 0) {
    // All half-curled — could be C, O, or E
    if (thumbIndexClose) {
      return { sign: 'O', confidence: 0.7 };
    }
    return { sign: 'E', confidence: 0.6 };
  }

  // C — all fingers half-curled in C shape
  if (index.halfCurled && middle.halfCurled && ring.halfCurled && pinky.halfCurled && thumb.halfCurled) {
    return { sign: 'C', confidence: 0.65 };
  }

  // O — all half-curled, thumb and index tips close (circle)
  if (thumbIndexClose && index.halfCurled) {
    return { sign: 'O', confidence: 0.7 };
  }

  // F — index + thumb touching (circle), other 3 extended
  if (thumbIndexClose && middle.extended && ring.extended && pinky.extended) {
    return { sign: 'F', confidence: 0.8 };
  }

  // G — index pointing sideways, thumb extended
  if (index.extended && !middle.extended && !ring.extended && !pinky.extended && thumb.halfCurled) {
    return { sign: 'G', confidence: 0.65 };
  }

  // X — index half-curled (hooked), rest curled
  if (index.halfCurled && middle.curled && ring.curled && pinky.curled) {
    return { sign: 'X', confidence: 0.65 };
  }

  return null;
}

// ── Sign Language Service ───────────────────────────────────────────────────

let _nextSignSegId = 1;

export class SignLanguageService {
  private _active = false;
  private _signLanguage: SignLanguageType = 'asl';
  private _callbacks: RecognitionCallback[] = [];

  // Recognition state
  private _lastRecognition: string | null = null;
  private _sameSignCount = 0;
  private _confirmThreshold = 4; // Frames needed to confirm a letter
  private _letterBuffer: string[] = [];
  private _lastLetterTime = 0;
  private _wordTimeout = 1500; // ms pause to insert space
  private _sessionStartMs = 0;

  // Debounce
  private _lastEmitTime = 0;
  private _minEmitInterval = 800; // ms between emitted letters

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

  processHandLandmarks(landmarks: HandLandmarks[]): void {
    if (!this._active || landmarks.length === 0) return;

    const primaryHand = landmarks.find(h => h.handedness === 'right')
      || landmarks[0];

    if (primaryHand.points.length < 21) return;

    const result = classifyASLGesture(primaryHand.points);

    if (result) {
      console.log(`[SignLanguage] ${result.sign} (${(result.confidence * 100).toFixed(0)}%)`);
    }

    if (!result || result.confidence < 0.6) {
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
      if (now - this._lastEmitTime < this._minEmitInterval) return;

      if (this._letterBuffer.length > 0 && now - this._lastLetterTime > this._wordTimeout) {
        this._emitWord();
      }

      this._letterBuffer.push(result.sign);
      this._lastLetterTime = now;
      this._lastEmitTime = now;
      this._sameSignCount = 0;
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
