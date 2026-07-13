# LLP 0031: Server route taxonomy and authority boundary

**Type:** Spec
**Status:** Active
**Systems:** Local server lifecycle, HTTP surface, Security/authorization, Admin API, Client integration, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-01
**Revised:** 2026-07-13 (ENG-24596 final audit: registered the console-credential and secret-read-mint routes, the `SecretReadMintProof` effect, and rescue's dev/test-only profile); 2026-07-13 (ENG-24596: registered provider challenge/family-alarm credential cases, the public no-store response class, and the installed provider/mailbox/auth host-operation rows); 2026-07-13 (ENG-24594: made the route registry the enforceable router source; added independent path, credential-resolution, invocation-authority, legacy-body, effect, response-sensitivity, and session-overlay axes; re-scoped `AppAuth` to dev-mode client assertion; and pinned the complete existing-route × auth-mode matrix and metadata-driven acceptance sweep); 2026-07-13 (final audit hardening: the local durable-live registry now enforces the hosted proof's 2,048-global/64-per-connection ceilings before initial query execution, with net-zero supersession and typed 429 diagnostics); 2026-07-12 (ENG-24560/ENG-24571: the typed public-inspect projection now removes per-room ephemeral identities/scopes and client-mutation retention internals, exposing aggregate ephemeral health only); 2026-07-12 (ENG-24566: local connection grants are fixed-cap, prefer unused eviction, refuse while all used leases are current, and retire idle used grants only with stale-socket termination plus permanent minted-id fallback); 2026-07-12 (ENG-24347/ENG-24354/ENG-24358 review follow-up: hosted subscription rows, canonical args, and accepted sockets now have hard advertised ceilings, including the legacy proof socket; persisted over-limit state fails recoverably through health/reset; ENG-24347/ENG-24352/ENG-24354/ENG-24358: optional request bodies fail closed, WebSocket query-token transport is retired, hosted subscriptions and frames are bound to the current socket session so an obsolete socket cannot act for its replacement, and hosted durable connection grants are bounded and reaped; earlier: 2026-07-01 status → Active: LLP 0032 S1 implemented the full migration and the declared route registry with enforcement tests, verified against a running server; earlier same day status → Accepted, ratified in the LLP 0032 R1 batch: the five classifications are settled, LLP 0032 S0 landed the interim gate; author self-review pass: corrected the invariant's auth framing — app routes carry app-supplied `ctx.auth`, not server-enforced auth, and several are public; noted axum's `Router` is not route-introspectable so the declared registry is required for enforcement; aligned the new gated writes with the LLP 0024 host-ops projection; made explicit that the reserved-prefix proxy rule is safe only because the enforcement test holds. Not an independent review — this session authored the draft. GPT-5 review clarified that `/_snapback/admin*` is a static console shell/assets lane, not itself an `authorize()`-gated API; required the route registry to record auth policy as well as path class; and made WebSocket-carried operations part of the taxonomy so `/live/*` cannot smuggle a system operation. A further author self-revision then lifted that WebSocket insight into the normative invariant — the classified unit is the operation, not just the URL path — and clarified that the registry's `app-auth` policy means handler-enforced `ctx.auth`, not transport authentication. Still not an independent review; the GPT-5 pass above is 0031's one independent review so far. A subsequent Claude session then settled the five open-question classifications with the author and wrote them into the spec below, driven by three code-verification sub-agents and two adversarial Claude review passes over the decisions. That work corrected decision 4 — `/ephemeral/collections` (register) is an ungated definition-overwrite with no caller and is now classed system, split from the validate-only `/ephemeral/collections/ensure`, which stays app-data — dropped a category error in the delete rationale, folded seed into `app.reset` per LLP 0024, and added a field-level inspect test the route registry cannot substitute for. This remains a same-family Claude pass, not the independent review 0031 still owes: the GPT-5 review above predates these decisions, so a fresh cross-family pass over the revised spec is the outstanding review debt. 2026-07-04 (ENG-22798): added §Server-binary identity on /health — the ungated `/health` now carries a build-identity block (crate version + git commit/dirty + a per-process startup nonce) so an externally started, unprovisioned or schema-only server is reuse-verifiable before any app bundle loads; the reuse-provenance verdict falls back to it when bundle identity is unavailable. Still a same-family Claude pass; the cross-family review debt above stands. 2026-07-07 (ENG-23441): D3 tightened — the public `functions` manifest is now itself a typed projection (`PublicFunctionManifest`) that drops executable handler bodies (`IbexModule.source`, `HandlerPlan` step bodies) and `sourceSpan`; full handler source lives only on the gated twin, and the field-level trim test gains a whole-payload source-sentinel assertion. Same-family Claude pass; the cross-family review debt stands. 2026-07-07 (ENG-23365): §Server-binary identity — the build.rs stamp now tracks the binary's real inputs (src/, Cargo.toml, Cargo.lock, refs/heads, packed-refs) so incremental rebuilds and ref-only moves re-stamp instead of replaying a stale commit/dirty pair. 2026-07-07 (ENG-23419): §Server-binary identity — the dirty probe now maps `git status --porcelain` success-with-empty-output to `gitDirty: false` instead of conflating it with command failure, so a clean checkout can actually earn binary-provenance reuse. 2026-07-07 (ENG-23442): added §Connection capability grants and the `connection-auth` registry policy — connection ids are no longer caller-chosen bearerless capabilities; `POST /connection/open` mints a per-connection token (idempotent re-open under the current token; suggested ids adopted only in non-prod), and `/live/*`, `/outbox/{id}`, and the ephemeral publish/subscribe/delete routes require it, with `/outbox/{id}` reclassified from Public. Same-family Claude pass; review debt stands.)
**Related:** LLP 0000, LLP 0003, LLP 0011, LLP 0012, LLP 0013, LLP 0017, LLP 0023, LLP 0024, LLP 0025, LLP 0030, LLP 0039, LLP 0051, LLP 0054

ENG-24594's implementation hardening makes the sessions overlay executable
through the real router and socket dispatcher in embedded acceptance state,
without selecting sessions in production before the staged resolver lands. It
also closes invalid policy tuples, method/preflight drift, body-carried
connection-token ordering, multiplexed-operation dispatch and 401/403 parity,
raw legacy-authority field rejection, selected-operation extension propagation,
and conservative response-control inheritance.

## Summary

The Snapback HTTP server draws one clean boundary between **app-data routes**
and **system routes**, and enforces both placement and authority from the same
registry that constructs the router. App-data routes — the operations an
ordinary app client is meant to call — live at the server root and either resolve
app authority according to the active auth mode or are explicitly public.
System routes — schema/function
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
- [LLP 0039](./0039-auth-vertical-slice.rfc.md) defines server-resolved session
  authority. This spec owns the route-policy vocabulary and complete existing
  route matrix that makes 0039's authority boundary mechanically enumerable.

## The invariant

> Every route the server exposes is either an **app-data route** or a **system
> route**. App-data routes live at the server root; they are the operations an app
> client may call. In `dev` auth mode only, `AppAuth` permits client-supplied
> `ctx.auth` as local-development impersonation. In `sessions` mode, authority is
> resolved by the server from the session bearer or the bound connection grant;
> client-auth-bearing body fields are rejected, never trusted or silently
> ignored. (Several routes, like `/health` and `/`, are simply public.) System
> routes live under `/_snapback/*`. System API routes
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
not synonymous with transport-authenticated: dev mode deliberately permits the
client-asserted identity inherited from local v0, while session mode resolves
authority at the transport boundary. The split is therefore about *what the operation is for* —
app-scoped data an app client should call vs instance-level control an operator,
agent, or dev tool should call — not read vs write, and not authenticated vs not.

## Route classification

Current surface (`src/server.rs` `core_routes`, `src/admin.rs` `admin_routes`)
and its target home:

| Route today | Gating today | Class | Target |
| --- | --- | --- | --- |
| `/` (instance status; content-negotiated HTML/YAML/JSON/Markdown, YAML default — LLP 0017 §Instance home page) | none | app-data/public read | root — keep; trim the on-disk DB path per D3. Negotiation changes the rendering, never the payload's public scope |
| `/health` | none | app-data | root — keep |
| `/query/{name}` | app auth | app-data | root — keep |
| `/mutation/{name}` | app auth | app-data | root — keep |
| `/connection/open` | none (grants, never exercises) | app-data | root — added by ENG-23442 (§Connection capability grants) |
| `/live/{name}/subscribe`, `/live/{name}/resume`, `/live/{id}/stream` | connection token + app auth | app-data | root — keep (connection-auth since ENG-23442) |
| `/outbox/{id}` | connection token | app-data | root — keep (connection-auth since ENG-23442; was Public) |
| `/ephemeral/publish`, `/ephemeral/subscribe` | connection token | app-data | root — keep (connection-auth since ENG-23442) |
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

Historical note: at this spec's first draft, the gated schema-load,
functions-load, and reset operations did not yet exist under `/_snapback/api/*`.
The LLP 0032 S1 migration added them and retired the ungated root aliases; the
matrix below describes the post-migration surface.

## Enforcement

The invariant is durable only when the registry has runtime teeth. Axum's
`Router` cannot enumerate its routes, so two separately maintained literal
lists — one that constructs the router and one that describes it — cannot prove
parity. The old `core_routes()` / `system_routes()` / `admin_routes()` builders
plus a descriptive `route_registry()` were therefore insufficient: a new
`.route(...)` could bypass the registry, and a policy label could have no effect.

### Independent policy axes

Each registered HTTP route is a `RegisteredRoute { spec, method_router }`.
`RouteSpec` retains method, path, and `RouteClass`, and records these independent
closed axes. They are independent because a policy names what must be proven,
not which carrier happens to prove it, and because response safety cannot be
inferred from request authority:

| Axis / type | Required cases and meaning |
| --- | --- |
| `RoutePolicy` (path policy) | `Public`; `AppAuth` (**dev mode only**, client-asserted local impersonation); `ConnectionAuth` (valid server-minted connection capability); `SessionAuth` (a live user session is required); `AdminRead`; `AdminWrite`; `AdminSecretRead` (an operator-plane-derived, scoped secret-read lease is required even on loopback; neither the ordinary admin bearer nor a persisted console credential satisfies it) |
| `CredentialResolution` | `None`; `LegacyBodyAuth`; the distinct HTTP connection carriers `ConnectionGrantHeader`, `ConnectionGrantHeaderOrWebSocketSubprotocol`, and dev-only `ConnectionGrantHeaderOrDevQuery`; `BoundConnectionGrant` for an operation already inside an authenticated connection; `AdminCredential`; `OptionalSessionBearer` (a presented bearer is always validated); `RequiredSessionBearer`; `AdminSecretReadLease`; provider-specific `ChallengeProof` and `FamilyAlarmBearer`; or `OperationSpecific`. Distinct carriers are never substitutable merely because they are all bearer strings. `ChallengeProof` keeps email-code exchange distinct from anonymous `None`; `FamilyAlarmBearer` is revoke-only and never resolves invocation authority |
| `InvocationAuthority` | `None`; `ClientAsserted` (dev only); `ResolvedCaller`; `ConnectionBound`; `Operator`; `AnonymousAdminBypass`; `System`; and `DevImpersonation` for host-ops identity selection. This is the authority projected into the invocation, not the path credential; `DevImpersonation` never aliases `ResolvedCaller` |
| `LegacyBodyPolicy` | `NotApplicable`; `Allowed` (dev only); or `Rejected`. Presence must survive deserialization so explicit `null`, a defaulted object, `ctx_ledger.auth_fingerprint`, and sibling ephemeral/live owner fields cannot collapse into absence |
| `EffectPolicy` | `None`; `Provisioning`; `FunctionKind`; `OperationSpecific`; `SecretReadMintProof`; `ImpersonationCapability`; or `Unavailable` for a branch that exists in dev but is categorically refused in sessions. `SecretReadMintProof` composes `AdminWrite` with the one-shot operator proof bound to exact lease scope/budgets; the admin credential alone cannot mint a secret-read lease. `ImpersonationCapability` independently composes with `AdminWrite`: the browser-held console/admin credential and `AdminSecretRead` lease satisfy neither it nor each other |
| `ResponseSensitivity` | `StaticPublic`; `PublicProjection`; `PublicNoStore` for a fixed typed public response that still must not be cached or body-logged; caller-scoped `ApplicationData`; `ConnectionSecret`; `OperatorMetadata`; raw/open `SensitiveApplicationData`; or `CredentialSecret`. `SensitiveApplicationData` includes both app-derived and identity-derived values: rows, subjects, handler results/errors, executable source, query arguments, receipt correlation/scope, addresses, sessions, and config values. `PublicNoStore`, `ConnectionSecret`, and `CredentialSecret` are always `no-store` |
| `SessionModeOverlay` | optional overrides for `path_policy`, `credential_resolution`, `invocation_authority`, `legacy_body_policy`, `effect_policy`, and `response_sensitivity`. `NONE` means every axis is invariant. `RouteSpec::effective_for(PolicyAuthMode::{Dev,Sessions})` applies the overlay exactly once; an unknown mode or incomplete required overlay fails closed |

`RouteSpec::effective_for(dev | sessions)` materializes one
`EffectiveRoutePolicy`; the middleware consumes that value rather than
re-interpreting the axes. `AppAuth` has no sessions meaning by itself. A route
that accepts client-asserted `ctx.auth` in dev must carry an overlay that selects
server-resolved caller or bound-connection authority and rejects the complete
auth-bearing field family in sessions. `SessionAuth` means a user-bearing live
session is mandatory; an optional-user app invocation uses optional session
resolution instead and then applies the function's `authRequirement` at the
shared invocation gate.

Response sensitivity is enforceable structurally, not by scanning serialized
JSON after a handler runs. Registry validation rejects a Public or tokenless
`AdminRead` entry whose response can carry app-derived or identity-derived
content unless the entry names an exhaustive typed projection. Credential and
capability responses, plus `PublicNoStore` provider responses, set
`Cache-Control: no-store` and are excluded from body capture, access logs,
diagnostics, and receipts. Raw/open response types require `AdminSecretRead`
under sessions when they can reveal data or identity. Exhaustive projection and
secret-sentinel tests remain necessary because no route middleware can prove a
field was omitted.

### Router↔registry parity and the centralized gate

The registered-route collection is the **only** source used to construct
`app()`. Folding its `method_router` values into an axum router installs the
corresponding `RouteSpec` and centralized policy middleware on every entry.
`route_registry()` is a read-only projection of those same registered objects,
not a second declaration. Production code must not call `.route(...)` outside
that construction seam; grouping helpers may return registered entries but may
not return an already-populated router. Thus an unregistered HTTP handler is
unreachable, and a registered handler cannot run without its effective policy
being resolved first.

Each registered path also receives one fixed, no-effect `OPTIONS` preflight
inside that same fold; GET carries axum's standard HEAD projection. The CORS
middleware adds headers but cannot manufacture a method for an unknown path.
The method-parity sweep probes the full standard method family, so an opaque
`MethodRouter` cannot hide an undeclared second handler.

The central middleware rejects a missing/invalid required carrier before the
handler, preserves the distinction between 401 authentication failure and 403
effect/authorization failure, installs only the resolved authority selected by
the entry, applies mode/profile refusal, and attaches response controls. A
handler may enforce finer domain authorization, but handler-local checks do not
substitute for the registered transport/effect policy. The staged auth-mode
state and shared function-invocation gate land later in the 0039 order. Item 1
supplies the closed policy representation and an embedded `AppState` mode seam
which executes the sessions overlay through the actual middleware and socket
dispatcher for acceptance; every production constructor still selects `dev`
until item 4 installs the staged resolver.

For body-carried connection ids, the central gate authenticates the presented
bearer before JSON extraction, then verifies the exact id/token pair from one
bounded raw-body peek before rebuilding the body for the typed handler. The
same peek preserves explicit `null` and rejects only authority-bearing wrapper
locations (`request`, `input`, and the context-ledger auth fingerprint), not
identity-looking application keys inside args, values, scopes, correlation, or
permission maps.

Before item 4 supplies that runtime-mode resolver, attempting to install a
route whose base policy is `SessionAuth` or `AdminSecretRead` fails closed as
HTTP 503 `SNAPBACK_AUTH_POLICY_UNAVAILABLE`. This is an implementation-order
backstop, not a third auth mode and not a credential verdict: item 1 installs no
such route, and item 4 replaces the backstop with the real active-mode
credential resolver before session routes become reachable.

HTTP is not the only registry. `operation_registry()` exhaustively enumerates
the three `/app/ensure` intent branches, WebSocket message kinds, the direct
runner's query/mutation/unknown split, and each multiplexed host-op whose
credential, authority, effect, or response policy differs. Dispatch matches
must be exhaustive over the same closed operation types. The outer HTTP entry
may select `operation-specific` or `function-kind` resolution, but an unknown
operation fails at the stronger policy and never inherits the weakest known
branch. For example, leaving WebSocket
`ephemeral_delete` or host-ops `function.run --as-user` outside the operation
registry would be a policy bypass even if the carrier route were registered.
The selected `OperationSpec` and its effective policy are installed into the
request extensions after authorization; downstream invocation code never sees
the weaker outer carrier row as the selected authority. Response controls use
the stricter of the carrier and selected-operation sensitivity.

### Complete existing-route × auth-mode matrix

This matrix is normative for every route and multiplexed operation that exists
when ENG-24594 lands. `Dev` means the non-production, loopback development
posture; it does not waive an existing connection or admin credential. `Sessions`
is the effective target policy after the later 0039 items supply session
resolution. `MODE_PENDING` is the staged-mode overlay owned by LLP 0039/0012:
ordinary app data and Public attestation refuse with
`SNAPBACK_AUTH_MODE_PENDING`, while public health/identity, the bootstrap auth
handshake, and operator recovery remain reachable. A `prod` profile paired with
`dev` auth serves health/identity but refuses all ordinary app-data operations;
sessions are the only production app-data posture.

Response labels below are part of `ResponseSensitivity`: **public metadata** is
a fixed server fact; **typed public projection** may expose app identity and
aggregates only through exhaustive projection; **admin metadata** excludes app
and identity values; **app-derived** may carry rows, arguments, results, source,
or handler-controlled text; **identity-derived** may carry a subject or session;
and **credential** includes any token, code, or delegated capability. A row that
names more than one sensitivity carries the strongest applicable controls.

#### App-data HTTP and WebSocket surface

| Existing route / operation | Dev effective policy | Sessions effective policy | `MODE_PENDING` | Response sensitivity |
| --- | --- | --- | --- | --- |
| `GET /`, `GET /inspect` | `Public`; no caller authority | unchanged | serve | typed public projection; exhaustive public-vs-gated sentinel |
| `GET /health` | `Public`; no caller authority | unchanged | serve | public metadata only |
| `POST /query/{name}` | `AppAuth`; client body auth becomes dev authority | optional session bearer; server-resolved caller; reject every body auth field; function `authRequirement` decides whether anonymous is allowed | refuse | app-derived result, scoped to resolved caller |
| `POST /mutation/{name}` | `AppAuth`; client body auth becomes dev authority | optional session bearer; server-resolved caller; reject every body auth field; shared invocation/write gate applies | refuse | app-derived result/receipt, scoped to resolved caller |
| `POST /action/{name}` | same `AppAuth` dev authority | same optional session resolution and body rejection before detached execution | refuse | app-derived `FunctionRunResult` envelope |
| `POST /client-mutations/acknowledge` | `AppAuth`; client body auth supplies dev ownership | optional session bearer; resolved caller plus the later authority-descriptor check; reject body auth and public `ctx_ledger.auth_fingerprint` | refuse | typed settlement metadata; any echoed app value is forbidden |
| `POST /app/ensure` legacy/untagged dev form | `Public`; exact LLP 0012 `snapback.v0` + `dev` compatibility only | reject; sessions requires an explicit branch | refuse | typed identity/provisioning result; never a manifest echo |
| `POST /app/ensure { intent: "attest" }` | accepted only where LLP 0012 permits the explicit compatibility form; compare-only | `Public`; exact identity-only pair, no manifests/seed/mode material/unknown fields, and no mutation | refuse | typed public identity/hash projection |
| `POST /app/ensure { intent: "provision" }` | provisioning authority/profile gate; legacy dev startup remains compatible | `AdminWrite` or pre-bind startup authority; branch gate runs before hashes or effects | **sole app-schema recovery exception**; same privileged gate | admin metadata/effect result; no secret/config value echo |
| `POST /connection/open` | `Public`; closed DTO; no caller identity; `previousToken` proves only grant ownership | optional current session bearer; bind resolved anonymous/session authority; body identity fields forbidden; per-source throttle | refuse | secret delegated connection capability; `no-store`, never logged/retained |
| `POST /live/{name}/subscribe`, `/resume`, `/unsubscribe` | `ConnectionAuth`; connection token plus client body auth as dev authority | connection token resolves its bound authority; reject live owner/body auth; auth-scoped registration remains refused until 0039 item 6, while explicitly authority-independent live may proceed | refuse | app-derived live snapshot/metadata, scoped to bound authority |
| `GET /live/{connection_id}/stream` | `ConnectionAuth`; header or WebSocket subprotocol token; no URL credential | bound connection authority; header/subprotocol only; revoked/expired authority closes the stream | refuse | app-derived delegated stream; never cache |
| `GET /outbox/{connection_id}` | `ConnectionAuth`; header token, with the documented dev-only query fallback | bound connection authority; **reject** `?connection_token=` and require the header | refuse | app-derived delegated queue; never cache |
| `POST /ephemeral/collections/ensure` | `Public`; validate-only compatibility check | unchanged closed, identity-free DTO | refuse | typed definition compatibility metadata, no values |
| `POST /ephemeral/publish`, `/subscribe`, `/delete` | `ConnectionAuth`; body auth is dev authority in addition to the connection token | bound connection authority; operation-specific closed DTO rejects all legacy identity/auth siblings; protected auth-scoped rooms remain admission-refused until item 6, and custom-key authorization remains refused until separately designed | refuse | app-derived ephemeral result/metadata, scoped to bound authority |
| WS `ephemeral_publish`, `ephemeral_subscribe`, `ephemeral_delete`, `ephemeral_unsubscribe` | same connection and dev-body authority as the HTTP twin | same bound authority and closed body-auth rejection as the HTTP twin | refuse/close | app-derived frames, never cache |
| WS `live_ping` | authenticated connection capability; no app identity field | authenticated bound connection; no client authority field | refuse/close | public transport metadata only |

The sessions body rejection in this table is a **family**, not a check for one
field spelling: nested `HandlerInput.auth`; live resume/unsubscribe owner auth;
ephemeral `auth`, `principal`, `user_id`, `session_id`, and equivalent sibling
identity fields; and `ctx_ledger.auth_fingerprint` are all rejected when present,
including explicit `null`. The replacement authority always comes from the
resolved session or bound connection grant.

#### System HTTP and multiplexed operation surface

| Existing route / operation | Dev effective policy | Sessions effective policy | `MODE_PENDING` | Response sensitivity |
| --- | --- | --- | --- | --- |
| `GET /_snapback/admin`, `/`, `/setup`, `/{*path}` under that prefix | `Public` system-static presentation only | unchanged; the shell gains no data/control authority | serve | fixed static assets only; app/client-page XSS contract is separate |
| `GET /_snapback/api/health` | `AdminRead` (tokenless loopback remains the LLP 0017 compatibility posture) | unchanged | serve | typed admin metadata only |
| `POST /_snapback/api/console/credential` | `AdminWrite`; the configured/master credential is presented once | unchanged; neither a session nor a secret-read lease substitutes | serve if the admin gate succeeds | short-lived process-bound ordinary console credential; `CredentialSecret`, no-store |
| `POST /_snapback/api/admin-secret-read/mint` | `AdminWrite` **plus `SecretReadMintProof`** bound to the exact finite scopes, TTL, and row/byte budgets | unchanged; a URL, console credential, session, or unbound proof cannot select/mint | serve only if both independent gates succeed | short-lived scoped `sbrl_` lease; `CredentialSecret`, no-store |
| `GET /_snapback/api/inspect` and host-op `app.inspect` | write-grade admin bearer under the shipped sensitive-read compatibility rule | `AdminSecretRead`; ordinary admin/console credentials are insufficient | serve if the stronger gate succeeds | app-derived and operator-secret full projection |
| `GET /_snapback/api/receipts` | `AdminRead` | `AdminSecretRead`; the raw receipt shape can carry correlation and scope | serve if the stronger gate succeeds | app-derived raw receipt data |
| `GET /_snapback/api/data/{table}` | `AdminRead`, row/byte caps still apply | `AdminSecretRead`; live lease must name the table, have no wildcard, and retain row/byte budget | serve if the stronger gate succeeds | raw app- and possibly identity-derived rows |
| `POST /_snapback/api/functions/{name}/run` — query | operation/function-kind `AdminRead`; optional body user is dev impersonation | `AdminSecretRead` covering every table/response exposed; anonymous handler projection plus `adminBypass`; reject body auth; refuse on `prod` | serve if the stronger gate succeeds | app-derived handler result |
| same direct runner — mutation | operation/function-kind `AdminWrite`; optional body user is dev impersonation | `AdminWrite`; anonymous handler projection plus `adminBypass`; reject body auth; refuse on `prod` | serve if the stronger gate succeeds | app-derived result behind an explicit write credential |
| same direct runner — action | operation/function-kind `AdminWrite`; optional body user is dev impersonation | `AdminWrite`; anonymous handler projection plus `adminBypass`; reject body auth; refuse on `prod` | serve if the stronger gate succeeds | app-derived action envelope behind explicit write credential |
| same direct runner — unknown kind | stronger outer gate, then handler/profile validation | no implicit query fallback; refuse without a registered function-kind branch | refuse branch | unclassified response is not emitted |
| `POST /_snapback/api/schema/load`, `/functions/load`, `/app/reset`, `/client-mutations/purge`, `/connections/{connection_id}/disconnect`, `/cron/tick`, `/cron/{name}/run`, `/ephemeral/cleanup` | `AdminWrite`; existing non-prod/profile restrictions still apply; cron invokes as `system` | unchanged path credential and system/no-user authority; client auth is never accepted | serve if admin/profile gate succeeds | effect/admin metadata; cron/function outputs are app-derived behind `AdminWrite` |
| `GET /_snapback/api/config/status`, `/config/plan` | `AdminRead` | unchanged **only because** closed projections expose declarations/status and never config values | serve | typed admin metadata; value sentinel required |
| `POST /_snapback/api/config/set`, `/unset`, `/verify` | `AdminWrite` | unchanged; no session/admin credential substitution | serve | effect/admin metadata; config values never echo |
| outer `POST /_snapback/api/host-ops` | operation-specific; unknown/unbuilt operations take the stronger gate | operation-specific; outer route is not authority for a weaker inner branch | serve only for a permitted operation | operation-specific |
| host-ops `app.reset`, `schema.load`, `functions.load` | `AdminWrite`, non-prod | unchanged; no caller identity | serve if gates succeed | effect/admin metadata |
| host-ops `function.explain` | `AdminRead`; an optional user selector is dev-only client assertion | `AdminSecretRead`; anonymous projection; reject the user selector because the frozen 0039 impersonation surface names `function.run`, not explain | serve if stronger gate succeeds | app-derived dry-run report |
| host-ops `function.run` query without identity selector | `AdminRead` | `AdminSecretRead`; anonymous projection plus `adminBypass`; refuse on `prod` | serve if stronger gate succeeds | app-derived handler result |
| host-ops `function.run` mutation without identity selector | `AdminWrite` | `AdminWrite`; anonymous projection plus `adminBypass`; refuse on `prod` | serve if gate succeeds | app-derived result behind explicit write credential |
| host-ops `function.run --as-user/--as-role` | `AdminWrite`; resolves `devImpersonation`, never a real session; non-prod only | `AdminWrite` **plus `ImpersonationCapability`**; still resolves `devImpersonation`, never real session authority; refuse on `prod` | serve only if both gates succeed | identity- and app-derived; audit-marked |

The secret-adjacent choice left open by LLP 0039 is settled here: full admin
inspect, raw receipts, raw table scans, query runner output, and dry-run/explain
output become `AdminSecretRead` under sessions. Admin health and config
status/plan stay `AdminRead` only through closed typed projections that cannot
contain rows, handler-controlled text, identity subjects, or config values. An
ordinary admin bearer is not a secret-read fallback, even on loopback.

ENG-24596 installs the provider witnesses without activating session mode:
`POST /auth/request-code` is `None` plus `PublicNoStore`; `/auth/exchange` uses
`ChallengeProof` plus `CredentialSecret`; `/auth/refresh` and `/auth/logout`
use `SessionAuth` plus `RequiredSessionBearer`; and `/auth/family-alarm` uses
the revoke-only `FamilyAlarmBearer`. The mailbox and host-ops
`auth.mintSession` / `auth.rescueCollidingTable` combine `AdminWrite` with the
non-substitutable `ImpersonationCapability`; mint remains fenced until item 4
activates sessions. Mint is profile-bounded to dev/demo/test, while collision
rescue is deliberately narrower and refuses demo as well as prod. LLP 0054 owns provider/keyring semantics and the complete
DTO table. Item 4 still owns persisted mode resolution, so production
construction remains in `dev` and provider routes return the typed no-store
`SNAPBACK_AUTH_MODE_DEV` refusal there.

### Acceptance for the enforceable registry

The route-policy suite is derived from registry metadata and proves all of the
following:

1. The router is folded from `RegisteredRoute` values only; `route_registry()`
   projects those exact values. A test-only route cannot be made reachable
   without a complete `RouteSpec`, and deleting a registry entry makes its HTTP
   path unreachable. Retired root aliases remain absent.
2. Every entry satisfies path/class invariants, has a complete effective policy
   in both `dev` and `sessions`, and rejects unknown modes, incomplete overlays,
   invalid policy/credential combinations, and a Public/tokenless response
   classified as raw app- or identity-derived.
3. A denial happens before a sentinel handler side effect. Missing/invalid
   session, connection, admin, secret-read, and impersonation carriers exercise
   the registered 401/403 outcome; credential classes have a non-substitutability
   matrix rather than a generic "some bearer" positive.
4. An exhaustive expected-route set equals the HTTP registry's method/path set.
   The closed `/app/ensure` intent family, WebSocket message enum, direct-runner
   function-kind branches, and host-op operation names likewise equal
   `operation_registry()`; unknown operations take the strongest refusal.
5. A registry-metadata-driven sessions sweep sends every client-auth-bearing
   field spelling, both populated and explicit `null`, through every
   `AppAuth`/`ConnectionAuth` HTTP route, every WebSocket operation, and every
   registered direct-runner branch. Each returns
   `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED`, and the handler/operation sentinel is
   untouched. The same valid dev fixtures retain their declared compatibility.
6. The matrix is exercised in `dev`, `sessions`, `MODE_PENDING`, and the
   `prod`+`dev` refusal posture. In pending mode ordinary app-data and Public
   attest fail, privileged provision remains the sole schema-apply recovery
   branch, and public health/identity plus operator surfaces keep their stated
   reachability.
7. Typed public/admin projections carry app-value, identity, source, path,
   diagnostic-text, receipt-correlation/scope, config-value, token, and code
   sentinels. Each sentinel appears only on a route whose sensitivity and
   credential allow it; credential/capability responses are `no-store` and no
   secret appears in logs, diagnostics, receipts, or public output.

Two seams require exhaustive companion checks because an HTTP router cannot see
inside a multiplexed dispatch or a serialized response:

- **WebSocket message kinds are invisible to the HTTP router.**
  `operation_registry()` therefore enumerates all five current
  `LiveSocketClientMessage` variants (`ephemeral_publish`,
  `ephemeral_subscribe`, `ephemeral_delete`, `ephemeral_unsubscribe`, and
  `live_ping`), and the dispatch-name match is exhaustive over that enum. A new
  variant without operation metadata fails CI rather than inheriting the
  carrier route's policy.
- **Content trims are invisible to route middleware.** D3 keeps `/inspect`
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
5. Build the router from `RegisteredRoute` entries and enforce the independent
   policy axes, sessions overlay, operation registry, WebSocket/direct-runner/
   host-op exhaustiveness, and field-level public-inspect/`/` projection tests
   described in Enforcement. This ENG-24594 revision supersedes the earlier
   descriptive-only four-policy registry sketch.
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

This spec does not change the **active dev-mode** admin authorization model,
loopback defaults, or CORS behavior in LLP 0017. It does specify the sessions
overlay later landing items activate: secret-bearing reads require
`AdminSecretRead`, and impersonation effects require their separate capability.
The earlier migration extended the gated surface to cover operations that
escaped it as root aliases; ENG-24594 makes every current boundary enforceable
from router metadata. The static console lane (`/_snapback/admin*`) remains only a presentation surface:
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

A third sensitive fact fell out of D3's original enumeration and was closed
2026-07-07 (ENG-23441): the public payload's `functions` manifest carried each
function's *executable body* — `FunctionRuntime::IbexModule.source` (the full
handler source) and the `HandlerPlan` step bodies — which is a direct
source-disclosure, not an identity fact. The public `functions` block is now
itself a typed projection (`PublicFunctionManifest`): it keeps the
identity/compat and dependency facts (app id, bundle/inputs hashes, function
names/kinds, capability and read/write summaries, cron and config
*declarations* — never values) and drops every executable body plus
`sourceSpan` (a source-path leak). Full source stays gated-twin-only. The
field-level Enforcement test gains a whole-payload source-sentinel assertion —
a sentinel planted in both runtime shapes must appear in the gated payload and
never in the public one.

