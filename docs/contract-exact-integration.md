# Contract/Exact Integration Notes

**Status:** Implementation notes for [LLP 0021](../llp/0021-contract-exact-integration-hardening.plan.md): Phase 0 inventory, Phase 1 generated binding plus Exact descriptor project-check coverage, the Phase 2 provider conformance discovery plus Todo v2 fixture pass, the Phase 3 build preset and package-export Exact resolver, and the first Phase 4 surface-migration footholds. This file inventories current prototype glue and the repeatable build/launch recipe so future work can replace it with product code.

## Product vs Prototype

Product code today:

- `src/admin.rs` serves the packaged admin console and `/_snapback/api/*` from the same Snapback server.
- `src/contract_exact.rs` owns Snapback-side Contract/Exact capability diagnostics that core can emit without importing Exact.
- `demos/_kit/client.mjs` is the framework-neutral online Snapback client used by headless and Contract acceptance.
- `packages/snapback-codegen` (the product codegen package; `demos/_kit/codegen.mjs` is a compatibility re-export) projects Snapback demo artifacts into generated Contract binding modules under `snapback/generated/contract/`, including runtime links and per-query/per-mutation descriptor sidecars.
- `packages/snapback-contract/` is the first package-equivalent Snapback Contract adapter: generated-artifact validation, boundary hydration, manifest-derived runtime links, quiet headless Contract mounting, optimistic mutations, reconciliation, retained-query/outbox storage, ordered D1-ledger replay, provider seam, row sync state, per-surface Online/Parity capability reporting, and the shared Online-only system-surface boundary/link helper used by the admin console.
- `packages/snapback-contract/build-preset.mjs` is the first build/dev-serve preset: it owns the shared Exact/Contract Vite plugin ordering, route-registry and entry preflights, static/native target selection, Snapback base-path rewrite, and the browser-only admin dev proxy shape.
- `packages/snapback-contract/exact-conformance.mjs` discovers, requires, and can run the Exact-owned provider conformance gate. It resolves the local Exact checkout, inspects `exact-verify.json` for `data-provider-conformance`, searches known suite paths, reports structured diagnostics for stale/missing Exact capability, and invokes `bun scripts/exact-verify.mjs --check data-provider-conformance --json` when asked to run the Exact check.
- `packages/snapback-contract/exact-package.mjs` imports `@exact/contract` compiler, runtime, and conformance exports through the package export map when installed, falling back to a configured Exact checkout package root while Snapback still runs from sibling source trees. It is exported as `@snapback/contract/exact-package`.
- `packages/snapback-contract/exact-project-check.mjs` runs generated Contract descriptors through Exact project semantics: static descriptor-module resolution, Contract compilation, descriptor-use extraction, and Exact's data doctor. It is exported as `@snapback/contract/exact-project-check`.
- `demos/todo-v2/tests/acceptance/adapter-semantics.mjs` is a no-server adapter semantics runner. It uses Exact runtime with an in-memory Snapback-like client to verify rejected optimistic mutations republish authoritative rows and runtime-link/provider mutations share one pending count.
- `demos/todo-v2/tests/acceptance/contract-descriptors.mjs` validates Todo v2 generated descriptor modules without starting a Snapback server and proves a bad generated-row field read fails with Exact's `shape_unknown_member` diagnostic before browser smoke.
- `demos/todo-v2/tests/acceptance/provider-conformance.mjs` imports Exact's reusable DataProvider conformance suite through the package-export resolver and points it at the live Snapback Todo v2 provider fixture.
- `admin-ui/contract-bindings.mjs` and `admin-ui/generate-contract-bindings.mjs` project the admin system-app bindings into generated Contract modules under `admin-ui/generated/contract/`, including runtime links and per-query/per-mutation descriptor sidecars.
- `admin-ui/build.mjs` regenerates those admin Contract modules, then invokes the shared static/native build preset.
- `admin-ui/dev.mjs` regenerates those admin Contract modules, then invokes the shared browser dev-serve preset and watches binding inputs for regeneration + reload.

