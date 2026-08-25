# Familiar page does not say which presence hook URL-first web should import

**Filed:** 2026-08-25 · **guide-gap**
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-familiar`
**Systems:** Guide, Ephemeral state, React/Expo

## Problem

`@expo/snapback-expo`'s `useSnapbackActivityPresence` requires
`SnapbackExpoLifecycleContext`. A URL-first `SnapbackProvider` (the
working Clique landing) does not provide it. The hook that works is
`@expo/snapback-react`. Familiar learned this from package types, not
from the familiar profile page.

The generation-fence on `touch()` is a product change (LLP 0310.000 Track
D). This ticket is the import/docs slice only.

## Direction

On the familiar profile page and the ephemeral/presence recipe: URL-first
web imports `useSnapbackActivityPresence` from `@expo/snapback-react`.
The Expo facade hook is for `SnapbackExpoProvider` only.
## Resolution (2026-08-25)

Resolved the documentation slice after checking LLP 0257 and the React/Expo
activity-presence sources. The maintained
`packages/snapback-react/activity-presence-bare-provider.test.mjs` now proves
the supported React hook under a bare `SnapbackProvider`. The independently
runnable, unregistered
`tests/probes/snapback-expo-activity-presence-bare-provider.mjs`
continues to characterize the facade's conditional browser AppState fallback.
That fallback is an implementation observation, not a public contract or a
Guide recommendation.

LLP 0310.000 Ruling 3 remains authoritative: URL-first web under a bare
`SnapbackProvider` imports from `@expo/snapback-react`, while the Expo facade is
for `SnapbackExpoProvider` trees. The Familiar profile, ephemeral-state page,
activity-presence recipe, and retrieval case 100 now enforce that boundary.
The RFC owner may amend Ruling 3 if the observed fallback should become a
supported contract. The generation-fence product change was not implemented or
tested in this lane.
