# Snapback 4: Keep idle changes polls from occupying every HTTP worker

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R19
Evidence: Measured with four ordinary polls
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.002](../../llp/3000.002-end-to-end-resource-bounds.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The HTTP host starts four blocking request workers. `/changes` waits on a
condition variable in the worker handling that request. Four ordinary idle
clients can occupy all workers for the long-poll interval, delaying health,
queries and mutations that would otherwise complete immediately.

Reproduction: start four requests to `/changes?since=999999&wait=2`; after
100 ms request the health endpoint. The health response took 1,904 ms, nearly
the remaining polling interval. The production-shaped client interval can be
much longer. This does not require a large workload.

Move waiting changes requests off the finite executor used for active work,
or use a bounded nonblocking notification mechanism. Merely increasing the
worker count changes the threshold without removing the failure. Verify four
and more idle clients can wait while a small query/mutation progresses,
notifications arrive promptly after commits, and close/cancellation releases
waiters without a thread or task leak.

## Implementation locations

- [crates/snapback4/src/serve.rs](../../snapback4/crates/snapback4/src/serve.rs)
- [packages/snapback4/src/client.ts](../../snapback4/packages/snapback4/src/client.ts)

## Resolution — 2026-09-13

The upstream thread-per-request correction already removed the four-waiter bottleneck. The integrated HTTP regression verifies ordinary requests proceed beside many long polls; socket writes release shared engine guards. Thread-count/deadline policy remains explicit research.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [packages/snapback4/test/http-bounds.test.mjs](../../snapback4/packages/snapback4/test/http-bounds.test.mjs)
