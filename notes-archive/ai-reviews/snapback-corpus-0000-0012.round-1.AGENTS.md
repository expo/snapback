# Adversarial Review: Snapback LLP 0000-0012

**Reviewer:** Codex / AGENTS
**Date:** 2026-06-25
**Scope:** LLP 0000 through LLP 0012 as a combined architecture and implementation plan.

## Overall assessment

The plan is directionally strong and unusually honest about prior failure modes.
The LLP corpus has a coherent center: local trusted core first, typed/generated
application API, query-result sync, server-authoritative mutations, explicit
capabilities, machine-readable diagnostics, and a headless adapter contract. The
Valet retrospective is doing real work; it prevents the plan from being a vague
"build Convex plus Firebase plus Rails" sketch.

But adversarially: **as written, this is not yet a plan that will reliably work.**
It is a good architecture program, not yet a sufficiently constrained execution
plan. The biggest risk is not that any one idea is bad; it is that the combined
promises multiply into a system where correctness depends on several hard,
unfinished contracts landing at once: serializable mutation execution,
analyzable live queries, authorization-aware partial sync, local/server replay
parity, SQLite/Postgres portability, runtime isolation, Cloudflare deployment,
and Contract/Exact integration.

The plan can become workable if the first implementation is cut much narrower
and if three load-bearing contracts are tightened before code hardens:

1. mutation isolation and replay semantics;
2. the exact subset of queries that are syncable/offline-capable;
3. target capability boundaries, especially Ibex-local vs hosted/V8 vs Cloudflare.

## Strengths

- **The core product thesis is coherent.** Scale-to-zero, local-first, realtime,
  open, relational, agent-first, and comprehensive are not random features here;
  the corpus gives them a shared shape.
- **The Valet lessons are concrete.** Silent schema drops, stale subscriptions,
  handler-source replay, per-row versioning, backpressure drops, auth divergence,
  and fake timeouts are now named failure classes, not folklore.
- **The canonical local target is the right first target.** Local Ibex + SQLite
  gives agents and CI one reproducible place to prove the product loop.
- **The "generated facts over inference" principle is exactly right.** Manifests,
  source spans, capability reports, diagnostics, and conformance corpora are the
  right defense against agent-built systems drifting into a false model.
- **The security docs are honest about Ibex.** Calling Ibex local/trusted until
  CPU and wall-clock enforcement are real is the right posture.
- **The adapter boundary is healthier than the Valet path.** The headless
  contract, typed packages, version handshakes, and Online-vs-Parity capability
  split are all necessary if Contract/Exact and React are both serious consumers.

## Major concerns

### 1. The mutation execution model may lose transactional correctness

LLP 0003 fixes Valet's "hold the DB lock for the whole handler" problem by
driving async handlers to completion, buffering writes, then taking the SQLite
write lock once at commit. That solves lock contention and async execution, but
it introduces a sharper correctness problem: **reads can become stale before the
buffered writes commit**.

Example failure cases:

- two users both read inventory count `1`, both decrement, both commit;
- two mutations compute `position = count + 1`, both write the same position;
- a permission check reads membership, membership changes, then the write commits;
- a finance/order mutation reads balance or reservation state, then commits after
  another mutation has changed the invariant.

Valet's old approach was expensive but gave a crude transaction boundary. The new
approach needs a replacement boundary, not just buffered writes.

Recommended changes:

- Define the default mutation isolation level before implementation.
- Either run mutation reads against a transaction snapshot and validate the read
  set at commit, or mark the mutation as conflicted and re-run/fail if any read
  row/version changed.
- Treat "server-authoritative replay" and "last-write-wins per field" as
  insufficient for invariant-preserving mutations.
- Consider a restricted `defineMutation` rule similar to Convex: no arbitrary
  network I/O, deterministic database reads, and automatic transaction retry when
  safe.
- Add an acceptance test where two concurrent mutations contend on the same
  invariant and the system proves no oversell/duplicate-position result.

