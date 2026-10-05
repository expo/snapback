import Foundation

// @ref LLP 0201.000#3 — explicit launch activation and bounded, append-only evidence.
final class ObservationJournal {
  static let maxBytes = 4 * 1024 * 1024
  static let maxEvents = 10_000
  let output: URL
  private let overflow: URL
  private var bytes: Int
  private var events: Int
  private var stopped: Bool

  static func activate(arguments: [String], documents: URL) throws -> (String, ObservationJournal)? {
    guard let index = arguments.firstIndex(of: "--clique-run") else { return nil }
    guard index + 1 < arguments.count, let id = UUID(uuidString: arguments[index + 1]) else {
      throw NSError(domain: "CliqueNative", code: 1, userInfo: [NSLocalizedDescriptionKey: "invalid run nonce"])
    }
    let run = id.uuidString.lowercased()
    let dir = documents.appendingPathComponent("clique-native").appendingPathComponent(run)
    return (run, try ObservationJournal(directory: dir))
  }
  init(directory: URL) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    output = directory.appendingPathComponent("native-observations.jsonl")
    overflow = directory.appendingPathComponent("overflow.json")
    if !FileManager.default.fileExists(atPath: output.path) {
      guard FileManager.default.createFile(atPath: output.path, contents: nil) else { throw NSError(domain: "CliqueNative", code: 2) }
    }
    let size = try FileManager.default.attributesOfItem(atPath: output.path)[.size] as! NSNumber
    bytes = size.intValue
    events = bytes <= Self.maxBytes ? try Data(contentsOf: output).filter { $0 == 10 }.count : Self.maxEvents
    stopped = FileManager.default.fileExists(atPath: overflow.path)
    if bytes > Self.maxBytes || events > Self.maxEvents { try stop() }
  }
  private func stop() throws {
    stopped = true
    try Data("{\"reason\":\"observation-journal-overflow\"}\n".utf8).write(to: overflow, options: .atomic)
  }
  func append(_ data: Data) throws {
    guard !stopped else { return }
    guard events < Self.maxEvents, data.count <= Self.maxBytes - bytes else { try stop(); return }
    let file = try FileHandle(forWritingTo: output)
    defer { try? file.close() }
    try file.seekToEnd(); try file.write(contentsOf: data); try file.synchronize()
    bytes += data.count; events += 1
  }
}
