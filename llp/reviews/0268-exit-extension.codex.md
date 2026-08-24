# LLP 0268 exit extension — codex review record

**Change:** the broadcast prover (landed on main as `a11054ca4`, 2026-08-24, ported onto the G2-A evaluator)
**Reviewer:** codex gpt-5.6-sol, xhigh, read-only, blind on full rounds
**Orchestrator:** Claude Fable 5 (session snapback-44), under `issues/20260824-llp0268-exit-extension-commission.md`
**Provenance:** every review below was actually received from the named model; verbatim text per round.

## Verdict ledger

| Round | Reviewed | Verdict |
| --- | --- | --- |
| r1 | prover source | VERDICT: NOT READY (4 MATERIAL) |
| r2 | fix round 1 delta | VERDICT: NOT READY (1 MATERIAL) |
| r3 | schema regen (targeted) | VERDICT: READY |
| r4 | port fidelity (targeted) | VERDICT: READY |

## r1 — prover source

I found four material blockers.

### MATERIAL

1. Exact-audience parity is circular, not independently proven.

   [graph_corpus_v1.rs:1664](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback/tests/graph_corpus_v1.rs:1664) computes one `allowed` value from fixture rows, then pushes the same `outcome` into both establishment and strict vectors at [line 1682](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback/tests/graph_corpus_v1.rs:1682). There is no second evaluator, deny-set computation, or assertion that both observations share one instance and authorization version. Nevertheless, the freezer marks `G0-BCAST-AUDIENCE` SATISFIED at [freeze-graph-g0-corpus.mjs:1762](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1762), and the draft calls the evaluations independent at [0268-EXTENSION-DRAFT.md:19](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/tests/conformance/graph/0268-EXTENSION-DRAFT.md:19).

   Fix: invoke distinct establishment and fresh strict-delivery evaluator paths at the same materialization identity and authorization version, then compare their complete allow/deny vectors. Keep `G0-BCAST-AUDIENCE` PARTIAL until that exists.

2. Audience identities omit the installed schema/policy declaration identity.

   Codegen hashes only the predicate at [graph-query.mjs:1103](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/packages/snapback-codegen/graph-query.mjs:1103); Rust recomputes the same predicate-only preimage at [graph.rs:4013](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/manifest/graph.rs:4013). Installed-owner admission performs shallow declaration/role/nominal-ID checks, even discarding `resource_field` at [engine.rs:34867](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-engine/src/local/engine.rs:34867), but it never binds the full installed membership/schema/policy identity into either hash. The draft explicitly acknowledges the missing digest at [0268-EXTENSION-DRAFT.md:48](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/tests/conformance/graph/0268-EXTENSION-DRAFT.md:48). That is an incomplete host recomputation under LLP 0209 §3.3.

   Fix: add an installed-owner declaration/schema/policy digest to the certificate preimage and have the host recompute it from installed facts. Codegen must remain query-shaped when that proof cannot be formed; an authored broadcast with a mismatch must refuse.

3. The new class-1 broadcast base has no paired-world falsification.

   The freezer produces only two `audienceParity` cases and one `scopeMismatch` case at [freeze-graph-g0-corpus.mjs:793](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:793); the Rust runner filters only those kinds at [graph_corpus_v1.rs:1616](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback/tests/graph_corpus_v1.rs:1616). Yet `G0-BCAST-CLASS` is marked SATISFIED with only `audienceParity` and `refusal` evidence at [freeze-graph-g0-corpus.mjs:1758](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1758). LLP 0209 requires the paired-world falsifier for the exact admitted base.

   Fix: add paired worlds for `publicRooms`, holding arguments/window/version fixed while varying every principal-, partition-, and policy-hidden slice; assert identical bytes, ordering, length, existence, and completeness. Until then `G0-BCAST-CLASS` cannot be SATISFIED.

