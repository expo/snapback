# Snapback 4 witness unit lease reacquisition flakes under parallel execution

Status: Open
Date: 2026-10-02

NX round 5's `cargo test -p snapback4 --bin snapback4 witness` returned 24/25:
`preparation::tests::lease_preserves_an_existing_owner_and_releases_on_drop`
failed `assert!(lease(&path).is_ok())` immediately after `drop(owner)`.
That test and the lease implementation are unchanged in this round. The earlier
same-task parallel run passed 25/25; every new publication/process regression
passed both times. Canonical `run-rust-tests.mjs` serializes the `snapback4` binary.

Possible cause: another concurrently spawning test can fork while the lock fd is
open, transiently keeping the shared open-file description until exec closes its
CLOEXEC descriptor. This has not been forced/reproduced and is not a confirmed
root cause. Investigate in an isolated fixture; preserve held-lock refusal and
release assertions rather than relaxing production custody.

Evidence: `snapback4/reports/20261001-nx-export-proves-native/round5/`
`rust-witness-development.log`, `rust-witness-final.log`,
`rust-witness-serialized.log`, and the single canonical full-suite record.
