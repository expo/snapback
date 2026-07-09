**Reviewer family:** GPT-5 (OpenAI)
**Provider / runtime:** OpenAI API via Codex CLI 0.143.0 (model gpt-5.5, reasoning
effort xhigh, read-only sandbox)
**Date:** 2026-07-09
**Redacted:** No — reviewed the local repository (the draft LLP, related LLPs,
and source); instructed not to read `.agent-local-secrets.md`; no secrets were
present in the reviewed material.
**Method:** cli-runner — non-interactive `codex exec` with the LLP 0005
standard review prompt plus instructions to verify the draft's factual claims
against the repository. Full repository read access. This Codex session did
not author LLP 0051. Review of the working-tree draft as of 2026-07-09, before
any revision.

# Review: LLP 0051 — The language-neutral data tier

## Overall assessment
I think the proposal is directionally good and worth pursuing. It identifies a real architectural opportunity: Snapback already has a schema-governed HostPlan IR, a closed host-op seam, and a DK-7 schema pipeline; promoting those into a language-neutral data tier is coherent.

I would not accept the draft as-is. I found one blocking factual error and several major scope/spec gaps. Most are fixable by tightening claims, splitting capability reporting by runtime/artifact, and making D1/D2/D4 more precise before implementation. I did not inspect Exact LLP 0329 and take the draft’s characterization of it as given.

## Strengths
- **§Context and §D2 are grounded in real code.** `FunctionRuntime` is currently `HostPlan | IbexModule` (`src/manifest.rs:361-365`), `MutationPlan` is `Insert | Patch | Delete` over `ValueExpr` (`src/manifest.rs:774-815`), and schemas are generated/drift-gated per DK-7 (`llp/0037-schema-source-of-truth.decision.md:13-19`, `:132-156`).
- **The HostPlan re-litigation is legitimate.** LLP 0020 demoted HostPlan as a public authoring model, not because its execution properties were bad (`llp/0020-core-authoring-surface.plan.md:97-102`). LLP 0003 explicitly left declarative conditional host-plan predicates as future Option B (`llp/0003-local-code-hosting-and-storage-core.rfc.md:347-360`).
- **D1 aligns with a documented aspiration.** `ValueExpr::RuntimeId` and `RuntimeNow` already exist (`src/manifest.rs:807-815`), host calls return frozen invocation time / fresh ids (`src/runtime.rs:537-556`), and LLP 0003 asked for injectable ids/timestamps (`llp/0003-local-code-hosting-and-storage-core.rfc.md:372-375`).
- **D4 targets real drift.** Live update structs are hand-written (`src/local.rs:356-380`), socket messages are a local Rust enum (`src/server.rs:2252-2291`), the JS kit dispatches by string kind (`demos/_kit/client.mjs:734-776`), and no live protocol schema appears under `schemas/`.
- **D6 preserves honest client labeling.** The current adapter explicitly reports `Online` and says it does not run handlers locally (`packages/snapback-contract/index.mjs:6-11`), matching LLP 0043’s “no local handler execution means no parity claim” rule (`llp/0043-offline-replay-retention.rfc.md:27-33`).

## Concerns
- **blocking — The ambient-nondeterminism claim is false for Ibex today.**  
  LLP 0051 says `Date.now`, `Math.random`, `crypto`, and timers are banned “on both engines” (`llp/0051-language-neutral-data-tier.rfc.md:125-132`). The repo says otherwise: `tests/workerd_twin_v0.rs:271-293` pins `Date.now`/`Math.random` as reachable on Ibex and denied on V8; `tests/workerd_twin_v0.rs:320-325` does the same for zero-arg `new Date()`. LLP 0048 records this as a declared engine fact (`llp/0048-v8-conformance-twin.rfc.md:370-373`, `:421-425`).  
  **Resolve by:** correcting the context and sequencing D1 behind closing the Ibex ambient gap, or scoping ledger determinism to IR/WASM/codegen-clean JS handlers with the declared Ibex asymmetry called out.

- **major — The All Aboard IR acceptance gate does not match the proposed IR.**  
  Increment 3 requires “the todo and all-aboard demo mutations express entirely in IR” (`llp/0051-language-neutral-data-tier.rfc.md:528-533`). Todo-v2 is already HostPlan-based (`demos/todo-v2/snapback/functions.mjs:47-83`), but All Aboard uses JS mutations (`demos/all-aboard/snapback/functions.mjs:117-154`) whose handlers do loops, point reads, query-all/delete-all, variable array inserts, and object processing (`demos/all-aboard/snapback/handlers.mjs:455-517`). D2 only proposes richer expressions plus `Get`, `Guard`, and `Let` (`llp/0051-language-neutral-data-tier.rfc.md:247-258`).  
  **Resolve by:** either narrowing the gate to todo-v2/graffiti/simple CRUD, or explicitly adding and specifying bulk/loop constructs such as `ForEachArg`, `DeleteWhere`, `Upsert`, bounded scan, and array/object projection.

