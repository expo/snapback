# LLP 0031: Server route taxonomy and authority boundary

**Type:** Spec
**Status:** Accepted
**Systems:** Local server lifecycle, HTTP surface, Security/authorization, Admin API, Client integration, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-01
**Revised:** 2026-07-01 (status → Accepted, ratified in the LLP 0032 R1 batch: the five classifications are settled, LLP 0032 S0 landed the interim gate, and S1 implements the registry; author self-review pass: corrected the invariant's auth framing — app routes carry app-supplied `ctx.auth`, not server-enforced auth, and several are public; noted axum's `Router` is not route-introspectable so the declared registry is required for enforcement; aligned the new gated writes with the LLP 0024 host-ops projection; made explicit that the reserved-prefix proxy rule is safe only because the enforcement test holds. Not an independent review — this session authored the draft. GPT-5 review clarified that `/_snapback/admin*` is a static console shell/assets lane, not itself an `authorize()`-gated API; required the route registry to record auth policy as well as path class; and made WebSocket-carried operations part of the taxonomy so `/live/*` cannot smuggle a system operation. A further author self-revision then lifted that WebSocket insight into the normative invariant — the classified unit is the operation, not just the URL path — and clarified that the registry's `app-auth` policy means handler-enforced `ctx.auth`, not transport authentication. Still not an independent review; the GPT-5 pass above is 0031's one independent review so far. A subsequent Claude session then settled the five open-question classifications with the author and wrote them into the spec below, driven by three code-verification sub-agents and two adversarial Claude review passes over the decisions. That work corrected decision 4 — `/ephemeral/collections` (register) is an ungated definition-overwrite with no caller and is now classed system, split from the validate-only `/ephemeral/collections/ensure`, which stays app-data — dropped a category error in the delete rationale, folded seed into `app.reset` per LLP 0024, and added a field-level inspect test the route registry cannot substitute for. This remains a same-family Claude pass, not the independent review 0031 still owes: the GPT-5 review above predates these decisions, so a fresh cross-family pass over the revised spec is the outstanding review debt.)
**Related:** LLP 0000, LLP 0003, LLP 0011, LLP 0012, LLP 0013, LLP 0017, LLP 0023, LLP 0024, LLP 0025, LLP 0030

## Summary

The Snapback HTTP server should draw one clean boundary between **app-data
routes** and **system routes**, and enforce it in code. App-data routes — the
operations an ordinary app client is meant to call — live at the server root and
carry app-level auth or are explicitly public. System routes — schema/function
loading, reset, seed, cron control, data explorer, connection control, the admin
API, and the admin console shell — live under the reserved `/_snapback/*`
namespace. Privileged system API routes carry the admin authorization model; the
static console shell/assets may be served as a public presentation surface only
because instance data and control still go through the authorized
`/_snapback/api/*` routes. No route is both, and no system route hides at the
root.

The payoff is that any proxy or gateway can grant the full app-data surface with
a single reserved-prefix rule (forward the root, refuse `/_snapback/*`) instead
of re-deriving a hand-maintained allowlist. This is the "safe by construction"
alternative the LLP 0030 dev proxy is otherwise forced to approximate.

## Motivation

LLP 0017 reserved `/_snapback/*` as the long-term admin namespace and said the
root routes "may continue as v0 aliases." That migration is half-done, and the
gap is now load-bearing for two other efforts:

- **The v0 aliases are ungated and destructive.** `src/server.rs` serves
  `/admin/schema`, `/admin/functions` (loads executable handler bundles),
  `/admin/reset` (wipes state), and `/admin/seed` at the root with **no
  `authorize()` check** — unlike their intent under the admin model. An
  unauthenticated `POST /admin/reset` succeeds on loopback even when
  `SNAPBACK_ADMIN_TOKEN` is set, because the token only guards `/_snapback/api/*`
  (`src/admin.rs`).
- **The dev proxy in LLP 0030 has no boundary to trust.** Because privileged and
  app routes are interleaved at the root with no namespace between them, the dev
  proxy must forward an explicit method+path allowlist and re-verify it by hand.
  A deny-list on `/_snapback/*` fails open the moment a new privileged route
  appears at the root — which is exactly the situation the ungated `/admin/*`
  aliases create.

Finishing the taxonomy closes the ungated hole and turns the proxy boundary into
a one-line rule that the server guarantees.

## Existing coverage

