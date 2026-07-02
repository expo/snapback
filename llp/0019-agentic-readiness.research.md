# LLP 0019: Agentic readiness

**Type:** Research
**Status:** Active
**Systems:** Developer experience, Runtime, Storage, Auth, Sync, Realtime, Tooling, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-06-26
**Revised:** 2026-07-01 (status → Active, ratified in the LLP 0032 R1 batch: finished reference research, stable since 2026-06-27)
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0005, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0017, LLP 0018, LLP 0024

## Summary

Snapback is already, at the level of stated intent and contract, an **agent-first**
backend. LLP 0000 declares "the first-class builder is an AI agent," LLP 0010
specifies the structured facts an agent must be able to recover, and LLP 0012
defines the manifests and diagnostic code families an agent consumes. That
posture is rare and it is a real asset.

The gap is not philosophy and it is not, mostly, the data API. The gap is that
the corpus specifies a **contract** while leaving the concrete **operating
surface** in draft: the exact operations an agent invokes, their names, the
single result schema they share, and the tool surfaces (CLI, HTTP, MCP) those
operations are projected onto. LLP 0010 enumerates the operations but states
"exact CLI names are not fixed here"; it also notes that *if* they are exposed
through HTTP, CLI, MCP, or another surface "they should share the same underlying
structured result schema" — without choosing. An agent cannot script against an
unratified surface.

This document surveys what is missing for maximal agentic use, organized by
dimension and **leading with the operating surface**, which is the prerequisite
for everything else. It is a Research document: it frames gaps and options and
records confidence. It does not ratify decisions. Where a finding implies a
decision, it names the LLP that should own that decision.

A second framing runs through the whole document and must not be collapsed:
**there are two distinct "agents."**

- **The build-time agent** authors and operates a Snapback app — writes schema
  and handlers, loads them, runs queries, debugs, verifies. This is what LLP
  0010 / 0012 / 0017 already address.
- **Runtime AI** is AI features *inside* the shipped app — embeddings, semantic
  search, an LLM call from a handler. The corpus does not address this at all.

These need almost entirely different things. Conflating them is the single
biggest analytical error available here, so the findings keep them separate.

## Motivation

The triggering question: "if we want Snapback to be maximally set up for agentic
use, what is missing? Does it need an MCP server? A CLI to execute against it? A
built-in way to do AI queries? Should we rethink the APIs?"

The short answers, expanded in Findings:

- **MCP server** — yes, and the function manifest (LLP 0012) is already, in
  substance, an MCP tool catalog. This is the highest-leverage, lowest-cost
  move. (F1)
- **CLI** — the operations exist in LLP 0010; their names do not. Ratify them,
  sharing one core with HTTP and MCP. (F1)
- **AI queries against it** — this is the *runtime AI* surface and is a genuine,
  unmade product decision. It rides on two already-deferred subsystems (vector
  storage and actions/outbound network). (F7)
- **Rethink the APIs** — mostly no. The data API is well-shaped for agents; what
  is thin is reflection over it, not the shape of it. (F6)

## Findings

### F1 — The operating surface is the prerequisite gap (lead)

**Confidence: High.** This is the load-bearing finding and the rest depend on it.

LLP 0010 enumerates the host operations an agent needs — `start`, `stop` /
`restart`, `reset`, `load` / `reload` schema and functions, `inspect`, `run`
(query or mutation with auth context), `explain`, and an `acceptance` suite —
and LLP 0017 reserves the admin console namespace (`/_snapback/admin/`) and an
`/_snapback/api/...` admin / runtime-state API, names `/_snapback/api/inspect` as
the route that should become canonical over time, and keeps the current local
routes (`/health`, `/inspect`, `/admin/schema`, `/admin/functions`,
`/admin/reset`, `/admin/seed`) as v0 aliases. At the time this research was
written, what did not yet exist was a single ratified core that all tool
surfaces project from; [LLP 0024](./0024-agent-operating-surface.spec.md) is the
first-cut Spec for that surface.

