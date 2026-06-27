# Snapback admin — Contract console

The richer admin console, authored as a **Contract/Exact app** and **statically
built** so the Rust server serves the snapshot with no Vite/Node/toolchain at
runtime. It is a *system app*: it talks to the headless admin API
(`/_snapback/api/*`), never to ordinary app tables, so it stays usable when the
app's own schema/functions are broken. Governed by
[LLP 0017](../llp/0017-admin-console-inspection-surface.rfc.md).

The build emits a single dist that loads in a **plain browser** and also carries
the **Exact LLP 0268** static native artifacts, so the same `/_snapback/admin`
URL is loadable by the native Exact macOS shell.

## Build

```sh
./build.sh                 # → admin-ui/dist/  (needs the Exact checkout + bun)
```

`build.sh` runs `build.mjs` under bun. `build.mjs` regenerates the admin
Contract bindings, then delegates to
`buildSnapbackContractStaticApp` in
[`packages/snapback-contract/build-preset.mjs`](../packages/snapback-contract/build-preset.mjs),
which owns the programmatic Vite `build()` with `configFile: false`,
`exactVitePlugin` before `contractVitePlugin`, route-registry and subdir-entry
preflights, the LLP 0268 `mac` native envelope, and the post-build URL rewrite
for the `/_snapback/admin/` mount. The current LLP 0021 inventory lives in
[`docs/contract-exact-integration.md`](../docs/contract-exact-integration.md).

## Dev Serve

For browser UI iteration, run Snapback and the Vite dev server in two terminals:

```sh
# terminal 1: the Snapback server that owns the admin API and runtime state
cargo run --manifest-path ../Cargo.toml -- --memory --port 4287

# terminal 2: the Contract console served by Vite
bun run dev
```

`bun run dev` runs `dev.sh`, which regenerates `generated/contract/*`, starts a
loopback Vite server, and proxies `/_snapback/api/*` to the Snapback server. The
default proxy target assumes the server is pinned to `http://127.0.0.1:4287`.
If Snapback auto-scans to another port, set the printed URL explicitly:

```sh
SNAPBACK_ADMIN_DEV_API=http://127.0.0.1:4291 bun run dev
```

The dev proxy binds to `127.0.0.1` by default. To expose it on another interface
you must opt in with both `SNAPBACK_ADMIN_DEV_HOST` and
`SNAPBACK_ADMIN_DEV_ALLOW_NON_LOOPBACK=1`; that exposes privileged admin routes
through the Vite process. `contract-bindings.mjs` and
`generate-contract-bindings.mjs` are watched: edits regenerate
`generated/contract/*` and trigger a browser reload. Native Exact artifacts are
not served by this browser-only dev server; use `./build.sh` for native shell
loading.

## Serve

```sh
SNAPBACK_ADMIN_DIST="$(pwd)/dist" cargo run --manifest-path ../Cargo.toml -- --memory
# then open the printed admin console URL
```

When `SNAPBACK_ADMIN_DIST` is unset, the server falls back to the embedded
single-file console (`src/admin/console.html`) — the always-works baseline that
needs no Exact toolchain.

## Loading in the Exact macOS shell

The build emits `dist/__exact/platform-manifest.json` + `dist/__exact/native/
mac-appkit-hermes/{exact-native.json, startup.js, startup.hbc}`, served under
`/_snapback/admin/__exact/…`, with the discovery `<link>` + inline platform index
in `index.html`. Point the macOS shell at the served URL:

```sh
EXACT_APP_CUSTOM_URL=<printed admin console URL>   # then launch ExactAppMac
```

The emitted envelope is `mode: static`, omits the dev-only fields, and is
decode-compatible with the loosened host. End-to-end load in ExactAppMac is the
remaining verification.

## Layout

- `app.contract` — the console UI: a tabbed inspector (Overview, Schema, a
  paginated Data explorer, a Functions runner, Realtime, Diagnostics) built from
  reusable components and `when` panels.
- `theme.ts` — self-contained palette + font stack + tab list (dependency-free;
  dark mode via `@exact/facet-contract` is a follow-up).
- `contract-bindings.mjs` — the source list for the admin Contract query and
  mutation bindings.
- `generate-contract-bindings.mjs` / `generated/contract/` — generated
  `use … from` targets, `.contract-meta.ts` semantics sidecars, and runtime
  links for inspect/refresh, tableScan/loadTable, and runResult/runFunction.
- `admin-client.mjs` — fetch client for `/_snapback/api/*`.
- `admin-boundary.mjs` — declares the admin resources/commands and flattens the
  inspect payload into the `data.ui.*` view model the `.contract` renders; shared
  boundary/link lifecycle comes from `createSnapbackSystemContractSurface`.
- `tests/contract-bindings.mjs` — smoke test that generated admin bindings and
  bridge links stay in sync.
- `main.ts` — boot: install web host, hydrate, configure links, mount, and
  dispose the surface on HMR teardown.
- `src/main.ts` — the build entry (a subdir shim that runs `../main.ts`).
- `src/app/routes.ts` — React-free route registry; the LLP 0268 exporter's unlock.
- `build.mjs` / `build.sh` — regenerate bindings, then call the shared Snapback Contract static build preset.
- `dev.mjs` / `dev.sh` — regenerate bindings, then call the shared Snapback Contract dev-serve preset with a loopback API proxy.
