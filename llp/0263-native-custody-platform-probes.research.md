# LLP 0263: Native custody module platform probes

**Type:** Research
**Status:** Active
**Systems:** Auth, Custody, Native clients, Security, Testing, React/Expo
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-08-15
**Revised:** 2026-08-15
**Related:** LLP 0258, LLP 0059, LLP 0064, LLP 0260

Research grounding for LLP 0258 Phase 0 item 1 (the D3 first-party native
custody module probes) and Open Question 1 (per-platform fencing grades).
Compiled from platform documentation and cited engineering sources by a
supervised research agent on 2026-08-15; claims the documentation leaves
ambiguous are tagged "needs empirical probe" and carried in the numbered
probe checklists, which are the Phase 0 execution plan on simulator (S) and
physical device (D). Nothing here flips a capability: per LLP 0258 D3 both
platforms ship the declared single-runtime capability in v1, and any
cross-process grade waits on its probe evidence.


**Scope.** Grounds LLP 0258 D3 (first-party native custody module) and Open
Question 1 (per-platform fencing grade). The module persists ONE serialized
custody record (`AuthCustodyV2`, ~a few KB: bearer + revision/epoch/lease
metadata) per `(appId, storagePartition)` in one OS-secure-storage domain,
with atomic whole-record compare-and-replace (CAS) conditioned on an expected
revision, crash-safe read-verify, and honest per-platform fencing claims.

**Method.** Apple/Android official documentation plus credible engineering
sources (Apple DTS "eskimo" forum answers, TN2408, AndroidX release notes,
LKML). Anything the docs leave ambiguous is flagged **needs empirical probe**.
Sources at the end; claims are annotated `[Sn]`.

---

## 1. iOS recommendation

### 1.1 Keychain has no CAS — and that is the central fact

- `SecItemUpdate`/`SecItemAdd` express unconditional writes. There is **no
  documented conditional-update, transaction, or optimistic-concurrency
  primitive** anywhere in the Keychain Services API [S1][S2].
- Individual SecItem operations **are** atomic and serialized: they are
  performed by the security daemon (`securityd`, SQLite-backed), which
  "guarantees serialisation regardless of the originating process" (Quinn,
  Apple DTS) [S2]. So a single `SecItemUpdate` is effectively
  whole-item-atomic and last-writer-wins.
- Quinn explicitly warns that daemon serialization "does not prevent all
  synchronization issues": a read-modify-write sequence from two processes
  (app + extension) is "hopelessly broken if you run two instances
  simultaneously" [S2]. **Keychain alone therefore cannot prove
  cross-process CAS.** CAS must be synthesized by wrapping
  read → compare-revision → write in a mutual-exclusion region that spans
  all writers.
- Within one process, a native serial queue around
  `SecItemCopyMatching` → compare → `SecItemUpdate` yields a correct
  single-runtime CAS, because the item-level write is atomic and no other
  writer exists by declaration.

**Accessibility / backup attributes** (all documented):