- [LLP 0017](./0017-admin-console-inspection-surface.rfc.md) defines the
  `/_snapback/*` reserved namespace and the admin authorization model. This spec
  completes 0017's v0-alias retirement and adds an enforcement test; it does not
  change the admin security defaults.
- [LLP 0013](./0013-ephemeral-realtime-state.rfc.md) owns the `/ephemeral/*`
  semantics. This spec classifies each ephemeral route as app-data or system but
  defers the meaning of those operations to 0013.
- [LLP 0030](./0030-managed-snapback-vite-dev.rfc.md) is the primary consumer:
  its dev-proxy allowlist becomes a single reserved-prefix rule once this holds.

## The invariant

> Every route the server exposes is either an **app-data route** or a **system
> route**. App-data routes live at the server root; they are the operations an app
> client may call, and their identity — when they carry one — is the app-supplied
> `ctx.auth` context, not an admin credential. (Several, like `/health` and `/`,
> are simply public.) System routes live under `/_snapback/*`. System API routes
> that read or mutate instance state are gated by the admin authorization model
> (`authorize()`); static console shell/assets under `/_snapback/admin*` may be
> public only because they do not themselves reveal instance state or perform
> control operations. The classified unit is the **operation**, not merely the URL
> path: an operation multiplexed over a route — such as a WebSocket message kind
> carried on `/live/{id}/stream` — is classified in its own right, so an app-data
> route cannot carry a system operation in any transport. No route or operation is
> both; no system operation lives at the root.

Corollary (the reason this spec exists): a dev or edge proxy may expose the
entire app-data surface by forwarding the root and refusing `/_snapback/*`,
because the server guarantees no privileged route — or operation multiplexed over
an app-data route, per Enforcement — is hiding at the root. This is
"safe by construction" only because the enforcement test below holds the
invariant — without it, "forward the root, refuse `/_snapback/*`" is just another
deny-list. A cautious proxy may still keep an explicit app-route allowlist as
defense-in-depth, and the loopback/CORS defenses in LLP 0017 and LLP 0030 remain
orthogonal: this boundary governs *authority*, not *origin*.

Two clarifications. App-data is **not** "read-only": `/mutation/*` and
`/ephemeral/publish` are writes an app client legitimately makes. And app-data is
**not** "authenticated at the transport": in local v0 the app routes trust the
`ctx.auth` the client supplies rather than enforcing a server-side credential
(see LLP 0003). The split is therefore about *what the operation is for* —
app-scoped data an app client should call vs instance-level control an operator,
agent, or dev tool should call — not read vs write, and not authenticated vs not.

## Route classification

Current surface (`src/server.rs` `core_routes`, `src/admin.rs` `admin_routes`)
and its target home:

| Route today | Gating today | Class | Target |
| --- | --- | --- | --- |
| `/` (YAML status) | none | app-data/public read | root — keep; trim the on-disk DB path per D3 |
| `/health` | none | app-data | root — keep |
| `/query/{name}` | app auth | app-data | root — keep |
| `/mutation/{name}` | app auth | app-data | root — keep |
| `/live/{name}/subscribe`, `/live/{name}/resume`, `/live/{id}/stream` | app auth | app-data | root — keep |
| `/outbox/{id}` | none | app-data | root — keep |
| `/ephemeral/publish`, `/ephemeral/subscribe` | none | app-data | root — keep |
| `/admin/schema` | **none** | system (loads schema) | add gated `/_snapback/api/schema/load`, retire root (D5) |
| `/admin/functions` | **none** | system (loads code) | add gated `/_snapback/api/functions/load`, retire root (D5) |
| `/admin/reset` | **none** | system (destructive) | add gated `/_snapback/api/app/reset`, retire root (D5) |
| `/admin/seed` | **none** | system | retire root; seed becomes an argument to `/_snapback/api/app/reset` per LLP 0024, not a standalone route (D5) |
| `/ephemeral/cleanup` | none (gated twin exists) | system (maintenance) | retire root; keep `/_snapback/api/ephemeral/cleanup` |
| `/connections/{id}/disconnect` | none | **system/control** (tears down any connection *and* its durable subscriptions) | **move under `/_snapback/api/*`** (D2) |
| `/inspect` | none (gated twin exists) | **app-data (identity descriptor)** | root — keep, trimmed to compat facts; operational + posture facts live only in the gated `/_snapback/api/inspect` twin (D3) |
| `/ephemeral/delete` | none (store enforces `publish` policy) | **app-data** (publish-parity authority) | root — keep, both transports (D1) |
| `/ephemeral/collections/ensure` | none | **app-data** (validate-only compat check) | root — keep (D4) |
| `/ephemeral/collections` (register) | **none** | **system** (unconditional definition overwrite, including `AccessPolicy`) | **retire** — no caller; defs load via `schema.load` (D4) |
| WebSocket `ephemeral_delete` over `/live/{id}/stream` | store enforces `publish` policy | **app-data** (same operation and check as `/ephemeral/delete`) | keep on `/live/*` — app-data in every transport (D1) |
| `/_snapback/admin*` | none | system presentation | keep under reserved namespace; must not expose instance data/control without `/_snapback/api/*` |
| `/_snapback/api/*` | admin authz | system API | already correct |

