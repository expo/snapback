# LLP 0209 G0 Stage A — grok review record

**Document:** `llp/0209-live-graph-profile.spec.md` v0.5 (G0 Stage A)
**Reviewer:** grok-4.6, reasoning effort xhigh, read-only, blind to the other family each round
**Orchestrator:** Claude Fable 5 (session snapback-44), under `issues/20260823-llp0209-g0-commission.md`
**Date:** 2026-08-23
**Provenance:** every review below was actually received from the named model; verbatim text follows per round. Nothing here is authored by the orchestrator except this header and the round labels.

## Verdict ledger

| Round | Reviewed commit | Verdict |
| --- | --- | --- |
| r1 | 228bebbe3 Stage A draft | VERDICT: NOT READY (4 MATERIAL) |
| r2 | 7c01acb13 fix round 1 | VERDICT: NOT READY (2 MATERIAL) |
| r3 | eb6f296e2 fix round 2 | VERDICT: NOT READY (3 MATERIAL) |
| r4 | 63cc68b89 fix round 3 | VERDICT: NOT READY (3 MATERIAL) |
| r5 | 12dbe6e7d fix round 4 | VERDICT: NOT READY (1 MATERIAL) |
| r6 | 55557e0fc fix round 5 | VERDICT: READY |
| r7 | 90f55302f fix round 6 | VERDICT: READY |

## r1 — 228bebbe3 Stage A draft

I'll review the Stage A amendment as a docs-only change: first the skill and the actual diff, then the commissioning packet, consumer LLPs, and cited code.The change is a large Stage A spec amendment. I'll read the packet, the amended spec, and the consumer LLPs next so findings rest on those texts rather than the truncated diff.Next I’ll read the new §2–§5 and §9 text, then check it against 0267, 0268, and the cited types.I’ll verify every cited `path:line` against the code, fixtures, and consumer LLPs next — those are the highest-risk MATERIAL class.The Stage A text is not implementable as an identity/broadcast contract. Four holes would send Stage B down a wrong path; the rest is naming and leftover framing.

## MATERIAL

### 1. Instance identity is one unkeyed window; every `bounded-to-many` also has `page`
**§2.2 / §2.4 (`llp/0209-live-graph-profile.spec.md:231`, `:341–357`).**  
`bounded-to-many` requires `page` and calls an independently pageable child “a named interval.” `GraphInstancePreimageV1` has a single `window: GraphWindowIdentityV1` with no `nodeId`. Equal instance hashes can therefore name different child-page demands (comment page 2 of `issueDetail` vs page 1; or a list page mixed with a child page). That violates 0268 G0-BCAST-IDENTITY (“identity strong enough to imply byte-equivalent results,” `llp/0268-broadcast-shaped-realtime.rfc.md:468`) and the packet’s comments-as-window ruling (`issues/20260823-llp0209-g0-commission.md:144–145`). 0267’s ledger is also one lineage bound to one stable window (`llp/0267-query-cost-guardrails.rfc.md:544–546`).  
**Fix:** Either (a) exactly one demand window — the root; child `page` is a plan-literal interval+take, and a child whose take/cursor is an argument refuses — or (b) `window` is a canonical vector keyed by `nodeId` for every demand-paged node, and 0267’s ledger/tuple is defined over that vector.

### 2. `priorLedger` is inside the window identity the ledger is bound to
**§2.4 (`:348`, `:360–365`).**  
`GraphWindowIdentityV1.priorLedger` is hashed into the instance preimage. 0267 binds `QueryCostWindowLedgerV1` *to* generation, plan, args digest, partition, target, and **stable** window identity; the first page is all-zero (`llp/0267-query-cost-guardrails.rfc.md:544–547`). Hashing the ledger into that identity is circular (you cannot bind a ledger to a digest that includes it) and unstable across pages of one interval. A mid-interval `lower` with a zeroed ledger becomes a new instance and resets cumulative caps.  
**Fix:** Window identity is `{order, direction, lower, upper, take}` only. Carry the ledger beside the cursor, bound to that identity; do not put it in the instance preimage.

### 3. Node-id assignment is not a unique walk
**§2.1 (`:173–180`).**  
Ids are “root first, then each node’s children by RFC 8785 `edgeName` order, projection last.” DFS preorder and BFS assign different ids as soon as two branches both have children, so host reconstruction disagrees with codegen (`SNAPBACK_GRAPH_IDENTITY_MISMATCH`) and plan hashes are not a function of shape.  
**Fix:** State preorder DFS: emit the node, recurse on children sorted by UTF-16 `edgeName`, emit the projection last.

### 4. G0-BCAST-CORPUS/INVALIDATION rows cannot exist under the §3.4 runner
**§3.3 (`:739–742`) vs §3.4 (`:773–787`).**  
0268 §7 requires allow/deny, P/Q mismatch, exact-audience, transition, mixed-commit, and hidden-world rows (`llp/0268-broadcast-shaped-realtime.rfc.md:469–470`). The only closed case is `pairedWorld`, and the runner **rejects any authority or version delta**. Transition and mixed data+authority commits *are* version deltas; exact-audience and P-member/Q-instance need two principals or two instances, not one `authority` plus a hidden-row slice. Those labels are mapped to an artifact that cannot hold them.  
**Fix:** Keep §3.4 for hidden-world class proofs. Add closed case kinds (with records) for exact-audience, P/Q mismatch, allow/deny, transition, and mixed-commit; do not run those through the hidden-row equality checker.

## MINOR

- **§2.6 `:493–494`.** “1.5 mean label edges” is the generator default, not the fixture: `large-seed42-v1` is 2,000,370 / 1,000,000 ≈ 2.00 (`demos/zerobugs/manifest/acceptance.v1.json:74–76`). 1,000 × 2.00 still falsifies 1,024; the number is wrong.
- **`GraphQueryCostV1.maxScannedRows` (`:436`) vs 0267 §2.1 / §5.** `maxScannedRows` is a whole-query `queryCost` field; examined-entry declarations are per-node `maxExaminedEntriesPerExecution`. Say that graph rollup *is* `queryCost.maxScannedRows`, or omit the duplicate.
- **§3.3 G0-BCAST-BOUNDS (`:743`).** Listing `maxObservers` / `maxDistinctEvaluationGroups` / `maxEstimatedLiveFanoutMs` as that carrier fights 0267 §5: those live fields are **not** a ninth G0 bound (`llp/0267-query-cost-guardrails.rfc.md:568–569`). Carrier is §2.6 only; live fields are exit notes.
- **`GraphIntervalEndV1` (`:345–346`)** is used, never closed. Write the tagged union (`unbounded` | inclusive/exclusive + `KeysetAfter`).
- **Citations off by a few lines (same artifact):** `TargetCapabilityId` enum is `types.rs:11648` not `:11639`; `KeysetAfter` is `storage.rs:8004` not `:7992`; args domain digest is `materialization-bridge.mjs:168` not `:163`; `normalized_plan` at `types.rs:9172` is snapshot-batch node `serde_json::to_value`, not the JCS `domain_hash` path (`:7058`).
- **Open questions still pose OQ-1 (`:1340–1352`)** after Stage A applies it. Close it; point at §2.5.
- **Adding `HandlerPlan::GraphQuery`** will not compile without a new fail-closed match arm. Packet “no matcher changes” means do not change the three frozen arms; say the new arm is ConservativeFallback / not-executed until G2.

## REFUTED-RISK

