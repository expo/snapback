# Snapback 4: scheduled-job crash fixture can observe completion after its queued snapshot

**Status:** Open
**Date:** 2026-10-04
**Systems:** Snapback 4 publication test fixtures
**Related:** LLP 3000 §7, publication suite under contention

Lane SU's full eb1000 suite on base `2154dc163d` plus test-only timeout
changes failed `a queued scheduled job survives serving process death and
runs once after restart`, at
`packages/snapback4/test/release-activation.test.mjs:515`:
`actual 'done' !== expected 'queued'`.

The fixture sends SIGSTOP upon the listener's stdout announcement, observes
one queued job with zero chunks, sends SIGKILL, awaits exit, then expects the
job to still be queued. This run reached the last assertion with `done`.
Sending a signal is not a witnessed maintenance/crash boundary; investigate
and make that boundary deterministic while preserving the real schedule
admission, crash/restart, same-job, exactly-once and outbox assertions.

The failing JavaScript fixture and production sources are unchanged from
base. SU edits only Rust test modules and documentation. An isolated rerun
on the same tree passed (1 test, 1.33 seconds); that does not erase the full
suite failure or establish a fix. No change was made to this fixture or to
Lane FX's worktree.

Evidence: [SU report and full-suite log](../snapback4/reports/20261004-su-serve-upload-timeout/REPORT.md).
