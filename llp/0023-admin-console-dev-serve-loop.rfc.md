# LLP 0023: Admin console dev-serve loop

**Type:** RFC
**Status:** Accepted
**Systems:** Developer experience, Contract/Exact, Tooling, Testing
**Author:** Claude (Opus 4.8)
**Date:** 2026-06-27
**Revised:** 2026-07-01 (status → Accepted, ratified in the LLP 0032 R1 batch: the dev-serve loop and built-dist serving shipped; 2026-06-27 review passes: GPT-5 clarified HMR verification, loopback proxy defaults, structured proxy failures, generated-binding lifecycle, and shared compile config; Claude hardened API-target resolution, non-fatal startup preflight, same-machine proxy risks, env naming, and Exact/bun prerequisites; GPT-5 re-review corrected memory-server port discovery and separated SSE from WebSocket proxy requirements; 2026-06-27 corrected the layout-bug characterization — a Contract `dom-mirror` `flex-shrink` default mismatch, not a kernel measurement bug — and recorded its upstream Exact fix, ENG-22199, verified under ENG-22214); 2026-07-03 (ENG-22600: fixed the dev-serve React 19 CJS/ESM interop crash — `resolve.dedupe` is now conditional on app-root resolvability; see "Shared Vite config")
**Related:** LLP 0017 (admin console; Serving Model), LLP 0021 (Contract/Exact integration hardening; the build preset), [diary 0005](../diaries/0005-admin-console-redesign.diary.md); Exact LLP 0268 (static platform manifests)

## Summary

The admin console (`admin-ui/`) has no hot-reload loop. Every UI change is
`./build.sh` -> restart/refresh the Rust server against the new `dist/`. The
build is fast (~1.5-2 s), but losing a live edit loop turns UI-polish work into a
slow rebuild-to-see cycle (see diary 0005). This RFC proposes a **dev-serve
loop**: a loopback-only Vite dev server that reuses the shared Exact/Contract
compile configuration, regenerates the admin Contract bindings before serve,
serves the browser console with Vite's hot-update or fast-reload behavior, and
reaches the live admin API by proxying `/_snapback/api/*` to a running Snapback
server. It requires **no Rust changes** and **no change to the admin API,
boundary, or client semantics**, and it preserves LLP 0017's hard rule that
ordinary local inspection must work without Vite.

## Motivation

LLP 0017's *Serving Model* already says a Vite-like server "should exist only as a
console-development convenience" — an optional hot-reload mode, never a runtime
dependency. That intent has not been turned into a concrete loop. Diary 0005 named
the gap as the single biggest ergonomics tax of the rebuild: ~50 iterations of
polish became ~10 because each one paid the rebuild + re-screenshot cost, and the
Contract web-flexbox quirks (the post-paint / resize card overlap — which turned
out to be an Exact `flex-shrink` default mismatch, not a measurement bug, fixed
upstream in Exact ENG-22199; see diary 0005) are exactly the kind of thing a live
loop surfaces immediately instead of after a full rebuild.

The pieces already exist:

- `main.ts` already wires `import.meta.hot.dispose` to dispose the surface, reset
  the runtime-link registry, and `reset()` the Contract runtime — so the teardown
  scaffolding exists.
- `main.ts` constructs the admin API base URL from `location.origin` and passes
  that same-origin `/_snapback/api` URL into `AdminClient`.
- `build-preset.mjs` already knows the plugin ordering (`exactVitePlugin` before
  `contractVitePlugin`), the workspace aliases, and `configFile: false`.

What is missing is a `serve`-mode entry that reuses that configuration.

## Goals

- One command brings up the UI half of a live dev loop for `admin-ui/` (running
  alongside a normal Snapback server) that edits `.contract`,
  `theme.ts`, and the boundary without a production build. True HMR is preferred;
  if Exact/Vite can only fast-reload some edit classes, the implementation must
  say so and still dispose/remount cleanly.
