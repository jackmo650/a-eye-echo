import ReplayKit
import Foundation

class SampleHandler: RPBroadcastSampleHandler {
    private static let appGroupID = "group.com.wallspace.aeyeecho"
    private static let ringBufferFileName = "audio_ring.pcm"
    private static let statusFileName = "broadcast_status"
    private static let headerSize = 32
    private static let audioBufferSize = 128 * 1024
    private static let totalSize = headerSize + audioBufferSize

    private var sharedContainer: URL?
    private var ringData: UnsafeMutableRawPointer?
    private var ringFD: Int32 = -1
    private let targetSampleRate: Double = 16000

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SampleHandler.appGroupID
        ) else {
            finishBroadcastWithError(NSError(domain: "SampleHandler", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "App Group not configured"]))
            return
        }
        sharedContainer = container
        let ringURL = container.appendingPathComponent(SampleHandler.ringBufferFileName)
        setupRingBuffer(at: ringURL)
        writeStatus("capturing")
        postNotification("com.wallspace.aeyeecho.broadcast.started")
    }

    override func broadcastPaused() {
        writeHeaderFlag(isActive: false)
    }

    override func broadcastResumed() {
        writeHeaderFlag(isActive: true)
    }

    override func broadcastFinished() {
        writeHeaderFlag(isActive: false)
        writeStatus("stopped")
        postNotification("com.wallspace.aeyeecho.broadcast.stopped")
        cleanup()
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .audioApp else { return }
        guard let ringData = self.ringData else { return }
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }

        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil,
                                                  totalLengthOut: &length, dataPointerOut: &dataPointer)
        guard status == noErr, let srcPtr = dataPointer, length > 0 else { return }

        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else { return }

        let srcSampleRate = asbd.pointee.mSampleRate
        let srcChannels = asbd.pointee.mChannelsPerFrame
        let srcBytesPerFrame = asbd.pointee.mBytesPerFrame

        let pcmData: Data
        if srcSampleRate == targetSampleRate && srcChannels == 1 && srcBytesPerFrame == 2 {
            pcmData = Data(bytes: srcPtr, count: length)
        } else {
            guard let converted = convertAudio(srcPtr: srcPtr, srcLength: length,
                                                srcSampleRate: srcSampleRate,
                                                srcChannels: srcChannels,
                                                srcBytesPerFrame: srcBytesPerFrame) else { return }
            pcmData = converted
        }

        writeToRing(pcmData, ringData: ringData)
        postNotification("com.wallspace.aeyeecho.broadcast.audio")
    }

    private func setupRingBuffer(at url: URL) {
        let fm = FileManager.default
        if !fm.fileExists(atPath: url.path) {
            fm.createFile(atPath: url.path, contents: nil)
        }
        ringFD = open(url.path, O_RDWR | O_CREAT, S_IRUSR | S_IWUSR | S_IRGRP | S_IWGRP)
        guard ringFD >= 0 else { return }
        ftruncate(ringFD, off_t(SampleHandler.totalSize))
        let ptr = mmap(nil, SampleHandler.totalSize, PROT_READ | PROT_WRITE, MAP_SHARED, ringFD, 0)
        guard ptr != MAP_FAILED else { close(ringFD); ringFD = -1; return }
        ringData = ptr
        let header = ptr!.assumingMemoryBound(to: UInt32.self)
        header[0] = 0; header[1] = UInt32(targetSampleRate); header[2] = 0; header[3] = 1
    }

    private func writeToRing(_ data: Data, ringData: UnsafeMutableRawPointer) {
        let header = ringData.assumingMemoryBound(to: UInt32.self)
        var writeOffset = Int(header[0])
        let audioRegion = ringData + SampleHandler.headerSize
        let bufSize = SampleHandler.audioBufferSize
        data.withUnsafeBytes { (srcBuf: UnsafeRawBufferPointer) in
            guard let src = srcBuf.baseAddress else { return }
            var remaining = data.count; var srcOffset = 0
            while remaining > 0 {
                let spaceToEnd = bufSize - writeOffset
                let chunk = min(remaining, spaceToEnd)
                memcpy(audioRegion + writeOffset, src + srcOffset, chunk)
                writeOffset = (writeOffset + chunk) % bufSize
                srcOffset += chunk; remaining -= chunk
            }
        }
        header[0] = UInt32(writeOffset)
        OSAtomicAdd32(Int32(data.count), UnsafeMutablePointer<Int32>(OpaquePointer(header + 2)))
    }

    private func writeHeaderFlag(isActive: Bool) {
        guard let ringData = self.ringData else { return }
        ringData.assumingMemoryBound(to: UInt32.self)[3] = isActive ? 1 : 0
    }

    private func convertAudio(srcPtr: UnsafeMutablePointer<Int8>, srcLength: Int,
                               srcSampleRate: Double, srcChannels: UInt32, srcBytesPerFrame: UInt32) -> Data? {
        let srcFrameCount = srcLength / Int(srcBytesPerFrame)
        let isFloat = srcBytesPerFrame / srcChannels == 4
        var monoFloat = [Float](repeating: 0, count: srcFrameCount)
        if isFloat {
            let fp = UnsafeRawPointer(srcPtr).assumingMemoryBound(to: Float.self)
            for i in 0..<srcFrameCount {
                var sum: Float = 0
                for ch in 0..<Int(srcChannels) { sum += fp[i * Int(srcChannels) + ch] }
                monoFloat[i] = sum / Float(srcChannels)
            }
        } else {
            let ip = UnsafeRawPointer(srcPtr).assumingMemoryBound(to: Int16.self)
            for i in 0..<srcFrameCount {
                var sum: Float = 0
                for ch in 0..<Int(srcChannels) { sum += Float(ip[i * Int(srcChannels) + ch]) / 32768.0 }
                monoFloat[i] = sum / Float(srcChannels)
            }
        }
        let ratio = targetSampleRate / srcSampleRate
        let outCount = Int(Double(srcFrameCount) * ratio)
        var resampled = [Float](repeating: 0, count: outCount)
        for i in 0..<outCount {
            let srcIdx = Double(i) / ratio; let idx = Int(srcIdx); let frac = Float(srcIdx - Double(idx))
            resampled[i] = monoFloat[min(idx, srcFrameCount-1)] + frac * (monoFloat[min(idx+1, srcFrameCount-1)] - monoFloat[min(idx, srcFrameCount-1)])
        }
        var int16Data = Data(count: outCount * 2)
        int16Data.withUnsafeMutableBytes { (buf: UnsafeMutableRawBufferPointer) in
            let ptr = buf.baseAddress!.assumingMemoryBound(to: Int16.self)
            for i in 0..<outCount { ptr[i] = Int16(max(-1.0, min(1.0, resampled[i])) * 32767) }
        }
        return int16Data
    }

    private func writeStatus(_ status: String) {
        guard let container = sharedContainer else { return }
        try? status.write(to: container.appendingPathComponent(SampleHandler.statusFileName), atomically: true, encoding: .utf8)
    }

    private func postNotification(_ name: String) {
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(name as CFString), nil, nil, true)
    }

    private func cleanup() {
        if let r = ringData { munmap(r, SampleHandler.totalSize); ringData = nil }
        if ringFD >= 0 { close(ringFD); ringFD = -1 }
    }
}
