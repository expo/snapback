**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.6 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, approval never; non-interactive `codex exec` orchestrated by /llp-super-refine
**Date:** 2026-07-20
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner

# LLP 0067 reviews — GPT family

## Round 1 — 2026-07-20

**Revision under review:** `llp/0067-fate-lessons.research.md`, sha256 `93eb9e618cde0f342b308ba92bc7769e2c332afb383bff926543db7dea3bfd58` (untracked file at repo HEAD `a75ddd5`)
**Runtime detail:** codex session id 019f82e4-f0b4-7fb2-9cf1-35e80a6cddf8, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. The sandbox is network-restricted, so the review's Fate-side claims rest on the model's prior knowledge of Fate's public documentation, not live fetches; see the orchestrator adjudication note below. After the review snapshot was taken, a concurrent fleet edit added a `**Revised:**` header line to the working-tree file; the review below is of the pinned pre-edit revision.
**Verdict:** NOT READY

### Review body (verbatim)

**Revision check: MATCH** — `sha256 93eb9e618cde0f342b308ba92bc7769e2c332afb383bff926543db7dea3bfd58`

## 1. Overall assessment

The research direction is valuable: Contract’s declarative dependency model is a promising place to introduce field selection, and Snapback could use those selections for narrower invalidation, smaller payloads, and less client work.

The document is not yet a sound plan, however. It conflates five distinct mechanisms—request composition, logical subscription sharing, transport multiplexing, field-aware invalidation, and render notification—and several load-bearing claims about Fate and Snapback are inaccurate. The stated fan-out ceiling is historical, field selection does not by itself expand `live_delta` eligibility, and Fate already implements the server-side half that the document says it lacks.

The provenance disclosure is candid rather than deceptive (`0067:33-38`), but “High” confidence (`0067:123-128`) is not justified while the public Fate documentation contradicts multiple findings. The recommended prototype remains promising after those claims are corrected and its Exact/Snapback ownership boundaries are split.

## 2. Strengths

- The document clearly distinguishes observed source material from inferred recommendations and calls for a prototype rather than immediate adoption (§“Provenance and evidence status,” `0067:33-38`; §“Recommendations,” `0067:130-139`). That is appropriate for Draft Research.

- F3 identifies a real leverage point: Contract has explicit, verifier-backed dependency declarations, while its current data dependencies remain query- or table-grained (§F3, `0067:79-91`). Contract’s canonical IR and action-effect verification support this diagnosis (`../exact/llp/0216-contract-explained.explainer.md:95-101,239-242`).

- The document correctly recognizes Snapback’s named query as the current subscription unit and distinguishes incremental `live_delta` handling from replace fallback (§F2, `0067:60-67`; `llp/0008-local-first-sync-and-realtime.rfc.md:51-56,243-259`).

- F4 appropriately treats normalization as optional future work rather than a prerequisite for field-selected subscriptions (`0067:93-103,134-139`). That restraint keeps the immediate experiment smaller.

- F6 correctly resists copying Fate wholesale and identifies offline replay, authority, and reconnect semantics as areas where Snapback has different requirements (`0067:114-119`).

## 3. Concerns

### 1. Fate’s view and code-generation model is materially mischaracterized

**Severity: major**

