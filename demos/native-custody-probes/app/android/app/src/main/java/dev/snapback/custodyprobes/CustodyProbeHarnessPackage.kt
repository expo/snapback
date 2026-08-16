package dev.snapback.custodyprobes

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ResultReceiver
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.ReactPackage

class CustodyProbeHarnessPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(CustodyProbeHarnessModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}

class CustodyProbeHarnessModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "CustodyProbeHarness"

  @ReactMethod
  fun runSecondaryProcessProbe(promise: Promise) {
    val receiver = object : ResultReceiver(Handler(Looper.getMainLooper())) {
      override fun onReceiveResult(resultCode: Int, resultData: Bundle?) {
        val map = WritableNativeMap()
        map.putBoolean("attempted", resultData?.getBoolean("attempted", false) ?: false)
        map.putString("context", "android-secondary-process")
        map.putString(
          "processName",
          resultData?.getString("processName") ?: "dev.snapback.custodyprobes:probe",
        )
        val diagnostic = WritableNativeMap()
        diagnostic.putString(
          "code",
          resultData?.getString("diagnosticCode")
            ?: "SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_RESULT_MISSING",
        )
        diagnostic.putString(
          "message",
          resultData?.getString("diagnosticMessage")
            ?: "Secondary-process probe returned no diagnostic.",
        )
        map.putMap("diagnostic", diagnostic)
        promise.resolve(map)
      }
    }
    val intent = Intent(context, CustodyProbeService::class.java)
      .putExtra(CustodyProbeService.RESULT_RECEIVER, receiver)
    try {
      context.startService(intent)
    } catch (error: Exception) {
      promise.reject(
        "SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_START_FAILED",
        "Could not start the secondary-process custody probe service.",
        error,
      )
    }
  }
}