Without this, Snapback can pass todo, kanban, and demos while still being unsafe
for inventory, games, permissions, and finance.

### 2. "Named query" is doing too much work

The corpus wants named queries to serve as ordinary server reads, live
subscriptions, retained local-first data, authorization-filtered sync units, and
client replay inputs. That is elegant if the query is analyzable. It is dangerous
if "query" can mean arbitrary server JavaScript.

LLP 0008 partially resolves this by saying analyzable single-table filters get
incremental deltas and opaque queries get `replace`. That is the right direction,
but the product promise still reads broader than the mechanics can support.

Recommended changes:

- Create an explicit capability category: `syncableQuery` or `defineLiveQuery`.
- Make syncable queries a restricted structured expression language for v1:
  single-table, declared indexes, declared auth predicates, stable ordering,
  bounded result sets, cursor pagination.
- Let ordinary `defineQuery` remain useful, but report it as online-only or
  replace-only unless it satisfies the syncability contract.
- Make every adapter surface this distinction. A query being callable must not
  imply it is offline-retained, incrementally live, or permission-resyncable.

This is the difference between "local-first works for the subset we can prove"
and "local-first works unless it silently becomes a resnapshot hammer."

### 3. The first implementation scope is still too broad

The root document says v1 includes code execution, data storage, auth, asset
storage, cron, notifications, local-first partial sync, realtime, multi-target
deployment, Contract/Exact integration, React/Expo, and eventually Postgres
graduation. The implementation order narrows this to code hosting + storage
first, but the adjacent LLPs keep pulling auth, sync, adapters, replay,
diagnostics, conformance, and packaging into the same first slice.

That is how a system gets many 80% subsystems and no hard proof.

Recommended first cutline:

- single trusted local app;
- Ibex + SQLite only;
- one generated TypeScript schema/function bundle;
- single-table indexed queries only;
- server-side mutations with one commit version per mutation;
- live query initial snapshot plus online realtime update;
- deterministic reset/seed;
- structured diagnostics for schema, function load, query plan, and capability
  gaps;
- one React or headless test adapter consuming generated artifacts.

Defer from the first slice:

- offline mutation replay;
- hosted/untrusted execution;
- Postgres;
- Cloudflare;
- real auth providers beyond dev auth;
- assets, cron, notifications;
- Contract/Exact Design Mode authoring;
- rich text, whiteboard, feed fan-out, finance, and exact money semantics beyond
  reserving the type vocabulary.

The deferred items should still shape interfaces, but they should not be allowed
to block the first proof.

### 4. SQLite scale claims remain ambition, not engineering evidence

The corpus is careful to say the Partiful-scale target is not proven. Still, the
root narrative may cause agents or readers to treat it as an expected property of
the local core.

The unproven parts are exactly where the system can fail:

- single-writer contention under realistic concurrent mutations;
- WAL checkpoint stalls and long-lived readers;
- subscription matcher cost;
- authorization-aware resubscribe fan-out;
- change-log retention and resnapshot cost;
- large local-store bootstrap and migration;
- high-frequency presence or whiteboard traffic;
- media metadata churn plus feed reads.

Recommended changes:

- Label the Partiful-scale target as a benchmark ambition until an acceptance
  profile exists.
- Define one small benchmark envelope before implementation starts: reads/sec,
  writes/sec, live subscriptions, fan-out, local dataset size, retained history,
  latency percentiles, and acceptable degradation.
- Add benchmark gates before any README or marketing claim says SQLite carries a
  popular production app.

### 5. Cloudflare is too important to leave as "second, maybe rearchitect"

The root plan says Cloudflare is the second target and may require rearchitecture.
That is a warning sign. If the local core bakes in process assumptions, filesystem
assumptions, WebSocket lifetime assumptions, polling assumptions, SQLite-file
assumptions, or native runtime assumptions, the Cloudflare target may become a
rewrite rather than a port.

