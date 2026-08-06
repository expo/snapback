# Hydrated AppDescriptor conveniences fail React binding canonicalization

**Status:** Resolved
**Date:** 2026-08-06
**Systems:** `packages/snapback-client`, `packages/snapback-expo`, generated AppDescriptor
**Related:** LLP 0176 G1, LLP 0179,
`demos/expo-golden-path-fixture/receipts/20260806-g1-ios-simulator.md`
**Fix commit:** pending landing by the orchestrator

## Reproduction

Import the generated `app` module and pass it to
`<SnapbackExpoProvider app={app}>` in Expo Go. Binding admission reached
client preparation, then failed:

```text
SNAPBACK_REACT_ARGS_INVALID: React query arguments are not a
CanonicalClientValueV1: non-enumerable object property
path=$.descriptor.api.mutations.addReceiptNote key=artifacts
```

JSON-only provider tests missed the failure. The typed generated module adds
a non-enumerable `artifacts` runtime convenience to each hydrated operation
reference, and the React binding receipt digest retained that hydrated object
instead of the portable descriptor projection.

## Resolution

Descriptor-mode client admission now takes and freezes a structured-clone
portable projection before validation and receipt hashing. That strips
non-enumerable hydration conveniences while preserving the LLP 0179 portable
fields and existing deployment admission. The Expo provider regression test
decorates every query/mutation reference exactly this way and proves client
preparation succeeds.

The Air rerun passed descriptor admission, provider boot, live query, and
ordinary mutation on the real iOS simulator.
