# LLP 0268 exit extension — grok review record

**Change:** the broadcast prover (landed on main as `a11054ca4`, 2026-08-24, ported onto the G2-A evaluator)
**Reviewer:** grok-4.6, xhigh, read-only, blind on full rounds
**Orchestrator:** Claude Fable 5 (session snapback-44), under `issues/20260824-llp0268-exit-extension-commission.md`
**Provenance:** every review below was actually received from the named model; verbatim text per round.

## Verdict ledger

| Round | Reviewed | Verdict |
| --- | --- | --- |
| r1 | prover source | VERDICT: NOT READY (1 MATERIAL) |
| r2 | fix round 1 delta | VERDICT: READY |
| r3 | schema regen + port | (not run — READY standing) |

## r1 — prover source

I'll review the LLP 0268 broadcast-prover exit extension against the contracts, starting with HEAD, the governing LLPs, and the listed artifacts.HEAD is `413501c75`. Next I’ll load the governing LLP contracts and the prover, corpus, and freezer artifacts.I’ll load the contract sections next and split the prover, host, and corpus into parallel reads.I’ll read the prover, host recomputation, and corpus next, and start the allowed tests in parallel.The compile path, host recomputation, and fixture are the load-bearing seams; I’ll read those next and start the allowed tests.Audience-parity looks tautological in the runner; I’ll confirm that against the corpus, LLP 0008 invalidation list, freezer, and defineGraphQuery emission.Review of **LLP 0268 exit extension — the broadcast prover** at `413501c75`. Allowed tests all passed: `graph_corpus_v1` (13), `snapback-types graph_` (18, including `graph_stage_b1_search_and_broadcast_are_fail_closed`), `graph-query.test.mjs`.

The compiler/host split is mostly fail-closed: codegen may only author `classification` + a membership `predicate`; the host recomputes `baseNodeIds`, equalities, identities, and the 18 selectors and refuses rows 23–27 without downgrade. One SATISFIED label is not earned.

## MATERIAL

### M1 — `G0-BCAST-AUDIENCE` SATISFIED without deny-set parity *(d, g)*

The exact-audience pair never compares two evaluators. Freezer writes the expect vector by hand; the runner assigns the same membership-lookup outcome to both sides; `strictEvaluatorIdentity` is a content hash of that same predicate. `audience-parity-failed` is never produced for a valid graph. Function auth is `authenticated`, not the establishment membership, so a fresh fail-closed evaluation of the query would **allow** an authenticated outsider that establishment **denies**.

| Site | What it does |
|---|---|
| `demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:808` | `expect: { establishment: ['allow', 'deny'], strict: ['allow', 'deny'] }` is authored, not computed |
| `crates/snapback/tests/graph_corpus_v1.rs:1682-1685` | `strict_outcomes.push(outcome)` copies the establishment lookup; the two vectors cannot diverge |
| `packages/snapback-codegen/graph-query.mjs:1110-1116` and `crates/snapback-types/src/manifest/graph.rs:4013-4028` | `strictEvaluatorIdentity` hashes `{format, policyIdentity, predicate}` where `policyIdentity` already hashes `predicate` |
| `packages/snapback-codegen/define.mjs:4092-4095` | broadcast queries get `auth: 'authenticated'` with **no** function-level membership matching the establishment predicate |
| `tests/conformance/graph/0268-EXTENSION-DRAFT.md:19` and corpus `broadcastInputs` `G0-BCAST-AUDIENCE` | both mark **SATISFIED** |

LLP 0209 §3.3/§3.4 and LLP 0268 §1.1 require establishment deny-set = fail-closed audience at one instance + authorization version. This fixture is `[allow, deny]` for `(principal_p_member, outsider)` on `room_p` (and the Q twin), but that is one table lookup plus a definitional hash, not parity.

