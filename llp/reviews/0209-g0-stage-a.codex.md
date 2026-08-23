# LLP 0209 G0 Stage A — codex review record

**Document:** `llp/0209-live-graph-profile.spec.md` v0.5 (G0 Stage A)
**Reviewer:** codex gpt-5.6-sol, reasoning effort xhigh, read-only, blind to the other family each round
**Orchestrator:** Claude Fable 5 (session snapback-44), under `issues/20260823-llp0209-g0-commission.md`
**Date:** 2026-08-23
**Provenance:** every review below was actually received from the named model; verbatim text follows per round. Nothing here is authored by the orchestrator except this header and the round labels.

## Verdict ledger

| Round | Reviewed commit | Verdict |
| --- | --- | --- |
| r1 | 228bebbe3 Stage A draft | VERDICT: NOT READY (8 MATERIAL) |
| r2 | 7c01acb13 fix round 1 | VERDICT: NOT READY (6 MATERIAL) |
| r3 | eb6f296e2 fix round 2 | VERDICT: NOT READY (7 MATERIAL) |
| r4 | 63cc68b89 fix round 3 | VERDICT: NOT READY (6 MATERIAL) |
| r5 | 12dbe6e7d fix round 4 | VERDICT: NOT READY (4 MATERIAL) |
| r6 | 55557e0fc fix round 5 | VERDICT: NOT READY (1 MATERIAL) |
| r7 | 90f55302f fix round 6 | VERDICT: READY |

## r1 — 228bebbe3 Stage A draft

Not ready: 8 MATERIAL findings. The checkout remained unchanged and clean.

## MATERIAL

1. **§2.1–§2.2 — the claimed closed IR is not actually a closed wire grammar.**  
   **Claim:** Stage B can implement `GraphNodeV1`, Rust/Serde types, and generated JSON Schema directly from the Spec.  
   **Evidence:** The exact carrier references `GraphNodeV1`, but no exact union is defined ([LLP 0209:155](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:155)). The table introduces undefined wire shapes including `GraphProjectionObjectV1`, `GraphIntervalEndV1`, `scopeBindings`, `membershipIdentity`, and `providerCompletenessClass` ([LLP 0209:227](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:227)); `GraphInstanceIdentityV1` appears only in the checklist. Page literal-versus-argument spelling, projection literal payload/output cardinality, and identity-wrapper placement are likewise absent. Yet Stage B must generate Rust and JSON Schema without making new design decisions ([LLP 0209:1228](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1228)).  
   **Fix:** Define every new tagged union and record exactly, including required/optional/null spellings, page argument references, projection/root-result encoding, search certificate fields, and the carrier that transports `{normalizedPlan, planHash}`.

2. **§2.4 — instance identity omits independently pageable child windows.**  
   **Claim:** Equal instance hashes close every demand value strongly enough for byte-equivalence.  
   **Evidence:** `bounded-to-many` explicitly permits independently pageable child intervals ([LLP 0209:231](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:231)), and all cursor/direction/page/range values are removed from canonical arguments ([LLP 0209:331](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:331)). But `GraphInstancePreimageV1` contains only one unkeyed `window` record, with no `nodeId` or child-window vector ([LLP 0209:340](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:340)). Two demands can therefore share an instance hash while selecting different child pages.  
   **Fix:** Hash a canonical node-ordered window vector containing every pageable node’s `nodeId`, order, direction, interval, take, and applicable ledger; define any per-parent window identity explicitly.

3. **§2.4 — the broadcast identity omits the contextual namespace required for byte-equivalence.**  
   **Claim:** `graphInstanceHash × partition × authorizationVersion × cut` implies identical bytes.  
   **Evidence:** The preimage deliberately excludes target, deployment, function, and generation ([LLP 0209:312](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:312)). LLP 0190’s required admission axes include app/database/target and exact activation identity ([LLP 0190:327](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0190-zerobugs-retained-facts-local-evaluation.spec.md:327)); the existing contextual precedent hashes precisely those axes ([LLP 0157:752](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0157-composition-algebra-and-completeness.spec.md:752)). LLP 0268 then keys a group directly from the G0 instance and scope identities ([LLP 0268:158](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0268-broadcast-shaped-realtime.rfc.md:158)). Equal inner hashes from different databases/generations can name different data.  
   **Fix:** Define an outer host-recomputed graph evaluation/materialization identity incorporating app, database, deployment, target profile, activation/generation, and function identity, and make the broadcast key consume it. Alternatively, normatively scope the registry by all those axes and narrow the byte-equivalence claim accordingly.

4. **§2.3 — two “admission” refusals depend on evidence unavailable to admission.**  
   **Claim:** The host/codegen can apply every refusal in the declared precedence.  
   **Evidence:** `SNAPBACK_GRAPH_BOUND_INVALID` includes “omits a required fixture derivation,” and `SNAPBACK_GRAPH_AUTHORITY_CORPUS_MISMATCH` requires a qualification paired world ([LLP 0209:281](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:281)). Neither derivations nor qualification receipts exist in `GraphQueryPlanV1`; the corpus is a separate Stage B artifact ([LLP 0209:1202](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1202)). A normal manifest admission cannot evaluate either condition.  
   **Fix:** Reclassify these as qualification/G0-exit failures outside admission precedence, or add a host-verifiable, identity-bound measurement/qualification receipt to the admitted artifact.

