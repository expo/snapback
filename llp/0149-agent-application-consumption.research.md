# LLP 0149: Agent-native application consumption

**Type:** Research
**Status:** Active
**Systems:** Agent application consumption, Application data API, App CLI,
MCP, Auth, Client protocol, Code generation, Diagnostics, Guide, Testing
**Author:** Charlie Cheever / Codex / Claude (Fable 5)
**Date:** 2026-08-01
**Revised:** 2026-08-02 (decision-sitting propagation: Slice 0 ownership is
assigned to LLP 0062's served envelope for both the consumption descriptor and
the operation-journal projection; source:
`issues/20260802-author-decision-packet.md`). 2026-08-02 (v0.5 — promoted Draft→Active on the author's
adjudication after round-4 convergence: dual-family loop closed
with Fable READY ×2 and Codex citation-only residue; the drifted 0147 anchor
re-pinned by content, two wording completions. Earlier, rounds 1–3 applied:
assessment ideas corrected (A1–A7), refusal-typing row and per-kind matrix
fixed, cross-plane dry-run facts and grant-fact/guardrail inventory made
honest, A5 scoped to platform gates, Slice 2 aligned with A7, A6 split into
effect-hermeticity vs data safety, retry-hint carrier reopened to 0144 OQ3.
Per-round record: `llp/reviews/0149-*` — Fable 5)
**Related:** LLP 0010, LLP 0011, LLP 0012, LLP 0019, LLP 0024, LLP 0037,
LLP 0042, LLP 0043, LLP 0055, LLP 0058, LLP 0059, LLP 0061, LLP 0062,
LLP 0093, LLP 0094, LLP 0095, LLP 0097, LLP 0108, LLP 0131, LLP 0133,
LLP 0134, LLP 0144, LLP 0146, LLP 0147

## Summary

Snapback is already unusually well prepared for agents that **author and
operate** applications. It has one structured host-operation core projected to
CLI, HTTP, and MCP; a generated app-data MCP catalog; a version-bound served
guide; scoped agent principals; structured argument and result contracts;
declared application refusal codes; durable mutation settlement; and a
generated per-app CLI programme.

The remaining opportunity is different: make a Snapback application itself
excellent for an agent to **consume**. Starting with only an application target,
a consuming agent should be able to:

1. discover what the application can do;
2. determine what it may do under its current authority and budgets;
3. choose a small relevant operation set without loading the whole application
   into context;
4. preview an effectful operation through the authoritative execution path;
5. execute without guessing about retry safety;
6. reconcile an interrupted or ambiguous outcome;
7. keep large values outside model context without losing exact custody; and
8. resume the task after process or model-context loss with enough evidence to
   know what remains.

The recommended product frame is one **agent consumption protocol**:

```text
discover -> select -> preflight -> authorize -> execute -> reconcile -> verify/resume
```

This is not a recommendation for a fourth API dialect. The protocol should be
a composition of facts and authorities already owned by the function manifest,
app envelope, result/refusal contracts, agent grants, settlement ledger, guide
manifest, and target capability reports. CLI, MCP, generated clients, and any
future agent UI remain projections.

The highest-leverage new primitive is a versioned per-operation
**consumption descriptor**: a join over the facts an agent needs to select and
safely invoke an operation. The highest-leverage new behavior is a uniform
**operation journal and reconciliation loop** over the mutation settlement
identity Snapback already ships. Preflight-to-commit continuity, resumable agent
sessions, and isolated workspaces follow only after those two foundations are
real.

This document is Research. It recommends a direction and work decomposition;
it does not ratify wire shapes, authorize implementation, or supersede the
owning LLPs named below.

A second model family reviewed this document on 2026-08-01 and concurred with
the direction and sequencing; its sharpenings and additional ideas (per-fact
provenance, version-conditioned invocation, effect-class ceilings, trust
labeling, and others) are recorded in §Second-model assessment. A dual-family
super-refine loop then reviewed the document; its verified findings are
applied in place and journaled under
`llp/reviews/0149-agent-application-consumption.super-refine.md`.

## Numbering note

LLP 0148 is intentionally not reused in this checkout. During authoring,
`llp/0148-prefixed-identifiers.decision.md` was confirmed on another git ref.
This document therefore takes 0149 so the parallel histories can merge without
a numbering collision.

## Scope: the consuming agent

LLP 0019 distinguished build-time agents from runtime AI inside an application.
This document introduces neither a third runtime nor an AI query language. Its
subject is an external **consuming agent** acting through an application's
ordinary data plane:

- an assistant managing a user's bookings through a Snapback application;
- an automation agent updating a project under a scoped grant;
- a coding agent exercising the app it just authored, but now as an app
  principal rather than as a Snapback operator; or
- a tool-driven agent calling queries, mutations, actions, and live queries
  through CLI, MCP, or a generated client.

The same process may be both author and consumer at different times. The
authority boundary is the distinction: host lifecycle, schema loading, deploy,
and reset are operator-plane work under LLP 0024; application functions are
app-data-plane work under LLP 0012, LLP 0042, and LLP 0062.

## Method and overlap survey

This research reviewed the current agent, CLI, MCP, guide, auth, settlement,
contract, and recent client/authoring LLPs before proposing new surface. The
result is that many attractive ideas are already owned, and the new work should
join them instead of renaming them. The table necessarily collapses shipped,
accepted-but-future, and proposed states; where that distinction is
load-bearing for a row, the row says so.

