# Contract/Exact Integration Notes

**Status:** Implementation notes for [LLP 0021](../llp/0021-contract-exact-integration-hardening.plan.md): Phase 0 inventory, Phase 1 generated binding footholds, the Phase 2 provider conformance discovery probe, the Phase 3 build preset, and the first Phase 4 surface-migration footholds. This file inventories current prototype glue and the repeatable build/launch recipe so future work can replace it with product code.

## Product vs Prototype

Product code today:

- `src/admin.rs` serves the packaged admin console and `/_snapback/api/*` from the same Snapback server.
- `src/contract_exact.rs` owns Snapback-side Contract/Exact capability diagnostics that core can emit without importing Exact.
- `demos/_kit/client.mjs` is the framework-neutral online Snapback client used by headless and Contract acceptance.
- `demos/_kit/codegen.mjs` projects Snapback demo artifacts into generated Contract binding modules under `snapback/generated/contract/`, including runtime links and per-query/per-mutation descriptor sidecars.
- `packages/snapback-contract/` is the first package-equivalent Snapback Contract adapter: generated-artifact validation, boundary hydration, manifest-derived runtime links, optimistic mutations, reconciliation, provider seam, row sync state, Online capability reporting, and the shared system-surface boundary/link helper used by the admin console.
- `packages/snapback-contract/build-preset.mjs` is the first static/native build preset: it owns the Exact/Contract Vite plugin ordering, route-registry and entry preflights, native target selection, and Snapback base-path rewrite.
- `packages/snapback-contract/exact-conformance.mjs` discovers the Exact-owned provider conformance gate. It resolves the local Exact checkout, inspects `exact-verify.json` for `data-provider-conformance`, searches known suite paths, and reports a structured missing-capability diagnostic while the Exact suite is absent.
- `admin-ui/contract-bindings.mjs` and `admin-ui/generate-contract-bindings.mjs` project the admin system-app bindings into generated Contract modules under `admin-ui/generated/contract/`, including runtime links and per-query/per-mutation descriptor sidecars.
- `admin-ui/build.mjs` regenerates those admin Contract modules, then invokes the shared build preset.

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
7. Mutations optimistically edit the Contract boundary, then call Snapback mutations on the live server.
8. Reconciliation re-queries Snapback and republishes authoritative rows into the boundary.
9. Provider users call the same backend through `createBoundaryContractDataProvider`.

This is Online only. It does not run handlers locally, queue offline mutations, replay deterministically, or claim Parity.

Todo v2 adds two useful checks on this lifecycle: the adapter exposes
`declaredQueries` and `declaredMutations` from the generated Contract data
manifest, and the v2 Contract acceptance asserts the extra `setPriority`
mutation is available at runtime. Both todo demos import generated
query/mutation modules from `snapback/generated/contract/`, proving ordinary
demo-local sidecars are no longer required for those surfaces. That reduces two
silent handwiring failures, but the adapter still needs an Exact-owned provider
conformance suite before LLP 0021 should treat it as finished product.

## Provider Conformance Discovery

Run the Snapback-side probe with:

```sh
node packages/snapback-contract/exact-conformance.mjs
```

The probe is intentionally discovery-only by default. It returns a structured
JSON report and exits successfully even when the suite is missing, so ordinary
Snapback work does not start depending on Exact. Use `--require` when a lane
should fail unless Exact has registered the suite, and `--run` when the Exact
`data-provider-conformance` check exists and should be executed through
`bun scripts/exact-verify.mjs --check data-provider-conformance --json`.

As of 2026-06-27, the local Exact checkout has:

- `packages/exact-contract/src/runtime/data-provider.ts`, the runtime provider
  contract and boundary-backed provider helper;
- `contract-data-bindings` in `exact-verify.json`, which tests the Exact mock
  provider and notes that Snapback conformance is still a later integration
  profile;
- no registered `data-provider-conformance` check and no known candidate suite
  file under the searched Exact paths.

That means Snapback has wired the discovery point but has not passed the LLP
0021 Phase 2 provider-conformance gate.