Recommended changes:

- Write a Cloudflare strategy LLP before the local server architecture hardens.
- At minimum, identify which local-core mechanisms have target seams:
  connection ownership, change notification, durable state, scheduler/alarm,
  WebSocket/session lifetime, runtime isolation, secrets, asset storage, and
  SQLite/Postgres/D1/Durable Object choices.
- Decide whether Cloudflare is a true v1 target, a post-v1 target, or a design
  constraint only. The current "second step" language is too strong for something
  this unsettled.

### 6. SQLite-to-Postgres portability will be false unless tested early

The storage spec says the right things, especially about single-sourced type
mapping, query semantics, timestamps, IDs, changesets, and logical export/import.
But portability is not a document property. It becomes true only when a second
engine runs the conformance corpus.

Recommended changes:

- Build a minimal Postgres runner earlier than feels convenient, even if it is
  not production-ready.
- Run schema, query, mutation, timestamp, decimal, null-ordering, and changeset
  cases against both SQLite and Postgres in CI.
- Treat "not yet tested on Postgres" as a capability gap in generated reports.

If Postgres waits until after the SQLite API feels nice, SQLite-only assumptions
will already be app-facing compatibility debt.

### 7. Client schema/version skew is under-specified

The corpus covers server schema application, manifest hashes, generated artifacts,
and protocol drift. It does not yet say enough about mobile/local-first clients
running old app versions with retained local stores while the backend schema and
permission rules evolve.

Failure cases:

- old client subscribes with an old query/function manifest;
- retained local rows lack new required fields;
- local store migration fails while offline;
- server sends fields or enum values the old adapter cannot represent;
- permission rules change while old clients still hold previously authorized data;
- offline mutations replay from an old handler contract.

Recommended changes:

- Add a schema/protocol version-skew section to LLP 0007, 0008, or a migrations LLP.
- Define compatibility rules: minimum supported client artifact version, forced
  upgrade/resnapshot, local replica migration, and rejection of stale offline
  mutations.
- Add acceptance tests with an old generated client reconnecting after a schema
  change.

This is not optional for mobile local-first apps.

### 8. Auth-aware sync is correct in principle but expensive in practice

The server-directed resubscribe-on-permission-change plan is a good v1 compromise.
The hard part is knowing which subscriptions are affected and what data must be
cleared fail-closed.

Recommended changes:

- Define the v1 permission dependency graph explicitly: table scopes, membership
  tables, auth variables, and epoch keys.
- Prefer broad invalidation in v1, but make the cost visible in diagnostics and
  benchmarks.
- Add a hostile test where a user loses access while offline or while retaining
  sensitive local data, then reconnects.
- Add a hostile test where a permission-affecting write has huge fan-out and the
  server has to resubscribe many clients.

The current direction is right, but the implementation can still leak stale data
or DOS itself with resubscribe storms.

### 9. Contract/Exact is primary but still not defined

LLP 0000, 0005, and 0012 are explicit about the terminology gap. That honesty is
good, but it remains a real dependency. If Contract/Exact is the primary product
target, the lack of a stable definition can distort core Snapback decisions.

Recommended changes:

- Ratify a short Contract/Exact definition before using it to settle core API
  tradeoffs.
- Until then, make the first Snapback contract independently usable through a
  headless/React fixture.
- Treat Contract/Exact Design Mode integration as a consumer of the headless
  contract, not as a blocker for proving the backend core.

### 10. Runtime isolation is not just a hosted concern

The docs correctly say Ibex is not safe for untrusted hosted code without real
resource enforcement. The risk is that early local-only shortcuts leak into
interfaces and make hosted mode impossible later.

Recommended changes:

- Make the runtime conformance suite a first-class early deliverable.
- Report enforced vs advisory limits in capability manifests from day one.
- Do not advertise hosted/multi-tenant Snapback until either V8/killable-isolate
  execution exists or Ibex has real preemption/resource control.
