# Supervised environment: no persisted-receipt fallback on cold boot

**Status:** Closed (2026-08-07)
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** Expo client, Offline, Supervised dev loop
**Date:** 2026-08-07
**Related:** Diary 0066 (three-lane measurement, 0.1.12)

Cold boot with the backend stopped fails the supervised bootstrap
(`SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE`) and the provider never falls back
to the documented `prepareReactBinding` persisted-receipt path — both
measurement lanes built app-level offline shells around the supervisor.
The receipt fallback exists and works (proven cold in both lanes); the
supervised provider just never takes it. Fix: on bootstrap-unavailable,
adopt the persisted receipt when one matches, surfacing the same honest
freshness facts.

## Resolution (2026-08-07)

Implemented in `@expo/snapback-expo`:

- A successful supervised adoption (and each successful authority refresh)
  caches the **non-secret** exchange binding + public authority facts —
  never the bearer — in a development-only cache
  (`supervised-binding-cache.mjs`: `localStorage` on web, an
  `expo-file-system` document file on device, injectable `bindingCache`
  option; production builds prune it per LLP 0181's package contract).
- On `SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE` (only that code) at
  `resolveBinding`, the environment re-presents the cached binding through
  the **unchanged full AppBinding admission** — identity, capability,
  clock-skew, and expiry all still apply, so an expired cached binding
  refuses with `SNAPBACK_APP_BINDING_EXPIRED` and its restart remediation —
  then adopts a tokenless client whose `prepareReactBinding` reaches LLP
  0114's existing digest-bound persisted-receipt path
  (`binding.source: 'persisted-receipt'`), with the same honest
  freshness/connection facts the documented low-level path surfaces.
- The boot ready state now carries `preparation.source:
  'deployment' | 'persisted-receipt'`; offline authority facts are the
  retained last-known public facts; no matching cache/receipt keeps the
  original bootstrap-unavailable refusal.

Test (the exact shape both lanes proved manually): supervised warm boot →
backend+exchange killed → fresh cold boot reaches a ready provider with
`prepared.source === 'persisted-receipt'`, plus empty-cache and
expired-binding refusals and a bearer-never-persisted regression —
`packages/snapback-expo/supervised-offline-fallback.test.mjs`
(scripted-wire, real client + real `prepareReactBinding`).

Guide: `guide/clients/react-expo.md` (supervised fallback paragraph in the
offline section) + `guide/capabilities.md` row.

Residue (tracked elsewhere, not blocking): the on-device default cache arm
rides the same carrier-witness debt as the receipt path itself
(`issues/20260806-expo-file-carrier-process-kill-witness.md`); cold boots
past the supervised binding TTL (default 1h) refuse by design — the
binding expiry contract, not a fallback gap.
