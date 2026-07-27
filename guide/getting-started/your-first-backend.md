---
title: Your first backend
id: getting-started.your-first-backend
order: 1
audience: agent-first
capabilities: [backend.schema, backend.functions, backend.seed, backend.provisioning, backend.codegen]
authorities: [llp/0004-application-data-api.rfc.md, llp/0037-schema-source-of-truth.decision.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-client/index.mjs]
examples: [demos/todo/snapback, demos/todo-v2/snapback]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-26
reviewed-commit: HEAD
---

# Your first backend

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A Snapback backend is a directory — conventionally `<app>/snapback/` —
holding a handful of source-authored `.mjs` files plus a committed
`generated/` tree that codegen produces from them:

```text
myapp/
  snapback/
    schema.mjs        # source-authored schema (the source of truth)
    functions.mjs     # query/mutation/action definitions
    handlers.mjs      # bundled ctx.db handler module (only if you use JS handlers)
    seed.json         # deterministic declarative seed
    generated/        # codegen output — committed, deterministic, never hand-edited
```

You write the first four. Everything under `generated/` comes from
`node packages/snapback-codegen/index.mjs myapp/snapback` and is committed.

## Declare the schema

All authoring helpers come from `packages/snapback-codegen/define.mjs`
(demos import it via the `demos/_kit/define.mjs` shim). A schema is tables
of validated fields, with chainable `.index(...)` and `.sync()`:

```js source=demos/todo/snapback/schema.mjs
import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
    userId: v.string(),
  })
    // by_user backs the user-scoped live query's index-first lookup.
    .index('by_user', ['userId'])
    // Declared syncable so it can back the restricted syncable-live subset.
    .sync(),
});
```

The complete validator set: `v.string()`, `v.principal()`, `v.id(table)`,
`v.boolean()`, `v.integer()`, `v.real()` / `v.number()`, `v.json()`,
`v.object({...})`, and `v.optional(inner)`. `defineSchema` also takes an
options object:
`ephemeral:` (a `defineEphemeral(...)` — see the
[presence recipe](../recipes/presence-cursors.md) and complete
[ephemeral-state reference](../realtime/ephemeral-state.md)), `auth:`
(`{ mode: 'dev' | 'sessions' }` — see
[auth/sessions-and-principals](../auth/sessions-and-principals.md)), and
`requiredCapabilities:`.

The system fields `_id`, `_version`, `_createdAt`, `_updatedAt` are
server-owned. Declaring one is a hard error
(`SNAPBACK_SCHEMA_SYSTEM_FIELD`), and handlers never set timestamps.

## Define functions

There are two authoring styles, freely mixed in one `functions.mjs`:

1. **Declarative plans** (`defineQuery`, `defineLiveQuery`,
   `defineMutation`) — built from expression helpers, deterministic, no JS
   runtime involved.
2. **JS handlers** (`defineJsQuery`, `defineJsLiveQuery`,
   `defineJsMutation`, `defineAction`) — logic lives in a bundled
   `handlers.mjs` and runs against the injected `ctx`.

A declarative query — filter, order, index, and the server-derived user id:

```js source=demos/todo/snapback/functions.mjs
export const listTodosOnce = defineQuery({
  table: 'todos',
  args: {},
  filter: [eq('userId', authUserId())],
  order: [asc('_createdAt')],
  index: 'by_user',
});
```

A JS mutation — the definition names its handler and declares its writes:

```js source=demos/todo/snapback/functions.mjs
export const createTodo = defineJsMutation({
  args: { title: v.string() },
  source: 'handlers.mjs',
  exportName: 'createTodo',
  writes: ['todos'],
});
```

A declarative mutation, for comparison:

```js source=demos/todo/snapback/functions.mjs
export const editTitle = defineMutation({
  args: { id: v.string(), title: v.string() },
  plan: patch('todos', arg('id'), { title: arg('title') }),
  returns: returnChangedCount(),
});
```

`demos/todo-v2/snapback/functions.mjs` is the fully declarative variant of
the same app — the side-by-side worth reading when choosing a style.
The reference pages cover the semantics shared by both styles:
[queries](../backend/queries.md) and [mutations](../backend/mutations.md).

## Write handlers (JS style only)

Handlers register on a global and receive only the injected `ctx` — no
imports, no `process`/env, no timers, no network, no direct storage:

```js source=demos/todo/snapback/handlers.mjs
globalThis.__snapbackHandlers = {
  async listTodos(ctx) {
    return await ctx.db
      .query('todos')
      .withIndex('by_user')
      .eq('userId', ctx.auth.userId)
      .order('_createdAt', 'asc')
      .collect();
  },

  async createTodo(ctx, args) {
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('todo title is required');
    return await ctx.db.insert('todos', {
      title,
      completed: false,
      userId: ctx.auth.userId,
    });
  },
```

The core `ctx.db` surface: `ctx.db.query(table).withIndex(name).eq(field, value)`
`.in(field, [...])`.`order(field, dir)`.`collect()`, plus
`ctx.db.get(table, id)`, `ctx.db.insert(table, values)`,
`ctx.db.patch(table, id, values)`, `ctx.db.delete(table, id)`, and
`ctx.auth.userId` — the server-derived identity
([never client-asserted](../auth/sessions-and-principals.md)).

Membership declarations additionally generate query-side
`ctx.permissions.<declaration>` checks and mutation-only
`ctx.membership.<declaration>` operations. See
[scoped roles and memberships](../auth/scoped-roles.md) for their typed surface
and transition rules.

## Seed deterministically

```json source=demos/todo/snapback/seed.json
{
  "tables": {
    "todos": [
      { "_id": "seed_todo_1", "title": "Read the Snapback explainer", "completed": true, "userId": "user_ada" },
      { "_id": "seed_todo_2", "title": "Build the todo demo", "completed": false, "userId": "user_ada" },
      { "_id": "seed_todo_3", "title": "Write the diary", "completed": false, "userId": "user_ada" },
      { "_id": "seed_todo_4", "title": "Plan the kanban demo", "completed": false, "userId": "user_grace" }
    ]
  }
}
```

## Generate and load

```sh
node packages/snapback-codegen/index.mjs myapp/snapback
```

Codegen **fails closed**: on any error it writes nothing (no silent stale
output) and exits 1 with stable diagnostic codes (`QUERY_UNKNOWN_FIELD`,
`FUNCTION_RESERVED_EXPORT`, ...). On success it writes
`myapp/snapback/generated/` — server manifests
(`schema.manifest.json`, `functions.manifest.json`), the client binding
surface (`api.mjs` + `api.d.ts`), Contract binding modules under
`contract/`, per-function argument schemas under `operations/`, and
`artifacts.json` carrying the `inputsHash` freshness key. Commit the tree.

A running server loads the app over its admin API — the kit client wraps
the endpoints:

```js source=demos/todo/surfaces/headless/run.mjs
  await db.loadSchema(gen('schema.manifest.json'));
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset();
  await db.seed(JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8')));
```

For a `dev`-mode app,
`db.ensureApp({ schema, functions, seed })` is the idempotent form: it
provisions only what's missing and seeds only empty tables.

Sessions-mode provisioning is deliberately explicit and admin-authorized:

```js fragment reason="generated manifests and seed come from the app build"
const db = new SnapbackClient(baseUrl, { adminToken });
await db.ensureApp({
  intent: 'provision',
  requestedMode: 'sessions',
  schema,
  functions,
  seed,
});
```

The untagged legacy body is refused once sessions mode is active. Explicit
provisioning always carries the client's configured admin token and remains
non-production-profile gated, even when artifact hashes already match. A fresh
`dev → sessions` provision stages the sessions deployment and closes app data
until the required process restart consumes it; same-mode sessions provisioning
is idempotent without weakening the gate. Explicit mode provisioning does not
yet accept a routes manifest.

Then call it. Function references are the generated `api.<name>` objects
from `generated/api.mjs`, and mutations return structured results:

```js source=demos/todo/tests/acceptance/headless.mjs
    const created = await db.mutate(api.createTodo, { args: { title: 'Buy milk' }, userId: ADA });
```

Continue with [the authoring loop](./the-authoring-loop.md) for the full
edit-regenerate-test cycle, and
[testing/acceptance](../testing/acceptance.md) for the harness.

## Anti-patterns

- **Do not hand-wire HTTP glue for app data.** The generated `api.mjs`
  references plus the kit client (or the Contract adapter /
  React arm) are the product path; raw `fetch` against `/query/...` is how
  demos accumulated unauditable glue before the kit existed.
- **Do not edit anything under `generated/`.** Regenerate. The server
  rejects stale artifacts loudly (`SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION`,
  `SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH`).
- **Do not set `_createdAt`/`_updatedAt`/`_id`/`_version`.** Server-owned;
  declaring them in a schema is a hard error.
- **Do not assert identity from the client.** `ctx.auth.userId` is derived
  server-side; see [auth](../auth/sessions-and-principals.md).
