import Foundation
import AVFoundation
import AppKit

// Read-only post-run frame extraction; never drives a simulator or changes a verdict.
let request = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
let asset = AVURLAsset(url: URL(fileURLWithPath: request["video"] as! String))
let done = DispatchSemaphore(value: 0)
Task {
  do {
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    var result: [[String: Any]] = []
    for frame in request["frames"] as! [[String: Any]] {
      let time = frame["seconds"] as! Double
      let value = try await generator.image(at: CMTime(seconds: time, preferredTimescale: 600))
      let bitmap = NSBitmapImageRep(cgImage: value.image)
      try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: frame["output"] as! String))
      result.append(["requestedSeconds": time, "actualSeconds": value.actualTime.seconds, "output": frame["output"]!])
    }
    print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
  } catch { fputs("video-review-extraction-failed\n", stderr); exit(2) }
  done.signal()
}
done.wait()
