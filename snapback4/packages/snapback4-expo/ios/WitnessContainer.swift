import Foundation

// Runtime environment is not exposed to Hermes by Expo. This small bridge
// supplies it and durable file append; the scenario and protocol live in JS.
enum WitnessContainer {
  static var launch: String? {
    #if targetEnvironment(simulator)
    return ProcessInfo.processInfo.environment["SNAPBACK4_WITNESS"]
    #else
    return nil
    #endif
  }

  private static func directory() throws -> URL {
    guard let launch, let bytes = launch.data(using: .utf8),
      let config = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
      let run = config["run"] as? String, !run.isEmpty,
      run.utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 122) || $0 == 45 })
    else { throw Snapback4OpenException("E_WITNESS_INPUT: no valid simulator witness launch") }
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    return documents.appendingPathComponent(".snapback4-witness/\(run)", isDirectory: true)
  }

  static func append(_ line: String) throws {
    let directory = try directory()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let file = directory.appendingPathComponent("receipts.jsonl")
    if !FileManager.default.fileExists(atPath: file.path) {
      guard FileManager.default.createFile(atPath: file.path, contents: nil) else {
        throw Snapback4OpenException("E_WITNESS_RECEIPT: cannot create receipts file")
      }
    }
    let handle = try FileHandle(forWritingTo: file)
    defer { try? handle.close() }
    try handle.seekToEnd()
    try handle.write(contentsOf: Data(line.utf8))
    try handle.synchronize()
  }

  static func signaled(_ label: String) throws -> Bool {
    guard !label.isEmpty, label.utf8.allSatisfy({
      ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || $0 == 45 || $0 == 95
    }) else { throw Snapback4OpenException("E_WITNESS_INPUT: invalid signal label") }
    return FileManager.default.fileExists(atPath: try directory().appendingPathComponent(label).path)
  }
}
