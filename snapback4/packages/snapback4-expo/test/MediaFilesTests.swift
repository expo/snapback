import Foundation
import AVFoundation
import CoreVideo

struct TestFailure: Error { let message: String }
func expect(_ value: Bool, _ message: String) throws {
  if !value { throw TestFailure(message: message) }
}
func expectFailure(_ failure: MediaFiles.Failure, _ body: () throws -> Void) throws {
  do { try body() }
  catch { try expect(error as? MediaFiles.Failure == failure, "unexpected refusal: \(error)"); return }
  throw TestFailure(message: "expected \(failure)")
}
func hex(_ bytes: Data) -> String { bytes.map { String(format: "%02x", $0) }.joined() }

func makeVideo(_ url: URL) async throws -> Data {
  let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
  let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 64, AVVideoHeightKey: 48,
  ])
  let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
    kCVPixelBufferWidthKey as String: 64, kCVPixelBufferHeightKey as String: 48,
  ])
  try expect(writer.canAdd(input), "cannot add H.264 input")
  writer.add(input)
  try expect(writer.startWriting(), "cannot start H.264 writer: \(String(describing: writer.error))")
  writer.startSession(atSourceTime: .zero)
  var buffer: CVPixelBuffer?
  try expect(CVPixelBufferCreate(kCFAllocatorDefault, 64, 48, kCVPixelFormatType_32ARGB, nil, &buffer) == kCVReturnSuccess, "pixel buffer creation failed")
  guard let buffer else { throw TestFailure(message: "no pixel buffer") }
  CVPixelBufferLockBaseAddress(buffer, [])
  CVPixelBufferGetBaseAddress(buffer)!.initializeMemory(as: UInt8.self, repeating: 128, count: CVPixelBufferGetDataSize(buffer))
  CVPixelBufferUnlockBaseAddress(buffer, [])
  let deadline = Date().addingTimeInterval(5)
  while !input.isReadyForMoreMediaData && Date() < deadline { try await Task.sleep(nanoseconds: 10_000_000) }
  try expect(input.isReadyForMoreMediaData, "video writer never became ready")
  try expect(adaptor.append(buffer, withPresentationTime: .zero), "video frame append failed")
  writer.endSession(atSourceTime: CMTime(value: 1, timescale: 30))
  input.markAsFinished()
  await writer.finishWriting()
  try expect(writer.status == .completed, "video writer failed: \(String(describing: writer.error))")
  return try Data(contentsOf: url)
}

func decodeVideo(_ url: URL) async throws {
  let asset = AVURLAsset(url: url)
  let tracks = try await asset.loadTracks(withMediaType: .video)
  guard let track = tracks.first else { throw TestFailure(message: "cached URI has no video track") }
  let reader = try AVAssetReader(asset: asset)
  let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
  try expect(reader.canAdd(output), "cannot add cached video reader")
  reader.add(output)
  try expect(reader.startReading(), "cached video reader failed: \(String(describing: reader.error))")
  guard let sample = output.copyNextSampleBuffer(), let image = CMSampleBufferGetImageBuffer(sample) else {
    throw TestFailure(message: "cached URI did not decode a frame: \(String(describing: reader.error))")
  }
  try expect(CVPixelBufferGetWidth(image) == 64 && CVPixelBufferGetHeight(image) == 48, "decoded dimensions differ")
  reader.cancelReading()
}

