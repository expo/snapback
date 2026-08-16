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
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
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
  data class TestCorruptedCiphertext(val record: String, val revision: Long) : CustodyState
}

private class CasConflict(val expected: Long?, val actual: Long?) : Exception()
private class StoredCorruption(val detail: String) : Exception()
private data class CustodyKey(val key: SecretKey, val generation: Long)

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
  private var generation = 0L

  private fun existingKeyLocked(): CustodyKey? {
    val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
    if (!keyStore.containsAlias(KEY_ALIAS)) return null
    return (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let {
      CustodyKey(it, generation)
    }
  }

  fun existingKey(): CustodyKey? = synchronized(lock) { existingKeyLocked() }

  fun getOrCreateKey(): CustodyKey = synchronized(lock) {
    existingKeyLocked() ?: KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES,
      KEYSTORE_PROVIDER
    ).run {
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
      val key = generateKey()
      generation = Math.addExact(generation, 1L)
      CustodyKey(key, generation)
    }
  }

  fun retirePermanentlyInvalidatedAlias(usedGeneration: Long): Boolean = synchronized(lock) {
    if (usedGeneration != generation) return@synchronized false
    val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
    if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
    true
  }

  fun isCurrent(usedGeneration: Long): Boolean = synchronized(lock) {
    usedGeneration == generation
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
      val iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)
      val ciphertext = Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP)
      if (iv.size != 12 || ciphertext.isEmpty()) {
        return CustodyState.Corrupt("custody AES-GCM envelope has invalid byte lengths")
      }
      decrypt(iv, ciphertext)
    } catch (_: AEADBadTagException) {
      CustodyState.Corrupt("custody AES-GCM authentication failed")
    } catch (error: Exception) {
      when {
        error.hasCause<AEADBadTagException>() ->
          CustodyState.Corrupt("custody AES-GCM authentication failed")
        else -> CustodyState.Corrupt(
          "custody envelope could not be decoded: ${error.javaClass.simpleName}"
        )
      }
    }
  }

  override suspend fun writeTo(t: CustodyState, output: OutputStream) {
    val record: String
    val revision: Long
    val corruptCiphertext: Boolean
    when (t) {
      is CustodyState.Present -> {
        record = t.record
        revision = t.revision
        corruptCiphertext = false
      }
      is CustodyState.TestCorruptedCiphertext -> {
        record = t.record
        revision = t.revision
        corruptCiphertext = true
      }
      else -> throw IllegalStateException("DataStore may persist only a present custody record")
    }
    val encrypted = encrypt(record, revision)
    val ciphertext = encrypted.second

    if (corruptCiphertext) {
      ciphertext[ciphertext.lastIndex] = (ciphertext.last().toInt() xor 0x01).toByte()
    }

    val envelope = JSONObject()
      .put("formatVersion", ENVELOPE_FORMAT_VERSION)
      .put("iv", Base64.encodeToString(encrypted.first, Base64.NO_WRAP))
      .put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
    output.write(envelope.toString().toByteArray(Charsets.UTF_8))
  }

  private fun decrypt(iv: ByteArray, ciphertext: ByteArray): CustodyState {
    while (true) {
      val handle = CustodyKeyStore.existingKey()
        ?: return CustodyState.AbsentWithDiagnostic("Android Keystore key alias is missing")
      try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, handle.key, GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(aad)
        val record = cipher.doFinal(ciphertext).toString(Charsets.UTF_8)
        val revision = recordRevision(record)
          ?: return CustodyState.Corrupt("custody payload has no safe positive revision")
        return CustodyState.Present(record, revision)
      } catch (error: Exception) {
        if (!error.hasCause<KeyPermanentlyInvalidatedException>()) throw error
        if (CustodyKeyStore.retirePermanentlyInvalidatedAlias(handle.generation)) {
          return CustodyState.AbsentWithDiagnostic(
            "Android Keystore key was permanently invalidated"
          )
        }
        // Another operation already retired this generation and created its
        // successor. This stale holder must retry with that fresh key rather
        // than deleting the successor alias.
      }
    }
  }

  private fun encrypt(record: String, revision: Long): Pair<ByteArray, ByteArray> {
    while (true) {
      val handle = CustodyKeyStore.getOrCreateKey()
      try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, handle.key, SecureRandom())
        cipher.updateAAD(aad)
        val ciphertext = cipher.doFinal(record.toByteArray(Charsets.UTF_8))

        // Verify the AEAD and revision echo before DataStore atomically
        // publishes the serialized bytes.
        val verifier = Cipher.getInstance("AES/GCM/NoPadding")
        verifier.init(
          Cipher.DECRYPT_MODE,
          handle.key,
          GCMParameterSpec(GCM_TAG_BITS, cipher.iv)
        )
        verifier.updateAAD(aad)
        val verified = verifier.doFinal(ciphertext).toString(Charsets.UTF_8)
        if (verified != record || recordRevision(verified) != revision) {
          throw IllegalStateException("custody AES-GCM read-verify mismatch")
        }
        if (!CustodyKeyStore.isCurrent(handle.generation)) continue
        return Pair(cipher.iv, ciphertext)
      } catch (error: Exception) {
        if (!error.hasCause<KeyPermanentlyInvalidatedException>()) throw error
        CustodyKeyStore.retirePermanentlyInvalidatedAlias(handle.generation)
        // A current invalidated key was retired, or a stale holder observed a
        // successor. Either way, retry encryption with the current generation.
      }
    }
  }

  private fun recordRevision(record: String): Long? = parseRecordRevision(record)
}