Prototype adapter or recipe code to retire under LLP 0021:

- `demos/todo/surfaces/contract/vite.config.ts` and the Exact resolver in `demos/_kit/exact-resolver.mjs` are demo-local packaging glue.
- `admin-ui/admin-boundary.mjs` and `admin-ui/admin-client.mjs` are still the admin-specific system-app layer; generated descriptors and runtime links replaced the old per-binding sidecars, and `createSnapbackSystemContractSurface` now owns boundary/link lifecycle, but the privileged admin API remains distinct from ordinary app tables.

## Current Lifecycle

The todo Contract surface follows this sequence:

1. Acceptance starts a local Snapback server, then loads generated schema/functions.
2. `reset` and `seed` create deterministic state through handler-bypassing admin paths.
3. `createSnapbackContractSurface` validates the generated Contract data manifest against the generated Snapback artifact index.
4. It queries Snapback for the authoritative initial `listTodos` rows.
5. Exact runtime creates a mock query boundary hydrated with that snapshot.
6. Runtime links expose the generated query/mutation set to Contract.
7. Headless acceptance mounts compiled Contract components through `surface.mount()`, which delegates to Exact's `host: "headless"` mode and tracks the disposable mount handle.
8. Mutations optimistically edit the Contract boundary, then call Snapback mutations on the live server.
9. Reconciliation re-queries Snapback and republishes authoritative rows into the boundary.
10. Provider users call the same backend through `createBoundaryContractDataProvider`.

That sequence remains the Online fallback. A single live-query surface earns
`Parity` only when it is configured with a client store, the generated manifest
claims `offlineReplay`, and every mutation declared on the surface has an IR
plan derivable for the bound table. That path retains authorized rows, evaluates
the closed IR locally for its overlay/ledger, queues before sending, full-resyncs
before ordered reconnect replay, and reconciles to server truth. Multi-query,
system, mixed-tier, and no-store surfaces remain `Online`.

Todo v2 adds useful checks on this lifecycle: the adapter exposes
`declaredQueries` and `declaredMutations` from the generated Contract data
manifest, and the v2 Contract acceptance asserts the extra `setPriority`
mutation is available at runtime. Both todo demos import generated
query/mutation modules from `snapback/generated/contract/`, proving ordinary
demo-local sidecars are no longer required for those surfaces. The v2 provider
conformance runner now imports Exact's reusable conformance suite and passes the
live Snapback provider fixture for the Online capabilities the adapter claims:
initial snapshot, subscription update, mutation invalidation, failed mutation
diagnostics, row sync state, force states, server-runnable query smoke, and
subscription disposal.

Todo v2 also has a descriptor-only Exact project-check runner:
`bun demos/todo-v2/tests/acceptance/contract-descriptors.mjs`. It resolves the
generated query and mutation modules through Exact static import semantics,
runs the Exact data doctor against the generated Contract data manifest, and
asserts that the generated `ListTodosRow` shape catches `todo.notAField` with
`shape_unknown_member` before any browser or server smoke test runs.

The no-server adapter semantics runner is:
`bun demos/todo-v2/tests/acceptance/adapter-semantics.mjs`. It holds an
in-memory mutation open long enough to observe optimistic state, releases it as
a rejection, and verifies the adapter republishes authoritative rows plus
`SNAPBACK_CONTRACT_MUTATION_FAILED`. It also holds one runtime-link mutation and
one provider mutation concurrently and verifies `pendingCount()` reports both as
one combined pending set.

## Provider Conformance Discovery

Run the Snapback-side probe with:

```sh
node packages/snapback-contract/exact-conformance.mjs
node packages/snapback-contract/exact-conformance.mjs --require
node packages/snapback-contract/exact-conformance.mjs --run
```

The probe is intentionally discovery-only by default. It returns a structured
JSON report and exits successfully even when the suite is missing, so ordinary
Snapback work does not start depending on Exact. Use `--require` when a lane
should fail unless Exact has registered the suite, and `--run` when the Exact
`data-provider-conformance` check exists and should be executed through
`bun scripts/exact-verify.mjs --check data-provider-conformance --json`.

