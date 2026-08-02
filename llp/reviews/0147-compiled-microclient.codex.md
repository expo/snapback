# LLP 0147 compiled microclient review — Codex family


## Round 1 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-01
**Method:** fresh non-author `codex exec` context, read-only sandbox over the
working tree; mutually blind — instructed not to read any `llp/reviews/`
artifact concerning LLP 0147, and verified after the fact not to have done so
(the only mention of that path in its 18,912-line transcript is its own
statement of intent to exclude it, at transcript line 176). SHA-pinned target
and instruction capsule.
**Instruction capsule SHA-256:** `d05c9bca226b508106b9571aac0c9e2e813b4cc5355a6fe59a1508296ae1cf8d`
**Target:** `llp/0147-compiled-microclient.rfc.md` (828 lines, Draft)
**Target SHA-256:** `2156eca984980d2614d2ba2796fb25e2f4f87498bb6f72edae276ba312b5726a`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

The proposal is directionally strong, but this revision is **NOT READY**.

The Full/Micro split is justified by the measured bundle closure, and the ahead-of-time wrapper over an `unknown`-returning transport is a clean architecture. The asymmetric trust split is also sound in principle—but only if every client-bound application payload crosses an authoritative server-validation boundary.

Two load-bearing claims are false in the current implementation:

1. Retained mutation-settlement recovery can acknowledge mutations and create a receipt before checking `expectedGeneration`.
2. Local `live_delta` fan-out publishes storage-derived rows without result-contract validation.

These are not implementation-detail omissions. They invalidate D3/D4 safety claims and gates 11/12, and the settlement case requires resolving a conflict between generation binding and existing durable-settlement semantics.

I verified the requested target SHA, branch, HEAD, and read all 828 lines. I did not inspect any LLP 0147 review artifact.

## 2. Strengths

- **Verified:** The 70.1 kB gzip premise is accurately reported from LLP 0145. LLP 0145 identifies the measurement as reproducible but not yet backed by committed fixture sources ([LLP 0145:240](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:240), [LLP 0145:265](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:265)); its journal records five reproductions within 0.1 kB ([0145 journal:62](/Users/ccheever/projects/snapback/llp/reviews/0145-client-bundle-architecture.super-refine.md:62)). I verified the recorded evidence rather than independently rerunning the uncommitted fixture.

- **Verified:** D1 chooses the correct additive packaging boundary. `./online` already exports the same `SnapbackClient` implementation ([package.json:46](/Users/ccheever/projects/snapback/packages/snapback-client/package.json:46), [online.mjs:8](/Users/ccheever/projects/snapback/packages/snapback-client/online.mjs:8)); narrowing it would be breaking.

- **Verified:** Generated references carry the full five-field generation object, and the client repeats it on all five requested families. Codegen installs it on references ([index.mjs:6708](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:6708)); the client test exercises query, action, mutation, authorized lease, and live subscribe and compares all five bodies ([package.test.mjs:231](/Users/ccheever/projects/snapback/packages/snapback-client/package.test.mjs:231), [package.test.mjs:282](/Users/ccheever/projects/snapback/packages/snapback-client/package.test.mjs:282)).

- **Verified:** Fresh query, mutation, and action ingress validation is correctly placed before execution. Query validation is at [src/local.rs:22403](/Users/ccheever/projects/snapback/src/local.rs:22403); mutation result validation precedes commit at [src/local.rs:11065](/Users/ccheever/projects/snapback/src/local.rs:11065) and [src/local.rs:11118](/Users/ccheever/projects/snapback/src/local.rs:11118); action ingress and egress are at [src/local.rs:17927](/Users/ccheever/projects/snapback/src/local.rs:17927) and [src/local.rs:17969](/Users/ccheever/projects/snapback/src/local.rs:17969). A fresh mutation result-contract failure therefore does roll back rather than commit, matching LLP 0108 ([LLP 0108:446](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:446)).

- **Verified:** The ordinary generation mismatch uses `SNAPBACK_ARTIFACT_IDENTITY_MISMATCH`, `subcause: "generation"`, and server-derived active facts ([src/local.rs:188](/Users/ccheever/projects/snapback/src/local.rs:188), [src/local.rs:194](/Users/ccheever/projects/snapback/src/local.rs:194), [src/local.rs:150](/Users/ccheever/projects/snapback/src/local.rs:150)). Success responses obtain facts from active manifests, including mutation responses at [src/server.rs:18838](/Users/ccheever/projects/snapback/src/server.rs:18838).

- **Verified:** Dev mode deliberately ignores `expectedGeneration` ([src/local.rs:176](/Users/ccheever/projects/snapback/src/local.rs:176)). LLP 0147 correctly incorporates the former OQ23 resolution: obligations are sessions-only ([LLP 0053:329](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:329)), while sessions clients cannot branch on generated `authorityIndependent` and must always offer `auth/live` ([LLP 0096:223](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:223), [LLP 0147:447](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:447)).

- **Verified:** The current Cloudflare arm has only dev auth and no sessions surface ([capability manifest:8](/Users/ccheever/projects/snapback/cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json:8), [LLP 0096:471](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:471)). D7 is correct that hosted Micro is not presently a product target.

- **Inferred design judgment:** The conservative module predicates in D5 are coherent at RFC altitude. I found no conditional module that is obviously required in a posture where it is omitted. Keeping `auth-obligation` for every sessions+live Micro composition is intentionally conservative and consistent with D7. The claim that `authority-fence` is always irreducible remains a design policy awaiting empirical attribution, not a contradicted fact.

- **Verified feasibility:** D2 requires new generation work but does name it. Current general references still contain `argumentSchema` ([codegen index.mjs:6720](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:6720)); Phase B explicitly commissions a separate profile artifact and compact runtime entry ([LLP 0147:632](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:632)). Nothing found makes the proposed omission of schemas/manifests/registries infeasible.

- **Verified citations:** Every LLP number in the Related header exists and the document’s relative links resolve. Body citations to LLP 0010 and LLP 0127 are also real, although they are omitted from the Related header.

## 3. Findings

### BLOCKING 1 — Retained mutation recovery violates D4’s generation-before-acknowledgement contract

**Defect:** A stale sessions request can recover a retained mutation settlement, acknowledge mutation IDs, and create a receipt before `expectedGeneration` is compared.

**Evidence:** The retained-settlement fast path deliberately precedes active function selection ([src/local.rs:10928](/Users/ccheever/projects/snapback/src/local.rs:10928)). On a cache hit it acknowledges supplied mutation IDs at [src/local.rs:10949](/Users/ccheever/projects/snapback/src/local.rs:10949), constructs and records the receipt at [src/local.rs:10956](/Users/ccheever/projects/snapback/src/local.rs:10956), and returns at line 10977. Function selection and generation validation occur only afterward on the cache-miss path ([src/local.rs:10983](/Users/ccheever/projects/snapback/src/local.rs:10983)).

That contradicts Motivation and D4 ([LLP 0147:110](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:110), [LLP 0147:328](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:328)) and gate 12 ([LLP 0147:708](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:708)).

It also exposes a genuine design conflict: LLP 0108 explicitly makes acknowledgement tuple-independent so stale clients can reclaim delivered historical settlements ([LLP 0108:464](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:464)). Simply moving the generation check earlier could strand settlements and validators.

**Why it matters:** Atomic generation refusal is one of the four defining “compiled-safe” properties and the reason product graduation waits for sessions. Gate 12 is unsatisfiable under the current governing semantics unless the RFC defines which invariant wins.

**Resolution criteria:**

- Decide whether historical settlement recovery is outside D4’s fresh-operation generation rule or whether generation refusal overrides it.
- If recovery wins, narrow D4 and gate 12 explicitly and define the generation/facts returned with historical settlement replay.
- If generation wins, amend LLP 0108/0043 and prove old clients can still acknowledge and garbage-collect settlements.
- Add rollout tests covering stale generation plus duplicate `clientMutationId`, piggyback acknowledgements, removed functions, and old/new contract tuples.

### BLOCKING 2 — `live_delta` bypasses the server result-contract seam

**Defect:** The local server can publish application rows in `live_delta` frames without passing those rows through `validate_handler_result`.

**Evidence:** Fresh query output is validated at [src/local.rs:23055](/Users/ccheever/projects/snapback/src/local.rs:23055). In contrast, `try_live_delta_fanout` computes operations from committed `ChangedRow` values ([src/local.rs:19525](/Users/ccheever/projects/snapback/src/local.rs:19525)), copies raw rows into wire operations ([src/local.rs:19551](/Users/ccheever/projects/snapback/src/local.rs:19551)), and serializes the frame ([src/local.rs:19594](/Users/ccheever/projects/snapback/src/local.rs:19594)) without result validation.

This is reachable with a contract stricter than the table schema because an authored `records` contract takes precedence over the HostPlan query’s default document contract ([result-contracts.mjs:577](/Users/ccheever/projects/snapback/packages/snapback-codegen/result-contracts.mjs:577), [result-contracts.mjs:594](/Users/ccheever/projects/snapback/packages/snapback-codegen/result-contracts.mjs:594)).

**Why it matters:** A valid initial snapshot can be followed by an add/update that violates the declared result contract. The generated wrapper would then publish a value outside its precise type and could expose fields excluded from the declared result shape. This directly refutes D3’s universal server-egress premise and gate 11.

**Resolution criteria:**

