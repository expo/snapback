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

`build.sh` runs `build.mjs` (a programmatic Vite `build()` with `configFile:
false`) under bun. It uses `exactVitePlugin` (emits the LLP 0268 platform
manifest + `mac` native envelope) + `contractVitePlugin` (compiles `.contract`).
See `build.mjs` for the sharp edges (route registry required, subdir entry,
post-build URL rewrite for the `/_snapback/admin/` mount) and
LLP 0017 *Static bundling and the native shell*.

## Serve

```sh
SNAPBACK_ADMIN_DIST="$(pwd)/dist" cargo run --manifest-path ../Cargo.toml -- --memory
# then open http://127.0.0.1:4287/_snapback/admin
```

When `SNAPBACK_ADMIN_DIST` is unset, the server falls back to the embedded
single-file console (`src/admin/console.html`) — the always-works baseline that
needs no Exact toolchain (and which has the data-explorer + function-runner this
Contract console does not yet).

## Loading in the Exact macOS shell

The build emits `dist/__exact/platform-manifest.json` + `dist/__exact/native/
mac-appkit-hermes/{exact-native.json, startup.js, startup.hbc}`, served under
`/_snapback/admin/__exact/…`, with the discovery `<link>` + inline platform index
in `index.html`. Point the macOS shell at the served URL:

```sh
EXACT_APP_CUSTOM_URL=http://127.0.0.1:4287/_snapback/admin   # then launch ExactAppMac
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
- `data/` — `use … from` binding targets + `.contract-meta.ts` semantics
  sidecars (inspect/refresh, tableScan/loadTable, runResult/runFunction).
- `admin-client.mjs` — fetch client for `/_snapback/api/*`.
- `admin-boundary.mjs` — hydrates the reactive boundary and flattens the inspect
  payload into the `data.ui.*` view model the `.contract` renders.
- `main.ts` — boot: install web host, hydrate, configure links, mount.
- `src/main.ts` — the build entry (a subdir shim that runs `../main.ts`).
- `src/app/routes.ts` — React-free route registry; the LLP 0268 exporter's unlock.
- `build.mjs` / `build.sh` — the programmatic static build.
