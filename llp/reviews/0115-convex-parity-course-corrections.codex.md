# Review: LLP 0115 — Convex-parity course corrections (Codex family)

## Round 1 — 2026-07-30 — pre-implementation program review

**Family:** OpenAI Codex
**Provider/runtime:** Codex CLI v0.146.0, model `gpt-5.6-sol`,
`model_reasoning_effort="ultra"`, sandbox read-only, approval never
**Session:** `019fb373-2aef-7211-810e-783fecfc9a17`
**Date:** 2026-07-30
**Invocation:** explicit human request (Charlie Cheever) for a Codex ultra
review of the planned/amended program before implementation
**Method:** single non-interactive `codex exec` run against the working
checkout at revision `f0547b7d`. Brief scope: LLP 0115 (v0.2 plus the
post-audit CV-1 correction), the eleven 2026-07-30 dated owner amendments
(LLP 0004, 0010, 0028, 0041, 0070, 0073, 0074, 0080, 0108, 0110, 0111),
diaries 0032–0039, the three `issues/20260730-*` tickets, and any code needed
to verify load-bearing claims. `llp/reviews/` was excluded from the
reviewer's reading for independence. The brief mislabeled the plan revision
"v0.3"; the reviewer correctly flagged that the file identifies itself as
v0.2.
**Redaction:** none — repository-local documents only.
**Failed attempts not counted:** one earlier launch of the same brief never
started (the orchestrator's `</dev/null` redirect was attached to the wrong
pipeline stage, so `codex exec` blocked reading stdin); it was killed with no
model output and is not a review.

