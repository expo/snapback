# LLP 0030: Managed Snapback Vite dev loop

**Type:** RFC
**Status:** Draft
**Systems:** Developer experience, Contract/Exact, Client integration, Tooling, Local server lifecycle, Packaging, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-01
**Revised:** 2026-08-12 (§Proxy surface and §Validation requirements: the relay terminates both WebSocket legs because Bun's `node:http` shim surfaces upgrades but silently drops raw writes on the handed-off socket; `packages/snapback-vite/bun-relay.test.mjs` is the Bun-runtime real-Vite witness); 2026-08-10 (§Readiness and port discovery: LLP 0224 Phase 1 adds the application-readiness receipt as a deterministic `<ready-file>.application-ready` sibling under the same owner-only discipline; the host descriptor itself is unchanged); 2026-08-08 (§Server process ownership uses the explicit `snapback start` spelling); 2026-08-02 (§Proxy surface: the default app allowlist now forwards the complete root-level `/assets/*` family — attempt creation/inspection/cancel/finalize, the TUS transfer resource, record inspection/deletion, and the strict, signed-issuance, signed, and public delivery lanes — all registered AppData by LLP 0031's 2026-07-31 dated amendment; system and admin routes, including the dev auth mailbox, stay refused. Closes the browser asset guide gap recorded by issues/20260802-guide-gap-react-asset-vite-path.md and proven by demos/file-drop/tests/acceptance/browser-relay.mjs); 2026-07-25 (§Server process ownership: the command-resolver ladder now governs `demos/_kit/server-process.mjs`'s shared server lifecycle as well as the Vite plugin, and is implemented there — caller-configured `serverBinary`/`SNAPBACK_SERVER_BINARY` first, then a provenance-verified `target/debug/snapback`, then `cargo run` as the source-tree fallback; All Aboard external-review evidence; issues/closed/20260724-kit-prebuilt-binary-boot-path.md); 2026-07-13 (ENG-24596: the ready descriptor advertises the mechanically derived owner-only `impersonationCapabilityFile` sibling for trusted CLI discovery only; browsers/plugins may not consume or proxy it); 2026-07-12 (ENG-24562 review follow-up: the server pins the resolved ready-file parent as a directory capability and publishes/removes by descriptor-relative operations plus inode identity, so a parent-symlink swap cannot redirect lifecycle writes or cleanup); 2026-07-12 (ENG-24338 review follow-up: readiness descriptors publish atomically as owner-only 0600 capability files, and CLI consumers bind URL plus minted-token discovery to one validated descriptor snapshot); 2026-07-01 (GPT-5 review clarified host-ops ownership, attach compatibility, default app-proxy authority, dev-only virtual-module leakage, and child-process command/security constraints; Claude review corrected the proxy authority boundary to an allowlist over the real root-level `/admin/*` routes, moved backend setup off the browser, pinned the attach-identity dependency on `app.inspect`, flagged the `auto`-attach reset footgun, and hardened the readiness and WebSocket validation; GPT-5 re-review made backend setup mode-aware so attach/auto cannot reset a server the plugin did not spawn, and distinguished one-shot artifact loading from later codegen/watch/hot-push; route convention clarified so the generic Snapback Vite default is `/__snapback/*`, while an Exact preset may opt into `/__exact/snapback/*`; a second fresh Claude review then corrected the false claim that no privileged routes live under `/_snapback/*` — the token-gated admin API `/_snapback/api/functions/{name}/run`, `/cron/*`, and `/ephemeral/cleanup` are privileged writes — noted that the root `/admin/*` v0 aliases are ungated so the proxy allowlist is their only guard, and changed the generic default from `/__snapback/*` to `/@snapback/*` because a one-underscore delta from Snapback's real `/_snapback/*` admin namespace is not "visually and mechanically distinct" and the relay's prefix-strip rewrite would put `/__snapback/_snapback/...` onto the real admin API; a follow-up author decision then reverted the generic default to `/__snapback/*` for consistency with Exact's `/__exact/*` dev namespace and to avoid the `/@handle` app-route collision a `/@snapback` proxy prefix would cause — Vite matches `server.proxy` keys by prefix — accepting the `/_snapback` look-alike as a human-only concern the allowlist already neutralizes, and reframed the taxonomy open question around finishing the LLP 0017 root-vs-`/_snapback` migration rather than inventing a new app-data namespace; GPT-5 consistency pass aligned proxy wording with LLP 0031's destructive/unclassified root-route taxonomy; a further Claude re-review flagged that the method+path allowlist cannot constrain operations multiplexed over an allowlisted WebSocket route — `ephemeral_delete` rides `/live/*` via `handle_live_socket_text` — so the fix belongs at the server via LLP 0031's transport-parity rule, not the proxy, and added a validation item for it; a later Claude pass then reconciled 0030 with LLP 0031's now-settled classifications — `/ephemeral/delete` and `/ephemeral/collections/ensure` are app-data and move into the forwarded allowlist, while `/connections/{id}/disconnect`, `/ephemeral/cleanup`, and `/ephemeral/collections` (register) stay refused — dissolved the WebSocket `ephemeral_delete` smuggling concern because delete is app-data in every transport, and pinned attach identity to the gated `/_snapback/api/inspect` with the trimmed public `/inspect` as the unauthorized fallback)
**Related:** LLP 0000, LLP 0005, LLP 0010, LLP 0012, LLP 0015, LLP 0017, LLP 0021, LLP 0023, LLP 0024, LLP 0031, LLP 0057, Exact 0263, Exact 0265

## Summary

An Exact app that uses Snapback as its backend should not normally require the
developer or agent to start Snapback in a separate terminal. This RFC proposes a
dev-time Vite plugin or preset that can optionally manage a local Snapback server
alongside the app, proxy the app's Snapback requests through Vite, and surface
server lifecycle failures as structured diagnostics.

The plugin should be a local-development convenience, not a new runtime target.
The Snapback Rust server remains the process that owns SQLite, runtime state,
cron, live subscriptions, admin APIs, and app instance locks. Vite owns only app
serving, proxying, optional child-process orchestration, codegen/reload hooks,
and developer-facing diagnostics.

The durable lifecycle contract should be the LLP 0024 host-ops model. A Vite
plugin may start as a thin Node orchestrator that shells out to the current CLI,
but it must not grow a private definition of `host.start`, readiness, diagnostic
envelopes, target identity, or server ownership. As host-ops matures, the plugin
should call that operation surface and project its result into Vite diagnostics
rather than re-implementing it.

## Existing coverage

This topic is partially covered but not owned by one document:

- [LLP 0010](./0010-agent-dx-and-acceptance.spec.md) says Valet's Vite-plugin
  orchestrator is worth copying: spawn a server child process, health-check and
  reuse an already-running server, codegen on save, hot-push schema/functions,
  and tear down cleanly. It is a general DX requirement, not a concrete app
  plugin API.
- [LLP 0012](./0012-headless-integration-contract.spec.md) requires local server
  lifecycle facts in capability and runtime state, and leaves open how a
  Contract/Exact preview process owns or attaches to that lifecycle.
- [LLP 0021](./0021-contract-exact-integration-hardening.plan.md) packages the
  Contract/Exact build and launch recipe, but its Phase 3 dev-serve work still
  assumes a Snapback API target or treats backend launch as an open item.
- [LLP 0023](./0023-admin-console-dev-serve-loop.rfc.md) specifies an admin-only
  browser dev loop with a Vite proxy to a separately running Snapback server. It
  deliberately keeps the backend in another terminal and does not cover ordinary
  Exact app surfaces.
- [LLP 0024](./0024-agent-operating-surface.spec.md) defines `host.start`,
  `host.stop`, `host.restart`, and the shared JSON result envelope for local
  host operations. A managed Vite plugin should become a consumer/projection of
  that host-ops core, not a competing lifecycle dialect.

This RFC owns the broader app-surface lifecycle question: when a Vite-served
Exact app should attach to, spawn, proxy to, or ignore a local Snapback backend.

## Motivation

The current Contract demo pattern is still too manual. The app's Vite config
points an ad hoc relative proxy path (currently `/snapback` in the demos) at a
Snapback URL supplied by an environment variable or a hard-coded local port.
The developer or test harness must start Snapback first, pick a compatible
port, remember which backend is serving which app, and ensure the app talks to
that backend.

That creates three recurring failure modes:

- **Ceremony:** the first useful Exact app command is not "run the app"; it is
  "start Snapback in one terminal, then start Vite in another terminal with the
  right target URL."
- **Wrong server:** if a port is occupied by a different app or stale process,
  the Vite proxy can forward to a healthy but wrong Snapback instance.
- **Opaque failure:** a missing backend becomes a fetch/proxy/JSON error in the
  app instead of a Snapback diagnostic an agent can act on.

The desired product feel is closer to: start the Exact app, and if local
Snapback is the selected backend, the dev loop brings up or finds the right
Snapback instance and reports exactly what happened.

## Goals

- A single Vite dev command can run an Exact app surface against a local
  Snapback backend.
- The same plugin can be used by Contract/Exact app surfaces and, where useful,
  React/Expo web surfaces that run under Vite.
- The plugin can either manage a Snapback child process or attach to an explicit
  or discoverable external server.
- File-backed databases preserve Snapback's single-owner guarantee: the plugin
  must never silently start a second server over a database already owned by
  another local Snapback process.
- Attach decisions are based on structured server/app identity, not only an open
  TCP port or successful `/health` response.
- The browser app uses a stable relative API path. For the generic Snapback Vite
  plugin the default is `/__snapback/*` (matching Exact's `/__exact/*` dev
  namespace; kept off the `/@handle` space app routes use), while an Exact preset
  may configure `/__exact/snapback/*` under Exact's established `/__exact/*` dev namespace.
  Either way, the plugin hides the actual loopback port.
- Missing, unhealthy, stale, or mismatched backends produce structured
  diagnostics in the LLP 0012 / LLP 0024 diagnostic dialect.
- Exact remains optional for Snapback core development; this plugin is part of
  client/app tooling, not a dependency of core server tests.

## Non-goals

- Do not embed the Snapback server in the Node/Vite process.
- Do not make Vite a production dependency for serving a Snapback app.
- Do not change Snapback's runtime, storage, auth, sync, cron, or admin
  semantics.
- Do not make native Exact shell development depend on a browser-only Vite dev
  server. Native/static envelopes remain governed by the Exact/Snapback build
  path in LLP 0021 and LLP 0023.
- Do not claim local-first Parity. A Vite-managed backend still speaks to a live
  local server unless and until a separate Parity adapter exists.

## Proposed design

Ship a Vite plugin or preset, tentatively:

```ts
import { defineConfig } from 'vite'
import { snapbackDev } from '@snapback/vite'
import { exactVitePlugin } from '@exact/devtools/vite-plugin'
import { contractVitePlugin } from '@exact/contract/vite-plugin'

export default defineConfig({
  plugins: [
    snapbackDev({
      route: '/__snapback',
      server: {
        mode: 'auto',
        db: '.snapback/dev.sqlite3',
        host: '127.0.0.1',
      },
    }),
    exactVitePlugin({ entry: '/main.ts', agentReadiness: false }),
    contractVitePlugin(),
  ],
})
```

The exact package name is open. The important boundary is that this plugin shells
out to the Snapback CLI or binary and proxies HTTP/WebSocket traffic; it does not
link the Rust server into Vite.

The proxy route remains configurable. The generic `@snapback/vite` default is
`/__snapback/*` — matching Exact's `/__exact/*` dev namespace and kept off the
`/@handle` space app routes use (see Proxy surface). An Exact-specific preset can instead choose
`/__exact/snapback/*` when it wants every dev-server relay under Exact's
established `/__exact/*` namespace.

### Lifecycle modes

The plugin should support explicit modes instead of one magic behavior:

- `off`: do nothing. The app or environment owns the backend.
- `external`: proxy to a configured URL and fail clearly if it is unreachable.
- `attach`: discover or validate an already-running compatible local Snapback
  instance, but never spawn one.
- `managed`: spawn a Snapback child process for this Vite session, then tear down
  only that child when Vite closes.
- `auto`: prefer an explicit URL, then attach to a compatible running instance,
  then spawn a managed server if allowed.

`auto` should be the ergonomic default for app demos. CI, native shells, staging
backends, and tests that start Snapback themselves should choose `external` or
`off`.

### Server process ownership

The managed path should execute a normal Snapback command:

```sh
snapback start --db .snapback/dev.sqlite3
```

or an equivalent configured command during source-tree development:

```sh
cargo run --manifest-path /path/to/snapback/Cargo.toml -- start --db .snapback/dev.sqlite3
```

For file-backed databases, Snapback's existing instance lock remains the source
of truth. If another process already owns the database and reports a healthy URL,
the plugin should attach or report a target mismatch depending on mode. If the
lock exists but has no reachable server URL, the plugin should report an
ownership diagnostic rather than deleting the lock or starting a second server.

The sidecar path is untrusted filesystem input even when the database directory
is writable by the current user. Snapback opens the final path without following
links/reparse points, requires a regular inode owned by the effective service
identity, repairs it to an owner-only mode/ACL, and only then locks and rewrites
through that validated descriptor. Platforms without an equivalent validation
backend fail closed. `[confirmed — Charlie Cheever / Codex, 2026-07-12, ENG-24488]`

The instance lock prevents two *servers* over one database; it does not prevent
two *clients* from both driving destructive control calls against one attached
server. In `auto` mode against the default `.snapback/dev.sqlite3`, the plugin
may attach to a server another surface or agent is actively using, and — under
today's browser-driven boot — a page reload would then wipe that shared database
through `/admin/reset`. This is the sharpest reason backend setup must move off
the browser (see Proxy surface): once schema/function/seed loading is a
managed-bring-up step and the app proxy forwards only app routes, an attach can
no longer let one surface silently reset another's state. Until then, `auto`
attaching to a shared file-backed database should be treated as unsafe by
default.

For in-memory development, there is no database lock. Managed in-memory mode is
therefore always a new backend instance unless the config supplies an explicit
URL to reuse.

The command resolver should be explicit and diagnostic-heavy:

- prefer a configured command or binary path when the app or test supplies one;
- otherwise prefer an installed Snapback CLI/package binary;
- use `cargo run --manifest-path ...` only for source-tree development where the
  checkout has already been bootstrapped;
- fail with a capability diagnostic when no runnable server command is
  available.

It should not silently trigger heavyweight runtime setup such as building Hermes
from source. That remains the bootstrap script's job, not a side effect of
starting Vite.

The same resolver ladder governs the repository's own shared demo/acceptance
server lifecycle (`demos/_kit/server-process.mjs`), not only this plugin.
External review of the All Aboard implementation matrix (2026-07-24) found the
kit's then-only `cargo run` rung taking every consumer down whenever the
checkout HEAD did not compile, with the non-JS arms independently rebuilding
the prebuilt-binary path through the raw `launchSpec` escape. Implemented
2026-07-25 (`issues/closed/20260724-kit-prebuilt-binary-boot-path.md`):
`startServer` resolves (1) a caller-configured binary — the `serverBinary`
option or `SNAPBACK_SERVER_BINARY`, which boots even on stamp drift and
reports the drift honestly on the handle — then (2) an existing
`target/debug/snapback` only when the checkout is pinned and the spawned
binary's `/health` stamp fully verifies against it (anything weaker tears the
child down and falls through with a diagnostic), then (3) `cargo run` as the
source-tree fallback. `deps.launchSpec` remains a test-only seam substituting
the cargo rung's command. Prebuilt runtime *distribution* (download, cache,
publishing) stays out of scope here — that is LLP 0041's runtime-package
program; the kit rung only consumes binaries that already exist locally.