- The dev server uses the **same Exact/Contract compile pipeline and aliases** as
  the production build, while keeping static/native export work build-only, so
  "works in dev" is strong evidence for "builds in prod" without over-coupling
  serve mode to packaging concerns.
- Zero Rust changes; zero changes to `admin-boundary.mjs` / `admin-client.mjs` /
  `app.contract` to run under dev vs prod.
- The dev proxy binds to loopback by default and reports an unreachable API
  target with a structured diagnostic instead of an opaque blank screen.
- Production / ordinary local inspection still needs no Vite (reaffirms LLP 0017).

## Non-goals

- Shipping any dev server as a runtime dependency. The packaged static `dist/`
  served by the Rust server remains the only production path.
- The LLP 0268 static native envelope. That is a build-time artifact; dev-serve is
  browser-only. Native shell iteration stays on the build path, and probing the
  dev server for native envelope artifacts should fail clearly rather than look
  like a malformed native app.
- Fixing the Contract web layout overlap (post-paint / resize). That was an
  Exact-side issue — a `flex-shrink` default mismatch in the `dom-mirror` web host,
  not a measurement bug — fixed upstream in Exact ENG-22199 (resize manifestation
  verified under ENG-22214, see diary 0005); the dev loop only made it cheaper to
  hit and confirm.

## Background: the current build path

`admin-ui/build.sh` → `build.mjs` regenerates the Contract bindings, then calls
`buildSnapbackContractStaticApp` (`packages/snapback-contract/build-preset.mjs`),
which runs a programmatic Vite `build()` with `configFile: false`, the exact +
contract plugins, workspace aliases, the LLP 0268 route-registry/subdir-entry
preflights and native targets, and a post-build URL rewrite for the
`/_snapback/admin/` mount. The Rust server then serves `dist/`; if no built
snapshot is available it returns a missing-dist diagnostic instead of a second
admin UI.

The basePath rewrite and the native-export preflights exist **only because of the
static, subpath-mounted production target**. A dev server served at root needs
neither.

## Proposed design

### Serving and the API seam

Run the admin UI under a Vite dev server (`vite serve`) and reach the live admin
API with **Vite's `server.proxy`**. The server should bind to loopback unless a
developer explicitly opts into a wider host, because the proxy forwards
privileged admin routes:

```
server: {
  host: process.env.SNAPBACK_ADMIN_DEV_HOST ?? '127.0.0.1',
  proxy: {
    '/_snapback/api': {
      // 4287 is only the *start* of Snapback's auto-scan range (4287-4387),
      // not a fixed port. Pin the server with --port 4287, or set
      // SNAPBACK_ADMIN_DEV_API to the port Snapback actually bound (it prints
      // it; file-backed servers also record port/url in the DB instance lock).
      // See below.
      target: process.env.SNAPBACK_ADMIN_DEV_API ?? 'http://127.0.0.1:4287',
      changeOrigin: true,
    },
  },
}
```

The browser loads the console from the Vite origin (e.g. `http://localhost:5173/`)
and calls `/_snapback/api/*` on that same origin; Vite forwards those to the
running Snapback server. The browser sees a single origin, so:

- `AdminClient`'s same-origin call is unchanged — no CORS, no token juggling on
  loopback.
- No Rust changes — Snapback is just a normal local server in another terminal.
- The privileged proxy is not accidentally exposed on the LAN. (Loopback binding
  does not by itself stop a page *in the dev browser* from driving the proxy —
  the admin API is open on loopback by default; see Open questions.)

The developer loop is two terminals:

```sh
# 1. a normal Snapback server (the source of truth)
snapback --memory --port 4287
# 2. the admin UI with HMR, proxying the API to it
cd admin-ui && SNAPBACK_ADMIN_DEV_API=http://127.0.0.1:4287 bun run dev
# open the Vite URL; edit app.contract / theme.ts for hot update or fast reload
```

