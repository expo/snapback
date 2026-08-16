package dev.snapback.custodyprobes

import android.app.Service
import android.content.Intent
import android.os.Bundle
import android.os.IBinder
import android.os.Process
import android.os.ResultReceiver

class CustodyProbeService : Service() {
  companion object {
    const val RESULT_RECEIVER = "dev.snapback.custodyprobes.RESULT_RECEIVER"
    private const val LANE_A_HOOK = "expo.modules.snapbackcustody.NativeCustodyProbeHooks"
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    @Suppress("DEPRECATION")
    val receiver = intent?.getParcelableExtra<ResultReceiver>(RESULT_RECEIVER)
    val processName = Process.myProcessName()
    var attempted = false
    var code = "SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_TEST_HOOK_UNAVAILABLE"
    var message = "Lane A must expose NativeCustodyProbeHooks.attemptSecondaryProcessIo(Context)."
    try {
      // @ref LLP 0059#cross-context-ownership — the secondary process makes
      // a real module call so this witnesses typed single-runtime refusal,
      // not a harness-side process-name assertion.
      // LANE-A-INTEGRATION: the debug-only hook must make a real custody I/O
      // attempt in this :probe process and return (or throw) the stable typed
      // single-runtime refusal code. No production code depends on this hook.
      val hook = Class.forName(LANE_A_HOOK)
      val method = hook.getMethod("attemptSecondaryProcessIo", android.content.Context::class.java)
      attempted = true
      val observed = method.invoke(null, this)
      code = when (observed) {
        is String -> observed
        else -> "SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_UNTYPED_RESULT"
      }
      message = "Lane A secondary-process custody I/O returned a typed result."
    } catch (error: java.lang.reflect.InvocationTargetException) {
      attempted = true
      val cause = error.targetException
      code = typedCode(cause) ?: "SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_UNTYPED_THROW"
      message = "Lane A secondary-process custody I/O threw a typed refusal."
    } catch (_: ClassNotFoundException) {
      // Preserve the explicit integration diagnostic above.
    } catch (error: Exception) {
      attempted = true
      code = typedCode(error) ?: "SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_PROBE_FAILED"
      message = "Secondary-process custody probe failed with a typed diagnostic."
    }
    receiver?.send(0, Bundle().apply {
      putBoolean("attempted", attempted)
      putString("processName", processName)
      putInt("servicePid", Process.myPid())
      putString("diagnosticCode", code)
      putString("diagnosticMessage", message)
    })
    // Stay alive until the host has observed both main and :probe PIDs with
    // adb shell ps. Harness cleanup force-stops the package after the proof.
    return START_NOT_STICKY
  }

  private fun typedCode(error: Throwable): String? {
    val getter = error.javaClass.methods.firstOrNull {
      it.parameterCount == 0 && (it.name == "getCode" || it.name == "code")
    } ?: return null
    return getter.invoke(error) as? String
  }
}