Managed teardown follows the LLP 0010 Valet lesson: terminate only the child
process this Vite session spawned, escalate from graceful termination to kill
when needed, and never stop a process the plugin merely attached to.

### Backend setup ownership

Moving schema/function/seed setup out of the browser closes the app-proxy
authority hole, but it creates a second ownership question: which mode is allowed
to mutate backend state during bring-up?

The setup policy must be explicit and mode-aware:

- `managed`: may run one-shot setup because the plugin spawned the server for
  this Vite session. It may load schema/functions from already-generated
  artifacts and, when configured, reset and seed the selected development
  database.
- `auto` after spawning a managed child follows the `managed` setup policy.
- `auto` after attaching to an existing server follows the `attach` setup policy,
  not the `managed` policy.
- `attach`: must be non-destructive by default. It validates that the existing
  server already has compatible schema/functions/data state, reports mismatches,
  and never resets or seeds unless the config opts into an attached-server reset
  with a diagnostic that names the server URL, database path, PID, and target
  descriptor.
- `external`: must be non-destructive by default. It can validate and proxy to
  a configured URL, but loading functions, resetting, or seeding an external
  target requires explicit configuration because the target may be shared,
  staged, or intentionally long-lived.
- `off`: does no setup.

This keeps the useful demo behavior — one command can bring up a fresh local
backend — without making attach mode a hidden destructive operation. Browser
reload and HMR must never rerun backend setup; they should remount the surface
against the already-prepared backend.

