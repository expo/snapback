# FL round 4 — validate identity at signal dispatch

**Round-5 correction:** [Astra's two hang findings and their fixes](../round-5/REPORT.md)
supersede this report's claim that compiler timeout alone is finite and its
identity-refusal cleanup treatment. Recorded-PID faults remain strict;
owned inspection commands must still be reaped through their retained handles.

2026-10-07. Base `e39f8ecf04`, branch `sb4-intent/fl-dry-run-flakes`.
All work and execution stayed in this worktree on eb1000
(`expose-builder-pixel`). Nothing pushed; no other worktree, remote host or
other lane's processes were changed or signalled.

## Finding and correction

Astra's round-3 P2 is correct. The native checkpoint records `{pid,start}`,
then expires after twenty seconds. The tests retained only its PID at fault
dispatch. Complete JSON, a readiness marker, and a previously blocked tool
do not prove that this process still exists. Astra's intercepted twenty-two
second reproduction showed the publisher had exited before SIGKILL dispatch.

The review inputs were `~/sb4-intent/reviews/fl-r3.astra.md` and
`fl-r3.astra.evidence/REVIEW.md`, including the reproduction and signal audit.
They reviewed round 3, not this revision. Grok's round-3 result was still
pending in the user's request. The round-3 report now explicitly corrects its
readiness/lifetime audit omission.

## Implementation

`scripts/test-signals.mjs` is the shared dispatch gate, including the former
round-3 publisher check. It requires a positive integer PID, a recorded birth,
the expected command, and fresh birth/command inspections immediately before
dispatch. There is no `await` or caller callback between the last check and
the signal. Missing, exited, stale, malformed or uninspectable identities fail
with `TEST_SIGNAL_REFUSED`; ESRCH is not ignored to make a fault case pass.

Native witness birth records retain their full precision: Linux boot ID plus
start ticks, Darwin seconds plus microseconds. Darwin's test-only C inspector
uses `proc_pidinfo` and `KERN_PROCARGS2`, checks birth around command capture,
and returns exactly argc arguments without environment bytes. It sends no
signals. This avoids reducing a native birth to `ps lstart`'s whole seconds.
Compilation and each inspection have finite bounds; a failed inspection
cannot authorize a signal. Linux reads `/proc` directly.
The Darwin layout was checked against Apple's
[process-info header](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h)
and the argument-buffer traversal in Apple's
[ps implementation](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/print.c).
That source check is not a Mac execution claim.

Background role and checkpoint faults pass the original `{pid,start}` record
to the gate. Allowed command forms identify the native binary, witness verb,
and this fixture's private paths; only native deadlines and private run IDs
vary. The publisher's command uses `publication-export`, matching the wrapper.
All crash-point assertions and subsequent recovery/retention assertions remain.

Direct-child signal sites use `spawnTracked` and `signalChild`: capture birth
and the parent at spawn, then recheck the captured birth and expected argv at
dispatch. Null JavaScript exit fields alone are not authority. If capture
fails for a command that exits quickly, its ordinary completion remains usable,
but no later signal is permitted. The keeper's pipe protocol remains intact.

Self-directed faults are separate: JavaScript fixtures use `signalSelf`, which
accepts no caller-supplied PID/PGID; C fixtures use `raise`. Their executing
process proves its own current identity. A living member can signal its own
group. The publisher's private `.kill` request and unconditional teardown
release retain round 3's protection against PID reuse between checking and
fault delivery. Immediate checks on other numeric fault paths do **not** claim
a kernel handle or eliminate every possible exit-to-syscall race.

## Complete signal-site audit

Line references in this table name the round-3 sites from Astra's audit.
[Mechanical search of the final sources](evidence/signal-audit.txt).

| Sites | Final treatment |
| --- | --- |
| Background 128, 206, 407, 545, 616, 989: driver/worker, simulator death, custody, owner watcher, skipped/sole maintenance | Pass the complete native record through the shared birth/command gate. A blocked tool no longer substitutes for current target identity. Existing state waits, deadlines and invariant assertions remain. |
| Background 1089, 1125, 1157: publication and maintenance checkpoints, empty legacy claim | Revalidate the checkpoint birth immediately before SIGKILL. An expired checkpoint refuses instead of dispatching or treating ESRCH as success. |
| Background 1118, 1149, 1175, 1188: passive observer, handoff and parked repair | Validate the observer/checkpoint record. The scan PID equality assertion is retained and supplemented with birth/command validation. |
| Background status observer and direct retention caller; publication wrappers/probes; export-native signal forwarding | Capture direct-child birth at spawn and dispatch through `signalChild`. Already completed children need no teardown signal; explicit fault dispatch to a completed child fails. |
| `app-server`, `avatar-fixture`, `read-through-server`, `timeline-recovery` | Same tracked-child gate for server cleanup. Existing completion waits remain. |
| `test-processes` command timeout/overflow | Track the inspection child at spawn; validate it before SIGKILL. Failure to validate is reported, never replaced with an unchecked numeric kill. The pre-existing signal-number-zero existence probe now rejects nonpositive/invalid PIDs; it delivers no signal and confers no ownership. |
| Background 131, 151, 249; export-failure liveness | Background liveness uses process state, not a numeric existence signal. Export-failure checks the native birth when awaiting maintenance exit. These observations authorize no faults. |
| Background gzip and its child; `test-file-owner`; export-failure self-termination | Shared `signalSelf`, with no borrowed numeric target. Compressor release remains armed only after the unaided product assertion or on timeout/teardown. Keeper EOF still owns group cleanup. |
| `publication-interposer.c` | Atomic PID publication unchanged. Both C terminations now use `raise`; neither accepts a numeric PID from the test. |
| `retention-interposer.c` | Its parsed PID only decides whether its own `getpid()` should pause; it never signals that number. |
| Copied `witness-simctl.py` | The Rust source also contains three parent/group interrupt dispatches in modes unused by these three JS cases. The JS fixture copy replaces those dispatches with explicit refusals and asserts none remain. Its driver-death modes still run normally; all death injection belongs to `signalFixture`. The original Rust fixture and its separate interrupt tests are unchanged. |
| `live-margin-load` | Removed cached negative-PGID signals. Busy workers exit on their owned stdin pipes closing; the test runs under the existing keeper and releases it by pipe. The keeper signals only its own group. |
| `publication-roundtrip-mock` | Its replacement `process.kill` records/asserts calls; it never signals the kernel. |

The governing context is LLP 3000#publication-suite-under-contention and
LLP 3000.030#15. LLP 3000 now records dispatch-time identity requirements.
There is no product-source change. The strict read test is byte-identical to
round 3; all custody, simulator cleanup, publication, completeness and meter
assertions remain. [Preservation check](evidence/preservation.json).

## Regressions and verification

The new background case uses the **actual** `publication-committed` checkpoint,
waits 22 seconds, observes publisher exit, and calls the same fault helper.
It requires refusal and **zero dispatch attempts**. Dispatch is intercepted,
so removing the guard cannot signal a recycled PID during this control.
The original twelve publication crash cases still execute their full
SIGKILL/recovery assertions. The file now declares 95 cases, 32 Darwin-only.

The shared-process regression uses a real owned child and intercepted dispatch.
Invalid PIDs, missing/changed birth, wrong command, an untracked handle and
an exited child all refuse; matching recorded and tracked-child dispatches
reach the interceptor with the exact expected PID/signal. The existing two
atomic publisher tests also cover missing birth explicitly.

- **Five export files:** **83 passed, 33 existing platform skips**, zero failures
  or runner leaks. Background is **63 passed / 32 Darwin skips**, including
  the real 22-second expired-checkpoint control. Publication passes all six
  cases. [Final log](evidence/export-final.log).
- **Shared runner/process inspection and four helper consumers:** the final
  adjacent run passes **164 tests**, with **one** existing platform skip and
  no runner leaks. This includes four export files, 53 process-inspection
  tests, 42 runner tests, and app-online, avatars, read-through and timeline
  suites. [Log](evidence/adjacent-final.log).
- **20 loaded rounds:** **60 passes** across the two publisher regressions and
  the signal-gate regression. Four directly owned busy loops and tests share
  CPUs 80–81; all loops exit through their owned pipes and are reaped. Source
  hashes stay fixed during the final run. [Summary](evidence/loaded-summary.json),
  [output](evidence/loaded-barriers.log). The updated load helper also passes
  its own two-busy-worker publication run and reaps its workers:
  [metadata](evidence/load-helper.host.json).
- **Dispatch-guard mutation:** removing only the dispatch check from a private
  helper copy makes both the signal regression and real 22-second checkpoint
  control fail. All attempted calls are intercepted; no stale signal reaches
  the kernel, and the runner reports no leaks.
  [Summary](evidence/signals-negative-summary.json), [log](evidence/signals-negative.log).
- **Atomic-publication mutation:** create-before-write makes both existing
  barrier regressions fail at the incomplete-record assertion. Cleanup reaps
  their processes. [Log](evidence/barrier-negative.log).
- **Read controls:** all 42 Astra field corruptions reject the first pair,
  including 21 with sequence advance. One lone advance passes both trace
  modes, endless advancement fails at eight pairs, and removing the strict
  comparison makes its regression fail. The source is restored/rebuilt;
  `dev_refusals` passes **22/22**. [Fields](evidence/review-fields.json),
  [corruption summary](evidence/retry-masking-summary.json),
  [retry controls](evidence/retry-controls-summary.json), [suite](evidence/dev-refusals.log).
- **Custody and timeout controls:** disabled native drain still fails the
  105-second state assertion; deliberate test timeout still fails. Both reap
  fixture custody and remove their roots, with no runner leak.
  [Drain control](evidence/custody-negative.log), [timeout](evidence/timeout-control.log).
- **Simulator recovery replay:** both positives pass and retained ownership,
  wrong marker, late unrelated call and changed export still reject.
  [Results](evidence/simulator-cleanup.json). This exercises Linux recovery,
  not Darwin background-driver execution.

Development failures are retained: twelve command refusals before correcting
the exact publication source pathname; dependency/artifact failures before
local preparation; and an accidentally removed inline fixture import, restored
before the successful fresh publication run. The old waiting file was stopped
through the validated identity of **only its owned Node test process**; the
runner released its keeper and reported no group leak. The read-corruption
harness initially lacked its copied input matrix and ran no corruption cases;
the input was copied before the successful final run. None of these runs is
represented as a passing qualification.

Dependencies were installed from the frozen lockfile in this worktree. The wasm
and client builds supplied missing local test artifacts; wasm measured 645,264
gzip bytes against the unchanged 645,564-byte budget. No generated bytes,
package versions or product code are committed. Text logs normalize trailing
whitespace and omit trailing empty lines. Darwin execution, including compiling
the native identity inspector with the Mac SDK, remains for the user's soak.
No publication qualification or fresh independent review verdict is claimed.
Syntax and whitespace checks pass. `ref-check --verbose` reports the same
pre-existing missing LLP 3000.035 anchor at `snapback4-difftest/src/lib.rs:3`;
both files are unchanged by this round. No new reference error was reported.
[Reference-check log](evidence/ref-check.log).

## Reproduce

From `snapback4/`, after the normal local binary/client artifact preparation:

```sh
node scripts/run-client-tests.mjs 2 files packages/snapback4/test/export-background.test.mjs packages/snapback4/test/export-publication.test.mjs packages/snapback4/test/export-native.test.mjs packages/snapback4/test/export-native-round2.test.mjs packages/snapback4/test/export-failure.test.mjs
python3 reports/20261007-fl-dry-run-flakes/round-4/reproduce/load.py
node reports/20261007-fl-dry-run-flakes/round-4/reproduce/signals-negative.mjs
node reports/20261007-fl-dry-run-flakes/round-4/reproduce/barrier-negative.mjs
python3 reports/20261007-fl-dry-run-flakes/round-4/reproduce/retry-masking.py
python3 reports/20261007-fl-dry-run-flakes/round-4/reproduce/retry-controls.py
node reports/20261007-fl-dry-run-flakes/round-4/reproduce/custody-negative.mjs
node reports/20261007-fl-dry-run-flakes/round-4/reproduce/timeout-control.mjs
node reports/20261007-fl-dry-run-flakes/round-2/reproduce/simulator-cleanup.mjs
```

Run the two Rust mutation harnesses sequentially; both restore/rebuild in
`finally`. The custody negative control reuses the existing private round-0
disabled-drain binary under `target/fl-negative`, never modifying product source.
