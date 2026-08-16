package expo.modules.snapbackcustody

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Process
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.core.DataStore
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.Serializer
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.security.KeyStore
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import org.json.JSONObject

private const val MODULE_VERSION = "0.1.0"
private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
private const val KEY_ALIAS = "snapback.auth-custody.aes-gcm.v1"
private const val CUSTODY_DIRECTORY = "snapback-auth-custody"
private const val ENVELOPE_FORMAT_VERSION = 1
private const val GCM_TAG_BITS = 128
private const val JS_MAX_SAFE_INTEGER = 9_007_199_254_740_991L
private val STORAGE_KEY = Regex("^snapback\\.auth-custody\\.(partition\\.)?[0-9a-f]{64}$")

private sealed interface CustodyState {
  data object Absent : CustodyState
  data class AbsentWithDiagnostic(val reason: String) : CustodyState
  data class Present(val record: String, val revision: Long) : CustodyState
  data class Corrupt(val reason: String) : CustodyState
}

private class CasConflict(val expected: Long?, val actual: Long?) : Exception()
private class StoredCorruption(val detail: String) : Exception()

private inline fun <reified T : Throwable> Throwable.hasCause(): Boolean {
  var current: Throwable? = this
  while (current != null) {
    if (current is T) return true
    current = current.cause
  }
  return false
}

private object CustodyKeyStore {
  private val lock = Any()

  fun existingKey(): SecretKey? = synchronized(lock) {
    val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
    if (!keyStore.containsAlias(KEY_ALIAS)) return@synchronized null
    keyStore.getKey(KEY_ALIAS, null) as? SecretKey
  }

  fun getOrCreateKey(): SecretKey = synchronized(lock) {
    existingKey() ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER).run {
      init(
        KeyGenParameterSpec.Builder(
          KEY_ALIAS,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setUserAuthenticationRequired(false)
          .setRandomizedEncryptionRequired(true)
          .build()
      )
      generateKey()
    }
  }
}

private class CustodySerializer(
  appId: String,
  storageKey: String
) : Serializer<CustodyState> {
  override val defaultValue: CustodyState = CustodyState.Absent
  private val aad = "snapback.auth-custody.aad.v1\n$appId\n$storageKey".toByteArray(Charsets.UTF_8)

  override suspend fun readFrom(input: InputStream): CustodyState {
    val bytes = input.readBytes()
    if (bytes.isEmpty()) return CustodyState.Corrupt("custody DataStore file is empty")

    return try {
      val envelope = JSONObject(bytes.toString(Charsets.UTF_8))
      val keys = envelope.keys().asSequence().toSet()
      if (keys != setOf("formatVersion", "iv", "ciphertext")) {
        return CustodyState.Corrupt("custody envelope has missing or unknown fields")
      }
      if (envelope.getInt("formatVersion") != ENVELOPE_FORMAT_VERSION) {
        return CustodyState.Corrupt("custody envelope format version is unsupported")
      }
      val key = CustodyKeyStore.existingKey()
        ?: return CustodyState.AbsentWithDiagnostic("Android Keystore key alias is missing")
      val iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)
      val ciphertext = Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP)
      if (iv.size != 12 || ciphertext.isEmpty()) {
        return CustodyState.Corrupt("custody AES-GCM envelope has invalid byte lengths")
      }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
      cipher.updateAAD(aad)
      val record = cipher.doFinal(ciphertext).toString(Charsets.UTF_8)
      val revision = recordRevision(record)
        ?: return CustodyState.Corrupt("custody payload has no safe positive revision")
      CustodyState.Present(record, revision)
    } catch (_: AEADBadTagException) {
      CustodyState.AbsentWithDiagnostic("custody AES-GCM authentication failed")
    } catch (_: KeyPermanentlyInvalidatedException) {
      CustodyState.AbsentWithDiagnostic("Android Keystore key was permanently invalidated")
    } catch (error: Exception) {
      when {
        error.hasCause<AEADBadTagException>() ->
          CustodyState.AbsentWithDiagnostic("custody AES-GCM authentication failed")
        error.hasCause<KeyPermanentlyInvalidatedException>() ->
          CustodyState.AbsentWithDiagnostic("Android Keystore key was permanently invalidated")
        else -> CustodyState.Corrupt(
          "custody envelope could not be decoded: ${error.javaClass.simpleName}"
        )
      }
    }
  }

  override suspend fun writeTo(t: CustodyState, output: OutputStream) {
    val present = t as? CustodyState.Present
      ?: throw IllegalStateException("DataStore may persist only a present custody record")
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, CustodyKeyStore.getOrCreateKey(), SecureRandom())
    cipher.updateAAD(aad)
    val ciphertext = cipher.doFinal(present.record.toByteArray(Charsets.UTF_8))

    // Verify the AEAD and revision echo before DataStore atomically publishes
    // the serialized bytes.
    val verifier = Cipher.getInstance("AES/GCM/NoPadding")
    verifier.init(
      Cipher.DECRYPT_MODE,
      CustodyKeyStore.existingKey() ?: throw IllegalStateException("new custody key disappeared"),
      GCMParameterSpec(GCM_TAG_BITS, cipher.iv)
    )
    verifier.updateAAD(aad)
    val verified = verifier.doFinal(ciphertext).toString(Charsets.UTF_8)
    if (verified != present.record || recordRevision(verified) != present.revision) {
      throw IllegalStateException("custody AES-GCM read-verify mismatch")
    }

    val envelope = JSONObject()
      .put("formatVersion", ENVELOPE_FORMAT_VERSION)
      .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
    output.write(envelope.toString().toByteArray(Charsets.UTF_8))
  }

  private fun recordRevision(record: String): Long? = parseRecordRevision(record)
}

