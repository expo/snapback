# Snapback 4: Isolate unrelated asynchronous SQLite transactions

Status: Open
Priority: P1
Observed: 2026-09-12
Review finding: R07
Evidence: Node SQLite failure reproduced; Expo driver has the same shared-depth pattern
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.001](../llp/3000.001-durable-replica-and-write-lifecycle.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

Both SQLite drivers use one `depth` counter and run `body()` directly whenever
another transaction is active. An unrelated asynchronous caller is treated as
nested work in that caller's transaction. A successful write can therefore
resolve before its changes commit and later disappear on another caller's
rollback. Reads can also join that uncommitted transaction.

Reproduction with `node:sqlite`: transaction A writes row A, waits on a promise,
and will throw. While it waits, transaction B writes row B and resolves.
Release A's wait so it rolls back. Row B is missing despite B's successful
return. The Expo port uses the same depth logic and runs statements through
the shared database rather than an exclusive transaction handle; the Expo
failure was not executed on a simulator in this review.

Serialize independent transaction scopes and keep their statements attached
to the owning transaction. Define intentional nesting separately or refuse it.
Run concurrent write/write and read/write cases with rollback and commit on
both adapters, and verify each returned success is durable with respect to
that adapter's documented commit contract.

## Implementation locations

- [packages/snapback4/src/replica/sqlite.ts](../snapback4/packages/snapback4/src/replica/sqlite.ts)