- Establish one universal client-publication egress seam covering initial snapshots, replacements, deltas, and any retained/cached/resume publication used by a qualifying target.
- For deltas, either validate the effective post-delta result or prove an equivalent per-operation validation rule against the selected result contract.
- Add a gate that begins with a valid narrow/closed-contract snapshot, commits an otherwise schema-valid row change that violates that result contract, and proves no delta or replacement is published.
- Until that gate passes, Micro must either retain payload validation or disable the delta path and use validated replacements.

### MATERIAL 1 — Target capability exclusion is claimed but not closed over current arms

**Defect:** D3 promises fail-closed profile admission when a target lacks ingress/egress capabilities, but the compile-failure list and graduation gates do not establish that rule, and the current Cloudflare target silently skips those unknown required capabilities.

**Evidence:** D3 requires admission refusal at [LLP 0147:312](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:312), but the failure inventory at [LLP 0147:509](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:509) does not name missing `args_contract_v1`/`result_contract_v1` target support.

Cloudflare advertises only `live_subscriptions` ([capability manifest:17](/Users/ccheever/projects/snapback/cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json:17)). Its runtime ignores required capability IDs absent from its closed registry ([coordinator.js:982](/Users/ccheever/projects/snapback/cloudflare/src/coordinator.js:982)); its mutation path commits and publishes `result.value` without result validation ([coordinator.js:4563](/Users/ccheever/projects/snapback/cloudflare/src/coordinator.js:4563)). The open fan-out issue independently demonstrates that this arm is not yet a universal live authority ([issue:9](/Users/ccheever/projects/snapback/issues/20260801-cloudflare-live-fanout-uses-declared-tables.md:9)).

**Why it matters:** Cloudflare is correctly excluded from the immediate product target, so this is not a third central blocker. But target selection is an RFC-owned compiler decision; relying on prose saying “not current” is weaker than the claimed fail-closed profile contract.

**Resolution criteria:** Add a stable generation failure and negative gate for a target lacking either contract capability, and state explicitly that current Cloudflare is excluded both for lack of sessions and lack of qualified ingress/egress seams.

### MATERIAL 2 — Retry/idempotency policy has no authoritative source

**Defect:** The RFC says mutation/action descriptors carry an explicit retry class, including an `idempotent` class backed by a declared mechanism, but never specifies where that declaration comes from or binds it into the profile.

**Evidence:** Retry behavior is normatively decided at [LLP 0147:544](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:544). Yet selected-operation requirements omit retry metadata ([LLP 0147:222](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:222)), the profile artifact’s operation record omits it ([LLP 0147:490](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:490)), the compile failures omit absent/invalid idempotency declarations, and current generated references have no retry class ([codegen index.mjs:6708](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:6708)).

**Why it matters:** Retrying an effectful request after transport ambiguity is safety policy, not descriptor spelling. The compiler cannot safely infer it, and the RFC correctly forbids inference—but currently supplies no other authority.

**Resolution criteria:** Either make all Micro v1 mutations/actions `nonIdempotent` and remove the `idempotent` branch, or define the authoritative declaration, accepted mechanisms, request identity, profile/digest binding, compile-time diagnostic, and ambiguity tests.

### DETAIL 1 — D4’s normative enumeration drops authorized-lease queries

**Defect:** Motivation correctly names five generation-bound request families, but D4’s normative “Every generated…” sentence names only query, mutation, action, and live subscribe.

**Evidence:** Compare [LLP 0147:106](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:106) with [LLP 0147:324](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:324). The implementation does carry it ([client index.mjs:5088](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5088)).

**Why it matters:** It creates avoidable ambiguity in D4 and gate 12, but does not reflect a defective architectural decision.

**Resolution criterion:** Name authorized-lease query explicitly in D4 and the generation acceptance matrix.

### DETAIL 2 — The gates do not explicitly prove Micro’s response-envelope boundary

**Defect:** D3 depends on Micro validating generic response envelopes before projecting `unknown` to an exact result, but no gate explicitly injects malformed or over-budget query/mutation/action response envelopes.

**Evidence:** The required checks are listed at [LLP 0147:292](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:292), and their exact minimum remains OQ8 ([LLP 0147:811](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:811)). Gates 14 and 16 are too general to unambiguously cover wrong-kind envelopes, malformed diagnostics, or oversized JSON. LLP 0095’s result-contract section covers rejected handler results, not arbitrary request/response envelope corruption ([LLP 0095:583](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:583)).

**Why it matters:** This is the client’s final check before an opaque value is published as the generated type.

**Resolution criterion:** Clarify an existing gate or add a compact adversarial-envelope gate covering non-JSON/over-budget input, wrong response kind, invalid diagnostic shape, and invalid version/cursor/live discriminants. This is specification detail, not a MATERIAL RFC-altitude defect.

## 4. Suggestions

These are non-blocking:

- Rename D3’s “Handler egress” boundary to **client-publication egress**. That phrasing naturally includes synthesized delta frames, caches, and retained publications.
- Add a compact D1–D7-to-gates matrix. It would make omissions visible while displacing repeated prose and respecting the approximately 20% growth budget.
- Add LLP 0010 and LLP 0127 to the Related header, since the body relies on both.
- Preserve LLP 0145’s measurement wording: 70.1 kB is well-reproduced recorded evidence, but Phase A still needs to create the committed measurement receipt.
- Keep additions surgical. At 828 lines, new safety material should replace redundant explanation rather than accumulate into a follow-on Spec inside this RFC.

## 5. Open questions the document must answer

1. Does whole-generation refusal apply to historical settlement recovery and acknowledgement, or only to fresh operation admission?
2. What exact server seam guarantees that every delta, replacement, cached, retained, or resumed application payload satisfies the effective result contract?
3. What is the authoritative source of mutation/action retry class, and what concrete mechanism is sufficient to declare an operation idempotent?
4. Which target capabilities qualify a Micro profile, and where is fail-closed target admission enforced and tested?
5. Which response-envelope checks must complete before `unknown` is projected to a generated result type, and which gate proves each check?

The existing questions about profile syntax, export shape, carrier class, size ceilings, Metro/Hermes, and eventual per-operation generation identity are appropriate. OQ8 is also appropriate, but it needs an explicit graduation-gate connection.

## 6. Readiness verdict

**NOT READY**

The architecture is promising and worth pursuing, but the retained-settlement generation conflict and unvalidated `live_delta` path are unresolved blockers. The target-admission and retry-policy gaps are additional material issues that should be resolved before this RFC reaches READY.
## Orchestrator verification (outside the verbatim body)

Spot-checked independently before applying:

- **BLOCKING 1 CONFIRMED** (`src/local.rs:10933-10981`), and found independently by
  the author pass and by the Fable family (its F1). One correction to the framing:
  the LLP 0108 passage cited as the conflicting authority (`llp/0108:449-469`,
  `ExpectedOperationV1` retained-settlement replay) is **exactly the slice LLP 0108
  §B removed** — "`ExpectedOperationV1` … removed from this implementation slice"
  and "Existing mutation settlement identity, lookup order, acknowledgement,
  retention, replay, and garbage collection remain exactly as governed by LLP 0043"
  (`llp/0108:700-712`), which §"Final author reconciliation" declares normative and
  superseding. `ExpectedOperationV1` and `SNAPBACK_MUTATION_RESULT_CONTRACT_STALE`
  have zero implementations in the tree. So there is no live spec conflict to
  adjudicate: LLP 0043 already governs, and the RFC's job is to say so. The
  resolution is narrower than "amend 0108/0043."
- **BLOCKING 2 CONFIRMED**, and found independently by the author pass.
  `try_live_delta_fanout` copies storage rows straight into the wire frame
  (`row: op.row.clone()`, `src/local.rs:19551-19562`) and serializes at `:19594`
  with no `validate_handler_result` anywhere in `:19497-19684`. The reachability
  argument holds: `effectiveResultContract` returns the authored contract before
  reaching the HostPlan default (`packages/snapback-codegen/result-contracts.mjs:594-596`).
  This is a **code/spec divergence, not only an RFC defect**: LLP 0108:440-443
  requires that "Query and live-query output is validated before snapshot/live
  publication, cache insertion, or transport serialization." Filed as
  `issues/20260801-live-delta-frames-bypass-result-contract-validation.md`.
- **MATERIAL 1, MATERIAL 2, DETAIL 1, DETAIL 2 CONFIRMED** as stated.
- The Fable family, blind to this review, reached NOT READY on the same
  settlement-replay defect (F1) and independently found a fabricated diagnostic
  code (`SNAPBACK_CAPABILITY_UNAVAILABLE`) that this review did not.


## Round 2 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-01
**Method:** fresh non-author `codex exec` context, read-only sandbox over the
working tree; delta-scoped — permitted to read this artifact's round-1 section
(own family) and instructed not to read the fable artifact or the super-refine
journal. Verified after the fact: the only occurrences of the fable path in the
17,072-line transcript are the capsule's own prohibition text and the target's
Revised header; the reviewer states it did not open the journal.
**Instruction capsule SHA-256:** `bc89a587ce0ba8368225dc95379b838cdb424c6e35632bdee1602a5c946924a4`
**Target:** `llp/0147-compiled-microclient.rfc.md` (v0.2, 970 lines, Draft)
**Target SHA-256:** `4380d0f338321b878a98c3a6aa91f120788d53cc8c5364670f8ba77e17ab496c`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