| Existing authority | What it already owns | Boundary for this research |
| --- | --- | --- |
| LLP 0010 | Structured diagnostics, capability reports, inspectable artifacts, agent-checkable acceptance | Preserve the stable-code/no-log-scraping discipline |
| LLP 0019 | Operating-surface research, dry-run, checkpoint/restore, permission graph, context pack, cost visibility | This document narrows the remaining question to application consumption |
| LLP 0024 / LLP 0042 | One host-op core with CLI/HTTP/MCP projections; generated per-function app-data MCP candidate catalog; mutation dry-run shape | Do not mint a second result envelope or MCP-only semantics |
| LLP 0043 / LLP 0133 | Durable `clientMutationId`, exactly-once settlement lookup, acknowledgement lifecycle, authoritative settlement receipts | Reconciliation must project this machinery, not approximate it in a new ledger |
| LLP 0055 / LLP 0059 | Agent principals, scoped grants, authority descriptors, revocation and client fencing | Discovery never grants authority; effective views are server-derived |
| LLP 0061 | Build-bound guide manifest, capability index, intent aliases, served pages, and guide MCP resources | Retrieval should return slices of this corpus, not generated prose as authority |
| LLP 0062 | App envelope, generated CLI/code mode, generation-bound calls, explicit mutation outcomes; future journal/`resolve`, transcripts, lock file, output-to-file, changed-since, and app MCP | Most execution mechanics belong as extensions of 0062, not a rival CLI |
| LLP 0108 / LLP 0131 / LLP 0144 | Result contracts, argument contracts, and declared refusal vocabularies with server-side admission | Success paths are contract-typed today; refusal typing lands at declaration and admission only — LLP 0144 deliberately keeps the vocabulary off the protocol descriptor and client consumption is untyped reach-through (`llp/0144:201-208, 381-386`), so descriptor refusal facts are dependencies on 0144's open surface decisions |
| LLP 0146 | Authoring-side conformance, `verify`, agent digest, semantic diff, typed remediations; defers least-authority planning, causal trace, and authoring workspace | Consume its facts; do not duplicate its authoring oracle or workspace design |
| LLP 0147 | Ahead-of-time compiled Micro client, exact generated wrappers, transport/lifecycle minimum, honest ambiguous outcomes | Consumption descriptors are discovery/control artifacts, not browser runtime baggage |

Two overlap conclusions are load-bearing:

1. **The generated app-data MCP catalog is already the seed of the consumption
   descriptor.** It carries operation identity, input/output shape, kind,
   required capabilities, authority requirement, dry-run support, source span,
   and bundle identity. The missing work is a richer, authority-separated join,
   not another catalog.
2. **Mutation reconciliation is already a server/client correctness
   mechanism.** The missing work is an agent-facing durable journal and
   `resolve` projection. A generic retry wrapper would be a regression.

## Findings

### F1. Static discoverability is not effective actionability

**Confidence: High.**

The current manifests and app CLI can answer “what functions exist?” and “what
is this function's static auth requirement?” They cannot, without invoking the
server, answer the separate question a consumer actually has: “under the
authority I hold right now, is this operation callable, what additional grant
would it require, which target capability is missing, and what limit would bind
the call?”

The distinction must remain structural:

- a **static descriptor** is source-stripped, principal-independent,
  generation-bound application data; and
- an **effective actionability view** is authenticated, server-derived,
  short-lived state about one authority and target.

Putting dynamic grant membership into a public static envelope would leak
principal state and make an immutable content address lie. Predicting it in the
client would duplicate authorization semantics. A dynamic view therefore joins
the static descriptor by identity and says only what the server can honestly
establish for the presenting authority — and it must itself be identity-bound
(generation, authority instance, observation time, expiry) so that a later
disagreement is classifiable as matched, stale, or invariant-violated rather
than read as a defect.

The tree already shows why one boolean cannot carry these facts: the
generated catalog publishes `dryRunSupported: false`
(`packages/snapback-cli/mcp-control.mjs:144`) while the runtime serves
`mutationDryRun` on the operator plane only (`crates/snapback/src/host_ops.rs:1686-1701`).
For the scoped consuming agent both are honestly "unavailable" today — this
is not a static/effective disagreement — but the flag cannot say which of
runtime support, projection availability, target support, or
current-authority reachability it reports, and the descriptor and effective
view must keep those facts distinct.

### F2. Function schemas are necessary but insufficient for safe selection

**Confidence: High.**

An argument schema tells an agent how to call a function; it does not tell the
agent whether the call is read-only, durable, externally effecting, retryable,
confirmation-worthy, context-expensive, or naturally verified by a later read.
Function kind supplies part of that answer but not all of it: actions may send
email or perform a read-only fetch; a mutation may be idempotent at the domain
level or may create a new durable object; a live subscription can arm
billing-visible demand on a hosted target under LLP 0093.

These are **operation safety facts**, not prose decoration. Some are derived
authoritatively from the function kind, manifest, capability ceiling, and
runtime contract. Others cannot be inferred and must remain `unknown` until the
application declares them through an owning authoring design. An LLM-generated
description must never become the authority for retry, effects, or grants.

### F3. Eager per-function tools do not scale with agent context

**Confidence: High on the problem; Medium on the exact MCP projection.**

LLP 0024 correctly defines every generated function as a candidate MCP tool.
For a small app, eagerly publishing each candidate is ideal. For a large app,
hundreds or thousands of tool definitions consume context, create collisions,
and reduce selection quality before the agent has begun its task.

The catalog should therefore support two projections over the same entries:

