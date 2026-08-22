# Witness the Expo auth crypto adapter on iOS and Android

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Expo, React Native, Auth bootstrap, Cryptography, Client integration, Testing
**Date:** 2026-08-21
**Governing:** LLP 0181 native adapters; LLP 0258 D3/D7
**Origin:** Follow-up to
[`issues/closed/20260821-expo-native-auth-crypto-adapter.md`](./closed/20260821-expo-native-auth-crypto-adapter.md)

## Pending witness

The Expo-native auth crypto implementation and packed-package checks have
landed, but the implementation host had neither a usable `simctl` nor `adb`.
Run the remaining witness on simulator-capable hosts: a macOS host with Xcode
and an iOS Simulator runtime, and an Android SDK host with `adb` and an Android
emulator (one host may satisfy both rows).

From a fresh packed Expo scaffold installed from the exact package tarballs:

1. boot application auth on an iOS simulator without an application-installed
   crypto global or hand-written shim;
2. boot the same scaffold on an Android emulator under the same constraint;
3. capture the auth storage-partition identity from each native run and prove
   it is byte-for-byte equal to the WebCrypto identity for the same canonical
   app id and storage-partition inputs; and
4. retain dated receipts identifying the package tarballs, source revision,
   simulator/emulator OS and runtime, and the observed partition identities.

This ticket closes only when both packed native boots and the byte-equal
WebCrypto comparison have been witnessed on those platform-capable hosts.

## R1 attempt — 2026-08-22

LLP 0295 R1 confirmed that the implementation gate is open on
`fa36a048e8e08f188ca0d486f76f7bb12b3541f2`: native digest commit
`55b266cf7` and supervised binding-refresh commit `38b2d9d56` are both
ancestors. Fresh packed Expo Explicit and Familiar probes passed password auth,
durable session restoration after additive schema activation, and a cold
provider reattach after a controlled binding term while the original
supervisor remained running. The digest parity test passed 4/4, the native
custody provider matrix passed 30/30, and the nested packed Expo closure passed
1/1.

The required launched native witness could not run on this host:
`xcode-select -p` reports `/Library/Developer/CommandLineTools`, `xcrun` cannot
find `simctl`, `adb` is absent, and the documented
`~/Dropbox/APIKeys/MACHINE_FLEET.md` dispatch record is absent. The retained
blocked receipt is
`benchmarks/runs/2026-08-22-r1-cold-probes/receipts/native-gate.json`. This does
not close the ticket or establish an iOS/Android boot claim.
