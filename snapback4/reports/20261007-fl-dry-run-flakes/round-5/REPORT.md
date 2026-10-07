# FL round 5 — bounded inspector commands and fresh stderr recovery

2026-10-07. Base `cc663aa03b`, branch `sb4-intent/fl-dry-run-flakes`.
All work and execution stayed in this worktree on eb1000
(`expose-builder-pixel`). No push, publication, remote execution or changes
to other worktrees or other lanes' processes.

## Review and governing context

Astra's round-4 review (`~/sb4-intent/reviews/fl-r4.astra.md`, with reproductions
under `fl-r4.astra.evidence/`) found two real timeout hangs. Its evidence also
showed a stderr-saturation failure between passing `dev_refusals` runs.
The three observations are preserved here: [owned-child hang](evidence/review-timeout-leak.log),
[compiler hang](evidence/review-inspector-timeout.log),
[stderr failure](evidence/review-dev-refusals-stderr.log).
Grok's round-4 review was pending in the request; no new review verdict is claimed.

The scoped llp-orient context is LLP 3000#publication-suite-under-contention
(keeper custody, retained inspection-child handles and dispatch-time identity),
LLP 3000.030 §15 (native export custody), and LLP 3000.015 §2.1 (asynchronous
developer evidence). Snapback 4's AGENTS, NOT-DOING and journal fence applies.
The child-handle cleanup rule already exists in QF7; round 4 incorrectly
allowed an inspection refusal to abandon that child. LLP 3000 and the round-4
report now distinguish fault refusal from mandatory owned-command cleanup.

## Changes

**Interpreter identity and timeout cleanup.** `spawnTracked` captures the
newborn child's complete actual argv alongside its requested argv, retaining
its parent and exact birth. A shebang inserts an interpreter; both direct
shebang and `node file` command forms now validate without removing script
paths or arguments. The simple `env interpreter script ...` transition is
also recognized. Unsupported command changes continue to refuse fault injection.

`runProcess` first uses the same strict identity gate. If inspection refuses
on timeout/overflow, it retains the refusal as the original failure's cause
and uses `killOwned` on the ChildProcess object it actually spawned. Only
objects registered by the shared spawner are accepted; a PID or imitation
object cannot use this path. It destroys captured pipes and resolves on
`close`, after reaping. This preserves ETIMEDOUT/ENOBUFS for the caller and
never substitutes an unchecked numeric kill. Recorded-PID faults retain
round 4's strict birth/command check and have no cleanup fallback.

**Compiler timeout.** The Darwin inspector compiles asynchronously during
identity-module initialization. After 30 seconds it sends TERM through the
owned child handle, grants one second, then sends KILL and reaps. Timeout or
overflow still refuses even if the child subsequently returns status zero.
The synchronous read-only probe uses KILL for its ten-second timeout, so a
handled TERM cannot hold `spawnSync` forever.

Self-signals live in the synchronous ownership helper. Keeper EOF and the
CommonJS compressor fixture therefore do not wait for inspector compilation
or require an asynchronous module. Background/failure fixtures change only
that helper URL; all custody, simulator, publication and signal assertions
are unchanged. A permanent mocked-Darwin/CommonJS regression verifies that
self cleanup never invokes a compiler. There is no product-source change.

**Stderr observation race.** Astra's failed snapshot ends at response 40,
operation `add39`, with zero drops. That is a valid pre-saturation record.
The test repeated `add39` after starting the drain and immediately accepted
the old record as recovery. Recovery now uses `add`, absent from all 4,096
saturation refusals. It still requires responsive refusals and a successful
mutation while stderr is unread, refusal to advertise the older cause, fresh
persisted recovery within ten seconds, and a positive drop count. The strict
point-read comparison is untouched.

## Regressions and evidence

`test-signals.test.mjs` adds eight cases: exact dispatch for a direct shebang,
an env shebang and `node file`; reaped shebang timeouts with valid and refused
identity; borrowed-handle refusal; compiler-independent self cleanup; and
TERM-handling compiler escalation. The command-change fixture waits for a
private go marker written after capture, so its refusal is deterministic.
The compiler case executes the actual Darwin JavaScript initialization path
on Linux using a fake `cc`. It observes TERM, requires completion without the
outer watchdog, and verifies the compiler was reaped before its emergency
self-release. Private release protocols also clean up broken implementations.

- **Export, process, signal and runner suites:** eight files pass **186 tests**,
  with **33** platform skips and no runner leaks. Background is **63 passed /
  32 Darwin skips**, including the real 22-second expired-checkpoint control.
  [Full log](evidence/suites.log).
- **Final helper consumers:** app-online, asset-avatars, read-through and
  timeline-delivery pass **49/49** in [the final adjacent log](evidence/adjacent-final.log).
  The final signal file also passes all eight cases in [the adjacent run](evidence/adjacent.log).
- **20 loaded rounds:** **440 Rust passes and 200 Node passes**, no failures.
  Final results are recorded in
  [the summary](evidence/loaded-summary.json) and [full output](evidence/loaded-tests.log).
  Four owned busy loops and the tests share CPUs 80–81. Each round runs all
  22 `dev_refusals` cases, seven fast new helper cases, the two publisher
  regressions and the prior signal-gate regression. Loops exit through owned
  stdin pipes and are all reaped; source hashes are unchanged across the run.