As of 2026-06-27, the local Exact checkout registers
`data-provider-conformance` in `exact-verify.json` and exports the reusable
suite from `@exact/contract/conformance`. Snapback's discovery probe reports
the suite as runnable, `--run` invokes the Exact-owned check successfully, and
Todo v2 has a Snapback fixture for the same suite:

```sh
bun demos/todo-v2/tests/acceptance/provider-conformance.mjs
```

The Todo v2 fixture starts a live in-memory Snapback server, creates the
package-owned Contract provider, and passes the Exact suite as
`snapback-todo-v2-provider` for its Online conformance subset. Separate
`packages/snapback-contract/offline-replay.test.mjs` evidence gates the
Parity-only behavior: retained reload, create/toggle/delete queue ordering,
lost-response exactly-once replay, convergence, auth wipe, artifact quarantine,
and serialized localStorage restart.

The admin Contract surface follows a related but system-app-specific sequence:

1. The build regenerates `admin-ui/generated/contract/` from `admin-ui/contract-bindings.mjs`.
2. `app.contract` imports those generated query and mutation modules as ordinary Contract symbols.
3. `admin-boundary.mjs` declares the admin resources and commands, then delegates boundary creation, query links, command tracking, publish helpers, flush, and disposal to `createSnapbackSystemContractSurface`.
4. `main.ts` configures the generated runtime-link registry from that surface and disposes it on HMR teardown.
5. The admin-specific layer fetches the privileged `/_snapback/api/*` endpoints and shapes inspect, table-scan, and function-runner state before publishing through the shared helper.

That removes the old one-file-per-binding drift hazard from `admin-ui/data/`,
and removes the local boundary/link lifecycle copy from `admin-boundary.mjs`.
It deliberately does not make the admin bridge an ordinary app-table adapter.

The generated modules are now checked by Exact project semantics for Todo v2,
not only by Snapback's artifact index. The adapter standardizes manifest/hash
and descriptor-index mismatch diagnostics for the artifacts it is handed, and
the admin UI no longer carries hand-written descriptor sidecars or a private
boundary/link lifecycle. Stable installed Exact package consumption and any
future admin-client/package consolidation remain separate dependencies.

## Static and Native Admin Recipe

The admin build path is now a preset invocation:

```sh
cd admin-ui
./build.sh
cargo run --manifest-path ../Cargo.toml -- --memory
```

`admin-ui/build.mjs` regenerates the admin Contract binding modules, then calls
`buildSnapbackContractStaticApp` from `packages/snapback-contract/build-preset.mjs`.
The preset requires and checks:

- `exactVitePlugin` before `contractVitePlugin`;
- a route registry at `admin-ui/src/app/routes.ts`;
- the subdirectory entry `admin-ui/src/main.ts`;
- programmatic Vite `build()` with `configFile: false`;
- post-build URL rewriting for the `/_snapback/admin/` mount until Exact owns basePath support.

The Snapback server serves the generated `dist/` snapshot under `/_snapback/admin/`.
`SNAPBACK_ADMIN_DIST` can pin a specific snapshot; when it is unset, a local
checkout auto-discovers `admin-ui/dist` if `./build.sh` has produced one. If no
built dist is available, the server returns a missing-dist diagnostic rather than
serving a second admin UI implementation.

## Admin Browser Dev Loop

The admin dev path uses the same shared Exact/Contract Vite base config as the
static build, but keeps static/native export concerns build-only:

```sh
cd admin-ui
cargo run --manifest-path ../Cargo.toml -- --memory --port 4287
bun run dev
```

`bun run dev` starts a loopback Vite server and proxies `/_snapback/api/*` to a
running Snapback server. The default API target is `http://127.0.0.1:4287` only
for the pinned-port loop above; when Snapback prints a different auto-scanned
port, set `SNAPBACK_ADMIN_DEV_API` to that origin. The dev server performs a
non-fatal startup preflight and returns `SNAPBACK_ADMIN_DEV_API_UNREACHABLE`
from the proxy when the API target is down, so the browser sees a structured
diagnostic instead of a blank screen or HTML proxy error.

