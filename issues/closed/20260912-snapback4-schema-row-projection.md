# Snapback 4: Apply the declared row projection when columns or tables are removed

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R02
Evidence: Reproduced; dropped-table consequence code traced
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.000](../../llp/3000.000-atomic-schema-and-release-activation.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

Removing a column changes schema metadata without removing that column from
persisted row objects. Reads return the entire old object. Later row validation
can reject an update because it still contains the now-undeclared field.
Removed table/catalog entries also remain available for accidental resurrection
if their names are introduced again.

Reproduction: seed `items { id: "a", obsolete: "retained" }`, adopt a table
containing only `id`, and point-read `items['a']`. The returned object still
contains the removed column; the probe used the same sequence with a field
named `secret`.

Implement the successor's exact projection at the activation boundary. Apply
it consistently to point reads, range reads, partition snapshots, indexes and
maintains. Define disposal/retention of dropped tables outside the active
namespace, rather than silently reviving their old contents. Verify an old row
can be updated after removal, removed fields never appear in new-generation
results, and a failed projection leaves the old activation intact. The
explicit destructive-change policy still governs data removal.

## Implementation locations

- [crates/snapback4-core/src/store.rs](../../snapback4/crates/snapback4-core/src/store.rs)
- [crates/snapback4-core/src/engine/mod.rs](../../snapback4/crates/snapback4-core/src/engine/mod.rs)

## Resolution — 2026-09-13

Activation removes undeclared fields, materializes optional fields, and erases dropped table/index contents without reusing catalog numbers or resurrecting rows on reintroduction.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [crates/snapback4-sim/tests/review_corrections.rs](../../snapback4/crates/snapback4-sim/tests/review_corrections.rs)