5. **§3.3 — `baseNodeIds` does not close LLP 0268’s complete delivered base.**  
   **Claim:** The broadcast certificate proves every observable fact is class 1.  
   **Evidence:** The carrier requires only “result- and delta-contributing” nodes ([LLP 0209:687](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:687)). Yet graph completeness consumes every non-projection node ([LLP 0209:859](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:859)), while Accepted LLP 0268 explicitly includes completeness and refusal in the delivered base ([LLP 0268:67](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0268-broadcast-shaped-realtime.rfc.md:67)). A reachable, unprojected class-2/3 node can affect completeness while being omitted from `baseNodeIds`.  
   **Fix:** Host-recompute `baseNodeIds` as every node affecting bytes, membership, order, length, existence, completeness, refusal, or future delta construction—including all §4.2 inputs—or reject inert/unobservable nodes and define the resulting exact set.

6. **§3.3 G0-BCAST-BOUNDS — the mapped artifact cannot carry the required group-state bound.**  
   **Claim:** `queryCost.graph` plus the three ordinary live ceilings satisfies LLP 0268’s bounds input.  
   **Evidence:** The mapping promises group-state bytes but names only graph result/work fields plus `maxObservers`, `maxDistinctEvaluationGroups`, and `maxEstimatedLiveFanoutMs` ([LLP 0209:743](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:743)). LLP 0268 requires normal/large group-state and fan-out bounds ([LLP 0268:471](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0268-broadcast-shaped-realtime.rfc.md:471)) and hard bounds group/subscriber/row/byte/frame/handoff state ([LLP 0268:383](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0268-broadcast-shaped-realtime.rfc.md:383)). LLP 0267’s `maxResultBytes` covers only authored-result serialization, while its live fields are explicitly orthogonal ([LLP 0267:534](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0267-query-cost-guardrails.rfc.md:534), [LLP 0267:568](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0267-query-cost-guardrails.rfc.md:568)). None bounds dependency/group-state bytes or frame/handoff state.  
   **Fix:** Add the required hard fields to the sole `queryCost` carrier through an Accepted-owner amendment, or specify a checked derivation from existing fields that provably bounds every retained group-state component.

7. **§5.1 — valid dependency cases are unrepresentable.**  
   **Claim:** `GraphCapturedReadV1` covers every admitted node kind.  
   **Evidence:** `exists-semi-join` has an `argumentId` only in `all` mode ([LLP 0209:232](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:232)), but every `membership` dependency requires `argumentId` and `argumentDigest` ([LLP 0209:956](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:956)). Likewise, null/omitted to-one attempts and misses must be captured, but `parent-point` requires `childKey` and `rowVersion` with no absent spelling ([LLP 0209:952](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:952), [LLP 0209:977](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:977)).  
   **Fix:** Split these dependency variants or define exact nullable/absent forms—for example nullable argument fields for plain `exists`, and nullable child key/version on misses—with canonical validation rules.

8. **§2.6/§9 — Stage B forbids the executor needed to produce LLP 0267’s observations.**  
   **Claim:** Stage B can populate per-node `StructuralWorkV1`, physical examined entries, relationship attempts, and cumulative window ledgers while no evaluator executes the graph.  
   **Evidence:** Stage B explicitly says no server or local evaluator executes `GraphQueryPlanV1` ([LLP 0209:1198](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1198)), while the bound rules demand actual node-attributed physical consultations and cumulative index ranges ([LLP 0209:471](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:471)). Accepted LLP 0267 defines those as actual consultations carrying `nodeId` and requires one executed normal/large run with a complete observation ([LLP 0267:116](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0267-query-cost-guardrails.rfc.md:116), [LLP 0267:571](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0267-query-cost-guardrails.rfc.md:571)). An opaque JS oracle can establish result bytes but cannot measure a different, unexecuted graph access plan’s physical work.  
   **Fix:** Add a test-only reference graph executor/storage observer with exact node-attribution rules while keeping it off production/runtime registration, or defer physical bound qualification and amend LLP 0267’s G0 consumption contract.

## MINOR

1. **§2.6:493 — the large-fixture label mean is factually wrong.** The Spec says 1.5 labels/issue and about 1,500 child rows. The frozen facts are 2,000,370 edges over 1,000,000 issues, or 2.00037 per issue ([acceptance.v1.json:74](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/demos/zerobugs/manifest/acceptance.v1.json:74)); the inventory explicitly says the 1.5 generator knob is ineffective ([inventory.v1.md:210](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/demos/zerobugs/stage0/inventory.v1.md:210)). Fix the text to “about 2,000 child rows”; the conclusion that 1,024 is insufficient remains valid.

2. **Open questions:1340 — OQ-1 is still presented as proposed/open after Stage A landed.** The normative sections and checklist apply the sibling-arm ruling, but this entry still asks extend-versus-migrate and says “ruling proposed” ([LLP 0209:1340](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1340)). Fix the heading to “Resolved 2026-08-23” and state the sibling ruling directly.

## REFUTED-RISK

- **OQ-1 semantic drift:** Checked throughout. §§2.5 and 9 consistently add `HandlerPlan::GraphQuery`, freeze the three existing carriers and corpora, forbid G0 migration, and defer degenerate equivalence to G2 ([LLP 0209:376](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:376), [LLP 0209:1236](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1236)). No normative section assumes extend-in-place or migration.

- **Cited `path:line` drift:** Checked all newly introduced source citations. The carrier structs, identity/hash functions, matcher arms, dependency enum, constructor locations, Zerobugs schema/functions, corpus start, and fixture anchors say what the Spec claims. No MATERIAL citation mismatch found.

- **Root and maintained-write candidates:** The hot fixture really is a 1,000-issue working set ([acceptance.v1.json:94](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/demos/zerobugs/manifest/acceptance.v1.json:94)), so 1,024 is a defensible provisional root ceiling. Zero maintained writes is also consistent with Stage B having no maintained graph facts. The 1,024 summed-window rejection remains correct—and is stronger using the actual 2,000,370 label-edge count.

