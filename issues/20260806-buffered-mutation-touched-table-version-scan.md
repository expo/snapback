# Buffered mutations scan every touched application table before commit

**Status:** Open
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