**Orchestrator verification notes (outside the verbatim body):** decisive
factual claims spot-checked against the checkout before circulation, all
confirmed — the admin client is imported only by Dispatch's acceptance
(finding 3; corrects the plan's and LLP 0041 amendment's "every arm" claim);
`defineSearchQuery` authors `query: v.json()` and generated client
declarations hand-author `SearchQueryAstV1`, with no search types in
`src/schema_export.rs` (finding 6; corrects the plan's CV-5 root-cause
attribution); LLP 0108's final reconciliation states both reviewer families
were NOT READY with material findings accepted-but-unclosed (finding 7;
corrects the plan's "demoted, not rejected" framing); `parse_source` loads
`content_digest` without recomputing it from parsed payloads (finding 10's
tamper caveat); LLP 0074's authority crosswalk assigns sequencing/evidence to
LLP 0063 and its sequence section requires the public registry rather than
`latest` (findings 1 and 3); LLP 0028's Summary still says cron "is not yet
built" (finding 13). The verbatim review body follows.

---

# 1. Overall assessment

LLP 0115 has the right strategic shape. It correctly puts external installation and runtime coherence ahead of authoring polish, preserves Snapback’s evidence/nonclaim advantages, separates argument collections from stored collections, redirects one-off scheduling to LLP 0070, and accurately diagnoses the immediate search failure. The evidence absorption is substantially better than a typical competitive roadmap.

It is not yet safe to implement as a program. The largest problems are governance and measurement authority, an incomplete package/release/rerun cycle, and several work items whose stated scope does not match either their owning document or the current code. In particular, CV-4, CV-5, CV-7, CV-8, and CV-9 all require design correction or ratification before coding. Several exits can also pass without producing any competitive improvement.

My recommendation is to revise LLP 0115 before starting the tranches. Isolated work with already-clear boundaries—such as CV-13 and a carefully specified CV-10 regression—can proceed, but the tranche program should not. The file at `f0547b7d` also still identifies itself as v0.2, not the v0.3 named in the review brief.

# 2. Findings worth addressing before implementation

## 1. Major — LLP 0115 does not currently have authority to govern sequencing or competitive acceptance

**Claim.** LLP 0074 explicitly leaves delivery sequencing and comparative evidence with LLP 0063. A Convex-specific protocol or reordering takes effect only through a coordinated LLP 0063 amendment. LLP 0115 nevertheless declares tranche order and leaves the rerun protocol open.

**Evidence.** The authority crosswalk says LLP 0063 owns sequencing and evidence and requires an explicit delegation with baseline-rollover rules ([LLP 0074 §Authority crosswalk](/Users/ccheever/projects/snapback/llp/0074-convex-competitive-strategy.rfc.md:273)). LLP 0074 also requires the fixture to be frozen before metric-affecting implementation ([§Sequence and gates](/Users/ccheever/projects/snapback/llp/0074-convex-competitive-strategy.rfc.md:770)) and says the protocol must pin versions, assistance policy, repetitions, tolerances, and adjudication ([§Acceptance protocol](/Users/ccheever/projects/snapback/llp/0074-convex-competitive-strategy.rfc.md:838)). Program ownership and target-customer scope remain unresolved there ([§Ownership](/Users/ccheever/projects/snapback/llp/0074-convex-competitive-strategy.rfc.md:859)). LLP 0115 instead sets sequencing while leaving rerun scope as OQ4 ([§Sequencing](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:547), [§Open questions](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:627)).

**Resolution criterion.** Before metric-affecting implementation, land a coordinated LLP 0063/0074 amendment that:

- names the program owner and adjudicator;
- delegates the LLP 0115 sequence;
- freezes the seven-app baseline, scoring rubric, package/comparator versions, assistance policy, and rollover rules; and
- states whether the claim covers only the frozen fixtures or a broader customer profile.

## 2. Major — the plan-level exit is not falsifiable, and its only rerun happens too early

**Claim.** “Near tie,” removal of a sentence from a diary recommendation, and absence of a broadly named incident class are subjective. More importantly, the only mandatory rerun occurs after A–C, although the final exit attributes Pantry’s improvement to D’s CV-11/CV-12.

**Evidence.** Diary 0039 describes 55/45 as a practical judgment rather than a frozen score ([Diary 0039 §Executive answer](/Users/ccheever/projects/snapback/diaries/0039-snapback-convex-main-rerun-report.diary.md:10)). LLP 0115 schedules the rerun after A–C ([§Sequencing](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:566)), but the completion criterion invokes CV-11/12 and editorial wording from the successor diary ([§Exit criterion](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:576)). Several item exits are similarly non-falsifiable: CV-6 says “hard to ignore,” CV-11 may exit by deciding not to ship, CV-12b names no mandatory target, and CV-8 may endorse the already-scored imperative status quo.

**Resolution criterion.** Freeze observable per-arm pass criteria before coding; make the A–C rerun an explicitly intermediate checkpoint; require a final post-D rerun; and require every CV item to be implemented, explicitly shelved as a program miss, or superseded. A decision not to ship a feature may be valid, but must not count as a parity correction.

## 3. Major — CV-1’s package closure and rerun release sequence are internally incomplete

**Claim.** A publishes a pre-feature closure, B/C then change runtime/codegen packages, and the post-A–C rerun must use published artifacts—but no second exact release is scheduled. CV-1 proves only one arm while the plan exit requires all seven.

The claimed npm conflict is also overstated: LLP 0074 requires public npm artifacts, while LLP 0111 already permits public immutable exact versions before hosted qualification and gates only `latest`.

**Evidence.** CV-1 completes the in-flight closure and rebuilds one arm ([LLP 0115 §CV-1](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:182)); the final exit requires all Snapback arms to use the published channel ([§Exit](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:586)). LLP 0041 binds a closure to one clean source/version vector ([LLP 0041 §Nine-package promotion](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:352)). LLP 0111 publishes exact candidate versions before hosted qualification and delays only default-channel promotion ([LLP 0111 §Executable order](/Users/ccheever/projects/snapback/llp/0111-fly-completion-and-hosted-ephemeral.plan.md:1210)); LLP 0074 merely requires the public registry, not `latest` ([LLP 0074 §Sequence](/Users/ccheever/projects/snapback/llp/0074-convex-competitive-strategy.rfc.md:724)).

CV-1’s evidence is also factually overstated: “all fourteen” cannot import Snapback checkout paths when seven are Convex arms, and AdminClient is Dispatch-specific rather than an every-arm dependency ([LLP 0115 §CV-1 evidence](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:139), [Diary 0038 §External consumption](/Users/ccheever/projects/snapback/diaries/0038-dispatch-main-rerun.diary.md:157)).

**Resolution criterion.**

- Decide admin-client and test-helper disposition before freezing the closure.
- Treat public exact-version installs and `latest` UX as separate gates.
- Cut a new exact candidate closure immediately before every published-channel rerun.
- Use Dispatch or a separate fixture for admin-client proof.
- Require zero checkout reach-through in authoring, generation, launch, and acceptance for all seven final Snapback arms.

## 4. Major — CV-2/CV-3 do not define a receipt authority that works across all runtime rungs

**Claim.** The plan correctly identifies the missing readiness receipt, but does not define issuer, custody, served-binary selection, actual loaded-library identity, package carriage, or renewal. The public packaged doctor is also omitted from the owner set.

**Evidence.** LLP 0010 explains that `scripts/ibex-doctor` deliberately proves a fresh disposable binary and is structurally blind to a stale served binary ([LLP 0010 §Runtime readiness gap](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:799)). CV-3 nevertheless requires doctor to verify “the served binary” without defining how it is selected ([LLP 0115 §CV-3](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:233)). The packaged runtime currently copies only the binary and Hermes library, with no readiness sidecar ([prepare-runtime.mjs](/Users/ccheever/projects/snapback/packages/snapback-runtime-linux-x64/prepare-runtime.mjs:145)). Meanwhile, public `snapback doctor` already exercises a VM/query/mutation/live vertical slice under LLP 0041 ([LLP 0041 revision note](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:26)).

**Resolution criterion.** Before CV-1 publication, define a versioned receipt with:

- issuer/probe version, platform tuple, binary digest, actual loaded Hermes identity, and expiry/invalidation;
- custody for contributor builds and packaged runtimes;
- validation rules for cargo, prebuilt, configured, and reused-server rungs;
- TOCTOU handling for swaps after issuance; and
- explicit distinction between `scripts/ibex-doctor` and public `snapback doctor`.

Order A as CV-2 probe → CV-3 receipt/custody → runtime-package carriage → CV-1 publication. Add LLP 0041 to the owner set.

## 5. Major — CV-4 is an existing server trust-boundary problem, not only array ergonomics

**Claim.** “Nested `v.object` arguments work end-to-end” is misleading. They receive generated types and JSON Schema, but the server receives only an argument hash and performs no per-invocation shape validation. Stored `v.object` also collapses to unrestricted JSON.

**Evidence.** LLP 0115 and LLP 0004 both claim end-to-end object support, then acknowledge that no server ingress validation exists even for scalars ([LLP 0115 §CV-4](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:267), [LLP 0004 amendment](/Users/ccheever/projects/snapback/llp/0004-application-data-api.rfc.md:600)). `FunctionDefinition` carries `argsContractHash`, not the contract shape ([manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:3045)). `v.object` uses `fieldType: 'Json'` ([define.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:252)), and storage accepts `FieldType::Json` unchanged ([storage.rs](/Users/ccheever/projects/snapback/src/storage.rs:14662)).

**Resolution criterion.**

- Split current-vocabulary runtime ingress validation into a prerequisite, preferably P0.
- Define a closed, versioned recursive argument-contract artifact carried to the server—not merely its hash.
- Test raw/bypassed-client requests across Query, LiveQuery, Mutation, Action, HostPlan, and relevant admin invocation paths, including validation-before-effects ordering.
- Then add array/union vocabulary.
- For CV-4b, preserve and enforce recursive object shape as well as arrays/unions across SQLite, PostgreSQL, indexes, live matching, and migrations.

The owner set should include the manifest/schema authority—LLP 0012/0037 or a named successor—plus 0007/0008/0081 for stored-field behavior. CV-4 is not an M-sized item as written.

## 6. Major — CV-5 is factually mis-scoped as a one-emitter wiring fix

**Claim.** No exported LLP-0037-owned Search AST JSON Schema currently exists. The provider’s `unknown` does not come from `typeForGeneratedValidator`; it comes from `defineSearchQuery` authoring the query as `v.json()` and the contract projection faithfully emitting `shape: unknown`. Generated API types are separately handwritten and special-cased.

**Evidence.** The plan’s claim is at [LLP 0115 §CV-5](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:301). Rust derives `JsonSchema` on the types ([search/types.rs](/Users/ccheever/projects/snapback/src/search/types.rs:199)), but the committed schema exporter does not include them ([schema_export.rs](/Users/ccheever/projects/snapback/src/schema_export.rs:95)). `defineSearchQuery` uses `query: v.json()` ([define.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:763)); contract projection invokes `argDescriptors` ([index.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:1325)), while generated client declarations hand-author `SearchQueryAstV1`/`SearchRequestV1` and special-case search arguments ([index.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5899), [search special case](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:6113)).

**Resolution criterion.** Export one Rust-owned, drift-gated Search request schema; carry a schema reference or closed descriptor through the operation contract and provider projection; and prove accepted/rejected AST agreement across Rust deserialization, JSON Schema, operation schemas, introspection, and generated client types. Assign LLP 0037 plus provider/Contract ownership and re-size the work. CV-5 should either be the first conformance fixture for CV-4’s recursive carrier or explicitly justify a separate path.

## 7. Major — CV-7 treats reviewed-but-unclosed design as implementation-ready

**Claim.** LLP 0108 did not merely run out of time on an otherwise ready design. Both reviewer families returned NOT READY, and the document accepted material replay, rolling-deployment, and graph-synthesis findings before narrowing v1 to self-contained expressions.

**Evidence.** LLP 0115 describes the bundling design as demoted rather than refuted ([§CV-7](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:342)). LLP 0108’s normative reconciliation explicitly says both families were NOT READY and that material findings remained unclosed ([LLP 0108 §Final reconciliation](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:623)). The superseded design also requires a same-landing LLP 0009 amendment and DK-4 benchmark ([§Bounded static bundling](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:195)). LLP 0004’s older hashed-dependency bundle rule remains unreconciled with its later self-contained alignment ([LLP 0004 §First-slice decisions](/Users/ccheever/projects/snapback/llp/0004-application-data-api.rfc.md:492), [dated alignment](/Users/ccheever/projects/snapback/llp/0004-application-data-api.rfc.md:583)).

**Resolution criterion.** Require a new normative follow-on and independent review before implementation. Its acceptance must cover stale references, resume/replay, rolling deployment, group-hash changes, graph synthesis, cross-module adversarial closures, and the DK-4 warm-pool benchmark. Reconcile LLP 0004 and LLP 0009 in the same landing.

## 8. Major — CV-8 combines distinct designs and hides a hosted-publication critical path

**Claim.** Multi-child snapshot composition, bounded aggregation, and Split’s four-table arithmetic are not one “third aggregate profile.” They have different owners and semantics. Publication of the existing profiles also requires an exact immutable Fly release and package proof, which the tranche does not acknowledge.

**Evidence.** LLP 0110’s OQ2 treats multi-collection snapshot composition separately from aggregation ([LLP 0110 §Open questions](/Users/ccheever/projects/snapback/llp/0110-bounded-children-and-activity-patterns.spec.md:915)). LLP 0080 separately owns aggregation and identifies Split’s locale-sensitive ordering issue ([LLP 0080 OQ7](/Users/ccheever/projects/snapback/llp/0080-portable-relational-queries-and-projections.rfc.md:709)). LLP 0115 bundles all three under one profile or status-quo decision ([§CV-8 work](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:395)). LLP 0110’s first publication requires target-neutral evidence, exact Fly evidence, and clean package installs ([§First-publication plan](/Users/ccheever/projects/snapback/llp/0110-bounded-children-and-activity-patterns.spec.md:1390)).

Giving anonymous comparison arms owner fields also changes the app contract, conflicting with the “same contracts” rerun condition.

**Resolution criterion.** Split CV-8 into:

1. existing experimental-profile publication;
2. multi-collection snapshot composition;
3. bounded aggregation/reducer semantics;
4. Split’s multi-table exact arithmetic and portable ordering; and
5. activity/sequence adoption.

Add LLP 0041/0111 dependencies, decide whether local publication is decoupled from hosted publication, and freeze symmetric contract changes for both comparator arms. Endorsing the existing imperative implementation should be recorded as a deliberate program miss, not successful completion.

## 9. Major — CV-9 has the right owner but the wrong capability boundary and size

**Claim.** The proposed rollback/drain proof is far below what LLP 0070 requires before claiming `durable-work-single-process-sqlite-v1`. The RFC remains Draft, has unratified storage/fault choices, admits only generated host-plan actions, and has no defined “default queue.”

**Evidence.** CV-9’s exit proves Dispatch, rollback, and forced drain ([LLP 0115 §CV-9](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:432)). LLP 0070 requires crashes, fences, restart/deploy/rollback, retry/deadline/cancel/dead-letter, capacity, authorization, secrets, and backup/restore before claiming the SQLite profile ([LLP 0070 §Acceptance](/Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:484)). Maintainer ratification remains a prerequisite ([§Decisions requiring ratification](/Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:528)). Jobs carry named queues, and applications declare their limits and producer/action sets ([§Job identity](/Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:69), [§Queue declarations](/Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:251)). Dispatch’s callee-class fit is explicitly unresolved ([§Callee admission](/Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:552)).

**Resolution criterion.** Either:

- ratify LLP 0070 and budget its complete acceptance corpus, likely L/XL; or
- define a narrower `transactional-one-off-sqlite-v1` capability with explicit nonclaims and its own minimum crash/fence/receipt corpus.

Before coding, decide the callee class and define bounded queue capacity, retry, delay, producer, overflow, and inspection policy—or require authors to declare the queue explicitly.

## 10. Major — CV-10’s proposed alternatives are not equivalent, and one interpretation weakens corruption detection

**Claim.** The diagnosis is correct, but “compare canonical bytes/digests and/or normalize globally” leaves a security-significant implementation choice unresolved. Comparing the stored digest alone would be unsafe because parsed derived payloads currently trust that digest.

The issue’s Real equality-filter criterion is also factually incompatible with the current portable scalar contract.

**Evidence.** The failing full-struct equality is real ([search/sqlite.rs](/Users/ccheever/projects/snapback/src/search/sqlite.rs:1713)), and storage validation leaves the insert representation unchanged ([storage.rs](/Users/ccheever/projects/snapback/src/storage.rs:14662)). However, `parse_source` loads `content_digest` without recomputing it from the parsed stored/filter/token payloads ([search/sqlite.rs](/Users/ccheever/projects/snapback/src/search/sqlite.rs:1087)). A digest-only comparison could therefore accept tampered payloads accompanied by an unchanged stored digest.

The issue asks for fractional/integral Real equality filters ([search issue §Resolution criteria](/Users/ccheever/projects/snapback/issues/20260730-search-real-integral-digest-corruption.md:58)), but LLP 0080 excludes Float/Real from portable equality ([LLP 0080 §Portable equality](/Users/ccheever/projects/snapback/llp/0080-portable-relational-queries-and-projections.rfc.md:148)), and the implementation refuses Real filter fields ([search/sqlite.rs](/Users/ccheever/projects/snapback/src/search/sqlite.rs:1576)).

**Resolution criterion.**

- Prefer a narrow release recheck that recomputes JCS digest from parsed derived payloads, verifies the stored digest, then compares it with an independently rederived authoritative digest.
- Test tampered payload/unchanged digest, genuine divergence, insert, seed, patch, reload, integral Real, and fractional Real.
- If global Real normalization is chosen, add LLP 0004/0007 ownership and test query, mutation acknowledgement, change journal, and live observable representation.
- Correct the issue to require Real stored-field coverage and explicit refusal of Real equality filters, unless a separate equality-semantics amendment intentionally admits them.
- Put the number-spelling invariant in a normative LLP 0073 section, not only its revision header.

## 11. Moderate — CV-6 may make the measured ergonomic problem worse

**Claim.** Raising or enforcing the degraded-result warning improves correctness, but does not address the repeated result-schema boilerplate that multiple apps identified. It may increase friction without improving expressiveness.

**Evidence.** CV-6 only changes warning/refusal policy ([LLP 0115 §CV-6](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:317)). Relay asks for schema-backed projection helpers ([Diary 0033 §Priority improvements](/Users/ccheever/projects/snapback/diaries/0033-relay-board-main-rerun.diary.md:203)); Campfire asks to reduce repetitive record schemas ([Diary 0034 §Priority improvements](/Users/ccheever/projects/snapback/diaries/0034-campfire-main-rerun.diary.md:203)); Split records significant nested contract bulk ([Diary 0036 §Colocation](/Users/ccheever/projects/snapback/diaries/0036-split-ledger-main-rerun.diary.md:111)). LLP 0108 forbids behavioral inference, but that does not preclude static schema-derived pick/extend/composition helpers.

**Resolution criterion.** Decide the exact warning/default/CI behavior before B, and add—or explicitly reject as out of scope—a schema-derived result-contract composition item with a measured reduction in repeated declarations while retaining exact egress validation.

## 12. Moderate — CV-12a introduces an unexplained index-rebuild rule

**Claim.** The new amendment says every range operator requires both a new parser profile and semantic index version. The earlier normative design separates index semantics, parser semantics, and cursor query identity; a rebuild is not evidently necessary for ranges over already stored filter values.

**Evidence.** LLP 0115 asserts the coupled version change ([§CV-12a](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:503)), as does LLP 0073’s new OQ11 ([LLP 0073 §Open questions](/Users/ccheever/projects/snapback/llp/0073-portable-full-text-search.rfc.md:884)). Earlier text says semantic index identity binds schema, weights, analyzer, result, visibility, scorer, and ordering ([§Index identity](/Users/ccheever/projects/snapback/llp/0073-portable-full-text-search.rfc.md:139)); parse/reduction changes create parser profiles ([§Query language](/Users/ccheever/projects/snapback/llp/0073-portable-full-text-search.rfc.md:322)); cursors independently bind semantic version and query-core hash ([§Cursors](/Users/ccheever/projects/snapback/llp/0073-portable-full-text-search.rfc.md:365)).

**Resolution criterion.** Either add query-operator/parser identity to semantic index identity and justify mandatory rebuilds, or define a separate query-language version and prove that existing physical generations can safely serve range predicates.

Also name the mandatory CV-12b target set. “Each new target” is currently satisfied by shipping none.

## 13. Moderate — Tranche E has incomplete owners and weaker exits than the underlying evidence

**Claim.**

- CV-13 drops two criteria from its issue: links to capture/result recipes and an executable freshness check.
- CV-14 points vaguely at the LLP 0062 family even though codegen custody already has identified owners and already emits a single-generation semantic summary.
- CV-15 is owned by LLP 0030/0031, not merely LLP 0010, and simply renaming `unpinned` could weaken an intentionally honest dirty/unknown classification.

**Evidence.** Compare CV-13’s exit ([LLP 0115 §CV-13](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:522)) with the ticket’s full criteria ([guide-gap issue](/Users/ccheever/projects/snapback/issues/20260730-guide-gap-first-backend-front-loads-legacy-handlers.md:21)). The resolved custody issue names LLP 0010/0012/0037/0041 and codegen as owners ([codegen review issue](/Users/ccheever/projects/snapback/issues/closed/20260727-codegen-review-surface.md:12)), and the existing manifest already embeds a deterministic summary ([review-surface.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/review-surface.mjs:180)). LLP 0031 defines the provenance verdicts and the intended meaning of `unpinned` ([LLP 0031 §Server-binary identity](/Users/ccheever/projects/snapback/llp/0031-server-route-taxonomy.spec.md:723)).

**Resolution criterion.**

- Carry the complete CV-13 ticket criteria into the plan.
- Reframe CV-14 as a two-manifest semantic delta—added/removed operations, contract changes, capability movement, and warning/degradation changes—owned by codegen/custody authorities.
- Assign CV-15 to LLP 0030/0031 and add a configured-but-receipt-attested class rather than weakening dirty/unknown `unpinned`.

Before handoff, also reconcile the stale metadata/prose: LLP 0115 still says v0.2 ([line 8](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:8)); LLP 0041 falsely says every arm imports AdminClient ([line 39](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:39)); and LLP 0028’s Summary says cron is unbuilt while its Status says it shipped ([Summary](/Users/ccheever/projects/snapback/llp/0028-cron-scheduled-execution.rfc.md:52), [Status](/Users/ccheever/projects/snapback/llp/0028-cron-scheduled-execution.rfc.md:1047)).

# 3. Per-tranche readiness

- **A — BLOCKED ON AUTHOR DECISION:** package membership, exact-version versus `latest`, evaluator-helper policy, and readiness-receipt custody determine the release closure.
- **B — BLOCKED ON AUTHOR DECISION:** runtime argument-contract compatibility, CV-5 schema authority, and CV-6 strictness must be decided before implementation.
- **C — BLOCKED ON AUTHOR DECISION:** CV-7 needs a reviewed follow-on, CV-8 needs profile/publication choices, and CV-9 needs ratification plus a capability cutline.
- **D — BLOCKED ON AUTHOR DECISION:** live search versus a recorded nonclaim, range-version semantics, and the mandatory target set remain unresolved.
- **E — ADDRESS FINDINGS FIRST:** CV-13 is otherwise ready; CV-14/15 need correct owners and testable exits.

# 4. Coverage check

I found five genuine diary findings with no concrete work item, dated amendment, or open ticket, plus one partially covered migration gap.

| Missing finding | Evidence | Needed disposition |
| --- | --- | --- |
| Negative checks can pass on the wrong failure layer | Streak’s invalid-input test passed on VM creation failure ([Diary 0032](/Users/ccheever/projects/snapback/diaries/0032-streak-lab-main-rerun.diary.md:148)) | Require diagnostic-specific `assertThrows` for every matrix negative and a positive VM/readiness canary. The helper already exists ([acceptance guide](/Users/ccheever/projects/snapback/guide/testing/acceptance.md:53)). |
| Schema-backed result-contract reuse | Relay, Campfire, and Split all report repetitive composite contracts ([Diary 0033](/Users/ccheever/projects/snapback/diaries/0033-relay-board-main-rerun.diary.md:186), [Diary 0034](/Users/ccheever/projects/snapback/diaries/0034-campfire-main-rerun.diary.md:188), [Diary 0036](/Users/ccheever/projects/snapback/diaries/0036-split-ledger-main-rerun.diary.md:111)) | Add a static projection/composition item; CV-6 only increases enforcement. |
| Public/shared `.lt(...).take(...)` pagination recipe | Source inspection was required to discover the shipped path ([Diary 0034](/Users/ccheever/projects/snapback/diaries/0034-campfire-main-rerun.diary.md:46)) | File the required `guide-gap` ticket and add an executable recipe/check. |
| Contention-safe server-derived append/page key | Campfire currently scans the room for its next sequence ([Diary 0034](/Users/ccheever/projects/snapback/diaries/0034-campfire-main-rerun.diary.md:195)) | Give this a standard-pattern/RFC owner or explicitly endorse application-managed allocation. |
| Typed generated references inside server handlers | Dispatch still uses string-named `ctx.runMutation` while Convex has typed server references ([Diary 0038](/Users/ccheever/projects/snapback/diaries/0038-dispatch-main-rerun.diary.md:66)) | Add a bounded server-reference work item or record the string surface as intentional. |
| Brownfield migration to manifest-only custody is manual | Dispatch had to migrate the tracked tree manually ([Diary 0038](/Users/ccheever/projects/snapback/diaries/0038-dispatch-main-rerun.diary.md:100)) | Compatibility is documented, but no migration command/check exists ([generated-artifacts guide](/Users/ccheever/projects/snapback/guide/getting-started/generated-artifacts.md:36)). Decide whether to automate it. |

One apparent miss is not entirely uncovered: Campfire’s membership-aware shared cursor already has a Draft owner in LLP 0100 ([LLP 0100 §Membership-scoped pages](/Users/ccheever/projects/snapback/llp/0100-membership-addressed-operations-and-pages.rfc.md:191)). LLP 0115 should link it as a dependency rather than silently treating the need as part of CV-8.

# 5. Suggestions and novel ideas

- Preserve the seven original contracts unchanged for longitudinal comparison, and add an eighth React/query-group arm. This resolves OQ4 without sacrificing comparability.
- Use exact candidate-tag versions for every evidence run. Treat `latest` as a separate first-hour UX test, never as the identity authority for a retained comparison.
- Split LLP 0070 into a small transactional-enqueue kernel capability and a larger worker-reliability profile. Dispatch could prove the kernel without borrowing the full durable-work claim.
- Keep matrix test helpers as a digest-pinned evaluation instrument unless Snapback intentionally wants them as supported public API. Product packages and evaluator tooling need not share a closure.
- Run blinded, order-randomized paired agent trials with frozen prompts and report commands, recovery interventions, elapsed time, and agent tokens alongside narrative scoring.
- Add metamorphic search tests: insert, patch, reload, rebuild, and restore of semantically identical numeric values must derive identical canonical sources; independent payload and digest tampering must still fail.
- Make CV-14 a risk-ranked semantic diff: contract narrowing/widening, capability promotion, authority changes, and new degradation should rank above ordinary content changes.

# 6. Open questions for the author

1. Who formally owns and adjudicates this program, and will LLP 0063 explicitly delegate the sequence to LLP 0115?
2. Is P0 satisfied by public exact versions, or is `latest` genuinely required? Which admin/test artifacts belong to the supported product closure?
3. Should current scalar/object server ingress validation move to P0, and what compatibility lane applies to existing hash-only manifests?
4. For CV-6, is omission a warning, CI failure, or runtime refusal—and is schema-derived result composition part of the same correction?
5. Is the author willing to reopen CV-7’s replay, deployment, graph-synthesis, and benchmark questions before implementation?
6. Which CV-8 outcomes are actually desired: multi-collection snapshots, aggregates, multi-table derivation, activity publication, or an endorsed imperative lane? Must local publication wait for Fly?
7. Should CV-9 satisfy all of LLP 0070, or mint a narrower one-off capability? Which callee class and queue policy are intended?
8. Is live search required for program success, or may the author deliberately accept that continuing Convex advantage? Which concrete CV-12b targets are mandatory?
9. Should ranges trigger index rebuilds, or only a new query-language/parser version?
10. For CV-10, should normalization be search-local or a storage-wide observable representation change?
11. Will the final protocol use the unchanged seven-app baseline plus an additive React arm, and will it require a fresh exact package ledger after A–C and again after D?

No files were modified.