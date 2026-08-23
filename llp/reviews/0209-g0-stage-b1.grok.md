# LLP 0209 G0 Stage B1 — grok review record

**Change:** graph IR types / identities / admission register / sibling HandlerPlan arm (landed on main as the series ending `73232029d`, 2026-08-23)
**Reviewer:** grok-4.6, xhigh (r5 targeted check at high), read-only, blind to the other family each round
**Orchestrator:** Claude Fable 5 (session snapback-44), under `issues/20260823-llp0209-g0-commission.md`
**Provenance:** every review below was actually received from the named model; verbatim text per round.

## Verdict ledger

| Round | Reviewed | Verdict |
| --- | --- | --- |
| r1 | B1 source (5fd3e38ae pre-rebase) | VERDICT: NOT READY (5 MATERIAL) |
| r2 | fix round 1 | VERDICT: READY |
| r3 | fix round 2 | VERDICT: READY |
| r4 | fix round 3 | VERDICT: READY |
| r5 | fix round 4 (targeted codex re-check of the sole open finding; grok READY since r3) | (not run — READY standing) |

## r1 — B1 source (5fd3e38ae pre-rebase)

I'll review LLP 0209 G0 Stage B1 against the spec: first the review skill, the contract, and the `HEAD~1` diff.The B1 commit is large; I'll pull the spec's normative sections and the authored Rust/test surfaces next.I’ll keep going through the spec’s identity, refusal, and Stage B sections, and start walking the Rust types and matcher arms.I’ll split the remaining work: spec §3/§5, the graph types/hashing/validation, and every `HandlerPlan` consumer.I’ll inspect validation, hashing, and the GraphQuery match sites next — the `base-not-class-1` wire spelling is a likely mismatch.Confirmed `base-not-class1` vs the spec’s `base-not-class-1`. I’ll check remaining wire spellings, parent-kind rules, demand-time identity, and HandlerPlan consumers.Checked `HEAD` is mechanical regeneration only. Findings below are against `5fd3e38ae` and `llp/0209-live-graph-profile.spec.md` v0.5.

## MATERIAL

### 1. Wire spelling of `GraphQueryShapedReasonV1` is `base-not-class1`, not `base-not-class-1`
- **File:** `crates/snapback-types/src/manifest/graph.rs:729` and generated `schemas/functions.manifest.schema.json:3621`
- **Claim:** Serde `rename_all = "kebab-case"` on `BaseNotClass1` emits `base-not-class1`. Spec §2.1 is `"base-not-class-1"` (`llp/0209-live-graph-profile.spec.md:619`; also §3.3:1878).
- **Evidence:** schema enum is `["base-not-class1", "separation-unprovable", ...]`. A spec-faithful plan with `"reason":"base-not-class-1"` will not deserialize; a B1 plan will hash/admit the wrong token.
- **Fix:** `#[serde(rename = "base-not-class-1")]` on `BaseNotClass1`, regenerate schemas, freeze a vector that round-trips the hyphenated spelling.

### 2. Query-shaped `reason` is authored, not host-selected
- **File:** `crates/snapback-types/src/manifest/graph.rs:2771` (normalize no-op) and `:3806–3811` (validate checks `format` only)
- **Claim:** §3.3: “When more than one query-shaped condition applies, the fixed precedence is exactly `GraphQueryShapedReasonV1` declaration order and the first match wins; the selected reason therefore enters the plan hash deterministically.” First token is `base-not-class-1`.
- **Evidence:** A principal-bound (class 3) graph with `"classification":"query-shaped","reason":"declared-query-shaped"` passes `validate_graph_query_plan_v1`. That condition is plan-local (declared classes); no owner artifact is required. Host reconstruction never rewrites `reason`, so it cannot produce `SNAPBACK_GRAPH_PLAN_IDENTITY_MISMATCH`.
- **Fix:** After node-class derivation, if any non-projection node is class 2 or 3, require `reason == BaseNotClass1` (or rewrite then exact-compare). Leave separation/scope/audience/invalidation to B2 owner proofs.

### 3. Argument rewrite map keys both names and authored ids; a name that equals another id corrupts filters
- **File:** `crates/snapback-types/src/manifest/graph.rs:2546–2552` and `:2400–2410`
- **Claim:** §2.1: compiler assigns `a0, a1, …` after UTF-16 name sort and rewrites filter args to those ids. Dual-insert of `argument_id` and `name` into one map is not injective.
- **Evidence:** Canonical plan, names `"A"` → `a0` and `"a0"` → `a1`. Map becomes `a0→a0`, `"A"→a0`, then second insert `"a0"→a1` overwrites the first id. `ValueExpr::Arg("a0")` (first argument) rewrites to `a1`. `normalized != *plan` → false `SNAPBACK_GRAPH_PLAN_IDENTITY_MISMATCH` on a legal plan. The same map, used as a first-pass compiler, can also bind the wrong argument.
- **Fix:** Rewrite only authored names, or only authored ids, and refuse `SNAPBACK_GRAPH_UNKNOWN_FIELD` / `ARGUMENT_UNBOUND` on name/id cross-collisions. Never share one map.

### 4. Root `accessIndex` prefix is the JCS-sorted filter field order, not the index component order
- **File:** `crates/snapback-engine/src/local/engine.rs:33979–33984` with `starts_with` at `:33927`
- **Claim:** §2.3 row 16 / §2.6 step 3: the index equality/range prefix is the declared index order. Filter conjunctions are JCS-sorted only as a plan-hash canonicalization (§2.4 item 2), which is a different order.
- **Evidence:** Index `(status, assigneeId)`, two equality filters. After JCS sort of `FilterExpr` objects, `assigneeId` can precede `status`. Engine then requires `declared.fields.starts_with(["assigneeId","status", …order])` and refuses `SNAPBACK_GRAPH_INDEX_PREFIX_UNSUPPORTED` on a valid index. Join-prefix checks for to-one/to-many correctly keep `joinOn` order; only the root path uses sorted filter fields.
- **Fix:** Prove the index prefix in declared index order: equality/range fields must be an index prefix; filter fields must be a subset of that prefix. Do not use JCS filter order as the prefix vector.

### 5. `classification:"broadcast"` is admitted without the host proofs in §2.3 rows 24–26
- **File:** `crates/snapback-types/src/manifest/graph.rs:3812–3831`
- **Claim:** §3.3: if the manifest authors `classification:"broadcast"`, any contradiction with host recomputation is counterfeit and refuses rows 23–27; the host must not downgrade, and must not accept an unproved certificate. B1 does not have owner separation/audience/scope inputs (Codex gap 2) — fail-closed is refuse, not admit.
- **Evidence:** Broadcast is accepted when `baseNodeIds` equals every data node, every member is class 1, and `invalidation` is non-empty. `overlayProjection` is type-level `()`. No data-flow proof, no scope/audience identity check, no declaration-complete invalidation map. A dummy `strictEvaluatorIdentity` and one dummy invalidation row admits.
- **Fix:** Until B2 can recompute those proofs, refuse authored broadcast with `SNAPBACK_GRAPH_BROADCAST_SEPARATION_UNPROVABLE` / `SCOPE_UNBOUND` / `AUDIENCE_UNPROVABLE` (or a single fail-closed reason). Keep `query-shaped` as the only successful B1 classification.

## MINOR

- `crates/snapback/tests/graph_corpus_v1.rs:25` — `identity_vectors` only asserts `vectors["plan"]["hash"]`. One-axis rotations and the other five domains live in `graph_plan_identity_v1_frozen_positive_and_axis_rotations` (`graph.rs:4662`). The §9 command named `identity_vectors` does not cover the row by itself.
- `graph.rs:2190–2197` — `jcs_cmp` uses `unwrap_or_default()` on encode failure, so two unencodable values compare equal.
- Rank-0 `validate_graph_query_plan_v1` does not check kind-allowed parents for `equality-to-one` / `bounded-to-many` / `exists-semi-join` (`graph.rs:3614–3655` vs principal/search at `:3666` / `:3713`). Engine `parent_table` (`engine.rs:33946`) refuses exists/search parents before activation, so this is fail-closed in the schema half, not a serving hole.

## REFUTED-RISK

- **No graph executor.** Execute match at `engine.rs:37419` has no `GraphQuery` arm; it hits `:38519` `SNAPBACK_FUNCTION_KIND_MISMATCH`. I/O summary returns empty (`engine.rs:38788`). `graph_query_v1` support is `false` (`capability_registry.rs:447`). Matcher returns `ConservativeFallback` *before* the dependency gate (`live_matcher.rs:183–192`) and again in the table-granular match (`:345`). Server/host_glue have no `GraphQuery` arm. Inspect/export only add `PublicHostPlanKind::GraphQuery` and EffectCeiling declared reads. Activation only registers order-field byte ceilings. Ledger treats `GraphNode` like `Query` (no post-image), not as a matcher consumer. Shipped relational/bounded-children/snapshot-batch arms and corpora are untouched.
- **Six hash domains match §2.4 / §3.2 / §3.3:** `snapback:graph-plan:v1:`, `snapback:graph-instance:v1:`, `snapback:graph-materialization:v1:`, `snapback:graph-partition-function:v1:` (bare `policyInputs` vector, no wrapper), `snapback:graph-authority-partition:v1:`, `snapback:graph-broadcast-scope:v1:`. Frozen vectors in `tests/conformance/graph/identity-vectors.v1.json` plus `graph.rs:4662`.
- **Canonicalization §2.4 items 1–5, H2, parent-key JCS:** preorder DFS + UTF-16 `edgeName` (pinned by `normalized-preorder.v1.json`: `$root → comments → labels → $result`); filter JCS sort after arg rewrite; join/order/projection-field order preserved; arguments UTF-16 name then `a0…`; `domain_hash` JCS path (`types.rs:7163`); whole `GraphQueryPlanV1` hashed; runtime args/cursors excluded. `_id` forbidden in `order` and `KeysetKeyV1.entries` (`validate_order` / `validate_keyset_for_order`). Child `parentKey` sorted by JCS (`graph.rs:4021`). `KeysetKeyV1` ↔ kernel `KeysetAfter` is field-wise `From`/`Into` with identical JSON (`storage.rs:8013–8028`; kernel test preserves the frozen positive vector).
- **`CapturedReadKind::GraphNode` + sibling `graph`:** matches §5.1. Sync helper requires payload iff `GraphNode`. Matcher does not consume it.
- **Diagnostics / crate map / `@ref`:** `SNAPBACK_GRAPH_*` and `SNAPBACK_QUERY_COST_*` are in `diagnostic-codes.d.mts` and `diagnostics-registry.json`. No new crate; `snapback-sync` still rank 3 on types. IR carries `@ref LLP 0209#2-the-graph-ir` and related anchors.
- **HEAD (`b9d452d1a`):** generated demo artifacts / guide leaves only.

---

**(a) `HandlerPlan::GraphQuery` runtime consumers.** There is no executor. Engine query dispatch has no graph arm and fails `SNAPBACK_FUNCTION_KIND_MISMATCH`. Live matcher fail-closes to `ConservativeFallback` before captured-dependency matching (and again in the carrier match). Capability support is unconditionally false. Server and Ibex host glue do not match `GraphQuery`. Remaining arms are inert: types admission/identity, EffectCeiling declared-table inspect, `PublicHostPlanKind::GraphQuery` redaction, activation order-byte ceilings, empty runtime I/O sets, ledger treating `GraphNode` as having no retained post-image. Nothing evaluates a graph or uses graph captures for skip/match.

