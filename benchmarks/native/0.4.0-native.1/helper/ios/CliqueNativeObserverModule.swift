import ExpoModulesCore
import Foundation
import CryptoKit

// @ref LLP 0201.000#3 — file-only passive observations survive an unavailable backend.
public class CliqueNativeObserverModule: Module {
  private let processNonce = UUID().uuidString.lowercased()
  private let started = ProcessInfo.processInfo.systemUptime
  private var sequence = 0
  private var runId: String?
  private var journal: ObservationJournal?
  private let lock = NSLock()

  private func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
  private func configure() throws -> Bool {
    if journal != nil { return true }
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    guard let (id, writer) = try ObservationJournal.activate(arguments: ProcessInfo.processInfo.arguments, documents: documents) else { return false }
    runId = id; journal = writer
    return true
  }
  public func definition() -> ModuleDefinition {
    Name("CliqueNativeObserver")
    Function("hash") { (value: String) -> String in self.digest(Data(value.utf8)) }
    Function("configuration") { () throws -> [String: Any]? in
      self.lock.lock(); defer { self.lock.unlock() }
      guard try self.configure() else { return nil }
      let bundle = Bundle.main
      let js = bundle.url(forResource: "main", withExtension: "jsbundle")
      return ["protocol": "clique-native/1", "runId": self.runId!, "processNonce": self.processNonce,
        "build": ["bundleId": bundle.bundleIdentifier ?? "", "nativeSha256": try self.digest(Data(contentsOf: bundle.executableURL!)),
          "hermesSha256": try js.map { self.digest(try Data(contentsOf: $0)) } as Any? ?? NSNull()]]
    }
    Function("append") { (kind: String, payload: [String: Any]) throws in
      self.lock.lock(); defer { self.lock.unlock() }
      guard try self.configure() else { return }
      let fields: [String: Set<String>] = [
        "ready": ["principal", "origin", "authenticationRestored", "build", "development"],
        "screen": ["route", "conversationId", "rows"],
        "write": ["ordinal", "operationId", "messageId", "bodyHash", "state"],
        "media": ["messageId", "assetId", "event", "width", "height", "provenance"],
        "search": ["token", "resultIds", "openedConversationId"]]
      guard let allowed = fields[kind], Set(payload.keys).isSubset(of: allowed) else {
        throw NSError(domain: "CliqueNative", code: 3, userInfo: [NSLocalizedDescriptionKey: "unsupported observation fields"])
      }
      self.sequence += 1
      let event: [String: Any] = ["protocol": "clique-native/1", "runId": self.runId!, "processNonce": self.processNonce,
        "sequence": self.sequence, "elapsedMs": (ProcessInfo.processInfo.systemUptime - self.started) * 1000,
        "kind": kind, "payload": payload]
      var data = try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys])
      data.append(10)
      try self.journal!.append(data)
    }
  }
}
