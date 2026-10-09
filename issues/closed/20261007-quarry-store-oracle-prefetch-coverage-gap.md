# Quarry store oracle does not exercise Postgres prefetch

**Status:** Closed (2026-10-08, lane GW: the widened generator reaches prefetch; the planted fault is caught by the random corpus)
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

## Resolution

**Closed 2026-10-08 (lane GW, branch `sb4/difftest-widen`).** The generator
(`snapback4/crates/snapback4-difftest/src/widen.rs`) now emits
prefetch-reachable reads from a stream independent of the base generator:

- half of the generated pages (and a fifth of the scalar cases, converted to
  pages) project `{ id, [score,] t: tags[.tag], u: tags[name = .label] }`,
  a cross-table `Get` and a unique `Lookup` whose keys vary across the page's
  six to fourteen rows;
- a quarter of those conversions are a loop, `for row in <page>: t =
  tags[row.tag] ...` (the planner's `For` path);
- `tags` has distinct ids `tag0..tag6`, a unique `name`, and mostly
  `read <- .owner = viewer` (also `allow` and `deny`), so the consumed path
  the ticket describes is reached.

Coverage is reported, including consumption: `store_stats` gains
`prefetch_cases_with_transfer` and `prefetch_consumption_witness_probes` /
`prefetch_database_calls_saved` (a probe whose prefetch-on run makes fewer
database calls than its prefetch-off run consumed cached answers; the cache
neither authorizes nor meters, so this physical witness is the only one the
API exposes). `tests/stores.rs::widened_reads_fill_and_consume_the_prefetch_cache`
asserts marks, transfers and consumption.

**Seeds 0–19,999** (`run-stores`, 8 workers, unchanged engine): 1,957 cases
transferred rows; 1,507,828 marked reads, 619,942 rows and 56,069,837 bytes
transferred with prefetch on (none off); 49,523 probes consumed cached answers,
saving 159,482 database calls. Zero disagreements in 519,898 attempts per
mode.

**The control** (this ticket's acceptance): the patch
`~/projects/snapback-difftest-lane/dt-b-cont1/control-prefetch-final4.patch`
(the first consumed cached hit becomes a cached miss) applied to
`crates/snapback4-core/src/engine/postgres/prefetch.rs`, seeds 0–1,999,
8 workers:

- faulted: `store-postgres-on` 1,523 disagreements in 50,352 attempts under
  27 signatures (e.g. `store-postgres-on--budget-data--array`,
  `--examined-continuation-data--array`, `--steps-refusal--E_BOUND`);
  `store-postgres-off` 0;
- reverted with `git checkout HEAD -- snapback4/crates/snapback4-core/src/engine/postgres/prefetch.rs`;
  `git diff --quiet -- crates/snapback4-core crates/snapback4-device crates/snapback4-lang/src/bind`
  exited 0; the same 2,000 seeds then gave 0 disagreements in 50,352 attempts
  per mode, with the same transfer and consumption counters (186 cases with a
  transfer, 4,707 consuming probes).

Ordinary engine behaviour and the exact meter fields are unchanged; no engine
code changed.