The first plugin does not need full codegen/watch/hot-push to satisfy this
policy. It can load the existing generated schema/function artifacts and seed
file once during managed bring-up, verify their hashes against the expected
target descriptor, and leave regeneration/watch work to the later loop.

### Target identity and attach compatibility

`attach` and `auto` need a compatibility contract stronger than "a server is
answering." The plugin should validate a structured target descriptor before it
proxies app traffic to an existing process. The descriptor can come from the
host-ops `host.start` result, admin/runtime inspect state, or the file-backed
instance-lock metadata plus a follow-up server probe.

Required compatibility facts:

- target profile id, such as `local.ibex.sqlite`;
- local server readiness and bound URL;
- database path or explicit target id for non-file targets;
- app id and app root when known;
- loaded schema hash and function bundle hash when the app expects loaded
  artifacts;
- generated input hash or codegen artifact hash when the browser bundle was
  built from generated Contract/Snapback artifacts;
- Snapback schema version and host-ops/result-envelope version.

Where these facts come from matters. The file-backed instance lock records only
`pid`, `db_path`, `host`, `port`, `url`, and `started_at_ms` — none of the schema
hash, function bundle hash, app id, or target profile. So every compatibility
fact beyond "a server for this database is answering on this port" must come
from the inspect surface / runtime-state until host-ops exposes a first-class
target descriptor. Which inspect matters: the orchestrator should read the
**gated** `/_snapback/api/inspect` when it holds admin authority (managed or
spawn-shaped `auto`), because that payload is a superset — it carries both the
identity facts and the `server` block (pid, port, storage mode) the target-mismatch
diagnostic wants — and fall back to the **public trimmed** `/inspect` for identity
facts in ordinary unauthorized `attach`/`external`. LLP 0031 (D3) trims the public
`/inspect` but deliberately keeps every compatibility fact below in it, precisely
because unauthorized attach validation depends on them; this read is the
orchestrator's, never the browser's.

The current inspect payload already gives the pieces as nested artifact facts:
`schema.appId`, `schema.schemaHash`, `schema.inputsHash`,
`schema.targetProfile`, `functions.appId`, `functions.bundleHash`,
`functions.inputsHash`, top-level `targetProfileId`, and top-level
`schemaVersion`. The plugin should compare those loaded facts against an
expected descriptor derived from the app's generated artifacts and plugin
configuration, not from browser state. Database path plus a healthy inspect
response is still only the weakest attach level and must be reported honestly
when hashes or app identity are missing. A schema, function bundle, generated
input, app id, or target-profile mismatch is a hard failure in `external`,
`attach`, and attach-shaped `auto` once those facts are available, unless the
configuration explicitly opts into a weaker policy for exploratory work. A
healthy but incompatible server is more dangerous than a missing one because it
can teach the app and agent a false model.