Checked and fine: `RelationalQueryPlan` / `BoundedChildrenQueryPlan` / `SnapshotBatchPlanV2` / `SingleNodeIdentityV1` / `HandlerPlan` / `FilterExpr` / `JoinEquality` / `TableVisibilityV1` / `domain_hash` line numbers; `live_matcher.rs:250` table-granular comment and arms `:254`/`:270`/`:289`; `issueDetail` `:3869` and `issueListV2` `:3933` with ten `reads` each; schema `:11`–`:371` is 23 tables; `acceptance.v1.json:30/54/94/109` fixture pins; `corpus.v1.json:254` is `cases`; `limits.mjs:10–11` ceilings; §2.5 sibling `GraphQuery` with frozen carriers and G2-only degenerate equivalence (no in-place widen, no migration); 0080 §4 left table-granular on the old arms; `maxMaintainedWritesPerMutation = 0`; class 3 = partition-of-one; `queryCost.graph` as the sole G0 bound member (0267’s remaining envelope is that RFC’s lane); public read as `{kind:"public-read"}`; selectable `sortField` as separate plans (order lives on the node and in the window, bound by refusal 16).

**(a)** All nine packet items have a carrier, Stage B artifact, and command. Weakest is **#6**: `issueListV2`’s oracle bytes include `hasMore` / `cursor` / `examined` / `total` / `searchEpoch` / per-item `labelsCompleteness` (`functions.mjs:2673–2687`, `:3213–3258`, `:3920–3930`), none of which is a §2.2 projection leaf, and `total` is the full filtered count. Stage B can lawfully refuse that envelope, but the spec never says whether the corpus is items+completeness-labels or oracle-byte identity, so the primary list query is not a decided compile-or-refuse.

**(b)** OQ-1 is applied as sibling arm / frozen carriers / no G0 migration in §2.5, checklist 9, and the v0.4/v0.5 history. Nothing still assumes extend-in-place. Residue: the Open questions section still asks OQ-1; §5’s additive `CapturedReadKind::GraphNode` is a new variant, not a rewrite of `RelationalQueryPlan`.

**(c)** Derivation rules are sound if Stage B uses **maxima**, not means. Root 1,024 is justified by hot-recent-v1’s 1,000-issue window (`acceptance.v1.json:94–101`), not by inheriting `RELATIONAL_TAKE_CEILING`. Rejecting the 1,024 summed-batch ceiling is right: 1,000 roots × large-fixture label mean ≈ 2.00 (`issueLabels` 2,000,370) is already ~2,000 child rows. Label fanout 16 is a candidate until the per-issue **max** is measured (normal 603/516, large ~2.00 mean; 30 labels exist on normal). Comments as a window rather than 16-fanout matches the large comment tail. Maintained-write 0 is right. Unsound if anyone sizes from the spec’s 1.5 mean or from six-observer frame MB.

VERDICT: NOT READY (4 MATERIAL)

## r2 — 7c01acb13 fix round 1

I'll review the Stage A fix round against the orchestrator's dispositions, starting with the skill, the two-commit delta, and the governing consumer LLPs.The fix delta is large; I’ll load the current spec, the consumer LLPs, and the commission packet, then walk each finding against the actual text.Next I’ll read the amended sections in full and the Accepted consumer text they have to stay consistent with.I’ll verify citations against the live code and close remaining grammar holes (window-bound placement, identity, M7/M8).The fix round actually closed M1–M11, the bound-observation ruling, and the listed MINOR items. Two new Stage B-blocking holes remain: window bounds/ledger keys still do not match the per-node identity split, and the physical examined/scan formula is not a unique function of plan shape.

## 1. Per-finding dispositions

**M1 — FIXED** (§2.1 `GraphNodeWindowIdentityV1` / `GraphInstancePreimageV1` ~513–541; §2.4 ~777–798). Instance identity is `plan × argsDigest × windows[]`, with exactly one `nodeId`-keyed entry for the root and every `page:{kind:"demand"}` child, and one `parentKey` interval per evaluated parent (root `parentKey: null`). Literal pages contribute nothing.

**M2 — FIXED** (§2.4 ~800–809). `priorLedger` is gone from `GraphWindowIdentityV1`; `QueryCostWindowLedgerV1` is beside-cursor, not hashed; the text assigns one independent lineage per demand-paged node (root charges all six counters; child lineages keep `rootRows` at 0). Remaining binding-key gap is a new finding below, not an unfixed M2.

**M3 — FIXED** (§2.1 ~596–605). Compiler ids are emit-then-recurse preorder DFS, children sorted by RFC 8785 UTF-16 `edgeName`, projection last; the three-node walk is pinned as `$root → n0`, `comments → n1`, `$result → n2`.

**M4 — FIXED** (§3.3 ~1144–1153; refusal 10 ~691; §4.2 ~1444–1446). `baseNodeIds` is host-recomputed as every §4.2 input (bytes, membership, order, length, existence, completeness, refusal, future delta). Authored mismatch is `SNAPBACK_GRAPH_IDENTITY_MISMATCH`; unreachable is `PARENT_INVALID`; reachable inert is `NODE_INERT`.

**M5 — FIXED** (§3.3 G0-BCAST-BOUNDS ~1186; §2.6 ~963–987; `queryCost` ~487–498). Carrier is §2.6 declarations plus `GraphG0ExitObservationV1`. Hard group-state/frame/handoff fields are deferred to 0268 B1 via a 0267-owner amendment. `maxObservers` / `maxDistinctEvaluationGroups` / `maxEstimatedLiveFanoutMs` sit on whole-query `queryCost` as orthogonal live policy and are not the BCAST-BOUNDS carrier.

**M6 — FIXED** (§2.3 ~672–720). Admission ladder is 28 manifest-decidable reasons; the two corpus/derivation-dependent former admissions are qualification-only as `SNAPBACK_GRAPH_QUALIFICATION_DERIVATION_MISSING` and `SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH`, with no admission precedence.

**M7 — FIXED** (§5.1 ~1527–1636). To-one miss is closed (`found:false`, `childKey:null`, `rowVersion:null`; omitted join uses `lookupKey:null`). Plain `exists` is the `argumentId:null` / `argumentDigest` absent arm; `all` requires both.

**M8 — FIXED** (single `ts` block ~166–569; matcher ~873–879). The listed types are in one block, including `GraphNodeV1`, projection object, interval ends, `scopeBindings`, `membershipIdentity`, `providerCompletenessClass`, `GraphInstanceIdentityV1`, demand vs literal page, and `GraphQueryCarrierV1` as `{GraphQuery:{normalizedPlan,planHash}}`. Stage B matcher is fail-closed `ConservativeFallback` / not-executed, no plan inspection.

**M9 — FIXED** (§3.4 ~1187–1364; mapping table ~1174–1186). Seven closed kinds (`pairedWorld`, `allowDeny`, `audienceParity`, `scopeMismatch`, `authorityTransition`, `mixedCommit`, `refusal`) exist, and every 0268 §7 label maps to a required kind set. Projection-versus-storage-column is a required G0-BCAST-CORPUS pass row (via `pairedWorld` / projection falsifiers), not a missing eighth kind.

**M10 — FIXED** (§9 Stage B oracle contract ~1891–1941). Per-query `GraphOracleFieldMapV1` compares declared graph rows/order/labels/continuation to oracle fields; envelope fields must appear once as mapped or excluded; `examined` / `total` / `searchEpoch` have reasons; continuation is same-next-page rows, never opaque cursor bytes.

**M11 — FIXED** (§2.4 ~811–831; §3.3 G0-BCAST-IDENTITY ~1184; §6 ~1716–1718). Outer `GraphMaterializationIdentityV1` follows the 0157 app/database/target/activation/function wrapper; broadcast/cross-process keys consume the outer hash; byte-equivalence is only inside one materialization context.

**RULED — FIXED** (§2.6 ~896–922; §9 ~1943–1947, ~1972–1976). Logical fields are fixture/oracle maxima × `H`; physical fields (`maxExaminedEntriesPerExecution`, `maxRelationshipLookupsPerExecution`, `maxWindowScannedRows`, `maxWindowIndexRanges`, `queryCost.maxScannedRows`) are analytical plan-shape declarations marked **[G2 measures]**; 0267 observed-value consumption for graphs starts at G2. Conflict with 0267’s “G0 must populate every applicable entry” is recorded as owner-side drift, not silently edited.

