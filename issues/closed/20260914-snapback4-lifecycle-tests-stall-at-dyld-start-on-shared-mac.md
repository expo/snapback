# Snapback 4: lifecycle tests time out when the test binary's child stalls in `_dyld_start`

Status: Closed — duplicate of issues/20260914-snapback4-lifecycle-tests-time-out-under-host-load.md (filed earlier); evidence folded there
Priority: P3
Date: 2026-09-14
Systems: `snapback4/crates/snapback4/tests/lifecycle.rs`, the blocking suite on shared macOS hosts

## Evidence

On the shared M5 Max (2026-09-14, load 9–37, swap near full), five tests in
`cargo test -p snapback4 --test lifecycle` failed outside Codex's sandbox and
passed inside it:

- `a_signal_still_cleans_up_the_application_worker`,
  `dev_and_serve_report_signals_without_an_application_worker`,
  `sqlite_replay_survives_counter_split_and_a_concurrent_cli_backfill`,
  `watcher_keeps_serving_after_a_refused_edit_and_a_parked_backfill` —
  `lifecycle.rs:49` "timed out:" with an empty stderr (the 15 s wait for the
  server's URL line);
- `abort_profile_reports_an_off_thread_panic_to_redirected_stderr` —
  `lifecycle.rs:68` "child did not exit".

The failures are not the catch-up lanes' code. Lane CU3's worktree has no diff
under `snapback4/crates` from base `518891fd1` and fails the identical five.
`sample` of the `snapback4 dev --port 0` child during the test's window shows
the main thread still at `_dyld_start` after 7 s (process state `SN`). The same
binary started from a shell prints its URL in under a second, with or without
a worker. Launch time from a shell was 9.7 s once, then 0.03 s, which fits
system policy assessment of freshly linked, ad-hoc-signed binaries under load.
`TMPDIR=/tmp` does not change the result.

## Follow-up

Make the host tests tell a launch stall apart from a server that never
listens. For example, time how long the child takes to reach `main` (the
server could print a startup marker to stderr first). The URL deadline would
then start after launch, not at spawn, and a stalled launch would print its
own diagnostic. Until then, an outside-sandbox red of exactly these five on a
loaded shared Mac is environmental. Confirm it by running a tree with no crate
diff before blaming a change.
