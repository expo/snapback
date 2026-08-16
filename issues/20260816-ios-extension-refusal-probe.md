# iOS native-custody extension-refusal probe

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 2
**Confidence:** 5
**Systems:** Auth, Custody, React/Expo, iOS, Capability honesty, Testing
**Date:** 2026-08-16
**Governing:** LLP 0258 D3 and Phase 2; LLP 0263 §5; LLP 0064 per-platform
capability honesty

## Remaining admission blocker

The committed iOS receipt at
`demos/native-custody-probes/evidence/20260816T214117Z-dfaa64ff-phase2-ios`
passes its exercised arms but marks P4 extension refusal INCOMPLETE because
the v1 probe app has no extension target. The ordinary Expo resolver must keep
iOS on `expo-native-phase-2-evidence-required` until this blocker closes.

Add a real share or notification extension target to the probe app. From that
extension process, attempt custody I/O against the same application custody
domain and prove `SNAPBACK_AUTH_CUSTODY_SINGLE_RUNTIME_REFUSED` occurs before
any custody read, ownership, or replacement operation. Retain distinct process
identity and zero-I/O counters in the committed receipt. Re-run the ordinary
boundary witness, then flip iOS by adding it to the same evidence-gated OS set
used for Android in `packages/snapback-expo/provider.mjs`; mirror the Android
provider admission/refusal tests and capability-row wording.

## Recorded nonclaims

This extension blocker is the prerequisite for the current `single-runtime`
flip. It does not upgrade simulator evidence into LLP 0263 §5 physical-device
(D) evidence. Preserve these separate nonclaims until independently run:

- iOS physical-device lock-state, real securityd kill safety, extension/app
  interleaving and writer kill/suspension, file-protection windows, encrypted
  backup restore, and device-to-device migration;
- Android physical f2fs kill/force-stop and lock-state controls,
  MultiProcessDataStore interleaving/writer-kill work, `bmgr backupnow` plus
  real Google Drive restore, and device-to-device transfer; and
- all stronger cross-process fencing, hardware, backup-continuity, and
  sender-constrained claims.

These arms refine future grades and platform lifecycle claims; they are not
silently claimed by the Android `single-runtime` admission or by the eventual
iOS extension-refusal proof.

## Exit

A committed iOS receipt exercises a real extension and proves the exact typed
refusal before custody I/O; focused provider tests admit iOS only after that
evidence; the capability index names the resulting grade and remaining
nonclaims; the open Phase 2 parent ticket records the iOS flip.