- **eager tools** below a measured size/count budget; and
- **catalog tools** above it: search, describe/materialize, invoke, subscribe,
  and resolve, returning only the relevant descriptors.

Intent matching should begin with deterministic capability IDs, aliases, names,
types, and guide-manifest metadata. Semantic retrieval may rank candidates, but
it cannot mint identity, authority, or safety facts.

### F4. Dry-run and commit are presently two unrelated acts

**Confidence: High on the gap; Medium on the remedy.**

Snapback's mutation dry-run uses the real buffered execution and commit
validation path, which is the correct foundation. It is also, today, an
operator-plane affordance only: `function.explain` runs under host-ops
dev-user authority (`crates/snapback/src/host_ops.rs:1701`), LLP 0055 pins `dryRun: false`
for agent principals in v1, and agent-principal dry-run is named future work
in LLP 0062 — so any preview promised to a consuming agent has a prerequisite
the corpus has named but not built. And a successful dry-run does
not bind a later invocation. Between preview and commit, the application
generation, authority, data version, read-set, deterministic inputs, or target
capability state may change.

For low-risk local authoring, “preview and call again” is useful. For a
consuming agent asking a human to approve an effect, the approval should refer
to a stable plan receipt, and the later commit should either remain within that
receipt or refuse as stale.

The likely shape is a short-lived, server-minted plan identity bound to the
operation, generation, authority/grant, argument digest, captured read/write
summary, deterministic runtime inputs, effect class, and expiry. It should not
hold a database transaction open while a human thinks. The commit path would
re-execute through the ordinary authoritative path and compare the new facts
with the approved plan, refusing on a material delta. Exact comparison rules,
predicate/read-set binding, and treatment of generated ids require a dedicated
RFC; this Research does not decide them.

Actions need a different contract. A preview can report declared capabilities
and prospective external effects, but it cannot execute an external effect and
call that a dry-run. No plan token makes an unmediated network side effect
reversible.

### F5. Outcome reconciliation is more important than automatic retry

**Confidence: High.**

Agents and tool hosts lose responses, hit timeouts, restart, and retry. A
consumption surface that reports only success/failure trains duplicate effects.
LLP 0062 already has the right per-kind posture: reads may be retried under
current authority; mutations use a durable `clientMutationId` and recover
the exact settlement; actions without an idempotency contract report an
unknown outcome and must not be retried automatically. The matrix below
makes the posture exhaustive.

The missing primitive is the future work LLP 0062 names: an authority-bound
operation journal with `resolve <id>`. It should be promoted from CLI polish to
the central agent consumption loop. Before dispatch, the credential-owning
parent durably records the target, app/function identity, arguments digest,
generation, authority descriptor, operation class, and request or mutation
identity. It then records only evidence-backed transitions:

```text
prepared -> not-dispatched                     (failure before dispatch)
prepared -> dispatched -> settled | refused | outcome-unknown
settled  -> durably-consumed -> acknowledged   (mutations only, per LLP 0043)
```

`outcome-unknown` never acknowledges, and for actions without an owning
idempotency contract it is terminal. Mutation resolution consumes LLP 0043's
settlement lookup and acknowledgement state machine. Queries may reissue.
Actions can resolve only when their owning contract supplies a trustworthy
idempotency/receipt mechanism; otherwise `outcome-unknown` is terminal
evidence, not a retry hint.

Per-kind semantics, in one place, because this is where they leak into each
other if left implicit:

| Kind | Dispatch identity | Safe retry | Reconciliation | ACK | Preview |
| --- | --- | --- | --- | --- | --- |
| query | request id | yes, under current authority | reissue | — | not needed |
| mutation | durable `clientMutationId` | only via settlement replay | LLP 0043 settlement lookup | yes | dry-run (operator-plane today; F4) |
| action | request id | never automatic | owning contract, else terminal unknown | — | declared effects only, no execution |
| live subscribe | subscription/demand identity | resubscribe re-arms demand | cursor + re-attestation | — | not needed |

### F6. Agent auth has enforcement but not yet a task compiler

**Confidence: High on value; Medium on inference limits.**

LLP 0055 makes scoped agent grants real, and LLP 0146 accepts least-authority
planning in principle. The next consumption step is to compile a chosen set of
operation descriptors into the smallest **reviewable grant request** Snapback
can justify:

- exact function scopes rather than tier-wide wildcards where possible;
- target and capability requirements;
- authority-creating status;
- resource selectors only where the application's declared grant vocabulary
  can express them;
- TTL, call count, concurrency, and spend/effect ceilings; and
- an explicit list of facts Snapback cannot infer.

Of the limits named, only expiry is a configurable grant fact today: the
grant record carries scopes and `expires_at` (`llp/0055:920-944`). The
ten-live-tokens-per-grant cap is a fixed carrier-custody constant
(`llp/0055:898-905`), and the throttles govern auth routes, not invocation
under a grant (`llp/0055:1154-1165`) — fixed platform guardrails, which are
neither requestable nor reviewable consent. Per-grant call-count,
concurrency, spend, and effect-class ceilings are new surface the compiler
can only propose once 0055 grows them.

The compiler proposes and submits a request; it never approves one. A later
operation outside that task set requests step-up rather than silently widening
authority. This work should extend LLP 0146 D7's `requestGrant` remediation and
LLP 0055's grant model instead of creating a consumption-only token type.

### F7. Process-per-command is a poor unit for long-running agent work

**Confidence: Medium.**

An agent task outlives individual CLI calls and often outlives a model context.
Re-reading the full catalog, reminting scoped tokens, rebuilding subscriptions,
and reconstructing ambiguous writes from stdout is wasteful and unsafe.

