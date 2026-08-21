# Resolve Expo native auth crypto without a consumer polyfill

**Status:** Closed
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Expo, React Native, Auth bootstrap, Cryptography, Client integration
**Date:** 2026-08-21
**Governing:** LLP 0181 native adapters; LLP 0258 D3/D6
**Evidence:** Messtimate published-0.1.24 diary; current
`packages/snapback-expo/provider.mjs` and `packages/snapback-client/app-client.mjs`

## Problem

React Native does not provide `globalThis.crypto.subtle`. The Expo provider's
native custody path nevertheless passes `cryptoObject: globalThis.crypto` into
`createProviderValidatedExpoNativePlatform`, and application-client custody
uses `cryptoObject.subtle.digest` for the storage-partition identity. A native
iOS boot therefore reaches `SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED`
unless the app installs a small crypto shim.

The Guide correctly documents a pure-JS fallback for prepared-binding digests,
but that does not cover the auth-custody partition digest. The resulting claim
that a fresh Expo app needs zero consumer polyfills is broader than the current
auth-bootstrap implementation.

## Required change

- Add a first-party Expo crypto adapter using a platform-qualified digest
  implementation (likely `expo-crypto`, already in the integration orbit), or
  make the provider accept and resolve an explicit `cryptoObject`/digest
  adapter.
- Keep security-bearing randomness separate from hashing; do not infer that a
  digest adapter is a CSPRNG.
- Use the same canonical bytes and SHA-256 output as WebCrypto and retain parity
  vectors across web, iOS, and Android.
- Remove the hard-coded native `globalThis.crypto` dependency from the
  provider-owned path.
- Reconcile the Guide's zero-polyfill claim and the native refusal name.

## Acceptance

- A fresh packed Expo scaffold boots auth on real/simulated iOS and Android
  without application-installed globals or a hand-written shim.
- WebCrypto and Expo-adapter partition identities are byte-identical for the
  same app and partition inputs.
- Missing native module, digest failure, and unavailable secure randomness
  remain distinct actionable refusals.

## Resolution

The Expo provider now owns a SHA-256-only `expo-crypto` adapter and passes that
narrow capability into the common LLP 0258 application-client custody owner.
The client continues to own the canonical UTF-8 transcript and returns the
same partition identity for WebCrypto, iOS, and Android adapter vectors. The
adapter deliberately exposes no random-byte API and creates no alternate
session or custody store.

Provider integration tests run with `globalThis.crypto` absent and distinguish
an absent or unlinked native module
(`SNAPBACK_AUTH_BOOTSTRAP_DIGEST_MODULE_UNAVAILABLE`), a resolved module whose
digest fails (`SNAPBACK_AUTH_BOOTSTRAP_DIGEST_FAILED`), and independently
unavailable secure randomness (`SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING`). The
packed local-source Expo closure now carries an offline `expo-crypto` fixture,
and the Guide's zero-consumer-polyfill claim names the boundary explicitly.

Simulator execution was attempted on the implementation host, but `xcrun`
could not locate `simctl` and `adb` was not installed. Native execution is
therefore evidenced here by OS-labeled parity vectors, provider integration,
and the packed closure proof rather than a launched simulator. The remaining
native-boot witness is tracked separately in
[`issues/20260821-expo-crypto-adapter-native-witness.md`](../20260821-expo-crypto-adapter-native-witness.md);
closing this ticket records the landed implementation, not completion of that
platform witness.

**Landing SHA:** `ca108246f`