Note the gated system operations for schema-load, functions-load, and reset
(the last carrying an optional seed argument) **do not exist yet** under
`/_snapback/api/*` — only the ungated root aliases do. So the migration must add
them before it can retire the root ones.

## Enforcement

The invariant is only durable if it is tested, not just documented. Axum's
`Router` exposes no way to enumerate its registered routes at runtime, so the
test has two viable shapes:

- **Registry-driven (preferred):** build the router from a single declared route
  registry that tags each entry with its path class (`app-data`, `system-static`,
  or `system-api`) and auth policy (`public`, `app-auth`, `admin-read`,
  `admin-write`). Here `app-auth` means the handler may enforce the app's own
  `ctx.auth`, not that the transport authenticates the caller — in local v0 it
  does not (see the invariant). The test then asserts every `app-data` entry is a root path,
  every `system-*` entry is under `/_snapback/*`, every `system-api` entry carries
  an admin auth policy, and the router is built from that registry and nothing
  else. Static console routes (`/_snapback/admin*`) are allowed to be public only
  if they serve shell/assets and cannot share handlers with stateful admin API
  operations. The classification is stated exactly once, and a new privileged root
  route fails CI instead of silently widening the boundary.
- **Black-box (fallback):** drive HTTP requests at the known privileged paths
  (`/admin/reset`, `/admin/schema`, …) and assert they are absent from the root
  after migration. This catches regressions of the specific retired aliases but
  cannot stop a brand-new privileged root route, so it is strictly weaker.

The registry is the mechanical guarantee proxies rely on; because axum offers no
route introspection, it is effectively required rather than merely tidy.
The registry must also cover non-HTTP operations carried over upgraded routes
when those operations have authority implications. For example, classifying
`/ephemeral/delete` as system while leaving the WebSocket `ephemeral_delete`
message on `/live/{id}/stream` would not actually remove the operation from the
app-data surface; either both transports are app-scoped, or the system variant
must move behind admin authority in every transport that exposes it.

Two enforcement gaps the route registry cannot close on its own, both surfaced
while settling the decisions below:

- **WebSocket message kinds are invisible to the router.** The registry is built
  into the axum `Router`, but the `/live/{id}/stream` socket dispatches through a
  serde-tagged `match` (`src/server.rs` `handle_live_socket_text`) the router
  never sees. Under D1 all three current socket operations (`ephemeral_publish`,
  `ephemeral_subscribe`, `ephemeral_delete`) are app-data, so the invariant holds
  today — but nothing mechanical stops a future system-authority message kind from
  being added to that `match`. The enforcement test must assert the socket's
  message kinds against the registry directly: enumerate the accepted
  `LiveSocketClientMessage` variants and fail CI if any is not a registered
  app-data operation (or is registered `system-*`).
- **Content trims are invisible to a route-level registry.** D3 keeps `/inspect`
  app-data but trims it by *content*: the public payload omits the `subscriptions`
  connection-id list and the on-disk DB path that the gated twin retains. Because
  the registry classifies routes, not fields, the "boundary cannot silently drift"
  guarantee does not reach this trim. It needs a dedicated field-level test — a
  snapshot/allowlist over the public `/inspect` and `/` payloads — pinned to (a)
  every compatibility fact LLP 0030 attach reads (`schema.appId`, `schema.schemaHash`,
  `schema.inputsHash`, `schema.targetProfile`, `functions.appId`, `functions.bundleHash`,
  `functions.inputsHash`, top-level `targetProfileId` and `schemaVersion`) and (b)
  the *exclusion* of `subscriptions[].connection_id` and `storage.sqlite_path`. The
  durable form is a typed public-inspect projection of `InspectState`, so that
  adding a sensitive field to the struct is a compile error at the projection
  rather than a silent leak.

