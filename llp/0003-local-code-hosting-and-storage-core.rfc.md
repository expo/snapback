# LLP 0003: Local code hosting and storage core

**Type:** RFC
**Status:** Draft
**Systems:** Runtime, Storage, Realtime, Developer experience, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-07-23 (LLP 0086 CC-8 row 5: seam-design rule recorded in §Execution and Write Semantics — never assume continuous global uniqueness or same-version caller↔authority calls across a graduated-target seam; design for epoch-scoped uniqueness and one deploy of version skew, per LLP 0083's platform-wall evidence). 2026-07-17 (internal additive migrations reserve the SQLite writer before inspecting predecessor columns, and database open validates the complete pre-migration and post-migration cuts without treating a valid intervening sibling commit as corruption). 2026-07-17 (snapshot-bound local reads: every query invocation is pinned on WAL, direct, live-subscription, and in-memory lanes; mutation-handler composite reads pin their own head-bound facts and capture the exact storage inputs consumed by read-your-writes overlays; local commit versions are allocated only after SQLite's writer reservation). 2026-07-12 (ENG-24576: `app.reset` with an optional seed is one SQLite transaction and advances runtime state only after commit. Earlier: 2026-07-07 ENG-23342: §Database Model migrator contract — declared indexes are kept in sync with the manifest: physical index names are validated globally and a changed or stale index definition is rebuilt instead of silently no-opping through `CREATE INDEX IF NOT EXISTS`. Earlier: LLP 0032 E3/DK-1: §Execution and Write Semantics now describes host-plan mutation isolation as the client-supplied read_set baseline *by design* — the two-execution-models distinction and the atomic-host-plan rationale. Same day, LLP 0032 L6+L7: §Database Model reader pool implemented, §Execution and Write Semantics status updated — query handlers now run on pinned WAL snapshots and blocking work is off the async workers. Earlier: LLP 0032 R7 current-vs-target annotation; LLP 0032 S5.D4 post-commit fan-out error contract)
**Related:** LLP 0000, LLP 0001, LLP 0002, LLP 0004, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0014, LLP 0083, LLP 0086, https://github.com/expo/valet, https://github.com/ccheever/ibex

## Summary

The first implementation slice of Snapback should be one local core: a small
Rust companion server that owns the local SQLite database, hosts generated
application code, executes that code through Ibex, and exposes the HTTP and
WebSocket transport surfaces needed by generated clients, agents, and tests.

This is one LLP rather than separate code-hosting and database-process LLPs
because the first useful system depends on their integration. Code hosting
without the app database cannot validate queries, mutations, or realtime
behavior. The database without the code host cannot validate the programming
model. The app-facing data API is split into LLP 0004; later LLPs can split
storage portability, runtime isolation, sync, and security into narrower Specs
once this vertical slice exists.

## Context

LLP 0000 sets the implementation order: code hosting plus data storage first,
on the canonical local Ibex plus SQLite target. LLP 0002 makes that target the
standard place for agents, reference apps, and CI to build and validate work.

Valet is the nearest precedent. Its useful shape was a Rust server beside
SQLite, with a JavaScript handler runtime, generated schema/function artifacts,
WebSocket sync, schema-managed SQLite triggers, a change table, a monotonic
version counter, hydration, subscription matching, and dispatch to connected
clients. Snapback should inherit that shape deliberately, but LLP 0006 has now
recovered enough Valet evidence to say which parts must change: one logical
mutation must allocate one commit version, subscriptions need authoritative
initial snapshots, handler bundles cannot be raw `toString()` source, codegen
must never silently drop schema fields or table bindings, and realtime
backpressure must be recoverable rather than silently dropping work.

## Decision

Build a local companion server as the first real backend component.

For the canonical local target, a Snapback app has:

- one Rust server process;
- one SQLite database owned by that process;
- one generated app bundle containing schema metadata and handler code;
- one HTTP/WebSocket transport surface for generated query, mutation,
  subscription, admin upload, health, and agent-validation calls;