A **consumer session** should durably bind:

- target and app/envelope generation;
- the selected operation-descriptor subset;
- an opaque reference to credential-broker custody, never bearer plaintext;
- grant, expiry, and remaining budgets;
- the operation journal and unresolved outcomes;
- live subscription cursors and explicit release obligations;
- large-result artifact references; and
- the last verified receipt and digest cursor.

This is adjacent to but distinct from LLP 0146's deferred **authoring
workspace**. The authoring workspace adds a disposable branch, captured
effects, semantic diff, and promotion. A consumer session can begin without
branching: it is durable coordination and custody around ordinary app-data
calls. If branch-backed workspaces later land under LLP 0097, the consumer
session can adopt one as its target rather than defining promotion itself.

### F8. Result size is a protocol concern for agents

**Confidence: High.**

LLP 0062 correctly refuses oversized stdout rather than emitting truncated
JSON, and names `call --output <file>` as future work. LLP 0146 correctly
rejects one universal continuation scheme: reads, mutations, actions, streams,
diagnostics, and digests have different completeness rules.

The consumption protocol should preserve that per-kind discipline while
standardizing **exact-value custody outside model context**:

- queries use application cursors or bounded pages;
- mutations return one complete value/receipt or a typed size refusal, never a
  truncated “success”;
- actions and streams use declared byte/item/time budgets;
- large diagnostics/evidence become redacted artifacts; and
- local CLI/MCP hosts may retain exact result bytes in a content-addressed,
  authority-bound artifact store and return a bounded preview plus digest,
  schema, byte/item counts, expiry, and opaque handle.

The first implementation can be client-local. Nothing here requires the public
app server to become a generic blob store. Handles to sensitive values must be
authority-bound and never appear in public descriptors or logs. The frame
shapes and tolerance floors these budgets bound are owned by the wire envelope
and client lifecycle contracts (LLP 0094, LLP 0095).

### F9. “The application is verified” and “the requested task completed” are different receipts

**Confidence: High on the distinction; Medium on a generic postcondition
surface.**

LLP 0146 D2's `snapback verify` is an authoring oracle: artifact freshness,
runtime readiness, capability resolution, and acceptance profiles (its
precedence list, `llp/0146:451-462`). It does not
prove that a user's requested booking was cancelled or a project item was
moved.

Consumption receipts should therefore remain operation-scoped: mutation
settlement, commit version, attribution, result/refusal contract, and optionally
a fresh follow-up query chosen by the agent or declared by the application.
Snapback should not claim the product-level task is complete merely because a
mutation returned success. A generic postcondition DSL is not recommended
without its own boundedness and authorization design.

## Recommended direction

### R1. Define one consumption descriptor, as a join over existing authorities

The working name in this Research is `OperationConsumptionDescriptorV1`; the
final name remains open. The 2026-08-02 author decision assigns ownership to
LLP 0062's served envelope. It extends that envelope/catalog family rather
than establishing a new operation identity.

The static descriptor should carry, where authoritative:

- operation id, name, kind, app/envelope generation, and contract identities;
- argument contract, result contract, and declared refusal union;
- static auth requirement, required target capabilities, and syncability;
- declared reads/writes and effect ceiling, clearly labeled as declarations;
- derived retry/outcome class and settlement support;
- dry-run/preflight availability;
- output mode and hard byte/item/time ceilings;
- demand/lifecycle facts relevant to subscriptions;
- risk and confirmation facts only where declared by an owning schema;
- capability IDs, guide resource IDs, intent aliases, and verified examples;
  and
- explicit `unknown`/`unsupported` values for facts the system cannot prove.

Field admission is a rule, not taste (adopting §Second-model assessment's
sharpening): every descriptor field must name the authority that produces it,
the consumer decision that branches on it, its disclosure class, and its
volatility and evidence type. A field
no agent decision branches on is guide prose, not descriptor surface.

An authenticated effective view joins by descriptor/generation identity and
adds current callability, grant/scopes, missing target capabilities, budget
facts, step-up requirement, and typed remediations. It never mutates or
personalizes the immutable public descriptor.

### R2. Project context-bounded discovery over the descriptor

Keep generated eager tools for small applications. Add a catalog projection
for large applications using a tiny stable tool family such as:

```text
search_operations
describe_operations
plan_operation
invoke_operation
subscribe_operation
resolve_operation
```

The names are illustrative, not decisions. `plan_operation` projects
preview, not the plan receipt: concretely, today's `mutationDryRun` explain
kind — operator-plane only until F4's agent-reachable prerequisite lands —
and for actions nothing yet, since an effects report exists only once an
effect-declaration grammar does (OQ3, OQ14). The plan *receipt* that would
bind preview to commit remains Slice 4's dedicated RFC. The
important properties are that selection is bounded, descriptors remain the
single data source, and all execution/result semantics stay shared with
CLI/HTTP/client projections.

Diagnostics should be able to carry stable capability/guide resource
references. A consumer asks the served guide for the smallest deterministic
context slice covering the selected descriptors, target, and refusal—not for
freshly generated prose.

### R3. Land the operation journal and `resolve` before general plan tokens

Reconciliation solves a correctness problem every consuming agent has today
and builds almost entirely on LLP 0043/0062 machinery. Preflight-to-commit
continuity is valuable but introduces new concurrency semantics. Build the
journal and resolution surface first, with projection parity across CLI and
MCP, then design plan tokens against an already durable invocation identity.