### Readiness and port discovery

Snapback currently prints its selected address and records it in file-backed
instance-lock metadata. That is enough for humans, but a managed Vite plugin
needs a machine-readable readiness handshake, especially when Snapback auto-scans
ports or uses port `0`.

Add one of these CLI affordances before depending on fully automatic managed
mode:

```sh
snapback start --db .snapback/dev.sqlite3 --startup-json
```

which prints a line like:

```json
{"event":"snapback.ready","url":"http://127.0.0.1:4291","db":"/abs/app/.snapback/dev.sqlite3","pid":12345}
```

or:

```sh
snapback start --db .snapback/dev.sqlite3 --ready-file /tmp/snapback-ready.json
```

For the MVP the `--ready-file` (out-of-band) shape should be preferred over
stdout JSON, because the only managed command that exists today is source-tree
`cargo run --manifest-path ... -- start --db ...` (there is no published `snapback`
binary yet), and `cargo` writes its own `Compiling…` / `Finished` lines to the
same stdout a `--startup-json` parser would read. A readiness file sidesteps
launcher stdout entirely. Once a clean packaged binary or a `snapback host start
--json` command exists, stdout JSON becomes a reasonable equal option.

The plugin may support a simpler MVP by choosing a port and passing
`--port <port>`, but the durable design should let Snapback choose the port and
report the chosen address structurally. Parsing prose startup logs should not be
the long-term contract.

The readiness payload should align with LLP 0024 instead of becoming a one-off
startup shape. At minimum, it should include `schemaVersion`, a request or
startup id, the resolved target descriptor, the selected URL, process id,
readiness state, and diagnostics. A future `snapback host start --json` or
equivalent host-ops command can subsume `--startup-json`; the Vite plugin should
be ready to consume either without changing app code.

The ready-file path should be per-session, created by the orchestrator in a
private temp directory or app-local ignored directory, removed before spawn, and
written atomically by Snapback only after the listener is bound and instance-lock
metadata has been recorded. Snapback publishes the descriptor through an
owner-only temporary file and atomic rename; its mode is 0600 independent of the
ambient umask because it participates in the local admin-capability handoff.
A ready-file destination must also be identity-disjoint from every startup
artifact Snapback manages: the database, its lock/config/token siblings, and
SQLite WAL/SHM/journal sidecars. Snapback validates normalized paths plus
existing symlink/hardlink identity before opening the database and again just
before publication, rejecting equality and ancestor/descendant collisions with
a stable diagnostic before a missing ready parent can occupy a lock, token, or
SQLite-sidecar pathname. The random
temporary publication candidate is allocated and included in both checks, then
opened create-new/no-follow so a pre-created or racing inode can never be
truncated. The resolved parent is pinned before the final disjointness check;
temporary creation, rename, and cleanup are relative to that directory
descriptor. Cleanup additionally requires the inode identity recorded at
publication, so replacing the caller's parent symlink or final entry cannot
redirect an unlink into the database or another managed artifact. For an
in-memory instance, minted-token read/create/cleanup uses that same directory
capability; if the canonical advertised parent itself has been renamed or
replaced, startup fails closed rather than split the descriptor from its token
handoff. Both token and ready-file descriptors are repaired to exact mode 0600
after open, independent of a permissive or restrictive umask (ENG-24562).
A consumer resolves the server URL and any `adminTokenFile` handoff from one
validated descriptor read, never two path reads that a rename could splice
together. A stale ready file must never be accepted as current readiness.

ENG-24596 adds `impersonationCapabilityFile`, the exact
`<ready-file>.impersonation` sibling used for one process-bound `sbic_`
capability. Publication, alias checks, pinned-parent handling, and cleanup
follow the same owner-only ready-file discipline, and attach-side discovery
verifies `startupNonce` before the strict file read. This field is for trusted
local CLI/operator tooling only. A Vite plugin, browser bundle, admin page,
proxy, or virtual module must neither read nor expose it; possession authorizes
an independent impersonation effect and is not a browser credential.

LLP 0224 Phase 1 adds a second deterministic sibling: the
application-readiness receipt `<ready-file>.application-ready`
(`snapback.application-ready.v1`, schema
`schemas/application-ready.schema.json`), overridable with
`--application-ready-file` / the `runDev` `applicationReadyFile` option.
The receipt is a projection of the server-owned `OperationalReadinessV1`
fact — the supervisor publishes it only after package-level provisioning
settles, bound to the returned `startupNonce` and digests, and removes it
before work begins on every launch, watch reload, restart, and dev-fresh
reset, so absence is the honest intermediate state. The host ready file's
own schema, timing, and security posture are unchanged by the receipt.
The Phase-1 JS publisher replicates the atomic-rename and owner-only-mode
discipline; native consumers (`snapback wait --level application`) verify
the live `startupNonce` before reading the sibling with the strict
owner-only read, and additionally require the live `OperationalReadinessV1`
evaluation to be positive for the receipt's bound target. The receipt
carries no bearer or sidecar authority.

The built descriptor carries the writing server's per-process `startupNonce`
(the same nonce `/health` reports in `binary.startupNonce`, LLP 0031's
server-binary identity), which is how destructive consumers enforce the
stale-file rule: `snapback stop` re-fetches `/health` from the descriptor's URL
and refuses to signal the descriptor's pid unless the live nonce matches — a
descriptor orphaned by a crash or Ctrl-C can never route a signal to a reused
PID (ENG-23366). Unverifiable cases (dead server, non-Snapback responder,
nonce-less descriptor from an older binary) fail closed with
`SNAPBACK_HOST_STOP_STALE_DESCRIPTOR` / `SNAPBACK_HOST_STOP_UNVERIFIABLE`
diagnostics.

### Proxy surface

The browser-facing API path should be stable and relative. The generic Snapback
Vite route uses a Snapback-owned dev namespace:

```text
/__snapback/query/listTodos
/__snapback/mutation/createTodo
/__snapback/live/<connection>/stream
```

For allowed app routes, Vite rewrites the configured proxy prefix
(`/__snapback/*` by default) to the Snapback server's root path. The proxy must
support WebSocket upgrades for durable live streams and any future realtime
transport. If the app uses EventSource or streaming HTTP in the future, the
proxy must preserve those responses too.

Do not use Snapback's own `/_snapback/*` namespace for this app-data relay.
`/_snapback/*` (single underscore) is Snapback's reserved system/admin/control
namespace on the Rust server — the admin console and the token-gated admin API
live there. `/__snapback/*` is the frontend-dev-server relay to app-facing
Snapback routes.