- one process-local realtime pipeline that turns committed SQLite changes into
  targeted client updates.

The server is the authority for writes, code execution, schema application,
change tracking, and realtime delivery. Clients may keep local replicas later,
but the first local server is not just a test shim. It is the product shape that
other targets must either implement or consciously adapt.

## Server Responsibilities

The Rust server owns these responsibilities in the first implementation:

- start, stop, and health-check the app instance;
- open the SQLite database, configure it, and checkpoint it on graceful
  shutdown when file-backed;
- apply generated schema metadata to create and migrate user tables;
- create Snapback infrastructure tables for metadata, change tracking, and a
  global version counter;
- install or update per-table change triggers for syncable tables;
- load and validate the generated function bundle;
- execute query and mutation handlers through Ibex;
- expose a transport protocol for generated subscription and mutation calls;
- poll database changes, hydrate changed rows, match subscriptions, and
  dispatch deltas;
- provide enough logs, errors, and inspection endpoints for an agent to know
  whether its code and schema are currently loaded and working.

Cron, auth, assets, notifications, actions with outbound network access, hosted
control planes, and multi-tenant isolation are allowed to reuse this server
shape, but they are not required for the first slice.

## Code Hosting Model

Application backend code is JavaScript or TypeScript authored in the project and
compiled into generated artifacts. The server does not discover arbitrary source
files at runtime. It consumes a generated bundle with at least:

- a schema manifest describing tables, fields, indexes, sync settings, and
  schema hash;
- a function manifest describing query and mutation names, argument validators,
  execution mode, and entrypoints;
- handler code strings or a compact equivalent that Ibex can evaluate.

Upload can be a local file load, a dev-server API call, or a CLI-driven push.
The required contract is that the server can answer:

- what schema is loaded;
- what functions are loaded;
- when each was loaded;
- whether schema application succeeded;
- whether a function failed validation before first invocation.

Handler invocation should create a fresh isolated runtime or an equivalently
strong execution boundary per call. Pooling can be reconsidered after a
benchmark proves startup cost is material. The initial bias is correctness,
observability, and simple isolation over reuse.

## Relationship to LLP 0004

LLP 0004 owns the app-facing schema, handler, `ctx.db`, and generated client API.
This RFC owns the local server that implements that API. The server may expose
HTTP and WebSocket routes, but those routes are transport for generated API
calls, not a second hand-written application API.

When the local core and the app-facing API disagree, the right fix is usually to
make the local core implement the LLP 0004 contract, not to teach application
code a local-only path. Temporary bring-up endpoints should be marked internal
and kept out of generated app code.

## Database Model

SQLite is the first app database. The server owns a single SQLite connection or
a serialized connection boundary that makes the write path easy to reason about.
WAL mode should be used for file-backed databases unless a target-specific
reason forbids it.

The serialized boundary governs the *write* path. Reads should use a separate
pool of WAL reader connections so that queries do not queue behind writes or
behind one another; collapsing reads and writes onto a single connection would
forfeit WAL's concurrent-reader benefit, which the read-heavy reference apps
(feeds, leaderboards — LLP 0000) depend on. (Implemented 2026-07-02 —
[LLP 0032](./0032-decision-and-implementation-hardening.plan.md) L6: `ReaderPool`
read-only connections with per-invocation pinned read transactions; measured
~68× on the read-during-write A/B in
[LLP 0035](./0035-local-target-benchmarks.research.md). File-backed databases
only; the in-memory dev mode cannot run WAL and keeps serialized reads.)

Every user table managed by Snapback has system fields:

- `_id`;
- `_version`;
- `_createdAt`;
- `_updatedAt`.

The server also owns infrastructure tables, at minimum:

- `_snapback_meta` for local metadata such as schema hashes and loaded bundle
  state;
- `_snapback_version` for a monotonic database version;
- `_snapback_changes` for row-level change records consumed by the realtime
  pipeline.

