import Darwin
import Foundation
import SnapbackExpoCustody
import UIKit

final class ShareViewController: UIViewController {
  private static let directorURL = URL(string: "http://127.0.0.1:18771/extension-result")!
  private static let ownerAppId = "native-custody-probes"
  // authAppIdHash("native-custody-probes") from the production default-owner
  // address in @expo/snapback-expo-custody.
  private static let ownerStorageKey =
    "snapback.auth-custody.587f81121d48633d95ed50d980d2276813c2c34f3957c5fddfdbc1fc55170291"

  private var reportTask: URLSessionDataTask?

  override func viewDidLoad() {
    super.viewDidLoad()

    // @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback
    // — this is the same production operation entry used by the NSE and Expo
    // module; the shared gate must refuse before the Keychain path performs I/O.
    let outcome = SnapbackExpoCustodyExtensionProbe.read(
      appId: Self.ownerAppId,
      storageKey: Self.ownerStorageKey
    )
    let extensionPoint = (
      Bundle.main.object(forInfoDictionaryKey: "NSExtension") as? [String: Any]
    )?["NSExtensionPointIdentifier"] as? String ?? "unresolved"
    let report: [String: Any] = [
      "schemaVersion": "snapback.native-custody-extension.v1",
      "extensionPointIdentifier": extensionPoint,
      "pid": Int(Darwin.getpid()),
      "bundleIdentifier": Bundle.main.bundleIdentifier ?? "unresolved",
      "code": outcome.code,
      "reason": outcome.reason,
      "ioOccurred": outcome.ioOccurred,
      "atMs": Int64(Date().timeIntervalSince1970 * 1_000)
    ]

    if let body = try? JSONSerialization.data(withJSONObject: report) {
      var request = URLRequest(url: Self.directorURL)
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "content-type")
      request.httpBody = body
      reportTask = URLSession.shared.dataTask(with: request)
      reportTask?.resume()
    }

    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }
}