4. The extension breaks the parallel G2 evaluator lane’s shared corpus contract.

   This HEAD rewrites the sidecar to two cases plus a new `caseDispositions` field at [broadcast-cases.g2-pending.v1.json:5](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/tests/conformance/graph/broadcast-cases.g2-pending.v1.json:5), enforced at [graph_corpus_v1.rs:1768](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback/tests/graph_corpus_v1.rs:1768). The active G2 worktree’s evaluator test expects the established six-key schema and four cases at [g2-lane graph_corpus_v1.rs:1964](/Users/ccheever/projects/snapback/.claude/worktrees/g2-lane/crates/snapback/tests/graph_corpus_v1.rs:1964), including all four kinds at [line 1987](/Users/ccheever/projects/snapback/.claude/worktrees/g2-lane/crates/snapback/tests/graph_corpus_v1.rs:1987). That lane has live changes in the same test, freezer, engine, graph manifest, and corpus files.

   Fix: preserve the four-row sidecar and existing top-level schema, adding prover disposition/evidence compatibly, or integrate/rebase the G2 evaluator and demonstrate the combined corpus contract before landing.

### MINOR

- The P-member/Q-instance witness is present in fixture data at [data.v1.json:7](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/tests/conformance/graph/broadcast-fixture/data.v1.json:7), but the test only checks distinct instance hashes and `scope-unbound` at [graph_corpus_v1.rs:1742](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback/tests/graph_corpus_v1.rs:1742). It never asserts that the selected principal belongs to P and not Q. Add explicit fixture assertions so the intended counterexample cannot silently decay.

### REFUTED-RISK

- Authored proof escape and weakened counterfeit rows: refuted apart from the installed-identity defect above. Codegen derives the certificate and returns query-shaped on an unprovable request at [graph-query.mjs:1184](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/packages/snapback-codegen/graph-query.mjs:1184); the host exact-compares recomputed fields at [graph.rs:4100](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/manifest/graph.rs:4100). Rows 23–27 remain executable and refuse in the expected order at [graph.rs:6324](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/manifest/graph.rs:6324).

- Separation: refuted. The delivered rooms table is public-read at [schema.mjs:7](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/tests/conformance/graph/broadcast-fixture/schema.mjs:7); membership appears only in the establishment predicate at [queries.mjs:44](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/tests/conformance/graph/broadcast-fixture/queries.mjs:44). The compiler fixes `effect:"admit-only"` and null overlay. No predicate channel reaches projection, ordering, length, existence, or completeness.

- Scope binding: refuted. Codegen requires every delivered data node to carry the same propagated argument equality at [graph-query.mjs:1142](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/packages/snapback-codegen/graph-query.mjs:1142); installed-owner admission verifies every field is a required nominal resource ID at [engine.rs:34914](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-engine/src/local/engine.rs:34914). Unsupported or unbound shapes become query-shaped.

- Invalidation completeness: refuted. The implementation includes permission-backing write, metadata activation, app reset, logical import, declared restore, out-of-band revocation, and all twelve transitions—login, logout, user switch, session expiry, admin revocation, lease expiry, grant issued/ended, credential issued/ended, token issued/ended—at [graph-query.mjs:1097](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/packages/snapback-codegen/graph-query.mjs:1097) and [graph.rs:4031](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/manifest/graph.rs:4031). This covers LLP 0008/0053’s authority-event vocabulary.

- The three required PARTIAL labels remain PARTIAL: invalidation, corpus, and bounds at [freeze-graph-g0-corpus.mjs:1763](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1763). The defect is the overclaim on CLASS and AUDIENCE.

- Public rooms is genuinely class 1: yes. Its delivered base has only public `rooms` data, an argument equality, public-field ordering, and a closed projection. No membership, principal, session, grant, delegation, or authority-partition value reaches the delivered base. What is missing is qualification evidence, not static class-1 structure.

- Freezer determinism: deterministic by inspection. The new cases use fixed arrays, frozen fixture values, canonical hashing, and stable output ordering at [freeze-graph-g0-corpus.mjs:793](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:793) and [line 1771](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1771). The committed corpus/digests passed the Rust corpus test. The Node test could not run because the sandbox denied `mkdtemp` with `EPERM`, including with `TMPDIR=/tmp`.

