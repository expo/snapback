# FL round 9 — asynchronous identity capture and independent timeout cleanup

2026-10-08. Base `dcd5d06707`; branch `sb4-intent/fl-dry-run-flakes`.
All commands ran on eb1000 in this worktree. No other host, worktree or
process custody was used; nothing pushed.

## Finding and correction

Astra correctly identified the round-8 regression. Initial command capture
ran `Atomics.wait` on the calling JavaScript thread, and `runProcess` armed its
timeout only after capture returned. A two-minute capture allowance could
therefore prevent command timeouts, sibling watchdogs and cleanup callbacks
from running. The review's 200 ms command finished at 5,712 ms after a
controlled 5.5-second empty-command observation.

`spawnTracked` now returns its owned child immediately. Capture runs as an
asynchronous task, waiting through abortable ten-millisecond timers only when
Linux reports an empty command. Both stat reads must agree, and every later
observation retains the first birth and this spawning parent. Changed births,
wrong parents, malformed nonempty commands and read failures still refuse.
Child exit/error cancels pending capture; its promise settles without an
unhandled rejection or a surviving two-minute timer.

`runProcess` arms its command timeout before spawning/capturing. Timeout and
overflow cleanup immediately use the retained owned child handle, close its
pipes, and await reaping. Cleanup does not depend on command readiness or an
identity inspection finishing. Borrowed objects and recorded PIDs still cannot
use `killOwned`. Fault injection separately awaits capture and fresh exact
birth/command checks before dispatch.

The audit also found a blocking Darwin subprocess probe in the same shared
helper. It now uses the existing asynchronous owned leaf-inspection transport,
with its original ten-second timeout, SIGKILL and close/reaping. Transport
errors refuse even if an exit status is zero; partial output cannot supply
identity. Capture abort
also cancels an in-flight probe. Compiler group custody, TERM/grace/KILL and
the thirty-second compiler deadline remain unchanged. No `Atomics.wait`,
`spawnSync` or `execFileSync` remains in `scripts/run-client-tests.mjs` or
`scripts/test-*.mjs`. Short `/proc`/boot-ID reads and metadata parsing remain
synchronous; no polling delay or subprocess wait occupies the runner thread.
Deliberately synchronous fixture work still runs inside isolated test files,
under the independent runner watchdog.

Recorded-PID inspection is still not atomic with signalling: exit and reuse
can occur between the final inspection and syscall. Owned handles and keeper
groups remain preferred. No numeric PID fallback, command normalization,
looser pattern or retry of a failed dispatch was added.

## Awaitable API audit

