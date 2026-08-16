<!-- Generated getting-started section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/getting-started/your-first-backend.md -->
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
    .visibility({ kind: 'owner', field: 'userId' })
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
the integer/real/finite-real/number spellings, scalar literals, principals,
arrays, objects, and syntactically disjoint unions. Generated document,
handler, and client types preserve the declared shape exactly.

A nested `v.principal()` is a validated **snapshot value only**. For example,
`v.array(v.principal(), { maxItems: 32 })` can preserve the recipients recorded
at send time, but Snapback never derives current membership, row visibility,
asset access, or another grant from that opaque array. Put current authority in
a first-class principal field, membership row, or grant.

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
untyped escape hatch. To strengthen an already-installed `v.json()` field into
this grammar without changing its name, use the reviewed
[`ConvertJsonToStructured` migration](../backend/migrations.md#evolve-vjson-into-a-structured-field);
direct retyping correctly refuses.
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
    });
  },
```

Because `todos` is owner-scoped, `createTodo` omits `userId`; the host stamps
the effective principal and refuses application-authored owner input.

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

---

<!-- snapback-guide-source: guide/getting-started/the-authoring-loop.md -->
---
title: The authoring loop
id: getting-started.the-authoring-loop
order: 2
audience: agent-first
capabilities: [backend.codegen, authoring.declaration-suggestions, operating.packaged-dev-loop, testing.acceptance, operating.inspect]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0041-packaged-dev-loop.rfc.md, llp/0245-infer-show-freeze-declarations.rfc.md, llp/0262-dev-identity-custody-capability.rfc.md, src/cli.rs, src/dev_identity.rs, packages/create-snapback-app/cli.mjs, packages/snapback-cli/index.mjs, packages/snapback-cli/templates, packages/snapback-codegen/index.mjs, packages/snapback-vite/lifecycle.mjs, packages/snapback-vite/proxy.mjs, scripts/snapback-package-cold-install.mjs, scripts/verify-local-proof]
examples: [packages/snapback-cli/templates/todo-contract, packages/snapback-cli/templates/react, packages/snapback-cli/templates/expo-chat, packages/snapback-cli/sessions-dev-loop.test.mjs, demos/todo/tests/acceptance/headless.mjs, demos/todo/surfaces/headless/run.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-16
reviewed-authorities-digest: sha256:2e65285c7733161978cafa2fcbf8994cbd131ee45ee1f6ca92f64bf3a7a38eac
---

# The authoring loop

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The cycle you repeat while building on Snapback:

```text
edit snapback/*.mjs  ->  regenerate  ->  run the acceptance suite  ->  inspect
```

The `snapback` command ships in the published `@expo/snapback-cli` package.
Install it once, globally, with whichever package manager you use:

```sh
npm install -g @expo/snapback-cli    # or: bun add -g @expo/snapback-cli
```

The current source and packed-package React path is:

```sh
snapback doctor --json
snapback new my-app --template react
cd my-app
bun install
bun run dev
```

<!-- since: 0.1.12 -->

Five templates ship in the packaged CLI:

- `todo-contract` — the smallest backend-first scaffold, with generated
  headless client references and acceptance but no Contract UI.
- `react` — a minimal React/Vite web app with a live todo query, mutation,
  and connection state.
- `crud-dashboard` — a React/Vite project dashboard with relational directory
  reads, independent live detail, and optimistic CRUD.
- `media-feed` — an Expo iOS/Android/web feed with image upload, a composed
  publish command, and collision-safe load-more pagination.
- `expo-chat` — the golden-path Expo conversation starter described below.

The `expo-chat` template carries
the LLP 0176 conversation surface as runnable code: a `messages` table
with an image `assetRef` field, the `messageImageUpload` intent, live
queries, the generated `conversation` surface (reads, a bound `sendText`
mutation, the composed `send` command with optional image upload, and
typing presence), and a React Native chat screen driving all of it
through `useSurface`. Scaffold it with
`snapback new my-chat --template expo-chat` and edit the working example
instead of composing that wiring from prose. The starter ships sessions
mode (`auth: { mode: 'sessions' }`) with seeded personas: the supervised
dev loop mints an ordinary session automatically, so authenticated send
and image upload work with zero edits. It still passes the seeded persona
as an explicit `senderId` argument and keeps chat history public-read; a
production chat derives sender identity from the adopted session and
scopes reads to conversation membership
([auth](../auth/sessions-and-principals.md)).

<!-- since: 0.1.15 -->

The same scaffold is also reachable through the ecosystem-standard entry
point, the `create-snapback-app` package (first published with the 0.1.15
closure):

```sh
npm create snapback-app my-chat
# equivalently: npx create-snapback-app my-chat
#               bun create snapback-app my-chat
#               pnpm create snapback-app my-chat
```

It is a thin wrapper — argument parsing and next-step output only — that
delegates to the same `snapback new` scaffold mechanism and template
registry in `@expo/snapback-cli`. Its default template is `expo-chat`;
`create-snapback-app --help` lists every template the installed CLI ships,
and `--template <name>` selects one.

The generated `dev` script is one supervisor:
`snapback dev snapback --client . --client-command vite`. It generates the
backend, starts or attaches to the native server, loads the app, then starts
Vite and watches both sides. Browser code uses only Vite's relative
`/__snapback` relay; it does not receive the loopback origin, admin token,
runtime path, or repository path. The template uses generated query/mutation
references and the first-party React provider/hooks; it does not add
application-owned subscription cleanup. If you launch Metro or Expo yourself
— including `CI=1 snapback dev --client-command "npx expo start"` — do not
inherit a truthy `CI`: Expo/Metro disable file watching and you will serve a
stale bundle. Prefer `snapback dev --expo`, or unset `CI` / pass `CI=0`.
`snapback dev` prints `SNAPBACK_EXPO_METRO_WATCH_INERT` as an advisory when
it can see that environment; it does not refuse.

The React/Vite templates import the relative relay base from the generated
development virtual module:

```ts source=packages/snapback-cli/templates/react/src/snapback-dev.d.ts
declare module 'virtual:snapback/dev' {
  import type {
    SnapbackAppBindingV1,
    SnapbackApplicationDescriptorV1,
  } from '@expo/snapback-client';

  export const snapbackBasePath: string;
  export const snapbackDevState: Readonly<{
    mode: 'off' | 'external' | 'attach' | 'managed' | 'auto';
    shape: string | null;
    ready: boolean;
    basePath: string;
  }>;
  export function createSnapbackDevAppBinding(
    app: SnapbackApplicationDescriptorV1,
  ): SnapbackAppBindingV1;
}
```

`@expo/snapback-vite` supplies `virtual:snapback/dev`; there is no file to
install or generate at that specifier. A hand-built TypeScript/Vite app must
add the ambient declaration above (conventionally
`src/snapback-dev.d.ts`) so the compiler knows the relay state and app-binding
helper. Pass the generated `app` to `createSnapbackDevAppBinding`, then pass
that binding to `createSnapbackAppClient`; the helper emits only the
same-origin relative relay path, never a loopback server URL.

The package `@expo/snapback-cli` supplies the `snapback` command — the
terminal npm identity (LLP 0115 decision 9): the workspace name and the
registry name are the same. The recorded pre-migration public closure
(`0.1.x`) was published under the interim `@ccheever/snapback-*` aliases from
the then-`@snapback/*` source names; those receipts remain verifiable as
lineage. The original byte-verified `0.1.0` closure contained the
macOS/arm64 and Linux/x64 runtimes plus Contract, client, codegen, React,
app CLI, and developer-loop CLI packages; clean GitHub-hosted machines on
both supported runtime tuples installed that exact closure and passed the
original `todo-contract` scaffold/generate/dev/watch proof. The published
closure has since widened to eleven packages, including
`@expo/snapback-expo` and `create-snapback-app`.

Which closure you get from npm is recorded, not remembered:
[`published-closure.json`](../published-closure.json) is the authority, and
its two fields carry the tradeoff. `newestPublished` is the newest closure on
the registry — what the `latest` tag installs. `newestQualified` is the
newest closure that also carries a complete public-qualification receipt from
the LLP 0137 G1 arm
(`demos/improvement-sweep/arms/g1-public-package-qualification/`):
`snapback new --template react`, `bun install`, `snapback generate`, a strict
typecheck, `vite build`, the `snapback dev` lifecycle, template live
acceptance with real handler execution, and a clean stop, proven from a clean
external directory. When the two fields differ, the newer publications are
deliberate fast-path releases with no qualification-arm receipt of their own
(the "Fast-path pre-consumer release" section of
[LLP 0041](repo:llp/0041-packaged-dev-loop.rfc.md)): install `latest` for
the newest surface and fixes, or pin the recorded `newestQualified` version
when you need the independently proven closure.

Still do not infer that a published closure contains every surface in the
current source tree: source lands continuously, and a packaged consumer has
whatever the newest published version froze. When a page describes a surface
newer than the newest closure, it says so. This rule is mechanical: pages carry
`since:` / `unreleased:` fences checked against
[`published-closure.json`](../published-closure.json) by
`scripts/check-guide.mjs`.

On each supported tuple the mapped runtime package carries the prebuilt server
and Hermes runtime. `doctor` first launches that relocated binary with
ambient dynamic-loader overrides removed, then creates a disposable app and
database, generates and loads its bundle, invokes a query, commits a mutation,
opens and closes a live subscription, stops the owned server through its ready
descriptor, and removes the temporary state. Its `snapback.cli-doctor.v2`
result reports one stable code per completed boundary; a launch-only result is
test instrumentation and never the installed-product claim. Other host tuples
report `SNAPBACK_IBEX_HOST_UNSUPPORTED`—they are not source-build fallbacks
disguised as installs. The former `@snapback/*` source scope belongs to an
unrelated npm product, which is why publication historically used the
`@ccheever/snapback-*` aliases; under the terminal `@expo/snapback-*` scope
application imports and published names are one identity and no alias
mapping exists.

## 1. Edit

Change `schema.mjs`, `functions.mjs`, or `seed.json`
([your first backend](./your-first-backend.md) covers each; apps on the
legacy bundled-module form also edit `handlers.mjs`).

## 2. Regenerate

In a source checkout, install the pinned workspace dependencies once before
running repository codegen:

```sh
bun install --frozen-lockfile
```

```sh
node packages/snapback-codegen/index.mjs <app>/snapback
```

Outside this repository, use the packaged equivalent:

```sh
snapback generate snapback
```

`snapback dev snapback` runs that generation first, starts or attaches to the
native server via `.snapback/dev.ready.json`, loads the generated schema and
functions, installs a generated versioned seed only for a newly created
managed database, and watches source changes through one coalesced generation
at a time. Later starts and watch reloads require the exact installed seed
identity to match; they do not reset or restore user data. A changed
`seedVersion` therefore reports `SNAPBACK_SEED_MIGRATION_REQUIRED` until you
choose migration or an explicit destructive reset-install. For the local dev
destructive branch, `snapback reset --dev-fresh` is the one-shot path: fresh
database, seed re-install, and sessions verification or supervised re-mint.

The command infers `dev` versus `sessions` from the generated schema.
Sessions-mode managed starts supply the complete closed schema/functions
startup carrier before listener bind, including on backend restart; later
reloads use the complete admin-authorized provisioning pair instead of the
dev-only raw host-load verbs. The attach path validates the database target
before reading the managed owner-only token. A different target fails with
`SNAPBACK_DEV_SERVER_TARGET_MISMATCH`. If initial attach/load fails, a server
started by this command is stopped. If later generation succeeds but live load
fails, the event state is `generated-but-not-loaded`; generation errors are
the distinct `generation-failed` state.

For a dev-auth app, the served backend rotates an owner-only `sbdev_`
capability each boot and advertises its path as
`devIdentityCapabilityFile` in the ready descriptor. The managed Vite loop
re-reads that sidecar and stamps `x-snapback-dev-identity` on relayed app
requests and `/connection/open`; it overwrites a browser-supplied value and
never exposes the bearer through `virtual:snapback/dev`. Attach or external
Vite instead receives the explicit trusted-host handoff
`SNAPBACK_DEV_IDENTITY_FILE=<path>`. During LLP 0262 rollout stage 1, missing
custody still runs with one server warning per boot; a capability that is
present but does not verify is already refused, and full enforcement waits for
the carrier acceptance witness.

Use `snapback --help` to enumerate the complete packaged and delegated native
surface. `snapback <command> [<subcommand>...] --help` is non-executing and
selects the longest registered wrapper path, so commands such as
`snapback backup create plan --help` show their actual required flags rather
than only the top-level backup summary. Package help also declares whether the
selected command is one-shot or long-running, its machine output, exit
taxonomy, and recovery channel. `snapback hosted lifecycle --help` lists its
closed verbs, transport flags, and current availability gate.

Bare `snapback` is also discovery-only and prints root help. Start the normal
authoring loop explicitly with `snapback dev`; use native `snapback start` only
when a lower-level harness deliberately owns server loading and lifecycle.

<!-- since: 0.1.21 -->
## Suggest, review, and apply a result contract

After generation has produced current context types, ask Snapback to derive a
result-only candidate from one operation's TypeScript/JSDoc return evidence.
Review the ordinary patch and its grouped runtime/type consequences first:

```sh
snapback author suggest snapback/functions.mjs#createTodo --format patch
```

Retain the machine record when you want the stale-safe apply seam:

```sh
snapback author suggest snapback/functions.mjs#createTodo --json > suggestion.json
```

Then apply exactly that one suggestion. The command rereads the complete
definition/helper/type/schema/compiler input closure and writes atomically
only when its identity and exact patch target still match:

```sh
snapback author suggestion apply suggestion.json --json
```

An `exact` or `schema-derived` candidate has a complete patch. `widened`
evidence deserves extra review; `holed` and `refused` candidates deliberately
have no patch until an author supplies the missing bound, refinement, or
closed shape. The suggestion receipt never becomes runtime authority: normal
generation freezes the accepted `result:` declaration and derives runtime
validation plus generated-client types from that source.

When `snapback dev` runs without a TTY, stdin accepts optional
`snapback.dev-command.v1` JSON lines while it remains open. EOF only closes
that control channel: it does not stop the server, watcher, or generated
client arm. Stop a detached loop with SIGINT/SIGTERM; an interactive terminal
may also use `q` or Ctrl-C. This is deliberately different from stdio MCP
servers, where EOF ends the protocol process.

If a selected native runtime predates the generated artifact shape, the loop
reports `SNAPBACK_RUNTIME_ARTIFACT_IDENTITY_MISMATCH` with the exact selected
binary, its independent build stamp when available, the artifact paths, and
two safe recovery paths: rebuild from the same source revision or point
`SNAPBACK_RUNTIME_BINARY` at a compatible binary. Do not delete generated
fields or hand-edit artifacts to fit an older runtime.

Codegen is deterministic and **fails closed** — on error it writes nothing
and exits 1 with stable diagnostic codes on stderr, so there is never
silently stale output. On success it prints an author summary and the
`inputsHash` freshness key. Commit `generated/artifacts.json` with your source
change, plus only projections explicitly named by consumer policy. The
complete graph is regenerated under `.snapback/codegen-cache/<inputsHash>/`;
see [generated artifact custody](./generated-artifacts.md). The server compares hashes and
rejects stale artifacts loudly (`SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION`,
`SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH`) rather than serving them.

If you forget this step, the very first server load or acceptance run tells
you; nothing downstream guesses.

A raw `ERR_MODULE_NOT_FOUND` for `acorn`, `esbuild`, or `typescript` means the
source checkout has not completed the pinned install above. It is a contributor
environment failure, not an application diagnostic. Packaged
`snapback generate` installs these as ordinary package dependencies.

## Evolve a table that already has data

Adding an **optional** field to a populated table is an ordinary edit, not a
migration ceremony: change the schema and let the running `snapback dev`
watch reload pick it up. The reload evolves the catalog in place, and live
handles may stay attached while it happens — a subscriber does not have to be
torn down first.

For the complete sessions loop — what the pin records, why identities rotate,
how packaged cold-successor activation advances it, and how to preserve rows
after a partial load — use
[Evolve a sessions schema without discarding data](../backend/schema-evolution.md).

What matters is *where* you do it. Stop the server, regenerate, and restart,
and a sessions-mode app refuses with
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`, whose details carry the expected
and observed deployment identities: the settled deployment's startup carrier
no longer matches the artifacts on disk. The recovery is the exact-carrier
then packaged-successor path on the detailed page; do not discard the database
or hand-edit its pin.

Additive changes (new optional fields, new tables, new indexes) are what this
loop supports. Destructive changes — dropping a field, tightening an optional
field to required, changing a field's type — are refused by the conservative
applier; they need the reviewed migration path
([reviewed migrations](../backend/migrations.md#run-the-reviewed-loop);
design: [LLP 0081](repo:llp/0081-reviewed-storage-evolution-and-migrations.rfc.md)),
not a redeploy. Seeded data is separate again: a changed seed identity reports
`SNAPBACK_SEED_MIGRATION_REQUIRED` and is resolved on the
[versioned seeds](../backend/versioned-seeds.md) page, not here.

## 3. Run the acceptance suite

Headless first — the required surface is driveable without any UI
(LLP 0012). A suite boots its own isolated server and drives the real
product path:

```sh
cd <generated-app>
bun run test
```

The generated todo and React starters make that default live: it boots and
loads an isolated Snapback target, executes generated query and mutation
references, verifies loaded artifact identity, cleans up, and prints a
`snapback.starter-acceptance.v1` receipt. Use `bun run test:static` for the
faster generated-file/source-coherence check; it does not boot Snapback and
does not satisfy acceptance. The templates declare `packageManager: bun`, so
Bun is the paved runner; the scripts themselves are package-manager-agnostic
(`npm test` / `npm run test:static` are the equivalents if you manage the
generated app with npm). Repository demos that do not use a generated
starter run their named headless suite directly, for example
`node <app>/tests/acceptance/headless.mjs`.

Exit `0` = every declared check passed; `1` = a check failed or the run was
short (zero checks can never pass); `2` = setup error. See
[testing/acceptance](../testing/acceptance.md) for the harness and server
lifecycle discipline.

For a demo in this repo, the whole-repo proof is
`scripts/verify-local-proof` (add `SNAPBACK_VERIFY_EXACT=0` for a
deliberately core-only iteration; merge CI requires the Exact-gated block).

## 4. Inspect

A running server tells you what it is actually serving. `snapback dev`
prints the admin console URL on startup, and the packaged CLI opens the
console against the supervised server's ready descriptor:

```sh
snapback admin --ready-file .snapback/dev.ready.json
curl http://127.0.0.1:4287/inspect
```

(Contributors running the server from a source checkout get the same admin
URL printed by `cargo run`.)

`GET /inspect` is the public projection (instance, capability facts);
`GET /_snapback/api/inspect` is the admin-gated full view, and the admin
console renders the same surface in a browser — the author's debugger for
"what schema/functions/data does this server hold right now". Structured
failures everywhere carry stable `SNAPBACK_*` diagnostic codes
(`{ code, severity, subsystem, message, details }`), so match on
`error.diagnostic.code`, never on message text.

## Anti-patterns

- **Do not hand-edit the review manifest/cache or skip the regenerate step** — the
  server's stale-artifact rejection exists because "it probably still
  matches" was wrong often enough.
- **Do not assert on diagnostic message strings.** Codes are the contract;
  messages are prose.
- **Do not point a new suite at a server you didn't start.** Suites own
  their server lifecycle; see
  [testing/acceptance](../testing/acceptance.md).
- **Do not parse server logs for readiness.** `snapback dev` consumes the
  ready-file descriptor and verifies the live target; log text is not a
  lifecycle protocol.
- **Do not set `SNAPBACK_RUNTIME_BINARY` in ordinary installed projects.** It
  is a contributor/test override. Installed apps should exercise the selected
  platform runtime package so `doctor` verifies the artifact users receive.
- **Do not inherit `CI=1` when you launch Metro or Expo yourself.** File
  watching is inert and the served bundle goes stale. Prefer
  `snapback dev --expo`, or unset `CI` / pass `CI=0`
  ([React Expo clients](../clients/react-expo.md#know-what-the-supervisor-owns)).

---

<!-- snapback-guide-source: guide/getting-started/generated-artifacts.md -->
---
title: Generated artifact custody and review
id: getting-started.generated-artifacts
order: 3
audience: agent-first
capabilities: [backend.codegen]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0012-headless-integration-contract.spec.md, llp/0021-contract-exact-integration-hardening.plan.md, llp/0037-schema-source-of-truth.decision.md, llp/0041-packaged-dev-loop.rfc.md, llp/0252-convex-familiar-authoring-profile.rfc.md, llp/0253-familiar-profile-v1-api.spec.md, packages/snapback-codegen/review-surface.mjs, packages/snapback-codegen/review-manifest.schema.json, packages/snapback-codegen/codegen-policy.schema.json, packages/snapback-codegen/familiar.mjs, packages/snapback-codegen/index.mjs, packages/snapback-codegen/semantic-generation.mjs, schemas/normalized-definition.v1.schema.json]
examples: [packages/snapback-codegen/review-surface.test.mjs, packages/snapback-codegen/familiar-phase-a.test.mjs, packages/snapback-codegen/familiar-phase-b.test.mjs, tests/fixtures/familiar-todo, tests/fixtures/familiar-todo-explicit, packages/snapback-codegen/contract-output-mode.test.mjs, packages/snapback-cli/templates/react, demos/todo-v2/snapback/codegen.policy.json]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:88e5be1e178a53be282e824c2f4d83697cba481474c140c0fa180880c2fe48ca
---

# Generated artifact custody and review

Codegen separates reviewable source control state from regenerable build
output. One complete input hash names one complete generated graph; every file
in that graph has a SHA-256 digest and byte count.

## Know what belongs in source control

There are exactly three custody classes:

- `review-manifest`: `snapback/generated/artifacts.json`. Commit this file. It
  is the deterministic review projection for the whole graph.
- `consumer-committed`: a projection that a source-only consumer or CI policy
  explicitly needs. Commit only the paths listed in `committedProjections` in
  `snapback/codegen.policy.json`, and add matching negations to the app's
  `.gitignore`. The closed policy record uses
  `schemaVersion: "snapback.codegen-policy.v1"`.
- `regenerable-cache`: every other generated projection. These bytes live
  under `.snapback/codegen-cache/<inputsHash>/` and are ignored.

Snapback's maintained demos, including the backend bakeoff, use this
manifest-only policy. Existing external repositories may retain a committed
legacy `generated/` tree while they migrate; that compatibility is deliberately
limited to pre-v2 manifests and explicitly declared `consumer-committed`
projections. It is not an exception for new repository-owned demos. The admin
UI's separately generated bindings remain under their existing dedicated
generator and CI gate because they are not a Snapback backend graph.

<!-- since: 0.1.21 -->

## Choose Exact metadata output explicitly

Ordinary React, Expo, and headless generation is Contract-neutral. It still
emits `contract-data.manifest.json`, generated function references, callable
modules under `generated/contract/`, and `contract/runtime-links.ts`; none of
those imports Exact. It omits only rendered modules that import an `@exact/*`
package, currently the `.contract-meta.ts` sidecars.

If the project compiles `.contract` files against those sidecars, opt in with a
committed `snapback/codegen.policy.json`:

```json fragment reason="minimal codegen policy; applications preserve any existing committed projections"
{
  "schemaVersion": "snapback.codegen-policy.v1",
  "committedProjections": [],
  "contractMetadata": "exact"
}
```

Keep any existing `committedProjections` instead of replacing them. Commit the
policy and regenerate. The policy is part of the complete input hash, so its
Exact-enabled graph has a different freshness identity and artifact inventory
from the neutral graph. Installing `@exact/contract` does not enable the output
implicitly; package-presence probing would make generation irreproducible.

For published Snapback 0.1.20 and earlier, an npm-only app that does **not**
consume Contract can temporarily keep the unavailable Exact sidecars out of a
broad TypeScript program:

```json fragment reason="temporary tsconfig mitigation for published generators before explicit output selection"
{
  "exclude": ["snapback/generated/contract"]
}
```

That exclusion hides neutral bindings too, so it is mitigation for older
published generators, not the desired steady state. After upgrading to a
closure with explicit output selection, regenerate without the opt-in and
remove the exclusion; broad `tsc --noEmit` and lint should include the generated
TypeScript normally.

## Regenerate one complete graph

```sh
snapback generate snapback
snapback generate snapback --json
```

The human result inventories tables, operations by kind, live and ephemeral
counts, file custody, warnings, and degraded result types. A degraded result
links the authored export or schema field to the generated type and gives an
exact remediation. `--json` returns the same deterministic summary and structured
diagnostics.

<!-- since: 0.1.21 -->

Run `snapback generate snapback --check --json` when you need the complete
ordinary checker without replacing generated bytes. It discovers and
evaluates definitions, admits handlers and target capabilities, checks
contracts, renders and inventories the full temporary candidate, and then
discards that candidate before publication. Ordinary generation shares that
path and differs only at the final complete-graph publication step.

Successful generation and preflight include
`handler-runtime-profile.v1.json` in the candidate inventory. Its review record
uses logical kind `handler-runtime-profile` and consumer
`developer-tooling`. See the [handler runtime profile](../backend/handler-runtime.md)
for module, syntax, global, target, diagnostic, and per-operation selection
fields.

Generation writes a temporary complete graph, digests it, atomically publishes
the hash-addressed cache, verifies it, then atomically materializes
`snapback/generated/` for import compatibility. A hard generation or write
failure leaves the previously serveable graph intact.

## Consume through the manifest

The packaged dev loop, runtime load, release builder, app CLI, Vite lifecycle,
Contract validation, and CI resolve generated files through `artifacts.json`.
A missing or tampered cache produces `SNAPBACK_CODEGEN_CACHE_INVALID`; run
`snapback generate snapback` to reconstruct it. Only a digest-matching
`consumer-committed` projection may be read without the cache. Codegen never
serves an unverified materialized cache projection as a stale fallback.

A release closes over the verified cache graph, not whatever files happen to
remain in `generated/`. CI regenerates from a cold cache, verifies every
digest, and diffs the review manifest plus explicitly committed consumer
projections.

## Inspect the normalized definition and source profile

Every generated graph contains `normalized-definition.v1.json`. It projects
the canonical application schema and operation contracts without app address,
source profile, handler behavior, or source-graph custody. Use its
`normalizedContractId` to compare complete contract facts and its
`normalizedSchemaId` for the schema-only migration closure. Both identities
also appear in `artifacts.json` and the immutable generation envelope.

The schema and function manifests and `app.descriptor.json` record the resolved
`authoringProfile`. Omitting the optional `codegen.policy.json` key is exactly
`"snapback-explicit-v1"`; that default spelling is deliberately absent from
the semantic-identity preimage. `"snapback-familiar-ts-v1"` is the other
versioned policy value, used by the familiar source adapter as that phased
surface becomes available.

### Diagnose SNAPBACK_CODEGEN_AUTHORING_PROFILE_INVALID

This refusal means `codegen.policy.json` supplied an `authoringProfile` other
than `"snapback-explicit-v1"` or `"snapback-familiar-ts-v1"`. Correct the
closed policy record and regenerate. Codegen leaves the previously generated
graph untouched when policy validation fails.

<!-- since: 0.1.21 -->

## Author with the familiar TypeScript profile

Select `"snapback-familiar-ts-v1"` only in `codegen.policy.json`. A familiar
backend has a required top-level `schema.ts`, top-level function modules such
as `todos.ts`, optional helper modules, and generated imports under
`generated/`. On a clean checkout, codegen synthesizes `generated/server`
and `generated/api` before it evaluates definitions, so imports from those
modules work on the first generation.

`snapback/generated/` is the one canonical artifact directory for both
profiles, the CLI dev loop, and client/build admission. Do not create an
`_generated/` compatibility directory or symlink: codegen refuses either form
with `SNAPBACK_CODEGEN_LEGACY_GENERATED_DIRECTORY`, and refuses retired source
imports with `SNAPBACK_CODEGEN_LEGACY_GENERATED_IMPORT`. Two filesystem names
for one graph would also turn generated writes into watch inputs.

The constructors are `query`, `mutation`, and `action`. Every function must
declare `args`, `returns`, `auth`, and `handler`. Queries also declare `reads`;
mutations declare `reads` and `writes`; actions may declare `secrets`. Query
delivery defaults to live and accepts only `"live"` or `"read"`. The complete
working source is the [familiar todo fixture](repo:tests/fixtures/familiar-todo),
and its [explicit twin](repo:tests/fixtures/familiar-todo-explicit) demonstrates
the equivalent string-export spelling.

Each top-level module becomes an API namespace: `todos.ts` exporting `list`
defines the canonical operation name `todos.list` and generated reference
`api.todos.list`. Explicit modules spell the same canonical name with an
ES2022 string export such as `export { listImpl as "todos.list" }`. Generated
references in both profiles hydrate `authoringProfile` from the descriptor's
single app-level fact, derive query `delivery` from the nominal reference kind,
and supply the default `retention` fact at binding time. Only non-default
retention is serialized per reference. `normalized-definition.v1.json`
deliberately excludes the source profile so equivalent definitions can compare
equal without erasing the profile from semantic and generation identity.
Client-consumed generated JavaScript does not re-export dotted names as string
ESM aliases. Consume them through `api.todos.list`, `api["todos.list"]`, or
`app.api.queries["todos.list"]`; those namespace forms pass the shipped Expo
57 Metro/Hermes transformer. Codegen and the canonical client import the same
operation-name grammar, so every generated `IDENT` or `IDENT.IDENT` name is
callable. Current descriptors require the app-level `authoringProfile`; Expo
validates its closed values while retaining the field-less legacy descriptor
shape. A cross-package contract gate freshly generates and admits both profiles
at the same version.

Familiar query/mutation handlers use the canonical context. The callback form
of `withIndex` accepts only one `eq`/`in`/`lt`/`lte`/`gt`/`gte` chain and
replays every recorded predicate. Familiar actions expose only `auth`,
`runtime`, `secrets`, `refuse`, `isDirectHuman`, generated-reference
`runMutation`, and refusing `runQuery`/`fetch`/`fetchStream` stubs. Use the
explicit profile for other action host effects or declarative plans.

### Diagnose familiar profile refusals

| Code | Repair |
| --- | --- |
| `SNAPBACK_CODEGEN_LEGACY_GENERATED_DIRECTORY` | Remove the `_generated/` directory or symlink and use only `snapback/generated/`. |
| `SNAPBACK_CODEGEN_LEGACY_GENERATED_IMPORT` | Change Familiar imports from `./_generated/{server,api}` to `./generated/{server,api}`. |
| `SNAPBACK_CODEGEN_FAMILIAR_EXPLICIT_SOURCE_PRESENT` | Remove `schema.mjs`, `functions.mjs`, and `routes.mjs`, or select the explicit profile. |
| `SNAPBACK_CODEGEN_EXPLICIT_FAMILIAR_SOURCE_PRESENT` | Remove `schema.ts` and top-level familiar imports, or select the familiar profile. |
| `SNAPBACK_CODEGEN_FAMILIAR_MODULE_PATH_UNSUPPORTED` | Keep function modules at the backend root; nested modules are helpers only. |
| `SNAPBACK_CODEGEN_FAMILIAR_RESERVED_MODULE_UNSUPPORTED` | Move `crons.ts`/`http.ts` behavior to the explicit `defineCron`/`defineRoutes` vocabulary. |
| `SNAPBACK_CODEGEN_FAMILIAR_EXPORT_UNSUPPORTED` | Export only familiar function values from a function module; move exported helpers to a helper module. |
| `SNAPBACK_CODEGEN_FAMILIAR_KEY_UNSUPPORTED` | Remove the named unsupported key or follow its diagnostic route to the explicit profile. |
| `SNAPBACK_CODEGEN_FAMILIAR_AUTH_MISSING` | Add the exact canonical `auth` value: `"public"`, `"optional-user"`, or `"authenticated"`. |
| `SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE` | Use the diagnostic's shape-specific list/value route; for a missing declaration, review the generated LLP 0245 suggestion. |
| `SNAPBACK_CODEGEN_FAMILIAR_DELIVERY_INVALID` | Use `"live"` or `"read"`. |
| `SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED` | Return one canonical chained range expression from the callback. |
| `SNAPBACK_FAMILIAR_RUNQUERY_UNSUPPORTED` | Use an explicit-profile action when action-to-query composition is required. |
| `SNAPBACK_FAMILIAR_RUNMUTATION_REF_REQUIRED` | Pass the generated `api.module.mutation` reference, never a string or reconstructed object. |
| `SNAPBACK_FAMILIAR_HOST_EFFECT_UNSUPPORTED` | Use the explicit profile for `fetch` or `fetchStream`. |
| `SNAPBACK_FAMILIAR_API_REFERENCE_DYNAMIC` | Use a static two-member reference such as `api.todos.create`; computed or escaping API access is not admitted. |
| `SNAPBACK_CODEGEN_FAMILIAR_NAME_COLLISION` | Rename operations whose dotted/camel spellings produce the same generated local binding. |
| `SNAPBACK_CLIENT_REFERENCE_PROFILE_MISMATCH` | Pass a reference generated for the client alias's admitted profile, or use a canonical client verb that accepts both profiles. |

Vite rewrites relative imports beneath a `generated` or
`generated-<target-profile>` directory to the verified cache file. This covers
the React/client API import and Contract's generated descriptor and
`runtime-links` imports without changing their author-friendly source spelling.
Node scripts do not have a bundler hook, so they call
`resolveGeneratedArtifact(generatedRoot, artifactPath)` before reading JSON or
dynamically importing a generated module.

## Review a codegen change

Review `artifacts.json` beside the source change. Its stable summary shows the
surface-size change, while `files` shows the content digest, logical kind,
custody, consumer, and regeneration command for every projection. Identical
inputs produce byte-identical review manifests and summaries.

If a consumer truly cannot regenerate, declare its exact projection path in
`snapback/codegen.policy.json`; do not commit the whole graph. Re-run codegen and
the review manifest will record the new custody.

## Anti-patterns

- **Do not import arbitrary files from an unverified cache path.** Resolve
  through the review manifest.
- **Do not hand-edit `generated/` or `.snapback/codegen-cache/`.** Regenerate;
  digest verification treats edits as tampering.
- **Do not add the whole generated tree to `committedProjections`.**
  Custody is a narrow consumer need, not a way to restore noisy diffs.
- **Do not fall back to stale materialized projections after a cache error.**
  Regenerate or fail closed.
