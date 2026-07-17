# LLP 0007: Storage portability contract

**Type:** Spec
**Status:** Draft
**Systems:** Storage, API, Runtime, Sync, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-07-17 (the plain-JSON commit-version stream is explicitly bounded by `Number.MAX_SAFE_INTEGER`; successor exhaustion refuses before every mutation tier, and every durable ordering fact is decoded fail-closed rather than cast or defaulted). 2026-07-13 (audit follow-up: required-field weakening is rejected while preserved physical columns remain `NOT NULL`, reset clears dormant removed tables, and direct query/action artifacts preflight closed-expression bounds); 2026-07-13 (data-boundary review follow-up: every filter operand now shares one 500-value portable bind ceiling, and scalar/system filter-type failures use one cross-target diagnostic); 2026-07-12 (ENG-24567/ENG-24573: portable queries are bounded identically across Rust, Cloudflare, and buffered overlays; required-field migrations now enforce and physically install `NOT NULL` atomically); 2026-07-12 (ENG-24342: the shipped plain-JSON Integer profile is explicitly JavaScript-safe-range bounded on every target, with shared boundary corpus evidence); 2026-07-02 (LLP 0032 X1: DK-2 commit-version graduation design note added — per-app gap-free streams, target-owned allocators, HLC rejected with a named revisit trigger; same day: LLP 0032 E3/DK-1: read-set-validation contract now names the two execution models — server-captured for Ibex handlers, client-supplied baseline for host-plan mutations (Option A) — and status callout refreshed for E3 decided/E4 landed. Earlier: LLP 0032 R3/R7 id algorithm closed as ratified UUIDv7 per LLP 0004; read-set-validation contract implementation-status annotation)
**Related:** LLP 0000, LLP 0001, LLP 0002, LLP 0003, LLP 0004, LLP 0006, LLP 0008, LLP 0009, LLP 0011, LLP 0012, LLP 0014, LLP 0018, LLP 0022, LLP 0032

## Summary

Snapback's data model starts on SQLite and must graduate to Postgres without a
rewrite of ordinary application code. This Spec defines the portable storage
contract that LLP 0004's application data API can rely on and LLP 0003's local
server must implement first.

The core rule: the paved path is a portable document/relational layer with
engine-independent ids, system fields, validators, query semantics, indexes, and
transaction behavior. Engine-specific storage features remain allowed only behind
an explicit portability opt-out.

## Scope

This Spec owns:

- portable table, field, validator, id, timestamp, and version semantics;
- the default query and index contract shared by SQLite and Postgres;
- the minimum transaction and changeset contract that sync and realtime consume;
- the first schema-evolution boundary agents may rely on;
- diagnostics that reveal non-portable storage behavior.

It does not own:

- the app-facing handler syntax, owned by LLP 0004;
- local server mechanics, owned by LLP 0003;
- partial sync and replay, owned by LLP 0008;
- auth and row visibility rules, owned by LLP 0011;
- full online migration workflows, which should get a later migrations LLP.

## Design Principles

- **Portable by default.** Code written on the paved path must have the same
  observable behavior on SQLite and Postgres.
- **Explicit escape hatches.** Raw SQL and engine-specific types are allowed only
  when a project declares the portability it is giving up.
- **Generated facts over inference.** The schema manifest must say what tables,
  fields, indexes, system fields, and portability flags exist.
- **Index-first scale.** Unbounded production queries must use indexes, cursors,
  or an explicit small-data opt-out.
- **Sync-ready from the beginning.** Ids, versions, timestamps, and changesets
  must be shaped so local-first sync can arrive without changing app handlers.

## Data Model

A Snapback table is a named collection of documents stored in a relational
engine. Application code sees plain documents. The storage layer maps those
documents to SQLite or Postgres tables.

Every Snapback-managed table has these system fields:

- `_id`: an opaque string id;
- `_version`: the global commit version that last changed the row;
- `_createdAt`: the runtime-provided creation timestamp;
- `_updatedAt`: the runtime-provided update timestamp.