**MINOR — FIXED.** Large-fixture means are **2.00** labels and **2.53** comments per issue, and declarations use maxima not means (~989–993). `queryCost.maxScannedRows` is the checked sum of per-node examined bounds and is not duplicated inside `GraphQueryCostV1` (~916–919, ~941). OQ-1 is resolved (~2114–2119). Cited line numbers I checked against current files (HandlerPlan :9724, family arms :9754, matcher :254/:270/:289, KeysetAfter :8004, define constructors, schema :2072/:2111, Zerobugs oracles, fixtures) resolve to the named symbols.

## 2. New MATERIAL findings

**N1. Demand-paged window bounds and ledger keys are still singular after the per-node identity split.**  
§2.4 (~803–808) gives each demand-paged node its own ledger lineage, and §2.6’s table (~949–954) says `maxWindowPages` / `maxWindowScannedRows` / `maxWindowResultRows` / `maxWindowResultBytes` / `maxWindowIndexRanges` are declared **per demand-paged node**. The wire type does not: `GraphQueryCostV1` (~379–395) has one graph-level tuple, and `GraphNodeCostV1` (~370–377) has no window fields. `issueDetail` is exactly this shape (root demand page + demand-paged comments) with different page budgets. Independently, ledger authentication (~800–803) still binds `QueryCostWindowLedgerV1` to `GraphWindowIdentityV1` (order/direction/ends/`take` only), which has neither `nodeId` nor the per-parent interval vector, so two lineages in one plan are not distinct keys. 0267 §5’s singular window wording is noted as drift; 0209’s own type and binding are still the implementable contradiction.  
**Fix:** Put the six window fields on each demand-paged `GraphNodeCostV1` (keep a graph rollup only if 0267 still needs one, with an explicit sum/max rule). Bind each ledger to `(generation, planHash, argsDigest, partition, target, nodeId, canonical per-parent interval vector)`.

**N2. Physical examined/scan/range declarations are not a unique function of plan shape.**  
§2.6 (~912–922) says the host bounds a node’s examined entries by “maximum consultations × **index-bounded entries per consultation**,” then checked-sums into `queryCost.maxScannedRows` and multiplies into `maxWindowScannedRows` / `maxWindowIndexRanges`. Unique point lookups are 1; a filtered keyset/`bounded-to-many` range is not. Those numbers are plan-hash inputs (§2.4 ~741–743). Two Stage B implementations can emit different hashes for the same Zerobugs graph, or refuse the corpus as underivable. G2 measurement does not remove the G0 declaration.  
**Fix:** Pin the closed analytical function, e.g. unique/point → 1; root → `maxRootRowsPerPage`; to-many/semi-join → `maxChildrenPerParent` (or `take` for a demand page); consultations = checked product of ancestor take/fanout/argument expansion; refuse any node whose index prefix cannot support that cap.

## 3. MINOR (worth fixing before landing)

- **`broadcast: GraphBroadcastAdmissionV1 | null` is hashed with no inhabitant rule** (~501, ~743). `null` and `classification:"query-shaped"` are different plan bytes. Require the tagged record on every plan, or define the exact `null` case (e.g. finite-only `Query`).
- **`GraphWindowIdentityV1.order`** (~513–518) is demand-hashed, but §2.2 says demand supplies only take/direction/ends. State that `window.order` is copied from the node and must exact-match, or drop it from the vector.
- **`allowDeny.expect`** (~1258–1259) has no allowed result bytes, despite the pass table saying the allowed principal “receives the expected result.”
- **`queryCost.maxResultBytes` vs `queryCost.graph.maxResultBytes`** (~487–498 vs ~386). Require equality or delete one; 0267 §5 already checks one whole-result maximum plus `maxPageResultBytes`.
- **`KeysetAfter` is only defined in `crates/snapback-kernel/src/storage.rs:8004`**, while G0 IR is specified to land in `snapback-types` with no look-alikes. Point Stage B at a types-crate move/re-export.
- **`JoinEquality.rootField` / `joinedField`** reused on parent and through edges: say upstream = `rootField`, downstream = `joinedField` so through-table `parentJoin` / `targetJoin` is not guessed.

## 4. Is §2.1 closed enough for Rust + JSON Schema?

Almost for the plan AST: the node union, projection, pages, identities, broadcast certificate, and `HandlerPlan::GraphQuery` payload are copyable without inventing arms, and `?` vs `| null` vs `| never` is stated. Remaining design decisions are: N1 (where window bounds live and what a ledger binds); N2 (the physical-bound function); `broadcast: null` vs `query-shaped`; whether `window.order` is demand-authored; `KeysetAfter`’s crate home; and how 0267 §2.1’s `keyset`/`notPageable` plus allowed-index identities compose with this nested `queryCost` (graphs already carry `accessIndex` and pages). None of those can be filled in by “just following the `ts` block.”

VERDICT: NOT READY (2 MATERIAL)

## r3 — eb6f296e2 fix round 2

I'll review the round-2 delta against the listed dispositions, then check the full spec and the Accepted consumers for remaining implementability holes.The branch is three commits ahead; I'll take the round-2 delta as `HEAD~1..HEAD` and load the spec plus the Accepted consumer docs next.The round-2 diff is large; I’ll read the full spec, the commission packet, and the Accepted consumer sections next.I'll read the spec sections the round-2 findings touch, plus 0267 §5 and 0268 §0/§1/§7.Next I’ll read the corpus, completeness, and oracle sections, then check the cited wire types against the current code.I’ll check the oracle handlers and cited types so the translation table and remaining grammar holes can be judged against real code.Round-2 closed the required registers, projection scope, invocation record, packet posture, and per-node windows. Two corpus/oracle encoding holes and a physical-bound example that contradicts its own function keep Stage B from implementing without new design decisions.

## 1. Per finding

**R1 — FIXED** (`llp/0209-live-graph-profile.spec.md` §2.3, 738–807; §4.2, 1665–1668). Admission is a 29-row ladder decidable from manifest/schema/policy only (no args/cursor/partition/materialization). Demand-time is a separate 4-row ladder with its own ids, including `SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH` versus admission `SNAPBACK_GRAPH_PLAN_IDENTITY_MISMATCH`. Qualification has stable ids and no ladder precedence. §4.2 takes `primaryReason` from the admission or demand-time register and states that qualification failures never become a result label.

**R2 — FIXED** (§2.1, 250–271 and 597–653; §2.3 row 18). Every `GraphProjectionObjectV1` has `scopeNodeId`. `field` is the scope node or a unique-root-path ancestor; to-one/principal fields are the nested-`object` exception from the parent scope (`null` on optional miss). To-many rows require `array` with matching `item.scopeNodeId`; `exists-semi-join` is `exists` only. Sibling/unarrayed descendant/cross-cardinality refuse `SNAPBACK_GRAPH_PROJECTION_SCOPE_INVALID`. `fields` array order is emitted-key order and is plan-hashed; the issue → labels → label example is executable.

**R3 — FIXED-BUT-INTRODUCED evaluation-time `refused` has no corpus case** (§3.4, 1346–1355, 1504–1554, 1578–1583). `GraphCorpusInvocationV1` is the reusable closed invocation (planHash, args, windows, full materialization preimage, partition, authorizationVersion, cut) and appears on every executable kind, with two records where principals/instances compare. `refusal` is a three-phase discriminated trigger with no materialization. `nodeCompleteness: NodeCompletenessV1[]` plus `graphCompleteness` replace a single tuple. The new rule that executable results may not use `refused` and that `GraphRefusalCaseV1` reasons are limited to the §2.3 registers makes the R4/§4/0267 cost-bound outcomes unrepresentable (new MATERIAL 1).