The generic default is `/__snapback/*`, matching Exact's established
`/__exact/*` dev-server namespace (below) so the two tools that ship and load
together share one relay convention. `/__` is deliberately chosen over a
`/@snapback` alternative. Vite matches `server.proxy` keys by prefix
(`url.startsWith(context)` unless the key begins with `^`), and the `/@` space is
application handle-space — `/@username` profile routes in the Twitter / Mastodon /
Medium style — so a `/@snapback` relay would prefix-match and hijack any
`/@snapback…` handle. `/__`, by contrast, is dev-infra space that user-facing
routes essentially never use, and this codebase already reads `__snapback` as
"Snapback internal" (the runtime handler globals `globalThis.__snapbackHandlers` /
`__snapbackInvoke`).

One caveat is Snapback-specific: `/__snapback` (relay, two underscores) sits one
character from `/_snapback` (the server's reserved admin namespace, one
underscore). This is a *human* look-alike, not a security hole. The app-route
allowlist below refuses `/__snapback/_snapback/...` because it is not an
enumerated app route, and once backend setup moves off the browser the page only
ever writes the relay prefix while `/_snapback/*` stays server-internal — so the
two rarely co-occur in app code. The durable way to retire even the look-alike is
the server-side route-taxonomy cleanup in Open questions (finish the LLP 0017
migration so the app-data root and the reserved `/_snapback/*` system lane are
cleanly separated), not a divergent relay spelling.

If the relay is provided by an Exact preset, `/__exact/snapback/*` is also
acceptable: it nests under Exact's real, established `/__exact/*` dev-server
namespace (`/__exact/ws`, `/__exact/agent/*`, `/__exact/module-graph`, and
peers), so the leading `/__exact/` segment already disambiguates it from
`/_snapback/*`. It should be treated as an Exact wrapper over the same app-data
relay rather than the generic Snapback plugin default. These authorities must
stay visually and mechanically distinct.

> **Update (2026-08-02): the asset route family forwards.** LLP 0031's dated
> amendment (2026-07-31) registered the root-level `/assets/*` upload and
> delivery family as AppData rows of `core_route_registrations()`, and the
> default allowlist now forwards all of them at method+path granularity —
> attempts (create/inspect/cancel/finalize), the TUS transfer resource
> (HEAD/PATCH/DELETE), records (inspect/delete/bytes/signed-url issuance),
> and the signed and public pasteable delivery lanes — so a browser app
> reaches the whole generated asset client surface through the relay with no
> app-owned proxy. `/_snapback/*` (including the admin-gated dev auth
> mailbox) and the system root routes stay refused. Verified end to end by
> `demos/file-drop/tests/acceptance/browser-relay.mjs`.

> **Update (2026-07-01): the boundary now holds at the server.** LLP 0032 S1
> implemented [LLP 0031](./0031-server-route-taxonomy.spec.md): the ungated root
> `/admin/*` aliases are retired, `/connections/{id}/disconnect` and the
> `/ephemeral/collections` register route moved/retired, the migrated writes live
> under `/_snapback/api/*`, and a declared route registry with an enforcement
> test guarantees no privileged operation hides at the root. So the default app
> proxy can now be the single reserved-prefix rule this RFC wanted — *forward the
> root, refuse `/_snapback/*`* — rather than the hand-maintained allowlist
> described below. The allowlist reasoning is retained as the rationale for why
> the boundary was needed and remains valid as defense-in-depth.

**The default app proxy must be an explicit allowlist, never a deny-list.** The
Snapback HTTP surface interleaves app routes and privileged control routes at the
server root, with no namespace boundary between them: `/query/*`, `/mutation/*`,
`/live/*`, and `/health` sit next to `/admin/schema`, `/admin/functions` (which
loads executable handler bundles), `/admin/reset` (which wipes app state),
`/admin/seed`, and root routes now classified by LLP 0031: `/ephemeral/cleanup`,
`/connections/{id}/disconnect`, and `/ephemeral/collections` (register) are system
(refuse), while `/ephemeral/delete`, `/ephemeral/publish`, `/ephemeral/subscribe`,
and `/ephemeral/collections/ensure` are app-data (forward). A
configured-prefix-to-root rewrite exposes every privileged one of those unless the
proxy restricts what it forwards. A deny-list keyed on `/_snapback/*` is the wrong
instrument three ways over. First, it is incomplete in both directions:
state-mutating routes exist *both* at the server root (`/admin/schema`,
`/admin/functions`, `/admin/reset`, `/admin/seed`, `/ephemeral/cleanup`,
`/connections/{id}/disconnect`, and conservatively classified/unsettled
`/ephemeral/*` operations) *and* under `/_snapback/api/*`
(`/_snapback/api/functions/{name}/run`, which runs mutations and actions;
`/_snapback/api/cron/tick`; `/_snapback/api/cron/{name}/run`;
`/_snapback/api/ephemeral/cleanup`; and, once LLP 0031's migrated writes land,
`/_snapback/api/schema/load`, `/_snapback/api/functions/load`, and
`/_snapback/api/app/reset`) — so a `/_snapback/*` deny-list leaves every
root `/admin/*` route exposed, while an `/admin/*` deny-list leaves the
`/_snapback/api/*` writes exposed. Second, the root `/admin/*` aliases are
*ungated*: unlike the `/_snapback/api/*` handlers, which run through the admin
`authorize()` check, the root v0 aliases perform no token check at all, so the
proxy allowlist is the *only* thing between a dev-browser page and an
unauthenticated `/admin/reset` even when `SNAPBACK_ADMIN_TOKEN` is set. Third,
any deny-list fails open the moment a new privileged route is added at either
the root or under `/_snapback/*`. The default proxy must forward only an
enumerated set of app routes — `/`, `/health`, the trimmed public `/inspect`,
`/query/*`, `/mutation/*`, `/live/*`, `/outbox/*`, and the app-data ephemeral
routes `/ephemeral/publish`, `/ephemeral/subscribe`, `/ephemeral/delete`, and
`/ephemeral/collections/ensure` (all classified app-data by LLP 0031) — specified
at method+path granularity so a coarse prefix does not silently re-admit a system
sibling such as `/ephemeral/cleanup` or `/ephemeral/collections` (register).
An admin/control proxy can exist, but it must be an explicit opt-in with its own route and
diagnostic wording. This keeps ordinary app dev from inheriting the broader
authority of the admin console loop in LLP 0023.