### R4. Add effective-authority and grant-request projections after descriptors

The static descriptor makes a requested task set nameable. The effective view
makes the current gap nameable — projecting the shared invocation-authority
vocabulary LLP 0058 owns (`llp/0058:1049`, the shared type layers and
invocation gate), never inventing authority language of its own. LLP
0146 D7's remediation vocabulary and LLP
0055's grant requests then have enough structure to propose a least-authority
request without inventing policy.

### R5. Treat consumer sessions as a composition, not a new authority

A session owns local custody, journal, selected descriptor set, cursors, and
artifact handles. It does not mint permissions, preserve revoked authority, or
turn an old effective view into current truth. Every resume re-attests target,
generation, and authority before new effects.

## Suggested build sequence

### Slice 0 — ownership and schema placement

**Author decision — 2026-08-02.** LLP 0062's served envelope owns the static
consumption descriptor and the operation-journal projection. This is ownership
of the existing authority's projections, not permission for a fourth manifest
or result envelope. Source: `issues/20260802-author-decision-packet.md`.

- Extend the LLP 0062 served envelope with the static consumption descriptor
  and operation-journal projection.
- Amend LLP 0012/0024/0037/0062 as required rather than introducing a fourth
  manifest authority.
- Specify public versus authenticated fields and disclosure classes.
- Add guide capability GAP rows, with LLP 0134 maturity markers, before
  claiming a surfaced feature.

### Slice 1 — descriptor and bounded discovery

- Join argument/result/refusal contracts and existing catalog facts.
- Add guide/capability references and explicit unknowns.
- Implement size-aware eager-versus-catalog MCP projection.
- Prove CLI/MCP descriptor parity and source-stripping.

### Slice 2 — durable reconciliation

- Implement the authority-bound operation journal and `resolve`.
- Reuse `clientMutationId` and the LLP 0043 settlement/ACK lifecycle.
- Keep every action's unresolved outcome terminal at the generic engine; a
  declared idempotency key is recorded for human or app-specific
  reconciliation only (A7), and only a separately designed, enforced owning
  contract may introduce a nonterminal action-resolution class.
- Add context-external result artifacts under per-kind completeness rules.

### Slice 3 — effective actionability and task grants

- Add the authenticated server-derived effective view.
- Integrate typed remediations and least-authority grant requests.
- Make step-up explicit; never let discovery or planning self-approve.

### Slice 4 — preflight/commit continuity

- Design the plan receipt/token in a dedicated RFC.
- Re-execute and compare rather than holding a transaction across approval.
- Refuse material drift in generation, authority, inputs, reads/writes, or
  declared effect class.
- Keep actions outside the mutation guarantee unless their effect provider has
  its own idempotency/preview contract.

### Slice 5 — resumable consumer sessions

- Add brokered credential custody and opaque local session handles.
- Persist selected descriptors, budgets, journal, subscriptions, and artifact
  references.
- Compose with LLP 0146/0097 workspaces later; do not block the non-branching
  session on effect-isolated promotion.

## Second-model assessment (Fable 5, 2026-08-01)

This section was written by a second model family after reading this document
against LLP 0024, 0043, 0055, 0062, 0146, and 0147, with targeted checks of
LLP 0011, 0061, 0093, 0133, and 0144 where the ideas below lean on
them. It records where the assessment concurs, where it would sharpen the
text, and eight additional ideas (A1–A8) with sequencing implications. It
shares this document's non-authority: nothing here ratifies a wire shape.
(Round 1 of the super-refine loop found this section's original ideas
overstated in six places; the versions below are the corrected ones, and the
uncorrected originals are preserved in the review artifacts.)

### Concurrence

The document's two load-bearing overlap conclusions hold up against the
current corpus. The generated catalog entry already carries the identity,
schema, and authority core of the static descriptor — though none of its
refusal, retry, effect, risk, or guide facts, and the implemented catalog is
thinner than its spec: `outputSchema` is always `'unknown'` and
`dryRunSupported` is hardcoded `false`
(`packages/snapback-cli/mcp-control.mjs:135-144`), which is evidence for
R1's remaining work, not against the seed claim. And LLP 0062's future-work
list already names the journal, `resolve`, transcripts, `changed-since`, and
the token broker — so the honest finding is that most of this Research is
joining and sequencing existing authorities, and the document says so. That
is its main strength.

**Journal before plan tokens (R3) is the most important call here, and it is
correct** for a reason worth stating structurally: the journal introduces no
new concurrency semantics — every transition it records is evidence the
system already produces (LLP 0043 settlement lookup, LLP 0062's per-kind
outcome contract) — while plan tokens require a materiality comparison nobody
has designed yet. Building the comparison before the identity it compares
over would put the harder design on an unstable foundation.

**The static/effective separation (F1) is right**, and right for one more
reason the text understates: cacheability. A descriptor that is honestly
principal-independent can be content-addressed, shipped in the envelope,
mirrored into context packs and skills, and trusted offline. One
principal-dependent field poisons all of that. The separation is not only a
security boundary; it is what lets discovery be cheap.

### Sharpenings

1. **Descriptor field sprawl is the main design risk in R1.** The field list
   is already long, and Research-stage lists only grow. Recommended admission
   rule for the owning RFC: every descriptor field needs both an owning
   authority that produces it and a named consumer decision that branches on
   it. If no agent behaves differently because of the field, it is prose and
   belongs in the guide, not the descriptor.
