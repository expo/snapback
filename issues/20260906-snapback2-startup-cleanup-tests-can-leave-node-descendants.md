# Startup cleanup tests can leave Node descendants

Status: Open
Scope: Snapback2 test harness

The exact f7d251394 M5 full run exited0 with746 passing Rust tests and
two nextest leak notices. Two reparented node processes running
`-e setInterval(() => {}, 1000)` survived. Their start times matched the
duplicated `startup_cleanup_guard_reaps_the_child_and_removes_every_test_path`
tests in test_unit.rs and test_derived.rs. This is source/timing inference,
not a launch-PID record; no inferred process was killed.

Both tests spawn `node` through PATH and only assert the Child option was
removed plus scratch/store cleanup. OwnerCleanup kills/waits the direct
child, so a launcher/descendant mismatch is a hypothesis to reproduce.
Retained evidence: /Users/ccheever/clique-improvement/verification/assets-f7d251394/
(full log, result JSON, JUnit). The earlier asset full run had no leak notices.

Reproduce with recorded direct and descendant PIDs under the actual PATH;
assert process termination, deduplicate the test if appropriate, and clean
only launch-recorded children. Keep this separate from asset recovery.