private data class StoreEntry(
  val appId: String,
  val store: DataStore<CustodyState>
)

private fun parseRecordRevision(record: String): Long? {
  return try {
    val raw = JSONObject(record).opt("revision")
    if (raw !is Number) return null
    val value = raw.toLong()
    if (
      value <= 0 || value > JS_MAX_SAFE_INTEGER
      || raw.toDouble() != value.toDouble()
    ) null else value
  } catch (_: Exception) {
    null
  }
}

class SnapbackExpoCustodyModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val stores = ConcurrentHashMap<String, StoreEntry>()

  private val reactContext: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SnapbackExpoCustody")

    AsyncFunction("platformGrade") {
      singleRuntimeRefusal() ?: mapOf(
        "status" to "ok",
        "os" to "android",
        "grade" to "single-runtime",
        "mechanism" to "datastore-keystore-aes-gcm",
        "moduleVersion" to MODULE_VERSION
      )
    }

    AsyncFunction("read") Coroutine { appId: String, storageKey: String ->
      singleRuntimeRefusal()?.let { return@Coroutine it }
      if (!validAddress(appId, storageKey)) {
        return@Coroutine storageFailure("invalid native custody address")
      }
      try {
        when (val current = storeFor(appId, storageKey).data.first()) {
          CustodyState.Absent -> mapOf("status" to "ok", "record" to null)
          is CustodyState.AbsentWithDiagnostic -> mapOf(
            "status" to "absent",
            "code" to "SNAPBACK_AUTH_CUSTODY_CORRUPT",
            "reason" to current.reason
          )
          is CustodyState.Present -> mapOf("status" to "ok", "record" to current.record)
          is CustodyState.Corrupt -> corrupt(current.reason)
        }
      } catch (error: Exception) {
        storageFailure("DataStore read failed: ${error.javaClass.simpleName}")
      }
    }

    AsyncFunction("compareAndReplace") Coroutine {
      appId: String,
      storageKey: String,
      expectedRevision: Long?,
      serializedRecord: String ->
      singleRuntimeRefusal()?.let { return@Coroutine it }
      if (!validAddress(appId, storageKey)) {
        return@Coroutine storageFailure("invalid native custody address")
      }
      val proposedRevision = parseRecordRevision(serializedRecord)
        ?: return@Coroutine corrupt("replacement has no safe positive revision")

      try {
        // @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback — revision comparison and whole-record replacement execute inside DataStore's one native transaction.
        val updated = storeFor(appId, storageKey).updateData { current ->
          val actualRevision = when (current) {
            CustodyState.Absent, is CustodyState.AbsentWithDiagnostic -> null
            is CustodyState.Present -> current.revision
            is CustodyState.Corrupt -> throw StoredCorruption(current.reason)
          }
          if (actualRevision != expectedRevision) {
            throw CasConflict(expectedRevision, actualRevision)
          }
          CustodyState.Present(serializedRecord, proposedRevision)
        }

        // @ref LLP 0263#4-crash-safety-analysis-of-the-recommended-write-paths — DataStore owns atomic publication; serializer AEAD verification and this revision echo close the successful write.
        val verified = storeFor(appId, storageKey).data.first()
        if (
          updated !is CustodyState.Present
          || verified !is CustodyState.Present
          || updated.record != serializedRecord
          || verified.record != serializedRecord
          || verified.revision != proposedRevision
        ) {
          corrupt("DataStore read-verify revision or payload mismatch")
        } else {
          mapOf("status" to "ok", "record" to verified.record)
        }
      } catch (conflict: CasConflict) {
        mapOf(
          "status" to "cas-stale",
          "code" to "SNAPBACK_AUTH_CUSTODY_CAS_STALE",
          "expectedRevision" to conflict.expected,
          "actualRevision" to conflict.actual
        )
      } catch (corruption: StoredCorruption) {
        corrupt(corruption.detail)
      } catch (error: Exception) {
        storageFailure("DataStore write failed: ${error.javaClass.simpleName}")
      }
    }

    OnDestroy {
      stores.clear()
      scope.cancel()
    }
  }

  private fun storeFor(appId: String, storageKey: String): DataStore<CustodyState> {
    val entry = stores.compute(storageKey) { _, existing ->
      if (existing != null) {
        if (existing.appId != appId) {
          throw IllegalStateException("custody storage key was reused for a different app")
        }
        existing
      } else {
        val applicationContext = reactContext.applicationContext
        StoreEntry(
          appId,
          // @ref LLP 0263#24-android-verdict — v1 deliberately uses exactly one single-process DataStore instance per JS-derived owner storage key.
          DataStoreFactory.create(
            serializer = CustodySerializer(appId, storageKey),
            scope = scope,
            produceFile = {
              val directory = File(applicationContext.filesDir, CUSTODY_DIRECTORY)
              if (!directory.exists() && !directory.mkdirs()) {
                throw IllegalStateException("could not create custody DataStore directory")
              }
              File(directory, "$storageKey.custody")
            }
          )
        )
      }
    }
    return checkNotNull(entry).store
  }

  private fun singleRuntimeRefusal(): Map<String, Any?>? {
    val context = reactContext.applicationContext
    val processName = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      Application.getProcessName()
    } else {
      val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      manager?.runningAppProcesses
        ?.firstOrNull { it.pid == Process.myPid() }
        ?.processName
    }
    if (processName == context.packageName) return null
    return mapOf(
      "status" to "single-runtime-refused",
      "code" to "SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED",
      "platform" to "android",
      "process" to processName
    )
  }

  private fun validAddress(appId: String, storageKey: String): Boolean {
    return appId.isNotEmpty() && appId.trim() == appId && STORAGE_KEY.matches(storageKey)
  }

  private fun corrupt(reason: String): Map<String, Any?> = mapOf(
    "status" to "corrupt",
    "code" to "SNAPBACK_AUTH_CUSTODY_CORRUPT",
    "reason" to reason
  )

  private fun storageFailure(reason: String): Map<String, Any?> = mapOf(
    "status" to "storage-error",
    "code" to "SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED",
    "reason" to reason
  )
}