2. **The effective view needs a stated enumeration posture now, not only an
   open question (OQ4).** The safe default: the effective view answers only
   about descriptors presented by identity (batched is fine); it never
   enumerates what an authority can do server-side. "What may I do?" is
   answered by client-side join of the static catalog with per-descriptor
   answers — compatible with "no client-side permission oracle" precisely
   because each per-descriptor answer is server-derived; the client only
   joins. That posture can be revised later; starting without one invites
   an enumeration oracle by accretion.
3. **The eager/catalog cutover (F3) should be measured in serialized bytes of
   tool definitions, not tool count**, since context cost is what the budget
   protects. And the catalog tools should be present in both projections: an
   eager session still needs `search`/`describe` when the app generation
   changes mid-session and new operations appear.

### Additional ideas

**A1. Per-fact provenance as evidence records.** F2 distinguishes derived
facts from declared ones, but the R1 descriptor shape does not carry the
distinction. Every operation-safety fact should carry its evidence: a
`derived` proof from kind or capability ceiling, a `declared` record of what
the application asserted, an `observed` record naming the mechanism and
generation that produced it, or explicit absence (`unknown`). These are
independent records, not one exclusive grade — a fact can be both declared
and observed with different values, and that disagreement must be
representable, because it is the false-declaration detection state.
Consumers calibrate accordingly: derived read-onlyness can skip
confirmation; a declared-but-never-observed idempotency claim cannot. Scope
honesty: the observation machinery that exists is LLP 0146 D1's
declared/captured conformance, and it observes read/write dependency sets
only — actions have unsupported captures, and nothing observes idempotency,
external effects, reversibility, or confirmation-worthiness. Those facts
stay declared-or-unknown until an owning observation or enforcement design
exists. Within that scope, OQ3's detection story rides machinery 0146
already builds — no new oracle.

**A2. Version-conditioned invocation as the stepping stone to plan tokens.**
The dominant agent race is read → decide → write, and full plan receipts
(Slice 4) are the heavyweight cure. A lighter primitive covers the common
case: an invocation may carry an optional precondition — "refuse unless this read
identity is still current." The identity that exists today is the storage
commit version: live replace/delta frames carry it as their `version: u64`
(`llp/0093:213-214`), and the settlement receipt binds its committed
`snapshotVersion` to the same commit order (LLP 0133). No query-result
digest or narrower read identity exists yet — whether one should is exactly
OQ13, and this idea must not smuggle that open question in as existing
machinery. The refusal is typed and carries the current identity, so
the agent re-reads and re-decides. This is compare-and-set for agents: no
held transaction, no materiality DSL. The natural candidate owner is the
existing conflict/settlement path — whether it can admit and evaluate the
comparison without a second evaluator is OQ13, and stays open. One honest
caveat bounds the idea's reach: a global commit-version precondition also
stales on unrelated writes, so its refusal rate in practice, not this
document, decides how much of the race it usefully covers. It belongs
between Slice 2 and Slice 4, and it cheaply
measures demand for the machinery Slice 4 generalizes.

**A3. Effect-class ceilings in grants; approval identity in the journal.**
F2's confirmation-worthiness fact and F4's plan receipt remain UX advice
until something enforces them. Join them to LLP 0055: a grant should be able
to carry an effect-class ceiling — for example, reads and reversible
mutations autonomously; external effects only with an approved plan receipt
attached to the invocation. The plan token then stops being a courtesy and
becomes the credential that lifts the ceiling for one planned effect. The
journal records the approval identity (who approved, which plan, when), so
audit can distinguish autonomous effects from human-approved ones. This
retroactively strengthens R3's sequencing: the approval record needs a
durable journal to live in before plan tokens are worth minting.

**A4. Trust labeling of results — a direction with a missing prerequisite.**
A consuming agent reads data other principals wrote, and some of it is
adversarial — prompt injection through user-generated content is now a
standard attack on tool-using agents. Snapback's position owning schema,
functions, and invocation authority makes it a natural place to label result
content for agent hosts — but the derivation this needs does not exist yet,
and pretending otherwise would weaken the very defense it aims at. Write
authorization today is imperative — mutations run with `ctx.auth` and may
reject unauthorized changes (`llp/0011:259`) — with declarative write-side
rules still a draft shape (`llp/0011:181-196`). The only static
approximation is function write summaries joined with per-function auth
requirements, and those are declarations of exactly the class LLP 0146's own
correction found unreliable. Until an enforced write policy or recorded
value provenance exists, the honest posture is the floor: tool projections
treat every application-sourced value as untrusted content, uniformly. The
dangerous artifact is the positive label — `operator-only` derived from an
unenforced declaration is an unsupported trust claim — so no positive label
ships before the owning design. The idea earns its place as a follow-on only
in that gated form.

