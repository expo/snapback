# Snapback 4: Resume pending writes after transient HTTP failures

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R11
Evidence: Reproduced with one transport branch returning 503
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.001](../../llp/3000.001-durable-replica-and-write-lifecycle.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The mutation `post` helper returns `{ok:false}` for HTTP 5xx without changing
the link state. Flush leaves the entry queued, but retry is mainly triggered
by a new write or an offline-to-online transition. When sync remains healthy,
there is no transition and the old write can remain pending indefinitely.

Reproduction: allow normal schema/sync requests, return 503 for the first
mutation, then restore healthy mutation responses. After follower activity,
transport recovery and explicit `client.sync()`, the predicted row still has
`pending: true`; the server has not received it. No new write was submitted.

Schedule a bounded retry for pending entries after transient failures,
independent of whether another request kept the link online. Distinguish
retryable failures from terminal outcomes and stop retries on close or signout.
Verify eventual delivery after one and several 503s, no busy loop, preserved
operation identity, and restart with a pending entry. Do not require the app
to create another write to unstick the first.

## Implementation locations

- [packages/snapback4/src/local.ts](../../snapback4/packages/snapback4/src/local.ts)

## Resolution — 2026-09-13

Pending writes retry transient server/transport failures with bounded backoff and stable IDs without requiring an observer. Close stops owned work. Drained partition streams now cover no-op and online-only commits so sent entries can retire.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [packages/snapback4/test/client-lifecycle.test.mjs](../../snapback4/packages/snapback4/test/client-lifecycle.test.mjs)
- [crates/snapback4-sim/tests/review_corrections.rs](../../snapback4/crates/snapback4-sim/tests/review_corrections.rs)
