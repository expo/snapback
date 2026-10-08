# FL round 8 — correctness work under process-startup contention

2026-10-07–08. Base `2797247960`, branch `sb4-intent/fl-dry-run-flakes`.
`git fetch origin && git merge origin/main` fast-forwarded the lane to the
landed tip. In the independent `snapback4/` workspace, `bun install
--frozen-lockfile` succeeded and `bash ~/sb4-intent/check-sdk-deps.sh` printed
**`deps-ok`**. The debug CLI was rebuilt with the packaged SQLite flags.
[Build log](evidence/build.log). All execution stayed on eb1000 and in this
worktree. Nothing pushed; no other lane's processes or worktrees changed.

## Failure and correction

The 0.4.15 Darwin dry-run report identifies a ten-second `spawnSync` timeout
inside a test that invokes the real runner six times. The aggregate test guard
was thirty seconds. Each invocation starts a runner, keeper and native Node
test processes. Neither guard represents a throughput or product contract.
The reported failure is therefore consistent with host contention preventing
correct work from finishing, rather than a wrong runner verdict.

The CLI test now awaits each invocation through `fixtureCommand`, using the
existing owned-command keeper and process-group cleanup. It yields the test's
event loop while the runner works. A timeout fails with a distinct
`TEST_FIXTURE_COMMAND_TIMEOUT` message that names the invocation and its
allowance, retaining the original error and captured output. A command error
or failed cleanup cannot be interpreted as an expected failing test file.

All original checks remain: native exit status, exact ordered file verdicts,
aggregate counts, both PATH shim variants, per-invocation shim hits, the later
healthy file, `KEPT_FAILURE`, and absence of inspection/keeper errors. There
is no retry of a failed invocation or test. The six calls still run sequentially.

`scripts/test-work-bounds.mjs` shares the runner's existing **15-minute
file-stall floor** as a correctness command work allowance. The CLI case has
six such invocation allowances plus two minutes for cleanup. Ordinary native
parity cases allow two work phases plus cleanup. These are generous hang
guards, not delays or new performance claims. Normal runs complete as soon
as their children and cleanup do. `largestGuard` now declares all test guards
above the floor, so the outer file watchdog retains its usual 25%/one-minute
margin rather than accidentally cancelling the larger inner guard. The
existing guard-census test checks the added entries and serial-mode behavior.

Nested CLI and ordinary native baselines use asynchronous private group
custody. The runner's own detached file keepers receive EOF when their runner
exits, and still kill their own groups. The synchronous self-group-kill
baseline retains its directly created detached group; it now checks that its
SIGKILL was not a timeout. Synchronous export/device fixtures retain their
existing ownership model, use SIGKILL for a finite transport timeout, and
check spawn errors before treating a nonzero exit as a desired refusal.
Signal targets and the identity requirements at dispatch are unchanged.

The expanded load replay also found an initial-capture race in the shared
signal helper: `/usr/bin/env` can expose an empty Linux cmdline while execing
Node. Previously that one read permanently lost the child's birth record.
Initial capture now waits, for at most two minutes, for a complete command
within the first observed live birth and parent. Only empty command bytes get
that wait. Changed births, wrong parents, malformed nonempty commands and read
errors still refuse. Signal dispatch itself still makes immediate complete
birth/command checks with no retry; owned children still use their retained
handles. The existing recorded-PID check-to-syscall race remains.

## Sibling audit and changes

[Initial bound census](evidence/bound-census.txt) and
[broader direct-process census](evidence/client-process-census.txt) preserve
the search scope. The audit distinguishes short work/setup bounds from clocks
that deliberately test timeout, backoff, progress or a product deadline.
Existing state, data, count, custody and timing assertions remain in place.

