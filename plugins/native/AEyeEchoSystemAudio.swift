import Foundation
import Speech
import ReplayKit

@objc(AEyeEchoSystemAudio)
class AEyeEchoSystemAudio: RCTEventEmitter {

    private static let appGroupID = "group.com.wallspace.aeyeecho"
    private static let ringBufferFileName = "audio_ring.pcm"
    private static let headerSize = 32
    private static let audioBufferSize = 128 * 1024
    private static let totalSize = headerSize + audioBufferSize
    private static let sampleRate: Double = 16000
    private static let sessionRestartSec: TimeInterval = 55

    private var isCapturing = false
    private var ringFD: Int32 = -1
    private var ringData: UnsafeMutableRawPointer?
    private var lastReadTotal: UInt32 = 0
    private var lastReadOffset: Int = 0
    private var readTimer: Timer?

    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var sessionRestartTimer: Timer?
    private var currentLocale = "en-US"
    private var generation: Int = 0

    override static func requiresMainQueueSetup() -> Bool { return false }

    override func supportedEvents() -> [String] {
        return ["onSystemAudioResult", "onSystemAudioStatus", "onSystemAudioEnd"]
    }

    private var hasListeners = false
    override func startObserving() { hasListeners = true }
    override func stopObserving() { hasListeners = false }

    @objc func startCapture(_ locale: String) {
        guard !isCapturing else { return }
        currentLocale = locale
        isCapturing = true
        generation += 1
        lastReadTotal = 0
        lastReadOffset = 0

        SFSpeechRecognizer.requestAuthorization { [weak self] authStatus in
            guard let self = self else { return }
            DispatchQueue.main.async {
                switch authStatus {
                case .authorized:
                    self.openRingBuffer()
                    self.startSpeechRecognition()
                    self.startReadTimer()
                    self.registerDarwinNotifications()
                    self.emitStatus("capturing")
                default:
                    self.isCapturing = false
                    self.emitStatus("error")
                }
            }
        }
    }

    @objc func stopCapture() {
        guard isCapturing else { return }
        isCapturing = false
        generation += 1
        stopReadTimer()
        stopSpeechRecognition()
        unregisterDarwinNotifications()
        closeRingBuffer()
        emitStatus("idle")
    }

    @objc func setLanguage(_ locale: String) {
        currentLocale = locale
        if isCapturing {
            stopSpeechRecognition()
            startSpeechRecognition()
        }
    }

    @objc func isAvailable(_ resolve: @escaping RCTPromiseResolveBlock,
                            reject: @escaping RCTPromiseRejectBlock) {
        resolve(SFSpeechRecognizer.authorizationStatus() != .denied)
    }

    // MARK: - Ring Buffer Reader

    private func openRingBuffer() {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: AEyeEchoSystemAudio.appGroupID
        ) else { return }

        let ringURL = container.appendingPathComponent(AEyeEchoSystemAudio.ringBufferFileName)
        if !FileManager.default.fileExists(atPath: ringURL.path) {
            FileManager.default.createFile(atPath: ringURL.path, contents: nil)
        }

        ringFD = open(ringURL.path, O_RDONLY)
        guard ringFD >= 0 else { return }

        var st = stat()
        fstat(ringFD, &st)
        guard Int(st.st_size) >= AEyeEchoSystemAudio.totalSize else { close(ringFD); ringFD = -1; return }

