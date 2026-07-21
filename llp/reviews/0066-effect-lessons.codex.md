**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.6 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, approval never; non-interactive `codex exec` orchestrated by /llp-super-refine
**Date:** 2026-07-20
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner

# LLP 0066 reviews — GPT family

## Round 1 — 2026-07-20

**Revision under review:** `llp/0066-effect-lessons.research.md`, sha256 `523ed1341898e33717ed5d0981300d04ed199f5d277f57bea294ccfcc55cf101` (untracked file at repo HEAD `a75ddd5`)
**Runtime detail:** codex session id 019f82e4-ea2a-7d20-aa8b-9fc662a64f59, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. After the review snapshot was taken, a concurrent fleet edit added a `**Revised:**` header line to the working-tree file; the review below is of the pinned pre-edit revision.
**Verdict:** NOT READY

### Review body (verbatim)

MATCH — sha256 `523ed1341898e33717ed5d0981300d04ed199f5d277f57bea294ccfcc55cf101`

## 1. Overall assessment

This is a useful research direction with a sound high-level conclusion: Snapback should mine Effect for operational ideas without adopting Effect’s pervasive programming model. The document is candid about confidence and generally conservative about future work.

However, it is not ready in its current form. Its two principal findings—durable workflows and retry policies—mischaracterize important existing Snapback mechanisms and omit load-bearing safety constraints. It also overstates equivalence between Snapback diagnostics and Effect’s typed error channel. These errors weaken the claim that the document has identified exactly two genuine gaps.

The best revision would retain the recommendations while replacing the broad comparisons with an explicit capability matrix and grounding future workflow/retry work in Snapback’s existing cron, mutation-settlement, authority, and ordering designs.

## 2. Strengths

- The provenance section honestly distinguishes public Effect documentation, repository evidence, and the author’s inferences (`llp/0066-effect-lessons.research.md:37-43`). The disclosure that Effect’s implementation was not source-verified is appropriately cautious.

- The description of Effect’s central abstractions is broadly accurate (`llp/0066-effect-lessons.research.md:12-18`). Official documentation supports the three-channel `Effect<Success, Error, Requirements>` model, Tags/Layers, Schema, Schedule, fibers, streams, and tracing. The workflow package is also correctly treated as an alpha surface.

- The document correctly recognizes that Snapback already has a real, enforced schema-drift story (`llp/0066-effect-lessons.research.md:59-65`). Generated framework schemas and CI comparison are documented in `llp/0037-schema-source-of-truth.decision.md:143-172` and implemented in `src/schema_export.rs:1-16`.

- It identifies a genuine opportunity for a general-purpose durable workflow or job facility, provided that the gap is narrowed. Existing LLPs explicitly note the absence of a general durable background-job subsystem (`llp/0044-asset-storage-pipeline.rfc.md:94-104`, `llp/0045-notifications-outbox.rfc.md:64-74`).

- The recommendation not to import Effect as a dependency or impose its monadic API (`llp/0066-effect-lessons.research.md:111-119`, `llp/0066-effect-lessons.research.md:129-138`) is well aligned with Snapback’s plain, agent-oriented authoring surface (`llp/0000-snapback.explainer.md:718-724`).

- The document appropriately keeps durable workflows at research/RFC distance and assigns only medium confidence to the proposed composition (`llp/0066-effect-lessons.research.md:121-127`). That restraint is correct for a Research LLP.

- The observability finding is directionally strong (`llp/0066-effect-lessons.research.md:103-109`). Snapback has diagnostics and inspection facilities, but the root LLP still treats broader observability as future work (`llp/0000-snapback.explainer.md:925-929`).

## 3. Concerns

### 3.1 Typed errors are not equivalent to Snapback’s current diagnostics

**Severity: major**

The document says Snapback’s structural diagnostics and Contract state arms are “the equivalent” of Effect’s typed error channel and concludes that no change is needed (`llp/0066-effect-lessons.research.md:47-57`).

Snapback diagnostics currently expose an open `code: string` and open-ended details:

- `src/diagnostic.rs:22-29`
- `schemas/diagnostic.schema.json:15-28`
- `demos/_kit/client.d.mts:1-15`

The application API provides typed arguments and successful return values, but not a generated, closed error union for each operation (`llp/0004-application-data-api.rfc.md:303-320`). Contract’s loading/error/empty/ready arms model UI lifecycle state; they do not provide Effect-style typed operation failures or exhaustiveness over error cases.

**Resolution criteria:** Recast this as a partial correspondence. Distinguish runtime diagnostic structure, UI lifecycle state, and statically declared operation failure channels. Either identify typed failures as an intentional non-goal or record a narrower research opportunity, such as deriving discriminated diagnostic unions from a Rust-owned diagnostic registry.

### 3.2 “Only two genuine gaps” is unsupported and internally inconsistent

**Severity: major**

The summary names typed errors, Layers, structured concurrency, streams, tracing, workflows, and scheduling, then asserts that only workflows and retry policies are genuine gaps (`llp/0066-effect-lessons.research.md:12-31`). The findings do not evaluate Layers, structured concurrency, or streams. F5 then identifies missing cross-boundary tracing, which is itself a gap (`llp/0066-effect-lessons.research.md:103-109`). F1 is at best partial equivalence.

This makes the document’s headline conclusion stronger than its evidence.

**Resolution criteria:** Add a compact capability matrix covering every Effect proposition named in the summary, classifying each as equivalent, partial, intentional non-goal, unassessed, or gap. Replace “only two genuine gaps” with “two prioritized opportunities” unless the completed matrix justifies exclusivity.

### 3.3 The workflow finding overlooks Snapback’s closest existing implementation

**Severity: major**

The claim that “Snapback has none” and that LLP 0000 acknowledges this is inaccurate (`llp/0066-effect-lessons.research.md:25-28`). LLP 0000 does not document a workflow gap in those terms.

More importantly, accepted LLP 0028 already specifies and implements substantial durable-execution machinery:

- Stable scheduled-run identities and leased claims: `llp/0028-cron-scheduled-execution.rfc.md:300-310`
- Per-sequence mutation-result persistence and replay: `llp/0028-cron-scheduled-execution.rfc.md:311-329`
- Retry returning prior committed results: `llp/0028-cron-scheduled-execution.rfc.md:331-337`
- Implemented result ledger: `cloudflare/src/coordinator.js:354-369`, `cloudflare/src/coordinator.js:1650-1675`
- Recovery acceptance coverage: `cloudflare/test/acceptance.cron-recovery.mjs:89-118`

The actual gap is narrower: Snapback lacks a general, on-demand, portable workflow API for long-lived orchestration and external activities. LLPs 0044 and 0045 are stronger evidence for that gap than LLP 0000.

The cited composition is also unreliable. LLP 0004 does not define the claimed “receipts,” and LLP 0052 is not an authority on outbox ambiguity (`llp/0066-effect-lessons.research.md:79-86`).

**Resolution criteria:** Reframe F3 around the missing general-purpose surface, cite LLP 0028 as the closest prior art, and cite LLPs 0044/0045 for the remaining gap. Correct or remove the references to LLPs 0000, 0004, and 0052. Enumerate what must be generalized beyond cron: invocation, step identity, long-lived control flow, external activities, retention, portability, and local/hosted parity.

### 3.4 The workflow sketch does not address external-effect ambiguity

**Severity: major**

The proposed rule that every step records its result “at commit” works for a database mutation when the outcome row and application changes share a transaction (`llp/0066-effect-lessons.research.md:79-86`). It does not make payment, email, or arbitrary API calls exactly once.

A process can crash after an external provider accepts an action but before Snapback persists the result. Existing cron recovery explicitly permits external egress to repeat even when database mutations are deduplicated (`llp/0028-cron-scheduled-execution.rfc.md:311-320`; `cloudflare/test/acceptance.cron-recovery.mjs:131-140`). Actions are also not globally transactional; earlier mutations survive later failure (`llp/0047-hosted-execution-limits.rfc.md:102-113`).

Connectionless receipts cannot solve this: they prove settlement state, not arbitrary activity results, and intentionally exclude application row data (`schemas/receipt.schema.json:44-107`, `src/live_wire.rs:271-315`).

**Resolution criteria:** Split the proposed step model into at least:

1. Database mutations whose result ledger is committed atomically.
2. External activities requiring provider idempotency keys, status lookup, a server-side intent/outbox, compensation, or an explicit ambiguous/manual state.
3. Pure deterministic computation.

State that Snapback cannot promise exactly-once external effects. Define stable workflow/step identities, fencing, versioning, retention, compensation, and ambiguity behavior before claiming the approach is materially smaller than a conventional workflow engine.

### 3.5 The retry-policy finding misstates current behavior and omits ordering constraints

**Severity: major**

The document says Snapback retry behavior is uniform, hard-coded, and invisible to manifests and verifiers (`llp/0066-effect-lessons.research.md:92-101`). That is not true across Snapback:

- Cron manifests already carry a generated retry policy: `packages/snapback-codegen/index.mjs:2336-2345`, `src/manifest.rs:2067-2084`.
- LLP 0028 defines the current `NextTick` policy and fail-closed treatment of unsupported backoff: `llp/0028-cron-scheduled-execution.rfc.md:573-594`.
- Client mutation replay is evidence-sensitive rather than uniform. Connectivity ambiguity remains queued, while an origin-signed rejection settles failure (`packages/snapback-contract/index.mjs:2090-2117`).
- Replay preserves strict mutation ordering and stops at unresolved ambiguity (`llp/0043-offline-replay-retention.rfc.md:148-168`).
- Mutation conflicts already carry a machine-readable reject policy (`src/storage.rs:6958-6969`) and are documented as reconcile-with-fresh-state rather than blind retry (`guide/backend/mutations.md:137-148`).

Effect’s `Schedule` is a composable executable value; it is not inherently a serializable policy-data format. Moreover, a per-mutation delay policy creates an unresolved queue question: delaying the head mutation either blocks later mutations or violates the current causal ordering guarantee.

**Resolution criteria:** Reframe the gap as declarative retry timing and attempt/deadline policy for failures already classified as retryable. Separate failure eligibility from scheduling. Incorporate the existing cron policy, mutation evidence classes, nonretryable conflict/auth/validation cases, ambiguity settlement, and FIFO ordering. Clarify that verifiers can prove policy declaration and runtime conformance—not arbitrary operational outcomes.

### 3.6 The schema comparison is too broad

**Severity: minor**

F2 says Snapback has the same principle as Effect Schema with a stronger enforcement story (`llp/0066-effect-lessons.research.md:59-65`). Snapback’s enforced derivation currently concerns framework-owned shared wire artifacts (`llp/0037-schema-source-of-truth.decision.md:69-94`). Application schema remains TypeScript-authored (`llp/0004-application-data-api.rfc.md:89-125`). “Stronger” is also undefined across two differently scoped systems.

**Resolution criteria:** Scope the claim to Snapback-owned cross-language wire artifacts and define “stronger” specifically as a committed, CI-enforced Rust/schema drift gate. Otherwise remove the comparative adjective.

### 3.7 External provenance is honest but insufficiently auditable

**Severity: minor**

The provenance caveat is honest, but the document does not identify exact Effect URLs, package versions, source revisions, or the secondary sources behind adoption and criticism claims (`llp/0066-effect-lessons.research.md:33-43`, `llp/0066-effect-lessons.research.md:111-119`). This is weaker than the corpus’s observed/inferred convention (`llp/0001-prior-art.research.md:25-49`).

The claims that adoption grew because teams hit operational limits and that the learning curve is the “most common criticism” are causal or superlative claims without visible evidence. Workflow identity should also note that Effect combines the workflow name with the payload-derived idempotency key, and retryable activities may have multiple attempts.

The metadata header omits the standard `Revised` field.

**Resolution criteria:** Add a dated source table with exact URLs and relevant package/repository revision, distinguish stable Effect core concepts from alpha workflow internals, qualify or source the adoption/criticism claims, and add `Revised`.

