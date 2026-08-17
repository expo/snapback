# LLP 0258 Phase 2: qualify native auth custody per OS

**Status:** Closed
**Closed:** 2026-08-16
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

## Claim (2026-08-16)

A fresh orchestration session (continuing the 531ce12aa program per its
memory handoff) claimed the Phase 2 build here at b7f01a693.

**Ceded 2026-08-16 ~01:5x** by direct cross-session deconfliction: a
concurrently commissioned orchestrate session (author-commissioned ~01:05
specifically for Phase 2, with a codex implementation lane already running
and a fleet probe host bootstrapped) now owns the ENTIRE native scope —
the D3 module, the LLP 0263 probe host, (S)/(D) probe runs, and per-OS
evidence/flips. Its module lands as a separate package
(`packages/snapback-expo-custody`), consumed through `@expo/snapback-expo`
— the ceding session concurs that layout satisfies LLP 0260's "through
`@expo/snapback-expo`" wording without forcing native code into the
JS-only package. The ceding session stopped its implementation lane before
any files were written (no competing partial work exists) and retains only
`issues/20260816-llp-0258-phase-1-4-real-browser-proofs.md`. Per the fleet
convention all of this yields to landed code.

**Publication posture (author ruling, 2026-08-16):** the Experimental
`@expo/snapback-expo-custody` package joins the qualified 0.1.24 publication
closure; this does not close this ticket or establish either per-OS durable
custody claim.

## Phase 2 close-out record (2026-08-16)

- Committed receipts:
  `demos/native-custody-probes/evidence/20260816T214639Z-0a6c91ed-phase2-android`
  (Android PASS) and
  `demos/native-custody-probes/evidence/20260816T214117Z-dfaa64ff-phase2-ios`
  (iOS PASS with P4 extension refusal explicitly INCOMPLETE).
- Android proved the ordinary provider journey and exact force-stop
  restoration without credential re-entry, 15 jittered kill-mid-write runs
  spanning predecessor and successor restoration, distinct-PID `:probe`
  refusal with `SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED`, real AEAD
  byte-flip corruption refusal, uninstall-clears-data, quiesced ordinary-path
  refusal, and a clean leakage scan. This landing therefore admits Android at
  grade `single-runtime` through the ordinary Expo resolver.
- iOS proved its recorded kill/relaunch, old-or-new write restoration, CAS,
  corruption/reinstall, ordinary-boundary refusal, and leakage arms, but the
  committed v1 app has no extension target. LLP 0258 requires background,
  extension, and multi-process entry refusal for `single-runtime`; iOS remains
  refused and continues in
  `issues/closed/20260816-ios-extension-refusal-probe.md`.
- Claim chain: `b7f01a693` claimed the lane; `676d53befa` recorded its cession
  to the commissioned Phase 2 owner; this record closes the Android flip from
  the committed evidence while preserving the iOS holdout.
- The generated target-capability row is untouched: no codegen home exists
  yet. That remains Phase 3 row-group-4's dependency rather than an invented
  target claim in this lane.

## iOS flip and ticket closure (2026-08-16; receipt 2026-08-17 UTC)

The committed iOS bundle
`demos/native-custody-probes/evidence/20260817T005627Z-7a5041db-phase2-ios`
is an unqualified 43-probe PASS. Its XCUITest-driven Share Extension arm
returned exact `SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED` before custody
I/O (`ioOccurred: false`) from a PID distinct from the main app. The ordinary
Expo resolver now admits the exact iOS + `single-runtime` tuple, completing
the second per-OS source admission beside Android.

The Phase 2 (S)-grade evidence does not claim physical-device (D) lock-state,
real securityd/f2fs kill behavior, backup restore or device migration,
extension/app interleaving, writer kill/suspension, stronger cross-process
fencing, hardware custody, backup continuity, or sender-constrained auth. Only
the iOS share-sheet extension kind was exercised; the built/embedded NSE is
structurally non-invokable via simulator `simctl push`. Publication remains
governed by `issues/20260816-custody-first-publish-gate.md`.

**Ticket disposition:** CLOSED. Both OS arms are admitted in source at
`single-runtime`; the preserved (D)-grade and stronger-grade nonclaims remain
future work, not blockers to this Phase 2 source flip.