| File / cases | Finding and action |
| --- | --- |
| `test-processes`: real CLI PATH-shim parity | Six ten-second synchronous invocations under thirty seconds. Changed to awaited, bounded owned commands; all verdict/count/shim/failure assertions retained. |
| `test-processes`: slow ps before release / cleanup verification (2) | The healthy file used a three-second file watchdog while testing the independent ps timeout/retry. Use the ordinary file allowance for that healthy file. Keep the actual two-second timeout, 60-second retry, minimum durations, snapshot counts and keeper acknowledgement assertions. |
| `test-processes`: remaining cases | Synthetic routing/metadata tables need no process-work bound. The 200 ms never-finishing transport, output-overflow and ps recovery clocks deliberately exercise the helper's timeout behavior; retained. Live identity refusal assertions are unchanged. |
| `test-file-runner`: native baselines (10 cases) | TODO and beforeExit semantics (2), cancellation, six native parity variants, and buffered synchronous progress used the common ten-second native baseline. Baselines now await owned completion. Their comparisons with the real runner, native result and diagnostic counts remain unchanged. |
| `test-file-runner`: self-group kill | Ten-second direct native baseline enlarged; explicit `native.error === undefined` distinguishes the fixture's SIGKILL from a timeout. The later assertion that the runner sends no signal is intact. |
| `test-file-runner`: unsampled orphan | Five-second shell launch/fork/parent-exit setup waits now use the correctness work allowance. The stale snapshot, missing orphan in that snapshot, actual parent exit and complete group drain remain required. |
| `test-file-runner`: reaped keeper before exit callback | Five-second synchronous exit observation and two-second ps inspection were setup limits. The observation now has the work allowance, with a 60-second leaf-ps cap. It still holds JS synchronously and proves the actual closed-native-handle/null-JS-field window; no fabricated identity or signal. |
| `test-file-runner`: runner death | Keeper and test PID readiness used five seconds, and drain reused the already-consumed readiness deadline. Readiness now has the work allowance; post-death group drain gets a fresh two-minute state window. Actual runner SIGKILL and absence of every living group member remain required. |
| `test-file-runner`: intentional watchdog fixtures | Event-loop block, leaked handle, double-forked helper, chatter, synchronous reporter buffering, progress-renewal and concurrent-inspection tests exercise short watchdog/cleanup clocks themselves. Those clocks and their existing timing/outcome assertions are retained. The buffered baseline's independent success check is still required. |
| `test-signals`: self-directed CommonJS load | The five-second command checked import semantics and absence of compiler use. It now uses awaited owned completion; exact self-signal output and no-compiler assertions remain. |
| `test-signals`: tracked shebang / env shebang / Node file (3) | Twenty-second outer guards wrapped process startup plus identity inspection without asserting latency. They now use the work-plus-cleanup allowance. Complete argv, retained-handle route and borrowed-handle refusals remain exact. |
| `test-signals`: copied-binary identity | The native stand-in's real C compilation had a thirty-second cap inside a two-minute case. It now uses the bounded owned-command work allowance and a work-plus-cleanup case guard. All eight accepted command vectors and every different-binary/alias/root refusal remain exact. |
| `test-signals`: newborn exec capture (3 new Linux regressions) | Force an empty initial cmdline, then a complete command, a different birth, or malformed nonempty bytes. The first must capture and dispatch through the owned handle; the latter two must refuse during initial capture without dispatch. |
| `test-signals`: other cases | Owned shebang timeout and TERM-ignoring compiler cases deliberately force the helper's deadline and require reaping before return; their fault clocks, emergency-release detection and assertions are unchanged. Native inspector compilation retains the separately documented round-6 deadline/custody contract. |
| `test-command-group` | Both frontend regressions deliberately time out a fake compiler and require group TERM/KILL, no emergency self-release, and an empty group before return. Their fault clocks and assertions remain. Five pure inspection cases do not launch commands. |
| `export-background` | Ten/twenty/thirty-second wrapper, status, doctor and cleanup command caps were shorter than the ordinary work allowance. They now use that allowance, and all 95 cases share a work-plus-cleanup outer guard. Spawn errors are distinct failures. Darwin leaf-ps observation allows 60 seconds. Existing state waits, retention/deadline/initialization timing assertions, all seven custody cases, failure cleanup and exact identity dispatch are unchanged. |
| `export-failure` | Installed shim's three five-second self-signal invocations now use owned completion. The publication matrix's twenty-second wrapper cap and two-minute whole-case cap now cover its twelve invocations. A transport failure cannot pass as a desired publication refusal. Previous-export inventory, rollback, receipt and scheduling assertions remain exact. |
| `export-native` | Python's actual lease-acquisition marker had a five-second setup wait. It now gets a two-minute state allowance, below the file watchdog floor. No sleep replaces the marker. Retention counts, active lease protection and eventual ownerless repair remain required. Native configuration refusal, synchronous no-short-cap calls and signal-forwarding readiness were checked. |
| `export-native-round2` | No short `spawnSync`/`execFileSync` work cap. Lease fixtures release through their owned pipes; process outcome and retained-inventory assertions are unchanged. Rerun as a surrounding suite. |
| `export-publication` | Both atomic PID-barrier cases had ten-second C-process readiness waits inside thirty-second cases; now two-minute state waits inside five-minute guards. The inherited publisher's publication and finished-state waits each get their own two-minute window instead of sharing ten seconds. Complete PID identity, unsafe-fault refusals, native signals, inherited lease custody and recovered bytes remain asserted. |
| `schema-capability-refusals` (3) | Broader census found a thirty-second native-device cap and sixty-second multi-process case. Use the existing client `hangBudget` with twelve named work units (two servers, four HTTP operations, six device invocations), and fail distinctly on spawn errors. Every schema/row dump, integrity check, freelist count, query result and capability refusal comparison is unchanged. |