## 4. Suggestions (non-blocking)

- Treat Snapback’s client mutation settlements, cron result ledger, subsystem intent/outbox patterns, and a future workflow ledger as one family of durable-operation protocols. A shared vocabulary for identity, claim, attempt, settlement, ambiguity, and retention would reduce duplicated design.

- Consider a generated diagnostic registry that produces JSON Schema, TypeScript discriminated unions, documentation, and Contract match helpers. This could capture part of Effect’s typed-error benefit without importing its programming model.

- Model retries as a closed table from failure class to eligibility, schedule, ordering domain, and terminal settlement. This is easier to verify than embedding all semantics in a single “retry policy” field.

- Default any first workflow ledger to the existing per-application authority. LLP 0007 currently requires one version authority per application and warns against intra-application sharding (`llp/0007-portable-storage-and-target-parity.rfc.md:249-258`). Separate workflow sharding should wait for evidence that this boundary is insufficient.

- Replace “smaller lift than Temporal” with a bounded comparison table listing guarantees included and explicitly omitted. Effect’s design still entails durable request/reply state, shard ownership, retries, interruption, clocks, and replay.

## 5. Open questions

- What exact first use case requires a general workflow facility rather than the existing cron ledger plus a domain-specific intent table?

- Are workflows limited to server-side orchestration, or can client-authored sagas participate? What authority owns their state?

- How are step identities kept stable across code edits, reordered branches, loops, and workflow-version upgrades?

- Which external systems provide idempotency or status lookup, and what is the user-visible outcome when neither exists?

- Does delayed retry block a mutation ordering domain, or can independent domains advance safely? How are those domains declared?

- Can the current Cloudflare cron result-ledger design become a shared portable abstraction, including local targets, rather than introducing a parallel subsystem?

- How are running workflows exported, migrated, retained, garbage-collected, and restored across hosting targets?

- Which Effect concepts—Layers, structured concurrency, and streams—are genuine matches, intentional non-goals, or still unassessed?

- Is there sufficient user evidence to prioritize workflows or configurable retries above the separately identified tracing gap?

## 6. Readiness verdict

NOT READY

### Orchestrator verification (round 1)

Spot-checked the decisive claims without altering the verbatim body. Confirmed: LLP 0028 lines ~300–337 document leased claims, per-sequence mutation-result persistence in the same Durable Object SQLite transaction, and retry-returns-prior-committed-result (with egress explicitly allowed to repeat) — concern 3.3's prior-art claim and 3.4's external-effect-ambiguity evidence are accurate. Confirmed cron manifests carry `retryPolicy: spec.retryPolicy ?? { mode: 'NextTick' }` (`packages/snapback-codegen/index.mjs:2344`) and `src/manifest.rs` has a `CronRetryPolicy` type — concern 3.5's "not uniform/hard-coded everywhere" premise is accurate. The concern-3.3 note that LLP 0000 does not acknowledge a workflow gap matches the orchestrator's independent grep (only LLP-authoring-workflow hits). Both reviewer families independently flagged the LLP 0052 miscite, the LLP 0004 receipts misattribution, the unsupported LLP 0000 claim, and the missing `Revised:` field. Disposition: round-2 revision will reframe F3 around LLP 0028 as closest prior art plus the narrower general-surface gap (citing 0044/0045, and LLP 0070 which appeared concurrently in the tree), split the step model into atomic-mutation vs external-activity vs pure classes, recast F1 as partial correspondence, scope F2, rewrite F4 around the existing cron retryPolicy and evidence-class replay semantics, add a capability-disposition matrix, and tighten external provenance.

## Round 2 — 2026-07-20

**Revision under review:** `llp/0066-effect-lessons.research.md`, sha256 `6e2d8c0d149c54bb34b8c3d8d4d05a8534b770ad5753a592cd85ba6cf13888f5` (pinned at repo HEAD `0e05b7b`; the reviewer observed HEAD had moved to `edd8768` under concurrent fleet activity mid-round — the hash matched, so the reviewed content is the intended revision)
**Runtime detail:** codex session id 019f82f4-b533-7a63-92ca-57214dc667dd, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

MATCH — sha256 `6e2d8c0d149c54bb34b8c3d8d4d05a8534b770ad5753a592cd85ba6cf13888f5`

## 1. Overall assessment

This is valuable research. The durable-workflow and retry-policy findings are well chosen, grounded in Snapback’s actual machinery, and appropriately routed toward LLP 0070 rather than presented as an implementation plan. The document’s learn-without-wholesale-adoption posture is sensible as a hypothesis.

It needs revision before acceptance. F1 materially overstates Effect’s error guarantees, F4 incorrectly describes unsigned receipts as “origin-signed,” and F6 promotes an inferred preference into a settled non-goal and blanket dependency prohibition without sufficient evidence.

The provenance section is generally candid: it identifies the observation date, discloses the lack of Effect source verification, marks workflow/Cluster as alpha, and distinguishes secondary-source impressions. That honesty is undermined by the specific overclaims below.

Review-environment note: the target digest matched exactly. The checkout’s current HEAD was `edd87680c3a1b40ab7edd035ad0fb17263f94bec`, not the stated `0e05b7b…`; supporting files relevant to this review were unchanged between those revisions. I did not inspect `llp/reviews/`.

## 2. Strengths

- The disposition matrix avoids claiming false equivalence and clearly separates partial correspondence, gaps, and unassessed areas (`llp/0066-effect-lessons.research.md:43-55`). This is a strong organizing device.

- F3 is the strongest finding (`llp/0066-effect-lessons.research.md:112-163`). The cron ledger, transactional mutation-result replay, repeatable external egress, and LLP 0070’s job-shaped scope are accurately represented by LLPs 0028, 0044, 0045, 0047, and 0070. The distinction between transactionally ledgered database work and ambiguous external effects is load-bearing and correct in substance.