Verification: `cargo test -p snapback --test graph_corpus_v1` passed 13/13; the targeted `snapback-types` broadcast fail-closed test passed.

Weakest seam: exact audience. It currently consists of two predicate-derived hashes and a corpus test that labels one membership lookup twice. It neither binds the full installed policy/schema identity nor independently exercises establishment versus strict delivery at one instance and version. That combination makes the certificate look exact while leaving the central deny-set-parity claim untested.

VERDICT: NOT READY (4 MATERIAL)

## r2 — fix round 1 delta

One new MATERIAL blocks readiness. The six round-1 findings are substantively repaired, but Q2/Q3 introduced a shipped-carrier/schema inconsistency.

### Q1–Q6 dispositions

- **Q1 — FIXED.** Establishment independently resolves the installed declaration and scans membership rows from the establishment predicate ([freezer:799](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:799), [freezer:807](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:807)). Strict delivery separately reads `functionMembership`, performs a fresh membership scan, then evaluates filtering, ordering, truncation, projection, bytes, length, existence, and completeness ([freezer:847](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:847)). The shared helper only finds the installed table; it does not supply an outcome. The two paths cannot collapse because the divergent member/moderator fixture produces establishment `allow`, strict `deny`, and `audience-parity-failed` ([freezer:930](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:930)). Per-principal evaluations reuse one graph instance and authorization version ([freezer:761](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:761)); Rust freshly reconstructs both computations and exact-checks `[allow, deny]`, including outsider `resultBytes: null` ([graph_corpus_v1.rs:1920](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback/tests/graph_corpus_v1.rs:1920), [graph_corpus_v1.rs:1954](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback/tests/graph_corpus_v1.rs:1954)). The hand-authored/circular vectors are gone.

- **Q2 — FIXED-BUT-INTRODUCED.** Authoring requires one declaration-bound membership predicate and marks broadcast functions authenticated ([define.mjs:3985](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/packages/snapback-codegen/define.mjs:3985), [define.mjs:4109](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/packages/snapback-codegen/define.mjs:4109)). Codegen validates installed roles/resource types and requires exact audience equality, which is stronger than implication ([graph-query.mjs:1151](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/packages/snapback-codegen/graph-query.mjs:1151), [graph-query.mjs:1298](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/packages/snapback-codegen/graph-query.mjs:1298)). Host admission rechecks authenticated auth plus declaration, resource table, scope argument, roles, and installed vocabulary ([engine.rs:34864](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-engine/src/local/engine.rs:34864), [engine.rs:35386](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-engine/src/local/engine.rs:35386)). The outsider is denied end-to-end. The introduced issue is the missing `functionMembership` public-schema update below.

- **Q3 — FIXED-BUT-INTRODUCED.** The digest preimage binds declaration, table fields, membership policy, and visibility policy ([graph-query.mjs:1123](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/packages/snapback-codegen/graph-query.mjs:1123)); Rust derives the same identity from `SchemaManifest` ([graph.rs:3909](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/manifest/graph.rs:3909)). The engine recomputes it from active installed facts and refuses mismatch ([engine.rs:34881](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-engine/src/local/engine.rs:34881)); the installed-role mutation test proves the carried value cannot override those facts ([engine test:224](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-engine/src/local/tests/engine.rs:224)). Codegen returns query-shaped when the identity cannot be formed ([graph-query.mjs:1317](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/packages/snapback-codegen/graph-query.mjs:1317)). The introduced issue is the missing `installedOwnerIdentity` public-schema update below.

- **Q4 — FIXED.** The two `publicRooms` worlds independently remove the other-principal policy row and the other partition plus its dependent policy row, while holding the invocation tuple fixed ([freezer:1723](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1723)). They exact-match bytes, ordering, length, existence, and completeness ([freezer:1772](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:1772)). Rust requires the union of hidden axes to be exactly partition, policy, and principal ([graph_corpus_v1.rs:1731](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback/tests/graph_corpus_v1.rs:1731)). The draft’s CLASS claim is expressly based on that evidence ([draft:15](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/tests/conformance/graph/0268-EXTENSION-DRAFT.md:15)).