**R4 — FIXED-BUT-INTRODUCED comments `(incomplete, null)` is not a function** (§9, 2113–2212). `GraphOracleLabelTranslationV1[]` is a closed included/excluded union over `complete|incomplete|refreshing|not-found-authoritative` × reason; unlisted pairs fail with `SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH`. Outer `status`/`reason` for `issueListV2`, `issueDetail`, and `listIssueByID` are all dispositioned against the live oracle. The comments row maps one pair to both `window` and cost-bound `refused` with no discriminator in the type (new MATERIAL 2).

**R5 — FIXED** (`issues/20260823-llp0209-g0-commission.md` 52–59, 62–63, 111–115, 140–165, 294–299). Packet now states three-layer identity, paired-world falsification at qualification not admission, exactly one fail-closed `GraphQuery` matcher arm, logical fixture/oracle vs analytical physical `[G2 measures]`, and 2.53 comments / 2.00 labels as contextual means with declarations from maxima.

**R6 — FIXED** (§2.1, 379–403; §2.4, 890–900; §2.6, 987–994). Each demand-paged node, including the root, carries the six `maxWindow*` fields; non-pageable nodes omit them. `windowRollup` is the host-derived checked sum of those six across lineages, not an independent ceiling. Each ledger authenticates against `(generation, planHash, argsDigest, partition, target, nodeId, canonical per-parent interval vector)`.

**R7 — PARTIAL** (§2.3 row 16; §2.6, 1014–1063). The access-shape table, consultations product, `examined = consultations × entries`, `lookups = consultations`, `maxScannedRows` as checked sum, window = `maxWindowPages ×` per-page, and `SNAPBACK_GRAPH_INDEX_PREFIX_UNSUPPORTED` are implementable and unique for plan-hashed range rows (`maxChildrenPerParent` only; demand `take` is request-time). The required numeric `issueDetail` example then puts corpus `take = 50` into plan-hashed `queryCost.maxScannedRows = 89` and the window rollup, which the same section forbids. Stage B cannot tell whether comments’ declared entries-per-consultation is 50, a fixture maximum, or some other page cap.

**RULED — FIXED** (§2.6, 996–998; §9, 2226–2254, 2367–2371). The split is “Ruled 2026-08-23 under `issues/20260823-llp0209-g0-commission.md`”, ratified at v0.6, with a 0267 §5 amendment on the drift list. Exit text is “ratification” only; the “or override” phrasing is gone from the split.

**MINOR (round-2 list) — FIXED.** `broadcast: GraphBroadcastAdmissionV1` is required (511); `GraphWindowIdentityV1.order` is copied from the node and exact-matched (523–525, 886–888); `allowDeny.expect.allowed` is `GraphCorpusExpectedResultV1` (1424–1428); sole whole-result byte check is `queryCost.maxResultBytes` (974–976, 1088); `KeysetAfter`/`KeysetKeyV1` move to `snapback-types` byte-identical (705–708), and `KeysetAfter` still lives at `crates/snapback-kernel/src/storage.rs:8004`; `JoinEquality.rootField` is upstream / `joinedField` downstream (733–736), matching `crates/snapback-types/src/contract_types.rs:1897`; `Sha256V1` pattern is `^sha256:[0-9a-f]{64}$` (167, 588–590); two-sibling DFS is `$root → n0`, `comments → n1`, `labels → n2`, `$result → n3` (655–665); history/packet use **2.00** / **2.53**, not 1.5 (1132–1134, 2493–2496).

## 2. New MATERIAL findings

**M1. Evaluation-time `refused` cannot be a corpus case, but it is the graph result.**  
Evidence: §4 still produces `refused` at a `(materialization, partition, version)` tuple and explicitly imports `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` (1665–1670). R4 maps list/detail child-bound, label-membership-bound, issue-read-model-bound, labels/emoji `incomplete,null`, and comments null-cursor overflow to that label. R3 then says an executable result may not use `refused` (1551–1554), only `GraphRefusalCaseV1` carries a reason, that case never mints a materialization (1539–1545), and “each reason is limited to that §2.3 register” (1578). `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` is in neither graph register.  
Fix: Either allow `GraphCorpusExpectedResultV1` to carry `refused` + imported 0267 codes at a real materialization, or add an evaluation-time register that includes those codes and a corpus trigger that still records the outer identity. Do not fold cost-bound overflow into admission or into qualification-mismatch.

**M2. `commentsCompleteness: incomplete, null` is two graph dispositions with one translation key.**  
Evidence: The oracle returns `{status:'incomplete', cursor:null, items:[]}` on the 1,024-row collection ceiling and `{status:'incomplete', cursor}` on a real next page (`demos/zerobugs/control/snapback/functions.mjs` 2941–2952). The table (2199) maps that one `(status, reason)` to `window` when `commentsCursor` is non-null and to cost-bound `refused` when it is null. `GraphOracleLabelTranslationV1` (2113–2128) has no cursor/`when` field. The follow-on rule (2208–2212) treats a window without continuation proof as `SNAPBACK_GRAPH_QUALIFICATION_CORPUS_MISMATCH`, which would reject the valid 1,024-bound oracle row instead of accepting `refused`.  
Fix: Put a closed discriminator on the translation record (for example `cursor: "non-null-proved" | "null"`) and serialize two entries; do not use corpus-mismatch as a stand-in for cost-bound refusal.

Do not re-count R7’s `take=50` example here; it is the R7 PARTIAL.

## 3. MINOR (worth fixing before landing)

- Packet heading still says OQ-1 is “applied unless overridden” (`issues/20260823-llp0209-g0-commission.md:181`); item 7 still calls windows a graph-level “summed-window tuple” and lists `maxResultBytes` as a `queryCost.graph` field (87–94).
- §4.1 `proof` is `CanonicalClientValueV1` with only prose members; `existenceBits` has no index rule. Freeze both as closed records before Stage B writes corpus bytes.
- Nested `kind:"object"` is specified for to-one/principal children; a same-scope grouping object or a bare `field` of a to-one outside that wrapper should be an explicit `SNAPBACK_GRAPH_PROJECTION_SCOPE_INVALID` miss, not an implication.
- `queryCost.maxIndexRanges` is “derived analytically” with no unique function, unlike `maxScannedRows`.
- `FilterExpr.value` is shipped `ValueExpr` (`crates/snapback-types/src/manifest/types.rs:10469`), whose `Arg(String)` path is not tied to `argumentId` `a0`… . Say whether graph filters bind by argument `name` or rewritten id.
- `windowRollup.maxWindowResultBytes` as a sum of whole-result lineage maxima over-counts a single publication that advances more than one demand-paged node; state that the rollup is a conservative ceiling, or charge nested bytes per lineage.

## 4. Is §2.1 closed enough?

The plan/identity grammar in §2.1 is close: tagged node kinds, required `broadcast`, lexical projection scope, JCS domains, `Sha256V1` pattern, demand vs literal pages, and reused `JoinEquality` / `FilterExpr` / `OrderExpr` / `TableVisibilityV1` / `KeysetAfter` with a Stage B move. Rust + JSON Schema can follow the records without inventing arms. Remaining design choices are not new tagged unions; they are binding rules the TS does not encode: kind-conditional `GraphNodeCostV1` presence (§2.2 table), `ValueExpr.Arg` vs `argumentId`, and the demand request envelope (only identity types exist; Stage B corpus uses §3.4 `GraphCorpusInvocationV1`). Completeness `proof` and oracle translation discriminators sit outside §2.1 and are the actual Stage B blockers.

VERDICT: NOT READY (3 MATERIAL)

## r4 — 63cc68b89 fix round 3

