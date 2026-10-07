import Foundation

// @ref LLP 0201.000#3 — explicit launch activation and bounded, append-only evidence.
final class ObservationJournal {
  static let maxBytes = 4 * 1024 * 1024
  static let maxEvents = 10_000
  let output: URL
  private let runId: String
  private let overflow: URL
  private let diagnostics: URL
  private let flushRequest: URL
  private let flushAcknowledgment: URL
  private let stateLock = NSLock()
  private var admittedBytes: Int
  private var admittedEvents: Int
  private var completedBytes: Int
  private var completedEvents: Int
  private var persistedBytes: Int
  private var persistedEvents: Int
  private var stopped: Bool
  private var lastAcknowledgedNonce: String?
  private(set) var diagnosticState: [String: String]?

  static func activate(arguments: [String], documents: URL) throws -> (String, ObservationJournal)? {
    guard let index = arguments.firstIndex(of: "--clique-run") else { return nil }
    guard index + 1 < arguments.count, let id = UUID(uuidString: arguments[index + 1]) else {
      throw NSError(domain: "CliqueNative", code: 1, userInfo: [NSLocalizedDescriptionKey: "invalid run nonce"])
    }
    let run = id.uuidString.lowercased()
    let dir = documents.appendingPathComponent("clique-native").appendingPathComponent(run)
    return (run, try ObservationJournal(directory: dir, runId: run))
  }
  init(directory: URL, runId: String? = nil) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    self.runId = runId ?? directory.lastPathComponent.lowercased()
    output = directory.appendingPathComponent("native-observations.jsonl")
    overflow = directory.appendingPathComponent("overflow.json")
    diagnostics = directory.appendingPathComponent("observer-diagnostics.json")
    flushRequest = directory.appendingPathComponent("flush-request.json")
    flushAcknowledgment = directory.appendingPathComponent("flush-ack.json")
    // Requests are process-local barriers. A fresh helper process must never
    // acknowledge the previous process's retained challenge.
    try? FileManager.default.removeItem(at: flushRequest)
    try? FileManager.default.removeItem(at: flushAcknowledgment)
    if !FileManager.default.fileExists(atPath: output.path) {
      guard FileManager.default.createFile(atPath: output.path, contents: nil) else { throw NSError(domain: "CliqueNative", code: 2) }
    }
    let size = try FileManager.default.attributesOfItem(atPath: output.path)[.size] as! NSNumber
    let bytes = size.intValue
    let events = bytes <= Self.maxBytes ? try Data(contentsOf: output).filter { $0 == 10 }.count : Self.maxEvents
    admittedBytes = bytes
    admittedEvents = events
    completedBytes = bytes
    completedEvents = events
    persistedBytes = bytes
    persistedEvents = events
    lastAcknowledgedNonce = nil
    diagnosticState = nil
    if FileManager.default.fileExists(atPath: diagnostics.path),
       let data = try? Data(contentsOf: diagnostics),
       let object = try? JSONSerialization.jsonObject(with: data),
       let value = object as? [String: String] {
      diagnosticState = value
    }
    stopped = FileManager.default.fileExists(atPath: overflow.path) || diagnosticState != nil
    if bytes > Self.maxBytes || events > Self.maxEvents {
      stopped = true
      persistOverflow()
    }
  }

  static func recordActivationFailure(arguments: [String], documents: URL, reason: String, operation: String) -> [String: String] {
    var value = ["reason": reason, "operation": operation]
    guard let index = arguments.firstIndex(of: "--clique-run"), index + 1 < arguments.count,
          let id = UUID(uuidString: arguments[index + 1]) else { return value }
    let run = id.uuidString.lowercased()
    value["runId"] = run
    let directory = documents.appendingPathComponent("clique-native").appendingPathComponent(run)
    let marker = directory.appendingPathComponent("observer-diagnostics.json")
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      if !FileManager.default.fileExists(atPath: marker.path) {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        try data.write(to: marker, options: .atomic)
      }
    } catch { /* The module retains this value in memory; app behavior remains isolated. */ }
    return value
  }

  func recordFailure(reason: String, operation: String) {
    stateLock.lock()
    guard diagnosticState == nil else { stateLock.unlock(); return }
    let value = ["reason": reason, "operation": operation]
    diagnosticState = value
    stopped = true
    stateLock.unlock()
    do {
      if !FileManager.default.fileExists(atPath: diagnostics.path) {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        try data.write(to: diagnostics, options: .atomic)
      }
    } catch { /* In-memory state remains sticky and no error reaches the app. */ }
  }

  /// Reserve journal capacity on the calling thread before work enters the
  /// serial writer. This lock never covers file I/O.
  var acceptingObservations: Bool {
    stateLock.lock(); defer { stateLock.unlock() }
    return !stopped && diagnosticState == nil
  }

  func reserve(byteCount: Int) -> Bool {
    stateLock.lock(); defer { stateLock.unlock() }
    guard !stopped else { return false }
    guard admittedEvents < Self.maxEvents, byteCount >= 0, byteCount <= Self.maxBytes - admittedBytes else {
      stopped = true
      return false
    }
    admittedEvents += 1
    admittedBytes += byteCount
    return true
  }

  func latchOverflow() {
    stateLock.lock(); stopped = true; stateLock.unlock()
  }

  func persistOverflow() {
    do { try Data("{\"reason\":\"observation-journal-overflow\"}\n".utf8).write(to: overflow, options: .atomic) }
    catch { recordFailure(reason: "observation-journal-io", operation: "overflow-marker") }
  }

  @discardableResult func appendReserved(_ data: Data) -> Bool {
    defer {
      stateLock.lock()
      completedBytes += data.count
      completedEvents += 1
      stateLock.unlock()
    }
    do {
      let file = try FileHandle(forWritingTo: output)
      defer { try? file.close() }
      try file.seekToEnd(); try file.write(contentsOf: data); try file.synchronize()
      stateLock.lock()
      persistedBytes += data.count
      persistedEvents += 1
      stateLock.unlock()
      return true
    } catch {
      recordFailure(reason: "observation-journal-io", operation: "append")
      return false
    }
  }

  @discardableResult func append(_ data: Data) -> Bool {
    guard reserve(byteCount: data.count) else { persistOverflow(); return false }
    return appendReserved(data)
  }

  /// Called only from the serial native writer queue. A matching atomic ack is
  /// therefore a barrier after every append accepted before this poll.
  func acknowledgeFlushRequest(processNonce: String) {
    guard let data = try? Data(contentsOf: flushRequest),
          let object = try? JSONSerialization.jsonObject(with: data),
          let request = object as? [String: Any],
          Set(request.keys) == Set(["protocol", "runId", "nonce"]),
          request["protocol"] as? String == "clique-native-flush/1",
          request["runId"] as? String == runId,
          let nonce = request["nonce"] as? String,
          UUID(uuidString: nonce) != nil,
          nonce != lastAcknowledgedNonce else { return }
    stateLock.lock()
    guard admittedEvents == completedEvents, admittedBytes == completedBytes else {
      stateLock.unlock()
      return
    }
    let eventCount = persistedEvents
    let byteCount = persistedBytes
    stateLock.unlock()
    let acknowledgment: [String: Any] = [
      "protocol": "clique-native-flush/1", "runId": runId, "nonce": nonce,
      "processNonce": processNonce, "eventCount": eventCount, "byteCount": byteCount]
    do {
      let encoded = try JSONSerialization.data(withJSONObject: acknowledgment, options: [.sortedKeys])
      try encoded.write(to: flushAcknowledgment, options: .atomic)
      lastAcknowledgedNonce = nonce
    } catch {
      recordFailure(reason: "observation-journal-io", operation: "flush-ack")
    }
  }
}
