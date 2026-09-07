READY

Independent grok-4.6 xhigh review of the frozen r3 timeout measurement-helper correction. Exclusive directory `/Users/ccheever/clique-improvement/reviews/default-install-timeout-race-r2/grok`. No peer material. No author verdict consumed as authority. Read-only: zero semantic children, zero helper/regression imports or executions, zero npm/install/ci/network/build/publication. No subagents. This is not npm-install performance qualification, not a replay of original017, and not independent clearance of any source/product repair.

## Scope

Exact r3 candidate helper versus the original parent and versus the prior reviewed r2 helper, plus the existing Root-run six-case r3 controls. Controlling prior static finding (closed Astra, pair disposition CHANGES_REQUIRED): new `logComplete=true` incorrectly inferred that all log writers finished from direct Popen child reaping. Prior Grok READY on that r2 helper does not refute the descendant-writer condition.

Assessed:

- removal of `logComplete` and comments that `actualProcessWaitCompleted` is direct-child-only and `logSha256` is a receipt-time snapshot
- controls asserting absence of the unsupported field while retaining meaningful timeout/identity/wait assertions
- timeout failure 124 despite later actual 0 or -9
- unknown `actualReturnCode` null and retained running marker
- actual waits/reaping
- no signal on identity refusal
- first-failure order
- waits, deadlines, and production argv
- no new descendant-writer framework or authority
- introduced versus inherited defects; untested hypotheses not treated as failures of this delta

File identities (not Git commits):

- original parent `2c21f71603cef8d81f34456f5fda0268c81de2a15ba989af62e29f428967f45c` — verified this turn by `shasum -a 256` of the supplied copy
- prior reviewed helper `c10d60e9dc8617f73f0c8e343abb450a0e81e6bfc4f9b8e8df69a9eab813ae9f` — recorded in `unchanged-inputs.json`; that r2 file is not in this packet and was not hashed from a live r2 tree
- corrected candidate `b66c1e0e7eddb99d6a17a3902a0d3fb116f35618c47068d16b8d97a87438fa0a` — verified this turn by `shasum -a 256` of the supplied copy

## Read inventory

Inbox and bindings first: `work/supervisor-inbox.md`, exclusive `workload.json`, `prompt.md`, `request.json`, `launch.json`, `source-manifest.json`, `provider-inputs.json`, `input/author-closure.json`, `input/root-reported-runner-closure.json`, `input/provider-inputs/reviewer-persona.md`, `input/provider-inputs/context-custody.json`. Bundled review skill and persona were disclosed equally; they did not expand this into GitHub posting, subagents, or live workspace scans.

Author packet: complete `REPORT.md`, `phase.json`, `request.json`, `workload.json`, `input-manifest.json`, `unchanged-inputs.json`, `static-inspection.json`, `actual-launch-identity.json`, `native-terminal-receipt.json`, `supervisor-terminal-identity.json`, `closed-review-consumption.json`, `closed-review-custody.json`, `regression-prompt.md`, `root-approval.template.json`.

Helpers and harness: complete `parent-helper.py`, `candidate-helper.py`, `helper.diff`, `helper-vs-r2.diff`, `regression.py`, `regression-vs-r2.diff`, `controlled-child.py`, `run-regressions.py`, `runner-vs-original.diff`, `path-bindings-vs-r2.diff`. Historical copies `regression-vs-r1.diff` and the start of `path-bindings-vs-r1.diff` (byte-identical r2 evidence, not r3 behavior).

Closed prior-round reviews (shared equally, not live peer findings): both `closed-reviews/*/review.md`, `actual-identity.json`, `terminal.json`, `supervisor-terminal-identity.json`, `input-integrity-after.json`, plus `closed-pair-disposition.json` and both `supervisor-read-only-amendment*.json`.

Original017: `original-evidence.json` and snapshots `outer.log`, `report.json`, `terminal.json`, `receipts/default-install.running.json`, `receipts/default-install.log`, `supervisor-owned-process-observation.json`, `supervisor-owned-group-observation.json`. No `default-install.json` is present (missing terminal receipt).

r1 harness failure: `r1-failure.json` and snapshots `REPORT.json`, `parent-exit-during-identity.outer.log`, `.terminal.json`, `result.json`, `receipts/probe.log`, `receipts/probe.running.json`, `root-owned-process-observation.json`.

r2 custody (earlier-pass, not r3 execution): complete `r2-evidence.json`.

r3 Root run: `execution/REPORT.json`, `execution/root-outcome.json`, `execution/owner.json`, and for each of the six cases the complete `result.json`, receipts, probe logs, `.terminal.json`, and `.outer.log`.

Own notes: `work/inspection-notes.md`. This review writes only that file, `review.md`, and `final-answer.md`.

