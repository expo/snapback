# Guide-gap: RN local-store RNG regression bricked ordinary Online startup

**Opened:** 2026-08-03
**Resolved:** 2026-08-03
**Systems:** Client SDK, React/Expo, Local store, Guide
**Related:** LLP 0008 DK-9, LLP 0064 §3, LLP 0157 §D6, LLP 0166 §D1/§D2,
`issues/closed/20260801-0137-a1expo-f1-webcrypto-required-expo-path.md`

LLP 0166 L1 made format-v3 store metadata eagerly mint a CSPRNG
`clientStoreId` and 32-byte local-row-handle key, and made every client eagerly
mint a CSPRNG registration context. Stock React Native/Hermes has no
`globalThis.crypto`. The default memory fallback therefore threw
`SNAPBACK_RQS_STORE_RANDOM_UNAVAILABLE` during ordinary Online startup,
regressing the August 1 crypto-free boot fix. The guide still claimed that a
fresh Expo Online app needed no crypto but did not explain the new optional
store consequence.

## Resolution

- Default store resolution now reports `{ implementation: null, durable:
  false, reason: "secure-random-unavailable" }` when no secure RNG can mint
  store metadata. The Online client remains usable; secure keys are never
  synthesized from `Math.random`.
- Storeless active-query bookkeeping uses process-local time+sequence identity.
  Persisted/brokered contexts and registrations remain CSPRNG-only.
- `registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto })` accepts an
  injected `expo-crypto` module and carries its RNG into both the native file
  store and registration identities without requiring a global polyfill.
- The React Expo guide now states the degradation and the direct Expo Crypto
  registration path. Regression coverage runs with `globalThis.crypto`
  removed.
