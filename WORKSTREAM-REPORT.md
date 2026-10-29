# Integration 33 — Snapback 4 0.4.49

Qualified release on main: `55a4d4e39c75a6aa5f661222b4161d0c2a623f79`.
Worktree `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`.
Records: `/home/ccheever/sb4-loop/integration33/`.
Complete Linux qualification: PASS. Normal main push: PASS. Exact commit to publish: `55a4d4e39c75a6aa5f661222b4161d0c2a623f79`.

## Changes

| Item | Commit | Result |
|---|---|---|
| Main integration | `53eeed0208` | No-ff merge of pre-merge main `47ff676a47fc9a83dcf10814e7c19f52389bafcb`, including publication fixtures and version-pin ticket. |
| MUSE1 | `da4a1a66bc` | No-ff merge of `5146b896cd`. Ordinary check creates neither proof helper. Exhaustive matrix and compact <=8KB draft are explicit opt-ins; existing matrix facts refresh without code expansion. Verify remains unchanged. Received Muse/Codex source reviews and measured negative outcomes are preserved. |
| Early 0.4.49 bump | `2a58bf4b1c` | Four npm manifests/platform dependency pins, Rust workspace and both Cargo locks, both explicit fixture tripwires, and a 0.4.49 guide-changes entry. |
| R1 review/seal | `25180bc742` | Source-reviewed nonrejecting observation setup; regenerated awaitBoundary(), preserving both assertions and all 215 delivery fault-site IDs/recipes. |
| Wasm/review record | `85f6e3b97d` | Append-only journal and exactly measured+500 artifact allowance. |
| Lifetime fixture | `f64de25232` | Arm serveUntilSignal before announcing readiness. Keep strict zero exit, EOF, group signals and store release/restart assertions. |
| Generated production lifetime | `55a4d4e39c` | Same ordering repair in the shipped production script; real generated-script regression forces a scheduling gap at readiness. Guide changes explain the equivalent edit for existing scripts. |

Existing apps keep their source, assertions and scripts. The formerly automatic
exhaustive proof scaffold is now opt-in. Both helper choices remain available;
`npm run verify` retains its ordered, bounded first-red behavior. No engine,
authority, delivery format or runtime ceiling changed in this integration.

### R1 source review

`proofResponse` returns immediately when observation is disabled. All enabled
setup operations, including URL/header/custom-response accesses and installing
the wrapper, are inside try/catch. It cannot add a rejection at its three new
transport awaits. The deferred response.json wrapper preserves the original
decode's rejection at the caller's existing await; observation errors are caught.
It adds no eager body read, I/O or write custody. Proof-account diagnostics and
proof/browser/host waits are Node harness orchestration outside SDK delivery.
New zero-await helpers add no fault sites. Generated the seal via awaitBoundary()
and retained all 215 classifications/recipes without exceptions. Final full
matrix: **445/445 passed, no skips**, in `r1-final-matrix-summary.txt`.

### Version tripwires

`snapback4/scripts/bump-version.mjs` validates every input before writing the nine
release files: four manifests/platform pins, workspace version, both release
locks, device-version and sync-generation pins. Used for 0.4.49. A disposable-copy
control advanced all pins, then proved a stale final tripwire causes no writes.
`issues/20261028-snapback4-version-bumps-miss-release-fixture-pins.md` is resolved
under `issues/closed/`. Both tripwire files pass in the final full client pool.

### Additional red found and repaired

The first complete publication source suite passed Rust and models but failed
one srv1-lifetime SIGTERM assertion: fixture readiness appeared before handlers
were installed, permitting signal termination (`exitCode:null`) instead of zero.
A controlled gap reproduces old ordering as -15; armed ordering exits zero in
three trials (`srv1-readiness-control.json`). The generated production script
had the same ordering, so it was repaired too. The existing starter test now
pauses inside its actual readiness console.log, signals immediately and demands
zero exit plus release/restart. An old-ordering copy fails that new assertion
(`srv1-negative.log`). Rebuilt actual positive file: **22/22**, no skips;
`srv1-positive.log`. All corresponding final full-pool cases pass. No timeout or
exit/ownership assertion was weakened.

## Verification

### Affected selection and root checks

The requested broad run against pre-merge main executed all **31** commands.
Raw receipt: `target/affected/85f6e3b97de4-1793244662417.json`; its literal FAIL
is preserved. After the discovered red was repaired during the run, its source
stability guard correctly refused a qualification. The client batch saw the old
compiled CLI against repaired source (srv1 and exact upgrade-history comparison).
Root generated/guide checks also found missing root node_modules. Restored the
frozen root install and hoist without changing source or locks; recorded retries.
The separate Lean oracle exit1 is unchanged inherited evidence, detailed below.

Final affected repair ran on frozen **55a4d4e39c**, base **85f6e3b97d**:
**15/15 PASS**, complete and unchanged=true. It reruns the CLI crate, full language
guide target, fixtures, all client files and models, diagnostics, docs budget,
root guide/inventories, packaged docs and references. All affected unchanged
engine-crate passes are retained from the broad run; the final full publication
suite independently reruns the entire source battery.

Receipt: `/home/ccheever/projects/snapback-sb4loop/target/affected/55a4d4e39c75-1793253615017.json`.
Summary: `affected-final-summary.json`. Root generated-artifact retry also passes
(`root-generated-final.log`, wrapper exit0). Root guide **22/22**, no skips or
preconditions; inventories PASS; reference check **579 LLPs / 12,884 refs / zero
errors or unchecked refs**; docs budget PASS. Earlier wrong-directory docs-budget
invocation and missing-cache attempts remain in logs, not relabelled as passes.