**The allowlist constrains HTTP paths, not operations multiplexed over an
allowlisted socket.** `/live/{id}/stream` is an app route the default proxy
forwards, and the proxy must upgrade it to a WebSocket — but that socket carries a
message protocol, not a single operation. Snapback's `/live/*` stream today
accepts `ephemeral_publish`, `ephemeral_subscribe`, and `ephemeral_delete`
messages (`src/server.rs` `handle_live_socket_text`), and LLP 0031 (D1) classifies
all three as app-data — `ephemeral_delete` enforces the same `publish` check as its
HTTP twin — so the proxied socket carries no system authority today and transport
parity holds. The residual obligation is forward-looking and server-side: a
method+path allowlist cannot see socket sub-operations, so if a *future*
authority-bearing message kind were added to that socket, forwarding `/live/*`
would re-admit it through the very front door the allowlist is meant to guard — and
the same holds for any future realtime transport this proxy is asked to preserve.
The proxy cannot enforce this; LLP 0031's transport-parity rule (an app-data route
must not carry a system operation in any transport) and its WebSocket message-kind
assertion in the enforcement test are what keep the socket app-data as it evolves.

**Backend setup must move off the browser for the allowlist to be sufficient.**
The current Contract demos boot by having the *browser* call `loadSchema`,
`loadFunctions`, `reset`, and `seed` through the old `/snapback` proxy — i.e.
they depend on `/admin/*` from client code. That is precisely the authority the
app proxy should not carry. In `managed` mode the plugin should instead load
schema, functions, and the seed as part of bringing the backend up, through the
LLP 0024 host-ops core (`schema.load`, `functions.load`, `app.reset` with a seed)
once it exists — projected over HTTP by LLP 0031's gated writes
`/_snapback/api/schema/load`, `/_snapback/api/functions/load`, and
`/_snapback/api/app/reset` (D5). Until those gated writes exist, the transitional
path is the Node orchestrator POSTing the *ungated root*
`/admin/{schema,functions,reset,seed}` aliases server-side. That transitional path
is safe because it is server-side, not because it is gated: the root aliases accept
no token, so "hold and redact admin authority" is aspirational for this phase, and
the real protection is that the browser never receives these calls and the app
proxy still forwards only app routes.
This closes the authority hole and makes the app-route allowlist complete rather
than a restriction that breaks the demo it is meant to migrate. A longer-term
structural fix — a single server-side app-data namespace that the browser may
call, with everything else outside it — would make the proxy boundary safe by
construction and is tracked in Open questions.

Because any configured Snapback app proxy can otherwise expose privileged local
capabilities when rewritten to the server root, the dev server must bind to
loopback by default. A non-loopback host must require an explicit opt-in and
must warn that the Snapback proxy is exposed on the network. Loopback binding
stops LAN exposure but not a same-machine drive-by page in the dev browser
driving the proxy; where an app truly needs privileged access, the explicit
admin/control proxy — not the default app proxy — is the place to reason about
that risk.

### Generated app facts

The plugin should make the selected route and backend state inspectable to app
code without hard-coding environment globals. A virtual module is the preferred
shape:

```ts
import { snapbackBasePath, snapbackDevState } from 'virtual:snapback/dev'
```

The browser client should normally use the relative `snapbackBasePath`, not the
private loopback URL. The private URL is a dev-server implementation detail and
should not leak into generated app code, saved Contract files, or production
builds.

The virtual module is a serve-time convenience. Production/static builds should
either tree-shake it away through the normal adapter entry point or fail with a
specific diagnostic if app code imports dev-only lifecycle state directly. The
module may expose a narrow public state such as `mode`, `basePath`, readiness,
and sanitized diagnostics, but it must not expose private loopback targets,
admin tokens, raw environment variables, or command lines to browser code.

### Codegen and hot push

The first useful plugin must manage lifecycle, app-route proxying, and one-shot
backend setup from existing generated artifacts so the browser no longer needs
`/admin/*`. The complete developer loop should eventually inherit LLP 0010's
Valet lessons:

- run Snapback codegen before the app starts;
- watch schema/function inputs;
- debounce and coalesce codegen runs;
- load or hot-push schema/functions into the running server when generation
  succeeds;
- report codegen failures as structured diagnostics;
- never continue silently with stale generated output;
- treat server push failure as a warning when running in local/offline codegen
  mode.

This keeps "start the Exact app" aligned with the generated artifacts that the
Contract adapter consumes.

## Diagnostics

The plugin should register diagnostics under the existing diagnostic families
instead of inventing a new dialect. Candidate codes:

- `SNAPBACK_DEV_SERVER_UNREACHABLE`: configured or discovered target did not
  answer `/health`.
- `SNAPBACK_DEV_SERVER_START_FAILED`: managed child process exited before
  readiness.
- `SNAPBACK_DEV_SERVER_READY_TIMEOUT`: managed child process stayed alive but
  never reported readiness.
- `SNAPBACK_DEV_SERVER_DB_OWNED`: requested file-backed database is owned by
  another Snapback process that cannot be attached to safely.
- `SNAPBACK_DEV_SERVER_TARGET_MISMATCH`: a healthy Snapback target does not
  match the expected app, database, schema hash, or generated artifact hash.
- `SNAPBACK_DEV_PROXY_UNREACHABLE`: a browser request hit the proxy while the
  backend target was unavailable.
- `SNAPBACK_DEV_HOST_EXPOSED`: a non-loopback Vite host was configured without
  the explicit exposure opt-in.
- `SNAPBACK_DEV_CODEGEN_STALE`: generated artifacts are stale or generation
  failed and old output exists.

Each diagnostic should include `target_surface` (`contract-browser-dev`,
`react-vite-dev`, `admin-dev`, etc.), `mode`, `route`, expected and actual
target URLs where safe, database path when local, PID when known, and suggested
next checks.

Where the plugin is projecting a host-ops operation, the Vite diagnostic should
retain the underlying LLP 0024 result envelope or request id so an agent can
join browser-visible failures back to CLI, HTTP, or MCP host-ops output. The
plugin may add Vite-specific context, but `diagnostics[]` remains the diagnostic
channel.

## Security posture

The default is local-only:

- Vite host defaults to `127.0.0.1`.
- Snapback host defaults to `127.0.0.1`.
- Non-loopback Vite or Snapback hosts require explicit opt-in.
- Admin writes on a served instance are always token-gated (auto-minted when
  `SNAPBACK_ADMIN_TOKEN` is unset — ENG-23443, LLP 0017 §Security Defaults),
  so proxying the admin API through Vite is no more powerful than direct
  loopback access; but exposing Vite beyond loopback can still expose the
  read surface and the token-gated lane to the network.
- The plugin must never place admin tokens or secrets into browser-visible
  virtual modules.
- Child-process environment should be explicit and redacted in diagnostics. The
  plugin should pass through only the environment needed to run Snapback and the
  selected app, and should never echo secrets in Vite logs, readiness payloads,
  virtual modules, or browser-visible diagnostics.