Application schemas must not redefine those names. Handlers may read them, but
the server owns their values.

The first portable field vocabulary should include:

- string;
- boolean;
- exact signed integer (the shipped plain-JSON v0 profile is bounded to
  `[-(2^53-1), 2^53-1]`);
- exact decimal;
- floating-point number;
- timestamp;
- json object;
- array of portable values;
- nullable and optional variants;
- references expressed as opaque ids.

The v0 `Integer` validator uses the JavaScript-safe signed range on every
target. Local SQLite must not accept a wider i64 value than a JavaScript/Worker
target can distinguish: doing so makes one JSON number alias multiple integers
and breaks the cross-target storage claim. Full exact 64-bit integers remain in
the intended vocabulary, but require the tagged/string wire encoding already
called out by LLP 0004 before they become part of the paved profile. `[confirmed
— Charlie Cheever / Codex, 2026-07-12]`

Binary values and asset bytes are not inline document fields on the paved path.
They should be stored through the asset subsystem, with metadata and references
stored in ordinary tables.

**Single-sourced physical mapping (learned from Valet).** Each portable type must
map to exactly one physical representation per engine, defined in **one** generated
table that both the writer and the reader assert against. Valet let the
validator→column mapping drift between the two sides — the same `v.number()` became
`REAL` on the client but `INTEGER` on the server, `v.bytes()` was unmapped
server-side, and booleans needed an ad-hoc integer normalization because SQLite has
no boolean type
([LLP 0006](./0006-valet-retrospective.research.md), `[observed - Valet LLP
0014/0040]`). "Portable by default" silently fails unless the type map is
single-sourced. Include boolean and bytes in the normalization table explicitly.

## Ids

`_id` is an opaque, client-mintable, engine-independent string. It must not be a
SQLite rowid, Postgres sequence, or any value whose meaning depends on a storage
engine.

[LLP 0004](./0004-application-data-api.rfc.md) ratified the concrete algorithm
for v0 (ledgered 2026-06-26): `_id` is an opaque **UUIDv7** string generated by
Snapback's runtime id source. Any future replacement must satisfy:

- collision resistance for offline clients;
- stable serialization across clients, SQLite, and Postgres;
- lexical or temporal properties only if the chosen algorithm documents them;
- no application dependency on embedded timestamp, shard, or sequence structure.

Handlers should treat ids as strings with equality semantics only.

## Versions and Changesets

Snapback has one monotonic logical commit version per app database. Each
successful mutation commits one changeset and advances the global version once.
Every row inserted, updated, or deleted by that mutation is associated with that
same commit version.

For rows that still exist, `_version` equals the commit version that last changed
the row. Deletes require tombstones or change records because the row no longer
exists to carry `_version`.

This contract gives sync and realtime one ordering source:

- clients can ask for changes since version `N`;
- subscriptions can compare row `_version` values to a cursor;
- mutation changesets can be delivered atomically;
- reconnect can either replay from a retained version or require resnapshot.

The physical `_snapback_changes` table is a local implementation detail, but its
observable behavior must match this logical changeset contract.

**Implementation constraint (learned from Valet).** The commit version must be
allocated **once per mutation** and stamped onto every affected row and changeset
record. Valet implemented versioning with a per-row `AFTER INSERT/UPDATE/DELETE`
trigger that did `version = version + 1`, so a multi-row mutation advanced the
global version *once per row* and rows from a single changeset received
**different** versions
([LLP 0006](./0006-valet-retrospective.research.md) §Findings from the Valet LLP
corpus, `[observed - Valet LLP 0001/0013]`). That breaks both atomic changeset
delivery and the "compare row `_version` to a cursor" rule above. A naive per-row
trigger does not satisfy this Spec; the version must come from one
per-transaction allocation.

### Commit-version graduation (DK-2, decided 2026-07-02)

The single monotonic counter above is trivially correct on single-writer
SQLite and was undesigned for concurrent Postgres writers and for Cloudflare
(this Spec and [LLP 0014](./0014-cloudflare-strategy.rfc.md) both flagged
it). This design note — LLP 0032 X1, docket row DK-2 — pins the portable
contract now, before further wire-protocol surface hardens around a
single-global-stream assumption, and leaves allocator mechanics to each
target.