(a) No: not all nine deliverables are concrete enough for Stage B. Deliverables 1, 2, 5, 7, and 8 have the blocking gaps above; 3 is weakened by the broadcast-base closure hole; 4 is substantially concrete; 6 can at least produce stable refusals once the wire grammar is fixed; and 9 is concrete. Deliverable 7 is weakest because its required evidence cannot be generated under Stage B’s own no-evaluator rule.

(b) The OQ-1 sibling-arm/frozen-carrier ruling is applied consistently in all normative implementation and exit sections. Nothing still relies on widening a shipped carrier or migrating its corpus. Only the stale “Open questions / ruling proposed” wording remains.

(c) The fixture anchors support the 1,024 root candidate and zero maintained-write value, and they reject a 1,024 summed graph window even more decisively than stated. They do not validate the 1.5 label mean: the actual large-fixture mean is 2.00037, while comments average 2.527886 rather than the generator knob’s 3.0. More importantly, the physical per-node and cumulative derivations are not soundly obtainable until Stage B defines an executable measurement path for the normalized graph.

VERDICT: NOT READY (8 MATERIAL)

## r2 — 7c01acb13 fix round 1

## 1. Disposition check

| Finding | Status | Evidence |
|---|---|---|
| M1 | FIXED | [§2.1](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:513) defines the `nodeId`-keyed window vector, and [§2.4](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:777) requires exactly one entry for every demand-paged node with per-parent child intervals. |
| M2 | FIXED | [§2.4](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:800) explicitly excludes the ledger from identity and assigns one authenticated ledger lineage to each demand-paged node; `priorLedger` is absent. |
| M3 | FIXED | [§2.1](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:596) specifies emit-then-recurse preorder DFS, UTF-16 `edgeName` sorting, projection-last numbering, and an `n0`/`n1`/`n2` example. |
| M4 | FIXED | [§3.3](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1144) recomputes `baseNodeIds` over every listed observable and [§2.3](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:690) refuses unreachable or inert nodes. |
| M5 | FIXED | [§2.6](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:963) defines the exit observation carrier, while [the G0-BCAST-BOUNDS row](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1185) uses declarations plus those observations and assigns hard group-state/frame/handoff fields to B1 through an LLP 0267 amendment without naming the three live fields as this carrier. |
| M6 | FIXED-BUT-INTRODUCED runtime refusals remain in the admission-only ladder | The two corpus/derivation failures were correctly moved to qualification at [lines 711–720](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:711), but `CURSOR_UNBOUND` and the instance/materialization portions of `IDENTITY_MISMATCH` require runtime inputs despite admission being declared manifest/schema/policy-only at [lines 674–675](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:674). |
| M7 | FIXED | [§5.1](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1527) gives point hits/misses exact nullable fields and gives plain `exists` `argumentId:null` with `argumentDigest` absent, while `all` requires both non-null fields. |
| M8 | PARTIAL | The requested records and fail-closed matcher arm are present at [§2.1](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:166) and [§2.5](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:873), but projection field scope and row correlation remain undefined. |
| M9 | FIXED-BUT-INTRODUCED unexecutable/incomplete corpus carriers | All seven case kinds and all nine label mappings exist at [§3.4](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1187) and [§3.3](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1175), but several cases omit the invocation inputs needed to execute them and the expected-result carrier lacks the required per-node completeness proofs. |
| M10 | PARTIAL | [§9](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1891) adds a per-query field map and justified exclusions, but its `"exact-label"` comparison cannot compare the graph vocabulary to the oracle’s different status vocabulary, and outer `status`/`reason` are not dispositioned. |
| M11 | FIXED | [§2.4](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:811) defines the LLP 0157-style contextual wrapper, requires broadcast/cross-process use of the outer hash, and limits inner-identity byte equivalence to one materialization context. |
| RULED | NOT FIXED | Although [§2.6](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:896) states the required logical/physical split, it marks it `[author-ratify]`, repeats that posture at [§9](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1943), and expressly permits ratification **or override** at exit, contrary to “RULED, not a free choice”; LLP 0267 still normatively requires G0 observations at [§5 lines 511–574](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0267-query-cost-guardrails.rfc.md:511). |
| MINOR | PARTIAL | The operative table fixes 2.00/2.53, maxima, `maxScannedRows`, OQ-1, and citations, but the current revision history still says 1.5 labels at [line 2196](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2196), and the packet still says 3.0/1.5 at [lines 141–148](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/issues/20260823-llp0209-g0-commission.md:141). |

## 2. New MATERIAL findings

1. **The admission ladder requires unavailable runtime facts.** `SNAPBACK_GRAPH_CURSOR_UNBOUND` requires arguments, authority partition, cursor windows, and ledger lineage; `SNAPBACK_GRAPH_IDENTITY_MISMATCH` includes instance/materialization records ([§2.3](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:698)). Neither is decidable from the candidate manifest, schema, and policy alone.  
   **Fix:** define a third ordered runtime-demand refusal register; move cursor binding and runtime identity checks there, leaving only plan/base-node reconstruction in admission.

2. **Projection correlation is not specified.** `GraphProjectionValueV1.field` can name any `nodeId`, while nested `object`/`array` only constrain their container kind ([§2.1](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:249)); nothing defines whether fields may reference ancestors, siblings, descendants, or to-many nodes, nor which row supplies such a reference. Different evaluators can therefore emit different bytes or expose an unintended row.  
   **Fix:** define a lexical row scope for every projection object, exact legal relative references, ancestor repetition rules if allowed, and refusal for ambiguous/cross-cardinality references.