Further field-level hardening (ENG-24560) treats handler-controlled operational
text the same way: public cron inspection exposes only aggregate job,
failed-job, and in-flight counts, while public recent diagnostics expose only
code, severity, and subsystem. Raw cron runs/results and diagnostic
messages/details stay on the gated twin. Because loopback `AdminRead` is open,
that full twin is classified as a sensitive read and requires the configured or
auto-minted admin bearer; a route prefix alone is not authentication. The root
instance-status rendering also omits the absolute minted admin-token file path.

Further operational internals are gated as of 2026-07-12. Public ephemeral
diagnostics are an aggregate-only typed projection: room/entry/subscriber/byte
gauges and counters remain, while `activeRooms` (collection, routing key, exact
scope, scope epoch) is absent. `storage.clientMutationRetention` is likewise
gated because its record/byte/cap/GC facts describe server replay internals, not
the public app identity. Runtime capability availability/version/posture remains,
but absolute Ibex submodule/CLI paths do not. Function, cron, and config
`sourceSpan`s are absent. Unsupported-dependency, schema-artifact, cron, and
recent diagnostics retain only code/severity/subsystem, never free-form
message/details, and cron run results are absent because they may contain
application values. Exhaustive destructuring and sentinel serialization tests
make newly added fields require an explicit public/private decision.

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

