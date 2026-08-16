package expo.modules.snapbackdevidentity

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

internal object CheckoutNonceCarrier {
  private var captured = false
  private var consumed = false
  private var nonce: String? = null

  @Synchronized
  fun captureLaunch(delivered: String?) {
    if (captured) return
    captured = true
    nonce = delivered?.takeIf { it.isNotEmpty() }
  }

  @Synchronized
  fun take(): String? {
    if (consumed) return null
    consumed = true
    return nonce.also { nonce = null }
  }
}

class SnapbackExpoDevIdentityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SnapbackExpoDevIdentity")

    Function("takeCheckoutNonce") {
      CheckoutNonceCarrier.take()
    }
  }
}