- **Q5 — FIXED.** The sidecar blob is byte-identical at `HEAD` and `HEAD~2`: both are `6f8624ff140f75be5d17479b1be2edc4111ce4a9`; broken `HEAD~1` was `8388749e98ad65c8fa66b4565b5193dc65ce1965`. Prover status is additive in the separate four-row disposition artifact ([broadcast-prover-dispositions:1](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/tests/conformance/graph/broadcast-prover-dispositions.v1.json:1)). The Rust contract retains six top-level keys and exactly four G2 cases ([graph_corpus_v1.rs:2076](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback/tests/graph_corpus_v1.rs:2076)).

- **Q6 — FIXED.** The executable witness proves different instance hashes, `P != Q`, membership in P, and non-membership in Q, then requires query-shaped `scope-unbound` with null bytes ([graph_corpus_v1.rs:1996](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback/tests/graph_corpus_v1.rs:1996)).

### New finding

**MATERIAL — the new carrier fields are absent from the committed closed JSON Schemas.**

Rust now serializes required `installedOwnerIdentity` and optional-present `functionMembership` ([graph.rs:1248](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/manifest/graph.rs:1248), [graph.rs:1318](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/manifest/graph.rs:1318)). But `functions.manifest.schema.json` closes `GraphBroadcastAudienceV1` with only `strictEvaluatorIdentity` ([schema:2407](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/schemas/functions.manifest.schema.json:2407)) and closes `GraphQueryPlanV1` without `functionMembership` ([schema:3565](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/schemas/functions.manifest.schema.json:3565)). The same definitions remain stale in the inspect/admin/app-ensure schemas.

These are Rust-owned public schemas ([schema_export.rs:104](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/schema_export.rs:104)); therefore any recursive schema consumer rejects the newly emitted legitimate broadcast manifest as containing unknown properties. Codegen’s current pre-write check misses this because it validates only root-level properties rather than nested definitions ([index.mjs:1925](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/packages/snapback-codegen/index.mjs:1925)). This is one underlying MATERIAL under criterion (i), affecting both Q2 and Q3’s shipped carrier.

Fix: regenerate all Rust-owned and derived schemas with `snapback-schemagen`, regenerate chained artifacts/inventories, and add a recursive committed-schema test validating `broadcastFixture.functionManifest` so a default manifest cannot hide future graph-carrier drift.

No new MINOR findings.

### Risk sweep

- **REFUTED-RISK (a–d, f):** full engine admission recomputes the installed owner, audience, scope equalities, separation fields, and invalidation; every delivered non-projection node must carry the same scope argument equality ([graph.rs:3993](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/manifest/graph.rs:3993)). No authored proof value alone admits a host plan.
- **REFUTED-RISK (e):** all 18 LLP 0209/LLP 0008→0053 selectors are present: permission-backing write; metadata activation; app-reset, logical-import, declared-physical-restore; out-of-band revocation; and login, logout, user-switch, session-expiry, admin-session-revocation, lease-expiry, grant issued/ended, credential issued/ended, and token issued/ended ([LLP 0209:787](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/llp/0209-live-graph-profile.spec.md:787), [graph.rs:4137](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/manifest/graph.rs:4137)).
- **REFUTED-RISK (g–h):** the draft retains exactly INVALIDATION, CORPUS, and BOUNDS as PARTIAL ([draft:20](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/tests/conformance/graph/0268-EXTENSION-DRAFT.md:20)); rows 23–27 retain their codes and order ([graph.rs:476](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/manifest/graph.rs:476)) with executable counterfeits ([graph.rs:6449](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/manifest/graph.rs:6449)).
- **Scope:** no evaluator, matcher, serving, or client-carrier changes were found. The G2 sidecar contract is intact; the stale public schemas are the sole shared-contract blocker.