**Pinned for every target (the portable contract):**

1. **The version stream is per logical app**, scoped to
   [LLP 0018](./0018-app-instance-boundaries.rfc.md)'s app boundary — not
   per physical instance and not global across apps. On the canonical local
   target (one app per instance) the two coincide, which is why nothing
   changes today.
2. **Within one stream, versions are opaque, monotonically increasing
   integers.** Clients compare versions and hold cursors only within the
   same stream; comparing versions across streams is undefined.
   In the shipped plain-JSON v0 profile the exact domain is
   `0..=9_007_199_254_740_991` (`Number.MAX_SAFE_INTEGER`), the same portable
   integer ceiling used by row values and timestamps. A commit at the maximum
   has no successor: every mutation tier refuses before writing with
   `SNAPBACK_STORAGE_VERSION_EXHAUSTED`. A negative or above-maximum durable
   global version is corruption and prevents read-lane publication/reopen with
   `SNAPBACK_STORAGE_VERSION_CORRUPT`. The same fail-closed decoder governs
   every other persisted ordering fact when consumed: managed-row `_version`,
   resource and membership witnesses, membership-transition commit versions,
   change-journal high-water values, and its retention floor. None may be cast,
   wrapped, rounded, or treated as an absent/zero cursor. Pruning also validates
   its caller-supplied time floor before it can alter either the journal or
   replay floor.
3. **Gap-free commit visibility.** When an observer has seen version `N`,
   every change numbered `≤ N` in that stream is durably committed and
   visible to it — versions order *visibility*, not *allocation*. This is
   the property the serialized SQLite writer provides for free; each
   graduated target must supply it by its own mechanism, and a mechanism
   that can expose a gap that later fills in (a reader at `N` missing `N−1`)
   does not satisfy this Spec.
4. **Wire cursors are `(stream identity, version)` pairs** treated as one
   opaque resume token ([LLP 0012](./0012-headless-integration-contract.spec.md)
   §Versioning). Resume below the retention floor forces resnapshot
   ([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) §Retention).

**Allocator mechanics per target (target-owned, not portable):**

- **Local SQLite (shipped):** the serialized writer allocates at commit
  inside the write transaction. Correct by construction.
- **Postgres (graduation default: commit fencing).** A bare sequence
  violates property 3: allocation order is not commit order under
  concurrency, so `changes since N` can permanently miss a lower-numbered
  transaction that committed later. The recommended shape is **commit
  fencing** — allocate the version in a short critical section at commit
  time (per-app advisory lock or a single-row `UPDATE … RETURNING` version
  row), so version order equals commit-visibility order. Handler execution
  stays concurrent; only the allocation tail serializes. This preserves the
  exact contract with the least machinery and is the honest continuation of
  the per-app single-authority model (per-app write throughput keeps a
  designed ceiling — the trade [LLP 0022](./0022-electric-powersync-turso.research.md)
  documents across this product class). The scale-out escape hatch, recorded
  but deliberately not designed here: a logical-decoding/commit-order change
  feed assigning stream positions (Electric-style), which also satisfies
  properties 1–4 if a measured per-app writer ceiling ever becomes the
  binding constraint. Measure first (M1-class evidence), then design.
- **Cloudflare D1 / Durable Objects.** A Durable Object is single-threaded,
  so the write-owning object allocating a per-app counter from its storage
  reproduces SQLite's semantics exactly. The named constraint: **one app
  stream requires one version authority.** If one app's data ever shards
  across multiple objects ([LLP 0014](./0014-cloudflare-strategy.rfc.md)
  Profile C), either allocation funnels through one coordinator object, or
  the shards become distinct streams and the client model must carry
  multiple `(stream, version)` cursors — the opaque-pair wire shape leaves
  that evolution open, but nothing today designs it, and no target may ship
  intra-app sharding without revisiting this note.

