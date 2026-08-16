package dev.snapback.custodyprobes

import android.app.ActivityManager
import android.app.Application
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Process
import android.os.ResultReceiver
import java.io.File

class CustodyProbeService : Service() {
  companion object {
    const val RESULT_RECEIVER = "dev.snapback.custodyprobes.RESULT_RECEIVER"
    private const val LANE_A_HOOK = "expo.modules.snapbackcustody.NativeCustodyProbeHooks"
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    @Suppress("DEPRECATION")
    val receiver = intent?.getParcelableExtra<ResultReceiver>(RESULT_RECEIVER)
    val processName = resolveProcessName()
    var attempted = false
    var ioOccurred = false
    var reason: String? = null
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
        is Map<*, *> -> {
          ioOccurred = observed["ioOccurred"] as? Boolean ?: false
          reason = observed["reason"] as? String
          observed["code"] as? String
            ?: "SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_UNTYPED_RESULT"
        }
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
      putBoolean("ioOccurred", ioOccurred)
      putString("processName", processName)
      putInt("servicePid", Process.myPid())
      putString("diagnosticCode", code)
      putString("diagnosticMessage", message)
      putString("diagnosticReason", reason)
    })
    // Stay alive until the host has observed both main and :probe PIDs with
    // adb shell ps. Harness cleanup force-stops the package after the proof.
    return START_NOT_STICKY
  }

  private fun resolveProcessName(): String? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        Application.getProcessName()?.takeIf { it.isNotBlank() }?.let { return it }
      } catch (_: RuntimeException) {
        // Fall through to procfs/OEM-compatible discovery.
      }
    }
    try {
      val raw = File("/proc/self/cmdline").readBytes()
      val end = raw.indexOf(0).let { if (it < 0) raw.size else it }
      raw.copyOfRange(0, end).toString(Charsets.UTF_8)
        .trim()
        .takeIf { it.isNotEmpty() }
        ?.let { return it }
    } catch (_: Exception) {
      // ActivityManager is the final compatibility fallback below.
    }
    return try {
      val manager = getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      manager?.runningAppProcesses
        ?.firstOrNull { it.pid == Process.myPid() }
        ?.processName
        ?.takeIf { it.isNotBlank() }
    } catch (_: RuntimeException) {
      null
    }
  }

  private fun typedCode(error: Throwable): String? {
    val getter = error.javaClass.methods.firstOrNull {
      it.parameterCount == 0 && (it.name == "getCode" || it.name == "code")
    } ?: return null
    return getter.invoke(error) as? String
  }
}