**NOT READY.** The ahead-of-time Micro profile remains a good idea, and v0.2 substantially improves the proposal. The delta-validation defect is now handled appropriately at RFC altitude: it is stated honestly, assigned to Phase B, and made a red graduation precondition. Likewise, omitting `clientMutationId` is a coherent conservative v1 decision.

However, v0.2 introduces one blocking authority error and two material gate contradictions:

- D4 incorrectly claims that no specification conflict remains, overlooking LLP 0012’s unconditional settlement ordering.
- Gate 11a rules out a delta-gap solution that D3 and OQ10 explicitly leave open.
- Gate 15a contradicts LLP 0095’s required handling of unknown live-frame kinds.

I verified the requested SHA, 970-line length, branch, and HEAD. I read only the Codex-family round-1 review. A super-refine journal now appears in the working tree, but I did not open or inspect it. No repository files were edited.

## 2. Strengths

### Verified

- The architectural premise is supported by LLP 0145’s measured 70.1 kB gzip closure and its recommendation for a generated, capability-selected client beside the compatibility client. The RFC preserves Full and adds Micro rather than changing existing semantics. [LLP 0145:140–173](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:140), [LLP 0147:36–79](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:36)

- D3 now accurately describes the shipped delta defect. The full query path validates the complete result before handoff, while `try_live_delta_fanout` copies storage rows directly into `LiveDelta` operations and serializes them without result-contract validation. [src/local.rs:23055–23060](/Users/ccheever/projects/snapback/src/local.rs:23055), [src/local.rs:19551–19600](/Users/ccheever/projects/snapback/src/local.rs:19551), [LLP 0147:317–329](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:317)

- Treating that defect as a Phase B prerequisite is sufficient for a Draft RFC. The proposal is not claiming the lane is already safe, and gate 11a is explicitly red. [LLP 0147:719–732](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:719), [LLP 0147:813–821](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:813)

- The stated reading of LLP 0108 §B is correct as far as LLP 0108 goes: it removed `ExpectedOperationV1` and left settlement identity, lookup order, ACK, retention, replay, and GC governed by LLP 0043. [LLP 0108:701–717](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:701)

- The description of the shipped settlement route is exact. A settlement hit returns and records a receipt before active-function selection or `expectedGeneration` comparison; that comparison occurs only after a miss. [src/local.rs:10933–10984](/Users/ccheever/projects/snapback/src/local.rs:10933)

- “Micro v1 carries no `clientMutationId`” is feasible. The field is optional on the wire, and the current client emits it only when supplied. [src/manifest.rs:5674–5703](/Users/ccheever/projects/snapback/src/manifest.rs:5674), [packages/snapback-client/index.mjs:5601–5632](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5601)

- The correction to `SNAPBACK_CAPABILITY_UNSUPPORTED` is accurate, and the Cloudflare target currently advertises only `live_subscriptions` with dev auth. [LLP 0012:640](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:640), [Cloudflare capability manifest:8–19](/Users/ccheever/projects/snapback/cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json:8)

- “Fresh admission” has been propagated consistently through Motivation, D4, and gate 12. Authorized-lease queries are also restored to D4’s enumeration. [LLP 0147:118–138](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:118), [LLP 0147:366–404](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:366), [LLP 0147:826–834](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:826)

- Gate 11b is demanding but satisfiable. For example, the RQS resume-delta route builds operations from the current query output, which has already crossed `execute_query_invocation`’s complete result validator; this is different from the unsafe storage-derived fanout path. [src/local.rs:13378–13398](/Users/ccheever/projects/snapback/src/local.rs:13378), [src/local.rs:12379–12425](/Users/ccheever/projects/snapback/src/local.rs:12379), [src/local.rs:23055–23060](/Users/ccheever/projects/snapback/src/local.rs:23055)

### Inferred design judgment

- Omitting settlement and automatic mutation retry is the right default for a first measured Micro profile. It gives up ambiguity recovery, but it avoids importing an outbox/custody protocol whose semantics dominate the supposedly minimal client. D4 and D6 mostly price that tradeoff honestly. [LLP 0147:396–404](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:396), [LLP 0147:469–501](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:469)

- The server-trust decision in D3 is reasonable for a first-party authoritative backend once every reachable publication path is proved. Keeping Full as the defense-in-depth alternative makes the choice proportionate rather than universal. [LLP 0147:338–364](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:338), [LLP 0147:890–903](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:890)

## 3. Findings

### 1. BLOCKING — v0.2 regression: D4’s “no conflict” authority claim is false

**Defect:** LLP 0108 leaves settlement replay to LLP 0043, but LLP 0012 still unconditionally requires function selection and generation comparison before acknowledgement or receipt; therefore D4 cannot truthfully say there is “no conflict to adjudicate.”

**Evidence:** D4 makes that claim at [LLP 0147:381–394](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:381). LLP 0012 says selection runs first and mismatch refuses before acknowledgement or receipt at [LLP 0012:871–884](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:871). LLP 0043 instead explicitly performs settlement lookup before active mutation-function selection at [LLP 0043:286–297](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:286), matching the shipped code at [src/local.rs:10933–10984](/Users/ccheever/projects/snapback/src/local.rs:10933). Even the current request-envelope comment still states the LLP 0012 ordering unconditionally. [src/manifest.rs:5681–5683](/Users/ccheever/projects/snapback/src/manifest.rs:5681)

**Why it matters:** D4’s central claim is that Micro safely reuses an existing ratified generation-binding contract. That contract currently disagrees with both LLP 0043 and the implementation. Micro v1 makes the path unreachable, but the RFC’s authority explanation and future settlement guidance remain factually wrong.

**Resolution criteria:** Replace the “no conflict” paragraph with an explicit reconciliation and amend LLP 0012’s call-time generation section so its ordering applies to fresh admission. The amendment should preserve LLP 0043’s settlement-first behavior and state replay behavior for generation facts and removed functions. This can replace the current authority paragraph without growing the RFC.

### 2. MATERIAL — v0.2 regression: gate 11a contradicts D3 and OQ10

**Defect:** D3 and OQ10 permit disabling deltas for narrowed contracts in favor of validated replacements, but gate 11a requires a valid narrowed-contract change to “still delta.”

**Evidence:** D3 permits validation “or” refusal in favor of replacement at [LLP 0147:326–329](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:326). OQ10 retains replacement fallback as option three at [LLP 0147:951–957](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:951). Gate 11a nevertheless requires the symmetric valid case to delta at [LLP 0147:813–821](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:813). The linked issue repeats the same contradiction between candidate fix three and its acceptance test. [issue:91–117](/Users/ccheever/projects/snapback/issues/20260801-live-delta-frames-bypass-result-contract-validation.md:91)

**Why it matters:** Phase B cannot choose one of the RFC’s expressly permitted fixes and still graduate. This is a defective decision/gate composition, not missing implementation detail.

**Resolution criteria:** Decide whether preserving deltas for narrowed contracts is mandatory:

- If fallback remains allowed, rewrite gate 11a’s positive half to require a correct validated delta **or an explicitly measured replacement fallback**.
- If delta preservation is mandatory, remove the fallback language from D3 and OQ10.

This should rewrite the existing gate and OQ text rather than add another gate.

### 3. MATERIAL — v0.2 regression: gate 15a conflicts with LLP 0095 forward compatibility

**Defect:** As written, gate 15a requires invalid live-frame discriminants to produce a structured error, while gate 16 imports LLP 0095’s rule that unknown frame kinds must be skipped without becoming fatal.

**Evidence:** Gate 15a appears at [LLP 0147:842–847](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:842), and gate 16 requires every routed LLP 0095 fixture at [LLP 0147:849–852](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:849). LLP 0095 requires unknown envelope kinds to be skipped at [LLP 0095:315–320](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:315). Its exact fixture expects only `ignore_frame` for an unknown `kind` at [schemas/live.wire-fixtures.v1.json:2444–2484](/Users/ccheever/projects/snapback/schemas/live.wire-fixtures.v1.json:2444).

**Why it matters:** The same Micro implementation cannot satisfy both gates under the ordinary meaning of an invalid discriminant. Treating unknown kinds as errors would also regress protocol evolution.

**Resolution criteria:** Replace “invalid … live-frame discriminants” with a narrower phrase such as “malformed discriminants or malformed payloads for known frame kinds,” and explicitly leave unknown kinds to LLP 0095’s skip rule. This is a replacement, not an addition.

### 4. DETAIL — v0.2 regression: the “explicit retry class” was not propagated into the generated contract

**Defect:** The runtime section says descriptors carry an explicit retry class, but D2’s descriptor, generated example, and `microProfile.v1.selectedOperations[]` contain no such field.

**Evidence:** The claim is at [LLP 0147:624–640](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:624); the conceptual descriptors contain only `kind` and `name` at [LLP 0147:266–285](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:266), and the profile artifact enumerates operation identity and contract hashes but not retry class at [LLP 0147:558–580](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:558).

**Why it matters:** It leaves unclear whether retry policy is an attested generated input or merely derived from operation kind. V1’s two classes are otherwise coherent.

**Resolution criteria:** Prefer replacing “descriptors carry an explicit retry class” with “retry policy is derived from the closed operation kind in v1.” Alternatively, add the field consistently to D2 and the profile artifact while deleting equivalent explanatory prose elsewhere.

### 5. DETAIL — v0.2 regression: future settlement gate 12 conflicts with D6’s generation-mismatch policy