**Recommendation (captured as a first-cut Spec in
[LLP 0024](./0024-agent-operating-surface.spec.md)):
one host-ops core, three projections.**

1. **Host-ops core.** A single internal API implementing the LLP 0010
   operations and returning the LLP 0012 structured result schema (stable
   diagnostic codes, severity, subsystem, source spans, suggested next checks).
   This is the source of truth. CLI, HTTP, and MCP are thin projections of it.
   LLP 0010 already asks for exactly this shared schema; this finding promotes
   it to a prerequisite and says: build the core first.

2. **CLI projection.** Ratify the verb names, a non-interactive impersonation
   flag set — e.g. `--as <user>` / `--as-admin`, a proposed spelling for the
   run-as-user / explicit-admin-bypass capability LLP 0011 already defines (0011
   fixes the capability, not flag names) — and a JSON output mode. Small decision,
   outsized impact: agents cannot automate against unratified verbs.

3. **MCP projection — two servers.**
   - A **control-plane MCP** that exposes the host-ops core (`start` / `reset` /
     `inspect` / `run` / `explain` / `acceptance`) so an agent operates the
     local server through typed tools rather than memorized CLI string formats.
     It is a wrapper over the core, not new design.
   - A **generated app-data MCP**: codegen emits, per app, an MCP server or tool
     catalog where **each generated function becomes a candidate tool**. This is
     nearly free because the `functionManifest` (LLP 0012) already carries, per
     function, an args validator (→ the tool's JSON Schema), kind, capabilities,
     auth, and read-set / primary-table summary (→ the tool description). It
     stays in sync with the running app via `bundleHash`. The manifest *is* the
     catalog; emitting MCP from it is a projection, not a parallel surface.

     The catalog is not itself an authorization model. A generated mutation tool
     is not callable merely because it exists; it must run under an explicit
     user, admin, or service-principal authority, and the audit trail should
     record both the actor and the effective principal. Local development can
     start with LLP 0011's explicit dev impersonation model, but hosted
     app-data MCP should wait for the service-principal / scoped-token design in
     F2.

**Hard constraint:** do not let MCP become a fourth dialect. One core, one
result schema, three projections. This is the difference between an agent that
can rely on uniform diagnostics everywhere and one that learns three error
shapes.

The control-plane / app-data split is still part of the build-time/operator
story, not the runtime-AI story. Control-plane MCP is how an external agent
*operates* Snapback. App-data MCP is how an external agent or tool invokes the
app's generated functions under explicit authority. Runtime AI inside a shipped
app should call app functions through ordinary app/runtime mechanisms and
actions; it should not depend on MCP as an in-process protocol.

### F2 — Machine / agent identity and scoped capability tokens

**Confidence: High that this is the largest auth gap; Medium on the exact token
shape.**

Auth today is session-based (LLP 0011: `ctx.auth.userId`, `sessionId`,
`isAuthenticated`, optional `provider` / `roles[]`). For non-interactive callers
LLP 0011 offers only local impersonation — run as unauthenticated, a specific
user, specific roles, or an explicit, labeled admin bypass — and the model it
points to is Valet's `--dev` pattern: accept any string as `userId`, log every use
with a warning. That is acceptable on a trusted local box and unacceptable
anywhere else. It is also why LLP 0017 keeps the hosted admin surface disabled
"until hosted auth and authorization policy exist."

For an agent to be a first-class *operator* (not just an impersonated user) the
corpus needs a **service-principal identity with scoped capability tokens**:
bearer tokens with a TTL, scoped to specific handlers / mutation classes / data
ranges, and **distinguishable in the audit log** from human users. "Agent X
performed Y as principal Z under scope S" should be first-class, not inferred
from an impersonated `userId`.

The audit model should distinguish at least four facts: the **actor principal**
(the agent or service identity presenting the token), the **effective principal**
(the user / guest / admin context the operation runs as, if any), the scoped
grant that authorized the operation, and whether the operation was dry-run or
committed. That same authority tuple should be accepted uniformly by CLI, HTTP,
and MCP projections so each surface does not invent a slightly different auth
story.

This is the strategic unlock for anything beyond a trusted local machine. It
should be owned by LLP 0011, with hosted-gating implications for LLP 0017 and
isolation implications for LLP 0009 (trusted Ibex vs. killable-isolate V8 for
untrusted code).

### F3 — Dry-run and explain-denial: the missing rung in the feedback loop

**Confidence: High.**

LLP 0004's doctor / sandbox surface already offers `explain` for queries (plans,
index usage, permission explanations) — good. What is missing is **mutation
dry-run**: "if I ran this mutation as this principal, would it commit? what
would it write? what read-set would it validate? if denied, which rule failed?"
— *without committing.* LLP 0009 says an agent must be able to ask "why is this
operation denied"; dry-run is the constructive answer.

