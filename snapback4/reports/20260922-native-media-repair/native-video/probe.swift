import Foundation
import AVFoundation
import CoreMedia
@main struct Probe {
  static func main() async {
    for arg in CommandLine.arguments.dropFirst() {
      let url = arg.hasPrefix("file:") ? URL(string: arg)! : URL(fileURLWithPath: arg)
      var facts: [String: Any] = ["input": arg, "url": url.absoluteString, "pathExists": FileManager.default.fileExists(atPath: url.path)]
      let asset = AVURLAsset(url: url)
      do {
        facts["playable"] = try await asset.load(.isPlayable)
        facts["readable"] = try await asset.load(.isReadable)
        facts["durationSeconds"] = try await asset.load(.duration).seconds
        let tracks = try await asset.loadTracks(withMediaType: .video)
        var descriptions: [[String: Any]] = []
        for track in tracks {
          let formats = try await track.load(.formatDescriptions)
          descriptions.append(["formats": formats.map { String(describing: $0) }, "nominalFrameRate": try await track.load(.nominalFrameRate)])
        }
        facts["videoTracks"] = descriptions
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        let result = try await generator.image(at: CMTime(seconds: 0, preferredTimescale: 600))
        facts["decodedFrame"] = ["width":result.image.width,"height":result.image.height,"atSeconds":result.actualTime.seconds]
      } catch {
        let error = error as NSError
        facts["error"] = ["domain": error.domain, "code": error.code, "message": error.localizedDescription, "details": String(describing: error.userInfo)]
      }
      let data = try! JSONSerialization.data(withJSONObject: facts, options: [.sortedKeys])
      print(String(data: data, encoding: .utf8)!)
    }
  }
}