## Migration plan

1. Add gated system operations under `/_snapback/api/*` for the writes that exist
   only as ungated root aliases today: `/_snapback/api/schema/load`,
   `/_snapback/api/functions/load`, and `/_snapback/api/app/reset` (the reset
   carrying an optional seed argument) — same handlers, behind `authorize(write)`.
   These project the LLP 0024 host-ops surface (`schema.load` / `functions.load` /
   `app.reset`), not a second parallel admin API: this spec says *where authority
   lives*, LLP 0024 says *what the operation contract is*. Seed is not a standalone
   route — LLP 0024 folds it into `app.reset` — so the root `/admin/seed` alias is
   retired without a one-to-one replacement (add an `app.seed` noun to LLP 0024
   first if additive seed-without-reset is ever needed).
2. Repoint callers off the root `/admin/*` aliases and the routes changing class:
   the demo browser boot (moved to managed bring-up per LLP 0030 step 8),
   `demos/_kit/client.mjs`, and the acceptance tests. For the disconnect move (D2),
   repoint the two acceptance callers that disconnect their own synthetic ids —
   `demos/todo/tests/acceptance/headless.mjs:253` and
   `demos/all-aboard/tests/acceptance/cron.mjs:99` — to admin-credentialled calls or
   a self-disconnect stub. `admin-ui/` already uses `/_snapback/api/*`.
3. Apply the resolved classifications (see Resolved decisions): keep
   `/ephemeral/delete` app-data on both transports; keep
   `/ephemeral/collections/ensure` app-data; retire `/ephemeral/collections`
   (register); move `/connections/{id}/disconnect` under `/_snapback/api/*`; trim
   public `/inspect` and `/` to the identity descriptor, leaving operational and
   posture facts to the gated twin.
4. Delete the ungated root `/admin/*` aliases and the retired
   `/ephemeral/collections` register route once no caller depends on them.
5. Add the enforcement test and the declared route registry, including auth policy
   (`public`, `app-auth`, `admin-read`, `admin-write`), the WebSocket message-kind
   assertion, and the field-level public-inspect/`/` snapshot test (see
   Enforcement).
6. Update LLP 0017's serving-model note to point here as the completion of its
   v0-alias retirement, and update LLP 0030's proxy allowlist and validation text
   per Impact on LLP 0030 so the reserved-prefix rule holds once this ships.

## Impact on LLP 0030

Until this lands, LLP 0030's dev proxy keeps its explicit method+path allowlist —
correct under today's interleaved taxonomy, so 0030 is not blocked. Once the
invariant holds and the test guards it, the 0030 proxy can forward the root
app-data surface and refuse `/_snapback/*` as a single rule, and the "ungated
`/admin/reset` through the proxy" footgun disappears at the source rather than
being fenced off per proxy.

The settled classifications change what 0030 must say, and 0030's current text
still treats several of these routes as unclassified or destructive. Concrete
deltas:

- **Move into 0030's forwarded app-route allowlist:** `/ephemeral/delete` (D1)
  and `/ephemeral/collections/ensure` (D4). 0030 currently lists both among the
  "destructive or unclassified" routes the default proxy must refuse; they are
  app-data, and the demo boot needs `ensure`, so refusing them would break the
  very surface 0030 migrates.
- **Keep refused as system:** `/connections/{id}/disconnect` (D2, now settled
  system rather than "unclassified"), `/ephemeral/cleanup`,
  `/ephemeral/collections` (register, D4), the ungated root `/admin/*` aliases
  until retired, and everything under `/_snapback/api/*` — including the new D5
  writes `/_snapback/api/schema/load`, `/_snapback/api/functions/load`, and
  `/_snapback/api/app/reset`.
- **WebSocket parity resolves in 0030's favor:** because delete is app-data in
  every transport (D1), the `/live/*` socket carries only app-data operations, so
  0030's "prove a system-classified live-socket message is refused" validation
  item is satisfied trivially and should be reworded to "confirm every live-socket
  operation is app-data."
- **Attach reads the gated inspect when authorized:** D3 trims public `/inspect`
  but retains every compatibility fact 0030 attach reads. The orchestrator should
  read the gated `/_snapback/api/inspect` when it holds admin authority (a superset
  that also carries the `server` block for mismatch diagnostics) and fall back to
  the trimmed public `/inspect` for identity facts in ordinary unauthorized
  attach.