The dev proxy binds to `127.0.0.1` unless `SNAPBACK_ADMIN_DEV_HOST` is set and
`SNAPBACK_ADMIN_DEV_ALLOW_NON_LOOPBACK=1` explicitly opts into exposing the
privileged admin proxy. Browser requests for static native Exact artifacts such
as `/__exact/platform-manifest.json` return
`SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE`; native shell loading
stays on the `./build.sh` + `SNAPBACK_ADMIN_DIST` path.

## Launch Shapes

Browser baseline:

```sh
cargo run -- --memory
# open the printed admin console URL
```

Static browser/native admin:

```sh
cd admin-ui
./build.sh
cargo run --manifest-path ../Cargo.toml -- --memory
# browser: open the printed admin console URL
# native Exact shell: EXACT_APP_CUSTOM_URL=<printed admin console URL>
```

Admin Contract browser dev:

```sh
cargo run -- --memory --port 4287
SNAPBACK_ADMIN_DEV_API=http://127.0.0.1:4287 bun run --cwd admin-ui dev
```

Todo Contract browser dev:

```sh
cargo run -- --port 4420 --memory
SNAPBACK_TODO_API=http://127.0.0.1:4420 bun run --cwd demos/todo/surfaces/contract dev
```

The native Exact shell must point at the Snapback-served static admin URL, not the todo Vite browser dev server.

## Diagnostics

Current structured diagnostics:

- `SNAPBACK_CAPABILITY_EXACT_MISSING`: no Exact checkout with the required Contract compiler, runtime, and data-provider capability was found.
- `SNAPBACK_CAPABILITY_EXACT_PACKAGE_EXPORT_MISSING`: Exact is present, but the requested `@exact/contract` package export could not be resolved from installed packages or the configured Exact checkout.
- `SNAPBACK_CAPABILITY_EXACT_PROVIDER_CONFORMANCE_MISSING`: Exact is present, but no Exact-owned `data-provider-conformance` suite is registered or present at known candidate paths. This remains the stale/missing-Exact diagnostic even though current local Exact checkouts should expose the suite.
- `SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE`: a native Exact artifact was requested while Snapback has no built admin dist configured.
- `SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACT_MISSING`: a dist is configured, but the requested native Exact artifact is absent from it.
- `SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH`: a Contract data manifest was generated from different inputs than the Snapback artifact index.
- `SNAPBACK_STALE_CONTRACT_DATA_ARTIFACT_VERSION`, `SNAPBACK_STALE_CONTRACT_DATA_SCHEMA_HASH`, and `SNAPBACK_STALE_CONTRACT_DATA_BUNDLE_HASH`: Contract data manifest version/hash mismatches against generated Snapback artifacts.
- `SNAPBACK_STALE_CONTRACT_DESCRIPTOR_SET`: generated Contract descriptor artifacts are missing from the generated artifact index.
- `SNAPBACK_CAPABILITY_EXACT_ENTRY_MISSING`, `SNAPBACK_CAPABILITY_EXACT_ROUTE_REGISTRY_MISSING`, and `SNAPBACK_CAPABILITY_EXACT_BUILD_OUTPUT_MISSING`: static/native Contract build preset preflight failures.
- `SNAPBACK_ADMIN_DEV_API_UNREACHABLE`: the admin browser dev proxy could not reach the configured Snapback API target.
- `SNAPBACK_ADMIN_DEV_HOST_EXPOSED`: the admin browser dev proxy was configured for a non-loopback host without the explicit exposure opt-in.
- `SNAPBACK_ADMIN_DEV_API_INVALID`, `SNAPBACK_ADMIN_DEV_PORT_INVALID`, and `SNAPBACK_ADMIN_DEV_PROXY_PATH_INVALID`: admin browser dev-server configuration errors.

These diagnostics live under the LLP 0012 `CAPABILITY_*` / `STALE_*` families and include the target surface in `details.target_surface`.
