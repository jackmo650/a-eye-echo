# A.EYE.ECHO — Development Log

**Open Source:** [github.com/jackmo650/a-eye-echo](https://github.com/jackmo650/a-eye-echo)
**License:** Open source, public repository
**Bundle ID:** `com.wallspace.aeyeecho`
**Platform:** iOS (React Native + Expo)

---

## What We Built

A.EYE.ECHO is a mobile accessibility app that provides real-time captioning for deaf and hard-of-hearing users. It offers three input modes:

### 1. Microphone Mode
Live speech-to-text using Apple's SFSpeechRecognizer via `expo-speech-recognition`. Captions appear in real-time with adjustable themes (high-contrast, large text). Includes amplitude visualization bars and vibration feedback on speech detection.

### 2. URL / Video Mode
Paste any URL (YouTube, Dailymotion, Twitch, podcasts, news sites), play it in an embedded WebView, and transcribe the audio via the device microphone. Includes:
- Back/forward navigation buttons and URL bar
- Auto-detection of URL type (YouTube, audio, video, stream)
- YouTube embed via `youtube-nocookie.com` to bypass WebView detection
- Auto-resume JavaScript injection to keep video playing through audio session changes
- Mobile Safari user agent for compatibility

### 3. ASL Sign Language Recognition
Camera-based hand pose detection using Apple Vision's `VNDetectHumanHandPoseRequest` through a custom VisionCamera frame processor plugin. Detects 21 hand joints with chirality (left/right hand) support. Currently proof-of-concept — needs more model training for accurate sign classification.

### Additional Features
- **5 caption themes:** High Contrast, Warm, Cool, Minimal, Neon
- **Multi-language support:** 30+ languages via SFSpeechRecognizer BCP-47 locale mapping
- **Translation:** DeepL API integration for real-time translated captions
- **Session export:** TXT, SRT, VTT, JSON, Markdown formats
- **Onboarding:** 6-page walkthrough covering all features
- **Vibration feedback:** Haptic alerts on speech start and speaker changes

---

## Technical Architecture

### Speech Recognition Pipeline

```
expo-speech-recognition (SFSpeechRecognizer)
    ↓ interim/final results
TranscriptionService
    ↓ filterHallucinations() → TranscriptSegment
    ↓ optional: DeepL translation
useTranscriptStore (Zustand)
    ↓ segments[]
UI Components (Live captions, Transcript tab)
```

### Key Files
| File | Purpose |
|------|---------|
| `src/services/speechRecognitionEngine.ts` | Wraps expo-speech-recognition with auto-restart, generation counter |
| `src/services/transcriptionService.ts` | Orchestrates mic/URL/system-audio modes, hallucination filtering |
| `src/components/UrlIngestPanel.tsx` | WebView player with navigation, auto-resume JS |
| `plugins/withBroadcastExtension.js` | Expo config plugin for native file management |
| `plugins/native/HandLandmarksPlugin.swift` | VisionCamera frame processor for hand pose |
| `plugins/native/HandLandmarksPlugin.m` | ObjC registration via VISION_EXPORT_SWIFT_FRAME_PROCESSOR |
| `src/stores/useTranscriptStore.ts` | Zustand store for transcript segments |
| `src/services/translationService.ts` | DeepL API translation |

### Native Module Management

Since `npx expo prebuild --clean` wipes the `ios/` directory, all native files are managed via an Expo config plugin (`plugins/withBroadcastExtension.js`) that:

1. Copies Swift/ObjC files from `plugins/native/` to the Xcode project
2. Uses `addSourceFile()` to link them to the main app target's build phases
3. Writes a bridging header with VisionCamera and React Native imports
4. Creates the Broadcast Upload Extension target (for future system audio capture)

This ensures native code survives `expo prebuild --clean` cycles.

---

## Issues We Faced & How We Solved Them

### 1. whisper.rn Fatal Bug
**Problem:** whisper.rn (on-device Whisper model) had a fundamental bug ([GitHub issue #299](https://github.com/nickhopley/whisper.rn/issues/299)) — only processes ~1 second of audio before the JSI context hangs.

**Solution:** Replaced entire transcription pipeline with `expo-speech-recognition` wrapping Apple's SFSpeechRecognizer. More reliable, no model download needed, supports continuous streaming.

### 2. SFSpeechRecognizer 60-Second Session Limit
**Problem:** Apple limits speech recognition sessions to ~60 seconds. After that, the session ends silently.

**Solution:** Auto-restart timer at 55 seconds. A generation counter (`_generation`) discards stale results from old sessions. The `end` event handler auto-restarts if `_active` is still true.

### 3. WebView Video Pausing on Speech Recognition Restart
**Problem:** Every time `ExpoSpeechRecognitionModule.start()` is called, it reconfigures the iOS audio session. This pauses any media playing in the WebView (video stops).

**Root cause chain we debugged:**
1. First attempt: Only pass `iosCategory` on first session → failed because expo-speech-recognition uses its own default config (without `mixWithOthers`) when iosCategory is omitted
2. Second attempt: Pre-configure audio session via `expo-av` `Audio.setAudioModeAsync()` → helped but expo-speech-recognition overrides it on each `start()` call
3. Third attempt: Inject auto-resume JavaScript into WebView → worked but `injectedJavaScript` prop interfered with Dailymotion's page initialization

**Final solution (three-part):**
- Always pass `iosCategory: { category: 'playAndRecord', categoryOptions: ['mixWithOthers', 'allowBluetooth', 'defaultToSpeaker'], mode: 'default' }` on EVERY session start
- Use `onLoadEnd` + `injectJavaScript()` instead of `injectedJavaScript` prop for auto-resume script
- URL mode never forces session restarts on segment completion (no `_finalizeAndRestart` calls) — let sessions run until iOS naturally ends them

### 4. WebView Touch Interaction Blocked
**Problem:** The idle scroll gesture detector and caption overlay were covering the WebView, preventing users from tapping play/unmute on videos.

**Solution:** Hide the caption area and gesture detector when `sourceMode === 'url'`.

### 5. HandLandmarksPlugin Lost on Prebuild
**Problem:** `expo prebuild --clean` wipes the `ios/` directory, deleting manually added native Swift/ObjC files. ASL recognition showed `[NULL-plugin]`.

**Solution:** Created an Expo config plugin that copies native files from `plugins/native/` and uses `addSourceFile()` to properly link them in the Xcode project. The plugin runs automatically on every prebuild.

### 6. Broadcast Upload Extension Build Failure
**Problem:** The `.appex` bundle was missing its executable — the Sources build phase was empty.

**Solution:** Changed from `addBuildPhase([], ...)` + `addFile(...)` to `addBuildPhase(['AEYEECHOBroadcast/SampleHandler.swift'], ...)` which properly links the source file to the build phase.

### 7. AudioCapture Freezing WebView
**Problem:** In URL mode, `AudioCapture.initAudioCapture()` (via `react-native-live-audio-stream`) was reconfiguring the audio session, freezing the WebView.

**Solution:** Added `skipAudioCapture` parameter to `_startMicMode()`. URL mode skips AudioCapture entirely since amplitude bars aren't needed when watching video.

---

## Technology We Used

| Technology | Purpose | Status |
|------------|---------|--------|
| **expo-speech-recognition** | SFSpeechRecognizer wrapper for live transcription | Active, primary engine |
| **expo-av** | Audio session pre-configuration | Active |
| **react-native-webview** | URL video playback | Active |
| **VisionCamera** | Camera access for ASL | Active |
| **Apple Vision (VNDetectHumanHandPoseRequest)** | Hand pose detection (21 joints) | Active |
| **DeepL API** | Real-time translation | Active |
| **expo-sqlite** | Session persistence | Active |
| **Zustand** | State management (transcript store) | Active |
| **expo-haptics** | Vibration feedback | Active |
| **expo-clipboard** | URL paste functionality | Active |

## Technology We Abandoned

| Technology | Why Abandoned |
|------------|---------------|
| **whisper.rn** | Fatal bug: JSI context hangs after ~1s of audio (GitHub issue #299). Only processes first chunk then stops. |
| **System Audio Capture (Broadcast Upload Extension)** | Deferred — requires ReplayKit RPBroadcastSampleHandler + App Group shared memory + complex native bridge. Infrastructure built (config plugin, SampleHandler.swift, native module) but not wired up. Too complex for initial release. |
| **Audio downloading from URLs** | YouTube and most platforms block direct audio extraction. WebView + mic approach works with ANY URL. |
| **`injectedJavaScript` WebView prop** | Interferes with some sites' page initialization (Dailymotion). Replaced with `onLoadEnd` + `injectJavaScript()`. |
| **Silence-based session restart (URL mode)** | Forcing speech recognition restarts on silence caused video to pause. Removed for URL mode — sessions run until iOS naturally ends them. |
| **Android build** | Abandoned — expo-speech-recognition + VisionCamera + Apple Vision are iOS-only. Android would require a completely different native stack (Google Speech API, MediaPipe). Expo managed workflow doesn't support the native module complexity needed. See "Android Port" section below. |

---

## Work Still Left

### High Priority
- **Train more ASL models** — Current hand pose detection identifies 21 joints but needs ML classification model to map poses to actual ASL signs. Need training data for common signs, fingerspelling alphabet, and common phrases.
- **System audio capture** — Native Broadcast Upload Extension infrastructure exists but needs: App Group setup for shared audio data, RPBroadcastSampleHandler → speech recognition pipeline, UI for starting/stopping broadcast from within the app.

### Medium Priority
- **Test vibration feedback** — Haptic vibration on speech detection is implemented but untested on device
- **Speaker diarization** — Identify and label different speakers in conversation
- **Offline model fallback** — When SFSpeechRecognizer's on-device model isn't available, provide clear user feedback
- **Session auto-save** — Currently requires manual export; should auto-persist
- **Remove temporary `resetOnboarding()`** — In `app/_layout.tsx`, remove the debug call that resets onboarding on every launch

### Future / Nice-to-Have
- **NDI output** — Stream captions to production systems (port from WallSpace.Studio)
- **OSC integration** — Control caption appearance from external tools
- **Sentiment analysis** — Visual indicators for tone/emotion
- **Multi-device sync** — Share transcript across devices in real-time
- **watchOS companion** — Wrist-based caption display

---

## Porting to WallSpace.Studio

A.EYE.ECHO's transcription and captioning features can be ported to the WallSpace.Studio Electron desktop app:

### What Can Port Directly
1. **Caption rendering** — `captionRenderer.ts` uses Canvas2D, works identically in Electron
2. **Translation service** — DeepL API calls are platform-agnostic
3. **Transcript store** — Zustand store pattern works in both React Native and React web
4. **Export formats** — SRT/VTT/TXT generation is pure TypeScript
5. **Hallucination filtering** — `filterHallucinations()` is a pure function

### What Needs Platform Adaptation
1. **Speech recognition** — Replace expo-speech-recognition with Web Speech API (`webkitSpeechRecognition`) in Electron's renderer process. Same auto-restart pattern applies (Chrome also has session limits). Alternatively, use the existing `whisperBridge.ts` in WallSpace which runs whisper.cpp as a native subprocess (avoids the whisper.rn JSI bug since it's a standalone binary, not a React Native module).
2. **Audio capture** — Electron has `navigator.mediaDevices.getUserMedia()` for mic and `desktopCapturer` for system audio. System audio capture is much easier in Electron than iOS.
3. **WebView video** — Electron's `<webview>` tag or `BrowserView` can embed URLs. Audio routing is simpler since Electron controls the audio pipeline.
4. **ASL hand detection** — Could use MediaPipe Hands (runs in browser via WebAssembly/WebGL) instead of Apple Vision. Cross-platform and no native code needed.

### Integration Points in WallSpace
- **Scene overlay** — Caption text rendered as a compositor layer, overlaid on CRT/projector output
- **Scope integration** — Send transcript segments via WebSocket to Scope for AI processing
- **Output window** — Render captions directly in the output BrowserWindow via IPC
- **Zone 2 panel** — Add a "Captions" tab alongside Logs, Outputs, etc.

### Recommended Approach
1. Create `src/renderer/services/captionService.ts` in WallSpace mirroring A.EYE.ECHO's `transcriptionService.ts`
2. Use Web Speech API as default engine, whisper.cpp subprocess as fallback
3. Add `CaptionPanel.tsx` component for Zone 2
4. Add caption overlay layer to the compositor pipeline
5. Wire transcript segments to Scope WebSocket for cloud processing

---

## Android Port — Why We Abandoned It & How To Revisit

### Why Android Was Abandoned

The app relies heavily on iOS-specific APIs that have no direct Android equivalents:

1. **SFSpeechRecognizer** — Apple's on-device speech recognition has no Android equivalent with the same API surface. `expo-speech-recognition` wraps this on iOS. On Android, it falls back to Google's Speech-to-Text API which requires network access (no true on-device mode on most devices) and has different session behavior.

2. **Apple Vision VNDetectHumanHandPoseRequest** — The hand pose detection for ASL runs natively on iOS via the Vision framework. Android has no built-in equivalent. Would need MediaPipe Hands (Google's ML framework) which has different integration patterns.

3. **VisionCamera Frame Processor Plugins** — The HandLandmarksPlugin is written in Swift using Vision framework APIs. Would need a complete Java/Kotlin rewrite using MediaPipe.

4. **iOS Audio Session Management** — The `playAndRecord` + `mixWithOthers` audio session model is iOS-specific. Android's audio focus system works differently and has its own complexities with WebView media.

5. **Expo Config Plugin** — The `withBroadcastExtension.js` config plugin manipulates Xcode project files (pbxproj). Android would need a separate Gradle-based plugin.

### How To Build for Android (If Revisiting)

| iOS Component | Android Replacement |
|---------------|-------------------|
| `expo-speech-recognition` (SFSpeechRecognizer) | Google Speech-to-Text API via `@react-native-voice/voice` or Android's `SpeechRecognizer` class. Note: most Android devices require network for speech recognition. |
| Apple Vision hand pose | MediaPipe Hands via `@mediapipe/hands` or a custom TFLite model. Can run on-device via GPU delegate. |
| VisionCamera frame processor (Swift) | VisionCamera does support Android — would need a Java/Kotlin frame processor plugin wrapping MediaPipe. |
| `expo-av` audio session config | Android `AudioManager` focus request with `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` to mix with other audio. |
| Broadcast Upload Extension | Android has `MediaProjection` API for system audio capture — actually easier than iOS since it doesn't require an extension. |
| WebView `allowsInlineMediaPlayback` | Android WebView supports inline playback by default. Use `setMediaPlaybackRequiresUserGesture(false)`. |

### Recommended Android Approach

1. **Speech:** Use `@react-native-voice/voice` which wraps Android's `SpeechRecognizer`. Similar auto-restart pattern needed (Android also has session limits). For offline, consider Vosk (open-source, runs on-device) or whisper.cpp via JNI.

2. **ASL:** Use MediaPipe Hands Android SDK. Create a VisionCamera frame processor in Kotlin that runs MediaPipe inference per frame. Same 21-joint output as Apple Vision.

3. **System Audio:** Android's `MediaProjection` API can capture system audio directly — no app extension needed. This is actually easier on Android than iOS. Use `AudioRecord` with `MediaProjection` to get PCM samples, feed to speech recognizer.

4. **WebView:** Android WebView is more permissive. Less audio session conflict. The `KEEP_PLAYING_JS` auto-resume script may not be needed.

5. **Build:** Would need `npx expo prebuild` for Android, plus Gradle configuration for MediaPipe dependencies. No Xcode-specific config plugin needed.

**Estimated effort:** 2-3 weeks for a basic Android port (speech + captions), plus additional time for ASL (MediaPipe integration) and system audio (MediaProjection).

---

## Build & Deploy

```bash
# Install dependencies
npm install

# Generate native project (runs config plugin)
npx expo prebuild --clean

# Build for device
xcodebuild -workspace ios/AEYEECHO.xcworkspace -scheme AEYEECHO \
  -configuration Release \
  -destination 'platform=iOS,id=YOUR_DEVICE_UDID' \
  -allowProvisioningUpdates build

# Install on device
xcrun devicectl device install app --device YOUR_DEVICE_UUID \
  "path/to/AEYEECHO.app"
```

### Requirements
- Xcode 15+
- iOS 16+ device (SFSpeechRecognizer on-device recognition)
- Apple Developer account (for device deployment)
- DeepL API key (for translation, set in Settings)

---

*Built with accessibility at its core. No access = no participation.*
