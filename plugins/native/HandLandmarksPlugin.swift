import Vision
import CoreMedia

@objc(HandLandmarksPlugin)
public class HandLandmarksPlugin: FrameProcessorPlugin {

    private let request = VNDetectHumanHandPoseRequest()

    public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]! = [:]) {
        super.init(proxy: proxy, options: options)
        request.maximumHandCount = 2
    }

    public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer) else { return [] }

        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return []
        }

        guard let observations = request.results, !observations.isEmpty else { return [] }

        var results: [[String: Any]] = []
        for obs in observations {
            var points: [[String: Any]] = []
            // Apple Vision provides 21 joint points matching the standard hand pose model
            let jointGroups: [[VNHumanHandPoseObservation.JointName]] = [
                [.wrist],
                [.thumbCMC, .thumbMP, .thumbIP, .thumbTip],
                [.indexMCP, .indexPIP, .indexDIP, .indexTip],
                [.middleMCP, .middlePIP, .middleDIP, .middleTip],
                [.ringMCP, .ringPIP, .ringDIP, .ringTip],
                [.littleMCP, .littlePIP, .littleDIP, .littleTip],
            ]
            for group in jointGroups {
                for joint in group {
                    if let pt = try? obs.recognizedPoint(joint), pt.confidence > 0.1 {
                        points.append([
                            "x": Double(pt.location.x),
                            "y": Double(1.0 - pt.location.y), // flip Y to match screen coords
                            "z": 0.0,
                        ])
                    } else {
                        points.append(["x": 0.0, "y": 0.0, "z": 0.0])
                    }
                }
            }

            let chirality: String
            if #available(iOS 17.0, *) {
                chirality = obs.chirality == .left ? "left" : "right"
            } else {
                chirality = "right"
            }

            results.append([
                "points": points,
                "handedness": chirality,
            ])
        }

        return results
    }
}