**Rejected: HLC-style ordering** for the v1 contract. Hybrid logical clocks
order events across independent writers, but they do not give gap-free
"changes since `N`" semantics without additional stability-watermark
machinery, they complicate the retention floor, and they buy nothing while
every planned target has a single per-app write authority. **Revisit
trigger:** a design that requires multi-master writes within one app stream
(nothing planned does).

## Timestamps

`_createdAt` and `_updatedAt` come from the Snapback runtime clock, not from
application calls to `Date.now()`. The storage representation must round-trip
without timezone ambiguity and compare consistently across SQLite and Postgres.

Draft default: store timestamps as exact integer milliseconds since the Unix
epoch, exposed through generated client types as a timestamp value rather than a
bare application-owned number. A later revision may choose a richer timestamp
type if the wire and storage mapping stay portable. This integer-milliseconds
choice is deliberately *better* than Valet's, which stored `_createdAt`/
`_updatedAt` as `REAL DEFAULT 0` (float) — a source of precision loss and
cross-engine compare ambiguity ([LLP 0006](./0006-valet-retrospective.research.md),
`[observed - Valet LLP 0014]`); keep integers.

Runtime-owned timestamps use the non-negative half of the same JavaScript-safe
integer profile: `0..=9_007_199_254_740_991` milliseconds. A recorded replay
ledger is validated against that bound before either evaluator runs, and its
frozen clock is the clock used by provisional rows, the handler result, the
authoritative commit, and change-journal facts. Reconnect wall time must never
replace it. `[confirmed — Charlie Cheever / Codex, 2026-07-12, ENG-24487/ENG-24489]`

Handler-visible time comes from the runtime, and replay must reproduce it: Valet
captured and retransmitted the mutation's `now` (alongside generated ids) so an
offline-then-replayed insert produced the same timestamp on the client and the
server, while leaving `Math.random()` non-deterministic because the server is
authoritative ([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) §Mutation
Replay; `[observed - Valet LLP 0016]`).

## Query Semantics

The query builder in LLP 0004 is a portable expression language, not SQL text.
Portable query behavior must be defined by Snapback, not by whichever SQL engine
is currently running.

First-slice requirements:

- equality and inequality compare values of the same declared type only;
- comparing unlike non-null types is a
  `SNAPBACK_QUERY_FILTER_VALUE_INVALID` error at every execution site;
- null checks use explicit `isNull` and `isNotNull`;
- sort order is stable and deterministic: every explicit field order ends in
  an ascending `_id` tie-break, including local/hosted SQL, buffered overlays,
  and captured retained/live top-N boundary keys;
- nulls sort after present values unless a future API explicitly chooses another
  null ordering;
- explicit ordering is limited to scalar/system fields; `Json` fields fail
  closed until Snapback defines one canonical array/object order across every
  engine;
- every materialized query is bounded: omitted `take` means 1,024 rows, an
  explicit limit must be `0..=1,024`, literal `In` operands are capped at 500
  items cumulatively across the whole plan rather than per clause, and all
  filter operands together bind at most 500 values (excluding target-internal
  parameters such as the result limit); exceeding the latter reports
  `SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED`;
- one mutation may buffer at most 1,024 writes. Read-your-writes queries
  overfetch only `effective limit + buffered writes`, with an internal ceiling
  of 2,048, then merge and truncate through the same portable evaluator;
- pagination for large or mutable result sets uses cursors, not offsets;
- offset-style `skip(n)` is a small-data convenience and should warn on
  production-marked unbounded queries.

The complete generated function manifest is an admission boundary, not a bag
of invocation-time assertions. Before replacing a known-good generation, every
query filter expression and HostPlan action argument must pass the same closed
`ValueExpr` depth and pinned-function checks as mutation plans. HostPlan actions
also share the plan step/serialized-byte bounds and must declare valid, unique
result bindings before returning one. A rejection preserves the prior function
generation atomically.

