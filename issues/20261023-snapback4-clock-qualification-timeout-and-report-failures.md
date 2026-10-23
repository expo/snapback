# Snapback 4: clock expiry-drain timeout and large-report assertion

Status: Open
Date: 2026-10-23
Scope: snapback4/crates/snapback4/tests/clock.rs

P1-EV-1's full binary sweep and isolated repeats both fail:

- `advance_drains_expiry_across_multiple_bounded_sweeps`: the HTTP helper's
  30-second socket read returns `WouldBlock` at clock.rs:78.
- `kit3_large_clock_report_uses_complete_http_and_runnable_no_argument_commands`:
  `large.stdout.len() > 65_536` fails at clock.rs:1144.

The isolated commands select each test separately in `cargo test -p snapback4
--test clock NAME -j 5 -- --nocapture`. They still share the host with another
lane's builds. Both `clock.rs` and the clock verb source are byte-identical to
the lane's base `06a9d2c47f`; these witnesses exercise SQLite. This is evidence
of unresolved qualification failures, not proof of their cause or an exact-base
rerun. Neither timeout nor assertion was relaxed. Builds used line-tables-only
debug profiles and this worktree's target.

Full and isolated logs are retained in
[the lane report](../snapback4/reports/20261023-p1-ev1-schema-evolution/REPORT.md).
Investigate the actual HTTP/clock completion and the large command's captured
stderr before changing any bound.
