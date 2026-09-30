# SL round 1 — independent hang and polling guards

Round 0's rules and [report](../REPORT.md) remain the operating
scope; this round addresses the two P2 review findings. Merge commit
`5e1f86136753ae4ea822b7bbd6001203da106135` first integrated `origin/main`
(`e05cec8e0a7e4d9eb4bf1a9527e9258541370193`) with round 0
(`5593f264df116fa8223539513c11eb37c7bd702f`). Both journal histories, both
console-framing regression tests and both LLP revision histories were retained.
No production behavior changes in this round. Nothing pushed or published.

## Changes and negative controls

| Changed test | Gap and correction | Control |
|---|---|---|
| `witness.rs` driver fixture, including concurrent namespace ownership | Unbounded process output could hang when the driver's timeout broke. A fixture-owned process group has an independent monotonic deadline: 150 seconds for preparation (120-second step + 30 seconds slack), 600 seconds for multi-step scenarios. Output goes to files. After normal exit, ownership remains with the fixture until its original assertions complete; cleanup cannot conceal a leaked backend. On timeout/unwind, cleanup gives the driver 15 seconds to interrupt and reap its children, then kills the owned group and waits for the driver. `waitid(WNOWAIT)` holds the leader's PID through group cleanup. Deadline expiry panics after cleanup. | Compile the actual production `Owned`, `simctl` and interrupt/tick source with the actual fixture watchdog; the correct 120-second driver passes. Remove only the simctl deadline check: the fixture must fail with `WITNESS_FIXTURE_WATCHDOG`. Both recorded driver and fake-simctl PIDs must be absent afterward. |
| Both typing ages, 0 and 3,000 ms | Query evaluations missed callbacks that only checked the deadline. A Vite fixture transform wraps the real expiry timer callback without changing its delay, return handle or cancellation. No expiry callback may wake before the deadline; each tier must have an observed callback at the deadline. All previous React, HTTP, device, offline, query-count and rendering assertions remain. | A scratch fixture transforms the production timeout delay to exactly 100 ms, leaving its deadline check intact. Both ages must fail specifically on early expiry wakeups, with no cancellation or skip. |
| Session/online model comments, suite comment, round 0 report and changed-test table | Correct the description to aggregate budgets: **10,000 s per session tier**, **6,000 s for online interleavings**, **1,800 s per mixed-evidence host**, at unchanged default counts. An individual stuck history can consume the aggregate budget. | No code, seed, coverage assertion or timeout value changed. |

The retained [control runner](negative-controls.py) uses scratch copies and never
edits production source. Run from `snapback4/`:

```sh
taskset -c 80-95 target/sl-load/confine python3 reports/20260929-sl-suite-under-load/round1/negative-controls.py witness
taskset -c 80-95 target/sl-load/confine python3 reports/20260929-sl-suite-under-load/round1/negative-controls.py typing
```

The [round 0 method](../METHOD.md) gives the build command for `confine`.
The portable witness control is helper/process evidence on Linux, **not a
Darwin CLI or native simulator pass**. The full Darwin-only fixture remains
platform-gated. Round 0's restriction on running work on the source Macs remains.

## Verification and failures

All focused checks and controls use CPUs 80–95 with round 0's inherited
`confine` guard; the one full-suite run is the requested unconfined exception.
No load, startup delay, count reduction, seed override or new skip is used.

| Check | Result |
|---|---|
| [Final portable witness target](witness-final.log) | 10 passed; zero failures/ignores. Darwin driver cases are not executed on Linux. |
| [Typing after rebuilt wasm](typing-rebuilt.log) | Both ages pass; zero failures, cancellations or skips. |
| [Retained 100 ms polling control](typing-polling-negative.log) | Both ages fail the new early-wakeup assertion, as required; zero cancellations/skips. [Record](negative-typing.json). |
| [Merged console guards](console-merge-corrected.log) | All five console tests pass, including both independently added interleaving tests. The initial bin-only filter selected zero tests; the corrected filter ran five. |
| [Whole guide](guide.log) | 105 passed; zero failed or ignored. |
| [Normal-exit cleanup control](cleanup-control.log) | Deliberately leaked backend remains connectable after `finish`; fixture destruction stops the group. Linux subreaper in the control reaps the deliberate orphan. [Retained source](cleanup-control.rs). |
| [Final reference audit](ref-check-final.log) | 525 LLPs, 9,990 references; zero errors or unchecked references after report/journal. |

**Recorded setup failures (environmental, resolved):**

- Initial [typing run](typing.log): both age-zero and age-3,000 tests failed
  before reaching expiry with `wasm: the module does not export the Snapback
  device runtime`. The ignored round 0 wasm artifact was stale against the
  merged source. Neither failure exercised the new assertion.
