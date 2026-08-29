---
title: Queries
id: backend.queries
order: 1
audience: agent-first
capabilities: [backend.functions, backend.query-semantics, backend.batch-reads]
authorities: [llp/0003-local-code-hosting-and-storage-core.rfc.md, llp/0004-application-data-api.rfc.md, llp/0007-storage-portability.spec.md, llp/0008-local-first-sync-and-realtime.rfc.md, llp/0055-agent-principals-and-scoped-grants.rfc.md, llp/0108-inline-handlers-and-result-contracts.spec.md, llp/0174-authoring-incidents-at-security-fences.research.md, llp/0231-entity-and-permissioning-recommendation.rfc.md, llp/0245-infer-show-freeze-declarations.rfc.md, llp/0248-bounded-batch-reads.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/inline-handlers.mjs, packages/snapback-codegen/n-plus-one-advisory.mjs, packages/snapback-codegen/n-plus-one-advisory.test.mjs, packages/snapback-codegen/result-contracts.mjs, packages/snapback-codegen/ctx.d.mts, packages/snapback-codegen/authoring-validation.test.mjs, packages/snapback-harness/ctx-bootstrap.js, packages/snapback-harness/envelope.test.mjs, packages/snapback-client/index.d.mts, schemas/capability.manifest.local-dev-sqlite-ibex.json, crates/snapback-engine/src/manifest.rs, crates/snapback-engine/src/runtime.rs, crates/snapback-kernel/src/storage.rs, crates/snapback-types/src/result_contract.rs, crates/snapback/tests/local_v0.rs, demos/signal-desk/snapback/functions.mjs]
examples: [demos/todo, demos/todo-v2, demos/signal-desk]
status: current
targets: [local]
maturity: partial
authoring-profiles: [explicit]
reviewed: 2026-08-28
reviewed-authorities-digest: sha256:0af0b8392f37713d417d949dd430071bd811114f7ebd6b69a830e08afe9782f0
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

For live reads, that is also the selection rule: use `defineLiveQuery` for an
exact one-table point or list query whose filters and ordering fit the
declarative plan. Use `defineRelationalQuery` for its supported joins, and use
`defineJsLiveQuery` only when the bounded read or computed result is not
expressible by those declarative carriers. Delta versus full replacement is a
server delivery choice; both are required to preserve the same authoritative
result membership.

After a create, **use the canonical row id returned at settlement** when a
route opens an `_id` point query. A provisional optimistic identity is not a
row address and must not be cast to `Id<Table>`; keep it inside the
[optimistic-create projection](../recipes/optimistic-create.md) until its
logical mint settles. Wait for delivery only if the subscription already
existed before the insert; a subscription opened after settlement with the
canonical id must receive the row in its initial snapshot.

