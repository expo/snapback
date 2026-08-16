import CryptoKit
import ExpoModulesCore
import Foundation
import Security

private let moduleVersion = "0.1.0"
private let envelopeFormatVersion = 1
private let jsMaxSafeInteger: Int64 = 9_007_199_254_740_991

private struct CustodyEnvelope: Codable {
  let formatVersion: Int
  let checksum: String
  let payload: String
}

private enum StoredRecord {
  case absent
  case present(payload: String, revision: Int)
  case corrupt(reason: String)
  case storageFailure(status: OSStatus)
}

public final class SnapbackExpoCustodyModule: Module {
  // @ref LLP 0263#14-ios-verdict — Keychain has no conditional write, so the
  // selected single-runtime grade synthesizes CAS on one native serial queue.
  private let custodyQueue = DispatchQueue(label: "expo.snapback.auth-custody.keychain")

  public func definition() -> ModuleDefinition {
    Name("SnapbackExpoCustody")

    AsyncFunction("platformGrade") { () -> [String: Any] in
      if let refusal = self.singleRuntimeRefusal() { return refusal }
      return [
        "status": "ok",
        "os": "ios",
        "grade": "single-runtime",
        "carrier": "ios-keychain",
        "mechanism": "keychain-serial-cas",
        "moduleVersion": moduleVersion,
        "storageFormatVersion": envelopeFormatVersion
      ]
    }

    AsyncFunction("read") { (appId: String, storageKey: String) -> [String: Any] in
      if let refusal = self.singleRuntimeRefusal() { return refusal }
      guard self.validAddress(appId: appId, storageKey: storageKey) else {
        return self.storageFailure(reason: "invalid native custody address")
      }
      return self.custodyQueue.sync {
        self.readResult(self.readStoredRecord(appId: appId, storageKey: storageKey))
      }
    }

    AsyncFunction("compareAndReplace") {
      (appId: String, storageKey: String, expectedRevision: Int?, serializedRecord: String) -> [String: Any] in
      if let refusal = self.singleRuntimeRefusal() { return refusal }
      guard self.validAddress(appId: appId, storageKey: storageKey) else {
        return self.storageFailure(reason: "invalid native custody address")
      }
      // @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback — expected revision and the entire serialized record cross one native call and one native CAS critical section.
      return self.custodyQueue.sync {
        self.compareAndReplaceStoredRecord(
          appId: appId,
          storageKey: storageKey,
          expectedRevision: expectedRevision,
          serializedRecord: serializedRecord
        )
      }
    }
  }

  private func singleRuntimeRefusal() -> [String: Any]? {
    // An extension must refuse before any Keychain query. Main-app background
    // execution remains the same declared runtime and uses the selected
    // AfterFirstUnlockThisDeviceOnly accessibility class.
    guard Bundle.main.object(forInfoDictionaryKey: "NSExtension") != nil else {
      return nil
    }
    return [
      "status": "single-runtime-refused",
      "code": "SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED",
      "platform": "ios",
      "process": "app-extension"
    ]
  }

  private func validAddress(appId: String, storageKey: String) -> Bool {
    guard !appId.isEmpty, appId.trimmingCharacters(in: .whitespacesAndNewlines) == appId else {
      return false
    }
    return storageKey.range(
      of: #"^snapback\.auth-custody\.(partition\.)?[0-9a-f]{64}$"#,
      options: .regularExpression
    ) != nil
  }