**Registry mechanism (settled: router-owned entries).** The compile-time route
registry is adopted, not merely suggested: because axum exposes no route
introspection, metadata and `MethodRouter` travel in the same `RegisteredRoute`,
and `app()` and `route_registry()` are projections of that one collection. The
independent authority axes and sessions overlay are enforced through the
per-entry middleware; multiplexed operations have their own exhaustive registry.
The field-level inspect trim (D3) still rides alongside it as a separate typed-
projection test.

## Server-binary identity on /health

`/health` is the ungated, always-present root endpoint the acceptance suites
probe to decide whether to reuse a server on a default port. The reuse-provenance
scheme (ENG-22753/ENG-22757) verifies that decision by matching `GET /inspect` →
`functions.appId`/`bundleHash` against the committed `artifacts.json`. That
identity exists only once a **functions bundle** is loaded, so two classes of
server can never be verified and are always refused:

- an externally started but **unprovisioned** server (no bundle at all), and
- a **schema-only** server (`ensureApp({ schema })`, no functions) — e.g. the
  cursors-web web surfaces — which is correctly provisioned yet reports no bundle
  identity.

To shrink that unverifiable set, `/health` carries a **server-binary identity**
block (ENG-22798): `{ crateVersion, gitCommit, gitDirty, buildProfile,
startupNonce }`. `crateVersion` is `CARGO_PKG_VERSION`; `gitCommit`/`gitDirty` are
stamped by `build.rs` at build time (overridable via the matching
`SNAPBACK_BUILD_GIT_COMMIT`/`SNAPBACK_BUILD_GIT_DIRTY` env vars for a
deterministic CI stamp); `startupNonce` is a per-process UUIDv7 boot id. Together
they answer "is this MY checkout's binary?" before any app is provisioned.
The stamp tracks the binary's real inputs (`src/`, `Cargo.toml`, `Cargo.lock`)
and the ref store (`refs/heads`, `packed-refs`) alongside `.git/HEAD` and the
index, so an incremental rebuild after a source edit — or a ref-only move like
`git reset --soft` — re-runs the git probe instead of replaying the previous
build's cached commit/dirty pair; without that, a binary containing
uncommitted code could self-report the prior clean commit and falsely earn
reuse (ENG-23365). The dirty probe distinguishes `git status --porcelain`
succeeding with empty output (a proven-clean tree → `gitDirty: false`) from the
command failing (unknown → env var left unset, runtime defaults to dirty);
conflating the two had made a clean checkout unable to ever stamp
`gitDirty: false`, silently disabling binary-provenance reuse in exactly the
clean-CI case it exists for (ENG-23419).
`demos/_kit/provenance.mjs` grows a `verifyBinaryProvenance` verdict beside
`verifyApiProvenance`, and `startServer` falls back to it only when bundle
identity is unavailable (the `code: 'no-bundle'` verdict); a present-but-wrong
bundle (foreign app or hash drift) stays a hard refusal, never a binary fallback.

