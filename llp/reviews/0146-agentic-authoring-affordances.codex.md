# LLP 0146 agentic authoring affordances review — Codex family


## Round 1 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-01
**Method:** fresh non-author `codex exec` context, read-only sandbox over the
working tree; mutually blind — instructed not to read any `llp/reviews/`
artifact concerning LLP 0146, and verified after the fact not to have done so
(no reference to that path appears anywhere in its 17,820-line transcript).
SHA-pinned target and instruction capsule.
**Instruction capsule SHA-256:** `0b009ed73a1f87f1fd0512a66435e1be1f57bf1ef21f74761a913cfe331333ce`
**Target:** `llp/0146-agentic-authoring-affordances.rfc.md` (605 lines, Draft)
**Target SHA-256:** `eeecc46c923d4f4248c2eb2cae26a4c81b9bf2ca0e80ee2c9a477fd53e7d36ca`
**Repo revision at review start:** origin/main `7c509eb6`
**Output tokens reported:** 275,250
**Status:** completed
**Verdict:** NOT READY

**Author note on this artifact.** Codex's *source* anchors (`src/`,
`cloudflare/`, `packages/`) verified accurate throughout, including the
BLOCKING. Its *LLP filenames* are reconstructed and wrong — it writes
`llp/0024-host-operation-contracts.rfc.md`,
`llp/0042-acceptance-runtime-control-plane.spec.md`,
`llp/0054-deterministic-simulation-testing-for-snapback.research.md`,
`llp/0062-agentic-authoring-control-plane-plan.plan.md`,
`llp/0097-branch-effect-isolation.rfc.md`,
`llp/0108-app-codegen-contracts-and-type-generation.rfc.md`, and
`llp/0144-host-operation-semantics-analysis.rfc.md` for documents whose real
slugs are `0024-agent-operating-surface.spec.md`,
`0042-agent-mcp-surface.rfc.md`,
`0054-tigerbeetle-lessons-for-snapback.research.md`,
`0062-generated-app-cli-and-code-mode.rfc.md`,
`0097-ephemeral-data-branches-and-effect-isolation.rfc.md`,
`0108-inline-handlers-and-result-contracts.spec.md`, and
`0144-declared-app-refusal-codes.rfc.md`. The **line numbers and quoted
content in those files were checked and are correct**, so the findings stand;
only the filenames are confabulated. Recorded verbatim below without repair.

## Verbatim review

## Overall assessment

**Verdict: NOT READY**

The load-bearing correction in §“Correction to the motivating critique” is valid for the local runtime but false for the Cloudflare arm. Cloudflare records captured reads yet still determines live-query fanout from manifest-declared tables. An under-declared handler can therefore miss invalidation exactly as the RFC says cannot happen. Because D1’s scope and severity rest on this correction, the RFC must account for target-specific behavior before review.

## Strengths

The local-runtime analysis is substantially correct. Point and query dependencies are captured in `src/runtime.rs:2458-2555`, live subscriptions register the resulting dependencies in `src/local.rs:13679-13692`, and mutation commits ultimately validate `executed.reads` through `src/storage.rs:4388-4457`. Relational queries also have an intentional plan-based fallback rather than relying on manifest declarations.

I independently verified the three specifically checkable corpus claims:

- `acceptance.run` is pinned but unbuilt in `src/host_ops.rs:51-55` and `guide/operating/host-ops.md:72-73`.
- LLP 0115 CV-14 is open and claimed by no move at `llp/0115-convex-parity-course-corrections.plan.md:435`.
- The only direct source consumer of `FunctionRunResult.captured_reads` outside `src/local.rs` is `function_run_secret_scopes` at `src/admin.rs:1774-1787`.

D1’s opt-in enforcement does not itself contradict LLP 0127 decision 6: LLP 0108 explicitly describes declarations as evidence rather than ceilings while leaving later enforcement decisions open at `llp/0108-app-codegen-contracts-and-type-generation.rfc.md:877-882`. D6 is appropriately cautious about claiming global determinism, and the C11 refusal correctly respects LLP 0097’s requirement for exhaustive egress mediation at `llp/0097-branch-effect-isolation.rfc.md:60-69`.

## Findings

**BLOCKING-1 — The captured-dependency correction is false for Cloudflare live invalidation**

