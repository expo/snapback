# Snapback 4: blocked-stderr recovery test can observe an earlier add39 record

Status: Open
Date: 2026-10-04
Scope: `snapback4/crates/snapback4/tests/dev_refusals.rs`

The SX full suite on eb1000 failed
`blocked_stderr_cannot_block_responses_or_later_mutations` at line 147:
the asserted recovered refusal record had `dropped: 0`. It contained only
request IDs 9–40, ending in operation `add39`, despite the test already
issuing 4,096 refusals before draining stderr. The loop accepts the saved
record when its last operation is `add39`, which also names an earlier
refusal; matching that name alone does not prove the post-drain request
was persisted. This is a likely stale-observation race, not an established
loss of the production recovery guarantee.

The same compiled test binary immediately passed an isolated rerun in
2.15 seconds. Neither the test nor its diagnostic worker was changed by SX.
The full-suite failure remains recorded; a passing rerun is not a green
full suite or proof of a cause.

Reproduction/evidence:

- Baseline `a8762e0556`, SX working changes limited to SQL/catalog inspection,
  sync-window advice/docs and their tests.
- Full suite: 24 CPUs (24–47), eight Cargo jobs, eight Rust test processes,
  `CARGO_INCREMENTAL=0`, dev/test debug info disabled, Node 24.13.1.
- [SX report](../snapback4/reports/20261004-sx-sql-inspection/REPORT.md),
  `full-suite.log.gz` and `stderr-control.log.gz` alongside it.

Follow-up: bind recovery to the new refusal's request identity or another
monotonic post-drain observation, then check the dropped count. Keep the
blocked-sink/nonblocking-response assertion and exercise it under concurrent
load. Do not relax the dropped-count assertion or add a blind delay.