**Evidence:** The summary and F1 say Fate has “no codegen compiler,” uses only plain TypeScript inference, and composes views “by reference, not inline selection” (`0067:12-16,44-58`). Fate’s documented views support both inline nested views and referenced reusable views. Its plugin writes generated project-local types under `.fate/`, and CLI code generation remains supported. See the official [Views guide](https://fate.technology/guide/views), [Fate 1.0 announcement](https://fate.technology/posts/fate-1.0), and [repository README](https://github.com/nkzw-tech/fate).

The statement that Fate composes “all descendant views into one network request” is also too strong. The documented `useRequest` API receives an explicitly constructed request graph; it does not automatically discover arbitrary descendant React views. Multiple operations rendered together may be transport-batched depending on the integration, which is different from one composed logical request. See the [Requests guide](https://fate.technology/guide/requests).

**Resolution criteria:** Rewrite F1 to say that Fate avoids GraphQL syntax and Relay-style fragment compilation, while still using generated client wiring/types. Document inline and referenced selection accurately, and distinguish explicit request composition from adapter-dependent batching. Pin the Fate version or commit used for each finding.

### 2. The central “client-side half only” analogy is incorrect

**Severity: major**

**Evidence:** F2 says Fate demonstrates only client-side composition and contrasts Snapback’s server with Fate “sitting on generic RPC” (`0067:69-76`). Fate’s Live Views retain selections server-side and intersect changed field paths with those selections before publishing updates. Fate also supplies native server machinery alongside tRPC and GraphQL integrations; it is not merely a client layered on generic RPC.

Conversely, each documented `useLiveView` remains a logical live subscription. Those subscriptions are multiplexed over one SSE connection, but Fate does not thereby demonstrate one screen-level logical subscription or fewer subscribers. The document partly contradicts itself when it later acknowledges that “both halves exist in Fate” (`0067:147`). See the official [Live Views guide](https://fate.technology/guide/live-views) and [README](https://github.com/nkzw-tech/fate).

**Resolution criteria:** Separate:

1. request composition;
2. logical subscription composition;
3. connection multiplexing;
4. field-aware server invalidation; and
5. payload/render suppression.

Credit Fate with field-aware server invalidation, and present screen-level logical subscription composition as a separate, unverified proposal.

### 3. The reported Snapback fan-out ceiling is not a current measurement

**Severity: major**

**Evidence:** F2 presents roughly 5–6 affected subscriptions per commit as Snapback’s current ceiling (`0067:62-67`). LLP 0035 records that as a dated 2026-07-02 warm-realm result. After auth enforcement, protected fallback queries run in fresh realms, and the current profile has not received an equivalent full-scale measurement (`llp/0035-local-target-benchmarks.research.md:52-74,141-172`). The cost is also per **affected** fallback subscription, not per total subscriber.

**Resolution criteria:** Label 5–6 as the historical warm-profile result, describe the current auth-scoped fallback state, and require the proposed prototype to remeasure the current protected-query profile. Report affected-subscription count separately from total subscriptions.

### 4. Field selection does not currently widen `live_delta` eligibility

**Severity: major**

**Evidence:** F2 claims that composing selected fields would widen Snapback’s effective `live_delta` subset (`0067:71-76`). Current eligibility is determined by query shape and execution plan, not projected result fields: `QueryPlan` contains filters, membership, ordering, limit, and index information but no projection (`src/manifest.rs:2143-2168`); non-`HostPlan` execution falls back (`src/local.rs:11055-11061,11250-11255`); ordering or a full result cap forces replacement (`src/live_matcher.rs:619-631`).

Field selection could reduce the fraction of commits that affect a subscription, payload size, and downstream render work. It does not make an ordered or Ibex-backed query incrementally analyzable. The accompanying statement that all limited queries fall back is also too broad: an unordered limited query below its cap can remain incremental.

**Resolution criteria:** Split the hypothesis into independent outcomes—affected-subscription rate, rerun count, bytes, and client update work. Remove the claim that projection widens `live_delta` eligibility unless a concrete new execution algorithm is proposed and benchmarked.

### 5. The Contract recommendation bundles distinct ownership and runtime layers

**Severity: major**

**Evidence:** Recommendation 1 treats `.contract` selection syntax, screen subscription composition, Snapback protocol behavior, and renderer performance as one Contract-side issue (`0067:132-137`). Exact owns the Contract language, compiler, dependency semantics, and `ContractDataManifest`; Snapback owns its provider mapping and wire artifacts (`llp/0037-schema-source-of-truth.decision.md:69-94`; `llp/0052-contract-update-economy-and-host-state.rfc.md:690-701`).

Moreover, masking fields does not automatically produce “minimal re-renders.” Current query updates publish a whole rows signal, and Contract already updates per binding rather than rerendering React-style components (`../exact/packages/exact-contract/src/runtime/instance.ts:1120-1128,1210-1238`; `../exact/llp/0216-contract-explained.explainer.md:155-176`). The relevant measures are dependent effect executions and host-update attempts, not simply “renderer rerenders.”

**Resolution criteria:** Split the work into:

1. Exact selection syntax/IR, helper-boundary behavior, masking, and verification;
2. Snapback projection, wire representation, and invalidation benchmarks; and
3. optional physical batching that preserves query arguments, authority partitions, lifecycle, status/error state, and dynamic mount/unmount behavior.

Specify the signal/subscription changes required for field-level update economy and benchmark the existing LLP 0052 churn metrics.

### 6. A normalized cache requires an explicit authorization-safety model

**Severity: major**

**Evidence:** F4 proposes a normalized cache as a later optional client arm without discussing authorization provenance (`0067:93-103`). Snapback permits the same row to be visible through one authorized subscription and absent through another (`llp/0008-local-first-sync-and-realtime.rfc.md:441-453`). Offline state is also keyed by principal, query identity, artifact version, authorization lease, and stream (`llp/0043-offline-replay-retention.rfc.md:55-128,245-260`).

Merging entity fragments across queries could expose fields learned under a broader authorization context through a narrower or expired one. Field masking is not an authorization boundary.

**Resolution criteria:** State that any normalization experiment must partition by stream/database and authority principal, retain per-field query/lease provenance and completeness, and define invalidation, deletion, lease expiry, and wipe behavior. Otherwise scope the experiment to online, single-authority use and explicitly forbid cross-query fragment reuse.

### 7. Several supporting repo-facing claims need correction

**Severity: minor**

**Evidence:**

- Fate and Snapback do not require globally unique IDs across all types. Fate keys records by type plus ID, while Snapback can use table plus `_id`; `0067:52,96-101` overstates the identity migration.
- Snapback’s WebSocket reconnect path performs a fresh subscription/snapshot rather than durable stream resumption (`0067:117`; `llp/0008-local-first-sync-and-realtime.rfc.md:575-598`). The durable mutation outbox is a separate property.
- LLP 0012 does not frame normalized caches as pluggable client arms (`0067:101-103`). It defines a framework-neutral external-store contract with a thin React projection (`llp/0012-headless-integration-contract.spec.md:827-850`). DK-9 permits physical store implementations that preserve one observable query-cache/outbox contract; it does not establish entity-normalized semantics as interchangeable (`llp/0008-local-first-sync-and-realtime.rfc.md:388-420`).
- Ephemeral state does have a schema-derived field set through collection value validators (`0067:149-150`; `llp/0013-ephemeral-realtime-state.rfc.md:74-125,463-468,798-818`).

**Resolution criteria:** Use type/table-scoped identity, describe Snapback reconnect and outbox durability separately, remove the LLP 0012 pluggability claim, and reframe the ephemeral question around deriving projections from collection value validators rather than an alleged absence of schema.

### 8. Provenance is candid but insufficiently precise for the stated confidence

**Severity: minor**

**Evidence:** The broad provenance paragraph honestly says Fate was checked against public documentation rather than source (`0067:33-38`), but individual findings have no direct sources or version pin, and several are contradicted by those public sources. F3 also relies on Contract behavior without citing its governing Exact documents. The metadata omits the required `Revised` field (`0067:1-8`).

**Resolution criteria:** Add direct source/version citations to each Fate finding, cite the authoritative Exact LLPs for Contract IR and data bindings, downgrade confidence where source verification remains absent, add LLPs 0013 and 0037 to `Related`, and add the standard `Revised` metadata field.

## 4. Suggestions

- Add a compact terminology table distinguishing logical request, transport operation, logical subscription, connection, invalidation decision, payload projection, and reactive notification.

- Let the Contract compiler derive field paths from property access where possible, with explicit descriptor metadata or conservative widening at opaque helper boundaries. This avoids making authors duplicate dependencies manually.

- Benchmark selection overlap and changed-field overlap as two independent dimensions. Record subscriptions per screen, affected-subscription fraction, server reruns, bytes, dependent effect executions, and host updates.

- Compare field selection with a server-side result memo or subscription DAG keyed by query, arguments, and authority. Reusing one fallback evaluation across identical watchers may attack the fan-out bottleneck more directly than composing component subscriptions.

- Treat any future normalized cache as an authority-scoped materialized-fragment graph, not a globally shared entity map.

## 5. Open questions

- Is the primary objective fewer logical subscriptions, fewer server evaluations, smaller payloads, or fewer dependent client effects? Which one defines success?

- Can Contract reliably infer nested field paths through computed access and imported helpers, or must descriptors declare conservative selection sets?

- Which fields must remain subscribed for filters, ordering, authorization, identity, and reconciliation even when the renderer does not read them?

- How would composed subscriptions preserve dynamic arguments, pagination, authority partitions, per-query status/errors, and independent mount lifecycles?

- What is the current protected-query fallback ceiling under the post-auth execution profile?

- Would shared result evaluation for identical authorized queries outperform field-selected screen composition with less protocol complexity?

- If entity fragments are normalized, what exact authority and lease provenance accompanies each field, and how are revocation and deletion represented?

- Can ephemeral collection validators supply the same projection machinery as durable table schemas, or do their merge/TTL semantics require a distinct protocol?

## 6. Readiness verdict

NOT READY

### Orchestrator verification (round 1)

Spot-checked the decisive claims without altering the verbatim body. The Codex sandbox is network-restricted, so its Fate citations were adjudicated against the live documentation by the orchestrator on 2026-07-20:

- **Concern 2 (server-side selection intersection): CONFIRMED.** fate.technology/guide/live-views states the client sends subscribe/unsubscribe control messages, "the server keeps those selections on the connection and sends updates only for records that connection subscribed to," and a `changed` field list reduces per-subscriber data. Fate does implement a server-side half; LLP 0067's "client-side half only / generic RPC" framing in F2 is materially wrong, and each `useLiveView` is indeed a logical subscription multiplexed over one SSE connection.
- **Concern 1 (inline selections): CONFIRMED** — the views guide shows inline nested selection (`author: { id: true, name: true }`) with referenced views as the preferred composition, so "by reference, not inline selection" overstates. **Concern 1 (codegen under `.fate/`, CLI generation): NOT CONFIRMED** — the live views guide shows no code generation and only a Vite plugin (`@nkzw/fate/src/vite`); this sub-claim is treated as unverified and the revision will not assert it, only soften the "no codegen" absolute to "no query language or fragment compiler; a Vite plugin integrates transport."
- **Concern 3 (historical ceiling): CONFIRMED** — LLP 0035's "Current measurement contract (2026-07-13, protected-query enforcement)" says the dated tables reflect the 2026-07-01/02 runtime and auth-scoped LiveQueries now take the protected fresh-realm profile; the Claude-family round independently flagged the same nuance.
- **Concern 4: CONFIRMED** — `src/manifest.rs` QueryPlan (lines 2143–2168) contains no projection field, and `src/live_matcher.rs:619–631` confirms both the ordered/at-cap Replace rule and that an unordered under-cap limited query stays incremental (the review's "too broad" point).
- **Concerns 6/7:** LLP citations verified as characterized (LLP 0008:441–453 same-row-different-visibility; LLP 0012's external-store contract; LLP 0013 collection value validators — the ephemeral premise was independently flagged by the Claude-family round).

Disposition: round-2 revision will rewrite F1/F2 around the five-mechanism separation, credit Fate's field-aware server invalidation, re-scope the fan-out numbers as historical warm-profile results with the auth-era caveat, replace the projection-widens-delta claim with independent outcome hypotheses, split Recommendation 1 by ownership (Exact vs Snapback), add the normalization authorization-safety constraints, and fix the minor citation corrections. The codegen sub-claim of concern 1 is dispositioned as unverified (no change asserting Fate codegen; version pin added instead).

## Round 2 — 2026-07-20

**Revision under review:** `llp/0067-fate-lessons.research.md`, sha256 `b149078bfbada2dc181185851b056e1713eebf78f797f2253e7abd8a85854d03` (pinned at repo HEAD `0e05b7b`)
**Runtime detail:** codex session id 019f82f4-bb3d-7d70-a272-6b9781450219, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

MATCH — sha256 `b149078bfbada2dc181185851b056e1713eebf78f797f2253e7abd8a85854d03`

## 1. Overall assessment

This is a strong, useful research document with a sound central direction: investigate field selection and masking, measure each claimed benefit independently, and keep normalized caching parked until evidence justifies its authorization complexity.

The Fate characterization is substantially honest and supported by its public documentation. The Contract ownership and dependency model is also represented accurately. However, the document is not yet decision-quality because it materially overstates Snapback’s current `live_delta` boundary, omits a load-bearing selection-identity design fork, and conflates two distinct client-store layers. Those issues affect safety and the validity of the proposed benchmarks, not merely presentation.

## 2. Strengths

- F1 successfully separates selection declaration, request composition, transport multiplexing, field-aware invalidation, masking, and normalization instead of treating them as one feature ([0067 §F1](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:51)). The distinctions agree with Fate’s [Views](https://fate.technology/guide/views), [Live Views](https://fate.technology/guide/live-views), and [Requests](https://fate.technology/guide/requests) guides.

- F2 correctly turns “field selection improves performance” into three independent hypotheses—affected-subscription rate, payload size, and client work—and requires separate measurements ([0067 §F2](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:97)). Comparing selection with shared server evaluation is an especially good control.

- F3 correctly identifies Contract’s explicit query/binding and action-write model, canonical IR, verifier, and fine-grained runtime. It also correctly rejects React-style rerender counts in favor of derive, effect, and host-update churn ([0067 §F3](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:125); [Exact LLP 0216](/Users/ccheever/projects/exact/llp/0216-contract-explained.explainer.md:155); [LLP 0052](/Users/ccheever/projects/snapback/llp/0052-contract-update-economy-and-host-state.rfc.md:614)).

- The Exact/Snapback ownership split is correct: Exact owns Contract language, IR, verifier, and `ContractDataManifest`; Snapback owns its native artifacts, validated projection, provider mapping, and wire/runtime use ([0067:144](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:144); [LLP 0037:89](/Users/ccheever/projects/snapback/llp/0037-schema-source-of-truth.decision.md:89)).

- F4 recognizes that masking is not authorization, proposes strong provenance fences, and parks normalization rather than allowing prior-art enthusiasm to force an architecture ([0067 §F4](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:150)). F6 similarly avoids copying Fate’s transport merely because its declaration model is useful.

- The provenance section plainly states that Fate was checked against public documentation rather than source and assigns appropriately limited confidence ([0067:40](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:40)).

## 3. Concerns

- **Major — F2 materially overstates the current `live_delta` eligibility boundary.**
  **Evidence:** F2 says everything outside the analyzable subset takes `live_replace`, explicitly mentions membership in `QueryPlan`, and assigns high confidence to current fallback behavior ([0067:83](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:83), [0067:107](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:107), [0067:200](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:200)). The governing design instead says membership-gated queries must use conservative re-query/`live_replace`, not incremental membership deltas ([LLP 0056:1014](/Users/ccheever/projects/snapback/llp/0056-scoped-roles-and-memberships.rfc.md:1014); [LLP 0008:702](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:702)). Current code appears not to enforce that boundary: every HostPlan query becomes a delta candidate ([local.rs:11055](/Users/ccheever/projects/snapback/src/local.rs:11055)); row classification checks ordinary filters but not `membership_filters` ([live_matcher.rs:286](/Users/ccheever/projects/snapback/src/live_matcher.rs:286)); delta computation rejects ordering/full-cap cases but not membership predicates ([live_matcher.rs:613](/Users/ccheever/projects/snapback/src/live_matcher.rs:613)); and an affected change producing no ordinary-table ops is treated as `NoChange` ([local.rs:11289](/Users/ccheever/projects/snapback/src/local.rs:11289)). The shape is reachable in the specified revision through Shindig’s membership-gated `eventDetails` query ([functions.manifest.json:45](/Users/ccheever/projects/snapback/demos/shindig/snapback/generated/functions.manifest.json:45)). This is potentially authorization-relevant.
  **Resolution criteria:** Either identify and regression-test a guard proving nonempty `membership_filters` cannot reach `live_delta`, or document the observed design/implementation discrepancy, correct F2 and its confidence statement, and make membership/auth predicates an explicit safety dependency of field-aware invalidation. This Research LLP need not repair the runtime itself.

- **Major — the proposed selection flow omits the logical-query identity/deduplication fork.**
  **Evidence:** The document proposes per-view selections flowing through the wire but does not decide how two bindings with the same query and arguments but different selections coexist ([0067:28](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:28), [0067:116](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:116)). Exact’s current logical key contains provider/authority partition, descriptor, compatibility token, and canonical arguments—no selection ([query-identity.ts:144](/Users/ccheever/projects/exact/packages/exact-contract/src/runtime/query-identity.ts:144))—and same-key bindings share one provider subscription ([query-dedup.ts:237](/Users/ccheever/projects/exact/packages/exact-contract/src/runtime/query-dedup.ts:237)). Snapback’s external store similarly keys provider/query/authority/args ([external-store.mjs:93](/Users/ccheever/projects/snapback/packages/snapback-client/external-store.mjs:93)). Selection must therefore either enter the key, fragmenting subscriptions, or be maintained as a changing union with per-binding masks. Fate itself makes the selected view part of request identity, as its [Requests guide](https://fate.technology/guide/requests) explains.
  **Resolution criteria:** Add this design fork to F2 and the open questions. Require the prototype to compare canonical-selection keys against unioned subscriptions, including selection churn, upgrade/downgrade semantics, subscriber count, payload savings, and masking correctness.

- **Major — F4 conflates the online external store with the durable DK-9 client store.**
  **Evidence:** F4 describes one “store-agnostic client contract” by joining DK-9 with LLP 0012’s external store ([0067:152](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:152)). They are distinct layers. `@snapback/client/external-store` is an Online-only, ephemeral per-logical-query lifecycle and optimistic store ([LLP 0012:836](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:836)). DK-9’s durable `SnapbackClientStore` owns retained results, stream/version cursors, authorization state, leases, and the mutation outbox ([LLP 0008:388](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:388); [client-store.mjs:1](/Users/ccheever/projects/snapback/packages/snapback-contract/client-store.mjs:1)). Its fences include app, database, target profile, version stream, schema hash, inputs hash, and authority—not merely principal and query ([client-store.mjs:32](/Users/ccheever/projects/snapback/packages/snapback-contract/client-store.mjs:32); [index.mjs:979](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:979)). Without naming the target layer, the normalization recommendation is not scoped enough to assess.
  **Resolution criteria:** Describe both layers and state which one normalization would augment. A durable experiment must preserve the complete store fence and per-field query/lease provenance. An online experiment must explain how it delivers cross-query convergence if cross-query fragment reuse remains forbidden.

- **Minor — the fan-out figures read more like observed capacity than derived, workload-specific server-compute ceilings.**
  **Evidence:** Both ~5–6 and ~28–31k are derived from a 10 ms budget ([LLP 0035:158](/Users/ccheever/projects/snapback/llp/0035-local-target-benchmarks.research.md:158), [LLP 0035:199](/Users/ccheever/projects/snapback/llp/0035-local-target-benchmarks.research.md:199)). The delta benchmark runs classification and serialization for a one-row commit; it does not measure authority preparation, enqueue, network, or client application ([bench.rs:503](/Users/ccheever/projects/snapback/src/bench.rs:503)).
  **Resolution criteria:** Call both dated, fixture-specific, derived server-compute ceilings and explicitly distinguish them from measured end-to-end subscriber capacity.

- **Minor — the npm package/version provenance appears conflated.**
  **Evidence:** Lines 13–14 and 42–45 identify `@nkzw/fate` as 1.3.2. Fate’s current first-party materials distinguish the React package `react-fate` from core `@nkzw/fate`; their package manifests are on separate 1.3.x and 1.0.x lines ([Getting Started](https://fate.technology/guide/getting-started), [`@nkzw/fate` manifest](https://raw.githubusercontent.com/nkzw-tech/fate/main/packages/fate/package.json), [`react-fate` manifest](https://raw.githubusercontent.com/nkzw-tech/fate/main/packages/react-fate/package.json)). The 1.3.2 value appears associated with the docs/React release, not demonstrably with `@nkzw/fate`.
  **Resolution criteria:** Name the actual package whose metadata was read—likely `react-fate@1.3.2`—or cite a stable version-specific npm record proving `@nkzw/fate@1.3.2`; then recheck the publication date.

- **Minor — “a hazard Fate does not face” and “external validation” exceed the evidence and tagging discipline.**
  **Evidence:** Fate’s normalized cache shares records across requests, and its Requests guide explicitly warns against reusing request-scoped snapshots across users, so authority partitioning is not demonstrably absent from Fate ([0067:160](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:160); [Fate Requests](https://fate.technology/guide/requests)). F5’s “mild external validation” is analysis, not validation evidence ([0067:175](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:175)). LLP 0001’s convention classifies influence claims as `[inferred]` ([LLP 0001:25](/Users/ccheever/projects/snapback/llp/0001-prior-art.research.md:25)).
  **Resolution criteria:** Say Fate’s public materials do not address Snapback’s required authorization granularity, rename F5 as independent convergence rather than validation, and explicitly tag all Fate-to-Snapback influence claims as inferred.

- **Minor — F3 bundles masking with performance effects and overstates the L4 analogy.**
  **Evidence:** Masking makes field declarations enforceable, but it does not by itself reduce Contract effect execution. Current query delivery publishes a fresh row array on every delivery ([instance.ts:1210](/Users/ccheever/projects/exact/packages/exact-contract/src/runtime/instance.ts:1210)); terminal bindings then react independently ([view.ts:4396](/Users/ccheever/projects/exact/packages/exact-contract/src/runtime/view.ts:4396)). Suppressing work additionally requires server invalidation filtering, stable selected-value equality, or another publication filter. Likewise, L4 has a complete fresh-query oracle, whereas runtime field-access tracing cannot prove unused declarations across unexecuted branches and helpers.
  **Resolution criteria:** Separate masking correctness, payload/invalidation savings, and client publication suppression. Treat `accessed ⊆ declared` as enforceable, but label `declared − accessed` overfetch reporting coverage-dependent advisory telemetry unless conservative static analysis supplies a complete proof.

## 4. Suggestions

- Prototype selection first as a shadow decision: compute whether each update would have been suppressed, still execute the authoritative full query, and compare outcomes. This adapts L4’s real-oracle advantage without putting authorization correctness behind an experimental skip.

- Represent four field sets separately: payload fields, membership/filter/order dependencies, authorization dependencies, and identity/reconciliation metadata. Only payload fields should be masked; invalidation must consider the other three sets even when they are not delivered.

- Before normalization, test mutation-plan-driven overlay fan-out across active same-authority query stores whose declared read sets can observe the mutation. That could provide cross-query optimistic convergence without introducing shared entity fragments or a new durable authorization surface.

- Pin external research to package-specific version URLs or repository revisions. A site-wide docs version is not necessarily the version of every package in a monorepo.

## 5. Open questions

- What exact guard or test establishes the intended `membership_filters` → `live_replace` boundary today, and what happens for membership-table writes versus main-table updates?

- Is selection part of logical query identity, or does each shared query maintain a union? If unioned, how are selection upgrades, downgrades, reconnects, and concurrent mount/unmount handled?

- Which client layer would own normalization: the Online external store, the durable retained/outbox store, or a separate projection over both?

- What is the canonical split between Exact-owned selection declarations and Snapback-owned wire/query-plan artifacts, and which compatibility token changes when that mapping changes?

- Which realistic workloads have enough unselected-column churn to improve affected-subscription rate, as opposed to merely reducing bytes?

- Can Contract conservatively infer nested field access through imported helpers and computed paths, or must helpers export explicit field summaries?

## 6. Readiness verdict

NOT READY

### Orchestrator verification (round 2)

Spot-checked the decisive claims without altering the verbatim body. The headline major is **confirmed as a real design/implementation discrepancy** by direct code inspection: `row_matches_query_filters` (`src/live_matcher.rs:286`) iterates only `plan.filters` and never `plan.membership_filters`; the delta-candidate selection (`src/local.rs:11055-11060`) admits any `HostPlan::Query` with nonempty changes; and `try_live_delta_fanout`'s only authorization guard (`src/local.rs:11300-11306`, per LLP 0053) falls back solely when an **auth-scoped subscription has a Remove op** — Add/Update ops on a membership-gated query proceed down the delta path without the membership semi-join being evaluated, contrary to LLP 0056's "conservative re-query/`live_replace` lane" requirement (LLP 0056:1014-1020). This is authorization-relevant runtime behavior beyond this document's scope to fix; it is being surfaced to the user in the orchestrator's report for filing per the repo's issue conventions. Concerns 2 and 3 (selection-identity fork; external-store vs DK-9 store-layer conflation) verify against the cited Exact runtime files and LLP 0012/0008 as characterized. The npm-provenance minor is plausible (the round-2 Claude review reported `@nkzw/fate` 1.3.2 from npm; the discrepancy between package lines will be resolved by naming the package actually read and dropping the specific version claim if unverifiable). Disposition: round-3 revision will document the membership/delta discrepancy explicitly (correcting F2 and its confidence), add the selection-identity design fork, split the two client-store layers in F4, downgrade the F5/F4 Fate-comparative claims, re-scope the ceiling figures as derived server-compute numbers, and adopt the four-field-set and shadow-decision suggestions.

## Round 3 — 2026-07-20

**Revision under review:** `llp/0067-fate-lessons.research.md`, sha256 `010b81d967248dec1c5a1b9b4f7356eb71dcffd7c5f6c939a5d185c9f903999f` (pinned at repo HEAD `0c2ed65`)
**Runtime detail:** codex session id 019f8308-8774-7e92-9bee-1c682a66de5c, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. The sandbox is network-restricted; the Fate 1.0-announcement claim was adjudicated by the orchestrator against the live site (see verification note).
**Verdict:** NOT READY

### Review body (verbatim)

MATCH — sha256 `010b81d967248dec1c5a1b9b4f7356eb71dcffd7c5f6c939a5d185c9f903999f`

## 1. Overall assessment

This is strong, useful research. It extracts relevant lessons without proposing wholesale Fate adoption, correctly separates logical subscriptions from transport multiplexing, and surfaces a real authorization-relevant `membership_filters`/`live_delta` discrepancy. The benchmark-first plan and separation of Snapback and Exact ownership are sound.

The document is not ready because its central invalidation hypothesis conflates fields delivered to a component with fields read by server-side query computation. That distinction is essential for opaque Ibex queries and must become an explicit soundness gate. Several smaller factual and provenance corrections are also needed.

## 2. Strengths

- §F1 accurately decomposes Fate into selection, request composition, logical subscriptions, field-aware invalidation, masking, and normalized caching (`llp/0067-fate-lessons.research.md:59-88`). Those descriptions agree with Fate’s [README](https://github.com/nkzw-tech/fate#readme), [views guide](https://fate.technology/guide/views), and [live-views guide](https://fate.technology/guide/live-views).

- §F2 correctly characterizes Snapback’s named-query subscription granularity and the current `live_delta` subset (`llp/0067-fate-lessons.research.md:90-136`). `QueryPlan` has filters, membership filters, ordering, and limit but no projection, while opaque Ibex and ordered/capped cases retain conservative replacement behavior (`src/manifest.rs:2143-2168`; `src/live_matcher.rs:619-631`; `llp/0008-local-first-sync-and-realtime.rfc.md:166-179`).

- §F2a is the document’s strongest contribution. The discrepancy is real: delta candidacy admits the relevant HostPlan shape, row classification ignores `membership_filters`, and only an emitted authorization-scoped Remove forces fallback (`src/local.rs:11055-11060,11299-11306`; `src/live_matcher.rs:286-297,664-701`). The Shindig query makes the unsafe empty-to-Add path reachable (`demos/shindig/snapback/functions.mjs:45-55`). This directly conflicts with the conservative lane required by `llp/0056-scoped-roles-and-memberships.rfc.md:1014-1021`.

- §F2b identifies the correct identity fork. Exact’s current logical key is partition, descriptor, compatibility token, and canonical arguments, with same-key bindings sharing an upstream subscription; selection is absent (`../exact/packages/exact-contract/src/runtime/query-identity.ts:144-153`; `../exact/packages/exact-contract/src/runtime/query-dedup.ts:237-295`).

- §F3’s distinction between masking correctness, advisory overfetch reporting, and update-suppression economics is excellent (`llp/0067-fate-lessons.research.md:174-207`). It prevents a common mistake: assuming access masking alone reduces signal publication or effect execution.

- §F4 correctly distinguishes the online external store from the durable DK-9 result/outbox store and treats authorization provenance as the gating issue for normalization (`llp/0067-fate-lessons.research.md:209-244`). Parking normalization until a concrete overlay problem appears is appropriately conservative.

## 3. Concerns

### Major — Delivery selection is not proof of server execution dependencies

**Evidence:** The document says a change to an unselected column “need not invalidate” a matching subscription and suggests existing `changed_fields` may support that decision (`llp/0067-fate-lessons.research.md:110-115`). Its field taxonomy includes payload, filter/order, authorization/membership, and identity metadata, but omits server computation or output-lineage dependencies (`llp/0067-fate-lessons.research.md:200-204,319-322`).

Snapback explicitly has no read-set extraction for opaque server queries (`llp/0008-local-first-sync-and-realtime.rfc.md:166-176`). Ibex queries may transform results beyond their predicate (`llp/0000-snapback.explainer.md:232-239`). An unselected database column can therefore influence a selected derived output. Skipping the re-query from UI selection plus `changed_fields` would be unsound. Re-querying first and suppressing an unchanged selected result is safe, but does not improve the fallback server-compute ceiling.

**Resolution criteria:** Revise F2/F3 to distinguish:

1. response projection;
2. server read and output-derivation closure;
3. filter/order dependencies;
4. authorization/membership dependencies; and
5. identity/reconciliation metadata.

Pre-requery suppression must be restricted to a query class with proven field lineage, such as direct HostPlan row projection, or require a sound dependency summary. Opaque Ibex queries must remain conservative; selected-value equality may suppress delivery only after execution. The shadow experiment must be described as measurement evidence, not a graduation proof, and include derived-output and helper-based counterexamples.

### Minor — The two fan-out ceilings are assigned the wrong common measurement scope

**Evidence:** `llp/0067-fate-lessons.research.md:95-103` describes both figures as classification-and-serialization-only and excluding enqueue. The fallback metric includes re-query, dependency capture, serialization, enqueue, and timed outbox draining (`llp/0035-local-target-benchmarks.research.md:158-165`; `src/bench.rs:101-106,403-435`). Only the delta microbenchmark is classifier-plus-serialization without enqueue (`src/bench.rs:459-545`; `llp/0035-local-target-benchmarks.research.md:199-243`).

**Resolution criteria:** Give each figure its own scope and state that they are not equivalent production-capacity measurements. Preserve the existing warning that neither is a current full-scale auth-era result and neither measures network or client application.

### Minor — Fate’s maturity is presented as settled despite contradictory official sources

**Evidence:** The document repeatedly calls Fate self-declared alpha and not production-ready (`llp/0067-fate-lessons.research.md:13-14,46-51,269-271`). Fate’s README still contains that warning, but its official May 14, 2026 [Fate 1.0 announcement](https://fate.technology/posts/fate-1.0) says it is ready for production use.

**Resolution criteria:** Report the official-source contradiction explicitly, with dates and links. Do not use “alpha” alone as the confidence rationale; retain the appropriate caveat that the review did not verify Fate’s implementation comprehensively.

### Minor — “Masking enforcement is cheap” contradicts the document’s own confidence assessment

**Evidence:** Cheapness is asserted in the Summary and §F3 (`llp/0067-fate-lessons.research.md:35-38,182-186`), while the Confidence section assigns medium-to-low confidence because grammar, IR, verifier, renderers, and helper inference all change (`llp/0067-fate-lessons.research.md:278-279`). Recommendation 3 confirms that breadth (`llp/0067-fate-lessons.research.md:300-304`).

**Resolution criteria:** Replace “cheap” with “standalone” or “separable in value,” unless a scoped prototype or cost decomposition supports the cost claim.

### Minor — The F2a provenance tag is inconsistent with the corpus convention

**Evidence:** F2a is tagged `[observed ... by code inspection]` (`llp/0067-fate-lessons.research.md:138-159`). LLP 0001 defines `[observed]` as not freshly verified and `[confirmed]` as backed by a recoverable artifact and date (`llp/0001-prior-art.research.md:25-43`). The document also does not pin the inspected repository revision.

**Resolution criteria:** Tag F2a as confirmed, record repository HEAD `0c2ed650bcc947652ea5d3e5481eab17e827a711`, retain the date, and add exact code references. Once filed, replace “flagged for filing” with the issue identifier.

## 4. Suggestions

- Scope the `changed_fields` claim to the current in-process live-query matcher. Those fields also drive authorization-event classification and ephemeral invalidation, and are not journaled (`src/storage/authorization.rs:99-126`; `src/ephemeral.rs:4111-4142`; `src/storage.rs:7177-7179`).

- Make `_version` an explicit hypothesis falsifier. If reconciliation requires every version advance to be delivered, unselected-column suppression may become metadata-only delivery rather than complete invalidation suppression.

- Use a two-tier identity experiment: preserve the existing query/args/authority key as the shared evaluation key, then add a canonical selection hash for projection cells. Maintain a ref-counted selection union upstream and per-binding masks downstream. This avoids treating “selection in the key” versus “one global union” as strictly binary.

- Clarify Contract’s checking mechanisms: typed query bindings are checked through compiler/project-mode analysis, while contract claims use the canonical-IR verifier. Add the governing Exact documents and LLP 0052 to `Related`.

- Treat per-component selection as a separate Exact-owned compiled binding-plan artifact unless a two-phase pipeline is designed. The existing `ContractDataManifest` is provider input generated before Contract compilation; mutating it with component selections risks circular generation.

- Test nested child-component composition, imported helpers, derives, actions, and branch widening—not only a flat view. A conservative fallback to `*` is preferable to an incomplete inferred mask.

- Tighten “same-authority query store” in §F4 to the complete provider/application/database/target/version/authority partition appropriate to the chosen store layer.

## 5. Open questions

- Which Snapback query classes can provide a sound source-field-to-output-field dependency closure, and what capability marker proves it?

- For opaque queries, is post-execution selected-value equality valuable enough when it saves payload and client work but not server re-query cost?

- Must `_version` and other reconciliation metadata advance on every underlying row change, and can metadata updates be separated from view invalidation?

- Should selection identify a logical subscription, a delivery projection over shared evaluation, or both at different layers?

- How do child components and helper summaries compose selection requirements without making ordinary Contract authoring cumbersome?

- What artifact carries compiled selections across the Exact/Snapback ownership boundary without creating a circular `ContractDataManifest` pipeline?

- Which production-shaped workloads have enough unselected-column churn to beat the simpler shared-evaluation control?

- What regression test and tracked issue will close the current membership-filter defect, including primary-table writes while membership is false and both directions of membership-table change?

## 6. Readiness verdict

NOT READY

### Orchestrator verification (round 3)

Spot-checked the decisive claims without altering the verbatim body. Confirmed: LLP 0008:166-176 states opaque server-query handlers get "no read-set extraction" and re-run wholesale — the major's premise that server execution dependencies are unproven for the opaque class is accurate, and the resulting soundness gate (pre-requery suppression only for proven-lineage query classes; post-execution equality suppression for the rest) is a correct strengthening of the document's hypothesis 1. The Fate-maturity contradiction was adjudicated against the live site: the May 14, 2026 announcement states verbatim "fate 1.0 is now ready for production use" while the README retains the alpha warning — the review's correction stands and the revision will report the contradiction with dates rather than relying on "alpha" alone. The `[observed]`→`[confirmed]` tagging point matches LLP 0001's declared vocabulary. The concurrent Claude-family round returned READY on this same revision; its C1 (the missed-delivery/NoChange direction of F2a) is complementary to this review's findings and will be folded into the same revision. Disposition: accept the major and four minors for a round-4 revision alongside the Claude-family polish items.

## Round 4 — 2026-07-20

**Revision under review:** `llp/0067-fate-lessons.research.md`, sha256 `f8f9de7360249537a134e3e29ac2209ae6a512a9e7e2aef559841996d04e8ce8` (pinned at repo HEAD `4a1024a`)
**Runtime detail:** codex session id 019f8319-6581-7a30-9d08-b802aeb39620, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

MATCH — `f8f9de7360249537a134e3e29ac2209ae6a512a9e7e2aef559841996d04e8ce8`

## 1. Overall assessment

The central direction is good: Fate is relevant prior art, field declarations and masking merit investigation, and the benchmark-first plan is appropriately cautious. The document also wisely separates masking correctness from update economics and parks normalized caching behind an authorization-safety bar.

However, several repo-facing claims are materially inaccurate or incomplete. In particular, F2 misstates current Ibex read-dependency capture, F2a overstates both its debug protection and its applicability across auth modes, and F4 omits Contract’s actual online state path. The proposed cross-query overlay admission rule is also too weak for the authorization hazard the document itself identifies. These issues should be corrected before the Research LLP advances.

## 2. Strengths

- The provenance treatment is unusually candid and consistent with the corpus’s Research conventions. It names mutable Fate sources and their read date, disclaims source verification, exposes the README/1.0 maturity contradiction, pins F2a’s inspected Snapback revision, and marks Fate-to-Snapback recommendations as inferred (`llp/0067-fate-lessons.research.md:44-60`; `llp/0001-prior-art.research.md:25-49`).

- F2 responsibly refuses to compare the ~5–6 fallback and ~28,000+ delta figures as equivalent capacity measurements. The stated scopes match LLP 0035 and the benchmark implementation: fallback includes re-query, capture, serialization, enqueue, and outbox draining, while the delta measurement is classification plus serialization without enqueue (`llp/0067-fate-lessons.research.md:97-114`; `llp/0035-local-target-benchmarks.research.md:199-258`; `src/bench.rs:378-547`).

- The conceptual decomposition is strong. F2 separates affected-subscription rate, payload size, and client work; F3 separates masking enforcement, advisory overfetch reporting, and suppression economics (`llp/0067-fate-lessons.research.md:116-156,205-244`). That prevents Fate’s attractive surface model from being mistaken for proof of a Snapback performance result.

- F2b correctly identifies the selection-identity fork. Exact’s logical key excludes selection and same-key bindings share one provider subscription, while Snapback’s online and durable keys also exclude selection (`llp/0067-fate-lessons.research.md:192-203`; `../exact/packages/exact-contract/src/runtime/query-identity.ts:144-178,256-267`; `../exact/packages/exact-contract/src/runtime/query-dedup.ts:237-299`).

- F2a’s core discovery is real and valuable despite the qualifications below. The governing design keeps membership semi-joins on `live_replace`, but current delta candidacy admits HostPlan queries and row classification ignores `membership_filters` (`llp/0056-scoped-roles-and-memberships.rfc.md:1014-1021`; `src/local.rs:11055-11060`; `src/live_matcher.rs:286-297,613-715`).

- The recommended shadow-decision experiment is a sound plan: preserve the authoritative full path, measure counterfactual suppression, include derived-output counterexamples, and require proven lineage before graduation (`llp/0067-fate-lessons.research.md:320-346`).

## 3. Concerns

### C1 — Major: F2 incorrectly says opaque/Ibex handlers have no read-set extraction

**Evidence:** F2 states that opaque handlers have “no read-set extraction” (`llp/0067-fate-lessons.research.md:119-127`). Current Snapback dynamically captures Ibex point and query reads through `ctx.db`, returns those dependencies from query execution, and uses them for realtime invalidation (`src/runtime.rs:1008,1035,1054,1632-1729`; `src/local.rs:12277-12295`). The landed behavior is documented in `llp/0020-core-authoring-surface.plan.md:267-300,341-366`.

The actual limitation is narrower but still supports F2’s conservative conclusion: Snapback lacks field-level source-to-output derivation lineage. Captured row/query dependencies do not prove which source fields influenced a selected output.

**Resolution criteria:** Replace the “no read-set extraction” claim with the precise distinction between dynamic row/query dependency capture and absent field-level derivation lineage. Cite LLP 0020 and current code rather than the stale/Valet-framed passage in LLP 0008.

### C2 — Major: F2a’s claimed debug convergence protection is false

**Evidence:** The document says a membership-only change yielding zero ops freezes release builds but would trip the L4 assertion in debug builds (`llp/0067-fate-lessons.research.md:176-180`). `try_live_delta_fanout` returns `DeltaFanout::NoChange` immediately for empty ops (`src/local.rs:11289-11297`), and the caller skips further work (`src/local.rs:11105-11108`). The debug convergence assertion occurs later (`src/local.rs:11391-11396`) and is unreachable on that path. Debug and release builds can therefore both miss the transition silently.

**Resolution criteria:** Correct F2a and its Confidence section to state that `NoChange` bypasses the debug oracle. Require a regression test for a membership-table-only empty-to-visible transition. Distinguish this from nonempty over-delivery, which can reach the debug assertion.

### C3 — Major: F2a overgeneralizes the missed-delivery direction across auth modes

**Evidence:** Membership writes are authorization events (`src/storage/authorization.rs:73-127`). With sessions-mode invalidation installed, Snapback processes that event before ordinary live fan-out, resnapshots auth-scoped subscriptions, and excludes the handled subscription IDs from the delta loop (`src/local.rs:5528-5555,10773-10902,11034-11036`). Thus that path can preempt the zero-op failure.

The missed transition remains reachable where no earlier authorization-event resnapshot handles the subscription. Shindig is explicitly dev mode and contains a HostPlan query with `membershipFilters` (`demos/shindig/demo.snapback.json:6-15`; `demos/shindig/snapback/generated/functions.manifest.json:70-99`). The main-table over-delivery direction is independently real.

**Resolution criteria:** Scope the missed-delivery claim to configurations where authorization-event handling does not pre-resnapshot the subscription, or provide an executable sessions-mode reproduction demonstrating another route. Present over-delivery and missed delivery as separately conditioned findings.

### C4 — Major: F4’s exhaustive “two client store layers” model omits Contract’s online path

**Evidence:** F4 names only the React external store and durable DK-9 store (`llp/0067-fate-lessons.research.md:246-258`). React does use `@snapback/client/external-store` (`packages/snapback-react/index.mjs:3-85`), but Contract does not use that store. Snapback creates and writes an Exact `ContractQueryBoundary` (`packages/snapback-contract/index.mjs:1787-1796,2167-2249,4346-4352`); Exact then owns boundary subscriptions and per-binding row signals (`../exact/packages/exact-contract/src/runtime/query-boundary.ts:58-155`; `../exact/packages/exact-contract/src/runtime/instance.ts:1120-1280`). Durable DK-9 custody is another, optionally stacked owner.

This omission matters because Contract’s boundary is one of the places where optimistic cross-query inconsistency can occur.

**Resolution criteria:** Replace the two-layer model with an explicit topology covering at least the React external store, the Snapback/Exact Contract boundary and binding state, and durable DK-9 custody. State which paths are alternatives, which can be stacked, and which concrete owner each proposed experiment would modify.

### C5 — Major: the proposed overlay fan-out admission rule is not an authorization proof

**Evidence:** F4 correctly observes that one row may be visible through one subscription and absent through another, and that field masking is not authorization (`llp/0067-fate-lessons.research.md:260-275`; `llp/0008-local-first-sync-and-realtime.rfc.md:441-453`). It then proposes applying an overlay to every same-authority query store whose read set can observe the mutation (`llp/0067-fate-lessons.research.md:276-280`).

Same authority plus read relevance does not prove that the mutated row belongs in a particular query result. Query arguments, ordinary predicates, membership predicates, and authorization scope can all differ. A read set is an invalidation dependency, not necessarily a positive visibility proof.

**Resolution criteria:** Require a per-query proof that the optimistic result satisfies ordinary filters, membership predicates, authorization constraints, and reconciliation rules. Opaque or unproved query instances must receive no cross-query overlay. If “can observe” was intended to mean that complete proof, define it explicitly.

### C6 — Minor: Fate deduplicates identical live-view subscriptions

**Evidence:** F1 says every `useLiveView` remains its own logical subscription (`llp/0067-fate-lessons.research.md:80-84`). Fate’s current [`subscribeLiveView` implementation](https://github.com/nkzw-tech/fate/blob/main/packages/fate/src/client.ts) keys subscriptions by entity plus selection plan, increments a reference count for an existing key, and calls the transport only for a new key. Distinct entities or selection plans remain separate, so the broader “no screen-level composition” conclusion still holds.

This does not make the provenance tagging dishonest—the document explicitly says Fate’s source was not inspected—but the factual description is imprecise.

**Resolution criteria:** State that identical entity-and-selection-plan subscriptions are deduplicated and reference-counted, while distinct refs or plans remain separate logical subscriptions.

### C7 — Minor: precise Exact claims do not cite the current governing source

**Evidence:** F2b’s identity/sharing claims are correct, but the Related list and F3 chiefly cite Exact LLP 0216, which describes itself as narrative rather than authoritative (`llp/0067-fate-lessons.research.md:9,194-243`; `../exact/llp/0216-contract-explained.explainer.md:17-22`). Exact LLP 0263 contains the current data-binding contract and ratified logical-query identity (`../exact/llp/0263-contract-data-bindings-for-snapback-and-backends.rfc.md:206-377,560-633,1284-1317`).

**Resolution criteria:** Add Exact LLP 0263 and the logical-subscription authority to Related and cite them in F2b/F3. Ideally pin the inspected Exact revision as F2a pins Snapback.

## 4. Suggestions

- Clarify that Fate has no Relay-style query language or fragment-hoisting compiler, but does use Vite/CLI generation for wiring and types; “the Vite plugin integrates transport” understates its build tooling.

- Either cite dated registry artifacts for the observed Fate package versions or remove the non-load-bearing `1.3.2` numbers.

- Treat existing Contract IR plus runtime propagation as a third possible home for selections; a separate artifact and a two-phase pipeline are not the only options (`llp/0067-fate-lessons.research.md:239-243`).

- Consider having the Contract compiler synthesize a conservative selection witness from its semantic graph. Directly known field reads become the selection; imported or opaque helper boundaries widen to all fields unless they export dependency summaries. This could avoid duplicating declarations while preserving soundness.

- Benchmark a matrix rather than one aggregate “field selection” prototype: HostPlan with proven lineage, Ibex with captured-but-field-opaque reads, membership-gated queries, ordered/limited queries, identical watchers, and same-query watchers with differing selections.

## 5. Open questions

- What exact artifact or capability marker proves source-field-to-output-field lineage, and who owns producing and verifying it?

- Can dynamic Ibex dependency capture be extended to field reads soundly, or must opaque handlers always remain conservative?

- What invariant and tests cover both membership failure directions across dev and sessions modes?

- Should selection participate in logical identity, be unioned across bindings, or use a two-tier evaluation key plus projection-cell key?

- Which concrete online owner—React external store, Contract boundary, or Exact binding state—would host masking, equality suppression, and optimistic fan-out?

- What proof is sufficient for cross-query optimistic visibility, especially when membership and authorization dependencies are not delivered fields?

- Does mandatory `_version` advancement reduce unselected-field suppression to metadata-only delivery, and on what workloads does selection outperform shared server evaluation?

## 6. Readiness verdict

NOT READY

### Orchestrator verification (round 4)

Spot-checked the decisive claims without altering the verbatim body. Confirmed: LLP 0020 Phase 3 documents landed dynamic read-dependency capture (row ids, query ranges, predicates) — C1's correction of the stale Valet-era "no read-set extraction" framing is accurate, with the surviving narrower limitation being absent *field-level* derivation lineage; the delta loop excludes `already_resynced` subscription ids populated by authorization-event handling (`src/local.rs:3984, 11035`) and membership writes classify as authorization events (`src/storage/authorization.rs:73`) — C3's auth-mode scoping of the missed-delivery direction rests on real machinery. C2 (the `NoChange` return preceding the debug assertion) was independently found by the concurrent Claude-family round-4 review — the two families agree the debug-oracle claim must be corrected. C6's Fate-source observation is from the reviewer's knowledge of the nkzw-tech/fate client source; the revision will adopt the ref-counted dedup nuance without asserting source verification this loop did not perform. The Claude-family round-4 verdict on this same revision was READY with overlapping minors; this review's five majors govern. Disposition: round-5 revision corrects the read-set-extraction claim (citing LLP 0020), the debug-oracle claim, scopes the missed-delivery direction by auth mode, replaces the two-layer store model with the full topology including the Contract boundary, strengthens the overlay admission rule to a per-query visibility proof, and folds in C6/C7 and the Claude-family round-4 minors.

## Round 5 — 2026-07-20

**Revision under review:** `llp/0067-fate-lessons.research.md`, sha256 `6933a5c4a03a2eb2c57f0a8a7287543627e2677a4cb46f80cc2ab73c38593e16` (pinned at repo HEAD `4a1024a`)
**Runtime detail:** codex session id 019f8329-27ae-7693-939e-98dafb7601ec, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

MATCH — sha256 `6933a5c4a03a2eb2c57f0a8a7287543627e2677a4cb46f80cc2ab73c38593e16`

## 1. Overall assessment

The core research agenda is sound: field selection and Contract masking merit investigation, while normalization is appropriately parked behind evidence and authorization constraints. The document correctly separates invalidation, payload, and client-work benefits and proposes a safe shadow-evaluation path.

It is not ready because its headline fan-out figures come from benchmark fixtures later corrected as methodologically unsound, without a corrected rerun. There are also narrower provenance and current-state inaccuracies concerning Fate subscription identity, Exact LLP status, and durable-store composition.

## 2. Strengths

- Section F2 carefully separates affected-subscription rate, payload size, and client update work instead of treating “field selection” as one undifferentiated optimization (`llp/0067-fate-lessons.research.md:121`).
- Section F2 correctly limits pre-requery suppression to query classes with proven source-to-output field lineage and keeps opaque handlers conservative (`llp/0067-fate-lessons.research.md:124`). The repository has row/range dependency capture but no output-field lineage, as described.
- Section F2a is an excellent, concrete finding. The membership-gated `live_delta` discrepancy, both failure directions, Shindig reachability, and sessions/dev qualification are confirmed by `src/local.rs:11055`, `src/local.rs:11289`, `src/live_matcher.rs:286`, `src/live_matcher.rs:619`, and `src/live_matcher.rs:643`.
- Section F3 correctly distinguishes masking enforcement from update-suppression economics and identifies the five field sets that a sound design must keep separate (`llp/0067-fate-lessons.research.md:235`, `llp/0067-fate-lessons.research.md:263`).
- Section F4 accurately identifies the external store, Exact-owned Contract boundary, and DK-9 durable store as distinct state owners, and its authorization warning is important (`llp/0067-fate-lessons.research.md:278`).
- The recommendation to gather shadow decisions while retaining the authoritative path is a safe and useful plan (`llp/0067-fate-lessons.research.md:373`).
- The maturity contradiction is honestly reported: Fate’s [README](https://github.com/nkzw-tech/fate) retains an alpha warning while the [1.0 announcement](https://fate.technology/posts/fate-1.0) claims production readiness.

## 3. Concerns

### C1 — Major: the fan-out ceilings are unsupported by the corrected benchmark

Evidence: `llp/0067-fate-lessons.research.md:104-112` presents approximately 5–6 fallback and 28,000+ delta subscriptions per commit as dated, fixture-specific measurements from `llp/0035-local-target-benchmarks.research.md:214-217`.

Commit `37f1a2f` subsequently corrected both fixtures:

- The old delta loop made only subscriber zero match while all remaining subscribers took the cheap non-member path, then divided by the total subscriber count. Current `src/bench.rs:518-521` explicitly says that mixture understated affected-delivery cost and overstated the derived ceiling.
- The fallback benchmark changed from an ever-growing result set to a fixed 16-row fixture (`src/bench.rs:403-435`).

No corrected full-scale result is recorded. Calling the values merely “dated” and “fixture-specific” does not disclose that their intended measurement contract was known to be broken. Recommendation 2 also asks to remeasure only fallback, although the delta number is the more directly invalid affected-subscription measurement.

Resolution criterion: either rerun the corrected current release harness and replace both figures with reproducible configurations and scopes, or remove the figures and explicitly identify the 2026-07-02 results as invalid historical artifacts. Recommendation 2 must require remeasurement of both paths.

### C2 — Minor: Fate live-subscription identity exceeds the declared provenance

Evidence: `llp/0067-fate-lessons.research.md:82-88` asserts client-side reference-counted deduplication by entity and selection plan, and line 228 calls selection-bearing live identity “Fate’s choice.” Yet lines 46–48 and 349–351 say Fate was not source-verified.

The public [Live Views guide](https://fate.technology/guide/live-views) establishes one SSE stream, subscribe/unsubscribe controls, server-held selections, and changed-field intersection. The [Requests guide](https://fate.technology/guide/requests) establishes selection as part of the request cache key. Neither documented source specifies reference-counted live-subscription identity or proves that distinct selection plans form distinct logical live subscriptions.

Resolution criterion: add a stable source or test permalink proving the refcount and live-key semantics, or qualify them as inferred/unverified and narrow “Fate’s choice” to the documented request-cache identity.

### C3 — Minor: Exact LLP 0263 is not wholly ratified

Evidence: `llp/0067-fate-lessons.research.md:223-240` repeatedly calls Exact LLP 0263 the ratified data-binding RFC/contract. Its header remains `Status: Draft` (`../exact/llp/0263-contract-data-bindings-for-snapback-and-backends.rfc.md:4`). Its A1 amendment specifically ratifies logical binding identity and same-key deduplication (`../exact/llp/0263-contract-data-bindings-for-snapback-and-backends.rfc.md:1282-1308`). Exact LLP 0216 is a general Contract explainer, not the normative data-binding companion.

Resolution criterion: cite “Draft Exact LLP 0263’s ratified A1 amendment” for identity and deduplication, and use Exact LLP 0216 only for general Contract language, IR, and verifier background.

### C4 — Minor: durable-store composition is phrased as current capability

Evidence: `llp/0067-fate-lessons.research.md:297` says durable custody “can stack beneath either online path.” Currently, the legacy single-query Contract surface accepts `clientStore` (`packages/snapback-contract/index.mjs:540`), but keyed Contract explicitly rejects it with `SNAPBACK_CONTRACT_KEYED_OFFLINE_PENDING` (`packages/snapback-contract/index.mjs:781-795`). The React external store is explicitly non-durable (`packages/snapback-client/README.md:21-23`).

Resolution criterion: state the currently supported composition precisely and label stacking beneath the React or keyed-Contract paths as a proposed architecture rather than an as-built capability.

## 4. Suggestions

- Add a compact Fate provenance table mapping each mechanism to a URL, access date, and preferably a commit permalink.
- Refine F2a’s wording to say that visibility-changing membership inserts, deletes, and role changes classify as authorization events; incidental-only updates may not.
- Clarify that a later non-empty delta may expose or heal prior membership drift; it does not necessarily make the debug assertion fail.
- Expand F4’s overlay visibility proof to name ordering, limits/windows, aggregation, and output derivation explicitly.
- Consider a compiler-emitted five-set dependency certificate carrying proof provenance such as `host-plan`, `declared`, or `opaque`. The runtime could then permit pre-requery suppression only for proven certificates.
- Ensure the authorization-relevant F2a defect is filed promptly and link the issue from the document.

## 5. Open questions

- What are the corrected fallback and delta costs under fixed result sizes, genuinely affected subscribers, and the current protected-query profile?
- In realistic workloads, does field selection materially reduce affected-subscription rate, or mostly payload and client work?
- Which query classes can produce a sound source-field-to-output-field closure, and how is that proof represented in generated artifacts?
- Can a two-tier identity—stable shared-evaluation key plus canonical selection-hash projection cells—avoid both union churn and subscription fragmentation?
- Does `_version` or other reconciliation metadata require delivery for every underlying row change, defeating full suppression?
- Where should compiled Contract selections live, and which compatibility or artifact token changes when they change?
- Can normalized fragments retain enough query-specific authorization and lease provenance to remain useful, or do the necessary fences erase most of normalization’s benefit?

## 6. Readiness verdict

NOT READY

### Orchestrator verification (round 5)

Spot-checked the decisive claims without altering the verbatim body. Confirmed: commit `37f1a2f` ("ENG-23422 ENG-23423: correct Snapback fanout benchmarks") exists, and the current `src/bench.rs` delta-benchmark comment states verbatim that mixing non-member reject cost "would understate the affected delivery cost and overstate the derived fan-out ceiling" — C1's premise that the 2026-07-02 figures came from fixtures later corrected as unsound is accurate, and no corrected full-scale rerun is recorded in LLP 0035. Confirmed keyed Contract rejects `clientStore` with `SNAPBACK_CONTRACT_KEYED_OFFLINE_PENDING` (`packages/snapback-contract/index.mjs:792-794`) — C4's as-built composition correction is accurate. C2 aligns with the concurrent Claude-family round-5 review, which independently found the dedup claim unsupported by the cited public sources; C3 likewise (0263 is Draft with a ratified A1 amendment). Disposition: round-6 revision recasts both fan-out figures as invalid historical artifacts pending a corrected rerun (and requires remeasuring both paths in Recommendation 2), retags the Fate live-identity nuances as inferred/unverified, corrects the 0263 status description, and states the as-built durable-store composition precisely.

## Round 6 — 2026-07-20

**Revision under review:** `llp/0067-fate-lessons.research.md`, sha256 `ae99fcf7ffcd913853267fb6f698ba72453f8ba8f909a1661ac3be3a2f7e1265` (pinned at repo HEAD `4a1024a`)
**Runtime detail:** codex session id 019f8338-796e-7d42-8921-82f41b7a9575, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

MATCH — `sha256 ae99fcf7ffcd913853267fb6f698ba72453f8ba8f909a1661ac3be3a2f7e1265`

## 1. Overall assessment

This is a strong research direction. Fate is relevant prior art, and the document correctly extracts declarations, masking, and field-aware invalidation without proposing to transplant Fate’s transport or cache wholesale. The ordering is sensible: masking has standalone value; server-side selection needs measurement and safety prerequisites; normalization should remain parked.

The draft is unusually careful about provenance, authorization, dependency lineage, and separating affected-rate, payload, and client-work hypotheses. However, two load-bearing areas need correction: it retains an unsupported benchmark magnitude after invalidating its evidence, and it mischaracterizes the as-built Contract modes in the normalized-cache analysis. The recommendations also need an explicit corpus-reconciliation action for benchmark claims now known to be invalid.

## 2. Strengths

- The provenance section is candid and internally consistent ([0067:44](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:44)). The stated maturity contradiction is real: Fate’s [README](https://github.com/nkzw-tech/fate) still calls it alpha while the [Fate 1.0 announcement](https://fate.technology/posts/fate-1.0) calls it production-ready.

- F2 separates three independently measurable effects—affected-subscription rate, payload size, and client update work—and correctly refuses to infer server execution dependencies from UI delivery selection ([0067:126](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:126)). The row/range-level dependency and missing field-lineage description matches the runtime ([runtime.rs:1632](/Users/ccheever/projects/snapback/src/runtime.rs:1632)).

- F2a is an excellent, actionable safety finding ([0067:176](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:176)). The implementation does capture membership-table dependencies, but delta classification evaluates only ordinary filters ([live_matcher.rs:87](/Users/ccheever/projects/snapback/src/live_matcher.rs:87), [live_matcher.rs:286](/Users/ccheever/projects/snapback/src/live_matcher.rs:286)); unordered below-cap queries remain delta-eligible, and empty deltas become `NoChange` before the convergence assertion. The Shindig dev-mode shape is reachable. The document also correctly distinguishes the main-table over-delivery and membership-table missed-delivery directions.

- F3’s distinction between masking correctness and suppression economics is important and correct ([0067:247](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:247)). Exact publishes a fresh rows array for each query delivery ([instance.ts:1198](/Users/ccheever/projects/exact/packages/exact-contract/src/runtime/instance.ts:1198)), so masking alone cannot suppress downstream reactive work.

- The five field sets and ownership split are well reasoned ([0067:275](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:275)). In particular, keeping payload projection separate from derivation, filters/order, authorization/membership, and reconciliation metadata avoids the common mistake of treating a view selection as a complete invalidation dependency.

- The shadow-decision recommendation is a good plan ([0067:390](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:390)). It preserves the full-query oracle, includes derived-output counterexamples, compares both selection-identity arms, and includes shared evaluation as a lower-ceremony control.

## 3. Concerns

### 3.1 Unsupported benchmark conclusion

**Severity: major**

**Evidence:** The document correctly says both historical fixtures were methodologically invalid and that no corrected full-scale run is recorded ([0067:105](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:105)), but immediately retains the conclusion that delta is “orders of magnitude cheaper” ([0067:117](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:117)). The corrected smoke gate proves only that delta is more than 2× cheaper ([bench.rs:1029](/Users/ccheever/projects/snapback/src/bench.rs:1029)). Moreover, the fallback and delta measurements cover different work: fallback includes re-query, enqueue, and draining, while the delta benchmark measures classify-and-serialize without enqueue.

Recommendation 2 then says to rerun the fallback benchmark, despite F2 correctly requiring both paths to be remeasured ([0067:122](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:122), [0067:390](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:390)).

**Resolution criteria:**

- Remove “orders of magnitude,” or label it explicitly as an unmeasured hypothesis rather than retained evidence.
- Require corrected full-scale runs of both paths.
- Either measure comparable end-to-end stages or report compute-only and delivery-inclusive results separately.
- Record result-set size, auth profile, affected subscriber count, total subscriber count, and enqueue/drain scope with each result.

### 3.2 Known-invalid capacity claims remain authoritative elsewhere

**Severity: major**

**Evidence:** The recommendations do not require immediate reconciliation of active documents that still present the invalid figures as current facts: [LLP 0000:214](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:214), [LLP 0008:222](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:222), and [LLP 0035:199](/Users/ccheever/projects/snapback/llp/0035-local-target-benchmarks.research.md:199). The stale ~5,200× claim also remains in implementation commentary ([live_matcher.rs:592](/Users/ccheever/projects/snapback/src/live_matcher.rs:592)) and several dependent LLPs.

That leaves the repository’s governing explanation and RFC contradicting this research finding, creating a direct decision-quality hazard.

**Resolution criteria:**

- Add an immediate corpus-reconciliation recommendation, separate from future remeasurement.
- Qualify the old figures everywhere as superseded fixture results, preserving them only as history.
- Search dependent LLPs and code comments so no invalid ceiling or ratio remains presented as current evidence.
- Propagate corrected measurements only after the replacement run is recorded.

### 3.3 F4 misstates the as-built Contract architecture

**Severity: major**

**Evidence:** F4 says the Contract boundary path can exhibit cross-query optimistic inconsistency and treats it as a required normalization owner ([0067:299](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:299)). No shipped Contract mode currently combines multiple query results with optimistic overlays:

- Legacy single-query mode has a boundary and optimistic reducers, but binds one query ([index.mjs:559](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:559), [index.mjs:2167](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:2167)).
- Legacy multi-live mode has multiple boundary entries but explicitly has no optimistic publication turn ([index.mjs:3920](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:3920), [index.mjs:4384](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:4384)).
- Keyed Contract uses direct provider handles and has no optimistic overlay ([keyed-provider.mjs:308](/Users/ccheever/projects/snapback/packages/snapback-contract/keyed-provider.mjs:308), [keyed-provider.mjs:343](/Users/ccheever/projects/snapback/packages/snapback-contract/keyed-provider.mjs:343)).

The statement that only legacy single-query accepts `clientStore` is also too broad ([0067:304](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:304)): legacy multi-live accepts it for durable authorization/invalidation custody ([index.mjs:3933](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:3933), [index.mjs:4218](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:4218)), although retained rows and offline outbox support remain single-query-only.

**Resolution criteria:**

- Describe legacy single, legacy multi-live, and keyed direct-provider modes separately.
- State that cross-query optimistic divergence is currently architecturally possible on the per-query React external-store path, but is only a future Contract risk unless multi-query optimism is added.
- Correct the `clientStore` claim by distinguishing full offline retention/outbox from authorization custody.
- Name the intended experimental attachment point, preferably the strategic keyed logical-subscription path rather than the legacy mock boundary.

### 3.4 Fate live-subscription identity is imprecise

**Severity: minor**

**Evidence:** “Each live view is its own logical subscription” ([0067:83](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:83)) can be read as one server subscription per hook instance. Current upstream source instead keys by entity plus selection plan and reference-counts identical consumers before opening transport subscription ([FateClient source](https://github.com/nkzw-tech/fate/blob/main/packages/fate/src/client.ts#L1106)). The conclusion that Fate does not compose distinct screen-level live subscriptions remains correct.

**Resolution criteria:** Say “one logical subscription per distinct entity, selected paths, and selection arguments, reference-counted across identical consumers and multiplexed over one SSE connection.” Pin the upstream revision if source behavior becomes evidence.

### 3.5 Logical-key governance is slightly misattributed

**Severity: minor**

**Evidence:** F2b calls Exact LLP 0263 the governing contract for the four-position key ([0067:232](/Users/ccheever/projects/snapback/llp/0067-fate-lessons.research.md:232)). Exact LLP 0179 §8.1 is the explicit normative home for tuple construction, partition minting, compatibility tokens, and canonicalization ([Exact LLP 0179:558](/Users/ccheever/projects/exact/llp/0179-snapback-by-default.rfc.md:558)). Exact LLP 0263 A1 consumes those rules and governs binding lifetime, fencing, and same-key deduplication ([Exact LLP 0263:1284](/Users/ccheever/projects/exact/llp/0263-contract-data-bindings-for-snapback-and-backends.rfc.md:1284)).

**Resolution criteria:** Cite LLP 0179 and LLP 0263 jointly and distinguish their ownership.

## 4. Suggestions

- Exploit Contract’s existing field-shape analysis: infer direct member-access selections from the AST, conservatively widen opaque helper/import boundaries, and require explicit summaries only at those boundaries. This may deliver honest masking with less duplicated declaration ceremony.

- Restrict any normalized-cache prototype to manifest-declared entity-shaped results with stable identity. Arbitrary named-query results may be derived, aggregated, or synthesized, so `table + _id` is not a universal identity rule.

- Replace F3’s claim that “renderers” necessarily change with “runtime, verifier, inspection, and tooling” unless selection provenance is intentionally carried into host operations.

- When F2a is filed, replace “flagged for filing” with the issue key and include separate regression cases for main-table over-delivery and membership-table-only empty-to-visible transitions.

- Add pinned deep links or an upstream Fate commit to the provenance section and mark F1 as observed, matching LLP 0001’s convention more closely.

## 5. Open questions

- Which Contract path is the intended first selection/masking target: legacy boundary-backed mode or strategic keyed provider subscriptions?
- What is the corrected, stage-comparable fallback-versus-delta ratio, and which of affected rate, bytes, or client work is actually the dominant opportunity?
- Can compiler-inferred field access supply most selections, leaving explicit declarations only for opaque helpers and intentional widening?
- What exact manifest capability proves that a result is entity-normalizable and that source-field-to-output-field lineage is sound?
- Should selection remain binding-local over a shared full upstream subscription initially, allowing unioned upstream projection only after shadow measurements show a material win?
- What durable tracker and landing sequence will ensure F2a and the invalid benchmark claims are corrected before selection work begins?

## 6. Readiness verdict

NOT READY

### Orchestrator verification (round 6)

Spot-checked the decisive claims without altering the verbatim body. Confirmed: the stale "~5 200× cheaper" figure survives in `src/live_matcher.rs:591-592`'s doc comment, LLP 0000:219, and LLP 0008:230 plus its Revised header — concern 3.2's corpus-reconciliation hazard is real; the corrected smoke gate in `src/bench.rs` asserts a "decisively cheaper" delta-vs-fallback comparison per run rather than any orders-of-magnitude ratio — concern 3.1's evidence stands; the multi-live surface's header comment ("no optimistic layer... freshness owned by the push") confirms 3.3's no-optimistic-publication claim for that mode. Concern 3.4 now cites the upstream FateClient source directly, resolving the provenance ambiguity the two prior rounds flagged from opposite directions. The concurrent Claude-family round-6 verdict on this same revision was READY with four minors, one of which (the relative-magnitude parenthetical leaning on invalidated fixtures) independently anticipates concern 3.1. Disposition: round-7 revision softens the ratio to a mechanism-grounded unmeasured expectation, requires corrected full-scale runs of both paths with per-result scope metadata, adds an immediate corpus-reconciliation recommendation for the superseded figures (LLP 0000/0008/0035, dependent docs, and the live_matcher comment), splits F4's Contract description into the three as-built modes with the corrected clientStore scope and names the keyed path as the intended attachment point, adopts the sourced Fate dedup wording, and cites Exact 0179 §8.1 jointly with 0263 A1.

## Round 7 — 2026-07-20

**Revision under review:** `llp/0067-fate-lessons.research.md`, sha256 `13369fa235df349e50ebf804069b35a66f7c5d4f399bfa59ef9f052a2c928c25` (pinned at repo HEAD `4a1024a`)
**Runtime detail:** codex session id 019f834a-25dc-7181-bb34-fd0d2266a777, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

MATCH — sha256 `13369fa235df349e50ebf804069b35a66f7c5d4f399bfa59ef9f052a2c928c25`

## 1. Overall assessment

This is strong, unusually careful research with a good benchmark-first plan. Separating masking correctness from suppression economics, requiring proven field lineage, comparing selection designs against shared evaluation, and parking normalization are all sound decisions.

Two material issues prevent readiness: Fate’s subscription identity is internally inconsistently sourced and incompletely described, and F4 incorrectly limits present-day Contract cross-query optimistic divergence to React.

## 2. Strengths

- The benchmark correction is exemplary. F2 clearly demotes the ~5–6 and ~28,000+ ceilings from evidence to invalid historical artifacts and calls for corrected remeasurement (`llp/0067-fate-lessons.research.md:101-127`). Commit `37f1a2f` confirms both fixture defects, while LLP 0035 records no corrected full-scale run.

- F2a identifies a real, reachable safety discrepancy rather than merely proposing future work (`llp/0067-fate-lessons.research.md:180-232`). Membership dependencies wake subscriptions, but delta classification ignores `membership_filters`, skips other-table changes, and can settle empty ops as `NoChange` before convergence checking (`src/live_matcher.rs:87-99,286-297,613-651`; `src/local.rs:11289-11305,11391-11445`). The Shindig `eventDetails` query reaches the vulnerable unordered, below-cap shape.

- The field-lineage distinction is technically sound (`llp/0067-fate-lessons.research.md:132-157`). UI projection does not prove server computation dependencies, and opaque Ibex handlers cannot safely skip re-execution merely because changed columns are absent from a selection.

- F2b accurately states Exact’s logical key and the selection-key-versus-union fork (`llp/0067-fate-lessons.research.md:234-250`). Exact keys partition, descriptor identity, compatibility token, and canonical arguments, with same-key deduplication and no selection (`../exact/llp/0179-snapback-by-default.rfc.md:571-602`; `../exact/llp/0263-contract-data-bindings-for-snapback-and-backends.rfc.md:1284-1317`).

- F3 correctly characterizes Contract’s explicit, query-granular dependency model and separates masking from update suppression (`llp/0067-fate-lessons.research.md:252-293`). Exact’s IR has query/mutation bindings and action effect declarations but no field-selection construct; current query delivery publishes fresh array-valued signals.

- Most of the client-store inventory is accurate, including the online external store, keyed provider, multi-live mode, and DK-9 durable fences (`llp/0067-fate-lessons.research.md:295-327`).

- Fate’s public model is otherwise represented fairly. Selection composition, masking, normalized caching, selected-field updates, and changed-field intersection agree with the [Views](https://fate.technology/guide/views), [Requests](https://fate.technology/guide/requests), and [Live Views](https://fate.technology/guide/live-views) guides. The maturity conflict is also real: the [README](https://github.com/nkzw-tech/fate) warns about alpha status while the [1.0 announcement](https://fate.technology/posts/fate-1.0) claims production readiness.

## 3. Concerns

### Major — F4 incorrectly makes current Contract divergence React-only

**Evidence:** The document says cross-query optimistic divergence is currently possible only through React and becomes a Contract risk only if multi-query optimism is added (`llp/0067-fate-lessons.research.md:304-314`).

Contract explicitly supports mounting several surfaces over one physical store (`packages/snapback-contract/index.mjs:129-133`; `packages/snapback-contract/auth-coordinator-contract.test.mjs:433-440`). Each legacy surface binds one query, constructs an independent boundary, and applies optimistic reducers only to that boundary (`packages/snapback-contract/index.mjs:929-951,1219-1263,1787,2167-2249`). Consequently, two concurrent single-query surfaces whose results contain the same row can diverge during an optimistic mutation today, even though no individual surface combines multi-query results with optimism.

This changes the factual baseline and the rationale for parking the normalization/overlay-fan-out investigation.

**Resolution criteria:** Either demonstrate and cite an enforced constraint that makes concurrent differing-query legacy surfaces unsupported or impossible, or revise F4 to distinguish within-surface from cross-surface behavior, acknowledge the current multi-surface risk, and base prioritization on a two-surface reproduction or representative workload.

### Major — Fate subscription identity is inconsistently sourced and incomplete

**Evidence:** The provenance and Confidence sections say Fate was not verified against source (`llp/0067-fate-lessons.research.md:46-48,379-381`), while F1 explicitly derives reference-counted identity from upstream `FateClient` source (`llp/0067-fate-lessons.research.md:83-89`). No immutable revision, path, or permalink is provided, falling short of LLP 0001’s recoverable-artifact convention (`llp/0001-prior-art.research.md:25-43`).

Moreover, the entity-plus-selection-plan description covers `subscribeLiveView` but omits Fate’s distinct live-list path. Current source keys entity live views by entity plus selection plan, while live-list views use connection identity, filtered connection arguments, and selection plan; both are reference-counted ([current `FateClient` source](https://github.com/nkzw-tech/fate/blob/main/packages/fate/src/client.ts)). Live lists are particularly relevant to comparison with Snapback named-query subscriptions.

The transport wording is also too broad: the official guide specifies one SSE connection per Fate client for the **native HTTP transport**, not universally for every Fate integration ([Live Views guide](https://fate.technology/guide/live-views)).

**Resolution criteria:** Pin an immutable Fate commit and exact source locations; revise provenance and Confidence to identify the narrow source-verification exception; distinguish entity and live-list logical identities; and qualify the SSE statement as one native-HTTP connection per `FateClient` instance. Alternatively, remove or demote the source-only identity claims.

## 4. Suggestions (non-blocking)

- Replace “self-declared alpha” in the Summary with “conflicting upstream maturity claims” (`llp/0067-fate-lessons.research.md:13,49-53`).

- Add Exact LLP 0179 to `Related`; it is now a normative, load-bearing source.

- Add a direct-entity provenance gate to F4: normalize only manifest-proven table entities. Scalar, joined, projected, or opaque outputs should remain query-local without an explicit entity mapping.

- Consider compiler-derived selections: union statically visible Contract field reads, require summaries or conservative widening at helper/component boundaries, and emit an Exact-owned consumer-usage artifact. This could preserve honesty without duplicating obvious field lists.

- Add an immutable evidence table mapping each Fate mechanism to its guide or pinned source artifact, with section-wide `[observed]` tagging.

## 5. Open questions

- How often do real Contract applications mount concurrent legacy surfaces with overlapping rows, and how long does divergence persist before push reconciliation?

- Is Fate’s entity-live or live-list identity the intended comparison point for each Snapback proposal?

- What measured threshold would justify wire/protocol selection work over masking alone or shared server evaluation?

- Can shared evaluation use the existing authority/query/args key while projection cells use canonical selection hashes, avoiding both duplicated execution and union-selection churn?

- What proof establishes that a result is a canonical entity eligible for normalization or cross-query overlay fan-out?

- How are selections widened across child Contract components and opaque imported helpers without making declarations unsound?

## 6. Readiness verdict

NOT READY

### Orchestrator verification (round 7)

Spot-checked the decisive claims without altering the verbatim body. Confirmed: `packages/snapback-contract/index.mjs:129-133` explicitly documents an app mounting "several Contract surfaces over" one physical store (with the LLP 0059 barrier-participant `@ref`), so two concurrent single-query legacy surfaces with per-boundary optimistic reducers can indeed diverge on a shared row today — the first major's correction of F4's "React-only" scoping is accurate. The second major's internal-inconsistency point (blanket "not verified against source" vs the F1 source-derived claim) was independently flagged by the concurrent Claude-family round-7 review; the live-list identity and native-HTTP-transport qualifications extend it. Disposition: round-8 revision distinguishes within-surface from cross-surface Contract divergence and acknowledges the current multi-surface risk, and demotes the Fate subscription-identity claim to the docs-supported facts with the source-derived nuance clearly marked as an unpinned exception (plus the Summary maturity wording, Exact 0179 in Related, and the two Claude-family round-7 minors).

## Round 8 — 2026-07-20

**Revision under review:** `llp/0067-fate-lessons.research.md`, sha256 `4598815bd4886a0787831b7e9f307afec546859f30955f5a3b85f2208e23794e` (pinned at repo HEAD `4a1024a`)
**Runtime detail:** codex session id 019f8358-363c-7ba3-a59a-7a9ecff2f054, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

MATCH — sha256 `4598815bd4886a0787831b7e9f307afec546859f30955f5a3b85f2208e23794e`

## 1. Overall assessment

This is strong, unusually careful research. Field selection and masking are worthwhile investigations; normalization is correctly treated as a later, authorization-sensitive experiment. The benchmark-first plan, shared-evaluation control, shadow decisions, and Exact/Snapback ownership split form a good plan.

One material safety omission prevents readiness: F2a calls its failure taxonomy complete but omits membership-only visible-to-hidden transitions. A membership deletion or role downgrade can leave previously visible, now-forbidden rows frozen in a client when no authorization-event resnapshot preempts the delta path. That is the most security-sensitive manifestation of the discovered discrepancy and must be included in the finding and repair criteria.

## 2. Strengths

- The provenance is candid and decision-useful (`llp/0067-fate-lessons.research.md:44-65`, `392-406`). It distinguishes public documentation, one unpinned source observation, confirmed repository findings, and inferred recommendations. The conflicting maturity claims are accurately reported by Fate’s current [README](https://github.com/nkzw-tech/fate) and [1.0 announcement](https://fate.technology/posts/fate-1.0).

- F2 correctly separates three possible benefits—affected-subscription rate, payload size, and client work—and identifies proven source-to-output field lineage as the soundness gate (`llp/0067-fate-lessons.research.md:136-171`). It does not mistake UI selection for server execution dependencies.

- The historical fan-out numbers are handled responsibly (`llp/0067-fate-lessons.research.md:110-134`). Commit `37f1a2f` did invalidate both benchmark fixtures as described, no corrected full-scale result is recorded, and stale figures remain in `llp/0000-snapback.explainer.md:214-221`, `llp/0008-local-first-sync-and-realtime.rfc.md:222-231`, and `llp/0035-local-target-benchmarks.research.md:199-258`.

- The live-query architecture is otherwise accurately characterized: named-query subscription granularity, HostPlan-only delta candidacy, ordered/at-cap fallback, and unordered below-cap eligibility (`llp/0067-fate-lessons.research.md:110-112`, `173-185`; `src/local.rs:11055-11061`; `src/live_matcher.rs:619-631`).

- F2b identifies the correct architectural fork (`llp/0067-fate-lessons.research.md:241-257`). Exact’s logical identity is partition, descriptor, compatibility token, and canonical arguments—with no selection—and Snapback’s retained key is query name plus canonical arguments (`../exact/llp/0179-snapback-by-default.rfc.md:558-602`; `packages/snapback-contract/client-store.mjs:48-58`).

- F3’s distinction between masking correctness and update-suppression economics is excellent (`llp/0067-fate-lessons.research.md:268-301`). The five field sets and the Exact/Snapback authority boundary prevent an attractive but unsound “selected fields equal dependencies” shortcut.

- F4 accurately inventories the principal client-state owners and highlights the authorization danger of fragment reuse (`llp/0067-fate-lessons.research.md:303-369`). The Contract mode descriptions, keyed-store refusal, and DK-9 fences are supported by the implementation.

- The recommendations are properly staged (`llp/0067-fate-lessons.research.md:412-454`): repair the safety boundary, correct the corpus, remeasure, compare against shared evaluation, shadow before graduating an optimization, and park normalization.

## 3. Concerns

1. **Major — F2a omits the membership-revocation failure direction.**

   **Evidence:** F2a claims two failure directions and discusses membership-only missed delivery solely as empty-to-visible (`llp/0067-fate-lessons.research.md:207-227`). Membership dependencies deliberately wake in both directions, including deletion and role downgrade (`src/membership_rules.rs:667-745`). The delta evaluator then ignores changes whose table differs from the primary query table (`src/live_matcher.rs:643-650`), returns an empty delta, and settles it as `NoChange` before the debug convergence oracle (`src/local.rs:11289-11297`, `11391-11396`).

   Consequently, in dev or any mode lacking the sessions authorization-event resnapshot, a membership deletion, active-to-pending transition, or role downgrade can leave a previously visible row in the client. This is stale authorization-sensitive disclosure, not merely a missed newly-visible row.

   **Resolution criteria:** Expand F2a, Confidence, Recommendation 2, and the first open question to cover:

   - hidden-to-visible membership insert/upgrade;
   - visible-to-hidden membership delete/downgrade;
   - primary-table Add/Update over-delivery;
   - the relevant dev and sessions-mode behavior.

   Require regression coverage for both membership visibility directions and make revocation preservation an explicit prerequisite for selection work.

2. **Minor — “replayed commits” conflates journal reconstruction with offline mutation replay.**

   **Evidence:** The document says replayed commits carry empty `changed_fields` (`llp/0067-fate-lessons.research.md:155-164`). Specifically, changes reconstructed from `_snapback_changes` receive empty sets (`src/storage.rs:7177-7179`, `7309-7315`). DK-9 queued mutations, however, are re-executed through the normal mutation path after resynchronization (`llp/0043-offline-replay-retention.rfc.md:148-167`) and can produce ordinary changed-field metadata.

   **Resolution criteria:** Replace “replayed commits” with “journal-reconstructed changed-row records,” explicitly distinguishing them from offline mutation replay and reconnect’s fresh snapshot.

3. **Minor — Cross-surface divergence is not always bounded by push.**

   **Evidence:** The document says cross-surface divergence is “bounded by push reconciliation” (`llp/0067-fate-lessons.research.md:320-327`). Legacy single-query mode also supports non-live descriptors (`packages/snapback-contract/index.mjs:957-970`). Only the surface initiating a mutation performs its snapshot reconciliation (`packages/snapback-contract/index.mjs:1845-1862`, `2046-2052`); an overlapping non-live sibling surface has no peer-refresh guarantee.

   **Resolution criteria:** State that live-bound surfaces are bounded by push, while non-live sibling surfaces may remain divergent until independently refreshed or reconciled.

4. **Minor — Several Fate descriptions compress distinct mechanisms too aggressively.**

   **Evidence:** “One batched request-graph” (`llp/0067-fate-lessons.research.md:81-86`) conflates explicit view composition with transport batching. Fate documents that `useRequest` may issue multiple operations and that its native transport batches operations created in the same microtask ([Requests guide](https://fate.technology/guide/requests)). Likewise, F6 frames the contrast primarily as SSE versus WebSocket (`llp/0067-fate-lessons.research.md:381-390`), although Fate documents custom live buses and event IDs ([Live Views guide](https://fate.technology/guide/live-views)).

   **Resolution criteria:** Describe the composed request and transport batch separately; qualify “no query language” as applying to Fate’s view-authoring surface; and compare documented consistency, replay, and mutation-outbox guarantees rather than transport protocols.

5. **Minor — The DK-9 contract is described as though every listed implementation were durable.**

   **Evidence:** The “durable DK-9 client store” paragraph lists both memory and localStorage implementations (`llp/0067-fate-lessons.research.md:330-342`). The memory implementation is explicitly a deterministic reference used to model reloads, whereas localStorage supplies web persistence (`packages/snapback-contract/client-store.mjs:3129-3167`).

   **Resolution criteria:** Call this the “DK-9 client-store contract” and state that durability depends on the backing adapter.

## 4. Suggestions

- Add `[observed]` tags to F1 and the factual portion of F6, matching the convention in `llp/0001-prior-art.research.md:31-43`. The current global provenance is honest, but inline tags would make evidence class easier to audit.

- Prototype selection as a two-level identity: a stable evaluation key plus a canonical projection key. For the union arm, make selection unions monotonic within one subscription generation and shrink only after refcount reaches zero or a new generation begins. That avoids downgrade races while limiting subscription fragmentation.

- Make any normalized identity at least `(provider/authority partition, table, _id)`, not merely `(table, _id)`, with per-field visibility provenance. Exact already treats the partition as security-bearing (`../exact/llp/0179-snapback-by-default.rfc.md:571-583`).

- Pre-register decision thresholds for the experiment: selection should have to beat the shared-evaluation control on a named workload and delivery-inclusive metric before protocol work begins. Oversample revocation and membership changes in the shadow oracle rather than measuring only ordinary updates.

## 5. Open questions

- Should membership-filtered queries be categorically excluded at delta candidacy and defensively rejected again inside `compute_live_delta` until a certified semi-join evaluator exists?

- What regression matrix proves that sessions-mode pre-resnapshot cannot race or miss membership revocation, while dev/no-resnapshot behavior remains correct?

- Which manifest capability certifies source-field-to-output-field lineage, and what conservative class represents opaque Ibex handlers?

- For unioned selections, what are the generation, reconnect, mount/unmount, and downgrade semantics, and which layer owns the canonical selection hash?

- What authority/visibility witness must form part of an online or durable normalized-cache identity, and when must individual fields be evicted?

- What measured affected-subscription rate, payload reduction, or client-work reduction justifies selection over the simpler identical-watcher shared-evaluation control?

## 6. Readiness verdict

NOT READY

### Orchestrator verification (round 8)

Spot-checked the decisive claim without altering the verbatim body. Confirmed: `src/membership_rules.rs:667-674` states in test commentary that "the matcher wakes in BOTH directions," with the hidden-to-visible and (per the acceptance-test block) deletion/downgrade directions both proven at the capture-matcher level — so a membership revocation wakes the subscription, the delta evaluator yields zero ops for the membership-table-only change, and `NoChange` freezes the previously-visible rows: the major's stale-disclosure direction is real and is indeed the most security-sensitive face of F2a. The four minors verify as characterized (journal-reconstruction vs offline-replay distinction per `src/storage.rs:7177-7179` and LLP 0043; non-live sibling surfaces lacking peer refresh; the Requests-guide microtask-batching nuance; the memory client-store being a deterministic reference). The concurrent Claude-family round-8 verdict on this same revision was READY with two citation minors. Disposition: round-9 revision expands F2a to the full three-direction taxonomy (over-delivery; hidden-to-visible freeze; visible-to-hidden freeze = stale authorization-sensitive disclosure) with per-auth-mode conditioning and regression requirements including revocation preservation, and folds in the four minors plus the Claude-family citation nits.

## Round 9 — 2026-07-20

**Revision under review:** `llp/0067-fate-lessons.research.md`, sha256 `390ed005032d0ed2265c630026ecf159689b1365af9f29a26561d552f9cffb89` (pinned at repo HEAD `4a1024a`)
**Runtime detail:** codex session id 019f8365-8b20-7f33-944a-961ac0978af9, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** READY

### Review body (verbatim)

MATCH — `sha256 390ed005032d0ed2265c630026ecf159689b1365af9f29a26561d552f9cffb89`

## 1. Overall assessment

This is a strong Research LLP. Field selection is worth investigating, and the document correctly treats it as a benchmark-first hypothesis rather than a commitment to adopt Fate’s architecture.

The plan is coherent: repair the membership/`live_delta` safety boundary, replace invalid benchmark figures, measure independent effects, use shadow evaluation before permitting suppression, split Exact and Snapback ownership, and keep normalization parked. I found no material correctness, feasibility, safety, or decision-quality flaw in the research. `./ref-check --verbose` passes with zero errors.

## 2. Strengths

- The provenance discipline is unusually good. Fate observations, unpinned source inspection, maturity contradictions, repository confirmations, and inferences are clearly distinguished (`llp/0067-fate-lessons.research.md:44-65,414-428`). The public claims match Fate’s [Views guide](https://fate.technology/guide/views), [Requests guide](https://fate.technology/guide/requests), [Live Views guide](https://fate.technology/guide/live-views), [1.0 announcement](https://fate.technology/posts/fate-1.0), and [README](https://github.com/nkzw-tech/fate). The conflicting production-readiness statements are represented honestly.
- F2 correctly separates affected-subscription rate, payload size, and client-update work instead of treating “field selection” as one undifferentiated optimization (`llp/0067-fate-lessons.research.md:137-174`). The field-lineage restriction is essential and correct.
- The benchmark correction is accurate and appropriately consequential (`llp/0067-fate-lessons.research.md:111-135`). Commit `37f1a2f` changed the fallback fixture to a fixed 16-row set and corrected the delta fixture from one matching subscriber divided by all subscribers to every measured subscriber matching (`src/bench.rs:403-435,518-560`). LLP 0035 records no replacement full-scale result (`llp/0035-local-target-benchmarks.research.md:52-90`).
- F2a is a real, reachable safety discrepancy, precisely characterized (`llp/0067-fate-lessons.research.md:190-256`). Delta candidacy does not exclude `membership_filters` (`src/local.rs:11055-11061`), classification evaluates only ordinary filters (`src/live_matcher.rs:286-297,613-715`), empty membership-only deltas become `NoChange` before the convergence assertion (`src/local.rs:11289-11297,11391-11396`), and Shindig contains an unordered membership-gated query (`demos/shindig/snapback/generated/functions.manifest.json:68-99`). The three failure directions and sessions-mode qualification are correct.
- The Contract analysis is well grounded. Exact’s logical key omits selection, Contract dependencies are explicit but query-granular, and masking alone would not suppress binding publication (`../exact/llp/0179-snapback-by-default.rfc.md:558-602`; `../exact/llp/0263-contract-data-bindings-for-snapback-and-backends.rfc.md:232-286,1282-1317`).
- F4 avoids importing Relay normalization wholesale. It identifies the actual state owners, the authorization hazard, and the cheaper overlay-fan-out alternative (`llp/0067-fate-lessons.research.md:321-391`). Keeping normalization parked is the right decision.

## 3. Concerns

No major concerns. The following are minor, non-blocking precision issues.

1. **Minor — two F2a statements are overly absolute.**

   - Evidence: “the only authorization guard” (`llp/0067-fate-lessons.research.md:201-205`) overlooks outer retained-authority revalidation (`src/local.rs:11066-11078`). “Membership writes classify as authorization events” (`llp/0067-fate-lessons.research.md:237-244`) has an intentional exception for known updates confined to declared incidental fields (`src/storage/authorization.rs:109-126`; `llp/0056-scoped-roles-and-memberships.rfc.md:1183-1191`). Neither exception weakens the identified failure.
   - Resolution criterion: say “the only result-shrink/obligation guard inside `try_live_delta_fanout`” and “authorization-relevant membership inserts, deletes, and role transitions.”

2. **Minor — multi-live freshness is not always push-owned.**

   - Evidence: F4 says legacy multi-live freshness “is owned by the push” (`llp/0067-fate-lessons.research.md:330-346`), but `livePush:false` performs initial snapshots and post-mutation reconciliation (`packages/snapback-contract/index.mjs:4322-4345,4366-4381,4409-4422`).
   - Resolution criterion: qualify the statement as applying to the default push mode and mention poll/reconcile mode.

3. **Minor — single-query durable custody is capability-gated.**

   - Evidence: “accepts a `clientStore` for full retained-rows/outbox custody” (`llp/0067-fate-lessons.research.md:358-364`) can imply that passing a store is sufficient. Retention also requires a live descriptor, `offlineReplay`, complete retained identity, and additional replayability conditions for the outbox (`packages/snapback-contract/index.mjs:977-1017`).
   - Resolution criterion: change “accepts … for full custody” to “can use … for custody when its retention/replay eligibility gates pass.”

4. **Minor — issue status is internally ambiguous.**

   - Evidence: F2a refers to “the filed issue” (`llp/0067-fate-lessons.research.md:234,243`) but later says the discrepancy is “flagged for filing” and recommends filing it (`llp/0067-fate-lessons.research.md:246-248,442-445`).
   - Resolution criterion: either include the actual issue key/link or consistently call it the future issue.

## 4. Suggestions

- Pin the upstream Fate commit or tag used for the client-identity inspection. The current unpinned provenance is honest, but a blob-level reference would make F1 reproducible.
- For the immediate F2a repair, fail closed whenever `membership_filters` is nonempty and add a belt-and-suspenders assertion at delta candidacy. Re-enable incremental membership deltas only behind an explicit proof capability and bidirectional visibility tests.
- Prototype the selection-identity question as two layers: preserve the existing authorization-scoped evaluation key, then key projection cells by canonical selection hash. This could share one evaluation while avoiding mutable union-selection churn.
- Treat field lineage as a versioned proof artifact containing the five field sets from F3. Opaque handlers would receive only post-requery projection/equality suppression; only proven direct plans could skip execution.
- Extend Recommendation 1 beyond numeric corrections: governing prose that treats ordinary HostPlan filters as “the whole query” should explicitly exclude membership-gated plans.
- Keep normalization out of the active roadmap until a demo measures meaningful cross-query optimistic divergence.

## 5. Open questions

- Should the first safety repair categorically exclude all membership-gated plans from `live_delta`, or is any smaller safe subset already provable?
- Are Contract selections static per compiled artifact, or can runtime mounting change them? This strongly affects key fragmentation and union churn.
- What canonical representation and compatibility token should identify nested selections, aliases, optional fields, and JSON-valued fields?
- Which HostPlan classes can emit a sound source-to-output field-lineage certificate?
- How much benefit remains after mandatory identity and reconciliation fields—especially `_version`—are included?
- On realistic screens, does field-aware invalidation outperform shared evaluation of identical query/args/authority cohorts?
- Which client owner should receive the first experiment, given that strategic keyed Contract currently rejects durable client-store custody?
- Can Exact’s verifier conservatively handle imported helpers and dynamic property access without making selection declarations so broad that masking loses value?

## 6. Readiness verdict

READY

### Orchestrator verification (round 9)

Both reviewer families independently marked this same pinned revision (`390ed005…`) READY — the GPT family with no major concerns for the first time in nine rounds, the Claude family for the fifth consecutive round — and the orchestrator's factual checks across the loop surfaced no unresolved material defect. **The loop converges here for LLP 0067.** Non-blocking residue recorded across the two round-9 reviews: the four GPT-family precision minors (guard/authorization-event absolutes, multi-live poll mode, custody gating, issue-status wording), the Claude family's citation-weight notes (DK-9 fence keying per LLP 0043; the 0037/0021 attribution), and both families' suggestions — most importantly that the F2a issue be filed promptly (after a search-Linear dedup check, per the fleet convention) with the Shindig `eventDetails` regression fixture and bidirectional membership-visibility tests, and that Recommendation 1's corpus reconciliation land as a docs-only pass. Per the /llp-super-refine authorization, the document's status advances Draft → Review; the residue travels with the filings rather than re-opening the loop.