The broader census also inspected direct calls in server-check, server-e2e,
native-opening, recorded-compatibility, worker-regressions, first-account,
keep-incarnation and both rule-hop suites: their bounded commands already use
the client `hangBudget` convention. Client-seams, init-recipe, wasm-budget,
web-shell and measure-launch have direct calls without the short literal
transport caps at issue here; they remain governed by their existing case/file
guards. Witness acquisition already uses `hangBudget` for server readiness.
Publication-roundtrip's command timeouts are expected command-spec fixtures,
not real process launches. This is a scoped process-work audit, not a claim
that every possible client timing race has been eliminated.

The governing context is LLP 3000#publication-suite-under-contention,
LLP 3000.030 §15 for export custody, and LLP 3000.033 §1.3 for unchanged
refusal-store guarantees. LLP 3000 records the command/aggregate guard
distinction. No shipped CLI implementation or public contract changed.

## Controls

- **Slow but correct runner:** a private preload stalls each of the six real
  CLI starts for twelve seconds. The fixed case passes all its original
  assertions. The landed version fails with `ETIMEDOUT` at ten seconds;
  its failure is not an inspection or cleanup error.
  [Control log](evidence/slow-cli.log), [reproducer](reproduce/slow-cli.mjs).
- **Actually hung runner:** a real runner starts a test that blocks its event
  loop after creating a TERM-resistant descendant and publishing readiness.
  An injected ten-second command clock fails distinctly, reaps the command
  group, and verifies that the detached file group's test and descendant are
  gone. The independent thirty-second self-release does not fire.
  [Final loaded control](evidence/hung-runner-final-loaded.log),
  [reproducer](reproduce/hung-runner.mjs).
- **Newborn capture controls:** restoring the old helper fails the complete
  same-birth regression. Removing the anchor-birth check fails the changed-birth
  regression. Both controls release the real child through its owned stdin,
  and intercept dispatch rather than signalling a recorded PID.
  [Old-helper control](evidence/exec-capture-old-negative.log),
  [birth-check control](evidence/exec-capture-birth-negative.log),
  [loaded final replay](evidence/exec-capture-negative-final.log),
  [reproducer](reproduce/exec-capture-negative.mjs).

The additional maintenance diagnostic control forces a private one-millisecond
drain allowance while holding the real retention lock. It requires the original
`ERR_ASSERTION`, `actual: false`, `expected: true`, the pending queue record and
a freshly verified live observer command. Fixture cleanup retains its ordinary
90-second drain allowance. [Final control](evidence/maintenance-diagnostics-control-final.log),
[reproducer](reproduce/maintenance-diagnostics.mjs). A private binary-replacement
control also reproduced the earlier stranded-observer error with these final
diagnostics, and acknowledged cleanup ([log](evidence/replaced-binary-reproducer-final.log)).

No real runner default is shortened for these controls. The first control
changes only startup delay; the second supplies a test-only command allowance.
Neither control signals a cached PID or accepts cleanup failure as success.

## Verification

The affected-file run passes **200 tests in 10 files**, with zero failures
and **33 explicit platform skips**: export-background, export-failure,
export-native, export-native-round2, export-publication, test-processes,
test-file-runner, test-signals, test-command-group and schema-capability-refusals.
Background contributes 63 passes and 32 skips. [Final suites](evidence/suites-final.log).
Unchanged `dev_refusals` passes **22/22** ([log](evidence/dev-refusals.log)).
`./ref-check` passes with zero errors ([final log](evidence/ref-check-final.log)).

The final loaded replay held source hashes and the CLI's inode, mtime and
SHA-256 fixed for **2,604 seconds**. Eight busy loops and eight concurrent test
jobs were confined with `taskset` to CPUs 80–87. Every changed Linux case ran
20 times. The primary CLI case and the other non-background groups passed
**20/20 each** (760 test passes). The complete background file passed **18/20**;
rounds 2 and 3 failed the unchanged 90-second maintenance-drain assertion.
Totals are **2,018 passes, two failures and 640 platform skips** across 160
file results. Every keeper acknowledged cleanup and all eight busy loops were
reaped. [Input hashes and run results](evidence/final-load/summary.json),
[verified totals and failed case names](evidence/final-load/verified.json).
The evidence verifier exits nonzero for those two failures; it never substitutes
passing retries for the original verdicts.