There is one documented diagnostic exception to the ordinary selection rule.
Diary 0106's Clique thread still blanked on table `postById` /
`repliesForPost` reads even though HostPlan matcher characterizations pass.
Until a faithful React/JS/wire trace explains that product path,
`defineJsLiveQuery` plus a local cache remains the application workaround that
restored Clique. Treat it as mitigation, not proof that timing, provisional
identity, authorization, optimistic projection, or HMR is the cause. The
residual warning and trace checklist are in
[live queries](../realtime/live-queries.md#matching-inserts-in-point-and-parent-queries).

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

When the question is why a query examined surprising work rather than how to
declare it, pull the bounded local inspection described in
[query costs and runtime attribution](./query-costs.md). A complete ordinary
declarative record names the planner-selected access path and exact examined
outer entries without retaining arguments or row values.

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

Search vocabulary: v.media is restricted to stored top-level fields and cannot be repeated as an anonymous JS result validator.

If you searched for “v.media is restricted to stored top-level fields and
cannot be repeated as an anonymous JS result validator,” keep the media field
attached to its stored source. `v.media()` is schema-only because its projected
`MediaRef` is derived from that table and field. Return the containing document
with `results.documents(table)`, `results.document(table)`, or `v.doc(table)`;
for a computed record, nest that `v.doc(table)` rather than redeclaring the
media field anonymously. Both authoring profiles lower to this same result
contract rule.

Search vocabulary: Optional asset fields still must serialize as null in document results; Result-contract requiredField on optional document columns; document results still demand null for requiredField.

If you searched for “Optional asset fields still must serialize as `null` in
document results,” “Result-contract `requiredField` on optional document
columns,” or “document results still demand `null` for `requiredField`,” the
rule is: every stored optional field is a **present document key** whose value
is `T | null`. Omitting the key violates the result contract; return `null`
when the stored value is absent. This applies to `results.documents`,
`results.document`, and every nested `v.doc` in both Explicit and Familiar
authoring. It is a result/document rule, separate from whether a mutation
argument may be omitted.

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

Search vocabulary: used dynamic array indexing while correlating bounded getMany results; Computed array lookup used to associate uniqueMany media.

If you searched for “used dynamic array indexing while correlating bounded
getMany results” or “Computed array lookup used to associate uniqueMany
media,” do not recover correlation with `rows[i]`. Carry the request identity
into every output record and match the returned row by that identity with an
array method:

```js fragment reason="ID-carrying correlation rewrite for both batch forms"
const media = await ctx.db.uniqueMany(
  'messageMedia',
  'byMessage',
  messages.map((message) => ({ messageId: message._id })),
);
const correlated = [];
for (const message of messages) {
  const row = media.find((candidate) => candidate?.messageId === message._id) ?? null;
  correlated.push({ messageId: message._id, media: row });
}
return correlated;
```

The same rewrite works for `getMany`: match each returned document's `_id`
against the ID carried by the source record. It avoids forbidden computed
member access, preserves the ID even when a lookup is hidden or missing, and
uses the same inline-handler grammar in Explicit and Familiar authoring.
`SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN` also carries this compilable
`for...of` rewrite as a structured recovery payload; tooling may present it as
a code action, but it requires the author to select the authoritative ID.

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
malformed dynamic keys refuse before storage.

### Declare a unique index over optional fields

Use the ordinary public index option `{ unique: true }`, even when one or more
indexed fields are optional:

```js source=packages/snapback-codegen/authoring-validation.test.mjs
  rsvps: defineTable({
    eventId: v.string(),
    userId: v.optional(v.principal()),
  })
    .index('by_event_user', ['eventId', 'userId'], { unique: true })
    .visibility({ kind: 'public-read' }),
```

Codegen sees the optional `userId` component and derives the manifest fact
`whereApplicable: true`; `whereApplicable` is not an `.index(...)` authoring
option. A row participates in uniqueness only when **all** index components
are present. If any optional component is absent, that row does not
participate. A `uniqueMany` key must still supply every component as a
present, non-null value valid for its field type, or the whole batch refuses.
Authors searching for “whereApplicable index option” or
“unique index optional field” should use this same declaration.

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
or changes how any read executes. Unique indexes whose manifests carry the
codegen-derived `whereApplicable: true` fact stay quiet: their optional
components do not participate in uniqueness when absent, while `uniqueMany`
requires every component to be present and non-null. Calls already using
either batch method, point reads outside loops, guarded calls, and loops whose
table is not one static literal also stay quiet.

## Bound every collection intentionally

`ctx.db.query(...).collect()` is not an unbounded table scan. Without an
explicit `.take(n)`, it may return at most 1,024 rows. If it reaches that
ceiling, Snapback refuses the invocation with
`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`: the runtime cannot prove whether the
1,024 rows are the complete result or a truncated prefix.

Live subscriptions hit the same ceiling when a commit reevaluates their
query; the client now keeps the fail-closed blanking behavior but reports the
typed refusal and `.take(n)` repair instead of retrying the identical read.

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

Generated query references repeat this budget in their type hover, and
`SNAPBACK_PUBLIC_BUDGETS_V1.query` exposes the exact typed values. A literal
over 1,024 refuses at generation with `limit`, `observed`, and a
`fixed-bound-then-slice` recovery. A dynamic `.take(limit)` remains supported:
the runtime checks its eventual value against the same ceiling. After choosing
a semantically complete fixed server window, slice only when the caller wants
a smaller subset of that already-correct window.

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
in an argument list. For a bounded membership-driven top-N feed, use the
[checked chunked `in()` composition](../recipes/chunked-semijoin-feed.md);
Snapback does not yet ship the closed semi-join proposed by LLP 0278 D3.

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