## Security posture

This spec does not change the admin authorization model, loopback defaults, or
CORS behavior in LLP 0017 — it extends the gated surface to cover the operations
that currently escape it as root aliases, and makes the boundary testable. The
static console lane (`/_snapback/admin*`) remains only a presentation surface:
instance reads and writes still belong behind the `/_snapback/api/*` auth policy.
The enforcement test is the load-bearing artifact: it converts "we drew the
boundary" into "the boundary cannot silently drift."

## Resolved decisions

The five open classifications are settled below (labelled D1–D5 and referenced
from the route table and migration plan). Each was verified against the current
handlers and pressure-tested by two adversarial review passes; the *semantics* of
each ephemeral operation still defer to LLP 0013, while the *authority class* is
settled here.

**D1 — Ephemeral delete is app-data, in both transports.** `/ephemeral/delete`
and the WebSocket `ephemeral_delete` message both route to `EphemeralStore::delete`,
which enforces `ensure_authorized(&collection.publish, …)` — the *same* check
`publish` runs. Delete therefore carries publish-parity authority: an operation an
app client legitimately makes, not instance control. Both transports stay app-data
(root and `/live/*`); no split and no separate admin route is introduced here. Two
caveats are recorded rather than hidden:

- *Not "cleanup's twin."* An earlier framing justified this by pointing at
  `/ephemeral/cleanup`'s gated twin as the admin counterpart. That is a category
  error: cleanup sweeps only TTL-*expired* entries, whereas delete removes a
  caller-named key regardless of expiry. LLP 0017 specifies an admin "delete a
  specific entry" control and still lists it as an open capability gap; that gated
  operation is unbuilt and out of scope here.
- *"Own entry" is aspirational under the current policy.* The check is "may you
  publish to this scope," not "do you own this entry." Under the `AllowAll` default
  the demos use, any client that may publish may delete *any* entry in the
  collection. The store already tracks `owner_connections` (and uses it correctly
  on disconnect) but `delete` ignores it. True own-entry semantics are a separate
  hardening — compare `request.connection_id` against the caller via
  `owner_connections` — that should be sequenced *before or with* the LLP 0030
  proxy switch that forwards delete wide-open (see Open questions), not treated as
  unrelated.

**D2 — `/connections/{id}/disconnect` is system/control; move it under
`/_snapback/api/*`.** The handler takes the connection id from the path and calls
`LocalSnapback::disconnect` with no ownership or auth check, and that method does
two destructive things — ephemeral disconnect *and* tearing down the connection's
durable live subscriptions. That is instance control, and LLP 0017 already classes
"disconnect a connection" as an admin-write. It is *not* symmetric to delete:
delete models authority over its target (a publish scope), disconnect models none
(a raw id → teardown). Any genuine app-scoped "disconnect myself" is a *separate*
future operation that derives the connection from the caller's own context and
takes no arbitrary path id; over the socket, closing the stream already
disconnects, so the HTTP route is not the app path. This decision and D3 are
jointly load-bearing: `/inspect` currently emits `subscriptions[].connection_id` —
exactly the id `disconnect` consumes — so today any unauthenticated caller can
enumerate every live connection and disconnect it. Gating disconnect removes the
act; trimming the connection list from public `/inspect` (D3) removes the
enumeration; neither alone closes the hole.

**D3 — `/inspect` stays app-data but is trimmed to an identity descriptor;
operational and posture facts live only in the gated twin.** The public `/inspect`
and `/` should expose the app-identity/compatibility facts a client or an
unauthorized `attach` needs to confirm it is talking to the right backend — the
`schema` and `functions` manifests (`appId`, `schemaHash`/`bundleHash`,
`inputsHash`, `targetProfile`), `targetProfileId`, and `schemaVersion` — and
nothing that is either an attack vector or an environment leak. Two facts move out
of the public payload: `subscriptions[].connection_id` (the D2 enumeration
ammunition) and the absolute `storage.sqlite_path` (`/` reveals it in prose today).
The gated `/_snapback/api/inspect` already returns everything via
`#[serde(flatten)]`, so this is a *removal* from the public payload, not new work
on the gated one. Because a route-level registry cannot see a field trim, this is
guarded by the field-level test in Enforcement, ideally as a typed projection of
`InspectState`. The public payload should *not* be shrunk to bare identity in one
step — the demo acceptance tests read benign operational counters (`ephemeral.*`,
`liveDelivery.*`, `storage.version`) off the public read; those may stay public or
be repointed to the gated twin (Open questions), but the two *sensitive* fields go
regardless.

