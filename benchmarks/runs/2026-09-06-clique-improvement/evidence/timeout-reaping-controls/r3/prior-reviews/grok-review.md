READY

# Independent review: timeout measurement-helper repair

Reviewer: grok-4.6 (xhigh). Exclusive directory only. No peer material. No author verdict consumed as authority. Read-only: zero semantic children, zero helper/regression imports or executions, zero npm/install/ci/network/build/publication.

## Scope

Exact candidate helper versus parent helper, plus the existing Root-run six-case controlled results. This is not npm-install performance qualification, not a replay of original017, and not independent clearance of any source/product repair.

Assessed:

- timeout failure 124 despite later actual 0 or -9
- wait/reap during exit-versus-identity races
- no signal on changed identity
- owned-group cleanup
- cleanupUnknown / actual null / running / logComplete truthfulness
- non-timeout behavior and first-failure stop
- whether controls exercise real kqueue NOTE_EXIT / FIFO / Popen / wait rather than substituting `execute()`
- Python 3.9 kqueue try/finally close
- exception and error-order limits inside this delta, including retained unknown child state
- introduced versus inherited defects

File identities (not Git commits), verified here by SHA-256:

- parent `2c21f71603cef8d81f34456f5fda0268c81de2a15ba989af62e29f428967f45c`
- candidate `c10d60e9dc8617f73f0c8e343abb450a0e81e6bfc4f9b8e8df69a9eab813ae9f`

## Files read

Inbox and bindings: `work/supervisor-inbox.md`, `workload.json`, `prompt.md`, `request.json`, `input/author-closure.json`, `input/author-evidence/workload.json`, `input/author-evidence/unchanged-inputs.json`, `input/author-evidence/input-manifest.json`, `input/author-evidence/request.json`, `input/author-evidence/phase.json`, `input/author-evidence/static-inspection.json`, `input/author-evidence/REPORT.md`, `input/author-evidence/native-terminal-receipt.json`, `input/author-evidence/supervisor-terminal-identity.json`, `input/provider-inputs/grok-bundled-review.SKILL.md` (skill copy only; did not expand scope).

Helper and harness: complete `parent-helper.py`, `candidate-helper.py`, `helper.diff`, `regression.py`, `controlled-child.py`, `run-regressions.py`, `regression-vs-r1.diff`, `path-bindings-vs-r1.diff`, `runner-vs-original.diff`.

Original017: `original-evidence.json` and snapshots `original-evidence/outer.log`, `report.json`, `terminal.json`, `receipts/default-install.running.json`, `receipts/default-install.log`, `supervisor-owned-process-observation.json`, `supervisor-owned-group-observation.json`. No `default-install.json` is present (missing terminal receipt).

r1 harness failure: `r1-failure.json` and snapshots `r1-failure/REPORT.json`, `parent-exit-during-identity.outer.log`, `.terminal.json`, `parent-exit-during-identity/result.json`, `receipts/probe.log`, `receipts/probe.running.json`, `root-owned-process-observation.json`.

Root six-case run: `execution/root-outcome.json`, `execution/REPORT.json`, `execution/owner.json`, and for each of the six cases the complete `result.json`, receipts, logs, `.terminal.json`, and `.outer.log`.

Local inspection command (1 of 30): SHA-256 of helpers, harness, helper.diff, selected probe logs/receipt, REPORT.json, and all six outer logs.

## Retained facts (confirmed from packets, not re-executed)

