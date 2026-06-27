# LLP 0007: Storage portability contract

**Type:** Spec
**Status:** Draft
**Systems:** Storage, API, Runtime, Sync, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-06-25
**Related:** LLP 0000, LLP 0001, LLP 0002, LLP 0003, LLP 0004, LLP 0006, LLP 0008, LLP 0009, LLP 0011

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
- exact signed integer;
- exact decimal;
- floating-point number;
- timestamp;
- json object;
- array of portable values;
- nullable and optional variants;
- references expressed as opaque ids.

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

The runtime may choose the concrete id algorithm, but it must satisfy:

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
- comparing unlike non-null types is an error;
- null checks use explicit `isNull` and `isNotNull`;
- sort order is stable and deterministic;
- nulls sort after present values unless a future API explicitly chooses another
  null ordering;
- pagination for large or mutable result sets uses cursors, not offsets;
- offset-style `skip(n)` is a small-data convenience and should warn on
  production-marked unbounded queries.

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
dependencies have not changed since the handler observed them. A changed
dependency produces either a deterministic retry or a structured conflict
diagnostic. Silent commit against stale reads is outside the paved path for
invariant-preserving mutations such as inventory, ordering, balances, or
permission-gated writes.

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
- preserve removed fields instead of dropping data;
- reject type changes that require rewriting existing rows;
- reject unsafe uniqueness changes unless the data already satisfies them.

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

- Which exact id algorithm should the runtime use?
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