**Fix:** Mark `G0-BCAST-AUDIENCE` **PARTIAL** until a distinct strict path exists. Minimum: bind function membership (or the fail-closed query audience) to the same closed predicate, evaluate establishment and that path independently for both principals, and only then claim SATISFIED. Do not treat `strict_outcomes = establishment_outcomes` as evidence.

---

## MINOR

1. **CLASS required `pairedWorld` is substituted *(g, f-adjacent)*** — corpus `broadcastInputs` for `G0-BCAST-CLASS` lists `audienceParity` + `refusal` (`freeze-graph-g0-corpus.mjs:1758`). LLP 0209 §3.3 requires `pairedWorld` + `refusal`. There is no paired-world for `publicRooms`. Static class-1 is real (see (k)); the falsifier is missing. **Fix:** either freeze a storage-column / extra-membership pair on this fixture, or keep CLASS SATISFIED only with an explicit “no hidden-policy slice; pairedWorld N/A” note, not a swapped case kind.

2. **SEPARATION is grammar isolation, not a result-channel walk *(b)*** — `queries.mjs:4-7` and the draft call the B2 source walk the proof. Overlay is `()` / `null`, effect is `admit-only`, filters cannot express membership. That is closed-IR isolation, which is enough for this slice, but it is not a walk of projection/order/length/existence/completeness. **Fix:** say “IR isolation” in the draft; optionally assert no data node visibility/filter mentions the establishment declaration.

3. **Bound P-member / Q-instance deny is untested *(c coverage)*** — `scopeMismatch` is the **unbound** plan (`publicRoomsUnbound` → `scope-unbound`). Audience pairs use outsider, not `principal_p_member` on `room_q`. The bound mechanism (`roomId` arg → membership lookup) would deny; it is not executed. **Fix:** add that pair as `allowDeny` or a third `audienceParity` expect `[deny, deny]` / `[allow, deny]` as appropriate.

4. **Invalidation mapping is conservative, not row-bound *(e residual)*** — 18 selectors match LLP 0053 events 1–4 plus LLP 0209 §3.2’s twelve transitions (`graph.rs:4031-4070`, `graph-query.mjs:1118-1139`). `permission-backing-write` uses `table: declaration` and `all-declaration-scopes`, not `bindings` from the changed membership row to `a0`. Completeness is OK; precision is not. Draft already keeps INVALIDATION PARTIAL for G2-C fences — keep it PARTIAL; do not later claim row-precise affected-scope.

5. **Pending sidecar grew `caseDispositions` *(i coordination)*** — `broadcast-cases.g2-pending.v1.json` exact keys now include `caseDispositions`; `g2_pending_broadcast_cases_are_structurally_frozen` requires it. Fence case bodies are unchanged. Additive, but a G2 lane that assumed the old four-kind sidecar will merge-conflict. **Fix:** call out the key in the G2 handoff.

6. **Shared `define.mjs` regenerates every demo `artifacts.json`** — hash/cache churn only; not matcher/serving. Expected from touching the authoring module; still a wide landing surface.

7. **JS `graphPlanIdentityV1` does not recompute broadcast proofs** (`graph-query.mjs:951-958`) — it rewrites ids and checks costs. Host `validate_graph_query_plan_v1` + `graph_broadcast_proof_faults` is the gate. Fine if every production path hits Rust admission.

8. **Resource-equality walk uses source node order** (`graph-query.mjs:1142-1162`) — child-before-parent authoring yields conservative `scope-unbound`. Host recomputes in canonical order. False query-shaped, not a trust escape.

---

## REFUTED-RISK

