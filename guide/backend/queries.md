---
title: Queries
id: backend.queries
order: 1
audience: agent-first
capabilities: [backend.functions, backend.query-semantics]
authorities: [llp/0003-local-code-hosting-and-storage-core.rfc.md, llp/0004-application-data-api.rfc.md, llp/0007-storage-portability.spec.md, llp/0108-inline-handlers-and-result-contracts.spec.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/inline-handlers.mjs, packages/snapback-codegen/result-contracts.mjs, src/result_contract.rs, demos/signal-desk/snapback/functions.mjs]
examples: [demos/todo, demos/todo-v2, demos/signal-desk]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-03
reviewed-commit: f9ae0083ef41bfc9d07f033da440f96048919613
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

Specialized read shapes are their own closed carriers with their own pages —
cross-reference rather than reimplementing them in a JS handler: bounded
joins ([relational queries](./relational-queries.md)), index-backed text
search ([text search](./text-search.md)), exact vector search
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
cannot be mixed with `handler`.

Every JS query handler returns an **array of rows**, including point reads:
return `[]` for missing or `[row]` for present. Returning a single object fails
with `SNAPBACK_HANDLER_RESULT_INVALID`; the diagnostic names whether the
declaration is a `query` or `live query` and includes its function id.

Declare what that array contains:

- `results.documents('todos')` validates complete stored documents, including
  server-owned system fields and stored optional-field semantics.
- `results.records(v.object({...}))` validates exact computed records and does
  not invent system fields.
- `v.doc('todos')` references that same complete document shape from inside a
  result validator. For example,
  `results.records(v.object({ todo: v.doc('todos') }))` avoids respelling a
  nested document. A top-level `results.records(v.doc('todos'))` is
  hash-identical to `results.documents('todos')`.

`v.doc` is result-only. Codegen expands it against the current schema before
hashing and refuses unknown tables; adding or changing a table field therefore
regenerates the contract and generated types. It is not accepted in function
arguments or stored schema fields.

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

`ctx.db.query(table)` accepts exactly these verbs, in any order after
`.withIndex(name)`:

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
(`defineOwnedKeysetPages` generates this shape for *owner*-scoped history;
the chain above is how you page anything else.) A verb outside this table
refuses during generation with a named diagnostic rather than failing at
runtime.

## Scope on the server

Put authorization predicates in the query, not in client arguments or UI
filters. `authUserId()` in declarative plans and `ctx.auth.userId` in JS
handlers are server-derived. For sessions-mode details, see
[sessions and principals](../auth/sessions-and-principals.md).

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
- **Do not sort or filter after an implicit `collect()` to infer a global
  result.** Push the operation into the query builder and declare `.take(n)`.
- **Do not mark every query live.** Ordinary queries stay ordinary; opt into
  live delivery only when the UI needs subscription semantics.
- **Do not respell a complete stored row with `v.object`.** Use
  `results.documents(table)` at the top level, or `v.doc(table)` when the
  complete stored shape appears inside a result validator.
- **Do not capture imports or arbitrary top-level bindings in an inline
  handler.** Statically reachable same-file function declarations—including
  context-reader helpers that receive `ctx.db`—are admitted. Imported helpers,
  top-level `const`/class state, and multi-file capability graphs remain
  outside the landed slice; use the legacy module form when that boundary is
  intentional.