**Why extend `/health` rather than add an endpoint.** `/health` is already the
ungated root endpoint, already classified `app-data`/`public` in the route
registry, and already the surface the reuse decision is made against. Adding
non-sensitive identity fields to its JSON body changes neither its class nor the
route registry, and adds no second surface for the suites to probe. A new root
identity endpoint would need its own registry entry and enforcement coverage for
no gain.

**Sensitivity.** The build-identity facts are provenance, not an environment
leak, so they stay on the *public* payload — consistent with the D3 line: the two
facts D3 removes from public `/inspect` are the connection-id enumeration list and
the absolute on-disk DB path, and a crate version, a commit hash, and a random
boot id are none of those. Because these fields live on `/health`, not `/inspect`,
they are outside the field-level public-inspect projection test, and
`HealthResponse` is not part of the LLP 0037 schema drift gate, so extending it is
additive.

**Verification is conservative (refuse-when-unverifiable holds).** Binary
provenance is sound only when the build is pinned to a **clean** commit on *both*
sides: a dirty or commitless build on the checkout *or* the running server is a
not-ok verdict, because dirty bytes are not pinned to any commit. In practice this
earns reuse for clean checkouts (CI) and still refuses a dirty local dev tree — a
strict shrink of the unverifiable set, never a widening of trust. The
`startupNonce` is deliberately *not* part of the "is this my binary?" verdict (an
external verifier cannot know the expected nonce); it lets a caller that spawned a
server confirm the port still answers the same process, and makes a restart
observable.

