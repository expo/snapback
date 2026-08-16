# LLP 0004: Application data API

**Type:** RFC
**Status:** Draft
**Systems:** API, Storage, Runtime, Sync, Developer experience
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-08-15 (removed the LLP 0255 amendment after the author
selected LLP 0254 D10 Withdraw)
**Revised:** 2026-08-08 (stored literal-union domains admitted at table fields:
`v.union([v.literal('a'), v.literal('b')])` lowers to `FieldType::Enum`, a
`TEXT` column with a central fail-closed write-path domain check, generated
literal-union types, and one added conservative-applier rule for domain
narrowing; the CV-4b Spec commission for stored arrays and objects is
unchanged — see §Dated alignment: stored literal-union domains). 2026-08-03 (`single_table_v1@1` owner amendment accepted by
Charlie: `SingleTablePlanV1` is the closed normalization of the exact shipped
`rqsEligible` predicate, with a new class-only 1,024 examined-entry
establishment refusal; ordinary Query/LiveQuery APIs are unchanged and no
implementation/capability claim follows.) 2026-08-01 (implicit collection completeness: a JS
`ctx.db.query(...).collect()` that reaches the portable 1,024-row cap now
refuses with `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`; authors must use
server-side ordering plus explicit `take(n)` when they intend a bounded
prefix). 2026-07-30 (Diary 0039 dated alignment: structured collection
validators for arguments and stored fields are a named spec hole to be filled
by a new owned Spec under this RFC's portability rules, per LLP 0115 CV-4 —
see §Dated alignment: structured collection validators); 2026-07-27 (LLP 0108 amendment: JS handlers may be colocated as
direct self-contained expressions; explicit result contracts flow through
generated references and runtime egress validation); 2026-07-26 (stable codegen identity now takes `appId` from the
nearest ancestor `demo.snapback.json` explicit `id`, so nesting a backend below
`backends/` cannot silently rename its functions; bare backends retain the
immediate-parent compatibility fallback); 2026-07-24 (same-landing amendments for the acceptance of LLP 0065/0080/0081: the deferred joins/query-planning and schema-migrations bullets now point at Accepted LLP 0080 and LLP 0081 as their controlling authorities, and the generated standard-pattern conditional-lowering carve-out from this RFC's unconditional host-plan writes is recorded per Accepted LLP 0065); 2026-07-16 (ENG-24920 companion amendment); 2026-07-14 (ENG-24905: pinned the stable function id codegen rule under §First-Slice API Decisions — required `{appId}:{exportedName}` ids, byte-identical across regeneration of unchanged source, retired on rename; the LLP 0055 stage prerequisite). Earlier: 2026-07-02 (LLP 0032 E3/DK-1: §Write Semantics now describes host-plan mutation isolation as the client-supplied read_set baseline by design (Option A); status callout refreshed — E4 landed, E2 landed. Earlier: LLP 0032 R7 §Write Semantics implementation-status annotation)
**Related:** LLP 0000, LLP 0001, LLP 0002, LLP 0003, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0012, LLP 0108

## Summary

Snapback needs a separate LLP for the API that applications use to communicate
with it, especially around the data store. LLP 0003 defines the local Rust
server and SQLite core. This document defines the app-facing data API contract:
how backend handlers read and write data, how clients invoke those handlers, and
which parts of that API must remain portable across SQLite, Postgres, local
sync, and hosted targets.

The decision: Snapback's paved path is a typed, function-first API over a
portable document/relational data layer. App code talks to Snapback through
named queries and mutations. Handler code talks to the data store through
`ctx.db`. Clients talk to generated function references. Raw SQL and direct
table writes are escape hatches or bring-up tools, not the default product API.
The concrete hook and helper names in this document are illustrative unless a
later Spec fixes them.

## Why This Is Separate

The data API is a load-bearing contract for agents. It is the surface generated
apps will use constantly, and small choices here determine whether Snapback can
preserve its SQLite-to-Postgres story, local-first sync story, authorization
story, and Design Mode story.

It should not be buried inside the local server architecture LLP. The server can
change shape across local, Cloudflare, and hosted targets; the application data
API should feel stable across those targets.

It also should not wait for the full storage abstraction LLP. The first
implementation needs a concrete API now, while the deeper storage LLP can later
define query planning, SQL feature portability, migrations, indexes, and
Postgres-specific scale-up behavior.

## Design Inputs And Bias

This revision incorporates three concrete lessons from the Valet demo diaries.
First, schema/codegen failures must be loud: the kanban diary found a field
silently omitted from the generated schema when a validator was assigned through
a variable, which made writes appear to succeed while persisted documents lost
the field. Second, local/server parity cannot be assumed: the Klondike diary hit
auth mismatches, burst writes that exceeded the WebSocket rate limit, and
multi-row optimistic updates that rendered partial game states in another tab.
Third, generated adapters matter: the Valet demos repeatedly copied local bridge
glue, and the Pong diary kept handler code self-contained because server replay
only saw handler source.

Convex and InstantDB point at the same API bias. Convex's schema and generated
types make data access legible to TypeScript; its docs push explicit index use,
transactional mutations, and lintable async rules. InstantDB's schema, typed
queries/transactions, permission files, sandbox, and LLM/MCP workflow show that
agents do better when the system has source files they can inspect and a
machine-checkable place to try queries, transactions, and permission checks
before editing app code.

The agent-facing conclusion is that Snapback should prefer analyzable, generated,
diagnostic-heavy APIs over flexible but opaque JavaScript surfaces. Humans often
prefer terse affordances; agents can think ahead and benefit more from explicit
proofs: generated manifests, source spans, permission explanations, query plans,
capability flags, and errors that fail before a demo silently loses data.

## API Layers

There are three API layers in scope:

1. **Schema API**: the project defines tables, field validators, indexes, and
   sync metadata in source code.
2. **Handler API**: backend functions are declared with `defineQuery` and
   `defineMutation`; their handlers receive `ctx`, including `ctx.db`.
3. **Client API**: generated function references are used by clients to run
   queries, subscribe to live results, and invoke mutations.

The raw HTTP/WebSocket protocol is not the product API. It is an implementation
detail that carries generated API calls between the client and the server.
The generated API should also be the contract that automated agents inspect:
schemas, function references, permissions, query plans, and local/server
capabilities should be available as files or machine-readable diagnostics rather
than only as runtime behavior.

## Schema API

The schema API should be source-authored and codegen-friendly:

```ts
export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
    userId: v.string(),
  })
    .index('by_user', ['userId'])
    .sync({
      filter: (q, ctx) => q.eq('userId', ctx.auth.userId),
    }),
})
```

The schema contract should produce a generated manifest with:

- table names;
- field names, types, optionality, and deprecation state;
- system fields;
- indexes and search indexes;
- sync metadata;
- schema hash;
- any auth or authorization metadata needed by the server.

The first slice can support a narrow validator set. The important constraint is
that the validator vocabulary maps cleanly to SQLite, Postgres, generated
TypeScript types, serialized wire data, and local client storage.

The schema parser/codegen must fail closed. If it cannot resolve a validator,
field, index, sync filter, or table expression into the generated manifest, it
must produce an error with file and source-span context. It must not silently omit
that field or strip it at persistence time. The generated manifest should be
deterministic enough for agents to diff before and after a schema edit.

## Handler API

Handlers define the application backend API:

```ts
export const listTodos = defineQuery({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query('todos').order('_createdAt', 'asc').collect()
  },
})

export const createTodo = defineMutation({
  args: { title: v.string() },
  handler: async (ctx, args) => {
    return ctx.db.insert('todos', {
      title: args.title,
      completed: false,
      userId: ctx.auth.userId,
    })
  },
})
```

Creation and update times come from the server-owned system fields `_createdAt`
and `_updatedAt` (LLP 0003), so handlers do not set them and the example above
does not declare a `createdAt` column. When a handler genuinely needs a timestamp
or a generated id, it must take them from the injectable runtime clock and id
source rather than calling `Date.now()` or `Math.random()` directly — otherwise an
optimistic client execution and the authoritative server execution produce
different values and offline replay diverges (see *Write Semantics*).

Queries are read-oriented functions. Mutations are write-oriented functions.
The function name, args schema, return type, and execution metadata become the
stable client-facing API.

The first implementation should require handlers to return JSON-serializable
values. Documents crossing the API boundary are plain objects with schema fields
plus Snapback system fields. This is a first-slice simplification, not the
portability contract: exact 64-bit integers and decimals (the finance reference
app's money-grade correctness, LLP 0000) and binary values (the asset path) need
an encoding that survives the SQLite↔Postgres and client boundaries, so the wire
format must extend beyond plain JSON before those reference apps are in scope (see
*Portability Rules*).

The `ctx.auth` shape in examples is provisional. The auth LLP owns the final
claims/session/provider model; this API only requires that handlers can receive a
stable auth context when auth is available.

The handler loader must also define how helper code is made available to server
replay. Either handlers are bundled with their module dependencies, or codegen
rejects unsupported external references. Requiring every handler body to be
self-contained is an acceptable bring-up constraint only if the error is explicit
and documented; otherwise agents will accidentally write handlers that pass local
typecheck but fail under the Rust server.

## ctx.db Contract

Queries receive a read-only `ctx.db`. Mutations receive a read-write `ctx.db`.
The two surfaces should share query semantics, but read-only handlers must not
be able to call write methods.

The first read contract should include:

- `get(id)` returns one document or `null`;
- `query(table)` returns a chainable query builder;
- `search(table, field, options)` is optional for the first slice, but the API
  should reserve room for it.

The first write contract should add:

- `insert(table, value)` creates a row and returns its id;
- `patch(id, updates)` applies a partial update;
- `delete(id)` removes a row.

The first query builder should include:

- `withIndex(indexName, (q) => ...)`;
- `filter(predicate)`, where `predicate` is a structured expression, not an
  arbitrary JavaScript callback;
- `eq`, `neq`, `lt`, `lte`, `gt`, `gte`;
- `oneOf`;
- `isNull`, `isNotNull`;
- `arrayContains`;
- `order(field, direction)`;
- `take(n)`, `skip(n)`;
- `collect()`;
- `first()`.

The query builder is a portable API, not SQL. It should map to SQL pushdown when
possible and fall back to correct in-process evaluation only when needed. If a
query cannot be executed efficiently or portably, the API should make that
visible to agents through diagnostics rather than silently becoming a production
footgun.

`collect()` is portability-bounded, not an unbounded table materializer. A JS
handler that omits `take(n)` and receives exactly the portable 1,024-row ceiling
cannot prove whether that prefix is complete, so it fails closed with
`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`. An explicit `take(n)` acknowledges
prefix semantics; ordering and filtering that determine the prefix must be in
the query builder before `collect()`, not applied in JavaScript afterward.

The default shape should be index-first for unbounded tables. `filter` should be
a structured predicate expression, not an arbitrary JavaScript callback, and
Snapback should warn or fail when a subscribed or production-marked query scans a
large table without an index, cursor, or explicit small-data opt-out.

Query handlers should be deterministic with respect to their args, auth context,
and database state. Non-deterministic APIs such as time, random values, and
network I/O should stay out of queries unless a later Spec defines how they
interact with caching, reactivity, and replay.

Not every callable query is a syncable live query. For v1, Snapback should draw a
hard capability line:

- ordinary `defineQuery` functions are callable server reads;
- a restricted syncable-query subset — possibly spelled `defineLiveQuery` or a
  `syncable: true` query declaration — is eligible for retained local results,
  incremental realtime deltas, and authorization-aware resubscribe;
- any query outside that subset must be reported as online-only or replace-only,
  not silently treated as fully local-first.

The v1 syncable subset should be structured and analyzable: one primary table,
declared args, declared auth predicate, portable query-builder filters, declared
index/cursor ordering, bounded result size or explicit retention policy, and no
opaque JavaScript callback that the sync matcher cannot inspect. This keeps the
local-first contract true for the subset Snapback can prove instead of implying
that any named function automatically has offline and incremental-sync semantics.

## Write Semantics

Mutations are server-authoritative. Each mutation should run inside one atomic
write boundary by default. In the ratified target, handler execution itself is
**not** globally serialized: the local target drives handlers concurrently and
serializes only the brief commit, keeping concurrent mutations isolated through
snapshot reads plus a commit-time read-set conflict check rather than a single
global mutation lock
([LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md) §Execution and
Write Semantics). What must hold is the *observable* boundary — a handler never
sees another request's uncommitted writes — not any particular scheduling of
execution. (**Implementation status, updated 2026-07-02:** read-your-writes
works (LLP 0032 E2), query-shaped read-set validation is predicate-granular
(E4), and host-plan mutation isolation is the client-supplied `read_set` baseline
*by design* (E3, decided Option A, pending Charlie's ratification — see the
paragraph below). Query handlers now run on pinned WAL snapshots via the reader
pool (LLP 0032 L6); mutation handlers still serialize on the global instance
mutex. See LLP 0003's §Execution and Write Semantics callout and
[LLP 0032](./0032-decision-and-implementation-hardening.plan.md) Phase 2.)

All writes performed by one mutation should commit and publish as one changeset.
A client may optimistically simulate that changeset, but subscribers should not
observe half-applied multi-row state. Burst handling should be framed around the
mutation result or changeset, not around one WebSocket message per row write, so
large but valid mutations do not leave clients with invisible pending writes.

Queries should not mutate data. Mutations may read before writing. The first
implementation should avoid exposing long-running network I/O inside query and
mutation handlers; actions can add that later under a separate contract.

Because LLP 0003's local core drives async handlers to completion before taking
the write lock, mutation reads are not automatically protected by the final commit
transaction. A mutation that reads data and later writes must therefore participate
in the mutation isolation contract: the host records the rows, query ranges, and
auth/permission facts the handler relied on, validates them at commit, and retries
or rejects the mutation when those dependencies changed. Host-plan mutations are
the mirror image: they are unconditional write sequences with no server-side
read-then-commit window, so the deciding read is the *client's* optimistic read,
and the client supplies that baseline as `read_set` for the server to validate
atomically at commit. Either way the same rule holds — a read-before-write cannot
silently commit against invalidated assumptions — enforced at whichever party
actually performed the read (LLP 0003 §Execution and Write Semantics; DK-1/E3,
Option A). App code must not assume that "server-authoritative" means stale reads
can safely commit. The generated API and diagnostics should expose conflict
failures distinctly from validation errors and ordinary thrown handler exceptions.

Generated IDs and timestamps should be injectable through the runtime so
offline replay can produce stable inserts and timestamps later. The handler API
should not need to change when local-first mutation replay arrives.

If the same mutation can run locally for optimistic updates and on the server for
authority, both executions should see the same `ctx.db` semantics. Any target
that cannot provide parity must report that as an explicit capability gap.

## Client API

Clients should call generated function references, not hand-written endpoint
strings:

```ts
const todos = useQuery(api.todos.listTodos, {})
await mutate(api.todos.createTodo, { title: 'Buy milk' })
```

The generated client API should provide:

- typed function references;
- typed args;
- typed return values;
- a live query/subscription path;
- a mutation invocation path;
- connection and pending-mutation state for UI and agent validation.

Direct client-side table writes are not the paved path. They may exist in tests,
local optimistic execution, or internal sync machinery, but application code
should express writes through named mutations.

The generated client/runtime adapter should be part of Snapback's product
surface, not copied per demo. Application frameworks can provide thin bindings,
but the bridge between generated function references, local execution, pending
mutation state, and subscriptions should be generated or imported from a stable
package.

## Relationship To Sync And Realtime

The syncable live query, not every named query, is the unit clients subscribe to
for retained local-first data and incremental realtime delivery. A named query can
be implemented as a simple table filter, a server-executed function, or eventually
a richer relational query, but the client API must expose the capability
difference: callable, live-replace, syncable-live, offline-retained, and
auth-resyncable are separate properties, not synonyms.

Two mechanisms behind that subscription are load-bearing and not settled here.
First, *reactivity*: how the server learns a live query's read-set, so a
committed write re-runs exactly the subscriptions it affects. This is the
server-side counterpart to LLP 0003's subscription matcher and LLP 0001's
"Convex-grade reactivity on a standard relational store" open question; leaving it
implicit risks each layer assuming the other owns it. Second, *authorization-aware
subscription*: an opaque server-executed function cannot be analyzed for what it
reads or whether its results leak rows a viewer may not see, so not every query
form can safely back a live, authorization-filtered subscription (the card-game
reference app, LLP 0000). Which forms qualify — and how the table-level
`.sync({ filter })` composes with function-level query subscriptions — is an open
question below. Until that question is settled, only the restricted syncable
subset above should be advertised as local-first.

This RFC does not settle the local-first protocol. It only constrains it: the
sync system should preserve the same function and `ctx.db` programming model
rather than forcing apps to use a separate offline-only API.

## Permissions And Debugging

Authorization is a separate LLP, but this API must reserve space for
permission-aware development. Agents need a way to run a query or mutation as a
particular user, guest, or unauthenticated session and receive the same
permission result the server would apply. Admin bypasses should be explicit in
the API shape, and a test impersonation path should be available so local
validation does not drift from server replay.

Snapback should ship a local "doctor" or sandbox command early. At minimum it
should run generated queries and mutations against a local database, show raw
results, explain permission checks, report query plans/index usage, show
read-set/subscription metadata when available, and surface local/server
capability gaps. This is not just human debugging UI; it is the feedback channel
agents use to repair their own plans before changing more code.

## Portability Rules

The data API should preserve the SQLite-to-Postgres path by default:

- schema field types must have a portable storage representation;
- the numeric vocabulary must distinguish integer and decimal from floating
  point: a single JS-number type (an IEEE-754 double) cannot carry 64-bit
  integers or exact decimal money, so the validators and wire encoding must
  represent these exactly rather than assuming plain JSON;
- binary/asset bytes are not JSON and should cross the boundary out-of-band (see
  asset storage, LLP 0000), not embedded inside the JSON document;
- query builder operations must have clear semantics independent of SQL engine;
- sorting, null behavior, and type comparisons need documented behavior;
- generated IDs and system fields must have the same observable meaning across
  local optimistic execution and server execution;
- raw SQL is not part of the paved path;
- engine-specific features require an explicit opt-out from portability.

The first slice can be single-table-first. It should not close the door on
joins, relation traversal, aggregations, or richer server queries. Those need a
follow-on storage/query spec before agents rely on them.

## Agent Feedback Requirements

The API must give agents enough feedback to correct themselves:

- codegen should fail with clear errors and source spans for invalid schemas,
  unsupported schema syntax, and handler definitions;
- unknown table and field names should be caught as early as practical;
- unsupported query operations should fail loudly;
- unindexed scans, offset pagination over large tables, and non-portable
  predicates should be warnings or errors depending on target/capability flags;
- generated types should make common API misuse hard;
- lints should catch unawaited async database operations, direct time/random use
  in handlers, and unsupported external handler dependencies;
- runtime errors should include the function name, argument shape, auth/user
  context class, data API operation, and local/server target that failed.

Where TypeScript cannot provide a guarantee, the server should expose a
machine-readable diagnostic. The diagnostic should be stable enough for an agent
to consume without scraping prose.

## Deferred Work

This RFC does not settle:

- the WebSocket wire protocol;
- local mutation queues, replay, and conflict semantics;
- authorization and row-level visibility rules;
- raw SQL escape hatches;
- joins, relation traversal, aggregations, or query planning — the first
  bounded relational profile (two-source equi-joins and maintained
  projections) is now Accepted
  [LLP 0080](./0080-portable-relational-queries-and-projections.rfc.md);
- the exact shape of `ctx.auth`;
- Postgres-specific behavior;
- schema migrations — the reviewed migration workflow is now Accepted
  [LLP 0081](./0081-reviewed-storage-evolution-and-migrations.rfc.md);
- action APIs with outbound network access;
- the full permission language and diagnostic UI;
- GraphQL, REST auto-generation, or public endpoint routing.

Two later authorities also refine this API's mutation surface: generated
standard patterns (owner-scoped CRUD, unique lookup, keyset pages) are
governed by Accepted
[LLP 0065](./0065-generated-data-pattern-soundness.rfc.md), whose generated
update/delete lower to a server-evaluated conditional read-guard-write plan
rather than this RFC's unconditional host-plan write sequence — see
LLP 0007 §Transactions for the carve-out.

## First-Slice API Decisions

Ratified on 2026-06-26 for v0 implementation:

- **Ids:** `_id` is an opaque UUIDv7 string generated by Snapback's runtime id
  source. Application code may compare it for equality and pass it across API
  boundaries, but must not parse timestamps, table names, shards, or ordering
  meaning out of it. Cursors may use `_id` as a deterministic tiebreaker.
- **Timestamps and ids in handlers:** handlers use injected runtime APIs for
  deterministic time and ids. The first spelling is `ctx.runtime.now()` for the
  mutation timestamp and `ctx.runtime.id()` for an id. Direct `Date.now()`,
  `new Date()`, `Math.random()`, and ad hoc id libraries are diagnostics inside
  query and mutation handlers. **`ctx.runtime.now()` is frozen for the whole
  invocation:** it returns a single timestamp fixed when the handler starts, so
  every call within one invocation is equal — correct for replay determinism (a
  replayed handler that read the clock twice must see the same value both times),
  but surprising if you expect wall-clock progress inside a long handler. For a
  scheduled action the value is frozen to the run's *scheduled* time
  (`due_at_ms`), not the moment the action began, so a late-firing action still
  stamps the time it was due. (LLP 0032 E6.)
- **Query builders:** query-builder chains are immutable. A call such as
  `.filter(...)`, `.withIndex(...)`, `.order(...)`, or `.take(...)` returns a
  new query expression. This avoids Valet's mutable-builder parity footgun and
  makes generated query expressions easier to diff.
- **Structured filters:** `filter` accepts Snapback's structured predicate DSL.
  Opaque JavaScript callbacks are rejected for syncable-live queries and
  reported as online-only or unsupported for other query modes unless a later
  spec adds an analyzed callback form.
- **V0 indexed query shape:** the only syncable-live v0 query shape is one
  primary table, one declared index, equality predicates over an index prefix,
  optional structured residual predicates that the matcher can evaluate,
  deterministic ordering by declared index order plus `_id`, and `take(n)`.
  `skip(n)` is dev/small-data only and not allowed in syncable-live v0 queries.
  A scan requires an explicit small-data or dev-only opt-out and produces a
  diagnostic.
- **Syncable declaration:** v0 uses an explicit `defineLiveQuery` declaration
  for the restricted syncable-live subset. Ordinary `defineQuery` functions are
  callable server reads; they are not retained local-first queries unless they
  are also declared through the live-query form or a later accepted syntax.
- **Handler bundles:** generated handler artifacts are bundled modules with
  hashed dependencies, source maps when available, and a function manifest entry.
  Raw `handler.toString()` source replay is not allowed. Unsupported dynamic
  imports or ambient dependencies fail codegen with source-span diagnostics.
- **Function ids (ENG-24905, 2026-07-14):** codegen emits a required stable
  `id` for every generated function: `{appId}:{exportedName}`, a pure function
  of its inputs, so regenerating unchanged source produces byte-identical ids.
  For a demo backend, `appId` is the explicit `id` from the nearest ancestor
  `demo.snapback.json`; moving that backend under a nested layout such as
  `<demo>/backends/snapback` therefore preserves identity. This manifest id is
  a 1–64 character lowercase ASCII slug: it begins and ends with a letter or
  digit and otherwise contains only lowercase letters, digits, and hyphens.
  That one portable grammar is safe both in the colon-delimited function id
  and as the schema `$id` URI path segment, with no consumer-specific
  normalization. A backend with no ancestor demo manifest uses its immediate
  parent directory as the compatibility fallback. An ancestor manifest with
  an invalid explicit `id` fails codegen rather than falling back to a
  path-derived identity.
  A rename is a different function — the new name mints a new id and the old
  id is retired, never re-pointed at a different function. Deleting and
  re-adding a same-named function deterministically reproduces the same id:
  continuity of authority is *not* implied by id equality. Scoped grants and
  consent key on this id, and the ABA-revival defense is the grant-side
  durable basis generation (LLP 0055), which this deterministic scheme
  deliberately keeps implementable — do not randomize ids to "fix" revival.
  LLP 0012 registers the manifest-side requirement: a manifest whose function
  lacks an id fails load with a typed diagnostic.
- **Simple writes:** `delete(id)` is idempotent in v0 and returns whether a row
  existed before the call; deleting an already-missing row does not advance the
  commit version. `patch(id, {})` is allowed as a no-op and does not advance the
  commit version. `replace(id, value)` is deferred until a concrete need appears.
- **Doctor surface:** the public v0 doctor/sandbox is a CLI command backed by
  the same structured local-server inspection and invocation API. HTTP endpoints
  may exist for the CLI and tests; MCP can wrap the same schema later.

## Dated owner amendment: `single_table_v1@1` (2026-08-03)

Charlie Cheever accepted this amendment as LLP 0004's part of the
`single_table_v1@1` owner ruling. It is semantic acceptance only: it grants no
implementation or capability claim, and the implementation/adoption program is
commissioned separately.

`SingleTablePlanV1` is the closed owner normalization of the exact shipped
`rqsEligible` population. Class membership is host-derived, never authored: a
served function belongs only when the existing non-erroring predicate proves
all of `authorityIndependent === true`, `LiveQuery`, effective public auth,
empty `uses`/auth-scope/authorization-dependence inputs, exact
`HostPlan(Query(plan))`, no authority or ambient ordinary-filter value input,
empty `membershipFilters`, and a complete one-table read summary whose sole
table is the plan table. `publicInline` is unrelated and is not required. A
function that fails this predicate gains no class record, plan hash, proof, or
QMK; its existing API and legacy behavior remain unchanged.

The exact closed record is:

```ts
type SingleTableFilterOpV1 = "Eq" | "In" | "Lt" | "Lte" | "Gt" | "Gte"
type SingleTableBinaryOpV1 =
  | "Add" | "Sub" | "Mul" | "Div" | "Mod"
  | "Eq" | "Ne" | "Lt" | "Lte" | "Gt" | "Gte"
  | "And" | "Or"
type SingleTableUnaryOpV1 = "Not" | "Neg"
type SingleTableLiteralV1 =
  | null | boolean | number | string
  | readonly SingleTableLiteralV1[]
  | Readonly<Record<string, SingleTableLiteralV1>>

type SingleTableValueExprV1 =
  | "Args"
  | Readonly<{ Arg: string }>
  | Readonly<{ Binding: string }>
  | Readonly<{ Literal: SingleTableLiteralV1 }>
  | Readonly<{
      Field: Readonly<{ base: SingleTableValueExprV1; key: string }>
    }>
  | Readonly<{
      Binary: Readonly<{
        op: SingleTableBinaryOpV1
        left: SingleTableValueExprV1
        right: SingleTableValueExprV1
      }>
    }>
  | Readonly<{
      Unary: Readonly<{
        op: SingleTableUnaryOpV1
        expr: SingleTableValueExprV1
      }>
    }>
  | Readonly<{
      If: Readonly<{
        cond: SingleTableValueExprV1
        then: SingleTableValueExprV1
        else: SingleTableValueExprV1
      }>
    }>
  | Readonly<{ Concat: readonly SingleTableValueExprV1[] }>
  | Readonly<{
      Call: Readonly<{ func: string; args: readonly SingleTableValueExprV1[] }>
    }>
  | Readonly<{
      Record: Readonly<{
        fields: Readonly<Record<string, SingleTableValueExprV1>>
      }>
    }>

type SingleTablePlanV1 = Readonly<{
  format: "snapback.single-table-plan.v1"
  query: Readonly<{
    table: string
    filters: readonly Readonly<{
      field: string
      op: SingleTableFilterOpV1
      value: SingleTableValueExprV1
    }>[]
    membershipFilters: readonly []
    order: readonly Readonly<{
      field: string
      direction: "Asc" | "Desc"
      maxEncodedBytes: number | null
    }>[]
    limit: number | null
    indexedBy: string | null
  }>
  rqsDigestKind: "mset1" | "seq1"
  examinedEntryCeiling: 1024
}>
```

The host reconstructs this record from the current served typed `QueryPlan`
and exact-compares it; no client-carried copy is trusted. The application
result is the complete array of full documents returned by the HostPlan Query;
this class adds no projection. `NodePlanHashV1` argument bindings preserve this
RFC's function-argument declaration order.

The class is admitted only as the one node in LLP 0157's
`single-node.v1` profile. It has whole-result/no-public-cursor semantics and is
not admitted to `snapshot-batch.v1`, `mixed-route.v2`, or any implicit
successor. A future multi-node admission requires its own reviewed versioned
profile amendment.

The 1,024 examined-storage-entry ceiling is a **new owner decision made by
this 2026-08-03 ruling**, not a description of the shipped predicate. During
`single-node.v1` establishment or re-establishment, the target counts storage
entries examined and refuses the whole establishment with a registered closed
reason before examining entry 1,025. It installs no partial result or proof.
The ordinary non-node Query/LiveQuery API is unchanged: a sparse legacy query
may remain usable there while refusing node establishment. No implicit index
requirement or ordinary API scan guard is created by this class-only rule.

## Implementation Sketch

1. Define `defineSchema`, `defineTable`, validators, `defineQuery`, and
   `defineMutation` in TypeScript.
2. Generate typed function references and a server-consumable schema/function
   manifest.
3. Implement the minimal `ctx.db` host API in the local Rust server.
4. Implement the query builder in both generated TypeScript types and Rust
   execution.
5. Add generated client APIs for live query subscription and mutation
   invocation.
6. Add diagnostics for unknown tables, unknown fields, invalid filters, and
   unsupported operations.
7. Add static checks for unsupported schema syntax, unawaited database promises,
   direct time/random calls in handlers, and unindexed production queries.
8. Add a local sandbox/doctor path that can run a query or mutation as a chosen
   user context and report permission/query-plan diagnostics.
9. Validate with one tiny app that uses schema, query, mutation, client
   subscription, and realtime update.

## Open Questions

- How should the API express joins or relation traversal without making the
  SQLite-to-Postgres path fragile?
- How early can codegen validate field names used inside handler queries?
- How is a live query's read-set/dependency tracked so a committed write re-runs
  exactly the right subscriptions (the reactivity mechanism deferred to LLP 0003's
  matcher and LLP 0001's open question)?
- How do table `.sync` filters compose with function-level `defineLiveQuery`
  declarations?
- How are exact integers/decimals (money) and binary values represented across the
  validator set, the wire format, and the SQLite↔Postgres mapping?
- How are multi-row mutation changesets represented so optimistic clients,
  subscriptions, replay, and server persistence all observe the same atomic unit?
- How are mutation read sets represented, validated, retried, or rejected so
  buffered async handlers do not commit against stale invariants?
- Cursor- vs offset-based pagination: `skip(n)` is an O(n) convenience that
  destabilizes under concurrent writes — the large-dataset reference apps (Linear,
  Notion) need stable cursors.

## Dated alignment: generated agent-auth authoring (2026-07-16)

Codegen owns stable function ids and the `ctx.auth` additions (`kind`, actor,
delegation, and `isDirectHuman`). Schema authoring gains `v.principal()` and
`.membership()` with stable `id`, `pendingRoles`, `incidental` plus its floor,
and `provenance`. Generated `ctx.membership.<declaration>` writes and
`ctx.permissions.<declaration>` checks are declaration-bound; raw writes to a
membership table are refused. Bootstrap/teardown witnesses are host-derived,
role names generate literal unions, and invalid declarations fail at load.

Codegen derives `authorityCreating` from declared permission-backing writes;
opaque functions may be marked explicitly. A create-with-host convenience, if
shipped, is only sugar over the same bootstrap witness. Optimistic adapters
must preserve the same transition and denial semantics rather than invent a
client-only membership lane.

## Dated alignment: inline handlers and result contracts (2026-07-27)

LLP 0108 adds a paved, colocated JavaScript form in which a directly exported
query, live query, mutation, or action builder contains one direct,
self-contained `handler` expression. The existing `source`/`exportName` form
remains the compatibility lane; mixing the forms or capturing imported or
sibling values is invalid. The exported binding still determines the stable
function id.

Operations may declare `results.documents`, `results.records`,
`results.document`, or `results.value`. Codegen freezes the effective
schema-bound contract, hashes it, and makes its precise result type part of the
generated reference. Runtime validation occurs on the post-JSON image before
query/live/action publication and before mutation commit. Omission is the
explicit degraded `Unknown` contract, not result inference from handler code.
LLP 0108's final author reconciliation governs the exact grammar and bounds.

## Dated alignment: structured collection validators (2026-07-30)

The Diary 0039 rerun repeatedly hit the boundary of this RFC's first-slice
validator set, and the LLP 0115 audit mapped it precisely. Current state,
code-verified: nested `v.object` **arguments already work end-to-end**
(typed descriptors plus a closed JSON Schema with
`additionalProperties: false`); `v.array` and `v.union` are result-contract-
only — the authoring gate's closed primitive map rejects them fail-closed at
argument (`FUNCTION_INVALID_VALIDATOR`) and stored-field
(`SCHEMA_INVALID_VALIDATOR`) boundaries, and the `v.json()` escape hatch is
already loud. So Split Ledger's split vector — Convex's clearest input-typing
win in the rerun — needs specifically array/union admission, not a general
structured-inputs overhaul. (Implementation note: the `resultOnly` flag on
those builders is dead metadata; the primitive map is the actual gate.)

The extension is deliberately not designed here. Per the 0108/0080/0081
precedent and this RFC's own split-into-Spec status note, it lands as a new
owned Spec with this dated pointer (LLP 0115 CV-4; its open question 1 is
answered accordingly). Two scope facts that Spec must own, recorded so they
are not rediscovered:

- **Arguments first.** The result-side machinery (vocabulary spellings,
  recursive Rust validation, type/schema projection, hashing, bounds) is
  reusable prior art, but no server-side per-invocation args-shape
  validation seam exists today even for scalars — argument admission
  requires building runtime ingress validation, not just widening the
  authoring gate. Host-plan mutations add an interaction with the
  value-expression IR, which operates over scalar arg references.
- **Stored fields are a separate, larger design**: a `FieldType` extension,
  a SQLite/Postgres representation decision under §Portability Rules,
  index/`arrayContains`/live-matcher semantics, and LLP 0081 migration
  interaction. Nothing in the result-contract lane de-risks it.

## Dated alignment: stored literal-union domains (2026-08-08)

The 2026-07-30 alignment above split CV-4 into arguments (LLP 0131, shipped)
and stored fields (CV-4b, Open), and named the stored-field lane "a separate,
larger design": a `FieldType` extension, a SQLite/Postgres representation
decision, index/`arrayContains`/live-matcher semantics, and an LLP 0081
migration interaction. That framing is right for **arrays and objects**. It
over-charges the **union-of-string-literals** case, which is why LLP 0191 §5
classes closed stored domains as a schema-fidelity quick win and LLP 0191's
2026-08-08 ruling OQ5 sequences the §5 schema quick-wins immediately rather
than behind the CV-4b Spec. This alignment lands that slice under this RFC's
portability rules; the CV-4b Spec's commission is unchanged and still owns
arrays, objects, and every question below.

**What is admitted.** A stored table field may declare a closed union of
string literals:

```js
role: v.union([v.literal('crew'), v.literal('user')]),
visibility: v.optional(v.union([v.literal('internal'), v.literal('public')])),
```

Two to **seven** variants. That is one fewer than LLP 0131's argument bound,
and the reason is worth recording because it is not arbitrary: an *optional*
enum field's document contract expands to `null | 'a' | 'b' | …`, and LLP 0108
bounds a result-contract union at eight variants, so an eight-value optional
domain would produce a nine-variant contract and refuse. One bound for both
required and optional fields avoids the evolution trap of the alternative,
where making an eight-value domain optional later would be refused by a rule
the author never saw when declaring it. Every variant must be a non-empty
string literal of at most 64 UTF-8 bytes, and the values must be unique.
Authored order is identity-significant: it is the order of the generated
TypeScript union and it feeds the schema hash. Anything else
— a numeric or boolean literal, a mixed union, a duplicate, the wrong arity —
still refuses with `SCHEMA_INVALID_VALIDATOR`. `v.array` and `v.object` at
stored fields are unchanged: still refused, still CV-4b's.

No new authoring spelling is introduced. A dedicated `v.enum([...])` sugar was
considered and deliberately deferred: LLP 0127 move 1's "one grammar spanning
arguments, stored fields, results, and failure variants" proposal is still
unadjudicated in the CV-4b Spec's loop, and admitting the union spelling that
already exists pre-empts none of it while a second spelling would.

**Why this slice does not need the larger Spec.** Each of CV-4b's four costs
is absent here. The physical representation is not a decision — an enum field
is a `TEXT` column, byte-identical to `v.string()`, so `sqlite_type` gains an
alias, not a mapping. Index, filter, order, and live-matcher semantics are not
a decision — an enum field is string-like everywhere, so nothing in the query
surface changes shape. There is no element/containment vocabulary to design,
because there are no elements. What remains is a domain predicate, and this
RFC already has the right home for it.

**The `FieldType` extension.** `FieldType::Enum { values }` joins the closed
vocabulary in `src/manifest.rs`. It is a distinct variant rather than a
`String` carrying a constraint because the retype gates compare `FieldType`
values, and the transitions below have to be distinguishable from each other.
Codegen emits `{"Enum": {"values": ["crew", "user"]}}` in the schema manifest;
the server re-establishes the same closed rules on ingest and refuses a
hand-written manifest that violates them with
`SNAPBACK_SCHEMA_ENUM_DOMAIN_INVALID`.

**Enforcement is central and fail-closed.** The domain is checked at the one
place every writer funnels through — the declared-field coercion inside
`insert_document` and `patch_document` — not by a `CHECK` constraint, because
the server is the single central writer and a constraint would duplicate the
rule in a place the diagnostics cannot reach. An out-of-domain string refuses
with `SNAPBACK_FIELD_ENUM_VALUE_INVALID` naming the table, the field, the
rejected value, and the admitted list; a non-string still refuses with
`SNAPBACK_FIELD_TYPE_MISMATCH`. This is the point of the change: closed
authorization-relevant domains (role, visibility) can no longer reach storage
through a writer that forgot its guard, so query authorization cannot observe
an unknown role.

**Evolution.** LLP 0007 §Schema Evolution's conservative applier gains one
rule, recorded there as its own dated amendment: a transition that *narrows*
an existing field's domain — `String` → `Enum`, or `Enum(A)` → `Enum(B)` where
A ⊄ B — is admitted only after an in-transaction check proves every existing
non-NULL value satisfies the successor domain, and otherwise refuses whole
with `SNAPBACK_SCHEMA_ENUM_DOMAIN_BACKFILL_REQUIRED` naming one offending
value. Widening — `Enum(A)` → `Enum(B)` with A ⊆ B, or `Enum` → `String` — is
admitted without a scan. This is the shape of the null-count precedent that
already governs optional → required, for the same reason: the physical column
does not move, so the only question is whether the data satisfies the tighter
declaration. Every other type ↔ `Enum` transition remains
`SNAPBACK_SCHEMA_FIELD_RETYPED`. The reviewed LLP 0081 lane is untouched: its
closed intent vocabulary still classes an enum type change as a declared
`ConvertField`, and aligning `derive_intents` with the admitted transitions
above is a named follow-on, not a claim made here.

**What is not claimed.** Postgres is unimplemented, as everywhere else in this
RFC; the portable intent is `GENERATED`-free plain `TEXT` plus the same
server-side domain check, deliberately *not* a native `CREATE TYPE ... AS
ENUM`, whose ALTER story is worse than the manifest's. Nothing here narrows or
widens CV-4b. Nothing here touches numeric identity or default columns, which
LLP 0191's OQ2 ruling routes through the commissioned coordinating
identity-architecture Decision (`issues/20260808-identity-architecture-decision.md`);
see the companion note under §Portability Rules' owner, LLP 0007, for why the
schema surface deliberately did not grow a counter of its own.

## Status

Draft. This should guide the first implementation of Snapback's app-facing data
API. It should be revised alongside the local core prototype and split into a
more formal Spec once the minimal API survives a reference app.