| Item | Why it does not hold |
|---|---|
| **(a) trust escape** | `defineGraphQuery` admits only `{classification, establishment.predicate}` (`define.mjs:4018-4029`; extra proof fields → `SNAPBACK_GRAPH_UNKNOWN_FIELD`, test at `graph-query.test.mjs:705-719`). `compileGraphBroadcastV1` constructs every other field. Host `recompute_graph_broadcast_establishment_v1` + `graph_broadcast_proof_faults` exact-compares effect/predicate/overlay/scope/audience/invalidation (`graph.rs:3899-4127`). Authored `baseNodeIds` mismatch is row 30, not a rewrite-and-accept on the admission path. Rows 23–27 still refuse; no downgrade to query-shaped. |
| **(b) predicate → result** | Membership is not a `FilterExpr` arm. Node visibility for `publicRooms` is table `public-read` (`define.mjs:3856`, `schema.mjs:15`). Projection is `scopeId`/`name`. Overlay inhabitant is `null`. Establishment cannot appear in order/length/existence/completeness in this IR. |
| **(c) unbound equalities** | `publicRooms` has `resourceEqualities: [{nodeId:'n0', field:'scopeId', argumentId:'a0'}]`. Engine requires that field to be a required `Id<rooms>` (`engine.rs:34914-34941`). Unbound declaration compiles to `query-shaped`/`scope-unbound` and is the executable `scopeMismatch` case. Exists/principal/search nodes refuse the binding walk. |
| **(e) missing 0008 event** | LLP 0008 defers to LLP 0053’s four authorization events plus session/lease/grant/credential/token transitions. Those are the 18 selectors. Membership tables **are** permission-backing (`SchemaTable::is_permission_backing`). Inserts/deletes always match `permissionFields: null`. |
| **(f) class-1 lie** | Delivered base is one `root-window` + projection, both `declaredClass: 1`, `class2:[]`, `class3:null`. `roomMembers` is not a graph node. No owner/`auth.userId`/principal-bound/search node in the delivered set. |
| **(h) rows 23–27** | `graph_stage_b1_search_and_broadcast_are_fail_closed` still refuses PublicRead overlay, cleared equalities, doctored strict identity, popped invalidation, and class-3 base. Codegen never emits those counterfeits. |
| **(i) evaluator/matcher/serving / G2 corpus schema** | `engine.rs` +81 is installed-owner admission only (`validate_graph_query_schema_references` ~34864). `graph_corpus_v1.rs` keeps `g2_pending_broadcast_cases_are_structurally_frozen` and the closed seven-kind union. Fence cases remain sidecarred. No matcher/serving change. |

---

## (j) Freezer determinism

Yes for the new fixture. The freezer codegens `broadcast-fixture` in a temp dir that is not serialized, builds invocations from closed hashes/epoch 0, and `--check` byte-compares `pretty(corpus)` / pending / bounds. Rust recomputes `contentDigest` after stripping that field (`graph_corpus_v1.rs:1779-1789` and the corpus digest at ~826). `broadcast_prover_cases_are_executable` reconstructs plan/instance/materialization/partition. I did not re-run the freezer binary itself.

## (k) Is `publicRooms` genuinely class-1?

Yes. `rooms` is `public-read`; the graph does not read `roomMembers`; filters are `scopeId = Arg(roomId)`; order is `updatedAt`; projection is `scopeId`/`name`. No principal-, partition-, or membership-dependent channel in the **delivered** base. Membership is establishment-only. `auth: 'authenticated'` gates invocation, not row bytes among recipients.

## (l) Weakest seam

`G0-BCAST-AUDIENCE` is the load-bearing SATISFIED upgrade, and it is definitional. The V1 carrier makes `strictEvaluatorIdentity` a hash of the establishment predicate, codegen never emits `audience-parity-failed`, `defineGraphQuery` does not attach that membership as function auth, and the only executable “parity” test copies one fixture lookup into both vectors. Everything else in this lane is fail-closed recomputation; this label is the one that pretends a second evaluator exists.

VERDICT: NOT READY (1 MATERIAL)

## r2 — fix round 1 delta