I'll review fix round 3 against the listed dispositions: first the round-3 delta, then the current spec, then the Accepted consumers and commission packet.The round-3 commit is large (~700 lines). Next I’ll pull the delta and the consumer sections in parallel.The spec is ~2,900 lines; I’ll read it in chunks and pull the consumer sections next.I’ll check the oracle’s actual completeness/cursor behavior and a few cited types so F3 and the wire-grammar holes can be judged against the code.`KeysetAfter.entries` looks like field/value pairs, not the spec’s value array — I’ll confirm the actual JSON and the comments-ceiling oracle path.Fix round 3 landed the requested carriers (proof unions, evaluation-time register, oracle `when`, partition proof type, query-shaped vs counterfeit split). Three of those closures are still not uniquely implementable, and two of them contradict cited code / LLP 0267.

## 1. Disposed findings

**F1 — `FIXED`.** §2.1 `GraphNodeCompletenessEvidenceV1` (348–455) is a closed `(kind,label)` union; §3.4/§4.1 (1961–1966, 2084) bind `existenceBits[i]` to `childNodeIds[i]` with equal lengths and preorder ids; `GraphCompositionProofV1` (468–494) plus §4.2 (2121–2126) cite every non-projection node by `(nodeId,nodeKind,label,proofHash)` with a named hash domain.

**F2 — `FIXED`.** §2.3 (1092–1126) adds a fourth evaluation-time register (0267 hard codes plus storage/authority fences) that fires only after a real `GraphMaterializationIdentityV1`; `GraphCorpusExpectedResultV1` refused (1771–1783, 1975–1985) carries only demand- or evaluation-time reasons at a materialization; `GraphRefusalCaseV1` (1895–1956) stays non-materializing (admission / demand-time / qualification only); §4.2 (2108–2109) forbids qualification as `refused`; §3.3 (1654–1699) plus `GraphQueryShapedReasonV1` (521–527) split counterfeit authored `classification:"broadcast"` (rows 23–26) from successful `query-shaped` with a closed reason, matching 0268 §1.2’s “if unproved, the answer is query-shaped.”

**F3 — `FIXED`.** `GraphOracleLabelTranslationV1.when:{cursor,rows}` (2559–2586) is closed; every table row is discriminated (2661–2683); `issueDetail` `commentsCompleteness` `(incomplete,null)` + `cursor:null` + `rows:empty` maps to evaluation-time `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` and is forbidden as corpus-mismatch (2676, 2690–2692). That matches the oracle (`functions.mjs:2941–2942` returns `{items:[], status:'incomplete', cursor:null}` at the 1,024-comment ceiling).

**F4 — `FIXED-BUT-INTRODUCED` the through-edge examined product.** Plan-hashed fields use declared maxima; the `issueDetail` example is redone with `C_comments` not `take=50`; request-time `50 <= C_comments` is separate (1404–1428); principal-binding is two points and through targets are listed (1365–1387); per-kind rows exist (1359–1369). The closed function then says to multiply the table’s already-per-parent `maxChildrenPerParent + maxChildrenPerParent` examined cell by `P(node)` *and* additionally multiply the through target-point term by `maxChildrenPerParent` (1380–1382), so ThroughEdgeV1 `maxExaminedEntriesPerExecution` is not unique.

**F5 — `FIXED`.** `GraphPartitionEquivalenceProofV1` is a closed record (496–512); `GraphNodeAuthorityV1` places it exactly on class 2 and `null` on 1/3 (514–519, 868–874); it is plan content and hashed (1151–1152); mismatch refuses `SNAPBACK_GRAPH_AUTHORITY_UNPROVABLE` (1559–1568).

**F6 — `FIXED`.** Closed `oracleDivergence:"direction-tie-break"` (1785, 2640–2654); expected order is graph/LLP 0007 (ascending `_id`); oracle comparison is after ascending-`_id` tie normalization; corpus + v0.6 exit note; control is not edited (2880–2885).

**F7 — `FIXED`.** Admission row 1 is manifest-decidable from argument-routing and “does not inspect a runtime value” (1048); qualification has no precedence and reports the complete set in stable id order (1110–1116, 2009).

**RULINGS — `PARTIAL`.** Argument-id rewrite + `SNAPBACK_GRAPH_ARGUMENT_UNBOUND` (958–968, 1077); `windowRollup.maxWindowResultBytes` as conservative checked sum (1315–1317); kind-conditional `GraphNodeCostV1` presence table (1319–1330); explicit projection-scope rows for bare to-one field and same-scope grouping object (894–898, 1065) are all implementable. Failures: `KeysetKeyV1` is in `snapback-types` and `KeysetAfter` is not moved (172–178, 1002–1005), but the JSON is **not** kernel-identical (see M1); `maxIndexRanges` is a closed function (1390–1393) but it zeros every point consultation, which 0267 will observe (see M2).

**MINOR (round-3 list) — `FIXED`.** Packet OQ-1 heading is a resolved ruling; item 4 uses materialization identity; item 7 lists per-node `maxWindow*` + `windowRollup`; `maxResultBytes` is only `queryCost.maxResultBytes`; revision history has a fix-round-3 bullet (2969–2975).

## 2. New MATERIAL

**M1. `KeysetKeyV1` is not wire-identical to kernel `KeysetAfter`.**  
§2.1 (172–178) defines `entries: CanonicalClientValueV1[]`. Kernel `KeysetAfter` (`crates/snapback-kernel/src/storage.rs:8004–8007`) and the generated schema (`schemas/migration.journal-entry.schema.json` `KeysetAfter`) serialize `entries` as `Vec<(String, Value)>` → `[[field, value], ...]`. Stage B following the TS grammar and Stage B following “byte-identical JSON” produce different plan/cursor bytes; `From`/`Into` cannot make both JSON spellings true.  
**Fix:** Make `KeysetKeyV1.entries` the same `(field, value)` array as `KeysetAfter`, keep the kernel type unmoved, and drop the values-only spelling (or stop claiming byte-identity and define an explicit, hashed encoding).

**M2. `queryCost.maxIndexRanges` zeros point consultations; LLP 0267 counts them.**  
0209 (1362–1368, 1390–1393, 1417) assigns index-ranges `0` to every to-one, principal, search, and through-target point and hashes `issueDetail` `maxIndexRanges = 3`. 0267 §1.1 sets `indexRangeCount == accessPathConsultations.length` with `selectedPath.kind` including `"point" | "unique" | "boundedIndex"`; §5 says a relationship lookup’s storage consultation “separately contributes to `indexRangeCount`.” G2 observations will exceed the G0 declaration (`issueList` with 1,024 roots × to-ones far more so), and 0209 says those observations must fit the declaration (1401–1402). This is not on the 0267 drift list.  
**Fix:** Count every 0267 access-path consultation (point/unique/boundedIndex/fullScan) as one toward `maxIndexRanges` / `maxWindowIndexRanges`, redo the worked example, and if that breaches 0267’s instance absolute of 512, record an explicit 0267-owner amendment rather than silently redefining the counter.

**M3. Through-edge examined-entry function is two functions.**  
The consultation table (1365) already gives per-parent-row examined `maxChildrenPerParent + maxChildrenPerParent` (range + one point per admitted through row). The next paragraph (1380–1382) multiplies “entry and range terms” by `P(node)` and then multiplies the through target-point term by `maxChildrenPerParent` again. That is `P·2C` vs `P·(C + C²)` (or `P·C²` if someone treats the whole cell as the target term). The lookup-count sentence (1385–1387) matches the table, not the extra product.  
**Fix:** Delete the extra multiply. Per parent: one through range (`C` entries, 1 index range) plus `C` target points (`C` entries; ranges depend on M2). Then × `P(node)` only.

## 3. MINOR (worth fixing before landing)

