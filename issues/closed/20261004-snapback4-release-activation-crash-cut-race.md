# Snapback 4: release activation test can miss its queued-job crash cut

- **Opened:** 2026-10-04, lane NZ round 4 on the Apartment mini.
- **Area:** `snapback4/packages/snapback4/test/release-activation.test.mjs:507`.
- **Status:** Closed, 2026-10-05; main lane FY supplies the deterministic pre-first-chunk crash cut.

The third NZ round-4 complete Mac suite failed subtest 12, “a queued scheduled
job survives serving process death and runs once after restart.” At the intended
crash cut the job was already **done**, not **queued**. The subtest took 72.987 ms;
the other 17 tests in that file passed. This prevents the test from exercising
its queued-job recovery premise; it is not evidence that recovery itself failed.

The fixture waits for the listener URL on stdout, then sends SIGSTOP to its own
server. Its comment assumes this precedes the maintenance tick. Observing that
message and scheduling the callback does not provide a before-first-chunk
barrier. Preserve the queued-state/chunk assertions and recovery checks; replace
the incidental scheduling assumption with a controlled cut. Do not weaken the
assertion to accept an already completed job.

The file is unchanged from base `e7e325b7d1`, and passed in both earlier full
runs. No release-serving implementation is changed by NZ. Evidence is retained
in [NZ Round 4](../../snapback4/reports/20261003-nz-native-proof-zero-cost/REPORT.md#round-4--publication-and-retention-races),
`round4/full-suite-qualified.json`, and `round4/release-crash-cut-failure.json`.
The complete log is `/tmp/sb4-nz-r4-full-suite-qualified.log`, retained by content
hash in the report's external archive. The prior passes are in the logs bound
by `round4/full-suite.json` and `round4/full-suite-final.json`.

Reproduce from `snapback4/` with physical Node 24:
`node --test packages/snapback4/test/release-activation.test.mjs`, or
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`.

## Follow-up: next full-pool sample, 2026-10-04

The next complete-suite attempt passed this unchanged file, 18/18 cases
in 2.916 s. The crash cut happened in time in that sample; the fixture still
lacks a deterministic barrier.
The complete attempt is recorded in NZ `round4/full-suite-complete.json`.
This passing sample does not close the issue or erase the prior failure.

## Resolution: FY integrated in NZ Round 12, 2026-10-05

Main's FY fix (`0982b0d5e2`, with bounded cleanup in `6173f51c74` and body-error
preservation in `eb39b39936`) is included by main `8bd933cd2d`. The real serving
startup admits the schedule, then its explicit worker's Node-version probe stops
the parent before maintenance can start. The test witnesses the stopped state,
asserts one queued job with zero chunks/writes, witnesses SIGKILL exit and checks
the unchanged row before restart. Exactly-once completion, second-restart and
outbox assertions remain. This closes the missing barrier, without relaxing a
time limit or accepting an already completed job.

The merged NZ mini run passes the queued-job case (1.397 s) in the affected
release-activation run. The [Round 12 integration report](../../snapback4/reports/20261003-nz-native-proof-zero-cost/REPORT.md#round-12--integration-2026-10-05)
binds that log and the complete merged-tree qualification. Earlier flaky passes
above remain historical observations; the closure is based on the changed
barrier and its verification.