- **major — The ctx-answer ledger’s auth shape is underspecified.**  
  D1 proposes `{ ids, now, principal }` and says principal is replayed (`llp/0051-language-neutral-data-tier.rfc.md:184-199`). Current durable `AuthInput` is `principal`, `session_id`, and `user_id` (`src/manifest.rs:817-821`), JS exposes `auth.userId` (`packages/snapback-harness/ctx-bootstrap.js:267-270`), LLP 0043 asks for an auth-context fingerprint (`llp/0043-offline-replay-retention.rfc.md:91-99`, `:131-136`), and LLP 0039’s target `AuthContext` includes `userId`, `sessionId`, `isAuthenticated`, provider, and roles (`llp/0039-auth-vertical-slice.rfc.md:78-88`).  
  **Resolve by:** defining the ledger auth field as a resolved auth context plus fingerprint/epoch, with clear replay validation and mismatch diagnostics.

- **major — D3 overstates what WASM implies for local resource-limit reporting.**  
  D3 says wasmtime fuel/memory caps would give the local profile `cpu_budget: Enforced` (`llp/0051-language-neutral-data-tier.rfc.md:310-313`). Current capability limits are target-level: local `cpu_budget` is `Missing` (`src/manifest.rs:1061-1079`; `schemas/capability.manifest.local-dev-sqlite-ibex.json:33-45`), and Ibex JS remains supported.  
  **Resolve by:** making resource limits artifact/runtime-specific, or rephrasing to “WasmModule invocations can report enforced fuel; the local target remains CPU-budget-missing while IbexModule is allowed.”

- **major — D4 is too narrow for the “third-language client is codegen” claim.**  
  D4 covers live envelopes, socket messages, and handler completion (`llp/0051-language-neutral-data-tier.rfc.md:338-358`), but non-JS clients also need schemas for HTTP request/response envelopes, connection grants, query/mutation/action bodies, outbox `Durable` envelopes, receipts, diagnostics, and ephemeral frames. The JS kit hand-authors many of these (`demos/_kit/client.mjs:315-355`, `:479-517`).  
  **Resolve by:** expanding D4 into an explicit protocol schema set, or weakening the non-JS client claim until those shapes are governed.

- **minor — “Data is not code” needs resource bounds.**  
  Runtime-updatable IR on Cloudflare is attractive (`llp/0051-language-neutral-data-tier.rfc.md:467-470`), but expression trees can still consume CPU/memory.  
  **Resolve by:** specifying plan size, step count, expression depth, library-call cost, and evaluator budget limits before claiming hot-load safety.

- **minor — WASM determinism language should define a strict profile.**  
  “Same bytes eliminate cross-engine semantic drift” (`llp/0051-language-neutral-data-tier.rfc.md:318-324`) is mostly true only for a constrained WASM profile. Floats, WASI, host serialization, traps, and undefined import behavior still need pinning.  
  **Resolve by:** naming a Snapback WASM ABI/profile and putting its edge cases in D5.

## Suggestions
- Split the first revision into “facts/invariants” and “implementation.” Fix the ambient-engine statement, ledger auth shape, and D2 demo gate before debating acceptance.
- Add a `dataTierProfile` or equivalent version to plans, ledgers, schemas, and conformance cases so old ledgers remain replayable after IR growth.
- Treat D1 ledger cases as a durable subset of the existing host-call trace idea (`HostCallTraceEntry` at `src/runtime.rs:847-859`), but do not store diagnostic-only calls such as `runtime.log`.
- Make D5 include both positive and rejection cases: malformed plans, unsupported expression forms, null/absent behavior, numeric boundaries, field access errors, auth mismatch, ledger exhaustion, and replay with stale artifact hashes.
- Add one explicit negative-demo gate: identify a real handler that must remain JS/WASM. All Aboard currently looks like that candidate unless D2 grows bulk/loop semantics.

## Open questions
- What is the exact first IR profile: CRUD plus point reads only, or does it include bounded loops/bulk table operations?
- Does Parity require local query evaluation over retained caches, or only local mutation overlay derivation?
- What ledger fields cross the wire versus remain local receipt/debug material?
- How are old ledgers replayed after schema, function manifest, or IR-profile upgrades?
- Where do WASM bytes live, how are they signed or trusted, and what is the deploy-time binding story per target?
- Is `AuthContext` replay an identity freeze only, or must authorization epochs/fingerprints be frozen too?

