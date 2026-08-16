import ExpoModulesCore
import Foundation
import UIKit

private let checkoutEnvironment = "SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE"

private final class CheckoutNonceCarrier {
  static let shared = CheckoutNonceCarrier()

  private let lock = NSLock()
  private var captured = false
  private var consumed = false
  private var nonce: String?

  private init() {}

  func captureLaunch(_ delivered: String?) {
    lock.lock()
    defer { lock.unlock() }
    guard !captured else { return }
    captured = true
    if let delivered, !delivered.isEmpty {
      nonce = delivered
    }
  }

  func take() -> String? {
    lock.lock()
    defer { lock.unlock() }
    guard !consumed else { return nil }
    consumed = true
    let delivered = nonce
    nonce = nil
    return delivered
  }
}

public final class SnapbackExpoDevIdentityAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // @ref LLP 0262#d2-carriers-per-shipped-topology — capture the simulator
    // child environment into process memory before React starts. The value is
    // neither persisted nor logged and can be consumed only once.
    CheckoutNonceCarrier.shared.captureLaunch(
      ProcessInfo.processInfo.environment[checkoutEnvironment]
    )
    return false
  }
}

public final class SnapbackExpoDevIdentityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SnapbackExpoDevIdentity")

    Function("takeCheckoutNonce") { () -> String? in
      CheckoutNonceCarrier.shared.take()
    }
  }
}
