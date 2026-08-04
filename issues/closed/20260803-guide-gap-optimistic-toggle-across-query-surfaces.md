# Guide gap: optimistic toggle across multiple query surfaces

**Date:** 2026-08-03
**Status:** Resolved 2026-08-03
**Area:** Snapback React guide

## Problem

The optimistic-mutation section documents the primitives and correctly says
that v1 targets one canonical query store, but it does not provide a familiar
toggle/counter recipe or show what an app should do when the same record is
rendered by multiple query stores (for example, a post in both a timeline and
a profile feed).

While building `demos/chirp`, this made it too easy to reach for component
state for the heart and counter. Combining a local counter delta with the live
authoritative count produced a visible double increment.

## Proposed guide change

- Add a complete favorite/like example whose query returns both `liked` and
  `likeCount` for the current viewer.
- Show an optimistic `update` that changes both fields atomically and an
  `isAuthoritative` matcher that recognizes the mutation result.
- Emphasize that `update` is a replayable projection over changing
  authoritative bases: capture and set the intended outcome rather than
  implementing a toggle/increment action that can run twice during rebase.
- Explicitly warn against adding a component-local delta to a count already
  supplied by a live query.
- Explain response-before-query and query-before-response reconciliation.
- Show the v1 multi-surface pattern: configure the mutation against the exact
  canonical query/args that rendered the component, commonly through a small
  surface-specific wrapper, and state that other mounted stores update through
  their authoritative subscriptions rather than the same optimistic layer.
- Cross-link the recipe from both the React/Expo client page and live-query
  guidance.

## Evidence

See `diaries/0053-chirp-expo-twitter-clone.diary.md` and the optimistic like
implementation in `demos/chirp/src/components/post-card.tsx`.

## Resolution

Added `guide/recipes/optimistic-toggle.md`, a CI-verified like/favorite
recipe covering every point above: the viewer-aware `liked`/`likeCount`
query shape, an atomic two-field projection with a complete-receipt
`isAuthoritative` matcher, the replayable capture-and-set reducer rule
(with the partial-delivery and rebase-inversion hazards the chirp diary
hit), response-before-query and query-before-response reconciliation, the
explicit warning against component-local counter deltas, and the v1
one-canonical-store multi-surface pattern with surface-specific wrappers.

The recipe's behavioral claims are asserted by a new toggle-recipe section
in `packages/snapback-react/optimistic.test.mjs` (run by the package CI
suite), which the page transcludes. Cross-linked from
`guide/clients/react.md` (whose `toggleTask` example was also fixed — it
previously toggled inside the reducer, the exact replay hazard this ticket
flags — plus two new anti-pattern bullets), `guide/clients/react-expo.md`,
`guide/realtime/live-queries.md`, and the guide index. The recipe cites
only tracked sources because `demos/chirp` had not yet landed when it was
written; the demo remains the motivating evidence.
