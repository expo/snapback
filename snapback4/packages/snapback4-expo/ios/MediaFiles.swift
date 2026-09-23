import Foundation

// @ref LLP 3000.007#8 — ordinary media stays in its device store's private cache
// The module serializes access with its existing device lock.
final class MediaFiles {
  enum Failure: String, Error, LocalizedError {
    case invalidIdentity = "invalid media id or closed device"
    case invalidBytes = "invalid media bytes"
    var errorDescription: String? { rawValue }
  }

  private var directory: URL?
  init(directory: URL) { self.directory = directory }
  func close() { directory = nil }

  private func base(_ id: String) throws -> URL {
    guard let directory, !id.isEmpty,
      id.utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) })
    else { throw Failure.invalidIdentity }
    return directory.appendingPathComponent(id)
  }

  // Match the server's supported brands in the initial ftyp box. This is a
  // filename hint for already-admitted bytes, not another media admission rule.
  private func isMP4(_ bytes: Data) -> Bool {
    guard bytes.count >= 12, bytes[4..<8].elementsEqual("ftyp".utf8) else { return false }
    let size32 = bytes.prefix(4).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    let header = size32 == 1 ? 16 : 8
    guard bytes.count >= header else { return false }
    let size = size32 == 0 ? UInt64(bytes.count) : size32 == 1
      ? bytes[8..<16].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) } : size32
    guard size >= UInt64(header), size <= UInt64(bytes.count) else { return false }
    let brands = ["isom", "iso2", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "qt  "]
    for offset in stride(from: header, to: Int(size) - 3, by: 4) where offset != header + 4 {
      if let brand = String(data: bytes[offset..<offset + 4], encoding: .ascii), brands.contains(brand) { return true }
    }
    return false
  }

  private func resolve(_ id: String) throws -> URL {
    let file = try base(id), video = file.appendingPathExtension("mp4")
    let manager = FileManager.default
    if manager.fileExists(atPath: file.path) {
      // A bare file is either a legacy entry or the latest atomic write. It
      // wins if interruption left both variants; stale bytes cannot reappear.
      if isMP4(try Data(contentsOf: file, options: .mappedIfSafe)) {
        if manager.fileExists(atPath: video.path) {
          _ = try manager.replaceItemAt(video, withItemAt: file, options: .usingNewMetadataOnly)
        } else { try manager.moveItem(at: file, to: video) }
        return video
      }
      if manager.fileExists(atPath: video.path) { try manager.removeItem(at: video) }
      return file
    }
    return manager.fileExists(atPath: video.path) ? video : file
  }

  func read(_ id: String) throws -> String? {
    let file = try resolve(id)
    guard FileManager.default.fileExists(atPath: file.path) else { return nil }
    return try Data(contentsOf: file).map { String(format: "%02x", $0) }.joined()
  }

  func write(_ id: String, hex: String) throws {
    let file = try base(id), chars = Array(hex.utf8)
    guard chars.count % 2 == 0 else { throw Failure.invalidBytes }
    var bytes = Data(capacity: chars.count / 2)
    for i in stride(from: 0, to: chars.count, by: 2) {
      guard let byte = UInt8(String(bytes: chars[i...i + 1], encoding: .utf8) ?? "", radix: 16) else { throw Failure.invalidBytes }
      bytes.append(byte)
    }
    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    // One atomic commit point regardless of format. Resolution renames this
    // same file within the cache; it never creates a separate display copy.
    try bytes.write(to: file, options: .atomic)
    _ = try resolve(id)
  }

  func remove(_ id: String) throws {
    let file = try base(id)
    // Remove the possible shadow first. If it cannot be removed, leave the
    // authoritative bare file in place and report the error for retry.
    for variant in [file.appendingPathExtension("mp4"), file] {
      if FileManager.default.fileExists(atPath: variant.path) { try FileManager.default.removeItem(at: variant) }
    }
  }

  func uri(_ id: String) throws -> String { try resolve(id).absoluteString }
}
