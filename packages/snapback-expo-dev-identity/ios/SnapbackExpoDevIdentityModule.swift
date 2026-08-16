import ExpoModulesCore
import Darwin
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

  private func captureEnvironmentLocked() {
    guard !captured else { return }
    let delivered = getenv(checkoutEnvironment).map { String(cString: $0) }
    unsetenv(checkoutEnvironment)
    captured = true
    if let delivered, !delivered.isEmpty {
      nonce = delivered
    }
  }

  func captureLaunch() {
    lock.lock()
    defer { lock.unlock() }
    captureEnvironmentLocked()
  }

  func take() -> String? {
    lock.lock()
    defer { lock.unlock() }
    // JavaScript may ask before the app-delegate subscriber runs. Close that
    // race by performing the same environment read-and-unset attempt under
    // this lock before marking the one-shot delivery consumed.
    captureEnvironmentLocked()
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
    // @ref LLP 0262#d2-carriers-per-shipped-topology — make a best-effort
    // early copy of the simulator child environment and immediately remove it
    // from the process environment. take() performs the same locked capture
    // attempt if JavaScript reaches the module before this subscriber.
    CheckoutNonceCarrier.shared.captureLaunch()
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