**A5. One platform-refusal vocabulary: a platform refusal is the effective
view learned late.** R4 keeps the effective view and typed refusals
adjacent; the stronger claim should be made — scoped to the boundary LLP
0144 pins. Two namespaces exist and stay separate: platform actionability
(grant and capability gates — host denials 0144's I6 keeps terminal,
uniform, and outside the application channel — plus budget gates, proposed
platform-owned denials whose vocabulary belongs to their eventual
diagnostic/authorization owner) and application
refusals (`appCode`: app-authored disclosure raised inside permission-gated
handlers, 0144's I2/I7). The effective view predicts only the first. For a
platform gate, a refusal from an attempted call and an effective-view
answer for the same descriptor under the same authority must name the same
missing fact, the same remediation, and the same step-up path. Application
refusals it does not predict — a business-state refusal exists only by
executing application logic, which is OQ4's cost and enumeration problem.
Then attempt-based discovery is principled for reads — the cheapest probe
there is — and preflight exists precisely for the calls where attempting is
unacceptable. The consistency claim needs its identity
stated: the effective view is a dated receipt bound to generation, authority
instance, and expiry, and grants expire, get revoked, and lose scope to
manifest activation between view and call. Disagreement therefore has three
honest outcomes — prediction matched, view stale, or invariant violated —
and only the last, a same-identity disagreement, is a server defect. That
narrowed invariant is still a free acceptance check.

**A6. Executable task exemplars instead of prose recipes.** LLP 0062 names
call transcripts and `run --replay` as future work; LLP 0061 makes guide
snippets CI-verified. Compose them — but as two mechanisms, not one, because
their safety properties differ. **Hermetic exemplar playback** replays a
recorded operation trace against recorded frames (LLP 0062's `run
--replay`, exactly): no server, no effects — effect-hermetic, but not
thereby safe to distribute. A transcript records full call and subscription
result documents, values kept separate and explicitly user-authorized (LLP
0062's transcript design; its default audit lane is a different, value-free
artifact), so playback fixtures stay under transcript custody and
disclosure rules; whether a value-redacted fixture class can exist — and
what replay means when a script branches on a removed value — is OQ16.
Playback proves the recorded shapes still parse and the script still
drives them.
**Live exemplar acceptance** executes the same named task ("cancel a
booking," "invite a member") as an ordinary acceptance scenario against
seeded, isolated, disposable state — queries and mutations only; actions run
as their declared-effects preview or against an app-supplied test double,
never as live external effects in CI, and a double that backs an acceptance
claim needs an identity, an isolation witness, and an enforced
no-live-provider contract. "Replay recorded operations against
current live state" is deliberately not a mechanism here — re-executing
recorded effectful traces is what LLP 0146 declined (Declined 3,
`llp/0146:926-948`). The descriptor's
"verified examples" then stop being hand-authored JSON that rots; they are
projections of the passing exemplar corpus, and "is this task still
accomplishable by an agent" is answered by the live-acceptance lane. This is
the agent-facing analogue of the guide's snippet-freshness discipline.

**A7. Declared action idempotency keys — reconciliation metadata, never
retry authorization.** A bounded step on OQ7: an action may declare that it
accepts a caller-supplied idempotency key and promises to thread it to its
external effect provider (the Stripe pattern). Snapback cannot verify the
promise, and LLP 0147 has already adjudicated the bar a declared retry input
must meet: its `idempotent` retry class is deliberately absent because such
a declaration requires naming its authoritative source, request identity,
artifact carrier, and compile-time diagnostic before it may carry policy
(the LLP 0147 paragraph beginning "An `idempotent` class is deliberately
absent rather than reserved-and-unused," cited by content because 0147's
line numbers drift under its concurrent revision; `llp/0147:721-726` as of
this revision). So the
declaration licenses nothing automatic — `outcome-unknown` stays terminal
for every action, exactly as F5 requires. Its value is narrower and real:
the journal records the key with the dispatch, and `resolve` presents it to
the human or app-specific reconciler who decides what to do, with the
provider-side deduplication as their tool rather than the engine's excuse.

**A8. The resume artifact is a delta briefing.** R5 says re-attest on
resume; say also what the resumed agent is handed: the LLP 0146 D3 digest
discipline applied to the session — a compact, stably-ordered diff since the
last verified receipt. Descriptor deltas from generation change
(`changed-since` over the envelope hash is already LLP 0062 future work),
settlements recovered for outstanding journal entries, expired
subscriptions, consumed budgets, revoked grants. Re-attestation says the
world may have changed; the delta briefing says what changed, in a budget a
fresh model context can afford.

Three smaller notes that need no idea-sized treatment:

- Budget and rate refusals should carry a machine-readable earliest-retry
  fact, so agents do not spin-poll. The owner differs by namespace: platform
  budget/rate denials belong to the diagnostic and authorization owners,
  outside LLP 0144's application channel. For application-declared refusals
  no standard carrier exists — 0144's landed slice is that declared
  refusals participate in no dispositions (E1, `llp/0144:423-429`), with
  hints and their owner open in its OQ3; a future owning amendment could
  standardize one, and until then any value in `appDetails` is
  app-specific and untyped.
- Whatever journal custody wins OQ8, its schema should permit multiple
  targets in one store — real agent tasks span applications even if sessions
  stay per-target.
- "The operation set cannot express this task" is a typed remediation that
  names the authoring path (the same process is often author and consumer),
  not an invitation to grow a generic query surface. This belongs beside
  "no natural-language authority" in the list below.

### Assessment confidence

- **High:** A1 (scoped to the observation machinery that exists), A5 (as an
  identity-bound design constraint on two future surfaces, not a verified
  fact), A8 — each joins machinery that exists or is accepted future work.
- **Medium:** A2, A3 — each needs an owning design (precondition carrier,
  effect-class taxonomy) before its value is proven.
- **Gated:** A4 (only the untrusted floor before an enforced write policy or
  value-provenance design exists; no positive trust label), A6 (on LLP
  0062's transcript/replay landing plus an effect-aware acceptance lane),
  A7 (reconciliation metadata only; retry policy stays behind LLP 0147's
  declared-input bar).

## What not to build

- **No fourth result envelope.** App CLI, MCP, HTTP, and clients project one
  Rust-owned semantic core where LLP 0024/0062 already require it.
- **No client-side permission oracle.** Only the server can produce the
  effective actionability view.
- **No natural-language authority.** Descriptions and semantic retrieval may
  aid selection; they never decide operation identity, effects, retry, or
  grants.
- **No universal automatic retry.** Reads, settled mutations, contract-backed
  idempotent effects, and unknown actions remain distinct.
- **No universal rollback.** Database branches cannot unsend an email, reverse
  a payment, or retract a leaked credential.
- **No per-operation bearer in tool metadata.** Credential custody stays with
  the parent/broker and authority is resolved at invocation.
- **No silent context truncation.** Elision, paging, artifact handles, and size
  refusals are typed facts.
- **No token-count protocol guarantee.** Exact serialized bytes/items are
  stable; tokenizer estimates are model-specific heuristics.

## Open questions

1. **Artifact ownership — ANSWERED 2026-08-02.** LLP 0062's served envelope
   owns the static consumption descriptor and operation-journal projection,
   preserving LLP 0037's ownership rule and avoiding a fourth manifest.
   Source: `issues/20260802-author-decision-packet.md`.
2. **Public disclosure.** Which effect, refusal, and guide facts are safe in the
   principal-independent public envelope, and which require authenticated
   lookup?
3. **Effect authority.** Which operation-safety fields can be derived from
   existing function kind/capability ceilings, and which require a new
   declaration grammar? How are false declarations detected?
4. **Effective view cost.** Can the server answer current actionability without
   executing application permission logic or creating an enumeration oracle?
5. **MCP materialization.** Which MCP clients can dynamically refresh tool
   definitions, and when should the stable catalog-tool projection be the only
   advertised surface?
6. **Plan comparison.** Which read-set and deterministic-input changes are
   material between preflight and commit, and can the existing conflict
   validator express the necessary comparison without a second evaluator?
7. **Action idempotency.** Is there a bounded declarative provider/effect
   contract from which Snapback can derive safe action reconciliation, or must
   action outcome remain unknown outside app-specific protocols?
8. **Journal custody.** Is the first durable journal a file owned by the app CLI,
   a profile-local broker database, or a general client-store record? How do
   concurrent processes share it safely?
9. **Result artifacts.** What is the minimum secure local artifact-store
   contract—permissions, expiry, redaction, digest, and authority binding—and
   when is a server-side resource justified?
10. **Hosted gate.** Which pieces may ship locally before hosted service
    principals and durable hosted agent mutation audit satisfy LLP 0055/0060?
11. **0146 composition.** Does LLP 0146's agent digest carry static descriptor
    deltas directly, and do its typed remediations become the effective view's
    sole remediation vocabulary?
12. **Consumption verification.** Is an optional declared verification query a
    useful bounded affordance, or does it encourage applications to encode
    product assertions in backend metadata that belongs in acceptance tests?
13. **Precondition carrier (A2).** Which read identities — commit version,
    query result digest, something narrower — can honestly serve as
    invocation preconditions, and can the existing conflict/settlement path
    own the comparison without a second evaluator?
14. **Effect-class taxonomy (A3).** Is there a small closed set (read,
    reversible write, durable write, external effect) that grants,
    descriptors, and journals can share, or is effect class app-declared
    vocabulary in the LLP 0144 style?
15. **Trust-labeling granularity (A4).** Field-level or value-level; and how
    do untrusted-content labels survive projection through code mode and
    generated clients without degrading into prose?
16. **Exemplar redaction (A6).** Can recorded task exemplars be mechanically
    value-redacted well enough to ship in the public envelope, or do they
    stay target-local acceptance fixtures? And if a redacted class exists,
    what does replay mean when a script branches on a redacted value?
17. **Effective-view receipt classification (A5).** How does the receipt
    distinguish authority expiry, manifest/generation change,
    target-capability change, and genuine server inconsistency, so "stale"
    and "defect" cannot be conflated by the consumer?

## Confidence

- **High:** one joined consumption descriptor rather than another dialect;
  static/effective separation; context-bounded discovery; an agent-facing
  operation journal and `resolve`; per-kind result bounding; projection parity.
- **Medium:** preflight-to-commit plan identities; least-authority inference;
  durable consumer sessions; generic post-operation verification.
- **Low until measured:** semantic intent ranking beyond deterministic aliases;
  generic action idempotency; compensating-operation metadata; any claim that
  one operation-card vocabulary can express every application's risk policy.

## Recommended follow-ons

1. Extend the LLP 0062/0024 family with the static consumption descriptor,
   bounded discovery projection, and operation journal/`resolve` contract.
2. Extend LLP 0146 D7 and LLP 0055 with the authenticated effective view and
   least-authority grant-request composition.
3. Write a separate RFC for preflight-to-commit continuity only after the
   operation journal supplies stable invocation identity and evidence.
4. Revisit the consumer-session/workspace composition after the descriptor,
   journal, and LLP 0097 effect-isolation prerequisites are concrete.
5. When the plan-token RFC is scoped, evaluate version-conditioned invocation
   (A2) as its first deliverable and effect-class grant ceilings (A3) as its
   enforcement rationale, rather than treating preview as pure UX.

## Status

Active Research, promoted from Draft by the author on 2026-08-02 after the
dual-family super-refine loop converged on v0.5 (Fable READY ×2, Codex
citation-only residue; per-round record under `llp/reviews/0149-*`). As
Research it authorizes no implementation or contract change. The first
ownership decision is now made: LLP 0062's served envelope owns the consumption
descriptor and operation-journal projection. The plan-token and workspace
questions should not be allowed to delay that foundation.