### Differential evidence

Ordinary short campaign: **2,000 cases / 120,026 executions / 9 oracles / zero
disagreements**, exit0. Lean short campaign retains literal exit1: **18** existing
next/continuation and E_RULE-vs-NOT_FOUND observations. All **16** saved finding
files and every oracle counter exactly match the Integration31/30 baseline.
No oracle/model/assertion was changed or weakened. `difftest-summary.json`.
Core/device/difftest/simulator/native/Lean Git trees exactly match pre-merge main
(`engine-tree-comparison.json`); only workspace version metadata differs there.
These known model observations are separate from the complete Linux publication
suite, which compiles the oracle and runs the full client models.

### Packed consumers and complete Linux red check

The initial full consumer-only chain passed at **85f6e3b97d**, including all host
starters, positive/negative proof kit/frontend controls, upgrades, production,
migrations, staging, recipes and clean Ubuntu24.04/Alpine consumers.
`consumer/qualification/consumer.json` truthfully says suite:not-run and
publicationQualified:false. It is earlier-candidate evidence, not final Linux
suite qualification.

First complete red attempt: `redcheck/qualification/suite.log` records exactly
**1 failure in 3440 seconds**, the lifetime race above. Consumer checkpoints are
retained in that attempt's proofs.json, with **no qualification receipt**.
Source moved for repair; never use that run as a release qualification.

Fresh complete final run on **55a4d4e39c**:
- Rust **8,547 tests**, 1,206 invocations plus doctests: PASS in 1,225 seconds.
- Full client pool **453/453 files**, **8,042 pass / 57 existing platform skips /
  zero failures** of 8,099 tests: PASS in 1,707 seconds.
- Both full-count app-session and online-client models: PASS in 326 seconds.
- Complete source suite: **0 failures in 3,379 seconds**.
- All final packed consumers, six host starters and clean Ubuntu24.04/Alpine proofs: PASS.
- Complete Linux qualification: PASS, exit0; receipt source exactly matches the qualified main release.

Receipt: `/home/ccheever/sb4-loop/integration33/redcheck-final/qualification/receipt.json`.
Receipt SHA256: `124c0f41e0e3482f6b902086ec70ce2c96262bee93839d2015a860334ca72e76`.
Native SHA256: `83b36258fe31128f661b714810fd12e5a5a2d858c774e7dfd2e2256053b2724b`.
Prepared client/Expo and qualified Linux tarball SRIs independently rechecked against the receipt.

Final records: `/home/ccheever/sb4-loop/integration33/redcheck-final/`.
Source/client/Rust summaries are retained there. The full qualifier produced
`qualification/receipt.json` and exit0 before landing; it is the authority
for source, artifact integrities, ELF/flags and complete consumer results.

The supplied kit's `redcheck-at.sh` actually takes a records directory and
hardcodes a forbidden publication worktree. It was read and copied, never run.
`redcheck-final-driver.sh` preserves its prepare + complete qualify-linux sequence
in this worktree with explicit external output paths, source/clean checks,
timeouts and memory limits. Original/driver provenance and failed runs remain.
No direct invocation of the full test.sh outside the commissioned qualifier.

### Wasm

Locked Linux artifact: **2,416,593 raw / 738,550 gzip / 556,076 Brotli bytes**.
Budget **739,050 = measurement + exactly 500**. Final packed raw wasm SHA256:
`8d58e71e98d26c9730b74fcb844f58d375e68f94d6095ac0d6da9b38aa05f407`.
It is byte-identical to the artifact whose strict family/server-only absence
audits passed. `wasm-final-binding.json` binds final packing and measurement.
Whole-artifact version/layout attribution only; no runtime ceiling increase or
independent feature-cost claim.

## Retention, landing and remaining work

All heavy jobs use user systemd scopes with MemoryMax60G/OOMPolicycontinue,
Cargo16, no incremental/debug payloads, at most two heavy jobs and command
timeouts. Removed 24 completed host workspaces from each of the three consumer runs,
retaining top-level checkpoints, logs and packs. After source tests finished,
removed 1,011 completed hashed Rust test executables (35.72GiB logical), retaining
the top-level CLI, shared libraries and dependency caches. Cleanup manifests are
retained. No protected publication targets/worktrees or wave stores were touched.

Landing: final receipt validated, then fetched origin. Main had not advanced beyond
47ff676a47, so no further merge or requalification was needed. Normal
`git push origin sb4-loop:main` succeeded, advancing main to **55a4d4e39c75a6aa5f661222b4161d0c2a623f79**.
Visibility governance allowed it; two selected frozen-record drift gates deferred
to the scheduled backstop under repository policy. The pre-push hook warned that
its Node24.18.0 pin was absent and used ambient24.13.1; the publication qualifier
itself used its pinned24.13.1 successfully. No force push.

Root WORKSTREAM-REPORT.md is lane-local. This final report is committed locally
after the qualified main push; its report-only child is intentionally not pushed.
The source to publish is the qualified main commit above, not that local metadata
child. Worktree clean after the report commit; all product commits are on main.

MUSE1's small-sample Muse input/call bars pass; Codex input/call bars miss. The
existing Codex fixture/security-note follow-up remains open. No general dollar,
wall-clock or overall bakeoff win is claimed. The inherited Lean model gaps stay
explicit. Mac/signing/native publication and npm release remain with the publish
agent; **0.4.49** is the version to publish from the final qualified source.
