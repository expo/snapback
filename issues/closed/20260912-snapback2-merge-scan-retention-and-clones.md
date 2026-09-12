# snapback2 merge/scan retain O(examined) and clone per row

**Status:** Closed
**Priority:** P1
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `merge.rs:199`, `lane.visible:365`, `:374`; `scan.rs:363`, `:344`, `:375`, `:398-417`

## What was reported

- `merge.rs:199` — `BTreeSet<String>` cloned ids plus `row.clone()` per
  row, while `lane.visible:365` retains **all examined bodies**: peak
  memory is O(examined), not O(take). `:374` meters `heap_before` per
  comparison plus boxed `Value` keys: O(n log n) dynamic ordering.
- `scan.rs:363` — three id passes (`:344`, `:363`, `:375`) plus ~15
  per-range clones (`:398-417`).

## Suggested fix

- Borrow ids instead of cloning; single pass over ranges; take-bounded
  retention (drop non-visible bodies); avoid per-comparison metering on
  the hot path.
- Benchmark with a large-examined/small-take query before and after.

## Acceptance

- Peak memory for examined≫take queries is bounded by take (+ window),
  with measurements recorded in the ticket.

## Resolution (2026-09-12)

Confirmed a narrower issue than the report: hidden examined row bodies already drop immediately; required examined-id trace evidence remains O(examined). Overlapping nonuniform lanes could retain duplicate authorized row bodies. A merge-local Rc pool now retains one body per intrinsic id, bounded by take+lanes+2, while preserving each lane's identities, returned membership, halo/N2 evidence, ordering and exact metering. Returned rows move out after lane/pool teardown. Duplicate seen ids no longer allocate temporary Strings. Ordinary scans borrow the halo and reuse the visible id pass; necessary trace/receipt ownership copies remain.

Standalone measured regression:2000 stored posts,2KiB bodies,32 overlapping nonuniform lanes,take3. Both versions examine193 candidates and publish38 receipt rows (32 discovery+6 posts). Peak measured Rust allocations575820→187807 bytes (67.4% reduction); representative query wall time10.294ms→6.014ms, informational under shared host load. SQLite's C allocations are excluded and trace identity vectors intentionally remain O(examined). The ignored standalone allocation regression asserts<300000 bytes; run alone with cargo test -p snapback2-core --test merge overlapping_merge_retention_profile -- --ignored --nocapture.

Validation:16 merge and13 spike tests pass; full293-case exporter freshness and266-case twin parity pass. Per-comparison step charging remains because certificate bounds require it.
