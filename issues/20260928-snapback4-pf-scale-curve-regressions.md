# Snapback 4: PF scale-curve regressions pin too little

- **Status:** Open
- **Date:** 2026-09-28
- **Area:** `snapback4/crates/snapback4/tests/scale_curves.rs`, `snapback4/crates/snapback4-core/src/store.rs:87-91, 948-951`, `word_heap/tests.rs:262, 285-286`
- **Found by:** Grok's review of lane PF round 0 (`~/sb4-intent/reviews/pf-r0.grok.md` on the EPYC host), READY with two Lows

1. The search regression (`scale_curves.rs:227-242`) freezes its first population as the baseline, so one extra constant statement at 10, 50 and 100 postings still compares equal. Pin an absolute statement count, as Insights does (`scale_curves.rs:299-306`: 20 preflights and 4 payloads).
2. Nothing checks that the two skipped-read statements in `store.rs` keep the same join, bounds and limit; the byte ceiling at `word_heap/tests.rs:262` still admits the old two-statement 2,048 B. Assert the statement shape and tighten the ceiling.
