# FS — witness, lease and worker flakes

2026-10-08 · eb1000 (`expose-builder-pixel`) · branch `sb4-intent/fs-witness-worker-flakes` · starting commit `ecba83f39e2f8539ffa08d73949e8e953760f3e7`.

Six of the seven requested tickets are closed with evidence; the Darwin-only existing-app driver ticket remains open. The additional preparation receipt bug is fixed and closed. Every requested portable Rust case passes all 30 final loaded runs, and each worker case passes 30 loaded runs with negative controls. Broader loaded runs retain the unrelated failures listed below. Nothing pushed.

## Changes and causes

The smoke barrier, orphan reconciliation and recovery assertions assumed that dropping the local handle released the kernel flock immediately. A concurrent libtest neighbour can fork while that descriptor is open. Close-on-exec does not close it until exec: the child retains the same open-file description and therefore custody. Roots are distinct; a shared fixed path is not the cause. Production refusal/deferral is correct. An explicit unlock would incorrectly release another holder's custody.

The affected last-close scenarios now re-execute in their own test process, while their ordinary neighbours continue running concurrently. Each scenario retains its own intentional concurrent processes. A pipe-gated child deterministically holds the fork-inherited store/retention/run/export/destination descriptions after parent drop, then exits and is reaped before reacquisition. The smoke control exposes the underlying `E_STORE_BUSY`; the retention control exposes the exact `E_WITNESS_ARTIFACT: retention lock busy`. A separate 122-second fixture guard bounds an isolated child's hang, using the existing test slack convention. No product lease or timeout changed.

The three symlinked-manifest worker tests used synchronous process completion as their only wait. The host remains alive after source refusal, so each consumed its entire 122-second guard. They now use the existing asynchronous fixture, wait for the exact refusal log, preserve the no-worker-start assertion, and explicitly stop/join the owned host. The no-start assertion runs again after shutdown. The ancestor case supplies its nested project to the same fixture; diagnostics and cleanup follow that directory.

Two old fixes were already present: `bb943663952` isolated the preparation lease test and added its fork/CLOEXEC control; `33b412a54ba` made supervised-worker log observation explicit. FS leaves those test assertions intact and closes their tickets with new load and negative-control evidence.

**One product diagnostic bug was also fixed.** A preparation could succeed but its receipt report `expired: true`, because the receipt sampled time after descendant cleanup. The preparation's completion instant is now captured before cleanup; its receipt is still written only after cleanup succeeds. Cleanup retains its separate deadline. No idle/hard bound or success assertion was raised or removed. A virtual-time regression proves on-time completion followed by a clock beyond the hard cap, and exact idle-boundary expiry.

## Reproduction and stress setup