- **Root `prefix` continuation is `KeysetKeyV1 | null` in §2.1 (365) but §4.1 requires non-null.** Tighten the prefix arm to a mandatory continuation so the schema cannot accept a zero-progress prefix.
- **`GraphCorpusExpectedResultV1.existenceBits` (1766) has no index**, unlike the per-proof vector. Specify it as the concatenation of every `exists-semi-join` proof’s `roots[].existenceBits` in canonical node order then parent-key order, or drop the top-level field and compare only proofs.
- **Worked `issueDetail` lists `maxRelationshipLookupsPerExecution = 25` next to whole-query fields (1415–1417).** That name is per-node in `GraphNodeCostV1`; call it a slice sum or show the per-node vector.
- **`partitionFunction` has no hash domain (509–510, 868–871).** Name one (`snapback:graph-partition-function:v1:` or equivalent) so two hosts cannot both be “correct.”
- **`GraphCorpusGraphCompletenessV1.proofClass` is not derived from the composed label** the way §4.1 derives node `proofClass`. Bind `unknown→none`, `refused→refusal`, `complete→all-complete`, `prefix→composed-prefix`, `window→composed-window`.
- **Exists complete proofs carry `childNodeIds` on a leaf node (426–430).** Require `childNodeIds === [this.nodeId]` (one bit per root), or the vector is an extra degree of freedom.

## 4. Is §2.1 closed enough for Rust + JSON Schema?

No. A Stage B pair of Rust types and a generated JSON Schema can follow §2.1 for nodes, projection, refusal registers, identities, broadcast admission, partition proofs, and completeness *evidence shapes*, but they still have to decide (a) whether cursor/interval JSON is `CanonicalClientValueV1[]` or `KeysetAfter`’s `[field, value][]`, (b) whether `maxIndexRanges` is 0209’s range-only counter or 0267’s access-path count, and (c) which ThroughEdgeV1 examined product is the plan-hash input. Those are semantic, not naming. Remaining holes that are mechanical (prefix `continuation` nullability, partition-function domain string, top-level `existenceBits` flatten order, graph `proofClass` mapping) can wait for Stage B only if M1–M3 are closed first.

VERDICT: NOT READY (3 MATERIAL)

## r5 — 12dbe6e7d fix round 4

I'll review the round-4 delta against the G1–G8 dispositions, then check the complete spec against 0267/0268 and the commission packet. Starting with the diff, the current text, and the Accepted consumers.The round-4 delta is large; I’ll read the spec sections that map to G1–G8 and the Accepted consumer docs in parallel.Next I’ll read §2.6 and the refusal/broadcast/corpus sections, plus the 0267 consultation definition and the keyset schema they cite.Round-4 landed the G1–G8 dispositions as implementable rules, except G5’s new `parentKey: KeysetKeyV1` (no unique construction). Checked against LLP 0267 §5, LLP 0268 §0/§1/§7, and LLP 0183 §D2: no consumer contradiction besides the already-recorded 0267 512-vs-1025 drift.

## 1. Per finding

**G1 FIXED.** `KeysetKeyV1.entries` is `readonly (readonly [string, CanonicalClientValueV1])[]` (§2.1:176–179), documented as kernel `KeysetAfter` (`storage.rs:8004–8007`) with JSON `[field, value]`, Schema `prefixItems` + `minItems:2,maxItems:2` (§2.1:980–988), field order = declared `order` then separate `id` = `_id`, and Stage B must pin positive/negative kernel round-trip vectors (§9 row 2:2922).

**G2 FIXED.** Step 4 charges every `point`/`unique`/`boundedIndex`/`fullScan`/opaque consultation as one `queryCost.maxIndexRanges` unit with `indexRangeCount == accessPathConsultations.length` (§2.6:1511–1515); `maxWindowIndexRanges = maxWindowPages ×` that lineage’s per-page consultation max (1517–1524). `issueDetail` is re-derived from those steps (1545–1563: scanned `43 + C_comments`, lookups vector summing to 25, `maxIndexRanges = 26`). The 1,024-root / 1,025-consultation clash with 0267’s 512 absolute is recorded as an owner amendment with the corpus row as evidence, without redefining points out of the counter (1576–1582, drift list 3062–3068).

**G3 FIXED.** One through-edge function: per parent, per probe, 1 edge range + `C` target points, times `P` (and `Q` probes for `all`) only (§2.6:1493–1494, 1526–1537). Formulas are `P×Q×((C+1)+C)` examined, `P×Q×(1+C)` lookups, `P×Q×(1+C)` ranges; the extra `C` multiply is gone; `C+1` is the G4 lookahead on the range.

**G4 FIXED.** One four-step function: `P(root) = maxArgumentExpansion` else 1; non-root `P` is root take × path fanout × distinct multiplicative args; consultations-per-parent by kind; entries = 1 for points, `cap+1` for ranges citing `engine.rs:37942–37962`; then examined/lookups/ranges/window products (§2.6:1476–1524). The worked example is those steps, including request-local `take=50` tightening to 51 examined without changing the plan hash (1545–1574).

**G5 FIXED-BUT-INTRODUCED parentKey identity is not uniquely constructible.** Disposition items landed: per-parent `rows`/`ranges` for to-one/principal/to-many (§2.1:444–488); nested semi-joins are `{parentKey, existenceBit}` on the immediate parent with no `childNodeIds` and no flat `existenceBits` (§2.1:489–496, §3.4:2138–2144, §4.1:2271); every `(kind,label)` is its own arm, including split projection/composition prefix vs window (518–586). New problem: to-one/exists/principal `parentKey` is `KeysetKeyV1` (447–502) while to-many proofs, the demand window vector, and captured reads use `GraphRowKeyV1` (455–482, 906–909, 2379–2436), and nothing says how to populate `KeysetKeyV1` for a parent with no `OrderExpr[]` (to-one/principal, which §2.2:1128 allows as parents).

**G6 FIXED.** `GraphCompletenessProofTupleV1` is `authorizationVersion: AuthorizationVersion` + `evaluationCut: GraphEvaluationCutV1` (§2.1:349–354); both axes are reused owner types, not `version: string` (990–997); the same pair is on corpus invocations (1897–1898) and on the §4 claim tuple (2236–2245).

**G7 FIXED.** `GraphMaterializedRefusalReasonV1` is demand ∪ evaluation only (§2.1:327–329). Materialized `refused` proofs/results/composition `primaryReason` use that union; admission codes live only on `GraphRefusalCaseV1` `phase:"admission"` (§2.3:1239–1244, §3.4:2071–2085, 2159–2166, §4.2:2292–2296).

**G8 FIXED.** `SNAPBACK_GRAPH_BROADCAST_BASE_CLASS_INVALID` is admission reason 23: authored `classification:"broadcast"` whose host `baseNodeIds` includes class 2 or 3 (§2.3:1185, union 298). §3.3 states it is not downgraded to `base-not-class-1` (1828–1832, 1857–1860) and the G0-BCAST-CLASS row cites row 23 (1864).

**MINOR FIXED.** Partition-function domain + JCS(`policyInputs`) preimage, no wrapper (601–603, 964–967); `GraphQueryShapedReasonV1` first-match = declaration order (1819–1822); `when.cursor`/`when.rows` bound to required dotted oracle fields (2831–2835); `sourceIssueID → issue._id` before tie normalization (2841–2848); root prefix `continuation: KeysetKeyV1` (not null) (412–420); per-node lookups vector in the example (1559–1562); node and graph `proofClass` derived, not authored (2154–2157, 2276–2283); round-4 history bullets (3189–3197).

## 2. New MATERIAL findings

**M1. Completeness `parentKey: KeysetKeyV1` has no unique construction, and it is a different parent identity than the rest of the IR.**

Round 4 replaced scalar/`GraphRowKeyV1` parent evidence with `KeysetKeyV1` on equality-to-one, exists-semi-join, and principal-bound complete arms (§2.1:447–502). `KeysetKeyV1` is specified only as a keyset boundary whose `entries` exact-match **that node’s** declared `order` fields (§2.1:985–987). Those three kinds have no `order`. §2.2 still allows a to-one parent of another to-one or of a principal node (1128). Three implementable encodings are all licensed by the text:

