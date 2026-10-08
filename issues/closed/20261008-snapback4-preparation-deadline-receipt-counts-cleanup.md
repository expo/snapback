# Snapback 4: preparation deadline receipt charges subsequent cleanup

Status: Closed — 2026-10-08, FS
Date: 2026-10-08
Scope: witness preparation deadline receipt and `live_output_passes_original_budget_and_stalled_child_is_drained`

FS's unchanged baseline fails the positive receipt assertion in all 30 loaded witness-module runs: the child succeeds, but `expired` is true when the receipt is read. `node_with_deadline` calls `Deadline::finish`, which samples `Instant::now()`, only after bounded child/group cleanup. The fixture uses a 500 ms idle limit and five-second cap around actual Node output. Cleanup can consume the remaining idle window after the preparation outcome was already decided.

This is a product diagnostic bug. Capture the preparation completion time before cleanup, retain cleanup's separate deadline and success requirement, and write the receipt afterward using that captured time. Neither runtime bound nor the test's assertion should be raised or weakened. Add a virtual-time receipt regression whose observation clock is beyond the hard cap while the recorded preparation completion is before expiry, plus the exact expired-boundary control.

Evidence and final disposition: [FS report](../../snapback4/reports/20261008-fs-witness-worker-flakes/REPORT.md).

## FS resolution — 2026-10-08

Fixed the product receipt timestamp: capture preparation completion before descendant cleanup, then persist that snapshot only after cleanup succeeds. Idle/hard limits and group cleanup are unchanged. The existing real-output/forced-stall test passes all 30 final loaded witness runs (baseline failed 30/30); the new virtual-time receipt regression passes 30 dedicated loaded runs plus those 30 neighbour runs. Restoring the late clock sample fails the new regression. Complete affected Rust targets pass 335 CLI tests (four existing ignores) and 32 Linux witness integration tests.

[Full commands, baseline/final logs, controls and limits](../../snapback4/reports/20261008-fs-witness-worker-flakes/REPORT.md).