I'll start by loading the review skill and inspecting the HEAD delta against the round-1 findings.This is a targeted round-1 disposition review, not a generic PR review. I'll pull the HEAD delta, the LLP, and the Q1–Q6 code paths next.I'll pull the actual HEAD patch, LLP 0268, and the Q1–Q6 code paths so dispositions rest on file:line evidence.Sidecar bytes match `HEAD~2`. Next I’ll read the source diffs and run the allowed tests in parallel.I’ll trace the independent evaluation paths and the certificate preimage next, then check paired-world and corpus schema changes.I’ll extract the paired-world and audience-parity cases from the corpus, then inspect the counterfeit-row tests.I’ve got the paths mapped; next I’ll run the allowed tests and check a few remaining seams (invalidation vocabulary, freezer determinism, corpus schema).Round-1 dispositions first, then new findings. Allowed tests: `graph-query.test.mjs` pass, `graph_stage_b1_search_and_broadcast_are_fail_closed` pass, `broadcast_admission_recomputes_function_membership_and_installed_owner` pass, `graph_corpus_v1` 14/14 pass. Sidecar SHA-256 `3eb0313ae03ab97adc4b8d45fc5bd0f3d1211e31d87dda264bb78520c10fd37e` matches `HEAD~2` byte-for-byte.

## Q1–Q6 dispositions

### Q1 — FIXED

Two evaluators, two plan fields, no copy.

**Establishment** (`crates/snapback/tests/graph_corpus_v1.rs:477–517`, freezer twin `demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:807–831`) requires `classification == "broadcast"`, reads `broadcast.establishment.predicate` plus `establishment.scope.argumentIds[0] → argument.name`, and scans installed membership rows. It cannot consume a strict result.

**Strict** (`graph_corpus_v1.rs:529–639`, freezer `freeze-graph-g0-corpus.mjs:850–897`) never calls the establishment function. It reads `normalizedPlan.functionMembership[0]`, binds `resource.arg.path` into `args`, admits or denies on that predicate, and only then filters/orders/projects the closed `root-window` / `closed-projection`. Deny returns `resultBytes: null`.

At one instance+version the two audience pairs share args, windows, partition, `evaluationCut`, and `authorizationVersion` (`public-rooms-scopeP-exact-audience` and `…scopeQ…` in `corpus.v1.json`). Complete records are compared, not just labels (`graph_corpus_v1.rs:1938–1964`): establishment evidence vs frozen evidence, strict evidence vs frozen evidence, outcome vectors `[allow, deny]` exact-match, outsider `resultBytes` is null.

The constructed divergence is real: `publicRooms` establishment admits `member` while `publicRoomsDivergent` function membership requires `moderator` (`tests/conformance/graph/broadcast-fixture/queries.mjs:103–150`). Compiler disposition is `query-shaped` / `audience-parity-failed` (`graph-query.mjs:1298–1314`; frozen at `corpus.v1.json` `broadcastFixture.divergence`; asserted at `graph_corpus_v1.rs:2046–2073`). The circular copy and hand-authored expect vector are gone; the freezer derives `expect` from the two evaluations (`freeze-graph-g0-corpus.mjs:915–928`).

**Is strict a wrapper?** The *deny-set kernel* is the same shape of membership-row scan, over a **different plan field**. That is not a reduction to the establishment lookup:

1. Strict never reads `broadcast.establishment`. After canonicalize, establishment scope is argument id `a0`; function membership still names `roomId` (`corpus` `publicRooms` carrier). Those meet only through the host name→id map (`engine.rs:34949–34952`, `graph.rs:3967–3970`).
2. On allow, strict continues into an independent root/projection execution that establishment does not perform.
3. Replacing strict with `fixture_establishment_evaluation(...)` would drop `resultBytes` / order / length / existence / completeness and would miss `publicRoomsDivergent`.
4. This is a G0 closed-IR interpreter, not a second host VM. Delivery ordering remains G2-C, which is why `G0-BCAST-AUDIENCE`’s remaining condition names that slice only.

### Q2 — FIXED

Broadcast classification now requires function auth **and** membership that exactly equals the establishment predicate.