3. **The closed corpus union cannot carry its mandated evidence.** `audienceParity`, `scopeMismatch`, `authorityTransition`, and `mixedCommit` omit canonical graph arguments and/or window vectors ([§3.4](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1262)); a materialization hash is not reversible. Separately, `GraphCorpusExpectedResultV1` carries one completeness tuple, while §4.1 and checklist row 4 require per-node plus composed labels/proofs ([lines 1208–1231](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1208)).  
   **Fix:** introduce one reusable closed invocation record containing plan, args, windows, materialization, partition/version, and cut; require it in every executable arm; add the canonical `NodeCompletenessV1[]` plus composed proof; make refused cases a discriminated form that does not require an impossible materialization.

4. **Oracle “exact-label” parity is impossible against the cited handlers.** The graph vocabulary is `unknown|complete|prefix|window|refused`, but the oracle returns `complete|incomplete|refreshing|not-found-authoritative` ([functions.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/demos/zerobugs/control/snapback/functions.mjs:2488)); page-limited results are specifically `status:"incomplete"` with `reason:"page-limit"` ([functions.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/demos/zerobugs/control/snapback/functions.mjs:3240)).  
   **Fix:** define a closed, reason-sensitive translation table to graph labels/refusals—or explicitly exclude those fields with reasons—and disposition every outer `status` and `reason` field for all three queries.

5. **The commissioning packet now contradicts the amended Stage B contract.** It still requires two-layer identity ([lines 52–57](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/issues/20260823-llp0209-g0-commission.md:52)), says paired-world falsification occurs at admission, forbids matcher changes ([lines 104–108](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/issues/20260823-llp0209-g0-commission.md:104)), and requires G0 `StructuralWorkV1` physical observations ([lines 146–154](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/issues/20260823-llp0209-g0-commission.md:146)). Those conflict with M6, M8, M11, and the ruled G2 observation posture.  
   **Fix:** reconcile the packet in the same docs landing, including contextual identity, qualification phase, the one fail-closed matcher arm, and analytical physical declarations.

## 3. MINOR

- Replace the stale 1.5/3.0 means in both the revision history and packet; retain the “maxima, not means” instruction.
- Use a two-sibling DFS example so the claimed UTF-16 ordering is exercised rather than merely stated.
- Tighten `Sha256V1` from `sha256:${string}` to the exact lowercase 64-hex schema pattern. Host recomputation is fail-closed, but the generated JSON Schema should express the claimed wire restriction.
- `./ref-check --verbose` is green; the citation-line repairs themselves are sound.

## 4. Wire-grammar assessment

No. The record and union inventory is substantially complete, but Rust plus JSON Schema do not eliminate the remaining projection design decision: `field`, nested `object`, and `array` references lack exact row-scope and correlation rules. The schema can encode the current permissive shapes, but admission and evaluation would still have to invent which cross-node references are legal and which row each reference denotes.

VERDICT: NOT READY (6 MATERIAL)

## r3 — eb6f296e2 fix round 2

## 1. Disposition check

- **R1 — PARTIAL.** [§2.3 lines 740–807](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:740) splits plan/demand identity and limits §4 refusal composition correctly, but admission row 1 still depends on a runtime argument despite admission being manifest/schema/policy-only, and the qualification register has no defined internal precedence.

- **R2 — FIXED.** [§2.1 lines 597–653](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:597) defines lexical scope, correlation, to-one null behavior, array ordering, invalid cross-cardinality references, and the worked issue/labels/label example; predicate-only semi-joins expose only `exists` and create no row scope.

- **R3 — FIXED-BUT-INTRODUCED open completeness-proof grammar.** [§3.4 lines 1346–1554](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1346) supplies reusable invocation records, two invocations where needed, non-materializing refusals, per-node completeness, and composed completeness, but both proof payloads remain arbitrary `CanonicalClientValueV1`.

- **R4 — PARTIAL.** [§9 lines 2113–2212](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2113) lists reason-sensitive translations and rejects unlisted pairs, but `GraphOracleLabelTranslationV1` cannot encode the continuation/zero-row precondition that prose declares part of the key—for example `(incomplete,null)` maps comments to either `window` or refusal depending on `commentsCursor`.

- **R5 — FIXED.** [Packet lines 52–67](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/issues/20260823-llp0209-g0-commission.md:52), [108–176](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/issues/20260823-llp0209-g0-commission.md:108), and [287–300](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/issues/20260823-llp0209-g0-commission.md:287) now carry three-layer identity, qualification-time paired worlds, exactly one fail-closed Stage B matcher arm, the ruled logical/physical posture, and the corrected 2.53/2.00 figures.

- **R6 — FIXED.** [§2.1 lines 372–405](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:372), [§2.4 lines 890–900](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:890), and [§2.6 lines 987–994](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:987) require six maxima per demand-paged node, bind each ledger to the full requested tuple and per-parent interval vector, and derive the graph rollup by checked sums.

- **R7 — PARTIAL.** [§2.6 lines 1018–1063](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1018) adds the requested table, refusal, and example, but lines 1024–1026 require plan declarations to substitute `maxChildrenPerParent` while the worked `queryCost.maxScannedRows` uses the request’s `take=50`; the function also never counts the second point consultation in a principal binding or the target consultation in a `ThroughEdgeV1`.

- **RULED — FIXED.** [§2.6 lines 996–1012](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:996) and [§9 lines 2222–2229](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2222) state that the split was ruled on 2026-08-23 and is author-ratified at v0.6, without retaining an override option for that ruling.

- **MINOR — PARTIAL.** Broadcast tagging, order identity, allow-result expectation, result-byte ownership, join direction, SHA pattern, DFS example, and 2.00 history are fixed, but [§2.2 lines 702–708](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:702) still leaves Stage B to choose between moving/re-exporting `KeysetAfter` and introducing `KeysetKeyV1`.

