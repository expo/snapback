package expo.modules.snapbackdevidentity

import android.content.Context
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler

private const val CHECKOUT_EXTRA = "SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE"

class SnapbackExpoDevIdentityPackage : Package {
  override fun createReactActivityHandlers(
    activityContext: Context?
  ): List<ReactActivityHandler> = listOf(
    object : ReactActivityHandler {
      override fun onDidCreateReactActivityDelegateNotification(
        activity: ReactActivity?,
        delegate: ReactActivityDelegate?
      ) {
        val launchIntent = activity?.intent
        // @ref LLP 0262#d2-carriers-per-shipped-topology — capture the exact
        // launch Activity extra before Expo enters any React load path. The
        // process-only value is never persisted/logged and is consumed once.
        val delivered = launchIntent?.getStringExtra(CHECKOUT_EXTRA)
        launchIntent?.removeExtra(CHECKOUT_EXTRA)
        CheckoutNonceCarrier.captureLaunch(delivered)
      }
    }
  )
}
