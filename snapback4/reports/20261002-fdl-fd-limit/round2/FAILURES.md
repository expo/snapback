# FDL round 2 failure ledger — 2026-10-02

| Invocation | Result | Classification |
| --- | --- | --- |
| Affected tests, final source, shell soft 1,024 | Exit 0; 373 passed, zero failed, four existing ignores | No ours, baseline or environmental test failures |
| Guide, final source, shell soft 1,024 | Exit 0; 110 passed, zero failed | No ours, baseline or environmental test failures |
| Full suite, `a hide during the startup probe waits for its observed-replacement decision` | `ERR_SQLITE_ERROR`, errcode 5, `database is locked`, at `replacementFor`, `web-admission-review.test.mjs:321` | **Baseline fixture race.** The entire file is unchanged from `00a96f16b7`; the exact baseline helper reproduces this refusal under a controlled SQLite writer lock. |
| Full suite, parent `web admission review: recovery and transport respect the session boundary` | Failed because its child above failed | **Baseline**, same cause; this is the second failed test, not another underlying defect. |
| Full-suite stall after the browser review failed | The replacement server survived failed setup, keeping its Node test process alive | **Baseline fixture cleanup defect.** The exact baseline helper never calls `replacement.close()` when its copy fails. The recorded test-owned leftover server alone received SIGTERM after read-only diagnosis; the runner then emitted its existing failure and continued. |
| Controlled baseline helper counterexample | Exit 0; asserts `SQLITE_BUSY` and absent replacement cleanup while another connection holds `BEGIN IMMEDIATE` | Expected negative evidence, not another failed suite run or a retry. |
| Initial optional orientation-file read | `cat skills/llp-orient/SKILL.md`: file unavailable | Environmental lookup failure: the checkout's skill symlink points into the uninitialized vendor submodule, as already recorded in round 0. Read the governing Snapback 4 rules, LLP and guide directly for this small correction. No test or product failure. |
| First post-suite artifact hash check | `sha256sum` could not find its input file when invoked from the repository root with a Snapback 4 relative path | **Ours, command-directory mistake.** Reissued from `snapback4/`; both CLI and wasm hashes match (exit 0, `artifact-recheck.log`). No source change or test rerun. |

No failed suite test was retried or omitted. Existing ignored tests remain
explicitly ignored. No round-2 product/test failure is attributed to this change.
The baseline fixture defects are ticketed in
[`issues/closed/20261002-snapback4-browser-replacement-fixture-lock-cleanup.md`](../../../../issues/closed/20261002-snapback4-browser-replacement-fixture-lock-cleanup.md).
The single full suite exits **1**, with exactly **`== 1 failure(s) in 1803 s`**
and failed category **`client tests`**. Clients: **5,766 passed, two failed,
ten skipped**. All Rust targets/doctests and **79 final models** pass. There
are no environmental test failures; the environmental row above is a file
lookup only. Wall time includes the recorded orphan-fixture diagnosis/cleanup.
