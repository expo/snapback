# Physical process-kill witness for offline cold-boot binding on the Expo file carrier

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** React client, Expo client, File RQS store, Testing
**Date:** 2026-08-06
**Governing:** LLP 0114, LLP 0090, LLP 0129
**Related:** `issues/closed/20260804-guide-gap-react-expo-offline-cold-boot.md`
(step 5 residue), `issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md`
(the sibling real-Chrome IndexedDB witness gap)

## What is missing

`issues/closed/20260804-guide-gap-react-expo-offline-cold-boot.md` fixed the
IndexedDB binding-receipt election race and added CI-runnable node
simulations, but its step 5 — a **physical Expo file-carrier process-kill
witness** — was explicitly out of scope for that fix.

Today's evidence for the Expo file carrier is
`demos/relay-room-bakeoff/snapback-expo/tests/offline-acceptance.mjs`: a
fresh `SnapbackClient` in the *same node process* over the fake Expo file
system prepares offline from the persisted binding receipt and renders
retained rows. That proves the persisted-receipt path on the carrier, but it
does not prove every React Native cold-start condition (real process death,
real expo-file-system durability, real device relaunch).

## What done looks like

A witness in the style of `demos/rn-durable-store-witness/` (or an extension
of it): warm online boot on a device/simulator with the registered file
store, kill the app process, relaunch with the backend unreachable, and
assert the provider is constructed with `binding.source ===
'persisted-receipt'` rendering `freshness: 'retained'` rows. Retain Relay
Room's fresh-client test as the cheaper regression rung.

The equivalent real-Chrome IndexedDB witness (manual repro: `demos/warble`)
is tracked by the umbrella browser-proof gap ticket above, not this one.

## G4 simulator attempt — 2026-08-06

The external 0.1.11 G4 app registered `expo-file-system` plus `expo-crypto`,
rendered a current retained-eligible query, then cold-relaunched Expo Go while
the supervised backend process was paused. The app remained at boot
`starting`; it emitted `freshness: retained` only after the backend resumed,
then immediately reconciled current. That is **not** the offline witness this
ticket requires. Pausing kept the bootstrap/session request pending instead of
producing a fast connectivity refusal through which persisted-receipt
preparation could run.

The attempt also found that an app-level marker triggered on any later
`freshness: retained` transition can mislabel ordinary refresh as cold boot.
The external fixture now emits that marker only before the process has ever
rendered current. The acceptance below still needs a real process death plus a
fast, honest backend-unavailable condition and must inspect
`binding.source: 'persisted-receipt'`; an event name alone is insufficient.