- Keep fresh runtime per invocation as the default until pooling has a proof.

## Specific plan changes I would make

1. Add a short "MVP cutline" LLP or section to LLP 0000/0010. Make it explicit
   what the first implementation proves and what it intentionally cannot do.
2. Add a mutation isolation section to LLP 0003/0004/0007. Require read-set
   validation, retry, conflict failure, or another named serializability strategy.
3. Split callable queries from syncable live queries. Use a restricted v1
   live-query DSL rather than relying on arbitrary query handlers.
4. Move Cloudflare strategy earlier. It can be a research/RFC, but it should land
   before the local architecture bakes in unportable process assumptions.
5. Add client schema/version skew to the migrations/sync plan.
6. Make a minimal Postgres conformance runner an early gate, not a late graduation
   project.
7. Define the first benchmark envelope before claiming any app-scale target.
8. Pick one first adapter/test surface. I would choose headless plus React before
   Design Mode, because it proves the generated contract without waiting on the
   unresolved Contract/Exact authority gap.

## Novel/non-standard ideas worth considering

- **Capability budgets as generated artifacts.** Each query/function could carry
  not just "requires live subscription" but an explicit budget: max result size,
  max expected fan-out, required index, offline retention policy, auth epoch
  dependency, and resnapshot cost class. Agents can then reason about scale
  before code runs.
- **A "strict mode" app profile from day one.** In strict mode, unindexed
  subscribed queries, opaque live queries, advisory-only timeouts, unsupported
  replay, version mismatch, stale generated artifacts, and portability gaps are
  errors, not warnings. This gives agents a target that is hard to fool.
- **Mutation invariants as first-class declarations.** Instead of hoping handlers
  encode all invariants correctly, allow schema/function declarations such as
  unique scoped position, nonnegative inventory, membership-required write, or
  balance cannot go below zero. The runtime can use these for diagnostics and
  conflict checks.
- **Shadow execution in the acceptance suite.** For selected tests, run the same
  schema/function bundle against two storage engines or two runtimes and diff the
  generated diagnostics, query results, and changesets. Make drift visible before
  users hit it.
- **Resnapshot as a product-visible state.** Do not hide resnapshot behind a
  generic loading state. Adapters should expose "stale because permission epoch
  changed", "stale because retention floor passed", and "stale because capability
  changed" distinctly.

## Key open questions

- What exactly is the first slice that must work before any broader subsystem
  starts?
- What isolation level do mutations provide when reads happen before the final
  commit transaction?
- Which query forms are v1 syncable, offline-retained, and auth-resyncable?
- Is Cloudflare a v1 target, v2 target, or only a future design constraint?
- When does a second storage engine enter CI?
- What happens when a mobile client with an old generated artifact reconnects
  after schema, permission, or protocol changes?
- What is the first trusted benchmark envelope for SQLite + Ibex?
- What is the minimum Contract/Exact definition Snapback can depend on?
- Which runtime limits are enforced on Ibex, which are advisory, and how are they
  exposed to agents?
- What are the rules for replaying or rejecting offline mutations after auth,
  permissions, schema, or function definitions changed?

## Bottom line

The general plan is good enough to keep pursuing, but not good enough to implement
straight through as written. The plan will work only if the first product slice is
made smaller and the load-bearing correctness contracts are made sharper before
implementation momentum starts.

The most important hardening move is to stop treating "local-first realtime
backend" as one feature. Break it into provable layers:

1. generated schema/function honesty;
2. serializable server mutations and changesets;
3. live query initial snapshot and online deltas for a restricted query subset;
4. retained local reads;
5. offline mutation replay;
6. auth-aware sync and permission invalidation;
7. cross-engine and cross-target conformance.

If those layers are gated in that order, Snapback has a credible path. If they
are built all at once, the most likely failure mode is a polished local demo that
cannot safely graduate to offline, auth-sensitive, hosted, or high-fan-out apps.