## Inspection activity (actual; no ceiling)

No artificial inspection-count ceiling was applied. File reads count. This is not “1 of 30 shell-only.”

- 2 directory listings (exclusive grok root; `work/`)
- 2 mistyped paths, then successful full reads of `REPORT.md` and `unchanged-inputs.json`
- full reads of every file in the inventory above (path-bindings-vs-r2 in two slices)
- 5 content searches: `logComplete` under `input/`, under `execution/`, and in both helpers; helper `INSTALL`/`childSeconds`/`timeoutSeconds` symbols
- 2 shell inspections, each under 1s and well under 30s: `shasum -a 256` of 13 supplied files; `diff -u` parent versus candidate
- 0 Python interpreters against supplied modules, 0 imports, 0 regression reruns, 0 new witnesses, 0 npm/install/ci/network/build/publication, 0 source edits, 0 sibling access, 0 original live workspace access

Reading retained result files is not a claim that this reviewer re-ran the six controls.

## Retained facts (from packets, not re-executed)

- Original017 default-install timed out after ~29.89s; kill then raised `RuntimeError: process identity unavailable/changed`; terminal receipt omitted; `checks: []`; CI unrun; `automaticRetry` false; actual npm exit unknown (`originalActualInstallExitCode` null). Later log text `added 4 packages in 30s` and later process absence do not establish exit 0. No retry.
- r1 failed before NOTE_EXIT: Python 3.9 `select.kqueue` has no `__enter__` (`AttributeError: __enter__` at r1 `regression.py:97`). Case PID 85724 exit 1; controller child return 0; five cases unrun. That run does not establish helper behavior.
- r2 Root run (custody only): tool 16623, outer exit 0, chunk `2e546f`, loop `10.023559333s`, six passing cases. Closed pair disposition was CHANGES_REQUIRED on the `logComplete` metadata. Those six passes are not r3 results and do not prove descendant-writer closure.
- r3 Root run: tool **83351**, outer exit **0**, chunk **185f15**, loop **6.696467833s**, `execution/REPORT.json` SHA-256 `ff02a23ae5f6ff4a2607d4641971057b9eb7bb11effad452b5cac569aa12c612`, all six case processes exit 0, `automaticRetry` false. Author closure is separately evidenced by outer tool **96157** / native PID **3780**, both actually 0. Preparation-time fields (`phase.json` `regressionCasesExecuted: 0`, `request.json` `PREPARATION_ONLY_REGRESSIONS_UNEXECUTED`, native receipt `regressionExecuted: false`) precede that later Root execution and are historical relative to the supplied `execution/` tree.
- Synthetic helper elapsed values of 31 seconds are not measurements of npm performance.

## r3 helper delta

Local `diff -u` of the supplied parent and candidate matches `helper.diff`. The only helper change versus the original parent is `execute()` after `TimeoutExpired`. `kill_owned_group` (`:83-87`), `identity`, success-path `wait`, `require(code == 0, … failed; retain first failure and stop)` (`:218`), `INSTALL`/`CI` (`:28-29`), and `childSeconds == 30` / `outerSeconds == 90` (`:106-107`) are unchanged.

Versus the prior reviewed helper, `helper-vs-r2.diff` is only:

```
# logSha256 is a receipt-time snapshot; descendants may retain log writers.
record.update(..., logSha256=digest(log))
# Completion describes only the directly owned Popen child.
record['actualProcessWaitCompleted'] = child.returncode is not None
- record['logComplete'] = record['actualProcessWaitCompleted']
write_json(...)
if record['actualProcessWaitCompleted']:
    running.unlink()
```

Candidate `candidate-helper.py:209-216` therefore no longer assigns `logComplete`. Grep of that file and of the entire `execution/` tree finds no `logComplete` key. The two comments document remaining field meaning; they do not restore the unsupported completeness claim. They are the requested qualification, not an introduced defect.

Timeout path (`:195-208`) is otherwise the r2 repair: commit `code = 124` and `timedOut = True` before cleanup; `poll()` then `kill_owned_group` only if still unreaped; ordinary cleanup exceptions become `cleanupFailure`; bounded `child.wait(timeout=2)` on the Popen child only; second timeout becomes `cleanupUnknown`. A later actual 0 or -9 never replaces 124. Unlink of `running` remains gated on `actualProcessWaitCompleted`.

## Regression delta and control fidelity

`regression-vs-r2.diff` adds one common absence assertion and removes the two old completeness checks. It does not add cases, children, kqueue paths, or a descendant-writer harness.

```
assert all('logComplete' not in json.loads(path.read_text())
           for path in (receipt, running) if path.exists())
```

