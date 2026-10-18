# Snapback 4: intermittent Mac file-runner latency assertion under host load

Status: Open
Date: 2026-10-18
Scope: `packages/snapback4/test/test-file-runner.test.mjs`, “a foreign listing over five seconds leaves sibling cleanup and watchdog timers running”

Integration 16's broad Mac Studio client scope at `08fa452c31` failed the
unchanged `result.elapsed < 3000` assertion with elapsed 3005 ms. The blocked
fixture was correctly refused as TEST_FILE_HANG and its keeper acknowledged
cleanup; no ownership, kill-target or failure-semantics assertion failed.
Node 24.21.0 ran on Xcode27.0's Mac Studio while other machine work was present.
This establishes an intermittent timing assertion, not its root cause.

The same test then passed alone without source/timeout changes: sibling 755 ms,
hung 2167 ms, foreign listing 8479 ms, 389 heartbeat ticks; process groups drained.
The final pinned Node 24.13.1 complete Mac scope passes all 52 files, including
the entire 42-test watchdog file, after the isolated pass. No threshold changed.
Integration16 retains both logs and the final broad verdict under
`snapback4/reports/integration16/`. A passing repetition does not close this
issue or authorize relaxing the 3-second assertion.

Investigate process-list latency, scheduling and whether the deliberate foreign
listing can be synchronized to establish progress without turning this into a
host-performance threshold. Preserve the five-second foreign-list scenario,
watchdog/cleanup concurrency, group ownership checks and failure deadlines.