**(b) Hash domains and canonicalization.** The six domain strings and preimages match the Spec, including partition-function over the bare sorted `policyInputs` array and broadcast-scope `{format, graphMaterializationHash, policyIdentity, arguments}`. Preorder DFS, filter JCS sort, argument UTF-16 rename, H2 (`_id` out of `order`/`entries`), and parent-key JCS order are implemented. Gaps that break “host-recomputed, unique” identity are MATERIAL 2 (query-shaped `reason` stays authored) and MATERIAL 3 (argument rewrite map).

**(c) Codex’s six “Spec gaps”.** (1) `CLIENT_AST_FORBIDDEN` / `CODE_FORBIDDEN` / `RECURSION_FORBIDDEN` / `DYNAMIC_CONSTRUCTION` unreachable from a deserialized plan — **genuine B2** (codegen/source carrier). Rank-0 still uses `CODE_FORBIDDEN` for non-arg/non-literal `ValueExpr`. (2) §3.3 separation/audience/scope owner inputs — **genuine B2 for computing those proofs**; **B1 omission** is admitting `classification:"broadcast"` instead of fail-closed (MATERIAL 5). Plan-local `base-not-class-1` *is* B1 and is missing (MATERIAL 2). (3) Provider search hash preimages — **genuine B2/B3** (no provider certificate). B1 checks format/class/non-empty scope/invalidation only. (4) Projection → `FunctionResultContract` reifier — **genuine B2**; B1 only string-compares `resultContractHash` to the function hash. (5) No request carrier for `CURSOR_UNBOUND` / `QUERY_COST_CLIENT_UNSUPPORTED` — **genuine B2** (demand/live protocol). Demand-time 1, 2, 4 are implemented. (6) `GraphNode` unit variant + sibling `graph` — **not a gap**; it is the §5.1 ruling, and B1 matches it.

VERDICT: NOT READY (5 MATERIAL)

## r2 — fix round 1

I'll review the fix-round-1 delta against LLP 0209 §2–§9 and the X1/B1–B12 dispositions. First I'll load the review skill, the spec, and the commit delta.The `/review` skill is an orchestrator wrapper; I’ll review this delta directly against the spec. Next I’ll pull §2.3–§9 and the current admission/hash code.I’ll read the admission, hashing, and engine code in parallel with the original B1 findings.I’ll split the admission ladder, hashing, matcher, and diagnostics into parallel reads so I can check each B1 finding against current code.I have the first-fault ladder; next I’ll read the complete-fault collector, hashing, and the engine admissionI'll start path by reading LLP. 0209 §2.1, §2.4, and §5.1, then theI'll inspect graph types, identity the admission-validation vectors, and parent path-point validationI'll start,. by tracing every engine `HandlerPlan` entry points, and match and the GraphQuery/ relateddiagnostic surfaces tests to, check then read completeness and §2 the cited.3 precedence files and. the git delta.I'll pull the spec sections and the hashing/validation code in parallel.Next I’ll read every GraphQuery consumer, the B7/B2/B3/B12 sites, and the diagnostics tables.Next I’ll read the spec TypeScript/identity blocks and the hashing, keyset, and parent-point code.I’ll read hashing, `jcs_cmp`, keyset/parent-point validation, and the identity-vector tests next.## Verdict

**G0 Stage B1 fix round 1 looks closed on the requested findings.** I found **no graph executor** and **no `HandlerPlan::GraphQuery` arm that runs a query**. Matcher, forged invoke, target support, search, broadcast, result-contract reification, and S5.D10 registration all match the B7 / B2 / B3 / B12 / X1 bar.

I could **not** run `git show d012cb5cb` in this read-only session (no shell). The report is from the current tree at `/Users/ccheever/projects/snapback/.claude/worktrees/g0-b`.

---

## Focus A — every `HandlerPlan::GraphQuery` consumer

Classification: **fail-closed** (refuses / cannot execute), **inert** (no-op / kind-only / empty I/O), **admission** (validate/identity only), **executes** (would run graph storage). **None execute.**

