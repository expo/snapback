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
