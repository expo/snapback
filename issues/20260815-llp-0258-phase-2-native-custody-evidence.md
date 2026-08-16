# LLP 0258 Phase 2: qualify native auth custody per OS

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 2
**Confidence:** 4
**Systems:** Auth, Custody, React/Expo, iOS, Android, Capability honesty
**Date:** 2026-08-15
**Governing:** LLP 0258 D3 and Phase 2; LLP 0059 durable client store;
LLP 0064 per-platform capability honesty
**Starting points:** `75da1f28a` (SecureStore adapter), `0477fda40` (full
owner-key addressing), `b186296fd` (ordinary Expo path with native
`durable-required` refusal)

## Problem

The SecureStore adapter exists and addresses records by the full LLP 0258
owner key, but its source/unit evidence is not an iOS or Android durability
grade. The ordinary Expo path therefore still refuses `durable-required` on
native. An in-process serialization queue and read/validate/write CAS test do
not establish OS crash atomicity, background or multi-process fencing, or
kill/relaunch restoration.

## Required per-OS probes

Run and retain separate evidence for each supported OS/package/SDK tuple:

1. **iOS kill/relaunch.** Sign in through the ordinary first-party provider,
   settle the principal and custody record, terminate the process without a
   graceful coordinator close, relaunch, and restore the same settled
   principal and exact custody revision/epoch without credential issuance.
   Record Keychain/SecureStore protection behavior and the carrier's behavior
   across device lock where the claimed grade depends on it.
2. **Android force-stop/relaunch.** Repeat the same journey using force-stop
   and cold relaunch. Record Keystore/SecureStore behavior and prove the
   restored authority came from the existing custody record rather than a
   supervisor remint or fresh password exchange.
3. **Fencing.** Exercise overlapping adapter/coordinator instances, stale
   expected revisions, and interruption at each read/replace boundary. Prove
   whole-record replacement preserves the bearer, revision, epoch, and phase
   atomically enough for the claimed LLP 0258 D3 grade. Hash or redact bearer
   material in every receipt.
4. **Background and multi-process posture.** Probe background tasks, Android
   headless/secondary processes, and iOS extension/background access where
   applicable. If cross-process fencing is not independently proved, declare
   the platform `single-runtime` and prove background, extension, and
   multi-process entry refuse with the typed diagnostic before custody I/O.

If the current SecureStore adapter cannot meet even the single-runtime grade,
harden or replace it with the first-party native custody module LLP 0258 D3
requires. Do not reinterpret process-local unit tests as platform evidence and
do not fall back to memory.

## Capability flip and exit

- Store one evidence bundle per OS, naming OS/SDK/package versions, process
  controls, expected and observed public custody facts, fencing cases, and
  negative leakage scans.
- Admit the qualifying adapter through `createSnapbackAppClient`/
  `SnapbackExpoProvider` only on the OS whose evidence passed.
- Flip `auth.application-bootstrap-native-custody` and the generated target
  capability independently for iOS and Android. One passing OS must not change
  the other row.
- Update the intent guide and capability index with the exact grade,
  single-runtime refusals or stronger fencing claim, and nonclaims. Keep
  sender-constrained custody explicitly out of scope.