This converts the agent's loop from optimistic-commit-and-rollback into
**propose → check → commit**, which is both safer and cheaper. It should extend
the LLP 0004 doctor surface and reuse the LLP 0003 read-set machinery.

The implementation constraint matters: dry-run should not be a second evaluator.
It should execute the generated mutation through the same buffered `ctx.db`
invocation path a real mutation uses — the buffering host API LLP 0003 already
defines, which drives the handler to completion before taking the write lock —
then discard the buffered writes instead of committing them. The result should report the same diagnostics, the predicted
write set, the read-set validation verdict, and deterministic runtime inputs
(`now`, generated ids) used during the attempt. Future actions / outbound
side-effect capabilities need their own dry-run contract; they should not sneak
into mutation dry-run by accident.

### F4 — Reversibility: checkpoint / restore beyond reset

**Confidence: Medium.**

Committed mutations have no general undo surface today, and the only coarse
recovery is full local database reset (LLP 0010), which destroys all state. An
autonomous agent doing exploratory work needs a cheaper, scoped
**checkpoint / restore** operator surface.

The ordering substrate already exists: LLP 0007 defines a single monotonic
global version with every changeset stamping all affected rows at one version.
That makes "checkpoint at version N" meaningful, but it does **not** by itself
make restore cheap. A real restore also needs one of:

- a byte-level local snapshot;
- retained before-images / logical undo data in the changeset log; or
- a branch / clone mechanism that can be rewound or discarded.

The likely v0 shape is whole-database local checkpoint / restore, explicitly
scoped to development and tests. Scoped restore by table, actor, or changeset
range is a larger storage contract and should not be implied by the word
checkpoint. Ownership probably crosses LLP 0003 (local core), LLP 0007
(portable storage / snapshot semantics), and LLP 0010 (operator surface).

### F5 — Permission-dependency graph in the manifest

**Confidence: Medium.**

