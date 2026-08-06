# Android emulator clock lag rejects a freshly issued supervised binding

**Status:** Resolved
**Date:** 2026-08-06
**Systems:** `packages/snapback-expo`, AppBinding, supervised development, Android emulator
**Related:** LLP 0181 AppBinding v1,
`demos/expo-golden-path-fixture/receipts/20260806-g1-android-emulator.md`
**Fix commit:** pending landing by the orchestrator

## Reproduction

Start `snapback dev --expo`, wait for readiness, and immediately cold-open the
cached Expo Go bundle on the Android emulator. The fleet AVD clock lagged the
host by about 21 seconds. One run rendered:

```text
SNAPBACK_APP_BINDING_NOT_YET_VALID: The supervised development binding is
not valid before its issuance time
```

The strict `issuedAt > Date.now()` comparison made ordinary host/emulator
clock skew a launch race. A slower first bundle happened to cross the boundary
and pass; a cached bundle exposed it reliably.

## Resolution

Admission permits at most 60 seconds of forward issuer skew for the
`issuedAt` lower bound of a `source: "supervised-dev"` binding delivered via
`local-supervised-ipc`. The allowance does not change expiry, does not apply to
release bindings, and grants no network or application authority. The coded
refusal remains for values more than 60 seconds in the future and now reports
the admitted bound.

The binding unit test pins both sides of the exact 60-second boundary. The
final real-emulator launch observed device time
`2026-08-06T09:26:31.362Z` against binding issuance
`2026-08-06T09:26:35.199Z`, then reached Sessions authority, the seeded live
query, and `G1_ANDROID_PASS`.
