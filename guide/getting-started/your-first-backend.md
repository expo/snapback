---
title: Your first backend
id: getting-started.your-first-backend
order: 1
audience: agent-first
capabilities: [backend.schema, backend.functions, backend.seed, backend.provisioning, backend.codegen]
authorities: [llp/0004-application-data-api.rfc.md, llp/0037-schema-source-of-truth.decision.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0108-inline-handlers-and-result-contracts.spec.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/inline-handlers.mjs, packages/snapback-codegen/index.mjs, packages/snapback-client/index.mjs]
examples: [demos/todo/snapback, demos/todo-v2/snapback, demos/signal-desk/snapback, packages/snapback-codegen/inline-result-contracts.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-03
reviewed-commit: 6e5d69d1037c6042fb9338221dfb489e00f5f78a
---

# Your first backend

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A Snapback backend is a directory — conventionally `<app>/snapback/` —
holding a handful of source-authored `.mjs` files plus a generated review
manifest and an ignored, regenerable artifact materialization:

For the current source/packed React path, start with
`snapback new my-app --template react`, install the generated dependencies,
and run `bun run dev`. That one script owns both this backend loop and Vite;
the exact public-versus-staged package boundary and seed-on-new-database
behavior are in [the authoring loop](./the-authoring-loop.md).

```text
myapp/
  snapback/
    schema.mjs        # source-authored schema (the source of truth)
    functions.mjs     # query/mutation/action definitions, JS handlers inline
    seed.json         # deterministic declarative seed
    generated/
      artifacts.json  # committed deterministic review manifest
      ...             # ignored cache materialization; never hand-edited
  .snapback/
    codegen-cache/    # complete graphs keyed by the complete inputsHash
```

You write the first three. Codegen owns everything under `generated/` and
`.snapback/codegen-cache/`. Commit `generated/artifacts.json` and only
consumer projections explicitly required by policy; see
[generated artifact custody](./generated-artifacts.md). (Apps on the
[legacy bundled-module form](#legacy-compatibility-bundled-handler-modules)
author one more file, `handlers.mjs`.)

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

The core validators: `v.string()`, `v.principal()`, `v.id(table)`,
`v.boolean()`, `v.integer()`, `v.real()` / `v.number()`, `v.json()`,
`v.object({...})`, and `v.optional(inner)`. This inventory is deliberately
partial: specialized validators — typed asset references (`v.assetRef`,
[assets](../backend/assets.md)), result-side `v.doc(table)` references
([queries](../backend/queries.md)) — are taught with their features.
`defineSchema` also takes an
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
2. **Inline JS handlers** (`defineJsQuery`, `defineJsLiveQuery`,
   `defineJsMutation`, `defineAction`) — one direct, self-contained
   `handler:` expression colocated with its arguments, result contract, and
   declared reads/writes, run against the injected `ctx`.

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

A JS mutation and a JS live query in the paved inline form — each definition
carries its `handler` directly, next to `args`, `result`, and the declared
`reads`/`writes`:

```js source=packages/snapback-codegen/inline-result-contracts.test.mjs
  export const createTodo = defineJsMutation({
    args: { title: v.string() },
    writes: ['todos'],
    result: results.value(v.id('todos')),
    handler: async (ctx, args) => ctx.db.insert('todos', { title: args.title }),
  });
  export const watchTodos = defineJsLiveQuery({
    args: {},
    reads: ['todos'],
    result: results.documents('todos'),
    handler: async (ctx) => ctx.db.query('todos').collect(),
  });
```

(That excerpt is transcluded from the codegen package's inline-handler
conformance test over a minimal `todos` table, so this page breaks if the
paved form drifts. Fuller inline examples — index-first lookups, auth
scoping, multi-table writes — are transcluded from
`demos/signal-desk/snapback/functions.mjs` on the reference pages linked
below.)

A declarative mutation, for comparison:

```js source=demos/todo/snapback/functions.mjs
export const editTitle = defineMutation({
  args: { id: v.string(), title: v.string() },
  plan: patch('todos', arg('id'), { title: arg('title') }),
  returns: returnChangedCount(),
});
```

Use a declarative plan when the plan vocabulary expresses the operation; use
an inline JS handler for bounded logic it cannot express.
`demos/todo-v2/snapback/functions.mjs` is a fully declarative app, and
`demos/signal-desk/snapback/functions.mjs` mixes declarative live queries
with inline JS mutations — the side-by-sides worth reading when choosing.
The reference pages carry the complete semantics:
[queries](../backend/queries.md), [mutations](../backend/mutations.md), and
[actions](../backend/actions-and-fetch.md).

## Inside a JS handler

A handler receives only the injected `ctx` and its validated `args` — no
imports, no `process`/env, no timers, no network, no direct storage. The
core `ctx.db` surface: `ctx.db.query(table).withIndex(name).eq(field, value)`
`.in(field, [...])`.`order(field, dir)`.`collect()`, plus
`ctx.db.get(table, id)`, `ctx.db.insert(table, values)`,
`ctx.db.patch(table, id, values)`, `ctx.db.delete(table, id)`, and
`ctx.auth.userId` — the server-derived identity
([never client-asserted](../auth/sessions-and-principals.md)).

Inline v1 is deliberately self-contained: it does not capture imports,
sibling helpers, or outer constants, so put all application logic and locals
inside the direct handler expression. Class syntax, dynamic import, `eval`,
and `Function` are refused during generation.

### What the subset refuses, and the standard rewrites

Every refusal below happens at generation with a file/line/column, never at
runtime:

| Refused | Diagnostic gist | Standard rewrite |
| --- | --- | --- |
| Dynamic computed member access (`s[i]`, `vec[slot] += d`) | `dynamic computed member access is outside inline_handler_v1` | walk strings with `charAt`/`charCodeAt`; update slots with `arr.map((v, i) => i === slot ? v + d : v)` |
| Sibling capture (imports, outer consts, helper functions) | free identifier outside the allowlist | inline the logic, or declare the helper *inside* the handler body |
| An empty `writes: []` on `defineJsMutation` | `defineJsMutation requires declared writes` | declare the tables the mutation may write, even if a given path writes none |
| A query verb outside the builder | `<verb> is not a query-builder verb` | use the [documented chain](../backend/queries.md#the-complete-builder-chain) |
| Class syntax, `this`/`super`, dynamic `import`, `eval`, `Function` | named per construct | restructure as plain functions and values |

What **is** available, and needs no ceremony: `JSON.stringify`/`JSON.parse`,
`Math`, `String.fromCharCode`, template literals, arrow helpers declared
inside the handler body, ordinary array methods (`map`, `filter`, `reduce`,
`slice`, `sort`), and destructuring with static names.
[Queries](../backend/queries.md) covers the capture limits; the governing
spec is
[LLP 0108](repo:llp/0108-inline-handlers-and-result-contracts.spec.md).

Declare what a handler returns. JS query and live-query handlers return an
**array of rows** (`[]` for missing, `[row]` for present) described by
`results.documents(table)` or `results.records(v.object({...}))`; mutations
and actions use `results.value(validator)` or `results.document(table)`.
Omitting `result` is an explicit degraded `unknown` contract. The complete
result-contract vocabulary and runtime-validation rules are on
[queries](../backend/queries.md) and [mutations](../backend/mutations.md).

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

Codegen **fails closed**: on any error it leaves the previously serveable
graph intact and exits 1 with stable diagnostic codes
(`QUERY_UNKNOWN_FIELD`, `FUNCTION_RESERVED_EXPORT`, ...). On success it writes
a complete input-hash cache and materializes `myapp/snapback/generated/` for
compatibility — server manifests
(`schema.manifest.json`, `functions.manifest.json`), the client binding
surface (`api.mjs` + `api.d.ts`), Contract binding modules under
`contract/`, per-function argument schemas under `operations/`, and
`artifacts.json` carrying digests, custody, the `inputsHash`, and the
deterministic author summary. Commit the review manifest, not the ordinary
cache projections.

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
  routes,
});
```

The untagged legacy body is refused once sessions mode is active. Explicit
provisioning always carries the client's configured admin token and remains
non-production-profile gated, even when artifact hashes already match. A fresh
`dev → sessions` provision stages the sessions deployment and closes app data
until the required process restart consumes it; same-mode sessions provisioning
is idempotent without weakening the gate. Explicit mode provisioning does not
reinterpret route identity: it validates `routes` against the same candidate
schema/functions pair and installs them only with that deployment.

Then call it. Function references are the generated `api.<name>` objects
from `generated/api.mjs`, and mutations return structured results:

```js source=demos/todo/tests/acceptance/headless.mjs
    const created = await db.mutate(api.createTodo, { args: { title: 'Buy milk' }, userId: ADA });
```

Continue with [the authoring loop](./the-authoring-loop.md) for the full
edit-regenerate-test cycle, and
[testing/acceptance](../testing/acceptance.md) for the harness.

## Legacy compatibility: bundled handler modules

Before inline handlers landed, the JS style split every definition from its
logic: the definition names a bundled module and export
(`source` / `exportName`), and the logic registers on a global in a separate
authored `handlers.mjs` next to `functions.mjs`. This form remains fully
supported — `demos/todo` still uses it — but it is the compatibility lane,
not the paved path for new work.

The definition names its handler and declares its writes:

```js source=demos/todo/snapback/functions.mjs
export const createTodo = defineJsMutation({
  args: { title: v.string() },
  source: 'handlers.mjs',
  exportName: 'createTodo',
  writes: ['todos'],
});
```

The bundled module registers its logic on a global and receives the same
injected `ctx` and bounded `ctx.db` surface as an inline handler:

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

The `{ source, exportName }` lane remains useful for existing apps already
on the split and for logic that genuinely needs imported or sibling helpers,
which inline v1 deliberately refuses to capture. One definition declares
`handler` or `source`/`exportName`, never both — mixed or missing
discriminants fail generation with
`SNAPBACK_FUNCTION_HANDLER_FORM_INVALID`.

## Anti-patterns

- **Do not hand-wire HTTP glue for app data.** The generated `api.mjs`
  references plus the kit client (or the Contract adapter /
  React arm) are the product path; raw `fetch` against `/query/...` is how
  demos accumulated unauditable glue before the kit existed.
- **Do not start new JS functions on the bundled `handlers.mjs` split.**
  Inline `handler:` is the paved form; the `source`/`exportName` module lane
  is compatibility for existing apps and for logic that needs sibling
  modules.
- **Do not edit anything under `generated/` or `.snapback/codegen-cache/`.**
  Regenerate. The server
  rejects stale artifacts loudly (`SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION`,
  `SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH`).
- **Do not set `_createdAt`/`_updatedAt`/`_id`/`_version`.** Server-owned;
  declaring them in a schema is a hard error.
- **Do not assert identity from the client.** `ctx.auth.userId` is derived
  server-side; see [auth](../auth/sessions-and-principals.md).