The governing context is [LLP 3000#publication-suite-under-contention](../../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention):
asynchronous inspection must leave independent clocks and keeper EOF delivery
running; only retained handles or keeper groups authorize owned cleanup.
[LLP 3000.030 §15](../../../../llp/3000.030-native-proof-in-minutes.rfc.md)
continues to govern export custody. The LLP now records the asynchronous
capture/probe and cleanup distinction; no shipped CLI or SDK source changed.

| Callers | Change and preserved requirement |
| --- | --- |
| `signalChild`, `signalRecorded`, `inspectSignalTarget`, `checkSignalRecord`, `signalTargetAlive` | Await native inspection. Fresh complete identity remains required; each dispatch follows the final check. `childCaptureReady` exposes settlement for readiness regressions and grants no signalling authority. |
| `fixture-signals` and all export fault sites | Return/await dispatch before observing outcomes. Selected binary, exact root, all command vectors, birth precision and positive-PID requirements remain unchanged. |
| `publication-barrier` | Await identity before writing the private self-kill request, and await each liveness result. Atomic PID publication and all unsafe/stale-record refusals remain intact. |
| `export-failure` | Await both maintenance-liveness observations before testing their booleans. A Promise cannot be mistaken for a live process. |
| `export-background` diagnostics | Await both fresh observations before serializing the snapshot. The original failed drain assertion, predicate and 90-second bound remain intact. |
| App, avatar, read-through and timeline helpers | Await owned-child fault dispatch before waiting for exit/removing fixture files. No argv or path spelling changed. |
| Process/signal/command-group tests | Await successful dispatch; use awaited `assert.rejects` for the same refusal cases. Every intercepted-call/retained-handle assertion remains. |
| Shebang timeout regression | Explicitly require the original interpreter command to validate and a deliberately changed command to refuse while the child is alive. Then require the same timeout/SIGKILL/reaping result. Readiness also observes command completion, so an early timeout cannot leave the test polling for an impossible marker. |

All production callers in the test tree were searched for these APIs. Historical
report reproducers remain bound to their recorded revisions; the round-9
controls below use the current asynchronous API. Darwin-only call sites are
updated by source audit; this Linux run does not claim native Darwin execution.

## Regressions and controls

- Persistent empty cmdline: mock only this real owned child's command bytes;
  retain actual PID, stat, parent and birth. A 20 ms heartbeat must continue,
  a 200 ms timeout must report `ETIMEDOUT` and reap with SIGKILL before the
  independent emergency exit, and child exit must cancel further capture reads.
  Explicit liveness bounds distinguish event-loop starvation; they do not
  reduce ordinary correctness work allowances.
- Four anchored-capture cases: complete command succeeds; changed birth,
  changed parent and malformed nonempty bytes refuse without dispatch. The
  malformed case still requires exactly two reads rather than retries.
- Native leaf inspection: real subprocess timeout and abort each keep sibling
  heartbeats running and require reaping before return. The PID is an observed
  result for the existence check, never a signalling authorization.
- Four private mutations all fail: replace the timer wait with a blocking
  wait, remove waiting, remove the birth anchor, or remove the parent anchor.
  The blocking control uses a 5.5-second capture ceiling and fails its heartbeat
  assertion at about 5.5 seconds. Each mutated subprocess group is reaped.
  [Final control output](evidence/empty-controls-final.log),
  [reproducer](reproduce/empty-controls.mjs).
- The real hung-runner control still fails distinctly at its injected timeout,
  reaps the command group and detached test descendants, and never uses its
  emergency release. [Output](evidence/hung-runner.log),
  [unchanged reproducer](../round-8/reproduce/hung-runner.mjs).

## Verification

- Ten affected files: **204 passed, 33 Darwin skips, zero failures**.
  Background is **63/32**. [Final suite](evidence/ten-suites-final.log).
  A subsequent full signal-file pass verifies the final readiness-settlement
  adjustment: **16/16** ([log](evidence/signals-final.log)).
- Final frozen-source load replay: **20/20 main CLI cases**, plus **20/20** of
  each of the seven selected capture/leaf cases, **160 passes total**. Eight
  busy loops and two concurrent jobs shared CPUs 80–87 through `taskset` for
  95 seconds. All keepers acknowledged cleanup and all owned busy loops were
  reaped. The 200 ms capture command completed/reaped in **202–209 ms**, and
  first heartbeat delivery was **19–25 ms**.
  [Hashes and rounds](evidence/loaded-summary.json),
  [totals and measurements](evidence/loaded-verified.json),
  [driver](reproduce/load.py).
- Unchanged `dev_refusals`: **22/22** ([log](evidence/dev-refusals.log)).
- Extra app/avatar/read-through/timeline helper consumers, after refreshing the
  SDK: **117/117** ([log](evidence/helper-consumers-built-sdk.log)). The six
  earlier avatar failures disappear with the current generated SDK; no SDK
  or product source change was made.
- `./ref-check`: zero errors ([final log](evidence/ref-check-final.log)).

Two earlier 20-round replays also passed; they are retained under
`evidence/before-readiness-settlement/` and `evidence/before-probe-error-check/`.
The final replay above supersedes them after adding the shebang regression's
command-completion readiness check and the Darwin probe transport-error check.
Neither replay rebuilds or replaces the CLI while export workers are alive.

Initial setup failures are retained rather than counted as passes. The first
extra helper-consumer run could not import `undici`; the initial ten-file run
also failed two effective Expo prebuild evaluations. Frozen installation
restored the missing dependencies and the requested SDK check printed
`deps-ok` ([install](evidence/deps-install.log), [check](evidence/deps-check.log)).

The expanded avatar consumer then reported six `E_OFFLINE` versus `E_CLIENT`
failures. A private copy of round 8's signal/avatar helpers reproduced all six
with the same installed SDK, so the helper comparison alone did not identify
a product cause. A fresh isolated TypeScript build found thirteen stale SDK
JavaScript artifacts, including local asset handling
([comparison](evidence/sdk-artifact-comparison.json)). The ordinary SDK build
was then completed after the export workers exited
([build](evidence/sdk-build.log)). Earlier outcomes remain in
`helper-consumers.log`, `helper-consumers-final.log` and `avatar-baseline.log`;
the [baseline reproducer](reproduce/avatar-baseline.mjs) is specific to those
stale artifacts and is not a passing-source negative control.

Round 8's two maintenance-drain failures and native inspection recurrence
remain open; this round's passing export run does not explain them. No macOS
soak, complete publication qualification or resolution of those tickets is
claimed.

## Reproduce

From `snapback4/`, with frozen dependencies and current generated SDK artifacts:

```sh
python3 reports/20261007-fl-dry-run-flakes/round-9/reproduce/load.py
node reports/20261007-fl-dry-run-flakes/round-9/reproduce/empty-controls.mjs
node reports/20261007-fl-dry-run-flakes/round-8/reproduce/hung-runner.mjs
```

Preserve the evidence directory before rerunning a driver. Mutations use private
copies and remove them in `finally`; original sources are never replaced.
