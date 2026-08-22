# `s5_d10_production_diagnostic_inventory_cannot_drift` fails: stale exclusion SNAPBACK_ELEVATED_READ_TRACE

Status: Open
Created: 2026-08-21
Related: LLP 0283 F-1

## Symptom

`cargo test -p snapback-server --lib s5_d10_production_diagnostic_inventory_cannot_drift` fails:

    stale exclusion: SNAPBACK_ELEVATED_READ_TRACE

The assertion is `crates/snapback-server/src/server/tests.rs:24580`
(`assert!(emitted.remove(*literal), "stale exclusion: {literal}")`), driven by the exclusion
literal listed at `crates/snapback-server/src/server/tests.rs:21893`.

## Cause

The literal is listed as an *excluded* production diagnostic, and the test asserts every excluded
literal is still actually emitted. `SNAPBACK_ELEVATED_READ_TRACE` is no longer emitted from a
production path — it now appears only as an env-var name at
`crates/snapback-runtime/src/elevated_read_trace.rs:18` (`const TRACE_ENV`).

That file arrived on main with `39a97e8c3 refactor: preserve phase 2 crate moves`. The crate move
relocated the trace machinery; the exclusion list in the server tests was not updated to match.

## Not caused by the fence work

Recorded because it surfaced during LLP 0283 F-1 verification and could be misattributed. The
`lane/modefence` change touches only:

- `crates/snapback-engine/src/local/admission_fence_tests.rs`
- `crates/snapback-engine/src/local/engine.rs`
- `crates/snapback-kernel/src/storage.rs`
- `crates/snapback-server/src/server.rs`

It does not touch `crates/snapback-server/src/server/tests.rs` (so neither the exclusion list nor
the drift test) and does not touch `crates/snapback-runtime` at all. The failure reproduces
independently of it.

## Fix

Decide which is true and make the list say it:

1. The trace is intentionally no longer a production diagnostic — remove the literal from the
   exclusion list.
2. The trace should still be emitted from a production path — restore the emission the crate move
   dropped.

Option 2 is the one to check first: an elevated-read trace that silently stopped being emitted is
a loss of security-relevant observability, not merely a stale list entry. Confirm whether the
emission was deliberately removed or lost in the move before deleting the row.