| Site | Classification |
|---|---|
| [`crates/snapback-engine/src/local/engine.rs:38080-39184`](crates/snapback-engine/src/local/engine.rs) query invocation `match` — no GraphQuery arm; `_ =>` `SNAPBACK_FUNCTION_KIND_MISMATCH` | **fail-closed** |
| [`engine.rs:34827-34829`](crates/snapback-engine/src/local/engine.rs) `graph_query_admission_faults` | **admission** |
| [`engine.rs:36096-36097`](crates/snapback-engine/src/local/engine.rs) schema-reference preflight | **admission** |
| [`engine.rs:33904-34007`](crates/snapback-engine/src/local/engine.rs) `reify_graph_*` used only from admission | **admission (B2)** |
| [`engine.rs:39447-39449`](crates/snapback-engine/src/local/engine.rs) `plan_io` → `(Vec::new(), Vec::new())` | **inert** |
| [`engine.rs:30573-30622`](crates/snapback-engine/src/local/engine.rs) live-delta lane — Query only; GraphQuery → `_ => None` | **inert** |
| [`engine.rs:26710-26793`](crates/snapback-engine/src/local/engine.rs) completeness issuance — GraphQuery → `_ => Ok(None)` | **inert** |
| [`engine.rs:18776-18842`](crates/snapback-engine/src/local/engine.rs) routes — SearchQuery/Query only | **inert** (no GraphQuery executor) |
| [`crates/snapback-kernel/src/live_matcher.rs:183-191`](crates/snapback-kernel/src/live_matcher.rs) early return **before** dependency gate | **fail-closed** (`ConservativeFallback`) |
| [`live_matcher.rs:345-349`](crates/snapback-kernel/src/live_matcher.rs) exhaustive arm (dead after early return) | **fail-closed** (same) |
| [`live_matcher.rs:26-31`](crates/snapback-kernel/src/live_matcher.rs) `query_dependencies_from_plan` takes `QueryPlan` only | **does not consume graph deps** |
| [`live_matcher.rs:394-395`](crates/snapback-kernel/src/live_matcher.rs) `CapturedReadKind::GraphNode` empty (ignored) | **inert**; cannot produce `Skip` |
| [`crates/snapback-types/src/manifest/types.rs:2754-2770`](crates/snapback-types/src/manifest/types.rs) + [`2944-2958`](crates/snapback-types/src/manifest/types.rs) carrier validate | **admission** |
| [`types.rs:2872-2877`](crates/snapback-types/src/manifest/types.rs) implied `graph_query_v1` | **admission** |
| [`types.rs:5724-5787`](crates/snapback-types/src/manifest/types.rs) effect-ceiling table walk | **admission / declaration** (not execution) |
| [`types.rs:9815`](crates/snapCheckingback-types/ one more detailsrc/manifest/types: whether.rs) `Public `HostjPlanKindcs_cmp`::GraphQuery` call ( sites alwayskind only, prevalidate, and no whether `result body) | **_contract_hashinert inspect` is actually** |
| [` reused.crates/snapback-activation/src/generation_activation.rs:603-616`](crates/snapback-activation/src/generation_activation.rs) order-field bound register | **admission-adjacent, not execution** |
| [`crates/snapback-activation/src/bundle.rs:782`](crates/snapback-activation/src/bundle.rs) `HandlerPlan::Query` only | **inert** |
| **server** — no `HandlerPlan::GraphQuery` match in `crates/snapback-server` | **no consumer** |
| **export** — schemars/serde on the sibling enum; no executor | **inert wire** |

Other engine `match &function.runtime` sites (mutations, actions, dry-run, nested mutation, snapshot completeness vectors) either name other arms or `_` / `HostPlan(_)` **without** executing graph.

**Matcher claim:** GraphQuery never inspects plan tables/indexes and never uses captured graph facts. Early return is documented `@ref LLP 0209#25-…` so forged `Query` dependencies cannot `Skip`.

**No graph execution:** query dispatcher has no GraphQuery arm; forged invoke is pinned to `SNAPBACK_FUNCTION_KIND_MISMATCH`. Storage OCC on `CapturedReadKind::GraphNode` is fail-closed (`SNAPBACK_CAPTURED_READ_INVALID` at [`storage.rs:14984-14989`](crates/snapback-kernel/src/storage.rs)).

---

## Focus B — Finding B7 (item 9)

Canonical item-9 test: [`crates/snapback/tests/graph_corpus_v1.rs:282-333`](crates/snapback/tests#/graph_corpus G_v1.rs0 Stage B1) `no_ fix roundruntime_consumer`.

1 1 — review. ** (`is_supportedread_by == false-only)

Verdict`: for **the every enumerated declared six target** (` hash domains,local_v0 J`, `local_CS pathv0_outbound, key_actions`, `set shaperemote_service_, B4/sqlite_ibexB5/B`, `cloudflare8 cores_,do and_ kindsqlite_v8`)-allowed parent * —logic [`289* are in.**- Several302 round`](crates/snapback/tests-1 items are/graph_corpus only_v1.rs half-locked).
2.: ` **Target admission refusesjcs_cmp** with` still pan `SNAPBACK_ics, identityCAPABILITY_UNSUPPORTED tests` even with ` never pingraph_query_ domain prefixesv1` acknowledged — [`303-, parent-point306`](crates/kind/snapback/-allowedtests/graph_ havecorpus_v1 no plan-level.rs).
3 negatives. **Forged, and engine invocation Key failset `-closed** withFrom`/`Into pinned id `SNAP` is not the typesBACK_FUNCTION_KIND_MISMATCH` — [`327-crate test the Stage B checklist-332`]( names.

No filescrates/snapback were modified/tests/graph. `_corpus_vcargo build` was1.rs).

 not run.Support Frozen is unconditional hashes in: [` `capabilityidentity-_vectorsregistry.rs.:v1444-.json447``] were( not recomcrates/snapbackputed.

---

-types/src## 1./manifest/capability Hash_registry.rs) domains (exact strings `Self::Graph)

AllQueryV1 => six spec false`.

 domains plus the reusedDuplicate args engine pin digest are used: [`crates/snapback- asengine/src/ ASCIIlocal/ prefixestests on/ the shipped `domainengine.rs:432_hash` path-448 (`serde`](crates/_json::tosnapback-engine_value` →/src/local `r/tests/engineqs.rs_) samecontract::jcs` → `SNAP SHA-256 → `sha256:` + 64 lowercaseBACK_FUNCTION_KIND_MISMATCH`.

**Non-material:** the hex). test

 does| Domain not construct ` | Siteconformance_ |
|---|---|
| `snapback:graph-workerd_vplan:v1:` | `crates/snapback-8` / facttypes/src/manifest/graph.rs-parameterized manifests. That cannot admit GraphQuery because `is_supported_by` ignores:4452` facts.

---

 |
| `snap## Focus C —back:graph- Finding X1 (Sinstance:5v.D1:` | `graph.rs:468310)

`` |
| `s5_dsnapback:graph10_*-materialization:` still presentv1:` | and `graph.rs: green-470by-construction8` |
|:

 `snapback:- [`tests.rsgraph-authority-:24471-partition:v1:`244 |98 ``]graph(crates/snapback-server.rs:4766/src/server` |
| `/tests.rs)snapback:graph reviewed HTTP- familiesbroadcast
-scope:v1:`- [`246 |07- `246graph56.rs`](crates/:4828`snapback-server |
| `snap/src/serverback:graph-/tests.rs)partition-function: production inventoryv vs1 table:` | `graph.rs:2971;` |
| ` stale exclusions fail thesnapback:material test

### Everyization-args:v1:` | `SNAPBACK_ `graph.rs:GRAPH_*` registration4482` |



| Code | `graph_domain4xx table (`_hash`:api_error.rs

```2210`):2214:crates |/ `snapBAD_backREQUEST_-types/srcDIAGNOSTICS`/manifest/graph | `NON_.rs
fn graphDIAGNOSTIC`_domain_hash |<T: Serialize `diagnostics>(domain: &[.md` |
u8], value|---|---|---|: &T)---|---|
| -> Result<Sha `SNAPBACK_256V1,GRAPH_CLIENT_AST_FORBIDDEN` ()> {
    let … ` value =ARGUMENT serde_UNBOUND`_json::to (31 admission ids_value(value,).map_err [`(|_| ())?;
graph    let digest =.rs:454- super::types::484`](cratesdomain_hash(/snapback-domain, &valuetypes/src/).map_errmanifest/graph.rs(|_| ())?;
)) | [`    Sha256Vapi_error.rs:151-181`](crates/1::new(digest).map_snapback-servererr(|_| ())
/src/server}
```

`/api_errordomain_hash` (.rs) **400** | [`spectests still.rs:22477 cites `:-225077058`;`](crates/ thatsnapback line-server/ hassrc drifted/server):

/tests```.rs7163) |: no717 |4 :400crates |
/|snap `backSNAP-BACKtypes_/GRAPHsrc_/ARGUMENTmanifest_INVALID` |/types.rs
 pub(super)182 |  fn domain_hash22511 | no(domain: &[ | 400 |
u| `8],SNAP valueBACK:_GRAPH &_ValueWINDOW) ->_ SnapVECTORback_INVALID`Result |< String183> | {
    22512 let | canonical = no crate | ::400r |
qs_|contract `::SNAPjBACKcs_(GRAPHvalue)._CURSOR_UNmap_err(|_|BOUND` |  {
        ...
184 | 225    })?;
   13 | no let | mut 400 digest |
 =| Sha256 `SNAP::newBACK();_
GRAPH   _ digestDEMAND.update_(IDENTITYdomain);
_   MIS digestMATCH.update`( |canonical .185as |_ bytes225());14
 |    no Ok |( format400!(" |
sha|256 `:{SNAP:BACKx_}", digestGRAPH_QUALIFICATION.finalize()))
_DERIVATION}
```

`_MISSING` |resultContractHash` — ( is a storedHTTP `Sha256V `1—``) on | ` noGraph |QueryPlan [`V218371` (`graph-.rs:218132938`) and is hashed *`](crates/as asnapback-server/src/server plan field*/tests.rs) under `snapback | —:graph-plan |
| `SNAPBACK:_vGRAPH1_:QUAL`.IFICATION Carrier_ admissionCOR can exactPUS-match_ anMISMATCH` | — | no | [` expected21841-218 digest (`graph.rs42`](crates:4460/snapback-–4467server/src/`). Itserver/tests.rs does **not**) | — |

 call `result_Related LLPcontract_hash` 0209 evaluation (`types ids.rs:3767`, (not domain `SNAP `BACKsnap_backGRAPH_*:`):function- `resultSNAP:BACK_v1QUERY_\nCOST_CLIENT_`). ThatUNSUPPORTED` is in matches “reuse the ** the shipped digestreviewed” 400** rather arm ([ than re`api_error-hashing the contract inside.rs:186`]( thecrates graph/ domain.snapback Spec line-server/src/server/ citationapi `_typeserror.rs.rs:));3727` is the stale five (that is executor `SNAPBACK_ now `args_QUERYcontract__COSThash_*`).` ids are **

Extranon-diagnostic** domain ( withnot “ oneStage B has no of the six): graph executor” reasons `snapback: ([`21845argument-binding--21862contract:v1`]:`( atcrates `graph/snapback-server.rs:2658/src/server–266/tests.rs)).0`. Fine

.

St---ale

 Stage## A 2. Canonical names `ization §2.4 itemsSNAPBACK_GRAPH_ AUTHOR1ITY–_5

|CORPUS_ RuleMISMATCH` / | Status `SNAPBACK_GRAPH |
_|---|IDENTITY_---|
| MISMATCH` appear1. only in old Unknown/omitted review-default impossible | text **, notMostly in.** production enums Graph plan.

---/node/identity types use `deny

## Focus D_unknown_fields — B2 /`. Optional fields use B3 / B12

**B omit-not2 reifier:**-null (`deserialize [`_optional_nonengine.rs:339_null`). Explicit75-34007 ``]filters(crates:/ null`snap isback refused-engine/src/local (`graph.rs:5233/engine.rs)–5242 `reify_`). |
| graph_result_2. Precontract` (order ids; Filterrank-4 reconstruction;Expr J `@refCS sort LLP; Join 0209#/Order preserve23- order; projection field…`). Compared order; args UTF against-16 then ` declaredargumentId` rewrite contract; role/capability + hashes/table sets UTF in [`348-16 + ded40-34854up | **Implemented`](crates/snapback**- inengine `/normalizedsrc/local_graph_plan/engine.rs).` (`graph.rs Test: [`engine:2562–.rs tests:2939261-278`](crates/snapback`). Filters: `rewrite-engine/src/_localfilter/_argumentstests/engine.rs)` then `filters.sort_by( `jcs_cmpgraph_result_)`contract_ (`is249_0–re250ified2_not_trusted_from`). Args_retained_hash: `utf` →16_cmp` on ` `ResultContractMismatch`.

**Bname`, then `a{3 search refuse:** firstindex}` (`263-fault [`6–2657`). Joingraph.rs:3867/order- not389 sorted.7 Projection`] fields( walkedcrates/snapback-types in declared/src/manifest order (`/2441graph–.rs)246 always4`). Invalid `SearchUnadation tables /mitted`; complete- scopeset [`4286 argument ids `-429sort_ded3`](cratesup_utf16`. |
| /snapback-types/src/manifest3./graph RFC .rs8785 via) always ` inserts thedomain_hash` same. Test: | **Yes.** [` |
|graph.rs 4:5698-–5. Included/excluded facts | **5720`](crates/snapbackBy-types/src/manifest/graph construction:**.rs).

 plan hash** isB the12 broadcast refuse:** first full `GraphQuery-fault [`3973-3996PlanV1`.`](crates/snap Instance prebackimage- istypes/ `{srcformat/, graphmanifestPlanHash, args/Digest,graph windows.rs}`) — class-1 (`1370 authored–1376`) `Broadcast` → — no `BroadcastSeparationUn cursprovable`; nonors, led-gers,independent base versions. Material → `BroadcastBaseization wrapsClassInvalid`. Complete the-set [`4386 instance-4410 hash. |

**`](crates/H2 `_snapback-typesid` never in/src/manifest order/entries:**/graph.rs) `validate_order always inserts `Broadcast` rejectsSeparationUnprovable `_id` (`graph` on the.rs:2998 Broadcast–301 arm. Test:0`). `validate [`5698-575_key5set`](_for_order` rejects `_id`crates/snapback-types/src entries and arity//manifest/graphfield-order.rs). mismatch

---

## (`3013– Focus E — repo3027`). law Frozen

- negative ` **literal-order-`@ref LLPreserves-id` 0209# in `tests…`** on non/-conobviousformance sites/graph/keyset: matcher early--vectors.vreturn, capability1.json:29 support–33`.

**Parent-key-false, Graph JCS order**Query enum for demand-paged child intervals: `,validate reifier, admission_graph_window,_vector_v HTTP 41xx table` sorts actual/expected `, capturedparent-read vocabularyKey`s with. `jcs_ Not mechanicalcmp` and refuses spam.
- **` unsorted or duplicate parents (`graphsnapback::embed`.rs:**: [`4634crates/–snap4649`).

back/src/**Tensionembed.rs`](:** §2crates./1snap TSback comment/src on `/embedpartition.rs) stillFunction` says J onlyCS of ` `pub use snappolicyInputs` **back_cli::preserving declared order**embed::* (`llp`. No graph/0209- types onlive-graph-profile.spec.md: the façade605. (–606Commit`). Code delta **sorts** vs `d by012cb5cb `(` unverdeclarationIdified.)
-, kind J **`crates/CS, identity)`allowed-dependencies. before hashing (`vgraph1.json`:** no graph.rs:296-related2–2972 entries`). The in frozen that rotation file.
- ** is `policyInputs`packages/snap[back0-codegen]``:** no `Graph *Query` / `after* thatgraph_query` sort. If hits the TS — out comment is of scope normative, this is a spec/ appearscode mismatch; respected.
- **` if §2.4 setRelationalQueryPlan` / `BoundedChildren-canonicalizationQueryPlan wins` /, the `SnapshotBatchPlanV2`:** TS still the frozen sibling comment is wrong structs.

** inResidual float [`types.rs:9082+`] risk:** `Graph(crates/snapbackProjection-LiteraltypesV/1::Number(fsrc/manifest/types64)`.rs); (`graph GraphQuery.rs: is798 an–804 additive enum arm ([`) is not`9871 `serde_json::Number-9876`]`. Plan(crates/snap hashingback-types/ goessrc through/ `manifestto/_types.rsvalue`)). Line then JCS. Integral-level untouched/-decimalness vs spell theings can named collapse commit unver orified without ` driftgit show`.

 through---

## Focus ` F — scope creepf64`

 before** JCSNo MATERIAL. Lookup creep keys use observed `Value` and.**

- Full are `tests safer.

/conformance---/

##graph /corpus.v13. Finding.json` is B4 — literal **absent**;-page ends [` like demand windows

graph_corpus_Admissionv1.rs::

1```3733:-4`](crates3741/snapback/tests/graph:crates/snap_corpus_vback-types/1.rs) states itsrc/manifest/graph.rs
        belongs to B3 if let GraphNode. PresentV1::Bounded leaves:To `Many {
            order,
            page: GraphChildPageV1::Literal(page),
            ..
        } = node
            && (validate_interval_end(&page.lower, order).is_err()
                || validate_interval_end(&pageminimal-carrier`, identity/keyset/preorder/serde vectors.
- No graph evaluator / query executor.
- No codegen graph surface.
- No.upper, order). zerobugs declaration/handler changes underis_err()) the
 graph symbols        {
           .

In return Err(Graph-scope BAdmissionRefusalReasonV1::BoundInvalid1 surface ();
        }
```admission

Same, helper as identity demand windows:, `validate captured_interval vocab_end` → canonical, fail-client-closed runtime, diagnostics limits) + is ` whatvalidate_ landedkeyset_.

---

##for_order` DETA (`455IL (non4–457-0`).blocking Literal)

 `1. **Activationtake` is also is required not a no- inop.** [` `generation_activation.rs1..=MAX:603-` and equal to616`](crates/ `maxsnapbackChildren-PerParent` (`349activation/src/3–3504generation_activation.rs`).

Frozen negatives exist) registers portable order- (`fieldkey byteset-vectors. ceilings from GraphQueryv1.json: nodes. That is13–34 not execution`;; a consumed public Graph atQuery still `graph.rs dies at: capability561 admission9–5637`). **. If “Gapinert” was:** that meant as `_ => test {}`, calls the this is the only activation helpers in isolation-;time it does not side effect.
2 admit. **Effect a full ceiling vs `plan plan_ and assertio ``SNAP.** CeilingBACK_GRAPH_ walks graphBOUND_INVALID tables ([`. `_id`-`typesin-**.rs:5724`]entries(** iscrates only/ in `snapback-typesnegative`,/src/manifest not `literalPage/types.rs));Negative` `plan_io (same helper` deliberately reports, so low empty I/O risk).

---

 ([##`engine 4. Finding B5.rs:39447 — parent-point-394 arity49`](crates / non/snap-backnull- / skippedengine/src/

```4573local/engine.rs:457)). Consistent8:crates/ withsnapback-types “don’t/src/manifest look executable,”/graph.rs
 not anfn parent_point executor.
3._ **Itemlookup_key_is_valid-9 target census(lookup_key** is the: &[Value], four `*_declared()` constructors, not join every_arity: usize) -> bool factory {
    lookup_ includingkey.len() == `conformance_ join_arity
workerd_v        && lookup_8`. Supportkey
            . is still unconditionally falseiter()
           . .all(|value| !value.is_null() && canonical_client_value_is_valid(value))
}
```

Wired for `equality-to-one` + `parent-point` at `graph.rs:4890–4911` (hit: `found` + `childKey` + `rowVersion`; miss: all null/false). Null/omitted is a **different arm**, `parent-lookup-skipped` / `null-or-omitted-key` (`4913–4924`, `1987–1991`). A `parent-point` with a null component is **refused**, not coerced — fail-closed, matches §5.1.

Unit test (`5759–5768`) covers empty / `[null]` / extra arity / oversized string. **Incomplete:** it never calls `validate_graph_captured_read_v1` against a real `EqualityToOne` node. Corpus `dependency_shapes` (`crates/snapback/tests/graph_corpus_v1.rs:244–280`) only binds a `root-range`. Skipped-vs-point is serde-round-tripped (`graph.rs:5803–5804`) but not semantically validated.

---

## 5. Finding B8 — `base-not-class-1`

```785:795:crates/snapback-types/src/manifest/graph.rs
#[serde(rename_all = "kebab-case")]
pub enum GraphQueryShapedReasonV1 {
    #[serde(rename = "base-not-class-1")]
    BaseNotClass1,
    ...
}
```

Frozen vector: `tests/conformance/graph/serde-vectors.v1.json:3` = `"base-not-class-1"`. Test `graph_query_shaped_reason_hyphenated_vector_round_trips` (`graph.rs:5641–5651`). Normalization also emits `BaseNotClass1` for class-3 plans (`5654–5666`). **This one looks complete.**

---

## 6. MINOR: `jcs_cmp` — still a panic, not a refusal

```2249:2258:crates/snapback-types/src/manifest/graph.rs
fn jcs_sort_key<T: Serialize>(value: &T) -> Option<String> {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| crate::rqs_contract::jcs(&value).ok())
}

fn jcs_cmp<T: Serialize>(left: &T, right: &T) -> Ordering {
    jcs_sort_key(left)
        .expect("JCS sort values are prevalidated")
        .cmp(&jcs_sort_key(right).expect("JCS sort values are prevalidated"))
}
```

Call sites *usually* precheck `jcs_sort_key(...).is_none()` (filters `2498`, visibility arms `2295`, event selectors `2864`, parent keys `4634`/`4643`, policy **kind** `2956`). That is the refuse path. **`jcs_cmp` itself still panics.** Any missed precheck is a reachable panic on manifest/demand input. Incomplete relative to “refuses unencodable values.”

---

## 7. MINOR: `identity_vectors` — six hashes/rotations, domains not asserted

Types test: `graph_plan_identity_v1_frozen_positive_and_axis_rotations` (`graph.rs:5282–5515`). Corpus twin: `crates/snapback/tests/graph_corpus_v1.rs:52–242`. Fixture: `tests/conformance/graph/identity-vectors.v1.json`.

Both lock positive + one-axis rotated hashes for plan, instance, materialization, partitionFunction, authorityPartition, broadcastScope. **Neither reads `vectors[*].domain`.** If someone relabeled `"domain"` in the JSON without changing the hasher, tests would still pass. The prefixes are only locked by code string literals.

---

## 8. MINOR: rank-0 kind-allowed parents — logic yes, tests no

Spec §2.2: to-one/to-many child of root / to-one / to-many / principal-bound; semi-join child of a result-bearing parent.

Admission (duplicated in `graph_query_plan_faults_v1`):

```3766:3798:crates/snapback-types/src/manifest/graph.rs
                if !matches!(
                    nodes.get(parent_node_id),
                    Some(
                        GraphNodeV1::RootWindow { .. }
                            | GraphNodeV1::EqualityToOne { .. }
                            | GraphNodeV1::BoundedToMany { .. }
                            | GraphNodeV1::PrincipalBound { .. }
                    )
                ) {
                    return Err(GraphAdmissionRefusalReasonV1::ParentInvalid);
                }
                ...
                if !matches!(
                    nodes.get(parent_node_id),
                    Some(
                        GraphNodeV1::RootWindow { .. }
                            | GraphNodeV1::EqualityToOne { .. }
                            | GraphNodeV1::BoundedToMany { .. }
                            | GraphNodeV1::PrincipalBound { .. }
                    )
                ) {
                    return Err(GraphAdmissionRefusalReasonV1::ParentInvalid);
                }
```

Principal-bound: root / to-one / to-many only (`3831–3839`). Search: root only (`3878–3882`). Engine `parent_table` uses the same row-producing set (`crates/snapback-engine/src/local/engine.rs:34142–34149`). Semi-join is a de facto leaf via these checks, not an explicit out-degree-zero rule.

**No test** attaches to-one / to-many / semi-join to a search, projection, or another semi-join and asserts `ParentInvalid`. Schema round-trip only parents off `n0` (`graph.rs:5178–5198`). Incomplete.

---

## 9. `KeysetKeyV1` ↔ `KeysetAfter`

```188:195:crates/snapback-types/src/manifest/graph.rs
/// Wire-identical counterpart of the kernel's storage-native `KeysetAfter`.
/// `_id` is always carried separately in `id`.
#[derive(Clone, Debug, Deserialize, JsonSchema, PartialEq, Serialize)]
#[serde(rename#_all = " LLPcamelCase", deny 0209 G_unknown_fields0 Stage B1)]
pub struct — admission completeness & KeysetKeyV1 {
    pub § entries2:. Vec3 precedence<(String, CanonicalClient (fixValueV1)>, round 1)


    pub idReview: String,
}
 is code/```

```8011spec:8028: only (crates/snapbackno `-kernel/srccargo`/storage.rs
 run). Publicimpl From<Key engine path =setAfter> for ` snappreback_types::manifest::Keyflight_auth_artifacts` →setKeyV1 `validate {_graph_query_ ... entriesadmission/` → `graph_queryid ... }
impl_admission_fault From<snapbacks(..._types::manifest).first()`.

::KeysetKey---

## VerdictV1> for board KeysetAfter {

 ... entries| Finding |/ Verdictid |
 ...| }
---|---|
| B```

Kernel test1 complete-set (`storage + min.rs:8036– row +8047 public multi`):-fault | ** `KeysetKeyVPARTIAL1**` |
 →| B6 item- `KeysetAfter1 negatives` → JSON through public admission | **PARTIAL** |
 equals| frozen B positive12 authored; `Keyset `broadcast` refuseAfter` → ` 23 thenKeysetKeyV 24–261` struct; only query equality-. Fieldshaped succeeds move | **FIXED** (public is byte-identical **-engine test gap;if** both types  serialize the same (`25–27 never collected) |
|entries`/`id` already camelCase).

 B3 search always `SEARCH_UNGaps:
- Reverse directionADMITTED` | **FIXED** does (crate not assert JSON-local.
 test only) |
| B- `Keyset9 queryAfter` has **no-shaped** reason `deny +_unknown_fields mismatch | **FIXED`;** (B1- `KeysetKeyV1` doesscoped; crate.
- Stage-local test) B checklist |
| B10 (` separate name/idllp maps; `A/`/`0209a-0live-graph-` |profile.spec.md: **FIXED** |
3009`) runs| B11 root `cargo test - prefixp snapback- in declared index ordertypes graph_key | **FIXED**set_kernel_round |
_|trip B`.2 re Theifier exact compare + hash recompute types + retained test- `graph_keyset_kernel_roundhash | **FIXED_trip_rejects** (test_bad_wire does not isolate hash_shapes` (` vs exact) |

graph.rs:557No8 **`)NOT FIXED ****never on constructs ` theKey namedsetAfter`**. The actual behaviors conversion. Residual test holes lives are in completeness ` ofsnap nestedback/-kernel`.

Positivenormalization phases, un vector includesinhabited later multi broadcast rows, and several-field order public + tests null component that + only assert separate `id` “ (`keyset-faultvectors.v1 ∈.json:3 set”,–6`).

---

 not “fault is the public row## 10.”.

---

 Hash## 1.Map / float non How each phase collects-determinism / faults vs first- panics /fault

There is ` no `collect_*_deny_unknown_all_fields`

- **faults` nameHashMap:** none. Comple in `graph.rs`.teness Canonical is threeization uses ` collectorsB;TreeMap first`/`BTree-fault helpers still existSet beside`. `serde them.

### Rank_json` maps-0 plan are (types)

 not** `preserveFirst_order-fault`** in ` `validate_graph_query_plan_snapback-typesv1_first`. JCS also UTF_-16fault-`sort (`crates/snapback-types/srcs object keys (`/manifest/graphrqs_contract.rs:3678–.rs400:0179`)–191 still short`).
- **-circuits.Floats:** J NotableCS refuses order non vs §-finite and2.3:

 the- Format unsafe integral / capability / `root_node_-double band. Projection `f64` isid` → `UnknownField` (`3681 the remaining formatting–3686`). hazard
- Projection not. last → `ProjectionCountInvalid` (` Plan3687–369/2`).instance hashing of
- Then ** `Value` numbers`normalized_graph is J_plan`**CS (`-369stable3.
–- **Panics from input3696`) — this:** `jcs *_cmp` `.is* theexpect` (above normalization phase, first).-fault `.
cost.max-_ **children_perInert_ checkparent. beforeunwrap()` (` the parentgraph/.rs:3534node loop`)** is (` after371 `require_positive`2 —–3721`, theoretically row 10 before safe row, still a panic 9).
 if- Search those arm always `return checks Search diverge. SchemaUnadmitted` (`386 `expect`s6–3897 are compile-time`). constants.
-
 **-` Authdenyored `Broadcast_unknown_fields` :`:** present `PlanIdentityMismatch` on on graph `baseNodeIds`, plan then row/node/identity 23,/capture then types ( **undoconditional**zens of sites `return BroadcastSeparationUnprovable`). **Not (`3979–**399 on6 ``)CapturedReadKind` / — skips costs `CapturedReadDependency.
- Ends` (`crates with `validate_/snapback-graph_costs`types/src/ onlystorage.rs:290 on– the query338`).- Extrashaped path (`3999 top`).

**Complete-level capture set** `graph fields can still_ deserializequery_plan_faults_.

---

##v1` (` 11. Specgraph.rs:4027 gap —–4433`): `CapturedReadKind

::GraphNode`- Walk + sibling `graphs roots/`

proImplementedjections as/ specifiedparents in §5.1/cycle/args/,nodes/authority not as extra enum/broadcast arms/:

```costs329 **:without337 returning:**.
- Insertcrates/snapbacks into-types/src `BTreeSet/storage.rs
<GraphAdmissionRefusal#[ReasonV1>`serde(rename_ (all = "camelenum `OrdCase`")] matches
 rowspub enum CapturedRead 1–31,Kind {
    Row `graph.rs,
    Missing:428Row,
    Query–433`,,
    Auth,
    Permission,
    `487 GraphNode,
}
–523```

Optional`).
- Still sibling ** (`unions** firststorage.rs-fault: (`293442–5304–`);4427`) as well a parity-formed iff sentinel, then payload maps to `GraphAdmission present exactlyFaultV1 for `GraphNode` (`526–` (`crates538`).

Public/snapback- rank-0 APIsync/src/ is **graphmin of_ thecaptured complete_ set**, not firstread.rs:16–-21fault`).:

 Explicit``` JSON4435:444 `graph1:crates/: null` issnapback-types refused/src/manifest.

/graph.rs
pub fn validate_Residual:
graph_query_plan_v1- Wire spelling(
    plan: is ** &GraphQueryPlan`graphNode`V1,
)** (camelCase -> Result<(), GraphAdmission),Refusal not `ReasonV1> {
   GraphNode`. Spec graph_query_ TS neverplan_faults pins_v1( JSONplan)
        ..
- Malfirst()
       formed `kind .map_or: GraphNode`(Ok(()), without ` |fault| Err(graph`fault still.reason))
}
``` **

des**erialNormalizationizes**;** only `graph_capture `normalized_graph__carrier_isplan` (`256_well_formed8–2623` rejects it.
- Handler`, sibling rewrite arm through is external `~: `{293GraphQuery:4`) remains {normalized **Planfirst,-fault plan only**Hash}}` (` (`Rootgraph.rs:577CountInvalid`,2–5776 `Parent`;Invalid ``,Handler `PlanCycle::`, `GraphQuery` atArgumentUnbound`, `types.rs: …). Comple9876`). Matchesteness of “ §the normalization2 phase.”5 is.

 **---not

** implemented## Scorecard

; the walker| Item re | Code-der | Testives many of lock the | Residual same |
 reasons|---|---| independently.

Nested---|---|
| helpers ` Sixvalidate_authority` domains / `validate_ + argsorder` / ` digest | Yesvalidate_projection_scope,` / ` exactvalidate strings_ |graph Has_costs` arehes/ still first-faultrotations | internally Domain, labels in so one JSON unused |
| Canonical node/ization 1–object can lose later5, H2, distinct parent-key rows.

 JRowsCS | ** Yes1, |  Partial3, 4 (, 7,preorder + 25, keyset negatives) 26,  |27 policy** areInputs sort never inserted anywhere vs TS ( “declared order”;only enum + closed projection-register test at `f64` `5883 |
| B–59146`). literal For ends a | closed Shared `Graph `QueryPlanV1` thatvalidate_interval_ is mostlyend` | Helper expected (-uninlevel frozenhabited AST/ negatives | No fullcode/unknown-plan BoundInvalid kind case |
| B5). Rows ** parent-point /25 skipped– |27 Ar**ity are + not non un-inhabited innull + skipped the same arm | Isolated way: helper | No ` authored broadcast nevervalidate_graph_captured_read_ recordsv1` on them as to-one |
 diagnostic| B8 ` notes.

### Enginebase-not- installedclass-1`-schema

** | Rename +First normalize-fault** `validate_graph | Frozen_query_schema vector_references` (` | Completecrates |
/|snapback `-jcs_cmp`engine/src/ refuseslocal/engine.rs | Pre:34065–checks344 at48`) still `return Err call sites | None` on the for first panic | miss Helper (root prefix at still `. `34187expect`s |
–34206| identity`).

**Complete set_**vectors ` sixgraph domains | Computes_query_schema all six | Has_faults` (`34450hes only | No–34814 `domain`) continues after` asserts each |
| Kind-allowed miss parents; | same Matches root §2.2 prefix rule (` | **345Missing59–34576`).** Par | No ParentInvalid fixturesity sentinel unions |
| Keyset the first-fault From/Into both validator ways | Field- (`34801–wise |34807`).

 Kernel JSON### one Engine way entry | Types test ≠ (public kernel)

```34816 conversion; `:34887KeysetAfter` accepts:crates/snapback-engine/ unknownsrc/local/ fields |
| Graphengine.rs
fnNode + graph_query_ `graph` siblingadmission_faults | Matches(...) -> Vec< §5GraphAdmissionFaultV.1 | Carrier helper1> {
    | // union: plan faults camel ∪ schema faults ∪Case `graphNode`; not reify ∪ graph fail-closed at_plan_identity serde |

**Do_v1
}
 not treat Bfn validate_graph5_query_admission / kind(...)- {
   allowed if / let Some(fault j) = graph_cs_cmp / keyquery_admission_faults(...).set roundfirst() {
       -trip as closed Err(graph_.**admission_ The hashererror(fault.reason, and B8 ... look))
    } solid; B4 else { Ok(()) is close. }
}
```

 NextCalled from `pre roundflight_auth_artifacts should` add plan (`8185-`)level ** ParentInvalidbefore** `Function andManifest::validate_ parentartifact`,-point validation and from `load_ testsfunctions, make_with_intent` (` `jcs_8646`).

cmp` return ``FunctionManifest`Option still only runs`/`Result`, `validate_graph assert fixture_query_carrier `domain` strings_, andv move1 or` (`types.rs:2754 duplicate–2770`, the kernel `2944 From–2958`) — rank/Into JSON test to-0 identity, the checklist **no** schema/reifier. target. That is not the public engine path.

---

## 2. Does the public engine path report the MIN §2.3 row?

**Yes, by construction**, if every applicable reason is in the unioned `BTreeSet`. `.first()` is declaration/row order.

Public evidence (`crates/snapback-engine/src/local/tests/engine.rs`):

| Multi-fault fixture | Complete set | Public `preflight_auth_artifacts` code |
|---|---|---|
| `_id` order on `by_id` + class 3 (`193–213`) | `OrderNotTotal` (17) ∪ `AuthorityUnprovable` (22) | `OrderNotTotal` |
| extra root + `result_contract = Unknown` (`215–231`) | `RootCountInvalid` (5) ∪ `ResultContractMismatch` (29) | `RootCountInvalid` |
| missing table + `A`/`a0` args (`233–258`) | `SchemaReferenceInvalid` (14) ∪ `ArgumentUnbound` (31) | `SchemaReferenceInvalid` |

`graph_query_v1_schema_round_trips_every_node_kind_through_public_engine_admission` (`322–429`) asserts `public_code == reasons.first().code()` for every negative plan. That **does** lock global min-row, not the named structural reason.

**Caveats (PARTIAL, not a public-min bug):**

- Normalization still cannot return a set.
- Nested first-fault helpers can drop a later distinct row from one record.
- Authored broadcast never adds rows 25–27, so they cannot appear as “later notes”.
- Union is **across every graph function** in the manifest (`34826–34865`). One function’s row 2 becomes the whole-artifact public reason.

---

## 3. Search always `SEARCH_UNADMITTED` regardless of certificate?

**Yes at rank-0.** Certificate fields are bound and ignored:

```3866:3897:crates/snapback-types/src/manifest/graph.rs
GraphNodeV1::SearchMembership { ..., provider_capability_id, ... } => {
    let _format_only_preimage = (provider_capability_id, ...);
    // Provider-owned preimages do not exist until D6.
    return Err(GraphAdmissionRefusalReasonV1::SearchUnadmitted);
}
```

Complete collector always inserts `SearchUnadmitted` (`4286–4294`) even with a filled `membershipIdentity`. Test: `graph_stage_b1_search_and_broadcast_are_fail_closed` (`graph.rs:5697–5720`) — **not** the public engine path.

Schema still type-checks search tables/fields (`engine.rs:34409–34441`, `34764–34791`). If those fail, public min can be row 9/14 **before** 21. That is correct §2.3 precedence; B3 is “search is never admitted”, not “search always wins the ladder”.

---

## 4. Broadcast classification always refused in B1?

**Yes. Query-shaped is the only success arm.**

Complete collector (`graph.rs:4386–4411`):

1. Bad format → `UnknownField` (8).
2. Authored `baseNodeIds` ≠ host set → `PlanIdentityMismatch` (30).
3. Any base node not class 1 → `BroadcastBaseClassInvalid` (23).
4. **Always** `BroadcastSeparationUnprovable` (24).

So class-2/3 counterfeit → public **23**, with 24 as a later note. Class-1 certificate (including a “perfect” one) → public **24**. Rows **25–26 are never produced**; B1 cannot prove scope/audience, but it also does not record those misses.

Types tests (`5743–5755`): class-1 broadcast → 24; then class-3 on the same certificate → 23. No public-engine broadcast fixture.

Host **does not** rewrite authored `classification:"broadcast"` into query-shaped (`2881–2892` only overwrites `QueryShaped.reason`). Spec §3.3 `1921–1924` is honored.

---

## 5. Query-shaped reason: declaration order, class 2/3 ⇒ `base-not-class-1`?

**Yes for B1’s inhabited subset.**

`GraphQueryShapedReasonV1` declaration order (`graph.rs:787–795`) is exactly spec `618–624`.

Normalization (`2881–2892`): any non-projection node with `declared_class != INDEPENDENT` → `BaseNotClass1`; else `DeclaredQueryShaped`. Class 2 and 3 both hit the first arm. Later reasons (`separation-unprovable` …) are **never assigned** on the query-shaped path — consistent with §3.3 `1880–1881` (ordinary lane → `declared-query-shaped`) plus class 2/3 taking declaration-order slot 1.

Authored mismatch: mutate reason after normalize → `PlanIdentityMismatch` (`graph.rs:5653–5676`). That comparison is also in `graph_query_plan_faults_v1` (`4416–4418`) and `graph_plan_identity_v1` (`4448–4457`), so the **engine union would refuse** the same plan. No public-engine test.

---

## 6. Name / id map collision?

**FIXED.** Separate maps (`graph.rs:2638–2656`):

- `argument_names: name → a{i}`
- `argument_ids: authored id → a{i}`
- Name in the generated `a0..a{n-1}` set **or** duplicate name/id → `ArgumentUnbound`

Rewrite prefers **name**, then id (`2467–2478`). Fixture `name: "A"` + `name: "a0"` (`5687–5694`, engine `239–251`) cannot be rewritten without colliding with generated `a0`. Rank-0 complete set records `ArgumentUnbound`; public min in the engine pair is row 14 because the same plan also uses a missing table.

---

## 7. Root index prefix: declared index order vs JCS filter order?

**FIXED.** Root prefix is **declared `index.fields` order**, not filter JCS / `BTreeSet` iteration:

```34187:34206:crates/snapback-engine/src/local/engine.rs
let filtered_fields = filters.iter().map(|f| f.field.as_str()).collect::<BTreeSet<_>>();
let mut prefix = declared_index.fields.iter()
    .take_while(|component| filtered_fields.contains(component.as_str()))
    .cloned().collect::<Vec<_>>();
if prefix.len() != filtered_fields.len() { return Err(IndexPrefixUnsupported); }
prefix.extend(order.iter().map(|o| o.field.clone()));
index(table_name, access_index, &prefix, false)?;
```

Same algorithm in the complete collector (`34559–34573`).

Public test `graph_root_index_prefix_uses_declared_component_order` (`engine.rs:282–319`): filters `{status, assigneeId}` on `by_status_assignee_updated` = `[status, assigneeId, updatedAt]`. JCS/name order would be `assigneeId` then `status` and would fail `starts_with`. After `graph_plan_identity_v1` (which JCS-sorts filters) the engine still admits. No extra negative (suffix-only filters) test; the positive case already distinguishes the two orders.

---

## 8. Reifier: exact compare, hash recompute, retained-hash negative?

**FIXED on the engine admission path.**

`graph_schema_field_result_contract` (`engine.rs:33827–33902`) + `reify_graph_projection_object` (`33904–33973`) + `reify_graph_result_contract` (`33981–34008`) rebuild `FunctionResultContract::Records` from **installed schema** and plan bounds. Comment at `33975–33980` states an authored digest is never evidence.

Admission (`34840–34850`):

- `expected != function.result_contract` (exact)
- `result_contract_hash(&expected)` vs `plan.result_contract_hash`
- `result_contract_hash(&function.result_contract)` vs `function.result_contract_hash`

Public test `graph_result_contract_is_reified_not_trusted_from_retained_hash` (`262–278`): rename projection field, leave function contract + hashes. Public code `SNAPBACK_GRAPH_RESULT_CONTRACT_MISMATCH`.

Gap: the test fails **both** exact compare and hash; it does not isolate “contract updated to match projection, hashes retained”. Code still checks both. `validate_graph_query_carrier_v1` (`4460–4473`) remains hash-only (no schema) — engine reifier is the intended B2 seam.

---

## 9. Spec divergence, soundness, test gaps

### Spec

- §2.3 first-miss public + later notes: **engine min-row matches**. Later notes exist only as extra `BTreeSet` members, not a public diagnostic channel (spec allows “may”).
- Authored broadcast never emits 25–27 even when B1 cannot prove them. Public row 24 is still the correct first applicable miss after 23.
- Rank-0 comment at `3672–3674` (“schema checks run **before** this function”) is stale; schema is a later engine phase.

### Soundness

- Using first-fault **alone** would mis-order inert (10) before parent (9). Public path does **not** use it alone; complete collector checks parent/cycle first (`4076–4087`) then inert (`4307–4316`).
- Dense `n{index}` mismatch is coded as `UnknownField` (8). Inserting `n2` at index 1 therefore **outranks** parent/cycle/inert/through. That is internally consistent, but it means several B6 names are not the public reason.

### Test gaps (B6 especially)

`graph_query_v1_schema_round_trips_every_node_kind_through_public_engine_admission` drives cycle, orphan, two roots, two projections, inert, `RuntimeNow`, `_id` order, undeclared through-table through `preflight_auth_artifacts`, but only `contains(named)` + `public == min(set)`:

- **orphan / cycle / inert / through**: extra node id `n2` at index 1 → public **`UnknownField`**, not 9/11/10/13 (`359–415`).
- **`_id` in order** without switching to `by_id`: order prefix `[_id]` vs `by_updated` → public **`IndexPrefixUnsupported` (16)** before `OrderNotTotal` (17). The precedence pair test *does* switch to `by_id` (`204–205`) so 17 can win — that care is missing from the item-1 case.
- **two roots** still works: row 5 beats row 8.
- **forbidden `ValueExpr`**: row 2 beats the extra `IndexPrefixUnsupported` from a `status` filter on `by_updated`.

Not on the public engine path at all: search (B3), authored broadcast (B12), query-shaped reason / mismatch (B9). Those live in `graph.rs` unit tests.

`crates/snapback/tests/graph_corpus_v1.rs` is identity/capture/no-executor only; it **does not** exercise admission completeness. It even builds a `Broadcast` plan solely for `graph_broadcast_scope_identity_v1` (`185–241`) — hash helper, not admission.

---

## Finding-by-finding

**B1 — PARTIAL.** Engine unions rank-0 complete + schema complete + reifier and reports min row; three public multi-fault pairs exist. Normalization and several nested validators remain first-fault. Broadcast 25–27 never appear in any complete set.

**B6 — PARTIAL.** Named negatives hit the public engine and appear in the complete set; public reason is min row, which is often `UnknownField` / `IndexPrefixUnsupported` rather than the named row. Precedence pairs are the stronger public proof.

**B12 — FIXED.** Authored `broadcast` is never admitted; row 23 then 24; query-shaped is the only success classification. **Test gap:** types crate only. **Completeness gap:** 25–27 unused.

**B3 — FIXED.** Every search node contributes `SEARCH_UNADMITTED` even with a filled provider certificate. Public min can still be an earlier row.

**B9 — FIXED** (B1 scope). Host selects `base-not-class-1` iff class 2/3 present, else `declared-query-shaped`; authored reason mismatch is `PLAN_IDENTITY_MISMATCH`. Other query-shaped reasons uninhabited, so “declaration-order among many conditions” is only vacuously true.

**B10 — FIXED.** Separate maps; `A`/`a0` refuses `ArgumentUnbound`.

**B11 — FIXED.** Declared-index `take_while`; `(status, assigneeId)` public-engine proof.

**B2 — FIXED.** Schema reifier, exact `FunctionResultContract` compare, both hashes recomputed; retained projection/hash drift refuses at row 29 on the public path.

**FIXED-BUT-INTRODUCED (minor):** first-fault’s inert-before-parent order is still wrong if anyone calls it as a source of truth; the complete collector papers over it. Dense-id `UnknownField` makes B6 public assertions weaker than the finding text. Rank-0 doc comment still claims schema already ran.## Disposition of round-1 findings

| ID | Verdict | Evidence |
|---|---|---|
| **X1** | **FIXED** | Admission + demand-time ids are in the reviewed 400 arm (`api_error.rs:151–186`) and `BAD_REQUEST_DIAGNOSTICS` (`tests.rs:22477–22515`). Qualification ids stay non-diagnostic (`21837–21842`). Executor `SNAPBACK_QUERY_COST_*` ids (no HTTP producer in B1) are non-diagnostic (`21845–21862`). Demand-time ids were **removed** from the exclusion list. `graph.rs` is in the S5.D10 scan (`21794`). |
| **B1** | **FIXED** | Rank-0 `graph_query_plan_faults_v1` (`graph.rs:4033`) and engine `graph_query_schema_faults` (`engine.rs:34454`) collect full `BTreeSet`s. `validate_graph_query_admission` reports `.first()` of the union (`34872–34883`). Public `preflight_auth_artifacts` pairs: 17∪22→17, 5∪29→5, 14∪31→14 (`engine.rs:190–258`). |
| **B2** | **FIXED** | `reify_graph_result_contract` (`engine.rs:33981`) vs installed schema; admission exact-compares contract and both hashes (`34840–34850`). Retained-hash rename refuses `RESULT_CONTRACT_MISMATCH` on the public path (`262–278`). |
| **B3** | **FIXED** | Search always inserts/returns `SearchUnadmitted` even with a filled certificate (`graph.rs:3866–3897`, `4286–4294`). Test `graph_stage_b1_search_and_broadcast_are_fail_closed` (`5698–5720`). |
| **B4** | **FIXED** | Literal pages use the same `validate_interval_end` as demand windows (`3733–3741`, `4554–4570`). Frozen `literalPageNegative` including `_id`-in-order (`keyset-vectors.v1.json:13–34`; `graph.rs:5619–5637`). |
| **B5** | **FIXED** | `parent_point_lookup_key_is_valid`: exact `joinOn` arity, non-null, canonical (`4573–4578`, `4897–4911`). Null is a different arm (`ParentLookupSkipped` / `null-or-omitted-key`). Helper negatives at `5759–5768`. |
| **B6** | **FIXED** | `graph_query_v1_schema_round_trips_every_node_kind_through_public_engine_admission` (`engine.rs:322–429`) drives cycle, orphan, two roots, two projections, inert, `RuntimeNow`, `_id` order, undeclared through-table through `preflight_auth_artifacts`, asserts each named reason is in the complete set, and public code is the global min row. Precedence pairs are the B1 test. |
| **B7** | **FIXED** | `GraphQueryV1 => false` (`capability_registry.rs:447`). `no_runtime_consumer` (`graph_corpus_v1.rs:282–333`): four declared targets `is_supported_by == false`, `require_capabilities` → `SNAPBACK_CAPABILITY_UNSUPPORTED`, forged `invoke_query` → `SNAPBACK_FUNCTION_KIND_MISMATCH`. Duplicate engine pin at `432–448`. |
| **B8** | **FIXED** | `#[serde(rename = "base-not-class-1")]` (`graph.rs:788–789`); frozen `serde-vectors.v1.json`; round-trip `5641–5651`. |
| **B9** | **FIXED** | Normalize overwrites query-shaped reason: any non-projection class 2/3 → `BaseNotClass1`, else `DeclaredQueryShaped` (`2881–2892`). Authored mismatch → `PlanIdentityMismatch` (`5653–5676`). |
| **B10** | **FIXED** | Separate `argument_names` / `argument_ids` maps; name in generated `a{i}` set refuses (`2638–2656`). `"A"`/`"a0"` → `ArgumentUnbound` (`5678–5694`; also in the engine 14∪31 pair). |
| **B11** | **FIXED** | Root prefix walks **declared `index.fields`**, not filter JCS / `BTreeSet` order (`engine.rs:34187–34206`, `34559–34573`). `(status, assigneeId)` on `by_status_assignee_updated` admits (`282–319`). JCS field order would be `assigneeId, status` and fail `starts_with`. |
| **B12** | **FIXED** | Authored `classification:"broadcast"` is never rewritten to query-shaped. Class 2/3 → row 23, then 24 always recorded; class-1 certificate → public row 24 (`3979–3996`, `4392–4410`). Tests `5743–5755`. Query-shaped is the only success arm. |
| **MINOR** | **PARTIAL** | Call sites refuse unencodable JCS then sort; `jcs_cmp` itself still `.expect`s (`2255–2258`). `identity_vectors` locks all six hashes + rotations (`graph_corpus_v1.rs:52–242`) but never asserts fixture `domain` strings. Rank-0 kind-allowed parents are implemented (`3766–3798`) with **no** dedicated ParentInvalid fixture. |

---

## New findings

### 1 — MINOR — `jcs_cmp` still panics
- **File:** `crates/snapback-types/src/manifest/graph.rs:2255–2258`
- **Claim:** The round-1 MINOR asked the comparator to refuse. Callers precheck `jcs_sort_key.is_none()` (filters `2498`, visibility `2295`, selectors `2864`, parent keys `4634`), then `sort_by(jcs_cmp)` still `.expect`s.
- **Fix:** Make `jcs_cmp` return `Option<Ordering>` / `Result` so a missed precheck cannot panic on manifest input.

### 2 — MINOR — B6 public reason is often not the named row
- **File:** `crates/snapback-engine/src/local/tests/engine.rs:359–397`
- **Claim:** Orphan/cycle/inert/through insert `nodeId: "n2"` at index 1 → dense-id `UnknownField` (row 8) outranks 9/11/10/13. `_id` in order on `by_updated` adds `IndexPrefixUnsupported` (16) before `OrderNotTotal` (17). The test still correctly asserts `contains(named)` and `public == min(set)`.
- **Fix:** Assign sequential `n{i}` (and, for `_id` order, `accessIndex: "by_id"` as the precedence pair already does) if you want the public code to be the named structural row.

### 3 — MINOR — no kind-allowed-parent negative
- **File:** `crates/snapback-types/src/manifest/graph.rs:3766–3798`
- **Claim:** To-one/to-many/semi-join reject search/projection/semi-join parents, but nothing asserts `ParentInvalid` for that case.
- **Fix:** One rank-0 fixture: equality-to-one parented by exists-semi-join.

### 4 — MINOR — reifier system-field range ≠ shipped table-document contract
- **File:** `crates/snapback-engine/src/local/engine.rs:33838–33841` vs `crates/snapback-types/src/manifest/types.rs:3811–3836`
- **Claim:** Spec §2.2 says projection scalars reuse shipped result-value contracts. Host reifier maps `_version`/`_createdAt`/`_updatedAt` to signed JS-safe integers; `table_document_value_contract` uses `min: 0`. No current B1 fixture projects those fields; mismatch would fail-closed.
- **Fix:** Call the shipped helper (or copy `min: 0`). Also `FieldType::AssetRef { media: Some(_) }` should use `media_result_contract`.

---

## (a0) Graph execution / matcher consumption in this fix?

No. `d012cb5cb` adds admission, a schema reifier, fail-closed search/broadcast, keyset/parent-point checks, and diagnostics. `execute_query_invocation` has **no** `GraphQuery` arm; it hits `_` → `SNAPBACK_FUNCTION_KIND_MISMATCH` (`engine.rs:39180–39184`). Matcher still returns `ConservativeFallback` **before** the dependency gate (`live_matcher.rs:183–191`) and does not inspect the plan.

## (a) `HandlerPlan::GraphQuery` consumers

Every production match is fail-closed or inert:

| Site | Behavior |
|---|---|
| `engine.rs:39180` query dispatcher | `SNAPBACK_FUNCTION_KIND_MISMATCH` |
| `live_matcher.rs:187–191` and `:345` | `ConservativeFallback`; no plan/table skip |
| `engine.rs:39449` `plan_io` | empty reads/writes |
| `engine.rs:26793` completeness | `Ok(None)` |
| `engine.rs:34816`, `36096`; `types.rs:2756`, `2944` | admission / identity only |
| `types.rs:5724` effect ceiling | declared table walk, not execution |
| `types.rs:9815` inspect | kind-only `PublicHostPlanKind::GraphQuery` |
| `generation_activation.rs:603` | order-field byte ceilings (admission-adjacent) |
| server | no `GraphQuery` match |

`CapturedReadKind::GraphNode` is ignored in the matcher (`live_matcher.rs:394`) and fail-closed in OCC (`storage.rs:14984–14989`).

## (b) Six hash domains and canonicalization

Domains match the Spec exactly: `snapback:graph-plan:v1:`, `graph-instance`, `graph-materialization`, `graph-authority-partition`, `graph-broadcast-scope`, `graph-partition-function` (`graph.rs:4452, 4683, 4708, 4766, 4828, 2971`), plus reused `snapback:materialization-args:v1:` and `resultContractHash` as a plan field. Hashing is `serde_json::to_value` → shipped `domain_hash` / JCS.

§2.4 (1)–(5): `deny_unknown_fields` + omit-not-null; preorder DFS with UTF-16 `edgeName` children (`2519–2538`); FilterExpr JCS sort after `argumentId` rewrite (`2490–2501`); Join/Order/projection field order preserved; arguments UTF-16 name then `a{i}`; role/table sets UTF-16 dedup. H2: `_id` banned in `order` and keyset `entries`. Parent keys JCS-sorted (`4634–4649`). `KeysetKeyV1` ↔ `KeysetAfter` field-wise `From`/`Into` with JSON equality on the frozen positive (`storage.rs:8013–8047`). No `HashMap` in the hasher.

## (c) Codex’s six “Spec gaps”

1. **No pre-lowering source carrier** so `CLIENT_AST_FORBIDDEN` / `CODE_FORBIDDEN` / `RECURSION_FORBIDDEN` / `DYNAMIC_CONSTRUCTION` are unreachable from a deserialized plan — **genuine B2 (codegen)**. Rank-0 still emits `CODE_FORBIDDEN` for non-literal/non-arg `ValueExpr` (`4019–4022`). Rows 1/3/4 stay uninhabited until a source AST exists.
2. **§3.3 separation/audience/scope-proof owner inputs not available to B1** — **genuine B2/B3**. B1 host-selects only `base-not-class-1` vs `declared-query-shaped`, and authored `broadcast` always dies at 23 or 24.
3. **Provider-owned search hash preimages not exposed** — **genuine D6 / not B1**. B3 ruling is implemented: every search node is `SEARCH_UNADMITTED`.
4. **No Rust projection→`FunctionResultContract` reifier** — **was a B1 omission; this round implemented it** at engine rank-4 (`engine.rs:33981`). Remaining tightness vs `table_document_value_contract` is MINOR (finding 4).
5. **No request carrier for `CURSOR_UNBOUND` / `QUERY_COST_CLIENT_UNSUPPORTED`** — **genuine B2/G2** (demand-time / live protocol). Codes are now reviewed 400 so they do not inherit fail-safe 500.
6. **`GraphNode` unit variant + sibling `graph` field** — **not a B1 omission**. This is the Spec’s chosen shape (`storage.rs:329–337`, `293–304`). CamelCase wire `graphNode` is serde `rename_all`.

---

**REFUTED-RISK:** forged captured `Query` deps cannot `Skip` a graph (matcher early-return + test `graph_query_v1_no_executor_matcher_is_fail_closed_before_dependencies`). `policyInputs` are sorted before `partitionFunction` hashing, but a reordered authored vector still fails exact proof compare (`§3.1`). Embed façade unchanged. Frozen relational/bounded-children/snapshot-batch arms untouched. No codegen, no corpus file, no evaluator.

VERDICT: READY

## r3 — fix round 2

I'll review the HEAD delta against C1–C4 and the Spec, starting with the review skill, the governing LLP, and the four-file commit.The HEAD commit is four files; next I’ll pull the truncated pieces, LLP 0209’s B1 rules, and the round-2 dispositions.I’ll read the Spec’s cost, presence, hashing, and B1 checklist sections, then walk the four-file implementation against C1–C4.I’ll inspect the reifier, cost-fault accumulation, hash domains, and every `HandlerPlan` match next.## C1–C4

**C1 — FIXED.** Missing data-node cost records are now a separate complete-set probe, not a `BoundInvalid` length miss. `graph_cost_record_faults` (`crates/snapback-types/src/manifest/graph.rs:3297–3322`) inserts row 12 when any non-projection node lacks a cost id, and row 28 only when a cost id is duplicated or names a non-data node. `graph_query_plan_faults_v1` unions that set (`4457`) before fail-fast `validate_graph_costs` (`4458–4459`). Clearing costs on a plan that also collides argument names (`engine.rs:425–450`) yields `UnboundedExpansion` + `ArgumentUnbound`, not `BoundInvalid`; public preflight (`engine.rs:8185`, `34826–34827`) reports row 12. The schema first-fault sentinel still *inserts* into the accumulated set (`34751–34757`), it does not replace it.

**C2 — FIXED.** Object reification resolves `GraphProjectionValueV1::Object.node_id` and `GraphToOnePresenceV1` (`engine.rs:33872–33891`): `Required` → nested `Object`; `Optional` (and `PrincipalBound`) → `Union[Null, Object]`; any other node → `ProjectionScopeInvalid`. That matches Spec §2.1 (`llp/0209-live-graph-profile.spec.md:1015–1020`): parent-scoped object wrapper, JSON `null` on an admitted optional miss, refusal-shaped (non-null) contract on required. `graph_to_one_result_contract_tracks_required_and_optional_presence` (`engine.rs:473–510`) admits both presence values and flips each into `ResultContractMismatch`.

**C3 — FIXED.** `table_document_field_result_contract` (`types.rs:3817–3893`) is the single stored-field mapping (`_id` / `_version|_createdAt|_updatedAt` with `min: 0`, media-qualified `AssetRef` → `media_result_contract`). `table_document_value_contract` and `single_table_delta_contract_matches_schema` call it (`3895–7068`). Graph reification goes through the same helper (`engine.rs:33827–33836`). `_version` + optional media `AssetRef` projection tests (`engine.rs:514–595`) refuse a signed `_version` integer and `Union[Null, AssetRef]`.

**C4 — FIXED.** `jcs_cmp` / `expect("JCS sort values are prevalidated")` are gone. `sort_by_jcs_key` (`graph.rs:2255–2267`) precomputes `Option` keys, refuses, then sorts by those strings. Partition-function kind keys are precomputed the same way (`2955–2964`). `graph_jcs_sort_refuses_fallible_keys_without_panicking` (`5739–5762`) covers the refusal path. No remaining `jcs_cmp` in this crate.

---

## New findings

None MATERIAL.

**REFUTED-RISK — `validate_graph_costs` still fail-fasts after the missing-id check** (`graph.rs:3391–3398`). A present-but-malformed cost on another node is not unioned once row 12 already fired. C1’s required case is missing-cost ∪ other-phase faults; public precedence is row 12. Not a leftover C1 miss.

**REFUTED-RISK — principal-bound objects are always `Union[Null, Object]`** (`engine.rs:33883–33885`). Spec gives principal-bound no `presence` field; completeness allows contract-declared nullability. C2 only required the to-one presence split.

**REFUTED-RISK — optional media is `Union[Null, MediaRefV1 { optional: true }]`**. That is the pre-existing document mapping C3 was asked to share, not a graph-only spelling.

---

## Answers

**(a0)** No. The four-file delta does not add an evaluator, matcher arm, or dependency consumer.

**(a)** `HandlerPlan::GraphQuery` has no runtime consumer.

| Site | Behavior |
| --- | --- |
| `execute_query_invocation` (`engine.rs:39130–39134`) | no `GraphQuery` arm → `SNAPBACK_FUNCTION_KIND_MISMATCH` (`graph_corpus_v1.rs:327–332`) |
| live matcher (`live_matcher.rs:187–191`, `345–349`) | `ConservativeFallback` *before* the dependency gate; second arm also fallback |
| live delta (`engine.rs:30574` `_ => None`) | no incremental plan |
| I/O summary (`engine.rs:39399`) | empty reads/writes |
| completeness issuance (`engine.rs:26793`) | `Ok(None)` |
| schema/load (`36046–36047`, `8185`, `8646`) | admission only |
| types validate / inspect (`types.rs:2756`, `2944`, `9726`) | carrier identity; public kind only |
| effect ceiling (`types.rs:5731–5794`) | declared reads, not evaluation |
| activation (`generation_activation.rs:603–615`) | order-field byte ceilings |
| mutation/dry-run | kind mismatch / not a mutation |

**(b)** The six domains and preimages match Spec §2.4 / §§3.1–3.3:

- `snapback:graph-plan:v1:` over normalized `GraphQueryPlanV1` (`4497`)
- `snapback:graph-instance:v1:` over `{format, graphPlanHash, argsDigest, windows}` (`4728`)
- `snapback:graph-materialization:v1:` over the LLP 0157 wrapper (`4753`)
- `snapback:graph-partition-function:v1:` over the `policyInputs` vector, no wrapper (`2974`; Spec `969–971`)
- `snapback:graph-authority-partition:v1:` (`4811`)
- `snapback:graph-broadcast-scope:v1:` (`4873`)

`domain_hash` is SHA-256(domain ‖ JCS) with no extra newline (`types.rs:7074–7085`). Canonicalization: (1) required fields materialized; (2) preorder UTF-16 `edgeName` (`2538–2539`), filter JCS sort after argument-id rewrite (`2501–2504`), arguments UTF-16 name (`2640`), `joinOn`/`order`/projection `fields` unsorted, role/table sets UTF-16 dedup; (3) JCS via `domain_hash`; (4)–(5) plan hash is the normalized plan including `queryCost` / authority / broadcast / `resultContractHash`, excluding runtime args/cursors. H2: `validate_keyset_for_order` rejects `_id` in `entries` and requires `entries` 1:1 with declared order (`3016–3028`). Parent keys sort by JCS (`4680–4693`).

**(c)** Codex “Spec gaps”:

| Gap | Verdict |
| --- | --- |
| `CLIENT_AST_FORBIDDEN` / `CODE_FORBIDDEN` / `RECURSION_FORBIDDEN` / `DYNAMIC_CONSTRUCTION` unreachable from a deserialized plan | **B2/codegen-owned.** B1’s closed IR has no pre-lowering source carrier; rows 1–4 are compiler-time. Not a B1 omission. |
| §3.3 separation/audience/scope-proof owner inputs | **B2-owned.** B1 fail-closes authored broadcast (`4454`). Proof construction is compiler work. |
| provider-owned search hash preimages | **B2/D6-owned.** B1 always `SearchUnadmitted` (`4337`). |
| no Rust projection → `FunctionResultContract` reifier | **Was a B1 omission; closed** by round 1 + this C2/C3 helper. |
| no request carrier for `CURSOR_UNBOUND` / `QUERY_COST_CLIENT_UNSUPPORTED` | **B2/G2-owned.** Demand-time; needs request/connection. |
| `CapturedReadKind::GraphNode` unit variant + sibling `graph` field | **Not a gap.** Spec-ratified B1 shape (`0209:3136–3137`; `storage.rs:291–337`). |

VERDICT: READY

## r4 — fix round 3

I'll review the round-3 delta against D1–D2 and the Spec, starting with the HEAD commit and the LLP 0209 constraints.HEAD is the round-3 pairing/cost-fault delta. Next I’ll pull Spec text and the cost/carrier implementations to judge D1–D2.I'll read the Spec cost/carrier sections and the current validation/deserialization implementations next.I’ll pull the round-2 review text, the rest of cost validation, HandlerPlan arms, and hash-domain implementations.Engine `GraphQuery` arms exist — I’ll trace those paths plus inspect/activation to confirm they’re fail-closed, not execution.I’ll run the targeted `snapback-types` tests for the cost-fault set and GraphNode pairing.## Prior findings

**D1 FIXED.** Complete cost-fault collection is in `graph_cost_faults` (`crates/snapback-types/src/manifest/graph.rs:3372`), which `graph_query_plan_faults_v1` unions (`:4543`). Missing data-node cost → `UnboundedExpansion` (row 12) at `:3385`. Duplicate/extra ids → `BoundInvalid` (row 28) at `:3391`. Present records that fail kind-conditional presence/range/`ClosedProjection` → `BoundInvalid` via `graph_cost_record_is_malformed` (`:3297`, `:3397`). `validate_graph_costs` is still first-error for the analytical walk and is unioned (`:3405`); the public first miss is the ladder minimum (`validate_graph_query_plan_v1` `:4563`). Specified test `graph_cost_faults_include_missing_and_malformed_present_records` (`:6033`) removes n1’s cost, zeros n0 `maxExaminedEntriesPerExecution`, asserts both faults, and public `Err(UnboundedExpansion)`. Ran: pass.

**D2 FIXED.** `CapturedReadDependency` no longer derives `Deserialize`. Custom impl (`crates/snapback-types/src/storage.rs:351`) rejects unpaired `graph` with `CAPTURED_READ_GRAPH_PAIRING_ERROR` (`:23`, `:394`). `graph_pairing_is_valid` (`:343`) is `kind == GraphNode` iff `graph` is `Some`. Schemars `if/then/else` (`:294`) matches Spec §5.1 “required exactly when `kind == GraphNode`”. Tests cover missing GraphNode payload, extra payload on `auth`, valid pair (`:445`), and schema text (`:471`). `schemas/action.output.schema.json:55` is the only JSON schema that embeds the carrier; it was regenerated. Sync helper is now a one-line delegate (`crates/snapback-sync/src/graph_captured_read.rs:16`). Ran pairing + schema tests: pass.

---

## New findings

**MINOR — leftover `deserialize_with` on a type that no longer derives `Deserialize`.** `CapturedReadDependency.graph` still carries `deserialize_with = "deserialize_optional_non_null"` (`storage.rs:311`) even though deserialize goes through `Wire` (`:357`). Harmless; delete the field-level deserialize attrs or document that they apply only to the wire helper.

**MINOR — sync helper still public.** `graph_capture_carrier_is_well_formed` remains as a wrapper. Fine as an in-memory check (struct literals can still skip serde); not required on the wire path.

**REFUTED-RISK — in-memory unpaired `GraphNode`.** Struct literals can still build `kind: GraphNode, graph: None`. Authored JSON cannot: serde is the wire gate. Kernel OCC fail-closes GraphNode reads (`crates/snapback-kernel/src/storage.rs:14984`). Not an authored-field bypass.

**REFUTED-RISK — JSON Schema `else: { not: { required: ["graph"] } }`.** That spelling forbids the `graph` key, not merely making it optional. Matches deserialize (`storage.rs:294` vs `:343`).

**REFUTED-RISK — this delta did not add execution or matcher consumption.** Diff is cost-fault collection, pairing deserialize, helper delegate, schema regen.

---

**(a0)** No. HEAD only touches `graph.rs` cost faults, `storage.rs` pairing, the sync wrapper, and `action.output.schema.json`.

**(a)** `HandlerPlan::GraphQuery` has no runtime consumer. Traced matches:

| Site | Behavior |
| --- | --- |
| `live_matcher.rs:187` | `ConservativeFallback` **before** the dependency gate |
| `live_matcher.rs:345` | same fallback (unreachable for GraphQuery after the early return) |
| `live_matcher.rs:394` | `GraphNode` kind ignored in generic deps (no graph matching) |
| `engine.rs:39130` (`execute_query_invocation` `_`) | `SNAPBACK_FUNCTION_KIND_MISMATCH` — test `graph_query_v1_forged_engine_invocation_has_no_executor` |
| `engine.rs:39399` | `plan_io` returns empty tables |
| `engine.rs:36046`, `:34777` | schema/admission only; `reify_graph_result_contract` is admission reconstruction |
| `types.rs:2756`, `:2944` | carrier/identity validation |
| `types.rs:5731` | read-set *summary* from declared nodes, not evaluation |
| `types.rs:9726` | inspect: `PublicHostPlanKind::GraphQuery` only |
| `generation_activation.rs:603` | portable order-byte ceiling register |
| `storage.rs:14984` | mutation OCC: `SNAPBACK_CAPTURED_READ_INVALID` |
| Capability | `GraphQueryV1 => false` (`capability_registry.rs:447`) |

No server/export arm executes it. Fail-closed or inert everywhere.

**(b)** The six dedicated domains match Spec §2.1/§2.4/§3.2/§3.3, all via `graph_domain_hash` → shipped `domain_hash` (JCS then SHA-256, `sha256:` + 64 lowercase hex):

| Domain | Site |
| --- | --- |
| `snapback:graph-plan:v1:` | `graph.rs:4580` |
| `snapback:graph-instance:v1:` | `:4811` |
| `snapback:graph-materialization:v1:` | `:4836` |
| `snapback:graph-partition-function:v1:` | `:2974` (JCS of `policyInputs` vector) |
| `snapback:graph-authority-partition:v1:` | `:4894` |
| `snapback:graph-broadcast-scope:v1:` | `:4956` |

Canonicalization: (1) hash is over `normalized_graph_plan` (`:2571`, `:4578`); (2) preorder DFS, children by UTF-16 `edgeName` (`:2537`), filters JCS-sorted after `argumentId` rewrite (`:2473`, `:2504`), `JoinEquality`/`OrderExpr` not reordered, projection field order preserved, arguments UTF-16 by name (`:2640`); (3) RFC 8785 JCS via `domain_hash`; (4) whole `GraphQueryPlanV1` including costs/authority/broadcast/`resultContractHash`; (5) demand/runtime facts live on instance/materialization preimages, not the plan. H2: `validate_order` / `validate_keyset_for_order` refuse `_id` in `order`/`entries` (`:3001`, `:3016`); `id` is the tie-break. Parent keys: `sort_by_jcs_key` on `parentKey` (`:4763`). `KeysetKeyV1` ↔ `KeysetAfter` is field-copy both ways (`crates/snapback-kernel/src/storage.rs:8013`).

**(c)** Codex’s six “Spec gaps”:

1. **Rows 1–4 unreachable from a deserialized plan** — **B2/codegen-owned**, with one B1 exception. The IR has no pre-lowering AST (`defineGraphQuery` is not in this landing). `CLIENT_AST_FORBIDDEN` / `RECURSION_FORBIDDEN` / `DYNAMIC_CONSTRUCTION` are never inserted from plan JSON. `CODE_FORBIDDEN` **is** reachable on IR `ValueExpr` that is not Arg/Literal (`graph.rs:2492`, `:4151`). Cycles are row 11, not row 3.
2. **§3.3 separation/audience/scope-proof owner inputs** — **B2-owned**. B1 fail-closes authored `classification:"broadcast"` at row 24 (`graph.rs:4125`) instead of proving or downgrading. Correct for B1; owner proof wait for schema/policy.
3. **Provider search hash preimages** — **B2/B3-owned**. Graph must not evaluate search; membership identity is a certificate, not a host-recomputed provider preimage.
4. **No Rust projection→`FunctionResultContract` reifier** — **was a B1 omission; fixed in round 2**, still present (`engine.rs:33931`, used at `:34790`). Not a remaining gap.
5. **No request carrier for `CURSOR_UNBOUND` / `QUERY_COST_CLIENT_UNSUPPORTED`** — **demand-time / G2**. Reasons exist on `GraphDemandTimeRefusalReasonV1` (`graph.rs:541`); cursor/protocol carriers are not B1 admission inputs (Spec `:1209`).
6. **`GraphNode` unit variant + sibling `graph` field** — **not a gap**. Spec §5.1 `[author-ratify]` chose one additive kind plus optional payload (`llp/0209-live-graph-profile.spec.md:2547`). Round 3 now enforces that pairing.

VERDICT: READY

## r5 — fix round 4 (targeted codex re-check of the sole open finding; grok READY since r3)

(no grok run this round: grok was READY on the prior revision and the delta addressed only codex's finding)