**Defect:** The future settlement fixture expects original output plus current generation facts after rotation, but D6 says any success whose facts differ from the request generation publishes nothing.

**Evidence:** D6’s rule is at [LLP 0147:489–496](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:489); the future fixture is at [LLP 0147:831–834](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:831). The current server does in fact fetch current facts after returning a settlement. [src/server.rs:18838–18851](/Users/ccheever/projects/snapback/src/server.rs:18838)

**Why it matters:** This is outside Micro v1, but it leaves contradictory guidance for the successor composition that adopts LLP 0043.

**Resolution criteria:** Either say gate 12 is testing the raw server response and D6 still suppresses client publication, or define a future replay-aware exception to D6. The cleanest v1 treatment may be to remove this speculative future fixture and leave it to the measured successor RFC.

### 6. DETAIL — v0.2 regression: Related omits newly load-bearing LLP 0090

**Defect:** OQ10 relies on LLP 0090 D1’s changed-row economy, but LLP 0090 is absent from `Related`.

**Evidence:** [LLP 0147:31–34](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:31), [LLP 0147:951–957](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:951)

**Resolution criteria:** Add LLP 0090 to `Related`, displacing the redundant sentence that the linked ticket contains the same three options and costs.

## 4. Suggestions

These are non-blocking.

- **Mechanical publication witness:** Instead of relying permanently on route enumeration alone, introduce an opaque server-side `ValidatedPublication` or equivalent proof object. Client-bound application publication functions would accept only that type; full results create it through result-contract validation, and delta paths create a constrained element-validation witness. This would make future seam bypasses harder to introduce.

- **Decision-to-gate matrix:** Replace some repeated prose in Consequences and Ratification with a compact D1–D7 → phase → gate mapping. The three v0.2 regressions are precisely failures to propagate one decision into its gate.

- **State the manual-retry cost plainly:** Replace one repeated paragraph about absent idempotency with one sentence saying that after an indeterminate mutation, a user-initiated second invocation may duplicate the effect. The current policy implies this, but application authors should not need to infer it.

## 5. Open questions the document must answer

1. Which document normatively owns the ordering between LLP 0012 generation binding and LLP 0043 settlement recovery, and what exact amendment reconciles them?
2. Is delta preservation for narrowed result contracts mandatory, or is a deliberate validated-replacement fallback acceptable?
3. Which live-frame discriminant failures are fatal, and which are forward-compatible unknown kinds that must be skipped?
4. Is v1 retry policy an explicit generated/artifact field or a closed derivation from operation kind?
5. If a later Micro composition adopts settlement replay, does an active-generation mismatch suppress the recovered output or become an explicit replay exception?

## 6. Explicit readiness verdict

**NOT READY.**

The core proposal is strong and close, but the LLP 0012/0043 authority conflict and the two contradictory gate pairs must be reconciled before the RFC is internally sound.
## Orchestrator verification (outside the verbatim body)

- **BLOCKING-1 CONFIRMED, and it is a v0.2 over-correction by the orchestrator.**
  LLP 0012 §Call-time generation binding does state the ordering unconditionally —
  "otherwise an unequal asserted pair refuses before handler, acknowledgement,
  receipt, or mutation effects" (`llp/0012:881-884`) — while LLP 0043 states the
  opposite ordering for settlement: "Before selecting an active mutation function,
  the server … looks up the exact `(clientMutationId, function, input, auth
  fingerprint, authority instance)` identity. A hit republishes the stored result
  without handler dispatch or successor result-contract validation. … A miss then
  uses ordinary active-function selection" (`llp/0043:286-296`). The shipped code
  follows LLP 0043. v0.2 resolved the LLP 0108 half of the conflict and then
  wrongly declared the whole conflict gone. Fable's round-1 F1 had flagged the
  0012 half in passing ("may warrant a dated 0012 clarification too") and this
  orchestrator did not carry it into v0.2 — the finding is fairly charged.
- **MATERIAL-3 CONFIRMED.** LLP 0095's tolerance floor requires that "unknown
  envelope kinds are skipped, never fatal" with fixture
  `negative.unknown_kind.skipped` (`llp/0095:315-320`). Gate 15a's "invalid …
  live-frame discriminants … surface a structured error" collides with gate 16's
  import of that fixture set.
- **MATERIAL-2, DETAIL-4, DETAIL-5, DETAIL-6 CONFIRMED** as stated. MATERIAL-2 and
  DETAIL-6 were found independently by the Fable family, blind.
- The Fable family, blind to this review, reached NOT READY on the same gate 11a
  contradiction and the same LLP 0090 omission, and additionally found an
  unqualified LLP 0108 universality claim left standing in §Motivation that this
  review did not flag.


## Round 3 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-01
**Method:** fresh non-author `codex exec` context, read-only sandbox over the
working tree; delta-scoped — permitted to read this artifact's prior rounds
(own family) and instructed not to read the fable artifact or the super-refine
journal. The reviewer states it did not inspect the prohibited artifacts.
**Instruction capsule SHA-256:** `84f555a976cc459df834189110460d5ec2fc26cc67b50e2f4fd3b2d6b3e4699f`
**Target:** `llp/0147-compiled-microclient.rfc.md` (v0.3, 1031 lines, Draft)
**Target SHA-256:** `07f915fc2510a45ad38722f8bab06d722235f1935e3b7af85679a1880c428c7e`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

**NOT READY.**

The ahead-of-time Micro client remains a strong proposal, and v0.3 successfully repairs the major D4, gate 11a, gate 15a, retry-field, and gate 12 contradictions from round 2.

However, v0.3 introduces a new blocking regression in D6: it classifies a complete, successful effectful response with late-generation facts as an indeterminate outcome. For mutations, the server has already confirmed the commit before it reads those facts. Moreover, refusing an immediate retry from the stale artifact does not prevent a duplicate after the application regenerates against the successor generation.

I verified the requested branch, HEAD, line count, and SHA-256; read all 1031 lines; read only the permitted Codex-family LLP 0147 artifact; did not inspect the prohibited artifacts; and made no repository changes. `./ref-check --verbose` reports 148 LLP documents, 3,798 references, and zero errors.

## 2. Strengths

### Verified

- The architectural premise remains supported: LLP 0145 measured the existing headless closure at 70.1 kB gzip and recommended a generated, capability-selected client beside Full rather than an in-place replacement. [LLP 0145:140–173](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:140)

- D4 now describes the authority conflict accurately. LLP 0043 puts settlement lookup before function selection; LLP 0108 §B defers settlement identity and lookup ordering to LLP 0043; LLP 0012 still states function selection and generation refusal unconditionally. [LLP 0043:286–297](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:286), [LLP 0108:701–717](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:701), [LLP 0012:871–900](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:871), [LLP 0147:403–436](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:403)

- Gate 11a is now fix-neutral and still falsifiable. It observes both halves: invalid data must not publish, while a valid change must arrive as a validated delta or replacement. The companion ticket’s acceptance criteria match. [LLP 0147:862–873](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:862), [issue:109–120](/Users/ccheever/projects/snapback/issues/20260801-live-delta-frames-bypass-result-contract-validation.md:109)

- The unknown-kind correction agrees with LLP 0095: unknown string kinds are skipped, while known kinds remain subject to their required behavior. Gate 16 no longer contradicts gate 15a on that point. [LLP 0147:897–904](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:897), [LLP 0095:315–320](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:315), [fixture:2444–2484](/Users/ccheever/projects/snapback/schemas/live.wire-fixtures.v1.json:2444)

- Retry policy is now propagated consistently. Every operative statement derives the two v1 classes from operation kind, and neither the example descriptor nor `microProfile.v1` carries a retry field. [LLP 0147:606–626](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:606), [LLP 0147:670–689](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:670)

- Gate 12 now correctly limits v1 evidence to fresh admission and explicitly leaves settlement/facts reconciliation to the composition that adopts settlement. [LLP 0147:880–889](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:880)

### Inferred design judgment

- Additive Full/Micro packaging remains the right migration boundary.
- Omitting settlement and automatic effectful retries from the first measured Micro composition is coherent.
- The server-egress trust decision is proportionate provided gates 11a/11b become executable proof rather than prose.

## 3. Findings

### BLOCKING — v0.3 regression: D6 turns a known successful effect into an “indeterminate” outcome

**Defect:** A complete successful response whose generation facts rotated after admission is predecessor-generation success, not transport ambiguity, and refusing the same stale artifact does not prevent duplication after regeneration.

**Evidence:** D6 says an effectful success with mismatched facts carries indeterminate-outcome semantics because the effect “may have committed,” then concludes that manual re-decision cannot duplicate it. [LLP 0147:531–542](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:531)

For mutation, the server commits first, records the outcome as `Confirmed`, and only afterward reads current generation facts to construct the successful response. [src/local.rs:11227–11300](/Users/ccheever/projects/snapback/src/local.rs:11227), [src/server.rs:18822–18851](/Users/ccheever/projects/snapback/src/server.rs:18822)

For actions, `result.ok` means the action returned successfully; generation facts are fetched only after that result. [src/local.rs:1707–1740](/Users/ccheever/projects/snapback/src/local.rs:1707), [src/server.rs:18893–18921](/Users/ccheever/projects/snapback/src/server.rs:18893)

The duplicate counterexample is direct:

1. Generation G1 admits a mutation and commits it.
2. An unrelated deployment rotates the whole generation to G2 before response facts are read.
3. Micro suppresses the G1 success and calls it indeterminate.
4. The application regenerates against G2, as the RFC requires after generation rotation.
5. A user retries; G2 fresh admission now succeeds, and Micro has no `clientMutationId` with which to deduplicate it.

The RFC itself acknowledges that unrelated changes rotate the generation and that Micro v1 carries no settlement identity. [LLP 0147:438–453](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:438), [LLP 0147:952–958](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:952)

**Why it matters:** This misreports durable truth and can induce the exact duplicate-effect behavior D6 claims to prevent. It is a defective effect-outcome decision, not missing implementation detail.

**Resolution criteria:**

- Decide whether a late-generation success publishes its still-contract-valid typed result or returns a non-result deployment-transition diagnostic.
- In either case, preserve the known operation outcome: mutation committed; action completed successfully, without claiming rollback.
- Mark the response non-retryable absent settlement identity. State that same-artifact retry refusal protects only the stale artifact; retry after regeneration may duplicate the effect.
- Replace gate 12’s generic rollout-interleaving language with an executable late-rollout success fixture asserting those semantics.

**Displacement:** Replace D6’s current facts-mismatch bullet at lines 531–542, the rollout portion of gate 12 at lines 880–889, and generalize the existing manual-retry cost at lines 952–956. No new paragraph is necessary.

### DETAIL — v0.3 regression: gate 15a no longer covers malformed frame discriminants

**Defect:** v0.3 correctly exempts unknown string kinds, but its replacement tests only malformed payloads for recognized kinds and no longer covers an absent or non-string `kind`.

**Evidence:** D3 names “known live-frame discriminants,” while gate 15a names malformed payloads for known kinds; neither explicitly exercises a malformed discriminant. [LLP 0147:352–358](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:352), [LLP 0147:897–904](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:897) LLP 0095’s tolerance rule applies to an unknown kind, not a missing or wrongly typed discriminator. [LLP 0095:315–320](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:315)

**Why it matters:** This leaves a small hole in the stated final envelope check, although resolving it is implementation-level detail.

**Resolution criteria:** Exercise missing and non-string `kind` as structured errors/no-publication, while preserving skip behavior for a syntactically valid unknown string kind.

**Displacement:** Replace gate 15a’s current “malformed payloads for known live-frame kinds” clause with “absent/non-string frame kinds or malformed payloads for recognized kinds.” Replace D3’s “known live-frame discriminants” phrase correspondingly.

### DETAIL — D4’s reconciliation leaves a known source comment stale

**Defect:** The commissioned LLP 0012 clarification does not include the mutation-envelope comment that still claims generation comparison occurs before every receipt or ACK.

**Evidence:** D4 commissions only the LLP 0012 clarification. [LLP 0147:426–436](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:426) The source comment still states the unconditional ordering that the shipped settlement route contradicts. [src/manifest.rs:5681–5683](/Users/ccheever/projects/snapback/src/manifest.rs:5681)

**Why it matters:** The normative reconciliation would land while leaving a nearby implementation-facing explanation factually false.

**Resolution criteria:** Update the source comment alongside the LLP 0012 amendment so it says the ordering applies to fresh admission and acknowledges the LLP 0043 settlement-first carve-out.

**Displacement:** Replace D4’s existing commissioning sentence to include the comment correction, and replace—not augment—the three-line source comment.

## 4. Suggestions

These are non-blocking.

- Replace gate 11a’s word “promptly” with “within the fixture’s bounded virtual-time deadline.” The gate already has observable arms; this makes its time condition mechanical without adding text elsewhere.

- During implementation, use an opaque `ValidatedPublication`-style proof value so client-bound constructors cannot accept raw application payloads. If recorded in the RFC, this should replace gate 11b’s final enumeration-only sentences, not add another paragraph.

- Recover the growth budget by replacing the 42-line revision-history header with compact one-line v0.1/v0.2/v0.3 entries pointing to the review artifacts. The detailed history already has a more appropriate home there.

## 5. Open questions the document must answer

1. When an effectful success arrives with late successor-generation facts, does Micro publish the predecessor result or return a settled-success deployment diagnostic?
2. What exact outcome fact must that diagnostic preserve for mutations and actions, and how does it prevent consumers from treating the operation as safely retryable?
3. Does gate 12 explicitly prove that a retry after regeneration may duplicate the effect when no settlement identity exists?
4. Are absent/non-string live-frame kinds fatal malformed envelopes while valid unknown string kinds remain skip-tolerant?

## 6. Explicit readiness verdict

**NOT READY.**

v0.3 is close and repairs the principal round-2 contradictions, but D6’s new effect-outcome semantics are wrong and unsafe. The document becomes review-ready once that bullet and its rollout gate describe a confirmed predecessor-generation success honestly.
## Orchestrator verification (outside the verbatim body)

- **BLOCKING CONFIRMED, and accepted in full.** The mutation path commits and
  records the outcome before the server reads generation facts
  (`src/local.rs:11227-11300`, `src/server.rs:18822-18851`), so v0.3's
  "may have committed" was false: it did commit. The duplicate counterexample is
  also right, and it defeats the fence v0.3 leaned on — after regeneration
  against the successor generation, which the RFC itself requires, a hand retry
  is freshly admitted. The Fable family, blind, found the same clause defective
  (its F1) by a different route (a byte-identical rollback re-admitting the stale
  retry) and rated it MATERIAL rather than BLOCKING.
- v0.4 goes further than either family's minimum: rather than choosing between
  "publish the result" and "return a deployment diagnostic," it **inverts the
  rule to publish**, on the ground both families' evidence supports — the value
  is known-good and suppressing it is what creates the retry incentive. Gate 12
  gains the executable late-rollout fixture Codex specified, including the
  honest converse that a post-regeneration retry duplicates.
- **Both DETAILs CONFIRMED and applied**, including the commissioned correction
  of the stale mutation-envelope source comment (`src/manifest.rs:5681-5683`),
  which no reviewer had previously connected to the LLP 0012 amendment.
- The revision-history compaction suggestion was adopted; the per-round detail
  now lives in the journal, recovering the growth budget.


## Round 4 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-01
**Method:** fresh non-author `codex exec` context, read-only sandbox; delta-scoped,
own-family artifact only. The reviewer states it inspected only the permitted
artifact and made no repository changes.
**Instruction capsule SHA-256:** `48396a9d52eaad71a4a66f773797b8fee349e8b82c992c4e2d279cca72e90f63`
**Target:** `llp/0147-compiled-microclient.rfc.md` (v0.4, 1031 lines, Draft)
**Target SHA-256:** `d18213a8d8c2322635e37c5b07fefd46b0d7966e067905ce7b82faa9c4c292d7`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

**NOT READY.**

I verified HEAD `67628399`, the target’s 1,031 lines, and SHA-256 `d18213a8d8c2322635e37c5b07fefd46b0d7966e067905ce7b82faa9c4c292d7`. I used the LLP review/orientation workflow, inspected only the permitted Codex-family artifact, and made no repository changes.

The inversion—publish a successful predecessor-generation result while separately signaling stale code—is defensible in isolation, especially for committed mutations. However, v0.4’s motivating interleaving contradicts Snapback’s shipped sessions activation protocol: successor activation cannot publish while the predecessor request or its retained response body still holds admission. Consequently, a successful G1 request cannot observe G2 response facts in the way gate 12 requires.

The mutation-ordering argument is only half true: the mutation is confirmed before facts are read, but G2 is also prevented from becoming active before those G1 facts are read and the response finishes.

## 2. Strengths

### Verified

- The proposal remains appropriately additive: generated microclients supplement, rather than replace, the canonical runtime path ([LLP 0147:42](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:42), [LLP 0147:213](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:213)).

- D3’s new envelope floor is consistent with LLP 0095: unknown **string** kinds remain skippable, while absent or non-string `kind` values are malformed envelopes rather than unknown extensions ([LLP 0147:338](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:338), [LLP 0095:315](/Users/ccheever/projects/snapback/llp/0095-websocket-wire-contract.spec.md:315)). Gate 15a tests that distinction directly ([LLP 0147:896](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:896)).

- D4 correctly preserves settlement before post-call authority validation and commissions correction of the stale mutation-envelope source comment ([LLP 0147:390](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:390), [LLP 0147:418](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:418)). The current mutation implementation validates the result, commits, and issues a confirmed receipt before returning ([local.rs:11065](/Users/ccheever/projects/snapback/src/local.rs:11065), [local.rs:11227](/Users/ccheever/projects/snapback/src/local.rs:11227)).

- Gate 11a now supplies a bounded virtual-time deadline rather than leaving the positive live-query arm potentially unbounded ([LLP 0147:857](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:857)).

- The Runtime contract correctly scopes duplicate-effect retry risk to effectful operations, and correctly observes that deployment facts are sessions-only in the current implementation ([LLP 0147:650](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:650), [local.rs:150](/Users/ccheever/projects/snapback/src/local.rs:150)).

### Inferred

- If Snapback later permits overlapping generations, publishing a successful, G1-validated result is preferable to converting known success into indeterminacy. For mutations in particular, suppressing the confirmed result encourages exactly the retry that can duplicate the durable effect.

- One-shot query results are likewise ordinarily safe to publish as observations at their execution point. Live subscriptions need a stricter distinction between returning their initial result and retaining it as readable cache state.

