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
      server: { mode: 'managed', port: 3210 },
      setup: { backendDirectory: 'snapback' },
      generatedRoots: ['snapback/generated'],
    }),
  ],
});
```

Run that configuration with the application's ordinary Vite command. The
plugin consumes the fixed-port/external-client profile of `snapback dev`, pins
Vite's actual loopback origin with `strictPort`, declares that exact origin to
the backend lifecycle, and waits for the authoritative
`snapback.application-ready.v1` receipt. Attach mode compares the receipt's
complete application, authority, artifact, target-profile, capability, and
admission bind-set with live operational readiness before asking the shared
CLI lifecycle to perform its idempotent generated load and binding reissue.
An expired binding is reissued only after that identity cut. Browser code
receives a same-origin projection of the receipt-issued binding at
`/__snapback`; the backend origin, admin token, receipt/runtime paths, and
qualified-binary facts remain private.

The relay registry includes the exact server-registered methods under
`/auth/password/*` and `/auth/recovery/*`, so the generated binding supports
signup, sign-in, recovery, logout, and live data on that one page origin. This
is not a broad `/auth/*` proxy; unknown and privileged auth routes remain
refused. See the served Guide's
[authoring loop](http://127.0.0.1:4287/_snapback/guide/getting-started/the-authoring-loop.md#use-password-and-recovery-through-the-vite-origin).

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
