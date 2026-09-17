# Snapback 4 lifecycle and client startup tests time out under host load

**Status:** Closed
**Priority:** P3
**Date:** 2026-09-14
**Systems:** CLI lifecycle tests, client test runner, publication qualification
**Author:** Codex / GPT-6 Astra
**Resolution:** Fixed by `c4eb1047f`: pre-main and readiness waits are distinct, early exits remain prompt, and loaded-host client execution is bounded.

Evidence status: received orchestrator observation plus retained local test logs

## Problem

Under shared-host load (reported load averages 12–17, with higher spikes
during publication), four tests in `snapback4/crates/snapback4/tests/lifecycle.rs`
were reported to fail at line 49 with `timed out`. The separate
`abort_profile_reports_an_off_thread_panic_to_redirected_stderr` test can
fail at line 68 with `child did not exit`. The previous orchestrator
reported the behavior across multiple trees including main. That report
does not identify an exact baseline SHA for the four timeouts, so it is
not an exact-base regression comparison or evidence that every tree fails.

The client suite also fails in a cluster with `server did not listen`
under load. Publication attempt 1 for 0.2.10 refused on that red suite;
the successful retry passed 132/132 client tests and completed the full
suite in 90 s. A serial client control passed 132/132. These failures
must remain visible; increasing a wait must not hide an early child exit,
a real startup refusal or a product crash.

## Evidence

Local retained logs from this program:

- `/private/tmp/lane-W5-suite.log`: the named abort-profile child timeout;
  client totals 124 tests, 57 passed, 66 failed (with one remaining
  cancelled); full-script summary `== 2 failure(s) in 328 s`.
- `/private/tmp/lane-W5-client-serial.log`: 132 tests, 132 passed, 0 failed,
  outside the lane sandbox, with file concurrency 1.
- `~/projects/snapback-lanebriefs/publish-0.2.10.log`: successful retry,
  132 client passes, `== 0 failure(s) in 90 s`, followed by publication.
- The 2026-09-14 relaxed-Quarry handoff records the earlier four
  `lifecycle.rs:49` failures and the first publisher refusal. The current
  publish log is the retry; do not present it as the missing first log.

The lane's sandbox Chromium SIGABRT and its Linux signal-test failures
are separate observations in the W5 journal, not explanations for these
outside-sandbox host-load failures.

## Fix direction and acceptance

Use load-tolerant, bounded spawn/readiness waits that report captured
stderr and the child's exit immediately when it dies. Run client test
files serially when the host is loaded (the current diagnostic command,
from `snapback4/`, is below). Preserve the tested lifecycle behavior and
real crash/refusal assertions; do not weaken them to make a timeout pass.

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$PATH
node --test --test-concurrency=1 'packages/snapback4/test/*.test.mjs'
```

Reproduce on a recorded source SHA with host load and command retained;
compare ordinary and serial runs. Verify that a deliberately dead child
still fails promptly with its diagnostic and that the blocking suite and
publisher retain refusal on actual reds. This ticket commissions no
change to the frozen Clique packet or its published pin.

## Evidence added 2026-09-14 by the catch-up lead (root cause)

`sample` of the `snapback4 dev --port 0` child during one test's 15 s window
shows its main thread still at `_dyld_start` after 7 s (process state `SN`).
The process has not reached `main`. The same binary started from a shell
printed its URL in under a second, with and without a worker. One shell
launch of a freshly linked debug binary took 9.7 s, and the next took
0.03 s, which fits macOS assessment of new ad-hoc-signed binaries under load.
Lane CU3's worktree, whose `snapback4/crates` did not differ from `518891fd1`,
failed the same five tests, so they fail on base crates. `TMPDIR=/tmp` did not
change the result. At load 9–20 later that day the five passed. A readiness
wait that starts when the child reaches `main` (for example, a first stderr
marker) would tell a launch stall apart from a server that never listens.
The duplicate ticket [`20260914-snapback4-lifecycle-tests-stall-at-dyld-start-on-shared-mac.md`](20260914-snapback4-lifecycle-tests-stall-at-dyld-start-on-shared-mac.md)
was folded into this one.

## Resolution — 2026-09-17

The test-only launch protocol now emits `SNAPBACK4_TEST_MAIN_REACHED` as the
first action in `main`, when explicitly requested by the lifecycle harness.
Startup has separate bounded phases: 30 seconds to cross the host's pre-main
launch boundary, then 15 seconds for server readiness. Every polling loop
checks `try_wait` first and reports the exit status plus captured stderr, so a
crash or refusal is never converted into a longer timeout. The abort-profile
probe uses the same distinction and bounded logged wait.

The regression `a_dead_child_reports_its_status_and_stderr_without_waiting_for_the_deadline`
launches a fixture that writes `deliberate child refusal` and exits 23. It
requires the harness to report both facts in under two seconds despite a
15-second deadline. The complete lifecycle target passed all 20 tests in
14.1–14.2 seconds during the two final qualifications.

The blocking runner also measures host load before launching client files. It
uses file concurrency one when the one-minute load is at least the logical CPU
count (or when `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1` is explicit); otherwise
it uses bounded deterministic shards for the two dominant files. On the
documented 96-CPU qualification host, both ordinary-path runs passed all 554
client tests and the complete rebased suite in 52/50 seconds. Final code
checkpoint `c4eb1047f0d0098a3994e916848300e5fbbca97a` also passed
lifecycle 20/20 under
`RLIMIT_NOFILE=256` on the loaded macOS host; that separate 50.2-second target
observation confirms the bounded launch distinction but is not a suite-budget
measurement. Raw-log hashes are recorded in the blocking-suite and descriptor
tickets.
