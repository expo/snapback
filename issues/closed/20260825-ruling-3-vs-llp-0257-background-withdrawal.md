# LLP 0310.000 Ruling 3 conflicts with LLP 0257 on bare-provider background withdrawal

**Filed:** 2026-08-25 · **Resolved:** 2026-08-26 — no conflict
**Systems:** React, React/Expo, Ephemeral state, Guide
**Owner:** LLP 0310.000 / LLP 0257 RFC owner
**Related:** LLP 0257 §Expo: backgrounding and resume; LLP 0310.000 Ruling 3;
`issues/closed/20260825-guide-gap-activity-presence-url-first.md`

## Guide-lane process posture

LLP 0310.000 Ruling 3 is an RFC in Review, landed on `origin/main` on
2026-08-25. While that review remains open, Ruling 3 directs this guide lane.
The three teaching pages retain LLP 0310.000 in their authority declarations,
but keep this status and landing history here so retrieval guidance stays
stable across later RFC process transitions.

## Conflict

LLP 0257 requires the `@expo/snapback-expo` facade hook to observe AppState and
withdraw activity presence immediately on backgrounding. Its shared-lifecycle
source rule says a tree without an injected source falls back to the facade's
conditional AppState resolver, explicitly including a bare
`SnapbackProvider`; the RFC also says the facade wrapper works under that bare
provider.

LLP 0310.000 Ruling 3 instead names
`useSnapbackActivityPresence` from `@expo/snapback-react` as the paved import
for URL-first web and says the `@expo/snapback-expo` facade hook is for
`SnapbackExpoProvider` trees only. The React hook deliberately has no platform
lifecycle listener. Under a bare `SnapbackProvider`, backgrounded typing intent
therefore expires at its activity deadline rather than being withdrawn
immediately.

The shipped facade currently follows LLP 0257. It reads the optional Expo
lifecycle context, falls back through `resolveSnapbackExpoLifecycleSource()`
when the context is absent, gates publication until observation is established,
and withdraws on a non-active AppState transition. Consequently, the facade
currently does work under a bare `SnapbackProvider`, even though Ruling 3 says
that composition is not the paved or supported contract.

## Owner decision required

Resolve the documents and product in one of two directions:

1. Preserve LLP 0257's immediate-withdrawal requirement under a bare provider:
   amend Ruling 3 to support and pave the Expo facade for that composition, then
   align the Guide and retrieval case 100.
2. Preserve Ruling 3's package/provider boundary: amend LLP 0257's bare-provider
   requirement and change the facade to require a `SnapbackExpoProvider` tree
   (or otherwise refuse the unsupported composition). Keep the React import
   paved under a bare provider and accept its deadline-only background expiry,
   unless a separately designed lifecycle mechanism closes that limitation.

This guide lane does not choose between the two or amend either LLP.

## Round-8 guide-lane resolution

The lane keeps
[`activity-presence-react-characterization.test.mjs`](../packages/snapback-react/activity-presence-react-characterization.test.mjs)
as package-gating characterization of shipped React behavior that the Guide
relies on, not as a regression test for this conflict ticket. The file
characterizes the relevant React module graph: the public
entry sources the hook from `implementation.mjs`, and a recursive local-import
walk from that module proves that no reachable React-side file imports React
Native, refers to AppState, or attaches a platform lifecycle `change` listener.
It separately mounts the React hook under a bare `SnapbackProvider`, proves
that `touch()` publishes and arms the activity deadline without withdrawing,
then fires that deadline and proves it performs the withdrawal. Retrieval case
100 is the docs proof that every named page teaches the background-expiry
limitation and the shipped facade fallback. This characterization does not
decide whether the facade's shipped bare-provider fallback should remain
supported; the owner decision above remains open.

## Resolution — 2026-08-26: no conflict

Two things resolved this, and neither is a compromise between the two
directions above.

1. **Ruling 3 no longer asserts the boundary.** The r2 text this ticket was
   filed against ("the facade hook is for `SnapbackExpoProvider` trees only")
   was withdrawn during the LLP 0310.000 review. Its r5+ text says
   *"no package boundary is ruled here"* and defers to the LLP 0310 P20
   re-test.
2. **P20 ran and the facade works.**
   `tests/probes/expo-presence-bare-provider-20260826/` mounts the
   `@expo/snapback-expo` facade under a bare URL-first `SnapbackProvider` on
   web with no lifecycle context: outcome `works`, no diagnostic, gated
   admission opened, one publish. LLP 0257's bare-provider fallback is what
   ships and what is now proven.

So direction 1's substance holds without amending anything: LLP 0257 stands
unamended, LLP 0310.000 rules no package boundary, and the guide keeps both
imports with their gated/ungated difference documented rather than declaring
one composition unsupported. The three teaching pages and retrieval case 100
were corrected in the same landing.

`packages/snapback-react/activity-presence-react-characterization.test.mjs`
stays as characterization of the React hook's deliberate absence of a platform
lifecycle listener; `tests/probes/expo-presence-bare-provider-20260826/probe.test.mjs`
is now the standing regression test for the facade's bare-provider fallback.