Queries that cannot be pushed down portably must report a diagnostic. Silent
fallback to full table scans is not acceptable for production-marked queries.
Valet validates both the rule and the failure mode: it translated a filter to SQL
only if **every** node was translatable (a deliberate all-or-nothing choice, since
partial pushdown causes split-filter pagination bugs), but a single untranslatable
node — typically a JSON/array predicate like `arrayContains` — forced the **entire**
query into an in-memory scan of all rows, and did so **silently**
([LLP 0006](./0006-valet-retrospective.research.md), `[observed - Valet LLP 0019]`).
Adopt the all-or-nothing translation, but emit a diagnostic at every point Valet
fell back silently. JSON and array predicates are the concrete part of the paved
path that does not push down portably.

The same query must also return the same result regardless of *where* it runs —
not only across SQLite and Postgres, but across the local optimistic replica and
the server. Valet's local notification path read the whole table instead of
re-running the handler's `order`/`filter`, and its local `ctx.db` did not implement
`withIndex`, so the same named query produced differently-ordered or different
results locally versus on the server
([LLP 0006](./0006-valet-retrospective.research.md),
`[confirmed - Valet diaries, 2026-06-25]`). Portable query semantics are defined
once and must hold on every execution site.

Only a restricted, declared subset of portable queries is syncable/offline-retained
in v1. That subset must be representable as generated data, not opaque handler
JavaScript, so storage adapters, local replicas, and subscription matchers can all
evaluate the same predicate, index order, cursor, and auth variables. Portable
query semantics remain required for ordinary callable queries, but ordinary
callability does not imply incremental live sync, retained local storage, or
authorization-aware resubscribe. Generated artifacts and capability reports must
make this distinction explicit.

Comparison and null semantics must be pinned, because they are a classic
SQLite↔Postgres divergence: decide and state whether comparing unlike non-null
types is an error or yields no match (Valet's matcher returned false rather than
erroring), and pin whether `neq` includes nulls — Valet had to special-case
`("field" != ? OR "field" IS NULL)` so that null-valued rows were not silently
dropped (`[observed - Valet LLP 0019]`).

## Index Contract

Schemas declare named indexes. A portable index has:

- a name stable across engines;
- one or more fields;
- an order for each field if ordering is relevant;
- optional uniqueness;
- optional partial predicates only after the portability rules for predicates
  are specified.

The first implementation should support simple single-table indexes and should
prefer `withIndex` for unbounded queries. Agents need diagnostics for:

- missing index;
- index declared but not applied;
- query could use an index but does not;
- index uses a non-portable field type or predicate.

## Transactions and Atomicity

Each mutation runs in one atomic write boundary by default. Its writes either
all commit or all roll back. Subscribers and sync clients observe the committed
result as one changeset.

The local SQLite target may serialize mutation execution. Postgres may allow
more concurrency later, but the observable contract must remain:

- no half-applied multi-row mutation state is published;
- `_version` and system timestamps are assigned consistently within the
  changeset;
- query handlers never see uncommitted mutation writes from another request.

Atomic commit is not enough when a mutation reads before it writes. If handler
execution happens outside the final write lock, the storage contract must provide
serializability by another means. The default v1 contract is read-set validation:
every mutation records the row ids, query ranges, index cursors, table predicates,
and auth/permission facts it read; at commit, the storage layer checks that those
dependencies have not changed since they were observed. Who records the read set
depends on where the deciding read happens: a server-executed (Ibex) handler
reads → awaits → commits, so the host *captures* the read set during execution; a
host-plan mutation is an unconditional write sequence whose reads and writes run in
one commit transaction (no server-side read-then-commit window), so the deciding
read is the *client's* optimistic read and the client supplies it as the mutation's
`read_set` baseline, which the server validates atomically at commit
([LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md) §Execution and Write
Semantics; DK-1/E3, Option A). A changed
dependency produces either a deterministic retry or a structured conflict
diagnostic. Silent commit against stale reads is outside the paved path for
invariant-preserving mutations such as inventory, ordering, balances, or
permission-gated writes.

