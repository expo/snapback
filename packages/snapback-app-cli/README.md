<!-- @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real — published packages must route readers to checkout-independent documentation. -->
<!-- @ref LLP 0061#4-distribution-and-discovery — package links use the build-bound served Guide and MCP projection. -->

# `@expo/snapback-app-cli`

`@expo/snapback-app-cli` provides the `snapback-app` command: an agent-facing
terminal over one generated Snapback application. It discovers operations from
digest-verified artifacts or a served API envelope, validates argument
contracts, and can introspect, call, subscribe, emit types, or run bounded code
mode without importing application source.

This package is optional. Install it directly when an agent or automation needs
the generic application-data terminal. Use `@expo/snapback-cli` for project
creation, codegen, the development server, testing, administration, and
deployment; `snapback-app` does not replace that lifecycle CLI and carries no
ambient admin authority.

## Inspect and call an application

In an existing Snapback application, add the optional package and generate the
backend artifacts first (the application already carries `snapback` through
`@expo/snapback-cli`):

```sh
npm install --save-dev @expo/snapback-app-cli
snapback generate snapback
snapback-app --artifacts ./snapback/generated introspect
```

`introspect` is the safest first step. It emits a bounded, value-free digest of
the app's schemas, operations, capability facts, and gaps. It does not import
the generated API module or handler bundle.

To call a function on a running local target, choose authority explicitly and
replace `listTodos` with a name returned by `introspect`:

```sh
snapback-app \
  --server http://127.0.0.1:4287 \
  --artifacts ./snapback/generated \
  --principal dev \
  --dev-user user_ada \
  --args-json '{}' \
  call listTodos
```

Anonymous is the default even when credential material exists. Session and
agent lanes require explicit file-backed custody. The shipped engine is a
local-target surface; hosted targets do not currently advertise the app-CLI
capability.

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Follow [the app CLI guide](http://127.0.0.1:4287/_snapback/guide/clients/app-cli.md)
  for introspection, principals, subscriptions, pairing, and code mode.
- Read [generated artifact custody](http://127.0.0.1:4287/_snapback/guide/getting-started/generated-artifacts.md)
  for the files this command trusts.
- Read first: [the start packets](http://127.0.0.1:4287/_snapback/guide/start/index.md)
  — the budgeted per-template first read (LLP 0259).
- Look up (do not linear-read) the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md)
  for the current local and hosted claim boundary.
- Run `snapback guide` or `snapback guide <query>` to browse or search the
  embedded Guide.
- Run `snapback mcp` for the same build-bound corpus as read-only MCP
  resources, starting at `snapback-guide://manifest`.

## Operate it

`snapback mcp` serves read-only Guide resources; `snapback mcp-control` adds typed control tools with local admin authority.
Preview control setup with `snapback agent setup --print <client> --server mcp-control`.