## Recommended next step
Revise and keep LLP 0051 in `Draft`. Fix the blocking ambient-determinism claim, narrow or expand the All Aboard IR gate, specify the ledger/auth schema, and broaden D4’s protocol schema scope. After that, this should get another review before moving toward `Accepted`.
---

# Re-review of r2 (2026-07-09, second round)

**Reviewer family:** GPT-5 (OpenAI)
**Provider / runtime:** OpenAI API via Codex CLI 0.143.0 (model gpt-5.5,
reasoning effort xhigh, read-only sandbox)
**Date:** 2026-07-09
**Redacted:** No — full read access to this repository and the Exact checkout
(`~/projects/exact`); `.agent-local-secrets.md` excluded by instruction in
both repos.
**Method:** cli-runner — non-interactive `codex exec` re-review of the r2
working-tree draft. The brief: verify each round-1 concern's resolution
adversarially, reconcile against Exact LLP 0329 r4 and its adversarial review
artifacts (`exact/llp/reviews/0329-*`, final dated sections), and give fresh
judgment on the whole with structural changes explicitly invited. This Codex
session did not author any revision of the document.

# Re-review (r2): LLP 0051 — The language-neutral data tier

## Overall assessment
Directionally good, but not ready to accept. r2 fixed most round-1 factual issues. The new blocker is cross-repo skew: Exact LLP 0329 r4 now makes the typed `define.mjs` builder the first-class authoring surface and demotes Contract mutation grammar to an evidence-gated option, while 0051 r2 still leads with Contract source as the D2 front-end fix (`llp/0051-language-neutral-data-tier.rfc.md:294-305`, `:611-613`). That must be revised before the pair can advance.

## Round-1 concerns: resolution check
- **Ibex deterministic-member asymmetry: resolved.** r2 now states the V8/Ibex asymmetry as current fact and scopes the closure to queries/mutations (`llp/0051...:138-163`, `:213-221`, `:684-691`). Verified current tests pin the asymmetry (`tests/workerd_twin_v0.rs:271-325`) and the `Date.now` busy-wait users are registered as actions (`tests/action_watchdog_v0.rs:55-64`, `:152-159`).

- **All-aboard IR gate: regressed.** r2 added `DeleteWhere`/`InsertEach`, but now falsely says all three all-aboard mutations are clear-and-replace snapshot appliers (`llp/0051...:324-335`, `:701-707`). Verified code: `applyFeedTick` reads state/ticks, computes modulo, templates `tick-${nextIndex}`, indexes `delays[patternId]`, patches six rows, deletes liveDepartures, and patches state (`demos/all-aboard/snapback/handlers.mjs:455-480`). `applyLiveFeedSnapshot` has conditional writes via `hasOwnProperty` (`:490-495`) plus insert-each (`:500-517`). `resetFeed` is mostly unrolled patches + delete (`:533-548`). The gate remains unsatisfiable as written.

- **LLP 0032 DK-1/E3 engagement: resolved.** r2 now names Option B as the `Get`/`Guard` extension and says accepting 0051 ratifies-and-extends E3 (`llp/0051...:348-366`). That matches DK-1/E3’s record of Option A plus future Option B costs (`llp/0032-decision-and-implementation-hardening.plan.md:538-571`).

- **Reads-are-never-ledgered: resolved.** r2 states the rule and distinguishes server replay, conformance replay, and client overlay reads (`llp/0051...:245-255`, `:542-546`).

- **D3 cpu_budget honesty: resolved.** r2 moves to artifact-class reporting for WASM while target-level local CPU remains Missing (`llp/0051...:419-428`; current target row at `src/manifest.rs:1061-1079`).

- **D4 scope: resolved.** r2 now admits the non-JS client inventory is larger than the live envelope and gates the non-JS-client claim on full client-visible wire coverage (`llp/0051...:470-486`).

- **Corpus infrastructure status: resolved.** r2 says LLP 0010’s corpus format/runners are designed, not built, and stages through the twin harness (`llp/0051...:521-526`). Verified only `tests/conformance/twin-corpus.handlers.js` exists.

- **MCP catalog tense: resolved.** r2 says the catalog shape is designed, not generated today (`llp/0051...:607-610`; `llp/0024-agent-operating-surface.spec.md:390-403`).

