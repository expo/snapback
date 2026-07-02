# LLP 0017: Admin console and inspection surface

**Type:** RFC
**Status:** Accepted
**Systems:** Developer experience, Runtime, Storage, Realtime, Security, Client integration, Contract/Exact, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-26
**Revised:** 2026-07-03 (instance home is embedded-only again: the short-lived `home-ui/` Contract surface, `SNAPBACK_HOME_DIST`, and `/_snapback/home/*` lane were removed because `/` is a recovery/status page whose value is zero-toolchain reliability, while the admin dashboard remains the useful Contract/Exact dogfooding surface. Earlier: 2026-07-02 instance home briefly gained a Contract surface and shared-build-preset notes; this revision supersedes that slice. Earlier same day: added §Instance home page: the root `/` is now content-negotiated — a branded, embedded HTML homepage for browsers over the same public metadata object served as YAML/JSON/Markdown; app identity comes from the schema manifest's optional `app` block. Earlier same day: ENG-22598: Secrets surface added to both consoles over the LLP 0036 config ops. Earlier: 2026-07-01 status → Accepted, ratified in the LLP 0032 R1 batch: the console and admin API shipped per this RFC, hosted access still future; LLP 0032 R3: layout-kernel diagnosis corrected per LLP 0023/ENG-22199; "local safe by default" annotated with the S0 root-alias gating; LLP 0032 S1: v0-alias retirement completed per LLP 0031)
**Related:** LLP 0000, LLP 0002, LLP 0003, LLP 0004, LLP 0005, LLP 0006, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0014, LLP 0015, LLP 0016, LLP 0024, LLP 0036

## Summary

Snapback should ship a first-party admin console: a developer and operations
surface for inspecting a running Snapback instance, browsing and carefully
editing application data, running generated functions, inspecting ephemeral
realtime state, and understanding health, capabilities, diagnostics, and runtime
configuration.

The admin console should be built on a headless admin contract, not private UI
state. The same facts should be available to the web console, a Contract/Exact
surface, native Exact, CLI/doctor tooling, agents, and future adapters.

The default serving model should be: **the same Snapback server that owns the app
instance serves the admin API and the packaged web admin console**. A Vite-like
development server is useful while building the console UI, but it should be an
optional hot-reload/proxy mode, not a runtime dependency for inspecting a
Snapback instance.

## Motivation

LLP 0003 already requires health and readiness, inspect, schema and function
load, deterministic reset, and invocation in the local core, plus enough
inspection for an agent to confirm its code and schema are loaded and working. LLP 0010 requires stable,
machine-readable ways to inspect loaded schema, functions, capabilities,
database version, connected clients, subscriptions, and recent errors. LLP 0012
requires adapters to consume shared artifacts and runtime state rather than
inventing private backend semantics. LLP 0013 requires explicit diagnostics for
ephemeral rooms, fan-out, TTL, rate limits, and queue pressure.

Those requirements point at the same product surface: Snapback needs a coherent
admin console and a coherent headless admin API. Without it, debugging falls back
to SQLite shells, ad-hoc HTTP calls, logs, and tribal knowledge about which
state lives in durable tables versus process memory. That is the wrong shape for
an agent-first backend.

An admin console also gives Snapback a practical place to answer questions that
otherwise stay invisible:

- which server and target profile am I connected to;
- is the database file-backed or in memory;
- where is the SQLite file, or what hosted storage target is active;
- what port and host is the server bound to;
- which schema, functions, generated artifacts, and capability gaps are loaded;
- which subscriptions and clients exist;
- why a mutation, query, permission check, runtime invocation, or ephemeral
  publish failed;
- whether data should be modeled as durable data or ephemeral realtime state.

## Scope

This RFC owns:

- the admin console product boundary;
- the serving model for the local web console;
- the route namespace for Snapback-owned admin surfaces;
- the headless admin API shape at a high level;
- durable data exploration and controlled direct-edit policy;
- the ephemeral-state inspector boundary;
- the generated-function runner boundary;
- security defaults for local and hosted admin access;
- validation requirements for the first implementation.

It does not own:

- app-facing schema and handler syntax, owned by LLP 0004;
- storage semantics and portability, owned by LLP 0007;
- local-first sync and durable realtime semantics, owned by LLP 0008;
- runtime sandbox details, owned by LLP 0009;
- auth and row-level permissions, owned by LLP 0011;
- the general Contract/Exact adapter contract, owned by LLP 0012;
- ephemeral runtime semantics, owned by LLP 0013;
- hosted control planes, billing, teams, or project lifecycle.

## Design Principles

- **Headless first.** The console is one consumer of a structured admin
  contract. Important facts must also be available to CLI, tests, agents, and
  non-Exact adapters.
- **Same instance authority.** The server that owns SQLite/Postgres, runtime
  state, subscriptions, and process-local ephemeral rooms is the authority for
  admin facts. A second process may render UI during development, but it cannot
  own the truth.
- **No private Exact semantics.** A Contract/Exact admin app is a good primary
  UI, especially for native, but it must consume the same admin contract that a
  plain web console or doctor command can consume.
- **Do not bypass Snapback silently.** Durable data edits should use Snapback
  validators, system fields, versions, changesets, and realtime notification
  paths. Raw engine access is an explicit local-only escape hatch, not the paved
  admin model.
- **Ephemeral is not a table.** The console should inspect ephemeral rooms and
  entries as TTL-bound latest-state runtime data, not as durable CRUD rows.
- **Function runner before code eval.** Running generated queries and mutations
  with explicit args and auth context is useful and safe to reason about.
  Arbitrary JavaScript eval is a different runtime-security feature and should
  not be the default "code runner."
- **Local safe by default.** The local console should be convenient on
  `127.0.0.1` and conservative when bound to non-loopback interfaces. Hosted
  admin access must require real authorization before it is enabled. (The v0
  `/admin/*` aliases initially shipped ungated on every bind, violating this
  principle; LLP 0032 S0 closed that on 2026-07-01 — all admin writes now
  share the token/loopback gate — and full alias retirement is
  [LLP 0031](./0031-server-route-taxonomy.spec.md).)

## Serving Model

The Snapback server should serve both:

- a machine-readable admin API; and
- the packaged web admin console, mounted under a Snapback-owned route.

The proposed reserved namespace is:

```text
/_snapback/
  admin/          web admin console
  api/...         admin and runtime-state API
  assets/...      console static assets, if not embedded
```

Snapback reserves `/_snapback/*` as the long-term namespace for system routes. A
reserved prefix avoids collisions with application routes and makes it obvious
which requests carry system privileges.

> **v0-alias retirement completed (2026-07-01).** This RFC originally let the
> root `/admin/schema`, `/admin/functions`, `/admin/reset`, and `/admin/seed`
> aliases "continue as v0 aliases." That migration is now finished:
> [LLP 0031](./0031-server-route-taxonomy.spec.md) draws and tests the
> app-data/system boundary, and LLP 0032 S1 implemented it — the root aliases
> are retired, their gated twins live under `/_snapback/api/{schema/load,
> functions/load, app/reset}` (seed folded into `app.reset`), and a declared
> route registry with an enforcement test guards the boundary. See LLP 0031 for
> the full classification.

The default local behavior should not require Node, Vite, Exact, or a browser
toolchain. A built Snapback binary should be able to start the local server and
serve a working admin console from packaged static assets. There are two
reasonable implementation stages:

1. During early development, serve static files from a checked-in or generated
   `admin/dist` path when present, and keep the JSON API available even when the
   bundle is missing.
2. Before public release, embed the built web console in the Rust binary or
   install it as a versioned package asset so `snapback` remains a one-command
   local server.

A Vite-like server should exist only as a console-development convenience:

- `snapback` still owns the admin API and runtime state;
- the admin web UI may be served by Vite for hot module reload;
- the Snapback server may proxy `/_snapback/admin/*` to that dev server, or the
  dev UI may call the Snapback admin API directly with an explicit local admin
  token;
- production or ordinary local inspection must work without starting Vite.

The concrete dev-serve loop is proposed in
[LLP 0023](./0023-admin-console-dev-serve-loop.rfc.md): a Vite `serve` mode that
reuses the production plugin chain and proxies `/_snapback/api/*` to a running
Snapback server, so the dev browser stays same-origin and no Rust change is
needed.

This is especially important for ephemeral state. The v1 ephemeral backend is
process-local memory; a separate UI server cannot truthfully inspect rooms,
subscribers, queue pressure, or pending outbox state unless it calls the
Snapback server anyway.

## Instance home page

The root `/` of a running instance serves one public metadata object — the
instance status: identity/compatibility facts, storage mode (never the on-disk
path — LLP 0031 D3), server bind and uptime, artifact hashes, counts,
capability summary, and links to the system surfaces. What changes per request
is the *rendering*, chosen by content negotiation:

- **Browsers** (`Accept: text/html`) get a branded homepage, left-aligned: the
  Snapback mark and wordmark, the app's own identity when the schema manifest
  declares one (`app.name` / `app.description` / `app.iconUrl` /
  `app.wordmarkUrl`), an emphasized admin-console action, the most important
  public facts as a four-column table (two key/value pairs per row, so the
  list reads as two side-by-side columns), an expandable "More details"
  section carrying the full metadata object, and smaller links to the health
  and inspect JSON endpoints.
- **Machine clients** get the object itself as YAML (`Accept: */*` or any
  YAML type — the default, so `curl /` keeps its long-standing shape), JSON
  (`application/json`), or Markdown (`text/markdown`). A `?format=` query
  parameter overrides the header so the HTML page can link to the machine
  renderings.

The browser rendering has one implementation: **the embedded page**
(`src/server/instance_home.html`). It is a single self-contained file (inline
styles, inline brand SVG, no external assets) rendered by the Rust server, so a
bare binary serves the page with no Exact, Vite, dist directory, or native
surface dependency. That is intentional: `/` is a recovery/status and launch
page, so its most important property is that it always works. The admin
dashboard remains the Contract/Exact dogfooding surface because it has enough
interactive state, privileged API shape, forms, and native-shell value to justify
the extra machinery.

One constraint spans both: **public means public.** Every rendering is a
projection of the same public instance-status object; nothing on the HTML
page may exceed what the YAML/JSON renderings expose. App identity fields are
app-authored input on an open route, so the HTML rendering escapes them.

The app identity lives on the schema manifest (an optional `app` block beside
`appId`) because the manifest is already the app-authored artifact the
instance loads; it flows into public inspect by construction and must contain
only publishable facts.

## Contract/Exact Shape

The admin console can and probably should have a Contract/Exact implementation.
That gives Snapback one UI source that can target web and native, and it
dogfoods the primary Snapback client stack.

However, the admin app is a **system app**, not an ordinary Snapback user app.
It talks to the admin API, not to ordinary app tables through generated
application functions. That avoids a chicken-and-egg dependency where the tool
for fixing schema, functions, or runtime state depends on the same broken schema,
functions, or runtime state.

The native Exact case should use the same admin API. The local Snapback server
cannot "serve" a native app in the same way it serves HTML, but it can provide
connection metadata, capability reports, and later a deep link or QR-style handoff
so a native admin surface connects to the right local instance.

Core Snapback tests must not require Exact to be installed. If Exact is missing,
the Contract/Exact admin surface should report a capability diagnostic, while
the headless API and packaged web console remain testable.

## Static bundling and the native shell

The Contract/Exact console (`admin-ui/`) is **statically built** and served by
the Snapback server from a `dist/` snapshot — there is no runtime Vite/dev
server. The build emits both the web bundle **and**, via Exact's LLP 0268
(single-URL static platform manifests), the native artifacts a native Exact shell
needs: `__exact/platform-manifest.json` plus a per-target static native envelope
(`__exact/native/mac-appkit-hermes/{exact-native.json, startup.js, startup.hbc,
diagnostics.json}`). The Rust server serves the whole snapshot under
`/_snapback/admin/`; data is fetched at runtime from the same origin's
`/_snapback/api/*`. The same dist therefore loads in a plain browser and exposes
a macOS-loadable native envelope — one URL, two surfaces.

The build recipe (proven by dogfooding) has sharp edges worth recording:

- **`exactVitePlugin` is required, with a route registry.** The LLP 0268 static
  exporter runs only inside the route-backed served-app build, which needs an
  `appRouteModules` registry next to the entry (`admin-ui/src/app/routes.ts`). A
  routeless `mount(app)` build (which earlier slices used) never reaches the
  exporter. The registry is a React-free stub (`@exact/router/types`, not the
  `@exact/router` barrel, which would drag React into the prerender SSR); the
  console stays client-rendered.
- **Build through a generated config file.** The preset writes a temporary
  vite config (plugins, workspace aliases, and a `server.fs.allow` spanning
  the Snapback and Exact repos) and builds with `configFile` pointing at it.
  Vite's own `base` stays `/`: native startup/HBC module ids must remain
  app-root-relative, while the browser `index.html` is post-rewritten to the
  `/_snapback/admin/` mount path. The exporter's nested prerender server
  reconstructs its config from scratch
  *unless* the outer build carried a `configFile` — and that reconstruction
  drops `fs.allow`, so the nested dev server, rooted in this repo but loading
  Exact sources from the checkout, denies those reads and fails with
  nondeterministic `Failed to load url … Does the file exist?` on files that
  exist (vite 8 only falls back to a raw fs read for `consumer === 'server'`
  or allowed paths). An earlier revision built inline with
  `configFile: false` because the then-current config-reload path failed to
  load the registry; that guidance is superseded. The entry must still live
  in a subdirectory (`/src/main.ts`), not at the root — a root-level entry
  cannot locate its registry. See `packages/snapback-contract/build-preset.mjs`.
- **The web entry is root-absolute; the native artifacts are document-relative.**
  exactVitePlugin emits the web `<script src="/assets/…">` without basePath
  support, while the native envelope/manifest use `./…`. `build.mjs` post-rewrites
  the web entry and discovery URLs to absolute under `/_snapback/admin/` so the
  one dist is self-consistent at that mount for both the browser and the shell.
- **HBC is optional.** The native startup artifact ships `startup.js` (source)
  always and `startup.hbc` when the Hermes compiler is present (`allowSourceFallback`
  covers the source-only case), so the build does not hard-require Hermes.

What remains unverified is the **actual macOS-shell load**: the emitted envelope
is well-formed and decode-compatible with the loosened host decoder (LLP 0268
made the dev-only fields optional), but loading the served URL in ExactAppMac
against this snapshot has not yet been run end-to-end.

The packaged single-file web console (`src/admin/console.html`, embedded in the
binary) remains the always-works baseline and the fallback the server serves when
no `dist/` is configured. It needs no Exact toolchain, satisfying *Core Snapback
tests must not require Exact*.

## Headless Admin Contract

The admin contract should extend the runtime-state and capability facts from LLP
0012 rather than inventing a parallel schema.

The first contract should cover:

- target profile, server readiness, host, port, process id, and uptime;
- storage engine, SQLite path or hosted target id, in-memory/file-backed status,
  database version, tables, indexes, and schema hash;
- loaded schema and function manifests, bundle hashes, load times, and stale
  artifact diagnostics;
- runtime engine, isolation mode, Ibex/V8 capability, resource-limit enforcement
  status, and known runtime gaps;
- connected clients, active live subscriptions, pending mutations, outbox depth,
  and recent realtime errors;
- ephemeral collections, rooms, entry counts, subscriber counts, value bytes,
  expiry state, rate-limit counters, coalesced updates, and resync count;
- recent diagnostics using the stable diagnostic shape from LLP 0010 and LLP
  0012;
- admin write capabilities and whether they are enabled for the current target.

Many of these facts already exist in LLP 0012's pinned v0 `runtimeState` and
`capabilityManifest` artifacts: storage engine, runtime engine, isolation mode,
resource-limit enforcement, connected clients, active subscriptions, pending
mutations, database version, and schema/bundle hashes with load times. The admin
contract reuses those rather than restating them. The genuinely new facts — host,
port, process id, uptime, outbox depth, the ephemeral-room block keyed to LLP
0013's diagnostics vocabulary, Ibex/V8 capability, stale-artifact diagnostics,
known runtime gaps, and admin-write capability — are additions to those
artifacts, not a parallel schema, in keeping with *No private Exact semantics*.

LLP 0012 pinned its v0 artifact schemas on the same date as this RFC, so the
admin contract must state whether these facts extend the `snapback.v0` artifacts
in place or land under a later `schemaVersion`. Either way they should be reported
through LLP 0012's artifact-kind and version machinery, admin-write capability
should be a `capabilityManifest` field rather than a private admin flag, and
admin-originated edits should carry a stable diagnostic code family under LLP
0012's registry. These field names track LLP 0012's artifact schemas and LLP
0013's ephemeral diagnostics; if those names change, revise this section.

The first implementation can begin with `/inspect` plus narrowly-scoped new
endpoints. Over time, `/_snapback/api/inspect` should become the canonical entry
point and the old route can remain as a compatibility alias.

The shared agent operating endpoint is
`POST /_snapback/api/host-ops`, specified in
[LLP 0024](./0024-agent-operating-surface.spec.md). It is the HTTP projection of
the same host-ops core used by CLI and MCP; admin-console endpoints may call that
core or present narrower UI-oriented views over its artifacts.

## Console Surfaces

The Headless Admin Contract above is the normative list of admin facts; the
surfaces below are an illustrative composition of those facts into views, not a
second source of truth. The admin console should eventually include these
surfaces:

- **Health dashboard:** target, server address, storage engine, database path or
  target id, in-memory status, version, uptime, runtime engine, and capability
  gaps.
- **Schema explorer:** tables, fields, validators, indexes, sync metadata,
  portability flags, system fields, schema hash, and source spans where
  available.
- **Data explorer:** paginated rows, row detail, system fields, filters, sort,
  stable cursors, JSON fields, and links from rows to changes/subscriptions when
  available.
- **Function runner:** generated queries and mutations, args schema, auth or
  impersonation context, required capabilities, output, logs, read/write sets,
  commit version, conflict diagnostics, and runtime errors.
- **Ephemeral inspector:** collections, scopes, rooms, entries, TTLs,
  subscribers, payload sizes, rate limits, queue pressure, coalescing, resyncs,
  and forced cleanup/delete controls.
- **Realtime inspector:** active durable subscriptions, initial snapshots,
  pending deltas, outbox depth, recent delivery errors, and resync requirements.
- **Diagnostics and capabilities:** stable diagnostic objects, capability
  manifest, missing features, version mismatches, stale generated artifacts, and
  suggested next checks.
- **Secrets and configuration status:** the LLP 0036 `config.status` primitive
  per declared entry — set/unset, pool membership, verification state, apply
  state, and which functions are granted the entry — with probe verification,
  and a pointer to the setup wizard for value writes. Names and states only;
  no read-back exists to power anything more.
- **Reset, seed, export, and import:** deterministic local operations useful for
  tests and demo repair.

Auth, assets, cron, notifications, actions, backups, and hosted operations can
add panels when their subsystems land. The console should not invent placeholder
controls that imply those capabilities exist before the capability manifest says
they do.

## Durable Data Exploration and Edits

Read-only exploration is straightforward: the admin API should expose rows
through Snapback's schema-aware storage layer. It should show system fields and
portability metadata, but it should not force the UI to know SQLite or Postgres
physical details.

Writes need stricter policy. The console should support three levels:

1. **Generated function invocation.** The preferred way to change data is to run
   a generated mutation with explicit JSON args and auth/impersonation context.
   This exercises the app's normal invariants.
2. **Direct admin edit.** A privileged dev/ops path may insert, patch, or delete
   rows directly, but it must still go through Snapback validators, system field
   assignment, one-version changesets, conflict or overwrite policy, and durable
   realtime notification. It should be visibly labeled as bypassing app-level
   mutation code. The caller must choose an authorization mode: evaluate the edit
   under an explicit impersonated auth context, or use an explicit admin bypass
   that is logged and diagnosed as a bypass.
3. **Raw engine access.** Raw SQL may be useful in local development or emergency
   repair, but it is an explicit portability and safety opt-out. It should be
   disabled by default, local-only unless a future hosted policy allows it, and
   excluded from the first Contract/Exact admin surface.

Direct admin edits should produce diagnostics or audit events that say they were
admin-originated and whether ordinary permissions were evaluated or explicitly
bypassed. Hosted targets will need a real audit log before enabling this for
production data.

## Ephemeral Inspector

The ephemeral admin surface should inspect runtime rooms, not durable tables.
For each collection and room, it should show:

- collection definition, scope, routing key, key mode, TTL, payload limit, and
  auth summary;
- active entries with key, owner, value size, expiry, `scopeEpoch`, and
  `entryVersion`;
- subscriber count and connection ids where safe to show;
- publish/reject/rate-limit/coalescing/resync counters;
- queue pressure and last epoch-change reason;
- target adapter: local memory, Redis-compatible, Durable Object, or missing.

Useful controls include cleanup expired entries, force room resync, delete an
entry, disconnect a connection, and simulate a publish in local/dev mode. Those
controls mutate live runtime state, even when they do not touch durable storage,
so they belong to the same privileged-write class as direct data edits.

The console must not offer durable export/import, offline retention, history,
audit, or table-like CRUD for ephemeral state. Restart clears the local memory
adapter, and the UI should make that obvious.

## Function Runner and Code Runner

The first "code runner" should be a generated-function runner:

- choose a generated query or mutation;
- inspect its args validator, kind, required capabilities, syncability class,
  auth requirement, read-set summary, and write-set summary when known;
- provide args and an auth/impersonation context;
- run it through the same invocation path as generated clients;
- show output, logs, diagnostics, affected rows, commit version, and runtime
  timing.

This directly supports the agent contract from LLP 0010 and the runtime-state
contract from LLP 0012. It is also the antidote to the Valet failure class in LLP
0006 where a query's declared namespace did not match the table its handler
actually read, so rows sat in the database and never reached the UI with no
error: showing the read-set and write-set beside each run makes that mismatch
visible.

An arbitrary JavaScript console is deliberately out of scope for the paved path.
It would need the full LLP 0009 runtime sandbox, capability, timeout, secret, and
database-isolation policy. A future local-only runtime probe may be useful for
engine conformance tests, but it should not be confused with the admin function
runner.

## Security Defaults

The admin surface is privileged. It can reveal database paths, schemas, runtime
state, diagnostics, and eventually data and mutation controls.

Local defaults:

- serving the console on loopback is allowed by default;
- when the server binds a non-loopback host such as `0.0.0.0`, the admin console
  should either be disabled by default or require an explicit admin token;
- write operations should require an admin token or equivalent local capability
  even when read-only health is public on loopback;
- destructive or whole-dataset controls such as reset, seed, import, export, raw
  SQL, connection disconnect, forced ephemeral resync, and simulated publish
  should require the same explicit local capability;
- browser write requests should have origin and CSRF protections appropriate to
  local development;
- secrets and secret-like diagnostics must be redacted.

Hosted defaults:

- admin is disabled until hosted auth and authorization policy exist;
- every admin request must be scoped to an app/project and actor;
- data writes, raw SQL, export/import, reset/seed, function invocation with
  impersonation, ephemeral mutating controls, and secret or auth inspection
  require explicit admin permissions;
- diagnostics must not leak another tenant's code, data, logs, paths, or
  secrets.

The local console must not be used as evidence that Snapback is ready to host
untrusted multi-tenant admin traffic. That remains gated by LLP 0009 and the
future hosted control-plane design.

## Implementation Sketch

The first slice can be deliberately small:

1. Reserve `/_snapback/*` and add aliases for existing health/inspect/admin
   endpoints.
2. Extend inspect state with server host, port, storage mode, database path or
   target id, loaded times, and admin capability flags.
3. Serve a static read-only web console from the same Rust server when assets are
   present; expose a clear diagnostic when the console bundle is missing.
4. Add a development proxy option for console UI work, with the Snapback server
   still owning the admin API.
5. Build the health, schema, function, capability, diagnostic, and ephemeral
   summary views.
6. Add a read-only table explorer over Snapback's schema-aware storage layer.
7. Add the generated-function runner.
8. Add direct admin row edits only after the storage layer can commit them as
   normal Snapback changesets with validation and live notification.
9. Add the Contract/Exact/native surface as a consumer of the same admin API,
   with a capability diagnostic when Exact is unavailable.

This sequence keeps admin useful before it becomes risky.

## Implementation status

A first slice of this RFC is implemented on the canonical local target
([LLP 0002](./0002-canonical-local-target.decision.md)) and landed with this
revision. It is deliberately the read-heavy, low-risk core — admin is useful
before it is risky — and it stops short of the privileged-write surfaces.

Landed (steps 1–7 of the sketch):

- the reserved `/_snapback/*` namespace, served by the same Rust server beside
  the v0 routes as aliases (`src/server.rs`, `src/admin.rs`);
- the packaged web console: a single self-contained file embedded in the binary
  and served at `/_snapback/admin`, with no Vite, Node, or browser toolchain
  (`src/admin/console.html`);
- `/_snapback/api/inspect`, which extends the existing inspect state **in place**
  with a `server` block (host, port, loopback, pid, uptime, storage mode) and an
  `admin` capability block, rather than forking a parallel schema;
- a read-only, schema-aware data explorer (`/_snapback/api/data/{table}`);
- a generated-function runner (`/_snapback/api/functions/{name}/run`) that uses
  the normal invocation path and reports the declared read-set and write-set,
  timing, and inline diagnostics — the visible answer to the Valet
  silent-namespace failure;
- the *Security Defaults* model as a pure, unit-tested policy: loopback reads
  open, loopback writes token-gated once `SNAPBACK_ADMIN_TOKEN` is set, and a
  non-loopback bind disabled without a valid token;
- the one safe ephemeral control: token-gated cleanup of expired entries.

Reported as honest capability gaps in the `admin` block, not as placeholder
controls: direct admin row edits, raw SQL, and the remaining ephemeral mutating
controls (force resync, delete entry, disconnect, simulated publish). The
cross-document `schemaVersion` reconciliation with
[LLP 0012](./0012-headless-integration-contract.spec.md) (see *Open Questions*)
is unresolved; the `server`/`admin` blocks extend the inspect payload in place
pending that decision.

A **Contract/Exact console** also landed (`admin-ui/`): a statically built
Contract app served by the same Rust server from a `dist/` snapshot (see *Static
bundling and the native shell*), rendering the server/storage/runtime facts,
capability gaps, schema, functions with read/write sets, ephemeral counters, and
diagnostics from `/_snapback/api/inspect`. It is the richer UI; the embedded
single-file console is the baseline and fallback. The two do not yet share one
admin client package (the Contract app has its own `AdminClient`, the embedded
console its own inline fetch) — consolidating them is follow-on work.

On 2026-06-27 the Contract console was **rebuilt from scratch** as an app-shell
layout — a fixed sidebar (the Snapback toggle mark, navigation, light/dark
switch) beside a scrolling content pane — and now meets or exceeds the embedded
console (see [diary 0005](../diaries/0005-admin-console-redesign.diary.md)). It
adds a dedicated **Capabilities** surface (the full `capabilityManifest`:
engines, feature flags, supported query forms, resource limits, gaps), a richer
**Realtime** surface (durable subscriptions, live-delivery stats, the complete
ephemeral counter set), the function runner's **captured** read/write sets
(`captured_reads`/`captured_writes`, not just the declared sets), and clears
three deferrals from the prior parity work: **dark mode** (hand-tuned light/dark
palettes, no `@exact/facet-contract`), a **multi-line args** input (the DSL
`multiline` prop), and the token-gated **ephemeral cleanup** control wired into
the UI. It deliberately still shows only what the `admin` capability block
reports — no placeholder controls — so direct edits, raw SQL, and the remaining
ephemeral mutating controls stay absent until the API exposes them.

One renderer finding worth recording — since corrected: the console observed
content **published into a boundary after first paint** collapsing (bare flex
rows to height 0, tall multi-line text overflowing), while the same markup
measured correctly on initial render. Diary 0005 diagnosed it as the Exact
layout kernel under-measuring;
[LLP 0023](./0023-admin-console-dev-serve-loop.rfc.md) corrected the diagnosis
— a `flex-shrink` default mismatch in the `dom-mirror` web host, not a
measurement bug — fixed upstream in Exact ENG-22199 (resize manifestation
verified under ENG-22214). The console's workarounds (explicit `minHeight` on
dynamic rows, fixed-height `scroll` blocks for code/JSON output) predate that
fix and can be retired when convenient.

