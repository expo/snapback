# Resolve Expo native auth crypto without a consumer polyfill

**Status:** Open
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