(`regression.py:164-165`). Parent still asserts omitted receipt, retained running, identity exception, NOTE_EXIT without test reaping, and controller wait 0 (`:166-171`). Candidates still assert argv/`timeoutSeconds == 30`, `logSha256 == digest(log)` at receipt time, 124 vs accepted 0, actual 0/-9/null, `actualProcessWaitCompleted`, `cleanupUnknown`/running retention on changed identity, immutable receipt bytes after later controller exit 0, one SIGKILL only for the live matching group, and empty signals otherwise (`:173-203`). Reap via `os.waitpid` `ChildProcessError` and group absence remain (`:204-215`). Python 3.9 kqueue `try/finally queue.close()` is unchanged from r2 (`:97-106`); `regression-vs-r1.diff` remains the historical copy of that harness-only fix.

Harness still replaces module `Popen` capture, monotonic clock, `identity`, `getpgid`, and `killpg` only (`:145-150`). Real `Popen` and real `child.wait` are never replaced. `controlled-child.py` and `run-regressions.py` hashes match the r2 correspondence (`a73ce301…`, `15906044…`). Population remains six cases, one FIFO child each, 15s per case / 100s loop, release 30/90 untouched. No new descendant framework or authority.

The `if path.exists()` filter makes the absence check vacuous if neither record exists, but no supplied case is in that state: parent retains running; every candidate writes a terminal receipt. Combined with the remaining per-case asserts, the six controls still have meaningful content beyond field absence.

## Six r3 records (read, not re-run)

Relative paths under `input/author-evidence/execution/`. None of these JSON bodies contains `logComplete`.

| Case | Retained outcome |
| --- | --- |
| `parent-exit-during-identity/` | Parent omission reproduced; no `probe.json`; running retained without `logComplete`; one unreaped NOTE_EXIT; controller actually reaped child 30432 as 0; `signals: []`. |
| `candidate-exit-during-identity/` | Helper 124 / actual 0 / `timedOut` / `actualProcessWaitCompleted` true; cleanup identity failure retained; child 30452 reaped by helper; no signal; running removed; `logSha256` `69c1e1c1…`. |
| `candidate-live-matching-group/` | Exactly one group SIGKILL for 30481; helper 124 / actual -9; child reaped; running removed; log snapshot `5b9d5a54…` (ready line only). |
| `candidate-changed-identity/` | No helper signal to 30502; immutable 124 / actual null / `actualProcessWaitCompleted` false / `cleanupUnknown` / running retained; receipt `logSha256` `5b9d5a54…`; after controller release, on-disk log is `69c1e1c1…` and receipt bytes were not rewritten (`controllerLaterExitCode` 0). |
| `candidate-disappears-before-group-query/` | Helper 124 / actual 0 for 30669; `ProcessLookupError` retained; one unreaped NOTE_EXIT; no signal; helper reaped and removed running. |
| `candidate-before-deadline/` | Real clock, child 30717, `exitCode == actualReturnCode == 0`, elapsed ~0.151s not 31s, no `timedOut`, `identityCalls` 1, no signal; helper reaped and removed running. |

Empty case `.outer.log` files (SHA-256 `e3b0c442…`) mean the regression process wrote no stdout; they are not evidence about the helper child. Runner first-failure stop is unchanged (`run-regressions.py:79`); these six all returned 0 so later cases ran.

Changed-identity is the explicit proof that `logSha256` is a snapshot: receipt hash stayed `5b9d5a54…` while the log later grew to `69c1e1c1…`. That is now documented at candidate `:209` instead of being labeled `logComplete=false`. Completed-wait cases still must not be read as “all writers finished”; the field that said so is gone, and the remaining flag is named and commented as direct-child wait only (`:212-213`).

## Findings

No introduced correctness defect in this r3 metadata delta. The unsupported completeness assignment is gone; controls assert absence; timeout 124, identity refusal, bounded wait, running-marker, first-failure, argv, and deadlines are preserved. Residual unknowns are inherited, explicitly retained by the 2s bound, or would need a new execution that this correction does not authorize.

### 1. `logComplete` removal matches the controlling finding — correct (introduced in r3)

Trigger of the prior defect: `logComplete` copied from `actualProcessWaitCompleted` after waiting only the Popen child, while descendants may still hold the log fd. r3 deletes that assignment. Absence is asserted on existing terminal/running records. Direct-child meaning and receipt-time snapshot are commented at the remaining fields. No descendant execution is required merely to stop making the unsupported assertion.

### 2. Timeout 124 is preserved when the child later exits 0 or -9 — preserved

`candidate-exit-during-identity` and `candidate-disappears-before-group-query`: 124 / actual 0 / wait completed / running removed. `candidate-live-matching-group`: 124 / actual -9 / one SIGKILL. Parent still cannot produce a terminal receipt: identity exception escapes before `write_json`.

