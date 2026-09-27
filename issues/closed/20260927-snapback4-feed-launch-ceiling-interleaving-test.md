# Snapback 4: atomic Following launch — the in-lock ceiling recheck lacks an interleaving test

Opened 2026-09-27 at lane FA's landing. Severity: Low (test gap; the code is correct).
Source: `~/sb4-intent/reviews/fa-r4.astra.md` (READY).

`Store::activate_at_with_launch` repeats the launch preflight under SQLite's writer
lock (`store/activation.rs:111`), after the unlocked estimate. The ceiling tests
use quiescent sources, so a mutation that reuses the unlocked estimate survives.

Scenario: 1,000 originals and 4,999 followers estimate exactly 5,000,000 copies.
After that estimate, another connection commits one more follow before activation
takes the writer lock; the new total is 5,001,000. Current code refuses; the
mutant would proceed.

Fix: add a deterministic pause between the two admission points, commit that
follow, then assert refusal before any candidate write and an unchanged
generation, sequence, slot set and owned catalog.

## Resolution — 2026-09-27, lane FA round 5

Closed by `copy_ceiling_rechecks_a_follow_committed_between_estimate_and_writer_lock`
in `snapback4/crates/snapback4-lang/tests/following_atomic_launch.rs`. A SQLite
authorizer pauses before BEGIN IMMEDIATE, after the unlocked 5,000,000-copy
estimate. Another engine commits the extra follow; the in-lock 5,001,000-copy
recheck refuses with `E_TIMELINE_ACTIVATE`, zero SQLite updates and zero attempted
candidate catalog inserts. The test preserves the durable/cached generation,
the sequence after the valid follow, every source image/slot and the complete
catalog, and checks all four owned tables remain empty.

The regression passes and fails when the in-lock preflight is deliberately
removed; the production code was restored before the passing affected suite. No
production hook was added. Evidence: `snapback4/experiments/following-adoption/atomic/ROUND5.md`.
