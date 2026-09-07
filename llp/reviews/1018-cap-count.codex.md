# LLP 1018 move two — count-backed cap probes lane review (codex `gpt-5.6-sol`, xhigh, read-only, blind)

**Change:** `s2/clique-cap-count` — the engine's cap probe reads a same-`by` maintained count, the certificate reserves one row per write, the `E_BOUND` rewrite pastes the declaration, twin parity, corpus cases, LLP 1017/1001 amendments. Round 1 reviewed the lane's first commit (13e30e288 pre-rebase); round 2 the fix (cb1ce9d5c pre-rebase). Landed SHAs are recorded in LLP 1018 §10.
**Implementer:** codex `gpt-5.6-sol` at xhigh (lane); the fix round by the orchestrator.
**Orchestrator:** Claude Fable 5.1, session `session_01N6HHCXSkeacu8sJfsUH38L`.
**Provenance:** every review below was actually received from the named model; verbatim text per round; the two reviewers never saw each other's reviews.

| Round | Reviewed | Verdict |
|---|---|---|
| 1 | the slice | VERDICT: NOT READY (1 MATERIAL) |
| 2 | the fix round (targeted) | VERDICT: READY (its two minors — the pasted name is not collision-checked, and the twin's proven-absence branch has no targeted test — are recorded as accepted) |

## Round 1 (verbatim)

- MATERIAL — [runner.ts:869](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/packages/evaluator/src/runner.ts:869): the TypeScript twin never checks `authorityAbsence()` for a missing maintained-count row. Even when `byId` absence authoritatively proves zero, it falls back to the source index and becomes partial without complete range coverage. Rust correctly accepts the proven absence at [runner_ops.rs:485](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:485). The 49-principal corpus case masks this divergence by inventing 49 explicit zero rows at [cap_cases.rs:521](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/bin/export_corpus/cap_cases.rs:521). Handle `countRow !== null || authorityAbsence(...)` as the point-read fast path, using zero only in the latter case.

- MINOR — [diagnostic.rs:110](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/certificate/diagnostic.rs:110): the suggested Quarry fragment ends after `maintain …:`. Quarry requires an indented `read <- rule`, so it is not independently pasteable, and the synthesized `<table>Count` name is not checked for collisions.

- MINOR — [cap_tests.rs:203](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/engine/cap_tests.rs:203): despite its name, this test fills to the cap in one transaction and refuses only in a later transaction. It does not exercise a later write failing after earlier same-transaction writes or verify their rollback. Count-backed group moves, deletes, and product seeding likewise lack direct regression coverage.

- REFUTED-RISK — [runner_ops.rs:15](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:15): server-side ordering is sound. Each constraint probe precedes its source write, maintenance follows every successful write, updates decrement then increment, deletes decrement without probing, and failed/partial executions roll back the enclosing transaction.

- REFUTED-RISK — [successor/caps.rs:13](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/successor/caps.rs:13): successor admission counts base rows directly before maintained-target rebuilds. Adding or retiring a maintain cannot make admission trust stale projection rows.

- REFUTED-RISK — [certificate.rs:520](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/certificate.rs:520): certificate custody retains the enforcement index and adds the maintained target’s `byId`. Schema identity already covers ordered cap constraints and maintains through [certificate-identity.ts:26](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/packages/evaluator/src/certificate-identity.ts:26).

- REFUTED-RISK — No new gate, registry, or config was introduced. No changed source or new corpus file exceeds 1,500 lines; the largest changed source file is 1,478 lines.

VERDICT: NOT READY (1 MATERIAL)

## Round 2 (verbatim, targeted confirmation)

No MATERIAL findings.

- MINOR — The “unchecked name” half remains: [`diagnostic.rs:114`](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/certificate/diagnostic.rs:114) mechanically chooses `<table>Counts`, but an existing table with that name makes the compiler reject the pasted repair at [`index.ts:160`](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/packages/compiler/src/quarry/index.ts:160). The added `read <- deny` does make the fragment syntactically self-contained.

- MINOR — The new proven-absence branch at [`runner.ts:874`](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/packages/evaluator/src/runner.ts:874) lacks a targeted regression test. The count-backed corpus instead seeds explicit zero-valued rows at [`cap_cases.rs:520`](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/bin/export_corpus/cap_cases.rs:520), so 218/218 does not exercise this branch.

- REFUTED-RISK — Semantics match Rust `ReceiptOnly`: both require an exact `byId` authority absence before treating a missing count row as zero; mismatched-schema absences are cleared. [`runner.ts:874`](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/packages/evaluator/src/runner.ts:874), [`runner_ops.rs:492`](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:492), [`store.ts:437`](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/packages/evaluator/src/store.ts:437)

- REFUTED-RISK — `read <- deny` does not obstruct enforcement: the cap probe uses direct engine storage lookup, and maintained writes explicitly bypass authored write rules. [`runner_ops.rs:484`](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:484), [`runner_ops.rs:1050`](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:1050), [`runner_ops.rs:293`](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/engine/runner_ops.rs:293)

- REFUTED-RISK — The atomicity finding is closed: all four inserts occur in one program, the fourth refuses, and the subsequent `byId` point read confirms rollback. [`cap_tests.rs:429`](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/engine/cap_tests.rs:429), [`cap_tests.rs:473`](/Users/ccheever/projects/snapback-worktrees/clique-cap-count/snapback2/crates/snapback2-core/src/engine/cap_tests.rs:473)

Read-only review; no builds run.

VERDICT: READY