§“Correction to the motivating critique” and D1, `llp/0146-agentic-authoring-affordances.rfc.md:121-197`. The RFC concludes that declaration drift cannot break runtime behavior because live invalidation consumes captured dependencies. That is true locally, but not across Snapback’s shipped targets.

Cloudflare’s host context records reads at `cloudflare/src/host-ops.js:246-248` and appends query and point-read dependencies at `cloudflare/src/host-ops.js:562-611`. Those reads are not consumed by the coordinator. The coordinator expressly says captured read sets are recorded but not yet validated at `cloudflare/src/coordinator.js:1-25`; more importantly, live fanout filters functions using `functionTables(fn)` at `cloudflare/src/coordinator.js:5150-5167`, and `functionTables` returns the function’s declared `tables` at `cloudflare/src/coordinator.js:5539-5542`.

Consequently, a handler declaring table A but dynamically reading table B will not be selected when B changes. This is the precise runtime failure the RFC rules out at lines 150-158. The correction must be scoped by execution target, and D1 must treat Cloudflare’s captured-read consumption or equivalent conservative invalidation as a correctness seam—not merely an artifact-trust improvement. The Cloudflare, offline/RQS, and any other non-local arms must each receive an explicit verified disposition.

**MATERIAL-1 — “Query explain” is incorrectly listed as shipped**

§“Executive summary” and §“Shipped-baseline inventory,” `llp/0146-agentic-authoring-affordances.rfc.md:17-23,84-98`. The RFC says query explain is implemented and marks it “Shipped.” In fact, `src/host_ops.rs:145-153` recognizes several explain kinds, but `src/host_ops.rs:1686-1721` serves only `mutationDryRun` and returns `SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED` for `queryPlan` and the other kinds. The guide states the same limitation at `guide/operating/host-ops.md:66`.

The inventory must distinguish a shipped explain envelope/mutation dry-run from an unimplemented query-plan explain operation, and any decisions relying on the claimed baseline must be reassessed.

**MATERIAL-2 — D1’s evidence and three-state verdict cannot represent the cases it promises to cover**

D1, `llp/0146-agentic-authoring-affordances.rfc.md:162-197`. The RFC proposes one of `conformant`, `underDeclared`, or `overDeclared` per invocation. A single invocation can be both under- and over-declared: it may capture undeclared B while failing to exercise declared A. Moreover, absence from one branch’s captured set does not establish that A is globally over-declared.

The runtime also does not provide both complete sets for every handler path. Successful query and mutation execution populates captures in `src/local.rs:14973-15131`, while action results use empty captured sets at `src/local.rs:1705-1740`; failures may likewise lack a complete dependency witness, as documented in `src/host_ops.rs:183-188`.

D1 should expose independent missing/extra deltas, aggregate observations across branches or scenarios before calling something over-declared, and include an explicit `incomplete` or `unsupported` provenance state. Its acceptance coverage must specify which success, failure, action, relational, search, snapshot, and target-specific paths yield authoritative evidence.

**MATERIAL-3 — D2 does not yet close the pinned `acceptance.run` hole it cites**

D2, `llp/0146-agentic-authoring-affordances.rfc.md:199-229`. The pinned operation is a host operation with profile identity, counts, diagnostics, and artifact paths specified at `llp/0024-host-operation-contracts.rfc.md:129-143`. LLP 0042 explicitly deferred a server-side runner pending a dedicated design at `llp/0042-acceptance-runtime-control-plane.spec.md:192-202`.

D2 instead assigns orchestration and application-test execution to `snapback verify` in the CLI. It does not define whether `acceptance.run` projects the same core, invokes a subset, or remains unbuilt. Thus the claim that D2 “closes” that hole is unsupported.

The RFC must either define the shared core and CLI/HTTP/MCP projections—including the existing LLP 0024 result contract—or say that `verify` is a separate CLI composition and leave `acceptance.run` open. A replayable receipt must also bind the acceptance profile and test bytes, target/data identity, authority context, and relevant seed—not only the artifact generation as proposed at line 216.

**MATERIAL-4 — D3 duplicates an existing incremental-introspection proposal without resolving hash custody**

D3, `llp/0146-agentic-authoring-affordances.rfc.md:231-261`. LLP 0062 already names `introspect --changed-since <envelopeHash>` at `llp/0062-agentic-authoring-control-plane-plan.plan.md:1520-1521`. D3 introduces `snapback describe --changed-since <digestHash>` without deciding whether it extends, renames, or supersedes that interface.