## 2. New MATERIAL findings

1. **Completeness proofs are not closed.** `NodeCompletenessV1.proof` and `GraphCorpusGraphCompletenessV1.proof` are arbitrary canonical JSON at [lines 1373–1398](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1373), while [§4.1 lines 1638–1646](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1638) supplies only prose fields.  
   **Fix:** define discriminated proof unions keyed by node kind, label, and proof class, plus exact composed-prefix/window/all-complete proof records.

2. **Broadcast non-eligibility is simultaneously an admission refusal and a successful query-shaped classification.** [Admission rows 23–26](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:773) refuse failed broadcast proofs, while [§3.3 lines 1314–1316](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1314) and [LLP 0268 §1.2](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0268-broadcast-shaped-realtime.rfc.md:133) require such graphs to classify query-shaped.  
   **Fix:** separate valid non-eligibility from malformed/counterfeit certificate admission failure and introduce a closed query-shaped reason enum, including ordinary class-2/class-3 ineligibility.

3. **The class-2 proof carrier is undefined.** [§3.1 lines 1193–1199](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1193) requires `GraphPartitionEquivalenceProofV1`, but it is absent from §2.1’s grammar and unexpanded-owner-type list, while the exit checklist says its proof report is embedded in normalized plans.  
   **Fix:** define its exact closed type, placement, normalization, and hash/reference relationship, then identify its precise field in `GraphQueryPlanV1`.

4. **The required oracle order is not representable for descending ties.** The graph requires ascending `_id` as the final tie-break at [§2.2 lines 702–704](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:702), consistent with [LLP 0007](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0007-storage-and-schema.spec.md:378), but the cited oracle multiplies the ID comparison by the requested direction at [functions.mjs lines 2824–2833](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/demos/zerobugs/control/snapback/functions.mjs:2824).  
   **Fix:** repair the oracle’s descending tie-break before freezing parity, or explicitly freeze descending tied-order cases as refusals rather than claiming exact graph parity.

## 3. MINOR

- The packet still titles OQ-1 “ruling proposed, applied unless overridden” and calls it a “Proposed ruling” at [lines 181 and 229](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/issues/20260823-llp0209-g0-commission.md:181), although LLP 0209 now records OQ-1 resolved.
- Packet deliverable 4 still says completeness is claimed at an “instance identity” tuple at [line 68](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/issues/20260823-llp0209-g0-commission.md:68), while current §4 uses the outer materialization identity.
- Choose and name the `snapback-types` keyset carrier now; “move/re-export or introduce” leaves unnecessary Stage B API naming work.

## 4. Wire-grammar closure

No. The principal plan/node records are substantially closed, but Rust plus JSON Schema still require design decisions for the typed completeness-proof unions, oracle precondition keys, the missing `GraphPartitionEquivalenceProofV1`, and the `KeysetAfter` versus `KeysetKeyV1` placement/name. R7’s multi-consultation and plan-maximum calculation must also be corrected before the generated bound logic is deterministic.

VERDICT: NOT READY (7 MATERIAL)

## r4 — 63cc68b89 fix round 3

The amendment is not ready: fix round 3 resolves F3, F5–F7, and the requested minor cleanup, but six material defects remain.

## 1. Disposition check

- **F1 — PARTIAL.** The new proof union exists ([LLP 0209 §2.1:348](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:348)), but singular to-one/principal proofs cannot cover multi-parent nodes, several union arms still permit contradictory label/evidence combinations, and the corpus-level flat `existenceBits` remains unindexed ([line 1766](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1766)).

- **F2 — PARTIAL.** The fourth register and materialized demand/evaluation refusal result are present ([lines 1092, 1759](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1092)), and qualification is excluded, but materialization-bound proofs still admit admission reasons and a counterfeit broadcast certificate whose base is valid class 2/3 has no closed admission code.

- **F3 — FIXED.** `GraphOracleLabelTranslationV1` now carries the closed `when:{cursor,rows}` discriminator ([line 2559](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2559)); every table row supplies it, and null-cursor/empty comments maps to materialized `SNAPBACK_QUERY_COST_BOUND_EXCEEDED` ([lines 2675–2692](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2675)).

- **F4 — PARTIAL.** Plan maxima and request-local `take` are separated and principal/through consultations are mentioned ([lines 1371–1428](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1371)), but the resulting analytical function contradicts LLP 0267 and current bounded-child execution, so it is not a correct closed function.

- **F5 — FIXED.** The closed proof type, class-2 placement, plan-hash inclusion, host recomputation, and mismatch refusal are all normative at [§2.1:496](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:496), [§2.4:1149](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1149), and [§3.1:1559](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1559).

- **F6 — FIXED.** The closed `direction-tie-break` disposition, ascending-`_id` normalization, corpus recording, and exit-note/B3 follow-up are specified at [§3.4:1785](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1785), [§9:2640](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2640), and [§9:2729](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2729).

- **F7 — FIXED.** Admission row 1 now examines manifest routing only ([line 1048](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1048)), while qualification reports the complete stable-ordered set without precedence ([lines 1110–1121](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1110)).

- **RULINGS — PARTIAL.** Rewritten `argumentId`, conservative byte rollup, projection refusals, and cost-presence rules landed, but `KeysetKeyV1` is not wire-type-identical to kernel `KeysetAfter`, and `maxIndexRanges` contradicts LLP 0267’s consultation count.

- **MINOR — FIXED.** The packet’s OQ-1 heading, materialization identity, per-node windows, `maxResultBytes` placement, and the revision-history round-3 bullet are corrected at [packet lines 68–96](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/issues/20260823-llp0209-g0-commission.md:68) and [Spec lines 2968–2975](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2968).