1. parent’s `OrderExpr[]` values plus `id` (fails when the parent has no order);
2. `{entries: [], id: parent._id}` (treat the proof node as the keyset node);
3. unique-join components as `entries`.

Windows and captured reads already identify the same parent as `GraphRowKeyV1 {table, id}` (§2.1:906–909, §5.1:2379–2436). Two Stage B corpora can both type-check and disagree byte-for-byte, and a to-one-of-to-one proof cannot be emitted from (1).

**Fix:** type every completeness `parentKey` as `GraphRowKeyV1` (same as the window vector and `GraphCapturedReadV1`), sort by RFC 8785 JCS of that record, and keep `KeysetKeyV1` for continuations and interval ends only. If a keyset identity is really required, spell the construction: immediate parent row; `entries` = that parent’s `order` field values or `[]` when the parent kind has no order; `id` = parent `_id`.

No other new MATERIAL. 0267 §5 is honored (consultations count in `indexRangeCount`; relationship lookups are not added again; 512 vs 1,025 is an owner amendment, not a silent redefinition). 0268 §1.1/§7 class-1-base + counterfeit-certificate split is G8. 0183 §D2 node kinds, exclusions, bound families, and label vocabulary still match; the 4-tuple is a tightening of D2’s single `version`.

## 3. MINOR (worth fixing before landing)

1. **`_id` in `OrderExpr[]` vs `KeysetKeyV1.entries`.** §2.2:1114–1116 appends ascending `_id` onto normalized `order`; kernel `KeysetAfter` keeps `_id` only in `id` and always adds `"_id" ASC` in SQL (`storage.rs:14423`). Pin whether graph `entries` include `_id` so the §9 round-trip vectors have one positive encoding.
2. **Principal-bound consultations.** Step 2 always charges two points (§2.6:1494–1495), including when `binding` is absent (§2.2:1131). Split binding vs no-binding, or say the extra point is principal resolution with no table.
3. **To-many `window.hasMore: boolean` vs root `hasMore: false`.** Root window proves named ends exhausted (§2.1:422–431, §4.1:2268). Child window allows `hasMore: true` with no continuation (§2.1:462–474). Say resume is via the demand vector, not a prefix continuation.
4. **DirectEdge exists as a 1-entry point** (§2.6:1491–1492). A non-unique “exists any child” parent prefix is a `boundedIndex` range, not a unique point; otherwise admission will `INDEX_PREFIX_UNSUPPORTED` a legal 0183 exists node. One sentence: LIMIT-1 exists is a point; non-unique parent-prefixed exists is a range with entry cap 1.
5. **`GraphEvaluationCutV1 = number`** (§2.1:347). Store version is `u64` (`storage.rs:9011`). JSON Schema should be a non-negative safe integer, not arbitrary `number`.
6. **§6 prose** still says “same version” / “evaluation cut version” (2573–2574) after G6 split the axes.

## 4. Wire grammar closure

§2.1 is closed enough for Stage B to emit Rust + JSON Schema for the plan carrier, node kinds, refusal unions, identities, and completeness **discriminators** without new product decisions: tagged arms, `proof: null` vs absent, `Sha256V1` spelling, reused owner types (`FilterExpr`, `AuthorizationVersion`, …), Serde `HandlerPlan::GraphQuery`, and `KeysetKeyV1` as a two-tuple array matching `KeysetAfter`. The remaining hole is not a missing field name; it is **how to populate `parentKey` on three complete-proof arms** (M1). Until that construction (or a `GraphRowKeyV1` retcon) is in the grammar, completeness JSON is not determined by the types alone. Secondary Schema-level choices (`evaluationCut` integer vs number; whether `_id` is inside `entries`) are mechanical once M1 and MINOR 1 are pinned.

VERDICT: NOT READY (1 MATERIAL)

## r6 — 55557e0fc fix round 5

I'll review the round-5 delta against the disposed H1–H5 findings and the Accepted consumers, starting with the spec, git range, and related LLPs.I'll pull the round-5 diff, commit history, and the consumer LLPs next so I can check each disposed finding against the actual text.Round 5 is the current HEAD; next I’ll pull the full delta and the governing sections of 0209, 0267, and 0268.The diff was truncated in the middle; I'll read the full log and the spec sections that H1–H5 actually change.I’ll now read the completeness types, the worked-example arithmetic, and the 0267/0268 consumer sections in full so I can test whether each H-item is actually implementable.The completeness unions and 0267 window wording look load-bearing; next I’ll check identity, the worked example, §5.1, and leftover `_id`/parentKey contradictions.Round 5 landed the disposed H1–H5 rules as implementable grammar and counting, not just mentions. Checking the Accepted consumers and the current §2.1 types, I do not see a new Stage B-blocking contradiction.

## 1. Per finding

**H1 — FIXED.** Every completeness `parentKey` is `GraphRowKeyV1` (`llp/0209-live-graph-profile.spec.md` equality-to-one / to-many `ranges` / exists / principal arms, ~448–507); §4.1 (~2312–2316) requires one entry per admitted parent, RFC 8785 JCS sort, and duplicate/missing keys to fail the proof; §2.1 (~992–993) limits `KeysetKeyV1` to continuation / interval-end boundaries (demand-vector `parentKey` is also `GraphRowKeyV1 | null`, ~910–913).

**H2 — FIXED.** `KeysetKeyV1.entries` is declared-order only and `_id` is forbidden in `entries` and normalized `order` (~176–180, 990–992); §2.2 states the single total-order rule as implicit ascending `_id` in `KeysetKeyV1.id` (~1123–1127) and row 17 refuses an authored `_id` (~1191); that rule is applied to window identity (~900–902, 1326–1340), both prefix arms (~2304, 2306), and Stage B keyset vectors (~2979).

**H3 — FIXED.** §2.4 (~1351–1357) and §2.6 step 4 (~1545–1556) charge each demand-paged page for the induced subtree (root lineage includes descendant consultations/results; a child lineage only its own subtree). The issueDetail one-page illustration is redone as `(43 + C_comments scanned, 26 ranges)` on the root lineage and `(C_comments + 1 scanned, 1 range)` on comments (~1588–1604), matching `2+1+1+1+17+16+(C+1)+2+2` and `1+25`.

**H4 — FIXED.** §2.6 step 2 (~1508–1522): direct `exists` is one `boundedIndex` `LIMIT 1` unless uniqueness is proved, `all` is `Q = maxItems` probes, principal-bound is one target point plus a binding point only when `binding` is present, null/omitted to-one keys do no storage consultation. Step 4 (~1536–1540) still charges those null keys as relationship lookups. §5.1 adds `parent-lookup-skipped` (~2421–2438, 2531–2536, 2544–2547) and matches exists/principal capture to that access model.

**H5 — FIXED.** §6 keys memos on `(GraphMaterializationIdentityV1, partition, authorizationVersion, evaluationCut)` (~2610–2620); materialization already includes `graphInstanceHash` (~943–952), so windows/args stay in the key; an `authorizationVersion` advance retires older entries even when partition and cut are unchanged (~2634–2636). History (~3259) records this as a description tightening of G1, not a change to the shipped session-exact opaque mechanism; §9 G1 still names that narrower pre-G0 key (~3039–3042).

**MINOR — FIXED.** `outerStatusReason` now has `oracleCursorField` / `oracleRowsField` (~2855–2862, 2886–2891); `GraphEvaluationCutV1` is JSON Schema `{type:"integer", minimum:0}` with a host safe-integer check (~347–350, 1000–1006); to-many `window` with `hasMore:true` resumes through the §2.4 demand vector (~2306); the commission packet completeness tuple is the four axes (`issues/20260823-llp0209-g0-commission.md` item 4); round-5 history bullets are present (~3255–3260).

## 2. New MATERIAL findings