A previous hash alone is insufficient to compute a delta unless some component retains or can retrieve the corresponding prior digest bytes. The RFC does not name the custodian, retention/expiry policy, authority boundary, or behavior for an unknown hash. Those are required decisions for truthful incremental semantics, not implementation trivia. D3 should reconcile its command and envelope with LLP 0062 and define hash lookup and fallback behavior.

**MATERIAL-5 — D4 cannot derive live-invalidation blast radius solely from two artifact generations**

D4, `llp/0146-agentic-authoring-affordances.rfc.md:263-289`. Schema, declaration, contract, and capability deltas can be artifact-derived. Local live invalidation, however, is based on runtime-captured dependencies; code behavior and data-dependent branches can change without a corresponding declaration delta. Two artifacts therefore cannot establish the actual live-invalidation blast radius under the correction defended by D1.

There is also existing partial implementation to reuse: `src/migration.rs:896-923` derives deterministic schema changes, and `src/cli.rs:779-813` exposes migration preview. D4 should distinguish declared/planned blast radius from observed blast radius, state what observation bundle is required for the latter, and define its relationship to the existing migration diff rather than presenting semantic diff as greenfield.

**MATERIAL-6 — D5 incorrectly says its protected-last-member class is not already covered**

D5, `llp/0146-agentic-authoring-affordances.rfc.md:291-336`. The RFC includes “protected-last-member” in its new finite vocabulary and then says these classes are not already covered by membership-transition invariants. Snapback already guards demotion of the final protected holder at `src/storage.rs:13192-13203` and removal of that holder at `src/storage.rs:13220-13263`.

If D5 intends to generalize the existing membership-specific rule, it must say so and specify how the generic invariant reuses or supersedes `membership.lastHolder`. It must also define transaction-final-state semantics, migration/existing-row validation, and the distinction between its “required referenced row” and existing membership resource-existence checks. Otherwise the vocabulary duplicates shipped behavior while leaving its genuinely new scope unclear.

**MATERIAL-7 — D6’s replay acceptance criterion exceeds its stated control over nondeterminism**

D6, `llp/0146-agentic-authoring-affordances.rfc.md:338-378`. The RFC says SQLite scheduling, sockets, OS threads, and external action ordering will be recorded but not controlled, yet requires a seeded violation to shrink into a scenario that reproduces on replay. Recording an uncontrolled ordering does not make that ordering enforceable during replay.

LLP 0054 already proposes controlled seams, generated operations, and safety/liveness properties at `llp/0054-deterministic-simulation-testing-for-snapback.research.md:243-334`, while explicitly remaining unratified research at `llp/0054-deterministic-simulation-testing-for-snapback.research.md:414-419`. D6 should state which parts it ratifies, define the scenario and shrink semantics it says are the real gap, and qualify replay guarantees to controlled seams—or add schedule capture/control sufficient to support the current criterion.

**MATERIAL-8 — D7’s example violates or fails to encode its own approval boundary**

D7, `llp/0146-agentic-authoring-affordances.rfc.md:380-418`. The text requires every remediation to carry a precondition and risk class, but the example contains no `riskClass`. It marks `useDifferentPrincipal` as `requiresApproval: false`, even though changing the effective principal is an authority-sensitive operation that the subsequent safety rule appears to exclude from machine application. Artifact-hash freshness does not resolve that authority risk.

The schema also lacks a positive `machineApplicable` discriminator, leaving consumers to infer automation safety from `requiresApproval`. LLP 0144 delegates wire-envelope ownership and requires caller-visible disclosure at `llp/0144-host-operation-semantics-analysis.rfc.md:223-249,318-338`; D7 leaves its carrier and disclosure behavior open.

The RFC must encode risk class, preconditions, machine applicability, approval requirements, and authority effects independently; make principal-changing remedies approval-requiring unless tightly constrained otherwise; and name the owning envelope/registry and projection behavior.

**DETAIL-1 — Several load-bearing source anchors point to the wrong operations**

