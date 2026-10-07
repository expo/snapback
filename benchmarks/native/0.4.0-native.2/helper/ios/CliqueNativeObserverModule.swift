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
  private var stickyDiagnostic: [String: String]?
  private var overflowPersistenceScheduled = false
  private var flushTimer: DispatchSourceTimer?
  private let lock = NSLock()
  private let writer = DispatchQueue(label: "dev.clique.native-observer.writer", qos: .utility)
  private let stalledWriterGate = DispatchSemaphore(value: 0)

  private func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
  private func disclose(reason: String, operation: String) {
    guard stickyDiagnostic == nil else { return }
    if let journal {
      journal.recordFailure(reason: reason, operation: operation)
      stickyDiagnostic = journal.diagnosticState
    } else {
      let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      stickyDiagnostic = ObservationJournal.recordActivationFailure(
        arguments: ProcessInfo.processInfo.arguments, documents: documents,
        reason: reason, operation: operation)
    }
  }
  private func configure() -> Bool {
    if journal != nil { return true }
    do {
      let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      guard let (id, journalWriter) = try ObservationJournal.activate(arguments: ProcessInfo.processInfo.arguments, documents: documents) else { return false }
      runId = id; journal = journalWriter
      if ProcessInfo.processInfo.arguments.contains("--clique-stall-writer") {
        writer.async { self.stalledWriterGate.wait() }
      }
      let timer = DispatchSource.makeTimerSource(queue: writer)
      timer.schedule(deadline: .now(), repeating: .milliseconds(50), leeway: .milliseconds(10))
      timer.setEventHandler { [weak self] in
        guard let self else { return }
        self.journal?.acknowledgeFlushRequest(processNonce: self.processNonce)
      }
      flushTimer = timer
      timer.resume()
      return true
    } catch {
      disclose(reason: "observation-journal-io", operation: "configuration")
      return false
    }
  }
  private func persistOverflowOnce() {
    guard !overflowPersistenceScheduled else { return }
    overflowPersistenceScheduled = true
    writer.async { self.journal?.persistOverflow() }
  }
  public func definition() -> ModuleDefinition {
    Name("CliqueNativeObserver")
    Function("hash") { (value: String) -> String in self.digest(Data(value.utf8)) }
    Function("diagnostic") { (operation: String) in
      self.lock.lock()
      guard self.stickyDiagnostic == nil else { self.lock.unlock(); return }
      let value = ["reason": "observation-bridge-failure", "operation": operation]
      self.stickyDiagnostic = value
      let activeJournal = self.journal
      self.lock.unlock()
      self.writer.async {
        if let activeJournal {
          activeJournal.recordFailure(reason: value["reason"]!, operation: operation)
        } else {
          let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
          _ = ObservationJournal.recordActivationFailure(
            arguments: ProcessInfo.processInfo.arguments, documents: documents,
            reason: value["reason"]!, operation: operation)
        }
      }
    }
    Function("configuration") { () -> [String: Any]? in
      self.lock.lock(); defer { self.lock.unlock() }
      guard self.configure() else { return nil }
      do {
        let bundle = Bundle.main
        let js = bundle.url(forResource: "main", withExtension: "jsbundle")
        return ["protocol": "clique-native/1", "runId": self.runId!, "processNonce": self.processNonce,
          "stalledWriterControl": ProcessInfo.processInfo.arguments.contains("--clique-stall-writer"),
          "build": ["bundleId": bundle.bundleIdentifier ?? "", "nativeSha256": self.digest(try Data(contentsOf: bundle.executableURL!)),
            "hermesSha256": try js.map { self.digest(try Data(contentsOf: $0)) } as Any? ?? NSNull()]]
      } catch {
        self.disclose(reason: "observation-configuration-io", operation: "build-identity")
        return nil
      }
    }
    Function("overflow") { (reason: String) in
      self.lock.lock(); defer { self.lock.unlock() }
      guard self.configure(), reason == "javascript-observation-queue" else { return }
      self.journal!.latchOverflow()
      self.persistOverflowOnce()
    }
    Function("append") { (kind: String, payload: [String: Any]) in
      let fields: [String: Set<String>] = [
        "ready": ["principal", "origin", "authenticationRestored", "build", "development"],
        "screen": ["route", "conversationId", "rows"],
        "write": ["ordinal", "operationId", "messageId", "bodyHash", "state"],
        "media": ["messageId", "assetId", "event", "width", "height", "provenance"],
        "search": ["token", "resultIds", "openedConversationId"]]
      self.lock.lock()
      guard self.configure() else { self.lock.unlock(); return }
      guard self.journal!.acceptingObservations, self.stickyDiagnostic == nil else {
        self.lock.unlock()
        return
      }
      guard let allowed = fields[kind], Set(payload.keys).isSubset(of: allowed) else {
        self.disclose(reason: "observation-payload-invalid", operation: "append")
        self.lock.unlock()
        return
      }
      do {
        self.sequence += 1
        let event: [String: Any] = ["protocol": "clique-native/1", "runId": self.runId!, "processNonce": self.processNonce,
          "sequence": self.sequence, "elapsedMs": (ProcessInfo.processInfo.systemUptime - self.started) * 1000,
          "kind": kind, "payload": payload]
        var data = try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys])
        data.append(10)
        guard self.journal!.reserve(byteCount: data.count) else {
          self.persistOverflowOnce()
          self.lock.unlock()
          return
        }
        self.writer.async {
          self.journal?.appendReserved(data)
          if let diagnostic = self.journal?.diagnosticState {
            self.lock.lock(); self.stickyDiagnostic = diagnostic; self.lock.unlock()
          }
        }
        self.lock.unlock()
      } catch {
        self.disclose(reason: "observation-serialization-failure", operation: "append")
        self.lock.unlock()
      }
    }
  }
}
