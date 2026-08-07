# Expo provider AppState lookup evaluates unsupported React Native root exports

**Status:** Resolved
**Date:** 2026-08-06
**Systems:** `packages/snapback-expo`, React Native 0.86, Expo Go 57
**Related:** LLP 0176 G1, LLP 0181 provider,
`demos/expo-golden-path-fixture/receipts/20260806-g1-ios-simulator.md`
**Fix commit:** pending landing by the orchestrator

## Reproduction

After binding and session adoption succeeded in Expo Go, the provider lazily
evaluated `await import('react-native')` to obtain `AppState`. Metro built a
separate React Native root namespace bundle and evaluated legacy optional
exports, failing at `PushNotificationIOS.js`:

```text
Invariant Violation: Your JavaScript code tried to access a native module
that doesn't exist.
```

Expo Go intentionally does not carry that unrelated native module.

## Resolution

The lifecycle fallback now lazily imports
`react-native/Libraries/AppState/AppState.js` directly. It keeps AppState
lazy and owned by React Native without evaluating unrelated root exports.

The final Air stream records a one-module AppState bundle, followed by
provider ready, seeded live query, ordinary mutation, `G1_IOS_PASS`, and
strict cleanup.