This is the recommended option because it is the lowest-coupling and keeps the dev
browser same-origin (matching production's single-origin model).

**Resolving the API target.** The `127.0.0.1:4287` default is correct only when
the Snapback server is *pinned* to that port (as the example does with
`--port 4287`). A bare `snapback --memory` auto-scans `4287-4387` and may bind a
different port. Snapback prints the chosen URL (`snapback listening on http://…`),
but memory servers do **not** write database instance-lock metadata because there
is no database file to lock. File-backed servers do record the chosen `port`/`url`
in the database lock sidecar, which `dev.mjs` can read when the database path is
known.

V1 should therefore prefer an explicit `SNAPBACK_ADMIN_DEV_API` or a pinned port
for `--memory`, and may use instance-lock discovery only for file-backed servers
where the target database path is unambiguous. Guessing 4287 when the real server
is elsewhere is worse than a clean failure — if some other process holds 4287,
the proxy silently forwards to the wrong server and returns confusing data
instead of an honest refusal.

Because the loop is two decoupled terminals, the developer may start Vite before
Snapback. A startup preflight of the API target must therefore be a **non-fatal
warning**, not a hard exit; the load-bearing diagnostic is a per-request proxy
error handler that turns `ECONNREFUSED`/timeout into JSON with a stable code such
as `SNAPBACK_ADMIN_DEV_API_UNREACHABLE`. `AdminClient` already surfaces structured
diagnostics cleanly; the dev proxy should never return an HTML proxy error or an
empty body that degrades into a generic JSON parse failure.

### Shared Vite config (the anti-drift move)

The one real risk is the dev server using a *different* plugin chain than the build
— "works in dev, breaks in build." To prevent it, **extract the shared Vite
configuration** (Exact/Contract module resolution, plugin construction + ordering,
`resolve.alias` from the Exact workspace, `dedupe`, entry shape, and any route
registry requirement) out of `build-preset.mjs` into a helper both consume, e.g.:

```
contractViteBaseConfig({ exactRoot, root, entry }) -> { plugins, resolve, ... }
```

`buildSnapbackContractStaticApp` keeps the build-only concerns (`base`, `outDir`,
static native targets, native/HBC preflights, and the post-build base-path
rewrite). A new `serveSnapbackContractApp` reuses the base config and adds only
serve concerns (`server.host`, `server.port`, `server.proxy`, and HMR/reload
behavior). Dev and build then share the Exact/Contract compile path without
forcing the browser dev server to emit LLP 0268 native artifacts.

**React dedupe is conditional on root resolvability (ENG-22600).** The shared
config originally set `resolve.dedupe: ['react', 'react-dom']` unconditionally.
Vite's dedupe forces bare `react` resolution to start from the *app root*
(admin-ui), which has no `node_modules` of its own; that resolution failed, so
the dep never registered with the dev optimizer, and the browser was served
Exact's raw CommonJS `react/index.js` — which provides no ESM named exports and
crashes the boot with `does not provide an export named 'isValidElement'`. The
bug was dev-serve-only because dev serves unbundled modules straight to the
browser and relies on the dep optimizer for CJS interop — exactly the step the
failed dedupe resolution bypassed — while both build legs bundle with their own
CJS→ESM interop (rolldown for the web assets, the native envelope's Hermes
module pipeline for `startup.js`). `contractViteBaseConfig` now dedupes only packages that node
resolution from the app root can actually find
(`resolveRootResolvableDedupe`): with no root react, dedupe drops out, react
resolves from its Exact-source importers, and the dev optimizer prebundles it
(imports rewrite to `/node_modules/.vite/deps/react.js`, with vite's
`__vite__cjsImport` interop rewrite in consumers). If a surface later installs
its own react, dedupe re-arms automatically and keeps the single-copy
guarantee.

Verified with a real browser boot (headless Chrome DOM dump: `#exact-root`
mounts the Contract host tree, console shows only vite connect messages, no
`isValidElement` SyntaxError) and guarded by two committed checks:
`packages/snapback-contract/build-preset.test.mjs` unit-tests the
drop-out/re-arm behavior of `resolveRootResolvableDedupe` (run by
`scripts/verify-local-proof`), and `admin-ui/tests/dev-serve-react-esm.mjs`
boots the dev serve, crawls the served module graph, asserts every react
import rewrites to the dep-optimizer chunk (no raw CJS served), and evaluates
the chunk to check `default.isValidElement` (run by admin-ui `npm test`,
which `scripts/verify-local-proof` invokes after the admin build; skips
without an Exact checkout unless `SNAPBACK_REQUIRE_EXACT=1`).

### HMR and remount behavior

Do not count "served by Vite" as proof of HMR. The current `main.ts` already
registers `import.meta.hot.dispose` to dispose the surface, reset generated
runtime links, and reset the Contract runtime. The dev implementation must verify
where updates land in the actual Exact/Vite module graph:

- if `.contract` and `theme.ts` updates are self-accepted by the Exact/Contract
  plugins, confirm the dispose/remount path leaves no stale providers, links, or
  duplicated subscriptions;
- if updates bubble to the boot module, add a tiny boot-level accept/remount path
  in `main.ts` rather than dev/prod branches in `admin-boundary.mjs`,
  `admin-client.mjs`, or `app.contract`;
- if a class of edit can only trigger a fast browser reload in v1, document that
  limitation honestly. It still satisfies the no-production-build loop, but it is
  not HMR.

### Bindings generation in dev

Generated `generated/contract/*` must exist before serve. `dev.mjs` regenerates
them at startup (same call `build.mjs` makes) before Vite starts, and the package
should expose a `dev` script that runs that helper.

Edits to `app.contract`, `theme.ts`, or `admin-boundary.mjs` should flow through
Vite normally. Edits to `contract-bindings.mjs` or
`generate-contract-bindings.mjs` are different because they change generated
module files that `app.contract` imports. V1 may either watch those inputs,
regenerate `generated/contract/*`, and invalidate/reload the Vite graph, or print
a clear "restart dev server after binding-list edits" diagnostic. Silent staleness
is not acceptable.

### Native-export preflights in serve mode

The route-registry / subdir-entry preflights exist for the LLP 0268 native
exporter and the served-app graph. Serve mode is browser-only, so it should skip
native target/HBC/platform-manifest preflights and all base-path rewrite work.
However, it should keep the subdirectory entry and route-registry checks until
Exact proves serve mode does not need them: the existing static recipe learned
that the route-backed app shape is what unlocks the Exact exporter, and the same
shape is the best guard against dev/prod drift.

If a native Exact shell or other client asks the browser dev server for
`/__exact/*` artifacts, the response should be a structured wrong-server-shape
diagnostic in the LLP 0021 family, not an accidental HTML page.

## Implementation sketch

1. Extract `contractViteBaseConfig` from `build-preset.mjs`; have the build path
   call it (no behavior change) to prove parity.
2. Add `serveSnapbackContractApp({ root, exactRoot, apiTarget, port })` to the
   preset (or a sibling), using the base config plus loopback `server.host`,
   `server.proxy`, API-target preflight/proxy-error diagnostics, and no static
   native export options.
3. Add `admin-ui/dev.mjs` + `dev.sh` + a package `dev` script mirroring
   `build.mjs`/`build.sh`: regenerate bindings, then call the serve helper. Honor
   `SNAPBACK_ADMIN_DEV_API`. The dev path inherits `build.sh`'s prerequisites — a
   `bun` runtime and an Exact checkout at `SNAPBACK_EXACT_ROOT`/`../../exact` — so
   surface the same clear error when they are missing.
4. Verify HMR/remount behavior and add a boot-level accept/remount path only if
   the Exact/Vite graph needs it.
5. Document the two-terminal loop in `admin-ui/README.md` next to Build/Serve.

## Validation requirements

- `bun run dev` boots a loopback Vite server, prints the Vite URL and API target,
  and regenerates `admin-ui/generated/contract/*` before serve. That regeneration
  is idempotent: because `generated/contract/*` is tracked (not gitignored),
  booting with unchanged inputs leaves those files byte-identical, so a dev boot
  never dirties the working tree.
- The dev loop targets the port Snapback actually bound. With a pinned
  `--port 4287` the default works; otherwise the target comes from
  `SNAPBACK_ADMIN_DEV_API`, file-backed instance-lock discovery, or a clear
  restart/configuration diagnostic — never a blind 4287. A `--memory` server
  without a pinned port or explicit API target must not pretend instance-lock
  discovery is available.
- Editing `app.contract`, `theme.ts`, or `admin-boundary.mjs` updates the browser
  without a production build. If the update is true HMR, the dispose/remount path
  runs; if it is a fast reload for a specific edit class, that limitation is
  documented and no stale runtime links or duplicate providers survive.
- A change that compiles in dev also compiles via `./build.sh` (shared config).
- With no Snapback server running, dev fails with a clear "API proxy target
  unreachable" message or structured `SNAPBACK_ADMIN_DEV_API_UNREACHABLE`
  diagnostic rather than a blank console.
- The dev proxy is loopback-only by default; any non-loopback host requires an
  explicit opt-in and prints that the admin API proxy is exposed on that host.
- Production and ordinary local inspection still require no Vite; `./build.sh` +
  `SNAPBACK_ADMIN_DIST` is unchanged.

## Alternatives considered

- **Snapback proxies `/_snapback/admin/*` to the Vite dev server.** Most
  production-like (single Rust origin), but requires Rust changes and a dev-only
  proxy path in the server. Heavier for no real gain over Vite-side proxy on
  loopback. Reconsider if cross-machine/dev-on-device scenarios appear.
- **Vite serves the UI; the UI calls Snapback cross-origin with a local token.**
  Forces CORS handling and a token even on loopback, and diverges from the
  same-origin production model. Rejected.
- **Status quo (rebuild only).** Keeps one path, but the iteration tax is the
  whole motivation here.

## Open questions

- Does `exactVitePlugin` in `serve` mode require the route registry / a subdir
  entry, or only the static native exporter? (Determines how much of the preflight
  set the serve helper must satisfy.)
- Does `exactVitePlugin` self-accept `.contract` updates in serve mode, or does
  the first implementation need a boot-level remount/fast-reload boundary?
- Should `contract-bindings.mjs` edits auto-regenerate and invalidate Vite, or is
  a clear restart-required diagnostic enough for v1?
- Should `dev.mjs` auto-start a Snapback server when none is reachable, or stay
  decoupled (assume the developer runs one)? Decoupled is simpler and matches the
  "Snapback owns the truth" model; revisit for one-command ergonomics.
- Should v1 implement file-backed instance-lock discovery, or keep target
  selection to explicit `SNAPBACK_ADMIN_DEV_API` / pinned `--port` and leave
  zero-config discovery for a later process registry that also covers `--memory`?
- Should the dev proxy enforce an Origin/Host allowlist (or require
  `SNAPBACK_ADMIN_TOKEN`) so that only the console — not an arbitrary page loaded
  in the dev browser — can drive the privileged admin API through it? Loopback
  binding stops LAN exposure but not a same-machine drive-by/DNS-rebind fetch.
- The admin API is request/response JSON today. If the console later consumes a
  live-push channel (LLP 0020) over `/_snapback/api`, confirm the transport before
  it lands: SSE/EventSource needs streaming without response buffering, while a
  WebSocket path needs Vite proxy WebSocket support (`ws: true`).
- Where the shared base config lives once more surfaces (todo demos) want a dev
  loop too — likely the same `packages/snapback-contract` preset module.
