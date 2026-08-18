# Todo demo

> **Legacy authoring form on purpose — do not copy this shape into new work.**
> This demo deliberately keeps the historical bundled-handler form
> (`defineJsLiveQuery({ source: 'handlers.mjs', … })` in
> `snapback/functions.mjs`, imported through the `demos/_kit` shim) as a floor
> witness. Start a new app from `demos/todo-v2` or the scaffold templates
> (`snapback new` / `npm create snapback-app`), which model the current
> authoring surface.

The floor reference app from [LLP 0000](../../llp/0000-snapback.explainer.md) and
the first demo in [LLP 0015](../../llp/0015-demo-application-suite.plan.md):
single-table CRUD, a user-scoped syncable-live query, realtime updates,
deterministic reset/seed, and structured diagnostics — one generated Snapback
backend consumed by two surfaces.

```
todo/
  demo.snapback.json          # demo manifest (surfaces, capabilities, gaps)
  snapback/
    schema.mjs                # source-authored schema (the source of truth)
    functions.mjs             # source-authored JS handlers + fixture HostPlans
    handlers.mjs              # bundled ctx.db handler module
    seed.json                 # deterministic declarative seed
    generated/                # codegen output (committed, deterministic)
      schema.manifest.json        # -> loaded by the Rust server
      functions.manifest.json     # -> loaded by the Rust server
      capability.manifest.json    # -> target capability facts
      api.mjs / api.d.ts          # -> generated function refs + types
      contract-data.manifest.json # -> consumed by Contract/Exact
      contract/                   # -> generated Contract modules + sidecars
      artifacts.json              # inputsHash + index
  surfaces/
    headless/run.mjs          # headless walkthrough (no UI framework)
    contract/todo.contract    # real Contract surface importing generated bindings
    contract/main.ts          # browser-hosted Exact Contract dev surface
  tests/acceptance/
    headless.mjs              # required surface acceptance suite
    contract.mjs             # Contract/Exact acceptance (needs Exact + bun)
```

The shared client/codegen helpers live in [`demos/_kit/`](../_kit). The
Contract adapter lives in [`packages/snapback-contract`](../../packages/snapback-contract),
and this surface imports generated binding modules from
`snapback/generated/contract/`; there is no local `surfaces/contract/data/`
sidecar directory. The LLP 0021 inventory distinguishes the remaining prototype
glue from product code in
[`archive/docs/contract-exact-integration.md`](../../archive/docs/contract-exact-integration.md).

## Run it

```sh
# 1. Regenerate the manifests from source (deterministic; fails closed).
node packages/snapback-codegen/index.mjs demos/todo/snapback

# 2. Headless surface walkthrough (boots the Rust server itself).
node demos/todo/surfaces/headless/run.mjs

# 3. Headless acceptance (the required surface).
node demos/todo/tests/acceptance/headless.mjs

# 4. Contract/Exact acceptance (optional surface; needs bun + installed packages).
#    Local Exact checkouts remain an explicit development override.
bun demos/todo/tests/acceptance/contract.mjs

# 5. Browser-hosted Contract surface (starts Vite; needs a running Snapback API).
cargo run -- start --port 4420 --memory
SNAPBACK_TODO_API=http://127.0.0.1:4420 \
  bun run --cwd demos/todo/surfaces/contract dev

# 6. Production build of the Contract surface (exactContractWeb preset ->
#    surfaces/contract/dist/web/; ENG-22487).
bun run --cwd demos/todo/surfaces/contract build
```

The surface uses the `exactContractWeb` paved-road preset from published Exact
packages. `surfaces/contract/package.json` keeps imports at `@exact/*` through
the `@ccheever/exact-*` aliases, and the committed `bun.lock` is the reproducible
pin. Run `bun install --cwd demos/todo/surfaces/contract` once before the
browser/build commands. Acceptance resolves that installed package set by
default; `SNAPBACK_EXACT_ROOT` or `.snapback/local.json` explicitly selects a
checkout for unpublished Exact development.

The acceptance runners start an in-memory Snapback server on a dedicated port
(reusing one if already healthy) and tear it down on exit.
The browser surface proxies `/snapback` through Vite to the Snapback API and
loads/resets/seeds the demo backend on page boot.

The embedded Ibex path needs the vendored Ibex checkout to have Hermes installed
(`vendor/ibex/scripts/download-hermes.sh` on macOS). If using a separate local
Ibex checkout instead, point Snapback at that install:

```sh
export HERMES_LIB_DIR=/Users/ccheever/projects/ibex/ios/Frameworks
export HERMES_INCLUDE_DIR=/Users/ccheever/projects/ibex/ios/Frameworks/hermes-headers
export DYLD_FRAMEWORK_PATH=/Users/ccheever/projects/ibex/ios/Frameworks
export EXACT_ALLOW_FALLBACK=1
```

## What it proves

**Headless (required):** schema load, generated function references, query,
JavaScript `ctx.db` create/toggle/delete mutations, HostPlan edit-title coverage
with server-owned system fields, user-scoped
auth filtering, an authoritative live-subscription snapshot, a realtime update
reaching a second client, matcher skips for unrelated user-scoped mutations and
hidden-row patch/delete changes, captured equality and `In` predicate matching,
range/limited-boundary matcher capability reporting, WebSocket push delivery of
`live_replace` updates, inspectable live-delivery skip/delivery counts, an ordinary query
honestly reported as **not** syncable
(`SNAPBACK_FUNCTION_NOT_LIVE`), admin-runner display of captured handler
read/write facts, a read-set mutation conflict (`SNAPBACK_MUTATION_CONFLICT`),
deterministic reset/seed, and machine-readable diagnostics for an invalid schema
(`SNAPBACK_SCHEMA_SYSTEM_FIELD`), an invalid query artifact
(`SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID`),
stale generated artifacts (`SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION`), handler capability denial
(`SNAPBACK_HANDLER_CAPABILITY_DENIED`), handler throw normalization
(`SNAPBACK_HANDLER_FAILED`), and codegen failing closed (`QUERY_UNKNOWN_FIELD`).

**Contract/Exact (optional):** the real `.contract` surface compiles against the
generated descriptors, mounts against the **live** Snapback server, renders the
live snapshot, drives a Snapback mutation from a Contract action (optimistic
create/toggle/delete updates), rejects a deliberately stale Contract data
manifest with `SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH`, and those mutations
are server-authoritative and visible to the headless surface — two surfaces over
one backend.

## What it is NOT claiming

This is a demo shape, not a scale benchmark. It is an **Online**-class
integration (server-authoritative mutations with optimistic UI), **not**
local-first/Parity: there is no local handler replay. This slice has an embedded
Ibex `ctx.db` bridge for the todo live query plus create/toggle/delete handlers;
it captures handler read dependencies at commit and rejects conflicts, but does
not retry automatically, emit incremental deltas, enforce CPU/wall-clock budgets,
or remove the remaining HostPlan fixture paths. Its realtime matcher is a
conservative table/equality, `In`, range, and limited-boundary slice that
delivers `live_replace` updates over the WebSocket stream and the deterministic
outbox. See
`demo.snapback.json` `capabilityGaps` / `notClaiming`.
