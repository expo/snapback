<!-- @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real — published packages must route readers to checkout-independent documentation. -->
<!-- @ref LLP 0061#4-distribution-and-discovery — package links use the build-bound served Guide and MCP projection. -->

# `@expo/snapback-vite`

`@expo/snapback-vite` is Snapback's local-development Vite plugin. It attaches
to or manages the backend lifecycle, resolves generated imports through the
digest-verified codegen cache, exposes sanitized state through
`virtual:snapback/dev`, and relays only allowlisted application-data HTTP and
WebSocket routes under `/__snapback`.

This is a project development dependency, not a production server adapter or a
general reverse proxy. The React starter created by `@expo/snapback-cli`
installs and configures it already. Install it directly only when adding the
managed Snapback loop to an existing Vite application.

## Add the managed development integration

For a new application, the supported route is the prepared starter:

```sh
npm install --global @expo/snapback-cli
snapback new my-app --template react
cd my-app
bun install
bun run dev
```

An existing Vite application can use the same plugin shape:

```ts
import { defineConfig } from 'vite';
import { snapbackDev } from '@expo/snapback-vite';

export default defineConfig({
  plugins: [
    snapbackDev({
      server: { mode: 'attach' },
      generatedRoots: ['snapback/generated'],
    }),
  ],
});
```

Run that configuration through `snapback dev snapback --client .
--client-command vite`. The CLI owns codegen and the backend; the Vite plugin
attaches to the ready target and gives browser code the relative
`/__snapback` path without exposing the backend origin, admin token, runtime
path, or repository path.

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Follow [the authoring loop](http://127.0.0.1:4287/_snapback/guide/getting-started/the-authoring-loop.md)
  for the complete React/Vite development flow.
- Read [generated artifact custody](http://127.0.0.1:4287/_snapback/guide/getting-started/generated-artifacts.md)
  for verified generated-import behavior.
- Read first: [the start packets](http://127.0.0.1:4287/_snapback/guide/start/index.md)
  — the budgeted per-template first read (LLP 0259).
- Look up (do not linear-read) the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md)
  before assuming a relayed route or target is supported.
- Run `snapback guide` or `snapback guide <query>` to browse or search the
  embedded Guide.
- Run `snapback mcp` for the same build-bound corpus as read-only MCP
  resources, starting at `snapback-guide://manifest`.