### 3. Unknown actual null and running marker — preserved

`candidate-changed-identity`: `actualReturnCode` null, `actualProcessWaitCompleted` false, `cleanupUnknown` true, running retained, `signals: []`. Later controller exit 0 does not rewrite the helper receipt.

### 4. Actual waits/reaping and no-signal identity refusal — preserved

Exit-during and disappears: NOTE_EXIT without test reaping, then helper wait/reap. Live matching group: actual `os.killpg` SIGKILL. Changed/disappeared/parent: `signals: []`. `kill_owned_group` identity/group gate is unchanged (`:83-87`).

### 5. First-failure, waits, deadlines, production argv — preserved

Timeout and parent-identity failures still `require` and stop after appending the check (`:218`). Success path still uses the original wait result as `exitCode` (`candidate-before-deadline`). Helper `INSTALL`/`CI` and preflight `childSeconds == 30` / `outerSeconds == 90` are byte-identical to the parent. These controls never call `main()` and never run npm.

## Introduced versus inherited

Introduced in r3 (this metadata delta): delete `logComplete`; comment direct-child completion and receipt-time `logSha256`; assert field absence in existing records; drop `logComplete is True/False` checks. No new process framework.

Inherited (unchanged, not demanded here): r2 timeout/reap repair; `kill_owned_group` ps+pgid gate; 2s Popen wait; `except Exception` around kill (not `BaseException`); first-failure stop; no retry; Darwin `identity()`; parent still omits the receipt; original017 actual npm exit unknown; CI unrun on that failure; later absence is not success; single-child controls.

Not in this delta: product/source change, npm argv, 30/90 release deadlines, descendant-writer observation, process-framework redesign.

## Limitations (untested without a new execution; not CHANGES_REQUIRED)

- Controls do not measure npm install latency or original017 child 74883. Original log later contains `added 4 packages in 30s`; that is not an `actualReturnCode`. Supervisor observations already record `npmInstallExitCode: null`.
- Deadline in five cases is synthetic (`wait(timeout=0)`). Only `candidate-before-deadline` uses a real clock, and that child is a FIFO script, not npm.
- Changed-identity is a deterministic fake identity string on a still-live own child, not live PID reuse.
- `getpgid` in the disappears case raises a harness `ProcessLookupError` after real NOTE_EXIT rather than calling Darwin `getpgid`. Wait/reap of that dead child is still real.
- 2s wait leaving `cleanupUnknown` / actual null / running retained is an explicit remaining unknown. Whether SIGKILL of a matching npm group always reaps within 2s is untested here.
- `poll()` then skip kill when the leader is already reaped, with extra members still in the group, is untested (one controlled child per case).
- `actualProcessWaitCompleted` and `logSha256` still do not establish that no inheriting descendant holds the log fd. That is now an explicit non-claim. A descendant-writer witness would be new execution and is **untested here**; it is not required to remove the unsupported field.
- `except Exception` around kill does not catch `BaseException`; a non-`TimeoutExpired` error from `wait(timeout=2)` still skips the receipt. Untested.
- Empty case `.outer.log` files are not helper-child evidence.
- Source repair is not independently cleared.

## Historical protocol facts (preserved; old reports not rewritten)

Closed pair: Astra `CHANGES_REQUIRED` (report SHA-256 `8b85bc27…`), Grok `READY` (`edeb754a…`), disposition `CHANGES_REQUIRED`. Prior Grok READY does not refute the descendant-writer finding. Prior Grok actually 71 read-only inspections (`read_file` 67, `list_dir` 3, `run_terminal_command` 1) exceeded original 30 and prospective 60; that report’s “1 of 30” counted shell-only and is not full compliance. Inbox amendments were delivered without observed reread. Final cap-removal amendment (`supervisor-read-only-amendment-02.json`, 2026-09-07T22:30:36Z) postdates both native closures (Astra native end 1788820190.100179, Grok native end 1788820219.8252318). Those deviations remain historical; this review does not rewrite the closed reports.

Author preparation recorded a truncated combined Grok-report read (`toolChunk` `bf1e4d`) corrected by a full separate read (`b4aae9`) before derivative edit; no semantic or execution effect is claimed.

## Verdict

READY. The r3 candidate removes the unsupported `logComplete` inference, comments direct-child wait and receipt-time log snapshot, and keeps six controls that still assert 124-versus-actual-0/-9, unknown null plus running, actual wait/reap, no-signal identity refusal, first-failure stop, and unchanged production argv/deadlines. Runner and controlled child are unchanged. No new descendant framework was added, and none is required for this metadata correction. The six Root records passed as supplied; this reviewer did not re-execute them. Original017 remains a failed timeout with unknown actual npm exit and unrun CI. This verdict does not qualify npm, performance, release, or source deployment.