- `defineGraphQuery` forces `auth: 'authenticated'` for authored `classification: 'broadcast'` and only accepts `declaration.hasRole(membershipResource.arg(...), ...)` (`define.mjs:3985–4003`, `4112–4130`).
- Codegen implication + exact role equality; otherwise `audience-parity-failed` (`graph-query.mjs:1298–1314`). Bare membership and divergent roles are tested (`graph-query.test.mjs:297–310`).
- Host recomputes from installed facts: missing/non-arg membership, scope mismatch, role inequality → `BroadcastAudienceUnprovable` (`engine.rs:34933–34967`). Public function auth on an authored broadcast certificate is refused (`engine.rs:35386–35393`; `engine.rs` tests `193–213`).
- Outsider is denied with no bytes (`graph_corpus_v1.rs:1961–1964`).

### Q3 — FIXED

`GraphBroadcastAudienceV1` carries `installed_owner_identity` (`graph.rs:1250–1253`). Codegen hashes declaration + table fields + membership policy + visibility (`graph-query.mjs:1123–1136`, `1317–1345`); unformable → `query-shaped` / `audience-parity-failed`. Host helper `graph_broadcast_installed_owner_identity_v1` (`graph.rs:3917–3949`) recomputes from the active `SchemaManifest` (re-inserting serde-omitted empty `transitions`). Mismatch refuses (`engine.rs:34889–34904`); schema-role mutation is covered (`engine.rs` tests `224–239`). Corpus asserts the frozen digest equals the host recompute (`graph_corpus_v1.rs:1907–1911`). Plan-local validation clones the carried digest by design (`graph.rs:4199–4201`) and still recomputes `strictEvaluatorIdentity` over it; the schema wrapper is what binds the digest to installed facts (`engine.rs:35352–35358` parity sentinel).

### Q4 — FIXED

Two `publicRooms` paired worlds, invocation tuple held fixed:

| Case | Hidden axes | Slice |
| --- | --- | --- |
| `g0-pair-public-rooms-other-principal-membership` | principal, policy | `roomMembers.member_q` |
| `g0-pair-public-rooms-other-partition-data` | principal, partition, policy | `rooms.room_q` + dependent `member_q` |

Freezer exact-matches `resultBytes`, `orderedRootIds`, `resultLength`, `existence`, `completeness` across present/absent (`freeze-graph-g0-corpus.mjs:1731–1868`). `paired_worlds` requires those same five fields, distinct world identities, identical non-slice table digests, and `broadcast_hidden_axes == {partition, policy, principal}` (`graph_corpus_v1.rs:1524–1735`). `G0-BCAST-CLASS` SATISFIED rests on that strength (`0268-EXTENSION-DRAFT.md:15`).

### Q5 — FIXED

`tests/conformance/graph/broadcast-cases.g2-pending.v1.json` is byte-identical to `HEAD~2` (SHA-256 `3eb0313a…`; six top-level keys; four rows; original description). `HEAD~1`’s `caseDispositions` key and two-row filter are gone. Additive dispositions live in `broadcast-prover-dispositions.v1.json`. `g2_pending_broadcast_cases_are_structurally_frozen` again enforces the four-row G2 contract (`graph_corpus_v1.rs:2076–2235`); `broadcast_prover_dispositions_are_additive` does not mutate it (`2237–2276`). No evaluator/matcher/serving edits; `graph_corpus_v1.rs` additions are extra helpers/tests.

### Q6 — FIXED

`scopeMismatch` now proves P≠Q, membership in P, and non-membership in Q before freezing the compiler’s `scope-unbound` carrier (`graph_corpus_v1.rs:2000–2032`). Certified `publicRooms` binds the only delivered data node `n0.scopeId → a0` (`resourceEqualities` above). A P-member presenting Q is an establishment deny on that instance’s argument, not a shared P-check on a Q key.

---

## New findings

### MATERIAL

None.

### MINOR

