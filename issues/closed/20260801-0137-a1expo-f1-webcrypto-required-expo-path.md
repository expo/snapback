# A1 Expo sweep: documented Expo path requires WebCrypto that React Native/Hermes does not provide (session establishment impossible out of the box)

**Opened:** 2026-08-01
**Systems:** Client integration, React/Expo
**Related:** LLP 0137 (Track B A1 Expo iOS arm), guide/clients/react-expo.md, demos/improvement-sweep/arms/a1-snapback-expo-ios/findings/0137-a1expo-f1-webcrypto-required-on-documented-expo-path.json

On a stock Expo SDK 57 / RN 0.86 app there is no `globalThis.crypto`, and the
packaged 0.1.7 client requires `crypto.subtle.digest('SHA-256')`
(react-binding.mjs manifest digests), `crypto.getRandomValues` (mutation
identity), and `crypto.randomUUID` (provider/store ids).
`prepareReactBinding` dies with `Cannot read property 'subtle' of undefined`
before any session exists. Neither the react-expo guide page nor the package
mentions a polyfill; the arm proceeded only after authoring an
expo-crypto-backed shim (arm evidence `app/src/crypto-polyfill.ts`).

Fix shape: RN-safe crypto seam in the client — pure-JS SHA-256 fallback for
the binding digests when `subtle` is absent, a named SNAPBACK_* refusal for
missing RNG primitives (or a documented one-line expo-crypto adapter), and a
prerequisites note on the react-expo page.

Witness: a fresh Expo app on the documented path reaches a ready provider and
a live query with zero consumer polyfills.

## Resolution (2026-08-01)

RESOLVED — the packaged client now boots on stock RN/Hermes (no
`globalThis.crypto`) with zero consumer polyfills, and refuses with one
named actionable code where real randomness is required:

- `packages/snapback-client/react-binding.mjs`: the three binding digests
  (`sha256Canonical`/`sha256Text`/`resultContractHash`) feature-detect
  `crypto.subtle` and fall back to the parity-tested pure-JS SHA-256 already
  shipped in `rqs.mjs` (byte-compatible with src/rqs.rs; regression asserts
  digest equality between the two paths). This removes the
  "Cannot read property 'subtle' of undefined" death in prepareReactBinding.
- `packages/snapback-client/index.mjs`: `cryptoRandomSource(what)` guards the
  security-bearing RNG mints (`newSeedOperationIdV1`, sender proof ids,
  `mintBundleBootKey`) — absent RNG throws
  `SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING` with expo-crypto /
  react-native-get-random-values guidance instead of a bare carrier
  TypeError. Math.random synthesis is never used for these.
- `packages/snapback-react/index.mjs`: provider instance labels and
  optimistic-layer ids (local uniqueness, not custody) fall back to
  time+sequence labels, mirroring processClientStoreId and
  createClientMutationId precedents.

Regression tests (proven-to-fail pre-fix):
`packages/snapback-client/webcrypto-fallback.test.mjs` (cryptoless
prepareReactBinding parity + named RNG refusals + mutation-id fallback) and
`packages/snapback-react/webcrypto-fallback.test.mjs` (cryptoless carrier
reaches a ready provider and a live query). Guide: the rewritten
guide/clients/react-expo.md "Crypto prerequisites" section (f6).

Witness satisfied at the node projection: a cryptoless runtime on the
documented path reaches a ready provider and a live query with zero
consumer polyfills; the RNG-gated surfaces name exactly what to install.