- Original017 default-install timed out; kill then raised `RuntimeError: process identity unavailable/changed`; terminal receipt omitted; `checks: []`; CI unrun; `automaticRetry` false; actual npm exit unknown. Later log text and later process absence do not establish exit 0. No retry.
- r1 failed before NOTE_EXIT: Python 3.9 `select.kqueue` has no `__enter__` (`AttributeError: __enter__` at r1 `regression.py:97`). Case PID 85724 exit 1; controller child return 0; five cases unrun. That run does not establish helper behavior.
- r2 Root run: tool 16623, outer exit 0, chunk `2e546f`, loop `10.023559333s`, `REPORT.json` SHA-256 `a2a3e17b85f51a381e6d4c69305d66d424c978b9bfae5738674dff93e78d4adb`, all six cases `ok: true`. Author-closure tool 80585 / chunk `ab45b5` is preparation native/outer closure; preparation “unexecuted” statements are historical relative to this later Root run.
- These controls do not qualify npm install performance or turn original017 into success. Source repair has not been independently cleared.

## Helper delta

The only candidate change is `execute()` after `TimeoutExpired` (`helper.diff`; candidate `candidate-helper.py:193-218` versus parent `:193-205`). `kill_owned_group`, `identity`, success-path `wait`, `require(code == 0, … failed; retain first failure and stop)`, and the install/ci body are unchanged.

Parent order on timeout: `kill_owned_group(record)` then unbounded `child.wait()` then `code = 124`. Identity failure raises before `code` is set and before the terminal receipt is written (`parent-helper.py:196-202`). That is the original017 traceback (`original-evidence/outer.log` lines 1–23: `TimeoutExpired` at execute:194, then `kill_owned_group` at :196, `require` at :85).

Candidate order on timeout:

1. `code = 124` and `timedOut = True` first (`:197-198`).
2. `try`: `poll()` then `kill_owned_group` only if still unreaped; any `Exception` becomes `cleanupFailure` (`:199-203`).
3. `try`: `child.wait(timeout=2)` on the Popen child only; `TimeoutExpired` becomes `cleanupUnknown` (`:204-208`).
4. Record `actualReturnCode=child.returncode`, `actualProcessWaitCompleted = child.returncode is not None`, `logComplete` equal to that flag (`:209-212`).
5. Write the exclusive terminal receipt; unlink `running` only if wait completed (`:213-215`).
6. Append the check, then `require(code == 0, …)` (`:216-218`).

Error order is the repair: semantic 124 is committed before cleanup identity can throw. Bounded wait replaces the parent’s post-kill unbounded wait, so a refused identity cannot hang `execute()`.

## Findings

No introduced correctness defect in this delta. The six Root controls match the helper’s stated timeout/reap/identity contract. Residual unknowns are either inherited, explicitly retained by the 2s bound, or would need a new execution to test.

### 1. Timeout 124 is preserved when the child later exits 0 or -9 — correct (introduced)

Trigger: `TimeoutExpired` from `child.wait(timeout=max(0, 30 - …))`, then later reap.

Evidence:

- `candidate-exit-during-identity` receipt: `exitCode` 124, `timedOut` true, `actualReturnCode` 0, `actualProcessWaitCompleted` true, `logComplete` true, running removed. `executeError` is `probe failed; retain first failure and stop`. Instrumentation: one NOTE_EXIT without test reaping, `signals: []`.
- `candidate-disappears-before-group-query`: same 124 / actual 0 / reaped / log complete; `cleanupFailure` is `ProcessLookupError`.
- `candidate-live-matching-group`: 124 / actual -9 / one SIGKILL / log complete / running removed / group absent.

Parent cannot produce those receipts: identity exception aborts before `code = 124` and before `write_json`. Reproduced: `parent-exit-during-identity` has no `probe.json`, `runningReceiptRetained` true, `parentOmittedReceiptReproduced` true, `executeError` `process identity unavailable/changed`, controller later reaped 0.

### 2. Wait/reap during exit-versus-identity is real, not a substituted `execute()` — correct

Harness (`regression.py:145-150`) replaces module `Popen` capture, monotonic clock, `identity`, `getpgid`, and `killpg` only. Comment and code: real `Popen` and real `child.wait` are never replaced.

Exit path (`regression.py:94-109`, r2 form):

