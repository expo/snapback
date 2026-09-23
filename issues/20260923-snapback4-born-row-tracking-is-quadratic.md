# Snapback 4: born-row and born-grant tracking scans every event in the commit (O(n²) per commit), in 0.3.0

**Status:** Open — P1. A fix lane is targeting 0.3.1.
**Date:** 2026-09-23
**Owner:** the Snapback 4 0.3 program lead (0.3.0's release owner). The
change came from `0388900b8`, "rows and grants born and undone inside one
commit log nothing", from another session.
**Scope:** `snapback4-core/src/partition.rs`, `account_row_change` and
`withdraw`, on the log-bearing host (the server engine, sqlite).

## What happens

`account_row_change` scans the commit's whole event list:

1. **For every inserted row:**

   ```rust
   let earlier = runner.events.iter().filter(|event| matches!(event.kind, EventKind::Put | EventKind::Del) && event.table == key.0 && event.id == key.1).count();
   ```

   Each insert is O(current events), so a commit that inserts n rows costs
   O(n²) string comparisons.
2. **For every newly made grant,** the same scan runs over `Join` events.
3. **`withdraw`** runs `events.retain(..)` over the whole list each time a
   born row changes again, or a born grant is undone.

Small mutation commits are unaffected. Large commits pay quadratically:
seeds and imports, large fan-out, and bulk jobs.

## Evidence (M5, the complete suite's per-target times)

| Target | F1a suite (`f34f9be75`, before `0388900b8`) | F1 landing (`a63c37f7b`) | 0.3.0 dry run (`1a8165ae4`) |
|---|---:|---:|---:|
| `device::following::calibration::w8b_wired_calibration_acquisition…` | 17.0 s | 958.3 s | 994.5 s |
| `snapback4::init` (includes the residency calibration fixtures) | 45.5 s | 877.2 s | 627.7 s |
| `sim::clique::search_global::forms::w13e_newest…` | 17.6 s | 459.0 s | — |
| `sim::clique::following::following_is_full_and_complete_at_the_envelope` | 19.7 s | 286.6 s | — |
| `sim::clique::lane_domains::w13c2_five_thousand_lanes_cut_without_cursor` | 0.5 s | 6.1 s | — |

About 30 targets slowed 10–56×, all with large seeded fixtures. The
`0388900b8` landing's own journal entry records "two 50-minute device
measurement tests (following calibration, search forms) were stopped, not
completed". That was this regression.

`maintained-column` activation is event-free, so it is unaffected. F1's
per-like mirrors are small commits.

## Fix direction

Keep the semantics exactly: the disclosure explorer and `reviews.rs` pin
them.

- Maintain per-key counters alongside `runner.events`, keyed by
  `(table, id)` for Put/Del and `(partition, table, id)` for Join. Then
  `earlier` is O(1).
- Make `withdraw` proportional to the key's own events, not the whole
  commit. For example, record event indices per key and mark withdrawn
  events, compacting once at the commit's end. Every reader of
  `runner.events` must then skip or never see withdrawn entries.
- Add a timing regression: a 20,000-row seed commit stays within a few
  seconds.
- Rerun `sim/tests/reviews.rs`, the exhaustive explorer and w13g.

## Calibration note

Calibration #18 (`snapback4@0.3.0`) was already running when this was found.
Its reading must check the builder's seed and replay timings for this
confound.
