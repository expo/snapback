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