- `queue = select.kqueue()` then `try/finally queue.close()` (Python 3.9 correction; r1 `with select.kqueue()` died at `__enter__` before NOTE_EXIT).
- Register `KQ_FILTER_PROC` / `KQ_NOTE_EXIT`, write FIFO `gate`, `queue.control(None, 1, 3)`, assert NOTE_EXIT and `child.returncode is None`.

Controlled child (`controlled-child.py:7-16`) is a FIFO waiter; it does not import product code. Gate release is a real kernel exit. Helper then `wait(timeout=2)` reaps.

Observed: `exitEventsWithoutReaping == 1` on parent, exit-during-identity, and disappears; helper `actualReturnCode` 0 on the two candidate races; `ownedChildActuallyReaped` via `os.waitpid` `ChildProcessError`.

Clock substitution: timeout cases use first monotonic as baseline and later calls as +31s so `wait(timeout=0)` enters the same `TimeoutExpired` handler as original017’s ~29.89s timeout (`r1-failure/…outer.log` “timed out after 0 seconds”). That substitutes the deadline, not the handler. `candidate-before-deadline` uses the real clock (`syntheticDeadline: false`, `elapsedSeconds` 0.2396s, not 31.0).

Identity/getpgid proxies inject the observation the parent already uses (`kill_owned_group` lines 83–87). For exit-during-identity the second identity returns `''` after a real NOTE_EXIT, which is the production empty-`ps` path (`require(current and current == …)`). For disappears, `getpgid` raises `ProcessLookupError` after a real NOTE_EXIT; the helper records that exception and still waits. These are observation-point injections around a real child lifetime, not a fake `execute()`.

### 3. Changed identity: no signal; immutable 124 / actual null — correct (introduced)

`kill_owned_group` still refuses mismatch before `killpg` (unchanged `:83-87`). Candidate catches that as `cleanupFailure`, does not signal, then bounded wait.

`candidate-changed-identity` receipt (frozen `probe.json`): `exitCode` 124, `actualReturnCode` null, `actualProcessWaitCompleted` false, `logComplete` false, `cleanupUnknown` true, `cleanupFailure.message` `process identity unavailable/changed`, `signals: []`. `probe.running.json` retained. After the controller wrote the gate and reaped 0, `controllerLaterExitCode` 0, `result.json` `actualReturnCode` 0, on-disk `probe.log` now hashes `69c1e1c1…` (ready + exit 0), while the receipt still carries `logSha256` `5b9d5a54…` (ready only; same digest as the SIGKILL log). Receipt bytes were not rewritten.

### 4. Owned-group cleanup — correct within this delta

Matching live identity/group: exactly one SIGKILL, actual -9, group absent (`candidate-live-matching-group`). Refused or disappeared identity: `signals: []`. Parent also never signals on identity failure; candidate additionally records and continues to a bounded wait.

`poll()` before kill (`:200-201`) is new. If the Popen child is already a zombie, `poll()` reaps and skip `kill_owned_group`. A dead leader already made parent `getpgid(pid)` fail, so skip-kill on a gone leader is not a new ability to signal leftovers. Extra live group members after leader self-exit were not in these single-child controls (untested; see limitations). `kill_owned_group` itself is unchanged.

### 5. cleanupUnknown / actual null / running / logComplete — truthful on observed paths

| Case | cleanupUnknown | actual | wait completed | logComplete | running |
| --- | --- | --- | --- | --- | --- |
| parent (baseline) | n/a (no receipt) | n/a | helper did not wait | n/a | retained |
| exit-during-identity | absent | 0 | true | true | removed |
| live-matching-group | absent | -9 | true | true | removed |
| changed-identity | true | null | false | false | retained |
| disappears | absent | 0 | true | true | removed |
| before-deadline | absent | 0 | true | true | removed |

