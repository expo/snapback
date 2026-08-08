# Row-13 lifecycle bench overwrites the prior dated receipt in place

**Status:** Closed
**Systems:** Testing, Instance forks
**Date:** 2026-08-07
**Resolved:** 2026-08-07
**Related:** LLP 0158, LLP 0185; `tests/instance_fork_bench_v1.rs`

Running `cargo test --release --test instance_fork_bench_v1 -- --ignored`
at a new qualification commit rewrote
`tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json`
in place (commit field and measurements replaced) rather than minting a new
dated receipt. Dated evidence should be append-only — the promotion-bench
convention ("creates a new dated record and refuses overwriting an old one")
is the right model. Fix: date the output filename from the run date and
refuse to overwrite an existing receipt. Found during the 2026-08-07
requalification; the working-tree overwrite was discarded, not landed.

## Resolution — 2026-08-07

The row-13 emitter now derives the UTC run date and writes
`instance-fork-lifecycle-bench.<run-date>.<platform>.v1.json`. Its write helper
opens the destination with exclusive create semantics, syncs the complete
canonical bytes, and returns `AlreadyExists` rather than truncating a retained
same-date/platform receipt. A non-benchmark regression test writes one receipt,
attempts a replacement, and proves the original bytes remain unchanged.

No evidence receipt was fabricated as part of this repair. The supervisor must
still run
`cargo test --release --test instance_fork_bench_v1 --no-run` and one real
`cargo test --release --test instance_fork_bench_v1 -- --ignored --nocapture`
run on a bootstrapped host before using the emitter's output for
requalification.
