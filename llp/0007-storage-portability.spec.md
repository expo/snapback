# LLP 0007: Storage portability contract

**Type:** Spec
**Status:** Draft
**Systems:** Storage, API, Runtime, Sync, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-08-09 (unique indexes whose declared key includes optional
fields now use the portable unique-where-present profile: the manifest carries
`whereApplicable`, compound keys participate only when every component is
present, SQLite uses an all-components-non-null partial unique index, and
activation/write conflicts retain the existing portable uniqueness diagnostic).
2026-08-08 (closed string domains join the portable field
vocabulary as a `TEXT` column plus a manifest-owned domain check — explicitly
not a native Postgres enum type — and the conservative applier gains one
narrowing rule on the optional-to-required precedent; the same amendment
records why identity/default columns deliberately did not land here and routes
them to LLP 0191's commissioned identity-architecture Decision). 2026-08-06 (bounded managed-version integrity proofs: the
local target's healthy-case `_version` validation is pinned to runtime-owned
per-table indexes — an invalid-domain partial index plus a head index —
mirroring the change-journal sentinel; dated note inside the DK-2
commit-version graduation section; fail-closed semantics unchanged).
Prior: 2026-08-03 (`single_table_v1@1` owner amendment accepted by
Charlie: exact typed normalization/evaluation, null/order/digest semantics,
existing query bounds, the new class-only examined-entry refusal,
`none.v1` whole-result behavior, and cross-target parity are fixed; ordinary
APIs and implementation/capability claims are unchanged.) 2026-08-01 (LLP 0044 ceremony amendment companion: bare
`v.assetRef()` derives a generated default intent — restricted-to-default
on every write path; `upload: null` keeps the prior unrestricted
handler-attach-only semantics; dated note inside the v.assetRef
amendment). Prior: 2026-07-31, later same day (bounded-array withdrawal, author
decision by Charlie: the `v.array(v.assetRef(...))` placement the LLP 0044
companion amendment froze is withdrawn — no array table fields exist in
the shipped portable vocabulary; child rows are the paved multi-asset
path; dated note inside the amendment). Earlier: (LLP 0044 companion: `v.assetRef` joins the field
vocabulary with the `upload` restriction and explicit optional/bounded-array
nodes; commit-boundary asset admission is classified under commit-time
validation for every write path with the reverse edge in the same changeset;
the `.assetSharing` table declaration is frozen on the shipped closed
visibility union, citing LLP 0011's pushdown-compilability requirement by
name; asset system tables recorded as Snapback-owned). 2026-07-24 (same-landing amendments for the acceptance of LLP 0065/0080/0081: the change-journal's closed operation vocabulary admits the two typed schema-transition events with high-water counting and an unchanged head/cut invariant; every declared index gains the framework-generated, scan-order-only implicit trailing `_id` component; generated standard-pattern update/delete are named as the server-evaluated conditional-plan carve-out from the Option A client-baseline path; the Schema Evolution section points at Accepted LLP 0081 as the migrations authority and the Index Contract points at Accepted LLP 0080 as the controlling relational profile). 2026-07-23 (LLP 0086 CC-8 row 2 amendment: per-target durability claims adopt the output-gate vocabulary — "synchronous inside, gated at the boundary" — with D1 Sessions bookmarks recorded as prior art for keeping bookmarkable versions on the wire (wire half cross-referenced to LLP 0008); vocabulary and citations only, no decided contract changed). 2026-07-18 (ordinary tables can declare true single/compound unique indexes; v1 requires every key field to be non-optional, maps both activation and write conflicts to one stable diagnostic, and deliberately defers upsert sugar). 2026-07-17 (local SQLite commit-version allocation now acquires an `IMMEDIATE` writer reservation before reading the predecessor, making the serialized-writer guarantee true across sibling `LocalDatabase` connections; head-bound read/version pairs are likewise snapshot-atomic). 2026-07-17 (the plain-JSON commit-version stream is explicitly bounded by `Number.MAX_SAFE_INTEGER`; successor exhaustion refuses before every mutation tier, every durable ordering fact is decoded fail-closed rather than cast or defaulted, retained replay versions agree, journal snapshots prove their operation/id/version structure, databases carrying Snapback state prove an exact head/journal cut before additive open migration while foreign-only brownfield databases retain LLP 0057 rescue reachability, and authorization/activation SQL preflights complete source relations at that cut). 2026-07-13 (audit follow-up: required-field weakening is rejected while preserved physical columns remain `NOT NULL`, reset clears dormant removed tables, and direct query/action artifacts preflight closed-expression bounds); 2026-07-13 (data-boundary review follow-up: every filter operand now shares one 500-value portable bind ceiling, and scalar/system filter-type failures use one cross-target diagnostic); 2026-07-12 (ENG-24567/ENG-24573: portable queries are bounded identically across Rust, Cloudflare, and buffered overlays; required-field migrations now enforce and physically install `NOT NULL` atomically); 2026-07-12 (ENG-24342: the shipped plain-JSON Integer profile is explicitly JavaScript-safe-range bounded on every target, with shared boundary corpus evidence); 2026-07-02 (LLP 0032 X1: DK-2 commit-version graduation design note added — per-app gap-free streams, target-owned allocators, HLC rejected with a named revisit trigger; same day: LLP 0032 E3/DK-1: read-set-validation contract now names the two execution models — server-captured for Ibex handlers, client-supplied baseline for host-plan mutations (Option A) — and status callout refreshed for E3 decided/E4 landed. Earlier: LLP 0032 R3/R7 id algorithm closed as ratified UUIDv7 per LLP 0004; read-set-validation contract implementation-status annotation)
**Related:** LLP 0000, LLP 0001, LLP 0002, LLP 0003, LLP 0004, LLP 0006, LLP 0008, LLP 0009, LLP 0011, LLP 0012, LLP 0014, LLP 0018, LLP 0022, LLP 0032, LLP 0044, LLP 0083, LLP 0086

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
   every other persisted ordering fact when consumed: managed-row `_version`
   (including when it drives query filtering or ordering), resource and
   membership witnesses, membership-transition commit versions, retained
   mutation output and settlement versions, every change-journal row (not only
   a table's high water), and the retention floor. SQLite values with a
   non-integer storage class are corruption, not generic adapter errors.
   Insert/update journal snapshots are versioned objects whose `_id` and
   `_version` agree with the journal row; deletes carry no snapshot and unknown
   operations are corruption. The closed operation vocabulary additionally
   admits exactly two typed schema-transition events, `schema-resync` and
   `rollback-resync` (Accepted [LLP 0081](./0081-reviewed-storage-evolution-and-migrations.rfc.md)
   §4): each carries the migration operation id, predecessor and successor
   schema hashes, generation identities, and the raised retention floor;
   each counts toward the journal high-water exactly like a data operation;
   and the head/journal-cut equality holds across them unchanged. Any other
   unknown operation remains corruption. None of these facts may be cast, wrapped,
   rounded, hidden below a cursor, or treated as an absent/zero cursor. A
   failed durable-version read emits an explicit diagnostic and no fabricated
   cursor. Pruning and membership expiry planning also validate caller-supplied
   time values before converting them for SQLite. A database carrying
   Snapback-owned schema objects or managed app `_version` columns must prove
   one canonical head row, no retained ordering fact ahead of that head, and an
   exact retained journal high-water equal to the head before open performs any
   additive DDL. A brownfield database with no such evidence may take the fresh
   adoption lane; in particular, a foreign `_auth_*` collision alone must stay
   reachable to LLP 0057's dormant-collision rescue. Auth-table DDL alone is
   not an ordering discriminator: LLP 0057 requires even an exact unmarked
   catalog shape to remain a collision rather than be implicitly adopted. SQL
   consumers whose source rows affect authorization or
   emptiness without being returned—membership semi-joins, durable room
   permission projections, and auth-mode seed checks—preflight the complete
   source relation at the same pinned head before selection. Membership
   activation and protected-holder lifecycle checks likewise validate every
   declared membership and resource source at the transaction's pinned head;
   an unrelated valid row or seed cannot hide a later corrupt row before a
   declaration becomes authoritative.
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

- **Local SQLite (shipped):** every app-write path begins an `IMMEDIATE`
  transaction, thereby acquiring SQLite's single-writer reservation, and only
  then reads the predecessor and allocates its successor. The allocation,
  validation, rows, journal, and global-head update share that transaction.
  Starting a deferred transaction after an autocommit predecessor read is not
  equivalent: sibling connections could otherwise allocate the same version.
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

**Dated note — bounded integrity proofs for managed tables (2026-08-06).**
The fail-closed decoder posture above says nothing about *cost*, and the
first implementation proved managed-row `_version` integrity for every
touched table on every buffered commit by a healthy-case full scan — write
latency grew with table cardinality even when the handler performed only
indexed point reads (the Zerobugs Lane 8 large-fixture ingest surfaced this
as a P1: 900-row batches degrading superlinearly past 132k rows). The
mechanism is now pinned the same way the change journal's
`_snapback_changes_invalid_committed_version` sentinel already was: the
local SQLite target owns two indexes per managed table —
`_snapback_version_domain_<table>`, a partial index over exactly the
invalid-version predicate (non-integer storage class, `<= 0`, or above the
portable maximum as a literal), and `_snapback_version_head_<table>` on
`(_version)` for the forged-future range probe against the transaction's
head. Healthy-case validation is an empty partial-index probe plus one
indexed range probe — O(corrupt rows + log n), never table cardinality.
The contract itself is unchanged: corrupt values still refuse with
`SNAPBACK_STORAGE_VERSION_CORRUPT` before any application effect; a table
whose runtime indexes are absent or predicate-stale (adopted database
mid-upgrade, staged-rename window) validates by the unbounded scan rather
than skipping — correctness never degrades, only speed. The indexes are
ensured at table create/update, after a staged-generation swap rename, and
at every open (which still refuses corruption before performing this or any
other additive DDL). The acceptance suite must keep an executable witness
that the healthy path performs no table-cardinality scan and a scale check
whose fixed-size batch cost stays flat as the table grows. The authored
identifier grammar reserves the `_snapback` prefix, so these names cannot
collide with any authored index.

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

## Dated owner amendment: `SingleTablePlanV1` portability (2026-08-03)

Charlie Cheever accepted this amendment as LLP 0007's substantive part of the
`single_table_v1@1` owner ruling. LLP 0004 owns the closed
`SingleTablePlanV1` type; this Spec owns its normalization and evaluation
contract on every target. Acceptance is semantic only: no implementation or
capability claim follows, and the implementation/adoption program is
commissioned separately.

The host reconstructs the record from the served typed `QueryPlan`; it never
trusts a client-carried copy. The typed source fields are exactly `table`,
`filters`, `membership_filters`, `order`, `limit`, and `indexed_by`; the
generated manifest already projects `membershipFilters` with the other
generated spellings. Normalization:

- emits `format: "snapback.single-table-plan.v1"`;
- translates only `indexed_by` → `indexedBy`;
- makes optional `limit`, `indexedBy`, and each order field's
  `maxEncodedBytes` explicit as JSON `null`;
- re-emits the class-proved empty `membershipFilters` list;
- preserves filter and order declaration order; and
- rejects unknown fields at every level.

Filters use exactly `Eq | In | Lt | Lte | Gt | Gte`; order directions use
exactly `Asc | Desc`. Value expressions use exactly the LLP 0004
`SingleTableValueExprV1` closed non-authority/non-ambient grammar: `Args`,
`Arg`, `Binding`, `Literal`, `Field`, `Binary`, `Unary`, `If`, `Concat`,
`Call`, and `Record`, with binary operations
`Add | Sub | Mul | Div | Mod | Eq | Ne | Lt | Lte | Gt | Gte | And | Or`
and unary operations `Not | Neg`. Unknown variants refuse. Every evaluator —
local SQLite, buffered overlay, native/retained, and any claimed hosted or
future Postgres target — consumes this same normalized record and returns the
same complete full-document row array or the same refusal.

The identity-bearing digest selector is exact:

- empty `order` and `limit: null` → `rqsDigestKind: "mset1"`;
- any non-empty `order` or any explicit limit, including `0` or `1024` →
  `rqsDigestKind: "seq1"`.

`limit: null` is identity-significant and never normalizes to `1024`, although
the effective returned-row limit is 1,024 when the authored limit is absent.
Filter/order declaration order is likewise identity-significant.

The class bounds are closed:

| Bound | Class value |
| --- | ---: |
| primary tables | exactly 1 |
| membership semi-joins | 0 |
| returned rows | explicit `0..=1,024`; absent means 1,024 |
| cumulative literal `In` items | 500 |
| cumulative filter bindings | 500 |
| `ValueExpr` depth | 32 |
| optional string order-field `maxEncodedBytes` | integer `1..=2^53-1` when present |
| examined storage entries | 1,024 |

All bounds except the last are the existing portable plan/expression/schema
bounds. The examined-entry ceiling is a **new class-only owner decision made
by the 2026-08-03 ruling**, not a claim about the shipped `rqsEligible`
predicate or ordinary query execution. During `single-node.v1` establishment
or re-establishment the target counts physical storage entries examined and
refuses the whole establishment with a registered closed reason when entry
1,025 would be examined. No partial result or proof installs. An absent named
index remains valid under the ordinary API; this class adds no general index
requirement or scan ceiling outside node establishment.

`single-node.v1` uses the existing `none.v1` cursor profile for this class.
One establishment consumes `{kind:"first"}`, returns one bounded whole result,
and produces `{kind:"terminal"}`; there is no public input or output cursor,
and the visible page carries the canonical empty `none.v1` boundary vector.
The result reuses LLP 0157's `established-result-jcs.v1` encoding. Every target
must match these normalization, bound, refusal, whole-result, and no-cursor
semantics before it may advertise class support.

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

Every declared index carries a framework-generated implicit trailing
ascending `_id` component under binary collation (Accepted
[LLP 0080](./0080-portable-relational-queries-and-projections.rfc.md) §1):
it makes the `_id` ordering tie-break index-servable without `_id` becoming
an author-indexable field, and it is **scan-order only** — a unique index's
uniqueness constraint and its complete ordered key remain over the declared
fields alone, so the implicit component can never legalize duplicate
declared keys. Bounded relational queries and maintained projections over
these indexes are governed by Accepted LLP 0080, the controlling first
relational profile this Spec's query semantics deliberately did not define.

The shipped v1 spelling is
`.index('by_event_user', ['eventId', 'userId'], { unique: true })`. It creates a
true database unique index inside schema activation; inserts and patches race
at the serialized commit, so exactly one duplicate key wins and every loser is
`SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`.

**Dated amendment — unique where present (2026-08-09).** When every declared
key field is required, uniqueness remains total. When one or more declared key
fields use `v.optional(...)`, the same authoring spelling automatically selects
**unique where present**; there is no second authoring syntax. The generated
index manifest carries `whereApplicable: true`, so adapters consume an explicit
portable fact rather than re-inferring semantics from field optionality.

A row participates in a compound unique-where-present index only when **every**
declared key component is present. Any absent component exempts the row. The
alternative any-present rule is rejected: partial presence would make identity
depend on which subset happened to be present, leaving no decidable compound
identity to compare.

SQLite implements the profile as a partial unique index whose predicate is
`WHERE col1 IS NOT NULL` for a single field and `WHERE col1 IS NOT NULL AND
col2 IS NOT NULL ...` for a compound key. Postgres has the identical partial-
unique-index mapping; that semantic pin applies when its adapter is implemented,
but this amendment does not claim a Postgres adapter today. Adding uniqueness
to brownfield data remains unsafe unless the rows that participate already
satisfy it. The pre-publication activation scan and partial-index construction
consider participating rows only; a duplicate refuses activation with
`SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`, leaving the predecessor active. Runtime
insert and patch conflicts use that same portable diagnostic as required-key
unique indexes—there is no new diagnostic class.

An `upsert` helper is explicitly out of scope for this slice. A unique index is
the invariant; insert-vs-update selection, returned-row semantics, authorization
of the update arm, and retry behavior need a separate portable API decision.
Applications that want duplicate creation to be an error should insert and
handle the typed conflict, as Shindig does.

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
Semantics; DK-1/E3, Option A). One carve-out: generated standard-pattern
update/delete operations lower to a server-evaluated conditional plan —
read, owner guard, then write in one authoritative transaction — rather
than the client-supplied-baseline path (Accepted
[LLP 0065](./0065-generated-data-pattern-soundness.rfc.md) §2, under
LLP 0051's conditional mutation model). A changed
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

### Durability vocabulary: synchronous inside, gated at the boundary (amended 2026-07-23)

> Recorded 2026-07-23 per [LLP 0086](./0086-prior-art-course-corrections.plan.md)
> CC-8 row 2 as a dated amendment under this Spec's convention: it fixes
> vocabulary and cites prior art, and changes no decided contract elsewhere in
> this document.

Every storage target this Spec graduates to must state its durability claim in
one shared vocabulary: **synchronous inside, gated at the boundary**. The claim
has two named halves —

- **the synchronous interior:** what the target guarantees at the moment a
  commit call returns *inside* the write authority — the transaction is
  committed, the commit version is allocated, and subsequent reads on that
  authority observe it;
- **the boundary gate:** the durability condition that must hold before any
  externally observable effect of the commit is released — the mutation
  response, the changeset, subscription fan-out, and any other outgoing
  message.

The two halves may coincide (local SQLite: the fsync'd WAL commit is both the
interior and the gate) or deliberately differ (Cloudflare DO SQLite: SQLite
commits synchronously in-object, while the platform's output gates hold all
outgoing network messages until the write replicates 3-of-5 — so the interior is
fast and the boundary never exposes an unconfirmed write). A per-target
durability claim that names only one half is incomplete under this Spec: a
target must say what "committed" means inside, what the gate waits for at the
boundary, and therefore exactly what an external observer can conclude when it
sees a version `N`. The gate is what makes property 3 above (gap-free commit
visibility) a *durability* statement and not merely an ordering one. The
vocabulary is taken from Cloudflare's SRS storage engine, which pairs
synchronous SQL with output gates
([LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md) §The storage
engine's design lessons (SRS)).

**Prior-art note — keep bookmarkable versions on the wire.** D1's Sessions API
ships sequential consistency across read replicas via lexically comparable
bookmarks attached to each query and portable across requests
([LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md) §D1 — the managed
sibling, and its one original idea). That is a shipped wire contract for
exactly the read-consistency problem this Spec's commit-version graduation will
face if a target ever adds regional read scale. The `(stream identity,
version)` cursor pinned above is already bookmark-shaped; no evolution of the
wire protocol may replace it with a token that cannot be compared and resumed
the way a bookmark can. The wire half of this note — client cursors, resume,
and retention — is owned by
[LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) §Retention, not here.

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

This is not the full migrations system. It is the minimum safe behavior below
the dedicated migrations authority: Accepted
[LLP 0081](./0081-reviewed-storage-evolution-and-migrations.rfc.md) now
defines the reviewed preview/approval/execution/verification/rollback
workflow for every change this conservative applier refuses (its v1 is the
exclusive single-writer profile; online changes and engine graduation remain
future profiles there).

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

## Dated amendment: asset references, sharing declarations, and admission (2026-07-31)

> Recorded 2026-07-31 as part of
> [LLP 0044](./0044-asset-storage-pipeline.rfc.md)'s gating companion pass
> (its §Open questions makes this freeze an implementation prerequisite;
> the pass was directed by Charlie on 2026-07-31). This amendment adds
> vocabulary and commit-boundary semantics; it changes no decided contract
> above.

**`v.assetRef` joins the portable field vocabulary.** Spelling, in the
closed validator set of `packages/snapback-codegen/define.mjs`:
`v.assetRef(options?: { upload?: string | null })`, where `upload` names
the exported upload-intent binding whose assets the field admits.
Placements are explicit schema nodes: bare and
`v.optional(v.assetRef(...))`.

> Amended 2026-08-01 (LLP 0044 §Ceremony floor, author-ruled): a bare
> `v.assetRef()` — `upload` omitted — now derives a generated default
> intent from its table/field placement (stable id
> `_assets.default.<table>.<field>`; strict delivery, strip, owner-only;
> manifest-visible like any intent), so the field behaves as
> restricted-to-its-default on every write path. The prior
> unrestricted, handler-attach-only semantics keep the explicit spelling
> `upload: null`.

> Amended 2026-07-31, later same day (author decision, Charlie): the
> bounded-array placement `v.array(v.assetRef(...), { maxItems })` this
> amendment originally froze is **withdrawn**. Implementation established
> that the portable field vocabulary ships no array table fields of any
> type — "array of portable values" above remains intended, unshipped —
> so the node promised a shape the platform cannot host. The paved path
> for multi-asset relationships is one row per asset in a child table
> (the LLP 0110 bounded-children idiom), which the reverse-edge,
> sharing, and GC machinery already serve and which the Party Wall demo
> validated end to end. If portable array fields later ship on their own
> merits, admitting an assetRef element type is an additive follow-up,
> not a breaking change.
The physical representation is the opaque asset id string under the
single-sourced type map; asset bytes are never inline document fields
(unchanged rule above). The asset metadata, upload-attempt, blob,
rendition, reverse-reference-edge, publication-record, and asset-work
ledger tables are Snapback-owned system tables in the LLP 0044 §Internal
model shapes; application schemas cannot declare or shadow them.

**Commit-boundary admission is part of commit-time validation.** Every
committed write to a `v.assetRef` field — scalar or optional, on every
write path — validates an admission inside the final
write lock, in this Spec's read-set-validation idiom. Handler (Ibex)
writes consume the transaction-scoped admission `ctx.assets.attach`
records; write paths without handler execution — host plans, including
both the Option A client-baseline path and the server-evaluated
standard-pattern carve-out, plus seed, migration, and admin edits — derive
the admission check from the field's declared `upload` restriction and run
it under the path's own authority in the committing transaction, refusing
on a restriction-less field. An untyped or admission-bypassing write fails
the commit with `SNAPBACK_ASSET_REF_UNVERIFIED`. The system
reverse-reference edge commits in the same changeset as the field write,
including field update, field clear, and row deletion. LLP 0044's
finalization-time authorization witness is this Spec's complete read-set
witness — row ids, observed-missing rows, query ranges, index cursors,
table predicates, and auth/permission facts — captured at upload-intent
admission and re-validated at finalization; it introduces no second
dependency vocabulary.

**The asset-sharing declaration.** Table-builder spelling:
`.assetSharing(spec)`, where `spec` reuses the shipped closed visibility
union rather than a not-yet-implemented general permission language:
`{ kind: 'public-read' }`, `{ kind: 'owner', field }`, or
`{ kind: 'membership', membership: <declared membership id>, roles?: [...] }`
(the [LLP 0056](./0056-scoped-roles-and-memberships.rfc.md) membership
predicate, already admitted by LLP 0053's 2026-07-14 amendment). Each
variant is pushdown-compilable by construction, satisfying *LLP 0011,
pushdown-compilability requirement, 2026-07-23* — cited by name as that
requirement demands. A table without `.assetSharing` confers no
`via-references` asset read authority regardless of any other visibility
it declares — LLP 0044 v6's explicit-declaration rule; the declaration is
an app-authored statement that anyone the spec admits may also read assets
referenced from the table's rows, independent of any function-level gate a
query adds. When a general row-visibility language lands (LLP 0011's open
question), `.assetSharing` becomes a citation into it rather than a
parallel dialect.

## Dated amendment: closed string domains and the identity-column boundary (2026-08-08)

**The portable field vocabulary gains one entry: a closed string domain.** A
declared stored field may carry a closed set of two to seven unique string
values (LLP 0004 §Dated alignment: stored literal-union domains owns the
authoring grammar and the admission rules). This is a *domain*, not a new
physical type. The single-sourced physical mapping this section demands is one
row long and deliberately unsurprising:

| portable type | SQLite | Postgres (intended) |
| --- | --- | --- |
| closed string domain | `TEXT` (identical to `string`) | `text` plus the same server-side check — **not** `CREATE TYPE ... AS ENUM` |

The Postgres choice is the load-bearing part of the row. A native enum type
would move the domain into engine DDL, where adding a value is an `ALTER TYPE`
that cannot run inside every transaction and removing one is not expressible
at all — the domain would then evolve on two different schedules on two
engines, which is exactly the drift this section exists to prevent. Keeping the
domain in the manifest and the check in the central writer keeps one authority
on every target. The domain is invisible to the query surface: a closed-domain
field is string-like for equality filters, ordering, index eligibility, unique
indexes, and the live matcher, and the wire encoding is a plain JSON string.

**§Schema Evolution gains one conservative-applier rule.** The existing list
admits added nullable fields and refuses type changes that require rewriting
rows. A domain *narrowing* rewrites no rows — the physical column does not move
— so it is admitted on exactly the terms the optional → required tightening
already uses: an in-transaction check over existing non-NULL values, the
physical column untouched, and a whole refusal that advances neither the stored
manifest nor any DDL when a row does not satisfy the successor domain
(`SNAPBACK_SCHEMA_ENUM_DOMAIN_BACKFILL_REQUIRED`, carrying one representative
offending value). Concretely: `string` → closed domain and closed-domain
narrowing take the check; widening a domain and closed domain → `string` are
admitted without a scan; every other type transition into or out of a closed
domain remains `SNAPBACK_SCHEMA_FIELD_RETYPED`. Accepted LLP 0081 remains the
authority for everything this applier still refuses, and its closed intent
vocabulary is unchanged by this amendment.

**The identity-column boundary, recorded so it is not rediscovered.** The
companion porting gap — a server-owned monotonic numeric column with a
configurable start, PostgreSQL's `GENERATED ... AS IDENTITY`
(`issues/shelved/20260808-numeric-identity-default-columns.md`) — is deliberately
*not* answered by this amendment, and the schema surface deliberately did not
grow a counter of its own. Three standing facts converge:

- `FieldManifest` has no default/server-assigned slot, and the only existing
  server-assigned column values are `_id`, the three system columns, the
  framework-owned relation-incarnation stamp, and membership provenance —
  every one of them a *closed framework concept*, not an app-declared default.
  A general default expression is a vocabulary question, not a column question.
- Framework-owned monotonic counters already exist and are owned elsewhere:
  Accepted LLP 0135 §1.1 defines them, stores them in
  `_snapback_sequence_counters_v1`, and pins v1 to "JavaScript-safe integers,
  first value 1, step 1, no authored start, step, or format", with "any
  cross-scope or global counter" named as not lifted. A table-level identity
  column is precisely a global counter with an authored start. Building a
  second counter authority beside that one would recreate the disagreement
  §1.1 rejects with rationale.
- LLP 0191 §3 reaches the same place from the other side and adds the sizing
  fact: an identity column wants *sequence* semantics — monotonic, **gaps
  allowed**, rollback burns values, a display/permalink identity rather than
  the canonical relationship key — because a gapless transactional counter
  serializes every write to the table and recreates a scale cliff at exactly
  the store size that exposed the gap. Charlie's 2026-08-08 OQ2 ruling routes
  it, with declared source keys, defaults, and alternate-key lookup, through
  one coordinating identity-architecture Decision whose implementation reaches
  this Spec and LLP 0004 as owner amendments
  (`issues/20260808-identity-architecture-decision.md`).

So the boundary is: closed string domains land now because they add a
predicate to an existing column; identity and default columns wait for the
Decision that fixes the identity vocabulary, because they add a new kind of
server-owned value and a second allocation authority. Whichever design that
Decision distributes here must state its gap semantics, its exhaustion refusal
against this Spec's JavaScript-safe integer bound, and its relationship to
LLP 0135's counters explicitly.

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