The per-row `_version` and the global `_snapback_version` are two views of one
ordering and must be reconciled, not maintained independently. The conservative
default: stamp each row's `_version` with the global version at commit, so that
"every row changed since version N" is a single indexed scan, and let
`_snapback_changes` carry what a row's current state cannot — deletions
(tombstones) and the ordering the realtime tailer consumes. The precise contract
is left to an open question below, but the three mechanisms must never be allowed
to disagree.

The first schema migrator should be conservative:

- create missing tables;
- add missing columns;
- create needed indexes where declared, and rebuild an existing index whose
  physical definition (owning table or column list) no longer matches the
  declaration — index rebuilds are non-destructive, and a bare
  `CREATE INDEX IF NOT EXISTS` would otherwise silently no-op on SQLite's
  database-global index namespace (schema validation also rejects distinct
  declarations whose joined `{table}_{index}` physical names collide);
- install or replace change triggers for syncable tables;
- reject type changes that would require rewriting existing data;
- preserve removed columns rather than dropping them.

This is enough to validate the local core without pretending to settle the full
SQLite-to-Postgres portability contract.

Snapback's own additive infrastructure migrations follow the same conservative
rule and add one concurrency requirement: column discovery and the dependent
`ALTER TABLE`/index work share an `IMMEDIATE` writer transaction. Two sibling
openers therefore serialize before either acts on `PRAGMA table_info`; neither
can apply a stale missing-column decision. File open performs a mutation-free
ordering preflight before any additive work and validates the complete current
ordering cut again afterward. A normal sibling commit may advance the head
between those two snapshots; it is accepted only when the final head, rows,
journal, and retained ordering facts validate together, rather than being
misreported as corruption merely because the numeric head changed.

## Realtime Pipeline

Realtime starts inside the local core. It should use the Valet-style shape until
we have evidence that a different design is better:

1. SQLite triggers append row-level changes to `_snapback_changes` and advance
   `_snapback_version` inside the same transaction as the user write.
2. A tailer polls for changes since its last processed version.
3. A hydrator fetches the current full row for inserts and updates, and emits a
   deletion marker for deletes.
4. A matcher evaluates active subscriptions and tracks membership so it can
   distinguish insert, update, and remove deltas per subscription.
5. A dispatcher groups deltas by client and sends one batched WebSocket message
   per client.

Because the hydrator reads the *current* row rather than a historical snapshot,
each emitted delta must carry the row's current version, and the pipeline must
coalesce multiple pending changes to the same row within a tick. Otherwise a
client can receive a `(state, version)` pair whose state is newer than the
version it is labelled with, or per-row deltas that are not monotonic — a
state-vs-log hazard in the same family as the Valet replay/versioning failures
recovered in LLP 0006.

The first polling interval can copy Valet's 50ms default. This is a starting
point, not a commitment. The important contract is that the server has a single
observable change pipeline with version ordering and testable delivery behavior.