**D4 — Split the collections routes: `ensure` is app-data, `register` is system.**
These are different operations. `/ephemeral/collections/ensure` is *validate-only*
— it errors if the named definitions are not already loaded or do not match, and
mutates nothing — so it is a compatibility read the app legitimately makes at boot
(the cursors demo boots with it); it stays app-data at the root.
`/ephemeral/collections` (register) is an unconditional, ungated overwrite of a
collection's definition *including its `publish`/`subscribe` `AccessPolicy`* — the
ephemeral twin of `schema.load`, and a privilege-downgrade vector (it can reset a
`RequireRoomPermission` collection to `AllowAll`). It has no caller, and collection
definitions already ride in each app's `schema.manifest.json` (`ephemeralCollections`,
loaded via `replace_collections`), so its job belongs to `schema.load`. Retire it
(preferred, since it is dead) or, if a standalone ephemeral-definition load is ever
wanted, gate it under `/_snapback/api/*`.

**D5 — Migrated writes are flat `subsystem/verb` under `/_snapback/api/*`, not
nested under `/admin/`.** The gated replacements are `/_snapback/api/schema/load`,
`/_snapback/api/functions/load`, and `/_snapback/api/app/reset`, matching the
existing `resource/verb` peers (`cron/tick`, `ephemeral/cleanup`,
`functions/{name}/run`) and mirroring the LLP 0024 host-ops nouns (`schema.load`,
`functions.load`, `app.reset`). A `/_snapback/api/admin/reset` shape is rejected
twice over: "admin" is redundant inside an already-admin namespace, and it
re-imports the exact v0 alias name (`/admin/reset`) the migration retires. Seed is
*not* a fourth route — LLP 0024 folds it into `app.reset` as an optional argument —
so the root `/admin/seed` alias is retired without a standalone replacement; if
additive seed-without-reset is later needed, add an `app.seed` noun to LLP 0024
(which owns the host-ops contract) first.

**Registry mechanism (settled: yes).** The single compile-time route registry the
Enforcement section describes is adopted, not merely suggested: because axum
exposes no route introspection, it is the only mechanical guarantee proxies can
rely on, and it now also carries the WebSocket message-kind assertion. The
field-level inspect trim (D3) rides alongside it as a separate typed-projection
test.

## Open questions

- **Own-entry delete hardening sequencing (D1).** Should the `owner_connections`
  check that turns delete into a true own-entry operation land *before* the LLP
  0030 proxy starts forwarding `/ephemeral/delete`? Under `AllowAll` the forwarded
  route lets any publisher delete any entry; that is acceptable for the cursor
  demos but should be a conscious sequencing call, not a default.
- **How far to shrink public `/inspect` (D3).** Keep the benign operational
  counters (`ephemeral.*`, `liveDelivery.*`, `storage.version`) on the public read
  for the acceptance tests, or repoint those reads to the gated twin and let the
  public payload collapse to the pure identity descriptor? The sensitive fields go
  either way; this is about how small the public surface ultimately gets.
- **`/ephemeral/collections` (register): retire or gate (D4)?** Retiring is
  cleanest since it is dead and its job is `schema.load`'s; gating it under
  `/_snapback/api/*` is the fallback only if a standalone ephemeral-definition load
  turns out to be wanted.
- **Static console on non-loopback binds (carried from the GPT-5 review).** Should
  `/_snapback/admin*` shell/assets be disabled or token-gated when the server binds
  a non-loopback address, or is public shell/asset serving acceptable as long as
  all data and control still flow through the gated `/_snapback/api/*`?

## Status

Draft. The five ambiguous classifications are now settled (see Resolved
decisions), so the spec is ready to drive the route-registry implementation —
starting with the gated `/_snapback/api/{schema/load, functions/load, app/reset}`
equivalents so the ungated root aliases can be retired without breaking the demos
and tests that still call them. Two things gate a move toward `Accepted`: a fresh
cross-family review of the revised spec (the one independent pass — the GPT-5
review above — predates these decisions), and the author's call on the sequencing
question in Open questions (own-entry delete vs the proxy switch). Status changes
are the author's; this pass proposes keeping it `Draft` pending that review.