On 2026-07-02 both consoles gained a **Secrets** surface over the LLP 0036
config ops (ENG-22598): stat tiles (declared / set / missing required /
verified), per-entry status cards with a probe **Verify** control, "used by"
badges joined from each function's `uses` grants, and a link to the setup
wizard, which stays the only place values are written. The Contract console
also raises a `config: N required missing` badge in the status strip and shows
per-function config grants in the Functions detail. Both render names and
states only — the view model never carries a value.

## Validation Requirements

Before this RFC moves beyond Draft, acceptance should prove:

- a fresh local `snapback` process serves `/_snapback/admin/` and
  `/_snapback/api/inspect` from the same server without Vite;
- the admin dashboard reports host, port, target profile, storage mode, SQLite
  path or in-memory status, database version, runtime engine, and capability
  gaps;
- starting a console-development server is optional and does not move admin API
  authority out of Snapback;
- binding to a non-loopback address disables admin or requires an explicit admin
  token;
- the data explorer reads rows through schema-aware Snapback storage, not raw
  SQLite assumptions;
- direct admin edits, once implemented, create ordinary Snapback changesets,
  notify live subscriptions, and report whether permissions were evaluated under
  an impersonated context or explicitly bypassed;
- the function runner invokes generated queries and mutations through the normal
  invocation path and surfaces diagnostics;
