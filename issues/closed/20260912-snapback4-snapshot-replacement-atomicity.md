# Snapback 4: Replace snapshot rows and their watermark in one transaction

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R05
Evidence: Reproduced with the Node SQLite adapter and an injected write failure
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.001](../../llp/3000.001-durable-replica-and-write-lifecycle.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`Replica.apply` calls `clearRows()` before opening the transaction that installs
a snapshot and watermark. Generation reset has a similar split. If the second
step fails, the old watermark remains but the corresponding rows are gone.
Incremental recovery can then resume past the missing data.

Reproduction: persist row `old` and watermark 10; apply a replacement snapshot
for watermark 11 through a store wrapper whose next `write` throws `disk full`.
After the failure, the row is absent and the watermark is still 10. This used
real `node:sqlite`, not the simulator's disk model.

Move clear/replace into the same store transaction as events, indexes,
generation and watermark. The IndexedDB clear helper must also await
transaction completion, not only successful clear requests. Fault-inject at
each replacement boundary on persistent adapters: reopening must yield the
entire old state or the entire new state. Include generation reset and pending
prediction treatment in the same acceptance scenario.

## Implementation locations

- [packages/snapback4/src/replica/replica.ts](../../snapback4/packages/snapback4/src/replica/replica.ts)
- [packages/snapback4/src/replica/store.ts](../../snapback4/packages/snapback4/src/replica/store.ts)
- [packages/snapback4/src/replica/sqlite.ts](../../snapback4/packages/snapback4/src/replica/sqlite.ts)

## Resolution — 2026-09-13

Snapshots and intervening catch-up deltas stage privately; the drained final transaction replaces rows, indexes, acknowledgements and watermark and rebases predictions. Durable owner and send-revision checks protect Memory, IndexedDB, SQLite and native stores.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [packages/snapback4/test/review-replica.test.mjs](../../snapback4/packages/snapback4/test/review-replica.test.mjs)
- [packages/snapback4/test/client-lifecycle.test.mjs](../../snapback4/packages/snapback4/test/client-lifecycle.test.mjs)
- [crates/snapback4-device/tests/native.rs](../../snapback4/crates/snapback4-device/tests/native.rs)
