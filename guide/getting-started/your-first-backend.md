---
title: Your first backend
id: getting-started.your-first-backend
order: 1
audience: agent-first
capabilities: [backend.schema, backend.structured-stored-fields, backend.stored-enums, backend.functions, backend.seed, backend.provisioning, backend.codegen]
authorities: [llp/0004-application-data-api.rfc.md, llp/0037-schema-source-of-truth.decision.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0108-inline-handlers-and-result-contracts.spec.md, llp/0115-convex-parity-course-corrections.plan.md, llp/0174-authoring-incidents-at-security-fences.research.md, llp/0211-typed-opaque-structured-stored-values.spec.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/inline-handlers.mjs, packages/snapback-codegen/index.mjs, packages/snapback-client/index.mjs, src/contract_types.rs, src/storage.rs]
examples: [demos/todo/snapback, demos/todo-v2/snapback, demos/signal-desk/snapback, packages/snapback-codegen/inline-result-contracts.test.mjs, packages/snapback-codegen/stored-enum-authoring.test.mjs, packages/snapback-codegen/structured-stored-values.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-09
reviewed-authorities-digest: sha256:b3d9adcd8e76825df7794cd4c78f72926c6f0cd6fa43552f8d54d2f82cc125ba
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
`v.object({...})`, `v.array(inner)`, and `v.optional(inner)`. This inventory is deliberately
partial: specialized validators — typed asset references (`v.assetRef`,
[assets](../backend/assets.md)), result-side `v.doc(table)` references
([queries](../backend/queries.md)) — are taught with their features.

**Storing media is an asset workflow, not a string-field shortcut.** If a
field will hold an uploaded photo, video, or file, stop here and follow
[Assets](../backend/assets.md): declare an asset intent, upload and finalize
through the generated asset surface, then attach a typed `v.assetRef` (or use
the finalized-only [`v.media()` happy path](../backend/media-happy-paths.md)).
Do not place a `data:image/...;base64,...` or `data:video/...` value in
`v.string()`/`v.json()` merely because it type-checks; that bypasses upload
bounds, trusted media finalization, delivery policy, GC, and rendition state.

<!-- since: 0.1.18 -->

**Closed string domains (enums).** A field whose values come from a fixed set
— a role, a status, a visibility — declares that set directly, instead of
storing `v.string()` and re-checking the domain in every writer:

```js source=packages/snapback-codegen/stored-enum-authoring.test.mjs
  todos: defineTable({
    role: v.union([v.literal('crew'), v.literal('user')]),
    visibility: v.optional(v.union([v.literal('internal'), v.literal('public')])),
    title: v.string(),
  }).index('by_role', ['role']).sync(),
```

Two to seven unique string literals, each at most 64 UTF-8 bytes; authored
order is the order of the generated type. The column is ordinary `TEXT`, so
the field indexes, filters, orders, and syncs exactly like `v.string()`, and
the generated TypeScript is the literal union (`"crew" | "user"`, or
`null | "internal" | "public"` when optional). Every central writer enforces
the domain: an out-of-domain string refuses with
`SNAPBACK_FIELD_ENUM_VALUE_INVALID` naming the field and the admitted values,
and commits nothing — which is why authorization-relevant fields belong here
rather than in a hand-written guard. Seven, not eight, because an optional
field's result contract adds a `null` variant against the eight-variant union
bound.

Changing a domain is a schema change with a data rule. Widening one (or going
back to `v.string()`) applies without a scan. Narrowing one — including
tightening an existing `v.string()` field into a domain — is applied only when
every stored value already satisfies it; otherwise the whole activation
refuses with `SNAPBACK_SCHEMA_ENUM_DOMAIN_BACKFILL_REQUIRED` naming an
offending value, and neither the manifest nor the table moves.

**Typed opaque arrays and objects.** At a table-field position,
`v.object({...})`, `v.array(inner)`, and non-enum unions rooted in those nodes
now compile to a persisted structured contract instead of silently degrading
to `v.json()`. Objects are closed maps. Nested `v.optional(...)` is legal only
for object members and means omission, not `null`; declare `v.null()` as a
union variant when null is data. The admitted leaves are strings, booleans,
the integer/real/finite-real/number spellings, scalar literals, arrays,
objects, and syntactically disjoint unions. Generated document, handler, and
client types preserve the declared shape exactly.

The runtime carrier is `canonical-json-text.v1`: the server validates the
whole value, normalizes integral Reals, writes canonical JSON `TEXT`, and
reloads a logical object or array. Admission is atomic and bounded at 32 KiB
per value, 48 KiB of structured data per row, depth 16, and 1,024 array
elements. Structured values are opaque to observation in this phase: ordinary
indexes, filters, orders, live matchers, search membership, search/vector
`storedFields`, and bounded/relational/maintained projections refuse them.
Project a scalar into an ordinary field when it must be queried.

`structured_stored_value_v1` is registered experimental and supported on the
local target. Schemas using this grammar carry that explicit capability
requirement, so older runtimes refuse coherently at capability settlement
instead of degrading the value to `v.json()`. `v.json()` remains the unchanged
untyped escape hatch.
The remaining [`backend.structured-stored-fields` GAP](../capabilities.md) is
queryable structure—interior predicates, containment, and portable declared
projections—owned by
[LLP 0115 CV-4b](repo:llp/0115-convex-parity-course-corrections.plan.md#cv-4-structured-collection-validators-split-arguments-then-storage).

**There is no numeric identity or default column.** A server-owned monotonic
number (PostgreSQL's `GENERATED ... AS IDENTITY`, a `SERIAL`) has no
declaration here, and neither does a per-field default. Mint ids with
`v.id(table)`/`_id`, or allocate a human-facing number with a
[scoped sequence](../backend/sequences.md), which is dense, transactional, and
scoped to a row of a parent table. The identity-column gap is owned by
`issues/20260808-numeric-identity-default-columns.md` under
[LLP 0191](repo:llp/0191-scale-architecture-revisits.research.md)'s
commissioned identity-architecture Decision.

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

They also cannot appear in an authored `.index(...)` declaration: codegen
reports `SCHEMA_UNKNOWN_FIELD`. Every declared index already receives an
implicit trailing `_id` component for deterministic scan order, so never add
`_id` yourself. System fields remain legal query filter/order leaves; for a
cursor such as `(playerId, _version)`, declare the authored partition index on
`playerId`, then range/order by `_version` in the query. Snapback does not yet
offer a portable author-declared composite index containing `_version` or a
timestamp system field.

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

If the function accepts, finalizes, attaches, or delivers a file, use the
generated [asset intent and finalization flow](../backend/assets.md) alongside
the mutation. Base64/data-URL payloads are ordinary oversized strings, not a
second media pipeline.

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
The generated
[`@expo/snapback-codegen/ctx` reference](../reference/expo-snapback-codegen--ctx.md)
is the complete verb and read/write-split lookup. Its declarations are the
same published type owner that each app's generated `api.d.ts` instantiates.

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
snapback generate myapp/snapback
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

The `{ source, exportName }` lane reads exactly one closed script. It supports
top-level helper functions in that same file; it does not load imported helpers
or a multi-file module graph. Any static or dynamic import is refused during
generation with `BUNDLE_UNSUPPORTED_IMPORT`. Third-party package admission is
still an open code-execution and supply-chain design question, not a sanctioned
pre-bundling workaround. One definition declares `handler` or
`source`/`exportName`, never both — mixed or missing discriminants fail
generation with
`SNAPBACK_FUNCTION_HANDLER_FORM_INVALID`.

## Anti-patterns

- **Do not hand-wire HTTP glue for app data.** The generated `api.mjs`
  references plus the kit client (or the Contract adapter /
  React arm) are the product path; raw `fetch` against `/query/...` is how
  demos accumulated unauditable glue before the kit existed.
- **Do not start new JS functions on the bundled `handlers.mjs` split.**
  Inline `handler:` is the paved form; the `source`/`exportName` module lane
  is compatibility for existing apps. It is still a closed single script,
  not an import or package-admission escape hatch.
- **Do not edit anything under `generated/` or `.snapback/codegen-cache/`.**
  Regenerate. The server
  rejects stale artifacts loudly (`SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION`,
  `SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH`).
- **Do not set `_createdAt`/`_updatedAt`/`_id`/`_version`.** Server-owned;
  declaring them in a schema is a hard error.
- **Do not assert identity from the client.** `ctx.auth.userId` is derived
  server-side; see [auth](../auth/sessions-and-principals.md).