The manifest tells an agent *what* is syncable and *what* capabilities exist,
but not the propagation graph: which mutations advance which **authorization
epochs** (LLP 0011), and which queries depend on which auth variables. An agent
reasoning about "if I change membership here, which subscriptions resync?" must
currently infer this. Emitting it as machine-readable manifest data (extending
LLP 0012, sourced from LLP 0011's epoch model) closes that reasoning gap.

### F6 — Rethink the data API? Mostly no — add reflection, not redesign

**Confidence: High.**

The data API (LLP 0004 / 0007) is genuinely well-shaped for agents, and churning
it would be a mistake:

- **Structured predicate DSL** (`filter('completed', 'eq', false)`) over opaque
  callbacks — analyzable, exactly right for an agent.
- **Immutable query builders** — diffable, reasoning-friendly.
- **Explicit `defineLiveQuery`** separating syncable from callable — the
  capability boundary is legible rather than implicit.
- **Fail-closed codegen with source spans and no silent failures** (LLP 0004 /
  0010) — the single most agent-friendly property in the system, and the one
  most backends lack.

The change to make is **additive introspection**: the running server should be
able to fully describe itself (the manifest-as-tool-catalog of F1), and
`run` / `explain` / dry-run (F3) should be first-class. The shape is right; the
reflection over it is thin.

One genuine API-design open question is worth resolving: the **read-set /
primary-table invalidation metadata** flagged open in LLP 0005 / 0012. Agents
need it explicit to reason about refresh boundaries; today it is "should
include" but not finalized.

### F7 — Runtime AI ("AI queries against it") is an unmade product decision

**Confidence: Medium — the recommendation is directional, not settled.**

Nothing in the corpus addresses AI features *inside* shipped apps. The
recommendation is **yes, minimally**, precisely because it rides on two
primitives the corpus lacks — one absent, one deferred — and a backend shipping
in 2026 without them has a real gap. The two are **independent** and should not be
sequenced as a single unit (see below):

1. **A portable vector type + ANN index.** LLP 0007 is built on "one physical
   mapping per engine, never let it drift." A `v.vector(dims)` type with a
   portable ANN index contract (e.g. sqlite-vec locally → pgvector on
   graduation) fits that frame exactly and is the load-bearing primitive for
   semantic search and RAG. It is **independent of the actions subsystem**:
   storing and querying vectors is a local storage / index concern that needs no
   outbound network, so it can be decided and shipped by extending LLP 0007 alone,
   ahead of any actions work. Highest-value runtime-AI addition.

2. **An `actions` runtime that can call out.** LLP 0009 blocks `ctx.fetch` /
   network by default and defers the actions capability contract (network and
   durable side-effects) to a later design. *Generating* embeddings from an
   external API and any LLM completion from a handler require this — and only this
   outbound path is blocked on actions, not vector storage or local retrieval.
   Decide actions, then `ctx.ai` is a thin capability over actions, with
   **cost / token metering** (which agents also need for budgeting).

Explicitly **not** recommended: a bespoke "AI query language." Vector type
(storage) + actions / `ctx.fetch` (execution) + `ctx.ai` (convenience over
actions) + per-call cost metering yields RAG and agentic in-app features without
inventing a new surface. The vector-storage half can proceed now by extending
LLP 0007; the execution half (`ctx.ai` over actions) should be its own RFC gated
behind the actions decision in LLP 0009. (See open question 5.)

### F8 — Supporting gaps

**Confidence: Medium across the set.**

- **Audit trail with agent identity.** There is no general mutation audit model
  yet: LLP 0011 defines none, and the only `{who, when, key, value_changed}` shape
  in the corpus is LLP 0009's *secret-specific* `set_env` log. So the gap is not
  merely that an audit log cannot distinguish agent from human or capture
  intent / dry-run-vs-execute — it is that the audit substrate itself is
  unspecified. Tie to F2.
- **Deterministic fixtures — nearly done.** `ctx.runtime.now()` /
  `ctx.runtime.id()` injection (LLP 0004) plus declarative seed-direct-to-storage
  (LLP 0010) already give reproducibility. The remaining piece is making seeded
  time / randomness observable and assertable so an agent can verify its own
  output deterministically. Finish, don't redesign.
- **A generalized acceptance harness.** LLP 0010 already finalizes a v0 acceptance
  *app* — one todo app that must prove query, mutation, live subscription, realtime
  update, conflict diagnostic, reset, and invalid schema / query diagnostics — as a
  charter deliverable. What is not yet first-class is a *reusable* harness an agent
  can point at the app it just wrote to verify *its own* work; that generalization
  is what makes autonomous operation trustworthy.
- **Generated context pack (`llms.txt`-style).** A single machine-readable doc
  the agent loads to understand *this app's* current schema, functions,
  capabilities, and limits. ~90% already present: the LLP 0012 manifests plus the
  diagnostic code families, concatenated and served as one fetch. Treat this as
  a generated artifact, not hand-written prose: it needs `schemaVersion`,
  `bundleHash`, stale-artifact diagnostics, and a redaction policy for secrets,
  paths, and tenant/user data.
- **Per-principal cost / rate visibility.** Limits exist in the capability
  manifest (LLP 0009 / 0013) but are not per-token / per-agent observable. Agents
  need to see their own current usage to self-throttle.

## Recommended sequencing

A directional ordering, not a ratified plan:

1. **Ratify the host-ops core** (one structured API) and project it to CLI +
   control-plane MCP. *(F1 — unblocks everything; mostly naming and wrapping
   already-specified operations.)*
2. **Generate the app-data MCP catalog from the function manifest.** *(F1 —
   near-free given LLP 0012; large DX win.)* Local callable tools can start
   behind explicit dev impersonation; hosted mutation tools wait for step 3.
3. **Service-principal identity + scoped tokens.** *(F2 — the unlock for
   hosted / untrusted agents; largest auth gap.)*
4. **Dry-run + explain-denial, then local whole-database checkpoint / restore.**
   *(F3, F4 — closes the propose-check-commit loop without pretending scoped
   undo is already designed.)*
5. **Decide the runtime-AI story.** Two separable tracks: the **vector type + ANN
   index** can land independently by extending LLP 0007 (no actions dependency);
   **`ctx.ai`** (outbound embeddings / LLM calls) is gated on finalizing the
   actions subsystem. *(F7.)*

Steps 1–2 are cheap and high-leverage; step 3 is the strategic unlock for
anything beyond a trusted local box.

## Confidence

- **High:** operating-surface gap and the one-core/three-projections shape (F1);
  agent identity being the largest auth gap (F2); dry-run as the missing loop
  rung (F3); "don't redesign the data API, add reflection" (F6).
- **Medium:** checkpoint / restore feasibility beyond whole-database local
  snapshots (F4); the exact token shape for service principals (F2); the
  permission-dependency-graph design (F5); the runtime-AI direction and its
  sequencing behind actions (F7); the supporting gaps (F8).

## Open questions

1. **Surface ownership.** Resolved for the first local implementation by
   [LLP 0024](./0024-agent-operating-surface.spec.md), which owns the host-ops
   operation ids, result envelope, CLI names, control-plane MCP tools, and
   generated app-data MCP catalog.
2. **Token model.** What is the concrete service-principal token shape — JWT with
   scoped claims, opaque capability tokens, or both — and how does it compose
   with the BYOP provider model in LLP 0011?
3. **Dry-run fidelity.** Can dry-run reuse the exact read-set validation path
   (LLP 0003) so its verdict is identical to a real commit, or does it need a
   separate, necessarily lower-fidelity evaluator?
4. **Checkpoint scope.** Is checkpoint whole-database only, or can it be scoped
   to a table / changeset range? What are the retention and cost implications
   against the change log?
5. **Runtime AI ownership.** Should vector storage extend LLP 0007 while actions
   and `ctx.ai` get a new RFC, or should runtime AI be a single combined RFC
   gated on the actions decision in LLP 0009?
6. **Manifest growth.** How much of the permission-dependency graph (F5) and
   context pack (F8) belongs in the existing manifests (LLP 0012) versus a
   separate generated artifact, and what is the size / staleness budget?
7. **App-data MCP exposure.** Which generated functions are exposed as MCP tools
   by default, and how do function capabilities map to scoped service-principal
   grants?
8. **Context-pack redaction.** Which runtime facts can be served to external
   agents without leaking secrets, local paths, provider metadata, or tenant/user
   data?
9. **Concurrent operators.** The operating surface (F1), dry-run (F3), and
   checkpoint / restore (F4) are all framed around a single agent. What are the
   semantics when several agents — or an agent and a human — operate one app
   instance concurrently: do checkpoints / restores compose or clobber each other,
   how do interleaved dry-runs and commits serialize, and what is the unit of
   isolation (the app instance — cf. LLP 0018 — a branch / clone, or a scoped
   capability grant from F2)? "Maximal agentic use" increasingly means fleets, not
   a lone agent.