§“Correction to the motivating critique,” `llp/0146-agentic-authoring-affordances.rfc.md:121-158`. `src/local.rs:13399` and `src/local.rs:14618` concern permission-epoch extraction, not general subscription invalidation. Registration occurs around `src/local.rs:13679-13692`, while mutation-triggered invalidation calls the live matcher at `src/local.rs:19174-19178`. Likewise, the cited mutation lines in `src/local.rs` forward `executed.reads`; the actual commit validator is reached at `src/storage.rs:4454-4457`. `FunctionRunResult` begins at `src/local.rs:1449`, not the inventory’s `src/local.rs:1447`.

The underlying local-runtime conclusion is mostly right, but the RFC must replace these anchors with the actual capture, registration, matching, and validation sites.

**DETAIL-2 — The candidate count is wrong**

§“Decision inventory,” `llp/0146-agentic-authoring-affordances.rfc.md:38-43,105-119`. The RFC says five candidates are declined or deferred, but C8 through C13 comprise six candidates. Update the count.

## Round 2 — 2026-08-01 (delta-scoped)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-01
**Method:** fresh non-author `codex exec` context, read-only delta review;
permitted to read only this family's round-1 artifact above, blind to the
fable artifact and the super-refine journal — verified after the fact
(the only occurrences of those filenames in the transcript are the prompt
echo, an unrelated `git status` listing, and citations inside other LLPs).
The prompt additionally carried a correction notice about round 1's
confabulated LLP filenames, instructing path resolution by directory
listing; the filenames in this round are correct.
**Instruction capsule SHA-256:** `430e8c16522abd3ad5d8b96ed22166e6756ae503d9f3d0d30336e1761149f103`
**Target:** `llp/0146-agentic-authoring-affordances.rfc.md` (v0.2, 901 lines, Draft)
**Target SHA-256:** `111b7b364b219e516d1667f9dd0a7efbec46346291cb4eaa58cc7fff3bcd9e29`
**Repo revision at review start:** working tree at v0.2 (pushed as `c28264cf`)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## Overall assessment

**Verdict: NOT READY**

v0.2 correctly repairs the central local-versus-Cloudflare account, but the correction remains incomplete: OQ12 leaves the current retention/RQS disposition open even though admission code already settles it. More importantly, D1’s revised evidence shape still cannot distinguish read from write conformance. These are load-bearing contract gaps, not merely permissible open policy choices. D3–D7 also contain several material delta-introduced contradictions described below.

## Round-1 finding dispositions

- **BLOCKING-1 — PARTIALLY FIXED:** local fallback and Cloudflare fan-out are now accurately described, but the required retention/RQS disposition remains OQ12 despite being source-resolvable (`src/manifest.rs:2299-2353,2973-2982`).
- **MATERIAL-1 — FIXED:** query-plan explain is correctly marked pinned/unbuilt (`llp/0146-agentic-authoring-affordances.rfc.md:112-117`; `src/host_ops.rs:1715-1721`).
- **MATERIAL-2 — PARTIALLY FIXED:** missing/extra deltas and provenance were added, but read/write classes remain collapsed and the baseline still falsely says both sets exist for “every handler” (`llp/0146-agentic-authoring-affordances.rfc.md:128-130,255-275`).
- **MATERIAL-3 — FIXED:** D2 explicitly withdraws the `acceptance.run` closure claim and leaves its relationship open (`llp/0146-agentic-authoring-affordances.rfc.md:328-335`).
- **MATERIAL-4 — PARTIALLY FIXED:** D3 reuses LLP 0062’s command and names custody, expiry, unknown-hash fallback, and authority as open, but its static `envelopeHash` cannot identify the newly dynamic digest state.
- **MATERIAL-5 — PARTIALLY FIXED:** D4 reuses migration derivation and separates declared from observed radius, but one new-generation observation bundle cannot establish an observed-radius change.
- **MATERIAL-6 — FIXED:** protected-last-member and membership-resource existence are honestly withdrawn against shipped enforcement (`src/storage.rs:13074-13094,13192-13263,14663-14710`).
- **MATERIAL-7 — PARTIALLY FIXED:** global replay is withdrawn, but the new `deterministic` classification still overclaims from controlled top-level steps.
- **MATERIAL-8 — PARTIALLY FIXED:** risk, machine applicability, approval, and authority effect are separated and principal changes now require approval, but two examples omit mandatory preconditions and wire ownership is misstated.
- **DETAIL-1 — FIXED:** the local capture, registration, matching, validation, and `FunctionRunResult` anchors now point to the relevant code.
- **DETAIL-2 — FIXED:** the declined/deferred count is now six (`llp/0146-agentic-authoring-affordances.rfc.md:63-64`).

