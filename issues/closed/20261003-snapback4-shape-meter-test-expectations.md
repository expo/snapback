# Snapback 4: shape-meter diagnostics leave existing test expectations stale

Status: Closed
Date: 2026-10-03
Scope: Test expectations following LLP 3000.007 §24 / the landed UB diagnostic

Lane A's required complete suite exposed four assertions that still require no
compiler notes where `N_SHAPE_METER` now reports the returned shape's residual
candidate work. The same failures reproduce on untouched base
`1bea1a149c6df00bae7276c7114c06ea5749b7bf`, with Rust 1.97.0:

- `snapback4-lang --test prefix_reads`: `explicit_caps_stay_silent_and_predicting_short_pages_stay_refused` and `prefix_reads_compile_without_notes_and_caps_follow_one_schema_number` (8 passed, 2 failed).
- `snapback4-sim --test membership_search`: `edges::calendar_repair_executes_the_same_offset_boundary_predicate` and `refusal_rewrite_compiles_on_its_schema_and_keeps_filters_in_both_searches` (22 passed, 2 failed).

Update only the note expectations that now intentionally carry the diagnostic;
keep the query/result and refusal-rewrite assertions. Do not silence the new
warning or change the presentation lane's read/withdrawal semantics to make
these unrelated tests green.

Reproduction commands, base source custody and lossless logs:
[Lane A report](../snapback4/reports/20261003-a-read-presentation/REPORT.md).

Resolution (2026-10-03): test expectations updated as this ticket asks. The four
assertions now accept lane UB's `N_SHAPE_METER` notes and still reject every other
note and every diagnostic. The query, result and refusal-rewrite assertions are
unchanged. `snapback4-lang --test prefix_reads` passes 10/10 and
`snapback4-sim --test membership_search` passes 24/24 on eb1000.
