# Todo v2 demo

Todo v2 lives alongside the original [`demos/todo`](../todo) demo. It keeps the
same small product shape but exists for one narrower reason: test whether the
LLP 0021 Phase 0/1 work makes a second Snapback+Contract surface less confusing.

Compared with the original, v2 adds a `priority` row field and a `setPriority`
mutation, then verifies that the shared Contract bridge derives runtime links
from the generated manifest instead of silently wiring only the original todo
subset. It also imports generated Contract binding modules instead of
demo-local descriptor sidecars, and adds an acceptance check for the new
wrong-native-server-shape diagnostic from LLP 0021.

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
      capability.manifest.json    # -> structured capability facts
      contract-data.manifest.json # -> consumed by Contract/Exact
      api.mjs / api.d.ts          # -> generated function references
      package.json                # -> package metadata for generated output
      artifacts.json              # inputsHash + index
      contract/                   # -> generated Contract modules + sidecars
  surfaces/
    headless/run.mjs          # headless walkthrough (no UI framework)
    contract/todo.contract    # priority-aware Contract surface importing generated bindings
    contract/main.ts          # browser-hosted Exact Contract dev surface
  tests/acceptance/
    headless.mjs              # required surface acceptance suite
    contract.mjs             # Contract/Exact acceptance (needs Exact + bun)
```

The shared client/codegen helpers live in [`demos/_kit/`](../_kit), and the
Contract adapter lives in [`packages/snapback-contract`](../../packages/snapback-contract).
V2 intentionally reuses that adapter instead of copying bridge code. Its Contract source
imports generated binding modules from `snapback/generated/contract/`; there is
no local `surfaces/contract/data/` sidecar directory. The LLP 0021 inventory
distinguishes the remaining prototype bridge from product code in
[`docs/contract-exact-integration.md`](../../docs/contract-exact-integration.md).

## Run it

```sh
# 1. Regenerate the manifests from source (deterministic; fails closed).
node demos/_kit/codegen.mjs demos/todo-v2/snapback

# 2. Headless surface walkthrough (boots the Rust server itself).
node demos/todo-v2/surfaces/headless/run.mjs

# 3. Headless acceptance (the required surface).
node demos/todo-v2/tests/acceptance/headless.mjs

# 4. Contract/Exact acceptance (optional surface; needs an Exact checkout + bun).
#    Exact is resolved via SNAPBACK_EXACT_ROOT | .snapback/local.json | ../exact.
bun demos/todo-v2/tests/acceptance/contract.mjs

# 5. Browser-hosted Contract surface (starts Vite; needs a running Snapback API).
cargo run -- --port 4421 --memory
SNAPBACK_TODO_V2_API=http://127.0.0.1:4421 \
  bun run --cwd demos/todo-v2/surfaces/contract dev
```

The acceptance runners start an in-memory Snapback server on a dedicated port
(reusing one if already healthy) and tear it down on exit.
The browser surface proxies `/snapback` through Vite to the Snapback API and
loads/resets/seeds the demo backend on page boot.

## What it proves

**Headless (required):** schema load, generated function references, query,
create/toggle/priority/delete mutations with server-owned system fields,
user-scoped auth filtering, an authoritative live-subscription snapshot, a
realtime update reaching a second client, an ordinary query honestly reported as
**not** syncable (`SNAPBACK_FUNCTION_NOT_LIVE`), a read-set mutation conflict
(`SNAPBACK_MUTATION_CONFLICT`), deterministic reset/seed, machine-readable
diagnostics for invalid schema/query/codegen, and the LLP 0021 wrong-native
server-shape diagnostic
(`SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE`).

**Contract/Exact (optional):** the real `.contract` surface compiles against the
generated descriptors, mounts against the **live** Snapback server, renders the
live snapshot, drives Snapback mutations from Contract actions (optimistic
create/toggle/priority/delete updates), rejects a deliberately stale Contract
data manifest with `SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH`, and those
mutations are server-authoritative and visible to the headless surface — two
surfaces over one backend.

## What it is NOT claiming

This is a demo shape, not a scale benchmark. It is an **Online**-class
integration (server-authoritative mutations with optimistic UI), **not**
local-first/Parity: there is no local handler replay. v0 runs declarative
`HostPlan`s, not JavaScript `ctx.db` handlers (the Ibex host-call bridge is a
capability gap). See `demo.snapback.json` `capabilityGaps` / `notClaiming`.