None. Round 5 does not newly contradict LLP 0267 §5 (null-key lookups still count as relationship attempts and not as `indexRangeCount`; induced-subtree window charging is an extension already on the 0267 wording drift list), LLP 0268 §0/§1/§7 (the nine named inputs and class-1-base rule are unchanged), or LLP 0183 §D2 (finite IR, fixture-sized bounds, completeness vocabulary). Cited `KeysetAfter {entries,id}` (~8004–8007) still matches the H2 wire split.

## 3. MINOR (worth fixing before landing)

1. **§4.1 “JCS of that record” (~2314–2315).** Say `parentKey`, as §2.4 already does (~1323–1324). JCS of the whole `{parentKey, found|existenceBit|…}` object is not parent-key order (`found`/`bindingFound` sort first) and would fork proof hashes.
2. **§4.1 `window.hasMore` (~2306).** That field is not on the to-many window arm; `hasMore` lives on `ranges[]` (~468–477). Spell `ranges[].hasMore`.
3. **Principal `bindingFound` when `binding` is omitted (~501–507 vs 1517–1519).** The complete arm always carries `bindingFound`, but the cost model consults binding only when present. Pin the vacuous value (recommended: `true`) so Stage B does not hash both `true` and `false`.

## 4. Wire grammar closedness

Yes. A Stage B implementer can emit Rust + JSON Schema from §2.1 without a new product decision: node unions, `KeysetKeyV1` tuple-array + separate `id`, `GraphRowKeyV1` parents, interval ends, demand window vector, instance/materialization preimages, completeness `(kind,label)` evidence, evaluation-cut integer, captured-read `parent-point` vs `parent-lookup-skipped`, and oracle cursor/row bindings are all closed types plus named admission checks (`_id` out of `order`/`entries`, duplicate parents, kind-conditional cost fields). The only leftover ambiguity that would change bytes is the completeness-array sort key in MINOR 1; copy §2.4’s `parentKey` JCS rule and the grammar does not need another design pass.

VERDICT: READY

## r7 — 90f55302f fix round 6

I'll review the round-6 delta against the disposed findings, then check the complete spec and the Accepted consumers. First I'm loading the review skill and gathering the git/docs context.The branch is seven commits ahead of origin/main; I’ll pull the round-6 delta, the spec, the Accepted consumers, and the commission packet next.The delta is docs-only in the spec. Next I’ll read the changed sections against 0267/0268 so I can check each disposed finding as an implementable rule.I’ll read the spec’s wire grammar, charging rules, and completeness sections next, then compare them to 0267 §5 and 0268.I’ll pull the spec’s type grammar and charging sections, and look for the original J1/MINOR write-up so I can check the dispositions against the text.I’ll keep reading the rest of §2.1 and the charging/bounds text so I can test each disposition against implementable rules.I’ll verify the kernel `_id` tie-break and scan the spec for leftover charging or grammar contradictions.Checking a few leftover wording sites so I don’t miss a real contradiction with the new kernel/`bindingFound` rules.## 1. Per finding

**J1 — lineage result charging vs induced-subtree structural work: `FIXED`**  
§2.4 (lines 1352–1367) and §2.6 (1463–1467, 1560–1575, 1619–1633, table 1675–1678).

Every demand-paged lineage page charges the published graph’s top-level `resultRows` and the one `serde_json::to_vec` `resultBytes` to **its own** ledger; induced-subtree accounting is limited to `scannedRows`, `indexRanges`, and per-node consultations. A child page re-charges that whole result as a stated conservative ceiling, and the text forbids a child-sub-result carrier. The `issueDetail` illustration now has implementable numbers: root `(43 + C_comments scanned, 26 ranges, 1 result row, B_root)`, comments subtree `(C_comments + 1 scanned, 1 range, 1 result row, B_comments)`, `windowRollup` `2` pages / `1` root row / `44 + 2×C_comments` scanned / `2` result rows / `B_root + B_comments` / `27` ranges. That matches LLP 0267 §1.4/§5 (one whole-result serialization; do not sum nested-node serializations). The multi-lineage extension of 0267’s singular window wording is already on the drift list, not a silent fork.

**MINOR — completeness arrays sort by JCS of `parentKey` only: `FIXED`**  
§4.1 (2340–2344). Sort key is the JCS bytes of the `parentKey` record alone, not the whole proof element; duplicate/missing parent keys still fail.

**MINOR — `ranges[].hasMore` in §4.1: `FIXED`**  
§4.1 bounded-to-many row (2334) and the §2.1 window arm (465–477). The window proof uses `ranges[].hasMore:boolean`; a true value carries no continuation and resume is the §2.4 demand vector. The type has no top-level `window.hasMore`.

**MINOR — `bindingFound` literal `true` when `binding` is absent: `FIXED`**  
§2.1 principal-complete arm (505–506) plus §2.6 step 2 (1532–1534). The complete proof’s only legal encoding is `bindingFound: true` (vacuous); no binding consultation is charged. The field remains a required boolean, so JSON Schema stays `boolean` and the const-true rule is a plan-conditional validator check.

**MINOR — worst-case-arm vs zero-for-actual-null: `FIXED`**  
§2.6 (1504–1506) with step 2 (1523–1525) and step 4 (1551–1554). Declarations take the worst-case consultation arm; G2 observations charge zero **consultations** for a null/omitted key; relationship **lookups** still count the attempt.

**MINOR — kernel `_id ASC` wording: `FIXED`**  
§9 (2921–2924). The graph emits declared order without `_id`; the kernel appends `_id ASC` to SQL, including `direction:"backward"`; `KeysetKeyV1.id` only carries the boundary value. That matches `crates/snapback-kernel/src/storage.rs:14423` (`"_id" ASC`) and `:8072` (`"_id" > ?`).

**MINOR — round-6 history bullet: `FIXED`**  
Revision history (3290–3291). J1 + the MINOR pins are recorded; grok r6 READY / codex pending r7 is process state, not a rule.

---

## 2. New MATERIAL findings

None. The delta does not contradict 0267 §5’s single whole-result check (`queryCost.maxResultBytes` remains the sole whole-query byte check, §2.6:1443–1445), 0268 §0/§1/§7 (nine named carriers in §3.3 unchanged), or 0183 §D2’s bound/vocabulary charter. Child-lineage `rootRows = 0` with top-level `resultRows` re-charged is conservative and executable.

---

## 3. MINOR worth fixing before landing

**§2.2 still uses the pre-round-6 tie-break attribution** (1126–1128): “the kernel applies an implicit ascending `_id` tie-break, carried only in `KeysetKeyV1.id`.” §9 now says the kernel owns SQL `_id ASC` and `id` does not apply ordering. Align that one sentence with §9 so admission (`SNAPBACK_GRAPH_ORDER_NOT_TOTAL`) and the corpus contract do not disagree.

Optional polish, not blocking: §4.1’s principal-bound production row still says “binding resolution” without restating vacuous `bindingFound:true`; the rule already lives in §2.1/§2.6.

---

## 4. Wire grammar closedness

Yes. A Stage B implementer can emit Rust enums/structs and a JSON Schema mirror from §2.1 without inventing fields, arms, or identity domains. Discriminators (`kind`/`label`, node kind, broadcast classification, page `kind`) are unique; reused owner types stay unexpanded; `?` means absent-never-null; kind-conditional `GraphNodeCostV1` presence is the §2.6 table, not free optionals.

Remaining holes are mechanical, not semantic: JSON Schema `if/then` for kind-conditional cost fields; count fields as `{type:"integer",minimum:0}` from the prose integer rule; plan-conditional validators (`bindingFound === true` iff `binding` is omitted; completeness sort by `parentKey` JCS; proof-tuple equality). `QueryCostWindowLedgerV1` is 0267-owned (six counters) with 0209’s multi-lineage authentication key in §2.4, not a missing plan field. `GraphDirectionV1`’s after/before scan lives in §4.1; it does not block the schema.

VERDICT: READY