### Requested checks

- `cargo test -p snapback --test graph_corpus_v1`: PASS, 14/14.
- `cargo test -p snapback-types broadcast`: PASS, 1/1.
- Node graph-query test: BLOCKED before assertions by the read-only sandbox (`EPERM` creating its temporary backend), including with a repo-local `TMPDIR`; this was environmental, not a test failure.
- **(j) Freezer determinism:** no nondeterministic artifact input found. Canonical hashing sorts object keys ([freezer:62](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:62)), fixture ordering is explicit, and `--check` byte-compares every output ([freezer:2047](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:2047)). `Date.now()` only cache-busts a temporary module URL and does not enter artifacts. Dynamic freezer rerun was unavailable under read-only restrictions.
- **(k) Genuine class 1:** yes. Delivered rows come only from the public-read `rooms` table ([schema fixture:3](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/tests/conformance/graph/broadcast-fixture/schema.mjs:3)); membership is a separate admission-only table and never enters the root, projection, order, length, existence, or completeness channels ([queries fixture:9](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/tests/conformance/graph/broadcast-fixture/queries.mjs:9)).

**(l) Weakest seam:** after repairing the blocking schema drift, the weakest proof seam remains the fixture-local strict evaluator. It is genuinely independent from establishment and proves this closed root/equality/projection slice, but it reimplements that slice rather than invoking the future production G2 evaluator. Semantic expansion of ordering, projection, windows, or delivery scheduling could drift from this oracle; the still-PARTIAL G2-C rows correctly remain the point where production evaluator and fence-order evidence must replace that narrow seam.

VERDICT: NOT READY (1 MATERIAL)

## r3 — schema regen (targeted)

No material findings.

- Rust types define optional/defaulted `function_membership` and required `installed_owner_identity`. Generated camelCase fields match in all four schemas containing the graph closure; the other two rotated artifacts do not contain those types.
- `d05501041` modifies only six generator-owned files: five schemas plus `http.routes.v1.json`.
- `dk7_committed_schemas_match_rust_types`: passed. Public-instance drift test also passed.
- Known failure: worktree path-resolution artifact. `schemas/../../../packages/...` escapes the worktree; the file exists in both `HEAD` and `origin/main`, and this commit touches no resolution inputs.

VERDICT: READY

## r4 — port fidelity (targeted)

- G2-A is intact: evaluator blob matches `origin/main`; lineage charging and proof classes remain at [graph_evaluator.rs:2037](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-engine/src/graph_evaluator.rs:2037), with unchanged regressions at [graph_corpus_v1.rs:2541](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback/tests/graph_corpus_v1.rs:2541).
- Reviewed 0268 proofs are preserved: installed-owner facts are recomputed at [graph.rs:3923](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/manifest/graph.rs:3923), exact establishment membership is enforced at [engine.rs:34981](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-engine/src/local/engine.rs:34981), and counterfeit rows remain at [graph.rs:6571](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback-types/src/manifest/graph.rs:6571).
- The port strengthens strict evaluation by executing admitted delivery through G2-A and matching frozen proofs/ledgers at [graph_corpus_v1.rs:3218](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback/tests/graph_corpus_v1.rs:3218).
- Executable moves are faithful: `audienceParity`/`scopeMismatch` are selected at [graph_corpus_v1.rs:3143](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/crates/snapback/tests/graph_corpus_v1.rs:3143); transition/mixed remain reasoned pending rows at [broadcast-prover-dispositions.v1.json:18](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/tests/conformance/graph/broadcast-prover-dispositions.v1.json:18); the unchanged four-row G2-A sidecar retains `advancedNodeId` at [broadcast-cases.g2-pending.v1.json:792](/Users/ccheever/projects/snapback/.claude/worktrees/0268-lane/tests/conformance/graph/broadcast-cases.g2-pending.v1.json:792), so no superseded pre-G2A evaluator content was imported.

VERDICT: READY
