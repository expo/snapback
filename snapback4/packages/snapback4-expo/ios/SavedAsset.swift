import Foundation

// A task-owned save copy; no network fetch, token, or original cache file escapes to the sheet.
final class SavedAsset {
  let directory: URL
  let url: URL
  init(hex: String, name: String) throws {
    guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\\"),
      !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
      hex.utf8.count <= 128 << 20, hex.utf8.count % 2 == 0 else {
      throw NSError(domain: "Snapback4", code: 1, userInfo: [NSLocalizedDescriptionKey: "invalid save bytes or filename"])
    }
    let chars = Array(hex.utf8)
    var data = Data(capacity: chars.count / 2)
    for i in stride(from: 0, to: chars.count, by: 2) {
      guard let byte = UInt8(String(bytes: chars[i...i+1], encoding: .utf8) ?? "", radix: 16) else {
        throw NSError(domain: "Snapback4", code: 1, userInfo: [NSLocalizedDescriptionKey: "invalid save bytes"])
      }
      data.append(byte)
    }
    directory = FileManager.default.temporaryDirectory.appendingPathComponent("snapback4-save-" + UUID().uuidString, isDirectory: true)
    url = directory.appendingPathComponent(name)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    do {
      try data.write(to: url, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    } catch { try? FileManager.default.removeItem(at: directory); throw error }
  }
  func remove() { try? FileManager.default.removeItem(at: directory) }
  deinit { remove() }
}