## 3. Findings

### BLOCKING — v0.4 regression: gate 12 requires an interleaving forbidden by sessions activation

**Defect:** D6 and gate 12 assert that G2 can become active after a G1 operation finishes but before its response facts are read, while the shipped sessions protocol prevents successor activation from overtaking that G1 request or its response body.

**Evidence:**

- D6 describes a successful G1 operation followed by G2 facts ([LLP 0147:521](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:521)); gate 12 requires that exact executable mutation fixture ([LLP 0147:876](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:876)).

- Every prepared request retains an `AdmissionLease` ([invocation.rs:869](/Users/ccheever/projects/snapback/src/auth/invocation.rs:869)). Mutation facts are read while that request remains admitted, after the mutation has returned ([server.rs:18833](/Users/ccheever/projects/snapback/src/server.rs:18833)).

- Sessions activation closes admission and waits for `in_flight == 0` before proceeding ([admission.rs:639](/Users/ccheever/projects/snapback/src/auth/admission.rs:639), [admission.rs:661](/Users/ccheever/projects/snapback/src/auth/admission.rs:661)). The server explicitly performs that transition before activating the successor ([server.rs:18924](/Users/ccheever/projects/snapback/src/server.rs:18924)).

- The lease is retained through the response body’s final sink, not merely through handler computation ([server.rs:9611](/Users/ccheever/projects/snapback/src/server.rs:9611), [LLP 0059:1312](/Users/ccheever/projects/snapback/llp/0059-admission-safe-http-streaming.spec.md:1312)).

- LLP 0058 requires same-mode activation to wait for predecessor finite invocations and retained HTTP responses before committing/publishing the successor ([LLP 0058:911](/Users/ccheever/projects/snapback/llp/0058-mode-transition-quiescence.spec.md:911)). The shipped test pauses a predecessor query response and proves activation cannot overtake it ([server.rs:27618](/Users/ccheever/projects/snapback/src/server.rs:27618)).

**Why it matters:** Gate 12 cannot validate a real rollout property as written. A mock can fabricate mismatched facts, but that would test defensive handling of a protocol inconsistency—not the claimed deployment race. The RFC therefore contains both a false shipped-code claim and an unsatisfiable graduation fixture.

**Resolution criteria:** Choose one:

1. Preserve current quiescence: specify that a successful sessions response carries its admitted generation, and replace gate 12 with the existing executable no-overtake fixture. A fabricated mismatch may remain as a defensive protocol-error test, but not as a rollout scenario.

2. Explicitly propose overlapping activation, including amendments to LLPs 0058/0059, admission lifetime, response retention, and final-publication fencing.

The first option is strongly preferable for this RFC.

**What the fix displaces:** Replace D6’s late-rollout passage at lines 521–536, the corresponding Runtime-contract facts rationale at lines 655–658, and gate 12’s late-rollout arm at lines 882–888. No net-new paragraph is necessary.

### MATERIAL — deployment resnapshot cannot be performed by the stale immutable microclient

**Defect:** D6 correctly blanks predecessor live state on generation change, but incorrectly promises an immediate fresh snapshot even though D4 requires fresh admission and the G1-generated client cannot submit a G2 artifact identity.

**Evidence:**

- D6 says deployment transition both blanks and resnapshots affected state ([LLP 0147:505](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:505), [LLP 0147:524](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:524)); gate 18 repeats that requirement ([LLP 0147:913](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:913)).

- LLP 0012 says activation retires predecessor-generation subscriptions, and a fresh request using the predecessor artifact receives the same generation mismatch ([LLP 0012:895](/Users/ccheever/projects/snapback/llp/0012-live-query-semantics.spec.md:895)).

- The implementation removes generation-bound subscriptions and emits `SNAPBACK_ARTIFACT_IDENTITY_MISMATCH` with retained state cleared ([local.rs:19010](/Users/ccheever/projects/snapback/src/local.rs:19010)).

- The generation-transition test proves that a subsequent G1 subscribe is rejected and only a G2 reference establishes the replacement subscription ([local.rs:32115](/Users/ccheever/projects/snapback/src/local.rs:32115), [local.rs:32200](/Users/ccheever/projects/snapback/src/local.rs:32200)).

**Why it matters:** An automatic resnapshot loop using the immutable G1 registry cannot succeed. It either retries indefinitely or obscures the actual requirement: regenerate/load successor code before establishing successor-generation live state.

**Resolution criteria:** Split ordinary recoverable resync from deployment mismatch:

- reconnect or recoverable version gap: blank and resnapshot;
- artifact-generation mismatch: blank, raise the stale-artifact signal, remain unreadable, and resubscribe only after regenerated successor code is installed.

**What the fix displaces:** Replace the existing “blanks and takes a fresh snapshot” clauses in D6 and gate 18 with this distinction. The replacement need not increase line count.

## 4. Suggestions

- **Non-blocking:** Add LLP 0058 to `Related`; it is the governing document for the interleaving D6 discusses. Use space freed by replacing the invalid late-rollout passage.

- **Non-blocking:** If overlapping generations are ever desired, distinguish `executionGeneration` from response-time `activeGeneration`. That would make the result’s provenance explicit instead of overloading one fact with two temporal meanings. This should replace, not supplement, the current late-facts prose.

- **Non-blocking:** For live subscriptions, state whether “publish the result” includes making the initial snapshot observably readable before processing the stale-artifact signal. If overlap is introduced later, those operations likely need atomic publish-and-blank handling.

## 5. Open questions

1. Is the RFC preserving LLP 0058’s sessions quiescence invariant? If yes, will a successful generation mismatch be classified as a server/protocol violation rather than a normal rollout?

2. On `SNAPBACK_ARTIFACT_IDENTITY_MISMATCH`, does the microclient stop resnapshot retries and wait for regenerated successor code?

3. If overlapping activation is intended eventually, what do deployment facts identify: the generation that executed the operation, the generation active when the response was assembled, or both?

## 6. Explicit readiness verdict

**NOT READY.**
## Orchestrator verification (outside the verbatim body)