## Cross-repo consistency with Exact LLP 0329 r4
0051 must be revised to match 0329 r4’s new authority split. Exact r4 says the committed track is E4–E6 plus corpus consumption, and explicitly says the typed builder is first-class while Contract grammar is only an option (`/Users/ccheever/projects/exact/llp/0329-snapback-language-neutral-data-tier.rfc.md:48-79`, `:61-66`, `:537-558`). 0051 still says “With a Contract-source front-end” (`llp/0051...:55-64`), demonstrates Contract source as “the front-end fix” (`:294-305`), says agents author against a Contract front-end (`:611-613`), and treats Contract as the existing authoring grammar in Alternatives (`:733-736`). These should become typed-builder-first, Contract-option language.

The §Relationship section is obsolete. It refers to Exact 0329 r2/r3 and says Exact should take an r3 on acceptance (`llp/0051...:650-671`). It should cite 0329 r4 and state: Snapback owns IR/profile/version/ledger/WASM/wire/corpus/typed builder; Exact commits to evaluators, DataProvider overlays/receipts, Acto, and corpus consumption; Contract grammar is evidence-gated (`0329...:499-514`).

0051’s Increment 3 gate must incorporate the flow-back from 0329 r4 and its reviews. Exact r4 records: todo-class CRUD is the Contract-source gate, all-aboard set-oriented work is builder-authored IR evidence, and `applyLiveFeedSnapshot` is the negative exemplar (`0329...:540-549`). The r3 adversarial reviews explain why: `DeleteWhere`/`InsertEach` cover fragments, not the whole handlers (`/Users/ccheever/projects/exact/llp/reviews/0329-snapback-language-neutral-data-tier.fable.md:230-240`; codex concurs at `...codex.md:243-247`).

Snapback-side issues raised by 0329 reviews that still matter: classify the real mutation corpus instead of asserting “80%” (`...codex.md:243-247`); keep reducers first-class and make overlay class per-mutation in receipts (`...codex.md:267-271`, `0329...:445-456`); ensure divergence-table rows have Snapback corpus cases before Exact compiler enforcement (`0329...:376-388`); make corpus consumption by reference concrete (`0329...:390-398`); and name filtered-read guards as out of profile or add `Exists`/`Count` later (`...fable.md:270-274`).

## New concerns
- **blocking — Increment 3’s all-aboard gate is still false.** `applyLiveFeedSnapshot` has data-dependent conditional writes (`handlers.mjs:490-495`), so it is an “outgrew IR” case under r2’s own exclusion of cross-step data-dependent control flow (`llp/0051...:339-341`). Resolve by replacing gate (b) with a classified table: covered by builder IR, covered only after source reshaping, and JS/WASM. Use `applyLiveFeedSnapshot` as the negative gate.

- **major — `Get`/field-access semantics are underspecified for the actual acceptance corpus.** `applyFeedTick` needs missing-row/default behavior, `Number.isInteger`, modulo, string-template ids, and bracket access into hyphenated JSON keys (`handlers.mjs:455-464`; `PATTERN_IDS` at `:11`). 0051 D2 names field access and templates but not missing-row semantics or bracket-key access (`llp/0051...:309-323`). Resolve by specifying them or excluding that handler from the v1 profile.

- **major — 0051 still structurally overweights Contract grammar.** After 0329 r4, Contract source is not a committed increment. Resolve by making the extended typed builder the first-class authoring surface in Summary, D2, D8, Alternatives, and Increments.

- **minor — Q2 should no longer be framed mainly around the Contract compiler.** Exact r4 commits to corpus consumption for evaluators regardless of grammar (`0329...:390-398`). Resolve by making Q2 “Exact evaluator/compiler consumers by reference,” with the compiler conditional on the option firing.

## Suggestions
- Add a “real mutation profile table” before acceptance: todo/todo-v2, all-aboard `applyFeedTick`, `applyLiveFeedSnapshot`, `resetFeed`, plus one auth guard and one filtered-read guard.
- Split Increment 3 into builder/profile/corpus first, Contract option later only through 0329’s trigger.
- Add a small capability table for `derivedOptimisticOverlays`, `offlineReplay`, reducer fallback, and per-mutation overlay class.
- Promote the ledger wire split table from Q7 into D1: `{generatedIds, now}` cross wire per LLP 0008 (`llp/0008-local-first-sync-and-realtime.rfc.md:300-309`); auth context/fingerprint stays server-retained unless a future RFC changes it.

## Recommended next step
Revise and keep `Draft`. The author should produce 0051 r3 in lockstep with Exact 0329 r4: typed-builder-first, Contract grammar evidence-gated, Relationship updated, and Increment 3 re-gated around the verified all-aboard facts. D1/D4 remain good early increments; D2 should not advance on the current all-aboard acceptance claim.