> **Implementation status (updated 2026-07-02, LLP 0032 Phase 2):** the shipped
> v0 now meets this contract's isolation semantics. Read-your-writes works
> (LLP 0032 E2), unknown query indexes fail closed (E5), query-shaped
> dependencies validate at predicate granularity (E4, landed after M1), and
> host-plan mutations validate the client-supplied read set *by design* — under
> the atomic single-transaction host-plan model the deciding read is the client's,
> so the client declares the baseline and the server enforces it atomically at
> commit (E3, decided 2026-07-02 — Option A, pending Charlie's ratification). DK-1
> is fully resolved (E2/E3/E4)
> ([LLP 0032](./0032-decision-and-implementation-hardening.plan.md) Phase 2). The
> one open concurrency-control refinement (mutation handlers reading on a pinned
> snapshot rather than the live write connection) is separate from these isolation
> semantics. LLP 0003 §Execution and Write Semantics carries the full
> current-vs-target callout and the two-execution-models rationale.

This atomicity must also hold for **optimistic client application**, not only
server commit. Valet applied multi-row mutations optimistically as several separate
queued writes, which let another tab render a half-applied move; the fix was to
route multi-row changes through one server-authoritative changeset
([LLP 0006](./0006-valet-retrospective.research.md),
`[confirmed - Valet diaries, 2026-06-25]`;
[LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) §Mutation Replay owns the
client side).

The read-only-ness of query handlers cannot be assumed from the engine: SQLite
will not reject `INSERT/UPDATE/DELETE/PRAGMA` issued on a "query" path
(`[observed - Valet LLP 0040]`). A genuinely read-only query capability
([LLP 0009](./0009-code-execution-security.rfc.md)) needs an authorizer hook or a
statement check above storage, or it must be treated as a capability assertion the
runtime enforces, not a property the database provides.

## Schema Evolution

The first local schema applier may be conservative:

- create missing tables;
- add missing nullable or defaulted fields;
- create declared indexes;
- preserve removed optional fields instead of dropping data;
- reject removing a required field or making it optional while its preserved
  physical column remains `NOT NULL`;
- reject type changes that require rewriting existing rows;
- reject unsafe uniqueness changes unless the data already satisfies them.

A newly added required field is accepted only for an empty table until the
schema language gains a portable default/backfill expression. Tightening an
existing optional field is accepted only after an in-transaction null-count
check, and the physical SQLite column must become `NOT NULL` in the same schema
transaction (using a validated table rebuild where SQLite cannot alter the
constraint directly). Any null/backfill conflict rejects without advancing the
stored manifest or partially rebuilding the table.

Required-to-optional and required-field removal are not safe additive changes:
the rollback-preserving physical column remains `NOT NULL`, so accepting the
weaker manifest would make a generated insert that omits the field fail in
SQLite. Both changes reject before DDL or manifest replacement until an
explicit portable drop/backfill migration exists. Removing a whole table may
leave its physical table dormant for rollback, but an app reset clears every
physical user table — including dormant removed tables — in the same reset
transaction, so remove → reset → re-add cannot resurrect old rows.

This conservative applier is validated by Valet, which shipped almost exactly this
behavior in production: add-column-only, no `ALTER COLUMN`, no down-migrations,
type changes detected and *reported* as breaking changes rather than auto-converted,
and removed columns **kept** in the database (not dropped) for rollback safety
([LLP 0006](./0006-valet-retrospective.research.md),
`[observed - Valet LLP 0014]`). Adopt these with confidence. The sanctioned way to
change a field's type is the **deprecate-old + add-new + backfill** idiom; name it
as the escape hatch. Valet ran no online/branching/rollback migrations, which is
evidence that a conservative applier is sufficient for v1 and that full migration
planning can wait for its own LLP.

A content-based schema hash lets startup skip all migration work on the common
"unchanged" path — adopt it. But hash a **single canonical input set**: Valet
computed two divergent hashes (the client excluded indexes it never creates; the
server included them), so "schema unchanged" meant different things on each side
(`[observed - Valet LLP 0014]`). If two scoped hashes are unavoidable, make each
hash's scope explicit so consumers compare like for like.

This is not the full migrations system. It is the minimum safe behavior before a
dedicated migrations LLP defines branching, validation, rollback, online changes,
and SQLite-to-Postgres migration workflows.

## Export and Engine Graduation

The SQLite→Postgres graduation this Spec promises is an **export/import** problem,
and Valet's experience says it is two different contracts that should not be
conflated (`[observed - Valet LLP 0040/0049/0048]`):

- a **logical portable bundle** — schema, functions, declared-table rows, cron, and
  auth *identity* state — which is the cross-engine migration path; and
- a **byte-level snapshot** — fast, intra-engine, for backup/restore.

Both have a place; name both. The logical bundle must define what it **excludes**:
Valet's bundle deliberately omitted ephemeral auth sessions, verification codes,
webhook-dedupe state, and secret values. The unsolved hard part Valet flagged is
**atomic logical import** (and backfill on the target engine, and branch clone on
Postgres). Treat atomic cross-engine import as a first-class design problem here,
not an implementation detail of a later migrations LLP — it is the operation that
makes "graduate without a rewrite" true or false.

The portable store interface this contract rides on should be **async and
transaction/lease-aware from the start**. Valet's single largest retrofit cost was
extracting a portable backend trait *after* consumers had bound to a synchronous
shape, then having to re-thread async and lease semantics through every boundary
(`[observed - Valet LLP 0040/0048]`). LLP 0003 owns the local implementation, but
the contract it implements should not assume synchronous, single-process access.

## Portability Opt-Outs

Projects may eventually opt into engine-specific behavior, but an opt-out must
be explicit in generated artifacts and diagnostics. An agent must be able to
tell when a schema, query, handler, or deployment target is no longer portable.

Examples of likely opt-outs:

- raw SQL;
- engine-native ids;
- Postgres-only indexes or operators;
- SQLite-specific pragmas relied on by app logic;
- custom collations;
- non-portable JSON query behavior.

## Validation Requirements

Before this Spec moves beyond `Draft`, the acceptance suite should prove the
same logical app behavior on at least:

- local SQLite through LLP 0003;
- a simulated or real Postgres adapter once one exists;
- generated schema/codegen diagnostics for non-portable constructs;
- one mutation that writes multiple rows and publishes one changeset, with every
  affected row carrying the *same* commit version;
- one concurrent mutation test where two handlers read the same invariant and
  only one commits, or one is retried, rather than both committing stale results;
- one query whose null ordering and pagination behavior are asserted;
- one query whose result is asserted **identical** on the local replica and the
  server (the parity Valet's local whole-table path broke);
- one ordinary callable query reported as not syncable/offline-retained, and one
  restricted syncable query accepted by the local matcher;
- a machine-readable cross-engine conformance corpus (LLP 0010) as the standing
  portability proof — Valet treated "the trait is portable" as an assertion because
  the matrix CI rig was never built (`[observed - Valet LLP 0035/0083/0048]`).

## Open Questions

- Should timestamp precision be milliseconds, microseconds, or nanoseconds?
- How much JSON querying belongs in the portable paved path?
- What is the first cursor encoding, and does it include index values, `_id`, and
  `_version`?
- What is the portable representation of mutation read sets and query-range
  dependencies for commit-time validation?
- When should full migration planning split into its own LLP?
- Should exact decimals use a string encoding, scaled integers, or a dedicated
  decimal wire type?
- What is the portable representation of a project/database handle? Valet left
  `ProjectId` unpinned (a path string on local, a Durable Object id on Cloudflare,
  a `(tenant, project)` pair when hosted) and warned that backends then
  re-implement adapter logic at every boundary — pin it before the cross-engine
  handoff (`[observed - Valet LLP 0040]`).
- Is the query result contract materialized or streaming? Valet returned fully
  materialized results while the sync hydrator and snapshot exporter both streamed,
  and flagged this as a seam to settle before Postgres (`[observed - Valet LLP
  0040]`); large result sets and bulk export both want streaming.

## Status

Draft. This is the proposed storage contract that lets implementation begin
without accidentally tying Snapback to SQLite-only behavior.
