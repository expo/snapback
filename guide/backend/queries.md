---
title: Queries
id: backend.queries
order: 1
audience: agent-first
capabilities: [backend.functions, backend.query-semantics]
authorities: [llp/0003-local-code-hosting-and-storage-core.rfc.md, llp/0004-application-data-api.rfc.md, llp/0007-storage-portability.spec.md, llp/0101-inline-handlers-and-result-contracts.spec.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/inline-handlers.mjs, packages/snapback-codegen/result-contracts.mjs, src/result_contract.rs, demos/backend-bakeoff/snapback/functions.mjs]
examples: [demos/todo, demos/todo-v2, demos/backend-bakeoff]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-27
reviewed-commit: HEAD
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

```js source=demos/backend-bakeoff/snapback/functions.mjs
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

Inline v1 does not capture imports, sibling helpers, or outer constants: put
all application logic and locals inside the direct handler expression. Class
syntax, dynamic import, `eval`, and `Function` are refused during generation.
The legacy `{ source, exportName }` form remains supported for existing
handlers, but it cannot be mixed with `handler`.

Every JS query handler returns an **array of rows**, including point reads:
return `[]` for missing or `[row]` for present. Returning a single object fails
with `SNAPBACK_HANDLER_RESULT_INVALID`; the diagnostic names whether the
declaration is a `query` or `live query` and includes its function id.

Declare what that array contains:

- `results.documents('todos')` validates complete stored documents, including
  server-owned system fields and stored optional-field semantics.
- `results.records(v.object({...}))` validates exact computed records and does
  not invent system fields.

The generated reference carries the precise array result. Snapback validates
the post-JSON image and 4 MiB egress ceiling before cache insertion, snapshot,
or live publication. Omitting `result` is an explicit degraded `unknown`
contract; codegen does not infer a type by inspecting handler behavior.

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
- **Do not mark every query live.** Ordinary queries stay ordinary; opt into
  live delivery only when the UI needs subscription semantics.
- **Do not return a stored row under `results.records`.** Use
  `results.documents(table)` when the complete stored shape, including system
  fields, is part of the contract.
- **Do not capture imported or sibling helpers in an inline handler.** Keep the
  expression self-contained or use the legacy module form.