## 2. New MATERIAL findings

1. **The per-node completeness carrier cannot prove the cardinalities admitted by the graph.** An `equality-to-one` node may have many parent rows ([line 1013](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1013)), yet its proof contains one `found:boolean`; `principal-bound` has the same problem with one `parentKey` ([lines 394–438](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:394)). The bounded-to-many arm also permits outer `label:"complete"` with inner window ranges and arbitrary `hasMore:boolean`, while the flat result `existenceBits` has no root/node index.  
   **Fix:** use per-parent point arrays for to-one/principal nodes, use `parentKey` rather than `rootKey` for nested semi-joins, split every `(kind,label)` into a distinct arm with literal exhaustion fields, and remove the flat existence vector or key it by `(parent/root key,nodeId)`.

2. **Completeness proofs omit one of their two required version axes.** The Spec says byte identity/completeness depends independently on `authorizationVersion` and evaluation cut ([lines 1233–1238, 1648–1650](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1233)), and corpus invocations carry both, but `GraphCompletenessProofTupleV1` and graph completeness carry only `version:string` ([lines 342–346, 1748–1757](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:342)).  
   **Fix:** replace `version` with separate closed `authorizationVersion` and `evaluationCut` fields, or define one closed record containing both, throughout node, projection, and graph proofs.

3. **Admission refusal remains inside a materialization-only composition.** Node/composition proofs permit `GraphAdmissionRefusalReasonV1` ([lines 354–360, 468–476](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:354)), and §4.2 selects admission reasons, although `GraphRefusalCaseV1` explicitly mints no materialization ([lines 1950–1956](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1950)) and materialized results permit only demand/evaluation reasons.  
   **Fix:** remove admission reasons from node/composition proofs and §4.2; keep them solely in the non-materializing refusal union.

4. **A counterfeit base-class broadcast certificate has no stable refusal reason.** §3.3 says an authored broadcast certificate over a class-2/3 base is counterfeit and refuses ([line 1703](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1703)), but admission rows 23–26 cover only separation, scope, audience, and invalidation ([lines 1070–1073](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1070)); a valid class-2 node does not trigger `AUTHORITY_UNPROVABLE`.  
   **Fix:** add a closed broadcast-base-class refusal code and precedence row, or explicitly extend an existing code’s exact condition to this case.

5. **The analytical cost function would install wrong plan maxima.** It has four incompatible rules:

   - points contribute zero to `maxIndexRanges` ([lines 1390–1393](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1390)), while LLP 0267 requires `indexRangeCount == accessPathConsultations.length`, including point/unique consultations ([LLP 0267 lines 116–146](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0267-query-cost-guardrails.rfc.md:116));
   - bounded-to-many charges only `maxChildrenPerParent`, while the existing executor fetches `take + 1` to derive `hasMore` ([engine lines 37942–37962](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/crates/snapback-engine/src/local/engine.rs:37942));
   - `P(root)=1` ignores the root `maxArgumentExpansion` field explicitly allowed at line 1324;
   - the through-edge table already charges `M + M`, then line 1382 says to multiply the target term by `M` again.

   **Fix:** define one consultation-count function first; count every point/range access as one `indexRangeCount`, include required successor lookahead, apply root argument multiplication, and state through formulas directly—for example examined `P×(M+M)` and relationship consultations `P×(1+M)`.

6. **`KeysetKeyV1` is not wire-type-identical to `KeysetAfter`.** The new type declares `entries: CanonicalClientValueV1[]` ([lines 172–178](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:172)), while the cited kernel owner is `Vec<(String, Value)>` ([storage lines 8004–8006](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/crates/snapback-kernel/src/storage.rs:8004)), serialized as field/value pairs. The proposed schema accepts arbitrary entries and does not preserve that shape.  
   **Fix:** declare the exact pair carrier, e.g. `entries: readonly (readonly [string, CanonicalClientValueV1])[]`, subject to the owner value constraints, and pin positive/negative round-trip vectors.

## 3. MINOR before landing

- Specify the exact RFC 8785 bytes and hash domain for `GraphPartitionEquivalenceProofV1.partitionFunction`; “digest over the vector” does not pin cross-language vectors.
- Define precedence when several valid `GraphQueryShapedReasonV1` conditions apply, since the selected reason enters the plan hash.
- Bind each oracle translation’s `when.cursor` and `when.rows` to explicit dotted oracle fields; the state enum is closed, but `nodeCompleteness` currently names only status/reason fields.
- Correct the F6 control description to acknowledge that `compareIssueRows` uses `sourceIssueID`, not the physical `_id`, and state how the corpus maps it before `_id` tie normalization.

## 4. Wire-grammar closure

No. The broad Rust record layout and most tagged unions now follow mechanically, but JSON Schema cannot represent the intended valid set without design decisions or substantial bespoke validation. The remaining holes are the incorrect keyset entry shape, multi-parent completeness proofs, the missing authorization-version/evaluation-cut split, admission reasons in materialized proof arms, the missing counterfeit-base refusal code, and the contradictory cost function. Those are semantic carrier defects, not merely choices of Rust naming or placement.

VERDICT: NOT READY (6 MATERIAL)

## r5 — 12dbe6e7d fix round 4

## 1. Disposition check

- **G1 — PARTIAL.** [`KeysetKeyV1`](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:176), its tuple schema, and Stage B vectors are present, but §2.2 says normalization appends `_id` into `order` ([line 1114](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1114)) while §2.1 also stores `_id` separately as `id`; this contradicts the kernel convention where `entries` matches declared order and `id` supplies the final tie-break ([storage.rs:7992](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/crates/snapback-kernel/src/storage.rs:7992)).