Both failed cases passed **60 further focused repetitions each**, including
40 with additional confined load. Those reruns did not reproduce their queue
state or identify a cause. The original fixtures had already been removed.
[Open drain ticket](../../../../issues/20261008-snapback4-maintenance-drain-fl-load.md).
The only test-source change after that replay adds failure diagnostics:
`maintenanceIdle` now preserves the seven queue/result records, the maintenance
log and fresh process identity observations before cleanup. Its predicate,
90-second bound and original error remain intact. The
[exact diagnostic patch](reproduce/maintenance-diagnostics.patch) permits the
verifier to compare the final source to the frozen replay in memory.

A complete run of that diagnostic candidate in a private test copy then
reported **62 passes, one failure and 32 skips**. The failure is distinct:
`repeated raced retention-lock deferrals stay pending and restore the bound
after release` received `E_WITNESS_PROCESS: invalid /proc process group` where
it requires `retention lock busy`. Native witness code and the executable were
unchanged; no rejected stat bytes were retained. This recurrence is appended
to the [existing native inspection ticket](../../../../issues/20261004-snapback4-native-witness-proc-group-inspection.md),
without claiming it caused the two earlier drain failures.
[Complete candidate output](evidence/background-diagnostics-final.log).

The final canonical background file, including the diagnostics, then passed
**63 tests with 32 platform skips** and no failures or keeper errors
([final file run](evidence/background-with-diagnostics.log)). This rerun verifies
the final diagnostic integration; it does not erase the three earlier failures.

This is **not a clean loaded qualification**. Linux cannot execute the 33
Darwin-only cases; skips remain separate from passes. No macOS soak or
publication qualification is claimed. All first failures remain in the evidence.

The first affected-file run exposed one implementation mistake: after making
`nativeTest` asynchronous, its inline use in the buffered-progress case still
read `.status` without awaiting it. That failure is retained in
`evidence/suites.log`. It was not a product failure or watchdog diagnosis.
The corrected runner and subsequent readiness changes first ran in private
copies. Those preliminary passes are not substituted for final-source evidence.

The initial broad batch is also **not qualification evidence**. Running Cargo
for `dev_refusals` during it replaced `target/debug/snapback4` while old workers
were alive. Background workers use `current_exe()` when launching successors;
replacing that Linux executable can leave their old pathname marked deleted.
Three repetitions and the overlapping affected-file run failed maintenance
drain assertions. The final replay freezes both code and the CLI's inode,
mtime and SHA-256, with no Cargo invocation during it. The initial batch also
spans the subsequent helper correction; its failed source-invariance check is
expected and explicitly excludes it from the final totals. All output remains
available, including the separate env-exec failure on signal replay round 18.
The [disposable-binary control](evidence/replaced-binary-control.log) replaces
only a private CLI copy after its observer starts. It reproduces the stranded
pending request, queue assertion and `E_WITNESS_PROCESS: No such file or
directory` log. Its owned keeper acknowledges cleanup. This explains why a
source-only freeze was insufficient; the queue assertion is unchanged.
[Reproducer](reproduce/replaced-binary.mjs).

## Reproduce

From `snapback4/` after installing the pinned dependencies and building the CLI:

```sh
python3 reports/20261007-fl-dry-run-flakes/round-8/reproduce/load-final.py
node reports/20261007-fl-dry-run-flakes/round-8/reproduce/slow-cli.mjs
node reports/20261007-fl-dry-run-flakes/round-8/reproduce/hung-runner.mjs
node reports/20261007-fl-dry-run-flakes/round-8/reproduce/exec-capture-negative.mjs
node reports/20261007-fl-dry-run-flakes/round-8/reproduce/maintenance-diagnostics.mjs
python3 reports/20261007-fl-dry-run-flakes/round-8/reproduce/verify-evidence.py
```

Do not rebuild or replace the CLI while the load driver is active. Its eight
busy loops and all test processes share CPUs 80–87 through `taskset`. Python
closes its own busy-loop stdin pipes and joins every child. All test files use
the normal keeper runner.
Only the owned worker loops and test descendants are created or cleaned up.
The verifier checks the committed replay and intentionally returns status 1
for its two retained failures. Copy the evidence directory before rerunning a
load driver if the previous run's evidence must be retained.