## Strengths

I verified the rebuilt correction’s main claims. The local matcher first considers captured dependencies, returns to the runtime-specific arm when no query dependency exists, and the Ibex fallback filters through `read_set_summary.tables` (`src/live_matcher.rs:129-168,195-257`). Cloudflare selects affected live functions using `functionTables(fn)` over changed tables, while captured reads are recorded but unused for fan-out (`cloudflare/src/coordinator.js:5150-5167,5539-5542`; `cloudflare/src/host-ops.js:562-611`).

D2’s withdrawal is direct and complete. D4 correctly recognizes and reuses the existing deterministic schema derivation and preview (`src/migration.rs:896-926`; `src/cli.rs:779-813`). The D5 withdrawals accurately reflect the shipped membership guards. D6 no longer calls uncontrolled execution globally deterministic, and D7 correctly changes `useDifferentPrincipal` to approval-requiring.

## Findings

**BLOCKING-1 — The required retention/RQS disposition is left open even though current source settles it**

The correction says retention/RQS is out of scope and defers its factual disposition to OQ12 (`llp/0146-agentic-authoring-affordances.rfc.md:214-225,877-880`).

Verified source answers the current-state question:

- Local RQS eligibility requires a `HostPlan(Query)` with a complete plan-consistent single-table summary; opaque Ibex/JavaScript is ineligible (`src/manifest.rs:2299-2353`).
- General retainable-query admission likewise rejects opaque JavaScript as `opaqueJavaScript` (`src/manifest.rs:2973-2982`).
- Cloudflare applies the same HostPlan-plus-summary eligibility rule (`cloudflare/src/rqs-host.mjs:194-223`).
- Its behind-head RQS path has neither table-set nor witness replay and always falls back to a fresh replacement (`cloudflare/src/coordinator.js:1192-1198`).

Therefore hand-authored declaration drift has no current retention/RQS effect: the opaque-JS shape where such drift could occur is excluded. The RFC must record this verified disposition and reserve OQ12 only for future expanded eligibility.

**MATERIAL-1 — D1’s deltas do not preserve the read/write dependency class**

D1 defines only:

```text
missing: captured \ declared
extra:   declared \ captured-here
```

(`llp/0146-agentic-authoring-affordances.rfc.md:255-267`).

Verified source carries four separate collections: declared reads, declared writes, captured reads, and captured writes (`src/local.rs:1449-1458`). Collapsing them permits a read/write swap to disappear—for example, declared-read A/declared-write B versus observed-read B/observed-write A has equal untagged table unions despite two violations. Provenance may also differ by class.

The same section internally contradicts the baseline claim that both sets are computed for “every handler”: actions intentionally return empty captured sets (`llp/0146-agentic-authoring-affordances.rfc.md:128-130,269-275`; `src/local.rs:1705-1740`).

D1 must define four deltas or class-tagged elements, with provenance per dependency class, and qualify the shipped baseline to supported successful query/mutation paths.

**MATERIAL-2 — D3 reuses a static envelope hash for dynamic state that the hash cannot identify**

D3 insists on LLP 0062’s `<envelopeHash>` hash space while adding row-count magnitudes, recent refusal codes, and D1 observations (`llp/0146-agentic-authoring-affordances.rfc.md:371-395`).

Verified LLP 0062 defines `envelopeHash` as the SHA-256 content address of an immutable generated envelope (`llp/0062-generated-app-cli-and-code-mode.rfc.md:246-260,1011-1032`). Row counts and recent refusals can change repeatedly while that hash remains constant. Consequently, one envelope hash cannot identify which prior dynamic digest the caller observed.

OQ10’s options do not resolve this as written: retaining digest manifests requires a digest-snapshot identifier; presenting prior digest bytes is not the hash-only interface; resolving only to a generation cannot diff dynamic sections (`llp/0146-agentic-authoring-affordances.rfc.md:382-390,868-872`).

D3 must separate static envelope deltas from dynamic observation deltas or introduce a digest-snapshot identity/cursor bound to the envelope plus runtime observation state.

**MATERIAL-3 — D4 cannot calculate an observed-radius change from only a new-generation observation**

D4 says an observed radius may be reported when “an observation bundle” over the new generation is supplied (`llp/0146-agentic-authoring-affordances.rfc.md:444-463`). That provides a current observed radius, not a change between predecessor and successor.

