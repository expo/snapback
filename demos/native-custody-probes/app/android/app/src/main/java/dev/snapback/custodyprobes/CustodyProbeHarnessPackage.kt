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
        val processName = resultData?.getString("processName")
        val servicePid = resultData?.getInt("servicePid", -1) ?: -1
        val resultMissing = processName == null || servicePid <= 0
        map.putBoolean(
          "attempted",
          !resultMissing && (resultData?.getBoolean("attempted", false) ?: false),
        )
        map.putBoolean(
          "ioOccurred",
          !resultMissing && (resultData?.getBoolean("ioOccurred", false) ?: false),
        )
        map.putString("context", "android-secondary-process")
        if (processName == null) map.putNull("processName") else map.putString("processName", processName)
        if (servicePid <= 0) map.putNull("servicePid") else map.putInt("servicePid", servicePid)
        val diagnostic = WritableNativeMap()
        diagnostic.putString(
          "code",
          if (resultMissing) {
            "SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_RESULT_MISSING"
          } else {
            resultData?.getString("diagnosticCode")
              ?: "SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_RESULT_MISSING"
          },
        )
        diagnostic.putString(
          "message",
          resultData?.getString("diagnosticMessage")
            ?: "Secondary-process probe returned no diagnostic.",
        )
        val diagnosticReason = resultData?.getString("diagnosticReason")
        if (diagnosticReason == null) diagnostic.putNull("reason")
        else diagnostic.putString("reason", diagnosticReason)
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
