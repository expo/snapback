# Startup cleanup tests can leave Node descendants

Status: Resolved — 2026-09-07
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


## Resolution (2026-09-07)

Reproduced on macOS from base `ba63c884e` using the actual shell PATH.
`node` resolves to `/Users/ccheever/.volta/bin/node`, a symlink to `volta-shim`.
A subprocess launched `node -e` with a JSON self-report of `process.pid`,
`process.ppid`, and `process.execPath`, followed by the original interval.
The recorded direct child was **46788**; Node reported **46789**, parent
**46788**, executable
`/Users/ccheever/.volta/tools/image/node/22.23.2/bin/node`.
After three seconds and the guard-equivalent direct-child `kill`/`wait`,
46788 exited with signal 9 while `kill(46789, 0)` still succeeded. Only the
launch-recorded Node PID 46789 was then killed; polling confirmed it no longer
existed. No process inferred from the earlier run was touched.

The bug is in the fixture's executable substitution: `IsolatedOwner` launches
`current_exe` directly, while this test substituted a launcher with a separate
Node child. Keep one Unix fixture in `test_unit.rs`, launch `/bin/sleep`
directly (macOS/Linux), record its PID, prove it is alive before cleanup and
absent with `ESRCH` after cleanup, and assert scratch, database, WAL, and SHM
removal. Remove the duplicate fixture from `test_derived.rs`. This changes no
production process-tree policy or compiler worker behavior. LLP 1002 §7
records the custody distinction.

Verification on the repaired lane:

- `cargo test -p snapback2 startup_cleanup_guard -- --nocapture`: one test
  passed in 3.03 s; direct sleep PID **48076**, verified absent by the test.
- `cargo nextest run -p snapback2 --bin snapback2 --config-file
  ../.config/nextest.toml --profile local-proof -E
  'test(startup_cleanup_guard) | test(isolated_owner_cleans_scratch)'
  --no-fail-fast --success-output immediate`: **2 passed**, 148 skipped,
  3.048 s, no leak notices. Run ID `f95bcfd2-5956-4164-87ac-9f50fcd39922`;
  direct sleep PID **48218**, verified absent by the test.
- `git diff --check`: passed.

These are focused fixture/startup checks; integrated full-suite verification
belongs to the parent landing run.