All work ran in this worktree on eb1000. No other worktree or lane process was changed. `bun install --frozen-lockfile` passed; `bash ~/sb4-intent/check-sdk-deps.sh` printed `deps-ok` when run from `snapback4/` (the initial repository-root invocation failed its relative package lookup). Node is 24.13.1. Cargo used six build jobs and `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. A fresh SDK build initially lacked the generated wasm declarations; the ordinary `scripts/build-wasm.sh` and SDK build supplied them. The wasm budget passed (645,680 B gzip / 646,180 B).

[repeat.py](repeat.py) records each command, exit status, elapsed duration, CPU affinity, owned busy-loop PIDs and their reaping in per-stage `summary.json`; raw output is retained as numbered `.log.gz`. It starts Python busy loops with `taskset`, runs two test binaries concurrently where stated, and signals only its own recorded children. Test commands and descendants inherit affinity. Rust uses four libtest threads. There is no host-wide stress or process-name cleanup.

- Baseline witness: 30 runs of all 72 witness cases, two concurrent binaries, CPUs 72–73, six owned busy loops. The first part overlapped the worker baseline's six additional loops on the same CPUs; subsequent runs had six. Final/candidate witness campaigns deliberately use twelve loops to cover the stronger load.
- Whole CLI: five baseline, five isolation-candidate and five final runs, four test threads, six busy loops on two CPUs (74–75 initially, 86–87 for final).
- Worker pair: 30 loaded runs, both files in parallel, two concurrent Node commands and six busy loops on CPUs 76–77. Each run executes the three refusal cases and both supervised-worker modes.
- Supervised delayed-log control: 30 runs of both modes on CPUs 78–79. The control withholds every stderr chunk until **both startup files have been observed**, then releases it after 250 ms. The file-to-pipe order is forced, not left to a lucky scheduler.
- Portable witness integration: 30 runs of all 32 Linux cases, four test threads and concurrent binaries under taskset load. The Darwin-only driver case is absent, not a pass.

Source and executable receipts are in [final-sha256.txt](final-sha256.txt). The final Rust unit binary and sibling CLI are pinned together under `target/fs-final/debug/`; mutation controls use different binaries and never replace that pair. The baseline was built before source edits and its campaigns finished before its executable was replaced. No baseline executable digest was captured. [summarize.py](summarize.py) derives [evidence.json](evidence.json) from raw logs; nested isolated-test results are not counted as additional outer tests.

## Baseline findings

| Case | Baseline evidence |
| --- | --- |
| Smoke commit-clock barrier | 30 witness runs and five whole-binary runs passed; a deliberate inherited holder reproduces its exact refusal deterministically. |
| Preparation lease release | Already fixed: 30 witness and five whole-binary runs pass, including the fork/CLOEXEC regression. |
| Orphan reconciliation named by DK | Fails 4/30 loaded witness runs at immediate post-drop cleanup/identity assertions. The pipe-gated retention control reproduces DK's exact lock-busy code. |
| EM ownerless-shell recovery | Fails 1/30 witness runs. |
| EM unfinished-export discovery | Fails 6/30 witness runs (`all discoveries were covered`). |
| Repeated-kill orphan-marker neighbour | Fails 9/30 witness runs. |
| Two-wrapper publication neighbour | Fails 1/30 witness runs and 2/5 whole-binary runs at retention reacquisition. A later isolated run exposes a separate intentional recovery/publisher contention, tracked below. |
| Worker refusals | All three pass only after 122.054–122.099 seconds each; the two-file baseline takes 367.656 seconds. |
| Supervised workers | Already fixed; both baseline modes pass. Removing the log wait under forced delivery order reproduces the original assertion failure. |
| Preparation receipt | Fails 30/30 loaded witness runs after successful preparation, with `expired: true`; fixed as a product receipt-timestamp error. |

EM's report was absent from the worktree but present in local Git commit `e408e47929`. Read-only `git show` identified its rounds 5 and 7 and the existing ticket `20261008-snapback4-parallel-recovery-fixture-leases.md`; no duplicate ticket ID was minted. [Provenance and original ticket](em-provenance.txt). EM's two signatures match the cases reproduced here; its publication/retention implementation changes were not imported.

## Controls and completed checks

[rust-controls.py](rust-controls.py) builds private test-only mutations that retain a known holder through the original positive assertion. Store barrier, retention reconciliation, discovery and preparation lease controls all fail with status 101 at the intended assertion. The ownerless-shell control holds its initialization/publication descriptors until the isolated fixture exits. These controls preserve all original positive assertions; they demonstrate that process isolation does not turn retained custody into success. The receipt control restores sampling the later clock and fails the new virtual-time assertion. Every mutated source is restored in `finally`.

[worker-controls.py](worker-controls.py) retains three controls: remove the existing wait and fail immediately after the files are ready; withhold authentication logs and fail at the unchanged 122-second wait guard; withhold refusal logs in each of the three manifest scopes and fail at that guard. Cleanup still joins the fixture-owned hosts. Delayed delivery passes all 30 runs in both modes. No timeout was lowered to make these results fast.

The worker fixes pass 30/30 per case. Refusal median durations are 341 ms (snapback manifest), 247 ms (project), and 220 ms (ancestor); every sample is below 459 ms under this load. The complete affected client files pass 82/82 with the final CLI. The complete affected Rust command passes 335 CLI unit tests (four existing ignores) and 32 Linux witness integration tests with one test thread. `./ref-check --verbose` passes with zero errors and zero unchecked references.

## Final results and ticket disposition

The final 30 witness-module runs use two concurrent binaries, four test threads each, twelve busy loops and CPUs 84–85. **All five requested portable Rust cases pass 30/30**, as do the preparation real-output/stall case and the repeated-kill orphan neighbour. Twenty-nine complete runs pass 73/73; one passes 72/73 with the separately ticketed native `/proc` refusal. Total outer witness results: 2,189 passed, one failed. All five final whole-CLI runs pass the requested cases; four pass the complete 335-test inventory and one fails only the unchanged latency snapshot assertion (four existing ignores per run). No failure is normalized away.

Every recorded campaign finished and reaped its busy loops. All six Rust mutation controls exit 101 at their intended assertions; all four JavaScript/fixture negative controls exit 1. Final source is restored after mutations, the normal unit artifact was rebuilt, and `git diff --check` passes. The journal and covering LLP were reconciled with the code; guide/production custody facts remain applicable.

| Requested ticket | Disposition |
| --- | --- |
| [Existing-app witness driver](../../../issues/20260915-snapback4-witness-driver-existing-app-test-flaky-under-load.md) | **Open:** actual case is Darwin-only; 30 portable fixture controls do not qualify it. |
| [Smoke store owner](../../../issues/closed/20261002-snapback4-unit-witness-owner-race.md) | Closed: isolated scenario, forced inherited store holder, original positive assertion rejects the retained-holder mutation. |
| [Preparation lease](../../../issues/closed/20261002-snapback4-witness-parallel-lease-test.md) | Closed: previously fixed; 30-run load and retained-owner control confirm it. |
| [Worker refusal waits](../../../issues/closed/20261002-snapback4-worker-refusal-tests-wait-entire-hang-guard.md) | Closed: precise refusal observation and owned shutdown, all three scopes. |
| [Supervised worker log race](../../../issues/closed/20260930-snapback4-supervised-workers-log-race.md) | Closed: previously fixed; forced file-before-log delivery passes, missing logs and old observer fail. |
| [DK orphan reconciliation](../../../issues/closed/20261008-snapback4-witness-orphan-reconciliation-parallel-lease.md) | Filed and closed: inherited custody reproduced and preserved; immediate reacquisition isolated. |
| [EM recovery fixture leases](../../../issues/closed/20261008-snapback4-parallel-recovery-fixture-leases.md) | Existing EM identity retained and closed for both named cases, with separate stuck-holder controls. |

Additional fixed product issue: [preparation receipt counted cleanup](../../../issues/closed/20261008-snapback4-preparation-deadline-receipt-counts-cleanup.md). Separate open follow-ups: [native process inspection](../../../issues/20261004-snapback4-native-witness-proc-group-inspection.md), [latency timing assertion](../../../issues/20261008-snapback4-cli-latency-snapshot-load-timing.md), and [intentional two-wrapper contention](../../../issues/20261008-snapback4-two-wrapper-recovery-contention.md).

## Limits and open follow-ups

The 2026-09-15 existing-app driver ticket remains open. Its pre-running-state hypothesis is unsupported: since `cdae076a803` on September 14, the fake simctl returns PID 6999 synchronously in `running` mode even without a PID file. Thirty loaded cold-fixture checks, including no-app and replacement-PID controls, pass; deleting that fallback fails. The driver's budget changed in `5593f264df1`, but Linux cannot establish that the original Darwin failure is resolved. [simctl-control.py](simctl-control.py) tests only that fixture premise. No macOS, simulator or complete Darwin dry-run qualification is claimed.

The unfiltered campaigns keep all failures visible. The native `/proc` process-group refusal recurred on baseline and final source and remains in its existing open ticket. The unrelated latency snapshot case failed its real-time assertion in baseline/candidate/final whole-binary runs; it has a separate new open ticket. One isolated two-wrapper publication run conservatively refused another recovery's export custody, then missed the success file; that intentional race also has a separate open ticket. No parser, lock refusal or survivor assertion was weakened to clear these failures. This work does not claim the entire loaded suite is deterministic.

No push or publication is part of this work.