This is a design inference from the proposed inputs: an observed delta requires comparable bundles for both generations, exercised under the same profile, tests/scenarios, data/seed, authority, target, and evidence-provenance rules. Otherwise absence on the old side may simply mean it was not exercised.

D4 must require paired comparable observations or label the result “current observed radius” rather than an observed-radius diff.

**MATERIAL-4 — D5’s promoted-relation refusal and reverse enforcement are not decidable as written**

D5 says codegen must refuse an `existsRelation` whose “target is a promoted incarnation” (`llp/0146-agentic-authoring-affordances.rfc.md:514-526`). Verified schema says a relation incarnation is a protected field on the child/source row, paired with a foreign-key field and a `parent_table`; it is not the target table or row (`src/manifest.rs:829-840`; `llp/0110-bounded-children-and-activity-patterns.spec.md:969-1000`). The proposed criterion therefore identifies the wrong side of the relationship.

The example also names only `targetIndex`. That bounds source insert/update validation, but `onTargetDelete: restrict` requires an indexed reverse lookup over source rows. Target-key updates need the same treatment, and concurrent source-insert/target-delete safety needs captured row/range dependencies—the kind of race contract existing membership relations spell out explicitly (`llp/0056-scoped-roles-and-memberships.rfc.md:564-588`).

D5 must define overlap using the source foreign-key/incarnation declaration, require or infer a source-side supporting index, and specify update and concurrency capture semantics.

**MATERIAL-5 — D6’s reproduction-class test does not account for uncontrolled behavior inside controlled steps**

D6 defines `deterministic` as every scenario step being a controlled seam, while acknowledging that SQLite, sockets, threads, actions, and external effects remain uncontrolled (`llp/0146-agentic-authoring-affordances.rfc.md:552-560,579-598`).

A controlled top-level step can still execute through one of those uncontrolled subsystems. Thus “every step is controlled” does not prove that the observed violation was independent of uncontrolled ordering. LLP 0054’s exact-replay proposal instead requires all nondeterministic inputs affecting observable behavior to pass through injected interfaces (`llp/0054-tigerbeetle-lessons-for-snapback.research.md:243-257`).

D6 must classify from transitive event/effect provenance, or conservatively mark any run touching an uncontrolled seam as `observed`. Probabilistic shrinking also needs a fixed trial budget and success criterion; otherwise “minimal” and “reproduction rate” are unstable.

**MATERIAL-6 — D7 still violates its own precondition rule and assigns wire ownership incorrectly**

D7 says every remediation carries a precondition, but `requestGrant` and `useDifferentPrincipal` have none in the revised example (`llp/0146-agentic-authoring-affordances.rfc.md:605-635`). The four safety axes are improved, but the example remains invalid under its own rule.

It also says LLP 0144 “owns the refusal wire envelope” (`llp/0146-agentic-authoring-affordances.rfc.md:652-656`). Verified LLP 0144 explicitly assigns first-class envelope-shape changes to LLP 0094 and keeps the current application refusal inside diagnostic details (`llp/0144-declared-app-refusal-codes.rfc.md:318-328`).

Add preconditions or explicitly make them optional for named remediation classes, and assign carrier/projection ownership to the 0094/0095 wire-contract family while retaining 0144’s refusal and disclosure constraints.

**DETAIL-1 — The “other arms” search disposition is factually inaccurate**

The RFC groups search with plan-table invalidation and says it never consults captured dependencies (`llp/0146-agentic-authoring-affordances.rfc.md:214-223`). Current search execution is one-shot `FunctionKind::Query`, not `LiveQuery`, and it captures a `Query` dependency with no predicate (`src/local.rs:22591-22680`). If passed to the matcher, the missing predicate produces a conservative `Some(true)` before the plan-table fallback (`src/live_matcher.rs:237-257`).

Describe current search as non-live; do not characterize it as plan-table live invalidation.

**DETAIL-2 — `functionTables` is not exactly “the declared fn.tables”**

The RFC says `functionTables` returns declared `fn.tables` (`llp/0146-agentic-authoring-affordances.rfc.md:197-207`). Verified code returns the first schema table when `fn.tables` is absent or empty (`cloudflare/src/coordinator.js:5539-5542`). This does not change the demonstrated A-versus-B defect, but the factual description should include the fallback.

