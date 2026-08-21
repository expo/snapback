<!-- Generated backend section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/backend/queries.md -->
---
title: Queries
id: backend.queries
order: 1
audience: agent-first
capabilities: [backend.functions, backend.query-semantics, backend.batch-reads]
authorities: [llp/0003-local-code-hosting-and-storage-core.rfc.md, llp/0004-application-data-api.rfc.md, llp/0007-storage-portability.spec.md, llp/0055-agent-principals-and-scoped-grants.rfc.md, llp/0108-inline-handlers-and-result-contracts.spec.md, llp/0174-authoring-incidents-at-security-fences.research.md, llp/0231-entity-and-permissioning-recommendation.rfc.md, llp/0245-infer-show-freeze-declarations.rfc.md, llp/0248-bounded-batch-reads.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/inline-handlers.mjs, packages/snapback-codegen/n-plus-one-advisory.mjs, packages/snapback-codegen/n-plus-one-advisory.test.mjs, packages/snapback-codegen/result-contracts.mjs, packages/snapback-codegen/ctx.d.mts, packages/snapback-codegen/authoring-validation.test.mjs, packages/snapback-harness/ctx-bootstrap.js, packages/snapback-harness/envelope.test.mjs, schemas/capability.manifest.local-dev-sqlite-ibex.json, crates/snapback-engine/src/manifest.rs, crates/snapback-engine/src/runtime.rs, crates/snapback-kernel/src/storage.rs, crates/snapback-types/src/result_contract.rs, crates/snapback/tests/local_v0.rs, demos/signal-desk/snapback/functions.mjs]
examples: [demos/todo, demos/todo-v2, demos/signal-desk]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:46147d74a2d26fe478b7826855e02827d9f62f3d34a9ad56ef34fa90d6458bf1
---

# Queries

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A query is a read-only function over one consistent database snapshot. Its
result is `{ rows, version }`: the rows and reported version come from the
same pinned snapshot, so an author never has to reconcile a result with a
separately sampled version.

## Choose declarative or JavaScript execution

Declarative queries spell out the table, arguments, predicates, ordering, and
index in the function definition:

```js source=demos/todo/snapback/functions.mjs
export const listTodosOnce = defineQuery({
  table: 'todos',
  args: {},
  filter: [eq('userId', authUserId())],
  order: [asc('_createdAt')],
  index: 'by_user',
});
```

`defineJsQuery` and `defineJsLiveQuery` instead colocate one direct,
self-contained handler expression with its arguments, result contract, and
declared reads. The handler uses the bounded `ctx.db` surface:

```js source=demos/signal-desk/snapback/functions.mjs
export const generateBrief = defineJsQuery({
  args: { incidentId: v.id('incidents') },
  result: results.records(v.object({ brief: v.string() })),
  reads: ['incidents', 'tasks', 'comments', 'activity'],
  handler: async (ctx, args) => {
    const incident = await ctx.db.get('incidents', args.incidentId);
    if (!incident) throw new Error('incident not found');
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_incident_position')
      .eq('incidentId', args.incidentId)
      .collect();
    const comments = await ctx.db
      .query('comments')
      .withIndex('by_incident_created')
      .eq('incidentId', args.incidentId)
      .collect();
    const completed = tasks.filter((task) => task.completed).length;
    const latest = comments.at(-1)?.body ?? 'No field notes yet.';
    return [{
      brief: `${incident.severity} · ${incident.status.toUpperCase()} — ${incident.title}. ${completed}/${tasks.length} tasks complete. Latest note: ${latest}`,
    }];
  },
});
```

Use the declarative form when the plan vocabulary expresses the query. Use a
JS handler for bounded logic the plan cannot express. Both styles return the
same public query envelope and must use declared indexes for author-facing
lookup paths.

Indexes name authored table fields only. `_id`, `_version`, `_createdAt`, and
`_updatedAt` are legal filter/order leaves but are rejected inside
`.index(...)` with `SCHEMA_UNKNOWN_FIELD`; `_id` is already the implicit final
tie-break for every declared index. For a version cursor, declare an index over
the authored partition key and apply the `_version` range/order after selecting
that index, as in the keyset example below. There is no portable composite
system-field index declaration to opt into.

Specialized read shapes are their own closed carriers with their own pages —
cross-reference rather than reimplementing them in a JS handler. Before using
`defineJsLiveQuery` for a plain conversation-membership or message-sender
join, check the shipped `defineRelationalQuery` and
`defineMaintainedProjection` surfaces
([relational queries](./relational-queries.md)). Other specialized shapes are
index-backed text search ([text search](./text-search.md)), exact vector search
([vector search](./vector-search.md)), several bounded child lists from one
snapshot ([snapshot batches](./snapshot-batches.md)), and the generated
job-status and push-ledger queries ([jobs](./jobs.md),
[Expo push](./expo-push.md)).

An inline handler does not capture imports, top-level `const` bindings, or
multi-file graphs; statically reachable same-file function declarations are
resolved and spliced in with the handler, and everything else must live
inside the direct handler expression. Class syntax, dynamic import, `eval`,
and `Function` are refused during generation. The legacy
`{ source, exportName }` form remains supported for existing handlers, but it
cannot be mixed with `handler`. It also reads one closed script: same-file
helpers work, while imports are refused with `BUNDLE_UNSUPPORTED_IMPORT`.

Most JS query handlers return an **array of rows**. Point reads and computed
aggregates may instead declare `results.document(...)` or
`results.value(v.object({...}))` and return that single value directly. The
query/live transport keeps one internal row for those declarations, while
typed consumers project the authored object or scalar back out. Returning a
single object under a row-shaped `results.documents`/`results.records`
declaration still fails with `SNAPBACK_HANDLER_RESULT_INVALID`.

Declare what that array contains:

- `results.documents('todos')` validates complete stored documents, including
  server-owned system fields and stored optional-field semantics.
- `results.records(v.object({...}))` validates exact computed records and does
  not invent system fields.
- `results.document('todos')` validates one stored document, while
  `results.value(validator)` validates one direct point/aggregate value. For a
  missing point read, include `v.null()` in the value validator and return
  `null`.
- `v.doc('todos')` references that same complete document shape from inside a
  result validator. For example,
  `results.records(v.object({ todo: v.doc('todos') }))` avoids respelling a
  nested document. A top-level `results.records(v.doc('todos'))` is
  hash-identical to `results.documents('todos')`.

`v.doc` is result-only. Codegen expands it against the current schema before
hashing and refuses unknown tables; adding or changing a table field therefore
regenerates the contract and generated types. It is not accepted in function
arguments or stored schema fields.

`results.records` accepts two shapes beyond a single `v.object`: the record
validator may be a **discriminated union of closed record variants** —
`results.records(v.union([v.object({...}), v.doc('todos')]))`, every variant
a `v.object(...)` or `v.doc(...)` — and an optional second argument declares
**row bounds**: `results.records(shape, { minItems, maxItems })`. Bounds are
declared together (supplying only one refuses generation) and must satisfy
0 ≤ `minItems` ≤ `maxItems` ≤ 1,024. A result violating a declared bound is
rejected pre-egress with `SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION` whose
details name the `minItems`/`maxItems` constraint — the same closed
constraint vocabulary [mutations](./mutations.md#consume-the-structured-result)
documents.

<!-- since: 0.1.16 -->

A field declared as a **closed string domain (stored enum)** —
`v.union([v.literal('crew'), v.literal('user')])` on a stored field — stays
an ordinary `TEXT` column, so it indexes, `.eq`-filters, and orders exactly
like `v.string()`, while generated result types carry the literal union
(`"crew" | "user"`). Every central writer enforces the domain with
`SNAPBACK_FIELD_ENUM_VALUE_INVALID`, so a query never needs a defensive
domain re-check on values it reads. Declaration rules and narrowing
semantics: [closed string domains](../getting-started/your-first-backend.md#declare-the-schema).

`v.tuple([a, b, ...])` declares a fixed-length heterogeneous array: it takes
1–8 element validators and validates each position against its own validator.
It is exported and usable in result contracts; its consumer in the shipped
surface is the snapshot-batch sealed row, whose declaration-ordered `nodes`
member is a tuple of per-child page contracts
([snapshot batches](./snapshot-batches.md)).

The generated reference carries the precise array result. Snapback validates
the post-JSON image and 4 MiB egress ceiling before cache insertion, snapshot,
or live publication. Omitting `result` is an explicit degraded `unknown`
contract; codegen does not infer a type by inspecting handler behavior.

Generated `api.d.ts` also exports `GeneratedHandler`,
`GeneratedQueryDatabase`, and `GeneratedMutationDatabase`. Same-file
context-reader helpers can use those types in TypeScript or checkJs without
declaring another row model. Query helpers receive the read-only database
surface; mutation handlers receive its write-capable extension. These types
check code against the schema and declared effective contract—they never infer
or mint a contract from handler behavior.

## Read one snapshot

The local target pins one transaction for the whole query invocation. The
normal file-backed read lane uses the WAL reader pool; direct-library,
live-subscription, and in-memory fallback lanes pin the serialized connection
instead. Every `get`, indexed query, membership witness, and terminal `version`
observes that same snapshot. Queries never write; a write attempt is a typed
refusal.

Inside a mutation, `ctx.db` layers the mutation's own buffered writes over each
logical storage read. Those reads become commit dependencies, described in
[mutations](./mutations.md). Each logical read pins its reported head and rows
together; buffered-query overlays capture the exact overfetch and touched rows
they consumed before commit validation.

The returned `version` is an exact integer in
`0..=Number.MAX_SAFE_INTEGER`. A malformed, negative, or out-of-range durable
cursor fails closed instead of being rounded, wrapped, or replaced with zero.

## Batch exact lookups in one host call

The experimental local `bounded_batch_reads_v1` profile has two positional
forms. `ctx.db.getMany(table, ids)` reads generated ids from one table;
`ctx.db.uniqueMany(table, index, keys)` reads complete keys through a declared
unique index. The generated [`QueryDatabase` reference](../reference/expo-snapback-codegen--ctx.md#symbol-querydatabase-8d46ad3df0)
types both the input keys and the resulting `Array<HandlerRow | null>`.

```js source=packages/snapback-harness/envelope.test.mjs
          ids: await ctx.db.getMany('items', ['b', 'a', 'b']),
          keys: await ctx.db.uniqueMany('items', 'bySlug', [{ slug: 'two' }]),
```

Each `ids` or `keys` array admits **0..256 items**, inclusive. The complete
canonically encoded host request is capped at **1,048,576 bytes (1 MiB)**, and
the canonical returned array is capped at **4,194,304 bytes (4 MiB)**. Item or
request-byte overflow refuses before storage work; response-byte overflow
refuses before any result is released. An empty array returns `[]` without a
host transition.

One non-empty method call makes one logical JavaScript-to-host call, never one
call per item, and all distinct lookups resolve inside one pinned read view.
This is not a one-SQL-statement promise: a target may use bounded internal
chunks. The result always has the input's length and order. Duplicate ids or
keys are looked up and authorized once, then repeated at every corresponding
output position. A missing row and a row hidden by table visibility both
produce `null`: **hidden and absent are indistinguishable**, with no per-item
reason or hidden count.

`uniqueMany` accepts only a declared unique index, and each key must be a
closed, complete object containing exactly that index's components. Object
construction order does not matter; Snapback canonicalizes components in
manifest index order. Static malformed literals refuse during generation;
malformed dynamic keys refuse before storage. For an index declared with
`whereApplicable: true`, every single-field or compound component must be
present, non-null, and valid for its declared field type, or the whole batch
refuses.

Use these methods when the handler already has exact ids or complete unique
keys and needs bounded JavaScript hydration. If the code is instead discovering
related rows or repeating a stable relationship shape, choose
[`defineRelationalQuery` or `defineMaintainedProjection`](./relational-queries.md)
at that point: those declarative carriers can own the relationship plus live,
cursor, retention, and whole-plan cost facts; a batch remains an imperative
exact lookup.

<!-- since: 0.1.23 -->

### Catch repeated point reads during generation

Code generation warns with `SNAPBACK_AUTHORING_N_PLUS_ONE_BATCH_READ` when
static handler analysis finds a literal same-table `ctx.db.get`, or a
complete `.first()` lookup through a declared total unique index, executed
unconditionally on every loop iteration. This proven-executions rule keeps
calls under an `if`, `switch`, ternary, or logical guard quiet rather than
assigning them the whole loop cardinality. Literal arrays and simple C-style
loops with literal initial value, bound, and step carry a known cardinality;
known loops below three iterations stay quiet, while an unknown cardinality is
eligible only for an unconditional call site.

The warning suggests `getMany` or `uniqueMany` and never rewrites the handler
or changes how any read executes. `whereApplicable` unique indexes stay quiet:
their optional components do not participate in uniqueness when absent, while
`uniqueMany` requires every component to be present and non-null. Calls already
using either batch method, point reads outside loops, guarded calls, and loops
whose table is not one static literal also stay quiet.

## Bound every collection intentionally

`ctx.db.query(...).collect()` is not an unbounded table scan. Without an
explicit `.take(n)`, it may return at most 1,024 rows. If it reaches that
ceiling, Snapback refuses the invocation with
`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`: the runtime cannot prove whether the
1,024 rows are the complete result or a truncated prefix.

Put the filters and ordering that define the desired window on the server, then
declare its size:

```js fragment reason="portable bounded query pattern"
const latest = await ctx.db
  .query('events')
  .withIndex('by_fleet_severity_page')
  .eq('fleetId', args.fleetId)
  .eq('severity', 'critical')
  .order('pageKey', 'desc')
  .take(100)
  .collect();
```

An explicit `.take(1_024)` is allowed and means “this bounded prefix is
intentional”; it does not claim the whole predicate has only 1,024 matches.
Do not collect a large prefix and then sort or filter it in JavaScript to infer
the global top rows—the omitted rows may contain the actual winners.

### The complete builder chain

`ctx.db.query(table)` accepts exactly these verbs, in any order —
`.withIndex(name)` included. `withIndex` is a plain setter that records the
selected index wherever it appears in the chain; it is not a required prefix
and imposes no ordering on the other verbs:

| Verb | Meaning |
| --- | --- |
| `.eq(field, value)` | equality |
| `.in(field, [values])` | membership in a bounded set |
| `.lt(field, value)` / `.lte(field, value)` | strictly-less / less-or-equal |
| `.gt(field, value)` / `.gte(field, value)` | strictly-greater / greater-or-equal |
| `.order(field, 'asc' \| 'desc')` | server-side ordering |
| `.take(n)` | the declared bound |
| `.collect()` / `.first()` | execute |

The range verbs are what make **keyset pagination** expressible for any
visibility the query already enforces: carry the last row's ordering value as
the cursor and ask for the next bounded window.

```js fragment reason="keyset page pattern over an existing bounded query"
const page = await ctx.db
  .query('messages')
  .withIndex('by_channel')
  .eq('channelId', args.channelId)
  .gt('_version', args.afterVersion ?? 0)
  .order('_version', 'asc')
  .take(20)
  .collect();
```

Do not collect the whole partition and slice it in JavaScript — that is
O(partition) per page and reaches the implicit ceiling on a busy channel.
(`defineOwnedKeysetPages` generates this shape for *owner*-scoped history —
see [generate keyset pages](./standard-patterns.md#generate-keyset-pages);
the chain above is how you page anything else.) A verb outside this table
refuses during generation with a named diagnostic rather than failing at
runtime.

#### Builder bounds and their refusal codes

The builder enforces its own caps, each with a stable diagnostic:

- `.take(n)` admits a non-negative safe integer of at most 1,024; anything
  else throws `SNAPBACK_QUERY_LIMIT_INVALID` at the call site.
- `.in(field, values)` requires an array
  (`SNAPBACK_QUERY_FILTER_VALUE_INVALID` otherwise), and one builder admits
  at most **500 total `in` operands** summed across all its `.in()` calls —
  the 501st operand throws `SNAPBACK_QUERY_IN_ITEMS_EXCEEDED`.
- One builder admits at most **500 total filter bindings**: each
  `.eq`/`.lt`/`.lte`/`.gt`/`.gte` call adds one binding and each `.in()` adds
  one per operand; exceeding the cap throws
  `SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED`.

These are authoring-shape refusals raised while the chain is being built,
before any storage read. A predicate that needs more than 500 operands is a
sign the membership set belongs in a table the query can join or index, not
in an argument list.

## Scope on the server

Put authorization predicates in the query, not in client arguments or UI
filters. `authUserId()` in declarative plans and `ctx.auth.userId` in JS
handlers are server-derived. For sessions-mode details, see
[sessions and principals](../auth/sessions-and-principals.md).

Ordinary handler `ctx.db` reads also apply the table's owner or membership
visibility. Trusted named queries and mutations can select
`ctx.db.elevated.{get,getMany,uniqueMany,query}` for the exact reads needed by
their own authorization logic, but only after a host-owned permission check and
with resource relationships validated. Elevated reads remain bounded and
snapshot-captured; actions and generated/direct plans cannot select them. See
[authorize first, then elevate the exact handler read](../auth/protecting-data.md#authorize-first-then-elevate-the-exact-handler-read)
for the sanctioned pattern and required negative test.

JS handlers also get the LLP 0055 authority verb **`ctx.isDirectHuman()`**:
`true` exactly when the server-resolved principal is a human acting directly
— `auth.kind === "human"` **and** no delegated actor is present
(`auth.actor == null`). Both conjuncts are load-bearing: kind alone would
admit a delegated agent acting *as* the human, and actor absence alone would
admit an autonomous agent principal. Use it to gate behavior reserved for a
directly present human instead of re-deriving the conjunction from
`ctx.auth` fields; it is exported on every generated context type.

> **Coming from Convex/Supabase?** See
> [Protected live CRUD, end to end](../recipes/coming-from-convex-and-supabase.md#protected-live-crud)
> for a complete worked translation of a Supabase RLS policy or a
> Convex-style ownership check into a Snapback query filter.

## Refuse with a declared application code

A query has the same typed refusal channel a mutation has: declare
`refusals: ['CODE']` on the function and raise it with
`ctx.refuse(code, details?)` so the caller receives a stable application
error code instead of an opaque `SNAPBACK_HANDLER_FAILED`. The complete rule
— when a domain error deserves a code, the declaration/fold contract, and how
plan `elseError` differs — is
[refuse with a declared code](./mutations.md#refuse-with-a-declared-code-not-a-bare-throw).

## Make a query live only when needed

`defineQuery` is callable but not subscribable. `defineLiveQuery` and
`defineJsLiveQuery` opt into the analyzable live surface. A client that tries
to subscribe to an ordinary query receives
`SNAPBACK_FUNCTION_NOT_LIVE`; Snapback never silently converts it into a
polling contract. See [live queries](../realtime/live-queries.md).

## Anti-patterns

- **Do not sample rows and version separately.** The query envelope already
  binds them to one snapshot.
- **Do not filter private rows in the client.** Put server-derived ownership
  in the query predicate.
- **Do not omit an available index.** A declarative `index` or JS
  `withIndex` makes the intended lookup explicit and portable.
- **Do not issue a loop of exact point reads after collecting the ids.** Use
  [`getMany` or `uniqueMany`](#batch-exact-lookups-in-one-host-call) so the
  bounded lookup crosses the host boundary once.
- **Do not sort or filter after an implicit `collect()` to infer a global
  result.** Push the operation into the query builder and declare `.take(n)`.
- **Do not mark every query live.** Ordinary queries stay ordinary; opt into
  live delivery only when the UI needs subscription semantics.
- **Do not respell a complete stored row with `v.object`.** Use
  `results.documents(table)` at the top level, or `v.doc(table)` when the
  complete stored shape appears inside a result validator.
- **Do not treat a manually pasted suggestion patch as stale-safe.** Manual
  paste remains ordinary authoring; only `snapback author suggestion apply`
  rechecks the complete analysis identity immediately before its atomic write.
- **Do not accept a candidate without reading its evidence class.** Review
  `exact`, `schema-derived`, `widened`, and `unresolved` proportions and resolve
  every hole; the analyzer never invents bounds, numeric refinements, or table
  identity.
- **Do not capture imports or arbitrary top-level bindings in an inline
  handler.** Statically reachable same-file function declarations—including
  context-reader helpers that receive `ctx.db`—are admitted. Imported helpers,
  top-level `const`/class state, and multi-file capability graphs remain
  outside the inline landed slice. The legacy module form is not an import
  escape hatch: it reads one closed script and admits same-file helpers only.

---

<!-- snapback-guide-source: guide/backend/mutations.md -->
---
title: Mutations
id: backend.mutations
order: 2
audience: agent-first
capabilities: [backend.query-semantics, backend.record-history, backend.mutation-settlement-identity]
authorities: [llp/0003-local-code-hosting-and-storage-core.rfc.md, llp/0004-application-data-api.rfc.md, llp/0007-storage-portability.spec.md, llp/0043-offline-replay-retention.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0108-inline-handlers-and-result-contracts.spec.md, llp/0144-declared-app-refusal-codes.rfc.md, llp/0162-agent-safe-storage-profile.rfc.md, llp/0174-authoring-incidents-at-security-fences.research.md, llp/0231-entity-and-permissioning-recommendation.rfc.md, crates/snapback-server/src/server.rs, crates/snapback-engine/src/runtime.rs, crates/snapback-types/src/result_contract.rs, crates/snapback-kernel/src/proof_checkpoint.rs, schemas/mutation.output.schema.json, packages/snapback-codegen/define.mjs, packages/snapback-codegen/history-authoring-types.fixture.ts, packages/snapback-harness/ctx-bootstrap.js, packages/snapback-codegen/refusal-tracking-authoring.test.mjs, crates/snapback/tests/mutation_settlement_identity_v0.rs, tests/conformance/twin-corpus.handlers.js, demos/messaging-snapback/snapback/functions.mjs, demos/signal-desk/snapback/functions.mjs, demos/todo/tests/acceptance/headless.mjs]
examples: [demos/todo, demos/todo-v2, demos/messaging-snapback, demos/signal-desk]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:57c704b548d0d3feb6bc066747148bcb4c897957e4f96527d921bf35c1889cc2
---

# Mutations

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A mutation makes snapshot-atomic logical reads, buffers writes, validates its
captured dependencies, and commits once. It does not hold one SQLite read
transaction across arbitrary asynchronous handler work; commit-time OCC rejects
relevant drift between reads. Every row changed by the commit receives the
same monotonic version. A rejected mutation commits nothing.

When one screen calls several of these mutations against the same resource id,
declare them once with `defineSurface` instead of rewiring each call site — see
[application surfaces](../clients/surfaces.md), which binds a resource's reads,
mutations, assets, and presence around shared parameters. The mutations
themselves are unchanged; a surface only composes the generated references.

## Define the write boundary

The paved JS form colocates its direct handler expression with arguments,
result contract, and possible writes:

```js source=demos/signal-desk/snapback/functions.mjs
export const createIncident = defineJsMutation({
  args: {
    title: v.string(),
    severity: v.string(),
    actorId: v.string(),
    now: v.integer(),
  },
  result: results.value(v.id('incidents')),
  writes: ['incidents', 'activity'],
  handler: async (ctx, args) => {
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('incident title is required');
    if (!new Set(['SEV-1', 'SEV-2', 'SEV-3']).has(args.severity)) {
      throw new Error('invalid severity');
    }
    const incidentId = await ctx.db.insert('incidents', {
      title,
      summary: 'Investigation started. Add tasks and field notes as evidence arrives.',
      severity: args.severity,
      status: 'investigating',
      commanderId: args.actorId,
      createdAt: args.now,
      updatedAt: args.now,
    });
    await ctx.db.insert('activity', {
      incidentId,
      actorId: args.actorId,
      sourceTable: 'incidents',
      sourceId: incidentId,
      operation: 'insert',
      effectiveSubject: args.actorId,
      actualActor: args.actorId,
      actorKind: 'human',
      mutationDigest: 'explicit-js-handler.v1',
      kind: 'incident.created',
      detail: `${args.severity} incident opened`,
      createdAt: args.now,
      sortKey: args.now,
    });
    return incidentId;
  },
});
```

Those two bare `throw`s are the minimum: they reject the write, but the caller
receives only a generic handler failure. As soon as a caller could *act* on
the reason — retry with a different value, be shown copy — declare the code
instead; see
[refuse with a declared code](#refuse-with-a-declared-code-not-a-bare-throw).

<!-- since: 0.1.16 -->

The hand-rolled severity domain guard above predates **stored enums**: a
field whose values come from a fixed set now declares that set on the schema
— `severity: v.union([v.literal('SEV-1'), v.literal('SEV-2'), v.literal('SEV-3')])`
— and every central writer then enforces the domain, refusing an
out-of-domain string with `SNAPBACK_FIELD_ENUM_VALUE_INVALID` (naming the
field and admitted values) and committing nothing. Declare the domain once
instead of re-checking it in every mutation; declaration rules and
narrowing semantics are
[closed string domains](../getting-started/your-first-backend.md#declare-the-schema).

The handler writes only through `ctx.db`. Server-owned ids, row versions, and
storage timestamps are never authored by the handler. An inline handler
captures no imports or top-level `const` bindings; statically reachable
same-file function declarations are resolved and spliced in with it. The legacy
`{ source, exportName }` form remains compatible but cannot be mixed with
`handler`; it also reads one closed script, supports same-file helpers, and
refuses imports with `BUNDLE_UNSUPPORTED_IMPORT`. Imported helpers, third-party
packages, and multi-file graphs are not admitted by that compatibility lane.

`defineMutation` is the declarative twin: compose `insert`, `patch`,
`delete`, conditions, and a declared return binding without running a JS
handler. The complete plan vocabulary — every step helper, the expression
algebra, return bindings, and the spec keys — is
[declarative mutation plans](./declarative-plans.md).

Strict `arg('name')` requires the property, so generation refuses a
caller-optional argument consumed by it with
`SNAPBACK_AUTHORING_OPTIONAL_ARG_CONTRADICTION`. Use `argOpt('name')` for the
omission branch: an omitted property evaluates to `null`; use
`coalesce(argOpt('name'), lit(default))` to supply a default. Writing that
`null` requires the target field to be declared `v.optional(...)`, which
stores it as a present null.

Set-oriented deletion is `deleteWhere(table, filter)`. The filter argument is
required; omitting it refuses generation with
`SNAPBACK_DELETE_WHERE_FILTER_REQUIRED`. An explicitly authored empty array,
`deleteWhere(table, [])`, retains the clear-table IR and therefore means
"delete every row" deliberately. Never derive or substitute that empty array
for an absent filter.

Two transactional effects beyond `ctx.db` writes commit or roll back with the
same mutation and have their own pages: a declared `sequences` counter
allocated through `ctx.sequence.allocate`
([sequences](./sequences.md)) and durable follow-up work enqueued through
`ctx.jobs.enqueue` ([one-off durable jobs](./jobs.md)).

<!-- since: 0.1.15 -->

## Derive a replay-stable effect key

When a mutation records an intent that an action or worker will deliver to an
external provider, derive the provider idempotency key from
`ctx.mutation.settlement()`. Write the intent and key inside the transaction;
perform the network I/O later, outside the mutation:

```js source=crates/snapback/tests/mutation_settlement_identity_v0.rs
  async recordEffectIntent(ctx) {
    var settlement = await ctx.mutation.settlement();
    var providerIdempotencyKey = settlement.settlementId === null
      ? null
      : 'notification:' + settlement.settlementId;
    await ctx.db.insert('entries', {
      marker: providerIdempotencyKey === null ? 'no-settlement-identity' : providerIdempotencyKey,
      clientMutationId: settlement.clientMutationId,
      settlementId: settlement.settlementId
    });
    return {
      queued: providerIdempotencyKey !== null,
      providerIdempotencyKey: providerIdempotencyKey
    };
  },
```

The projection has two opaque fields. `clientMutationId` is the client-minted
protocol identity; `settlementId` is the server-namespaced digest for the exact
mutation, authenticated principal, function, and arguments. Both are `null`
when the invocation carried no client mutation id. A settled duplicate returns
its stored result without handler re-entry. If an earlier attempt failed before
settlement and the handler genuinely re-enters, the same logical mutation sees
the same `settlementId` even though fresh per-entry values such as
`ctx.runtime.id()` may differ.

Treat both fields as opaque. Do not parse or re-hash a raw client mutation id,
and do not use a bearer token or secret as the provider key. Namespace the
server settlement id by effect, as the example does, so two providers do not
share one key.

Queries and actions have no mutation settlement identity and refuse the call
with `SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE`. An action should call a named
mutation through `ctx.runMutation`; that mutation writes the effect intent and
the later action or worker performs delivery. The hosted coordinator currently
has no client-mutation replay ledger and returns the all-null twin, so a
replay-stable effect key is a local-target capability.

A mutation that declares a write to a `permissionBacking` table is generated
with `authorityCreating: true`. Authors may explicitly mark an opaque mutation
conservatively, but cannot clear a derived marker. Under the partial local
agent-auth slice this requires grant consent at admission, and the host still
enforces the exact permission-backing write dynamically.

## Read and delete through `ctx.db`

The mutation context exposes the same bounded query builder used by JS
queries. Start with `query(table)`, select a declared index with
`withIndex(indexName)`, and add one `eq(field, value)` per equality-bound index
field. `take(limit)` supplies the explicit row ceiling; `collect()` is the
terminal that executes the builder and returns the bounded array:

```js source=demos/messaging-snapback/snapback/functions.mjs fragment="bounded indexed collection inside startDirectMessage"
    const mine = await ctx.db
      .query('conversationMembers')
      .withIndex('by_user')
      .eq('userHandle', selfHandle)
      .take(500)
      .collect();
```

Do not omit the bound merely because the query uses an index: index selection
limits *which* rows qualify, while `take` limits how many qualifying rows the
handler can materialize. Chain compound-index equalities in declared index
field order.

These reads are caller-scoped by table visibility. A named mutation that has
already established authority with `ctx.permissions` may use the explicit
`ctx.db.elevated` read variants for protected facts needed by its invariant;
elevation never applies to `insert`, `patch`, or `delete`. Follow the
[authorization recipe](../auth/protecting-data.md#authorize-first-then-elevate-the-exact-handler-read),
including its cross-resource and non-member negative cases.

`delete(table, id)` buffers deletion of one row in the mutation's atomic write
set. A common toggle shape reads the indexed row first, then deletes by its
server-owned `_id`:

```js source=demos/messaging-snapback/snapback/functions.mjs fragment="indexed lookup and delete inside toggleReaction"
    const existing = await ctx.db
      .query('reactions')
      .withIndex('by_message_user_emoji')
      .eq('messageId', args.messageId)
      .eq('userHandle', args.userHandle)
      .eq('emoji', args.emoji)
      .first();
    if (existing) {
      await ctx.db.delete('reactions', existing._id);
      return { reacted: false };
    }
```

Here `first()` is the single-row terminal; use `take(...).collect()` when the
handler genuinely needs a bounded list. `delete` remains buffered until the
mutation commits, so a later refusal or conflict removes nothing.

## Consume the structured result

Successful direct mutations return one closed envelope:
`version`, `changed_count`, `result`, the server-derived
`authorityDescriptor` (persisted with the ACK proof; it grants no authority),
an optional deterministic `ctx_ledger`, nullable server-derived `attribution`
and `facts` (the active artifact generation), and the terminal `receipt`. The
todo acceptance proves the
created id, changed count, and server-owned row fields together:

```js source=demos/todo/tests/acceptance/headless.mjs
    const created = await db.mutate(api.createTodo, { args: { title: 'Buy milk' }, userId: ADA });
    assert(typeof created.result === 'string' && created.result.length > 0, 'no id returned');
    assertEqual(created.changed_count, 1, 'changed_count');
```

Use `results.value(validator)` for a direct scalar/object payload or
`results.document(table)` for one complete stored document. The generated
mutation reference carries that exact logical result type. Snapback validates
the post-JSON result against the frozen effective contract before committing
writes or retaining a successful settlement. A mismatch returns
`SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION`; no write, durable version, or
successful settlement survives, and the diagnostic never echoes the rejected
value. The general result ceiling is 4 MiB, while retained mutation output
also keeps its existing 65,536-byte ceiling.

The violation details name the failing bound so you do not have to guess which
one it was: `constraint` carries one closed name (`maxResultBytes`, `maxBytes`,
`maxDepth`, `maxItems`, `minItems`, `nodeBudget`, `arity`, `dimensions`,
`requiredField`, `extraField`, `type`, `literal`, `range`, `union`, or
`serialize`) beside the JSON `path`, and size, count, depth, and budget bounds
also report numeric `limit` and `observed`. Those measurements are aggregate
magnitudes only — a rejected value, string, or dynamic key never appears.

An error is a structured `SNAPBACK_*` diagnostic. A rejected queued mutation
still has a terminal receipt on the error envelope so the client store can
settle it without guessing. A confirmed receipt always carries a non-null
durable `snapshotVersion`; `null` is allowed only for a rejected invocation
whose durable cursor could not be read safely.

## Refuse with a declared code, not a bare throw

<!-- since: 0.1.9 -->

**The rule: if a caller could act on the reason, declare it.** Write the
refusal code at the moment you write the guard — not after a test discovers
that the client cannot tell your business rule from a crash.

A bare `throw new Error('seat is taken')` reaches the caller as the platform
code `SNAPBACK_HANDLER_FAILED`, and the message text is deliberately *not* a
production or application contract. Direct native starts and production
launchers default to the redacted message `JavaScript handler failed` with
only the handler function in details; raw exception text remains on the
private error-tracking carrier. If the invocation-lifetime secret redactor
scrubs that private carrier, details may also contain the literal
`[REDACTED]` as a value-free witness that scrubbing occurred; no exception
text crosses the boundary. That is why refusal-first is a habit rather
than a polish step: the Zerobugs control shipped every
application-semantic refusal as a plain `throw` through ten receipted gate
attempts, and only adopted the channel when a gate assertion caught that a
short-id boundary refusal was invisible to the client
([issue](repo:issues/20260808-guide-gap-declared-refusals-discoverability.md)).

### Debug `SNAPBACK_HANDLER_FAILED` under the dev supervisor

The managed `snapback dev` and Vite development supervisors opt into a bounded
developer projection of the same failure. In that mode the diagnostic message
includes the validated JavaScript error class and underlying message. Its
details carry `errorClass` and `message`, plus `callee` and `property` when the
runtime can resolve the failed call, and `sourcePosition` with the handler
name, line, and column when the engine stack maps back into the handler source.
For example, `ctx.runtime.newId()` reports `property: "newId"` and
`callee: "ctx.runtime.newId"` instead of leaving only the generic code.

This visibility split is intentional: managed development favors the shortest
debugging loop, while production remains redacted by default because exception
messages and stacks can contain handler source, arguments, or other private
context. The enriched message is debugging evidence, not stable product copy;
declare a refusal code for any condition a client must branch on.

Declare a closed set of codes on the function:

```js source=packages/snapback-codegen/refusal-tracking-authoring.test.mjs
  export const moveTodo = defineJsMutation({
    args: { id: v.id('todos') },
    writes: ['todos'],
    refusals: ['INVITE_CONSUMED', 'STALE_MOVE'],
    trackedRefusals: ['STALE_MOVE'],
    handler: async () => null,
  });
```

Then throw one of them with `ctx.refuse(code, details?)`. The declaration is
what types the throw — an undeclared code is *not* a smaller version of a
declared one, it is the generic failure:

```js source=tests/conformance/twin-corpus.handlers.js
  async declaredAppRefusal(ctx, args) {
    ctx.refuse('STALE_MOVE', { expected: 1, actual: args.revision });
  },
  async undeclaredAppRefusal(ctx) {
    ctx.refuse('SOMETHING_ELSE', { hidden: 'must-not-cross-admission' });
  },
```

Codes are uppercase `A-Z0-9_`, 1–64 characters, never the reserved
`SNAPBACK_` prefix, and at most 64 per function; codegen refuses a violation
with `FUNCTION_REFUSAL_DECLARATION_INVALID`. A declared refusal arrives as
the platform code `SNAPBACK_APP_REFUSAL` carrying `appCode` and `appDetails`
in `diagnostic.details`; it never masks a platform denial, and a refusing
mutation commits nothing. The host admits the claimed code only when the
invoked function declared it, and folds anything else — undeclared, forged,
or a bare `SNAPBACK_APP_REFUSAL` claim — to `SNAPBACK_HANDLER_FAILED` with
the app payload dropped. `ctx.refuse` returns `never`, so it needs no
`throw` at the call site, and queries and actions have exactly the same
channel.

### Decide what deserves a code

Ask what the caller would do with the answer:

| Reason | Channel |
| --- | --- |
| The caller can retry differently, pick another value, or be shown copy ("seat taken", "invite already used", "stale revision") | **Declare it.** `refusals: [...]` + `ctx.refuse` |
| The caller must reconcile a concurrent write | Already typed: `SNAPBACK_MUTATION_CONFLICT` |
| The caller is not allowed to do this | Already typed: the auth codes, e.g. `SNAPBACK_AUTH_PERMISSION_DENIED` |
| A bug, an impossible state, or an invariant the caller cannot influence | Leave it a bare `throw`; the generic fold is correct |

Refusal codes are your product's vocabulary, so keep them stable: they end up
in UI copy switches and in tests. To make one issue-eligible in
[error tracking](../operating/error-tracking.md), also list it in
`trackedRefusals` (a narrowing of `refusals`, never an admission by itself).

The consuming side — matching `appCode` through optimistic rollback rather
than parsing message text — is
[show stable application errors](../clients/react.md#show-stable-application-errors-through-rollback).

**Declarative host-plan mutations are a different channel.** `elseError` on
`get(...)` and the code on `guard(...)` are plan refusals: that code arrives
as `diagnostic.code` itself, not wrapped in `SNAPBACK_APP_REFUSAL` with an
`appCode`. Every application plan code must also be declared in `refusals`;
codegen and server artifact validation reject omissions, while reserved
`SNAPBACK_` platform codes are exempt. That declaration cross-check does not
unify the runtime envelopes. Match plan refusals on `diagnostic.code` and
JS-handler refusals on `details.appCode`; do not write one client branch
expecting both shapes. The plan channel's complete semantics are
[refusals from a plan](./declarative-plans.md#refuse-from-a-plan-elseerror-and-guard).

## Preserve invariants with read sets

JS mutation reads are captured by the server. Declarative host-plan mutations
that depend on an earlier client observation carry that explicit
`readSet`. At commit, Snapback validates the exact row or predicate
dependencies. If a concurrent writer changed a dependency, the whole mutation
is rejected as `SNAPBACK_MUTATION_CONFLICT`:

```js source=demos/todo/tests/acceptance/headless.mjs
    const err = await assertThrows(
      () => db.mutate(api.setCompleted, {
        args: { id, completed: false },
        userId: ADA,
        readSet: [{ table: 'todos', id, version: observed }],
      }),
      'SNAPBACK_MUTATION_CONFLICT',
      'expected conflict',
    );
```

Treat that diagnostic as an invariant failure to reconcile, not as permission
to force a last-writer-wins commit. Predicate-shaped captured reads are
validated at predicate granularity, so unrelated writes do not spuriously
conflict.

Authorization-protected writes have one additional pre-transaction conflict:
`SNAPBACK_AUTH_RESERVATION_STALE`. It is HTTP 409 with
`details.retryable: true`, `details.effectCommitted: false`, and
`details.retryStrategy: "short-jitter"`. The standard JavaScript and Swift
clients recognize only that exact closed refusal and retry the complete write
within a bounded short-jitter budget. They do not retry a missing fact, a
different status, an ambiguous outcome, or anything that may have committed.
Every retry remains pinned to the first attempt's exact authority/carrier
generation; logout, user switch, or credential replacement fails the operation
stale instead of replaying predecessor intent as the successor.
Do not add an application retry loop, treat it as backend downtime, or use
service-style exponential backoff.

The JavaScript client defaults to 40 total attempts with 20–80 ms jitter.
Configure `reservationRetryMaxAttempts` (use `1` to disable retries) and
`reservationRetryJitterMilliseconds: [minimum, maximum]` at construction.
Inspect `reservationRetryDiagnostics()` or provide
`onReservationRetryDiagnostic` to retain scheduled, settled, and exhausted
attempt evidence without changing mutation settlement.

Tests for an authorization rule must assert the intended denial code
(`SNAPBACK_AUTH_PERMISSION_DENIED`, for example), not merely that the write
failed. A stale reservation is contention, not evidence that the rule ran.

## Declare structural uniqueness

For one-row-per-key application invariants, declare a true unique index instead
of scanning in the handler:

```js source=demos/shindig/snapback/schema.mjs
    .index('by_user', ['userId'])
    .index('by_event', ['eventId'])
    .index('by_event_user', ['eventId', 'userId'], { unique: true })
    .sync(),
```

Unique indexes may be compound. Every key field must be required in v1 so the
constraint is total across SQLite and Postgres. Duplicate inserts that reach
the serialized write boundary race at the constraint: exactly one wins, every
loser commits nothing and receives `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`. A
larger mutation may still fail earlier at an authorization or stale-reservation
boundary, also without committing. Snapback does not currently ship `upsert`;
keep duplicate-as-error flows as inserts and handle the unique diagnostic.

## Bound and resume bulk work

One mutation may buffer at most **1,024 writes**. The ceiling includes ordinary
`ctx.db` writes and other writes expanded into the same commit, such as
membership commands and maintained-projection effects. Attempting a 1,025th
write rejects the whole mutation with
`SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED`; none of its buffered writes commit.

Snapback does not ship a separate bulk-mutation or resumable-mutation API.
Build large jobs from the ordinary bounded primitives:

1. Read a bounded page through a stable unique index and keyset cursor; see
   [safe standard patterns](./standard-patterns.md#generate-keyset-pages).
2. Send that page to one ordinary mutation, sized so its direct writes plus
   generated projection effects remain at or below 1,024.
3. In that same mutation, update an application-owned job row with the last
   completed cursor or stable key.
4. Read that checkpoint before the next page. After interruption, resume after
   the committed checkpoint rather than replaying every earlier page.

For the specific case of loading a deterministic acceptance fixture larger
than one seed or one mutation allows, the paved recipe — gated batch-ingest
mutation, loader session, digest verification — is
[loading large deterministic fixtures](../testing/large-fixtures.md).

Each page is its own atomic commit; the whole multi-page job is not one
transaction. Make each page idempotent under the application's business key or
current status, and advance the checkpoint only in the commit that applied the
page. Keep batches comfortably below the ceiling when one input can expand into
multiple projection or membership writes. If the product invariant requires
more than 1,024 changes to commit all-or-nothing, redesign that invariant rather
than disguising several mutations as one transaction.

## One commit, one version

All affected rows share the mutation's `version`; no-op writes do not advance
it. Durable live delivery is produced from the committed write set, so clients
never observe a partial mutation. The version is a logical ordering within one
app database, not a wall-clock timestamp. It is an exact integer in
`0..=Number.MAX_SAFE_INTEGER`. The maximum commit is usable, but an operation
that needs its successor fails before writing with
`SNAPBACK_STORAGE_VERSION_EXHAUSTED`; never round or synthesize a cursor.

## Retain bounded record history

By default a committed write replaces the prior row image. A table that needs
its recent prior versions retained inside storage — the substrate host
machinery uses to prove facts about past states — declares finite per-record
history on the schema:

```ts source=packages/snapback-codegen/history-authoring-types.fixture.ts
const policy: HistoryRetentionSpec = {
  retainMs: 60_000,
  maxVersionsPerRecord: 12,
};

defineTable({ title: v.string() }).history(policy).sync();
```

The declaration is a closed typed object of exactly `retainMs` (an integer
from 1 through 2,592,000,000 — at most 30 days) and `maxVersionsPerRecord`
(1 through 1,000), declared at most once per table; there is deliberately no
unbounded spelling. It activates atomically with schema publication: central
writers then capture each committed change into the bounded history store,
and pruning enforces both the age window and the per-record version cap.

Retained versions are storage-side facts consumed by host machinery — the
operation ledger's historical-owner reads when it explains an owner
mutation, and the instance-fork promotion proof tail — not an application
read surface. There is no author-facing history query: a JS handler cannot
read a row's prior versions, and an app that needs user-visible revision
history keeps modeling it as ordinary application rows. Declaring
`history()` without a reason costs a write and storage per commit for
nothing.

## Anti-patterns

- **Do not implement read-then-write invariants as two unrelated requests.**
  Read inside the JS mutation or carry the explicit host-plan baseline.
- **Do not scan to emulate a unique compound key.** Declare a unique index;
  read sets are conflict detection, not a substitute for structural uniqueness.
- **Do not swallow `SNAPBACK_MUTATION_CONFLICT`.** Reconcile or ask the user;
  blind retry may violate the invariant that caused the read.
- **Do not signal an application-semantic refusal with a bare `throw`.** The
  message is not a public contract and the caller receives only
  `SNAPBACK_HANDLER_FAILED`; declare the code in `refusals` and raise it with
  `ctx.refuse`.
- **Do not invent an ad-hoc `{ ok: false, error }` result shape** to carry a
  domain error past the result contract. A refusal is a rejection: it commits
  nothing and settles the client's optimistic layer correctly, which a
  successful-looking envelope does not.
- **Do not count `SNAPBACK_AUTH_RESERVATION_STALE` as an authorization-rule
  denial.** Let the standard client retry the exact effect-free refusal, then
  assert the rule's exact code.
- **Do not set `_id`, `_version`, `_createdAt`, or `_updatedAt`.**
  They are server-owned.
- **Do not send an unbounded collection to one mutation.** Page by a stable
  key, commit a bounded batch with its application checkpoint, and resume from
  the last committed checkpoint.
- **Do not infer success from HTTP status alone.** Consume the result,
  diagnostic, and terminal receipt envelope.
- **Do not omit a result contract when callers depend on the payload shape.**
  Omission deliberately generates `unknown`.
- **Do not validate a mutation result after committing.** The runtime-owned
  pre-commit validator is what makes result-contract failure atomic.

---

<!-- snapback-guide-source: guide/backend/actions-and-fetch.md -->
---
title: Actions and outbound fetch
id: backend.actions-and-fetch
order: 3
audience: agent-first
capabilities: [backend.actions]
authorities: [llp/0004-application-data-api.rfc.md, llp/0009-code-execution-security.rfc.md, llp/0036-app-secrets-and-config.rfc.md, llp/0043-offline-replay-retention.rfc.md, llp/0055-agent-principals-and-scoped-grants.rfc.md, llp/0076-bounded-streamed-actions.rfc.md, llp/0108-inline-handlers-and-result-contracts.spec.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-harness/ctx-bootstrap.js, crates/snapback-server/src/server.rs, demos/all-aboard/snapback/functions.mjs, demos/all-aboard/snapback/handlers.mjs, demos/all-aboard/tests/egress-probe/functions.mjs, demos/all-aboard/tests/egress-probe/handlers.mjs, demos/all-aboard/tests/acceptance/egress.mjs, demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs]
examples: [demos/all-aboard, demos/competitive-checkpoint]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:63ee41d271a9a40072ccb8ce36307972fe1ea2a65d54c2464fe4f847a55a7faf
---

# Actions and outbound fetch

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

An action is the non-transactional function class for external I/O and
longer-running orchestration. It may fetch only when the deployment enables
outbound actions, receives only the config entries named by `uses`, and
commits durable state by calling a mutation.

## Declare the powers the action needs

All Aboard's feed action declares typed arguments, its JS handler, the one
config pool it may read, and the tables mutations it invokes can write:

```js source=demos/all-aboard/snapback/functions.mjs
export const refreshFeed = defineAction({
  args: {
    trigger: v.optional(v.string()),
    source: v.optional(v.string()),
    feedUrl: v.optional(v.string()),
    // Testing knob (short-cadence acceptance rigs): lowers the upstream-poll
    // budget window; clamped so it can never RAISE the 180s production budget.
    pollBudgetMs: v.optional(v.integer()),
  },
  js: { source: 'handlers.mjs', exportName: 'refreshFeed' },
  // @ref LLP 0036#declared-configuration-in-the-manifest — D8: the grant that
  // hands the live fetch its rotating key via ctx.secrets.
  uses: ['caltrainFeed'],
  writes: ['trainStatus', 'liveDepartures', 'feedRefreshState'],
});
```

`uses` is an allowlist, not documentation. Codegen rejects unknown entries,
and `ctx.secrets` refuses an entry the action was not granted. Declare values
and configure deployments as described in
[secrets and config](../operating/secrets-and-config.md).

## The handler file is a closed script

The file named by `js.source` is **not an ES module**: it is a closed
single-file script, and `exportName` resolves against a registration object
the file assigns to `globalThis.__snapbackHandlers`. An ES `export`
statement refuses at generation (`BUNDLE_UNSUPPORTED_EXPORT`), and a file
that never registers the name fails at load with
`SNAPBACK_HANDLER_EXPORT_MISSING`. The CI-executed egress conformance
fixture is the canonical shape — declaration:

```js source=demos/all-aboard/tests/egress-probe/functions.mjs
export const notifyDelivery = defineAction({
  args: { url: v.string() },
  js: { source: 'handlers.mjs', exportName: 'notifyDelivery' },
  result: results.value(v.object({ delivered: v.boolean() })),
  writes: ['deliveries'],
});
```

and the handler file's registration, performing a real outbound fetch and
committing the response through a named mutation:

```js source=demos/all-aboard/tests/egress-probe/handlers.mjs
globalThis.__snapbackHandlers = {
  // Canonical module-form fetching action: outbound fetch against a local
  // provider, response committed durably through a named mutation.
  async notifyDelivery(ctx, args) {
    const response = await fetch(args.url);
    const body = await response.text();
    if (response.status !== 200) {
      throw new Error('delivery provider refused: ' + response.status);
    }
    await ctx.runMutation('recordDelivery', { url: args.url, body });
    return { delivered: true };
  },
```

Several handlers can share one file: register each `exportName` as another
key on the same object.

### The inline form

An action may instead carry its handler inline as a self-contained
`handler:` function expression (LLP 0108). Under the same
`SNAPBACK_OUTBOUND_ACTIONS` opt-in, an inline action handler may reference
the global `fetch`:

```js source=demos/all-aboard/tests/egress-probe/functions.mjs
export const notifyInline = defineAction({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    const response = await fetch(args.url);
    const body = await response.text();
    return { delivered: response.status === 200 && body.length > 0 };
  },
  result: results.value(v.object({ delivered: v.boolean() })),
  writes: [],
});
```

### Host-mediated `ctx.fetch`

Alongside the global `fetch`, an action may use the host-mediated
`ctx.fetch` (LLP 0049 §Action Egress). It is target-portable: on the local
target it is served by the same detached execution lane as
`ctx.fetchStream`, under the same `SNAPBACK_OUTBOUND_ACTIONS` gate, and on
both targets it resolves to the same buffered value —
`{status, ok, url, bodyText}` with the authored URL echoed:

```js source=demos/all-aboard/tests/egress-probe/functions.mjs
export const notifyHostFetch = defineAction({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    const response = await ctx.fetch({ url: args.url });
    return {
      delivered: response.ok === true && response.status === 200,
      body: response.bodyText,
    };
  },
  result: results.value(v.object({ delivered: v.boolean(), body: v.string() })),
  writes: [],
});
```

Responses are bounded (1,000,000 bytes, UTF-8 text; the refusals are
`SNAPBACK_HOST_FETCH_RESPONSE_TOO_LARGE` and
`SNAPBACK_HOST_FETCH_RESPONSE_INVALID_UTF8` on every target). Secret
DESCRIPTOR placement slots resolve only at the hosted fetch boundary; the
local profile stages secret values through `ctx.secrets` handles into
headers and refuses descriptor slots with
`SNAPBACK_HOST_FETCH_SLOT_INVALID`. `ctx.fetchStream` works the same way
on both targets ([streamed actions](./streamed-actions.md)).

For the partial local agent-auth slice, codegen also derives
`authorityCreating: true` when an action or mutation declares a write to a
`permissionBacking` table; an opaque path may conservatively set the boolean
explicitly. This is an admission signal, not the security boundary: the host
rechecks the resolved grant's exact consent at the permission-backing write.

## Keep network I/O outside the transaction

Actions do not get `ctx.db`. Fetch or compute first, then call a named
mutation through `ctx.runMutation`; that mutation owns the atomic durable
commit and live fan-out:

```js source=demos/all-aboard/snapback/handlers.mjs
      const snapshot = await fetchCaltrainSnapshot(ctx, args || {});
      return await ctx.runMutation('applyLiveFeedSnapshot', {
        trigger,
        source: '511-siri-stop-monitoring',
        delays: snapshot.delays,
        departures: snapshot.departures,
```

This split prevents a slow or failed network request from holding the write
lane. Nested mutations inherit the action's server-resolved authority; they do
not accept a replacement identity.

<!-- since: 0.1.15 -->

Actions themselves cannot call `ctx.mutation.settlement()`; the host refuses
it with `SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE`. For replay-stable external
delivery, have the nested mutation [derive and store an effect key](./mutations.md#derive-a-replay-stable-effect-key),
then let the action or worker perform the I/O from that durable intent.

Two adjacent action surfaces have their own pages: a mutation schedules an
action to run later, transactionally with its writes, via `ctx.jobs.enqueue`
([one-off durable jobs](./jobs.md)); and an action sends Expo push
notifications through the declared seam's `ctx.push` surface
([Expo push](./expo-push.md)).

## Enable egress deliberately

Outbound egress is off by default, and the same opt-in is evaluated at two
separate boundaries:

1. **Generation time.** The process running `snapback generate` (or the
   repository codegen entry point) needs `SNAPBACK_OUTBOUND_ACTIONS=1` while it
   validates a bundle containing `fetch` or timers. Without it, generation
   fails early with `BUNDLE_UNSUPPORTED_FETCH` or
   `BUNDLE_UNSUPPORTED_TIMER`.
2. **Process runtime.** The Snapback server process also needs
   `SNAPBACK_OUTBOUND_ACTIONS=1`. Generation does not grant the running
   process network authority, and the runtime remains the security boundary.

The codegen acceptance witness sets the generation-process environment before
validating the action:

```js source=packages/snapback-codegen/authoring-validation.test.mjs
const previousOutboundActions = process.env.SNAPBACK_OUTBOUND_ACTIONS;
process.env.SNAPBACK_OUTBOUND_ACTIONS = '1';
```

Prefix whichever authoring command you use. The managed `dev` command runs
generation before starting or attaching to the server, so one prefixed command
carries the opt-in through that managed loop:

```sh
# Generate artifacts without starting the managed server.
SNAPBACK_OUTBOUND_ACTIONS=1 snapback generate snapback

# Or run managed generation + server development under the same opt-in.
SNAPBACK_OUTBOUND_ACTIONS=1 snapback dev snapback
```

A harness that starts the server directly passes the runtime environment
explicitly:

```js source=demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs
const source = await startStreamSource();
const server = await startServer({
  port: 0,
  db: ':memory:',
  cwd: repoRoot,
  env: { SNAPBACK_OUTBOUND_ACTIONS: '1' },
  provenance: {
    appId: 'competitive-checkpoint',
    artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
  },
});
```

Queries and mutations remain denied fetch even in an enabled runtime:

```js source=demos/all-aboard/tests/acceptance/egress.mjs
  await suite.check('a query in the same runtime is still denied fetch and has no ctx.secrets', async () => {
    const { rows } = await dbOn.query('queryProbe', {});
    assert(/AMBIENT_CAPABILITY_DENIED/.test(rows[0].fetchState), `query fetch should be denied, got: ${rows[0].fetchState}`);
    assertEqual(rows[0].secretsState, 'undefined', 'queries get no config surface');
```

Action wall-clock limits and the detached watchdog still apply. A timed-out
action cannot commit late, and a later invocation gets an isolated worker.

## Treat fetched text as data

Egress does not make an action a general-purpose code loader. Direct or
indirect `eval`, every Function-family string constructor (including
constructor walks and reflective calls), and WebAssembly are unavailable at
the runtime boundary. The same rule applies on the local Ibex engine and the
Workerd target. Codegen reports the obvious source forms early, but the engine
policy is what prevents aliases from bypassing the rule.

Do not fetch JavaScript, templates intended for evaluation, or remote policy
code. Parse a response as validated data and pass only typed values to a named
mutation. This keeps the manifest's bundle hash truthful: an action may use its
declared secret and egress authority, but fetched bytes never inherit its
`ctx.runMutation` authority as executable code.

## Handle failure as data only when the product means it

An action may return a structured fallback result when fallback is an explicit
product behavior, as All Aboard does for recorded data. Otherwise throw: the
action error remains a structured diagnostic envelope. Never convert
configuration, permission, or timeout failures into a false success merely to
keep a UI quiet.

Await or return every asynchronous branch whose outcome matters. The runtime
treats an unhandled detached rejection as a handler failure; it cannot be
reclassified as successful settlement by replacing reachable Promise hooks.

## Stream a response

Consuming an upstream response incrementally — an AI token stream, a large
export — is its own bounded surface with its own limits, attempt control
plane, and diagnostic codes. See
[streamed actions](./streamed-actions.md) for the whole pattern:
`ctx.fetchStream`, the one-pull-per-cursor reader, the
`ctx.streamAttempt` lease/settlement surface, the v1 limits (1 MiB total,
16 KiB reads, 64 KiB buffering, 30 s wall, 5 s idle, 4 cursors, ten
progress commits per second), and every `SNAPBACK_ACTION_STREAM_*` refusal.
Stream diagnostics name this section as their repair anchor; the page above
is the repair.

## Anti-patterns

- **Do not fetch inside a query or mutation.** The ambient-capability gate
  refuses it, and transactions must not wait on the network.
- **Do not pass API keys in action arguments.** Declare config and grant it
  with `uses`.
- **Do not write durable state directly from an action.** Call a mutation so
  validation, receipts, and live delivery share one commit.
- **Do not enable egress globally as a convenience.** Turn it on only for the
  deployment that needs actions with network access.
- **Do not evaluate fetched text.** Parse and validate it as data; dynamic
  source compilation is denied even for egress-enabled actions.
- **Do not launch unobserved Promise chains.** Await or return them so their
  failure remains part of the handler's explicit result.
- **Do not split a buffered body after receipt and call it streaming.** The
  witness must observe multiple durable commits before upstream completion.

---

<!-- snapback-guide-source: guide/backend/declarative-plans.md -->
---
title: Declarative mutation plans
id: backend.declarative-plans
order: 3
audience: agent-first
capabilities: [backend.functions]
authorities: [llp/0004-application-data-api.rfc.md, llp/0051-language-neutral-data-tier.rfc.md, llp/0133-local-settlement.spec.md, llp/0135-sequence-allocation-and-snapshot-batch.spec.md, llp/0144-declared-app-refusal-codes.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-codegen/settlement-bounded-skew.test.mjs, crates/snapback-kernel/src/storage.rs, crates/snapback-types/src/value_expr.rs, demos/warble/snapback/functions.mjs, demos/todo/snapback/functions.mjs, demos/signal-desk/snapback/functions.mjs]
examples: [demos/warble, demos/todo, demos/signal-desk]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:391f5bef508ca9c561097cb2f5de09f3c55ca2953808ca3c93f8ee2eb89361ae
---

# Declarative mutation plans

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`defineMutation` composes a **host-executed plan** — no JavaScript handler
runs. The plan is a sequence of closed steps (`insert`, `patch`, `del`,
`get`, `guard`, `letBind`, `deleteWhere`, `insertEach`, …) whose values are
expressions over the arguments, prior bindings, server-derived auth facts,
and runtime time/ids. The host validates, buffers, and commits the whole
plan with [mutation semantics](./mutations.md) — one commit, one version,
read-set conflict validation. This page is the complete plan vocabulary; the
JS-handler alternative and everything shared between the two forms (results,
conflicts, buffered-write ceilings) stay on [mutations](./mutations.md).

## Write a plan mutation

A single-step plan inserts a row from arguments plus trusted runtime values,
binds the server-minted id, and returns it:

```js source=demos/warble/snapback/functions.mjs
export const createPost = defineMutation({
  args: { body: v.string(), authorHandle: v.string(), authorName: v.string() },
  plan: insert(
    'posts',
    {
      feed: lit('home'),
      authorHandle: arg('authorHandle'),
      authorName: arg('authorName'),
      body: arg('body'),
      likeCount: lit(0),
      // Minted into the deterministic ctx ledger at enqueue time, so an
      // offline post replays with the timestamp the UI already showed rather
      // than jumping to the reconnect time.
      createdAt: runtimeNow(),
    },
    { bindIdAs: 'postId' },
  ),
  result: results.value(v.object({ postId: v.string() })),
  returns: returnExpr(record({ postId: bindingRef('postId') })),
});
```

A multi-step plan reads, refuses when the read misses, and moves a
denormalized counter atomically with the write that justifies it:

```js source=demos/warble/snapback/functions.mjs
export const likePost = defineMutation({
  args: { postId: v.string(), userHandle: v.string() },
  plan: [
    get('posts', arg('postId'), 'post', { elseError: 'POST_NOT_FOUND' }),
    insert('likes', { postId: arg('postId'), userHandle: arg('userHandle') }),
    patch('posts', arg('postId'), {
      likeCount: add(field(bindingRef('post'), 'likeCount'), lit(1)),
    }),
  ],
  refusals: ['POST_NOT_FOUND'],
  result: results.value(v.object({ liked: v.boolean(), likeCount: v.integer() })),
  returns: returnExpr(
    record({
      liked: lit(true),
      likeCount: add(field(bindingRef('post'), 'likeCount'), lit(1)),
    }),
  ),
});
```

## The `defineMutation` spec keys

- `args` — the closed argument validators, exactly as on `defineJsMutation`.
- `plan` — one step or a plain array of steps, executed in order; at least
  one step is required. (`mutationPlan(...steps)` is **not** this array: it
  wraps a flattened, frozen step list into the container
  `defineWriteWithActivity` accepts for its authored `primary` steps.)
- `returns` — a return binding (below); omitted behaves like
  `returnChangedCount()`, reporting the committed changed-row count.
- `result` — the declared result contract. A plan mutation admits
  `results.value(...)` or `results.document(...)` only; anything else
  refuses generation.
- `boundedSkew` — exactly `{ field, maxSkewMs }`, the LLP 0133 lane-L
  opt-in: accept a client-captured settlement time for one declared field
  when within the bound (below).
- `auth`, `refusals`, `trackedRefusals` — the shared authored-function keys.
  Every application code used by plan `elseError`/`guard` must appear in
  `refusals`; platform codes with the reserved `SNAPBACK_` prefix are exempt.
  See [refusal behavior](#refuse-from-a-plan-elseerror-and-guard).

For `boundedSkew`, `maxSkewMs` is an integer from 1 through 86,400,000, and
`field` must name **exactly one direct `runtimeNow()` write** across the
plan's `insert`/`patch`/`insertEach` values — a transformed or derived use
is inexpressible by construction. An out-of-bound claim is re-derived from
the server clock, not refused:

```js source=packages/snapback-codegen/settlement-bounded-skew.test.mjs
const direct = defineMutation({
  plan: insert('events', { capturedAt: runtimeNow(), observedAt: runtimeNow() }),
  boundedSkew: { field: 'capturedAt', maxSkewMs: 5_000 },
});
```

## Plan steps, completely

| Step | Meaning |
| --- | --- |
| `insert(table, values, { bindIdAs }?)` | Buffer one insert. `values` maps fields to expressions; `bindIdAs` names a binding that holds the server-minted id for later steps and `returns`. |
| `patch(table, id, values)` | Buffer a partial update of the row `id` (an expression). |
| `del(table, id)` | Buffer deletion of one row. (`delete` is a reserved word; the helper is `del`.) |
| `get(table, id, bindAs, { elseError }?)` | Point read captured into the read set. A missing row binds `null` (compose with `coalesce`) unless `elseError` names the typed failure code that rejects the mutation. |
| `guard(cond, elseError)` | Truthiness check over an expression; failure rejects the whole mutation with the author-supplied code. |
| `letBind(bindAs, expr)` | Bind a computed expression for later steps. |
| `deleteWhere(table, filter)` | Set-oriented delete. The filter array is required (`SNAPBACK_DELETE_WHERE_FILTER_REQUIRED`; non-array is `SNAPBACK_DELETE_WHERE_FILTER_INVALID`); an explicitly authored `[]` clears the table deliberately — see [mutations](./mutations.md#define-the-write-boundary). |
| `insertEach(table, source, itemAs, values)` | A bounded comprehension: one insert per element of the argument-supplied array `source`, with `values` expressions over the `itemAs` binding. |
| `assertSourceChanged(table, id, operation)` | Assert the plan changed that row with `'insert'`, `'patch'`, or `'delete'`; used by generated write-plus-activity plans to bind provenance rows to their source write. |
| `allocateSequence(counter, scope, into)` | Allocate one value from a declared [scoped sequence](./sequences.md) into a binding. Admitted only inside `defineWriteWithActivity`-generated plans; hand-authored `defineMutation` plans use the JS-tier `ctx.sequence.allocate` instead. |

Two related helpers are not steps: `existingOwner({ table, id, visibility })`
declares the owner-checked activity scope of a
`defineWriteWithActivity` profile (the visibility field must be a required
string or principal), and `mutationPlan(...)` is that profile's step
container noted above.
Both live with the write-plus-activity design reference in
[safe standard patterns](./standard-patterns.md#design-reference-write-plus-one-activity-row).

Steps execute in declaration order. General iteration, data-dependent step
skipping, and cross-step control flow are permanently outside the profile —
a mutation that needs them outgrew the IR (below).

## Return bindings

`returns` declares what the mutation's logical `result` is, without running
code:

- `returnBinding(name)` — the value of a binding (`bindIdAs`, `letBind`,
  `get`, or `allocateSequence` targets).
- `returnChangedCount()` — the committed changed-row count.
- `returnDocument(table, id)` — one complete stored document, read inside
  the committing transaction at the new version, so it observes the plan's
  own writes; a missing row returns `null`. The `id` is an expression. Pair
  with `results.document(table)`.
- `returnLiteral(value)` — a constant.
- `returnExpr(expr)` — any expression; with `record({...})` this covers
  computed summaries, as in `createPost` above.

The smallest useful shape is a patch that reports its effect:

```js source=demos/todo/snapback/functions.mjs
export const editTitle = defineMutation({
  args: { id: v.string(), title: v.string() },
  plan: patch('todos', arg('id'), { title: arg('title') }),
  returns: returnChangedCount(),
});
```

## The expression algebra

Every `values` entry, `id`, `cond`, filter value, and `returnExpr` body is an
expression built from this closed vocabulary (`define.mjs`; the runtime
authority is `crates/snapback-types/src/value_expr.rs`, and the data-tier corpus pins each entry's
behavior):

**Arguments and bindings.** `arg('name')` — strict property access; a
caller-optional argument consumed by it refuses generation with
`SNAPBACK_AUTHORING_OPTIONAL_ARG_CONTRADICTION`. `argOpt('name')` — the
omission-tolerant twin: a missing property evaluates to `null`; supply
defaults with `coalesce(argOpt('name'), lit(fallback))`. `argsRoot()` — the
whole args object, the null-safe base `argOpt` is built on.
`bindingRef('name')` (alias `binding`) — a prior step's binding.
`field(base, ...keys)` — null-propagating access by arbitrary string keys,
hyphenated keys first-class. `lit(value)` (alias `literal`) — a JSON
constant.

**Server-derived auth facts.** `authUserId()` — the effective user;
`authKind()`, `authActorKind()`, `authIsDelegated()`, `authActualActor()`,
`authActivityActorKind()`, `authGrantId()` — the LLP 0055 principal facts;
`clientMutationDigest()` — the settled client-mutation identity digest.
These are the plan-side equivalents of `ctx.auth` reads.

**Trusted runtime values.** `runtimeId()` and `runtimeNow()` — the plan-side
`ctx.runtime.id()` / `ctx.runtime.now()`
([trusted runtime values](./trusted-runtime-values.md)).

**Arithmetic, comparison, boolean.** Binary: `add`, `sub`, `mul`, `div`,
`mod`, `eqv`, `ne`, `lt`, `lte`, `gt`, `gte`, `and`, `or`. Unary: `not`,
`neg`. Expression equality is **`eqv`** — plain `eq(field, value)` is the
declarative-query *filter* helper (as are `ltFilter`/`lteFilter`/
`gtFilter`/`gteFilter`), not an expression.

**Conditionals, strings, records.** `cond(test, whenTruthy, otherwise)` —
the ternary. `concat(...parts)` — string concatenation; plain strings are
lifted to literals. `record({ field: expr, ... })` — the closed record
constructor for computed summaries.

**The pinned function library.** `call(name, ...args)` admits exactly
`len`, `trim`, `lower`, `abs`, `min`, `max`, `round`, `floor`, `ceil`, and
`coalesce` (`PINNED_FUNCTIONS`); `coalesce(...)` is exported directly.
Codegen fails closed on any other name — growing the library is a
profile-version event, not an app-side extension.

## Refuse from a plan: `elseError` and `guard`

Plan refusals are **their own channel**, different from `ctx.refuse` in a JS
handler, and the split matters when you write the client branch:

- A failed `get(..., { elseError: 'CODE' })` or `guard(cond, 'CODE')`
  rejects the whole mutation — nothing commits — and the code arrives as
  `diagnostic.code` **itself**. It is not wrapped in
  `SNAPBACK_APP_REFUSAL`, and there is no `details.appCode`. The details
  carry the failing step kind (`Get` additionally names the table and id).
- Every application code in `elseError` or `guard` must also appear in the
  mutation's `refusals: [...]` declaration. Codegen and server artifact
  validation reject an undeclared code. This cross-check makes the authored
  failure vocabulary complete, but it does not change the runtime envelope:
  plan failures still arrive as `diagnostic.code`, not `details.appCode`.
- A plan code is a free string. Unlike `ctx.refuse` codes, it may
  deliberately reuse a platform code so distinct failure paths collapse to
  one public outcome — the owner-checked delete below returns the same
  `SNAPBACK_ROW_NOT_FOUND` for "missing" and "not yours", disclosing
  neither:

```js source=demos/signal-desk/snapback/functions.mjs
export const deleteIncidentForAcceptance = defineMutation({
  args: { incidentId: v.id('incidents') },
  auth: 'authenticated',
  result: results.value(v.boolean()),
  plan: [
    get('incidents', arg('incidentId'), 'incident', {
      elseError: 'SNAPBACK_ROW_NOT_FOUND',
    }),
    guard(
      eqv(field(bindingRef('incident'), 'commanderId'), authUserId()),
      'SNAPBACK_ROW_NOT_FOUND',
    ),
    del('incidents', arg('incidentId')),
  ],
  returns: returnLiteral(true),
});
```

When a caller should branch on the reason from a **JS** handler, that is the
declared-refusal channel —
[refuse with a declared code](./mutations.md#refuse-with-a-declared-code-not-a-bare-throw).

## Know when the plan is not enough

The named out-of-profile classes (LLP 0051 D2) are explicit: data-dependent
step skipping (`conditional-writes`), uniqueness/quota/membership guards
over non-id keys (`filtered-read-guards`), coercion the pinned library lacks
(`type-coercion`), and general iteration (`general-iteration`). A mutation
in one of these classes belongs on `defineJsMutation`; declaring the class
as `outgrewIr` there makes codegen emit the class-specific "outgrew the IR"
info diagnostic into the generated manifest, keeping the tier ladder
explicit.

## Anti-patterns

- **Do not write a JS handler for a plan-expressible write.** The plan form
  is the paved road: no handler VM, a statically validated write shape, and
  the same commit semantics. Reach for `defineJsMutation` only when a named
  out-of-profile class applies.
- **Do not branch on `details.appCode` for a plan refusal.** Plan
  `elseError`/`guard` codes arrive as `diagnostic.code` directly; only
  `ctx.refuse` produces the `SNAPBACK_APP_REFUSAL` + `appCode` envelope.
- **Do not omit application plan codes from `refusals: [...]`.** Codegen and
  server artifact validation require every non-`SNAPBACK_` `elseError` and
  `guard` code to be declared. Platform codes retain their reserved namespace
  and need no application declaration.
- **Do not use `eq` where `eqv` is meant.** `eq` builds a declarative-query
  filter clause; expression equality inside a plan is `eqv`.
- **Do not smuggle client time or client-minted ids through `args`** to
  bypass `runtimeNow()`/`runtimeId()`. The closed argument schema and the
  [trusted runtime values](./trusted-runtime-values.md) page exist to keep
  those server-authored; `boundedSkew` is the one declared, bounded
  exception for a single directly assigned time field.
- **Do not emulate iteration by unrolling data-dependent steps.** The tuple
  of steps is static; a variable-shaped write set outgrew the IR.

---

<!-- snapback-guide-source: guide/backend/cron.md -->
---
title: Scheduled execution with cron
id: backend.cron
order: 4
audience: agent-first
capabilities: [backend.cron]
authorities: [llp/0028-cron-scheduled-execution.rfc.md, crates/snapback-cli/src/cli.rs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, demos/all-aboard/snapback/functions.mjs, demos/all-aboard/tests/acceptance/cron.mjs, demos/_kit/server-process.mjs]
examples: [demos/all-aboard]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:f69a89f211633bef6232851c37e3da506b4548cba2b8deeb3bd45fedc373e870
---

# Scheduled execution with cron

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Cron jobs are generated manifest entries that ask the target scheduler to run
an **action**. The action may perform I/O and calls mutations for durable
effects, so scheduled writes use the same atomic commit and live-delivery path
as user-triggered work. Cron owns only recurring, source-declared schedules;
one-off delayed work — the `runAfter` shape a mutation enqueues at runtime —
is [one-off durable jobs](./jobs.md), a separate subsystem with a separate
ledger (LLP 0028's 2026-07-30 boundary amendment).

## Define the job

All Aboard declares one demand-gated interval:

```js source=demos/all-aboard/snapback/functions.mjs
export const caltrainCron = defineCron({
  warmPoll: {
    // jitter:false because the 180s cadence is a fixed product interval for a
    // single demand-gated app; no thundering-herd concern (LLP 0028 §Jitter).
    schedule: { everyMs: 180_000, jitter: false },
    action: 'refreshFeed',
    activation: { kind: 'WhileLive', whileLive: ['liveTrainStatus'] },
  },
});
```

The complete authoring inventory for each job:

- `schedule`: exactly one of `everyMs` (local floor 1,000 ms) or a
  five-field `cron` expression;
- `action`: the name of a declared action; authenticated-only actions are
  rejected because the scheduler runs with system authority;
- `enabled`: defaults to `true`;
- `activation`: always (default) or `whileLive` over named live queries;
- `jitter` / `jitterMaxMs`: jitter defaults on; opt out only for a
  product-fixed cadence with no herd concern;
- `overlapPolicy`: defaults to `NoOverlap`;
- `retryPolicy`: defaults to `{ mode: 'NextTick' }`.

Codegen validates job names, schedules, action existence/kind, and the
auth-requirement boundary before the server loads the manifest.

## Inspect declared jobs and runtime posture

Use the read-only operator projection before forcing any scheduler work:

```sh
snapback cron list --ready-file .snapback/ready.json
```

The equivalent control-MCP tool is `snapback_cron_list`; the direct HTTP
alias is AdminRead-gated `GET /_snapback/api/cron`. The response lists each
declared job's name, action, schedule, enabled/activation state, next nominal
and due time, whether work is in flight, last-run time/outcome, and consecutive
failure count. These are the same facts already held for runtime inspection,
so listing does not tick, run, or persist scheduler work.

This narrow view intentionally omits exact run IDs, handler error details and
results, jitter seeds, and recent-run payloads. Use the secret-read-gated full
`app.inspect`/admin inspect view when those details are actually required.

## Gate polling on real demand

`whileLive` keeps a polling job inactive when nobody subscribes to the
declared query. The first subscription arms it; the last disconnect makes it
inactive again:

```js source=demos/all-aboard/tests/acceptance/cron.mjs
  // Subscribing to the declared live query arms the job (whileLive activation).
  const live = await db.liveQuery('liveTrainStatus', { connectionId: 'cron-rider' });
  const versionBefore = live.version;
```

This is how a scale-to-zero app avoids paying for upstream polling while idle.
The target owns the wakeup mechanism; the action/mutation behavior stays
portable.

## Test deterministically

`POST /_snapback/api/cron/tick` is an AdminWrite test/operations seam. The
kit's `cronTick()` sends the admin credential, recomputes activation, and
runs due work. Do not wait for wall-clock cadence in acceptance tests.

The acceptance asserts the whole path—tick → action → mutation → live update:

```js source=demos/all-aboard/tests/acceptance/cron.mjs
  await suite.check('scheduler run: action -> mutation -> live delta', async () => {
    const rows = await live.poll();
    assert(live.version > versionBefore, `durable version advanced (${versionBefore} -> ${live.version})`);
    const limited = rows.find((r) => r.patternId === 'sb-limited');
```

The public `GET /inspect` projection exposes aggregate cron posture only.
Per-job activation, next/last timing, diagnostics, and the bounded recent-run
ledger may contain handler-controlled values and therefore live on the
admin-gated `GET /_snapback/api/inspect` twin. In a headless suite, construct
`AdminClient` with the returned server token, or use
`openHeadlessApp(...).admin.inspect()`. Assert the job and a successful run so
a vacuous tick cannot pass.

## Run with the scheduler inert

To keep autonomous cron runs out of a test or dev session entirely, start
the server with the scheduler disabled:

```sh
SNAPBACK_CRON_DISABLED=1 snapback start   # or: snapback start --cron-disabled
```

The switch accepts `1` or `true`; any other value leaves the scheduler on,
so a typo cannot silently disarm production crons. Definitions still load,
validate, and appear in `/inspect` with their ordinary armed/inactive
state — only autonomous claiming stops. `POST /_snapback/api/cron/tick`
keeps working, so a suite drives every tick itself. From an acceptance
suite, pass the kit option instead of hand-building the environment:
`startServer({ ..., cronDisabled: true })` sets `SNAPBACK_CRON_DISABLED=1`
on the child (and refuses to reuse an already-running server, whose
scheduler may be live). See
[LLP 0028 §Scheduler state and run ledger](repo:llp/0028-cron-scheduled-execution.rfc.md).

**The first tick can look early.** `everyMs` schedules keep their nominal
grid anchored at Unix epoch 0, and a job's first evaluation seeds the most
recent past slot — so one catch-up run fires promptly after arming,
regardless of when your subscription armed it. A 180 s job observed firing
shortly after boot "before anything subscribed" is this catch-up, not a
bug ([LLP 0028 §Inspection and query
surface](repo:llp/0028-cron-scheduled-execution.rfc.md), ENG-22604 and the
2026-08-01 a4-f4 amendment). Inside that run, `ctx.runtime.now()` is the
run's due time — since the a4-f4 amendment that is within one interval of
wall clock, so time-gated scans (`remindAt <= now`) behave on the first
tick. If the mid-suite run would perturb your assertions, disable the
scheduler as above and tick manually.

Definition generations and run sequences are exact JavaScript-safe integer
identities. The maximum value is usable once; a successor fails before taking
ownership with `SNAPBACK_CRON_DEFINITION_GENERATION_EXHAUSTED` or
`SNAPBACK_CRON_RUN_SEQUENCE_EXHAUSTED`. An out-of-range persisted counter is
`SNAPBACK_CRON_STATE_INVALID`, never an implicit reset. Treat these as terminal
operator diagnostics for that scheduler state rather than retrying the job.
Scheduled-batch staging is atomic: exhaustion in any job publishes none of the
batch's claims. Inspect's consecutive-failure count saturates at the same
portable maximum instead of wrapping.

## Anti-patterns

- **Do not schedule a mutation directly.** Cron targets actions; the action
  calls a mutation for durable effects.
- **Do not emulate one-off delayed work with a cron job.** The run ledger's
  identity model rejects runtime-created entries by construction; use
  [one-off durable jobs](./jobs.md) (`ctx.jobs.enqueue`) instead.
- **Do not sleep in tests.** Force an authenticated tick and inspect its run
  ledger; start the suite's server with `cronDisabled: true` so the live
  scheduler cannot commit a competing run mid-assertion.
- **Do not poll while nobody can observe the result.** Use `whileLive` for
  warm-poll products that should scale to zero.
- **Do not disable jitter casually.** Fixed no-jitter schedules need an
  explicit product reason.

---

<!-- snapback-guide-source: guide/backend/handler-runtime.md -->
---
title: Handler runtime profile and generation preflight
id: backend.handler-runtime-profile
order: 4
audience: agent-first
capabilities: [backend.handler-runtime-profile]
authorities: [llp/0237-bounded-handler-modules.rfc.md, llp/0108-inline-handlers-and-result-contracts.spec.md, packages/snapback-codegen/handler-runtime-profile.mjs, packages/snapback-codegen/inline-handlers.mjs, packages/snapback-codegen/index.mjs, packages/snapback-cli/index.mjs]
examples: [packages/snapback-codegen/handler-runtime-profile.test.mjs, packages/snapback-codegen/handler-graph-parity.test.mjs, packages/snapback-cli/generate-check.test.mjs]
status: current
targets: [all]
maturity: shipped
since: 0.1.21
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:3a2d76c6596d4ae44aa1c9b1b98dfae32e8b5b9946ae149ef656c735f0cbf68d
---

# Handler runtime profile and generation preflight

Every successful generation writes
`handler-runtime-profile.v1.json` beside the function and schema manifests.
It is the machine-readable answer to what handler code this build admits:
module bounds, syntax, globals, computed access, runtime capabilities, target
differences, diagnostics, and the profile selected for each operation. The
artifact is projected from the same versioned tables used by codegen's
scanners, rather than from a separate prose restriction list.

Authoring a function that stores media? Route to [Assets](./assets.md) before
choosing handler arguments or stored fields. The explicit function surface is
where you declare asset intents, perform trusted finalization, and attach typed
references. A data URL in `v.string()` or `v.json()` is not an asset upload and
loses the pipeline's size, media, delivery, GC, and rendition guarantees.

## Inspect the generated profile

Read the profile through the generated review manifest, just like any other
regenerable artifact. Its `artifacts.json` file record has logical kind
`handler-runtime-profile`, consumer `developer-tooling`, a content digest,
byte count, custody, and regeneration command. The generated package also
exports it as `./handler-runtime-profile`.

The current admission identity is
`snapback.handler-admission.legacy.v1`; the artifact schema and profile are
`snapback.handler-runtime-profile.v1`. Each operation names one of the
existing `inline-handler-v1`, `inline-handler-same-file-helpers-v2`,
`closed-script-handler-v1`, or `host-plan-v1` profiles. In this first rollout,
`selectionReason` is honestly `legacy-profile`: imported modules are not yet
an admitted reason to select a different runtime profile.

## Inspect the same-file graph record

`moduleGraph.records` represents every extracted inline handler and its
reachable same-file helper closure. Each
`snapback.handler-graph-record.v1` record names the root handler, directed
helper topology, importer spans, `esm` module format, extractor and admission
versions, and the normalized root-relative target. In the current profile
every edge resolves to `self` and the target is `functions.mjs`; the record
does not admit a relative specifier or a second file.

Every handler and helper node carries two deliberately separate fields.
`canonicalExecutableAstDigest` hashes the canonical executable AST, while
`rawSourceEvidenceDigest` hashes the exact authored source slice. A comment or
formatting edit therefore rotates raw evidence without rotating the canonical
AST digest or the existing operation `implementationHash`. The explicit
`graphTopologyDigest` makes helper reachability and self-recursion inspectable,
but Rollout 2 does not add it to the already-shipped implementation-hash
preimage.

Same-file extraction parses one captured `functions.mjs` buffer, recorded as
`single-captured-source-buffer-v1`; no imported file exists to reread. Before a
later rollout admits relative imports, its implementation Spec and golden
vectors must freeze the parse-versus-attested-reread protocol and refuse a
changed file before artifact replacement.

## Preflight without replacing artifacts

Run the packaged preflight before asking codegen to publish a candidate:

```sh
snapback generate snapback --check --json
```

This is the same source discovery, definition evaluation, handler admission,
contract checking, target compatibility, complete candidate rendering,
inventory, and hashing path used by ordinary `snapback generate`. The only
difference is the final step: `--check` deletes its temporary candidate rather
than publishing it to the hash-addressed cache or replacing
`snapback/generated/`. A failed or successful preflight therefore leaves the
previous generated bytes intact.

The contributor entry point accepts the same mode:
`node packages/snapback-codegen/index.mjs <backend-dir> --check --json`.

## Can I import a helper?

No—not in the current profile. `moduleGraph.admittedSpecifiers` is empty,
`maximumFiles` is 1, and `maximumImportDepth` is 0. Re-exports are forbidden,
and codegen does not install an ambient resolver in the handler runtime. A
closed-script `import` refuses with `BUNDLE_UNSUPPORTED_IMPORT`; CommonJS
`require` refuses with `BUNDLE_UNSUPPORTED_REQUIRE`.

For an inline handler, move shared code into a named top-level function
declaration in the same `functions.mjs` file. Codegen includes every reachable
same-file function declaration in the operation's executable bytes. Imported
bindings and top-level values do not become spliceable helpers. A direct
handler reference to one reports `SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER`;
the message names an imported binding explicitly. An otherwise invalid
same-file helper reports `SNAPBACK_INLINE_HELPER_INADMISSIBLE`.

## Can I use Node crypto?

No. The current profile admits no package or Node built-in specifiers, so
`node:crypto` cannot be imported, and `process`, `require`, and `Buffer` are
not handler capabilities. A direct `process` reference in a closed script
refuses with `BUNDLE_UNSUPPORTED_PROCESS`. The generated profile records
`nodeBuiltins: false`, `nodeCrypto: false`, and `filesystem: false` for every
operation kind and target profile.

Do not treat an engine-provided `crypto` global as a Node compatibility
promise. If the operation needs fresh identity or trusted time, use
`ctx.runtime.id()` or `ctx.runtime.now()`. If it needs an external cryptographic
service, use an admitted Action capability rather than loading a Node module.

## Inline handlers and same-file helpers

An inline handler remains one direct function or arrow-function expression in
its builder declaration. It may call reachable, named, top-level function
declarations from the same file. Codegen scans the handler and the complete
reachable helper set with the same positive globals allowlist, syntax rules,
reflection rules, `ctx.db` member list, and query-builder verbs.

The nested `ctx.db.elevated` allowlist is exact: `get`, `getMany`,
`uniqueMany`, and `query`. An elevated write or unknown member refuses during
generation. See the [handler-read authorization recipe](../auth/protecting-data.md#authorize-first-then-elevate-the-exact-handler-read)
before using that trusted query/mutation-only surface.

Same-file helper cycles remain forbidden in this legacy profile and produce
`SNAPBACK_INLINE_HELPER_CYCLE`. This describes current enforcement; it does
not introduce the bounded multi-file graph, relative imports, or safe computed
index grammar reserved for later LLP 0237 rollout phases.

## Closed-script handler files

A `js.source` handler file is a closed script, not an ES module. Register its
functions on `globalThis.__snapbackHandlers`; an `export` statement refuses
with `BUNDLE_UNSUPPORTED_EXPORT`, while a missing runtime registration reports
the distinct runtime-check code `SNAPBACK_HANDLER_EXPORT_MISSING`.

The scanner rejects imports, dynamic loading, dynamic code construction,
ambient Node process access, WebAssembly, ambient time, ambient randomness,
and gated network/timer uses before artifact replacement. The runtime remains
the security boundary for aliases and reflective paths that static analysis
cannot prove.

## Globals and operation kinds

The profile's `globals` object is keyed by `Query`, `LiveQuery`, `Mutation`,
and `Action`, then separates inline and closed-script handler forms. Inline
handlers use the scanner's explicit positive identifier allowlist. Closed
scripts use a scanner denylist plus the runtime boundary; the artifact does
not pretend those two admission models are the same.

Fetch is unavailable to queries, live queries, and mutations. It is available
to an Action only when generation and runtime both enable
`SNAPBACK_OUTBOUND_ACTIONS`. Closed-script timers follow that Action opt-in;
inline timers remain unavailable. Node crypto and `process` remain unavailable
for every operation kind.

Ambient wall-clock and entropy calls are not the trusted handler surface.
Use `ctx.runtime.now()` and `ctx.runtime.id()` instead. At runtime, an ambient
capability denial is `SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED`, distinct
from its earlier static-admission refusal code.

## Forbidden syntax and computed access

The current inline profiles admit direct functions, statically named ordinary
property access, and same-file function declarations. They refuse classes,
ambient `this` or `super`, dynamic import, `eval`, Function construction,
dynamic computed properties, prototype/descriptor reflection, and helper
cycles.

Static string property access is admitted. Static numeric access is admitted
only where the current scanner resolves the literal. Dynamic computed access,
`__proto__`, `constructor`, `prototype`, and Object descriptor/prototype
reflection methods remain forbidden. The generated profile records these
lists directly from the executable scanner tables; this rollout does not widen
them.

## Static and runtime refusals

The diagnostic table publishes a phase for every handler-profile code. Codes
such as `BUNDLE_UNSUPPORTED_IMPORT` and
`SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN` are `static-admission` refusals.
`SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED` and
`SNAPBACK_HANDLER_EXPORT_MISSING` are `runtime-check` refusals. The separate
subcodes prevent an agent from mistaking a runtime boundary failure for a
source-graph admission failure.

Every listed rule also carries an admitted alternative and a build-bound
`/_snapback/guide/...` anchor. Prefer that structured remediation over
guessing from the error message.

## Diagnostic attribution

Definition evaluation now carries the authored exported binding and nested
property path through the isolated evaluator. This nested property path is
the authored route to the bad option. For example,
`SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE` can name
`sendPhoto.assets.image.optional` with its file, line, and column rather than
only reporting that some definition contained a function or other non-JSON
value.

A top-level builder value without an export—an unexported top-level operation—refuses before evaluation with
`SNAPBACK_CODEGEN_DEFINITION_NOT_EXPORTED`. Its structured details include the
binding name, source span, definition path, and an `export const ...`
remediation. Export the operation; do not work around discovery by mutating a
namespace or generated manifest.

The profile's graph identity evidence names two different fields:
`implementationHash` is the canonical executable digest, while
`authoredSourceHash` is the raw-evidence digest. Comments, formatting, and
source locations remain review evidence; they are not silently overloaded
into the executable graph identity.

## Anti-patterns

- Do not add a bundler alias or copy package code into generated output to make
  an import appear to work.
- Do not replace `--check` with a syntax-only parser pass; preflight must run
  the complete ordinary generator checker.
- Do not infer Node compatibility from Hermes, V8, or an ambient global that
  happened to exist in one process.
- Do not hand-edit `handler-runtime-profile.v1.json`; regenerate it from the
  authored backend and executable rules.

---

<!-- snapback-guide-source: guide/backend/familiar-profile.md -->
---
title: Familiar TypeScript profile (Experimental, non-default)
id: backend.familiar-profile
order: 5
audience: agent-first
capabilities: [backend.familiar-profile-v1, authority.profile.v1]
authorities: [llp/0056-scoped-roles-and-memberships.rfc.md, llp/0231-entity-and-permissioning-recommendation.rfc.md, llp/0240-application-authority-profiles.rfc.md, llp/0252-convex-familiar-authoring-profile.rfc.md, llp/0253-familiar-profile-v1-api.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, crates/snapback-engine/src/runtime.rs, packages/snapback-codegen/ctx.d.mts, packages/snapback-codegen/define.mjs, packages/snapback-codegen/familiar.mjs, packages/snapback-codegen/index.mjs, packages/snapback-harness/ctx-bootstrap.js, packages/snapback-react/familiar.mjs, packages/snapback-contract/auth-coordinator.mjs, packages/snapback-contract/auth-custody-secure-store.mjs, llp/0044-asset-storage-pipeline.rfc.md]
examples: [tests/fixtures/familiar-todo, tests/fixtures/familiar-todo-explicit, packages/snapback-codegen/familiar-phase-b.test.mjs, packages/snapback-codegen/rbac-authoring.test.mjs, packages/snapback-react/familiar.test.mjs, packages/snapback-react/package.test.mjs, packages/snapback-contract/auth-coordinator.test.mjs, packages/snapback-contract/auth-custody-secure-store.test.mjs, packages/snapback-cli/templates/expo-chat, tests/acceptance/fixtures/familiar-video-asset, tests/acceptance/familiar-video-asset-v1.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.21
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:8d755dadfc7074bdf2071561aa83601ad521d4c7ae7d5e3b80404ca4c6bf73e0
---

# Familiar TypeScript profile (Experimental, non-default)

> **Experimental / non-default in 0.1.23.** The familiar profile is a source
> adapter over Snapback's canonical schema, function, runtime, and client
> owners. It is not a second backend and does not make Convex compatibility a
> target claim.

Use this profile when top-level TypeScript modules and
`query`/`mutation`/`action` constructors materially improve authoring. Use the
default explicit profile for the broadest Snapback vocabulary, especially
declarative plans, routes, cron, search/vector, and
effectful actions. One backend selects one profile; mixing explicit
`schema.mjs`/`functions.mjs` with familiar `schema.ts`/function modules is a
typed refusal.

## Select the profile explicitly

The opt-in lives only in `snapback/codegen.policy.json`:

```json source=tests/fixtures/familiar-todo/codegen.policy.json
{
  "schemaVersion": "snapback.codegen-policy.v1",
  "committedProjections": ["normalized-definition.v1.json"],
  "authoringProfile": "snapback-familiar-ts-v1"
}
```

Omitting `authoringProfile` selects `snapback-explicit-v1`. Do not add a
runtime flag or client-side profile switch; generated app identity carries the
selection.

The familiar backend root is flat:

```text
snapback/
  codegen.policy.json
  schema.ts
  todos.ts                 # exports become api.todos.*
  contracts.ts             # non-function helper module
  generated/               # generated server/api declarations and runtime
```

Nested modules are helpers, not function namespaces. A top-level
function/intent module may export only familiar function or asset-intent
values; move exported constants and helpers out of it.

## Declare schema and functions

The schema vocabulary is the shared `defineSchema`/`defineTable`/`v` surface:

```ts source=tests/fixtures/familiar-todo/schema.ts
import { defineSchema, defineTable, v } from "./generated/server";

export default defineSchema({
  // @ref LLP 0234#phase-g2--d2-enforcing-closure — this dual-profile fixture's
  // public operations share synthetic rows, so every todo is public by design.
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
  }).visibility({ kind: "public-read" }).index("by_completed", ["completed"]),
});
```

That shared vocabulary includes typed opaque arrays and objects. A nested
`v.principal()` may record a historical recipient snapshot, including inside
`v.array(...)`; it does not grant current authority. Membership, visibility,
and grants must still use their first-class declarations. If an installed
Familiar schema used `v.json()` for data that is now structured, keep the field
name and use the reviewed
[`ConvertJsonToStructured` migration](./migrations.md#evolve-vjson-into-a-structured-field);
direct retyping refuses.

Each function declares its authority and data reach next to the handler. A
module `todos.ts` with export `list` becomes canonical name `todos.list` and
generated reference `api.todos.list`:

The shared operation-name grammar admits either one identifier or exactly two
identifiers separated by one dot (`IDENT` or `IDENT.IDENT`). Familiar
top-level modules generate the two-segment form, and the leaf is not restricted
to CRUD names. Client-consumed JavaScript exposes dotted operations through
the generated `api` namespace; it does not emit quoted or dotted ESM export
aliases.

```ts source=tests/fixtures/familiar-todo/todos.ts
export const list = query({
  args: { completed: v.boolean() },
  returns: v.array(v.doc("todos")),
  auth: "public",
  reads: ["todos"],
  handler: async (ctx, args) => ctx.db
    .query("todos")
    .withIndex("by_completed", (q) => q.eq("completed", args.completed))
    .collect(),
});
```

Every function requires `args`, `returns`, `auth`, and `handler`. Queries add
`reads`; mutations add `reads` and `writes`; actions may add `secrets`.
Queries are live by default; set `delivery: "read"` for a one-shot query.
Row-shaped query returns remain arrays. A point query can declare an exact
single value such as `returns: v.union([v.doc("todos"), v.null()])` or a closed
`v.object(...)` and return that value directly; `useQuery` receives the object
or `null`, not a one-row array. Familiar actions can read auth/runtime/secrets,
refuse, and call a generated mutation reference; they do not expose `ctx.db`,
fetch, assets, jobs, realtime, or streaming.

## Declare non-derived asset intents

A bare `v.assetRef()` still derives the small private JPEG/PNG default. When
the application needs another media type or policy, export the canonical
`defineAssetUpload` constructor from a top-level Familiar module. The module
and export become the same two-segment generated namespace as functions.
Omitting delivery on that explicit constructor uses the `public-immutable`
performance default and emits an advisory; use `private-signed` for authorized
per-user issuance when a renderer cannot attach bearers, or `private-strict`
for bearer-only next-request revocation. The owner-only example below keeps
its private tier explicitly:

```ts source=tests/acceptance/fixtures/familiar-video-asset/media.ts
import { defineAssetUpload } from './generated/server';

export const videoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['video/mp4'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  video: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

This declaration produces canonical intent `media.videoUpload` and generated
reference `api.media.videoUpload`. Use that nominal reference with the normal
asset client; the upload, trusted byte detection, video finalization, custody,
typed attachment, and authorized readback paths are identical to the explicit
profile. The [asset guide](./assets.md) owns the complete policy and client
flow. Do not encode media bytes in JSON or split data URLs across document
fields when the derived image default is too narrow.

## Put authorization before business logic

`auth: "authenticated"` proves only that a principal exists. It does not prove
the caller is an active member or administrator of an app resource. For every
protected handler, make the active-member/admin decision before returning rows
or performing effects.

Start with declarative table visibility. A membership declaration can protect
its resource table through the resource row's system id and protect direct
children through their required resource id:

```ts fragment reason="membership declaration is application-specific; this shows the two shipped visibility bindings"
conversations: defineTable({ title: v.string() }).visibility({
  kind: "membership",
  declaration: conversationMembers,
  resourceField: "_id",
  roles: ["member", "admin"],
}),
messages: defineTable({
  conversationId: v.id("conversations"),
  body: v.string(),
}).visibility({
  kind: "membership",
  declaration: conversationMembers,
  resourceField: "conversationId",
  roles: ["member", "admin"],
}),
```

Ordinary `ctx.db` reads enforce those policies, including inside familiar
queries and mutations. Prefer that fail-closed path whenever the governed row
directly names the membership resource; it makes an omitted handler check hide
the row instead of widening access.

<!-- since: 0.1.23 -->

For a handler that already receives the typed resource id, Familiar accepts
the same authority-profile declaration as Explicit:

```ts fragment reason="Familiar authority-profile admission uses the canonical membership predicate"
export const messages = query({
  args: { conversationId: v.id('conversations') },
  returns: v.array(v.doc('messages'), { maxItems: 50 }),
  auth: 'authenticated',
  reads: ['messages'],
  membership: [conversationMembers.hasRole(
    membershipResource.arg('conversationId'),
    'member',
  )],
  handler: async (ctx, args) => ctx.db.query('messages')
    .withIndex('byConversation').eq('conversationId', args.conversationId)
    .take(50).collect(),
});
```

Codegen places the captured role check before the handler, blanks a denied
row-set read, and terminally denies a mutation. Read admission requires a
row-set result contract that accepts `[]`; scalar/document results and
nonempty bounded record results fail generation. It also generates the bounded
`api.<profile>.list` and caller-scoped `api.<profile>.myRole` references. The
authored handler contains no repeated permission guard.

For a multi-hop relation the grammar cannot declare, use the sanctioned
handler sequence: prove the role with the declaration-qualified permission
helper, elevate only the exact protected read, and validate that every resolved
row belongs to the authorized resource before returning it:

```ts fragment reason="familiar query declaration fields and result shape vary; this is the authorization-critical handler body"
handler: async (ctx, args) => {
  await ctx.permissions.conversationMembers.requireRole(
    args.conversationId,
    "member",
    "admin",
  );

  const message = await ctx.db.elevated.get("messages", args.messageId);
  if (!message || message.conversationId !== args.conversationId) return [];

  const quoted = message.quotedMessageId
    ? await ctx.db.elevated.get("messages", message.quotedMessageId)
    : null;
  if (quoted && quoted.conversationId !== args.conversationId) return [];
  return [{ message, quoted }];
},
```

`ctx.db.elevated` is an explicit call-local authority, not an ambient server
mode. Its closed read allowlist is `get`, `getMany`, `uniqueMany`, and `query`.
It bypasses only table row visibility and remains bounded, captured, and
OCC-validated. It has no write members, is refused in actions, and does not
bypass result/egress, asset, membership-writer, or field-masking rules. If the
handler receives only a child id, perform one bounded elevated read to derive
the resource id, immediately call `requireRole` on that derived id, and return
nothing before the check succeeds.

Repeat this sequence in **every** quote lookup, receipt mutation, live query,
and other multi-hop handler that remains undeclarable, and add negative tests
for both a non-member and an authorized resource id paired with a foreign row
id. Direct-resource handlers should use the authority-profile declaration
above; repetition remains intentional only where the relation is still
multi-hop.

The full patterns are [Scoped roles and memberships](../auth/scoped-roles.md),
[Protecting live and retained data](../auth/protecting-data.md), and
[Bind a principal to your app user](../auth/app-identity-binding.md). Use
`ctx.membership.<declaration>.bootstrap(resourceValues, initialMembers?)` when
one group and its initial roster must be atomic: the host adds the creator,
accepts at most 64 unique additional principals, authorizes every added seat
from the creator's bootstrap role through the ordinary transition matrix, and
writes nothing if any seat is invalid. Do not substitute a client-provided user
id or an `auth` string for server-side checks, and do not make protected backing
tables `public-read` just so a trusted handler can inspect them.

## Keep React hook arguments identity-stable

Familiar's React doorway is `@expo/snapback-react/familiar`. It exports
`SnapbackProvider`, `useQuery`, `useMutation`, `useAction`, `useQueryState`,
and `skip` over the canonical React owner. `useQuery` returns current live data
or `undefined`; use `useQueryState` when the UI must render connection,
freshness, blocked, or diagnostic state.

Memoize stable-content argument objects at the component boundary:

```tsx fragment reason="application component names vary; packages/snapback-react/package.test.mjs proves stable identity stays silent while five consecutive equal-content identities emit SNAPBACK_REACT_LIVE_HOOK_ARGS_IDENTITY_CHURN"
const listArgs = useMemo(() => ({ completed }), [completed]);
const todos = useQuery(api.todos.list, listArgs);
```

Do the same for nested scope/value objects passed to live or presence hooks.
The canonical store key is content-based, so an inline equal-content object is
not a data-integrity bug, but repeated identity churn performs descriptor
handoffs and triggers the development diagnostic
`SNAPBACK_REACT_LIVE_HOOK_ARGS_IDENTITY_CHURN`. Memoization is lifecycle
hygiene, not a workaround for stale data.

<!-- since: 0.1.23 -->

## Persist native session custody with SecureStore

Web uses `createIndexedDbAuthCustodyStorage()`. React Native now has a
first-party, dependency-injected SecureStore adapter, so do not silently fall
back to `createMemoryAuthCustodyStorage()` for a user session that must survive
a process restart. Install the SDK-compatible `expo-secure-store` in the app;
`@expo/snapback-contract` itself stays dependency-free.

```js fragment reason="application package imports; the contract package test injects a SecureStore double instead of depending on Expo"
import * as SecureStore from 'expo-secure-store';
import { AuthCoordinator } from '@expo/snapback-contract/auth-coordinator';
import { createSecureStoreAuthCustodyStorage } from '@expo/snapback-contract/auth-custody-secure-store';
```

Construct the adapter once and pass it as `storage` with native wakeup seams
disabled:

```js source=packages/snapback-contract/auth-custody-secure-store.test.mjs
  const authStorage = createSecureStoreAuthCustodyStorage(SecureStore);
  const authCoordinator = new AuthCoordinator({
    appId,
    storage: authStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
```

The adapter uses `snapback.auth-custody.${authAppIdHash(appId)}` internally,
serializes ownership per app key, validates every read and write, and preserves
the coordinator's revision-CAS and authority-epoch invariants. On web keep the
IndexedDB adapter. Acceptance must terminate and relaunch the native process,
then prove `synchronize()` restores the settled session without a new
email-code exchange.

This string carrier is ordinary bearer custody only. A sender-constrained
record refuses with `SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED`; the Secure
Enclave/Keystore proof transport remains outside the shipped native target.

## One Expo Router journey

Here is the shortest coherent application loop, rather than six disconnected
reference exercises:

1. Scaffold the published Expo app, install `expo-router` and SDK-compatible
   `expo-secure-store`, copy the conventional `snapback/` backend when adding
   Snapback to an existing project, select the familiar policy above, and use
   the fenced first-party custody adapter above when working from source.
2. Author `schema.ts` plus top-level function modules. Put
   `SnapbackExpoProvider`/`SnapbackProvider` and the one long-lived client in
   `app/_layout.tsx`; construct the native `AuthCoordinator` with the
   SecureStore adapter there. Route files import generated `api.module.export`
   references and use memoized argument objects.
3. Gate each protected query/mutation with active membership or admin checks.
   Keep this server-side even if Expo Router already hid the screen.
4. For a simple private JPEG/PNG field in 0.1.23, a bare `v.assetRef()` derives
   the bounded default upload intent. Upload through the generated asset
   reference and `assets.upload(...)`, wait for its ready asset id, then attach
   the typed id in a mutation. Use the complete [asset guide](./assets.md), not
   a base64 data URL. If the default is insufficient, declare
   `defineAssetUpload` in a top-level module and upload through its
   `api.module.export` reference.
5. After every source change run `snapback generate snapback`; review and
   commit the refreshed `snapback/generated/artifacts.json` plus only the
   projections selected by policy. `_generated/` is retired: do not create it,
   including as a symlink, because codegen and dev admission refuse the
   alternate root. Never patch a generated manifest to make a type error
   disappear.
6. Run `snapback dev snapback --expo` for the supervised device loop. Keep the
   acceptance owner separate from the rendered route: use the generated
   template's headless `acceptance.mjs`/`acceptance.live.mjs` pattern to boot
   isolated state, mint the test persona, drive generated references, observe
   the live result, and shut down. Add an on-device process-kill/relaunch rung
   for SecureStore restoration and the actual picker/upload path.

The profile changes authoring syntax only. Expo boot, asset custody,
acceptance process ownership, generated-artifact review, live delivery, and
authorization remain the same canonical Snapback systems documented by their
linked pages.

## Know when to leave the profile

Move the backend to the explicit profile when it needs a surface the familiar
grammar refuses: declarative plans, routes, cron, search/vector, membership
declarations not expressible in the shared schema
vocabulary, or action fetch/stream/host effects. Treat the diagnostic's route
as the boundary; do not import explicit builders into a familiar function
module or hide them behind a helper.

The complete refusal table remains in
[Generated artifact custody](../getting-started/generated-artifacts.md#diagnose-familiar-profile-refusals).

---

<!-- snapback-guide-source: guide/backend/jobs.md -->
---
title: One-off durable jobs
id: backend.jobs
order: 5
audience: agent-first
capabilities: [backend.jobs-one-off]
authorities: [llp/0070-durable-background-work.rfc.md, crates/snapback-services/src/jobs.rs, crates/snapback-engine/src/runtime.rs, crates/snapback-server/src/admin.rs, crates/snapback-server/src/admin_secret_read.rs, crates/snapback-cli/src/cli.rs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/jobs-authoring.test.mjs, packages/snapback-admin-client/index.mjs]
examples: [packages/snapback-codegen/jobs-authoring.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:6d95641bb08090de8c01061804af32041cc9f70e6846bf722395c2e504334591
---

# One-off durable jobs

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

One-off jobs are the `runAfter` shape: a mutation schedules a declared
**action** to run later, transactionally with its own writes. If the mutation
rolls back, no job exists — rollback provably schedules nothing. This is the
LLP 0070 first slice behind the experimental `jobs_one_off_v1` capability;
recurring schedules are [cron](./cron.md), a separate subsystem with a
separate ledger.

Execution is **at-least-once** with fenced attempts and idempotency keys.
No exactly-once class is claimed anywhere on this surface.

## Enqueue from a mutation

`ctx.jobs.enqueue(action, args, options?)` needs zero declaration — every v1
job lands on the paved `default` queue:

```js source=packages/snapback-codegen/jobs-authoring.test.mjs
globalThis.__snapbackHandlers = {
  async scheduleEvent(ctx, args) {
    return await ctx.jobs.enqueue('notify', { name: args.name }, { delayMs: 0 });
  },
  async applyEvent(ctx, args) {
    const id = await ctx.db.insert('events', { name: args.name });
    return { id };
  },
  async notify(ctx, args) {
    return await ctx.runMutation('applyEvent', { name: args.name });
  },
};
```

The complete options vocabulary:

- `delayMs` — non-negative integer; `availableAt = now + delayMs` on the
  frozen invocation clock (deterministic under replay). Horizon: 30 days
  (`SNAPBACK_JOB_DELAY_INVALID` beyond it).
- `idempotencyKey` — 1..200 bytes, scoped to (queue, action); the same key
  under a different action is a different scope and creates an independent
  job. Re-enqueueing with the same key, an equal canonical-args SHA-256
  digest, and the same `maxAttempts` returns the existing job with
  `deduplicated: true` (a different `delayMs` does not break identity —
  the existing job keeps its original `availableAt`); divergent args or
  attempt policy under the same key fails
  `SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED`; a commit-time race fails closed
  with `SNAPBACK_JOB_IDEMPOTENCY_KEY_RACED` (retry the mutation to
  converge).
- `maxAttempts` — 1..8, default 1. Unlimited retry is invalid
  (`SNAPBACK_JOB_ATTEMPT_POLICY_INVALID`).
- `pushGrant` — exactly `{ to, dedupeKey }`, and only when the schema
  declares the [Expo push seam](./expo-push.md): the mutation captures a
  narrow producer-principal grant for one deferred send, persisted beside
  the job and never inside its arguments (any other shape is
  `SNAPBACK_JOB_PUSH_GRANT_INVALID`; capture requires an authenticated
  user mutation). The grant joins the idempotency identity — reusing a key
  with a divergent grant fails `SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED` like
  divergent args. Semantics live on the push page.

The return value is `{ jobId, availableAtMs, deduplicated }`. Job ids ride
the ctx-answer ledger, so tests can assert on them across replay.

### Budget retries for expected contention

`maxAttempts: 1` is a bounded-work default, not a recommendation that every
job is safe to try once. If an action calls a mutation that can contend with
foreground writes or authorization reservations, enqueue it as
**retryable by design** with a stable idempotency key and a small explicit
budget:

```js fragment reason="application-specific action, arguments, and idempotency identity"
await ctx.jobs.enqueue('notify', args, {
  maxAttempts: 3,
  idempotencyKey: `notify:${args.eventId}`,
});
```

The local sessions target may return the retryable
`SNAPBACK_AUTH_RESERVATION_STALE` refusal when a deferred mutation races a
concurrent foreground move. An attempt consumes one slot even though no
application effect committed; the queue applies its bounded jittered backoff
before the next attempt. With the default budget, that same routine contention
would make the job terminal `dead`. Keep the action idempotent because delivery
is still at-least-once, and choose the smallest budget that covers the
contention your acceptance test actually witnesses.

Who may enqueue, and what may run:

- **Only mutations enqueue.** Queries and actions get
  `SNAPBACK_JOB_ENQUEUE_UNAVAILABLE`; an action schedules follow-up work by
  calling a mutation via `ctx.runMutation`, exactly as above.
- **Only manifest-declared actions run** (either runtime form — HostPlan or
  JS). A mutation or query callee fails closed at enqueue with
  `SNAPBACK_JOB_CALLEE_NOT_ADMITTED`; an undeclared name is
  `SNAPBACK_JOB_ACTION_UNKNOWN`.

Paved `default`-queue limits (published, not declarable in v1): 16 enqueues
per mutation (`SNAPBACK_JOB_ENQUEUE_LIMIT_EXCEEDED`), 64 KiB canonical args,
30 s claim lease, claim batch 64, retry backoff base 1 s capped at 60 s with
jitter ceiling 1 s.

The declarations around the handlers above are ordinary — the enqueueing
mutation carries no jobs-specific ceremony:

```js source=packages/snapback-codegen/jobs-authoring.test.mjs
export const scheduleEvent = defineJsMutation({
  args: { name: v.string() },
  source: 'handlers.mjs',
  exportName: 'scheduleEvent',
  writes: ['events'],
});
```

## Observe a job's status live

`defineJobStatusQuery` generates the declared job-status query — an ordinary
live query over one job's privacy-bounded lifecycle projection, never an
ambient system table:

```js source=packages/snapback-codegen/jobs-authoring.test.mjs
export const jobStatus = defineJobStatusQuery({ auth: 'authenticated' });
```

**Declaring it is the whole authoring step.** Codegen itself emits the
experimental `jobs_one_off_v1` capability requirement *and* the
artifact-level experimental acknowledgment. Do **not** add
`jobs_one_off_v1` to `defineSchema(..., { requiredCapabilities })` — that
option admits schema-level target capabilities only and refuses this id as
unknown.

Args are fixed: `{ jobId: v.string() }`. Authorization in v1 is the declared
auth requirement plus knowledge of the opaque job id; there is no per-job
row policy yet. Subscribe to it like any live query: the snapshot serves the
current row and lifecycle transitions (claim, retry, terminal) arrive as
ordinary live updates.

The served row is lifecycle facts only — never argument values or results:
`jobId` (mirrored as `_id`), `queue`, `action`, `state`, `availableAtMs`,
`enqueuedAtMs`, `attemptCount`, `maxAttempts`, `stateVersion`,
`terminalAtMs`, `lastErrorCode`, and the producer association
(`producerMutationId`, `producerSnapshotVersion`, `producerFunction`).
States: `pending`, `claimed`, `succeeded`, `dead`, `cancelled`.

The terminal `dead` state is Snapback's **dead-letter / DLQ equivalent** in v1:
there is no separate dead-letter queue. Exhausted jobs remain on the same
durable queue with `lastErrorCode` and append-only attempt receipts, where the
operator lane below can inspect them. There is no replay/redrive operation in
this slice.

Retry history and current status are deliberately different surfaces. A job
that succeeds after one or more retries has `state: "succeeded"` and
`lastErrorCode: null`; the privacy-bounded product status row therefore does
**not** reveal that it retried. The operator detail route
`GET /_snapback/api/jobs/{id}` retains the attempt sequence (for example,
`retryable` with `SNAPBACK_AUTH_RESERVATION_STALE`, then `succeeded`). Use that
route with the required secret-read lease when succeeded-after-retry visibility
matters operationally; do not infer first-try success from a null terminal
error.

Receipts carry the other half of the association: a **confirmed** mutation
receipt that enqueued jobs gains a bounded `enqueues` array
(`{ jobId, action, availableAtMs }`, max 16); a rejected receipt never
carries it, and rollback leaves no job rows — inspectable evidence that
rollback schedules nothing.

## Drain deterministically in tests

`POST /_snapback/api/jobs/drain` is the injected-clock seam — the set-based
sibling of cron's forced tick. Body `{ nowMs?, maxWaves? }`: due jobs
(`availableAt <= nowMs`) are claimed in pinned order up to the claim batch
of 64 per wave, executed, and terminally published, with the drain receipts
returned synchronously (ceiling per call: 64 × waves; a larger due set
needs further calls or waves). Acceptance never sleeps:

```sh
# Enqueue with delayMs: 60000, then force due-ness by injecting the clock.
curl -s -X POST "$SERVER/_snapback/api/jobs/drain" \
  -H "x-snapback-admin-token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"nowMs": '"$AVAILABLE_AT_MS"'}'
```

From a headless suite, `AdminClient.drainJobs({ nowMs, maxWaves })` sends
the admin credential for you. Waves are bounded (default 1; out-of-range
values are clamped to 1..=16): jobs enqueued by a wave's actions become
claimable in the next wave when due, and a due set larger than one claim
batch paginates across waves the same way — cascades are refused by the
cap, never detected.

The autonomous worker is its own ~1 s loop; keep it out of a suite with
`SNAPBACK_JOBS_DISABLED=1` (the deliberate sibling of
`SNAPBACK_CRON_DISABLED` — separate subsystems, separate switches) and
drive every claim through the drain seam. Claim order is pinned
(`availableAt` ascending, then job-id bytes); claim ids are random and
explicitly non-normative — never assert on them.

## Inspect jobs as an operator

The admin lane is `GET /_snapback/api/jobs` (list) and
`GET /_snapback/api/jobs/{id}` (job plus its append-only attempt receipts).
In **sessions auth mode** these responses can carry application-adjacent
data, so the admin token alone is deliberately not enough: the request must
also present a **secret-read lease** in the `x-snapback-secret-read-lease`
header, or it refuses with `SNAPBACK_ADMIN_SECRET_READ_REQUIRED`.

Leases are operator-minted, short-lived (TTL ≤ 15 minutes), scoped to named
surfaces, row/byte budgeted, and reset-bounded. The minting proof root lives
next to the ready file (`<ready>.secret-read-root`), which is why minting is
a **ready-file-only** CLI operation — local operator authority can never be
discovered from a URL:

```sh
snapback secret-read-mint \
  --ready-file .snapback/dev.ready.json \
  --admin-inspect          # scope covering admin inspection reads (jobs included)
# → prints a JSON envelope; use its lease value:
curl -s "$SERVER/_snapback/api/jobs/$JOB_ID" \
  -H "x-snapback-admin-token: $ADMIN_TOKEN" \
  -H "x-snapback-secret-read-lease: $LEASE"
```

The CLI resolves the admin token from `--token`, `SNAPBACK_ADMIN_TOKEN`, or
the ready-file sibling discovery, and signs a one-shot, startup-bound HMAC
proof for `POST /_snapback/api/admin-secret-read/mint`. Other scope flags:
`--receipts`, `--table <name>` (repeatable), `--function <name>`,
`--explain-function <name>`, `--telemetry-events`, `--telemetry-export`,
`--errors-issue`; budgets: `--ttl-seconds` (60),
`--row-budget` (500), `--byte-budget` (1 MiB). There are no wildcard
scopes.

If you hand-roll the flow, the refusal ladder is diagnosable: a jobs read
without a lease is `SNAPBACK_ADMIN_SECRET_READ_REQUIRED`; a mint call with a
bad or replayed proof is `SNAPBACK_ADMIN_SECRET_READ_PROOF_INVALID`; a mint
call without the admin token is `SNAPBACK_ADMIN_TOKEN_REQUIRED`. In dev auth
mode the jobs reads take the ordinary admin credential without a lease. In a
headless suite, `AdminClient.listJobs()` / `showJob(id)` cover the dev-mode
path. Product code should not be here at all — declare the job-status query
instead.

## Design reference

RFC-only (LLP 0070 is in Review; none of this is claimed by
`jobs_one_off_v1`): queue declarations, capacity counters and admission,
per-key concurrency slots, cancellation, the `ambiguous` terminal state,
deadlines, operator replay, retention windows, webhook capture/delivery,
the `revalidatePrincipal`/`capturedGrant` authorization modes (v1 callees
run as the same system authority cron actions use; the push seam's narrow
`pushGrant` is LLP 0143's own lane, not this mode), artifact-digest
pinning, restore fences, Postgres, and every hosted/multi-worker profile.

## Anti-patterns

- **Do not sleep for due-ness.** Inject the clock: enqueue with a delay,
  then drain with `nowMs` at or past `availableAtMs`.
- **Do not schedule a mutation or query.** Jobs run declared actions; the
  action calls a mutation for durable effects (the same shape cron uses).
- **Do not add `jobs_one_off_v1` to `defineSchema` requiredCapabilities.**
  Codegen emits the requirement and the acknowledgment when you declare the
  surface; the schema option refuses the id.
- **Do not read job status from product code via the admin route.** That
  lane is operator custody (secret-read lease in sessions mode); the
  declared job-status query is the product surface.
- **Do not treat idempotent enqueue as exactly-once execution.** Dedup is
  enqueue-side identity; execution stays at-least-once with fenced
  attempts.
- **Do not assert on claim ids.** They are provenance on attempt receipts,
  random by design; assert on job ids, states, and receipts.

---

<!-- snapback-guide-source: guide/backend/versioned-seeds.md -->
---
title: Versioned seeds
id: backend.versioned-seed
order: 8
audience: agent-first
capabilities: [backend.versioned-seed]
authorities: [llp/0109-versioned-seed-evolution.spec.md, llp/0056-scoped-roles-and-memberships.rfc.md, crates/snapback-kernel/src/seed_identity.rs, crates/snapback-kernel/src/storage.rs, crates/snapback-server/src/server.rs, packages/snapback-codegen/seed-artifact.mjs, packages/snapback-client/index.mjs, packages/snapback-cli/index.mjs, packages/snapback-vite/lifecycle.mjs, tests/conformance/versioned-seed-v1.manifest.json]
examples: [demos/party-wall]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-07
reviewed-authorities-digest: sha256:d7472d809b09c8d3009cae85e794bb85f54db6098441f82a8b50424cf0f2459f
---

# Versioned seeds

> **Local target only.** This page describes the local dev/test target.
> Hosted compiled-seed custody remains an explicit GAP.

Use a versioned seed to establish a known fixture on a fresh database. Use a
migration to evolve durable data, or an explicit reset-install when destroying
the current instance is intended. A versioned seed is never an upsert.

## Author the identity

Add a portable `seedVersion` beside `tables` in `snapback/seed.json`. Codegen
emits `generated/seed.artifact.json` with the app id and a canonical
content digest. Changing the table bytes requires a new version. Reusing one
version for different bytes refuses `SNAPBACK_SEED_VERSION_REUSED`.

The identity is scoped to the current data-version stream. The first install
stores the rows, identity, and receipt atomically. Repeating the exact artifact
returns a pure `matched` observation of the establishing receipt. Presenting a
different identity to an installed stream refuses
`SNAPBACK_SEED_MIGRATION_REQUIRED`; it does not modify rows.

Named tables count as targets even when their seed arrays are empty. Occupied
targets without an active identity refuse as nonempty or partially untracked
data. This prevents Snapback from silently adopting a legacy database.

## Seed membership fixture seats through the declared lane

Versioned seeds may name membership tables and install **fixture seats**
(LLP 0100 §8b's routed lane, owned by LLP 0109 §8's dated amendment). The
first-landing refusal (`SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`) is
retired: a named membership table — empty or with fixture rows — is a legal
seed target and reset target. The lane is declaration-checked, never raw:

- fixture seats enter through the host's seed writer and carry per-row
  `seed` provenance; a fixture row that names a host-managed provenance
  column refuses as an undeclared field;
- the same-transaction activation scan enforces the closed role vocabulary,
  non-null axes, `(principal, resource)` uniqueness, resource referential
  integrity, and — under `lastHolder` — an eligible protected holder per
  live resource, refusing the **whole** install otherwise;
- a **reset-install retires every runtime seat and restores exactly the
  fixture seats in the same one-transaction cut** that rotates the
  data-version stream and the authorization incarnation
  (declared-restore semantics — one incarnation cut, never a stream of
  per-row kicks), so a principal holding a runtime-only seat is provably
  denied afterwards while fixture authority survives.

Runtime bootstrap is unchanged: product flows still create protected
resources through the generated membership `bootstrap()` method under a
real principal — the fixture lane is for seeds, resets, and test personas,
not an application write path.

Trusted dev/import tooling has a separate governed membership writer. In that
lane, a `lastHolder`-protected resource and an eligible holder must appear in
the same seed transaction or the whole write refuses with
`SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_RESOURCE`. Party Wall exercises
this dev-only fixture shape on a sibling server; do not present it as a
sessions-mode deployment seed or as a roster raw-write escape for handlers.

## Use the generated lifecycle

`SnapbackClient.ensureVersionedSeed(artifact)` is the non-destructive install
path. `previewVersionedSeed` reports the current/requested identity and exact
direct, derived, total, and reset-deletion counts without changing the
database or WAL. Preview is still an administrative NonProd operation.

For an intentional destructive change, preview `resetInstall`, retain its
tagged predecessor stream (`absent` or the exact present UUIDv7), and pass that
carrier to `resetInstallVersionedSeed`. `clearVersionedSeed` uses the same
predecessor check and coordinated reset but installs no successor identity.
Stale predecessor carriers and historical operation replays refuse.

The managed CLI and Vite lifecycle consume the generated artifact through the
same client methods. They preflight `versioned_seed_install_v1` or
`versioned_seed_reset_v1` and never fall back to legacy `ensure`, `seed`, or
`reset(seed)`. A watch reload therefore matches or reports drift; it does not
reset a populated database.

For `snapback dev`, “seed on first run” means the database did not exist when
that command created its managed server. The CLI installs the generated
artifact through the versioned protocol, then subsequent starts and watch
reloads make only the non-destructive `matched` observation. Existing
databases are never guessed to be fresh. A sessions-mode app is established
from its closed schema/functions startup carrier first; versioned seed remains
outside the legacy startup `seed` member and runs through the named
administrative operation after activation.

The direct administrative routes are
`/_snapback/api/app/seed/{ensure-v1,preview-v1,reset-install-v1,clear-v1}`.
Automation can instead use the corresponding
`app.seed.{ensure,preview,reset-install,clear}.v1` host operations. All four
require AdminWrite plus the NonProd profile, and host-operation bodies place
the closed seed request only under `input`.

## Expect the reset blast radius on connected clients

A receipted reset-install (or clear) retires the **entire pre-reset world**,
deliberately including authority — reset never resurrects it. Every already
connected client is permanently done, not transiently disconnected:

- Live-query holders receive `SNAPBACK_AUTH_STREAM_RESET` as a **terminal**
  error; the client closes for auth and reconnect retries will not recover
  it.
- Pre-reset session tokens invalidate globally: later mutations from any
  client still holding one fail `SNAPBACK_AUTH_REQUIRED`.
- A fresh email-code sign-in for the same email mints a **new** principal,
  so seats/roles must be re-entered through whatever the restored seed
  provides (for example invites); nothing re-links the old principal.

Rigs and admin tools should not learn this from an incidental throw out of
an unrelated await: `SnapbackClient.authTerminalStatus()` is the synchronous
terminal-auth fact (`{ terminated, code, authorityDisposition, atMs }`), and
`subscribeAuthTerminal(listener)` fires at the cut — rebuild the session
(fresh sign-in or explicit custody replacement, which clears the fact)
instead of retrying. Suites that reset mid-run must plan to re-authenticate
every persona afterwards.

## Run the loop against a sessions-mode app

The seed lifecycle is admin-gated, so on a dev-mode app an admin-token client
is enough. A **sessions-mode** app needs three additional facts, each of which
is a refusal if you miss it:

1. **The admin client must also carry a session bearer.** An admin-token-only
   client cannot offer the auth-client protocol, which sessions mode requires.
   Construct it as
   `createExternalSessionClient(url, { bearerToken, adminToken })` — a persona
   bearer minted through the
   [test-persona recipe](../auth/sessions-and-principals.md#mint-test-personas-the-complete-local-recipe)
   plus the admin token for the seed routes.
2. **Pass `requestedMode: 'sessions'` on every seed call.** The seed methods
   default to `dev` and refuse a sessions app with
   `SNAPBACK_SEED_CROSS_MODE_UNSUPPORTED` until the mode is stated
   explicitly. The refusal is deliberate: a cross-mode install would seed
   identities the running app cannot authenticate.
3. **Take `expectedDataVersionStream` from the preview.** The active stream is
   `preview.current.dataVersionStream`; a stale value from an earlier run
   refuses as a historical operation.

With those three, `resetInstallVersionedSeed` is the paved sessions reset: it
leaves the database in a state the next `snapback dev` accepts, unlike a raw
database wipe, which strands the seed identity. Remember that the reset
invalidates every bearer minted before it, including the one that performed
it — mint personas *after* the install, and never seed captured principal ids
(see
[reset invalidates sessions](../auth/sessions-and-principals.md#reset-invalidates-sessions-and-reissues-principals)).

When the fixture itself needs password-backed accounts, application profile
rows, and typed avatar assets, use the app-owned
[sessions fixture installer](../recipes/sessions-fixture-install.md). It signs
up or verifies each real principal after the administrative seed lifecycle;
it does not smuggle principal ids or asset records into this protocol.

## Interpret refusals

- `SNAPBACK_SEED_MIGRATION_REQUIRED`: migrate, or explicitly reset-install.
- `SNAPBACK_SEED_VERSION_REUSED`: choose a new version for changed bytes.
- `SNAPBACK_SEED_NONEMPTY_UNTRACKED` or
  `SNAPBACK_SEED_PARTIAL_UNTRACKED`: inspect the existing data; reset-install
  only if its deletion is intended.
- `SNAPBACK_SEED_OPERATION_HISTORICAL`: obtain a fresh predecessor stream and
  operation id.
- `SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED`: keep total direct plus changed
  maintained-projection outputs at or below 1,024. An acceptance fixture that
  genuinely needs more rows does not belong in a seed — load it through the
  gated batch-ingest recipe in
  [loading large deterministic fixtures](../testing/large-fixtures.md).
- `SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED`: the selected target does not
  advertise the required protocol; there is no compatibility fallback.

For the local dev loop, `snapback reset --dev-fresh` is the paved one-shot
escape from this whole lifecycle cluster: it creates a fresh database,
re-installs the versioned seed, and has a supervised Expo loop re-mint its
ordinary session. Every individual refusal above remains unchanged for partial
operations; the command composes the deterministic destructive path instead of
weakening those guards.

The local protocol is advertised as **experimental** while LLP 0109 remains in
Review. The executable manifest is the advertisement gate: every required
local row must pass, while hosted compiled-seed custody stays visibly GAP.

---

<!-- snapback-guide-source: guide/backend/assets.md -->
---
title: Assets
id: backend.assets
order: 9
audience: agent-first
capabilities: [backend.assets, clients.asset-signed-delivery, clients.asset-upload]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0044-asset-storage-pipeline.rfc.md, llp/0064-native-client-surfaces.rfc.md, llp/0096-auth-profiles-for-protocol-clients.spec.md, llp/0176-expo-messaging-golden-path.plan.md, llp/0180-asset-bearing-client-commands.rfc.md, llp/0181-zero-configuration-expo.rfc.md, llp/0210-asset-upload-dx-closure.rfc.md, llp/0253-familiar-profile-v1-api.spec.md, crates/snapback-services/src/assets.rs, crates/snapback-services/src/assets_cut.rs, crates/snapback-cli/src/cli.rs, crates/snapback-engine/src/local.rs, crates/snapback-server/src/server.rs, crates/snapback-server/src/server/asset_routes.rs, packages/snapback-client/assets.mjs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/familiar.mjs, packages/snapback-expo/asset-source.mjs, packages/snapback-react/index.mjs, packages/snapback-react/index.d.mts, packages/snapback-vite/allowlist.mjs, tests/acceptance/asset-lifecycle-v1-evidence.md, demos/zerobugs/control/snapback/functions.mjs, demos/zerobugs/control/composition/server.mts]
examples: [demos/party-wall, demos/file-drop, demos/tandem-expo-bakeoff, demos/expo-golden-path-fixture, demos/zerobugs/control, tests/acceptance/fixtures/familiar-video-asset, tests/acceptance/familiar-video-asset-v1.mjs, packages/snapback-client/assets.test.mjs, packages/snapback-react/assets.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:ac2cd7a89de0a56f4add93da19c9e943c1fd38470c9d223c21fa404259320788
---

# Assets

> **Local target only.** `asset_lifecycle_v1`, the image pipeline
> (`asset_image_pipeline_v1` — GPS stripping, declared renditions,
> ThumbHash placeholders, dominant color), and video location
> finalization (`asset_video_finalization_v1` — MP4/QuickTime location
> atoms blanked in place, no transcoding) all ship on the local target
> with the filesystem store, TUS resumable transfer, and all three delivery
> profiles. Location-bearing media require an explicit
> media-specific location declaration either way: images use
> `image: { location }`, while videos use the distinct sibling
> `video: { location }`. A `"strip"` image or video intent admits and
> publishes here with location metadata provably absent from served
> bytes; `"retain"` preserves the source bytes identically and records
> the choice in lifecycle evidence. Hosted targets report the whole
> capability Missing.

Use an asset when your app stores a file: bytes live outside document rows
under a Snapback-owned lifecycle — upload, trusted finalization, typed
attachment, authorized delivery, deletion — and your tables hold only a
typed reference.

## Choose public performance or revocable reads

Choose delivery before the first upload. For an explicit
`defineAssetUpload`, omitting `delivery` uses `public-immutable` and emits a
source-attributed advisory asking you to declare the decision explicitly:

- **`public-immutable` is the performance default.** Immutable bytes live at
  unguessable, CDN-shaped URLs with no issuance round trip. Use it for public
  feed media, avatars, product images, and other bytes that never need access
  revoked. Delete stops discovery and future canonical access; it cannot
  retract an already cached public response.
- **`private-signed` authorizes per-user URL issuance.** Use it when reads must
  be authorized but a native renderer such as `<Image>` cannot attach bearer
  headers. Revocation stops new issuance; an issued URL remains usable until
  its TTL.
- **`private-strict` is bearer-only and issues no signed URLs.** Every byte
  request reauthorizes, so this is the tier for next-request revocation when
  the client can send the bearer header.

The bare `v.assetRef()` derived intent below is a separate convenience and
intentionally remains private-strict. For explicit intents, do not rely on the
omission advisory as policy review: spell the chosen tier in source.

## The minimal path: one field, one attach line

The simplest case needs no upload intent at all. A bare `v.assetRef()`
field derives a generated **default intent** — strict delivery, GPS
stripped, owner-only reads, JPEG/PNG up to 10 MB — with a stable identity
in the manifest like any explicit intent (LLP 0044 §Ceremony floor):

```js fragment reason="minimal-path schema shape; the authoring suite verifies derivation"
// schema.mjs — the whole backend declaration for an avatar:
profiles: defineTable({
  ownerId: v.principal(),
  avatar: v.optional(v.assetRef()),
}).sync(),
```

Upload under the derived reference (`defaults.<table>.<field>` in the
generated api), then attach in any ordinary mutation:

```js fragment reason="client flow over the derived reference; conformance covers the transport"
import { defaults } from './snapback/generated/api.mjs';
const task = client.assets.start({ upload: defaults.profiles.avatar, file });
// in a mutation handler:
//   { avatar: await ctx.assets.attach(args.assetId) }
```

Sized thumbnails need no declared variants either — request any width and
the ladder rendition materializes once, then serves immutably:

```js fragment reason="width selector URL shape; the Rust e2e verifies materialization"
assets.deliveryUrl(assetId, { variant: 'primary', width: 128 });
// → /assets/records/<id>/bytes/primary?width=128 (ladder-normalized)
```

That is the whole ceremony: **one schema field plus one attach line.**
Declare an explicit intent (below) when you need different bounds, media
types, sharing, variants, callbacks, or delivery profiles — the derived
default is the paved floor, not the ceiling. The prior unrestricted
bare-field semantics keep the explicit spelling
`v.assetRef({ upload: null })`.

## Declare the upload intent and the reference field

Upload authorization and policy are declared in source and compiled into a
generated reference. The intent fixes what a client can never widen:
accepted media types, byte bounds, delivery profile, and read-access
policy. The authorizer runs server-side and returns the owner.

```js source=packages/snapback-codegen/asset-upload-authoring.test.mjs
export const avatarUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  reads: ['profiles'],
  accept: { mediaTypes: ['application/pdf', 'application/octet-stream'], maxBytes: 10_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

In the Familiar TypeScript profile, import the same constructor from
`./generated/server` and export it from a top-level module. For example,
`media.ts` exporting `videoUpload` becomes canonical intent
`media.videoUpload` and generated reference `api.media.videoUpload`:

```ts source=tests/acceptance/fixtures/familiar-video-asset/media.ts
import { defineAssetUpload } from './generated/server';

export const videoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['video/mp4'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  video: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

That is only a naming projection. It uses this same intent policy, asset
client, finalizer, typed reference, and delivery path; it does not derive video
through the image-only bare-field default.

Reference assets from tables with `v.assetRef`. A restricted field
(`{ upload: 'avatarUpload' }`) admits only that intent's assets and is
writable from host plans; an unrestricted field is attachable only through
handler-side `ctx.assets.attach`. `assetSharing` declares who may read
assets referenced from a table's rows — without it, a reference confers no
read authority and the asset stays owner-only.

```js source=packages/snapback-codegen/asset-upload-authoring.test.mjs
export default defineSchema({
  profiles: defineTable({
    ownerId: v.principal(),
    avatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
    attachment: v.assetRef(),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .assetSharing({ kind: 'owner', field: 'ownerId' })
    .sync(),
});
```

`assetSharing` takes the closed union `{ kind: 'public-read' }`,
`{ kind: 'owner', field }`, or `{ kind: 'membership', membership, roles? }`.
Declaring `access: { read: 'via-references' }` on an intent whose fields
can land in tables without the declaration emits
`SNAPBACK_ASSET_SHARING_UNDECLARED` at generation, listing the tables.

## Upload and attach

**A dev/test server with no real client session can never complete a
multi-step upload over the ordinary client HTTP surface — for any intent auth
mode.** Every upload attempt records the non-optional owner principal returned
by `authorize`. Transfer, finalization, and attachment compare that owner with
the caller resolved from each request. An anonymous browser, React Native, or
Expo request has no caller principal, so the server refuses attempt creation
before running the authorizer or reserving state with
`SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE`. Setting `auth: 'public'` does
not make ownership checks anonymous — a public intent remains legitimate with
session custody — and `public-immutable` controls delivery rather than upload
authority. Passing a `userId` option to the task is not authentication.

There are exactly two paved local-development answers:

1. For an operator, fixture, or headless proof, use the admin-impersonated CLI
   lane: `snapback assets put ... --user <handle>`. This is not an in-app
   upload path.
2. For an interactive browser or native app, run the app in settled Sessions
   auth mode and give it an ordinary session. A trusted local process that
   already holds the ready-file/operator authority can mint one through the
   shipped wrapper:

```sh
snapback session mint --email expo-dev@example.com --ready-file .snapback/dev.ready.json
```

The command prints a `hostOpsResult` whose `data.token` is the ordinary
session bearer; it never prints the impersonation capability. In an app, keep
the command or equivalent `auth.mintSession` host operation behind a trusted
development broker that authenticates its caller and returns only that
caller's session. Never put the ready file, admin token, impersonation
capability, mailbox reader, or a generic mint-for-email endpoint in an Expo
bundle. Adopt the returned bearer with `createExternalSessionClient` before
preparing the React provider, as described in
[native auth](../auth/native-apps.md):

```tsx source=demos/tandem-expo-bakeoff/snapback/src/backend.tsx
      activeServerOrigin = brokerPayload.serverOrigin;
      const client = createExternalSessionClient(brokerPayload.serverOrigin, { bearerToken: brokerPayload.bearerToken });
      const binding = await client.prepareReactBinding({
        generatedManifest: { schema, functions, capabilityManifest },
      });
      return { status: 'ready' as const, client, provider: createSnapbackReactProvider(binding) };
```

That broker response carries the stack-selected public backend origin beside
the bearer. A dynamic development port must come from the target's ready
descriptor or this kind of stack-owned carrier, never an app-owned fixed
fallback.

Separately, for a deterministic fixture that composes password accounts,
application-owned profiles, and typed avatars without admin impersonation,
follow the [sessions fixture installer](../recipes/sessions-fixture-install.md).
It reports `{ ok, accounts, profiles }`; its matched-repeat branch signs in and
verifies the fixture source digest, then skips asset uploads and
application-data writes.

The client flow is: create an attempt (the generated reference plus the
declared byte length — deferred length refuses), transfer bytes over TUS
1.0.0 (`PATCH /assets/tus/{id}`, checksum every chunk), then finalize.
Finalization re-validates the admission witness, verifies length and
integrity, detects the content type from bytes, computes the SHA-256
canonical digest, dedups within the app, and publishes atomically. The
asset id is stable from creation — an expired attempt's authorized
successor keeps it.

Dedup is by canonical bytes, by design: uploading byte-identical files
twice in one app yields two assets sharing one stored blob (each still
consumes logical quota). Two consequences worth knowing when you batch:
a burst of *identical* test images collapses to one set of stored bytes
— make fixtures byte-distinct (a unique comment segment suffices) when
your test needs distinct blobs; and attachment does not wait for
publication — `ctx.assets.attach` admits a `pending` asset (the
optimistic path), so you can attach in the same flow that started the
upload and let live readiness catch up.

Attach the asset to a row in an ordinary mutation:

```js source=tests/acceptance/fixtures/asset-conformance/handlers.mjs
  async createPhoto(ctx, args) {
    return await ctx.db.insert('photos', {
      caption: String(args.caption ?? '').trim(),
      image: await ctx.assets.attach(args.assetId, { upload: 'photoUpload' }),
    });
  },
```

The `photos` table uses owner visibility, so the insert deliberately omits its
`ownerId`; Snapback stamps the authenticated principal at the commit boundary.

Enforcement lives at the storage commit boundary, not the helper: a raw
id-shaped string written into a `v.assetRef` field fails the commit with
`SNAPBACK_ASSET_REF_UNVERIFIED` on every write path, and the reverse
reference edge commits in the same changeset. Deleting an asset refuses
while typed references remain.

## Send one Expo ImagePicker image with an ordinary session

For a declared asset-bearing command, `SnapbackExpoProvider` registers the
native source adapter and binary transport once. Pass the real
`expo-image-picker` asset directly to the generated command; application code
does not call `expo/fetch`, start a raw upload, or carry an asset id between
steps:

```tsx source=demos/expo-golden-path-fixture/src/screens/chat-screen.tsx
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.86 });
    if (result.canceled || !result.assets[0]) {
      emitG3('picker-cancelled');
      return;
    }
    const picked = result.assets[0];
    emitG3('picker-image-selected', {
      source: 'photo-library-picker',
      uriScheme: picked.uri.slice(0, picked.uri.indexOf(':')).toLowerCase(),
      fileName: picked.fileName ?? null,
      mimeType: picked.mimeType ?? null,
      fileSize: picked.fileSize ?? null,
    });
    try {
      const body = proofEnabled ? G3_IMAGE_BODY : draft.trim() || undefined;
      const outcome = await observeCommand(
        conversation.commands.send({ ...(body ? { body } : {}), image: picked }),
        'picked-image',
      );
```

The adapter accepts picker-owned `content://`, `ph://`, and `file://` records.
It copies the live-process bytes into an immutable, slice-readable structural
source for the existing asset task. Expo's WinterCG fetch carries binary
checksum/TUS requests. On Expo 57 Android only, a picker-cache `file://` that
returns a genuine 404 through `expo/fetch` falls back to local
`expo-file-system` `File.bytes()`; the 404 text is never treated as image
bytes.

The command still uses the provider's already adopted ordinary session for
asset reservation, transfer, and mutation. Its task exposes `preparing`,
`transferring`, `committing`, and the truthful terminal outcomes described in
[application surfaces](../clients/surfaces.md). Render those phases and await
`task.done`; `committed` proves the ordinary mutation settled, while `failed`,
`ambiguous`, and `cancelled` must remain distinct. A post-finalize mutation
failure can retain residue and is not a rollback receipt.

This adapter is transient live-process custody. It does not prove background
upload, restart recovery, offline source custody or settlement, or attempt
grants. Use the raw `useSnapbackAssetUpload`/`assets.start` seam for workflows
that do not fit the one-optional-asset command grammar.

> **Coming from Convex/Supabase?** See
> [Upload and attach an Expo image under session custody](../recipes/coming-from-convex-and-supabase.md#expo-media-upload)
> for the worked translation of Supabase Storage or Convex
> `generateUploadUrl` — including why ownership is never anonymous even when
> attempt creation is public, and why GPS/EXIF stripping happens server-side
> at trusted finalization rather than client-side.

## Render the uploaded image in a plain `<Image>`

`useSnapbackAssetImage` (from `@expo/snapback-react`) is the renderer
ladder — local preview → ThumbHash placeholder → delivered rendition — and
its `src` goes straight into a plain `<img>` or React Native `<Image>`. Do
not build delivery URLs by hand and do not read package source to pick a
route:

```tsx source=demos/expo-golden-path-fixture/src/screens/chat-screen.tsx
function NativeAssetImage({ assetId, userId, onRendered }: Readonly<{
  assetId: string;
  userId: Id<'users'>;
  onRendered(src: string): void;
}>) {
  // The shared convenience component is intentionally DOM-only. Expo uses
  // the same canonical delivery ladder through its hook, then hands the URL
  // to React Native's image loader.
  const image = useSnapbackAssetImage({ assetId, maxWidth: 760, userId });
  if (!image.src) return <ActivityIndicator color={palette.accent} style={styles.imageLoader} />;
  return (
    <Image
      accessibilityLabel="Shared photo"
      onLoad={() => { if (image.phase === 'rendition' && image.src) onRendered(image.src); }}
      resizeMode="cover"
      source={{ uri: image.src }}
      style={[styles.image, image.aspectRatio ? { aspectRatio: image.aspectRatio } : null]}
      testID={`asset-image-${assetId}`}
    />
  );
```

<!-- since: 0.1.12 -->

Three facts make this the whole recipe — there is no workaround to learn:

- **`src` is the most-permissive delivery URL the asset's declared policy
  actually grants.** An intent with `delivery: { kind: 'public-immutable' }`
  gets the pasteable public rendition URL (`/assets/public/{id}/{variant}`);
  the strict route becomes `src` only when nothing more permissive exists.
  This is URL selection, not authorization — the server still decides every
  request under Deliver's rules below.
- **The rendition-publication race is held for you.** Optional renditions
  publish asynchronously after `ready`. While a public-immutable asset has
  no ready rendition yet, `delivery` reports `'pending'` and the hook keeps
  the preview/placeholder underlay instead of emitting a URL that would 404
  or render an empty image. The live record projection flips the hook to the
  rendition on its own — no `onError` retry loop.
- **`strictSrc` always carries the header-authorized strict route**, for
  consumers that fetch bytes with the authenticated client. On a
  sessions-mode server a plain `<img>`/`<Image>` cannot send the required
  `x-snapback-auth-client-protocol` header (see Deliver below), so when only
  strict delivery exists there the hook warns once per asset with
  `SNAPBACK_REACT_ASSET_STRICT_DELIVERY_SESSIONS` instead of leaving empty
  image bubbles undiagnosed. Declare public-immutable delivery on the
  upload intent when the image must render in a plain image tag.

## Run lifecycle callbacks

An explicit upload intent may name an ordinary mutation for `ready` and/or
`rejected`. The mutation must declare exactly `{ event: v.string(), assetId:
v.string(), facts: v.json() }`; the facts are safe lifecycle metadata, never
byte authority, staging keys, or delivery bearers.

```js source=tests/acceptance/fixtures/asset-conformance/functions.mjs
export const fileUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream', 'application/zip'], maxBytes: 100_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  on: { ready: 'recordAssetReady' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

```js source=tests/acceptance/fixtures/asset-conformance/functions.mjs
export const recordAssetReady = defineJsMutation({
  auth: 'authenticated',
  args: { event: v.string(), assetId: v.string(), facts: v.json() },
  source: 'handlers.mjs',
  exportName: 'recordAssetReady',
  writes: ['assetCallbackLog'],
});
```

The runner uses the stable mutation identity
`asset-cb:<asset>:<event>:<generation>`, so retrying the same work cannot
double the committed effect. A callback failure retries independently and
never degrades an already-ready asset.

Authority differs honestly by auth mode. Dev callbacks preserve the existing
asset-owner dev authority. Sessions callbacks run under one per-app, narrowly
granted service principal named `asset-callbacks`; Snapback never mints an
owner session or bearer. In sessions callbacks `ctx.auth.sessionId` is `null`,
`ctx.auth.kind` is `"agent"`, and `ctx.auth.actorKind` is
`"asset-callbacks"`, so application code and stored audit rows can distinguish
the scheduled actor from an interactive user. The callback still follows the
ordinary staged mutation, commit-time grant validation, authorization-event,
and receipt path. The asset work-completion receipt records the service actor
and exact grant, without carrying any bearer.

```js source=tests/acceptance/fixtures/asset-conformance/handlers.mjs
  async recordAssetReady(ctx, args) {
    return await ctx.db.insert('assetCallbackLog', {
      assetId: args.assetId,
      event: args.event,
      actorId: ctx.auth.userId,
      actorKind: ctx.auth.actorKind,
      provider: ctx.auth.provider,
      sessionId: ctx.auth.sessionId,
    });
  },
```

## Attach several assets to one row (multi-image posts)

There is no `v.array(v.assetRef(...))` — the withdrawal is a standing
author ruling (LLP 0044, 2026-07-31; scope reaffirmed 2026-08-09), and
the answer is **not** a column splay (`img1`…`img4` with four identical
declarations and four attach calls — the shape the Clique pilot fell
into). Multi-asset relationships take the bounded-children path: an
ordered child table whose rows each carry one `v.assetRef`, a typed
reference to the parent row, and a position field. The parent stays
cheap to read on its own; the children arrive through an ordinary
child-row query (or a relational query when the join fits); each child
attaches independently in the same mutation; and per-asset deletion is
a row delete instead of a column shuffle. Party Wall (below) is the
CI-validated composition — its `posts` table is exactly this shape with
a bound of one, and the same pattern extends to a declared 1–4 bound
with a `position` column and a uniqueness index on
`(parentId, position)`.

## Put typed photos directly in a live feed

`v.assetRef` is a first-class result-contract leaf. A query or live query may
return a table containing typed references directly; each reference is the
opaque asset-id string on the JSON wire. Do not duplicate it into a plain
string display column or split the reference into a side table merely to make
the row live-queryable.

Party Wall keeps the photo, membership-backed sharing policy, reverse-reference
edge, seed fixture, and live-feed row together:

```js source=demos/party-wall/snapback/schema.mjs
    posts: defineTable({
      eventId: v.id('events'),
      authorId: v.principal(),
      authorName: v.string(),
      caption: v.string(),
      photo: v.optional(v.assetRef({ upload: 'photoUpload' })),
    })
      .visibility({
        kind: 'membership',
        declaration: eventMembers,
        resourceField: 'eventId',
        roles: ['host', 'guest'],
      })
      .index('by_event', ['eventId'])
      .assetSharing({ kind: 'membership', membership: 'eventMembers' })
      .sync(),
```

## Browser apps: the paved React + Vite path

A browser app reaches every asset route through the first-party dev relay:
`@expo/snapback-vite` forwards the complete author-facing `/assets/*`
family — attempts, TUS transfer, records, strict/signed/public delivery —
under `/__snapback`, while continuing to refuse `/_snapback/*` system and
admin routes (`packages/snapback-vite/allowlist.mjs`). No app-owned Vite
proxy is needed, and a relative URL such as
`/__snapback/assets/public/<id>/display` works directly as an `<img src>`.

The relay is a Vite-loop convenience, not a CORS requirement. The dev
server's CORS lane admits loopback browser origins directly, and its
preflight allows the TUS request headers (`tus-resumable`,
`upload-offset`, `upload-length`, `upload-checksum`) and exposes the TUS
response family (including `upload-offset`) to page JavaScript. A browser
carrier with no Vite relay — Expo web is the common case — completes
picker → `useSnapbackAssetUpload` → typed attach against the dev server
origin with no app-authored proxy. Relative delivery URLs are the one
relay-only affordance; a direct cross-origin app uses absolute delivery
URLs against the dev server origin instead.

Two facts shape the browser flow:

- **Interactive uploads need sessions custody.** The ordinary browser and
  native HTTP carriers resolve as anonymous when no real session is present,
  so the reservation refusal described under Upload and attach applies to
  every intent auth mode. The `--user` lane under Operate below is the
  CLI/host-op path (admin authority for agents and fixtures), not a browser or
  Expo path.
- **The sign-in code arrives through a trusted-local seam.** The dev
  mailbox is admin- and impersonation-gated
  ([sessions guide](../auth/sessions-and-principals.md)), so a browser demo
  reads it through a small server-side dev middleware that holds both
  carriers and hands the page only the one-time code — neither credential
  enters the bundle, and the relay never forwards the mailbox route.

Explicit and derived upload references are typed members of the generated
api (`AssetUploadReference` in `api.d.ts`; derived defaults are typed per
table and field on `defaults`), so the generated reference is accepted
directly — no cast:

```tsx fragment reason="hook call shape; the demo app strict-typechecks it in the proof"
const upload = useSnapbackAssetUpload({ upload: api.photoUpload });
```

```js source=demos/file-drop/tests/acceptance/browser-relay.mjs
    const task = assets.start({
      upload: api.photoUpload,
      file,
      declaredFilename: 'snapback-balloons.png',
      declaredContentType: 'image/png',
    });
```

The complete path — relay health, the system-route refusal, mailbox
sessions sign-in, typed upload to `ready`, typed attachment, the live
gallery update over the relayed WebSocket, and public rendition delivery
through the relay — is CI-verified by
`demos/file-drop/tests/acceptance/browser-relay.mjs` (run from
`scripts/verify-local-proof`); Snapdrop
([`demos/file-drop`](repo:demos/file-drop/README.md)) is the runnable demo.

## Deliver

`GET /assets/records/{id}` serves authorized metadata. The recommended
performance tier, `delivery: { kind: 'public-immutable' }`, serves ready
renditions on `GET /assets/public/{id}/{variant}` with year-long immutable
cache headers and no issuance request. Omission on `defineAssetUpload` selects
that tier, with an advisory; explicit declaration is still the documented
spelling.

Choose `{ kind: 'private-signed' }` when issuance must authorize each user but
the renderer cannot send a bearer. `POST /assets/records/{id}/signed-url`
issues a bearer URL valid until its TTL. Public and signed serve lanes are
**pasteable**: the URL is the entire
authority, so a plain `<img src>`, a CDN pull, or a link pasted into an
email fetches with no Snapback headers — including on sessions-mode
servers, where every other asset route requires the auth-client
protocol offer. Signed issuance and strict delivery keep full
per-request authorization.

Choose `private-strict` for immediate revocation. The
`GET /assets/records/{id}/bytes/{variant}` route (variant `primary` in v1)
reauthorizes every request through the declared read-access policy, carries
`Cache-Control: private, no-store`, supports HTTP ranges, and never serves
active-content types inline. Revoking access or deleting the asset denies the
next request. Two sizing selectors ride the byte routes:
`best?maxWidth=N` picks the largest *declared* variant within the bound, and
`?width=N` ladder-normalizes to a bounded on-demand rendition (materialized
once under the image ceilings, then immutable; refused above the declared
2048 ceiling or without the image-finalization fact). Signed issuance accepts
`widthPx` the same way and signs the concrete ladder variant.

On a sessions-mode server, a plain signed-out request to a
`private-strict` byte URL that omits the auth-client protocol offer is
malformed before the server can decide whether it is unauthorized. It
therefore returns HTTP 400 with
`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED`, not 401 or 403; send
`x-snapback-auth-client-protocol: 1` (and the session bearer when signed in)
on strict delivery requests. Public-immutable and already-issued signed byte
URLs are the pasteable exception: plain HTTP clients need no protocol offer
and receive their ordinary 200/403/404 delivery semantics. This ordering is
the reviewed status posture in [LLP 0012](repo:llp/0012-headless-integration-contract.spec.md)
and the per-profile offer contract in
[LLP 0096](repo:llp/0096-auth-profiles-for-protocol-clients.spec.md).

<!-- since: 0.1.16 -->

### Issue and refresh a private signed URL

The signed-URL request body is the closed object `{ variant?, widthPx?,
ttlMs? }`. Omitting `variant` selects `primary`; an entirely absent or empty
body and `{}` are valid default requests. `widthPx` selects a bounded ladder
rendition and supersedes `variant`. `ttlMs` must be between 1 and the target's
declared `assets.signedUrlMaxTtlMs` (86,400,000 ms on the local target); when
omitted, the target's declared default applies (900,000 ms locally).

Request parsing never escapes as a framework 422. Malformed JSON, unknown
members, or a wrongly typed field refuse with
`SNAPBACK_ASSET_REQUEST_INVALID`, whose details name the field. An authorized
request for an undeclared variant refuses with
`SNAPBACK_ASSET_VARIANT_UNKNOWN`; `details.variants` enumerates `primary` plus
the intent's declared keys. Authorization runs before that enumeration. An
unauthorized caller gets the same ordinary `SNAPBACK_ASSET_FORBIDDEN` denial
for an existing or nonexistent asset, with no variant list or existence
oracle.

Use the framework-neutral asset client instead of posting to the route. Each
`assets.signedUrl(assetId, options)` call performs one pure issuance, adds the
current client-owned custody headers and auth-client protocol offer, resolves a relative
server response against the client's base URL, and returns
`{ url, expiresAt, variant }`. It deliberately does not cache.

For a non-React renderer, call `assets.issuedUrlStore(assetIdOrNull, options)` and
subscribe to its external-store contract. Equal asset/option/authority keys
share one issuance loop. Pass `null` or `undefined` when no asset is selected;
the store returns the stable inert `empty` state. An empty string is invalid
and the error points callers to the nullable spelling. Render its six states
this way:

| State | URL | Rendering meaning |
| --- | --- | --- |
| `empty` | `null` | No asset is selected; render nothing. Subscription and `refresh()` perform no issuance or refresh work. |
| `issuing` | `null` | Initial or post-expiry issuance is in flight; render a loading placeholder. |
| `ready` | valid | Render the URL. A transient refresh failure may leave this state and attach a diagnostic while the held URL is still valid. |
| `refreshing` | valid | Keep rendering the held URL while replacement issuance is in flight. |
| `unavailable` | `null` | No valid URL is held after a transport or server failure; render the offline/error fallback while bounded retry continues. |
| `denied` | `null` | A structured authorization refusal blanked the URL and stopped timer retry; render the access-denied state. |

`store.refresh()` is the explicit exit from `denied` after the application
expects authority to have returned. Logout or authority replacement disposes
the old entry synchronously, and a final unsubscribe fences in-flight work.

React and Expo use `useSnapbackAssetUrl`, which projects that same controller;
it does not add another cache or timer. Its first parameter is
`string | null | undefined`, so optional components call the hook
unconditionally and render nothing for `empty`. The hook returns the six-state
snapshot plus a stable `refresh()`:

```ts source=packages/snapback-react/asset-upload-types.fixture.ts
const issuedUrl: AssetUrlState = useSnapbackAssetUrl('asset-1', {
  variant: 'chat',
  widthPx: 640,
  ttlMs: 30_000,
});
issuedUrl.url?.toUpperCase();
const issuedDiagnostic: AssetDiagnostic | null = issuedUrl.diagnostic;
const refreshed: Promise<void> = issuedUrl.refresh();
void issuedDiagnostic;
void refreshed;
```

TTL refresh is platform-owned. Applications should not hand-roll issuance
fetches, custody headers, URL caches, expiry timers, or one cache per
component; those were pilot workarounds and are now replaced by
`signedUrl`, `issuedUrlStore`, and `useSnapbackAssetUrl`.

### Upload when you only need the ready asset id

Use `assets.upload(uploadRef, source, { args? })` when the caller needs only a
ready asset id. It accepts the same normalized inputs as the platform
adapters: `File`, `Blob`, or picker-shaped
`{ uri, mimeType?, fileName? }`. It never retries and exposes no progress;
use `assets.start()` when the UI needs pause, resume, cancel, retry, preview,
or progress.

The raw task contract is frozen: `task.done` resolves at the first terminal
status — `ready | rejected | cancelled | failed`. `ready` is the only success.
`assets.upload()` therefore resolves with `assetId` only for `ready` and
rejects every other row with an error carrying `terminalStatus` and the
structured `diagnostic`. The package fixture pins both branches:

```js source=packages/snapback-client/assets.test.mjs
    if (status === 'ready') {
      assert.equal(
        await assets.upload(AVATAR_UPLOAD_REF, new Blob(['x'])),
        'asset_upload_helper',
      );
    } else {
      await assert.rejects(
        assets.upload(AVATAR_UPLOAD_REF, new Blob(['x'])),
        (error) => error instanceof Error
          && error.status === status
          && error.terminalStatus === status
          && error.diagnostic.code === 'SNAPBACK_ASSET_TEST_TRANSIENT'
          && error.diagnostic.details.row === status,
      );
    }
```

The settled task snapshot and its `done` value never mutate. An eligible
`retry()` returns a successor task for the same asset id with an independent
generation; the predecessor stays frozen. `failed` and `cancelled` are
eligible only while the underlying asset remains pending, while `ready` and
`rejected` are never eligible. Any ineligible retry creates no successor and
refuses with `SNAPBACK_ASSET_RETRY_INELIGIBLE`.

### Grant and revoke per-recipient access

The paved view-once recipe uses first-class asset grants. Opt the upload intent
in explicitly, keep its ordinary policy owner-only so the grant is the
recipient's sole authority path, and choose a revocable delivery profile:

For the complete send → open → close/delete → delivery composition, use the
[view-once media recipe](../recipes/view-once-media.md). This section is the
operation reference; the recipe carries the application-owned consumption and
live-edge bookkeeping that make "view once" a product behavior.

```js fragment reason="view-once intent showing the grants opt-in and sole-authority constraint"
export const messageImageUpload = defineAssetUpload({
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 10_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  grants: true,
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

At send time the asset owner mints one pending grant per recipient in the same
mutation as the message write. Pending grants confer no read access:

```js fragment reason="application-specific message writes surround this grant operation"
const { grantId } = await ctx.assets.grant(assetId, recipientPrincipal, {
  state: 'pending',
});
```

The named recipient activates that grant in its authorized `open()` mutation,
and either the recipient or asset owner removes it on close or deletion:

```js fragment reason="application-specific open/consumption checks surround these transitions"
await ctx.assets.activate(grantId);
await ctx.assets.revoke(grantId);
```

All three transitions commit atomically with the mutation's app-row writes.
Only the asset owner can mint; only the named principal can activate a pending
grant; the owner or named principal can revoke. Revoke removes the record, so a
later operation on that `grantId` refuses as unknown. Re-running the same
mutation `clientKey` replays its original result instead of minting a second
edge. `grants: true` is captured when the asset is admitted: adding it in a
later deploy does not make older assets grantable.

Two retention and delivery constraints are load-bearing:

- A grant must be the recipient's **sole authority path**. Public delivery or
  a recipient-visible `via-references` edge bypasses pending and revoke.
- An active grant protects the asset from reference GC; a pending grant does
  not. Keep a typed reverse reference, such as the message row's `assetRef`,
  alive for the entire pending window.

With `private-signed`, revoke stops new issuance but an already-issued bearer
URL remains usable until its TTL. With `private-strict`, revoke denies the next
governed request. Neither profile retracts bytes already copied, so view-once
media must not enter a durable application cache.

Each app may hold at most 1,024 pending plus active asset grants. The ceiling is
checked atomically when the owner mints; revoke releases capacity atomically.

#### Portable fallback: app-owned grant rows

When an application needs filterable grant metadata or must remain portable to
a target without first-class grant operations, compose ordinary app rows with
`via-references` authorization. Put the typed reference in a dedicated row
whose owner-principal sharing field is the current viewer:

```js fragment reason="pilot-proven row composition; no in-repo fixture contains the complete app-specific authorization checks"
mediaGrants: defineTable({
  messageId: v.id('messages'),
  targetPrincipal: v.principal(),
  viewerPrincipal: v.principal(),
  asset: v.assetRef({ upload: 'messageImageUpload' }),
  state: v.string(), // 'pending' | 'active'
})
  .index('by_message_target', ['messageId', 'targetPrincipal'], { unique: true })
  .assetSharing({ kind: 'owner', field: 'viewerPrincipal' })
  .sync(),
```

At send time, the sender calls `ctx.assets.attach` and inserts one grant row
per recipient. Set `targetPrincipal` to the recipient, but set
`viewerPrincipal` to the sender and `state` to `pending`; the sender must
pre-mint because `ctx.assets.attach` admits the asset owner, not the future
viewer. The row's typed `asset` field is also the reverse reference that keeps
the asset protected through this pending window.

In the recipient's authorized `open()` mutation, verify the message and
recipient, reject an already-consumed view in an app-owned consumption row,
then patch that recipient's grant row atomically:

```js fragment reason="application-specific authorization and consumption checks surround this core transfer-at-open operation"
await ctx.db.patch('mediaGrants', grant._id, {
  viewerPrincipal: ctx.auth.userId,
  state: 'active',
});
```

The viewer can now issue or fetch under the intent's delivery profile. On
`close()`, delete that recipient's grant row; delete-for-everyone deletes all
rows for the message. Remove any remaining typed references before deleting
the asset itself. Never recreate a consumed row: the separate consumption
record is what makes a second `open()` refuse rather than minting authority
again.

Two constraints are load-bearing:

- The grant row must be the recipient's **sole authority path**. A public
  profile, another recipient-visible `assetSharing` table, or another
  `via-references` edge would bypass the pending/close transition. A message
  row may retain a typed asset reference for storage integrity, but that table
  must not declare asset sharing that admits the recipient.
- A typed reverse reference must remain alive for the entire pending window.
  The pre-minted grant row supplies one above; do not replace it with a plain
  asset-id string, or reference GC can reclaim the asset before `open()`.

The same signed-versus-strict delivery limits apply to this fallback. Prefer
first-class grant operations unless the extra app-row shape is itself part of
the product model.

## Images

Declare a location policy on every image intent — omission refuses at
generation, and `strip` (the conventional choice) removes GPS metadata
from the canonical bytes before they are digested or stored, applying the
EXIF orientation and keeping only safe facts (dimensions, captured-at).
Declared variants render off the canonical bytes; mark one `required` and
it gates `ready`, produced atomically with the primary.

```js source=packages/snapback-codegen/asset-upload-authoring.test.mjs
export const photoUpload = defineAssetUpload({
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 1_000_000 },
  // Public display media follows the 2026-08-16 performance-default ruling.
  delivery: { kind: 'public-immutable' },
  image: { location: 'strip', variants: [{ key: 'thumb', width: 128 }] },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

Every published image carries typed media facts on its primary rendition:
`width`/`height`, `placeholder: { algo: "thumbhash.v1", value }` (render
it client-side for instant previews), `dominantColor`, `locationPolicy`,
and `capturedAt` where the source declared one. Deliver a specific variant
by key, or let the server pick the best fit:

```text
GET /assets/records/{id}/bytes/thumb
GET /assets/records/{id}/bytes/best?maxWidth=480
```

Processing is bounded and adversarial-input safe: decoded pixels,
dimensions, decompression ratio, metadata size, step time, and output
bytes are all Enforced ceilings in the manifest's `assets.image` block,
and a hostile file (decompression bomb, dimension lie, truncated stream)
rejects the asset with a structured `SNAPBACK_ASSET_IMAGE_*` diagnostic.
Retain-declared intents (`location: 'retain'`) keep metadata intact and
record that policy in the asset's lifecycle evidence.

## Video

Video location policy is a sibling declaration, not an alias through the
image block. Use `video.location` for accepted video types; an intent that
accepts both location-bearing images and videos declares both blocks. On the
local target, `strip` blanks MP4/QuickTime location atoms in place without
transcoding, while `retain` publishes the received bytes unchanged.

```js source=packages/snapback-codegen/asset-upload-authoring.test.mjs
export const clipUpload = defineAssetUpload({
  accept: { mediaTypes: ['video/mp4'], maxBytes: 100_000_000 },
  // Public display media follows the 2026-08-16 performance-default ruling.
  delivery: { kind: 'public-immutable' },
  video: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

## SVG: why the image intent refuses it, and the safe adapter

SVG is not an image to the asset pipeline — it is a document that can carry
script. Two deliberate mechanisms mean **you cannot simply add
`image/svg+xml` to an image intent's `accept.mediaTypes`**:

- **Trusted detection is byte-based and has no SVG entry.** Finalization
  names the content type from the bytes, not from the client's declaration.
  There is no SVG magic number, so an SVG body detects as
  `application/octet-stream`. Finalization then compares the *detected* type
  against the intent's accept list and fails the attempt with
  `SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED` — the declaration was admitted at
  attempt-create and refused at the trusted boundary, which is confusing
  until you know why.
- **Delivery force-attaches active content.** `image/svg+xml` (with
  `text/html`, the XML types, JavaScript, and unrecognized
  `application/octet-stream`) is on the never-inline list under every
  delivery profile, so a stored SVG cannot become a same-origin script lane.

So the platform's answer for SVG is "opaque bytes, never rendered inline by
us". If your app genuinely needs SVG — a frozen source contract, an existing
corpus — the paved shape is an **application-owned adapter** in four steps.
The Zerobugs control implements it end to end (`C-ASSET` in its
[PLAN](repo:demos/zerobugs/control/PLAN.md)).

### 1. Validate exactly, server-side, before any upload starts

Your code — not the platform — is now the type authority, so the check must
be exact and it must run somewhere the client cannot reach. Match the
declared MIME against the declared length **and** against the actual bytes:

```ts source=demos/zerobugs/control/composition/server.mts
function mimeMatches(contentType: string, bytes: Uint8Array): boolean {
  const ascii = new TextDecoder('utf-8', {fatal: false}).decode(bytes.slice(0, 512));
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v);
  if (contentType === 'image/gif') return ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');
  if (contentType === 'image/webp') return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
  if (contentType === 'image/svg+xml') return /^(?:\uFEFF|\s)*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/iu.test(ascii);
  return false;
}
```

A signature test is a *shape* test, not a safety proof — an SVG that starts
with `<svg` may still contain script. That is why the delivery step below is
non-optional: the adapter's safety comes from the sandbox, and the signature
check only keeps non-SVG bytes out of the SVG lane.

### 2. Route SVG to a separately named opaque intent

Declare two intents, not one widened intent. The ordinary image intent keeps
the four detectable image types and the image pipeline; SVG gets its own
intent that accepts `application/octet-stream` and declares **no `image`
block** — no renditions, no ThumbHash, no width ladder:

```js source=demos/zerobugs/control/snapback/functions.mjs
// Native trusted MIME detection deliberately classifies active SVG as opaque.
// The gateway admits this intent only after its own exact SVG signature/type/
// length policy and serves the typed alias with the source MIME.
export const zerobugsSvgUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  reads: ['identityBinding', 'user'],
  accept: {mediaTypes: ['application/octet-stream'], maxBytes: 10 * 1024 * 1024},
  delivery: {kind: 'public-immutable'},
  access: {read: 'via-references'},
  authorize: async (ctx) => {
    await requireSourceUser(ctx);
    return {owner: ctx.auth.userId};
  },
});
```

Upload the bytes under that intent with an octet-stream declaration, so the
declared type and the detected type agree:

```ts source=demos/zerobugs/control/composition/server.mts
            const svgOpaque = contentType === 'image/svg+xml';
            const upload = createAssetClient(session.client).start({
              upload: (svgOpaque ? api.zerobugsSvgUpload : api.zerobugsImageUpload) as never,
              file: new Blob([bytes], {type: svgOpaque ? 'application/octet-stream' : contentType}),
              declaredFilename: `${capability.key}.${extensionFor(contentType)}`,
              declaredContentType: svgOpaque ? 'application/octet-stream' : contentType,
            });
```

Two named intents is the point: an audit can see which assets went through
the trusted image detector and which went through your validator, and the
`authorize` boundary stays per-intent.

### 3. Attach through the typed `v.assetRef`, re-checking the pairing

The row keeps the real source MIME beside the typed reference. Because the
field must accept both intents, spell it `v.assetRef({ upload: null })` — the
explicit unrestricted, handler-attach-only form — and re-assert MIME↔intent
inside the attaching mutation so a caller cannot pair an SVG content type
with the trusted image intent:

```js source=demos/zerobugs/control/snapback/functions.mjs
    if (
      (args.contentType === 'image/svg+xml' && args.uploadKind !== 'svg-opaque')
      || (args.contentType !== 'image/svg+xml' && args.uploadKind !== 'image')
    ) throw new Error('asset upload intent was refused');
```

```js source=demos/zerobugs/control/snapback/functions.mjs
    const asset = args.uploadKind === 'svg-opaque'
      ? await ctx.assets.attach(args.assetID, {upload: 'zerobugsSvgUpload'})
      : await ctx.assets.attach(args.assetID, {upload: 'zerobugsImageUpload'});
```

### 4. Serve through your own alias with `nosniff` and a sandbox CSP

The native byte routes will not serve SVG inline, so the app owns a delivery
alias that reads the native bytes and re-labels them with the stored source
MIME. That re-labelling is what makes the sandbox headers mandatory — and
the CSP is applied only to the SVG type, not to every asset:

```ts source=demos/zerobugs/control/composition/server.mts
            return new Response(native.body, {
              status: 200,
              headers: {
                'content-type': String(row.contentType),
                ...(native.headers.get('content-length')
                  ? {'content-length': native.headers.get('content-length') as string}
                  : {}),
                'cache-control': 'public, max-age=31536000, immutable',
                'access-control-allow-origin': '*',
                'cross-origin-resource-policy': 'cross-origin',
                'x-content-type-options': 'nosniff',
                ...(row.contentType === 'image/svg+xml'
                  ? {'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:"}
                  : {}),
              },
            });
```

`sandbox` with `default-src 'none'` is what neutralizes script inside the
document; `nosniff` stops a browser re-deciding the type. Serve the alias
from an origin that holds nothing worth stealing if the sandbox is ever
bypassed.

**What this recipe is and is not.** It is an application adapter that keeps
SVG inside the typed asset lifecycle (owned uploads, typed references,
reference GC, deletion refusal while referenced). It is **not** native SVG
support: there is no image pipeline for these assets — no declared variants,
no `width=` ladder, no ThumbHash placeholder, no dimension or dominant-color
facts — and no sanitizer. You own the validator, the alias route, and its
headers. The control's implementation is witnessed by its own
`test:lane5:live` route check and the retained ZB4/ZB7 receipts under
[`demos/zerobugs/evidence`](repo:demos/zerobugs/evidence), not by repository
CI. If you do not have a hard requirement, rasterize to PNG at the edge and
use the ordinary image intent.

## Operate

The CLI drives the same lifecycle for agents and fixtures (dev/test
targets, admin authority):

```sh
snapback assets put photo.pdf --upload avatarUpload --user user_a --url http://127.0.0.1:4287
snapback assets inspect <asset-id> --url http://127.0.0.1:4287
snapback assets list --state ready --url http://127.0.0.1:4287
snapback assets retry <asset-id> --url http://127.0.0.1:4287
snapback assets gc-sweep --now-ms 1785484800000 --url http://127.0.0.1:4287
snapback assets delete <asset-id> --user user_a --url http://127.0.0.1:4287
```

Deletion is two truths, both deliberate: bytes die at the origin
immediately (delivery 404s on the next request), while the metadata row
lingers as a declared `availability: "deleted"` tombstone through its
retention window (default seven days — a GC sweep will not purge it
early). The tombstone is what lets clients and reverse-reference repair
observe *that* something was deleted rather than never existing; do not
read a 200 metadata response with `deleted` availability as a failed
delete.

`put` uploads chunk-checksummed and finalizes end-to-end verified.
`inspect` prints the lifecycle — availability, receipts, quota, reference
edges, runner claims — and never byte samples, staging keys, or bearer
URLs. `retry` re-drives pending publication/ledger work under the
generation fence; it never reopens a terminal attempt. `gc-sweep` requires
an explicit portable Unix-millisecond clock and runs the same attempt,
pending-asset, reference, tombstone, blob, retained-intent-artifact, and
publication cleanup as the background runner. Its report echoes `nowMs`;
each semantic reclamation keeps the ordinary asset lifecycle receipt.

Background maintenance (finalization re-drives, GC sweeps, publication
reconciliation) runs on the asset runner; set
`SNAPBACK_ASSET_RUNNER_DISABLED=1` to drive it deterministically in tests,
then invoke `asset.gcSweep` (or the CLI command above) with the suite's
chosen clock. Host operations do not keep a response replay ledger; the sweep
itself is idempotent, and each reclaimed asset receives its canonical
`reference-gc` lifecycle receipt exactly once.

## Export the asset component of a logical backup

The local target advertises `assets.export.cutExport: true`. Capture its asset
component into an absolute, empty-or-absent directory:

```sh
snapback assets export-cut \
  --dir "$PWD/backups/assets-2026-08-04" \
  --ready-file .snapback/server-ready.json
```

The command opens one read transaction and pins its storage head as
`cutVersion`. That transaction captures all `ready` asset records and their
`ready` renditions, deleted-asset tombstones, each referenced immutable blob
exactly once, and the settled quota snapshot. It deliberately excludes
in-flight attempts, pending/rejected assets, staging bytes, and reverse
reference edges; the edges derive from application rows and belong to the
app-data export component.

After the transaction closes, Snapback copies the immutable blobs under
`blobs/sha256/`, verifies each copy against its recorded SHA-256 and length,
then writes `asset-cut.manifest.json` last. An unreadable or mismatched blob
fails the command instead of producing an admissible partial cut. The failed
directory may contain copied objects but no valid complete manifest; retry
into a new empty directory.

This is a **logical export component**, not a full application or SQLite
backup. The capability manifest still lists `asset-byte-backup` as Missing,
and a portable application export must coordinate the separately owned
app-data component.

### Validate the complete cut before restore

`importValidation: true` is the refuse-partial half of the shipped surface.
Without `--apply`, `import-cut` only validates the tagged manifest digest and
every declared blob object:

```sh
snapback assets import-cut \
  --dir "$PWD/backups/assets-2026-08-04" \
  --ready-file .snapback/server-ready.json
```

A missing object, changed byte length, digest mismatch, or tampered manifest
returns a structured refusal before any asset row lands. Restore application
is a separate experimental capability (`importApply: "experimental"`):
`--apply` requires the server-side `SNAPBACK_ASSET_IMPORT_EXPERIMENTAL=1`
acknowledgment and an empty asset state. It is not the paved full-app restore
path.

### Invalidate every outstanding signed URL

Rotate the instance signing key when every already-issued `private-signed`
URL must stop validating immediately:

```sh
snapback assets rotate-signing-key --ready-file .snapback/server-ready.json
```

Rotation retires every active signing key, mints a fresh one, and emits an
instance-scoped receipt without returning key ids or key material. New signed
URL issuance works under the fresh key. This is deliberately a wide operator
action; use ordinary authorization changes when the intent is to revoke one
principal rather than every outstanding signed bearer URL.

The local proof drives these exact native CLI commands against a real server,
checks the pinned manifest, observes an issued URL fail after rotation, and
proves incomplete-cut validation exits non-zero with the structured refusal:

```js source=tests/acceptance/asset-conformance-v1.mjs
  const rotation = await runAssetsCli(sessionsServer, 'rotate-signing-key');
  assert.equal(rotation.exitCode, 0);
  assert.equal(rotation.envelope.ok, true);
  assert.equal(rotation.envelope.data.rotated, true);
  const signedAfterRotation = await fetch(`${sessionsServer.baseUrl}${issuanceBody.url}`);
  assert.equal(signedAfterRotation.status, 403, 'rotation invalidates the outstanding signed URL');

  const exportDir = join(scratch, 'asset-cut-export');
  const exported = await runAssetsCli(sessionsServer, 'export-cut', '--dir', exportDir);
  assert.equal(exported.exitCode, 0);
  assert.equal(exported.envelope.ok, true);
  assert.equal(exported.envelope.data.cut.formatVersion, 'snapback.asset-cut.v1');
  assert.ok(exported.envelope.data.cut.assetCount > 0);
  assert.ok(exported.envelope.data.cut.blobCount > 0);
  const cutManifest = await readJson(join(exportDir, 'asset-cut.manifest.json'));
  assert.equal(cutManifest.cutVersion, exported.envelope.data.cut.cutVersion);
  assert.equal(cutManifest.manifestDigest, exported.envelope.data.cut.manifestDigest);

  await rm(join(exportDir, cutManifest.blobs[0].objectPath));
  const incomplete = await runAssetsCli(sessionsServer, 'import-cut', '--dir', exportDir);
  assert.notEqual(incomplete.exitCode, 0);
  assert.equal(incomplete.envelope.ok, false);
  assert.equal(incomplete.envelope.diagnostics[0].code, 'SNAPBACK_ASSET_IMPORT_INCOMPLETE');
  checks.nativeCliCutExportAndRotation = true;
```

## Evidence and limits

The acceptance traceability map is
[`tests/acceptance/asset-lifecycle-v1-evidence.md`](../../tests/acceptance/asset-lifecycle-v1-evidence.md);
the manifest facts (stores, profiles, integrity grades, enforced limits,
and the explicit Missing nonclaims — byte backup, custom read
authorizers, deferred length) live in
`schemas/capability.manifest.local-dev-sqlite-ibex.json` under `assets`.
Live no-polling readiness ships as the reserved `_snapback.assetRecord`
projection (subscribe via the asset client's `watch`/`watchStore`), and
the framework-neutral upload task comes from the `@expo/snapback-client/assets`
entry: `createAssetClient(client)` wraps your `SnapbackClient`, and
`createAssetClient(client).start({ upload, args, file })` is the task
(there is no `client.assets` accessor on `SnapbackClient` itself); the
React/Expo hook and renderer are
`useSnapbackAssetUpload` / `useSnapbackAssetImage` in
`@expo/snapback-react`, and the real-server JS conformance vectors are
`tests/acceptance/asset-conformance-v1.mjs`.

The declared limits are preflightable, not discover-by-failure: the
attempt-create response's `transfer.maxChunkBytes` carries the chunk
ceiling (the packaged client narrows its chunk size to it
automatically), every TUS response advertises `Tus-Version`,
`Tus-Extension`, `Tus-Checksum-Algorithm`, and `Snapback-Max-Chunk-Bytes`
on the wire, and the manifest's `assets` block declares the byte, quota,
TTL, and count ceilings a suite can read before sending a byte. Ready
records expose the canonical `digest`, `digestAlgorithm`, and
`integrityGrade` as ordinary queryable facts on the record view and
`snapback assets inspect`.

## Anti-patterns

- **Do not post to `/signed-url` or cache bearer URLs by hand.** Use
  [`assets.signedUrl`, `issuedUrlStore`, or `useSnapbackAssetUrl`](#issue-and-refresh-a-private-signed-url)
  so custody, absolute URLs, authority blanking, and TTL refresh keep one
  owner.
- **Do not treat `task.done` resolution as upload success without checking its
  terminal row.** Use [`assets.upload()`](#upload-when-you-only-need-the-ready-asset-id)
  for settle-or-reject behavior, or branch on all four raw terminal statuses.
- **Do not add a second recipient-readable reference to view-once media.** Keep
  either the [first-class grant edge](#grant-and-revoke-per-recipient-access)
  from the [view-once media recipe](../recipes/view-once-media.md), or the
  [fallback app-owned grant row](#portable-fallback-app-owned-grant-rows), as
  the recipient's sole authority path. Retain an owner-only typed reverse
  reference through the pending window so reference GC cannot reclaim the
  asset before open or cancellation.

---

<!-- snapback-guide-source: guide/backend/media-happy-paths.md -->
---
title: Media happy paths
id: backend.media-happy-paths
order: 10
audience: agent-first
capabilities: [assets.media-field.v1, assets.media-collection.v1, assets.media-command.v1]
authorities: [llp/0239-asset-collections-and-media-field.rfc.md, llp/0244-media-ref-projection.spec.md, llp/0044-asset-storage-pipeline.rfc.md, llp/0210-asset-upload-dx-closure.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-codegen/app-descriptor.mjs, crates/snapback-kernel/src/storage.rs, packages/snapback-client/assets.mjs, packages/snapback-client/commands.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-react/implementation.mjs]
examples: [tests/acceptance/fixtures/media-profile/snapback/schema.mjs, tests/acceptance/fixtures/media-profile/snapback/functions.mjs, packages/snapback-codegen/media-field-authoring.test.mjs, packages/snapback-codegen/media-collection-authoring.test.mjs, packages/snapback-codegen/media-command-authoring.test.mjs, packages/snapback-client/assets.test.mjs, packages/snapback-client/commands.test.mjs, packages/snapback-react/assets.test.mjs, packages/snapback-react/commands.test.mjs, packages/snapback-react/asset-upload-types.fixture.ts, packages/snapback-react/media-collection-types.fixture.ts]
status: current
targets: [local]
maturity: shipped
since: 0.1.21
reviewed: 2026-08-16
reviewed-authorities-digest: sha256:17c83fe601e56488b64e3952744f80e95cc17c899099ba8f0729ea401da5efac
---

# Media happy paths

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

This page is the four-path map from LLP 0239. Paths 1 and 3 are in the current
published closure. Paths 2 and 4 are implemented and tested in contributor
source, with their publication boundary marked below.

Choose the upload intent's delivery tier before following a path.
`public-immutable` is the performance default: immutable bytes at unguessable,
CDN-shaped URLs with no issuance round trip. Use `private-signed` for
authorized per-user issuance when native renderers cannot attach bearers, or
`private-strict` for bearer-only reads with no signed URLs and next-request
revocation. Omitting `delivery` from `defineAssetUpload` selects
`public-immutable` but emits an advisory; the examples stay explicit. A
recipient-grant or revocation path must keep a private tier because public
delivery would bypass the grant.

## Path 1 — store one optional profile image

Declare `v.optional(v.media(...))` at the top level of a table. Name the upload
intent, a policy-generation identity, and the closed coarse kinds the field
admits. This fixture contains the complete optional-profile-image table:

```js source=tests/acceptance/fixtures/media-profile/snapback/schema.mjs
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

// @ref LLP 0239#d1-vmedia-is-the-zero-or-one-application-field
// @ref LLP 0244#d3-vmedia-attachment-is-finalized-only-in-v1
export const profiles = defineTable({
  ownerId: v.principal(),
  displayName: v.string(),
  image: v.optional(v.media({
    intent: 'profileImageUpload',
    policy: 'profile-image.v1',
    kinds: ['image'],
    delivery: 'primary',
    variants: ['primary'],
  })),
})
  .visibility({ kind: 'public-read' })
  .assetSharing({ kind: 'owner', field: 'ownerId' })
  .sync();
```

The named upload intent remains an ordinary asset upload declaration:

```js source=tests/acceptance/fixtures/media-profile/snapback/functions.mjs
export const profileImageUpload = defineAssetUpload({
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png'], maxBytes: 8_000_000 },
  // Public profile display follows the 2026-08-16 performance-default ruling.
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

Await finalization before attaching its asset id. Writes carry the opaque id
string; a client-supplied `{ assetId, kind }` object is refused because `kind`
is output-only server authority. Query and LiveQuery results project a non-null
field as exact `{ assetId, kind }` inside the application row's pinned storage
snapshot. Optional null stays null. Media-bearing LiveQueries deliberately do
not receive the current single-table RQS resume class.

For a plain opaque reference with the older pending-attachment behavior, use
[`v.optional(v.assetRef(...))`](./assets.md#declare-the-upload-intent-and-the-reference-field).
It is a different contract and does not return `MediaRef`.

## Path 2 — attach a bounded media collection

Declare a finite collection before accepting files: `maxItems` is required and
must be 1–32, ordering is `manual` or `created`, and every admitted item must
already be finalized under the named intent with one of the declared coarse
kinds. The local target can upload and deliver original video bytes, but this
does not claim portable playback or `media.video.playable.v1`.

This fixture reuses `sharedMediaUpload` in Path 4, so that intent deliberately
keeps `private-strict`: recipient grants need revocable reads. A feed-only app
should use a dedicated `public-immutable` intent for this collection.

The framework generates the child relation and its list, append, replace,
remove, and reorder operations. Do not add an attachment table, JSON array, or
`image1`…`imageN` fields. This post declaration caps the relation at four and
the generated command binds one-to-four ordered uploads to its append:

```js source=tests/acceptance/fixtures/media-profile/snapback/functions.mjs
// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation
export const postMedia = assetCollection({
  ownerTable: 'posts',
  intent: 'sharedMediaUpload',
  maxItems: 4,
  order: 'manual',
  kinds: ['image', 'video'],
  grants: 'none',
});

// @ref LLP 0264#d3-owner-inserts-are-host-stamped — the handler omits the
// installed owner field and closes its otherwise opaque generic-write ceiling.
export const createPostMutation = defineJsMutation({
  auth: 'authenticated',
  args: {
    body: v.string(),
    assetIds: v.array(v.assetRef({ upload: 'sharedMediaUpload' }), { maxItems: 4 }),
  },
  writes: ['posts'],
  opaqueWritePosture: 'conservative-v1',
  declaredTableCeiling: ['posts'],
  result: results.value(v.object({ _id: v.id('posts') })),
  handler: async (ctx, args) => ({
    _id: await ctx.db.insert('posts', { body: args.body }),
  }),
});

// @ref LLP 0239#d3-one-mediacommand-owns-multi-upload-plus-atomic-commit
export const createPost = defineMediaCommand({
  media: {
    input: 'media',
    intent: 'sharedMediaUpload',
    minItems: 1,
    maxItems: 4,
    kinds: ['image', 'video'],
  },
  mutation: createPostMutation,
  mapping: {
    passthrough: ['body'],
    assetsToMutationArg: 'assetIds',
    parentResultPath: '_id',
    collection: 'postMedia',
    operation: 'append',
  },
  sharing: assetSharing.none(),
});
```

Read the generated `postMediaList` LiveQuery and pass its ordered `children`
directly to the collection hook. The hook shares the issued-URL owner, keeps
each `itemId` stable, and isolates a denial or transient failure to one child:

```ts source=packages/snapback-react/media-collection-types.fixture.ts
export function MessageMedia({
  items,
}: {
  items: readonly MediaCollectionItem<'image' | 'video'>[];
}) {
  const projected = useSnapbackMediaCollection(items);
  return projected.map(({ itemId, state, refresh }) => {
    if (state.status === 'ready' || state.status === 'refreshing') {
      return { key: itemId, kind: state.media.kind, src: state.url };
    }
    if (state.status === 'unavailable') {
      return { key: itemId, retry: refresh };
    }
    return { key: itemId, hidden: true };
  });
}
```

An empty collection is synchronously `[]` and issues no request. `denied`
blanks only the affected URL; `unavailable` exposes its own retry; authorized
siblings remain visible. A ready video state is a delivered URL plus the
server-admitted coarse kind, not a promise that every browser can play it.

## Path 3 — render one authorized media reference or nothing

`useSnapbackMedia(mediaRefOrNull, options)` is empty-safe. `null` and
`undefined` synchronously return `{ status: "empty", media: null }`, start no
issuance, and make `refresh()` an inert resolved promise. An empty string is a
contract error that names the nullable spelling.

For non-empty input, pass only a `MediaRef` obtained from a server result. Its
coarse kind is disclosed with the readable media field even when separate
asset delivery is denied; projection success is not an asset-existence or
authorization oracle. The hook projects the shared issued-URL controller: image delivery
defaults to `primary`, accepts `widthPx` or an explicitly declared `variant`,
refreshes before expiry, and blanks the URL on denial or authority replacement.
It does not probe a signed route and does not claim portable video playback.

```ts source=packages/snapback-react/asset-upload-types.fixture.ts
export function ProfileMedia({ media }: { media: MediaRef<'image'> | null }) {
  const state = useSnapbackMedia(media, { widthPx: 640 });
  if (state.status === 'empty' || state.status === 'issuing') return null;
  if (state.status === 'ready' || state.status === 'refreshing') {
    return { src: state.url, alt: 'Profile' };
  }
  if (state.status === 'unavailable') {
    return { retry: () => state.refresh() };
  }
  return null;
}
```

`denied` is intentionally distinct from `unavailable`: denial carries a typed
authorization diagnostic and no URL. A transient unavailable state may be
retried. A valid URL remains visible while the controller is `refreshing`.

## Path 4 — grant recipient access and revoke it

The command transfers and finalizes every byte source first. Only then does it
invoke the command-bound mutation once; the parent record, generated collection
rows, reference attachments, and selected grants share that one application
storage transaction. Uploaded bytes are outside that transaction. A commit
failure can therefore leave reported upload residue, cancellation after
invocation does not roll back a possible commit, and response loss remains an
explicit ambiguous settlement whose retry reuses the command attempt. This is
an online foreground task, not offline source-byte custody or background
upload, and this page makes no hosted-target claim.

Direct recipients are legal only because both the collection ceiling and the
command declare that closed plan. The host reauthorizes the caller and every
principal at commit time; a client-supplied principal is never authority by
assertion:

```js source=tests/acceptance/fixtures/media-profile/snapback/functions.mjs
export const messageMedia = assetCollection({
  ownerTable: 'messages',
  intent: 'sharedMediaUpload',
  maxItems: 8,
  order: 'manual',
  kinds: ['image', 'video'],
  grants: {
    ceiling: {
      owner: { kind: 'owner-only' },
      recipients: { kind: 'recipients', state: 'active', maxRecipients: 8 },
    },
    default: 'owner',
  },
});
```

```js source=tests/acceptance/fixtures/media-profile/snapback/functions.mjs
export const sendMessage = defineMediaCommand({
  media: {
    input: 'media',
    intent: 'sharedMediaUpload',
    minItems: 1,
    maxItems: 8,
    kinds: ['image', 'video'],
  },
  mutation: sendMessageMutation,
  mapping: {
    passthrough: ['conversationId', 'text'],
    assetsToMutationArg: 'assetIds',
    parentResultPath: '_id',
    collection: 'messageMedia',
    operation: 'append',
    principals: { input: 'recipients', minItems: 1, maxItems: 8 },
  },
  sharing: assetSharing.recipients({ state: 'active', maxRecipients: 8 }),
});
```

Use the generated command reference—never its hidden target mutation. Removing
collection items through the generated operation detaches them and revokes the
collection-managed recipient grants in the same application transaction:

```ts source=packages/snapback-react/media-collection-types.fixture.ts
export function useMessageMediaActions() {
  const sendMessage = useSnapbackCommand(mediaProfileApp.commands.sendMessage);
  const removeMessageMedia = useSnapbackMutation(
    mediaProfileApp.api.mutations.messageMediaRemove,
    { queue: false },
  );
  return {
    send(
      conversationId: string,
      text: string,
      media: readonly AssetFileLike[],
      recipients: readonly Principal[],
    ) {
      return sendMessage({ conversationId, text, media, recipients });
    },
    revoke(parentId: Id<'messages'>, itemIds: readonly string[]) {
      return removeMessageMedia({ parentId, itemIds });
    },
  };
}
```

## Anti-patterns

- Do not pass `""` for no media; pass `null` or `undefined`.
- Do not construct `{ assetId, kind }` from MIME guesses, filenames, or client
  upload assertions. `kind` is reserved for server-admitted result metadata.
- Do not write a projected `MediaRef` object back to a media field; attach its
  finalized `assetId` string through an authorized write.
- Do not probe signed routes to discover variants or playback support.
- Do not hand-roll app-owned attachment tables, JSON media arrays, split media
  fields, or `image1`…`imageN`; declare an `assetCollection`.
- Do not call a media command's hidden mutation target or separately attach its
  uploaded asset ids; invoke `app.commands.<name>` through the command task.
- Do not claim `media.video.playable.v1`; this rollout adds no transcoding or
  portable container/codec guarantee.

---

<!-- snapback-guide-source: guide/backend/external-api.md -->
---
title: External API exposure
id: backend.external-api
order: 19
audience: agent-first
capabilities: [api.external-exposure]
authorities: [llp/0204-app-external-surfaces.rfc.md, llp/0031-server-route-taxonomy.spec.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, crates/snapback-engine/src/manifest.rs, crates/snapback-types/src/api_envelope.rs, crates/snapback-engine/src/ask.rs, crates/snapback-server/src/server.rs, crates/snapback-server/src/server/effects.rs, crates/snapback-server/src/server/oauth.rs, crates/snapback-kernel/src/storage/ask_spend.rs, crates/snapback-kernel/src/storage/pending_effects.rs, crates/snapback-kernel/src/storage/capability_links.rs, crates/snapback-kernel/src/storage/auth_integrations.rs, crates/snapback-kernel/src/storage/auth_agent_credentials.rs, crates/snapback-sync/src/auth/invocation.rs, crates/snapback-services/src/telemetry.rs, crates/snapback-services/src/telemetry_query.rs]
examples: [packages/snapback-codegen/auth-artifacts.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-09
reviewed-authorities-digest: sha256:33436c3acb6ab29a45b16c1b9d986e0037996934e374c91db0a295ece3ed8122
---

# External API exposure

> **Local target only**, and deliberately partial: the exposure core,
> `/api/v1` family, generated projections, integration records, and the OAuth
> facade, remote MCP, the read-only `ask` v1 budget ledger, capability links,
> durable user watches, and approval-gated effects are shipped.
> General billing-grade metering remains incomplete. Loss-tolerant per-caller telemetry attribution and console visibility
> are shipped, but are not a non-shedding usage ledger. Hosted targets refuse the facade and granted external lanes until the LLP 0039
> deployment-security contract lands.

Every function is private to the app's own clients until the schema declares
otherwise. The `api` block makes external exposure a per-function, opt-in
fact that governs callability with an integration credential, disclosure,
and documentation as one thing.

## Declare exposure

The block rides `defineSchema` options beside `auth`. It is meaningful only
under `auth.mode: 'sessions'`, and `enabled: true` additionally requires an
explicit `auth.agents.mode` declaration (`'disabled'` is a valid choice —
it means no new credentialed onboarding):

```js source=packages/snapback-codegen/auth-artifacts.test.mjs
  api: {
    enabled: true,
    functions: { listTodos: { expose: true, since: 'v1' } },
    origins: ['https://example.com:8443'],
  },
```

- `expose` defaults to **false**; a fresh app exposes nothing. Unknown
  function names in `api.functions` are authoring and activation errors.
- `since` is an optional additive-only stamp (no deprecation machinery
  exists yet; that waits for the first real deprecation).
- `approval` is optional and valid only on an exposed mutation or action.
  `'required'` gates every caller; `'external'` keeps direct first-party
  sessions immediate while external/service/link callers require approval.
- `api.budgets.ask` is accepted independently and becomes enforcement
  authority only when `api.ask.enabled` is true. An enabled ask declaration
  without every required budget line is refused at generation and activation.
- `oauth.enabled` requires `api.enabled`. The current facade is bearer-only,
  so `oauth.bearer: true` is an explicit acknowledgment of that weaker
  custody posture; omitting it refuses activation. `oauth.bundles` maps
  human-sized scope names to exposed function names, which activation
  compiles to the existing exact function/kind/basis grant scopes.
- The exposure fact compiles onto each function
  (`functions.manifest.json#apiExposure`) and rides the api envelope, so
  every projection derives the same set.

## What exposure gates

A service principal (agent/integration credential) invoking an unexposed
function is refused with `SNAPBACK_API_EXPOSURE_DENIED` at the
authorization gate — on the bare finite routes, live subscriptions and
reruns, and nested code-mode calls alike. Grant scopes still apply;
exposure never widens LLP 0058/0172 authorization.

**The honest limit:** an anonymous caller on the bare routes is
indistinguishable from a first-party anonymous caller, so `expose: false`
removes advertisement, projections, and credentialed callability — it
cannot remove bare-route anonymous reachability while the function's own
auth admits anonymous callers.

## Approval-gated effects

Declare the gate beside exposure:

```js fragment reason="approval policy excerpt; function names are app-specific"
api: {
  enabled: true,
  functions: {
    createTodo: { expose: true, approval: 'external' },
    deleteTodo: { expose: true, approval: 'required' },
  },
}
```

An approval-gated mutation/action does not execute on initial admission. Bare
HTTP, `/api/v1`, remote MCP, and capability-link invocation all return the same
`SNAPBACK_EFFECT_APPROVAL_PENDING` result with HTTP-style status 202, a `pfx_`
effect id, `/effects/{id}/approve` pointer, expiry, and prospective-effect
preview. V1 previews are always `kind: 'disclosed'`: they contain the canonical
args digest and the function's declared write set. They are not dry-run output
and must not be presented as verified simulation.

Signed-in app users see currently approvable intents at `GET /effects` and
decide them with `POST /effects/{id}/approve` or `/deny`. Non-link effects use
the app's current function policy to resolve approvers. A link-originated
effect is visible and approvable only by the link minter. An
`authorityCreating` function additionally requires the ordinary operation-
bound step-up proof in the approval body.

Approval rechecks expiry, current generation, function identity and kind,
exposure and gate, args binding, the original caller's current authority, the
approver's current function policy, and link/minter lineage where present.
Only then does the normal mutation/action path execute under the original
caller attribution with a separate approver fact. Denial, expiry, stale
binding, and execution outcome settle into the bounded effect journal.

Mutating capability links may have more than one use when the target function
is approval-gated or the mint request sets `approval: true`; each possessor use
creates a separate minter-approved effect. Generic dry-run previews, proactive
expiry sweeping, and granted-function links are not shipped in v1.

## The `/api/v1` family

External callers use `POST /api/v1/query/{name}`,
`/api/v1/mutation/{name}`, `/api/v1/action/{name}` — the same handlers as
the bare finite routes with external-lane semantics:

- Requests must **omit** `expectedGeneration`
  (`SNAPBACK_API_GENERATION_PIN_UNSUPPORTED`); the server serves the
  current generation and the envelope digest carries change detection.
- The family refuses every invocation unless the app enabled its API
  (`SNAPBACK_API_NOT_ENABLED`) and the function is exposed — for all
  authority classes, anonymous included.
- There is no `/api/v1` authorized-lease mint; live data for third parties
  is documented re-polling in v1.

```sh reason="basic bearer invocation example using the documented environment placeholders"
curl -X POST "$APP_BASE_URL/api/v1/query/listTodos" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $APP_API_TOKEN" \
  --data '{"args":{}}'
```

## Disclosure

With `api.enabled`, `disclosure` defaults to `'exposed-only'`: `GET
/inspect` and the served api envelope both filter their function inventory
to the exposed set (redacting one but not the other would protect
nothing). `disclosure: 'full'` is the explicit opt-in that keeps today's
full-inventory posture; disclosure never changes callability.

## Browser callers

`api.origins` grants exact-origin (scheme+host+port, no wildcards) CORS on
the `/api/v1` family only, for bearer transport. No declaration means no
CORS beyond loopback dev behavior.

## Generated projections

Served alongside the envelope, all derived from the same exposed set:

- `GET /app-api/openapi.json` — OpenAPI 3.1, one operation per exposed
  function, request schemas from the envelope.
- `GET /app-api/agent-skill` — a digest-pinned, pointer-heavy skill
  document teaching discovery, authority acquisition, and invocation.
- `scripts/generate-app-api-md.mjs` — the `API.md` reference projection;
  exposure-aware envelopes render `/api/v1` paths.

Exposed queries whose result contract declares a large row bound
(`maxItems > 100`) without a cursor argument get the
`SNAPBACK_API_PAGINATION_RECOMMENDED` lint at generation time.

## Read-only near-data `ask`

`POST /api/v1/ask` runs a host-managed model loop over the current exposed
**query** catalog. Mutations and actions are never offered as tools in v1,
regardless of the caller's broader grant. The same tool is advertised by the
remote MCP server when enabled; MCP v1 always waits for the synchronous final
envelope and does not stream.

Enable it with a complete budget declaration:

```js fragment reason="ask declaration shape; values are application policy, not recommended universal limits"
api: {
  enabled: true,
  ask: {
    enabled: true,
    billing: 'caller-key',
    model: { provider: 'openai-compatible', model: 'provider-model-id' },
  },
  budgets: { ask: {
    perRequest: { maxTokens: 2000, maxSteps: 8, maxWallMs: 30000 },
    perPrincipalDay: { maxTokens: 20000 },
    perIntegrationDay: { maxTokens: 10000 },
    appMonthly: { maxTokens: 500000 },
    resultVolume: {
      maxBytes: 262144,
      maxRows: 500,
      perPrincipalDayBytes: 2097152,
    },
  } },
}
```

The single v1 provider class is `openai-compatible`. That exact value uses
the OpenAI-compatible `/v1/chat/completions` endpoint; a deployment/test may
declare `openai-compatible:https://provider.example/v1`. Plain HTTP is
accepted only for a loopback test provider. Provider network use still
requires the LLP 0009 guarded-egress switch `SNAPBACK_OUTBOUND_ACTIONS=1`.
The earlier LLP 0204 D5 reference to LLP 0070 for this gate is a mis-cite; the
implemented authority is LLP 0009 plus the LLP 0036 target secret seam.

With `billing: 'app'`, `model.secret` names an LLP 0036 config entry. Its value
is runtime-only and never appears in the manifest, database, or response. With
`billing: 'caller-key'`, send the provider credential only in
`X-Snapback-Ask-Provider-Key`; it receives an invocation-lifetime redactor and
is neither persisted nor logged.

App-paid asks require the distinguished `snapback:ask:data-egress` consent
scope (ordinary signed-in sessions count as their own granted principal).
Caller-key asks require at least one granted read scope. Anonymous and
declared-client lanes are refused with `SNAPBACK_API_ASK_AUTHORITY_REQUIRED`
and an authority-acquisition escalation.

```sh
curl -X POST "$APP_BASE_URL/api/v1/ask" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $APP_API_TOKEN" \
  -H "X-Snapback-Ask-Provider-Key: $APP_PROVIDER_KEY" \
  --data '{"task":"Summarize the open incidents","stream":false}'
```

Admission transactionally reserves the complete per-request token and result-
byte maxima in `_snapback_ask_spend`; settlement releases that reservation and
charges actual observed usage. A crash can therefore strand capacity only in
the conservative direction. Provider usage fields are authoritative when
present; otherwise the host estimates bytes/4 and marks `estimated: true`.
Token, step, wall-time, query-result byte/row, principal-day, optional
integration-day, and app-month limits all fail with typed diagnostics.

The final envelope names provider/model, token accounting, current durable
spend, and `provenanceNotProof.calls`. Each call has the function name plus
domain-separated per-run HMAC commitments of arguments and result. These
receipts record host-observed provenance; they do not prove that the model's
answer was derived from those values. `resultSchema` is optional. When given,
the host validates the final tool arguments and permits two repair turns
before `SNAPBACK_API_ASK_RESULT_SCHEMA_MISMATCH`.

`stream` defaults to true on HTTP. The request runs as a platform-managed
attempt and settles the existing private transcript; `stream: false` returns
only the synchronous final envelope. The current v1 provider adapter does not
publish intermediate model tokens as live chunks.

## OAuth 2.1 compatibility facade

Apps that explicitly enable `api.oauth` publish local, no-store discovery at
`GET /.well-known/oauth-authorization-server` and
`GET /.well-known/oauth-protected-resource`. A generic client dynamically
registers at `POST /auth/oauth/register`, then uses authorization code with
required PKCE S256 through `GET|POST /auth/oauth/authorize` and
`POST /auth/oauth/token`.

<!-- since: 0.1.16 -->

The paved terminal client is
`snapback-app --server <app-url> login`. It performs discovery, DCR, loopback
or paste completion, PKCE exchange, and owner-only short-lived bearer custody;
see [Log in through the external OAuth facade](../clients/app-cli.md#log-in-through-the-external-oauth-facade)
for its scope-default heuristic and no-browser path. The native proof-of-
possession alternative remains `snapback-app pair`.

Dynamic registration creates the same delegation-only integration principal
and record as the native registration path, under the active
`auth.agents.mode`. It returns no client secret and creates neither an
installation nor authority. V1 DCR is creation-only: it exposes no
re-registration/update contract, so an existing client record — including a
suspended or revoked one — cannot be mutated through this endpoint. The
consent page resolves requested bundle names
to exact canonical scopes; approval uses the ordinary grant approval and
operation-bound step-up machinery. Authorization codes are single-use and
expire after 60 seconds.

Facade access tokens are ordinary grant-bound scoped tokens with a 15-minute
bearer lifetime. V1 intentionally issues no refresh token: after expiry, an
MCP or other OAuth client repeats authorization. `POST /auth/oauth/revoke`
releases the presented carrier and may also revoke its installation grant.
Suspension, integration retirement, user grant revocation, and scoped-token
release therefore close the same underlying authority rather than a parallel
OAuth authority model.

## Caller usage visibility

Function and live-subscription telemetry carries a closed caller lane:
`anonymous`, `declared`, `integration`, or `first-party`. Declared callers are
keyed only by the digest shown in the operator-only declared-client listing;
their raw e-mail-bearing declaration never enters telemetry. Integrations use
their registration record ID.

`GET /_snapback/api/telemetry/stats` accepts optional `callerKey` and `lane`
filters plus `groupByCaller=true`. The operator-only declared-client and
integration listings include a recent 24-hour usage count from the same
bounded rollup, beside the existing suspension controls. These counts inherit
telemetry retention, folding, and shedding. They are useful for visibility,
not billing, audit, entitlements, or proof that an invocation did not happen.

---

<!-- snapback-guide-source: guide/backend/trusted-runtime-values.md -->
---
title: Trusted runtime time and identifiers
id: backend.runtime-values
order: 24
audience: agent-first
capabilities: [backend.runtime-values, backend.mutation-settlement-identity]
authorities: [llp/0043-offline-replay-retention.rfc.md, llp/0051-language-neutral-data-tier.rfc.md, llp/0065-generated-data-pattern-soundness.rfc.md, packages/snapback-harness/ctx-bootstrap.js, packages/snapback-codegen/index.mjs, crates/snapback/tests/mutation_settlement_identity_v0.rs]
examples: [demos/competitive-checkpoint/snapback/handlers.mjs, demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:6919f120fbdc6b257e5c339ef8cdf9bd4ff8d32c498a0befc1c762967f765f26
---

# Trusted runtime time and identifiers

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

When a JavaScript handler needs a creation/update time or a fresh opaque
identifier, derive it inside the handler. Do not accept it from a client and
do not call ambient `Date` or `Math.random`.

## Stamp a write inside the handler

Use `ctx.runtime.now()` for an integer Unix timestamp in milliseconds. The
value is frozen for the invocation, so store one result in a local when several
writes describe the same event. Use `ctx.runtime.id()` for a fresh string on
each call:

```js source=demos/competitive-checkpoint/snapback/handlers.mjs
  const now = ctx.runtime.now();
  const attemptId = ctx.runtime.id();
  await ctx.db.insert('messages', {
    conversationId: args.conversationId,
    role: 'user',
    content: args.content,
    status: 'complete',
    attemptId: ctx.runtime.id(),
    idempotencyKey: 'user:' + args.idempotencyKey,
    sequence: 0,
    lastProgressAt: now,
    pageKey: ctx.runtime.id(),
  });
```

The owner-policy field is also intentionally absent: Snapback stamps the
effective principal at the host. Supplying it from handler values is refused,
even when it equals `ctx.auth.userId`.

The host records these answers and reuses them if it replays the invocation.
That is why ambient clock and randomness APIs are not interchangeable with the
context methods. An `id()` result belongs in a plain required string field; it
is not a principal and does not manufacture a table foreign key. Neither value
yields a dense per-scope ordinal (JOB-42): `id()` is opaque and `now()` is not
gap-free. That is the [scoped sequences](./sequences.md) surface — an
experimental, contributor-local-only publication (`sequence_allocation_v1` on
contributor-source builds of the local target since 2026-08-04); public
runtime packages and hosted targets retain a structured GAP. Do not hand-roll
it from these values either.

For owner-scoped generated CRUD, declare the same policy as
`createDefaults: { createdAt: 'now', pageKey: 'id' }` instead of writing a
handler. The [safe standard patterns](./standard-patterns.md) page covers that
narrow helper profile.

<!-- since: 0.1.15 -->

## Keep effect identity stable across mutation re-entry

`ctx.runtime.id()` is fresh identity for one handler entry. It is not an
effect-deduplication key: a mutation that throws before settlement may
genuinely re-enter and receive another runtime id. When retries must write one
durable effect intent with one provider idempotency key, use the mutation's
replay-stable `settlementId` instead. The complete mutation-only recipe is
[derive a replay-stable effect key](./mutations.md#derive-a-replay-stable-effect-key).

## Keep generated fields out of operation arguments

Declare only client-authored values in a mutation's `args`. The generated
operation schema is closed, while trusted fields such as `attemptId`,
`lastProgressAt`, and `pageKey` are absent:

```json source=demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json
{
  "$id": "https://schemas.snapback.dev/apps/competitive-checkpoint/startReply.args.schema.json",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "content": {
      "type": "string"
    },
    "conversationId": {
      "type": "string"
    },
    "idempotencyKey": {
      "type": "string"
    }
  },
  "required": [
    "conversationId",
    "content",
    "idempotencyKey"
  ],
  "title": "competitive-checkpoint:startReply arguments",
  "type": "object"
}
```

A caller that tries to supply an omitted timestamp or identifier is therefore
rejected as an additional property instead of silently overriding the server
value. Official generated clients check the same closed projection before
transport and report `SNAPBACK_ARGUMENT_VALIDATION_FAILED`; the server's own
validation remains authoritative either way.

## Repair ambient dependency diagnostics

- `BUNDLE_UNSUPPORTED_TIME` for `Date.now()` or `new Date()` means: call
  `ctx.runtime.now()` and keep the stored field an integer millisecond value.
- `BUNDLE_UNSUPPORTED_RANDOM` for `Math.random()` means: use
  `ctx.runtime.id()` only when the intent is a fresh identifier. For other
  values, pass an explicit deterministic input; Snapback does not expose a
  general randomness primitive.
- `BUNDLE_UNSUPPORTED_TIMER` means an ambient timer is not valid in that
  handler profile. `ctx.runtime.now()` supplies a timestamp, not a delay or
  scheduler.

The diagnostic message includes this page's path. Assert on its stable code,
not its repair prose; see [diagnostics](../operating/diagnostics.md).

## Move a client-authored field to the runtime

For future writes, replace the handler's use of `args.createdAt` or
`args.generatedId` with the appropriate context call, then remove that field
from the operation's `args`. Regenerate the operation schemas and update
callers together: the closed schema deliberately rejects an old client that
continues sending the removed property. Existing stored values can remain;
the trust boundary changes at the write path.

For disposable local data, reset and reseed after changing the schema. When
preserved local data must be reshaped or backfilled, use the reviewed
`snapback migrate` loop — [reviewed migrations](./migrations.md) — rather
than an ad-hoc script; this guide makes no hosted rollout or zero-downtime
migration claim.

## Anti-patterns

- Do not put `createdAt`, `updatedAt`, or generated IDs in public arguments
  when the server is their authority.
- Do not substitute `Date.now()`, `new Date()`, or `Math.random()` inside a
  handler.
- Do not reuse one `ctx.runtime.id()` result for distinct logical records.
- Do not use `ctx.runtime.id()` as a replay-stable effect or provider
  idempotency key.
- Do not type a runtime-generated string as a principal or foreign key.
- Do not infer a supported migration workflow from the runtime-value APIs.

---

<!-- snapback-guide-source: guide/backend/standard-patterns.md -->
---
title: Safe standard data patterns
id: backend.standard-patterns
order: 25
audience: agent-first
capabilities: [backend.standard-patterns]
authorities: [llp/0051-language-neutral-data-tier.rfc.md, llp/0065-generated-data-pattern-soundness.rfc.md, llp/0100-membership-addressed-operations-and-pages.rfc.md, llp/0110-bounded-children-and-activity-patterns.spec.md, llp/0113-qualification-and-publication-authority.spec.md, llp/0157-composition-algebra-and-completeness.spec.md, llp/0166-local-persistent-store.spec.md, packages/snapback-codegen/standard-patterns.mjs, packages/snapback-codegen/define.mjs]
examples: [packages/snapback-codegen/standard-patterns.test.mjs, packages/snapback-codegen/relation-activity-authoring.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:f99b6fdb988d64145b86f8c6275af59102ac56d2b59681059038fcfabeb44bec
---

# Safe standard data patterns

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use `@expo/snapback-codegen/standard-patterns` when a table follows the common
single-owner shape. The helpers generate declarative queries and mutations;
they do not add a second runtime or hide handwritten JavaScript behind the
API.

This surface is partial because the implemented v1 profile is intentionally
narrow: owner visibility only, with authorization and visibility always
declared by the caller. Its governing soundness RFC is Implemented; “partial”
describes the helper's limited profile, not unfinished enforcement.

## Declare the owner and continuation boundary

The pagination index is an authorization partition followed by one unique
continuation field. This example uses a server-generated string `pageKey`;
timestamps alone are usually not unique enough for the v1 keyset contract.

```js source=packages/snapback-codegen/standard-patterns.test.mjs
export const todos = defineTable({
  ownerId: v.principal(),
  slug: v.string(),
  title: v.string(),
  pageKey: v.string(),
  createdAt: v.integer(),
  updatedAt: v.integer(),
})
  .index('by_owner_slug', ['ownerId', 'slug'], { unique: true })
  .index('by_owner_page_key', ['ownerId', 'pageKey'], { unique: true })
  .index('by_owner_created', ['ownerId', 'createdAt'])
  .visibility({ kind: 'owner', field: 'ownerId' })
  .sync();
```

## Generate owner-scoped CRUD

Bind the table into a schema first, then name every generated operation and
declare the owner field. The generated list and get queries include an
executable `ownerId == authUserId()` filter. Create stamps the owner from the
authenticated principal; update and delete re-read the row and guard its owner
inside the transaction.

`createDefaults` and `updateDefaults` use trusted runtime values. `now` becomes
server-derived `runtimeNow()` and `id` becomes server-derived `runtimeId()`;
neither field appears in the public argument schema, so a client cannot forge
it. For the direct JavaScript handler form, including runtime diagnostics and
transitioning an existing client-authored field, see
[trusted runtime time and identifiers](./trusted-runtime-values.md).

```js source=packages/snapback-codegen/standard-patterns.test.mjs
export const { listTodos, getTodo, createTodo, updateTodo, deleteTodo } = defineOwnedCrud({
  table: schema.tables.todos,
  names: {
    list: 'listTodos',
    get: 'getTodo',
    create: 'createTodo',
    update: 'updateTodo',
    delete: 'deleteTodo',
  },
  visibility: { kind: 'owner', field: 'ownerId' },
  createDefaults: { pageKey: 'id', createdAt: 'now', updatedAt: 'now' },
  updateDefaults: { updatedAt: 'now' },
  immutable: ['slug', 'pageKey', 'createdAt'],
  listIndex: 'by_owner_created',
});
```

`listIndex` is required: it names a declared index whose leading field is the
owner field, the generated list orders by that index's field sequence (the
storage layer's implicit `_id` component breaks ties deterministically), and
the helper never emits an unindexed owner scan. `now` defaults bind only to
integer millisecond fields.

Generation fails closed when `visibility` is missing, the owner field is
optional or unsuitable, `listIndex` is absent or not owner-leading, a trusted
default has the wrong field type, the table carries a membership or
permission-backing declaration (generated CRUD refuses authority-bearing
tables), a unique index that excludes the owner field is not named in
`discloseUniqueConflicts` (an undeclared cross-owner conflict would disclose
existence), or an unknown option is present. Cross-owner update and delete
refuse with the same `SNAPBACK_ROW_NOT_FOUND` outcome as a missing row, so
existence is not disclosed at the public boundary.

## Generate a unique lookup

Use a declared unique index that includes the owner field. The helper derives
arguments for the other index fields while retaining the server-derived owner
predicate.

```js source=packages/snapback-codegen/standard-patterns.test.mjs
export const { todoBySlug } = defineOwnedUniqueLookup({
  table: schema.tables.todos,
  name: 'todoBySlug',
  index: 'by_owner_slug',
  visibility: { kind: 'owner', field: 'ownerId' },
});
```

## Generate keyset pages

Keyset pagination emits separate first-page and next-page live queries. Its
index must be unique and contain both the owner and cursor fields; generation
rejects a declaration that would disguise a scan as pagination.

```js source=packages/snapback-codegen/standard-patterns.test.mjs
export const { firstTodoPage, nextTodoPage } = defineOwnedKeysetPages({
  table: schema.tables.todos,
  names: { first: 'firstTodoPage', next: 'nextTodoPage' },
  index: 'by_owner_page_key',
  cursorField: 'pageKey',
  visibility: { kind: 'owner', field: 'ownerId' },
});
```

The default page size is 50. Pass `direction: 'desc'`, a smaller `limit`, or a
different cursor argument name when the declared unique index supports that
shape. The index fields must be exactly `[ownerField, cursorField]`, in that
order. A unique index with a third field is not sufficient because the cursor
may still repeat within one owner's partition. A generated string `pageKey`
using an `id` trusted default is the safe v1 continuation when the natural sort
field, such as a timestamp, is not independently unique.

The continuation is an opaque versioned cursor, never the raw boundary
value. When a page returns its full `limit` of rows, the response carries a
`cursor` next to `rows`; pass it as the next-page function's cursor argument
(`after` by default). The cursor binds the app, the first/next pair's plan
identity, and the caller's authority partition: a malformed, raw-value,
cross-pair, cross-owner, or post-authorization-change presentation is
refused with `SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID` (HTTP 400), never
silently repositioned, and every refusal class answers byte-identically. A
page with fewer than `limit` rows is terminal and carries no cursor.
Continuation guarantees no skipped and no duplicated row among rows
untouched by concurrent mutations; a row whose cursor field is concurrently
mutated may move relative to the page boundary.

## Generate membership-scoped keyset pages

When the partition is a shared resource rather than the caller's own rows —
a chat room's history, an org's board — `defineMembershipKeysetPages`
(LLP 0100 §4) pages one membership-protected resource. Visibility is the
caller's declared seat: the generated pair executes the resource-value
filter AND the declaration-bound role predicate on every invocation —
executable authority, never metadata.

```js source=packages/snapback-codegen/standard-patterns.test.mjs
export const { firstRoomMessagePage, nextRoomMessagePage } =
  defineMembershipKeysetPages({
    table: messages,
    names: { first: 'firstRoomMessagePage', next: 'nextRoomMessagePage' },
    membership: {
      declaration: roomMembers,
      resourceArg: 'roomId',
      resourceField: 'roomId',
      roles: ['owner', 'member'],
    },
    index: 'by_room_page_key',
    cursorField: 'pageKey',
    limit: 50,
  });
```

The `membership` block is this profile's visibility declaration and is
closed: `declaration` is the `defineTable(...).membership(...)` table
(resource-scoped only), `resourceArg`/`resourceField` carry the
declaration's exact nominal resource id type (a plain string that merely
looks like a room id is refused), and `roles` is a non-empty subset of the
declared non-pending roles — a pending seat is not visibility. The index
must be unique with exactly `[resourceField, cursorField]`, and a
membership or permission-backing table can never be the page table.

**The per-resource page-key idiom is a real authoring constraint.** The
single-column cursor means a chat-shaped table that would naturally page on
`(createdAt, id)` must instead maintain a per-resource unique page key —
a generated string `pageKey` written with an `id` trusted default (or an
app-owned monotone key) so `[roomId, pageKey]` can be declared unique.
Compound cursor boundaries are LLP 0100 open question 4, not a v1 surface.

**These pages are callable-only.** The pair is emitted as ordinary `Query`
definitions that cannot be subscribed at all — a deliberate delta from the
owned helper's live-query emission, because a subscribable historical page
would create one authorization-sensitive subscription per visited page.
The product's separate current-room `live_replace` query owns live
grant/revocation updates; a fresh first-page call observes a later grant.
When a Contract product screen needs one of these pages, invoke the
generated references from a host/client control beside the compiled
Contract surface — the composition is shown in
[the Contract adapter](../clients/contract-adapter.md#call-a-paged-query-from-a-contract-screen).

A non-member's first page is empty with no cursor and reveals neither room
nor membership existence — byte-identical to a nonexistent resource id.
The continuation cursor binds, beyond the owned profile's members, the
exact resource-argument VALUE (a room-A cursor presented for room B
refuses), the membership declaration facts, the global authorization pair
(any membership write invalidates outstanding continuations — removal
between pages refuses the old cursor, and rejoining does not revive it),
the data-version stream (reset invalidates), and the active artifact
identity (any redeploy invalidates — accepted conservatism). Every refusal
class answers with the byte-identical
`SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID` before any candidate row is
read.

## Know when to leave the profile

The v1 helpers do not authorize joins, projections, migrations, shared ACLs,
or public rows. Express those semantics directly with the declarative builders
— the complete `defineMutation` step/expression vocabulary is
[declarative mutation plans](./declarative-plans.md) — or a JavaScript
handler under their governing design. A schema field or index
can prove structure; it cannot prove who may see or mutate a row.

## Design reference: write plus one activity row

`defineWriteWithActivity` and `defineBoundedChildrenQuery` are experimental
local profiles. A contributor source build of the exact
`local-dev-sqlite-ibex` target advertises both as one atomic source publication
only when its private embedded
`LocalCapabilityPublicationV1` carrier still matches the committed
qualification receipt and the executor/schema source bytes. Application
artifacts cannot supply that carrier. They must explicitly acknowledge
`write_activity_v1` or `bounded_children_v1`; an unacknowledged requirement
refuses at load.

The repository evidence is split deliberately. Run
`node packages/snapback-codegen/relation-activity-authoring.test.mjs` for
closed authoring, generated relationship assertions, exact-one bounded result
typing, and dedicated capability refusal. Run
`cargo test --lib
relation_incarnation_is_protected_and_delete_recreate_isolated` for the
transaction-local active-incarnation check, including stale-row patch/delete
refusal after parent deletion and ID reuse. Run
`node tests/conformance/relation-activity-publication-v1.mjs` to verify the
tracked carrier, receipt, source digests, cursor golden, and first-party queue
ownership together. Remote-service, conformance-workerd, Cloudflare, and
hosted profiles retain both GAPs; this local source carrier does not authorize
them. Public runtime packages are deliberately compiled as `public-package`
and retain both structured GAPs because the loader does not yet embed and
verify the release-key-signed `PackageCapabilityAttestationV1`. Package
assembly refuses a contributor-source binary, so placing the same executable
under `node_modules` cannot launder the source trust root into a published
claim.

The helper makes one existing-owner transaction reviewable:

1. point-read the declared scope and collapse missing/invisible to
   `SNAPBACK_ROW_NOT_FOUND`;
2. run a bounded closed primary plan;
3. verify the declared source table, id, operation, and exactly one changed
   row;
4. insert exactly one activity row with server-derived authority provenance
   and the scope relation incarnation; and
5. validate and durably retain the exact LLP 0108 result under LLP 0043's
   client mutation identity.

Declare every non-scope primary table explicitly:

```js fragment reason="closed relation declaration shape; the executable fixture uses domain-specific table bindings"
relations: [{
  table: tasks,
  scopeForeignKey: 'incidentId',
  scopeIncarnation: 'incidentIncarnation',
}]
```

Do not author either protected field on an insert. The helper stamps the
foreign key from the authorized scope and the central writer supplies the
current incarnation. Before every non-scope `Get`, `Patch`, or `Delete`, the
generated host plan executes `AssertCurrentRelation` inside the commit
transaction. It compares the row foreign key and protected stamp with the
active registry token and collapses missing, cross-scope, and stale-orphan
rows to `SNAPBACK_ROW_NOT_FOUND`.

`defineBoundedChildrenQuery` returns exactly one row of a sealed union:
`absent` has `parent: null`, no children, and no continuation; `visible` has
the projected parent, the bounded child page, and a nullable continuation.
Projection leaves are `_id` or portable scalar fields only. Optional stored
scalars remain required keys whose value is `null | Scalar`; optional JSON is
not admitted as a projection leaf.

Two to eight complete bounded-children definitions additionally compose into
one pinned-snapshot batch via `defineSnapshotBatchQuery` — a further
experimental capability (`snapshot_batch_v1`, which also requires
`bounded_children_v1`) with its own page:
[snapshot batches](./snapshot-batches.md).

The neighboring experimental `single_table_v1` class is deliberately not an
authoring helper. Codegen derives it automatically when an ordinary
`defineLiveQuery` is public, authority-independent, ambient-free, and its
complete read summary is the one table in its declarative plan. The generated
artifact then requires the class; authors cannot assert membership. It remains
single-node-only and uses Arm A authority-independent snapshot retention, not
an `AuthorizedLease` and not `defineSnapshotBatchQuery`.

The source operation is exactly `insert`, `patch`, or `delete`. Empty and
storage-identical patches are not effects; missing targets and operation
mismatches roll the whole transaction back before activity or settlement.
Scope, source, and activity identities are declared, not inferred from the
first write or from field names.

Activity provenance comes only from admitted server authority. Sessions map
to a direct human actor. Delegated service authority requires an effective
user and records the distinct agent actor and grant. Anonymous, admin bypass,
system, bare/autonomous service, and dev impersonation refuse. The activity
stores a purpose-derived SHA-256 digest of the canonical durable
`ClientMutationIdentity`, not the cleartext client mutation id.

Inspect the generated plan and `EffectCeilingV1`: it must expose the scope
read/patch count, auxiliary point reads, one source effect, one activity
insert, runtime IDs/time, settlement lookup/write, and maximum application
writes. A maintained-projection participant or an unpartitioned observable
unique constraint is outside this profile.

## Anti-patterns

- Do not accept owner, creation time, update time, or generated IDs from client
  arguments when the server can derive them.
- Do not treat `authScopeField` metadata as an authorization predicate; the
  executable owner filter and mutation guard are the enforcement.
- Do not use a non-unique or owner-free index for keyset pagination.
- Do not infer visibility from field names such as `ownerId` or `userId`.
- Do not stretch these helpers over joins, ACLs, or migrations; leave the
  profile and state those semantics explicitly.
- Do not append activity after commit or treat a no-op patch as an auditable
  source change.
- Do not accept effective subject, actual actor, actor kind, grant, or
  mutation digest from application arguments.
- Do not infer support from an exported helper. Check the target manifest and
  acknowledge the experimental capability; other targets still report a GAP.

---

<!-- snapback-guide-source: guide/backend/relational-queries.md -->
---
title: Relational queries (bounded joins)
id: backend.relational-queries
order: 26
audience: agent-first
capabilities: [backend.relational-queries]
authorities: [llp/0080-portable-relational-queries-and-projections.rfc.md, llp/0110-bounded-children-and-activity-patterns.spec.md, llp/0065-generated-data-pattern-soundness.rfc.md, llp/0187-agent-discoverability-routing.rfc.md, llp/0248-bounded-batch-reads.rfc.md, packages/snapback-codegen/define.mjs]
examples: [packages/snapback-codegen/relational-authoring.test.mjs, packages/snapback-codegen/relation-activity-authoring.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:a51f3ecd3f5812a27fa4c4c048ff898da589f9e25df5abf1e67dff43e4e1cd56
---

# Relational queries (bounded joins)

> **Local target only.** Relational queries require the
> `relational_query_v1` target capability — **stable** since LLP 0080/0081
> flipped to Implemented (2026-07-26); no experimental acknowledgment is
> emitted or required. A target without the executor (for example the
> Cloudflare path) refuses at generation with a machine-readable capability
> gap, never at runtime.

Use `defineRelationalQuery` for the common "each row plus its one related
row" read: a bounded two-source equi-join with an explicit projection. It is
a closed plan — no SQL text, no callbacks — and every visibility fact is
declared, never inferred from field names or read sets.

## Recognize the messaging shape

A conversation list is the same shape as the books/authors example below:
make `conversationMembers` the bounded root, join its `conversationId` to a
declared unique conversation key, then project the conversation title and
membership facts. A message feed can likewise join messages to a distinct,
uniquely indexed sender table. Use `defineRelationalQuery` when the join is a
callable/live read, or `defineMaintainedProjection` when that same closed join
should be a transactionally maintained table.

Choose these declarations before hand-writing a `defineJsLiveQuery` for a
plain two-source join: codegen proves joined-side uniqueness, visibility, the
bounded root access, and target support. Stay with a bounded JS handler when
the result also needs grouping/aggregation, arbitrary post-join logic, more
than two sources, or a self-join. V1 explicitly refuses the same table as
both `root` and `joined`; reply-preview self-joins and reaction counts are
missing capability, not hidden relational options.

> **Coming from Convex/Supabase?** Convex joins are JS-side traversal or
> indexed lookups; Supabase exposes foreign-key-derived nested selection —
> see
> [Reading related data without hand-writing the wrong join](../recipes/coming-from-convex-and-supabase.md#relational-queries)
> for the bounded two-source `defineRelationalQuery` vs. `defineMaintainedProjection`
> translation and the multi-way/self-join GAP.

```js source=packages/snapback-codegen/relational-authoring.test.mjs
export const booksWithAuthors = defineRelationalQuery({
  root: schema.tables.books,
  joined: schema.tables.authors,
  join: [{ root: 'authorSlug', joined: 'slug' }],
  kind: 'inner',
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'owner', field: 'ownerId' },
    output: 'owner',
  },
  projection: {
    title: { root: 'title' },
    authorName: { joined: 'name' },
    score: { root: 'score' },
    available: { root: 'available' },
    shelf: { literal: 'fiction' },
    featured: { literal: true },
    edition: { literal: 1 },
    note: { literal: null },
  },
  take: 50,
  rootIndex: 'by_owner_title',
  joinedIndex: 'by_slug',
  retention: 'opaque-authorized-snapshot-v1',
});
```

The shape is closed and proven at authoring time:

- **Exactly two sources.** One root table and one joined table, with 1–4
  equality pairs. Join keys must share one admitted type — string,
  principal, reference id (same target table), integer, or boolean. A null
  key never matches.
- **The joined side must be provably unique.** `joinedIndex` names a
  declared `unique` index whose complete ordered key is exactly the joined
  field sequence — that declaration is the cardinality proof. Two joined
  rows under one key at runtime is a storage-invariant refusal, never a
  silent first-row pick.
- **Root access is index-served.** `rootIndex` names a declared index; for
  an owner-visible root its leading field is the owner field. Results order
  by the index's field sequence (ties broken deterministically by `_id`),
  and `take` (0–1024) bounds consumed authorized roots. v1 does not accept
  extra root filters yet.
- **Visibility is explicit on both sources and the output.** Each source
  declares `{ kind: 'owner', field }` or `{ kind: 'public-read' }`. The
  output must be declared too, and it can never be broader than a
  contributing source: owner sources force `output: 'owner'` (the generated
  function requires authentication), and only all-public sources may
  declare `output: 'public-read'`. A `left` join is refused when the only
  owner evidence sits on the omissible joined side.
- **Invisible means absent.** A joined row the caller cannot see behaves
  exactly like a missing row: `inner` omits that root (the page may come
  back short — it is not refilled), and `left` returns the root with null
  joined leaves. Callers cannot distinguish the two cases.

Each source table's `.visibility(...)` policy is also stamped into the plan
from the generated schema and ANDed with the source-local `visibility.root` or
`visibility.joined` predicate. Authors do not restate it. Activation and
execution re-derive the policy from the installed schema and refuse a missing
or mismatched carrier with `SNAPBACK_TABLE_VISIBILITY_PLAN_MISMATCH`. A joined
row hidden by the table policy follows the same absent semantics above.

Live subscriptions deliver whole-result replacement (`live_replace`): a
commit touching either source re-runs a policy-free query. When either source
has a restricted table policy, any commit conservatively resnapshots until a
precise matcher captures every policy dependency; this permits extra wakes but
not a missed authorization change. No incremental delta proof is claimed,
matching LLP 0080 and LLP 0231's deliberately conservative posture.
A relational plan is never `authorityIndependent` — public plans stay
authority-partition-scoped — and retention is default-deny with a closed
vocabulary. `retention: 'none'` is the default. An owner-visible
plan may declare `retention: 'opaque-authorized-snapshot-v1'`: the
projected result is retained as an opaque authorized snapshot under the
authenticated lease path (the client decodes it; it never re-executes the
join over retained rows), and the continuation cursor never rides the
lease envelope. An all-public plan cannot declare it — anonymous results
have no admissible v1 retention, refused at generation and again at load
(`SNAPBACK_AUTH_UNDECLARABLE_RETENTION`). The capability manifest records
the admitted classes under `relationalQueries.retention`. (Design
reference: LLP 0080's 2026-08-03 dated amendment, landed with Accepted
LLP 0166, specifies the third owner-issued class
`result-transform-snapshot-v1`. Selecting it is an owner reclassification:
it rotates the plan identity and admits the shipped closed result-transform
evaluator only after the D7 carrier gate; existing opaque records are never
relabelled in place.)

## Pagination

Every relational query accepts one implicit argument, `cursor`. When a page
consumes its full `take` of authorized roots, the response carries an opaque
versioned continuation cursor next to `rows`; pass it back as
`{ cursor }` to resume from the last consumed root. The contract:

- **`take` counts consumed roots, not emitted rows.** An `inner` join can
  emit a short — even empty — page whose continuation still progresses, and
  no page is refilled.
- **A short page is terminal.** A page that consumed fewer than `take`
  roots returns no cursor; `take: 0` returns an empty page with no cursor
  and consumes nothing.
- **Cursors are bound, not positional.** The cursor binds the app, the
  plan, the argument set, the order schema, and the caller's authority
  partition. A malformed, tampered, cross-plan, cross-argument,
  cross-user, or stale-authority cursor — including one presented after an
  authorization change — is refused with `SNAPBACK_RELATIONAL_CURSOR_INVALID`
  (HTTP 400), never silently repositioned, and every refusal class answers
  with byte-identical output.
- **Pages are not snapshot-consistent with each other.** Continuation
  guarantees no skipped and no duplicated root among roots untouched by
  concurrent mutations; a concurrently mutated root may move relative to
  the boundary.

## Maintained projections

`defineMaintainedProjection` turns the same closed join into a durable
output table the runtime maintains inside **every source mutation's own
commit** — source and projection either commit together or not at all,
with no background repair and no separately visible projection version.
A projection has no function carrier, so the generated bundle records its
relational-engine dependence as a schema-level `relational_query_v1`
requirement (derived from the projection's presence — never authored):
a target without the engine refuses at generation and admission, not at
activation.

```js source=demos/competitive-checkpoint/snapback/functions.mjs
export const conversationCardsProjection = defineMaintainedProjection({
  id: 'conversation-cards',
  root: schema.tables.conversations,
  joined: schema.tables.models,
  output: schema.tables.conversationCards,
  join: [{ root: 'model', joined: 'slug' }],
  // Left: a conversation whose model is not registered still projects a
  // card with a null modelName; the owner evidence rides the root.
  kind: 'left',
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'public-read' },
    output: { kind: 'owner', field: 'ownerId' },
  },
  projection: {
    ownerId: { root: 'ownerId' },
    title: { root: 'title' },
    modelName: { joined: 'displayName' },
  },
  rootReverseIndex: 'by_model',
  fanOutLimit: 64,
  sharedFanOutDisclosure: true,
});
```

The contract, all enforced at generation and re-proved at activation:

- **The output table is maintenance-only.** Any function that writes it is
  refused; a closed HostPlan may read an owner-visible output only with
  its visibility predicate composed (`eq(ownerField, authUserId())`), and
  opaque JS handlers may not touch it at all. Chains and diamonds —
  projections sourcing another projection's output — are refused.
- **Row identity is key-stable.** `outputKey` is the root `_id` (default)
  or `{ index }` naming a declared unique root index whose fields become
  immutable: a mutation that moves a key field is refused, and the same
  output key owns the same row `_id` across delete/re-insert and rebuilds.
- **Fan-out is bounded and declared.** `rootReverseIndex` must lead with
  the root join fields; `fanOutLimit` (1–1023) counts *every*
  reverse-index entry for a joined key. A write that would exceed it — or
  push a mutation past the 1,024-write bound including projection writes —
  refuses whole with `SNAPBACK_PROJECTION_FANOUT_EXCEEDED`.
- **Shared-source coupling is explicit.** A public joined source feeding
  an owner output couples callers through the shared `fanOutLimit`;
  declare `sharedFanOutDisclosure: true` or generation refuses with
  `SNAPBACK_RELATIONAL_DISCLOSURE_REQUIRED`.
- **Unchanged bytes cost nothing.** An affected output row whose
  recomputed logical bytes are unchanged issues no write; repeated writes
  to one source row coalesce to one evaluation against the final snapshot.

Author-supplied root filters beyond visibility remain specified by
LLP 0080 but are not yet authorable: v1 `defineRelationalQuery` admits no
residual root filters.

## Design reference: one bounded child page

`defineBoundedChildrenQuery` is present for the LLP 0110 conformance program.
A contributor source build advertises it experimentally only when the tracked
atomic local carrier matches the receipt and exact implementation bytes, and a
requiring artifact acknowledges it. Public runtime packages, remote services,
and hosted targets retain a structured GAP: the public package loader does not
yet verify `PackageCapabilityAttestationV1`. Do not select it for a deployed
package based on source-build code presence.

The source-build local executor is not declaration-only:
`node demos/signal-desk/tests/snapback-extras.mjs` exercises owner,
invisible, missing, and inactive parents plus a two-page `sbbc1` traversal
against the persisted server. That local proof is green; the remaining GAP
is the Spec's publication lifecycle and cross-target evidence.

The reviewed declaration makes the security and work proof explicit:

- the parent visibility is `owner(field)` or `public-read`;
- the parent and child tables' declared `.visibility(...)` policies are
  independently stamped and intersected with parent/through-parent scope;
- the child relationship is a required typed parent id plus a required
  `v.relationIncarnationOf(...)` stamp owned by the framework;
- the named child index is exactly
  `[foreignKey, relationIncarnation, ...ascendingOrderFields]`;
- the child projection includes `_id` and every order field;
- `take` is 0–1024, with at most `take + 1` physical index entries examined;
  `take: 0` performs no child read;
- parent deletion retains but hides orphan children, and recreating the same
  application id cannot revive them;
- missing and invisible parents return the same discriminator row:
  `{kind: "absent", parent: null, children: [], continuation: null}`;
- visible pages use the AEAD-protected `sbbc1` continuation inside the
  computed row; the top-level query cursor remains absent; and
- only the cursor-free first page is `live_replace`. Cursor-bearing
  subscribe/resume refuses.

A restricted parent or child table uses conservative whole-result replacement
on any commit so a policy-relevant change cannot be missed.

Central inserts, buffered handlers, seed, migration, import, and restore all
stamp the protected relation field from a physically present active parent.
Application attempts to insert or patch that field refuse. Moving a foreign
key re-derives the stamp; moving to a missing or inactive parent refuses.

The v1 cursor is not an offset or raw order key. It is a 1,024-byte-capped
XChaCha20-Poly1305 credential binding app/database/target, authorization
stream, function and normalized plan, parent id/incarnation/version,
authority partition, order schema, boundary values, and child `_id`.
Malformed or cross-boundary use is uniformly invalid; a valid credential
whose parent or authorization stream changed requires a first-page restart.

## Anti-patterns

- Do not build a relational plan merely to re-fetch exact ids or complete
  unique keys the handler already has. Use the bounded
  [`ctx.db.getMany` / `ctx.db.uniqueMany` batch-read surface](./queries.md#batch-exact-lookups-in-one-host-call)
  for that imperative hydration shape.
- Do not hand-author a relation-incarnation value or expose it as an argument.
- Do not group an unbounded all-child feed in the client and call it bounded.
- Do not authorize children after applying the page limit.
- Do not treat the experimentally gated builder as a positive target
  capability.

---

<!-- snapback-guide-source: guide/backend/snapshot-batches.md -->
---
title: Snapshot batches
id: backend.snapshot-batches
order: 27
audience: agent-first
capabilities: [backend.snapshot-batch-v1]
authorities: [llp/0135-sequence-allocation-and-snapshot-batch.spec.md, llp/0157-composition-algebra-and-completeness.spec.md, llp/0110-bounded-children-and-activity-patterns.spec.md, llp/0080-portable-relational-queries-and-projections.rfc.md, llp/0166-local-persistent-store.spec.md, crates/snapback-engine/src/manifest.rs, crates/snapback-engine/src/local.rs, crates/snapback-sync/src/snapshot_batch_cursor.rs, packages/snapback-codegen/define.mjs]
examples: [packages/snapback-codegen/relation-activity-authoring.test.mjs, packages/snapback-codegen/snapshot-batch-v2-authoring.test.mjs, demos/fleet-observatory-move1]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:21e047f9a0382245b33c96da4b91b541f81b8de4c5b93f131512a7da792745c4
---

# Snapshot batches

> **Experimental local target.** `snapshot_batch_v1` (all-bounded-children
> tuples, one `sbsb1` continuation) and `snapshot_batch_v2` (tuples that
> include relational join nodes, one `sbsb2` continuation; registered
> 2026-08-06, LLP 0157 v0.11) are supported by the contributor local
> SQLite/Ibex target only. The remote-service manifest records both as
> explicit capability gaps, and hosted targets and public runtime packages do
> not claim them. An artifact must acknowledge the profile capability it uses
> plus every composed experimental class — `bounded_children_v1` whenever a
> bounded-children node appears; `relational_query_v1` is stable and never
> needs acknowledgment. Codegen emits these acknowledgments with the
> generated artifact.

`single_table_v1` is a separate experimental sibling selected automatically
for qualifying public authority-independent declarative live queries. It is
single-node-only and therefore cannot be placed inside a snapshot batch; its
Arm A retained answer and QMK adoption rules are documented under
[offline retention](../sync/offline-and-retention.md).

Use `defineSnapshotBatchQuery` when one screen needs several independently
bounded lists from one authoritative snapshot. Build each node with
`defineBoundedChildrenQuery` or `defineRelationalQuery`, then pass a static
tuple of 2–8 nodes. Codegen selects the profile from the node classes, not
from a flag: an all-bounded-children tuple is `snapshot-batch.v1`; any tuple
containing at least one relational node is `snapshot-batch.v2`:

```js source=packages/snapback-codegen/relation-activity-authoring.test.mjs
export const boardView = defineSnapshotBatchQuery({
  nodes: [incidentTasks, incidentTasks, incidentTasks],
});
```

The host executes every node against one pinned snapshot in declaration order.
That order cannot affect the result. Nodes that have the same parent table,
typed parent argument, and complete visibility declaration share one parent
point read and visibility evaluation; equal runtime IDs under different
bindings do not deduplicate.

## Mix relational joins into the batch (`snapshot-batch.v2`)

A dashboard screen often needs a bounded join — message plus sender, event
plus vehicle — next to bounded child lists. `snapshot-batch.v2` admits a
static mixed tuple of complete `defineBoundedChildrenQuery` and
`defineRelationalQuery` nodes, with **at least one relational node**,
evaluated at the same single pinned snapshot. Each node keeps its own class's
complete declaration — visibility, index, order, `take`, projection —
unchanged:

```js source=packages/snapback-codegen/snapshot-batch-v2-authoring.test.mjs
export const eventActors = defineRelationalQuery({
  root: events,
  joined: actors,
  join: [{ root: 'actorSlug', joined: 'slug' }],
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'public-read' },
    output: 'owner',
  },
  projection: { title: { root: 'title' }, actorName: { joined: 'name' } },
  take: 3,
  rootIndex: 'by_owner_sequence',
  joinedIndex: 'by_slug',
});
export const mixedView = defineSnapshotBatchQuery({ nodes: [boardCards, eventActors, boardCards] });
export const allRelational = defineSnapshotBatchQuery({ nodes: [eventActors, eventActors] });
```

The Fleet Observatory workload's required route is exactly one such
composite — a 100-row relational join over 250,000 protected events next to a
100-row bounded child page, with no JavaScript handler assembling or joining
result collections
([retained workload receipt](repo:tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json)):

```js source=demos/fleet-observatory-move1/snapback/functions.mjs
export const fleetObservatory = defineSnapshotBatchQuery({
  nodes: [latestEventsWithVehicles, vehicleRollupPage],
});
```

Generated artifacts acknowledge the composed experimental capabilities
exactly — `snapshot_batch_v2` always, `bounded_children_v1` only when a
bounded-children node is present:

```js source=packages/snapback-codegen/snapshot-batch-v2-authoring.test.mjs
  assert(mixed.requiredCapabilities.includes('snapshot_batch_v2'));
  assert(mixed.requiredCapabilities.includes('relational_query_v1'));
  assert(mixed.requiredCapabilities.includes('bounded_children_v1'));
  assert(allRelational.requiredCapabilities.includes('snapshot_batch_v2'));
  assert(!allRelational.requiredCapabilities.includes('bounded_children_v1'));
  assert(manifest.acknowledgedExperimentalCapabilities.includes('snapshot_batch_v2'));
```

### Sealed parents, visible empty joins

Sealing runs only through bounded-children parents: if any declared parent is
missing or invisible, the whole mixed tuple is the byte-identical
`absent` row, disclosing no sealing node, count, or cause. A relational node
never seals — an authorized join that matches nothing is a **visible empty
page**, and missing or invisible joined rows keep the node's `inner`/`left`
semantics. An invocation-level authorization refusal of a relational node
refuses the whole composite; it is never recoded as parent absence. An
all-relational tuple has no parent, so its `absent` arm is statically
unreachable — but the declared result contract keeps the same two-arm
envelope in every profile, so the envelope shape never leaks the tuple's
class mix.

### Joined-side work accounting

The composite work ceiling is a static fact of the normalized plan. Each
bounded-children node examines at most `take + 1` child-range entries plus
one point read per deduplicated parent. Each relational node examines at most
`take` root-range entries with no lookahead — a page consuming fewer than
`take` roots is terminal — plus **exactly one joined-side unique-index lookup
per consumed root**, including roots an `inner` join later omits, so at most
`take` joined lookups per relational node per page. Summed node `take` stays
at most 1,024.

### Budget rule for relational order fields

The `sbsb2` cursor budget is proved before the first storage read, so a v2
relational node's declared root order fields must come from the closed
template set: a portable string or a table-scoped id carrying a
storage-enforced `maxEncodedBytes` declaration (the
`asc('field', { maxEncodedBytes: n })` order syntax —
[bound string order fields](./sequences.md#bound-string-order-fields)), a
JavaScript-safe integer, or a boolean. Declaring any other order-field type — a float (`v.real()`),
`principal`, or `assetRef` — refuses composition at establishment with
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED`; the node's standalone
admission is unchanged.

### Not retained, by design

Both profiles classify as `retention:"none"`: cursor-free-first-page
`live_replace` only, table-granular resnapshot over the union of every node's
declared dependency set when all node tables are public-read. Every bounded or
relational node also carries each source table's declared visibility policy.
If any node policy is restricted, invalidation conservatively resnapshots on
any commit until exact policy-dependency matching is available. There is no
`live_delta` and **no retained composite** — a batch never renders offline. If
a screen needs offline rendering, retain the owner-scoped relational query
standalone (that class is retainable) and keep the composite for the online view
([offline retention](../sync/offline-and-retention.md)).

## Result and continuation

The result is always one row. It is either a sealed absence or the exact
declaration-ordered tuple of cursor-free node pages:

```ts fragment reason="closed result shape from LLP 0135; illustrative generic aliases"
type SnapshotBatchRow<Nodes extends readonly unknown[]> =
  | { kind: "absent"; nodes: null; continuation: null }
  | { kind: "visible"; nodes: Nodes; continuation: string | null };
```

If any bounded-children parent is missing or invisible, the whole result is
the same `absent` row. No partial tuple or sealing node index is disclosed.
Parent visibility is checked before the cursor, so a hidden parent with
malformed cursor bytes still returns the sealed absence.

The visible row has no inner node continuations. Its one opaque continuation
starts with the profile's cursor-family prefix — `sbsb1.` for v1, `sbsb2.`
for v2 — and carries every node's terminal or boundary state under LLP 0157's
exact shared cursor grammar. Pass it back as the `cursor` argument.
A continuation page is a new invocation and therefore a new pinned snapshot;
the cursor detects parent incarnation/version or stream changes and asks the
caller to restart (`SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED`) rather than
pretending the prior snapshot still exists. A relational node has no parent
point-read on resume: its revalidation is the fail-closed plan, argument,
authority, epoch, and order-schema check, and its resumed root window keeps
LLP 0080's no-skip/no-duplicate guarantee for untouched roots. Cross-family
presentation refuses — `sbsb1` bytes in a v2 composite, `sbsb2` bytes in a
v1 composite, or any standalone `sbbc1`/relational cursor in either — with
`SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`; per-node cursor identity does not
survive composition.

## Live behavior

Only the cursor-free first page is live. Subscribe normally to receive
whole-batch `live_replace` frames when any node table changes — in a mixed
tuple that includes every relational node's root and joined tables. With any
restricted node-table policy, any commit may produce the conservative
replacement described above. A
subscribe request carrying a cursor refuses before storage access with
`SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED`.

## Closed limits

- Every node is a complete admitted plan of its own class:
  `bounded-children.v1` only in v1; `bounded-children.v1` and/or
  `relational-query.v1` (at least one relational) in v2. Search, aggregate,
  imperative, and data-dependent nodes are not admitted in either profile.
- The tuple has 2–8 nodes and the sum of `take` values is at most 1,024. The
  tuple is static: no node argument may reference another node's output.
- One node still performs at most its own bounded work (see
  [joined-side work accounting](#joined-side-work-accounting)). Terminal
  bounded-children nodes re-read the parent but do not scan a child range;
  terminal relational nodes examine zero root entries and perform zero joined
  lookups.
- The `sbsb1`/`sbsb2` wire cap is 8,192 bytes and the plaintext cap is 6,099
  bytes. Establishment computes the declared worst case before parent storage
  reads; an over-budget plan refuses instead of risking an unmintable page.
- String and id order fields need storage-enforced `maxEncodedBytes`
  declarations so the cursor budget is a proof over stored values, not a
  hopeful estimate. The declaration syntax —
  `asc('field', { maxEncodedBytes: n })` on the order expression, agreement
  across all declarations for one `(table, field)`, and the
  `SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED` write-side refusal — is
  [bound string order fields](./sequences.md#bound-string-order-fields).
- Cross-page snapshot consistency is not claimed. Each invocation has exactly
  one snapshot; the coordinated cursor binds plan, arguments, authority,
  parent versions, and all node boundaries for honest resume behavior.

Codegen emits LLP 0157's normalized node/composite record and `PlanHashV1`.
The host reconstructs and exact-compares both before execution. Liveness is a
fact inside that identity record, never inferred from the plan's shape.

## Anti-patterns

- **Hand-assembling a dashboard in a JS handler** by querying and joining
  several lists imperatively. Declare one snapshot batch instead: the
  generated composite gives one pinned snapshot, sealing, and a static work
  ceiling the handler form cannot claim. Fleet Observatory's required route
  is one v2 tuple with no JS assembly.
- **Feeding one node's output into another node's arguments.** The tuple is
  static; data-dependent invocation refuses.
- **Retaining or replaying a composite offline.** Retention is `"none"` by
  design; retain the owner-scoped relational query standalone instead.
- **Subscribing with a cursor.** Only the cursor-free first page is live;
  paginate with ordinary calls.

---

<!-- snapback-guide-source: guide/backend/text-search.md -->
---
title: Portable indexed text search
id: backend.text-search
order: 27
audience: agent-first
capabilities: [backend.text-search, authority.profile.v1]
authorities: [llp/0073-portable-full-text-search.rfc.md, llp/0131-structured-argument-contracts.spec.md, llp/0240-application-authority-profiles.rfc.md, crates/snapback-types/src/search/types.rs, crates/snapback-kernel/src/search/sqlite.rs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-client/index.mjs, packages/snapback-client/search.mjs]
examples: [demos/rbac, demos/signal-desk]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:5e680f348cb234fc1cc9f17ced62ccdbd88940e0a57db43733e514c47e2e81f9
---

# Portable indexed text search

> **Local target only.** Indexed text search requires the stable
> `full_text_search_v1` capability. The local SQLite target reports the exact
> analyzer, parser, scorer, cursor, and nonclaims in its capability manifest.
> PostgreSQL, Cloudflare, live search, offline search, sensitive fields, and
> native FTS acceleration are not claimed.

Use a search index when a query must match words, phrases, or prefixes without
scanning application rows in a JavaScript handler. Search is a closed host
plan: source mutations maintain canonical term, position, and source records
inside the same SQLite transaction, and queries send a structured AST rather
than SQL, FTS, or provider syntax.

## Declare an index

Add `searchIndex` to an ordinary bounded table. A semantic version names the
meaning of its analyzer, fields, weights, visibility, stored result fields,
and ordering. Changing any of those facts requires a new semantic version and
rebuild.

```js source=demos/signal-desk/snapback/schema.mjs
export const incidents = defineTable({
  title: v.string(),
  summary: v.string(),
  severity: v.string(),
  status: v.string(),
  commanderId: v.string(),
  createdAt: v.integer(),
  updatedAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_updated', ['updatedAt'])
  .searchIndex('search_incidents', {
    semanticVersion: 'signal-desk-incidents.v1',
    textFields: {
      title: { weight: 8, classification: 'public' },
      summary: { weight: 4, classification: 'public' },
      severity: { weight: 2, classification: 'public' },
      status: { weight: 2, classification: 'public' },
    },
    fieldClassifications: {
      commanderId: 'public',
      createdAt: 'public',
      updatedAt: 'public',
    },
    equalityFilters: ['severity', 'status'],
    storedFields: [
      'commanderId',
      'createdAt',
      'severity',
      'status',
      'summary',
      'title',
      'updatedAt',
    ],
    highlightFields: ['summary', 'title'],
    visibility: { kind: 'public-read' },
  })
  .sync();
```

Text weights are integers from 1 through 64. Every participating field needs
an explicit classification: text fields carry it beside their weight, while
`fieldClassifications` must classify exactly the participating equality,
stored, or owner fields that are not text fields. `public-read` admits only
public fields. Visibility is required: omission refuses generation with
`SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED`, so public release is always an
affirmative declaration. Owner search instead declares
`visibility: { kind: 'owner', field: 'ownerId' }`; the field must be a required
string or principal and every query is pushed into the server-resolved
effective user's partition.

Membership-visible search (LLP 0073's 2026-08-01 amendment, commissioned by
LLP 0100 §8a) declares
`visibility: { kind: 'membership', declaration, resourceField, roles }`:
`declaration` names a resource-scoped membership declaration, `resourceField`
a required scalar field on the indexed rows, and `roles` (optional) narrows
which seats are admitted. The generated search function then requires one
equality-bound resource argument (`resourceArg` on `defineSearchQuery`), so
every invocation searches exactly one resource's partition; the caller's seat
is resolved in the same snapshot as the posting recheck. A caller with no
admitted seat gets the empty page, byte-identical to a nonexistent resource;
a continuation minted before a seat revocation fails with the uniform
`SNAPBACK_SEARCH_CURSOR_RESTART` before any candidate is evaluated. Searching
several resources means iterating your own seats — multi-seat union search is
deliberately rejected. Other relation-derived visibility shapes remain
unaccepted.

When `declaration` names an `authorityProfile()`, codegen derives the effective
role set from that profile's canonical `roleLattice` and lowers it directly
into this same membership visibility plan. The search function carries the
profile `{ id, generation }` dependence; no second visibility-policy object is
generated. This keeps roster listing and search on the same non-enumeration
boundary while reusing the existing indexed membership check and revocation
semantics. The RBAC demo's `searchAnnouncements` acceptance proves active
member results, byte-identical outsider/missing-scope pages, and blank results
after revocation.

Export the operation with
`defineSearchQuery({ table: incidents, index: 'search_incidents' })`. It is an
ordinary `Query`, deliberately not a `LiveQuery`. A separately authored
`defineLiveSearchQuery` successor exists (Accepted LLP 0136, first-page-only,
no membership indexes), but it is gated on `live_full_text_search_v1`, which
the local target declares as a capability gap — codegen refuses such an
artifact with `SNAPBACK_CAPABILITY_UNSUPPORTED`, and live search remains a
nonclaim of this page.

A table that declares a search index may also declare that successor's
table-wide live-subscription ceiling now:
`defineTable(...).searchLiveLimits({ maxLiveSubscriptionsPerTable })` takes an
integer from 1 through 128 (default 128), may be declared once per table, and
requires at least one `searchIndex` on the same table — declaring it without
one refuses generation with `SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID`. The
declaration is projected into the generated manifest today; its enforcement
belongs to the gated live-search capability and is not a live-search claim.

## Search from a client

`parseSearchQueryV1` turns convenience text into the closed AST before the
request. `client.search` maps the normal query transport `{rows, cursor}` into
`{items, cursor, hasMore}`. The generated operation reference closes each
item's `fields` over exactly that index's `storedFields` and brands `rowId` for
the source table, so consumers neither cast stored values nor treat arbitrary
keys as present. Optional stored source fields are materialized as present
`null` values and therefore generate `T | null`, matching runtime storage.

For a membership-visible index, pass its generated `resourceArg` beside
`query` in the same options object, for example
`client.search(api.searchMessages, { roomId, query })`. The generated type
requires that resource key. The reference binds the shared search-request
grammar separately from the complete operation arguments, so the typed
wrapper accepts same-generation plain and resource-scoped references while
the ordinary closed argument validator still checks the resource value.

`resourceArg` also owns the same-named option slot. In particular, a generated
resource argument named `userId` becomes application data; it cannot
simultaneously carry dev-mode per-call auth through `options.userId`, and the
client deliberately omits that auth assertion. Use session/coordinator-owned
authority for that invocation, or rename the resource argument and regenerate
the references. Do not rely on one option value to mean both resource identity
and caller identity.

```ts source=demos/signal-desk/src/backends/snapback.ts
  async searchIncidents(term: string) {
    const result = await this.client.search(api.searchIncidents, {
      query: parseSearchQueryV1(term, {
        fields: ['title', 'summary', 'severity', 'status'],
      }),
    });
    return result.items.map((item) =>
      incident({ _id: item.rowId, ...item.fields }));
  }
```

The parser admits required terms and phrases, one flat `OR`, direct `-term`
exclusions, and one final `prefix*`. For programmatic queries, use the exported
`search.term`, `search.phrase`, `search.prefix`, `search.any`, `search.not`,
`search.filter`, and `search.all` constructors.

Results order by exact integer score descending, then opaque row id ascending.
Highlights are plain text with scalar ranges; the caller owns escaping and
markup. A continuation is AEAD-protected, caller/index/query/limit-bound, and
valid for at most 120 seconds. Pagination is current-keyset, not a retained
snapshot.

## Handle bounded refusals

- `SNAPBACK_SEARCH_QUERY_INVALID`: malformed AST, unsupported syntax, or a
  declaration-bound limit was violated.
- `SNAPBACK_SEARCH_WORK_LIMIT`: the caller's visible posting partition exceeded
  its deterministic exact-ranking or prefix ceiling; no partial page is
  released.
- `SNAPBACK_SEARCH_CURSOR_RESTART`: identity, policy, generation, query, limit,
  key generation, or TTL no longer matches. Restart at page one.
- `SNAPBACK_SEARCH_INDEX_UNAVAILABLE`: the target/profile/index is not active.
- `SNAPBACK_SEARCH_INDEX_CORRUPT`: a posting failed its authoritative
  source/version/owner recheck. Treat source data as authoritative and rebuild.

## Anti-patterns

- Do not collect rows and call `includes`, a regex, or a locale-sensitive
  lowercase function in a handler.
- Do not pass raw SQLite FTS, PostgreSQL `tsquery`, or a provider search string.
- Do not expose count, facets, suggestions, or autocomplete as if v1
  authorized them; it does not.
- Do not subscribe to a search operation or retain it offline.
- Do not use scores as authorization, moderation, pricing, or other correctness
  inputs.

---

<!-- snapback-guide-source: guide/backend/sequences.md -->
---
title: Scoped sequences
id: backend.sequences
order: 28
audience: agent-first
capabilities: [backend.sequences]
authorities: [llp/0113-qualification-and-publication-authority.spec.md, llp/0128-popular-app-storage-scale.research.md, llp/0135-sequence-allocation-and-snapshot-batch.spec.md, llp/0157-composition-algebra-and-completeness.spec.md, crates/snapback-engine/src/local-sequence-allocation-publication.v1.json, crates/snapback-engine/src/manifest.rs, crates/snapback-engine/src/runtime.rs, crates/snapback-kernel/src/storage.rs, tests/conformance/sequence-allocation-publication-v1.receipt.json, packages/snapback-codegen/define.mjs, packages/snapback-codegen/sequence-authoring.test.mjs, packages/snapback-contract/derived-overlay.test.mjs, packages/snapback-harness/ctx-bootstrap.js, demos/improvement-sweep/arms/a6-snapback-web/evidence/app/acceptance.a6.mjs]
examples: [demos/improvement-sweep/arms/a6-snapback-web/evidence/app]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-04
reviewed-authorities-digest: sha256:339769af563c7edf2b98728e26b469c9b33b7635fa8666b193a2ba63e7a578cf
---

# Scoped sequences

> **Local target only.** Contributor-source builds of the local dev/test target
> publish `sequence_allocation_v1` at Experimental maturity. Generated
> applications acknowledge that dependency. Public runtime packages and hosted
> targets retain a structured GAP because neither has its required publication
> authority or target-specific evidence.

The accepted surface is intended for dense, monotonic human-facing numbers such
as JOB-42 without an application-owned read/increment/write counter. The local
substrate declares every counter on the JS mutation, including its scope table
and the exact way the handler may reach that scope:

```js source=packages/snapback-codegen/sequence-authoring.test.mjs
const declaration = [{
  name: 'jobNumber',
  scopeTable: 'orgs',
  scopeAccess: { declaration: 'orgMembers', roles: ['dispatcher', 'operator'] },
}];
const direct = defineJsMutation({
  writes: ['jobs'],
  sequences: declaration,
  handler: async (ctx, args) => ctx.sequence.allocate('jobNumber', args.orgId),
});
```

`scopeAccess` is either a membership declaration plus admitted roles or the
literal `public.v1`; there is no implicit scope reach. The call names the scope
row itself: `ctx.sequence.allocate(counterName, scopeId)`. This makes the
serialization and authorization unit part of the API.

## Commit and replay behavior

A mutation may allocate once. The counter advance, application writes, result,
and settlement commit atomically. Aborts do not burn numbers. Concurrent
allocators serialize at the scoped counter or lose with an effect-free
mutation conflict, so committed values stay dense and monotonic. An Exact
mutation replay returns the retained result without advancing again.

The scope row's relation incarnation is part of counter identity. Deleting and
recreating the row starts a new sequence at 1, even when the application row id
is reused. The last admitted value is `Number.MAX_SAFE_INTEGER`; later
allocation refuses with `SNAPBACK_SEQUENCE_EXHAUSTED` and commits nothing.

Codegen emits the Experimental capability requirement and acknowledgment. The
local target admits that requirement only when its compiled qualification
carrier matches the §5.1 receipt and bound source bytes. A public-package build,
hosted target, altered carrier, or stale receipt stays support-false. Allocation
facts are settlement evidence: direct receipts carry the exact counter, scope,
incarnation, and value, while ordinary live fanout strips them. A sequence-only
migration mutation may use `writes: []`; do not invent an application write
merely to advance the framework counter.

## Bound string order fields

When a bounded query orders by a string, declare the storage-enforced UTF-8
width in the order expression, for example
`asc('sequenceLabel', { maxEncodedBytes: 32 })`. All declarations for one
`(table, field)` must agree. Activation checks existing rows and every central
writer rejects oversized values with
`SNAPBACK_ORDER_FIELD_MAX_ENCODED_BYTES_EXCEEDED`.

## Current limits

- Only contributor-source builds of `local-dev-sqlite-ibex` publish
  `sequence_allocation_v1`. Public packages, remote-service profiles,
  conformance twins, and hosted targets remain structured GAPs.
- Publication is Experimental. LLP 0113 governs support publication but cannot
  mint Stable maturity; that would require a separate digest-bound LLP 0134
  promotion act.
- One mutation can allocate at most once.
- A counter's current or next value is never readable through the API.
- Lane-L local execution of allocating mutations remains out of scope; do not
  claim local-execution parity.
- Historical application counters need an explicit, reviewed migration. The
  A6 fixture records its literal seed and reset/restore history through
  ordinary committed sequence allocations; there is no authored start-value
  escape hatch.
- Snapshot-batch composition is a separate LLP 0135 Part 2 capability. The
  experimental local target supports it independently; see
  [Snapshot batches](./snapshot-batches.md). Sequence qualification did not
  change that capability.

---

<!-- snapback-guide-source: guide/backend/schema-evolution.md -->
---
title: Evolve a sessions schema without discarding data
id: backend.schema-evolution
order: 29
audience: agent-first
capabilities: [backend.schema-evolution]
authorities: [llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0081-reviewed-storage-evolution-and-migrations.rfc.md, llp/0160-ideal-migration-experience.rfc.md, crates/snapback-types/src/auth/mode.rs, crates/snapback-cli/src/cli.rs, crates/snapback-kernel/src/storage.rs, packages/snapback-cli/index.mjs]
examples: [packages/snapback-cli/sessions-dev-loop.test.mjs, crates/snapback-cli/src/cli/tests.rs, crates/snapback-kernel/src/storage/tests.rs]
status: current
targets: [local]
maturity: shipped
since: 0.1.21
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:0aa239149530db05c541bcb02491fd9d2f69e8aa558e1b34e8a293ba11aeaa7a
---

# Evolve a sessions schema without discarding data

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The ordinary sessions-mode loop is: edit the schema, let generation produce a
complete candidate pair, and let the packaged `snapback dev` owner advance the
deployment. Keep the database. A deployment-identity refusal is a safety fence
around that loop, not a request to delete local state.

## Change schema, then let the identity rotate

Additive changes such as a new table, index, or optional field can load through
the running watch loop:

```sh
snapback dev snapback --db .snapback/dev.sqlite3
```

Edit while that process owns the server. Generation creates one coherent
schema/function pair; the running load path preflights and activates it. If the
managed process must restart, it owns the cold successor handshake described
below. Raw `snapback start` is a lower-level harness surface and does not own
this authoring recovery loop.

A schema edit changes `schemaHash`. Because the manifests are one coherent
pair, it also changes their shared `inputsHash`; `bundleHash` identifies the
function-manifest content and may rotate with shared generated inputs even
when the handler you were thinking about did not change. A function-only edit
can rotate `bundleHash` while leaving `schemaHash` unchanged. Compare the
whole identity, never one digest in isolation.

## What the sessions pin means

A settled sessions database records the exact complete deployment it admitted:

| Field | What it identifies |
| --- | --- |
| `schemaVersion`, `authMode`, `appId` | The artifact protocol, sessions mode, and application namespace. |
| `schemaHash` | Canonical schema-manifest content. |
| `bundleHash` | Canonical function-manifest content. |
| `inputsHash` | The shared schema/function input closure; both halves must match it. |

The pin is executable-authority custody. It prevents an arbitrary cold binary
from opening an existing sessions store with a different half-pair. It is not
a hash of SQLite bytes, not a claim that application rows are unchanged, and
not a runtime/codegen compatibility stamp. The `expectedDeployment` in a
startup diagnostic is the database's settled pin; `observedDeployment` is the
complete startup carrier that just passed enough preflight to be compared.
Neither object contains a bearer or another secret.

Every settled sessions start requires the single closed startup carrier. A
missing or unreadable carrier produces
`SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED`; a malformed, incoherent, or
different pair produces `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`. Do not hand
edit either hash to make them agree.

## Let the packaged successor path advance the pin

The packaged dev owner reacts only to a structured mismatch that includes a
preflighted observed identity. It stops the refused child and retries before
listener bind with the managed-only successor opt-in. Native startup then
preflights the complete pair again under the closed transition guard, validates
storage compatibility, atomically advances the manifest and pin, and publishes
functions only after commit. A success event has state
`startup-successor-activated` and carries the old and new identities.

This is not subset or superset admission. The whole candidate pair advances,
including comment-only function changes. If preparation, capability, schema,
or storage validation fails, startup remains closed, the old pin stays active,
and the existing database is not discarded. Fix the candidate and rerun the
managed loop.

## Recover from SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH

Use this recipe when regeneration happened while the sessions server was
stopped, or a failed/partial attempt left the files and pin on different
generations:

1. Stop retry churn. Preserve the database, its auth sibling files, the
   current sources, and the last generated schema/function pair whose identity
   equals `expectedDeployment`. Do not edit the database or manifest hashes.
2. If the previous pair was overwritten, restore the previous sources from
   version control and regenerate them into a separate preserved directory.
   Verify its complete identity equals `expectedDeployment`.
3. Boot that exact predecessor carrier against the existing store. This
   restores a running authority that agrees with the pin; it does not roll
   application rows back.
4. Put the intended additive schema and functions back, then run them through
   the packaged `snapback dev` watch/restart path. Let its
   `startup-successor-activated` event prove the guarded pin advance.
5. Rerun the acceptance process against the preserved rows and inspect the
   new generated identities. Only then retire the predecessor carrier.

The conformance witness in
[`sessions-dev-loop.test.mjs`](repo:packages/snapback-cli/sessions-dev-loop.test.mjs)
does exactly this boundary: it writes a row under the predecessor, restarts on
a successor, observes `startup-successor-activated`, and proves the row
survived. It also proves that an invalid successor refuses while the old data
remains available.

## Recover after a partial load materialized data

A deployment recovery does not make a destructive field change additive. For
example, if one generation admitted an optional object field and application
code wrote object values, changing that same field directly to an array must
refuse with `SNAPBACK_SCHEMA_FIELD_RETYPED`. Likewise, adding a required field
to populated rows refuses with
`SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED`.

Preserve the store and boot the exact carrier named by `expectedDeployment` as
above. Then choose one of two valid continuations:

- introduce a new optional field, deploy it through the managed successor
  path, backfill with an ordinary bounded mutation, and only later retire the
  old field through a reviewed migration; or
- author explicit migration intents and use the
  [reviewed migration loop](./migrations.md) to preview, approve, rehearse,
  apply, and verify the retype/backfill.

Do not delete the database to make the new type load, and do not patch the
stored JSON manually. The data already materialized under the predecessor is
the reason the applier refuses; preserving it is the recovery objective.

## Diagnose the four boundary codes

| Code | Meaning and next action |
| --- | --- |
| `SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED` | A settled sessions start has no readable trusted complete-pair carrier. Restore the exact generated carrier and retry. |
| `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` | The carrier differs from the pin or is not a coherent closed pair. Read `expectedDeployment`/`observedDeployment`; use the exact-carrier then managed-successor recipe above. |
| `SNAPBACK_SCHEMA_FIELD_RETYPED` | Existing storage makes a direct field retype non-additive. Preserve the predecessor and route through a new-field backfill or reviewed migration. |
| `SNAPBACK_SCHEMA_REQUIRED_FIELD_BACKFILL_REQUIRED` | Populated rows lack the proposed required value. Add it as optional and backfill, or declare the reviewed migration. |

For seed identity changes, use [versioned seeds](./versioned-seeds.md). For
renames, drops, retypes, required-field backfills, or domain narrowing, use
[reviewed migrations](./migrations.md). Those are storage-evolution decisions;
the sessions successor path is the safe carrier for a candidate after its
storage semantics are valid.

---

<!-- snapback-guide-source: guide/backend/vector-search.md -->
---
title: Portable exact vector search
id: backend.vector-search
order: 29
audience: agent-first
capabilities: [backend.vector-search]
authorities: [llp/0132-vector-search.spec.md, crates/snapback-types/src/vector/types.rs, crates/snapback-kernel/src/vector/query.rs, crates/snapback-kernel/src/vector/sqlite.rs, crates/snapback-engine/src/manifest.rs, packages/snapback-codegen/define.mjs, packages/snapback-client/index.mjs]
examples: [packages/snapback-codegen/vector-authoring.test.mjs, packages/snapback-client/package.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:39af92584e57debdcb2baa5c38f3f7b19dac6a588f5fefec6e5ba8d7e77d1dcd
---

# Portable exact vector search

> **Local target only.** Exact vector search requires the experimental
> `vector_search_v1` capability and an explicit experimental-capability
> acknowledgment. The local SQLite target reports the complete arithmetic,
> bounds, visibility, storage, and corruption facts. Hosted targets,
> PostgreSQL, ANN, live and offline search, and embedding computation are not
> claimed.

Use a vector index when an application already has fixed-width embeddings and
needs deterministic nearest-neighbor retrieval inside Snapback's ordinary
query snapshot. The v1 host plan performs a bounded exact scan; it never calls
an embedding model and never substitutes an approximate index.

## Declare a vector field and index

`v.vector(dimensions)` is distinct from an ordinary array, admits 1 through
4,096 binary64 components, canonicalizes negative zero to positive zero, and
rejects non-finite values or components outside ±2^100. A vector index binds
the field, dimensions, metric, classifications, visibility, filters, stored
fields, tie direction, and corpus ceiling into one semantic version.

```js source=packages/snapback-codegen/vector-authoring.test.mjs
  const documents = defineTable({
    embedding: v.vector(3),
    category: v.optional(v.string()),
    title: v.string(),
  }).vectorIndex('by_embedding', {
    semanticVersion: 'documents.embedding.v1',
    vectorField: 'embedding',
    metric: 'l2sq',
    fieldClassifications: {
      embedding: 'public',
      category: 'public',
      title: 'public',
    },
    equalityFilters: ['category'],
    storedFields: ['title'],
    visibility: { kind: 'public-read' },
    tieBreak: 'id-asc',
    maxIndexedVectorsPerPartition: 128,
  });
  defineSchema({ documents });
```

Use `visibility: { kind: 'owner', field: 'ownerId' }` for owner-private
retrieval. Snapback derives the effective principal on the server, pushes it
into the posting partition, and rechecks the authoritative source row before
release. Visibility is required: omission refuses generation with
`SNAPBACK_VECTOR_INDEX_VISIBILITY_REQUIRED`, so `public-read` is always an
affirmative declaration. `public-read` permits only public participating fields. Owner indexes
may use private fields, but every participating role rejects `sensitive` and
`forbidden`; membership-derived visibility is not a v1 shape.

Declare the ordinary query with
`defineVectorQuery({ table: documents, index: 'by_embedding' })`. Generated
argument types fix the vector dimension and the closed equality-filter field
set. Generated result types expose only `{ rowId, distance, fields }`, with
`fields` closed over the index's `storedFields`; there is no cursor.

## Retrieve nearest rows

Call `vectorSearch` with the generated operation reference. `k` defaults to 10
and is bounded to 64. Filters are exact scalar equality predicates, each
declared field may occur once, and at most eight filters are admitted.

```js source=packages/snapback-client/package.test.mjs
    const page = await vectorClient.vectorSearch(vectorRef, {
      vector: [1, -0, 3],
      filters: [{ field: 'category', op: 'eq', value: true }],
    });
```

A filter `value` may be any string, finite real, or boolean — that closed
union is the whole admitted contract, per filter field, regardless of the
stored field's declared type. Equality is exact and typed, so a value whose
type does not match the stored field (the test fixture above filters the
string field `category` with `true`) is admitted by the contract but matches
no rows; it is not a validation error. Match the stored field's type when you
intend the filter to select anything.

`l2sq` ranks ascending squared Euclidean distance; `dot` ranks descending dot
product. Both use `snapback-vector-distance-v1`: strict sequential binary64
arithmetic with round-to-nearest-ties-even, gradual underflow, and no FMA,
reassociation, extended intermediates, or reduction reordering. Equal distance
bits resolve by the declared canonical row-id direction. Distance is
informational and must not become an authorization, moderation, pricing, or
other correctness input.

For cosine-like ranking, normalize nonzero stored and query embeddings in the
same application-owned producer and declare `dot`. That gives portable dot
ranking over the admitted components; it does not add a `cosine` metric or make
Snapback an embedding producer.

## Stay inside the exact-work envelope

Generation requires
`dimensions × maxIndexedVectorsPerPartition ≤ 2^26`, with an absolute corpus
ceiling of 65,536 vectors per visibility partition. Source mutations maintain
the active shadow generation synchronously in the same SQLite transaction.
An insert or ownership transfer into a full destination refuses atomically;
maintenance failure rolls back the source mutation too.

- `SNAPBACK_VECTOR_VALUE_INVALID`: an authored or stored vector violates the
  dimension/component contract.
- `SNAPBACK_VECTOR_QUERY_INVALID`: the invocation vector, `k`, or filter set
  violates its generated contract.
- `SNAPBACK_VECTOR_CORPUS_BOUND`: a destination partition would exceed its
  declared bound.
- `SNAPBACK_VECTOR_MAINTENANCE_LIMIT`: one mutation exceeds the aggregate
  1,024-posting or 4 MiB vector-byte ceiling.
- `SNAPBACK_VECTOR_WORK_LIMIT`: derived state exceeded the declaration-proved
  exact-scan envelope; no partial result is released.
- `SNAPBACK_VECTOR_INDEX_UNAVAILABLE`: activation or a verified rebuild is
  still required.
- `SNAPBACK_VECTOR_INDEX_CORRUPT`: a digest, posting, frontier, or release
  recheck failed; the exact generation is quarantined.

## Anti-patterns

- Do not store embeddings in JSON and scan them in a JavaScript handler; that
  bypasses the vector value, authorization partition, work bounds, and facts.
- Do not treat `vector_search_v1` as ANN. Its advertised accelerator is
  exactly `none`; a future approximate profile needs a separate capability and
  recall evidence.
- Do not subscribe to a vector query, paginate it, retain it offline, or infer
  a hosted/PostgreSQL claim from the local SQLite implementation.
- Do not log query-vector components. They are custody-bearing caller content;
  telemetry records only bounded shape and digest facts.

---

<!-- snapback-guide-source: guide/backend/migrations.md -->
---
title: Reviewed migrations
id: backend.migrations
order: 30
audience: agent-first
capabilities: [backend.migrations]
authorities: [llp/0081-reviewed-storage-evolution-and-migrations.rfc.md, crates/snapback-cli/src/cli.rs, crates/snapback-kernel/src/migration.rs, crates/snapback-kernel/src/migration_presentation.rs, crates/snapback-engine/src/local.rs, crates/snapback/tests/migration_cli_presentation_v1.rs, crates/snapback/tests/migration_corpus_v0.rs]
examples: [crates/snapback/tests/migration_cli_presentation_v1.rs, crates/snapback/tests/migration_corpus_v0.rs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:0845678e9f349bbf1f6872d176f125d4fcd113124dda99a6558eb22917bb249f
---

# Reviewed migrations

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md). Hosted approval is an LLP 0072
> control-plane operation, not the local operator record taught here.

Ordinary schema activation applies additive, unambiguous changes directly.
A **destructive or reshaping** change — renaming a field, converting its
type, adding a required field to a populated table, tightening an optional
field, narrowing a stored domain, retiring fields or tables — must not be
guessed from a schema diff. Those route through the reviewed migration loop
(LLP 0081): `snapback migrate`, a seven-verb CLI surface in which a
deterministic plan is previewed, approved by digest, optionally rehearsed
against a restore-derived instance, applied, and verified. Search terms that
land here: migration, schema migration, alter column, rename column, drop
field, backfill.

## Run the reviewed loop

Every verb is a subcommand of `snapback migrate`; the global `--json` flag
silences the default human presentation on stderr and emits only the
structured envelope on stdout:

```sh
# 1. Deterministic plan + separately digested observation. Read-only.
snapback migrate preview \
  --db app.db --schema staged-schema.json \
  --intents intents.json \
  --publication-timestamp-ms 1790000000000 \
  --out preview.json

# 2. Authenticated local operator record, digest-acknowledged.
snapback migrate approve preview.json \
  --db app.db --out approved.json \
  --acknowledge-digests '<planDigest>:<observationDigest>'

# 3. (When the plan requires it) execute the approved plan AS a rehearsal
#    against the restore-derived instance its sealed binding names.
snapback migrate rehearse approved.json \
  --schema staged-schema.json \
  --rehearsal-plan rehearsal-plan.json \
  --db restored-copy.db --out rehearsal-receipt.json

# 4. Execute the approved file by path; never regenerates a plan.
snapback migrate apply approved.json \
  --db app.db --schema staged-schema.json \
  --rehearsal-receipt rehearsal-receipt.json

# 5. The receipt-vs-journal projection check.
snapback migrate verify --operation-id <id> --db app.db
```

`preview` also accepts `--rollback-timestamp-ms` (required later for the
LLP 0081 §6 fast rollback; must be at least the publication timestamp),
`--constants` (a JSON object of named literal constants — migration
constants are explicit inputs; preview creates none), and the reviewed
ceilings `--max-affected-rows` (default 1,000,000) and
`--max-barrier-downtime-ms` (default 60,000). `approve` accepts
`--approver` (defaults to the local `$USER` principal) and
`--expires-in-ms` (default 24 hours). `apply --dry-run` validates admission
without writing.

Approval authority on the local profile is filesystem custody of the
database plus the recorded operator principal; `--acknowledge-digests` is
the non-interactive render-first authorization and must be the exact
`<planDigest>:<observationDigest>` pair the review block printed. `apply`
consumes the approved file — it never regenerates a plan, so what runs is
byte-bound to what was reviewed.

## Declare migration intents

`--intents` names a JSON array of `MigrationIntent` values. Explicit intents
take precedence; when the flag is omitted, preview derives the intent set
from the schema diff for **unambiguous, semantics-free changes only** —
renames, conversions, and required-field backfills refuse derivation and
must be declared. The closed intent vocabulary:

- `CreateTable { table }` and
  `CreateIndex { table, index, fields, unique }`.
- `AddOptionalField { table, field, fieldType }`.
- `AddRequiredField { table, field, fieldType, backfill }` — add, backfill
  with the declared expression, validate, then tighten, in that required
  sequence.
- `TightenRequired { table, field }` — validate before tighten.
- `RenameField { table, from, to, fieldType }` — add destination, copy,
  validate, tighten, then retire the source (LLP 0081 §3's rename
  representation).
- `ConvertField { table, from, to, fieldType, expr }` — a rename with a
  conversion expression (type change).
- `ConvertJsonToStructured { table, field, generation }` — preserve the field
  name by staging a full successor table generation; each formerly-JSON value
  must validate and is rewritten as canonical structured storage before the
  successor can publish.
- `CopyTableToGeneration { table, generation, fields, sourceTable }` —
  stage a successor generation and copy into it.
- `RebuildProjection { projectionId }`.
- `RetireField { table, field }`, `RetireTable { table }`, and
  `RetireGeneration { table, generation }`.

```json fragment reason="illustrative intent file; CI constructs intents programmatically in crates/snapback/tests/migration_cli_presentation_v1.rs"
[
  {
    "AddRequiredField": {
      "table": "todos",
      "field": "priority",
      "fieldType": "Integer",
      "backfill": { "Literal": 0 }
    }
  }
]
```

### Evolve `v.json()` into a structured field

Changing an installed `v.json()` field directly to `v.object(...)` or
`v.array(...)` refuses with `SNAPBACK_SCHEMA_FIELD_RETYPED`; the server cannot
claim existing bytes satisfy the stronger contract. Declare the reviewed
intent instead:

```json fragment reason="illustrative intent; table and generation are application-specific"
[
  {
    "ConvertJsonToStructured": {
      "table": "messages",
      "field": "recipientSnapshot",
      "generation": 2
    }
  }
]
```

Preview expands this to `StageTableGeneration` plus an identity `CopyTable`
covering every successor field and seals the `shadow-generation` strategy. The
copy runs the structured validator/canonicalizer, then proves row count and a
full content digest. If even one legacy JSON value is outside the new shape,
apply refuses and the predecessor generation remains authoritative. Repair the
data under its old schema, preview again, and approve the new digests; do not
hand-edit the database or weaken the destination to make apply pass.

## Rehearse against a restore-derived instance

When the plan's target profile requires it, production apply refuses without
a rehearsal receipt (`SNAPBACK_MIGRATION_REHEARSAL_REQUIRED`: "execute it
and present its receipt to production apply"). `migrate rehearse` executes
the approved production plan **as** a rehearsal against the one database its
sealed `MigrationRehearsalPlanV1` binding names — a restore-derived isolated
instance, never the production audience. Targeting anything else, production
included, refuses with `SNAPBACK_MIGRATION_REHEARSAL_INVALID`. The receipt
comes back marked as a rehearsal and is consumed by
`migrate apply --rehearsal-receipt`; it never substitutes for the production
apply receipt.

## Verify, cancel, and the unbuilt rollback

- `migrate verify --operation-id <id> --db <db>` runs the
  receipt-vs-journal projection check. The §5 data proof (expected values,
  content digests) lands with the verification wave and refuses honestly
  until then.
- `migrate cancel approved.json --db <db>` requests cancellation at the
  next admitted pre-publication boundary; a cancelled operation reports
  `SNAPBACK_MIGRATION_CANCELLED`.
- `migrate rollback receipt.json --db <db>` is **declared but unbuilt** on
  this profile: it refuses with `SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE`
  rather than guessing. Plan the explicit `--rollback-timestamp-ms`
  constant at preview time anyway — the §6 fast-rollback design requires it
  to have been an input, not an afterthought.

## Handle migration refusals

The loop's decision-shaped refusals:

- `SNAPBACK_MIGRATION_PLAN_INVALID` — the plan, observation, or intent set
  fails validation.
- `SNAPBACK_MIGRATION_APPROVAL_REQUIRED` — apply without a binding
  authenticated approval (LLP 0081 §2).
- `SNAPBACK_MIGRATION_REHEARSAL_REQUIRED` /
  `SNAPBACK_MIGRATION_REHEARSAL_INVALID` — a required rehearsal receipt is
  missing, or the rehearsal targeted a database other than its sealed
  binding.
- `SNAPBACK_MIGRATION_PRECONDITION_FAILED` — a reviewed precondition (the
  digested observation, staged function set, or compatibility-posture
  ordering) no longer holds at execution.
- `SNAPBACK_MIGRATION_CANCELLED` — a requested cancellation was admitted.
- `SNAPBACK_MIGRATION_ROLLBACK_UNAVAILABLE` — rollback is unbuilt here.

Execution- and client-facing codes you may also encounter:
`SNAPBACK_MIGRATION_PLAN_STALE`, `SNAPBACK_MIGRATION_TARGET_MISMATCH`,
`SNAPBACK_MIGRATION_STEP_FAILED`, `SNAPBACK_MIGRATION_BARRIER_FAILED`,
`SNAPBACK_MIGRATION_FENCE_CLOSED`,
`SNAPBACK_MIGRATION_EXPECTED_ORACLE_FAILED`,
`SNAPBACK_MIGRATION_VERIFICATION_FAILED`,
`SNAPBACK_MIGRATION_JOURNAL_CORRUPT`,
`SNAPBACK_MIGRATION_PUBLICATION_AMBIGUOUS`,
`SNAPBACK_MIGRATION_PROFILE_UNSUPPORTED`,
`SNAPBACK_MIGRATION_EXECUTOR_UNAVAILABLE` /
`SNAPBACK_MIGRATION_EXECUTOR_STALE`,
`SNAPBACK_MIGRATION_RETAINED_WORK_INCOMPATIBLE`, and the two client-side
outcomes of a published migration: `SNAPBACK_MIGRATION_UPGRADE_REQUIRED`
(the application published a successor-only migration; upgrade client
artifacts and resync before replaying offline work) and
`SNAPBACK_MIGRATION_RESYNC_REQUIRED` (a replayed mutation's read baseline
predates a successor-only publication and its row has since changed; resync
before replaying client-custodied offline work). Assert on the stable code, not message prose
([diagnostics](../operating/diagnostics.md)).

## Anti-patterns

- **Do not hand-edit stored data or run ad-hoc SQL for a reshaping change.**
  The loop exists so destructive changes are previewed, digest-approved, and
  journaled; an out-of-band edit invalidates the record that makes later
  verification meaningful.
- **Do not let preview guess a rename.** Derivation is deliberately limited
  to semantics-free changes; a rename derived from a drop-plus-add diff
  would silently destroy data. Declare `RenameField`/`ConvertField`
  explicitly.
- **Do not regenerate a plan at apply time.** `apply` takes the approved
  file by path; a "fresh" plan is an unreviewed plan.
- **Do not point a rehearsal at production** — the sealed binding refuses
  it; do not try to satisfy apply with a production-shaped receipt either,
  the rehearsal marking is checked.
- **Do not treat approval expiry as a nuisance.** The default 24-hour
  window bounds how stale a reviewed observation can get before execution;
  re-preview instead of widening `--expires-in-ms` reflexively.
- **Do not build a schema-reset habit on data you meant to keep.** For
  disposable dev data, reset and reseed; the moment preserved data matters,
  this loop is the paved path.

---

<!-- snapback-guide-source: guide/backend/streamed-actions.md -->
---
title: Streamed actions
id: backend.streamed-actions
order: 35
audience: agent-first
capabilities: [backend.streamed-actions]
authorities: [llp/0076-bounded-streamed-actions.rfc.md, llp/0075-convex-checkpoint-protocol.spec.md, crates/snapback-sync/src/stream_attempt.rs, crates/snapback-server/src/server.rs, packages/snapback-harness/ctx-bootstrap.js, demos/competitive-checkpoint/snapback/handlers.mjs, targets/cloudflare/app/all-aboard.app.js]
examples: [demos/competitive-checkpoint, targets/cloudflare/test/acceptance.egress.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-03
reviewed-authorities-digest: sha256:e0fd6cecbea08f7ee19b849395320ffc839983a8c3e87af1635f502f1c53bf8d
---

# Streamed actions

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`ctx.fetchStream` lets an **action** consume an upstream HTTP(S) response
incrementally — an AI provider's token stream, a large export — without
granting database access, retaining unbounded bytes, or letting a late
continuation write after cancellation. It is a bounded, pull-driven,
action-only *response-byte* reader, not a general streaming API: clients
never see a stream object. They observe ordinary authoritative live-query
commits that your nested mutations produce
([LLP 0076](repo:llp/0076-bounded-streamed-actions.rfc.md) is the semantic
authority, **Accepted** 2026-07-25; its evidence ledger is the honest
record).

**What is witnessed where** (`maturity: partial` made concrete): the full
surface on this page — reader, limits, attempt control plane, crash-safe
settlement — is implemented and witnessed on the local target. The Workerd
target passes a narrower Miniflare witness (pull/chunk/total/cancel/idle,
progress-rate and cursor caps, secret placement) but has **no
`ctx.streamAttempt` control plane** — it refuses attempt tokens fail-closed.
The gate-bearing hosted receipt exists (the 2026-07-25 Fly.io
`single-instance-container-vm.v1` drill; protocol amendment v0.7), and the
capability is **stable** in the LLP 0058 registry since LLP 0076's
acceptance; admission is decided by the **served instance manifest**, never
by this page.

## Require the capability and enable egress

A streamed action needs the same egress enablement as ordinary outbound
fetch (`SNAPBACK_OUTBOUND_ACTIONS=1`), and its artifact must be admitted by
a target whose served manifest supports `bounded_response_stream_v1`.
Codegen selects the outbound-actions capability-manifest variant only when
that variable is set; the base local manifest declares
`bounded_response_stream_v1` as a gap, so generation without it fails with
`SNAPBACK_CAPABILITY_UNSUPPORTED`.
Codegen detects `ctx.fetchStream` in your handler (AST-derived — aliases and
destructuring count, comments do not) and adds the requirement to the
function manifest; every loader then resolves it against the live `/inspect`
manifest before any handler runs. An egress-disabled instance refuses the
artifact with `SNAPBACK_CAPABILITY_UNSUPPORTED` at load, not at first use.

The capability is **stable** (LLP 0076 Accepted 2026-07-25), so positive
presence in the served manifest is the plain compatibility assertion — no
acknowledgment is needed. Artifacts generated while the id was
`experimental` still carry it in `acknowledgedExperimentalCapabilities`;
that entry is a harmless no-op (acknowledging a stable id never refuses), so
pre-promotion artifacts keep admitting unchanged. The experimental-maturity
admission rule itself (LLP 0058 §Capability maturity) still applies to ids
that remain experimental; `relational_query_v1` and `migration_keyset_scan_v1`
have since been promoted too (LLP 0080/0081 flipped Implemented 2026-07-26),
and the served manifest's `capabilityMaturity` map is the authoritative
current list (`vector_search_v1`, `jobs_one_off_v1`, the asset ids, and
others).

## Consume the body with one pull-driven reader

One reader owns the body. Each `read()` pulls at most one host-bounded chunk
(≤ 16 KiB), so application backpressure is the default — the host never
buffers ahead of you beyond one in-flight chunk per cursor:

```js source=targets/cloudflare/app/all-aboard.app.js
    const reader = response.body.getReader();
    let reads = 0;
    let totalBytes = 0;
    let maxChunkBytes = 0;
    let checksum = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      reads += 1;
      totalBytes += chunk.value.byteLength;
```

`chunk.value` is a `Uint8Array`. `for await` async iteration delegates to
the same `read()`. `cancel()` is idempotent; a read after cancellation
returns `{ done: true }`, not an error. `releaseLock()` deliberately
deviates from the Web reader contract: it throws unless the stream reached
EOF or was cancelled. Overlapping `read()` calls on one cursor are refused —
one pull in flight per cursor is the profile, not a suggestion.

Every read result also carries the host-owned monotonic progress clock:
`elapsedMs` since the stream opened and `deltaMs` since the previous byte.
Use it to space durable commits — actions have no `Date.now()`, and
`ctx.runtime.now` is fixed per invocation.

## Own the attempt with the host control plane

Durable streamed work should be keyed by a host-owned **attempt**: the host
record owns the single-runner lease, the crash-safe `initiationState`
pre-mark, and the terminal cause plus the effect-certainty fact; a trusted
terminalizer guarantees a durable winner exists even if your action is
abandoned mid-stream. Start (or idempotently rejoin) the attempt before
opening the stream, and return an existing durable winner verbatim instead
of re-running:

```js source=demos/competitive-checkpoint/snapback/handlers.mjs
  const attempt = await ctx.streamAttempt.start('reply:' + args.attemptId);
  if (attempt.terminal) {
    // A durable winner already exists (a previous runner settled, or the
    // trusted terminalizer did): return it verbatim, never re-run.
    await runReconciled(ctx, 'settleReply', {
      attemptId: args.attemptId,
      status: attempt.terminal.cause === 'complete' ? 'failed' : attempt.terminal.cause,
      effectMayHaveExecuted: attempt.terminal.effectMayHaveExecuted,
    });
    return { outcome: attempt.terminal.cause, sequence: 0, replayedWinner: true };
  }
  const settleHost = async (cause) => {
    try {
      return await ctx.streamAttempt.settle(attempt.attemptToken, cause);
    } catch (_) {
      // Lease loss or abandonment: the trusted terminalizer owns the winner.
      return null;
    }
  };
```

Bind the upstream request to the attempt with `attemptToken`, then commit
progress through named mutations. While any cursor is open the host admits
at most ten nested-mutation commits per second (100 ms minimum spacing), so
coalesce chunks between commits:

```js source=demos/competitive-checkpoint/snapback/handlers.mjs
    const response = await ctx.fetchStream({
      url: args.streamUrl,
      method: args.method,
      body: args.method === 'GET' ? null : '{}',
      idempotencyKey: args.upstreamIdempotent ? args.attemptId : null,
      attemptToken: attempt.attemptToken,
    });
    if (!response.ok) fail('SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED', 'upstream returned a non-success status');
    reader = response.body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += ascii(chunk.value);
      readsSinceCommit += 1;
      if (readsSinceCommit >= 2) {
        sequence += 1;
        const progress = await runReconciled(ctx, 'applyReplyProgress', {
          attemptId: args.attemptId,
          sequence,
          delta: pending,
        });
        if (progress.terminal) {
          await reader.cancel();
          const settled = await settleHost(progress.status === 'complete' ? 'complete' : progress.status);
          if (settled) {
            await runReconciled(ctx, 'settleReply', {
              attemptId: args.attemptId,
              status: settled.cause === 'complete' ? progress.status : settled.cause,
              effectMayHaveExecuted: settled.effectMayHaveExecuted,
            });
          }
          return { outcome: progress.status, sequence: progress.sequence };
        }
        pending = '';
        readsSinceCommit = 0;
      }
    }
```

The rules this pattern encodes, which the host enforces or checks for you:

- **The durable winner is authoritative.** `ctx.streamAttempt.settle`
  returns the committed terminal record — which may be a different cause
  than your local inference when a cancellation or timeout raced you.
  Record and return *that*, verbatim.
- **In-transaction terminal checks are yours.** Every progress and
  completion mutation must reject a terminal attempt row inside its own
  transaction (`applyReplyProgress` returns `terminal: true` above). The
  host fences late commits too, but the authored check is part of the
  contract.
- **Reconcile inner-mutation conflicts, never last-writer-wins.** A
  concurrent committed writer (a durable client cancel racing a progress
  commit) rejects the whole inner mutation with
  `SNAPBACK_MUTATION_CONFLICT`. `runReconciled` above is the reference
  reconcile: re-invoke boundedly so the mutation re-reads the row in a
  fresh transaction and observes the cancel as `terminal` instead of
  overwriting it.
- **No retry after durable progress.** Once any progress commit landed,
  reopening the upstream under the same attempt is refused — transport
  re-segmentation could bind one sequence number to different bytes.
- **Certainty is host-derived.** `effectMayHaveExecuted` comes from the
  host's write-ahead `initiationState`; your rows may mirror it read-only,
  never compute it. A bare `idempotencyKey` does not make a non-GET request
  retry-safe — safe methods are idempotent by grammar, everything else
  settles `ambiguous` on unprovable transport loss.

## Design for the v1 limits

The profile is deliberately narrow ([LLP 0076 §Surface](repo:llp/0076-bounded-streamed-actions.rfc.md)
is the sole numeric authority):

| Limit | Value | On breach |
| --- | --- | --- |
| Total response bytes | 1 MiB | `SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED` |
| Application-visible buffered bytes | 64 KiB (structural: 4 cursors × one 16 KiB in-flight pull) | `SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED` |
| Host read size per pull | 16 KiB | (bounded by construction) |
| Wall clock, open → terminal read | 30 s, absolute mid-read; capped below the action watchdog with ~2 s settlement grace | `SNAPBACK_ACTION_STREAM_TIMEOUT` |
| Idle (no delivered byte) | 5 s | `SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT` |
| Concurrent cursors per invocation | 4 | `SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED` |
| Nested-mutation commits while a cursor is open | 10/s (100 ms spacing) | `SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED` |

Design consequences: budget the whole stream (including your commits) inside
30 s minus the settlement you must still perform; keep individual commits
≥ 100 ms apart using `elapsedMs`, not chunk counts, when cadence matters;
and treat the 1 MiB ceiling as a product constraint, not a tunable.

## Read the refusal codes

Stream diagnostics are structured and value-free: operation, expected
shape or limit, a safe received summary, and this page as the repair
anchor. URLs reduce to scheme+host; headers, bodies, secrets, and response
bytes never enter a diagnostic. The full v1 families:

| Code | Meaning |
| --- | --- |
| `SNAPBACK_ACTION_STREAM_INVALID` | Shape/protocol violation: bad URL or header shape, unknown cursor, overlapping pull, lease not held, retry after durable progress, descriptor slot this profile cannot resolve. |
| `SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED` | Total-byte, buffered-byte, or cursor-cap breach. |
| `SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT` | No delivered byte within 5 s (or no response metadata in time). |
| `SNAPBACK_ACTION_STREAM_TIMEOUT` | The absolute 30 s wall ceiling, including mid-read. |
| `SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED` | Transport failure that is retry-safe (safe method) or provably pre-send. |
| `SNAPBACK_ACTION_STREAM_UPSTREAM_AMBIGUOUS` | Non-idempotent transport loss the host cannot prove pre-send — never silently retried. |
| `SNAPBACK_ACTION_STREAM_UNSUPPORTED` | This target does not implement the profile (distinct from admission's `SNAPBACK_CAPABILITY_UNSUPPORTED`). |
| `SNAPBACK_ACTION_STREAM_CANCELLED` | Reserved internal cancellation reason; no v1 read path surfaces it (post-cancel reads return EOF). |
| `SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED` | The ten-commits-per-second fence while a cursor is open. |

Authority loss, generation change, and watchdog codes keep precedence when
they are the real cause: a read blocked across a service-authority
terminalization discards its late bytes and surfaces the authority refusal
(for example `SNAPBACK_AUTH_SCOPED_TOKEN_INVALID`), not a stream code.

## Secrets in streamed requests

Place secrets exactly as ordinary actions do on this target: stage values
through `ctx.secrets` handles; the staged-value redactor scrubs every stream
error envelope, and stream diagnostics never carry URLs or header values.
`secretSlots` (opaque descriptor placement, same shape as host-mediated
fetch) is accepted for hosted profiles that resolve descriptors at their
own boundary; the local value-mode profile refuses descriptor slots with a
typed diagnostic rather than sending a request missing its secret.

## Anti-patterns

- **Do not stream from queries or mutations.** `ctx.fetchStream` exists in
  actions only; the executed negative is part of acceptance.
- **Do not buffer the whole body before acting.** A target that does so is
  not implementing this profile; commit incremental progress through
  mutations so clients see authoritative intermediate state.
- **Do not commit per chunk.** You will trip the progress-rate fence;
  coalesce using `elapsedMs`.
- **Do not infer your own settlement when the host has a winner.** Return
  the settled record verbatim; a raced cancellation or timeout means your
  local view lost.
- **Do not treat an `idempotencyKey` as retry permission.** It is forwarded
  provider-visible, but only safe methods (or a future verified provider
  declaration) earn retry semantics.
- **Do not poll a stream you cancelled.** Post-cancel reads return EOF by
  design; settle and move on.

---

<!-- snapback-guide-source: guide/backend/expo-push.md -->
---
title: Expo push notifications
id: backend.expo-push-seam
order: 46
audience: agent-first
capabilities: [backend.expo-push-seam]
authorities: [llp/0143-expo-push-notification-seam.rfc.md, llp/0222-connected-client-predicate.rfc.md, llp/0045-notifications-outbox.rfc.md, crates/snapback-services/src/push.rs, crates/snapback-engine/src/push.rs, crates/snapback-sync/src/connected_clients.rs, crates/snapback-server/src/server.rs, crates/snapback-server/src/admin.rs, packages/snapback-codegen/define.mjs, packages/snapback-harness/ctx-bootstrap.js, packages/snapback-client/push-registry.mjs, packages/snapback-cli/fake-expo-push.mjs]
examples: [packages/snapback-cli/fixtures/push-seam]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:1b03a6d605d8591c0d82496900f39eb17acd1209f609feb927610e6bc0f84af6
---

# Expo push notifications

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

<!-- @ref LLP 0143#d0-the-decided-frame-seam-not-capability — this page
teaches the Expo provider seam without turning it into a delivery claim. -->

Snapback's Expo seam keeps device tokens out of application tables, resolves
declared audiences inside the host, and records what happened at Expo's ticket
and receipt boundaries. It is not the first-class notification outbox designed
by [LLP 0045](repo:llp/0045-notifications-outbox.rfc.md), and the target still
reports `notifications: false`.

The local capability manifest reports the separate structured capability
`notifications.expoPushSeam`. Using it requires all of these:

- session auth and a `definePushSeam` declaration;
- the additive `@expo/snapback-client/push-registry` client subpath;
- `SNAPBACK_OUTBOUND_ACTIONS=1` on both generation and the serving process;
- a declared audience whose host-enforced `authorize` clause admits the
  invocation; and
- Expo project credentials and native permission setup owned by the app.

Hosted targets omit the structured capability. There is no hosted native-auth
entry, authenticated token-registration path, provider custody, or durable
receipt-poll home yet.

The local seam's acceptance kit combines the packaged deterministic fake-Expo
carrier with a 2026-08-03 physical iOS development-build witness whose ticket
and receipt both settled `ok`. That external witness is retained in LLP 0143's
implementation record. It does not widen the receipt beyond the never-claims
below, and it does not turn the separate first-class `notifications` capability
on.

## Declare custody, audiences, and retention

`definePushSeam` is installed on a session-auth schema. `appScope` must bind
the EAS project, native application identity, and deployment environment.
Registry and ledger retention are explicit app facts between one day and one
year. Audience declarations are closed: membership resolution, or a bounded
explicit-principal resolver for immediate/system use, plus either membership
authorization or an explicit `system` authorization.

```js fragment reason="Representative declaration; no complete push demo has landed yet"
export const pushSeam = definePushSeam({
  appScope: {
    easProjectId: 'your-eas-project-id',
    applicationId: 'com.example.app',
    environment: 'development',
  },
  registry: { idleRetentionMs: 30 * 24 * 60 * 60 * 1000 },
  audiences: {
    guests: {
      resolve: {
        membership: eventMembers,
        resourceArg: 'eventId',
        roles: ['guest'],
      },
      authorize: {
        membership: eventMembers,
        resourceArg: 'eventId',
        roles: ['host'],
      },
    },
  },
  uses: ['expoPushAccessToken'],
  ledger: { retentionMs: 30 * 24 * 60 * 60 * 1000 },
});

export default defineSchema({ events, eventMembers }, {
  auth: { mode: 'sessions' },
  pushSeam,
});
```

Declare `expoPushAccessToken` as an optional deployment config entry and grant
it in every sending action's `uses`. Accounts without enhanced push security
may leave it unset. Snapback then attempts the request without a bearer; if
Expo requires one, `UNAUTHORIZED` settles as `failed-config` — an
intent-level aggregate state, distinct from the per-message
`expo-error-config` classification (see
[two state vocabularies](#two-state-vocabularies-intent-aggregates-and-per-message-lifecycle))
— rather than being retried. Config values never enter source, handler arguments, or the ledger.
See [Secrets and deployment config](../operating/secrets-and-config.md).

## Register the current installation

Importing the root client adds no push code or property. Attach the explicit
subpath and inject Expo's file-system module to select the conventional
device-scoped default:

```js fragment reason="Expo supplies the native module; Snapback owns the dedicated push file"
import * as ExpoFileSystem from 'expo-file-system';
import { SnapbackClient } from '@expo/snapback-client';
import { createExpoPushInstallationStorage } from '@expo/snapback-client/push-installation-expo';
import { attachPushRegistry } from '@expo/snapback-client/push-registry';

const pushInstallationStorage = createExpoPushInstallationStorage({
  fileSystem: ExpoFileSystem,
});
const client = attachPushRegistry(new SnapbackClient(origin, { bearerToken }), {
  pushInstallationStorage,
});

await client.push.registerExpoToken({
  projectId: 'your-eas-project-id',
  getExpoPushTokenAsync: Notifications.getExpoPushTokenAsync,
});
```

The installation id lives in the dedicated
`snapback-push/installation.v1.json` document-store member, not in the RQS
cache. Ordinary logout preserves it while the server retires the exact session
generation's token row transactionally. Account switching also preserves the
id; registering under the successor session rebinds the device through the
single-owner rule. A full app-data custody wipe must call
`pushInstallationStorage.clear()`; the next registration mints a new id. An OS
app-data reset or reinstall removes the app container and therefore also mints
a fresh id. Apps with another native durable key/value store may still pass a
custom `pushInstallationStorage`; missing custody continues to refuse rather
than fall back to process memory. Web push registration is outside v1.

The app still owns `expo-notifications` setup: OS permission prompts,
`projectId`, foreground behavior, and `addPushTokenListener`. On a rotation
signal, reacquire the Expo token with `getExpoPushTokenAsync` and call
`registerExpoToken` again. Registration is idempotent, rotation is atomic, and
the same token bytes have one live owner per app scope. Explicit logout flows
may also call `client.push.unregisterToken()`; server-side session termination
is the authoritative cleanup if they do not.

Never put Expo token bytes in an application table, query result, log, or
action argument. The protected registry exposes only bounded cardinalities and
retirement facts to operator inspection.

## Send to a declared audience

Generated action contexts expose `ctx.push.send` only when the schema declares
the send/ledger half of the seam. Pass a reference produced by the declared
audience function, not token bytes:

```js fragment reason="Representative action; generated audience names and args are app-specific"
export async function notifyGuests(ctx, { eventId }) {
  return ctx.push.send({
    to: pushSeam.audiences.guests({ eventId }),
    title: 'The plan changed',
    body: 'Open the app for the latest details.',
    data: { eventId },
    dedupeKey: `event:${eventId}:plan-change:v1`,
  });
}
```

The reference itself can be built two equivalent ways. The schema-side form
above (`pushSeam.audiences.guests({ eventId })`) works wherever the schema
module's `pushSeam` export is in scope. Inside a generated action handler,
the context exposes the same helpers without importing the schema:
`ctx.push.audience('guests', { eventId })` and its property twin
`ctx.push.audiences.guests({ eventId })`. Generated contexts type both
through `GeneratedPush`, closing the audience name union and each audience's
exact argument shape; an empty or non-string audience name refuses with
`SNAPBACK_PUSH_SEND_INVALID`. All three spellings produce the same audience
reference — an `{ audience, args }` value, never resolved tokens.

The host validates the reference, authorizes it against current membership,
resolves current members and live registry rows, reserves the durable ledger,
marks `transmitting` before the first provider byte, and sends serial batches
of at most 100 messages. A zero-row audience records `zero-target`; it is not
an error. Reusing a dedupe key with the same binding is a no-op. Reusing it
with a different audience or payload refuses.

Authority depends on the trigger:

- A directly invoked action uses its server-resolved user and must satisfy the
  audience's membership `authorize` clause.
- Cron/system actions may use only audiences declaring `{ system: true }`.
- A mutation may enqueue a deferred action with
  `ctx.jobs.enqueue(action, args, { pushGrant: { to, dedupeKey } })`. Capture
  checks producer membership inside the mutation transaction; the job stores
  only the exact audience reference and dedupe key. At system-authority
  execution the host rechecks that producer's current membership and
  re-resolves recipients. Explicit-principal audiences are refused here.

The return value contains `intentId`, `attempt`, `targetCount`, `batchCount`,
the current aggregate `state`, and `deduplicated`.

If the process dies after claiming a batch but before its durable transmit
marker, maintenance safely sends the exact protected binding after the claim
lease expires. Once the marker exists, recovery settles an unanswered attempt
as `ambiguous` instead. Fresh action reservations are not maintenance work, so
the worker cannot race the action that created them.

## Read handoff facts without reading secrets

Export one `definePushLedgerQuery({ auth: 'authenticated' })`. It accepts only
`intentId`; the host loads the stored audience reference and rechecks its
current authorization before returning flat lifecycle rows. The projection
contains opaque intent, batch, message, and token-row ids plus timing, state,
ticket id, allowlisted error code, and retirement effect. It never contains
token bytes, title/body/data, dedupe key, audience arguments, config, or Expo
prose. Do not query the protected ledger tables directly.

## Skip an immediate push when a client is fresh

Session-auth action contexts on the local target include
`ctx.realtime.hasFreshClient({ principalId })`. You may use it before
`ctx.push.send` as an advisory policy input:

```ts fragment reason="Representative action policy; the generated app supplies its audience-specific push request"
if (await ctx.realtime.hasFreshClient({ principalId })) {
  return { skipped: true, reason: 'connected' };
}
return ctx.push.send(pushRequest);
```

The local capability manifest names `semanticsVersion: 2`, a fixed
`freshnessBudgetMs: 15000`, and the `managed-websocket` plus
`authenticated-poll` transports. The fact is existential across the
principal's devices and tied to this app-instance authority. `false` means
only that no qualifying witness is fresh; it is not proof that the user is
offline. `true` does not prove that a live event was rendered or acknowledged.

Do not use this branch as exactly-once live-vs-push arbitration or to settle a
durable notification intent. That requires LLP 0045's durable intent,
idempotency, attempt, cancellation, and terminal-settlement lifecycle, which
is still a GAP. Hosted targets omit this predicate until their session/push
conjunction and a sound single-authority route or shared aggregation index both
exist.

## Treat ambiguity as possible duplicate display

After a durable `transmitting` marker, a socket drop or timeout means Expo may
have accepted the request even though Snapback did not receive tickets. The
attempt becomes `ambiguous` and is never automatically re-driven.

An explicit operator/app decision may send the same bound intent again with
`redriveAmbiguous: true`. It creates a new attempt marked with an ambiguous
predecessor. **The device may receive the notification twice.** The flag
refuses if no matching ambiguous predecessor exists, and deferred grants may
not authorize it.

HTTP 429/5xx request failures are retryable because the provider refused the
request. `DeviceNotRegistered` at either the ticket or receipt stage retires
and erases the token row. Raw provider prose is always dropped; only the
closed error vocabulary crosses into settlement.

## Interpret receipts narrowly

The local maintenance worker polls at 15 minutes after handoff, then 30
minutes, 1 hour, 2 hours, and 4-hour-capped intervals, for at most seven polls
inside a roughly 24-hour window. It requests at most 1,000 ticket ids at once.
Tests may call `POST /_snapback/api/push/maintenance` with an injected clock
only when a Dev/Test profile uses a loopback provider override; injected time
is refused against the real Expo endpoint.

### Two state vocabularies: intent aggregates and per-message lifecycle

The seam records state at two granularities, and the two closed vocabularies
overlap without being equal — do not switch on one expecting the other's
values:

- **Intent-level aggregate state** — what `ctx.push.send` returns as `state`
  and what an intent row carries. Closed set: `reserved`, `handed-to-expo`,
  `expo-accepted`, `expo-error`, `failed-permanent`, `failed-config`,
  `failed-retryable`, `ambiguous`, `ambiguous-receipt`, `zero-target`. The
  `failed-config` settlement from an unset-but-required
  `expoPushAccessToken` and the `zero-target` empty-audience outcome exist
  only here.
- **Per-message lifecycle state** — what the ledger query's per-recipient
  rows carry. Closed set: `reserved`, `handed-to-expo`, `expo-accepted`,
  `expo-error`, `expo-error-config`, `expo-error-rate`, `failed-permanent`,
  `ambiguous`, `ambiguous-receipt`. The receipt-stage provider
  classifications `expo-error-config` and `expo-error-rate` exist only here.

Reading the shared names:

- `handed-to-expo` means the send endpoint returned a successful ticket.
- `expo-accepted` means Expo's receipt says it handed the message to APNs/FCM.
- `expo-error` (both vocabularies), plus the message-level `expo-error-config`
  and `expo-error-rate`, are closed provider classifications.
- `ambiguous` means request response certainty was lost.
- `ambiguous-receipt` means the bounded receipt window ended without an
  answer.

The seam does not and will not claim: device delivery; notification display;
read or interaction state; OS permission state; exactly-once sending or
duplicate suppression; ordering across recipients or across intents; delivery
latency, availability, or any SLA; continued token validity or current
registration beyond the recorded retirement facts. A product string such as
"invitations sent" is product copy, not a fact this seam backs.

Push payloads pass through Expo and APNs/FCM as plaintext from Snapback's
perspective. Do not put protected row data in `title`, `body`, or `data`.
Prefer an opaque id that the app resolves through an authorized read when the
user opens it.

## Test without exfiltrating tokens

Production sends are pinned to `https://exp.host`. Only a dev/test-profile
server accepts `SNAPBACK_EXPO_PUSH_BASE_URL`, and the value must be a loopback
HTTP(S) origin. The shared conformance fixture scripts ticket responses,
receipt responses, both `DeviceNotRegistered` stages, and a socket close after
request bytes; it uses the same bounded HTTP carrier as production. Import
`startFakeExpoPushService` from
`@expo/snapback-cli/testing/fake-expo-push` for that reusable carrier; the
committed `push-seam` fixture exercises it through the generated app surface.

iOS simulators cannot mint Expo push tokens. Android emulators with Play
services generally can, but deterministic acceptance should still use fixture
tokens and the loopback provider. A real-device receipt is a separate release
witness, not permission to claim delivery or display.

## Anti-patterns

- Do not store push tokens in app rows or expose them to handlers.
- Do not accept a provider URL in an app argument or config entry.
- Do not equate a ticket or receipt with device delivery.
- Do not retry an ambiguous attempt without the explicit duplicate-risk flag.
- Do not defer an arbitrary principal list under system authority.
- Do not put sensitive content in a notification payload.
