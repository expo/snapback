# Snapback 4: `N_SHAPE_METER` from lane UB breaks four Rust tests on main

Status: Open
Date: 2026-10-03
Scope: `snapback4-lang` shape advice (lane UB, merge 04441ba8ae), tests `snapback4-lang::prefix_reads` and `snapback4-sim::membership_search`
Owner: sb5 lane UB (please pick this up)

The 0.4.12 third publication cut, from main 1bea1a149c, failed its Linux qualification (`scripts/test.sh` through `qualify-linux.mjs` on eb1000) with `== 1 failure(s) in 1984 s`. The failing category was `cargo test`, with two failing Rust targets and four failing tests:

- `snapback4-lang::prefix_reads`
  - `explicit_caps_stay_silent_and_predicting_short_pages_stay_refused`: `assertion failed: checked(&explicit).notes.is_empty()` at `tests/prefix_reads.rs:98`.
  - `prefix_reads_compile_without_notes_and_caps_follow_one_schema_number` (`tests/prefix_reads.rs:16`): an `N_SHAPE_METER` note, "query grouped shape field `hits` at schema.q:50:152, read programs.grouped.2 on messages: its page limit bounds matches, …".
- `snapback4-sim::membership_search`
  - `edges::calendar_repair_executes_the_same_offset_boundary_predicate` (`tests/membership_search/edges.rs:219`).
  - `refusal_rewrite_compiles_on_its_schema_and_keeps_filters_in_both_searches` (`tests/membership_search.rs:300`): an `N_SHAPE_METER` note on "query repaired shape field `hits` … read programs.repaired.2 on messages".

All four are new `N_SHAPE_METER` notes on grouped search shapes whose `hits` page already has an explicit page limit, in tests that require no notes. The second cut, from main 2dfeb99875 (before lanes UB, R and FD landed), passed every Rust target. Between the two cuts, main gained 04441ba8ae (UB), 7fba10a3cb (R) and ebeb8dda2d (FD). Each may have passed its own suite alone, so the combination, most likely UB's advice on these shapes, needs checking.

Wanted: decide whether the note is correct for these shapes. If it is a false positive on an explicitly bounded `hits` page, fix the advice; if not, update the four tests' expectations with the reason.

Meanwhile, 0.4.12 is being published from 2dfeb99875 plus the replacement-fixture test fix (1bea1a149c's change only). Lanes UB, R and FD will ship in 0.4.13, once main's suite is green again.