- the ephemeral inspector shows rooms, TTLs, entries, subscribers, rate limits,
  coalescing, and resync counters without writing to the durable database;
- ephemeral cleanup, forced resync, entry delete, disconnect, and simulated
  publish controls require the same admin-write capability as durable admin
  writes;
- a missing Exact/Contract toolchain is reported as a capability diagnostic and
  does not break core admin API tests;
- a Contract/Exact admin surface and the packaged web console consume the same
  admin contract for at least health, schema, functions, diagnostics, and
  capabilities;
- no admin UI path depends on hidden backend state unavailable to CLI or agents.

## Alternatives Considered

### Required separate Vite server

A Vite-style server is excellent for admin UI development, but it is the wrong
runtime requirement. It adds another process to orchestrate, cannot own
in-process runtime and ephemeral state, and would make basic inspection depend
on a JavaScript toolchain. Keep it optional.

### Ordinary Snapback app

Building the admin console as a normal Snapback app is attractive, but it creates
a bootstrap problem: the tool for repairing schema, functions, capabilities, and
runtime errors would depend on those same app-level mechanisms being healthy.
Treat the console as a system app over a privileged admin API.

### CLI-only admin

CLI and doctor commands are required, but they are not enough. Table browsing,
function invocation, ephemeral room inspection, live subscriptions, and
diagnostics benefit from an interactive UI. The answer is shared headless data
with multiple surfaces, not UI-only state.

