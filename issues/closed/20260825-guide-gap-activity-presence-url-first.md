# Familiar page does not say which presence hook URL-first web should import

**Filed:** 2026-08-25 · **guide-gap**
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-familiar`
**Systems:** Guide, Ephemeral state, React/Expo
**Related:** `issues/20260825-ruling-3-vs-llp-0257-background-withdrawal.md`

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

LLP 0310.000 Ruling 3 remains authoritative: URL-first web under a bare
`SnapbackProvider` imports from `@expo/snapback-react`, while the Expo facade is
for `SnapbackExpoProvider` trees. The Familiar profile, ephemeral-state page,
and activity-presence recipe now state the bare-provider limitation honestly:
the React hook has no AppState-driven background withdrawal, so backgrounded
typing intent expires at the presence deadline instead of withdrawing
immediately.

Retrieval case 100 and its required-guidance phrases are the proof for this
ticket. The unresolved conflict with LLP 0257 and the shipped Expo facade is
filed for the RFC owner in the related open issue. The generation-fence product
change was not implemented or tested in this lane.
