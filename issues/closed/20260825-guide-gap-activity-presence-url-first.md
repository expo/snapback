# Familiar page does not say which presence hook URL-first web should import

**Filed:** 2026-08-25 · **guide-gap**
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-familiar`
**Systems:** Guide, Ephemeral state, React/Expo

## Problem

The Clique run inferred from its failed composition that
`@expo/snapback-expo`'s `useSnapbackActivityPresence` requires
`SnapbackExpoLifecycleContext` and that a URL-first `SnapbackProvider` must use
the React export. The guide did not state the provider boundary and paved
import, so the run could not distinguish an implementation observation from
the supported public contract.

The generation-fence on `touch()` is a product change (LLP 0310.000 Track
D). This ticket is the import/docs slice only.

## Direction

Establish the current behavior from source and a bare-provider render probe,
then teach only the provider-scoped public contract.

## Resolution (2026-08-25)

Resolved the documentation slice after checking LLP 0257 and
`packages/snapback-expo/activity-presence.mjs`. The independently runnable
`activity-presence-bare-provider.test.mjs` currently observes that the facade
hook falls back through the conditional browser AppState resolver under a bare
`SnapbackProvider`, and that backgrounding invokes withdrawal. This is an
implementation observation, not a public contract or a Guide recommendation.

LLP 0310.000 Ruling 3 remains authoritative: URL-first web under a bare
`SnapbackProvider` imports from `@expo/snapback-react`, while the Expo facade is
for `SnapbackExpoProvider` trees. The Familiar profile, ephemeral-state page,
activity-presence recipe, and retrieval case 100 now enforce that boundary.
The RFC owner may amend Ruling 3 if the observed fallback should become a
supported contract. The generation-fence product change was not implemented or
tested in this lane.