- **G2 — PARTIAL.** Whole-invocation `maxIndexRanges`, the 26-range example, and the 512-absolute amendment request are correct ([§2.6:1507](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1507), [§2.6:1576](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1576)), but `maxWindowIndexRanges` still charges only each demand-paged node’s own consultation—the example gives the root lineage one range despite its page inducing 25 descendant consultations ([line 1569](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1569))—contrary to 0267’s cumulative published-page ledger ([0267 §5:544](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0267-query-cost-guardrails.rfc.md:544)).

- **G3 — FIXED.** The through-edge rule now enumerates one edge range plus `C` target points per probe and gives explicit examined/lookups/ranges formulas without a second multiplication by `C` ([§2.6:1526](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1526)).

- **G4 — FIXED-BUT-INTRODUCED the unified function misclassifies admitted access subarms.** The four-step derivation and worked example are present ([§2.6:1470](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1470)), but direct semi-joins are simultaneously called point consultations and bounded edge ranges, while every principal-bound node is charged two points even though `binding` is optional.

- **G5 — FIXED.** Literal `(kind,label)` arms and per-parent arrays are closed in §2.1 ([line 356](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:356)); §3.4 requires immediate-parent evidence and removes flat `existenceBits`/redundant `childNodeIds` ([line 2134](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2134)).

- **G6 — FIXED-BUT-INTRODUCED §6 does not consume the new authorization axis.** Node, projection, composition, invocation, and corpus completeness now carry both `AuthorizationVersion` and `GraphEvaluationCutV1` ([§2.1:345](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:345), [§3.4:1890](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1890)), but the memo key still contains only partition and evaluation cut.

- **G7 — FIXED.** `GraphMaterializedRefusalReasonV1` contains only demand/evaluation reasons ([line 327](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:327)), and admission reasons are restricted to non-materializing refusal cases ([line 1239](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1239)).

- **G8 — FIXED.** `SNAPBACK_GRAPH_BROADCAST_BASE_CLASS_INVALID` is admission row 23 before the separation/scope/audience/invalidation rows ([line 1185](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1185)), and §3.3 applies it specifically to authored broadcast certificates over valid class-2/3 bases ([line 1824](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1824)).

- **MINOR — PARTIAL.** The hash preimage, precedence, source-ID normalization, mandatory continuation, lookup vector, graph proof-class derivation, and history are fixed, but `outerStatusReason.translations` still contain `when.cursor`/`when.rows` without explicit dotted cursor/rows paths; those mappings were added only to `nodeCompleteness` ([§9:2792](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2792)).

## 2. New MATERIAL findings

There are two additional MATERIAL findings, for four total blockers when G1 and G2 are included.

1. **The consultation function is wrong for admitted direct semi-joins and principal nodes.** Section 2.6 calls a direct semi-join a one-entry point at [line 1491](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1491), then calls direct-edge consultations bounded ranges with `C + 1` entries at [line 1498](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1498); §5 independently requires ordinary `Query` dependencies for direct ranges ([line 2495](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2495)). It also charges two point consultations for every principal node despite optional `binding` ([line 721](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:721)). Fix by restoring explicit access subarms: direct semi-join as a bounded range unless uniqueness is proved, principal-bound as one point without binding/two with binding, and null-key attempts as relationship lookups but not fabricated storage consultations.

2. **The post-G0 memo key can reuse across authorization versions.** Section 3.2 explicitly requires partition digest, authorization version, and evaluation cut as independent sharing axes ([line 1782](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1782)), but §6 keys memoization only by instance, partition, and evaluation cut and calls that the completeness tuple ([line 2559](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2559)). An out-of-band revocation or metadata activation can advance authorization without changing the partition digest or data cut. Fix by adding `authorizationVersion` to the memo key and its equality/invalidation statements.

## 3. MINOR items before landing

- Add `oracleCursorField` and `oracleRowsField` to `outerStatusReason`, or factor a common translation-binding record used by both outer and node mappings.
- Define “parent-key order” mechanically for completeness `rows`/`ranges`—for example RFC 8785 JCS byte order—and reject duplicate/missing parent keys; the current phrase at [line 2139](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2139) does not determine cross-runtime proof hashes.
- Update the commission packet’s remaining single `(materialization identity, partition, version)` wording at [packet line 68](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/issues/20260823-llp0209-g0-commission.md:68) to the authorization-version/evaluation-cut tuple.

## 4. Wire grammar closure

No. The record and union shapes are otherwise close enough for direct Rust/Serde and JSON Schema implementation, but Stage B still must make a semantic choice about whether normalized `order` includes `_id` or `KeysetKeyV1.id` alone carries the implicit tie-break; that choice changes cursor bytes and hashes. The per-parent proof-array comparator/duplicate rule is the remaining smaller canonicalization hole. Once those are pinned, the wire grammar itself is sufficiently closed; the consultation defects are execution semantics rather than schema-shape gaps.

VERDICT: NOT READY (4 MATERIAL)

## r6 — 55557e0fc fix round 5

## 1. Round-5 dispositions

- **H1 — FIXED.** [§2.1](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:345>) uses `GraphRowKeyV1` for every parent-keyed proof arm, while [§4.1](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2312>) requires exact parent coverage, JCS-byte ordering, and rejection of duplicates or omissions.

- **H2 — FIXED.** [§2.2](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1123>) forbids `_id` in normalized `order`, [§2.1](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:984>) forbids it in `entries` and reserves `id` for the implicit tie-break, and [Stage B row 2](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2979>) requires negative vectors for both violations.

- **H3 — FIXED-BUT-INTRODUCED undefined and consumer-conflicting result-row/result-byte accounting.** [§2.4](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1351>) and [§2.6](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1545>) now charge induced subtrees, and the [worked example](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1588>) correctly derives `43 + C_comments` scans and 26 consultations, but the logical row/byte part creates MATERIAL M1 below.

