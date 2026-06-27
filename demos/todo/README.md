# Todo demo

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
    functions.mjs             # source-authored queries + mutation HostPlans
    seed.json                 # deterministic declarative seed
    generated/                # codegen output (committed, deterministic)
      schema.manifest.json        # -> loaded by the Rust server
      functions.manifest.json     # -> loaded by the Rust server
      contract-data.manifest.json # -> consumed by Contract/Exact
      artifacts.json              # inputsHash + index
  surfaces/
    headless/run.mjs          # headless walkthrough (no UI framework)
    contract/todo.contract    # real Contract surface + data/ binding targets
    contract/main.ts          # browser-hosted Exact Contract dev surface
  tests/acceptance/
    headless.mjs              # required surface acceptance suite
    contract.mjs             # Contract/Exact acceptance (needs Exact + bun)
```

The shared adapter/codegen/bridge live in [`demos/_kit/`](../_kit) so this glue is
not re-copied per demo (the Valet anti-pattern called out in LLP 0012).

## Run it

```sh
# 1. Regenerate the manifests from source (deterministic; fails closed).
node demos/_kit/codegen.mjs demos/todo/snapback

# 2. Headless surface walkthrough (boots the Rust server itself).
node demos/todo/surfaces/headless/run.mjs

# 3. Headless acceptance (the required surface).
node demos/todo/tests/acceptance/headless.mjs

# 4. Contract/Exact acceptance (optional surface; needs an Exact checkout + bun).
#    Exact is resolved via SNAPBACK_EXACT_ROOT | .snapback/local.json | ../exact.
bun demos/todo/tests/acceptance/contract.mjs

# 5. Browser-hosted Contract surface (starts Vite; needs a running Snapback API).
cargo run -- --port 4420 --memory
SNAPBACK_TODO_API=http://127.0.0.1:4420 \
  bun run --cwd demos/todo/surfaces/contract dev
```

The acceptance runners start an in-memory Snapback server on a dedicated port
(reusing one if already healthy) and tear it down on exit.
The browser surface proxies `/snapback` through Vite to the Snapback API and
loads/resets/seeds the demo backend on page boot.

## What it proves

**Headless (required):** schema load, generated function references, query,
create/toggle/edit/delete mutations with server-owned system fields, user-scoped
auth filtering, an authoritative live-subscription snapshot, a realtime update
reaching a second client, an ordinary query honestly reported as **not**
syncable (`SNAPBACK_FUNCTION_NOT_LIVE`), a read-set mutation conflict
(`SNAPBACK_MUTATION_CONFLICT`), deterministic reset/seed, and machine-readable
diagnostics for an invalid schema (`SNAPBACK_SCHEMA_SYSTEM_FIELD`), an invalid
query (`SNAPBACK_UNKNOWN_FIELD`), and codegen failing closed
(`QUERY_UNKNOWN_FIELD`).

**Contract/Exact (optional):** the real `.contract` surface compiles against the
generated descriptors, mounts against the **live** Snapback server, renders the
live snapshot, drives a Snapback mutation from a Contract action (optimistic
create/toggle/delete updates), and those mutations are server-authoritative and
visible to the headless surface — two surfaces over one backend.

## What it is NOT claiming

This is a demo shape, not a scale benchmark. It is an **Online**-class
integration (server-authoritative mutations with optimistic UI), **not**
local-first/Parity: there is no local handler replay. v0 runs declarative
`HostPlan`s, not JavaScript `ctx.db` handlers (the Ibex host-call bridge is a
capability gap). See `demo.snapback.json` `capabilityGaps` / `notClaiming`.