- **New hang/identity negative controls:** removing interpreter argv support,
  restoring early return after cleanup refusal, or removing compiler KILL
  escalation makes its regression fail. Each has one expected failure, no
  runner leak and an independent release/reap path. [Summary](evidence/timeouts-negative-summary.json),
  [final log](evidence/timeouts-negative-final.log).
- **Stderr controls:** a forced first snapshot of old `add39`/zero drops is
  ignored before fresh recovery passes. Restoring the old recovery predicate
  fails deterministically. Forcing zero drops on the recovered record still
  fails the original assertion. [Results](evidence/stderr-controls-summary.json).
- **Read controls:** all **42** Astra field corruptions fail on their first
  pair, including all 21 combined with sequence advance. A lone advance
  passes both trace modes; endless movement fails after eight pairs; removing
  the strict comparison makes the permanent regression fail.
  [Corruption matrix](evidence/retry-masking-summary.json),
  [bounded-retry controls](evidence/retry-controls-summary.json).
- **Prior controls:** missing dispatch validation fails both the signal gate
  and 22-second stale-checkpoint case with intercepted calls; non-atomic PID
  publication fails both barrier regressions. [Dispatch log](evidence/signals-negative-final.log),
  [barrier log](evidence/barrier-negative-final.log). Disabled native drain fails
  at its custody state bound and forced test timeout fails while reaping
  fixture custody and removing its root. [Custody](evidence/custody-negative.log),
  [timeout](evidence/timeout-control.log). Simulator recovery replay still
  has two positives and four expected refusals. [Replay](evidence/simulator-cleanup.json).

[Preservation check](evidence/preservation.json) records the unchanged earlier
assertions. [Signal-site audit](evidence/signal-audit.txt) distinguishes strict
numeric fault dispatch, owned native child handles and self-directed signals.

The changed-command regression uses Node's process-title mutation. The source
check against [libuv's argv update](https://github.com/libuv/libuv/blob/v1.51.0/src/unix/proctitle.c)
supports expecting changed command bytes on Unix; the native Darwin inspector
and Mac suite still need the user's soak. The user reported round 3's Mac
soak passed 5/5 at 94/94; that is not execution evidence for this revision.

## Development record and limits

The first combined run exposed the CommonJS/asynchronous-module incompatibility:
the compressor child exited early and nine background cases failed. The
standalone disabled-drain control caught the same setup defect. These logs
are retained as `*-pre-correction.log`; neither is a passing result. The old
file completed and its keeper reaped normally. An attempted identity-checked
stop found it already absent and refused before sending any signal.

A first loaded run was interrupted after six successful rounds when the
compiler failure check was finalized. Only this task's controller was sent
SIGINT through the current command/birth gate; its finally block reaped all
four loops. That run is retained separately and excluded from the final count.
One private timeout-control rewrite initially assigned to a constant and
started no test; the corrected control passed. An adjacent command named a
nonexistent timeline-recovery test; all real files in that command passed,
and timeline-delivery plus the final four-file run supplied the missing check.

All native product sources, package versions, limits and earlier assertions are preserved.
Darwin native compilation/execution and publication qualification remain
outside this Linux evidence. Reference checking retains the previously
reported LLP 3000.035 anchor error in untouched `snapback4-difftest/src/lib.rs`.
[Reference-check output](evidence/ref-check.log). Logs are normalized only for
trailing whitespace/empty EOF lines after their writers finish.

## Reproduce

From `snapback4/`, using the pinned Node 24 runtime and normal prepared local
binary/client artifacts:

```sh
node scripts/run-client-tests.mjs 3 files packages/snapback4/test/export-background.test.mjs packages/snapback4/test/export-publication.test.mjs packages/snapback4/test/export-native.test.mjs packages/snapback4/test/export-native-round2.test.mjs packages/snapback4/test/export-failure.test.mjs packages/snapback4/test/test-signals.test.mjs packages/snapback4/test/test-processes.test.mjs packages/snapback4/test/test-file-runner.test.mjs
node reports/20261007-fl-dry-run-flakes/round-5/reproduce/timeouts-negative.mjs
node reports/20261007-fl-dry-run-flakes/round-5/reproduce/signals-negative.mjs
node reports/20261007-fl-dry-run-flakes/round-5/reproduce/barrier-negative.mjs
node reports/20261007-fl-dry-run-flakes/round-5/reproduce/custody-negative.mjs
node reports/20261007-fl-dry-run-flakes/round-5/reproduce/timeout-control.mjs
node reports/20261007-fl-dry-run-flakes/round-5/reproduce/simulator-cleanup.mjs
python3 reports/20261007-fl-dry-run-flakes/round-5/reproduce/retry-masking.py
python3 reports/20261007-fl-dry-run-flakes/round-5/reproduce/retry-controls.py
python3 reports/20261007-fl-dry-run-flakes/round-5/reproduce/stderr-controls.py
python3 reports/20261007-fl-dry-run-flakes/round-5/reproduce/load.py
```

Run the Rust mutation harnesses sequentially; each restores and rebuilds in
`finally`. The disabled-custody control reuses the lane's private round-0
mutant under `target/fl-negative`; no product source is mutated by that control.