## Connection capability grants

Until ENG-23442, connection identity was a **caller-chosen bearerless
capability**: `GET /outbox/{connection_id}` was classified Public,
`GET /live/{connection_id}/stream` upgraded with no check, and the live/ephemeral
POST bodies carried whatever `connection_id` the caller asserted. Knowledge of a
connection id — guessed, leaked through logs or devtools, or remembered by a
past participant — was sufficient to drain another client's durable live results
and ephemeral messages or to attach a competing stream. The S3 socket-frame gate
bound frames to *a* socket's id but never established ownership of the id
itself.

The fix makes the connection a **granted capability**:

- **`POST /connection/open`** (app-data, Public — it *grants* a capability the
  way `/app/ensure` grants provisioning, exercising nothing) returns
  `{ connectionId, connectionToken }`. The token is always server-minted
  (`sct_<uuid4>`, CSPRNG). A caller-suggested id is **adopted only in non-prod
  profiles** (trusted local: readable ids keep demos, acceptance suites, and
  gated-inspect output debuggable) and only while unclaimed; a suggestion that
  collides with a live grant gets a minted id rather than a token rotation, so
  an existing connection's bearer can never be displaced. Prod profiles always
  mint (`conn_<uuid4>`): ids leaving the trusted posture are unguessable and
  never caller-selected.