- **BLOCKING CONFIRMED, and it is the loop's most valuable single finding.** The
  v0.4 inversion rested on an interleaving the shipped protocol forbids.
  Verified independently: sessions activation closes admission and blocks until
  `in_flight == 0` (`src/auth/admission.rs:639-667`); the admission lease is
  retained through the response body's final sink
  (`RetainedAdmissionBody { _admission, … }`, `src/server.rs:9611-9620`); and
  the facts read happens *inside* the request's admission and re-validates it
  first — `authority.validate_admission("mutation generation facts")`
  (`src/server.rs:18838-18841`) and `facts_authority.validate_admission("query
  generation facts")` (`src/server.rs:17735-17738`). LLP 0058 states the rule
  normatively: the transition owner "closes new admission and waits for every
  predecessor finite invocation and retained HTTP response body to drain"
  before publishing the successor generation
  (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:911-916`).
  A conforming sessions server therefore cannot deliver successor facts on a
  predecessor success. v0.5 adopts resolution option 1, which the review itself
  called strongly preferable.
- **MATERIAL CONFIRMED**, and the Fable family, blind, found the same defect
  from the other side (its round-4 F1: a still-stale resubscribe surfaces a
  generation refusal, so the promised resnapshot never lands). v0.5 splits
  ordinary recoverable resync from deployment mismatch in both D6 and gate 18.
- **Both non-blocking suggestions adopted**: LLP 0058 added to Related, and the
  live-subscription readability question answered by the new "blanks, signals,
  stays unreadable" rule.
- **Filename provenance, as in round 1:** this review's LLP *filenames* are
  reconstructed and wrong — it writes `llp/0095-websocket-wire-contract.spec.md`,
  `llp/0012-live-query-semantics.spec.md`,
  `llp/0058-mode-transition-quiescence.spec.md`, and
  `llp/0059-admission-safe-http-streaming.spec.md` for documents whose real slugs
  are `0095-client-lifecycle-and-conformance.spec.md`,
  `0012-headless-integration-contract.spec.md`,
  `0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md`, and
  `0059-session-projection-and-client-barrier.spec.md`. Every line number and
  quotation was checked and is correct, so the findings stand; only the
  filenames are confabulated. Recorded verbatim without repair.


## Round 5 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-01
**Method:** fresh non-author `codex exec` context, read-only sandbox;
delta-scoped, own-family artifact only. The reviewer states it complied with the
blindness requirement and made no repository changes.
**Instruction capsule SHA-256:** `ef509d7ab6470221d76749d62daf908b06f3530ed0a242ca0608c8ecbb498d16`
**Target:** `llp/0147-compiled-microclient.rfc.md` (v0.5, 1050 lines, Draft)
**Target SHA-256:** `9fc8db29d849a63c1b7dd42eb31709193ac781a0f8fb2fd9d911ec1199e4c859`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

**NOT READY.** v0.5 correctly repairs the alleged commit-to-response rollout race for fresh admissions, but over-corrects by presenting that proof as universal. A conforming sessions `auth/replay` settlement hit can legitimately return success with facts different from the request’s asserted generation.

This is blocking to READY because the RFC makes a false server-wide factual claim, though the core Micro v1 architecture remains sound and the correction can reduce the document’s size.

I verified the exact 1050-line target at SHA-256 `9fc8db29d849a63c1b7dd42eb31709193ac781a0f8fb2fd9d911ec1199e4c859`, HEAD `67628399`, complied with the artifact-blindness requirement, and made no repository changes.

## 2. Strengths

- **Verified:** The fresh-admission no-overtake repair is correct. Sessions activation closes admission and drains predecessor invocations and retained response bodies before publishing the successor ([LLP 0058:911](/Users/ccheever/projects/snapback/llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:911), [LLP 0059:1312](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1312), [src/server.rs:9611](/Users/ccheever/projects/snapback/src/server.rs:9611)). Gate 12 now tests that actual property and correctly labels fabricated mismatched facts as a defensive protocol fixture ([LLP 0147:890](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:890)).

- **Verified:** The proof holds for every fresh Micro v1 operation family reviewed:

  - Queries revalidate admission before reading facts ([src/server.rs:17686](/Users/ccheever/projects/snapback/src/server.rs:17686), [src/server.rs:17736](/Users/ccheever/projects/snapback/src/server.rs:17736)).
  - Fresh mutations validate generation after function selection, and response facts remain inside the admission ([src/local.rs:10983](/Users/ccheever/projects/snapback/src/local.rs:10983), [src/server.rs:18838](/Users/ccheever/projects/snapback/src/server.rs:18838)).
  - Actions revalidate admission before success facts ([src/server.rs:18868](/Users/ccheever/projects/snapback/src/server.rs:18868)).
  - Authorized leases retain and revalidate the admission through reservation ([src/server.rs:18234](/Users/ccheever/projects/snapback/src/server.rs:18234), [src/local.rs:10469](/Users/ccheever/projects/snapback/src/local.rs:10469), [src/local.rs:10528](/Users/ccheever/projects/snapback/src/local.rs:10528)).
  - Live establishment validates the generation and derives facts within the admitted operation ([src/local.rs:13182](/Users/ccheever/projects/snapback/src/local.rs:13182), [src/local.rs:13777](/Users/ccheever/projects/snapback/src/local.rs:13777)).

- **Verified:** v0.5 correctly separates recoverable resynchronization from deployment staleness ([LLP 0147:512](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:512), [LLP 0147:543](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:543)). A predecessor live assertion is retired and a fresh predecessor subscribe is refused; only successor artifacts can establish again ([LLP 0012:895](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:895)). Gate 18 captures the correct observable outcome ([LLP 0147:929](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:929)).

- **Verified:** Non-sessions and mixed-target cases do not create another legitimate mismatch. Dev omits facts and ignores the additive assertion ([src/local.rs:150](/Users/ccheever/projects/snapback/src/local.rs:150), [src/local.rs:170](/Users/ccheever/projects/snapback/src/local.rs:170)); v1-dev and mixed tuples are rejected rather than admitted ([LLP 0058:293](/Users/ccheever/projects/snapback/llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:293)). The Cloudflare arm currently exposes no sessions auth profile ([LLP 0096:471](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:471)).

- **Verified:** The requested structural changes are present: D6’s first bullet separates deployment, Gate 12 uses no-overtake, Gate 18 distinguishes stale deployment, and LLP 0058 is in Related ([LLP 0147:44](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:44)).

- **Design judgment:** The additive compiled Micro profile remains a good idea. Its exact generated wrappers, conservative runtime, explicit nonclaims, and red gates form a credible empirical plan rather than treating bundle size as the sole success metric ([LLP 0147:237](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:237), [LLP 0147:824](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:824)).

## 3. Findings

### BLOCKING — v0.5 regression: the “protocol violation, never rollout” rule is falsely universal

**Defect:** v0.5 universalizes a theorem that holds only for fresh generation-bound admissions: an `auth/replay` settlement hit can legitimately produce success whose current facts differ from the request’s predecessor generation.

**Evidence:**

- D6 says a conforming sessions success “always” carries its admitting generation and deployment transitions “never” produce mismatched success facts ([LLP 0147:529](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:529)).
- D4 itself records the exception: settlement lookup precedes active function selection and generation comparison ([LLP 0147:397](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:397)).
- LLP 0043 requires a settlement hit to republish the stored result without handler dispatch or successor validation ([LLP 0043:286](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:286)).
- The implementation returns a hit at `10949–10980`; function selection and generation validation occur only afterward on a miss ([src/local.rs:10928](/Users/ccheever/projects/snapback/src/local.rs:10928), [src/local.rs:10949](/Users/ccheever/projects/snapback/src/local.rs:10949), [src/local.rs:10983](/Users/ccheever/projects/snapback/src/local.rs:10983)).
- The mutation route then reads facts from the replay request’s current admission ([src/server.rs:18838](/Users/ccheever/projects/snapback/src/server.rs:18838)).
- `auth/replay` is a legitimate sessions profile whenever a mutation carries `clientMutationId` ([LLP 0096:367](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:367)).

A concrete non-racy execution is: G1 commits a settlement; G2 activates completely; a new G2-admitted replay asserts G1 and hits the settlement cache; the server returns the stored result with G2 facts. The admission barrier is fully respected.

**Why it matters:** D6 would classify a definite, authenticated settlement as indeterminate, suppress its result, and potentially strand confirmation if reused by a later replay-capable Micro composition. It also directly contradicts D4 and fails the READY requirement that codebase claims be true. Micro v1 is unaffected only because it deliberately emits no `clientMutationId` ([LLP 0147:435](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:435)).

**Resolution criteria:** Scope the mismatch rule explicitly to fresh Micro v1 admissions that cannot carry settlement identity. Preserve the defensive no-publication rule there. Exclude settlement replay and leave its facts semantics to D4’s commissioned LLP 0012 clarification.

**What the fix displaces:** Replace, rather than extend:

- the universal v0.5 changelog claim at lines 33–36;
- D6’s proof paragraph at lines 529–542;
- the Runtime-contract statement at lines 668–672.

Use Gate 12’s existing “later composition re-scopes” sentence at lines 903–904 to name both the gate and D6 exception. This should be a net deletion.

### DETAIL — sessions success does not explicitly require facts to be present

**Defect:** The Runtime contract says to compare “any returned” facts, which leaves a sessions success with no `facts` unchecked even though sessions success is required to carry them.

**Evidence:** LLP 0012 requires successful sessions calls and subscriptions to echo server-derived facts ([LLP 0012:890](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:890)). The shared response types keep facts optional only because dev uses the same envelope ([src/manifest.rs:5596](/Users/ccheever/projects/snapback/src/manifest.rs:5596), [src/server.rs:6578](/Users/ccheever/projects/snapback/src/server.rs:6578), [src/local.rs:734](/Users/ccheever/projects/snapback/src/local.rs:734)). The proposed runtime only compares a fact if returned ([LLP 0147:668](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:668)).

**Why it matters:** The defensive check would catch unequal fabricated facts but not their omission, allowing publication without the sessions evidence the profile relies upon. This is specification detail, not a defective architectural decision.

**Resolution criteria:** In a sessions composition, require `facts.activeGeneration` and compare it; in dev, retain the fact-absent behavior.

**What the fix displaces:** Replace lines 668–672 with the sessions-required/dev-absent rule. Replace Gate 12’s existing fabricated-facts fixture sentence at lines 900–904 with a shorter malformed-facts fixture covering both absent and unequal facts. Do not add another paragraph or gate.

## 4. Suggestions

- **NON-BLOCKING:** Deduplicate the no-overtake explanation. It is repeated in the v0.5 metadata, D6, and Gate 12. Keep the normative scope in D4/D6 and the executable formulation in Gate 12; replace the other copies with short cross-references. This directly pays down the growth overrun.

- **NON-BLOCKING:** Clarify the exact retirement transition imported from LLP 0095. Its `T-RESYNC` rule requires a subscription-scoped `resync_required` to enter resubscribe regardless of reason ([LLP 0095:237](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:237)). Replace D6’s “then stops” wording with “attempts the required fresh subscribe once, then stops and signals on generation refusal” if that is the intended Gate 18 behavior. This replaces lines 543–549 rather than adding text.

## 5. Open questions

1. What must `facts.activeGeneration` mean on settlement replay: the current admitting generation, the original settlement generation, or a separately named settlement-generation fact? D4 already names this for the commissioned LLP 0012 clarification ([LLP 0147:420](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:420)); D6 must stop answering it accidentally.

2. Does a deployment-retired subscription make exactly one LLP 0095-required fresh subscribe before stopping, or is Micro proposing an explicit lifecycle exception? This is DETAIL-level and can be pinned in the follow-on Plan.

3. Which Gate 11a live-delta remedy is selected? OQ10 correctly leaves this open, and the existing red gate prevents live graduation until empirical implementation work answers it ([LLP 0147:871](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:871), [LLP 0147:1031](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:1031)).

The other named packaging, byte-ceiling, and Metro/Hermes questions are appropriately empirical and do not independently block Draft readiness.

## 6. Explicit readiness verdict

**NOT READY**
## Orchestrator verification (outside the verbatim body)

- **BLOCKING CONFIRMED**, and the Fable family found the same defect blind,
  rating it DETAIL (its round-5 F2). v0.5's repair was true but stated
  universally: a settlement replay is a conforming sessions success whose facts
  may legitimately differ, because LLP 0043's lookup precedes generation
  comparison (`src/local.rs:10933-10984`) and the route then reads current facts
  (`src/server.rs:18838-18851`). Unreachable for Micro v1, which emits no
  `clientMutationId` — which is exactly why the scoping, not a policy change, is
  the fix. v0.6 scopes D6 to fresh admissions and extends gate 12's re-scope
  clause to cover D6's classification.
- **DETAIL CONFIRMED.** LLP 0012 has "successful sessions calls and
  subscriptions echo the server-derived pair"
  (`llp/0012-headless-integration-contract.spec.md:890-891`), so a sessions
  success *must* carry the fact; v0.5's "any returned" would have let omission
  through. §Runtime contract now requires it and gate 12's defensive fixture
  covers absent as well as unequal facts.
- **Suggestion 2 adopted and verified.** LLP 0095's T-RESYNC says "recovery is
  identical for every reason and an unknown reason must not change the
  transition" (`llp/0095:237-241`), so the client does make one fresh subscribe
  before the refusal stops it. D6 now says so rather than "then stops."
- **Suggestion 1 adopted**: the duplicated no-overtake prose collapsed to a
  cross-reference, paying down part of the growth overrun.
- The Fable family additionally found — and this review did not — that v0.5's
  recovery-window absolutes ignore an operator rollback re-activating the
  byte-identical predecessor, which also ends the refusal window. Applied.


## Round 6 — 2026-08-01 (final round)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-01
**Method:** fresh non-author `codex exec` context, read-only sandbox;
delta-scoped, own-family artifact only. The reviewer states it changed no
repository files.
**Instruction capsule SHA-256:** `c472e0557c65aba941485b72ad87e95721e0b1c652c1500e43f22b36856a2ff6`
**Target:** `llp/0147-compiled-microclient.rfc.md` (v0.6, 1062 lines, Draft)
**Target SHA-256:** `a8d534eab5d598a14e4c1de7ff67e2baa61f026ba2062853456499c1ba8cd8ab`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Status:** completed
**Verdict:** READY

## Verbatim review

## 1. Overall assessment

**READY**, subject to one small factual correction and the RFC’s already-declared LLP 0012 reconciliation before acceptance.

I verified the requested v0.6 file, 1062-line length, Draft status, and SHA-256. The five round-6 changes are sound. No blocking or material design defect remains, and no v0.6 regression was found.

## 2. Strengths

- **Verified — settlement replay is correctly scoped.** D6 now limits generation-fact classification to fresh admissions and places the settlement exception directly beside that rule ([LLP 0147:534](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:534)). LLP 0043 requires settlement lookup before active-function selection ([LLP 0043:286](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:286)); the implementation returns a settlement hit before generation comparison ([local.rs:10928](/Users/ccheever/projects/snapback/src/local.rs:10928)) and subsequently attaches current server facts ([server.rs:18838](/Users/ccheever/projects/snapback/src/server.rs:18838)). Therefore a valid replay can return a predecessor result with successor facts. Micro v1 cannot enter that path because it emits no `clientMutationId`. Gate 12 repeats the scope in the right place ([LLP 0147:903](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:903)).

- **Verified — the rollback exit is real.** Codegen deterministically derives deployment identities from the artifact inputs ([codegen:7751](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7751)), and same-mode provisioning can atomically reactivate a valid predecessor deployment ([auth_mode.rs:1112](/Users/ccheever/projects/snapback/src/storage/auth_mode.rs:1112)). The RFC correctly makes this conditional on an operator rollback actually reactivating the byte-identical predecessor ([LLP 0147:551](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:551)); it does not promise that every schema rollback is feasible.

- **Verified — one fresh subscribe matches LLP 0095.** `resync_required` requires a transition to resubscription, not an unbounded retry loop ([LLP 0095:237](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:237)). The canonical fixture names the action `resubscribe_subscription` ([wire_fixtures.rs:1077](/Users/ccheever/projects/snapback/src/wire_fixtures.rs:1077)). The RFC’s “make the required fresh subscribe once, then stop on deterministic refusal” rule therefore conforms. Current tests also distinguish generation refusal from the removed-function `SNAPBACK_UNKNOWN_FUNCTION` channel ([local.rs:32190](/Users/ccheever/projects/snapback/src/local.rs:32190)).

- **Verified — requiring sessions facts breaks neither dev nor mixed targets.** Successful sessions operations are specified to echo `facts.activeGeneration`, while dev omits it ([LLP 0012:890](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:890)); the implementation constructs facts only in sessions mode ([local.rs:150](/Users/ccheever/projects/snapback/src/local.rs:150)). Mixed and v1-dev tuples are rejected rather than admitted ([LLP 0058:293](/Users/ccheever/projects/snapback/llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:293)). Runtime enforcement may therefore require the fact in sessions while preserving the shared optional wire field needed by dev.

- **Verified — no-overtake reasoning is now concise and supported.** Activation closes admission and drains predecessor work; retained response bodies hold admission until publication completes ([LLP 0059:1312](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1312), [server.rs:9600](/Users/ccheever/projects/snapback/src/server.rs:9600)). The collapsed cross-reference loses no necessary constraint.

- **Verified — the live-delta problem is honestly gated.** Current delta serialization can bypass result-contract validation, and gate 11a requires a real solution rather than allowing suppressed publication ([LLP 0147:884](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:884)). Keeping this red as a Phase B prerequisite is appropriate for a Draft RFC.

- **Inferred assessment.** The additive Full/Micro boundary is a good design: it preserves the established client while testing whether generated specialization can remove interpreter and validator weight without weakening server-side safety. The evidence gates are unusually strong and should prevent a favorable bundle-size result from being mistaken for product readiness.

## 3. Findings

**BLOCKING:** None.

**MATERIAL:** None.

**DETAIL — inherited factual overstatement, not a v0.6 regression.**

- **Defect:** The statement that the Cloudflare arm advertises `live_subscriptions` “and nothing else” is too broad ([LLP 0147:373](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:373)).
- **Evidence:** The base manifest advertises only `live_subscriptions` ([base manifest:17](/Users/ccheever/projects/snapback/cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json:17)), but the checked-in all-aboard Cloudflare manifest also advertises `bounded_response_stream_v1` and `cron` ([all-aboard manifest:17](/Users/ccheever/projects/snapback/cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json:17)).
- **Why it matters:** It does not change the decision—neither manifest advertises both required contract capabilities, and Cloudflare still has no sessions surface—but the READY bar requires corpus claims to be literally true.
- **Resolution:** Replace lines 377–379 with: “It is the second independent reason every checked-in Cloudflare target is out of scope: none advertises both `args_contract_v1` and `result_contract_v1`; the base manifest advertises only `live_subscriptions`.”
- **Growth displacement:** This replaces the existing two-line claim and is slightly shorter.

## 4. Suggestions

- For maximum precision, replace “generation identity is content-derived” at [LLP 0147:558](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:558) with “codegen deterministically regenerates the predecessor’s asserted identity fields.” This better preserves LLP 0058’s distinction between deterministic derivation and receiver-computed content-address proof. It replaces the existing clause without growth.

- During Phase B, consider making every egress constructor require an opaque `ValidatedPublication` witness. Gate 11b’s mechanical enumeration would then prove that every publication path obtains the witness. If recorded in the RFC, this should replace—not supplement—the final explanatory sentences of gate 11b.

- The revision history now consumes roughly forty lines. A future editorial pass could replace it with six compact version entries, producing a substantial net deletion.

## 5. Open questions

One question must be resolved before acceptance, but it is already explicitly named rather than hidden: LLP 0012 must define what `facts.activeGeneration` means on an LLP 0043 settlement hit—current admitting generation, original settlement provenance, or separate facts—and scope generation comparison to fresh admissions. The stale source comment still states the universal ordering ([manifest.rs:5681](/Users/ccheever/projects/snapback/src/manifest.rs:5681)); [D4 correctly requires this reconciliation](/Users/ccheever/projects/snapback/llp/0147-compiled-microclient.rfc.md:425).

OQ10’s choice of delta-lane repair may remain open for the implementation Plan, but it must close before any live-query Micro graduation. The size ceilings, carrier class, Metro behavior, packaging partition, and future finer-grained generation mechanism are appropriately empirical questions. I found no unnamed architectural question that must be added to v0.6.

## 6. Explicit readiness verdict

**READY.**

**Author recommendation:** Apply the one Cloudflare wording correction, then land D4’s required LLP 0012 settlement/fresh-admission clarification together with the corresponding `src/manifest.rs` comment correction. After that, accept LLP 0147 and commission Phase A; no seventh conceptual review is warranted. Keep Micro React conditional on the named LLP 0114 amendment, and keep live-query product graduation blocked until gate 11a closes the delta-egress gap. No repository files were changed during this review.
## Orchestrator verification (outside the verbatim body)

- **DETAIL CONFIRMED and applied.** `capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json:17-21`
  advertises `bounded_response_stream_v1`, `cron`, and `live_subscriptions`, so
  "advertises `live_subscriptions` and nothing else" was literally false of that
  target. The decision is unaffected — neither manifest advertises both contract
  capabilities and neither supports sessions (`supportedAuthModes: ["dev"]`) —
  and the text now says exactly that. The Fable family did not find this.
- **Precision suggestion adopted:** "generation identity is content-derived"
  replaced with codegen's deterministic regeneration of the asserted identity
  fields, preserving LLP 0058's distinction between deterministic derivation and
  receiver-computed content-address proof.
- The Fable family, blind, also returned READY on this revision, with one
  DETAIL of its own (a wrong positional cross-reference in D6's first bullet),
  likewise applied. **The loop converged dual-READY on v0.6.**