        let ptr = mmap(nil, AEyeEchoSystemAudio.totalSize, PROT_READ, MAP_SHARED, ringFD, 0)
        guard ptr != MAP_FAILED else { close(ringFD); ringFD = -1; return }
        ringData = ptr
    }

    private func closeRingBuffer() {
        if let r = ringData { munmap(r, AEyeEchoSystemAudio.totalSize); ringData = nil }
        if ringFD >= 0 { close(ringFD); ringFD = -1 }
    }

    private func startReadTimer() {
        stopReadTimer()
        DispatchQueue.main.async { [weak self] in
            self?.readTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
                self?.readAvailableAudio()
            }
        }
    }

    private func stopReadTimer() { readTimer?.invalidate(); readTimer = nil }

    private func readAvailableAudio() {
        guard let ringData = self.ringData, isCapturing else { return }
        let header = ringData.assumingMemoryBound(to: UInt32.self)
        let totalWritten = header[2]
        let isActive = header[3]

        if isActive == 0 && totalWritten > 0 && lastReadTotal > 0 {
            DispatchQueue.main.async { [weak self] in
                self?.stopCapture()
                if self?.hasListeners == true { self?.sendEvent(withName: "onSystemAudioEnd", body: nil) }
            }
            return
        }

        guard totalWritten > lastReadTotal else { return }
        let newBytes = Int(totalWritten - lastReadTotal)
        guard newBytes > 0 else { return }

        let audioRegion = ringData + AEyeEchoSystemAudio.headerSize
        let bufSize = AEyeEchoSystemAudio.audioBufferSize

        var audioData = Data(count: newBytes)
        audioData.withUnsafeMutableBytes { (buf: UnsafeMutableRawBufferPointer) in
            guard let dst = buf.baseAddress else { return }
            var remaining = newBytes; var readOff = lastReadOffset; var dstOff = 0
            while remaining > 0 {
                let chunk = min(remaining, bufSize - readOff)
                memcpy(dst + dstOff, audioRegion + readOff, chunk)
                readOff = (readOff + chunk) % bufSize
                dstOff += chunk; remaining -= chunk
            }
            lastReadOffset = readOff
        }
        lastReadTotal = totalWritten
        feedAudioToRecognizer(audioData)
    }

    // MARK: - Speech Recognition

    private func startSpeechRecognition() {
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: currentLocale))
        guard let recognizer = speechRecognizer, recognizer.isAvailable else { emitStatus("error"); return }

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let request = recognitionRequest else { return }
        request.shouldReportPartialResults = true
        if #available(iOS 16, *) { request.addsPunctuation = true }
        if #available(iOS 13, *) { request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition }
        request.taskHint = .dictation

        let gen = generation
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self, self.generation == gen else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString
                let isFinal = result.isFinal
                let confidence = result.bestTranscription.segments.last?.confidence ?? 0.9
                self.emitResult(text: text, isFinal: isFinal, confidence: confidence)
            }
            if let error = error {
                let e = error as NSError
                if e.domain == "kAFAssistantErrorDomain" && e.code == 1110 { return }
                NSLog("[SystemAudio] Recognition error: \(error.localizedDescription)")
            }
        }

        sessionRestartTimer?.invalidate()
        sessionRestartTimer = Timer.scheduledTimer(withTimeInterval: AEyeEchoSystemAudio.sessionRestartSec, repeats: false) { [weak self] _ in
            self?.restartSpeechRecognition()
        }
    }

    private func stopSpeechRecognition() {
        sessionRestartTimer?.invalidate(); sessionRestartTimer = nil
        recognitionTask?.cancel(); recognitionTask = nil
        recognitionRequest?.endAudio(); recognitionRequest = nil
        speechRecognizer = nil
    }

    private func restartSpeechRecognition() {
        guard isCapturing else { return }
        NSLog("[SystemAudio] Auto-restarting recognition (55s)")
        recognitionRequest?.endAudio()
        recognitionTask?.finish()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self = self, self.isCapturing else { return }
            self.recognitionTask = nil; self.recognitionRequest = nil
            self.startSpeechRecognition()
        }
    }

    private func feedAudioToRecognizer(_ data: Data) {
        guard let request = recognitionRequest else { return }
        let sampleCount = data.count / 2
        guard sampleCount > 0,
              let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: AEyeEchoSystemAudio.sampleRate, channels: 1, interleaved: true),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(sampleCount))
        else { return }
        buffer.frameLength = AVAudioFrameCount(sampleCount)
        data.withUnsafeBytes { src in
            guard let base = src.baseAddress, let dst = buffer.int16ChannelData?[0] else { return }
            memcpy(dst, base, data.count)
        }
        request.append(buffer)
    }

    // MARK: - Darwin Notifications

    private func registerDarwinNotifications() {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        let callback: CFNotificationCallback = { _, observer, _, _, _ in
            guard let observer = observer else { return }
            let mod = Unmanaged<AEyeEchoSystemAudio>.fromOpaque(observer).takeUnretainedValue()
            DispatchQueue.main.async { mod.readAvailableAudio() }
        }
        let ptr = Unmanaged.passUnretained(self).toOpaque()
        CFNotificationCenterAddObserver(center, ptr, callback, "com.wallspace.aeyeecho.broadcast.audio" as CFString, nil, .deliverImmediately)
        CFNotificationCenterAddObserver(center, ptr, callback, "com.wallspace.aeyeecho.broadcast.stopped" as CFString, nil, .deliverImmediately)
    }

    private func unregisterDarwinNotifications() {
        CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque())
    }

    // MARK: - Events

    private func emitResult(text: String, isFinal: Bool, confidence: Float) {
        guard hasListeners else { return }
        sendEvent(withName: "onSystemAudioResult", body: ["text": text, "isFinal": isFinal, "confidence": confidence])
    }

    private func emitStatus(_ status: String) {
        guard hasListeners else { return }
        sendEvent(withName: "onSystemAudioStatus", body: ["status": status])
    }
}