- **Re-open is idempotent under the current token.** `POST /connection/open`
  with `{ connectionId, previousToken }` returns the *same* grant when the token
  matches (any profile — possession of the bearer proves ownership). This is
  what lets a client keep one connection identity across reconnects and server
  restarts: the registry is process-lifetime in-memory, so after a restart the
  suggestion is simply adopted afresh under a new token.
- **Every connection-scoped operation demands the token** — the
  `connection-auth` registry policy: `/live/{name}/subscribe|resume|unsubscribe`
  (body `connection_id`), `/ephemeral/publish|subscribe|delete` (body
  `connection_id`), `GET /outbox/{connection_id}`, and the
  `/live/{connection_id}/stream` upgrade. Verification is registry-lookup plus
  constant-time compare in a dedicated small lock — never the global write
  mutex, so the L9 "ephemeral proceeds while a mutation holds the write lane"
  latency bounds still hold (the l9 concurrency test now runs with grants).
  Failures are structured: missing token → 401
  `SNAPBACK_CONNECTION_TOKEN_REQUIRED`; unknown connection or wrong token → 403
  `SNAPBACK_CONNECTION_TOKEN_INVALID` (one code for both, so the gate is not an
  existence oracle over the id namespace).
- **Token transports.** HTTP: the `x-snapback-connection-token` header (GET
  `/outbox` also accepts `?connection_token=` for header-less pollers). The WS
  upgrade additionally accepts the `snapback.connection-token.<token>`
  subprotocol, because a browser `WebSocket` cannot set headers; the kit always
  offers `snapback.v1` alongside it and the server echoes `snapback.v1`, so the
  negotiation stays legal. The WS upgrade deliberately rejects/ignores
  `?connection_token=` credentials because URLs are routinely captured by
  access logs, proxies, browser tooling, and telemetry; the outbox polling
  fallback above is the only query-token transport (ENG-24354). Socket
  **frames** need no per-frame token: the
  upgrade authenticated the socket, and the existing S3 sender gate keeps every
  frame bound to that socket's connection id.