private data class StoreEntry(
  val appId: String,
  val store: DataStore<CustodyState>,
  val job: Job
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
        "carrier" to "android-datastore-keystore",
        "mechanism" to "datastore-keystore-aes-gcm",
        "moduleVersion" to MODULE_VERSION,
        "storageFormatVersion" to ENVELOPE_FORMAT_VERSION
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
          is CustodyState.TestCorruptedCiphertext ->
            corrupt("custody AES-GCM authentication failed")
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
        // @ref LLP 0059#unrecognized-authority-recovery — malformed custody is never an anonymous/fresh recovery arm; only validated settled or clearing records can enter coordinator recovery.
        val entry = storeEntryFor(appId, storageKey)
        val updated = entry.store.updateData { current ->
          val actualRevision = when (current) {
            CustodyState.Absent, is CustodyState.AbsentWithDiagnostic -> null
            is CustodyState.Present -> current.revision
            is CustodyState.Corrupt -> throw StoredCorruption(current.reason)
            is CustodyState.TestCorruptedCiphertext ->
              throw StoredCorruption("custody AES-GCM authentication failed")
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

    AsyncFunction("corruptCiphertext") Coroutine { appId: String, storageKey: String ->
      if (!BuildConfig.DEBUG) {
        return@Coroutine storageFailure("custody corruption test hook requires a debug build")
      }
      singleRuntimeRefusal()?.let { return@Coroutine it }
      if (!validAddress(appId, storageKey)) {
        return@Coroutine storageFailure("invalid native custody address")
      }
      try {
        val entry = storeEntryFor(appId, storageKey)
        val updated = entry.store.updateData { current ->
          when (current) {
            is CustodyState.Present ->
              CustodyState.TestCorruptedCiphertext(current.record, current.revision)
            CustodyState.Absent, is CustodyState.AbsentWithDiagnostic ->
              throw IllegalStateException("custody corruption target is absent")
            is CustodyState.Corrupt -> throw StoredCorruption(current.reason)
            is CustodyState.TestCorruptedCiphertext -> current
          }
        }
        if (updated is CustodyState.TestCorruptedCiphertext) {
          discardStore(storageKey, entry)
          mapOf(
            "status" to "ok",
            "mechanism" to "persisted-aead-byte-flip-datastore-reopen"
          )
        } else {
          storageFailure("custody ciphertext corruption was not persisted")
        }
      } catch (corruption: StoredCorruption) {
        corrupt(corruption.detail)
      } catch (error: Exception) {
        storageFailure("custody ciphertext corruption failed: ${error.javaClass.simpleName}")
      }
    }

    OnDestroy {
      stores.values.forEach { it.job.cancel() }
      stores.clear()
    }
  }

  private fun storeEntryFor(appId: String, storageKey: String): StoreEntry {
    val entry = stores.compute(storageKey) { _, existing ->
      if (existing != null) {
        if (existing.appId != appId) {
          throw IllegalStateException("custody storage key was reused for a different app")
        }
        existing
      } else {
        val applicationContext = reactContext.applicationContext
        val storeJob = SupervisorJob()
        val storeScope = CoroutineScope(storeJob + Dispatchers.IO)
        StoreEntry(
          appId,
          // @ref LLP 0263#24-android-verdict — v1 deliberately uses exactly one single-process DataStore instance per JS-derived owner storage key.
          DataStoreFactory.create(
            serializer = CustodySerializer(appId, storageKey),
            scope = storeScope,
            produceFile = {
              val directory = File(applicationContext.filesDir, CUSTODY_DIRECTORY)
              if (!directory.exists() && !directory.mkdirs()) {
                throw IllegalStateException("could not create custody DataStore directory")
              }
              File(directory, "$storageKey.custody")
            }
          ),
          storeJob
        )
      }
    }
    return checkNotNull(entry)
  }

  private fun storeFor(appId: String, storageKey: String): DataStore<CustodyState> =
    storeEntryFor(appId, storageKey).store

  private suspend fun discardStore(storageKey: String, entry: StoreEntry) {
    if (!stores.remove(storageKey, entry)) {
      throw IllegalStateException("custody DataStore changed during test-hook recreation")
    }
    // updateData has durably published the serializer's byte-flipped envelope.
    // Cancelling this per-key instance drops its decoded cache; the next read
    // constructs a new DataStore and must traverse AES-GCM decryption.
    entry.job.cancelAndJoin()
  }

  private fun singleRuntimeRefusal(): Map<String, Any?>? {
    return androidSingleRuntimeRefusal(reactContext.applicationContext)
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

private fun resolveAndroidProcessName(context: Context): String? {
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
    val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    manager?.runningAppProcesses
      ?.firstOrNull { it.pid == Process.myPid() }
      ?.processName
      ?.takeIf { it.isNotBlank() }
  } catch (_: RuntimeException) {
    null
  }
}

private fun androidSingleRuntimeRefusal(context: Context): Map<String, Any?>? {
  val processName = resolveAndroidProcessName(context.applicationContext)
    ?: return mapOf(
      "status" to "single-runtime-refused",
      "code" to "SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED",
      "reason" to "process-identity-unresolved",
      "platform" to "android",
      "process" to null
    )
  if (processName == context.packageName) return null
  return mapOf(
    "status" to "single-runtime-refused",
    "code" to "SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED",
    "reason" to "secondary-process",
    "platform" to "android",
    "process" to processName
  )
}

private fun attemptGuardedCustodyProbeRead(context: Context): Map<String, Any?> {
  androidSingleRuntimeRefusal(context)?.let { refusal ->
    return mapOf(
      "code" to refusal["code"],
      "reason" to refusal["reason"],
      "ioOccurred" to false
    )
  }
  val directory = File(context.applicationContext.filesDir, CUSTODY_DIRECTORY)
  try {
    directory.listFiles()?.sortedBy { it.name }?.firstOrNull()
      ?.inputStream()?.use { it.read() }
  } catch (_: Exception) {
    // The attempt itself is the guard witness; bytes and errors are never returned.
  }
  return mapOf(
    "code" to "SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_IO_OCCURRED",
    "reason" to "process-gate-admitted-read",
    "ioOccurred" to true
  )
}

class NativeCustodyProbeException(
  val code: String,
  message: String
) : IllegalStateException(message)

object NativeCustodyProbeHooks {
  /** Debug-only entry through the same pre-I/O process gate as module reads. */
  @JvmStatic
  fun attemptSecondaryProcessIo(context: Context): Map<String, Any?> {
    if (!BuildConfig.DEBUG) {
      throw NativeCustodyProbeException(
        "SNAPBACK_AUTH_CUSTODY_TEST_HOOK_UNAVAILABLE",
        "native custody secondary-process probe requires a debug build"
      )
    }
    androidSingleRuntimeRefusal(context)
      ?: throw NativeCustodyProbeException(
        "SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_NOT_DETECTED",
        "secondary-process custody probe resolved the application main runtime"
      )
    // Observe the refusal, then independently attempt the real file-read arm
    // through the same production gate. A gate regression reports that I/O
    // occurred instead of letting a process-name assertion mask success.
    return attemptGuardedCustodyProbeRead(context)
  }
}
