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