Future hosted or multi-tenant development targets should use `external` mode and
ordinary auth, not the local managed-server path.

## Implementation plan

1. Define the plugin package and config shape. Decide whether the first package
   lives at `@snapback/vite`, under `@snapback/contract`, or as a subpath of the
   existing package-equivalent.
2. Add a machine-readable Snapback readiness affordance (`--startup-json` or
   `--ready-file`) or a first host-ops `host.start --json` command so managed
   mode does not parse human logs.
3. Define the target descriptor and compatibility levels used by `attach` and
   `auto`.
4. Define mode-aware backend setup: destructive reset/seed is allowed by default
   only for a plugin-spawned managed child, while `attach`, `external`, and
   attach-shaped `auto` validate by default and require explicit opt-in before
   loading, resetting, or seeding shared state.
5. Implement lifecycle modes `external`, `attach`, `managed`, and `auto`, reusing
   Snapback's health endpoint, runtime inspect facts, host-ops results where
   available, and file-backed instance-lock metadata.
6. Add the `/__snapback` HTTP/WebSocket proxy with structured proxy failures,
   loopback-only defaults, and an explicit method+path allowlist of app routes
   (not a deny-list), so the ungated root-level `/admin/*`, the system root routes
   LLP 0031 settled (`/ephemeral/cleanup`, `/connections/{id}/disconnect`, and
   `/ephemeral/collections` register), and the token-gated `/_snapback/api/*` admin
   writes are all unreachable through the default app proxy — while the app-data
   routes it forwards include `/ephemeral/delete` and
   `/ephemeral/collections/ensure` (LLP 0031 D1/D4). An Exact preset may configure
   the same relay under `/__exact/snapback`.
7. Expose `virtual:snapback/dev` for the relative base path and sanitized dev
   runtime state.
8. Migrate one Contract demo surface from manual `SNAPBACK_*_API` proxy config
   to the plugin. This includes moving the demo's schema/function/seed loading
   out of the browser boot (today `main.ts` calls `loadSchema`/`loadFunctions`/
   `reset`/`seed` through `/snapback`) into managed bring-up via host-ops, so the
   migrated surface calls only app routes through `/__snapback` or an
   Exact-configured `/__exact/snapback` relay.
9. Add codegen/watch/hot-push once lifecycle/proxying is stable.
10. Revisit the admin dev loop in LLP 0023 and either share the same lifecycle
   plugin or keep the admin system surface as an explicit exception.

## Validation requirements

- Starting a migrated Exact demo with one command starts Vite and either attaches
  to or spawns the correct Snapback backend.
- The browser app uses the configured relative proxy route (`/__snapback` for
  the generic plugin, or `/__exact/snapback` for an Exact preset) in browser
  code; no generated Contract module records an absolute loopback backend URL.
- If an expected external Snapback server is down, the browser receives a
  structured diagnostic rather than an HTML proxy error or generic JSON parse
  failure.
- If the requested file-backed database is already owned by another server, the
  plugin attaches only when that server is healthy and compatible; otherwise it
  reports an ownership/target diagnostic.
- `auto` does not reset or seed when it attaches to an existing server. It only
  runs destructive setup when it spawned the managed child, unless the developer
  explicitly opted into resetting an attached/external target.
- Browser reload and HMR remount the Contract surface without re-running backend
  setup; data created after managed setup survives a browser reload unless an
  explicit reset command was issued.
- A healthy server for the wrong app id, database path, schema hash, function
  bundle hash, generated input hash, or target profile is rejected with a
  structured mismatch diagnostic.
- Killing Vite tears down only the child server it spawned. It does not stop an
  external server it merely attached to.
- WebSocket live subscriptions work through the proxy, proven by a surface that
  actually opens the durable `/live/<connection>/stream` socket or by a dedicated
  WS-through-proxy test. The current demo long-polls an outbox over plain HTTP and
  its Vite proxy sets no `ws: true`, so migrating it as-is would not exercise this
  path — the socket must be exercised explicitly, not assumed.
- The Bun-runtime arm is `packages/snapback-vite/bun-relay.test.mjs`, executed
  with `bun` so the real Vite server sits on Bun's `node:http` shim. It may
  delegate Node-24-only code generation to a child, but backend lifecycle,
  Vite, client traffic, the durable stream, mutation-triggered live frame, and
  refused system-route upgrade all remain in the Bun process. The refusal
  assertion checks only that the WebSocket connection fails, never a raw 403
  body that Bun drops on the handed-off upgrade socket.
- Every operation the `/live/*` socket accepts (`ephemeral_publish`,
  `ephemeral_subscribe`, `ephemeral_delete`) is app-data per LLP 0031 (D1), so a
  proxied `ephemeral_delete` over `/live/*` *succeeds* (transport parity) rather
  than being refused. The forward-looking guard is LLP 0031's WebSocket
  message-kind assertion: if a future system-classified message kind is added to
  that socket, the server refuses it even when the socket is reached through the
  default app proxy, proving the method+path allowlist is not silently bypassed by
  a WebSocket sub-operation.
- The privileged routes that exist today are all unreachable through the default
  app proxy (allowlist), reachable only when the configuration explicitly enables
  an admin/control proxy. These include the ungated root aliases `/admin/schema`,
  `/admin/functions`, `/admin/reset`, `/admin/seed`, the system root routes
  `/ephemeral/cleanup`, `/connections/{id}/disconnect`, and `/ephemeral/collections`
  (register), and the token-gated admin API under `/_snapback/api/*`
  (`/_snapback/api/functions/{name}/run`, `/_snapback/api/cron/tick`,
  `/_snapback/api/cron/{name}/run`, `/_snapback/api/ephemeral/cleanup`, and — once
  LLP 0031's migrated writes land — `/_snapback/api/schema/load`,
  `/_snapback/api/functions/load`, `/_snapback/api/app/reset`). Conversely, assert
  that the app-data routes LLP 0031 forwards *are* reachable: `/ephemeral/delete`
  and `/ephemeral/collections/ensure` (D1/D4). Assert the refusal along two paths,
  because the relay rewrites its prefix onto the server root: a direct privileged
  path (`/__snapback/admin/reset` and `/__snapback/_snapback/api/app/reset`) *and*
  the rewrite-into-admin path (`/__snapback/_snapback/api/inspect` and
  `/__snapback/_snapback/api/functions/{name}/run`), which would otherwise land on
  the real `/_snapback/*` admin API. Repeat for `/__exact/snapback/...` when using
  the Exact preset route.
- A production/static build fails clearly or tree-shakes cleanly when app code
  imports `virtual:snapback/dev`; no private loopback URL appears in generated
  Contract files or production bundles.
