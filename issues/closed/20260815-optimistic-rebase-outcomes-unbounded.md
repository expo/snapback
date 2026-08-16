# Optimistic rebase `outcomes` grows without bound for the life of the engine

**Status:** Closed
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 5
**Systems:** Client SDK, Optimistic mutations, Performance
**Date:** 2026-08-15
**Governing:** LLP 0155 (local prediction / rebase)
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

`packages/snapback-client/optimistic-rebase.mjs` keeps every rebase
outcome in an uncapped `outcomes` array (push at ~320, ~448;
`inspection()` copies the whole history at ~468-475). Each entry freezes
retired ids, every replayed operation, and changed predictions.

Live authoritative delivery can rebase often. This grows for the life of
the engine; `close()` does not clear it. React's layer/query caches
already have explicit caps (`OPTIMISTIC_LAYER_CAP`, `QUERY_CACHE_CAP`).

On a long-lived web session this is a slow leak, not a one-shot spike.

## Desired outcome

Ring-buffer or generation-bounded outcome history (enough for
inspection/debug, not the full session). Clear on `close()`.

## Acceptance

- After N rebases, retained outcomes are bounded by a documented cap.
- `close()` drops the history.
- Inspection still returns the most recent outcomes.

## Resolution (2026-08-15)

`packages/snapback-client/optimistic-rebase.mjs` documents and exports a
64-entry inspection-history cap, evicts the oldest outcome after each rebase,
and clears retained outcomes on `close()`. The new case in
`optimistic-rebase.test.mjs` exceeds the cap, verifies oldest/newest retained
revisions, and verifies close-time clearing.
