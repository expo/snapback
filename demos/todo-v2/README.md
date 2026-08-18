# Todo v2 demo

Todo v2 lives alongside the original [`demos/todo`](../todo) demo. It keeps the
same small product shape but exists for one narrower reason: test whether the
LLP 0021 Phase 0-2 work makes a second Snapback+Contract surface less confusing.

Compared with the original, v2 adds a `priority` row field and a `setPriority`
mutation, then verifies that the shared Contract bridge derives runtime links
from the generated manifest instead of silently wiring only the original todo
subset. It also imports generated Contract binding modules instead of
demo-local descriptor sidecars, and adds an acceptance check for the new
wrong-native-server-shape diagnostic from LLP 0021. Its provider conformance
runner imports Exact's reusable DataProvider conformance suite through package
exports and points it at the live Snapback provider. Its descriptor runner uses
Exact project checks to validate generated descriptor modules and row shapes
without starting the Snapback server.

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
    generated-remote-service/ # commit-addressed remote target publication
      remote-service.profile.json             # host-private HTTPS policy + corpus identity
      remote-auth-capability.manifest.json     # credential authority/rotation policy, no value
      remote-data-capability.manifest.json     # manifests, wire schemas, operation schemas
      operations/*.args.schema.json            # generated from function validators
  surfaces/
    headless/run.mjs          # headless walkthrough (no UI framework)
    contract/todo.contract    # priority-aware Contract surface importing generated bindings
    contract/main.ts          # browser-hosted Exact Contract dev surface
  tests/acceptance/
    headless.mjs              # required surface acceptance suite
    contract.mjs              # Contract/Exact acceptance (needs Exact + bun)
    contract-descriptors.mjs  # Exact project-check validation for generated descriptors
    adapter-semantics.mjs     # no-server adapter rollback + pending-count checks
    provider-conformance.mjs  # Exact-owned provider conformance fixture
```

The shared client/codegen helpers live in [`demos/_kit/`](../_kit), and the
Contract adapter lives in [`packages/snapback-contract`](../../packages/snapback-contract).
V2 intentionally reuses that adapter instead of copying bridge code. Its Contract source
imports generated binding modules from `snapback/generated/contract/`; there is
no local `surfaces/contract/data/` sidecar directory. The LLP 0021 inventory
distinguishes the remaining prototype bridge from product code in
[`archive/docs/contract-exact-integration.md`](../../archive/docs/contract-exact-integration.md).

## Run it

```sh
# 1. Regenerate the manifests from source (deterministic; fails closed).
node packages/snapback-codegen/index.mjs demos/todo-v2/snapback

# Publish the independently managed HTTPS service target. This contains no
# endpoint or credential value; a consumer must pin the commit and resolve
# both through host-private runtime authority.
node packages/snapback-codegen/index.mjs demos/todo-v2/snapback \
  --target-profile remote-service-sqlite-ibex

# 2. Headless surface walkthrough (boots the Rust server itself).
node demos/todo-v2/surfaces/headless/run.mjs

# 3. Headless acceptance (the required surface).
node demos/todo-v2/tests/acceptance/headless.mjs

# 4. Contract/Exact acceptance (optional surface; needs bun + installed packages).
#    Local Exact checkouts remain an explicit development override.
bun demos/todo-v2/tests/acceptance/contract.mjs

# 5. Exact project-check validation for generated Contract descriptors.
bun demos/todo-v2/tests/acceptance/contract-descriptors.mjs

# 6. No-server adapter semantics: rollback + combined pending count.
bun demos/todo-v2/tests/acceptance/adapter-semantics.mjs

# 7. Exact-owned DataProvider conformance against the Snapback provider.
bun demos/todo-v2/tests/acceptance/provider-conformance.mjs

# 8. Browser-hosted Contract surface (starts Vite; needs a running Snapback API).
bun install --cwd demos/todo-v2/surfaces/contract   # once; registry packages
cargo run -- start --port 4421 --memory
SNAPBACK_TODO_V2_API=http://127.0.0.1:4421 \
  bun run --cwd demos/todo-v2/surfaces/contract dev

# 9. Production build of the Contract surface (exactContractWeb preset ->
#    surfaces/contract/dist/web/; ENG-22487).
bun run --cwd demos/todo-v2/surfaces/contract build
```

The surface uses the `exactContractWeb` paved-road preset consumed from the
npm registry (ENG-22480 model, matching all-aboard; migrated by ENG-23899):
`@exact/*` imports resolve through npm alias dependencies to the published
`@ccheever/exact-*` packages (see `surfaces/contract/package.json`), and the
surface's committed `bun.lock` pins the exact bits — it replaced
`exact.pin.json`. No sibling checkout and no `SNAPBACK_EXACT_ROOT` are needed
for the browser surface; the acceptance resolver uses explicit/local checkouts
when supplied and otherwise probes only this surface's installed package set.

The acceptance runners start an in-memory Snapback server on a dedicated port
(reusing one if already healthy) and tear it down on exit.
The browser surface talks to the Snapback API directly at
`SNAPBACK_TODO_V2_API` (build-time `define`; the bun-vite `/snapback` proxy
kept in vite.config.ts is a non-bun fallback — under `bun --bun` a hung
WebSocket upgrade wedges proxied HTTP) and provisions/seeds the demo backend
idempotently on page boot.
That built-in `server.proxy` fallback is separate from `@expo/snapback-vite`:
the package relay now completes both WebSocket legs above Bun's raw socket
shim, while this todo-v2 fallback remains unchanged.

On macOS, run `scripts/bootstrap-ibex-runtime` from the repo root first, or set
`HERMES_INCLUDE_DIR`, `HERMES_LIB_DIR`, and `HERMESC` to a prepared Ibex
checkout such as `/Users/ccheever/projects/ibex`. The acceptance runners add the
resolved Hermes framework directory to `DYLD_FRAMEWORK_PATH` for the spawned
Snapback server; direct `cargo run` shells still need the normal Ibex/Hermes
runtime setup.

## What it proves

**Headless (required):** schema load, generated function references, query,
create/toggle/priority/delete mutations with server-owned system fields,
user-scoped auth filtering, an authoritative live-subscription snapshot, a
realtime update reaching a second client, an ordinary query honestly reported as
**not** syncable (`SNAPBACK_FUNCTION_NOT_LIVE`), a read-set mutation conflict
(`SNAPBACK_MUTATION_CONFLICT`), deterministic reset/seed, machine-readable
diagnostics for invalid schema, atomic rejection of an invalid query artifact
(`SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID`), codegen failures, and the LLP
0021 wrong-native server-shape diagnostic
(`SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE`).

**Contract/Exact (optional):** the real `.contract` surface compiles against the
generated descriptors, mounts against the **live** Snapback server, renders the
live snapshot, drives Snapback mutations from Contract actions (optimistic
create/toggle/priority/delete updates), rejects a deliberately stale Contract
data manifest with `SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH`, validates
generated descriptor modules and row shapes through Exact project-check helpers,
proves rejected optimistic mutations republish authoritative rows, proves one
combined pending mutation count covers runtime links and provider mutations,
and those mutations are server-authoritative and visible to the headless surface
— two surfaces over one backend. The provider conformance runner also passes
Exact's owned DataProvider suite against the Snapback provider's Online subset.
The separate package replay suite covers the retained/outbox behavior Exact's
generic suite does not yet exercise.

## What it is NOT claiming

This is a demo shape, not a scale benchmark. Its Contract single-query surface
is the first narrowly earned **Parity** class: every declared mutation is a
closed `HostPlan`, the same IR derives the local overlay and captured ledger,
authorized rows/outbox survive browser reload in the client store, and reconnect
full-resyncs before exactly-once ordered replay. Server results remain
authoritative. This does **not** claim arbitrary JavaScript-handler execution,
multi-query offline parity, CRDT merge, or the later delta-resume-with-pending
milestone. Mixed-tier Todo and system/admin surfaces stay Online.

## Native Rust tier (no JS)

The same `todo.contract` runs on Exact's `contract-native` tier (exact
LLP 0328/0329, ENG-23899): the Rust interpreter mounts the UI and a native
data host executes this demo's generated `HostPlan` queries and
`MutationPlan` mutations on an in-memory store seeded from `seed.json` —
no JavaScript anywhere in the process. From an exact checkout with this
repo as a sibling:

```sh
bun contract-native/scripts/generate-bundles.mjs --todo ../snapback
ios/ContractNativeLab/build.sh
./target/lab/ContractNativeLab target/contract-native/todo-v2.ir.json \
  --data ../snapback/demos/todo-v2 --user user_ada
```

This is a local replica proving plan-execution parity (exact
`contract-native/tests/todo_demo.rs` drives add/toggle/delete headlessly);
the shared-host/native packaging of that client store rides later delivery
milestones even though the JS/web Parity slice is now shipped.