## Round 3 — 2026-08-01 (delta-scoped)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-01
**Method:** fresh non-author `codex exec` context, read-only delta review;
permitted to read only this family's artifact above, blind to the fable
artifact and the super-refine journal. LLP paths resolved by directory
listing per the round-2 correction notice; filenames in this round are
correct.
**Instruction capsule SHA-256:** `c8a064f831bc222d507473f1ba5c319c45327954ac2b4e385c94455738736af0`
**Target:** `llp/0146-agentic-authoring-affordances.rfc.md` (v0.3, 1043 lines, Draft)
**Target SHA-256:** `9d3658ad85ed9c9402d5373e069c3469ed1acfe377b81accd678c168f00393c4`
**Repo revision at review start:** working tree at v0.3 (pushed as `f946e69a`)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## Overall assessment

**Verdict: NOT READY**

v0.3 resolves most round-2 findings correctly, but D5 remains materially inconsistent: its source-side overlap predicate compares incompatible schema concepts, and its proposed syntax cannot name the reverse index the normative text requires. D3 also introduces a second delta key without defining how callers supply it. These are unresolved contract defects rather than named policy questions.

## Round-2 finding dispositions

- **BLOCKING-1 — FIXED:** the RFC now records the correct no-effect disposition for opaque JavaScript and narrows OQ12 to future eligibility expansion (`llp/0146-agentic-authoring-affordances.rfc.md:269-279,1017-1022`; `src/manifest.rs:2973-2982`). A narrower factual overstatement introduced by this repair is DETAIL-1 below.
- **MATERIAL-1 — FIXED:** D1 defines four class-preserving deltas and separate read/write provenance (`llp/0146-agentic-authoring-affordances.rfc.md:317-333`), matching the four source collections (`src/local.rs:1449-1458`). Stale shorthand remains as DETAIL-2.
- **MATERIAL-2 — FIXED:** D3 separates immutable-envelope deltas from dynamic observations and introduces `digestCursor` (`llp/0146-agentic-authoring-affordances.rfc.md:448-471`). The resulting command-carrier gap is MATERIAL-2 below.
- **MATERIAL-3 — FIXED:** an observed-radius change now requires paired comparable bundles; one bundle is explicitly only a current radius (`llp/0146-agentic-authoring-affordances.rfc.md:525-536`).
- **MATERIAL-4 — PARTIALLY FIXED:** D5 moves the intended check toward the source side and adds reverse-index, target-update, final-state, and concurrency requirements (`llp/0146-agentic-authoring-affordances.rfc.md:610-639`), but the overlap predicate and index syntax remain defective as MATERIAL-1 below.
- **MATERIAL-5 — FIXED:** classification now follows transitive event/effect provenance, with conservative fallback to `observed`, and probabilistic shrinking has a fixed budget and success criterion (`llp/0146-agentic-authoring-affordances.rfc.md:686-710`).
- **MATERIAL-6 — FIXED:** both authority remediations now carry preconditions, and carrier ownership is correctly assigned to LLP 0094/0095 (`llp/0146-agentic-authoring-affordances.rfc.md:739-788`; `llp/0144-declared-app-refusal-codes.rfc.md:318-338`).
- **DETAIL-1 — FIXED:** search is correctly described as one-shot `FunctionKind::Query` (`llp/0146-agentic-authoring-affordances.rfc.md:262-268`; `src/manifest.rs:1163-1165`; `src/local.rs:22591-22684`).
- **DETAIL-2 — FIXED:** the Cloudflare first-schema-table fallback is now recorded accurately (`llp/0146-agentic-authoring-affordances.rfc.md:231-246`; `cloudflare/src/coordinator.js:5539-5542`).

## Strengths

I verified the major new factual foundations:

