import Darwin
import Foundation
import SnapbackExpoCustody
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
  private static let directorOrigin = URL(string: "http://127.0.0.1:18771")!
  private static let ownerAppId = "native-custody-probes"
  // authAppIdHash("native-custody-probes") from the production default-owner
  // address in @expo/snapback-expo-custody.
  private static let ownerStorageKey =
    "snapback.auth-custody.587f81121d48633d95ed50d980d2276813c2c34f3957c5fddfdbc1fc55170291"

  private let completionLock = NSLock()
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var originalContent: UNNotificationContent?
  private lazy var session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 10
    configuration.timeoutIntervalForResource = 15
    return URLSession(configuration: configuration)
  }()

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    completionLock.lock()
    self.contentHandler = contentHandler
    originalContent = request.content
    completionLock.unlock()

    // @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback
    // — this is the production read entry: the shared single-runtime gate
    // must refuse this NSE before the shared Keychain path performs I/O.
    let outcome = SnapbackExpoCustodyExtensionProbe.read(
      appId: Self.ownerAppId,
      storageKey: Self.ownerStorageKey
    )
    let extensionPoint = (
      Bundle.main.object(forInfoDictionaryKey: "NSExtension") as? [String: Any]
    )?["NSExtensionPointIdentifier"] as? String ?? "unresolved"
    let report: [String: Any] = [
      "schemaVersion": "snapback.native-custody-extension.v1",
      "bundleIdentifier": Bundle.main.bundleIdentifier ?? "unresolved",
      "extensionPointIdentifier": extensionPoint,
      "pid": Int(Darwin.getpid()),
      "code": outcome.code,
      "reason": outcome.reason,
      "ioOccurred": outcome.ioOccurred,
      "atMs": Int64(Date().timeIntervalSince1970 * 1_000)
    ]

    guard let body = try? JSONSerialization.data(withJSONObject: report) else {
      finishWithOriginalContent()
      return
    }
    var resultURL = Self.directorOrigin
    resultURL.appendPathComponent("extension-result")
    var resultRequest = URLRequest(url: resultURL)
    resultRequest.httpMethod = "POST"
    resultRequest.setValue("application/json", forHTTPHeaderField: "content-type")
    resultRequest.httpBody = body
    session.dataTask(with: resultRequest) { [weak self] _, _, _ in
      self?.finishWithOriginalContent()
    }.resume()
  }

  override func serviceExtensionTimeWillExpire() {
    finishWithOriginalContent()
  }

  private func finishWithOriginalContent() {
    completionLock.lock()
    let handler = contentHandler
    let content = originalContent
    contentHandler = nil
    originalContent = nil
    completionLock.unlock()
    if let handler, let content { handler(content) }
  }
}