@main enum MediaFilesTests {
  static func main() async throws {
    let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let directory = root.appendingPathComponent("backend%3Aalice store.sqlite.media", isDirectory: true)
    let files = MediaFiles(directory: directory), manager = FileManager.default
    let video = try await makeVideo(root.appendingPathComponent("fixture.mp4"))
    let image = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")!
    func bare(_ id: String) -> URL { directory.appendingPathComponent(id) }
    func suffixed(_ id: String) -> URL { bare(id).appendingPathExtension("mp4") }
    func exists(_ url: URL) -> Bool { manager.fileExists(atPath: url.path) }
    func assetURL(_ id: String) throws -> URL {
      guard let url = URL(string: try files.uri(id)) else { throw TestFailure(message: "invalid file URI") }
      return url
    }

    try files.write("Image1", hex: hex(image))
    try expect(try files.read("Image1") == hex(image), "image bytes changed")
    try expect(try assetURL("Image1") == bare("Image1"), "image filename changed")
    try expect(!exists(suffixed("Image1")), "image gained a video variant")
    try files.write("Video1", hex: hex(video))
    try expect(try files.read("Video1") == hex(video), "video bytes changed")
    let uri = try files.uri("Video1"), url = try assetURL("Video1")
    try expect(url == suffixed("Video1") && !exists(bare("Video1")), "new MP4 did not get one canonical file")
    try expect(uri.contains("%253A") && uri.contains("%20"), "URI did not preserve escaped store names")
    try await decodeVideo(url)
    print("PASS new MP4 URI decodes H.264 64x48; image bytes/name and escaped paths preserved")

    try video.write(to: bare("LegacyUri"), options: .atomic)
    let legacyURI = try assetURL("LegacyUri")
    try expect(legacyURI == suffixed("LegacyUri") && !exists(bare("LegacyUri")), "URI access did not migrate legacy MP4")
    try await decodeVideo(legacyURI)
    try video.write(to: bare("LegacyRead"), options: .atomic)
    try expect(try files.read("LegacyRead") == hex(video), "legacy read bytes changed")
    try expect(exists(suffixed("LegacyRead")) && !exists(bare("LegacyRead")), "read did not migrate legacy MP4")
    let reopened = MediaFiles(directory: directory)
    try expect(try reopened.read("LegacyRead") == hex(video), "reopen lost migrated bytes")
    try expect(try reopened.uri("LegacyRead") == suffixed("LegacyRead").absoluteString, "reopen lost migrated URI")
    print("PASS legacy MP4 migration through URI/read and fresh helper reopen")

    let replacement = video + Data([0, 0, 0, 8, 102, 114, 101, 101]) // an empty free box
    try video.write(to: suffixed("Interrupted"), options: .atomic)
    try replacement.write(to: bare("Interrupted"), options: .atomic)
    try expect(try files.read("Interrupted") == hex(replacement), "stale MP4 won over the latest atomic write")
    try expect(!exists(bare("Interrupted")), "MP4 resolution left a shadow variant")
    try await decodeVideo(try assetURL("Interrupted"))
    try image.write(to: bare("Interrupted"), options: .atomic)
    try expect(try assetURL("Interrupted") == bare("Interrupted"), "new image did not replace stale MP4")
    try expect(!exists(suffixed("Interrupted")), "image resolution left stale MP4 bytes")
    try expect(try files.read("Interrupted") == hex(image), "image replacement bytes changed")
    try files.write("Interrupted", hex: hex(video))
    try files.write("Interrupted", hex: hex(image))
    try expect(try files.read("Interrupted") == hex(image), "format-changing overwrite failed")
    try expect(!exists(suffixed("Interrupted")), "overwrite left a stale MP4")
    print("PASS both-variant interrupted writes resolve to latest bytes; format changes leave no shadow")

    try video.write(to: suffixed("Purge"), options: .atomic)
    try replacement.write(to: bare("Purge"), options: .atomic)
    try files.remove("Purge")
    try files.remove("Purge")
    try expect(!exists(bare("Purge")) && !exists(suffixed("Purge")), "purge left an owned variant")
    try expect(try MediaFiles(directory: directory).read("Purge") == nil, "purged bytes resurrected on reopen")
    try files.remove("LegacyUri")
    try expect(!exists(suffixed("LegacyUri")), "canonical video purge failed")
    try files.remove("Image1")
    try expect(!exists(bare("Image1")), "image purge failed")
    // Exercise real filesystem failures, not an injected alternate helper.
    // Only these test-owned files are immutable, and every exit resets them.
    try files.write("WriteFailure", hex: hex(image))
    do {
      let protected = bare("WriteFailure")
      try manager.setAttributes([.immutable: true], ofItemAtPath: protected.path)
      defer { try? manager.setAttributes([.immutable: false], ofItemAtPath: protected.path) }
      var refused = false
      do { try files.write("WriteFailure", hex: hex(video)) } catch { refused = true }
      try expect(refused, "immutable target did not refuse overwrite")
      try expect(try Data(contentsOf: protected) == image, "failed atomic overwrite damaged old bytes")
      try expect(!exists(suffixed("WriteFailure")), "failed write created a shadow")
      try manager.setAttributes([.immutable: false], ofItemAtPath: protected.path)
    }
    try files.write("WriteFailure", hex: hex(video))
    try expect(try files.read("WriteFailure") == hex(video), "atomic write retry failed")
    try video.write(to: suffixed("PurgeFailure"), options: .atomic)
    try image.write(to: bare("PurgeFailure"), options: .atomic)
    do {
      let shadow = suffixed("PurgeFailure")
      try manager.setAttributes([.immutable: true], ofItemAtPath: shadow.path)
      defer { try? manager.setAttributes([.immutable: false], ofItemAtPath: shadow.path) }
      var refused = false
      do { try files.remove("PurgeFailure") } catch { refused = true }
      try expect(refused, "immutable shadow did not refuse purge")
      try expect(try Data(contentsOf: bare("PurgeFailure")) == image, "failed purge exposed stale shadow as the sole entry")
      try manager.setAttributes([.immutable: false], ofItemAtPath: shadow.path)
    }
    try files.remove("PurgeFailure")
    try expect(try MediaFiles(directory: directory).read("PurgeFailure") == nil, "retry left resurrectable shadow bytes")
    print("PASS cleanup removes canonical and interrupted variants without resurrection")

    let unknown = Data([0, 0, 0, 16]) + Data("ftypheicisom".utf8) // isom is minor-version bytes, not a brand
    let truncated = Data([0, 0, 1, 0]) + Data("ftypisom".utf8)
    for (id, bytes) in [("Unknown", unknown), ("Truncated", truncated), ("WebP", Data("RIFF0000WEBP".utf8)), ("JPEG", Data([255, 216, 255, 224]))] {
      try files.write(id, hex: hex(bytes))
      try expect(try assetURL(id) == bare(id), "non-MP4 bytes were renamed")
      try expect(try files.read(id) == hex(bytes), "non-MP4 bytes changed")
    }
    print("PASS supported MP4 recognition leaves images, unknown brands and truncated headers unchanged")

    for invalid in ["", ".", "..", "../escape", "x/y", "x\\y", "x.mp4", "x%2Fy", "x?z", "ü", "a\n", "a\0"] {
      try expectFailure(.invalidIdentity) { _ = try files.read(invalid) }
      try expectFailure(.invalidIdentity) { try files.write(invalid, hex: hex(image)) }
      try expectFailure(.invalidIdentity) { try files.remove(invalid) }
      try expectFailure(.invalidIdentity) { _ = try files.uri(invalid) }
    }
    for invalid in ["0", "xx", "fffg"] {
      try expectFailure(.invalidBytes) { try files.write("Video1", hex: invalid) }
      try expect(try files.read("Video1") == hex(video), "failed write changed existing bytes")
    }
    let other = MediaFiles(directory: root.appendingPathComponent("backend%3Abob.sqlite.media", isDirectory: true))
    try other.write("Video1", hex: hex(image))
    try files.remove("Video1")
    try expect(try other.read("Video1") == hex(image), "purge crossed device-store boundary")
    print("PASS invalid IDs/hex refuse without replacing bytes; store scopes remain separate")

    let kept = try files.read("LegacyRead")
    files.close(); files.close()
    try expectFailure(.invalidIdentity) { _ = try files.read("LegacyRead") }
    try expectFailure(.invalidIdentity) { try files.write("LegacyRead", hex: hex(image)) }
    try expectFailure(.invalidIdentity) { try files.remove("LegacyRead") }
    try expectFailure(.invalidIdentity) { _ = try files.uri("LegacyRead") }
    try expect(try MediaFiles(directory: directory).read("LegacyRead") == kept, "ordinary close deleted cached bytes")
    print("PASS closed helper refuses every operation and preserves ordinary cache for reopen")
  }
}
