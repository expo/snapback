# Optimistic layers with a never-true isAuthoritative matcher strand until store teardown

**Date:** 2026-08-04
**Status:** Resolved (2026-08-07)
**Area:** Snapback React, optimistic mutations
**Governing:** LLP 0107

## Problem

When an optimistic layer supplies `isAuthoritative`, the revision-based
fallback retirement (`authoritativeRevision > confirmedRevision`) never
applies to it. A matcher that can never return true therefore strands the
confirmed layer permanently: it holds a store pin (keeping the subscription
demanded), keeps projecting over every delivery, and counts against the
256-layer provider cap until store teardown.

Reachable cases:

- the identified row is absent from that query's result (filtered out,
  paginated away, or deleted server-side before the matcher ever sees it);
- the server settles a projected field to a third value differing from both
  the receipt and the captured intent.

This is not a regression — it is the ratified complete-receipt semantics,
and hand-written matchers have always shared it — but
`projectRecordFields` (LLP 0107 replay-safety affordances) now makes
matcher-supplied layers the paved default, so the hazard deserves a
backstop. Found by the fresh-session review in llp-ship run
20260804-optimistic-replay-lint (finding 2).

## Suggested resolution

Design options, in rough preference order:

1. A bounded post-confirmation retirement backstop: after a layer is
   confirmed, retire it anyway once N authoritative deliveries (or a time
   bound) pass without the matcher returning true, with a dev diagnostic
   naming the mutation/query pair. Needs an LLP 0107 amendment ruling on
   what N/bound is honest — the layer's whole point is surviving partial
   deliveries.
2. For `projectRecordFields` specifically: retire when the identified row is
   absent from an authoritative delivery (the row can no longer dip), which
   closes the filtered/deleted class without touching hand-written matchers.
3. Documentation-only: keep the semantics, expand the recipe trap (done at
   filing time) and surface stranded layers in provider `inspection()`.

## Resolution (2026-08-07)

Charlie ruled option 2 **plus** option 3 (local-first author-gate packet,
item 5); option 1's timer/delivery-count backstop was explicitly not ruled.
Implemented in one landing:

- **Option 2** — for the `projectRecordFields` paved path only, a confirmed
  layer retires when its identified row is absent from an authoritative
  delivery of the query it projects onto. Scope is carried by a
  module-private symbol brand on the exact matcher function the helper
  returns, so overriding `isAuthoritative` — like any hand-written matcher —
  keeps the ratified complete-receipt semantics unchanged. Absence is
  conclusive at this surface because authoritative deliveries are complete
  result sets by construction (DK-3 deltas materialize client-side before
  delivery); the confirmation-time absence check is gated on
  `freshness === 'current'` so LLP 0114 Channel B retained frames never key
  retirement. The third-value strand (row present, field settled to a value
  differing from both receipt and intent) remains, by the ruling's scope.
- **Option 3** — provider/registry `inspection()` now reports
  `optimisticLayers` (installed count) and `confirmedOptimisticLayers`
  (`{attemptId, mutationId, queryId, confirmedRevision, storeRevision}` per
  confirmed, unretired layer).

Regression fixtures in `packages/snapback-react/optimistic.test.mjs`; LLP
0107 amended (Revised 2026-08-07, replay-safety affordances + journal);
`guide/recipes/optimistic-toggle.md` anti-pattern rescoped to hand-written
matchers.

## Related

- issues/closed/20260804-optimistic-projection-replay-lint-and-helpers.md
- llp/0107-react-presence-and-optimistic-lifecycle.spec.md
- guide/recipes/optimistic-toggle.md
