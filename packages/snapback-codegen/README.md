<!-- @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real — published packages must route readers to checkout-independent documentation. -->
<!-- @ref LLP 0061#4-distribution-and-discovery — package links use the build-bound served Guide and MCP projection. -->

# `@expo/snapback-codegen`

Snapback codegen executes an application's source-authored schema and function
definitions, then emits the digest-verified artifact graph consumed by the
runtime, clients, Vite integration, app CLI, and Contract adapter. That graph
includes the review manifest, runtime manifests, typed API references,
operation schemas, and generated Contract bindings.

This is an authoring dependency, not a standalone backend or runtime. A
project created by `@expo/snapback-cli` already installs it because
`snapback/schema.mjs` and `snapback/functions.mjs` import the declaration
helpers from `@expo/snapback-codegen/define`. Do not install it globally or
invoke its internal emitters individually.

## Generate an application's artifacts

The supported path is through the packaged CLI:

```sh
npm install --global @expo/snapback-cli
snapback new my-app --template todo-contract
cd my-app
bun install
bun run generate
```

In an existing Snapback project, the equivalent command is:

```sh
snapback generate snapback
```

Codegen reads `snapback/schema.mjs`, `snapback/functions.mjs`, and the optional
`snapback/seed.json`. On success, commit
`snapback/generated/artifacts.json`; treat the rest of the generated graph as
regenerable unless the project's codegen policy explicitly names a committed
consumer projection. Generation fails closed instead of silently preserving
stale output.

Import `@expo/snapback-codegen/define` when authoring backend declarations:

```js
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema({
  todos: defineTable({ title: v.string(), completed: v.boolean() }),
});
```

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Read [generated artifact custody](http://127.0.0.1:4287/_snapback/guide/getting-started/generated-artifacts.md)
  before committing generated files.
- Follow [the authoring loop](http://127.0.0.1:4287/_snapback/guide/getting-started/the-authoring-loop.md)
  for generate, dev, and verification commands.
- Read first: [the start packets](http://127.0.0.1:4287/_snapback/guide/start/index.md)
  — the budgeted per-template first read (LLP 0259).
- Look up (do not linear-read) the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md)
  before hand-authoring a feature that codegen may already expose.
- Run `snapback guide` or `snapback guide <query>` to browse or search the
  embedded Guide.
- Run `snapback mcp` for the same build-bound corpus as read-only MCP
  resources, starting at `snapback-guide://manifest`.