`logComplete` is aliased to `actualProcessWaitCompleted` (`:211-212`), not an independent byte audit. On observed receipts it is still accurate: reap of SIGKILL has a complete capture that lacks an exit line (`5b9d5a54…`); unknown wait hashes only the snapshot at receipt time (`5b9d5a54…`) while the file later grew (`69c1e1c1…`) with `logComplete` false. Do not treat later log growth as a rewritten semantic result.

### 6. Non-timeout behavior and first failure — preserved

`candidate-before-deadline`: real clock, gate released on first identity, `exitCode == actualReturnCode == 0`, no `timedOut`, `executeError` null, `identityCalls` 1, `signals: []`, running removed, log complete. Success path `wait` is unchanged.

Timeout and parent-identity failures still `require` and stop (`automaticRetry` false). Helper `main()` still runs `fresh-ci` only after `default-install` returns 0; these controls never call `main()` and never run npm. Original017 `checks: []` and omitted receipt remain failed/incomplete.

### 7. Python 3.9 kqueue close — correct (harness-only)

`regression-vs-r1.diff` is solely explicit `select.kqueue()` plus `try/finally queue.close()`. Registration, FIFO write, NOTE_EXIT wait, and the following asserts keep order. r1 evidence: failure at `with select.kqueue()` before NOTE_EXIT; five cases unrun. r2 parent case passed with `exitEventsWithoutReaping == 1`. Helpers are byte-identical to r1 (`unchanged-inputs.json`).

## Introduced versus inherited

Introduced (this `execute()` delta): commit 124 before cleanup; catch cleanup exceptions; 2s Popen wait; `timedOut` / `cleanupFailure` / `cleanupUnknown` / `actualProcessWaitCompleted` / `logComplete`; unlink `running` only after reap; terminal receipt exists on timeout+identity failure.

Inherited (unchanged, not demanded here): `kill_owned_group` ps+pgid gate; no signal on mismatch; first-failure stop; no retry; Darwin `identity()`; original017 actual npm exit unknown; CI unrun on that failure; later absence is not success; parent helper still omits the receipt.

Not in this delta: product/source change, npm argv, 30/90 release deadlines, process-framework redesign.

## Limitations (untested without a new execution; not CHANGES_REQUIRED)

- Controls do not measure npm install latency or original017 child 74883. Original log later contains `added 4 packages in 30s`; that is not an actualReturnCode. Supervisor observations already record `npmInstallExitCode: null` and that absence does not establish exit 0.
- Deadline in five cases is synthetic (`wait(timeout=0)`). Only `candidate-before-deadline` uses a real clock, and that child is a FIFO script, not npm.
- Changed-identity is a deterministic fake identity string on a still-live own child, not live PID reuse.
- `getpgid` in the disappears case raises a harness `ProcessLookupError` after real NOTE_EXIT rather than calling Darwin `getpgid`. Wait/reap of that dead child is still real.
- 2s wait leaving `cleanupUnknown` / actual null / running retained is an explicit remaining unknown, not a hidden success. Whether SIGKILL of a matching npm group always reaps within 2s is untested here.
- `poll()` then skip kill when the leader is already reaped, with extra members still in the group, is untested (single controlled child per case).
- `logComplete` is not a separate verification that no inheriting descendant still holds the log fd.
- `except Exception` around kill does not catch `BaseException`; a non-`TimeoutExpired` error from `wait(timeout=2)` still skips the receipt. Untested.
- Empty case `.outer.log` files (SHA-256 `e3b0c442…`) mean the regression process wrote no stdout; they are not evidence about the helper child.
- Source repair is not independently cleared.

## Verdict

READY. The candidate helper preserves semantic timeout 124, writes a truthful receipt through identity/exit races, signals only a still-matching owned group, leaves mismatched identity unsignaled with immutable 124/actual-null/unknown/running, reaps when wait completes, and keeps success-path 0 plus first-failure stop. The six Root controls exercise real FIFO/kqueue/Popen/wait around that handler. They do not qualify npm or reverse original017.