- `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: readable while the
  device is locked after the first post-boot unlock (required for background
  refresh paths), **never migrates to a different device** — absent after
  restoring a backup onto new hardware [S3]. This is the right class for a
  bearer: available to background runtime, not cloneable to another device.
- `kSecAttrSynchronizable = false` (default) keeps the item out of iCloud
  Keychain sync [S4].
- Known quirk: forum reports indicate ThisDeviceOnly items **may survive
  direct device-to-device (wired/proximity) migration** even though they are
  dropped on backup-restore [S5]. Apple's docs do not clearly specify D2D
  behavior → **needs empirical probe** (probe I-10).
- Keychain items persist across app uninstall/reinstall (documented by Expo,
  widely observed) [S6]. Read-verify must treat a leftover record from a
  previous install as valid-or-rejectable data, not corruption.

### 1.2 Evaluated composition: file + Keychain key + POSIX lock

For a future **cross-process** grade (main app + extension via app group):

- **Record file**: ciphertext in the app-group container, AES-GCM key in the
  Keychain (`AfterFirstUnlockThisDeviceOnly`, non-synchronizable). File
  protection `NSFileProtectionCompleteUntilFirstUserAuthentication` to match
  the key's availability window; `Complete` would make background access
  fail while locked.
- **Atomic replace**: write temp file in same volume/directory → `fsync` →
  rename over the original (`Data.write(.atomic)` or
  `FileManager.replaceItemAt`, which is documented as the no-data-loss safe
  replace and requires same-volume URLs) [S7][S8].
- **Cross-process mutual exclusion**: Apple's TN2408 is the authoritative
  statement. It obliges coordinated writes to shared containers, warns that
  `NSFileCoordinator` deadlocked app↔extension coordination on iOS ≤ 8.1.x
  (fixed in 8.2, but the structural hazard remains: a *suspended* process
  holding a coordination claim stalls the peer until the system kills the
  holder), and states that **"Posix file locks also work"** — `open(...,
  O_EXLOCK)` / `flock()` behave like SQLite DELETE-journal locking in shared
  containers [S9][S10]. Kernel-held `flock` is released automatically when
  the holding process dies, so a kill-9'd writer cannot wedge the lock.
- Residual hazard even with flock: iOS suspends (not kills) backgrounded
  processes at arbitrary points. A writer suspended *inside* the critical
  section blocks the other process until the system reclaims it. The window
  can be made tiny (lock → read → compare → rename → unlock, no awaits), and
  `beginBackgroundTask` can shield the section, but Apple documents no hard
  guarantee → the cross-process claim is **provable only empirically**
  (probes I-6..I-9).

### 1.3 Simulator fidelity

The iOS simulator implements the Keychain **API** but not the security
architecture: no Secure Enclave, no hardware-backed metadata key, no real
data-protection enforcement (there is no passcode-derived key hierarchy), and
biometrics are simulated [S11][S12]. The simulator proves API-shape,
serialization behavior, and file-path atomicity on the host filesystem
(APFS — same family as device). It does **not** prove lock-state access
classes, protection-class enforcement, backup/migration behavior, or
performance of `securityd` under contention.

### 1.4 iOS verdict

**Ship v1 as Keychain-only, single-runtime.** One `kSecClassGenericPassword`
item per owner key (service = canonical app id, account = storage partition),
`AfterFirstUnlockThisDeviceOnly`, non-synchronizable, whole-record serialized
blob (a few KB is comfortably within keychain practice on iOS). CAS = native
serial queue doing read → revision compare → `SecItemUpdate`; every write
followed by read-verify (envelope checksum + revision echo). Declare
**single-runtime capability**: extension/multi-process use refuses with the
typed diagnostic per D3. The file+flock composition is the designed upgrade
path to a cross-process grade, gated on device probes I-6..I-9 — do not claim
it from documentation alone.

---

## 2. Android recommendation

### 2.1 Storage primitive selection

- **Do not build on Jetpack security-crypto.** `EncryptedSharedPreferences`
  and `EncryptedFile` were deprecated (androidx.security:security-crypto
  1.1.0-alpha07, April 2025) with **no drop-in official replacement**;
  Google's articulated direction is DataStore for persistence + Tink (or
  direct JCA) for encryption + Android Keystore for key protection
  [S13][S14].
- **`expo-secure-store` is disqualified as the record store** on Android
  independently of D3's transactionality argument: it stores values in
  SharedPreferences encrypted with a Keystore key and documents a **2048-byte
  value limit** [S6] — the serialized custody record can exceed that, and
  SharedPreferences offers no cross-process or CAS semantics
  (`MODE_MULTI_PROCESS` deprecated in API 23 as unreliable) [S15].
- **Recommended primitive: androidx DataStore with a custom serializer**
  holding the AES-GCM-encrypted record, key in Android Keystore.
  `updateData` is documented as a **transactional, atomic
  read-modify-write**: the whole block is a single transaction with ACID
  guarantees [S16]. Revision-conditioned CAS is expressed directly inside
  `updateData { current -> if (current.revision != expected) throw
  CasConflict else new }` — this is a *real* transactional CAS, not a
  synthesized one.
- **Cross-process**: `MultiProcessDataStoreFactory.create` produces a
  DataStore whose data consistency "is guaranteed among DataStore instances
  across processes"; single-process and multi-process instances must never be
  mixed on one file [S17]. This is the strongest documented cross-process
  primitive available. It is a library guarantee (file-lock + versioned
  shared-memory under the hood), not an OS guarantee → grade it
  cross-process **only after** probe A-6/A-7 passes on device.
  Fallback/alternative: own file + `java.nio.channels.FileLock` (advisory,
  kernel-mediated; reliable among cooperating processes of the same app)
  [S18]; `ContentProvider` single-owner serialization is the heavier
  classical answer [S15] and is not needed if MultiProcessDataStore holds.
- **Atomic replace**: DataStore internally does write-temp → fsync → rename.
  If we hand-roll instead, note `android.util.AtomicFile` explicitly "does
  not confer any file locking semantics" and must not be used with concurrent
  writers [S19]; on ext4 and f2fs a same-directory `rename()` is atomic, but
  durability ordering requires fsync of the temp file before rename (f2fs
  historically needed `fsync_mode=strict` for strict rename durability —
  worth a torn-write probe on a physical f2fs device) [S20].

### 2.2 Key material and backup rules

- Android Keystore keys are **non-exportable and hardware-bound**: they never
  appear in any backup and cannot move device-to-device [S21].
- Consequence (well-documented failure mode): if the *ciphertext* is backed
  up but the key is not, restore produces undecryptable data — "you will
  never be able to decrypt it when using Android Keystore keys with auto
  backup enabled" [S21][S22]. Auto Backup is on by default.
- Therefore **exclude the record from backup and transfer explicitly**:
  `android:dataExtractionRules` with `<exclude>` under both `<cloud-backup>`
  and `<device-transfer>` (API 31+), plus legacy `android:fullBackupContent`
  rules for API ≤ 30 [S23][S24]. Note the documented trap: on API 31+,
  `allowBackup="false"` alone does not necessarily disable device-to-device
  transfer on all OEMs — the extraction rules are the reliable lever [S23].
- Read-verify must still treat "restored ciphertext, missing key" as a
  **typed custody-absent outcome** (AEAD tag failure → fresh-start), never a
  wedge — OEM backup agents do not always honor rules perfectly (probe A-9).

### 2.3 Emulator fidelity

The emulator's `/data` is an ext4 (or f2fs on newer images) filesystem image,
so file-atomicity and kill-mid-write behavior have good fidelity. The
emulator provides a software Keystore (no StrongBox, no hardware attestation)
and Google-image backup transport can simulate backup/restore (`bmgr`).
It does not prove: StrongBox/TEE behavior, OEM force-stop and OEM backup-agent
deviations, real D2D migration.

### 2.4 Android verdict

**Ship v1 on custom-serializer DataStore + Keystore-wrapped AES-GCM,
single-process instance, declared single-runtime capability.** The
`updateData` transaction gives an honestly documented CAS today. Keep the
record file and its prefs excluded from cloud-backup and device-transfer.
Flip to `MultiProcessDataStoreFactory` for the cross-process grade only after
probes A-6/A-7 demonstrate revision-conflict interleaving is actually fenced
on device; widget/service processes refuse with the typed diagnostic until
then.

---

## 3. Provable-claims table (what grade D3 can declare)

| Platform / mechanism | CAS mechanism | Fencing grade D3 can declare now | Basis | Upgrade path |
| --- | --- | --- | --- | --- |
| iOS — Keychain-only (v1) | in-module serial queue around read→compare→`SecItemUpdate`; item write atomic via securityd | **single-runtime** (declared; extension/multi-process refuses) | Apple DTS: item ops serialized, RMW across processes explicitly unsafe [S2] | file+flock composition below |
| iOS — app-group file + Keychain key + `flock`/`O_EXLOCK` | POSIX lock critical section + temp-fsync-rename | **cross-process candidate — needs empirical probe** (suspension-in-critical-section hazard; TN2408 endorses POSIX locks but gives no liveness guarantee) [S9][S10] | probes I-6..I-9 on physical device | declare cross-process only on probe evidence |
| Android — DataStore (single-process) + Keystore AES-GCM (v1) | `updateData` transactional RMW (documented ACID) [S16] | **single-runtime** (declared) | official DataStore docs | MultiProcessDataStore below |
| Android — MultiProcessDataStore | same `updateData`, cross-process consistency documented [S17] | **cross-process candidate — needs empirical probe** (library guarantee, not OS guarantee) | probes A-6/A-7 on device | declare cross-process on probe evidence |
| Android — hand-rolled file + `FileLock` | advisory kernel lock + temp-fsync-rename | fallback only; same probe obligations; `AtomicFile` alone is disqualified (no locking) [S19] | probes A-6/A-7 | — |

In D3 terms: **no platform declares cross-process fencing from documentation
alone.** Both v1 grades are single-runtime; both platforms have a designed,
probe-gated path to cross-process.

---

## 4. Crash-safety analysis of the recommended write paths

**iOS Keychain path.** A single `SecItemUpdate` executes in `securityd`
against SQLite; the writer process dying mid-call leaves the daemon
transaction to complete or roll back — the item should be old-value or
new-value, never torn. Apple does not *document* this atomicity contract
explicitly, so it is verified by probe I-1/I-2, not assumed. Read-verify:
every write is followed by a read of the item; the envelope carries a
checksum + the revision; a mismatch is a typed corruption diagnostic, and an
unparseable/failed-checksum record is custody-absent-with-diagnostic, never a
silent fresh start.

**File paths (both platforms).** write temp (same directory) → `fsync(fd)` →
`rename`/`replaceItemAt` → (Android hand-rolled: fsync parent dir). Same-
volume rename is atomic on APFS/ext4/f2fs; the torn state after a crash is
"temp file exists, original intact", which cleanup ignores. The known
ambiguity is *durability ordering* on f2fs without strict fsync mode
(rename may become visible before the temp's data blocks) [S20] — the AEAD
tag makes any torn/reordered content detectable at read (auth failure →
typed corruption), which is the honest floor; probe A-2 measures whether it
ever occurs in practice.

**Android Keystore key loss** (OS-initiated, e.g. lock-screen credential
changes on some versions, or restore-without-key): surfaces as
`AEADBadTagException`/`KeyPermanentlyInvalidatedException` → typed
custody-absent, never a wedge.

---

## 5. Probe checklists

Each probe states what it proves; (S) = meaningful on simulator/emulator,
(D) = requires physical device for full evidentiary weight.

### iOS

1. **(S,D) CAS happy path + revision conflict, single process.** Interleave
   two in-process writers through the module; assert exactly one wins per
   revision, loser gets typed conflict.
2. **(S,D) kill -9 mid-`SecItemUpdate` loop.** Tight update loop; harness
   SIGKILLs the app at random offsets; on relaunch the record parses and is
   exactly old-or-new revision N or N+1 — never torn. (Simulator result is
   indicative; device confirms real securityd.)
3. **(S,D) kill -9 mid file-replace** (composition path): assert
   old-or-new + orphan-temp cleanup + read-verify passes.
4. **(D) Lock-state access:** with `AfterFirstUnlockThisDeviceOnly`, verify
   read succeeds while device locked (post-first-unlock) e.g. from a BG task,
   and fails before first unlock after reboot (attach via console/logs).
   Simulator cannot prove this.
5. **(S,D) Uninstall→reinstall:** leftover keychain record from prior install
   is either validly adopted or rejected with a typed diagnostic — never
   treated as corruption crash.
6. **(D) Cross-process interleaving (composition):** main app + share/notification
   extension in one app group both attempt CAS on the same record via
   `flock`; N-thousand-iteration interleave, assert strict revision
   monotonicity, no lost update.
7. **(D) Writer killed inside critical section:** SIGKILL the extension while
   it holds `flock`; assert the kernel released the lock and the main app
   proceeds (no permanent wedge).
8. **(D) Writer *suspended* inside critical section:** background the app
   mid-section; measure how long the extension blocks and whether the system
   reclaims; this is the probe that decides the cross-process grade's honesty.
9. **(D) NSFileProtection window:** with `CompleteUntilFirstUserAuthentication`,
   confirm file readable while locked post-first-unlock; with `Complete`,
   confirm background read fails (negative control).
10. **(D,D) Backup-restore + D2D migration pair:** encrypted backup of device
    A restored to device B → ThisDeviceOnly record absent → module reports
    typed custody-absent (not corruption). Separately, direct device-to-device
    migration A→B: record may survive [S5]; decide and document the intended
    semantic (probe answers what the OS does).

### Android

1. **(S,D) CAS happy path + revision conflict, single process** (same as iOS-1)
   through `updateData`.
2. **(S,D) kill -9 (`Process.killProcess` / `adb shell kill -9`) mid-write
   loop:** relaunch, assert old-or-new revision, AEAD verifies, no torn read.
   Run on ext4 emulator image and on a physical f2fs device (durability-
   ordering question [S20]).
3. **(S,D) `adb shell am force-stop` mid-write:** same assertions (force-stop
   kills all app processes; distinct code path from kill -9).
4. **(S,D) Keystore key AEAD failure injection:** corrupt ciphertext /
   delete key alias; assert typed custody-absent diagnostic, no wedge, no
   silent fresh start without diagnostic.
5. **(S,D) Lock-state access:** read/write custody while device locked
   (screen off, keyguard) from a foreground service; Keystore key created
   with `setUserAuthenticationRequired(false)` must work; negative control
   with `true`.
6. **(D) Cross-process interleaving:** second process (`android:process`
   service or widget) + main process both CAS via `MultiProcessDataStore`;
   N-thousand interleave, strict revision monotonicity, no lost update.
7. **(D) Cross-process writer killed mid-transaction:** kill -9 the second
   process inside `updateData`; assert main process is not wedged and data
   is old-or-new.
8. **(S,D) Single/multi-process mixing negative test:** confirm the module
   cannot construct a single-process instance while a multi-process user
   exists (guard against the documented undefined mixing [S17]).
9. **(D) Backup-restore:** `bmgr backupnow` + reinstall (emulator) and a real
   Google-Drive restore to a second physical device: with extraction rules,
   record absent → typed custody-absent; without rules (control), restored
   ciphertext + missing key → same typed outcome, never a crash loop [S21][S22][S23].
10. **(D) D2D transfer:** cable/OEM migration between two physical devices;
    assert `<device-transfer>` exclusion held and outcome is typed
    custody-absent.

---

## 6. Open risks / ambiguities (explicit)

- **iOS securityd write atomicity under SIGKILL** is undocumented (inferred
  from SQLite + daemon serialization) — probe I-2 carries the claim.
- **iOS suspended-writer liveness** in the flock composition has no
  documented bound — probe I-8 decides whether cross-process is ever honestly
  declarable on iOS.
- **ThisDeviceOnly + direct D2D migration** behavior is contradictory in the
  field [S5] — needs probe I-10.
- **MultiProcessDataStore** is a library guarantee with a history of being
  the *replacement* for two prior deprecated mechanisms — probe A-6/A-7
  before any cross-process claim.
- **f2fs rename durability ordering** without strict fsync mode [S20] —
  AEAD read-verify bounds the damage to a typed corruption; probe A-2 on a
  physical f2fs device measures incidence.
- **security-crypto deprecation** means any dependency on
  EncryptedSharedPreferences (including transitively via expo-secure-store's
  Android arm) is legacy surface; the module must own its crypto (Keystore +
  AES-GCM directly or Tink) [S13][S14].

---

## Sources

- [S1] Apple — SecItemUpdate / Keychain Services reference:
  https://developer.apple.com/documentation/security/secitemupdate(_:_:)
- [S2] Apple Developer Forums (Quinn "The Eskimo!", Apple DTS) — "Writing to
  shared keychain concurrently": serialization by the security daemon, RMW
  across processes unsafe: https://developer.apple.com/forums/thread/108451 ;
  see also "SecItem: Fundamentals": https://developer.apple.com/forums/thread/724023
- [S3] Apple — kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly (no
  migration to a new device):
  https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly
- [S4] Apple — kSecAttrSynchronizable / iCloud Keychain behavior; Elcomsoft
  analysis of keychain backup classes:
  https://blog.elcomsoft.com/2020/08/extracting-and-decrypting-ios-keychain-physical-logical-and-cloud-options-explored/
- [S5] Apple Developer Forums — ThisDeviceOnly items preserved on direct
  device-to-device migration: https://developer.apple.com/forums/thread/802526
- [S6] Expo — SecureStore documentation (iOS kSecClassGenericPassword;
  Android SharedPreferences + Keystore; 2048-byte Android limit; keychain
  persists across uninstall): https://docs.expo.dev/versions/latest/sdk/securestore/
- [S7] Apple — FileManager.replaceItemAt (safe-save, no-data-loss replace,
  same-volume requirement):
  https://developer.apple.com/documentation/foundation/filemanager/2293212-replaceitemat
- [S8] Apple — NSData write(toFile:atomically:):
  https://developer.apple.com/documentation/foundation/nsdata/1408033-write
- [S9] Apple — Technical Note TN2408, "Accessing Shared Data from an App
  Extension and its Containing App" (coordination obligation; NSFileCoordinator
  hazard; "Posix file locks also work"):
  https://developer.apple.com/library/archive/technotes/tn2408/_index.html
- [S10] openradar 19103850 — NSFileCoordinator not safe for app extensions
  (history + fix in 8.2): http://www.openradar.me/19103850 ; discussion:
  https://mjtsai.com/blog/2014/11/21/ios-ipc-via-nsfilecoordinator-and-nsfilepresenter/
- [S11] Apple Developer Forums — simulator keychain vs device (no Secure
  Enclave; simulator does not replicate the security architecture):
  https://developer.apple.com/forums/thread/716730
- [S12] Atelier Socle — Keychain & Security Framework guide (simulator
  limitations): https://www.atelier-socle.com/en/articles/keychain-security-framework-guide
- [S13] AndroidX Security release notes — security-crypto deprecation
  (1.1.0-alpha07): https://developer.android.com/jetpack/androidx/releases/security
- [S14] ProAndroidDev — "Navigating the Deprecation of Encrypted Shared
  Preferences" (Google direction: DataStore + Tink + Keystore):
  https://proandroiddev.com/securing-the-future-navigating-the-deprecation-of-encrypted-shared-preferences-91ce3c20ae8d
- [S15] Android — SharedPreferences MODE_MULTI_PROCESS deprecation (API 23,
  unreliable, no reconciliation; ContentProvider recommended):
  https://developer.android.com/reference/android/content/Context#MODE_MULTI_PROCESS
- [S16] Android — DataStore architecture guide (updateData transactional,
  atomic read-write-modify, ACID):
  https://developer.android.com/topic/libraries/architecture/datastore
- [S17] Android — MultiProcessDataStoreFactory (cross-process consistency
  guarantee; never mix single/multi on one file):
  https://developer.android.com/reference/kotlin/androidx/datastore/core/MultiProcessDataStoreFactory
- [S18] Java/Android — java.nio.channels.FileLock (advisory, JVM-wide,
  platform-dependent):
  https://developer.android.com/reference/java/nio/channels/FileLock
- [S19] Android — AtomicFile ("does not confer any file locking semantics";
  backup-file pattern with fsync):
  https://developer.android.com/reference/android/util/AtomicFile
- [S20] LKML — f2fs fsync_mode=strict for rename durability; ext4 rename
  heuristics discussion:
  https://lkml.iu.edu/hypermail/linux/kernel/1804.3/01360.html
- [S21] The Code Side — "Android Auto Backup + Keystore Encryption = Broken
  Heart Love Story" (non-exportable keys + default backup = undecryptable
  restore): https://www.thecodeside.com/2020/09/14/android-auto-backup-keystore-encryption-broken-heart-love-story/
- [S22] Signal-Android issue #10751 — restore fails when secrets live in the
  old device's Keystore: https://github.com/signalapp/Signal-Android/issues/10751
- [S23] Android — Auto Backup / dataExtractionRules (cloud-backup vs
  device-transfer; API 31 allowBackup caveat):
  https://developer.android.com/identity/data/autobackup
- [S24] Android — backup security recommendations:
  https://developer.android.com/privacy-and-security/risks/backup-best-practices