- Initial [wasm build](build-wasm.log): `missing locked Binaryen`. Main's new
  locked optimizer was absent from the installed dependencies. Frozen
  [dependency installation](install.log) and the normal
  [wasm rebuild](build-wasm-after-install.log) resolved both setup issues.
  Rebuilt output is **1,978,828 B raw / 593,225 B gzip**, **494 B below** the
  unchanged 593,719 B cap. This round changes no production source.

**Our cleanup-order correction:** self-review found that the first watchdog
cleaned up even after normal driver exit, before the test's port assertions.
That could mask a leaked backend. Final code holds the unreaped driver and
owned group in the fixture until assertions finish, with timeout cleanup still
immediate. The dedicated cleanup control above verifies this boundary.
The edit happened during the single full run and is retained in
[the correction record](cleanup-order-correction.json), with before/after
source hashes. Therefore the round 0 runner's unchanged-source audit must
return 125; its suite footer and every actual test failure are reported
separately below. No second full run is made. Initial successful witness
controls remain under `initial-witness-*`; final-helper controls are rerun
and retain their own hashes and process-reaping checks.

Final helper control: the correct production deadline returns after
**120.13 s**; removing its deadline check fails with
`WITNESS_FIXTURE_WATCHDOG` after **150.14 s**, exit 101. Both the driver and
fake simctl are reaped in each run, checked by `kill(pid, 0)` returning ESRCH.
[Final control record](negative-witness.json), [correct log](witness-correct.log),
[mutation log](witness-no-deadline.log). The control hashes match the final helper.

**Single unconfined suite:** `== 0 failure(s) in 1334 s`.
[Complete log](final-unconfined.log), [extracted summary](final-unconfined.summary.json),
[runner metadata](final-unconfined.json). All 13 script stages pass:
4,364 Rust tests (33 existing ignores), 5,308 client checks (ten existing skips),
79 model checks and nine fixture-wrapper checks. Zero failed/cancelled tests
and zero asynchronous errors. Both 5,000-history session tiers, 3,000 online
interleavings and mixed-evidence histories retain their default counts.
The actual script exit is 0; the evidence wrapper returns **125 (ours)** for
`source_changed_during_run`, as described above. This is an actual passing
execution, **not an unchanged-source qualification**. The final portable witness
target was rerun after the correction: 10/10 passed. The full driver fixture
bodies also [compile](driver-compile.log) with only their module cfg expanded to
Unix in a scratch copy on Linux; no Darwin execution is claimed.

| Failure class | Every occurrence and disposition |
|---|---|
| Full-run test failures — ours | 0 |
| Full-run test failures — baseline | 0 |
| Full-run test failures — environmental | 0 |
| Evidence-wrapper audit — ours | One exit 125: watchdog cleanup-order correction during the run; retained metadata and source hashes, no repeat full suite. Final affected target and both witness controls pass after correction. |
| Earlier setup — environmental | Two typing cases could not load stale wasm; one wasm build refused missing locked Binaryen. Frozen install and rebuild resolve them; both ages pass focused and in the full suite. |
| Deliberate negative controls — ours, expected failures | Typing ages 0 and 3,000 fail on 100 ms wakeups. Removing the driver's deadline fails at the independent watchdog in both initial and final-helper runs, with both PIDs reaped. These are successful detecting controls, not product failures. |

The final source manifest is [tested-source-final.json](tested-source-final.json).
Its hashes still match after the full run and final focused checks. No counts,
assertions or inherited skips were relaxed. The inherited nominal 60-second
complete-suite budget remains exceeded; no ceiling was raised.

## Governing context (llp-orient)

Scope: witness test supervision and typing-expiry observation, with model-guard
wording. [LLP 3000 §7](../../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention)
requires preserved assertions/counts, independent clocks and hang guards;
[LLP 3000.019 §3.3](../../../../llp/3000.019-what-the-builder-still-wrote.rfc.md#3.3)
binds expiry to held answers;
[LLP 3000.030 §5](../../../../llp/3000.030-native-proof-in-minutes.rfc.md#5)
binds witness ownership and cleanup. The latter two are in `llp/current/`;
none is in `llp/foundation/`. Read the paved reads and witness guide cards.
The rationale is to test deadlines independently of host scheduling and to
stop only fixture-owned processes. Main's preparation helper already uses
`waitid(WNOWAIT)` to preserve process-group identity; the test watchdog follows
that ownership rule independently. The remaining platform risk is unexecuted
Darwin choreography. Update the existing LLP 3000 contention section and
correct the old report; no new design decision or hand-off is needed.
