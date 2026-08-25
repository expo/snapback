# Familiar page does not say which presence hook URL-first web should import

**Filed:** 2026-08-25 · **guide-gap**
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-familiar`
**Systems:** Guide, Ephemeral state, React/Expo

## Problem

The Clique run inferred from its failed composition that
`@expo/snapback-expo`'s `useSnapbackActivityPresence` requires
`SnapbackExpoLifecycleContext` and that a URL-first `SnapbackProvider` must use
the React export. The guide did not state the bare-provider fallback contract,
so the run could not distinguish a product failure from the supported import.

The generation-fence on `touch()` is a product change (LLP 0310.000 Track
D). This ticket is the import/docs slice only.

## Direction

Establish the shipped behavior from source and a bare-provider render probe,
then teach the provider-independent import choice and its lifecycle consequence.

## Resolution (2026-08-25)

Resolved the documentation slice after checking LLP 0257 and
`packages/snapback-expo/activity-presence.mjs`. The independently runnable
`activity-presence-bare-provider.test.mjs` renders the facade hook under a bare
`SnapbackProvider`, exercises the conditional browser AppState resolver, and
proves backgrounding invokes withdrawal. Therefore either export works
URL-first, but only the Expo facade keeps AppState-driven background withdrawal.
The Familiar profile, ephemeral-state page, activity-presence recipe, and
retrieval case 100 now state that contract and do not reject the Expo import.
The generation-fence product change was not implemented or tested in this lane.
