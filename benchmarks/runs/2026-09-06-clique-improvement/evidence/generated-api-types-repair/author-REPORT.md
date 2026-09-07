**Committed the narrow generated-API import repair; the affected checks pass.** Source is frozen and the writer is released. No push, rebase, merge, landing or publication occurred.

- Worktree/branch: `/Users/ccheever/projects/snapback-worktrees/clique-generated-api-types`, `s2/clique-generated-api-types`.
- Base: `fbaee64a17f024c991194d0f0f55bb232f3c13cc`.
- Commit: `8f7c6c208926923e89eaf1111f914fa7fb8ca2da`.
- Tree: `5a8f845adef90e9684765a1aa5d2201c3b62507f`.
- Clean worktree; all 190 archived source leaves match the committed worktree. [Candidate identity](work/candidate.json), [complete diff](work/candidate.diff).

Three files changed, with 86 insertions and 5 deletions:

- `snapback2/packages/compiler/src/project-api-types.ts`: adds `Column` and `RowOfColumns` to the existing emitted root type import. Inference and result shaping are unchanged.
- `snapback2/packages/compiler/src/api-shape-checks.ts`: adds two normally registered regression checks. Each calls actual `lowerProject` on Quarry, writes the resulting declaration unchanged, links the complete SDK, and consumes it with the real Expo template configuration. It checks the actual number-assignment directive, the exact inferred `boolean` field, absence of `TypeFlags.Any` on the row, and an actual `false` type for `IsAny`. A successful assignment of `false` alone is insufficient. The optional test observer retains the same Program's evidence without substituting declarations.
- `llp/1002-dev-loop.spec.md`: explains the required root bindings and consumer regression contract in the existing compiler section. No new gate or design document was added.

| Executed affected work | Actual result | Child elapsed / bound | Evidence |
|---|---|---:|---|
| Pre-fix merge regression, original generator plus new test | Expected failure: TS2578; error-any row/field; `IsAny` also error-any | 0.817s / 30s | [Test result](work/remote-evidence/results/pre-fix-merge-01/test-result.json) |
| Fixed insert and merge regressions | 2/2 pass; both consumers have zero diagnostics | 1.068s / 30s | [Test results](work/remote-evidence/results/fixed-consumers-01/test-result.json) |
| Scoped production/test typecheck | Zero diagnostics; roots are `project-api-types.ts` and `api-shape-checks.ts`, 250 resolved files | 2.421s / 30s | [Roots/options](work/remote-evidence/results/affected-types-01/before-program.json), [diagnostics](work/remote-evidence/results/affected-types-01/diagnostics.json) |
| Changed-file references, metadata and source caps | Pass; generator 739 lines, test file 430; four references resolve | 0.171s / 45s transport | [Result](work/fast-checks-result.json) |

`git diff --check` also passed. The reference check reused the repository's parser and anchor resolver on the changed files; this is not a full-corpus or full-gate claim. All three portable semantic commands ran once. No successful unchanged check was repeated. The expected pre-fix failure is retained in full; there were no unexpected semantic/helper failures or timeouts. Read-only discovery corrections are recorded separately. [Finite commands and input hashes](work/workload-ready.json), [failure/correction notes](work/preparation-notes.json).

The merge declarations before/after differ **only** by the two root imports. Before the fix, a number assignment accepts the error-any field and leaves its directive unused. Afterward, both insert and merge infer `row.done` as exactly `boolean`, reject number assignment, infer a non-any row, and reduce `IsAny` to `false`. Each consumer has two roots and 97 resolved files. [Complete inputs, types, diagnostics and comparison](work/summary.json). The accepted [original insert investigation](../generated-api-type-consumer-r1/astra/REPORT.md) supplies its pre-fix evidence and was not replayed or modified.

Verification ran in `/home/ccheever/clique-revisions/generated-api-types-repair-r1-20260907/work` through `ccheever@100.65.137.99`, with `BatchMode=yes`, `ConnectTimeout=10`, pinned Bun 1.3.12, Node 22.23.2 and TypeScript 5.9.2. The closed investigation supplied read-only SDK/dependency donors. All 153 SDK leaves and 24,010 dependency leaves were verified, privately copied, and checked afterward, including confined link targets. Actual package exports and Expo configuration resolution were preserved. The original local SDK also still matches every binding. Historical dependency mode equality is not claimed. [Custody and full evidence index](work/EVIDENCE.md).

All six remote workload children have actual PID/start/tool/command/cwd/deadline records, live full-inbox readiness acknowledgment before launch, waited terminals, and post-wait absence. The 30-second process-group kill/wait mechanism and 45-second transport bound were retained. All ten SSH/SCP transports closed; one additional local transport recorded the fast check. The baseline's exit 1 is expected and retained. No remote state became unknown. [Closure receipts](work/closure.json).

The eleven inherited SDK TS1038 diagnostics remain outside this candidate, as established in the unchanged original investigation. They were not repaired or reproduced again; Root's existing follow-up ticket owns them. This candidate does not establish that all SDK declarations are clean. No package build, install, native/Rust execution, server, browser, benchmark access, M5 contact, registry operation or additional agent was used. Review and landing belong to Root. This author's native/outer exit must be observed by the supervisor after return; it is not claimed prospectively.