### Raw SQLite browser

A SQLite browser is useful during bring-up but breaks the SQLite-to-Postgres
portability story and bypasses Snapback validators, system fields, versions,
changesets, permissions, and realtime delivery. It can remain a local escape
hatch; it should not be the admin console's model.

### Hosted control plane first

A hosted control plane will need its own design, but local development already
needs the inspection surface. The local console should be the foundation, with
hosted admin becoming an authorized deployment of the same headless contract
where possible.

## Open Questions

- The packaged plain web console is the required baseline (core admin tests must
  not require Exact; it must serve without Vite) and **both surfaces now exist**:
  the embedded single-file console is the baseline/fallback, and a statically
  built Contract/Exact console is the richer UI served from a `dist/` snapshot
  (*Static bundling and the native shell*). The remaining open items are narrower:
  (a) ~~the two do not yet **share one admin client package**~~ — **resolved
  2026-07-02 (LLP 0032 P8):** `@snapback/admin-client` is the one client; the
  Contract admin-ui imports the workspace package and the embedded console
  imports the byte-identical module the server serves at
  `/_snapback/admin/client.mjs` (embedded via `include_str!`, so the
  bootstrap property holds with no dist and no build step; test
  `p8_both_consoles_consume_the_one_embedded_admin_client`). The same pass
  normalized the inspect payload to camelCase end to end (aliases keep old
  spellings parsing; the embedded v0 artifacts keep their LLP 0012-pinned
  shapes), committed typed schemas for both payloads
  (`schemas/inspect.admin.schema.json`, `schemas/inspect.public.schema.json`,
  drift-gated per LLP 0037), and pinned casing with
  `tests/inspect_casing_v0.rs`; and (b) whether the
  **native macOS shell** actually renders the static snapshot end-to-end (the
  artifacts now emit; loading them in ExactAppMac is the open verification —
  currently also blocked upstream at Exact HEAD, ENG-22578).
