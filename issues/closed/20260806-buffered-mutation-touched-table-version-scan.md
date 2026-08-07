# Buffered mutations scan every touched application table before commit

**Status:** Resolved (2026-08-06)
**Severity:** P1
**Systems:** Storage, Runtime, Mutations, Performance, Large fixtures
**Date:** 2026-08-06
**Related:** LLP 0003, LLP 0007, LLP 0109, LLP 0183;
`src/storage.rs`; `demos/zerobugs/control/scripts/load-large-fixture.mts`

## Problem

Every buffered application mutation calls `validate_touched_managed_tables`
before applying its writes. For each touched application table, that function
calls `validate_managed_table_versions_by_name`, whose healthy-case query is:

```sql
SELECT 1
FROM <table>
WHERE typeof(_version) <> 'integer'
   OR _version <= 0
   OR _version > ?1
LIMIT 1
```

There is no physical index that bounds this dynamic invalid-version predicate.
When every row is valid—the normal case—SQLite must examine the complete table
to prove absence. `EXPLAIN QUERY PLAN` reports `SCAN issue`. Adding an ordinary
index on `_version` only changes this to `SCAN issue USING COVERING INDEX ...`;
it remains proportional to table size.

The Zerobugs Lane 8 authoritative fixture exposed the cost before the issue
table reached 132,000 of its planned 1,000,001 rows. The supervising live run
measured batches 1–50 at 2.43 seconds/batch and batches 50–150 at 3.69
seconds/batch. Each batch contains at most 900 rows, but the precommit integrity
scan grows with all previously committed rows. The projected ingest is over six
hours and superlinear rather than the plan's sub-450 ms/batch target.

The fixture handler's explicit reads are not the growing term: ledger replay
uses an equality lookup on the unique `(fixtureId, overlayDigest, batchIndex)`
index, committed-row recovery uses `_id` point reads, and its sentinel/user
checks are bounded by `take(1)`/`take(101)`. The client maintains source/runtime
maps incrementally and touches only the current batch. No fixture-layer schema
index can remove the runtime's mandatory touched-table scan.

This affects every buffered mutation path that invokes
`validate_touched_managed_tables`, not only fixture ingest. Large-table write
latency therefore grows with table cardinality even when the handler performs
only indexed point reads and a bounded number of writes.

## Fix shape

- Preserve the fail-closed managed-version integrity check without proving it
  by a healthy-case full scan on every commit.
- A likely SQLite shape is a runtime-owned per-table partial index for values
  outside the fixed portable domain, plus an indexed maximum-version check for
  the transaction's current head. The exact design must handle SQLite storage
  classes, schema migration/rebuild, restore, corruption injection, and all
  writer lanes; an authored application index is not the authority.
- Keep corrupted `_version` values refusing before effects with the existing
  `SNAPBACK_STORAGE_VERSION_CORRUPT` contract.
- Add an executable plan/statement-status witness proving the healthy path does
  no table-cardinality scan, and a scale benchmark whose fixed-size buffered
  batch cost does not grow with the target table.

## Done when

- A mutation touching 900 rows in a 1,000-row table and the same mutation in a
  1,000,000-row table perform bounded managed-version validation independent of
  table cardinality.
- Corrupt non-integer, non-positive, above-portable-maximum, and future-head
  `_version` values still refuse before any application effect.
- Schema activation, migrations, restores, HostPlan, JS buffered mutations,
  dry runs, and membership/resource counterpart validation use the same
  integrity authority without reintroducing a full scan.
- The Zerobugs large-ingest supervisor demonstrates the required sustained
  per-batch target on the repaired runtime.

## Resolution (2026-08-06)

Implemented the fix shape as specified, mirroring the change journal's
`_snapback_changes_invalid_committed_version` sentinel for managed
application tables. The local runtime now owns two indexes per managed
table (`src/storage.rs`, `ensure_managed_version_integrity_indexes`):

- `_snapback_version_domain_<table>` — a partial index over exactly the
  invalid-version predicate (non-integer storage class, `<= 0`, or above
  the portable maximum as a literal), empty on every healthy table;
- `_snapback_version_head_<table>` — an ordinary `(_version)` index
  supporting the forged-future range probe against the transaction head.

`validate_managed_table_versions_by_name` probes both via `INDEXED BY`
after a cached `sqlite_schema` currency proof, so healthy-case validation
is O(corrupt rows + log n) and independent of table cardinality. A table
whose runtime indexes are absent or predicate-stale (adopted database
mid-upgrade, staged-rename window) validates by the original unbounded
scan — correctness never degrades, only speed. The indexes are ensured at
`create_or_update_table` (activation, migrations, optional→required
rebuilds), inside the staged-generation swap and rollback rename
transactions, and at every open, which still refuses corruption before
performing any additive DDL. Stray runtime indexes left by renames are
swept. The `_snapback` prefix is barred from authored identifiers, so the
names cannot collide. Governing contract documented as a dated note in
LLP 0007 §Commit-version graduation (fail-closed semantics unchanged).

Every corrupt class — REAL/TEXT/BLOB storage classes, zero, negative,
above-portable-maximum, and integer future-head below the portable
maximum — still refuses with `SNAPBACK_STORAGE_VERSION_CORRUPT` before
any effect, on both the indexed path and the fallback (test matrix in
`src/storage.rs` `guarded_commit_tests`).

**Witnesses (all in-tree, deterministic):**

- `managed_version_validation_plans_use_bounded_runtime_indexes` — EXPLAIN
  QUERY PLAN shows the domain probe on the partial index, the head probe as
  an indexed SEARCH, and pins that the legacy dynamic predicate remains a
  cardinality SCAN.
- `buffered_managed_version_validation_cost_is_cardinality_independent` —
  VM-opcode counts (progress handler, period 1) for an identical buffered
  mutation at 1,000 vs 50,000 rows: indexed path bounded (≤ 2x + constant),
  legacy scan demonstrably linear (> 20x).
- Reopen upgrade/predicate-drift rebuild, refusal-before-DDL on corrupt
  legacy databases, fallback refusal with indexes dropped, and
  staged-swap/rollback index reconciliation tests.

**End-to-end receipt (real JS mutation lane over HTTP, chirp `createPost`,
one insert per call, debug binaries, 200-call windows):**

| posts rows | pre-fix ms/call | post-fix ms/call |
|-----------:|----------------:|-----------------:|
|      1,001 |            20.6 |             20.8 |
|     31,221 |            28.3 |             20.9 |
|    151,441 |            61.0 |             21.8 |

Pre-fix grows 2.97x over this range (~0.27 ms per 1,000 rows, linear —
extrapolating to ~290 ms/call at 1M rows, consistent with this ticket's
six-hour ingest projection); post-fix is flat (1.05x) through 151k rows,
past the 132k-row point where the Lane 8 live run degraded.

**Remaining leg:** the Zerobugs Lane 8 large-ingest supervisor rerun
against the landed commit (the "sustained per-batch target" bullet) is
unblocked and stays with the LLP 0183 program's supervising session — the
runtime scan this ticket names is gone.
