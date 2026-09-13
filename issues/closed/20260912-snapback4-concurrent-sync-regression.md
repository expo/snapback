# Snapback 4: Serialize or compare-and-apply overlapping sync responses

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R06
Evidence: Reproduced with reordered transport promises
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.001](../../llp/3000.001-durable-replica-and-write-lifecycle.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`syncOnce()` is callable concurrently by following, explicit `client.sync()`
and flush paths. Its backwards-watermark check compares against a local
variable captured before the request, not the state another sync may already
have committed.

Reproduction: start two syncs at watermark 1; resolve the first with row value
3/watermark 3, then the second with row value 2/watermark 2. Both apply, leaving
persisted watermark 2 and the older row. The check intended to prevent moving
backwards does not reject the second response.

Give stream application one owner, or validate and commit against current
persisted generation/watermark in a serialized transaction. Include explicit
sync overlapping the follower and a write flush, as well as responses from an
old generation arriving after reset. Verify watermarks never regress, rows
cannot be overwritten by an older page, and callers still observe completion
without deadlock or lost wakeups.

## Implementation locations

- [packages/snapback4/src/replica/replica.ts](../../snapback4/packages/snapback4/src/replica/replica.ts)
- [packages/snapback4/src/local.ts](../../snapback4/packages/snapback4/src/local.ts)

## Resolution — 2026-09-13

Sync coalesces per client and checks persisted generation, watermark, owner and send revision at apply. Backend adoption uses the transaction queue. A competing sender invalidates a response that captured its pending IDs too early.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [packages/snapback4/test/review-replica.test.mjs](../../snapback4/packages/snapback4/test/review-replica.test.mjs)
- [packages/snapback4/test/client-lifecycle.test.mjs](../../snapback4/packages/snapback4/test/client-lifecycle.test.mjs)
- [packages/snapback4/test/react.test.mjs](../../snapback4/packages/snapback4/test/react.test.mjs)