- Should the packaged web console be embedded into the Rust binary from the
  start, or served from an installed asset directory until release packaging is
  settled?
- What is the exact local admin token lifecycle: generated per process, stored
  under `.snapback/`, printed once, or disabled unless a write operation is
  requested?
- Which existing v0 routes should become permanent aliases, and which should
  move entirely under `/_snapback/api/`?
- Should read-only table browsing be allowed on hosted production data before
  row-level admin authorization is fully specified?
- What audit-log substrate records direct admin edits before the broader hosted
  control-plane design exists?
- How much raw SQL access, if any, should be exposed in local development?
- The canonical admin contract should extend LLP 0012's pinned `runtimeState`
  and `capabilityManifest` rather than fork a parallel schema, per *No private
  Exact semantics*. The narrower open question: do the admin-only additions
  (host/port/uptime, the ephemeral block, admin-write capability, direct-edit and
  raw-SQL gating) extend the `snapback.v0` artifacts in place or land under a
  later `schemaVersion`, and does any admin-only subset belong in a separately
  versioned admin artifact instead of the shared one?

## Status

Draft. The first slice (see *Implementation status*) is implemented and
validated on the local target: the same Snapback server serves the admin API and
the packaged web console, with Vite-like tooling only an optional development
convenience. The RFC stays Draft because the broader design is still open — the
privileged-write surfaces (direct edits, raw SQL, the remaining ephemeral
controls), the Contract/Exact admin surface, the local admin-token lifecycle,
and the cross-document `schemaVersion` reconciliation with LLP 0012 are not yet
settled. Promotion past Draft is the ratifying source's call.