- `FunctionRunResult` has distinct declared reads, declared writes, captured reads, and captured writes (`src/local.rs:1449-1458`).
- LLP 0062 defines `envelopeHash` as the content address of an immutable envelope (`llp/0062-generated-app-cli-and-code-mode.rfc.md:246-260,1011-1034`), so D3 is right that dynamic observations need another identity.
- A relation incarnation is a protected field on the child/source row, paired with a foreign-key field and parent table (`src/manifest.rs:829-840`; `llp/0110-bounded-children-and-activity-patterns.spec.md:991-1000`).
- Search is admitted only as a one-shot query and captures a conservative predicate-less query dependency (`src/manifest.rs:1153-1198`; `src/local.rs:22591-22684`).
- LLP 0094 governs wire-envelope families and closes the error envelope (`llp/0094-wire-envelope-contract.spec.md:85-121,707-734`); LLP 0144 explicitly delegates first-class carrier changes to LLP 0094/0095 (`llp/0144-declared-app-refusal-codes.rfc.md:318-338`).
- The local empty-declaration fallback is conservative, and the no-query-dependency fallback is reachable after point-read-only success (`src/live_matcher.rs:129-168,195-257`). The Cloudflare fallback is accurately described as arbitrary rather than conservative (`cloudflare/src/coordinator.js:5150-5167,5539-5542`).

## Findings

**MATERIAL-1 — D5’s repaired relation predicate and reverse-index contract remain unspellable**

Verified source establishes that `RelationIncarnation` is a field on the source table whose metadata contains a `foreign_key_field` and a `parent_table` (`src/manifest.rs:829-840`). The RFC instead says the source table and `sourceFields` must “coincide with” the `foreign_key_field`/`parent_table` pair (`llp/0146-agentic-authoring-affordances.rfc.md:610-619`). That compares unlike concepts: `parent_table` is a table identity, not a member of `sourceFields`. A correct predicate must relate at least the D5 source table, the incarnation’s foreign-key field, and D5’s target table equal to the incarnation’s `parent_table`.

The reverse-index repair is also absent from the proposed shape. The example exposes only `targetIndex` (`llp/0146-agentic-authoring-affordances.rfc.md:566-576`), while the normative text says both supporting indexes must be nameable (`llp/0146-agentic-authoring-affordances.rfc.md:621-626`). The acceptance text then reverts to the rejected target-side wording (`llp/0146-agentic-authoring-affordances.rfc.md:641-646`).

Add a source/reverse-index field or a deterministic inference rule, state the overlap predicate using correctly typed source-field and target-table comparisons, and update the acceptance criterion to match.

**MATERIAL-2 — D3 defines two delta keys but exposes only the old one-key command**

Verified LLP 0062 proposes only `introspect --changed-since <envelopeHash>` (`llp/0062-generated-app-cli-and-code-mode.rfc.md:1520-1521`). v0.3 retains that exact command (`llp/0146-agentic-authoring-affordances.rfc.md:437-446`) while deciding that the static and dynamic sections use `envelopeHash` and `digestCursor` respectively (`llp/0146-agentic-authoring-affordances.rfc.md:448-463`).

It is therefore an interface inference, but a necessary one: the shown request cannot tell the server which prior dynamic observation the caller saw. OQ10 discusses cursor custody and expiry, not how the cursor enters the command or how both delta bases are combined (`llp/0146-agentic-authoring-affordances.rfc.md:1008-1012`).

Define the request/output carrier for `digestCursor`, or explicitly name that interface shape as open. The acceptance criteria should exercise a dynamic-only change while `envelopeHash` remains unchanged.

**DETAIL-1 — The repaired retention paragraph overstates the eligible HostPlan shape**

The conclusion that opaque-JavaScript drift has no current retention effect is verified: opaque JavaScript is refused (`src/manifest.rs:2973-2982`). But the RFC says retention eligibility requires `HostPlan(Query)` with a single-table summary (`llp/0146-agentic-authoring-affordances.rfc.md:269-275`). That is true for RQS eligibility (`src/manifest.rs:2299-2353`), not for all retention: general retainable-query admission also accepts qualifying `HostPlan(RelationalQuery)` functions (`src/manifest.rs:2891-2971`).

Separate the statements: RQS requires the single-table Query profile; broader retention also admits a plan-consistent relational profile; both exclude opaque JavaScript.

**DETAIL-2 — D1’s report and acceptance prose still names the superseded unclassified fields**

After normatively defining `missingReads`, `missingWrites`, `extraReads`, `extraWrites`, `readProvenance`, and `writeProvenance` (`llp/0146-agentic-authoring-affordances.rfc.md:317-333`), the report and acceptance text still promises singular `missing`, `extra`, and `provenance` fields (`llp/0146-agentic-authoring-affordances.rfc.md:343-350,373-380`).

Update those passages to use the class-specific fields so the acceptance contract tests the repair actually adopted.
