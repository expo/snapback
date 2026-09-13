# Snapback 4: Make MemoryStore honor the store transaction contract

Status: Open
Priority: P2
Observed: 2026-09-12
Review finding: R08
Evidence: Reproduced
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.001](../llp/3000.001-durable-replica-and-write-lifecycle.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`MemoryStore.write` invokes the body against live maps. It has neither rollback
nor isolation, unlike the interface contract and persistent store behavior.
A prediction that writes one row and then refuses can leave the row visible
without a successfully admitted outbox entry.

Reproduction: call `write`, put row A, then throw. Catch the error and read A;
the row is still present. This also makes tests using `store: "memory"` a
poor witness for transaction-dependent client behavior.

Provide transactional staging/commit or an equivalent rollback-safe
implementation for rows, indexes, metadata and side tables, with serialization
of independent callers. Reuse the same rollback and overlapping-call examples
as the persistent adapters. A failed multi-step prediction must leave no
partial row/index change and no false pending write.

## Implementation locations

- [packages/snapback4/src/replica/store.ts](../snapback4/packages/snapback4/src/replica/store.ts)
