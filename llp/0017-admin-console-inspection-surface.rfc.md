# LLP 0017: Admin console and inspection surface

**Type:** RFC
**Status:** Accepted
**Systems:** Developer experience, Runtime, Storage, Realtime, Security, Client integration, Contract/Exact, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-26
**Revised (published console closure):** 2026-08-10 (each published platform
runtime now carries a closed, build-matched Contract/Exact snapshot; the CLI
selects it automatically, the runtime package seal binds every console byte,
and publication plus post-publish smoke refuse a missing, dirty, mismatched, or
non-serving snapshot.)
**Revised:** 2026-08-10 (fresh master admin tokens remain visible on interactive stdout only; captured stdout receives the owner-only file pointer or an explicit restart/configuration recovery).
**Revised:** 2026-08-03 (implemented the reviewed claim-link reachability affordances end to end: exact registered-origin leases, terminal QR, receipt-owned path-scoped tailscaled serve publication, the sole-parser ephemeral LAN relay and ruled-cleartext warning, claim-to-credential fail-closed observation, and backend-bound tab storage, with fake-daemon lifecycle, hostile-framing, hard-kill, and real-interface planted-link proofs). Same day: (designed the claim link's reachability affordances — `--qr` terminal QR rendering, `--tailscale` publication through tailscaled's serve proxy path-scoped to `/_snapback` with receipt-owned mapping lifecycle, and `--lan` as an ephemeral CLI-hosted relay: lifetime-scoped master-registered origin admission, sole-parser anti-smuggling discipline, console-slice-only forwarding that categorically excludes the master-exchange path, a fail-closed server-issued lease, tab-scoped reachability-session credential storage, and an explicit ruled-cleartext LAN transport posture with mandatory warning; revised same day after a dual-family delta round — both families NOT READY on the initial affordances text (origin/CSRF contract, LAN transport confidentiality, whole-namespace exposure, tailscale crash cleanup, parser discipline, relay-lifetime observation, storage-on-reusable-origins) — this text incorporates those fixes and is itself review-unreviewed). Same day: (implemented the one-time operator claim link end to end: bounded process-ephemeral digest-only claims, atomic single-winner exchange, provenance-capped renewal, durable digest-only redemption/status/revocation binding, attached/default and reattach CLI observation, console fragment exchange, loopback/hosted refusal, and planted-link acceptance proof). Same day: (designed the one-time operator claim link — `snapback admin link` mints a single-use thirty-minute process-ephemeral claim code redeemed from a `#claim=` URL, loopback-only, for one `sbcc_` credential with distinct provenance that slides within a ninety-minute absolute cap, a master-readable redemption record, and master revocation; the thirty/ninety windows are an author ruling widening the review round's five-minute/non-renewable-ten-minute bounds for parallel long-running sessions; added the "only ephemeral authority transits the human" design principle complementing LLP 0150, with the 401 master-paste prompt named as the acknowledged pre-existing exception; revised same day after a dual-family delta review round — both families NOT READY on the initial amendment (non-loopback contradiction, notification underspecification, renewal inheritance) — this text incorporates those fixes and is itself review-unreviewed). Same day: (`snapback admin` performs trusted ready-file discovery and hands only a derived `sbcc_` credential to the browser in a URL fragment; active dev/loopback credentials slide within an eight-hour cap and digest-only state reattaches beside file-backed databases; a short-TTL, rate-limited, single-use RFC-8628-shaped terminal approval flow covers remote browsers).
**Revised:** 2026-08-02 (0137 G1 follow-on: descriptor-scoped `P.secret-read-root` custody now retains an open handle to the adopted inode until teardown, preventing immediate inode-number reuse from making an identity-only guard delete a foreign replacement). 2026-08-01 (0137 G1: the `P.secret-read-root` sibling is descriptor-scoped custody — the serve process removes it identity-guarded with the ready descriptor at shutdown/teardown instead of orphaning it; the database-scoped `<db>.admin-token` reattach custody is unchanged). 2026-07-15 (the instance home now discovers the build-bound Snapback Guide for humans and its one-request flat projection for agent clients in every negotiated rendering). 2026-07-13 (ENG-24595: browsers exchange the master admin token for a short-lived, non-renewable console credential and never persist the master; config status exposes only closed verification state; the browser runner no longer manufactures app identity; earlier: ENG-24338 review follow-up: the readiness descriptor itself is atomically published owner-only at 0600, and CLI URL/token resolution uses one validated descriptor snapshot; ENG-24359 review follow-up: filesystem static assets are opened by a root-directory capability plus component-relative no-follow handles and read from the verified final descriptor; platforms without that primitive fail closed instead of retaining a canonicalize/read race; ENG-24338/ENG-24346/ENG-24359: trusted token discovery, owner-only no-follow capability files, and canonical static-asset containment; earlier: 2026-07-04 admin serving now has a single UI implementation: the Contract/Exact `admin-ui/dist` snapshot. The server auto-discovers a built repo-local dist when `SNAPBACK_ADMIN_DIST` is unset; if no dist is available, `/_snapback/admin` returns a missing-dist diagnostic instead of the deleted handwritten fallback console. Earlier: 2026-07-03 instance home is embedded-only again: the short-lived `home-ui/` Contract surface, `SNAPBACK_HOME_DIST`, and `/_snapback/home/*` lane were removed because `/` is a recovery/status page whose value is zero-toolchain reliability, while the admin dashboard remains the useful Contract/Exact dogfooding surface. Earlier: 2026-07-02 instance home briefly gained a Contract surface and shared-build-preset notes; this revision supersedes that slice. Earlier same day: added §Instance home page: the root `/` is now content-negotiated — a branded, embedded HTML homepage for browsers over the same public metadata object served as YAML/JSON/Markdown; app identity comes from the schema manifest's optional `app` block. Earlier same day: ENG-22598: Secrets surface was added to the then-existing admin consoles over the LLP 0036 config ops. Earlier: 2026-07-01 status → Accepted, ratified in the LLP 0032 R1 batch: the console and admin API shipped per this RFC, hosted access still future; LLP 0032 R3: layout-kernel diagnosis corrected per LLP 0023/ENG-22199; "local safe by default" annotated with the S0 root-alias gating; LLP 0032 S1: v0-alias retirement completed per LLP 0031)
**Related:** LLP 0000, LLP 0002, LLP 0003, LLP 0004, LLP 0005, LLP 0006, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0014, LLP 0015, LLP 0016, LLP 0024, LLP 0036, LLP 0150

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
- **Only ephemeral authority transits the human.** Complementing LLP 0150's
  invariant that durable bearer secrets never transit the human: in any new
  handoff flow, an admin credential a person is asked to carry, click, paste,
  or read aloud must be derived, short-lived, and ideally single-use, while
  the master `sbat_` token and other durable roots move only between trusted
  machine custodians (0600 files, trusted descriptors, process memory). The
  one acknowledged pre-existing exception is the console's 401 recovery
  prompt, where a person pastes the printed master token once; that path
  predates this principle, exists as a recovery hatch, and is exactly what
  the derived-credential flows are meant to obsolete in ordinary use. New
  flows are judged against this rule.
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
  and inspect JSON endpoints. A discovery note links humans to the build-bound
  Snapback Guide and agent clients to its complete one-request flat projection.
- **Machine clients** get the object itself as YAML (`Accept: */*` or any
  YAML type — the default, so `curl /` keeps its long-standing shape), JSON
  (`application/json`), or Markdown (`text/markdown`). A `?format=` query
  parameter overrides the header so the HTML page can link to the machine
  renderings. The shared public status object's `links` projection includes
  both the guide index and flat-guide URLs, so non-browser clients receive the
  same discovery information.

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
The public projection never includes the minted admin-token file path, raw cron
run records/results, or diagnostic messages/details. Cron is reduced to
aggregate job/failure/in-flight counts and diagnostics to code, severity, and
subsystem; full operational records remain available only through authenticated
admin inspect (ENG-24560).

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

For published installs, `admin-ui/build.mjs` closes that dist with a manifest
containing its source revision, clean/dirty fact, member byte counts and
digests, and a closure digest. Each platform runtime package carries the same
snapshot at `admin/`; its runtime-readiness seal binds every console member
beside the binary and Hermes artifacts. `@expo/snapback-cli` validates the
snapshot against the runtime receipt and supplies its path to the server.
Because the binary's embedded Guide, the runtime qualification, and the
console manifest all bind one source revision, an installed product cannot
silently combine a current server with an ambient or stale console.

Filesystem serving treats the configured dist as a directory capability, not
as a string prefix. On Unix the server resolves that root once, opens it through
no-follow directory descriptors, walks every request component with relative
`openat` + `O_NOFOLLOW`, requires the final opened object to be a regular file,
and reads from that same descriptor. A rename/symlink swap can therefore yield a
safe old/new in-root object or an error, never redirect the later read outside
the capability. A platform without an equivalent no-reparse-point,
handle-relative walk fails closed for filesystem-backed console assets; it does
not fall back to canonicalize-then-read. The headless admin API and embedded
setup/client assets remain available there (ENG-24359).

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
  Because that generated file is already executable ESM, the outer build uses
  Vite's `configLoader: 'native'`: the default bundle loader executes the
  plugin graph from an immediately deleted `vite.config.mjs.timestamp-*`
  module, and Bun/Rolldown can expose that transient path to Exact's nested
  prerender server, which then correctly but uselessly refuses that the module
  is gone. Native loading keeps the stable generated path as the reopenable
  authority for the complete callback lifetime.
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

Published CLI installs select the sealed runtime-package snapshot automatically;
consumers neither set `SNAPBACK_ADMIN_DIST` nor need a source checkout. A source
runtime still auto-discovers repo-local `admin-ui/dist` when it has already been
built, and contributors may use `SNAPBACK_ADMIN_DIST` to pin a specific test
snapshot. The handwritten single-file console has been removed. If a source
runtime has no built dist, `/_snapback/admin` returns a contributor-specific
missing-dist diagnostic while the headless admin API remains available. This
keeps core Snapback tests independent of Exact while avoiding two admin UI
implementations or teaching package consumers to build repository assets.

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
- provide args; the browser runner is an anonymous administrative bypass and
  never manufactures app identity. Hosted identity is resolved by the auth
  gate, while any future developer impersonation requires its own explicit
  non-browser capability;
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
- the full `/_snapback/api/inspect` projection is a sensitive read because it
  carries raw handler-controlled diagnostics/results, source, and local paths;
  whenever an admin token is configured or auto-minted it requires that bearer.
  Anonymous loopback clients use root `/inspect`, which is a typed redacted
  projection. A fresh console renders a text-only token prompt on 401 and sends
  the submitted master token once to
  `POST /_snapback/api/console/credential`. That response is `no-store` and
  carries a derived console credential with a ten-minute expiry. The
  server retains only its SHA-256 digest. On file-backed targets the digest,
  original issue time, sliding expiry, and absolute expiry are atomically
  persisted owner-only at `<db>.console-credentials`; the raw credential and
  master token are never written there. Valid entries reattach after a server
  restart. The shared client may persist the derived credential plus its expiry under
  `snapback_console_credential_v1`, removes it when stale, and sends it only as
  `x-snapback-console-credential`; the master never enters `localStorage`,
  `sessionStorage`, or IndexedDB. `snapback admin --ready-file P` validates the
  descriptor against the live startup nonce, reads the owner-only token path
  admitted by that trusted descriptor, exchanges the master in the CLI, and
  opens `/_snapback/admin/` with only `sbcc_` plus its expiry in the URL
  fragment; the page removes the fragment before boot and stores the derived
  record through the same client path. `--no-open` explicitly prints that
  fragment URL for headless handoff. A URL-only target never selects a local
  file and requires an explicit token.

  An active derived credential may renew itself only on a loopback local
  target in the `dev` profile and dev auth policy. Renewal slides the ten-minute
  expiry but never moves the absolute eight-hour deadline established at first
  mint; expired credentials and other profiles cannot renew. A derived console
  credential otherwise satisfies only ordinary `AdminRead`/`AdminWrite`: it
  cannot satisfy `AdminSecretRead` or mint/use impersonation authority.

  A browser that cannot share the terminal filesystem may request a
  RFC-8628-shaped device approval. The console displays an eight-hex-digit user
  code; `snapback admin approve <code> --ready-file P` proves master-token
  access in the terminal, and polling releases one newly derived credential to
  that browser. Device requests expire after ten minutes, approval and delivery
  are each single-use, invalid/expired/consumed codes share one refusal, and
  creation, approval attempts, polling, and total pending state are rate/cap
  bounded. Request and poll grant no admin authority by themselves. This flow,
  initial minting, and renewal all refuse non-loopback and hosted targets.

  The reverse handoff — terminal to browser — is the **one-time operator claim
  link** (implemented). It serves the remote-development posture
  where the master-holding terminal is a cloud machine (often driven by an
  agent session) and the human's browser cannot share its filesystem, so
  neither fragment handoff nor `snapback admin approve` is convenient.
  `snapback admin link --ready-file P` proves master access the same way
  `snapback admin` does, then asks the server to mint a **claim code**: a
  single-use, unguessable code with a thirty-minute expiry, held server-side
  only as a digest in the device-approval registry's process-local state —
  claims are process-ephemeral, and a server restart invalidates unredeemed
  codes. Master-proven claim mints draw on their own pending budget so
  unauthenticated device-approval requests cannot starve them; claim
  creation, claim-exchange attempts, and total pending claims join the
  device flow's enumerated rate/cap-bounded operations. The command prints a
  URL of the form `<console>/#claim=<code>`; `--url-base` substitutes the
  operator's tunnel or reverse-proxy origin for the bind address, since the
  printed host is an operator fact the server cannot know. Opening the link
  exchanges the claim atomically for one newly derived `sbcc_` console
  credential through the ordinary credential path (`no-store`, fragment
  removed before boot, same storage rules); the exchange consumes the code,
  so a concurrent race admits exactly one winner and a second use — or any
  use after expiry — shares the single invalid/expired/consumed refusal.
  A claim-derived credential carries distinct provenance, satisfies only
  ordinary `AdminRead`/`AdminWrite` (never `AdminSecretRead` or
  impersonation), and renews through the ordinary sliding mechanism under a
  **ninety-minute absolute cap** — deliberately far below the eight-hour cap
  of a locally minted credential (author ruling 2026-08-03, widening the
  review round's fixed ten-minute non-renewable bound, which forced constant
  link regeneration across parallel long-running sessions). An actively used
  console session thus lasts up to ninety minutes on one link, while an
  abandoned — or stolen-and-idle — credential still dies ten idle minutes
  after last use, and active theft is bounded by the cap, the redemption
  record, and master revocation. The redemption event is recorded atomically against the claim
  digest — time, direct transport-peer address, and the issued credential's
  digest — for the life of the claim plus the credential, readable only
  through master-bearer status (never by the browser or anonymous loopback),
  and the master may revoke the bound credential immediately. By default
  `snapback admin link` stays attached and reports redemption, expiry, or
  revocation as it observes them; `--no-wait` prints the URL and exits, and a
  later `snapback admin link --status`-style query reattaches to the recorded
  event. The address shown is the direct transport peer — behind the tunnel
  the `--url-base` posture implies, that is the tunnel endpoint, so the
  honest visibility claim is "redeemed at time T", with the peer address
  best-effort; forwarding headers are consulted only for explicitly
  configured trusted proxies and are labeled as such. Because the link is a
  bearer for its thirty-minute unclaimed life, this flow exists precisely
  because it is safe to appear in agent transcripts, scrollback, and chat
  logs *after* redemption — a claimed or expired link is inert, in contrast
  to the master token, which must never enter those channels at all. Like
  initial minting, renewal, and device approval, claim minting and claim
  exchange refuse non-loopback and hosted targets; the remote posture is
  served by a tunnel terminating on loopback plus `--url-base`, not by a
  relaxed bind rule.

  The claim link's **reachability affordances** (implemented)
  make the printed URL loadable where the human actually is — a phone on the
  same Wi-Fi, another device on the operator's tailnet — without changing the
  server's bind. The claim exchange still terminates on loopback, but the
  affordances are honestly a **delegated-ingress** decision, not a no-op: a
  Snapback-owned front makes the exchange reachable by non-loopback clients
  for a bounded lifetime, and every rule below exists to bound that
  delegation. `--url-base`, `--tailscale`, and `--lan` are mutually exclusive
  origin selectors (combining them is a stable usage error); `--qr` composes
  with any of them and renders, byte-identically, the one URL the invocation
  selected as a terminal QR code beside it — pure presentation, no trust
  delta (when the selected origin is plain loopback the CLI notes that the QR
  is only reachable from this machine).

  **The origin contract**, shared by both managed affordances: the server's
  browser-write protection reflects loopback origins only, so a console page
  served from a relay or tailnet origin must be *admitted*, never laundered.
  When an affordance starts, the CLI registers the exact published origin
  with the server over the master-authenticated channel; the server accepts
  it for exactly the affordance's lifetime and drops it at teardown. The
  front forwards `Origin` untouched — it never rewrites Origin or Host to
  loopback, which would disguise arbitrary cross-origin LAN requests as
  local. The relay additionally accepts only its own generated `Host` and,
  for state-changing requests and WebSocket upgrades, an `Origin` that is
  absent or exactly the registered origin.

  `--tailscale` publishes the server through a running tailscaled's `serve`
  proxy — the canonical tunnel-terminating-on-loopback — path-scoped to
  `/_snapback` (the app plane is not published), and prints the tailnet
  HTTPS origin. Exposure is bounded to the operator's tailnet — which may
  include shared or team nodes; tailnet membership is the operator's own
  trust decision — and transport is tailscale-terminated HTTPS. Forwarded
  peer addresses fall under the existing trusted-proxy labeling rule.
  Because created mappings are standing daemon state, ownership is explicit:
  mappings the CLI creates are tagged as Snapback-created and recorded in an
  owner-only reference-counted receipt; concurrent invocations share the
  mapping through the receipt and the last observer out removes it
  (compare-and-delete against what the receipt recorded); an invocation
  never removes a mapping it did not find recorded there, and operator-made
  mappings are never touched. A crash can strand a tagged mapping — the next
  `--tailscale` invocation sweeps stale Snapback-tagged mappings whose
  receipts have no live owner, and that bounded residue window is accepted
  here explicitly. `--tailscale` conflicts with `--no-wait` (cleanup needs
  the attached observation), and a missing or stopped tailscaled is a stable
  refusal, never a silent fallback to a different origin.

  `--lan` makes the attached CLI process itself host an **ephemeral relay**:
  `--lan[=<addr|interface>]` binds the named interface, or with no argument
  binds the single up, non-loopback, non-virtual interface when exactly one
  exists and otherwise refuses with the enumerated candidates; wildcard
  binds are prohibited, and without a TTY ambiguity is refused rather than
  prompted. The relay listens on an ephemeral OS-assigned port — port number
  is not part of the security argument — and serves **plain HTTP: this is an
  explicit threat ruling**, not an omission. On the local network the
  operator chose to bind, transport confidentiality is delegated to that
  network; a passive or active on-link attacker can observe or hijack the
  session for its lifetime. The mint command therefore prints an unmissable
  warning naming the exposure and the compensating controls — single-use
  exchange, ten-minute idle expiry, ninety-minute cap, redemption record,
  master revocation — and names `--tailscale` as the posture for networks
  the operator does not trust. (Ephemeral self-signed TLS was considered and
  rejected for v1: browsers surface it as a scarier interstitial than the
  cleartext it would replace, training exactly the click-through habit this
  surface should not train.)

  The relay is the **sole request parser** on each connection: it parses,
  canonicalizes (origin-form targets only; path normalization before prefix
  matching; ambiguous framing such as conflicting `Content-Length`/
  `Transfer-Encoding`, `CONNECT`, and pipelined follow-on requests are
  refused), strips hop-by-hop and client-supplied forwarding headers, and
  re-serializes toward loopback — never byte-splicing except inside a
  WebSocket upgrade whose canonical path and Origin passed policy before the
  `101`. It forwards only what a claimed console session needs: the console
  shell and assets, the claim exchange, and credential-authenticated
  `/_snapback/api/*` — and it categorically refuses the master console-
  credential exchange and any request carrying the master token header, so
  the master-paste flow and the master itself never ride the relay. Every
  other path gets the stable refusal diagnostic. (The master-exchange
  endpoint also joins the enumerated rate/cap-bounded operations — a
  settled-text amendment this passage carries.)

  Relay lifetime is **fail-closed, not best-effort**: the relay holds a
  short server-issued lease bound to the claim digest and, after redemption,
  the issued credential's digest, renewed over the same master-authenticated
  status channel the attached command already observes. The listener closes
  on revocation, credential or claim expiry, lease-renewal failure, an
  indeterminate status response, a server startup-nonce change, or CLI
  exit — so the maximum exposure after any invalidating event is one lease
  interval, and a relay that loses observation dies rather than lingers.
  Concurrent claims never share or extend one another's relays. Because the
  relay must outlive the mint command, `--lan` conflicts with `--no-wait`.
  The server still sees only loopback peers; the relay, which does know the
  true LAN peer, reports it in the attached observation output labeled as
  relay-observed — CLI-side context, not part of the server's redemption
  record.

  A console session on a relay or tailnet origin also gets **distinct
  storage semantics**: an OS-assigned relay port is a reusable browser
  origin, and a stable tailnet origin can later point at a different
  backend, so the shared client keeps reachability-session credentials in
  tab-scoped `sessionStorage`, keyed to the session and the instance
  identity, and never restores one against a backend that no longer matches;
  when an invocation-owned front terminates early the CLI revokes the bound
  credential, and the client clears its record on observed expiry or
  revocation. The standing-surface comparison still holds, stated honestly:
  a relaxed bind exposes every route indefinitely; a managed front exposes
  the console slice of one namespace, behind an origin contract and a
  fail-closed lease, for at most one claim-plus-credential lifetime, only
  while an operator's terminal deliberately holds it open.

  Operator tooling may
  hand the shared client a derived `AdminSecretRead` lease for an explicit
  inspection session, but the client retains it only in the current JavaScript
  object, sends it only on secret-bearing inspect/scan/runner calls, and never
  writes or restores it through `localStorage`, `sessionStorage`, IndexedDB, or
  another persistence adapter. A serve process started with `--ready-file P`
  creates an owner-only mechanical sibling `P.secret-read-root`; the root never
  enters an HTTP request or descriptor. The root is descriptor-scoped custody:
  the serve process pins the adopted inode with an open handle and removes it
  identity-guarded (alongside the impersonation sidecar) when the ready
  descriptor is torn down. The live handle prevents immediate inode-number
  reuse from making a foreign replacement compare equal, so no `P.*` sidecar
  survives a clean shutdown — unlike the database-scoped reattach family
  (`<db>.admin-token`), which persists by design (0137 G1). A later serve on
  the same ready path simply mints a fresh root. `snapback secret-read-mint --ready-file
  P` verifies that the live `/health` startup nonce still matches the trusted
  descriptor before reading that root or attaching the master admin credential,
  then sends a fresh one-shot HMAC proof bound to the exact finite scopes, TTL,
  and row/byte budgets. The response contains only the derived `sbrl_` lease and
  is `no-store`. A URL alone can never select this operation. A serve process
  without a ready file deliberately has no mint bridge; the staged-mode gate
  must therefore refuse session activation in that posture rather than enable
  an instance whose protected inspection lane no operator can enter. The
  console retries
  boot without ever placing server error text into HTML
  (ENG-24560/ENG-24568/ENG-24595);
- when the server binds a non-loopback host such as `0.0.0.0`, the admin console
  should either be disabled by default or require an explicit admin token;
- write operations should require an admin token or equivalent local capability
  even when read-only health is public on loopback;
- when no `SNAPBACK_ADMIN_TOKEN` is configured, the serve path **auto-mints**
  that local capability rather than leaving loopback writes open (ENG-23443):
  the reflected localhost CORS (any `http(s)://127.0.0.1|localhost|[::1]:*`
  origin) would otherwise let any local web page drive admin writes. The
  minted token persists 0600 next to the SQLite database (or the ready file
  for in-memory instances, or per-process when there is neither), is printed
  on the start that minted it only when stdout is an interactive terminal, and
  is discoverable by same-user tooling
  through a trusted local readiness descriptor's `adminTokenFile` — reading
  the mechanically-derived 0600 sibling file *is* the local-admin capability
  (LLP 0036 D3), and a browser page cannot read files. Captured stdout instead
  names that owner-only file without printing the token; a memory-only start
  with no file names the safe TTY restart or explicit `SNAPBACK_ADMIN_TOKEN`
  recovery. A CLI targeting an
  arbitrary `--url` never reads a path returned by that network peer; inspect's
  `admin.tokenFile` is an operator fact, not a token-discovery instruction
  (ENG-24338). Existing capability files are opened without following links,
  must be regular and owned by the service identity, and are repaired to 0600
  before reuse. Hosts without an implemented owner/ACL validation backend
  fail closed for persistent minted-token I/O; on Windows today an operator
  must supply `SNAPBACK_ADMIN_TOKEN` until the ACL backend lands (ENG-24346).
  Non-loopback binds do
  not mint: admin there stays disabled until an operator sets an explicit
  token. Embedded in-process routers (`server::router`,
  `AppState::detached`) keep the loopback-open default — they are not
  HTTP-served;
- destructive or whole-dataset controls such as reset, seed, import, export, raw
  SQL, connection disconnect, forced ephemeral resync, and simulated publish
  should require the same explicit local capability;
- browser write requests should have origin and CSRF protections appropriate to
  local development;
- secrets and secret-like diagnostics must be redacted. In particular,
  `config.status` and successful `config.verify` responses expose verification
  only as the closed `{ok, atMs}` projection; handler-controlled probe messages
  remain in operator-local state and cannot cross that `AdminRead` response.

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
- the admin shell route at `/_snapback/admin`, which serves the built
  Contract/Exact dist when available and otherwise reports
  `SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING`;
- `/_snapback/api/inspect`, which extends the existing inspect state **in place**
  with a `server` block (host, port, loopback, pid, uptime, storage mode) and an
  `admin` capability block, rather than forking a parallel schema;
- a read-only, schema-aware data explorer (`/_snapback/api/data/{table}`);
- a generated-function runner (`/_snapback/api/functions/{name}/run`) that uses
  the normal invocation path and reports the declared read-set and write-set,
  timing, and inline diagnostics — the visible answer to the Valet
  silent-namespace failure;
- the *Security Defaults* model as a pure, unit-tested policy: ordinary
  loopback reads open, sensitive full inspect and loopback writes token-gated
  once `SNAPBACK_ADMIN_TOKEN` is set, and a
  non-loopback bind disabled without a valid token; since ENG-23443 the serve
  path always resolves a token on loopback — auto-minting one
  (`resolve_serve_admin_token`, persisted 0600, surfaced via startup output,
  `adminTokenFile` in a trusted readiness descriptor, with `admin.tokenFile`
  retained only in bearer-authenticated full inspect) whenever `SNAPBACK_ADMIN_TOKEN` is unset
  — so no HTTP-served
  instance accepts tokenless admin writes;
- `snapback admin`, fragment-only browser handoff, restart-stable digest-only
  console credentials, capped dev-only sliding renewal, the bounded terminal
  approval flow, and the one-time operator claim link plus its QR, tailnet,
  and ephemeral LAN reachability affordances described in *Security Defaults*;
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
diagnostics from `/_snapback/api/inspect`. It is now the only admin dashboard UI.
The server still exposes the shared admin client module at
`/_snapback/admin/client.mjs` for tooling.

The admin dependency graph is part of the production security boundary
(ENG-24575). `scripts/verify-local-proof` runs `bun audit --production` after
the locked install/build/tests, so CI cannot silently drop the gate. The
published Exact devtools chain currently declares Undici 5.x, whose maintained
line remains vulnerable; the lock therefore overrides it to audited Undici
6.27.0. The required dev-serve module-graph smoke starts the actual Exact/Vite
server path and is the compatibility proof for that temporary out-of-range
transitive override until the upstream chain moves to Connect 2.x.

On 2026-06-27 the Contract console was **rebuilt from scratch** as an app-shell
layout — a fixed sidebar (the Snapback toggle mark, navigation, light/dark
switch) beside a scrolling content pane — after initially being compared against
the now-deleted embedded console (see
[diary 0005](../diaries/0005-admin-console-redesign.diary.md)). It
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

On 2026-07-02 the admin console gained a **Secrets** surface over the LLP 0036
config ops (ENG-22598): stat tiles (declared / set / missing required /
verified), per-entry status cards with a probe **Verify** control, "used by"
badges joined from each function's `uses` grants, and a link to the setup
wizard, which stays the only place values are written. The console raises a
`config: N required missing` badge in the status strip and shows per-function
config grants in the Functions detail. It renders names and states only — the
view model never carries a value.

## Validation Requirements

The accepted local contract must keep the following acceptance proofs green:

- a prepared local `snapback` process serves the built Contract/Exact
  `/_snapback/admin/` and `/_snapback/api/inspect` from the same server without
  Vite;
- an exact-version install outside the checkout carries a clean console
  snapshot matching the runtime/Guide revision and serves its sealed
  `index.html` from `/_snapback/admin/` without a consumer environment override;
- a no-dist contributor source process returns `SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING`
  for `/_snapback/admin/` while keeping `/_snapback/api/inspect` available;
- the admin dashboard reports host, port, target profile, storage mode, SQLite
  path or in-memory status, database version, runtime engine, and capability
  gaps;
- starting a console-development server is optional and does not move admin API
  authority out of Snapback;
- binding to a non-loopback address disables admin or requires an explicit admin
  token;
- non-loopback and hosted targets cannot mint, renew, device-approve, or
  claim-mint/claim-exchange browser console credentials even when another
  admin bearer is present;
- claim-link codes are single-use under concurrent
  redemption — exactly one exchange wins; invalid, expired, and consumed
  claims share one status and body; the code travels only in a `POST` body
  (never a URL or log line) and comparison is constant-time against the
  stored digest; exchange responses are `no-store`; claim-derived credentials
  carry distinct provenance, renew only within their ninety-minute absolute
  cap (never reaching the ordinary eight-hour cap), and are revocable by the
  master through the recorded redemption binding; a server restart
  invalidates unredeemed claims;
- the published reachability origin is registered
  master-authenticated for exactly the affordance's lifetime and dropped at
  teardown; the relay never rewrites Origin/Host toward loopback, accepts
  only its generated Host, and requires absent-or-registered Origin on
  state-changing requests and WebSocket upgrades; the relay forwards only
  the console shell/assets, claim exchange, and credential-authenticated
  `/_snapback/api/*`, refuses the master-exchange route and any request
  carrying the master token header, and refuses every other path with a
  stable diagnostic; adversarial framing is refused — absolute-form targets,
  encoded-separator and dot-segment lookalikes, conflicting
  `Content-Length`/`Transfer-Encoding`, `CONNECT`, pipelined follow-on
  requests, spoofed forwarding headers, and upgrades outside the namespace;
  the relay's lease closes it within one lease interval of revocation,
  expiry, observation loss, or server startup-nonce change, and it never
  outlives the ninety-minute credential cap; unredeemed and redeemed server
  restarts, observer failure, revocation races, concurrent claims, graceful
  exit, and hard CLI kill all end with a closed listener; `--lan` and
  `--tailscale` each conflict with `--no-wait`, and
  `--url-base`/`--tailscale`/`--lan` are mutually exclusive; `--lan` mint
  prints the cleartext-transport warning; reachability-session credentials
  live only in tab-scoped storage and are revoked on early front
  termination; `--tailscale` mappings are path-scoped to `/_snapback`,
  tagged, receipt-owned with last-out compare-and-delete cleanup, stale-swept
  on the next invocation after a crash, and operator-made mappings are never
  modified; master-exchange attempts are rate/cap bounded; `--qr` output
  encodes byte-identically the URL printed beside it;
- `snapback admin --no-open` prints a fragment-bearing URL whose only
  credential is derived `sbcc_`, and that credential authenticates the real
  admin API;
- active console credentials survive a file-backed server restart and renew
  past their base TTL without crossing their absolute lifetime cap;
- console device codes expire, are single-use, are rate/cap bounded, and release
  a credential only after a token-holding terminal approves the matching code;
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
- the Contract/Exact admin surface consumes the same headless admin contract
  available to CLI, tests, agents, and future adapters;
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

- The Contract/Exact console is the single admin dashboard UI. Core admin tests
  must not require Exact, so the no-dist path is a diagnostic, not a second UI.
  The remaining open items are narrower:
  (a) ~~the admin surfaces did not share one admin client package~~ — **resolved
  2026-07-02 (LLP 0032 P8), simplified 2026-07-04:** `@snapback/admin-client`
  is the one client; the Contract admin-ui imports the workspace package and the
  server exposes the byte-identical module at `/_snapback/admin/client.mjs` for
  tooling. The same pass
  normalized the inspect payload to camelCase end to end (aliases keep old
  spellings parsing; the embedded v0 artifacts keep their LLP 0012-pinned
  shapes), committed typed schemas for both payloads
  (`schemas/inspect.admin.schema.json`, `schemas/inspect.public.schema.json`,
  drift-gated per LLP 0037), and pinned casing with
  `tests/inspect_casing_v0.rs`; and (b) whether the
  **native macOS shell** actually renders the static snapshot end-to-end (the
  artifacts now emit; loading them in ExactAppMac is the open verification —
  currently also blocked upstream at Exact HEAD, ENG-22578).
- **Resolved 2026-08-10:** the packaged web console is a sealed installed asset
  directory inside each platform runtime package. This keeps the one static
  browser/native snapshot independently inspectable while the runtime seal and
  publication gates make it the same build identity as the binary and Guide.
- **Resolved:** an explicit token wins; otherwise loopback file-backed servers
  mint and owner-only persist a token beside the instance, ready-file launches
  publish an owner-only sibling capability, and processes with neither location
  keep an ephemeral token. Non-loopback admin stays disabled without an
  explicit token.
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

Accepted (ratified in the LLP 0032 R1 batch on 2026-07-01). The local target
serves one headless admin contract and the packaged Contract/Exact console from
the Snapback process; Vite remains an optional development proxy. The local
admin-token lifecycle is implemented with explicit/minted capabilities,
owner-only no-follow persistence, and trusted readiness discovery, while static
assets are read through contained no-follow handles. Hosted authorization, raw
SQL/direct-edit policy, and later schema-version evolution remain follow-up
surface work, not unsettled prerequisites for this accepted local contract.