1. **No second admitted principal for empirical class-1 invariance.** Each room has one member. Paired worlds hide *other* principals’ rows while evaluating as `principal_p_member`; they never compare two allowed callers on one instance. Harmless here because the delivered node is `public-read` and the projection has no caller fields — but it is the thinnest CLASS observation. File: `broadcast-fixture/data.v1.json:7–9`, `graph_corpus_v1.rs:1562–1584`.
2. **`audienceParity` does not assert shared materialization/version.** Frozen invocations do share them; `validate_broadcast_invocation` reconstructs each call independently and never `assert_eq!`s the pair (`graph_corpus_v1.rs:1920–1937`). Drift would have to be authored into the freezer.

### REFUTED-RISK

- **Authored proof fields / trust escape.** The only authored broadcast fields are `classification` and `establishment.predicate`. Effect, overlay, scope, both audience digests, invalidation, and `baseNodeIds` are derived and host-recomputed (`graph.rs:3993–4238`, `graph-query.mjs:1248–1354`). Authored `classification:"broadcast"` is never downgraded; rows 23–27 still refuse in order (`graph.rs:6449–6508`).
- **Separation as assertion.** Membership is establishment-only (`schema.mjs:3–15`, `queries.mjs:9–52`). `effect: admit-only`, `overlayProjection: null`. Predicate cannot reach projection/order/length/existence/completeness of the delivered graph.
- **Invalidation vs LLP 0008 / 0209 §3.2.** 18 selectors: permission-backing write, metadata activation, three incarnation causes, out-of-band revocation, twelve transition causes (`graph.rs:4137–4184`, `graph-query.mjs:1110–1203`). Matches LLP 0209’s two versioning families. `G0-BCAST-INVALIDATION` correctly stays PARTIAL for G2-C fence-before-delivery.
- **Draft nine-label table.** SATISFIED six; PARTIAL remains `G0-BCAST-INVALIDATION`, `G0-BCAST-CORPUS`, `G0-BCAST-BOUNDS` (`0268-EXTENSION-DRAFT.md:20–23`; `broadcast_inputs_complete`).
- **Rows 23–27.** Not weakened. Row 26 still zeros `strict_evaluator_identity`; engine tests add function-auth, bare-auth, role-divergence, and installed-schema mismatch.
- **Scope creep.** No matcher/serving/evaluator changes. `function_membership` and `installed_owner_identity` are the Q1/Q3 carrier fields (empty membership still omitted on ordinary plans). Demo `artifacts.json` hash churn is JsonSchema/codegen cache, not a G2 contract break. Sidecar restored.

### (j) Freezer determinism

The new fixture path is pure: static `data.v1.json`, Node `24.18.0` pin, JCS content digests, `_id` tie-break, deepClone then filter by row id (`freeze-graph-g0-corpus.mjs:807–972`, `1731–1868`). Sidecar emission is the original four-row `pendingCases(...)` with no `caseDispositions`. Not re-executed in this read-only review; inspection shows no wall-clock or unordered-hash source on the new pairs.

### (k) Is `publicRooms` genuinely class-1?

Yes. Delivered base is one `root-window` on `rooms` with `visibility: public-read`, `declaredClass: 1`, projection `{scopeId, name}` only (`schema.mjs:7–15`, `queries.mjs:9–25`). `roomMembers` is establishment/function admission, not a graph node. `functionMembership` is a static plan predicate, not caller identity. Function-level `authorizationDependence: ['userId']` (`index.mjs:5693–5696`) invalidates *who may join*, not the shared bytes.

### (l) Weakest seam

The deny-set half of “fresh strict evaluation” is a second membership-row scan over `functionMembership`, not a host query VM. For a certified plan those predicates are admission-forced equal, so runtime `[allow, deny]` agreement is a corollary of Q2 rather than an independent engine observation; the thing that is independent is the field source plus the delivered root/projection on allow, plus compiler refusal when the sources diverge. Combined with a single admitted principal per room, CLASS and AUDIENCE are as strong as this closed G0 slice can be without G2-C actually serving two members of P.

VERDICT: READY

## r3 — schema regen + port

(no run: READY standing; delta addressed only the other family's findings)