- A non-loopback Vite host fails without explicit opt-in.
- The application-readiness receipt sibling follows the ready-file
  discipline: owner-only mode, atomic rename, removal before work on every
  launch/reload/restart/dev-fresh reset, and `startupNonce` binding
  verified before any strict sibling read (LLP 0224 Phase 1 proof:
  `tests/wait_cli_v1.rs`, `packages/snapback-cli/application-ready.test.mjs`).
- Core Snapback tests still run without Exact, Vite, or this plugin installed.

## Alternatives considered

### Keep two terminals as the only supported path

This is the current admin dev model in LLP 0023 and it is still a valid escape
hatch. It is too much ceremony for ordinary app demos and Design Mode workflows,
where the primary command should be "run the app."

### Embed Snapback inside Vite

Embedding would make the startup path feel simple, but it would blur ownership of
SQLite, app instance locks, cron, runtime isolation, admin APIs, and server
teardown. The Rust server is already the correct unit of backend authority.

### Make Snapback proxy to Vite

A single Rust origin that reverse-proxies Vite would look production-like, but it
requires dev-only proxy behavior in Snapback and still needs Vite for app assets.
It is a reasonable future option for device/native workflows, but Vite-side
proxying is simpler for the browser Exact loop.

### Require a fixed Snapback port

Pinned ports are useful for tests and `external` mode, but they recreate the
port-collision problem LLP 0010 already corrected. The managed path should allow
Snapback to bind the first safe port and report it structurally.

## Open questions

- What is the public package name and import path?
- Should the plugin live in the Snapback repo first, or in Exact once published
  package boundaries settle?
- Which weaker compatibility policies are worth supporting for exploratory local
  work, and what names should they have?
- Finishing the LLP 0017 migration so the dev-proxy boundary is safe by
  construction is now specced, not open: LLP 0031 has classified every root route —
  `/ephemeral/delete`, `/ephemeral/publish`, `/ephemeral/subscribe`, and
  `/ephemeral/collections/ensure` stay app-data at the root; `/ephemeral/cleanup`,
  `/connections/{id}/disconnect`, and `/ephemeral/collections` (register) become
  system under `/_snapback/*`; and the ungated `/admin/*` aliases are retired in
  favor of the token-gated `/_snapback/api/{schema/load,functions/load,app/reset}`
  writes. The clean fix is **not** a new app-data namespace — app data belongs at
  the root, which is what the server is for — but to keep the root as *pure*
  app-data with every privileged/system route in the reserved `/_snapback/*` lane.
  Once the server guarantees "root = app-data, all privileged routes under
  `/_snapback/*`" — enforced by its own registry test — the relay collapses to a
  single reserved-prefix rule instead of a hand-maintained enumeration. This is
  owned by [LLP 0031](./0031-server-route-taxonomy.spec.md) (server territory that
  this RFC depends on but the Vite plugin does not own); until the registry and the
  migrated writes land, the explicit method+path allowlist above is the correct
  stopgap. What remains genuinely open for *this* RFC is only the timing: whether
  the first plugin depends on the reserved-prefix rule or ships the explicit
  allowlist and switches later.
- Where should schema/function/seed loading live once the browser stops doing it
  — a managed-server startup step, a host-ops call the plugin makes at bring-up,
  or a Node seed script — and which becomes the migration recipe for existing
  demos?
- Should attached-server setup support any non-destructive load operations by
  default, or should all attached/external setup require explicit opt-in until
  stronger app-instance ownership exists?
- If an app surface needs admin/control access during development, what explicit
  proxy route and opt-in wording should it use?
- Does Design Mode need a richer lifecycle API than Vite's plugin hooks expose?
- Should native Exact device development eventually use Snapback-proxies-Vite
  rather than Vite-proxies-Snapback?

## Status

Draft. **The host side of the handshake shipped 2026-07-02 (LLP 0032 P6):**
`snapback start --ready-file <path>` writes the out-of-band readiness
descriptor this RFC asked for (shape: `schemas/host-ready.schema.json`,
generated from the Rust `HostReadyDescriptor` per LLP 0037; attach-side
validation is `HostReadyDescriptor::validate`, tested in
`tests/host_ops_v0.rs`), the `snapback` CLI performs
`stop/inspect/reset/load/run` against a running instance, and one-shot
backend setup from generated artifacts exists as both `scripts/demo-setup`
and CLI verbs — so the managed/attach plugin can now be a thin consumer.
The immediate next step is unchanged in kind but smaller: the MVP
managed-dev plugin for one existing Contract demo — readiness handshake
(read the descriptor), mode-aware lifecycle, `/__snapback` app-route proxy
allowlist, and structured diagnostics. Codegen/watch/hot push should follow
only after the backend lifecycle and authority boundary prove sound.

**Implementation checkpoint (2026-07-23, LLP 0079 SC-2a).** The MVP shipped
as `@snapback/vite` (`packages/snapback-vite/`): `snapbackDev()` with the
five modes (`off`/`external`/`attach`/`managed`/`auto`), lifecycle built on
the `@snapback/cli` helpers (ready-file handshake, target + live
startup-nonce validation, admin-token discovery, nonce-verified stop of only
its own managed child), managed-only one-shot bring-up over host-ops HTTP
(reset/seed default `if-new`; attach/external refuse setup without explicit
opt-in), the `/__snapback` HTTP+WebSocket relay with an explicit
method+path allowlist derived from the server's `RouteClass::AppData` route
registrations (host-ops, retired root `/admin/*`, `/ephemeral/cleanup`, the
`/ephemeral/collections` register, and `POST /app/ensure` — whose legacy
provision half is exactly the authority this plugin moves off the browser —
all refused with `SNAPBACK_DEV_PROXY_ROUTE_REFUSED`), loopback-only default
with an explicit `allowNonLoopbackHost` opt-in (`SNAPBACK_DEV_HOST_EXPOSED`
otherwise), sanitized `virtual:snapback/dev`, and machine-readable
`snapback.vite-dev.v1` events. The `demos/todo` Contract surface migrated
per step 8: browser-boot `ensureApp` provisioning removed in favor of
managed bring-up, one command starts Vite and attaches-or-spawns the
backend, and the package e2e proves the WS-through-proxy live path (the
demo surface itself still polls; the package relay is separately proven under
`bun --bun` by `packages/snapback-vite/bun-relay.test.mjs`, because Bun surfaces
the upgrade event but drops raw writes on the handed-off `node:http` socket).
Steps 9–10 (codegen/watch/hot-push wiring, admin
dev-loop revisit) remain open — step 9 is LLP 0079 SC-2b.