- **URL credentials are not a WebSocket transport.** A
  `?connection_token=` presented without the header/subprotocol is rejected
  before upgrade with a stable unauthorized diagnostic, and the token is never
  echoed. The outbox query fallback above remains a separate HTTP-only
  compatibility surface.
- **The socket-close disconnect does not revoke the grant.** `live_stream`
  teardown still calls `disconnect` (dropping subscriptions and the outbox),
  but the grant survives so the kit's reconnect re-enters under the same
  identity while capacity is available. The local registry is fixed-cap. At
  pressure it first evicts grants never used for an authenticated operation;
  it may retire a used grant only after its idle lease, and refuses 429 while
  every used grant is current. A socket whose grant was retired fails its next
  lease touch and is closed before processing an inbound frame, sending a
  heartbeat, or draining notifier-queued data. After the first used id is
  retired, suggested ids remain disabled for the process: all new grants are
  minted so stale room/outbox state cannot be adopted by another bearer.
- **Hosted reconnect overlap has one current socket session.** Cloudflare can
  retain multiple hibernating sockets for one durable grant during handoff.
  Each accepted socket receives a fresh durable session id; fan-out selects
  only that current session, and close/error teardown is conditional on still
  owning it. Closing an obsolete socket therefore cannot delete the
  replacement's subscriptions, while closing the current socket performs the
  ordinary disconnect cleanup.
