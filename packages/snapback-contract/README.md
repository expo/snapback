<!-- @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real — published packages must route readers to checkout-independent documentation. -->
<!-- @ref LLP 0061#4-distribution-and-discovery — package links use the build-bound served Guide and MCP projection. -->

# `@expo/snapback-contract`

`@expo/snapback-contract` is the shared Contract/Exact adapter and validation
layer for Snapback. Codegen emits per-function Contract binding modules, and
this package wires those generated bindings to a live Snapback client. It also
owns lower-level shared boundaries used by other Snapback packages, including
artifact validation, auth coordination, authorization fencing, retained-store
primitives, diagnostics, and result-contract validation.

Most applications should not install this package directly. React web apps use
`@expo/snapback-client` and `@expo/snapback-react`; Expo apps should follow the
React Expo Guide's closure instructions. Those higher-level packages retain
their compatible Contract edge. Install `@expo/snapback-contract` directly
only when building the Contract/Exact surface or deliberately consuming one of
its documented low-level subpaths.

## Bind a Contract application

First generate the Snapback backend so the typed Contract modules exist:

```sh
snapback generate snapback
```

Then reference those generated modules from the application's `.contract`
file:

```contract
use listTodos from "../../snapback/generated/contract/listTodos.query.ts"
use createTodo from "../../snapback/generated/contract/createTodo.mutation.ts"

query todos = listTodos({})
mutation addTodo = createTodo
```

At boot, `createSnapbackContractSurface(...)` validates the generated artifact
set and creates the links installed through the generated
`configureSnapbackContractLinks(surface.links)` function. Use the complete
Guide recipe for that boot step: its inputs depend on the application's
generated manifests, client, Contract runtime, and optional retained store.

The package reports Online behavior by default. Parity is earned per configured
surface; installing the package alone does not claim offline replay, retained
authorization, or hosted readiness.

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Follow [the Contract adapter guide](http://127.0.0.1:4287/_snapback/guide/clients/contract-adapter.md)
  for generated bindings, surface boot, keyed scopes, and store choices.
- Read [the headless client guide](http://127.0.0.1:4287/_snapback/guide/clients/headless.md)
  when you need the transport beneath the adapter.
- Read first: [the start packets](http://127.0.0.1:4287/_snapback/guide/start/index.md)
  — the budgeted per-template first read (LLP 0259).
- Look up (do not linear-read) the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md)
  for the current target and maturity of each client capability.
- Run `snapback guide` or `snapback guide <query>` to browse or search the
  embedded Guide.
- Run `snapback mcp` for the same build-bound corpus as read-only MCP
  resources, starting at `snapback-guide://manifest`.