  private func keychainQuery(appId: String, storageKey: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: appId,
      kSecAttrAccount as String: storageKey,
      kSecAttrSynchronizable as String: false
    ]
  }

  private func readStoredRecord(appId: String, storageKey: String) -> StoredRecord {
    var query = keychainQuery(appId: appId, storageKey: storageKey)
    // Search across both synchronizable domains. Filtering on false would make
    // a leftover iCloud-synchronizable item look absent, allowing a second
    // item under the same service/account identity.
    query[kSecAttrSynchronizable as String] = kSecAttrSynchronizableAny
    query[kSecMatchLimit as String] = kSecMatchLimitAll
    query[kSecReturnData as String] = true
    query[kSecReturnAttributes as String] = true

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    switch status {
    case errSecItemNotFound:
      return .absent
    case errSecSuccess:
      let matches: [[String: Any]]
      if let collection = item as? [[String: Any]] {
        matches = collection
      } else if let single = item as? [String: Any] {
        matches = [single]
      } else {
        return .corrupt(reason: "Keychain custody lookup returned invalid attributes")
      }
      guard matches.count == 1, let attributes = matches.first else {
        return .corrupt(reason: "Keychain custody has duplicate service/account items")
      }
      if let synchronizable = attributes[kSecAttrSynchronizable as String] {
        guard let value = synchronizable as? NSNumber, value.boolValue == false else {
          return .corrupt(reason: "Keychain custody is unexpectedly synchronizable")
        }
      }
      guard
        let data = attributes[kSecValueData as String] as? Data,
        let accessibility = attributes[kSecAttrAccessible as String],
        CFEqual(accessibility as CFTypeRef, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
      else {
        return .corrupt(reason: "Keychain custody has invalid data or accessibility attributes")
      }
      return decodeEnvelope(data)
    default:
      return .storageFailure(status: status)
    }
  }

  private func decodeEnvelope(_ data: Data) -> StoredRecord {
    do {
      guard
        let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        Set(raw.keys) == Set(["formatVersion", "checksum", "payload"])
      else {
        return .corrupt(reason: "custody envelope has missing or unknown fields")
      }
      let envelope = try JSONDecoder().decode(CustodyEnvelope.self, from: data)
      guard envelope.formatVersion == envelopeFormatVersion else {
        return .corrupt(reason: "custody envelope format version is unsupported")
      }
      guard envelope.checksum == sha256Hex(Data(envelope.payload.utf8)) else {
        return .corrupt(reason: "custody envelope checksum mismatch")
      }
      guard let revision = recordRevision(envelope.payload) else {
        return .corrupt(reason: "custody envelope payload has no safe positive revision")
      }
      return .present(payload: envelope.payload, revision: revision)
    } catch {
      return .corrupt(reason: "custody envelope is not valid JSON")
    }
  }

  private func recordRevision(_ payload: String) -> Int? {
    guard
      let data = payload.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data),
      let record = object as? [String: Any],
      let number = record["revision"] as? NSNumber,
      CFGetTypeID(number) != CFBooleanGetTypeID()
    else {
      return nil
    }
    let value = number.int64Value
    guard value > 0, value <= jsMaxSafeInteger, number.doubleValue == Double(value) else {
      return nil
    }
    return Int(value)
  }

  private func encodedEnvelope(payload: String) -> Data? {
    let envelope = CustodyEnvelope(
      formatVersion: envelopeFormatVersion,
      checksum: sha256Hex(Data(payload.utf8)),
      payload: payload
    )
    return try? JSONEncoder().encode(envelope)
  }

  private func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  private func compareAndReplaceStoredRecord(
    appId: String,
    storageKey: String,
    expectedRevision: Int?,
    serializedRecord: String
  ) -> [String: Any] {
    let current = readStoredRecord(appId: appId, storageKey: storageKey)
    let actualRevision: Int?
    // @ref LLP 0059#unrecognized-authority-recovery — malformed custody is
    // never an anonymous/fresh recovery arm; only validated settled or
    // clearing records can enter coordinator recovery.
    switch current {
    case .absent:
      actualRevision = nil
    case let .present(_, revision):
      actualRevision = revision
    case let .corrupt(reason):
      return corrupt(reason: reason)
    case let .storageFailure(status):
      return storageFailure(status: status)
    }

    guard actualRevision == expectedRevision else {
      return casStale(expectedRevision: expectedRevision, actualRevision: actualRevision)
    }
    guard let proposedRevision = recordRevision(serializedRecord) else {
      return corrupt(reason: "replacement has no safe positive revision")
    }
    guard let envelope = encodedEnvelope(payload: serializedRecord) else {
      return corrupt(reason: "replacement envelope could not be encoded")
    }

    let writeStatus: OSStatus
    if actualRevision == nil {
      var add = keychainQuery(appId: appId, storageKey: storageKey)
      add[kSecValueData as String] = envelope
      add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      add[kSecAttrSynchronizable as String] = false
      writeStatus = SecItemAdd(add as CFDictionary, nil)
    } else {
      let update: [String: Any] = [
        kSecValueData as String: envelope,
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        kSecAttrSynchronizable as String: false
      ]
      writeStatus = SecItemUpdate(
        keychainQuery(appId: appId, storageKey: storageKey) as CFDictionary,
        update as CFDictionary
      )
    }

    if writeStatus == errSecDuplicateItem {
      let reread = readStoredRecord(appId: appId, storageKey: storageKey)
      if case let .present(_, revision) = reread {
        return casStale(expectedRevision: expectedRevision, actualRevision: revision)
      }
      return storageFailure(status: writeStatus)
    }
    guard writeStatus == errSecSuccess else {
      return storageFailure(status: writeStatus)
    }

    // @ref LLP 0263#4-crash-safety-analysis-of-the-recommended-write-paths — every Keychain write is re-read and both checksum and revision echo are verified before success.
    switch readStoredRecord(appId: appId, storageKey: storageKey) {
    case let .present(payload, revision)
      where payload == serializedRecord && revision == proposedRevision:
      return ["status": "ok", "record": payload]
    case let .present(_, revision):
      return corrupt(reason: "Keychain read-verify revision or payload mismatch: \(revision)")
    case .absent:
      return corrupt(reason: "Keychain read-verify found no replacement")
    case let .corrupt(reason):
      return corrupt(reason: reason)
    case let .storageFailure(status):
      return storageFailure(status: status)
    }
  }

  private func readResult(_ record: StoredRecord) -> [String: Any] {
    switch record {
    case .absent:
      return ["status": "ok", "record": NSNull()]
    case let .present(payload, _):
      return ["status": "ok", "record": payload]
    case let .corrupt(reason):
      return corrupt(reason: reason)
    case let .storageFailure(status):
      return storageFailure(status: status)
    }
  }

  private func casStale(expectedRevision: Int?, actualRevision: Int?) -> [String: Any] {
    [
      "status": "cas-stale",
      "code": "SNAPBACK_AUTH_CUSTODY_CAS_STALE",
      "expectedRevision": expectedRevision.map { $0 as Any } ?? NSNull(),
      "actualRevision": actualRevision.map { $0 as Any } ?? NSNull()
    ]
  }

  private func corrupt(reason: String) -> [String: Any] {
    [
      "status": "corrupt",
      "code": "SNAPBACK_AUTH_CUSTODY_CORRUPT",
      "reason": reason
    ]
  }

  private func storageFailure(status: OSStatus) -> [String: Any] {
    storageFailure(reason: "Keychain status \(status)")
  }

  private func storageFailure(reason: String) -> [String: Any] {
    [
      "status": "storage-error",
      "code": "SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED",
      "reason": reason
    ]
  }
}