A fixed-interval poll is a local-target placeholder, not the product mechanism:
it does steady work even when the app is idle, which is in tension with LLP
0000's *scale to zero* principle, and it does not map onto Cloudflare's
event-driven model — the privileged second target. Because the server owns the
single writer connection, a SQLite `commit_hook`/`update_hook` can *wake* the
tailer instead of spinning; the first realtime benchmark should weigh
hook-driven wakeups against the 50ms poll. Separately, matcher cost — evaluating
active subscriptions per change — is the component most likely to bend at scale
(LLP 0000's high-frequency fan-out open question) and is the first thing the
Valet retrospective should inform.

The pipeline must not hold the SQLite write lock while doing async WebSocket
dispatch. It may hold the database lock briefly for tailing and hydration.

**Post-commit fan-out error contract.** Fan-out runs *after* the mutation has
committed, so a single subscription's re-run or serialization failure must
never be reported as a mutation failure and must never abort the fan-out loop
— doing either returns an error to a caller whose write already persisted and
silently starves the remaining subscribers. Each per-subscription failure is
instead a recorded diagnostic (with a delivery-failure counter) plus a
best-effort `resync_required` signal to that one subscriber, so the client
re-snapshots rather than freezing; the loop continues to the next
subscription. A mutation only fails for reasons that occur *before* commit.
(Implemented 2026-07-01 via
[LLP 0032](./0032-decision-and-implementation-hardening.plan.md) S5.D4;
`notify_live_subscriptions`/`notify_permission_resyncs` are infallible with
respect to the mutation.)

## Execution and Write Semantics

Mutation execution is server-authoritative. A mutation request that names a
registered handler should run that handler on the server against the current
database state. Direct table writes can exist for bring-up and tests, but the
paved path is handler-based mutation.

`app.reset` with an optional seed is likewise one logical write. Table and
changeset deletion, version reset, seed validation, seed insertion, and the
seed changeset commit in one SQLite transaction. Runtime generations,
subscriptions, warm VMs, and cron demand state advance only after that commit.
If any seed row is invalid, the transaction rolls back and the prior database
and live runtime remain intact (ENG-24576).

**Drive handlers to completion; commit writes in one brief transaction.** This
is the structural correction to the Valet failure mode that both rejected
`async` handlers and serialized all writes behind the slowest one
([LLP 0006](./0006-valet-retrospective.research.md),
[LLP 0009](./0009-code-execution-security.rfc.md) §Runtime Boundary). Valet ran
mutation replay inside a synchronous `eval` that **held the database mutex for
the entire handler**, so an `async` handler returned an unresolved Promise and
was rejected at validation, and a slow handler blocked every other write.
Hermes is not the limit — Ibex already pumps the microtask queue via
`ex_hermes_poll` and releases the runtime lock between ticks
(`[observed - Ibex source, 2026-06-25]`). Snapback adopts that boundary:

- the handler runs against `ctx.db`, which is a **buffering** host API: reads
  observe a consistent snapshot fixed when the handler starts (a WAL reader
  transaction), with the handler's own buffered writes layered over that snapshot
  so it reads its own writes, while writes (insert/patch/delete) are accumulated
  against the handler's invocation, not applied to SQLite yet;
- the host **drives the handler to completion** using the engine's microtask
  loop (Ibex `ex_hermes_poll` on the local target; the V8 equivalent elsewhere),
  releasing the runtime lock between ticks so async work and concurrent
  handlers do not pin it;
- on handler completion (the Promise settles), the host **acquires the SQLite
  write lock once, applies all buffered writes in a single transaction, advances
  the global version by one, stamps that version on every affected row and the
  changeset record, and releases the lock** — the lock is held only for the
  commit, not across the handler's async duration;
- if the handler throws, no writes are applied and the mutation is rejected.

> **Implementation status (updated 2026-07-17, LLP 0032 Phases 2–3):** the
> boundary above is the ratified **target**; the shipped v0 now meets most of
> it, as verified in
> [LLP 0032](./0032-decision-and-implementation-hardening.plan.md).
> **Query handlers run on snapshot-bound views (LLP 0032 L6, landed 2026-07-02,
> completed across fallback lanes 2026-07-17):** each read-only invocation
> executes inside one deferred read transaction — on a pooled read-only WAL
> connection for the file-backed read lane, or on the serialized live
> connection for direct-library, live-subscription, and in-memory fallback
> execution. Every `ctx.db` read, membership witness, and reported/dependency
> version in that invocation therefore comes from one SQLite snapshot.
> *Mutation* handlers do not freeze one snapshot across the entire async
> invocation: each logical point/query/composite read pins its head and rows
> together, and commit-time captured-read validation rejects any relevant
> intervening change. Buffered query overlays capture the exact overfetch and
> touched-id reads they consume; the merge performs no hidden storage read.
> This is separate from DK-1's now-resolved read-set-validation semantics
> (E2/E3/E4). **Blocking
> work is off the
> async workers (LLP 0032 L7):** Hermes eval and SQLite run only on blocking
> threads (`lock_owned` + `spawn_blocking`, debug-asserted at the chokepoints),
> so a slow handler occupies the write lane, not the server's async runtime.
> **Read-your-writes is implemented (LLP 0032 E2):** a handler's buffered
> `ctx.db` writes are layered over its own later reads, so insert-then-query
> sees the row, a `patch` after a buffered insert reports `existed: true`, and
> delete-then-get misses; the overlay's overfetch and touched rows are all
> captured for OCC. **Host-plan mutation isolation is the client-supplied
> read_set baseline by design (E3, decided 2026-07-02 — Option A, pending
> Charlie's ratification):** a host-plan `MutationPlan` is an *unconditional*
> write sequence whose reads and writes run in one commit transaction, so a
> server-captured read there could never be stale relative to the commit —
> capturing reads server-side would be a no-op for conflict detection. The
> deciding read happened on the *client*; the client declares its baseline and
> `execute_mutation` validates it atomically inside the commit transaction. This
> is a principled optimistic-concurrency mechanism (version-match CAS, like HTTP
> `If-Match`), **not** a trust gap: an omitted or dishonest baseline weakens only
> that mutation's own isolation, never other writers' atomic, version-stamped
> commits. Query-shaped read-set validation is predicate-granular (**E4**, landed
> 2026-07-01). Mutation handlers deliberately retain per-read snapshots plus
> captured-read OCC rather than holding one read transaction across arbitrary
> async work; every individual head-bound read is nevertheless snapshot-atomic.
> DK-1's isolation *semantics* are fully resolved (E2/E3/E4). The mutation-isolation
> capability field
> ([LLP 0012](./0012-headless-integration-contract.spec.md)) reports the shipped
> mode.

The buffered model must not trade Valet's lock contention for silent stale-read
bugs. A handler may read data, await, buffer writes, and then commit after another
mutation has changed the rows or indexes it relied on. Without an isolation rule,
ordinary app invariants can fail: two buyers can both observe one remaining item,
two board updates can compute the same position, or a permission check can be
made against membership state that changed before commit. The first local core
therefore needs a named mutation isolation strategy, not just an atomic write
batch.

Default strategy for the first slice: record a conservative **read set** for each
mutation invocation — row ids read directly, indexed ranges or table predicates
used by query-builder reads, and any auth/permission facts used by the handler.
At commit, while holding the write lock, validate that every recorded dependency
is still at the version the handler observed. If validation fails, the server
must either retry the deterministic handler against fresh state or reject the
mutation with a structured conflict diagnostic. Silent last-writer-wins commit is
allowed only for writes whose correctness does not depend on a changed read. A
later storage/runtime spec may replace this with true serializable transactions
or another proven strategy, but it must preserve the observable rule: mutations
that read before writing cannot silently commit against invalidated assumptions.
The read-set extraction this validation needs is the same machinery the realtime
matcher uses to decide which subscribed queries a committed write affects
([Realtime Pipeline](#realtime-pipeline);
[LLP 0004](./0004-application-data-api.rfc.md) reactivity) — build it once and
both the mutation-isolation check and reactive invalidation share it.

Two execution models carry this baseline differently, and the difference is a
consequence of *where the deciding read happens*, not an inconsistency (DK-1/E3):

- **Server-executed handlers (Ibex).** The handler runs server-side and may read,
  `await` (releasing the runtime lock), then buffer writes. Because the deciding
  reads happen on the server at a snapshot that predates the commit, the host
  *captures* them during execution and validates the captured set at commit. This
  is the read-then-commit window the rule above exists to protect.
- **Host-plan mutations.** A host-plan `MutationPlan` is an *unconditional* write
  sequence (insert/patch/delete with values computed from args, not from queried
  state); its reads and writes execute in one commit transaction under the global
  mutex. There is no server-side read-then-commit window — any read the server
  could capture inside that transaction is by construction current at commit, so
  server capture would detect nothing. The read that can be stale is the
  *client's* optimistic read, taken before the request against a snapshot the
  server never saw. The client therefore supplies that baseline as `read_set`, and
  the server validates it atomically inside the commit transaction. This is the
  same rule — *mutations that read before writing cannot silently commit against
  invalidated assumptions* — enforced at the party that actually performed the
  read. A future option (E3 Option B) lets host-plan mutations carry declarative
  conditional predicates the server evaluates atomically instead of a version
  baseline; it is additive, not a correctness prerequisite.

This separates *handler time* (async, lock-free, may compose many reads and
writes) from *commit time* (synchronous, brief, holds the write lock). It
delivers the atomic-changeset guarantee [LLP 0007](./0007-storage-portability.spec.md)
requires (one commit version per mutation, stamped on every affected row), lets
`async`/`await` handlers run natively, and removes the per-mutation write
contention Valet measured, while the read-set validation above preserves the
transactional invariants Valet previously got only by holding the lock too long.

For the first slice:

- handler-visible database APIs go through Rust host calls, not direct SQLite
  access from JavaScript;
- generated IDs and timestamps should be injectable so offline/replay semantics
  can be added without changing the handler API;
- long-running I/O from handlers is out of scope for queries and mutations —
  and because the write lock is held only at commit, a handler that does
  long-running async work no longer serializes unrelated writes (though it still
  extends that mutation's own latency, bounded by the handler timeout
  [LLP 0009](./0009-code-execution-security.rfc.md) §Resource Limits);
- mutation retries are allowed only when the handler is deterministic with
  respect to args, auth context, runtime-provided ids/time, and database state;
  otherwise conflict rejection is the safe default;
- queries run read-only against the WAL reader pool ([Database Model](#database-model))
  and need not take the write lock at all.

Actions, outbound fetch, durable jobs, cron, and notification outboxes need
their own follow-on contracts. They should not complicate the first mutation
path.

### Seam rule: epoch-scoped uniqueness and version skew (added 2026-07-23)

The single-writer reasoning above is stated for the canonical local target,
where one Rust process owns the database and "one writer" holds continuously
for the life of the process. Graduated targets must not silently import that
strength. Cloudflare documents the two walls precisely for its own equivalent
seam: Durable Object global uniqueness is *event-scoped, not continuous* — a
replaced instance can briefly run concurrently with its successor during
partitions or platform updates, and only storage access re-asserts uniqueness
— and a newly deployed Worker version can call a DO still running the previous
version for a short period
([LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md) §Sharp edges — the
operational fine print). "One object, one thread" is true per storage epoch,
not absolutely.

The rule, recorded per
[LLP 0086](./0086-prior-art-course-corrections.plan.md) CC-8 row 5: any seam
between a transport front-end and the write authority (Worker↔DO on Cloudflare,
or the analogous split on any future target) must **never assume continuous
global uniqueness or same-version calls across the seam**. Concretely:

- correctness facts anchor in **storage transactions**, which re-assert the
  single writer, never in the authority's in-memory state surviving between
  events — an in-memory fact from a superseded epoch may belong to a stale
  concurrent instance;
- seam messages are **forward/backward compatible across at least one deploy
  of skew**: a caller one version ahead of (or behind) the authority must
  degrade to a structured error, never to misinterpretation.

The local target satisfies both trivially (one process, atomically upgraded);
the rule exists so the target-adaptation clause in [Decision](#decision) —
"other targets must either implement or consciously adapt" — cannot be
satisfied by a port that quietly assumes the local target's continuous
uniqueness.

## Agent and Test Surface

Because Snapback is agent-first, the local core must be easy to validate
without hidden state.

The first server should provide:

- a one-command local start path;
- deterministic database reset for tests;
- schema upload or load with machine-readable diff/error output;
- function upload or load with machine-readable validation errors;
- health and readiness endpoints;
- a way to inspect loaded schema, loaded functions, connected clients, active
  subscriptions, database version, and recent pipeline errors;
- integration tests that run the server, load a tiny app, write through a
  mutation, subscribe to a query, and observe the realtime update.

This is not polish. It is the feedback loop required for agents to build the
system safely.

## Boundaries and Deferred Work

This RFC does not settle:

- the app-facing data API, which is covered by LLP 0004;
- the public wire protocol shape, beyond needing enough transport for the LLP
  0004 generated API;
- the full local-first client sync protocol;
- the SQLite-to-Postgres portability contract;
- Cloudflare architecture;
- hosted control plane and project lifecycle;
- multi-tenant isolation;
- secret handling;
- auth and row-level authorization;
- asset storage;
- cron, actions, notifications, durable work, or outbound network access;
- production backup and restore.

It should be possible to add those later without replacing the local core, but
this RFC only decides the local vertical slice.

## Implementation Sketch

An initial implementation can proceed in this order:

1. Create a Rust server crate with HTTP health, admin schema load, admin
   function load, and WebSocket upgrade endpoints.
2. Add a SQLite wrapper that configures the connection, creates infrastructure
   tables, and exposes a serialized transaction boundary.
3. Add schema application for a minimal table manifest.
4. Add Ibex handler execution with a small `ctx.db` host API.
5. Add handler-based mutation over WebSocket or HTTP, including read-set capture
   and commit-time conflict validation.
6. Add change triggers, tailer, hydrator, matcher, and dispatcher for the
   restricted syncable-query subset from LLP 0004/0008.
7. Add one reference smoke app that proves schema load, function load,
   mutation, subscribe, and realtime delivery.
8. Add agent-readable inspection endpoints and machine-readable errors as soon
   as the happy path exists.

## Open Questions

- Should the local app database live under a project-local `.snapback/`
  directory by default, or should the dev command choose an external cache path?
- Should schema/function loading persist the generated bundle into SQLite
  metadata, or should SQLite store only hashes and the server read bundle files
  from disk on startup?
- How much of Valet's wire protocol should be copied verbatim for the first
  slice?
- Does Ibex need a fresh runtime per invocation for v1, or can a pooled runtime
  preserve isolation with less overhead?
- When can a `_snapback_changes` row be pruned? Without a retention rule the
  change log grows unbounded — harmless at idle, a storage-and-scan cost at the
  scale-up target. Candidate: prune once all live subscriptions have advanced
  past a change's version, plus a bounded horizon for reconnect/replay.
- What is the exact relationship between per-row `_version`, the global
  `_snapback_version`, and `_snapback_changes` (see Database Model), and does
  per-row stamping let inserts/updates skip the change table entirely, leaving it
  to carry only deletes?
- Where does the tailer cursor live across a server restart, and how does a
  reconnecting subscription resume without missing or replaying changes?
- For the realtime tailer, do hook-driven wakeups (`commit_hook`/`update_hook`)
  beat the 50ms poll on idle cost and latency, and does the winning mechanism
  survive the move to Cloudflare?
- What is the exact read-set representation for mutation isolation, and which
  conflicts are retried automatically versus reported to the client?
- Which recovered Valet constraints need prototype measurement before this RFC
  moves beyond Draft, especially matcher cost, read-set validation cost,
  write-lock duration, retention horizon, and tailer wakeup strategy?

## Status

Draft. This is intended to guide the first implementation of Snapback's local
core.

Ratified for the first local implementation on 2026-06-26: the execution/write
boundary in this RFC is the accepted v0 design — drive async handlers to
completion, buffer `ctx.db` writes over a consistent snapshot, commit once with
one version, and validate read sets at commit. The broader RFC remains Draft
until the first prototype validates or rejects the trigger/change-table/tailer
shape, hook-driven wakeups, matcher cost, read-set conflict validation, and
serialized write-boundary latency.