- F4 correctly retracts the earlier “uniform and hard-coded” characterization and separates failure classification from retry timing (`llp/0066-effect-lessons.research.md:165-196`). Cron’s manifest policy, mutation replay’s evidence-sensitive settlement, strict FIFO behavior, and conflict non-retry guidance are all supported by the repository.

- F1 correctly identifies Snapback’s actual partial correspondence: open structured diagnostics and presentation-state arms are not closed operation-specific failure unions (`llp/0066-effect-lessons.research.md:79-93`; `src/diagnostic.rs:22-31`; `guide/clients/contract-adapter.md:227-231`).

- The document appropriately gates workflow priority on a concrete use case and exposes the hard design questions—step identity, retention, upgrades, ordering domains, portability, and authority (`llp/0066-effect-lessons.research.md:257-272`).

## 3. Concerns

### Major — F1 overstates Effect’s typed-error guarantee

**Evidence:** F1 says Effect’s type system “enumerates each computation’s failure modes and enforces exhaustive handling” (`llp/0066-effect-lessons.research.md:75-77`). Effect’s official documentation says the error channel tracks expected errors and unions them through composition; unexpected defects remain outside that channel, and an Effect with a non-`never` error channel can still be executed without first exhaustively handling it. Exhaustive tag matching is an available helper, not a universal execution requirement. See [Expected Errors](https://effect.website/docs/error-management/expected-errors/), [Unexpected Errors](https://effect.website/docs/error-management/unexpected-errors/), and [The Effect Type](https://effect.website/docs/getting-started/the-effect-type/).

This matters because F1 uses the stronger claim to frame Snapback’s diagnostic-registry opportunity and assigns high confidence to the comparison.

**Resolution criteria:** Replace the claim with wording such as: “Effect tracks a typed union of expected errors and provides tag-aware, exhaustively checked matching helpers.” Explicitly exclude defects and acknowledge that callers may execute effects without eliminating the expected-error channel. Reassess the associated confidence statement.

### Major — Snapback receipts are not “origin-signed”

**Evidence:** F4 says “an origin-signed rejection settles as failure” (`llp/0066-effect-lessons.research.md:175-178`). `Receipt::Mutation` contains identity, outcome, version, transport, correlation, and timing fields, but no signature or MAC (`src/live_wire.rs:278-315`). The Contract adapter tests only whether `error.receipt` is present before settlement (`packages/snapback-contract/index.mjs:2090-2117`, `2803-2824`). LLP 0043 describes provider-core evidence that the origin reached its ACK stage, not cryptographic proof (`llp/0043-offline-replay-retention.rfc.md:189-206`).

This is a security-significant distinction: authenticated transport and an origin-emitted receipt are not the same thing as signed evidence.

**Resolution criteria:** Replace “origin-signed rejection” with “rejection carrying a provider-core receipt” and state the applicable authenticated-transport/trust-boundary assumption. Do not imply cryptographic verification unless such signing and client validation are actually implemented.

### Major — F6 turns an inference into a settled and overbroad policy

**Evidence:** The matrix labels the Effect type an “Intentional non-goal” (`llp/0066-effect-lessons.research.md:55`), while Recommendation 3 becomes “Do not adopt Effect as a dependency” (`llp/0066-effect-lessons.research.md:252-255`). No governing LLP establishes that decision. LLP 0000 supports plain, locally understandable authoring surfaces, but it does not demonstrate that agents perform worse with Effect or that an isolated internal dependency would infect public authoring contracts (`llp/0000-snapback.explainer.md:705-730`). Human learning-curve impressions do not establish agent ergonomics. The claim that Effect would exchange this simplicity for “guarantees Snapback already gets structurally” also conflicts with the document’s own gap, partial, and unassessed rows (`llp/0066-effect-lessons.research.md:47-55`, `211-219`).

**Resolution criteria:** Relabel this as a “recommended non-adoption posture `[inferred]`,” limited to Effect values and monadic composition in Snapback’s public authoring and serialized contracts. Treat internal/tooling dependencies as separate, need-driven evaluations. Replace the “already gets” rationale with matrix-consistent wording and define an evidence-based revisit trigger.

### Minor — F1’s diagnostic-registry proposal has incorrect scope and ownership

**Evidence:** F1 characterizes diagnostics as stable `SNAPBACK_*` codes and proposes a Rust-owned registry yielding closed unions per operation family (`llp/0066-effect-lessons.research.md:79-98`). Codes are open and multi-owner: declarative mutations accept app-authored codes such as `TODO_NOT_FOUND` (`packages/snapback-codegen/define.mjs:712-722`; `packages/snapback-codegen/data-tier-corpus.mjs:586-602`), which Rust emits verbatim (`src/storage.rs:2653-2690`). Other producers live in JavaScript and scripts. LLP 0037 explicitly requires reconsidering authority when Rust is not the natural owner (`llp/0037-schema-source-of-truth.decision.md:111-121`).

**Resolution criteria:** Describe stable machine-readable codes without implying a universal prefix. Either narrow the registry to Rust-owned framework diagnostics or sketch a federated catalog with producer ownership, operation-family declarations, shared infrastructure failures, and an unknown/generic fallback. Do not promise closed unions for opaque handlers without changing their contract.

### Minor — F2 contains as-built and comparative inaccuracies

**Evidence:** Application schemas are currently source-authored JavaScript ESM in `schema.mjs`, not TypeScript (`llp/0066-effect-lessons.research.md:102-109`; `guide/getting-started/your-first-backend.md:22-59`; `packages/snapback-codegen/index.mjs:506-518`). LLP 0037 governs all Snapback-owned shared artifact shapes, not only “wire artifacts” (`llp/0037-schema-source-of-truth.decision.md:67-94`). Calling Snapback’s enforcement “stronger” is also an untagged comparative judgment rather than a verified fact.

**Resolution criteria:** Say that application data-model declarations are app-owned and source-authored JavaScript as built; describe LLP 0037’s scope as Snapback-owned shared artifact shapes; replace “stronger” with the concrete difference—committed generated schemas plus CI drift detection—or mark and define the comparison as inferred.

### Minor — F3 needs more precise replay and external-effect terminology

**Evidence:** Calling the proposed activity ledger “exactly LLP 0028’s mutation-sequence replay, generalized” overstates equivalence (`llp/0066-effect-lessons.research.md:131-142`). LLP 0028’s mechanism is scheduler-specific and positionally keyed; stable workflow-step identity across code changes remains unsolved. Effect’s own [workflow README](https://github.com/Effect-TS/effect/tree/main/packages/workflow) says an activity executes once unless `Activity.retry`; retry attempts have distinct attempt identities, so “first completion across possibly multiple attempts” obscures the granularity being persisted.

Likewise, “external effects … are at-least-once at best” (`llp/0066-effect-lessons.research.md:144-148`) conflates re-attempt policy with provider-side outcome. Outcomes can be ambiguous, zero, at-most-once, or effectively once through provider idempotency and lookup.

**Resolution criteria:** Describe LLP 0028 as “the same transactional result-ledger pattern,” state Effect’s attempt-scoped semantics precisely, and say that workflow recovery may re-attempt external activities but cannot make them transactionally exactly-once. Mark the three step classes as non-exhaustive or add durable orchestration primitives such as timers, signals, and compensation.

### Minor — F5’s literal tracing and correlation claims are inaccurate

**Evidence:** Snapback does contain tracing code: `HostCallTraceEntry` records V8/Ibex conformance traces (`src/runtime.rs:1748-1809`). It is not operational distributed tracing, so the substantive gap remains. Also, the outbox entry ID does not itself flow into `LiveEnvelope`; the join is queue ID → mutation receipt → snapshot/commit version → live envelope (`src/live_wire.rs:42-60`, `292-315`).

**Resolution criteria:** Say “no OpenTelemetry or operational distributed-span instrumentation,” and document the composite correlation path rather than claiming the outbox ID flows directly end to end.

## 4. Suggestions

- Pin Effect’s core major version, `@effect/workflow` version, and preferably an upstream commit. The current date and alpha warning are honest, but mutable documentation makes later verification difficult.

- Add a compact claim ledger mapping each Effect claim to an exact source, stability status, Snapback evidence, confidence, and inferred recommendation. That would preserve LLP 0001’s observation/inference discipline more reliably than paragraph-level global tagging.

- Distinguish three retry concepts in F4: retrying the same logical operation, cron `NextTick` advancing to a new nominal invocation, and redelivery after receiptless ambiguity.

- Consider a non-standard but promising workflow design: require every durable external step to declare a settlement capability—transactional, provider-idempotent, provider-queryable, compensatable, or inherently ambiguous. Contract could then reject unsafe automatic-retry policies before deployment.

- Before elevating the agent-ergonomics argument, run a small comparative authoring exercise: identical Snapback tasks using plain async surfaces and an Effect-style prototype, measuring generated-code correctness, repair cycles, and diagnostic quality.

## 5. Open questions

- Which concrete application needs multi-step orchestration rather than a job plus domain intent/outbox table?
- What exactly constitutes stable step identity across edits, branches, loops, retries, and deployed-version changes?
- Should receipt authenticity remain a transport trust assumption, or should receipts eventually be schema-validated and cryptographically bound?
- Can operation-specific diagnostic unions coexist with app-authored codes and opaque JavaScript handlers?
- Is Effect rejected only from the public authoring model, or also from isolated internal tooling—and what evidence should govern that distinction?
- Which authority owns workflow retention, migration, compensation, and in-flight upgrade policy?
- Does retry timing attach to a logical operation, an individual attempt, or a nominal cron slot, and how are independent ordering domains declared?

## 6. Readiness verdict

NOT READY

### Orchestrator verification (round 2)

Spot-checked the decisive claims without altering the verbatim body. Confirmed: `src/live_wire.rs:278–315` (Receipt::Mutation) contains no signature or MAC field — the "origin-signed" phrasing in the reviewed revision (wording the round-1 GPT review itself introduced and the revision adopted) is wrong and security-significant; `packages/snapback-codegen/define.mjs:712–722` shows app-authored typed error codes (`opts.elseError`, `guard(..., elseError)`), confirming diagnostic codes are open and multi-owner; `guide/getting-started/your-first-backend.md` confirms application schemas are source-authored `.mjs` (JavaScript, not TypeScript). The F1 claim about Effect's documented expected-error/defect split matches Effect's public docs. The concurrent Claude-family round returned READY on this same revision with only non-blocking concerns, two of which (HostCallTrace, correlation-identifier naming) independently overlap this review's minor F5 concern. Disposition: accept the three majors and four minors for a round-3 revision; fold the Claude-family round's non-blocking polish into the same revision.

## Round 3 — 2026-07-20

**Revision under review:** `llp/0066-effect-lessons.research.md`, sha256 `654f5831bc09a11996f144092ecf87490306768a33ff98d3a8e533736c749083` (pinned at repo HEAD `0c2ed65`)
**Runtime detail:** codex session id 019f8308-7f8e-7181-a11e-ccecb22a46d8, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

MATCH — `654f5831bc09a11996f144092ecf87490306768a33ff98d3a8e533736c749083`

## 1. Overall assessment

This is strong research and a good reference input for Snapback. It avoids false equivalence, grounds the workflow comparison in shipped Snapback machinery, sharply limits exactly-once claims, and treats Effect adoption as an evidence-revisable posture rather than a decision.

The Effect-side provenance is candid and its principal claims check out against official documentation. The document is not yet suitable as finalized research, however, because F4 conflates distinct retry/settlement control planes and understates the current receipt schema and trust boundaries. These are localized corrections, not objections to the overall thesis.

## 2. Strengths

- The provenance block honestly identifies the research date, alpha status, secondary-source use, and absence of Effect source verification (`llp/0066-effect-lessons.research.md:58-79`). This is broadly consistent with the research discipline in `llp/0001-prior-art.research.md:25-49`, despite using coarser tags.

- F1 correctly distinguishes Effect’s typed expected-error channel from Snapback’s open, multi-owner diagnostic codes (`llp/0066-effect-lessons.research.md:83-118`). Snapback’s shape is supported by `guide/operating/diagnostics.md:18-42`, `src/diagnostic.rs:9-29`, and the verbatim propagation of app-authored codes in `src/storage.rs:2654-2690`.

- F2 accurately separates Rust-owned, generated shared-artifact schemas from app-owned `schema.mjs` declarations (`llp/0066-effect-lessons.research.md:120-132`; `llp/0037-schema-source-of-truth.decision.md:67-94,143-158`).

- F3 is the document’s strongest section. Its account of leased cron execution, commit-coupled result persistence, replay, and repeated external egress is supported by LLP 0028 and the implementation (`llp/0066-effect-lessons.research.md:134-193`; `cloudflare/src/coordinator.js:310-369,1651-1708,2673-2726`). Its refusal to promise transactionally exactly-once external effects is essential and correct.

- The detailed Effect claims are substantively accurate: the expected-error model, workflow replay, Schedule composition, and OpenTelemetry support agree with the official [error documentation](https://effect.website/docs/error-management/expected-errors/), [workflow README](https://github.com/Effect-TS/effect/blob/main/packages/workflow/README.md), [Schedule documentation](https://effect.website/docs/scheduling/introduction/), and [tracing documentation](https://effect.website/docs/observability/tracing/).

- F6’s narrowly scoped non-adoption posture and proposed comparative authoring experiment are appropriately falsifiable (`llp/0066-effect-lessons.research.md:248-271`).

## 3. Concerns

### 1. Retry policy conflates execution, delivery, and settlement

**Severity: major.**

**Evidence:** F4 presents three concepts as the corrected inventory and proposes a uniform failure-class-to-eligibility/schedule/terminal-settlement table that includes outbox redelivery and `ambiguousExternalEffect` (`llp/0066-effect-lessons.research.md:195-233`). Snapback also has connection and subscription retry policies, including bounded exponential reconnect (`llp/0008-local-first-sync-and-realtime.rfc.md:588-592`) and render-first attachment retry (`packages/snapback-contract/render-first.mjs:269-284,353-390`).

More importantly, receipt-less mutation delivery must remain ambiguous and queued, retaining the same `clientMutationId` across redelivery (`llp/0043-offline-replay-retention.rfc.md:189-206`). Exhausting attempts or a deadline may pause automation or escalate to an operator, but cannot turn missing settlement evidence into terminal success or failure.

**Resolution criteria:** Explicitly scope F4 to durable operation attempts or inventory the lifecycle retry mechanisms too. Separate failure eligibility, retry schedule, delivery evidence, and terminal settlement. State as an invariant that attempt/deadline exhaustion cannot terminally settle receipt-less or externally ambiguous outcomes, and describe how operation-level delay composes with connection-level backoff and FIFO ordering.

### 2. Receipt trust and schema state are described imprecisely

**Severity: major.**

**Evidence:** The receipt is described as arriving over “authenticated transport,” while the governing design establishes provider-core response evidence and auth-bound acknowledgement/GC, not universally authenticated transport (`llp/0066-effect-lessons.research.md:206-211`; `llp/0043-offline-replay-retention.rfc.md:189-206`). The local target explicitly lacks a public TLS edge and trusted effective-source derivation (`llp/0000-snapback.explainer.md:373-376`).

The open question asks whether receipts should “eventually become schema-validated” (`llp/0066-effect-lessons.research.md:331-333`), but receipts are already Rust-typed, exported as a committed JSON Schema, and covered by schema validation tests (`src/live_wire.rs:271-316`; `src/schema_export.rs:144-160`; `tests/artifact_schemas_v0.rs:1758-1782`). Runtime consumer validation and cryptographic authenticity are separate questions.

**Resolution criteria:** Describe the current receipt as provider-core response evidence within the active authority/trusted-origin context, without implying transferable authenticity. Acknowledge the existing generated schema, then ask separately whether consumers need runtime schema validation and whether receipts need cryptographic binding for transport across less-trusted intermediaries.

### 3. Conflict retry metadata is overgeneralized

**Severity: minor.**

**Evidence:** F4 says `SNAPBACK_MUTATION_CONFLICT` carries `details.retryPolicy: "reject"` (`llp/0066-effect-lessons.research.md:214-217`). That field exists for captured-read conflicts (`src/storage.rs:6958-6968`) but not for explicit `readSet` conflicts using the same diagnostic code (`src/storage.rs:6794-6811`), including the path documented in `guide/backend/mutations.md:84-103`.

**Resolution criteria:** Scope the field claim to captured-read conflicts and distinguish it from the guide-level policy for explicit read sets, or make every production conflict path emit the field and cover that invariant with tests.

### 4. The observability join is only partial

**Severity: minor.**

**Evidence:** F5 describes a chain from mutation identity through receipt version to live envelope (`llp/0066-effect-lessons.research.md:242-245`). Receipts carry mutation identity and snapshot version, but live envelopes carry version without mutation identity (`src/live_wire.rs:42-60,292-315`). Rejections can report the current durable cursor, while rejected or no-op mutations need not produce corresponding fan-out (`src/local.rs:5213-5247`).

**Resolution criteria:** Scope this to confirmed, version-advancing mutations within one application version stream and call it a version-based contextual join, not direct causal propagation.

### 5. “Prioritized” conflicts with the stated evidence

**Severity: minor.**

**Evidence:** The summary calls multi-step workflows a prioritized opportunity (`llp/0066-effect-lessons.research.md:22-33`), while the confidence section assigns low priority confidence, identifies no concrete multi-step use case, and says existing candidates remain job-shaped (`llp/0066-effect-lessons.research.md:281-287`).

**Resolution criteria:** Define “prioritized” as priority for LLP 0070 review only, or relabel workflows as a research lead gated on a concrete non-job use case.

### 6. Effect matching terminology is slightly too strong

**Severity: minor.**

**Evidence:** “Tag-aware, exhaustively-checked matching helpers” can imply that tagged recovery itself requires exhaustive handling (`llp/0066-effect-lessons.research.md:85-90`). Effect permits partial tagged handling and narrows the remaining error union; handling every variant is what reduces that union to `never`.

**Resolution criteria:** Name the particular exhaustive matcher intended, or say that tag-aware helpers narrow the remaining union and permit exhaustive handling.

## 4. Suggestions

- Pin the workflow evidence to exact official URLs and preferably a release tag or commit. The current claims are correct, but the package is alpha and the bare npm citation will age poorly.

- Mark the opening F6 “viral like async” analysis explicitly as `[inferred]`, as well as F1’s ergonomic judgment, to follow the tagging rule declared at `llp/0066-effect-lessons.research.md:75-79`.

- Expand F1’s federated catalog ownership beyond “framework-owned codes registered in Rust”: codegen, client, and Contract JavaScript packages also originate framework diagnostics.

- Mention Snapback’s closed declarative-plan tier alongside schema objects and async handlers in F6. It strengthens the argument for a plain, data-first authoring surface.

- For future workflow design, pair each stable semantic step ID with a compatibility fingerprint and explicit migration map. The verifier could reject accidental ID reuse, deletion of live steps, or incompatible result-shape changes.

- Consider representing retry policy as orthogonal artifacts—evidence state, eligibility, schedule, ordering domain, and escalation—rather than one table whose rows risk conflating failure with uncertainty.

## 5. Open questions

- What concrete use case requires durable multi-step control flow rather than one-action jobs plus domain intent tables?

- Which subsystem owns retry taxonomy, and how do connection retry, operation redelivery, job attempts, and cron slots compose without multiplying attempts unexpectedly?

- What must happen after automated retries stop while settlement remains ambiguous, and how is that state exposed to operators and Contract?

- Where should receipt schema validation execute, and against what authority or cryptographic trust root must a receipt be verified?

- How are workflow step identities migrated across edits, branching changes, deployed versions, export/import, and retention GC?

- Is the current version-based observability join sufficient, or should mutation/correlation identity propagate directly into live envelopes and future span context?

## 6. Readiness verdict

NOT READY

### Orchestrator verification (round 3)

Spot-checked the decisive claims without altering the verbatim body. Confirmed: the `retryPolicy` detail appears in the captured-read conflict construction (`src/storage.rs:6958-6968`) and not in the explicit `readSet` conflict path (`src/storage.rs:6794-6811`) — minor 3 is accurate. The receipt-schema point (Rust-typed, exported schema, tests) and the local-target no-TLS-edge point match the cited files, so major 2's "authenticated transport" correction stands. Major 1's invariant — exhausted attempts/deadlines cannot terminally settle receipt-less or externally ambiguous outcomes — is consistent with LLP 0043's ambiguity rules that this document itself cites. The concurrent Claude-family round returned READY on this same revision with one minor pointer concern (LLP 0034 §3.2 → §3), which overlaps nothing here. Disposition: accept both majors and the four minors for a round-4 revision; fold in the Claude-family pointer fix and polish.

## Round 4 — 2026-07-20

**Revision under review:** `llp/0066-effect-lessons.research.md`, sha256 `d80d4b13fd5a91d73fd75ccf7f3bd34dba3a02772bd4525d8fd46c7a1d6ff376` (pinned at repo HEAD `4a1024a`)
**Runtime detail:** codex session id 019f8319-5c94-74e2-a88d-b70db10a946d, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** READY

### Review body (verbatim)

**MATCH — SHA-256 `d80d4b13fd5a91d73fd75ccf7f3bd34dba3a02772bd4525d8fd46c7a1d6ff376`**

## 1. Overall assessment

This is strong, decision-useful research. Its central idea is sound: learn from Effect’s error, workflow, retry, and observability machinery without importing Effect’s entire programming model. The recommendations are appropriately framed as inputs to future design work, not as authorization to build a workflow engine prematurely.

The repository-facing claims are substantially correct. In particular, the document accurately distinguishes Snapback’s cron ledger from general orchestration, preserves the receipt-less ambiguity invariant, respects LLP 0037’s ownership model, and acknowledges that no workflow abstraction makes arbitrary external effects transactionally exactly-once.

The provenance scheme is coarser than LLP 0001’s convention but is candid about that choice, source quality, source-verification limits, and inference. Primary-source spot checks support the major Effect claims. I found no material correctness, coherence, feasibility, safety, or decision-quality problem. The concerns below are localized and non-blocking.

## 2. Strengths

- **Honest epistemic framing (§ “How to read this,” lines 61–82; § “Confidence,” lines 300–314).** The document separates documentation-derived observations, secondary-source impressions, and `[inferred]` recommendations. It explicitly lowers confidence on prioritization because no concrete multi-step use case has been identified. That is exactly the right posture for a Draft Research LLP.

- **Accurate error-model comparison (F1, lines 86–124).** Effect’s expected-error channel, defects outside that channel, partial handling, and executable non-`never` error channels match the official [Effect type](https://effect.website/docs/getting-started/the-effect-type/) and [error taxonomy](https://effect.website/docs/error-management/two-error-types/). On the Snapback side, `guide/operating/diagnostics.md:16-62`, generated API types, and `src/diagnostic.rs` support the conclusion that Snapback has structured but open, multi-owner diagnostics rather than closed per-operation error unions.

- **Correctly scoped schema analogy (F2, lines 126–138).** The document does not confuse Effect Schema with Snapback’s whole application data model. Its narrower correspondence—Rust authority for Snapback-owned shared artifacts, generated schemas, and CI drift detection—is supported by `llp/0037-schema-source-of-truth.decision.md:67-121` and `src/schema_export.rs`.

- **Good workflow gap analysis (F3, lines 140–200).** The account of cron’s leased claims, attempt counters, per-sequence transactional result persistence, and at-least-once recovery is supported by `llp/0028-cron-scheduled-execution.rfc.md:267-329`. More importantly, lines 176–193 correctly distinguish database atomicity from external-provider settlement and align with LLP 0043’s ambiguity rules and LLP 0047’s non-transactional action boundary. This is the document’s most valuable design lesson.

- **Excellent retry decomposition (F4, lines 202–256).** Separating eligibility, schedule, delivery evidence, and terminal settlement prevents a common and dangerous conflation. The invariant at lines 243–246—that exhaustion may stop automation but cannot manufacture a terminal outcome from ambiguity—is correct and should survive into any future design. The repo details about cron `NextTick`, receipt-driven mutation settlement, FIFO blocking, and captured-read conflict rejection are supported by the implementation.

- **Well-bounded non-adoption posture (F6, lines 275–298).** The document recommends neither wholesale adoption nor a blanket ban. It limits the posture to the public authoring surface and serialized contracts, while proposing a measurable comparative experiment as the revisit trigger. That is a better plan than deciding from human learning-curve anecdotes.

## 3. Concerns

### 3.1 Minor (non-blocking): Effect activity execution is stated too absolutely

**Evidence:** `llp/0066-effect-lessons.research.md:159-167` says an activity “executes once unless” `Activity.retry`, and calls the correspondence the same “transactional result-ledger pattern.” The official README uses similar shorthand, but the [Activity implementation](https://github.com/Effect-TS/effect/blob/main/packages/workflow/src/Activity.ts) applies a default interruption retry policy even without explicit `Activity.retry`. Persistence memoizes a completed engine activity attempt; it does not make execution code physically once-only, nor does it establish the same atomic boundary as Snapback’s transactionally coupled mutation/result row. The document’s later caveat at lines 176–193 preserves the safe conclusion, so this does not undermine the recommendation.

**Resolution criteria:** Rewrite the passage to say that the Cluster-backed engine reuses the persisted result of a completed activity attempt; ordinary failure retries obtain new internal attempt identities through `Activity.retry`, while interruption or loss before result persistence may re-execute code. Replace “same transactional result-ledger pattern” with “the same persisted-replay or memoization shape,” reserving transactional atomicity for Snapback mutations whose app writes and ledger row share a transaction.

### 3.2 Minor (non-blocking): “Live envelopes carry version” overgeneralizes the wire model

**Evidence:** `llp/0066-effect-lessons.research.md:265-270` says live envelopes carry a version. In `src/live_wire.rs:42-89`, `LiveReplace` and `LiveDelta` carry top-level versions, but `AuthorizationInvalidation` and `ResyncRequired` do not uniformly do so. The contextual join remains valid for the mutation-driven state-update path described by the document.

**Resolution criteria:** Narrow the statement to “mutation-driven `live_replace` and `live_delta` envelopes carry a version without mutation identity,” or otherwise enumerate the relevant versioned variants.

### 3.3 Minor (non-blocking): External provenance is honest but not fully reproducible

**Evidence:** `llp/0066-effect-lessons.research.md:63-74` identifies the main domains and one X post, but the exact Effect documentation pages, DeepWiki pages, and secondary articles are not listed. This is internally consistent with the declared coarse scheme, but it is less recoverable than LLP 0001’s convention at `llp/0001-prior-art.research.md:25-49`, especially for an alpha package whose documentation can move.

**Resolution criteria:** Add exact page titles and stable URLs for load-bearing external claims, preferably including the official [`@effect/workflow` release](https://github.com/Effect-TS/effect/releases/tag/%40effect%2Fworkflow%400.19.0). Name each secondary article actually relied upon, or remove sources that do not support a specific statement.

## 4. Suggestions

- Add a compact identity-and-settlement table for future workflow review: workflow execution identity, internal step identity, internal attempt identity, external provider idempotency key, atomic boundary, replay behavior, and ambiguity disposition. These identities must not accidentally collapse into one key.

- Turn the F3 safety analysis into a fault-injection matrix: crash before provider call, after provider acceptance, before result persistence, and after result persistence. Require every proposed step class to state the observable outcome and permitted retry behavior at each cut point.

- Clarify that general Effect `Schedule` is the conceptual reference for F4; `Activity.retry` itself is not the full Schedule surface. This strengthens the document’s distinction between general retry-policy design and one alpha workflow implementation.

- At `llp/0066-effect-lessons.research.md:100-102`, consider replacing “app-authored typed failure codes” with “app-authored machine-readable failure codes.” `elseError` and `guard` currently accept arbitrary strings (`packages/snapback-codegen/define.d.ts:163-171`), even though the runtime faithfully emits them (`src/storage.rs:2654-2690`).

- Make the prioritization gate operational: require a concrete workload whose correctness or operability cannot be adequately expressed as one LLP 0070 job plus a domain intent table before accepting multi-step workflow work.

## 5. Open questions

- What concrete workload actually requires durable multi-step control flow rather than a job, cron ledger, or domain-specific intent/outbox table?

- Is the reference model the abstract, pluggable `@effect/workflow` API or specifically its Cluster-backed persistent engine?

- What stable identity and migration rules apply when deployed workflow code reorders steps, changes branches or loops, or removes a step while executions remain in flight?

- Should provider idempotency keys remain stable across internal attempts by default, and which explicit capability permits changing them?

- What state names and operator actions apply to work that started but has neither a persisted result nor trustworthy provider settlement evidence?

- Can retry ordering domains be introduced without weakening LLP 0043’s FIFO and ambiguity guarantees, or should delayed head items always block their queue?

## 6. Readiness verdict

READY

### Orchestrator verification (round 4)

Both reviewer families independently marked this same pinned revision (`d80d4b13…`) READY, and the orchestrator's factual checks across the four rounds surfaced no unresolved material defect — the loop converges here for LLP 0066. Non-blocking residue recorded across the two round-4 reviews: the Claude-family pointer fix (Exact LLP 0216 → 0194 for the async-arm grammar) and truncated F6 sentence; this review's activity-execution precision (3.1), envelope-variant narrowing (3.2), and reproducible-source listing (3.3); and both families' suggestions (identity-and-settlement table, fault-injection matrix, LLP 0070 `dead`-state reconciliation against the settlement invariant). Per the /llp-super-refine authorization, the document's status advances Draft → Review; the residue travels to the next ordinary revision rather than re-opening the loop.
