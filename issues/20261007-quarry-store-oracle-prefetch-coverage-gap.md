# Quarry store oracle does not exercise Postgres prefetch

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Snapback 4, Quarry, differential testing
**Date:** 2026-10-07
**Related:** LLP 3000.035 §5.1

The 2,000-seed DT-B Continuation 1 negative control changed the first consumed
cached hit into a cached miss (`Some(None)`, so it does not request a fallback).
The generated campaign reported zero marked reads and zero transferred prefetch
rows in both modes. Its counts and 12 existing low-budget signatures were exactly
the unchanged-engine baseline: 30,584 attempts, 29,400 passes and 1,184 disagreements
per Postgres mode; zero incremental disagreements detected this planted fault.
This is a generator coverage gap, not a successful prefetch qualification.

`generate.rs` emits no related-key read in a page projection or loop. The batch
planner therefore has no marked requests to fill. Add generated cross-table
point reads whose keys vary across page rows, including enough distinct keys to
exercise an actual batch fill. A useful fixture pages eight `items`, each with a
`tag: id`, and projects `access[.tag]`; the eight access rows have distinct IDs and
`read <- .owner = viewer`. A focused test of that shape observed eight marked and
eight transferred rows. With the fault one membership became null; after the
fault was reverted the complete SQLite and Postgres outcomes were equal.

A public `access` table is insufficient for this consumed-cache control: its
point read uses the metered scan path. That fixture can transfer prefetched rows
without consuming the modified cached answer. Coverage must track effective
cache consumption as well as batch transfer, rather than infer consumption from
nonzero transfer counters alone.

Acceptance: generate and shrink these shapes; report actual batch/consumption
coverage; rerun at least 2,000 seeds with a single cached-hit-to-miss fault and
require an outcome disagreement; revert the fault and check the complete records
with prefetch on/off. Preserve ordinary engine behavior and exact meter fields.
The cache fault was made only in a scratch clone, restored with `git checkout
HEAD -- crates/snapback4-core/src/engine/postgres/prefetch.rs`, and followed by
`git diff --quiet -- crates/snapback4-core` (exit 0). No engine fix is included.

Evidence: `~/projects/snapback-difftest-lane/dt-b-cont1/control-prefetch-final4/`,
`control-prefetch-final4.patch`, `control-prefetch-final4-focused.log`,
`control-prefetch-final4-focused-reverted.log`, and `report-b.md`, Continuation 1.
