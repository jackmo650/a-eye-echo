# A.EYE.ECHO

Portable live captioning app for deaf and hard-of-hearing users. Real-time speech-to-text on iOS and Android using on-device speech recognition.

## Features

- **Live transcription** — streaming speech-to-text via Apple SFSpeechRecognizer (iOS) and Google SpeechRecognizer (Android)
- **25+ languages** with automatic language detection
- **Real-time translation** via DeepL (optional API key) or LibreTranslate (free fallback)
- **Speaker diarization** — detects speaker changes from timing and energy patterns
- **Caption sharing** — host or join live caption sessions via 6-digit room codes
- **URL video ingest** — paste YouTube or video URLs for captioning
- **Transcript editor** — search, edit, and export to SRT, VTT, TXT, JSON, or Markdown
- **Accessibility presets** — Cinema, Conference, Stage, Classroom display modes
- **Vibration grammar** — haptic patterns for questions, exclamations, and speaker changes
- **5-second rewind buffer** — tap to review recent captions
- **Speech intensity indicator** — visual quiet/normal/loud feedback
- **Custom themes** — font size, color, position, background opacity

## Download

**Android APK:** [Latest release](https://github.com/jackmo650/a-eye-echo/releases/latest)

**iOS:** Build from source (see below) or TestFlight (coming soon)

## Getting Started

### Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- iOS: Xcode 15+ and an Apple Developer account
- Android: Android Studio (for emulator) or a physical device

### Install

```bash
git clone https://github.com/jackmo650/a-eye-echo.git
cd a-eye-echo
npm install
```

### Run in development

```bash
# Start Expo dev server
npm start

# iOS (requires Xcode)
npm run ios

# Android (requires Android Studio or connected device)
npm run android
```

### Build for distribution

The project uses [EAS Build](https://docs.expo.dev/build/introduction/) for cloud builds.

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to your Expo account
eas login

# Build Android APK
eas build --platform android --profile preview

# Build iOS (requires Apple Developer account)
eas build --platform ios --profile preview
```

## Configuration

### API Keys (optional)

Translation requires a DeepL API key. Without one, the app falls back to LibreTranslate (free, lower quality).

**For local development:**
```bash
cp src/config/secrets.default.ts src/config/secrets.ts
# Edit secrets.ts and add your DeepL API key
```

**For EAS builds:**
```bash
eas env:create --name DEEPL_API_KEY --value "your-key-here" --visibility secret --environment preview
eas env:create --name DEEPL_API_KEY --value "your-key-here" --visibility secret --environment production
```

Get a free DeepL API key at [deepl.com/pro-api](https://www.deepl.com/pro-api).

### EAS Project Setup

If you fork this repo, you'll need your own EAS project:

1. Create an account at [expo.dev](https://expo.dev)
2. Run `eas init` to create a new project (this updates `app.json` with your project ID)
3. For iOS builds, update `appleTeamId` in `app.json` and `eas.json` with your own Apple Developer Team ID

## Project Structure

```
app/                    # Expo Router screens (tabs)
  index.tsx             # Live captioning screen
  transcript.tsx        # Transcript viewer/editor
  sessions.tsx          # Past session history
  share.tsx             # Caption sharing (host/join)
  settings.tsx          # App settings
src/
  components/           # Reusable UI components
  services/             # Core services
    speechRecognitionEngine.ts  # Apple/Google speech recognition
    transcriptionService.ts     # Orchestrates transcription pipeline
    translationService.ts       # DeepL + LibreTranslate translation
    captionNetworkService.ts    # WebSocket caption sharing
    audioDiarization.ts         # Speaker change detection
    vibrationService.ts         # Haptic feedback patterns
    database.ts                 # SQLite session persistence
  stores/               # Zustand state management
  types/                # TypeScript types and defaults
  config/               # API keys and configuration
```

## Contributing

Contributions are welcome! This is an accessibility tool — improvements that help deaf and hard-of-hearing users are especially valued.

### Setup for contributors

1. Fork and clone the repo
2. `npm install`
3. Copy `src/config/secrets.default.ts` to `src/config/secrets.ts` (gitignored)
4. Optionally add your DeepL API key for translation features
5. Run `npm start` and test on a device (speech recognition requires a real device, not a simulator)

### Notes

- **EAS project IDs and Apple Team IDs** in `app.json` and `eas.json` are specific to the maintainer's accounts. You'll need your own for cloud builds, but local development works without them.
- **Speech recognition** requires a physical device — simulators/emulators don't have mic access.
- The `expo doctor` warning about `expo-av` being "unmaintained" is a false positive — the package works fine with SDK 52.

## Tech Stack

- [Expo](https://expo.dev/) SDK 52 with Expo Router
- [React Native](https://reactnative.dev/) 0.76
- [expo-speech-recognition](https://github.com/jamsch/expo-speech-recognition) — cross-platform speech-to-text
- [Zustand](https://github.com/pmndrs/zustand) — state management
- [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) — local session storage
- [react-native-vision-camera](https://github.com/mrousavy/react-native-vision-camera) — camera for speaker identification

## Related Projects

- [WallSpace.Studio](https://github.com/jackmo650/crt-wall-controller) — CRT wall controller + live performance tool that integrates with A.EYE.ECHO via OSC for caption text

## License

[MIT](LICENSE) — Copyright (c) 2026 Neem LLC

Powered by [WallSpace.Studio](https://wallspace.studio)