- **H4 — FIXED.** [§2.6 steps 2–3](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1508>) specifies direct `exists`/`all`, uniqueness, principal-binding, and null-key consultation behavior, and [§5.1](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2531>) supplies matching point/range/skipped dependency forms.

- **H5 — FIXED.** [§6](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2610>) keys memos on materialization, partition, authorization version, and evaluation cut and retires old authorization versions, while the [round-5 history](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:3259>) explicitly preserves the shipped pre-G0 mechanism.

- **MINOR — FIXED.** The evaluation-cut schema and safe-integer validation are pinned in [§2.1](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:997>), to-many window resumption is specified in [§4.1](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2306>), outer oracle paths are present in [§9](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2855>), the packet carries all four tuple axes at [lines 68–71](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/issues/20260823-llp0209-g0-commission.md:68>), and the history bullet is present.

## 2. New MATERIAL findings

### M1 — Child-lineage `resultRows` and `resultBytes` have no defined unit and contradict LLP 0267

Evidence: LLP 0209 says a child lineage charges only its induced subtree’s result rows and serialized bytes ([§2.4](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1351>), [§2.6 table](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1647>)), but the graph has only one top-level authored result, while Accepted LLP 0267 defines result bytes as the single whole-result serialization and applies that quantity to the summed-window ledger ([§5](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0267-query-cost-guardrails.rfc.md:527>)); no §2.1 carrier defines a serialized child-subtree result or what counts as a descendant “result row.”

Fix: preserve LLP 0267 by charging each lineage page the published graph’s top-level `resultRows` and whole `serde_json` result bytes, limiting induced-subtree accounting to structural scan/consultation work; alternatively, amend LLP 0267 and add an exact child-subresult projection, serialization, and row-count carrier before Stage B.

No additional MATERIAL conflict was found with LLP 0268 §7 or LLP 0183 §D2.

## 3. MINOR items

- [§2.6](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1490>) should explicitly say analytical declarations take the worst-case possible consultation arm, while G2 observations charge zero for an actual null/omitted key; the current surrounding “unique plan-shape function” makes that inferable, but the prose switches between maxima and “actual” consultations.

- The principal-bound complete proof always requires `bindingFound:boolean` ([§2.1](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:501>)) although `binding` is optional; pin the absent-binding value or use a discriminated `not-required | lookup` evidence arm.

- [§9](</Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2893>) says the kernel applies the tie-break “through `KeysetKeyV1.id`”; more precisely, the kernel appends `_id ASC` to SQL order and `id` merely carries its boundary value.

## 4. Wire grammar closure

The record and union shapes in §2.1 are now sufficiently closed for Rust and generated JSON Schema: optional-versus-null spelling, tuple-array keysets, proof unions, ordering, and numeric validation are all pinned. The remaining wire-semantic hole is `principal-bound` evidence when the plan has no optional `binding`: Rust can generate the mandatory Boolean, but the validator and frozen corpus cannot derive its canonical value without making a convention. The larger M1 issue concerns accounting semantics rather than structural schema generation.

VERDICT: NOT READY (1 MATERIAL)

## r7 — 90f55302f fix round 6

## 1. Finding dispositions

- **J1 — FIXED.** [§2.4](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1345) and [§2.6](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1560) restrict induced-subtree accounting to structural work, charge every root or child publication for top-level `resultRows` and one whole-result serialization, explicitly reject a child sub-result carrier, and give a correct conservative rollup example at [line 1620](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1620).

- **MINOR — completeness-array sorting — FIXED.** [§4.1 lines 2340–2344](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2340) require sorting solely by the RFC 8785 JCS bytes of `parentKey`, not the containing proof element.

- **MINOR — `ranges[].hasMore` — FIXED.** [§4.1 line 2334](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2334) correctly places `hasMore` on each window range and states the per-range continuation behavior.

- **MINOR — vacuous `bindingFound` — FIXED.** [§2.1 line 505](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:505) and [§2.6 lines 1530–1534](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1530) require literal `true` when the normalized principal node omits `binding`.

- **MINOR — worst-case versus actual-null consultations — FIXED.** [§2.6 lines 1501–1506](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:1501) make declarations use the worst-case arm while observations charge zero storage consultations for an actual null or omitted key.

- **MINOR — kernel `_id ASC` wording — FIXED.** [§9 lines 2921–2924](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:2921) now assigns ordering to the kernel’s appended `_id ASC` and limits `KeysetKeyV1.id` to carrying the boundary value, matching [storage.rs line 14423](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/crates/snapback-kernel/src/storage.rs:14423).

- **MINOR — round-6 history — FIXED.** [Revision history line 3290](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:3290) accurately records J1 and all five polish corrections.

## 2. New MATERIAL findings

None. The delta introduces no contradiction with LLP 0267 §5, LLP 0268 §0/§1/§7, LLP 0183 §D2, or the cited kernel implementation.

## 3. MINOR items before landing

- [Line 3291](/Users/ccheever/projects/snapback/.claude/worktrees/g0-a/llp/0209-live-graph-profile.spec.md:3291) says “Converged” while recording Codex as pending; after this review, update that bookkeeping marker to `codex READY r7`.

## 4. Wire-grammar closure

Yes. Section 2.1 is closed enough for Rust types and generated JSON Schema without a remaining semantic design decision: union discriminants, conditional presence/absence, numeric domains, digest patterns, collection cardinality, ordering, canonicalization, and reused owner types are all pinned. I found no remaining wire hole; the pending-review history marker is editorial bookkeeping, not grammar.

VERDICT: READY