- **Hosted rows and grants are bounded by that session.** A kit HTTP subscribe
  requires a current authenticated socket and persists its session id; socket
  replacement removes old-session rows immediately, and subscribe,
  unsubscribe, inbound frames, fan-out, close, and demand counting all compare
  the stored session with the grant's current session. Socketless HTTP cannot
  arm demand. Cloudflare accepts only ASCII route-safe ids up to 128 bytes,
  caps the durable registry at 1,024 grants, admits at most 120 new grants per
  minute, and reaps disconnected grants after a 24-hour idle lease (active
  sockets and bearer-authenticated re-open remain valid). The same target caps
  subscriptions at 2,048 globally and 64 per connection, canonical arguments
  at 32 KiB, accepted sockets at 256, and the unauthenticated legacy proof
  subset at 128 sockets; one reusable connection bearer can hold at most two
  physical sockets for handoff overlap. A reconnect proactively closes prior
  tagged kit sockets; a runtime that still registers a close-requested socket
  returns retryable 429 until removal instead of exceeding either physical
  ceiling. On deployment wake, an old over-limit hibernation registry closes
  all sockets and reports `SNAPBACK_SOCKET_LIMIT_RECONCILIATION_PENDING` until
  cleanup completes, after which clients reconnect under the new limits.
  Admission is checked before the snapshot query and again atomically with
  replacement/persist. Legacy subscription rows are preflighted against the
  same limits *before* a schema migration copy; an older store already beyond
  a ceiling refuses startup through `/health` until authenticated reset/migrate
  rebuilds it. The local process-lifetime posture above is unchanged.
- **Local retained subscriptions have the same count ceilings.** The local
  process owns one in-memory durable-live registry and now admits at most 2,048
  subscriptions across it and 64 per granted connection. Admission is checked
  before the initial query, refuses with the hosted coordinator's typed 429
  codes (`SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT` or
  `SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT`), and never evicts established
  authority. A valid same-owner explicit supersession is net-zero; the old
  subscription remains retained until the replacement snapshot succeeds.
  Unsubscribe, disconnect, and failed initial queries all release or consume no
  capacity. The local capability manifest therefore reports
  `maximum_subscription_count` as `Enforced` rather than `Advisory`.
- **The kit half.** `demos/_kit/client.mjs` opens grants transparently on first
  use of a connection-id label, threads the token through every wire operation
  (label-keyed registries, granted-id-keyed wire traffic — in dev they are the
  same string), refreshes the grant once on a token rejection or a socket that
  fails without ever opening (the restart signature), and passes
  `previousToken` on refresh so a still-live server re-issues the same grant.
  Demo and app code keeps passing readable `connectionId` labels and never sees
  tokens.

`AppAuth` on these routes previously meant "the handler may enforce app-supplied
`ctx.auth`"; `ConnectionAuth` strengthens it to "the transport requires the
connection grant, and the handler may additionally enforce `ctx.auth`". True
row-level/user auth remains LLP 0011 land — the grant authenticates the
*connection*, not the user.

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

Active and implemented (accepted in the LLP 0032 R1 batch): LLP 0032
S1 landed the migration and the declared route registry with its enforcement
tests (registry-invariant, retired-root-absent, WebSocket message-kind, and the
field-level public-inspect trim), verified against a running server. The
own-entry-delete-vs-proxy sequencing (Open questions) and a cross-family review
of the revised spec remain outstanding but do not block the implementation.

ENG-24594 extends that active contract from a descriptive registry to
router-owned `RegisteredRoute` entries, centralized per-entry middleware, the
independent policy axes, exhaustive operation metadata, and the full auth-mode
matrix above. This extension is implemented only when its metadata-derived
acceptance suite passes; it does not by itself enable session mode, whose staged
runtime activation remains later in LLP 0039's landing order.

The five ambiguous classifications are settled (see Resolved
decisions), and the spec drove the route-registry implementation —
the gated `/_snapback/api/{schema/load, functions/load, app/reset}` equivalents
retired the ungated root aliases without breaking the demos and tests that called
them (they repoint through the kit client). A fresh cross-family review of the
revised spec (the one independent pass — the GPT-5 review above — predates these
decisions) and the author's call on the own-entry-delete sequencing remain the
outstanding follow-ups.