The admin Contract surface follows a related but system-app-specific sequence:

1. The build regenerates `admin-ui/generated/contract/` from `admin-ui/contract-bindings.mjs`.
2. `app.contract` imports those generated query and mutation modules as ordinary Contract symbols.
3. `admin-boundary.mjs` declares the admin resources and commands, then delegates boundary creation, query links, command tracking, publish helpers, flush, and disposal to `createSnapbackSystemContractSurface`.
4. `main.ts` configures the generated runtime-link registry from that surface and disposes it on HMR teardown.
5. The admin-specific layer fetches the privileged `/_snapback/api/*` endpoints and shapes inspect, table-scan, and function-runner state before publishing through the shared helper.

That removes the old one-file-per-binding drift hazard from `admin-ui/data/`,
and removes the local boundary/link lifecycle copy from `admin-boundary.mjs`.
It deliberately does not make the admin bridge an ordinary app-table adapter.

The generated modules are still a foothold, not the full Phase 1 finish line.
The adapter now standardizes manifest/hash and descriptor-index mismatch
diagnostics for the artifacts it is handed, and the admin UI no longer carries
hand-written descriptor sidecars or a private boundary/link lifecycle. Exact
project-check conformance and any future admin-client/package consolidation
remain separate dependencies.

## Static and Native Admin Recipe

The admin build path is now a preset invocation:

```sh
cd admin-ui
./build.sh
SNAPBACK_ADMIN_DIST="$(pwd)/dist" cargo run --manifest-path ../Cargo.toml -- --memory
```

`admin-ui/build.mjs` regenerates the admin Contract binding modules, then calls
`buildSnapbackContractStaticApp` from `packages/snapback-contract/build-preset.mjs`.
The preset requires and checks:

- `exactVitePlugin` before `contractVitePlugin`;
- a route registry at `admin-ui/src/app/routes.ts`;
- the subdirectory entry `admin-ui/src/main.ts`;
- programmatic Vite `build()` with `configFile: false`;
- post-build URL rewriting for the `/_snapback/admin/` mount until Exact owns basePath support.

The Snapback server serves the generated `dist/` snapshot under `/_snapback/admin/`. Without `SNAPBACK_ADMIN_DIST`, it serves the embedded single-file browser console from `src/admin/console.html`.

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
SNAPBACK_ADMIN_DIST="$(pwd)/dist" cargo run --manifest-path ../Cargo.toml -- --memory
# browser: open the printed admin console URL
# native Exact shell: EXACT_APP_CUSTOM_URL=<printed admin console URL>
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
- `SNAPBACK_CAPABILITY_EXACT_PROVIDER_CONFORMANCE_MISSING`: Exact is present, but no Exact-owned `data-provider-conformance` suite is registered or present at known candidate paths.
- `SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE`: a native Exact artifact was requested while Snapback is serving only the embedded browser console.
- `SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACT_MISSING`: a dist is configured, but the requested native Exact artifact is absent from it.
- `SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH`: a Contract data manifest was generated from different inputs than the Snapback artifact index.
- `SNAPBACK_STALE_CONTRACT_DATA_ARTIFACT_VERSION`, `SNAPBACK_STALE_CONTRACT_DATA_SCHEMA_HASH`, and `SNAPBACK_STALE_CONTRACT_DATA_BUNDLE_HASH`: Contract data manifest version/hash mismatches against generated Snapback artifacts.
- `SNAPBACK_STALE_CONTRACT_DESCRIPTOR_SET`: generated Contract descriptor artifacts are missing from the generated artifact index.
- `SNAPBACK_CAPABILITY_EXACT_ENTRY_MISSING`, `SNAPBACK_CAPABILITY_EXACT_ROUTE_REGISTRY_MISSING`, and `SNAPBACK_CAPABILITY_EXACT_BUILD_OUTPUT_MISSING`: static/native Contract build preset preflight failures.

These diagnostics live under the LLP 0012 `CAPABILITY_*` / `STALE_*` families and include the target surface in `details.target_surface`.
