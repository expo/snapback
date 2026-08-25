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

Resolved the documentation slice. The Familiar profile, ephemeral-state page,
and activity-presence recipe bind the hook import to the provider: URL-first
`SnapbackProvider` trees use `@expo/snapback-react`; the
`@expo/snapback-expo` facade is for `SnapbackExpoProvider`. Retrieval case 100
now routes the preserved "URL-first activity presence" vocabulary, requires
guidance on every named page, and rejects the old unconditional Expo-facade
import. The generation-fence product change was not implemented or tested in
this lane.
