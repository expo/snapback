# main does not compile: `current_version` is `pub(super)` but an integration test calls it

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Severity:** P0
**Systems:** Storage, Testing, CI
**Author:** Claude (Opus 5), directed by Charlie Cheever
**Date:** 2026-08-09
**Related:** LLP 0199, LLP 0175,
issues/20260809-0199-ownership-ratchet-worklist.md

`main` does not build its test targets. Both `rust-tests` and `cargo-clippy`
exit 101 in every `local-proof` run, which also strands every dependent gate.

From `local-proof` run 31336469578 (`862ee7f68`):

```
error[E0624]: method `current_version` is private
   --> tests/structural_validation_v0.rs:226:33
    |
226 |         let version_before = db.current_version().expect("version before case");
    |                                 ^^^^^^^^^^^^^^^ private method
    |
   ::: src/storage/versions.rs:13:5
    |
 13 |     pub(super) fn current_version(&self) -> SnapbackResult<u64> {
    |     ----------------------------------------------------------- private method defined here

error: could not compile `snapback` (test "structural_validation_v0") due to 6 previous errors
error: could not compile `snapback` (lib) due to 18 previous errors
```

Six call sites in `tests/structural_validation_v0.rs` reach
`db.current_version()`; the resolving impl was narrowed to `pub(super)` by
`f0eaae6b7` ("refactor(0199): owner #2 slice 8 — versions/journal + checkpoints
kernel facades") earlier the same day. `src/storage/versions.rs` now carries
three `current_version` definitions (lines 13, 263, 348); only the `pub(super)`
one is reachable from the test's receiver.

The refactor compiled for `src/`, so nothing in the owning change surfaced it —
integration tests under `tests/` are a separate crate and only fail at
`cargo test`/`cargo clippy --all-targets` time.

## Why this is filed rather than fixed

The correct repair depends on the slice-8 encapsulation intent, which the
owning session holds:

- widen the facade method back to `pub(crate)`/`pub`; or
- give the test a facade-appropriate accessor and stop reaching through; or
- move the assertion inside the module boundary.

Guessing wrong re-breaks the ownership ratchet this refactor exists to
establish. Handing it to the owner is cheaper than reverting.

## Note on the second error

`could not compile snapback (lib) due to 18 previous errors` is a distinct
failure surfaced under `cargo clippy --all-targets -- -D warnings` (lint-level
promotion), not the same E0624. It needs its own triage; the lib itself builds
for `cargo build --bin snapback`.

## Verification

Fixed when `cargo test --no-run` and `cargo clippy --all-targets -- -D warnings`
both succeed on `main`, and a `local-proof` run reports `rust-tests` and
`cargo-clippy` as PASS rather than exit 101.
