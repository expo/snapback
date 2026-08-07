# Row-13 lifecycle bench overwrites the prior dated receipt in place

**Status:** Open
**Systems:** Testing, Instance forks
**Date:** 2026-08-07
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
