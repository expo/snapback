# LLP 0031: Server route taxonomy and authority boundary

**Type:** Spec
**Status:** Active
**Systems:** Local server lifecycle, HTTP surface, Security/authorization, Admin API, Client integration, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-01
**Revised:** 2026-08-12 (OAuth advertised-origin hardening: local discovery
and DCR derive endpoint URLs from bound listener state, never request Host).
2026-08-10 (LLP 0204 commissioned the granted-operation
capability-link mint/serve/invoke/revoke operation classes and response
sensitivity for reads and writes; design only, with no implementation or
capability claim — see the dated amendment.) 2026-08-10 (LLP 0204 S5 Landing C registers the session-only
pending-effect inbox and approve/deny routes; bare, `/api/v1`, MCP, and
capability-link mutating calls converge on one typed 202 approval result.)
2026-08-09 (LLP 0204 S5 Landing B registers the user-owned durable
watch create, list, delete, suspend, and resume rows as exact session-only
AppData management operations; integration-owned creation remains deferred.)
2026-08-09 (LLP 0204 S5 Landing A implements the anonymous-set
capability-link mint, inert landing, invoke, and exact-minter revocation rows;
the granted-operation extension and D9.5 approval gate remain commissioned.)
2026-08-09 (LLP 0204 S4 Landing C registers read-only
`/api/v1/ask` and MCP `ask`; Landing B registered `/api/v1/run` with
bounded/digest validation and the evidenced untrusted-code refusal; earlier S4 Landing A private
stream transcript and cancel routes, S2 Landing E remote MCP server, and Landing C local OAuth facade;
earlier Landing B declared-client operator routes, Landing A integration lifecycle, and S1 `/api/v1` plus
`api.origins` bearer-token CORS — see dated amendments).
2026-08-08 (hosted app-data SPA-fallback refusal: reserved
app-data prefixes whose unimplemented route is answered by Workers Assets as
200 HTML now return the structured
`SNAPBACK_ROUTE_UNSUPPORTED_ON_TARGET` ErrorResponse). 2026-08-08 (LLP 0204 commissioned the OAuth-facade, capability-link, and external-anonymous route/response classes; design only, outside this Active spec's implemented-route claim — see the dated amendment). 2026-08-07 (LLP 0189 alignment sweep: verification-cadence/claim-gating clauses re-scoped or annotated to the LLP 0189 D-3/D-6 defaults). 2026-08-05 (§Server-binary identity: the build-identity dirty
probe is scoped to the runtime binary's input set — shared pathspec definition
in `scripts/runtime-build-inputs.txt` — instead of the whole tree, and all
expected-identity consumers read the same definition; demo/LLP/issue edits no
longer disqualify a prepared binary — see
issues/closed/20260805-whole-tree-dirty-flag-forces-runtime-rebuild.md.)
Earlier same day (LLP 0184 Phase 0 item 5 audit: corrected the
2026-07-25 hosted route table, which was missing the
`/_snapback/api/debug/network-profile` row — see the dated correction;
the full first-pass audited inventory of `gateway.js`'s hand-routed
system/control paths lives at `cloudflare/gateway-paths.inventory.json`.)
2026-08-04 (dated route-class registration for the
landed `/app-api/*` app-data-plane envelope surface — LLP 0062 Phase 1:
`GET /app-api/current` is the sessions-only `PublicNoStore` discovery
route and `GET /app-api/envelope/{sha256}` the content-addressed
`PublicProjection` artifact; both credential-free by construction and
enforced through the registry; closes
issues/20260804-0031-app-api-route-class-registration.md.) 2026-08-03, latest (LLP 0109 acceptance: the versioned-seed
route-family amendment gains its dated supplement — normative gate-before-
decode order including preview, and the redaction-bounded response posture
with `AdminSecretRead` as the sole gated-detail lane.) Earlier:
2026-08-03 (added LLP 0156's error-triage routes and host
operations with the structural `OperatorMetadata` / raw
`AdminSecretRead` split and an `AdminWrite` transition; earlier the same day,
reconciled the enforced route matrix with LLP 0143's session-only PUSH token
register/unregister routes and LLP 0154's three telemetry query projections;
the route-parity and body-authority acceptance inventories advance with the
same changes.)
**Revised:** 2026-08-01 (LLP 0062 exact scoped-token release: registered the
closed destroy-only `POST /auth/agents/token/release` app-data route; see the
dated amendment). 2026-07-31, W2b (LLP 0044 completion program: the asset family
gains the `private-signed` issuance route, the token-credentialed public
signed serve lane, and the `public-immutable` lane — the registry's first
`AppData`/`Public` byte routes, with the existence-oracle and cache
postures pinned in the extended dated amendment; `asset.rotateSigningKey`
joins the host-operation registry). Prior same day (LLP 0044 tickets L1-09/L1-10:
the asset family grows strict delivery over `(asset, rendition)` aliases —
`GET /assets/records/{id}/bytes/{variant}` — and the owner's explicit
`DELETE /assets/records/{id}`, ten rows total; see the extended dated
amendment). 2026-07-31 (LLP 0044 companion, tickets L1-04/L1-05: registered
the asset upload-session route family — see the dated amendment — with the
`AssetTransfer` authority-only invocation source and the same-path
multi-method router merge). 2026-07-25 (hosted-arm root system-route migration: the Cloudflare gateway/coordinator system operations moved under the reserved `/_snapback/*` namespace — see the dated amendment; LLP 0093 former OQ6, executed by LLP 0094 §0A.3). 2026-07-25 (§Server-binary identity: resolved the kit-side self-confirmation defect — `startServer` no longer injects checkout-derived `SNAPBACK_BUILD_GIT_COMMIT`/`SNAPBACK_BUILD_GIT_DIRTY` into spawned children, so the build.rs stamp is an independent probe again; strict equality is replaced by an honest verdict classification (`verified`/`unpinned`/`env-stamped`/`unverifiable`/`stamp-mismatch`) carried on the server handle; see the resolved-defect paragraph and issues/closed/20260724-kit-identity-stamp-env-injection-tautology.md). 2026-07-24 (§Server-binary identity: recorded the kit-side defect where the default `cargo run` launch injects checkout-derived `SNAPBACK_BUILD_GIT_COMMIT`/`SNAPBACK_BUILD_GIT_DIRTY` into the child, making the provenance comparison self-confirming on that path; fix tracked by issues/20260724-kit-identity-stamp-env-injection-tautology.md). 2026-07-24 (LLP 0090 rollout step 2: `POST /app/bundle` and the pending-registration owner are implemented on the local arm and the route matrix row landed — see the amendment's implementation note). 2026-07-24 (LLP 0090 cluster-0F amendment: added the dated LLP 0090 resumable-snapshot-lanes section — a commissioned `DeclaredPublicApplicationData` response-sensitivity class for the Channel A inlined-HTML lane and read-mode public bundles, with server-side re-check of the codegen-compiled `publicInline` facts, body-logging exclusion with identity/refusal-code loggability, v1 `no-store`, and the bounded anonymous rate/budget posture; plus the bounded pending-registration owner that makes register mode buildable — atomic grant mint, atomic handoff on socket attach, attach-grace reaping, idempotency replay-validity scoped by LLP 0077's exact wire identities (RFC 7638 JWK thumbprint + issuance `sender_replay_epoch`), register mode refused to read mode for anonymous callers, and an acceptance obligation that socketless-HTTP-cannot-arm-demand still holds outside that one closed operation; enters the enforced registry with 0090 clusters 0D/0E). 2026-07-17 (clarified that kit connection labels and granted wire ids coincide only when an initial suggestion is adopted; collision or mint-only containment makes them diverge, and connection-owned entry keys use the granted id). 2026-07-16 (ENG-24920 companion amendment); 2026-07-15 (ENG-25102: extended the public system-static lane beyond console assets to the build-embedded `/_snapback/guide` projections; the three read-only routes carry `PublicProjection`, no instance authority, and the same registry enforcement). 2026-07-14 (auth-program route reconciliation: extend the normative matrix through the bootstrap handshake, provider/session endpoints, authorized-lease query, and explicit invalidation ACK/manual-retry routes now installed by items 3–8). 2026-07-13 (ENG-24596 final audit: registered the console-credential and secret-read-mint routes, the `SecretReadMintProof` effect, and rescue's dev/test-only profile); 2026-07-13 (ENG-24596: registered provider challenge/family-alarm credential cases, the public no-store response class, and the installed provider/mailbox/auth host-operation rows); 2026-07-13 (ENG-24594: made the route registry the enforceable router source; added independent path, credential-resolution, invocation-authority, legacy-body, effect, response-sensitivity, and session-overlay axes; re-scoped `AppAuth` to dev-mode client assertion; and pinned the complete existing-route × auth-mode matrix and metadata-driven acceptance sweep); 2026-07-13 (final audit hardening: the local durable-live registry now enforces the hosted proof's 2,048-global/64-per-connection ceilings before initial query execution, with net-zero supersession and typed 429 diagnostics); 2026-07-12 (ENG-24560/ENG-24571: the typed public-inspect projection now removes per-room ephemeral identities/scopes and client-mutation retention internals, exposing aggregate ephemeral health only); 2026-07-12 (ENG-24566: local connection grants are fixed-cap, prefer unused eviction, refuse while all used leases are current, and retire idle used grants only with stale-socket termination plus permanent minted-id fallback); 2026-07-12 (ENG-24347/ENG-24354/ENG-24358 review follow-up: hosted subscription rows, canonical args, and accepted sockets now have hard advertised ceilings, including the legacy proof socket; persisted over-limit state fails recoverably through health/reset; ENG-24347/ENG-24352/ENG-24354/ENG-24358: optional request bodies fail closed, WebSocket query-token transport is retired, hosted subscriptions and frames are bound to the current socket session so an obsolete socket cannot act for its replacement, and hosted durable connection grants are bounded and reaped; earlier: 2026-07-01 status → Active: LLP 0032 S1 implemented the full migration and the declared route registry with enforcement tests, verified against a running server; earlier same day status → Accepted, ratified in the LLP 0032 R1 batch: the five classifications are settled, LLP 0032 S0 landed the interim gate; author self-review pass: corrected the invariant's auth framing — app routes carry app-supplied `ctx.auth`, not server-enforced auth, and several are public; noted axum's `Router` is not route-introspectable so the declared registry is required for enforcement; aligned the new gated writes with the LLP 0024 host-ops projection; made explicit that the reserved-prefix proxy rule is safe only because the enforcement test holds. Not an independent review — this session authored the draft. GPT-5 review clarified that `/_snapback/admin*` is a static console shell/assets lane, not itself an `authorize()`-gated API; required the route registry to record auth policy as well as path class; and made WebSocket-carried operations part of the taxonomy so `/live/*` cannot smuggle a system operation. A further author self-revision then lifted that WebSocket insight into the normative invariant — the classified unit is the operation, not just the URL path — and clarified that the registry's `app-auth` policy means handler-enforced `ctx.auth`, not transport authentication. Still not an independent review; the GPT-5 pass above is 0031's one independent review so far. A subsequent Claude session then settled the five open-question classifications with the author and wrote them into the spec below, driven by three code-verification sub-agents and two adversarial Claude review passes over the decisions. That work corrected decision 4 — `/ephemeral/collections` (register) is an ungated definition-overwrite with no caller and is now classed system, split from the validate-only `/ephemeral/collections/ensure`, which stays app-data — dropped a category error in the delete rationale, folded seed into `app.reset` per LLP 0024, and added a field-level inspect test the route registry cannot substitute for. This remains a same-family Claude pass, not the independent review 0031 still owes: the GPT-5 review above predates these decisions, so a fresh cross-family pass over the revised spec is the outstanding review debt. 2026-07-04 (ENG-22798): added §Server-binary identity on /health — the ungated `/health` now carries a build-identity block (crate version + git commit/dirty + a per-process startup nonce) so an externally started, unprovisioned or schema-only server is reuse-verifiable before any app bundle loads; the reuse-provenance verdict falls back to it when bundle identity is unavailable. Still a same-family Claude pass; the cross-family review debt above stands. 2026-07-07 (ENG-23441): D3 tightened — the public `functions` manifest is now itself a typed projection (`PublicFunctionManifest`) that drops executable handler bodies (`IbexModule.source`, `HandlerPlan` step bodies) and `sourceSpan`; full handler source lives only on the gated twin, and the field-level trim test gains a whole-payload source-sentinel assertion. Same-family Claude pass; the cross-family review debt stands. 2026-07-07 (ENG-23365): §Server-binary identity — the build.rs stamp now tracks the binary's real inputs (src/, Cargo.toml, Cargo.lock, refs/heads, packed-refs) so incremental rebuilds and ref-only moves re-stamp instead of replaying a stale commit/dirty pair. 2026-07-07 (ENG-23419): §Server-binary identity — the dirty probe now maps `git status --porcelain` success-with-empty-output to `gitDirty: false` instead of conflating it with command failure, so a clean checkout can actually earn binary-provenance reuse. 2026-07-07 (ENG-23442): added §Connection capability grants and the `connection-auth` registry policy — connection ids are no longer caller-chosen bearerless capabilities; `POST /connection/open` mints a per-connection token (idempotent re-open under the current token; suggested ids adopted only in non-prod), and `/live/*`, `/outbox/{id}`, and the ephemeral publish/subscribe/delete routes require it, with `/outbox/{id}` reclassified from Public. Same-family Claude pass; review debt stands.)
**Related:** LLP 0000, LLP 0003, LLP 0011, LLP 0012, LLP 0013, LLP 0017, LLP 0023, LLP 0024, LLP 0025, LLP 0030, LLP 0039, LLP 0051, LLP 0053, LLP 0055, LLP 0057, LLP 0058, LLP 0059, LLP 0060, LLP 0061, LLP 0071, LLP 0077, LLP 0090, LLP 0093, LLP 0094, LLP 0143, LLP 0150, LLP 0154, LLP 0204

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
API, the admin console shell, and the build-embedded guide — live under the reserved `/_snapback/*`
namespace. Privileged system API routes carry the admin authorization model; the
static console shell/assets and guide corpus may be served as public
presentation surfaces only because they expose build-owned bytes, never
instance data or control; those operations still go through the authorized
`/_snapback/api/*` routes. No route is both, and no system route hides at the root.

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
> (`authorize()`); static console shell/assets under `/_snapback/admin*` and the
> build-embedded guide under `/_snapback/guide*` may be public only because they
> do not reveal instance state or perform control operations. The classified unit is the **operation**, not merely the URL
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
| `/_snapback/guide`, `/_snapback/guide/{*path}`, `/_snapback/guide/flat.md` | none | system presentation | public, read-only build-owned guide projection (LLP 0061 §4a) |
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
when ENG-24594 lands and for the dated auth-program extensions through
ENG-24607 added below. `Dev` means the non-production, loopback development
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
| `GET /auth/session` | `Public`; anonymous closed discovery | `Public`; optional session bearer resolves the same prepared caller projected to the response | serve in every transition state | closed `PublicNoStore` bootstrap projection; never credential custody |
| `POST /auth/request-code` | installed but provider-mode refusal in active `dev` | `Public`; no caller authority | refuse | closed public no-store acknowledgement |
| `POST /auth/exchange` | installed but provider-mode refusal in active `dev` | `ChallengeProof`; no session/admin substitution | refuse | exact credential-secret projection; no-store |
| `POST /auth/refresh`, `/auth/logout` | installed but provider-mode refusal in active `dev` | `SessionAuth`; exact required session bearer | refuse | credential-sensitive exact projection; no-store |
| `POST /push/tokens/register`, `/push/tokens/unregister` | `SessionAuth`; exact required session bearer even in local development; no body authority | same required current session bearer; reject every body auth field | refuse | sensitive application metadata only; provider token bytes never echo; no-store |
| `POST /auth/family-alarm` | installed but provider-mode refusal in active `dev` | revoke-only `FamilyAlarmBearer`; never session/admin substitution | refuse | closed public no-store result |
| `POST /query/{name}` | `AppAuth`; client body auth becomes dev authority | optional session bearer; server-resolved caller; reject every body auth field; function `authRequirement` decides whether anonymous is allowed | refuse | app-derived result, scoped to resolved caller |
| `POST /query/{name}/authorized-lease` | `AppAuth`, but retained authorization is unavailable in `dev` | resolved authenticated caller plus exact invalidation/lease protocol offers and a proved retainable query profile | refuse | app-derived fresh snapshot plus signed authorization lease; no credential echo |
| `POST /mutation/{name}` | `AppAuth`; client body auth becomes dev authority | optional session bearer; server-resolved caller; reject every body auth field; shared invocation/write gate applies | refuse | app-derived result/receipt, scoped to resolved caller |
| `POST /action/{name}` | same `AppAuth` dev authority | same optional session resolution and body rejection before detached execution | refuse | app-derived `FunctionRunResult` envelope |
| `POST /app/bundle` | `AppAuth`; client body auth becomes dev authority; anonymous read is legal only for `publicInline`-class entries (interim: refused fail-closed until the cluster-0C fact exists); register mode requires a credentialed caller | optional session bearer; server-resolved caller; reject every body auth field; register mode additionally mints the pending-registration owner and connection grant of the dated LLP 0090 amendment | refuse | `DeclaredPublicApplicationData` (rows/tokens excluded from logs); register responses additionally carry the `[secret]` connection grant; `no-store` |
| `POST /client-mutations/acknowledge` | `AppAuth`; client body auth supplies dev ownership | optional session bearer; resolved caller plus the later authority-descriptor check; reject body auth and public `ctx_ledger.auth_fingerprint` | refuse | typed settlement metadata; any echoed app value is forbidden |
| `POST /app/ensure` legacy/untagged dev form | `Public`; exact LLP 0012 `snapback.v0` + `dev` compatibility only | reject; sessions requires an explicit branch | refuse | typed identity/provisioning result; never a manifest echo |
| `POST /app/ensure { intent: "attest" }` | accepted only where LLP 0012 permits the explicit compatibility form; compare-only | `Public`; exact identity-only pair, no manifests/seed/mode material/unknown fields, and no mutation | refuse | typed public identity/hash projection |
| `POST /app/ensure { intent: "provision" }` | provisioning authority/profile gate; legacy dev startup remains compatible | `AdminWrite` or pre-bind startup authority; branch gate runs before hashes or effects | **sole app-schema recovery exception**; same privileged gate | admin metadata/effect result; no secret/config value echo |
| `POST /connection/open` | `Public`; closed DTO; no caller identity; `previousToken` proves only grant ownership | optional current session bearer; bind resolved anonymous/session authority; body identity fields forbidden; per-source throttle | refuse | secret delegated connection capability; `no-store`, never logged/retained |
| `POST /live/authorization-invalidation/acknowledge`, `/manual-retry` | `ConnectionAuth`; exact bound grant and closed DTO | same bound connection authority plus exact negotiated invalidation/descriptor protocols; no body authority | refuse | typed obligation metadata only; no credential or subject echo |
| `POST /live/{name}/subscribe`, `/resume`, `/unsubscribe` | `ConnectionAuth`; connection token plus client body auth as dev authority | connection token resolves its bound authority; reject live owner/body auth; auth-scoped registration requires the installed item-6 protected-query profile and exact invalidation protocol, while explicitly authority-independent live remains the conservative exception | refuse | app-derived live snapshot/metadata, scoped to bound authority |
| `GET /live/{connection_id}/stream` | `ConnectionAuth`; header or WebSocket subprotocol token; no URL credential | bound connection authority; header/subprotocol only; revoked/expired authority closes the stream | refuse | app-derived delegated stream; never cache |
| `GET /outbox/{connection_id}` | `ConnectionAuth`; header token, with the documented dev-only query fallback | bound connection authority; **reject** `?connection_token=` and require the header | refuse | app-derived delegated queue; never cache |
| `POST /ephemeral/collections/ensure` | `Public`; validate-only compatibility check | unchanged closed, identity-free DTO | refuse | typed definition compatibility metadata, no values |
| `POST /ephemeral/publish`, `/subscribe`, `/delete` | `ConnectionAuth`; body auth is dev authority in addition to the connection token | bound connection authority; operation-specific closed DTO rejects all legacy identity/auth siblings; protected rooms require the installed item-6 barrier plus exact invalidation negotiation, while custom-key authorization remains refused until separately designed | refuse | app-derived ephemeral result/metadata, scoped to bound authority |
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
| `GET /_snapback/guide`, `/flat.md`, `/{*path}` under that prefix | `Public` system-static presentation only | unchanged; the corpus gains no instance authority | serve | build-owned `PublicProjection`; content hash + build commit bind cached bytes to the server |
| `GET /app-api/current` | `Public`; credential-free discovery document | unchanged; sessions-only content, no credential custody | serve | closed `PublicNoStore` discovery projection; never cached |
| `GET /app-api/envelope/{sha256}` | `Public`; content-addressed immutable artifact (64-lowercase-hex grammar, identity content coding, strong ETag, `Content-Digest`) | unchanged | serve | build-owned `PublicProjection`; immutable/no-transform caching; typed misses |
| `GET /_snapback/api/health` | `AdminRead` (tokenless loopback remains the LLP 0017 compatibility posture) | unchanged | serve | typed admin metadata only |
| `GET /_snapback/api/telemetry/stats` | `AdminRead` | unchanged; closed aggregates require no raw-data lease | serve | closed `OperatorMetadata` aggregates; no-store |
| `GET /_snapback/api/telemetry/events`, `/telemetry/export` | `AdminSecretRead`; fixed finite scope and row/byte budgets | unchanged; ordinary admin/session credentials cannot substitute | serve only with the scoped lease | sensitive raw/snapshot application data; no-store |
| `GET /_snapback/api/errors/issues` and host-op `errors.issues` | `AdminRead` | unchanged; the closed DTO contains structural titles/counters only | serve | `OperatorMetadata`; no templates, messages, or stacks; no-store |
| `GET /_snapback/api/errors/issue` and host-op `errors.issue` | `AdminSecretRead`; fixed `errorsIssue` scope and row/byte budgets | unchanged; ordinary admin/session credentials cannot substitute | serve only with the scoped lease | retained exemplar templates/stacks and correlation queries; `SensitiveApplicationData`, no-store |
| `POST /_snapback/api/errors/transition` and host-op `errors.transition` | `AdminWrite`; single issue CAS or one atomic release selector | unchanged; no session or secret-read credential substitution | serve if the admin gate succeeds | structural transition outcome/variance only; no-store |
| `POST /_snapback/api/console/credential` | `AdminWrite`; the configured/master credential is presented once | unchanged; neither a session nor a secret-read lease substitutes | serve if the admin gate succeeds | short-lived process-bound ordinary console credential; `CredentialSecret`, no-store |
| `POST /_snapback/api/admin-secret-read/mint` | `AdminWrite` **plus `SecretReadMintProof`** bound to the exact finite scopes, TTL, and row/byte budgets | unchanged; a URL, console credential, session, or unbound proof cannot select/mint | serve only if both independent gates succeed | short-lived scoped `sbrl_` lease; `CredentialSecret`, no-store |
| `GET /_snapback/api/auth/mailbox` | `AdminWrite` **plus `ImpersonationCapability`**; capture-provider profiles only | unchanged; a session, ordinary console credential, or secret-read lease cannot substitute for either axis | serve only if both independent gates and the provider-profile gate succeed | exact captured code projection; `CredentialSecret`, no-store |
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
| host-ops `auth.mintSession` | registered but `Unavailable` in `dev`; `AdminWrite` alone cannot mint | `AdminWrite` **plus `ImpersonationCapability`**, settled available sessions mode, and non-prod profile | refuse unless the sessions overlay and every independent gate are active | exact minted session credential; `CredentialSecret`, no-store |
| host-ops `auth.rescueCollidingTable` | `AdminWrite` **plus `ImpersonationCapability`**; dev/test only | same independent gates and dev/test-only profile | serve only if both gates and the profile gate succeed | typed operator metadata; no credential echo |
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

ENG-24596 installed the provider witnesses without activating session mode at
that item-3 checkpoint:
`POST /auth/request-code` is `None` plus `PublicNoStore`; `/auth/exchange` uses
`ChallengeProof` plus `CredentialSecret`; `/auth/refresh` and `/auth/logout`
use `SessionAuth` plus `RequiredSessionBearer`; and `/auth/family-alarm` uses
the revoke-only `FamilyAlarmBearer`. The mailbox and host-ops
`auth.mintSession` / `auth.rescueCollidingTable` combine `AdminWrite` with the
non-substitutable `ImpersonationCapability`; mint remains fenced until item 4
activates sessions. Mint is profile-bounded to dev/demo/test, while collision
rescue is deliberately narrower and refuses demo as well as prod. LLP 0057 owns
provider/keyring semantics and the complete DTO table. Item 4 subsequently
installed persisted mode resolution and item 5 closed the activation fence; an
explicitly staged local sessions deployment can therefore reach these rows now.
An unstaged process still defaults to `dev` and provider routes return the typed
no-store `SNAPBACK_AUTH_MODE_DEV` refusal there.

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
from router metadata. The static console and guide lanes
(`/_snapback/admin*`, `/_snapback/guide*`) remain presentation surfaces:
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
- *Own-entry enforcement is implemented.* After the publish-parity scope check,
  delete derives the caller's owner from server-bound request metadata for the
  collection key mode and compares it with the stored record owner. A mismatch is
  `Unauthorized` before removal or fan-out. Connection/custom keys bind ownership
  to the authenticated connection; session/user keys bind it to the corresponding
  server-resolved identity. The proxy therefore does not turn `AllowAll` publish
  scope into authority to delete another owner's entry.

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
`/ephemeral/collections` (register) was an unconditional, ungated overwrite of a
collection's definition *including its `publish`/`subscribe` `AccessPolicy`* — the
ephemeral twin of `schema.load`, and a privilege-downgrade vector (it can reset a
`RequireRoomPermission` collection to `AllowAll`). It has no caller, and collection
definitions already ride in each app's `schema.manifest.json` (`ephemeralCollections`,
loaded via `replace_collections`), so its job belongs to `schema.load`. The root
register route is retired and the absence check prevents its return. Only the
validate-only `/ephemeral/collections/ensure` app route remains. Any future
standalone definition load requires a newly specified and admin-gated system
operation; it may not revive the retired root overwrite.

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
succeeding with empty output (a proven-clean input set → `gitDirty: false`)
from the command failing (unknown → env var left unset, runtime defaults to
dirty); conflating the two had made a clean checkout unable to ever stamp
`gitDirty: false`, silently disabling binary-provenance reuse in exactly the
clean-CI case it exists for (ENG-23419). Since 2026-08-05 the probe is scoped
to the runtime binary's input set — the shared pathspec definition in
`scripts/runtime-build-inputs.txt` (Rust sources/manifests, `vendor/ibex`, and
the build-embedded corpora such as `guide/` and the harness scripts) — rather
than the whole tree: `gitDirty: true` means "this binary's *inputs* were
uncommitted", so demo/LLP/issue/diary edits neither flip the compile-time
`rerun-if-env-changed` input nor disqualify a prepared binary. Every consumer
that recomputes an expected dirtiness fact (`scripts/verify-local-proof`,
`scripts/bootstrap-ibex-runtime` receipt reuse, `demos/_kit/provenance.mjs`,
`packages/snapback-cli/runtime-recovery.mjs`) reads the same definition file,
falling back to whole-tree status when it is absent
(issues/closed/20260805-whole-tree-dirty-flag-forces-runtime-rebuild.md).
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
not-ok verdict, because dirty bytes are not pinned to any commit. (Known
LLP 0189 D-3/D-4 friction, 2026-08-07: raw commit equality lets unrelated
landings demote a still-correct prepared binary out of `verified`; the
follow-up is to compare the `scripts/runtime-build-inputs.txt` content
identity — the same scoping the `gitDirty` half already uses — so
`verified` survives unrelated commits.) In practice this
earns reuse for clean checkouts (CI) and still refuses a dirty local dev tree — a
strict shrink of the unverifiable set, never a widening of trust. The
`startupNonce` is deliberately *not* part of the "is this my binary?" verdict (an
external verifier cannot know the expected nonce); it lets a caller that spawned a
server confirm the port still answers the same process, and makes a restart
observable.

**Resolved defect — the kit's default launch path used to self-confirm
(found 2026-07-24, fixed 2026-07-25).** From ENG-24378 until the fix,
`startServer`'s default `cargo run` path computed the expected identity from
the launch-time checkout (`readCheckoutBinaryIdentity`,
`demos/_kit/provenance.mjs`) and injected that same commit/dirty pair into the
child's environment as `SNAPBACK_BUILD_GIT_COMMIT`/`SNAPBACK_BUILD_GIT_DIRTY`.
Because the build script prefers the env override — the affordance intended
for deterministic CI stamps — the freshly compiled child stamped exactly the
value the kit then compared against: the commit check was a tautology and
checkout drift was invisible on that path (surfaced by the All Aboard matrix
external review; `issues/closed/20260724-kit-identity-stamp-env-injection-tautology.md`).
The injection predated nothing it was needed for: the build.rs hardening that
makes the stamp track the binary's real inputs (ENG-23365) and the clean-tree
dirty probe (ENG-23419) had already landed. The fix removes the injection —
the child's stamp is build.rs's own independent probe again — and replaces the
brittle strict-equality gate with an honest classification in
`demos/_kit/server-process.mjs` (`classifyBinaryIdentity`): `verified` (same
clean commit both sides), `unpinned` (commits agree, a side is dirty — dirt
outside the binary's tracked build inputs legitimately does not re-stamp it),
`env-stamped` (an explicit env override in the launch environment, e.g.
`scripts/verify-local-proof`'s proof-wide stamp: attested by the caller, never
presented as checkout-verified), `unverifiable`, and `stamp-mismatch` (a hard
launch failure on the automatic rungs; reported-but-boots for an explicitly
configured binary under LLP 0030's kit resolver ladder). The verdict rides the
returned server handle (`handle.identity`) so receipts and reuse decisions can
distinguish verification from attestation. Regression coverage:
`demos/_kit/tests/server-process-lifecycle.mjs` (no-injection assertion, drift
detection, dirty-divergence honesty, env-stamp classification) and
`demos/_kit/tests/binary-provenance-drift.mjs` (the real build.rs-stamped
binary against a drifted expectation must yield `stamp-mismatch` or
`unverifiable`, never confirmation).

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
  (label-keyed registries, granted-id-keyed wire traffic). An initial unclaimed
  suggestion may make those strings equal in dev; a live collision or permanent
  mint-only containment makes them diverge. The kit refreshes the grant once on
  a token rejection or a socket that fails without ever opening (the restart
  signature). The label remains the local cache key, but refresh re-suggests
  the prior granted wire id and passes `previousToken`, so a still-live server
  re-issues the same grant even when label and wire id differ.
  Demo and app code keeps passing readable `connectionId` labels and never sees
  tokens.

`AppAuth` on these routes previously meant "the handler may enforce app-supplied
`ctx.auth`"; `ConnectionAuth` strengthens it to "the transport requires the
connection grant, and the handler may additionally enforce `ctx.auth`". True
row-level/user auth remains LLP 0011 land — the grant authenticates the
*connection*, not the user.

## Open questions

The former D1 sequencing question and D4 retire-or-gate choice are resolved:
own-entry delete enforcement and root register-route retirement have landed.

- **How far to shrink public `/inspect` (D3).** Keep the benign operational
  counters (`ephemeral.*`, `liveDelivery.*`, `storage.version`) on the public read
  for the acceptance tests, or repoint those reads to the gated twin and let the
  public payload collapse to the pure identity descriptor? The sensitive fields go
  either way; this is about how small the public surface ultimately gets.
- **Static console on non-loopback binds (carried from the GPT-5 review).** Should
  `/_snapback/admin*` shell/assets be disabled or token-gated when the server binds
  a non-loopback address, or is public shell/asset serving acceptable as long as
  all data and control still flow through the gated `/_snapback/api/*`?

## Dated amendment: agent-auth route classes (2026-07-16)

The declared registry carries `POST /auth/agents/register`,
`POST|GET|DELETE /auth/agent-invitations[/{id}]`,
`POST /auth/pairing-codes`, `POST /auth/agents/pair`,
`GET /auth/grant-requests`, `POST /auth/grant-requests/{id}/approve|deny`,
`POST /auth/agents/token|rotate|revoke-self|recover`,
`GET|DELETE /auth/grants[/{id}]` plus bulk revoke-by-actor,
`POST /auth/agents/{id}/credential`, `GET /auth/agents`,
`DELETE /auth/agents/{id}`, and `POST /auth/sessions/revoke-all`. It also
registers `auth.mintAgentInvitation`, `auth.mintAgentRecovery`,
`auth.mintAgentGrant`, `auth.revokeGrant`, `auth.revokeAgentCredential`,
`auth.revokeAgentInvitation`, and `auth.deactivateAgent`. Body-carried credentials, scoped tokens,
invitations, and pairing codes undergo structural credential-class dispatch
before lookup. Routes receiving those bodies are `request-secret`, preventing
middleware buffering, receipts, diagnostics, logs, and debug formatting from
capturing them. Responses minting or rotating credentials/tokens are
`[secret]`; list, deny, revoke, and deactivate results expose ids/status only.

Scoped-token resolution is legal only on generated app-data routes and
`POST /connection/open`. Multiplexed `function.run`, dedicated host-operation
aliases, provisioning, recovery, and lifecycle routes retain their existing
admin/session/process authorities and reject scoped tokens before body
dispatch. `AgentDestroyCapability` is a distinct non-browser class; the console
credential never substitutes for it.

## Dated amendment: LLP 0090 resumable-snapshot lanes (2026-07-24)

[LLP 0090](./0090-resumable-query-snapshots.rfc.md) (Accepted; this is its
rollout-cluster-0F amendment) commissions two additions to this taxonomy.
Both are normative contract as written here; they enter the enforced registry
when 0090's clusters 0D/0E land, and neither is active in the shipped router
today.

### `DeclaredPublicApplicationData` response sensitivity

The `ResponseSensitivity` axis gains a class for **declared-public
application data**: arbitrary application query rows whose emission on a
tokenless or anonymous response is authorized by the query's own
codegen-compiled served-manifest facts — a `public` auth requirement,
`authorityIndependent`, the closed-inputs proof, and the fail-closed
`publicInline` disclosure declaration — **re-checked server-side at
admission**, never taken from the route/manifest author's declaration alone
(LLP 0090 §Authorization scope). No existing class fits: `StaticPublic` and
`PublicProjection` cover build-owned bytes and fixed typed shapes,
`PublicNoStore` covers fixed typed provider responses, and `ApplicationData`
is caller-scoped — whereas these are unbounded app-derived rows deliberately
served without a caller. The class governs exactly two lanes:

- the **Channel A HTML lane** — the served `index.html` carrying an embedded
  public-inline bundle (0090 D2); and
- **read-mode public bundles** — `POST /app/bundle` in read mode for
  `publicInline`-class manifest entries (0090 D1.2/D4), including the v1
  socket-less Channel C surface.

**Logging rules.** Although callers may read the rows, the operator-plane
posture stays that of application data: response bodies (rows, embedded
bundles) are excluded from body capture, access-log payloads, diagnostics,
and receipts. Route, method, status, manifest-entry/query identities,
`generation`, response sizes, timing, and coded refusal reasons
(`SNAPBACK_BUNDLE_*`, `SNAPBACK_RESUME_*`) are loggable — the declaration
widens disclosure to callers, not log retention. Embedded resume tokens are
authority-neutral and never widen invocation authority (0090 D1.1), but they
are still excluded from logs like the rows they accompany. Cache posture in
v1 is `Cache-Control: no-store` on both lanes (0090 pins uncached shipping;
its Q6 owns any future caching, which would revisit this class's cache
axis, not its logging rules).

**Anonymous-caller rate/budget posture.** Both lanes run anonymous
evaluation under bounded budgets, because a tokenless request now costs a
query evaluation rather than static bytes: Channel A pageload evaluation
runs under 0090 D2's bounded anonymous evaluation budget and degrades to the
unhydrated shell on over-budget, timeout, or failure — never a failed
pageload and never partial data; read-mode bundle requests carry the 0090
D1.2 hard limits (query count, rows, bytes, evaluation time) plus the
per-authority resume/request rate of cluster 0D, refusing with coded errors.
Anonymous callers get no weaker limit class than credentialed ones.

### Bounded pending-registration owner (register mode)

Active 0031 requires a current authenticated socket session before HTTP can
arm subscription demand — "socketless HTTP cannot arm demand" (§Connection
capability grants). 0090's bundle **register mode** (D1.2) needs to create
live registrations in the same response that returns the snapshots, before
any socket exists. This amendment defines the one sanctioned exception as a
**closed operation** owning bounded pending state:

- **Pending-registration owner.** A successful register-mode bundle creates
  a **pending-registration owner** — a bounded server-side owner of the
  registration set that is *distinct from a socket session*: it holds
  subscription demand without a socket, cannot receive fan-out, and exists
  only inside its attach-grace window. It is the only construct through
  which socketless HTTP may arm demand.
- **Atomic grant mint.** The register-mode response atomically mints the
  connection identity and connection grant under the existing
  §Connection-capability custody rules (server-minted secret, prod ids
  never caller-chosen) together with the registration set and the
  single-commit snapshot cut — one transaction; a failed bundle mints
  nothing and strands no server state.
- **Atomic handoff on attach.** The client's subsequent socket attach
  presents that grant and takes **atomic handoff** of the pending
  registrations: the pending owner's registrations become the socket
  session's rows in one step, with no window in which both or neither own
  them. Attach/close races, overlapping sockets (the hosted two-socket
  handoff overlap), and partial attach resolve under the existing
  one-current-socket-session rule; a socket that dies before attach leaves
  the pending owner intact until its deadline.
- **Attach grace and reaping.** Pending registrations live only until the
  response's `attachDeadline`; if no attach arrives they are reaped —
  demand disarmed, capacity released — on both arms (Cloudflare persistence
  and reaping of pending owners is part of the cluster-0D contract, with
  the same bounded-registry posture as hosted grants).
- **Idempotency and retry.** The request carries an idempotency key minted
  by the client **per boot attempt**. A key's *replay validity* is scoped by
  the tuple (authority, sender-key identity, credential incarnation,
  `generation`, manifest entry, canonical args); a retry after a lost
  response returns the same registration set (or atomically supersedes it),
  never a duplicate, while a different sender key presenting a known key is
  refused. **The identity vocabulary is LLP 0077's exact wire identities,
  not a parallel one:** "sender-key identity" is the session family's RFC
  7638 JWK **thumbprint**, and "credential incarnation" is the issuance
  **`sender_replay_epoch`** — the same (thumbprint, epoch) pair
  `BoundGrantAuthorityV2` binds with exact-tuple equality. Retry semantics
  ride 0077's sender-constrained model: the first execution and every retry
  each consume a proof nonce, and a retry after a lost response returns the
  registration set under a **freshly rotated connection-grant secret**
  bound to the same connection identity (re-returning a possibly-exposed
  secret verbatim is refused), with lost-response fixtures covering
  credential rotation and authority transition mid-retry. Two concurrent
  same-user boots hold distinct keys and produce distinct registration
  sets.
- **Credentialed callers only.** Register mode is scoped to credentialed
  callers in v1 — the replay-validity tuple has no defined thumbprint or
  replay epoch for an anonymous caller under 0077's custody model — and an
  anonymous register-mode request is refused to read mode.

**Implementation note (2026-07-24, LLP 0090 rollout step 2).** The local arm
landed `POST /app/bundle` (read + register) with the pending-registration
owner (`src/bundle.rs`, `src/server.rs` `app_bundle`), the
`DeclaredPublicApplicationData` response-sensitivity class in the enforced
registry, and the step-2 acceptance fixtures (`tests/rqs_bundle_v0.rs`).
Interim narrowings, each with a coded TODO in the implementation: the
replay-validity tuple's sender identity/incarnation are projections of the
resolved authority (the RFC 7638 thumbprint / `sender_replay_epoch` binding
awaits sender-constrained custody wiring on this route), and anonymous read
mode refuses fail-closed until the cluster-0C `publicInline` fact exists.
The Cloudflare arm is deferred with the rest of the RQS Cloudflare work.

**Acceptance obligation.** The register-mode acceptance suite MUST prove
that the "socketless HTTP cannot arm demand" invariant still holds
**outside this one closed operation**: no other HTTP route or operation can
create or extend pending demand, a reaped pending owner leaves no armed
demand, and the existing socket-session binding rules for subscribe,
unsubscribe, frames, fan-out, and demand counting are unchanged everywhere
else (0090 rollout step 2 carries the fixtures: lost-response retry,
sender-key mismatch refusal, attach-deadline reaping, anonymous refusal to
read mode, and no stranded server state on partial client installation).

## Dated amendment: hosted-arm root system-route migration (2026-07-25)

The invariant ("no system operation lives at the root") was violated by the
Cloudflare arm, whose gateway served its system operations at the root
(recorded as LLP 0093 OQ6/D3.1; author decision 2026-07-25: **migrate — no
provider-specific exception is minted**). The migration is executed (LLP
0094 §0A.3, `issues/closed/20260725-hosted-root-system-routes-migration.md`);
each route keeps its **existing auth gate** — the migration moves paths,
never authority. The hosted route rows:

| Old root route | New route | Class | Gate (unchanged) |
| --- | --- | --- | --- |
| `POST /cron/run` | `POST /_snapback/api/cron/run` | system API | hosted admin token (`x-snapback-admin-token`, POST-only, fails closed when unconfigured) |
| `GET /cron/status` | `GET /_snapback/api/cron/status` | system API (read) | public bounded typed projection; the admin token escalates to scrubbed operator detail |
| `GET /config/status` | `GET /_snapback/api/config/status` | system API (read) | hosted admin token, GET-only |
| `POST /reset` | `POST /_snapback/api/app/reset` | system API (destructive) | hosted admin token; mutex-serialized atomic reset |
| `POST /evict` | `POST /_snapback/api/object/evict` | system API | hosted admin token |
| `POST /host-call` | `POST /_snapback/host-call` | system seam | per-invocation host-call token (`x-snapback-host-token`); **not** the admin model, hence outside `/_snapback/api/` |
| `POST /__test/*` | `POST /_snapback/test/*` (same suffixes) | system testing seam | `SNAPBACK_TESTING=1` profile gate; categorically absent from production deploys, hence outside `/_snapback/api/` |

Naming follows D5 (`subsystem/verb` under `/_snapback/api/*`) for the
admin-model-gated rows; `/_snapback/host-call` and `/_snapback/test/*` sit
inside the reserved namespace but deliberately outside `/api/` because
their gates are not the admin authorization model. Two placement notes:

- The **local arm's private loopback host-call listener**
  (`src/workerd_exec.rs`) accepts the same `/_snapback/host-call` path so
  the single-sourced workerd harness sends one path on every arm. The
  loopback listener is not part of the public HTTP server and was never an
  invariant violation; the shared path is a single-sourcing convenience.
- The hosted gateway now refuses any *unmatched* `/_snapback/*` path with
  an explicit JSON 404 instead of the SPA asset fallback, so the reserved
  prefix stays exhaustively system-owned on the hosted arm too.

No root aliases were retained: every consumer is in-repo and repointed in
the same change. The hosted `cronStatus` public-projection posture is
recorded as-is (a bounded typed public read living under `/_snapback/api/*`
— the same compatibility posture as the local tokenless-loopback
`GET /_snapback/api/health` row). Hosted `/health`, `/inspect`,
`/capability`, and the app-data kit routes are unchanged: they are
app-data/public identity surfaces, not system operations. The hosted arm
has no enforceable route registry (the gateway is a hand-routed Worker);
the Cloudflare acceptance suites are its enforcement seam, and
`cloudflare/test/acceptance.mjs` + `acceptance.protocol-hardening.mjs`
exercise the migrated paths and gates.

*Dated correction (2026-08-05, LLP 0184 Phase 0 item 5 audit):* the hosted
route table above was one row short of `gateway.js`'s real path count —
`/_snapback/api/debug/network-profile` (the LLP 0167 runtime network-profile
selector) was hand-routed in `gateway.js` before this table was written and
was never added to it. It has no root alias (introduced directly under the
reserved namespace, not part of the 2026-07-25 root migration), so it is
recorded here rather than in the migration table above:

| Route | Class | Gate |
| --- | --- | --- |
| `GET,HEAD /_snapback/api/debug/network-profile` | system API (read) | admin-read gate (coordinator-owned) |
| `<write> /_snapback/api/debug/network-profile` | system API | admin-write activation gate (coordinator-owned) |

`gateway.js` hand-routes every HTTP method for this single path to the
coordinator with no method-level branch of its own; the coordinator is what
dispatches `GET`/`HEAD` through the admin-read gate and any write method
through the admin-write activation gate — two distinct semantic operations
sharing one path, with different authority, effect, and schema. This is the
worked example LLP 0184 §3a uses for why the hosted-adapter manifest it
specifies must key entries by `(method, path, operation)` rather than by
path alone. The full first-pass audited inventory of `gateway.js`'s
hand-routed system/control paths — including this correction — is checked
in at
[`cloudflare/gateway-paths.inventory.json`](../cloudflare/gateway-paths.inventory.json);
Phase 1's hosted-adapter manifest is generated against that fixture.

### Hosted app-data SPA-fallback refusal (2026-08-08)

The static-assets binding may implement a single-page-app fallback by
returning `200 text/html` for an unknown URL. That behavior is valid for web
navigation but invalid for reserved app-data namespaces: it turns a missing
backend route into a false-success HTML response. After all implemented exact
and regex routes have taken precedence, the hosted gateway probes the asset
response for paths under `/auth`, `/assets`, `/ephemeral`, `/push`,
`/app-api`, `/client-mutations`, `/live`, `/outbox`, `/query`, `/mutation`,
`/action`, and `/connection`. A `200` HTML fallback becomes HTTP 501 with a
versioned `ErrorResponse` whose diagnostic code is
`SNAPBACK_ROUTE_UNSUPPORTED_ON_TARGET`; its details name the path and
`target: "cloudflare"`. Real non-HTML assets and non-200 asset responses pass
through unchanged. Prefix comparison is segment-boundary-aware, so a web path
such as `/querying` is not captured.

This refusal states target availability only. It neither claims the missing
local route exists on Cloudflare nor reclassifies an app-data namespace as a
system/control surface.

## Dated amendment: asset upload-session route family (2026-07-31)

[LLP 0044](./0044-asset-storage-pipeline.rfc.md) (tickets L1-04/L1-05)
registers the root-level AppData asset family:

- `POST /assets/attempts` — attempt creation; runs the generated
  upload-intent authorizer, so its invocation source is query-shaped
  (`HttpQuery`) and its sessions carrier is the ordinary
  `OptionalSessionBearer`/`ResolvedCaller` app posture;
- `POST /assets/attempts/{id}/finalize` (L1-06) — the trusted finalizer;
  witness re-validation can re-run the authorizer, so it is query-shaped
  (`HttpQuery`) like creation;
- `GET /assets/attempts/{id}` (inspect), `POST /assets/attempts/{id}/cancel`;
- `GET /assets/records/{id}` (L1-08) — the caller-facing asset metadata
  read; it decides through the declared read-access policy (LLP 0044
  §Asset read authorization), so it is query-shaped (`HttpQuery`);
- `HEAD|PATCH|DELETE /assets/tus/{id}` — the TUS 1.0.0 resource, wrapped by
  Snapback admission (TUS is never the authority model);
- `GET /assets/records/{id}/bytes/{variant}` (L1-09) — strict delivery
  over `(asset, rendition)` aliases only; blob keys never appear in URLs,
  every ordinary and range request re-authorizes through the declared
  read-access policy (query-shaped, `HttpQuery`), and responses carry
  `Cache-Control: private, no-store` with attachment disposition forced
  for active-content types. The image program (P-04, 2026-07-31) adds
  the declarative selector as the reserved variant `best` with a
  required `maxWidth` query parameter — the widest Ready rendition
  within the bound, else the narrowest available — changing no route
  shape and no authority posture;
- `DELETE /assets/records/{id}` (L1-10) — the owner's explicit delete
  running the one-transaction cascade; refuses while typed reference
  edges remain (the records path's second method — same-path
  multi-method, like the TUS resource).

The inspect/cancel/TUS rows share the new authority-only `AssetTransfer`
invocation source: the intent authorizer ran at attempt creation, and
possession of an attempt URL is not authority — every operation re-resolves
the caller and matches the admission's owner principal. All ten rows are
`AppData`/`AppAuth` with the standard sessions overlay (legacy body
authority rejected; covered by the session body-probe sweep, with the HEAD
probe asserting status only since HEAD responses carry no body, and the
GET delivery/DELETE probes asserting status likewise since neither takes a
JSON body). The TUS
resource is this registry's first same-path multi-method family: the rows
stay one-per-method in the registry, and the router merges them onto one
installed path with a single OPTIONS fallback, each method keeping its own
registration's policy middleware.

The W2b delivery-profile landing (2026-07-31, same day) extends the family
with the signed and public lanes:

- `POST /assets/records/{id}/signed-url` — `private-signed` issuance;
  per-request authorized exactly like strict delivery (query-shaped,
  `HttpQuery`, ordinary app-auth sessions posture), returning a bearer URL
  bounded by the declared TTL facts;
- `GET /assets/signed/{id}/{variant}` — the signed serve lane. `AppData`
  with `RoutePolicy::Public` and no credential resolution: the token query
  parameter is the entire credential, validated against the instance
  signing keys, the token's expiry, and the asset's *current* lifecycle
  generation; responses are privately cacheable only within the remaining
  bearer window;
- `GET /assets/public/{id}/{variant}` — the `public-immutable` lane.
  `AppData`/`Public`, no credential; only a Ready asset whose declared
  profile is public serves, everything else is indistinguishable from
  unknown (the public lane is never an existence oracle), and responses
  carry `Cache-Control: public, max-age=31536000, immutable` with
  rendition-id ETags.

The rotation operator surface is not a route: `asset.rotateSigningKey`
joins the LLP 0024 host-operation registry beside the other `asset.*`
operations (AdminWrite, NonProd).

*Dated addition (2026-07-31, author-approved — LLP 0044 §Delivery
profiles dated note):* the two URL-authority serve lanes above
(`/assets/signed/{id}/{variant}`, `/assets/public/{id}/{variant}`) are
exempt from the sessions-mode auth-client protocol-offer requirement —
plain `<img src>`/CDN/pasted-link consumers can send no custom headers,
and these lanes negotiate nothing. The exemption is the closed
`pasteable_delivery_route` predicate (structural properties AND the
explicit path pair, so no future public route inherits it by shape);
issuance and strict delivery keep the offer discipline.

## Dated amendment: versioned seed route family (2026-07-27)

LLP 0109 registers
`/_snapback/api/app/seed/{ensure-v1,preview-v1,reset-install-v1,clear-v1}` as
reserved administrative app-lifecycle routes. Each is centrally classified
AdminWrite and NonProd before its closed Rust body is parsed or seed state is
inspected. The four routes have one-to-one LLP 0024 host-operation names and
no legacy or root alias.

*Dated supplement (2026-08-03, LLP 0109 acceptance — decision sitting #2
extension, `issues/20260803-author-decision-sitting-2.md`):* the family's
gate order and response posture are normative. Authentication/profile
refusal precedes seed-state inspection, operation replay, and
request-specific diagnostics, and the closed body is decoded only behind
the gate — including read-only `preview-v1`, which deliberately carries the
same `AdminWrite + NonProd` requirement as the effectful routes (LLP 0109
§16.3). Seed responses and diagnostics are redaction-bounded: underlying
membership/schema/storage failures surface through a schema-owned public
projection whose safe details are limited to format/protocol versions,
`appId`, `seedVersion`, digests, target-table names and empty/nonempty
counts, schema hash, profile, and the opaque stream identity — never row
values, principals, credentials, filesystem paths, provider/credential
facts, or secret-like argument bytes. The original bounded detail is
reachable only through this Spec's separately gated sessions
`AdminSecretRead`/developer twin where its own policy permits it.

## Dated amendment: app-CLI exact scoped-token release (2026-08-01)

The registry adds `POST /auth/agents/token/release` as an `AppData` route with
`Public` path policy, the closed `ScopedTokenReleaseBody` credential resolver,
`InvocationAuthority::None`, no legacy-body authority, and
`PublicNoStore` response sensitivity. The body is exactly `{ token: sbagt_ }`;
an `Authorization` header is contradictory and refused. Although the response
is an opaque empty `204`, middleware treats the request as secret-bearing: the
token is excluded from buffering beyond the bounded auth body, logs,
diagnostics, receipts, and inspection.

`ScopedTokenReleaseBody` is deliberately distinct from ordinary
`OptionalSessionOrScopedToken`: it resolves an already-revoked stored token so
a lost success can be retried, installs no caller, and authorizes only the
destroy-only effect on that exact carrier. The metadata validator admits this
resolver only on `Public` + `None` + `PublicNoStore` rows, in both dev and
sessions overlays. The router/registry parity set, route-policy matrix, method
probe, independent throttle inventory, and response-control probe include the
new path.

## Dated amendment: LLP 0204 external-surface route families (2026-08-08)

**Commissioned by:** [LLP 0204](./0204-app-external-surfaces.rfc.md), D1,
D8, D9.4, and the OQ9 ruling.

**Status:** the OAuth facade family is implemented by `S2 Landing C`
(2026-08-09), including the registered policy tuples, metadata projections,
and local-only hosted refusal. The capability-link and external-anonymous rows
later in this amendment remain commissioned design. Every route row in this
amendment is refused wholesale on hosted targets in v1, per LLP 0055's existing
plane posture and LLP 0150 §8.

### OAuth facade and origin-root discovery

The OAuth facade is an **AppData authentication family**, extending the current
root `/auth/*` precedent in the
[app-data route matrix](#app-data-http-and-websocket-surface). Its closed
operations are:

| Route / operation | Effective policy | Response sensitivity |
| --- | --- | --- |
| `GET /.well-known/oauth-authorization-server` | `Public`; no credential or invocation authority | closed `PublicNoStore` OAuth metadata projection |
| `GET /.well-known/oauth-protected-resource` | `Public`; no credential or invocation authority | closed `PublicNoStore` protected-resource metadata projection |
| `POST /auth/oauth/register` (RFC 7591 DCR) | `Public` path with `OperationSpecific` proof/invitation resolution; no invocation principal | `CredentialSecret`, because a permitted facade profile may return client-registration credential material; always `no-store` |
| `GET|POST /auth/oauth/authorize` | `SessionAuth`; exact current session resolves the consenting user; legacy/body authority rejected | caller-scoped `ApplicationData`; this row forces `Cache-Control: no-store` on the caller-scoped response because the page carries integration, scope, and consent facts |
| `POST /auth/oauth/token` | `Public` path with `OperationSpecific` authorization-code, PKCE, and sender-proof resolution; no body-selected principal | `CredentialSecret`; always `no-store` |
| `POST /auth/oauth/revoke` | `Public` path with an operation-specific destroy-only credential resolver; no invocation principal | closed `PublicNoStore` acknowledgement |

DCR's interaction with `disabled`, `invited`, and `open` is not route-local
policy: LLP 0055's
[2026-08-08 integration-registration amendment](./0055-agent-principals-and-scoped-grants.rfc.md#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08)
owns that creation transaction. In particular, a public DCR path does not mean
open registration; the operation-specific resolver reaches creation only after
the current registration mode and any required invitation validate under LLP
0055's creation-source and consumption-profile rules.

The two `/.well-known/*` documents are the deliberate origin-root exception.
RFC 8414 authorization-server discovery derives the
`/.well-known/oauth-authorization-server` location from the issuer, and RFC
9728 protected-resource discovery derives
`/.well-known/oauth-protected-resource` from the protected resource. Moving
either document under `/auth/*` or `/_snapback/*` changes the standard-derived
URL and makes a conforming generic client miss it. Their root placement does
not weaken [The invariant](#the-invariant): they are public AppData discovery
operations, not system/control operations, and every non-metadata facade
operation remains under the established root `/auth/*` family.

Their advertised issuer, protected resource, and endpoint origins are derived
from the listener address captured at bind time. Request `Host`, forwarded
headers, and other client-controlled scheme/authority material never select
those URLs. The current published LAN relay does not route the OAuth family;
if a future trusted front does, it must install a server-owned front identity
rather than infer one from request headers.

### Durable-watch management family

The v1 durable-watch management family is:

| Route / operation | Effective policy | Response sensitivity |
| --- | --- | --- |
| `POST /watches` | AppData creation; `SessionAuth` with `RequiredSessionOrScopedToken`; sessions create user/revalidatePrincipal watches and active delegated integrations create integration/capturedGrant watches; every named function passes the ordinary invocation gate | `SensitiveApplicationData`; returns the created owner-scoped record and, only when generated, the webhook signing secret once; always no-store |
| `GET /watches` | AppData inspection; `SessionAuth` with `RequiredSessionOrScopedToken`; lists only the resolved user or integration actor's records | `SensitiveApplicationData`; includes bounded counters, notification, and recent firing outcomes, always no-store |
| `DELETE /watches/{id}` | AppData management; `SessionAuth` with `RequiredSessionOrScopedToken`; owner-only terminal transition | `PublicNoStore`; successful deletion returns no body |
| `POST /watches/{id}/suspend` | AppData management; `SessionAuth` with `RequiredSessionOrScopedToken`; owner-only reversible admission stop | `SensitiveApplicationData`; returns the updated owner-scoped record, always no-store |
| `POST /watches/{id}/resume` | AppData management; `SessionAuth` with `RequiredSessionOrScopedToken`; owner-only reactivation without renewal | `SensitiveApplicationData`; returns the updated owner-scoped record, always no-store |
| `POST /watches/{id}/renew` | AppData consent; `SessionAuth` with exact `RequiredSessionBearer`; only the effective consenting user may replace a live watchAnchor, with `ttlMs` bounded to 365 days | `SensitiveApplicationData`; returns the renewed record without any secret, always no-store |

**Implementation status (external-automations bundle, 2026-08-10):** all six
rows are implemented for user-owned `revalidatePrincipal` and
integration-owned `capturedGrant` watches when `api.enabled`.
The request body never selects an actor: legacy/body authority is forbidden,
and the resolved provider session is the owner. Scheduled evaluation and
reaction use internal source classes with credential-free, freshly revalidated
owner authority; those classes are not reachable through a public route.
Scoped-token management is confined to its integration actor; renewal remains
fresh session consent. Function and webhook reactions share the same internal
source, durable job, budget, storm-control, and bounded journal machinery.

### Capability-link mint and serve family

The v1 capability-link family is:

| Route / operation | Effective policy | Response sensitivity |
| --- | --- | --- |
| `POST /capability-links` | AppData mint; `SessionAuth` with an exact `RequiredSessionBearer` establishes the minter, and the function scope gate runs before creation | `CredentialSecret`; the returned URL/token is no-store and never logged |
| `GET /capability-links/{token}` | AppData/Public path with a `CapabilityLinkBearer` request-secret resolver, `InvocationAuthority::None`, and no effect | `PublicNoStore` inert landing projection; it never invokes the function, consumes a use, or echoes the token |
| `POST /capability-links/{token}/invoke` | AppData/Public path with `CapabilityLinkBearer`; resolves anonymous function authority only after link/minter-lineage/admission checks | `ExternalAnonymousApplicationData` below; always no-store |
| `DELETE /capability-links/{id}` | AppData mint-management; `SessionAuth` with exact `RequiredSessionBearer`; only the minting session and authority instance may revoke | `PublicNoStore`; successful instant revocation returns no body |

**Implementation status (S5 Landing A, 2026-08-09):** these rows are
implemented for LLP 0204's external anonymous set. The stored minter session
and authority instance bind the exact revocation act; use-time lineage follows
the continued validity of the human minter principal rather than the liveness
of that original session. Bounded `use_count` plus last-use/outcome facts and
the `link` telemetry attribution lane are the v1 per-use journal; full audit
rows remain owned by the audit-log program. Extending the bearer to granted
operations remains commissioned. S5 Landing C implements D9.5 for the
anonymous-set carrier: mutating links may be multi-use only when the function
gate or the mint's `approval: true` makes every use a pending effect, and the
minter is the only approver.

The path placeholder is credential material, not a loggable identifier. Router
normalization must replace it with the registered template before access-log,
trace, diagnostic, receipt, or error rendering; raw upstream/proxy logging of
the request target is incompatible with the route. The response middleware
sets `Referrer-Policy: no-referrer`, emits no third-party subresources, and
forbids redirects carrying the token. The GET row is intentionally inert so
preview crawlers cannot trigger an invocation or state transition. The POST row
owns the real use and applies LLP 0150's
[2026-08-08 capability-link exception](./0150-agent-token-acquisition.rfc.md#dated-amendment-llp-0204-capability-link-bearer-exception-2026-08-08),
including instant revocation, per-use journaling, minter-lineage death, and the
approval-or-single-use rule for mutations/actions.

For a query link, the landing projection obtains its live result only through
the non-GET invoke route — a client-issued POST from the landing page; GET
itself stays inert — which is how LLP 0204 D9.4's live result view for queries
is deliverable with no state change on GET.

`CredentialSecret`, `PublicNoStore`, and request-secret ingestion retain their
existing meanings under [Independent policy axes](#independent-policy-axes).
The mint row's `RequiredSessionBearer` and `CapabilityLinkBearer` are closed
resolvers, not aliases for a generic bearer: wrong-class credentials refuse
before lookup, as the existing
[agent-auth route-class amendment](#dated-amendment-agent-auth-route-classes-2026-07-16)
requires for its credential families, and a capability-link token never becomes
a session, grant, or actor principal.

### `ExternalAnonymousApplicationData` contract

`ResponseSensitivity` gains **`ExternalAnonymousApplicationData`**, a sibling
of — not an expansion of — `DeclaredPublicApplicationData`. It covers an
arbitrary app-derived response produced on an LLP 0204 external projection
without authenticated caller authority. Selection requires all of these facts
to be re-checked server-side before the handler runs:

1. the function is exposed under LLP 0204 D1;
2. its active authorization declaration is `public`, or is `optional-user` and
   this invocation has no user context;
3. the route/operation is one of the closed external projections using this
   class; and
4. LLP 0071's
   [2026-08-08 external-anonymous admission contract](./0071-application-abuse-moderation-and-audit.rfc.md#dated-amendment-llp-0204-external-anonymous-admission-2026-08-08)
   has admitted and atomically charged the request.

The class is response handling, not authorization: setting it in registry
metadata cannot expose a function, make an authenticated function anonymous,
or bypass admission. v1 responses are `Cache-Control: no-store`; app-derived
bodies, arguments, link templates, subjects, and values are excluded from body
capture, logs, diagnostics, and receipts. Route template, method, status,
function/integration class, response byte count, duration, and coded refusal
remain loggable after credential and declared-id redaction.

The existing
[§`DeclaredPublicApplicationData` response sensitivity](#declaredpublicapplicationdata-response-sensitivity)
continues to govern **exactly** its two stated lanes: LLP 0090's Channel A
inlined-HTML lane and read-mode public bundles. It is not widened to the LLP
0204 external anonymous set. The new sibling exists because that set includes
both `public` and anonymous `optional-user` functions across external
projections, rather than only LLP 0090's two `publicInline` read lanes.

The route/operation parity set must enumerate every consumer of
`ExternalAnonymousApplicationData`, and negative fixtures must prove that an
unexposed function, an authenticated-only function, a declared-id budget
failure, a network-floor failure, and a link outside the v1 anonymous set all
refuse before a sentinel handler effect. These are acceptance obligations for
the implementing landing, not evidence that it exists today.

## Dated amendment: LLP 0204 S1 versioned external finite family (2026-08-09)

**Commissioned by:** [LLP 0204](./0204-app-external-surfaces.rfc.md) D1/D2;
**implemented** at the S1 Landing 1 commit (`4b401a9e8`), unlike the
2026-08-08 amendment above, which remains commissioned design.

### The `/api/v1` app-data family

Three registered AppData routes extend the finite invocation family:

| Route | Effective policy | Notes |
| --- | --- | --- |
| `POST /api/v1/query/{name}` | identical tuple to `POST /query/{name}` (AppAuth path, sessions overlay → `OptionalSessionOrScopedToken`) | dispatches to the same handler |
| `POST /api/v1/mutation/{name}` | identical tuple to `POST /mutation/{name}` | same handler |
| `POST /api/v1/action/{name}` | identical tuple to `POST /action/{name}` | same handler |

The family is the *advertised external projection* of the finite surface;
`v1` names the contract regime (additive-only per the LLP 0204 OQ4 ruling),
not the app generation. Family-specific semantics, enforced before the shared
handler runs:

- **Unpinned.** A request carrying `expectedGeneration` is refused with
  `SNAPBACK_API_GENERATION_PIN_UNSUPPORTED` (400) rather than silently
  ignored; internal clients keep pinning on the bare family.
- **Exposure-gated for every authority class.** When the active manifest has
  no `api` block or `api.enabled` is false, every invocation refuses with
  `SNAPBACK_API_NOT_ENABLED` (403); an unexposed function refuses with
  `SNAPBACK_API_EXPOSURE_DENIED` (403) even where the bare route would admit
  the same anonymous caller. The bare routes retain LLP 0204 D1's honest
  limit for anonymous-admitting functions; this family is strictly opt-in
  surface. Credentialed (service-principal) exposure enforcement is not
  route-local: it lives at the invocation-gate chokepoint and covers the
  bare finite routes, live initial/rerun, and nested code-mode invocations
  identically.
- **No authorized-lease mint.** The `/query/{name}/authorized-lease` row has
  no `/api/v1` sibling (LLP 0055 pins the v1 service-principal surface to
  the finite routes plus `/connection/open`; retained reads are a non-goal).

### `api.origins` bearer-token CORS statement

The manifest's `api.origins` list grants cross-origin browser access to the
`/api/v1/*` family and `/mcp`. Because [LLP 0039's deferred origin-allowlisting
contract](./0039-auth-vertical-slice.rfc.md) is scoped to cookie transport,
this amendment carries its own statement for bearer transport:

- Matching is an exact scheme+host+port string comparison against the
  declared list; wildcards are refused at authoring and activation
  (`SNAPBACK_API_ORIGIN_INVALID`). No declaration means no CORS beyond the
  existing loopback dev behavior — today's posture.
- A matching origin is echoed in `Access-Control-Allow-Origin` with
  `Vary: Origin`. Credentialed CORS (`Access-Control-Allow-Credentials`) is
  never emitted: external calls authenticate with bearer headers, not
  cookies, so the cookie-scoped LLP 0039 contract is not implicated.
- The grant does not extend to system routes, the bare finite family, or
  the app-api discovery pair; those keep their existing posture.

The route registry remains the single method inventory (the CORS
allow-methods projection continues to derive from it), and the three rows
surface in `schemas/http.routes.v1.json` through the standard generator with
the same input/output schema refs as their bare siblings.

## Dated amendment: LLP 0204 S2 integration lifecycle routes (2026-08-09)

**Commissioned by:** [LLP 0204](./0204-app-external-surfaces.rfc.md) D7 and
the [LLP 0055 integration-registration amendment](./0055-agent-principals-and-scoped-grants.rfc.md#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08);
**implemented** by `S2 Landing A`.

The integration-registration class, companion record, terminal retirement,
and reversible suspension use these registered routes:

| Route / operation | Policy tuple | Body / result |
| --- | --- | --- |
| `POST /auth/integrations/retire` | `AppData`, `Public`, `AgentFamilySecretBody`, `InvocationAuthority::None`, `LegacyBodyPolicy::NotApplicable`, no extra effect, `PublicNoStore` | closed credential body; `204` |
| `POST /_snapback/api/auth/integrations/{id}/retire` | `SystemApi`, `AdminWrite`, `AdminCredential`, `InvocationAuthority::Operator`, `LegacyBodyPolicy::NotApplicable`, `AgentDestroyCapability`, `OperatorMetadata` | empty body; `204` |
| `POST /_snapback/api/auth/integrations/{id}/suspend` | `SystemApi`, `AdminWrite`, `AdminCredential`, `InvocationAuthority::Operator`, `LegacyBodyPolicy::NotApplicable`, no extra effect, `OperatorMetadata` | empty body; status projection |
| `POST /_snapback/api/auth/integrations/{id}/resume` | same tuple as suspend | empty body; status projection |
| `auth.integrationRetire` | host-ops projection of the retirement operator tuple above | closed `principalUserId` args; ordinary `hostOpsResult` |
| `auth.integrationSuspend` / `auth.integrationResume` | host-ops projection of the suspension operator tuple above | closed `principalUserId` args; ordinary `hostOpsResult` |

On `prod`, operator retirement requires both `AdminWrite` and the independent,
process-bound, non-browser `AgentDestroyCapability`; dev/test/demo require
`AdminWrite` only. The key-holder route accepts a live or attributable
tombstoned integration credential-family secret and is destroy-only.
Suspension is reversible admission state and is not represented or described
as credential or grant revocation.

The OAuth discovery, DCR, authorization, token, and revocation facade rows in
the 2026-08-08 LLP 0204 amendment are implemented by `S2 Landing C`. The
capability-link family remains commissioned design.

## Dated amendment: LLP 0204 S2 declared-client operator routes (2026-08-09)

**Commissioned by:** [LLP 0204](./0204-app-external-surfaces.rfc.md) D7 and
the [LLP 0071 external-anonymous admission amendment](./0071-application-abuse-moderation-and-audit.rfc.md#dated-amendment-llp-0204-external-anonymous-admission-2026-08-08);
**implemented** by `S2 Landing B`.

The bounded declared-client ledger has one operator read projection and four
registered mutation routes. The id travels in the JSON body because its
free-form normalized profile may contain characters unsuitable for a path
segment.

| Route | Policy tuple | Body / result |
| --- | --- | --- |
| `GET /_snapback/api/auth/declared-clients` | `SystemApi`, `AdminRead`, `AdminCredential`, `InvocationAuthority::Operator`, `LegacyBodyPolicy::NotApplicable`, no extra effect, `OperatorMetadata` | empty body; bounded usage/status projection |
| `POST /_snapback/api/auth/declared-clients/bless` | `SystemApi`, `AdminWrite`, `AdminCredential`, `InvocationAuthority::Operator`, `LegacyBodyPolicy::NotApplicable`, no extra effect, `OperatorMetadata` | closed `{clientId}` body; status projection |
| `POST /_snapback/api/auth/declared-clients/suspend` | same tuple as bless | closed `{clientId}` body; status projection |
| `POST /_snapback/api/auth/declared-clients/resume` | same tuple as bless | closed `{clientId}` body; active-status projection |
| `POST /_snapback/api/auth/declared-clients/delete` | same tuple as bless | closed `{clientId}` body; `204` |

`Snapback-Client-Id` is admitted only on the registered `/api/v1/*` family and
`/mcp`;
the bare first-party routes ignore it. Browser callers may present that header
through the external family CORS lane, and may read the
`Snapback-Client-Id-Status` response header. Parsing, bounded-ledger,
network-floor composition, suspension, and fresh-identity upgrade rules remain
normatively owned by LLP 0071 and LLP 0204 D7.

## Dated amendment: LLP 0204 S2 remote MCP route (2026-08-09)

**Commissioned by:** [LLP 0204](./0204-app-external-surfaces.rfc.md) D3;
**implemented** by `S2 Landing E`.

The app's standards-facing MCP server is one registered AppData path with
three method rows:

| Route | Policy tuple | Transport behavior |
| --- | --- | --- |
| `POST /mcp` | identical finite-function tuple to `/api/v1/*`: dev `AppAuth`/`LegacyBodyAuth`/`ClientAsserted`; sessions overlay → `Public`/`OptionalSessionOrScopedToken`/`ResolvedCaller`, legacy body authority rejected; `ApplicationData` | one JSON-RPC request per POST; JSON response or one-event SSE response |
| `GET /mcp` | same tuple | `405 Method Not Allowed`; v1 has no server-initiated stream |
| `DELETE /mcp` | same tuple | `405 Method Not Allowed`; v1 issues no `Mcp-Session-Id`, so there is no session to terminate |

This is the stateless subset of Streamable HTTP: POST is the only message
carrier, a response may use `application/json` or `text/event-stream`, and the
server neither creates transport sessions nor initiates streams. GET and
DELETE are registered so their absence is explicit and policy-covered rather
than an accidental router gap. The route uses MCP protocol version
`2025-06-18` and re-reads the current envelope for every request.

The catalog contains `describe_api` plus one deterministic tool for every
currently exposed function. Tool names are `snapback_fn_` followed by the
lowercase function id with non-ASCII-alphanumeric/non-underscore characters
replaced by `_`; a sanitized-name collision gains the first eight hexadecimal
SHA-256 characters of the original stable id. Each tool carries its original
function id in `_meta["snapback/functionId"]`, making the mapping reversible.
Listing is the public exposed envelope projection for every authority class;
authentication and exact facade/scoped-token grants constrain calls rather
than turning discovery into an authority oracle. Calling a known but hidden tool still enters the shared
finite path and returns an MCP tool error containing the canonical
`SNAPBACK_API_EXPOSURE_DENIED` diagnostic rather than becoming an unknown-tool
oracle.

`initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, and
`resources/read` are implemented. The three read-only resources are generated
from the same current envelope: the canonical envelope, OpenAPI projection,
and agent skill. `describe_api` generates their HTTP discovery pointers and
the OAuth metadata pointers. At S2 Landing E, `run_code` and `ask` were
deliberately absent and advertised as deferred to LLP 0204 S4. S4 Landing B
registered `run_code` with the same per-target typed capability refusal as
`/api/v1/run`. S4 Landing C registers `ask` only when `api.ask.enabled` and
its complete budgets are active; MCP execution is synchronous in v1.

Bearer facade tokens, anonymous external admission, exposure and exact grant
scope, suspension, network/declared/integration budgets, and caller
attribution all flow through the same registered middleware and per-kind
finite handlers as `/api/v1`. `Snapback-Client-Id` therefore has the same
declared-tier semantics on `/mcp`; the bare first-party routes still ignore it.
The JSON-RPC route has honest-null schema references because its method and
tool schemas are generated from the current envelope rather than committed as
standalone Rust DTO schema artifacts.

## Dated amendment: LLP 0204 S4 external execution surfaces (2026-08-09)

**Commissioned by:** [LLP 0204](./0204-app-external-surfaces.rfc.md) D6 and D9.1;
**implemented** by `S4 Landing A` (private streams) and `S4 Landing B`
(`/api/v1/run` registered refusal surface).

### Private stream routes

The first streaming-conversation landing adds two exact root AppData route
rows. Neither is a chunk transport: live chunks use the already-classified
connection-authenticated live/ephemeral socket machinery.

| Route | Policy tuple | Result |
| --- | --- | --- |
| `GET /streams/{attempt_token}` | dev `AppAuth`/`LegacyBodyAuth`/`ClientAsserted`; sessions overlay → `SessionAuth`/`RequiredSessionOrScopedToken`/`ResolvedCaller`, legacy body authority rejected; `SensitiveApplicationData` | immutable transcript for the initiating session user or service credential; unknown → 404, known foreign → 403; `no-store, private` |
| `POST /streams/{attempt_token}/cancel` | same tuple | same-initiator cancellation of the host-owned attempt; the committed terminal winner is returned; `no-store, private` |

The path token is an opaque locator, never its own authority. Both handlers
compare the resolved session-user or service-credential identity with the
attempt's durable initiator identity after lookup. Anonymous chunk viewing is
connection-bound on the existing live transport and has no transcript HTTP
read lane in v1.

Streaming actions invoked anonymously additionally bind the ordinary action
request's optional `streamConnectionId` to the existing
`Snapback-Connection-Token` carrier through the connection registry before an
attempt can start. The body field is a locator and the header remains the sole
connection credential; a non-anonymous connection authority is refused. This
closed branch exists only for a manifest-proven `stream: true` action and does
not make the general action route connection-authenticated.

Route registry parity, invocation-source mapping (`HttpQuery` for transcript
read, `HttpAction` for cancel), sessions carrier coverage, empty-body probes,
error status mapping, and the guide surface map cover both exact rows. The
remote `/mcp` contract remains stateless and does not gain GET streaming.

### Registered code-mode submission

`POST /api/v1/run` is a fourth exact `/api/v1` AppData row with the finite
family's dev tuple and sessions overlay: `AppAuth` / `LegacyBodyAuth` /
`ClientAsserted` becomes `Public` / `OptionalSessionOrScopedToken` /
`ResolvedCaller`, legacy body authority is rejected, and the response class is
`ApplicationData`. Its `InvocationSource::HttpRun` is authority-only: a code
program is not an app function, and any eventual injected-client calls must
prepare the ordinary per-kind finite sources independently.

The handler validates the real submission contract in this order after the
registered transport/authority gates: `api.enabled`; a closed JSON object with
`program` (at most 1 MiB), `envelopeDigest`, and optional object `args`; exact
match with the current envelope digest; then the D6 capability gate. A stale
digest is `SNAPBACK_API_RUN_ENVELOPE_STALE` (409) and carries the current
digest. Every current target reaches
`SNAPBACK_API_RUN_UNTRUSTED_CODE_UNSUPPORTED` (501): the gate requires the
`hosted_untrusted_code` gap to be absent and every LLP 0047 resource-limit row
to be uniquely `Enforced`. Owner-code `runtime-qualify` evidence is never
consulted.

No checker or executor ships behind that refusal. A manifest that eventually
passes the evidence gate reaches one explicit author-promotion match arm which
still returns the same typed refusal today. The route's schema-export row is
honestly null until that promotion lands. MCP `run_code` is a real advertised
tool with the same target conditionality and refusal; `describe_api` no longer
lists it as deferred.

### Read-only near-data ask

`POST /api/v1/ask` is a fifth exact `/api/v1` AppData row with the same dev
tuple and sessions overlay as `/api/v1/run`: `AppAuth` / `LegacyBodyAuth` /
`ClientAsserted` becomes `Public` / `OptionalSessionOrScopedToken` /
`ResolvedCaller`, legacy body authority is rejected, and the response is
`ApplicationData`. `InvocationSource::HttpAsk` is authority-only. Each nested
catalog query derives an ordinary `HttpQuery` target from the unchanged
prepared caller, admission lease, grant scopes, and publication fences.

The handler's closed body is `{ task, resultSchema?, stream? }`; there is no
`args` or mutation carrier. The distinguished caller-key provider credential
is accepted only on this POST route in `X-Snapback-Ask-Provider-Key`, never a
path, query, log, transcript, or durable value. The catalog intersects the
current envelope projection with exposed `Query`/`LiveQuery` definitions, so
mutation and action tools are absent regardless of grant.

App-paid execution requires the `snapback:ask:data-egress` consent scope;
caller-key billing requires a granted read principal. Anonymous and declared
external lanes therefore reach a typed 403 after ordinary external admission,
never provider egress. The exact manifest-activated ledger reserves maximum
tokens/result bytes before execution and transactionally replaces the
reservation with actual usage after every terminal outcome. Streaming-default
HTTP requests use the existing host-owned attempt and private transcript
records; MCP forces the same final envelope synchronously and has no v1 MCP
stream.

The schema-export row is honestly null because the body and receipt envelope
remain handler-owned DTOs rather than committed standalone artifacts. Route
registry parity, sessions forbidden-field probes, invocation-source mapping,
network-lane classification, status-family review, guide capability/surface
maps, and MCP tool discovery cover the new row.

## Dated amendment: LLP 0204 S5 approval-gated effect family (2026-08-10)

**Commissioned by:** [LLP 0204](./0204-app-external-surfaces.rfc.md) D9.5 and
the OQ9 ruling; **implemented** by `S5 Landing C`.

### Approval-gated effect family

The management family adds three exact root AppData rows:

| Route | Policy tuple | Result |
| --- | --- | --- |
| `GET /effects` | `SessionAuth` / `RequiredSessionBearer` / `ResolvedCaller`; legacy body authority rejected | `SensitiveApplicationData`; returns at most 256 live pending effects the session user may approve, with link-originated effects visible only to the minter |
| `POST /effects/{id}/approve` | same tuple; ordinary function policy is revalidated for the approver and the frozen original caller | `SensitiveApplicationData`; atomically decides, then executes through the ordinary mutation/action path with original-caller attribution plus the approver fact |
| `POST /effects/{id}/deny` | same tuple; exact approver selection rechecked in the decision transaction | `SensitiveApplicationData`; terminally refuses the effect without function execution |

`EffectManagement` is a session-only authority source. The internal
`EffectExecution` source is not route-selectable: it exists solely to restore
the frozen original caller after approval and cannot recursively create a
second pending effect. Approval revalidates function id/kind, active generation,
current exposure and approval gate, argument contract and digest, original
authority, current approver policy, expiry, and capability-link minter lineage.
Authority-creating functions consume the existing operation-bound step-up
proof in the same decision transaction.

Mutation/action calls on the bare routes, `/api/v1`, remote MCP tools, and
capability links all return HTTP-style `202` with
`SNAPBACK_EFFECT_APPROVAL_PENDING`, an opaque `pfx_` id, approval pointer,
expiry, and disclosed prospective-effect receipt. The receipt is explicitly
not a dry run: v1 contains only the canonical args digest and declared write
set. The exact manifest-activated `_snapback_pending_effects` ledger bounds
arguments, previews, authority snapshots, and journal facts; lazy reads and
decisions durably settle expiry without adding a scheduler.

## Dated amendment: LLP 0204 granted capability links (2026-08-10)

**Commissioned by:** [LLP 0204](./0204-app-external-surfaces.rfc.md), D9.4,
the OQ9 ruling, and the 2026-08-10 author sitting's full granted-operation
extension; authority construction is owned by LLP 0055's
[matching amendment](./0055-agent-principals-and-scoped-grants.rfc.md#dated-amendment-llp-0204-granted-capability-links-2026-08-10)
and LLP 0058's
[sealed-variant amendment](./0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md#dated-amendment-llp-0204-granted-capability-links-2026-08-10).

**Status:** commissioned design only. These are additions to the route and
response registries, not implemented rows or a target capability claim. The
external-anonymous capability-link operations in the
[2026-08-08 amendment](#capability-link-mint-and-serve-family) remain distinct
and are already implemented by S5 Landing A.

### Granted-link operation classes on the existing paths

Granted links reuse the existing URL family but add closed semantic operation
classes. The request is classified before a function handler or link effect
runs; a body discriminator never causes the anonymous branch to inherit a
grant resolver.

| Route / operation | Effective policy | Response sensitivity |
| --- | --- | --- |
| `POST /capability-links` — `GrantedCapabilityLinkMint` | AppData mint; sessions-only `RequiredSessionOrScopedToken`. A direct session supplies its server-resolved effective user; a scoped token must resolve a delegated `ServicePrincipal` whose grant carries both the exact function call scope and exact `capabilityLinkMint` scope. The shared mint gate runs before creating a link grant or secret | `CredentialSecret`; the one-time URL is `private, no-store`, is never echoed again, and is excluded from every log/receipt/diagnostic projection |
| `GET /capability-links/{token}` — `GrantedCapabilityLinkLanding` | AppData/Public path with the exact `CapabilityLinkBearer` request-secret resolver and `InvocationAuthority::None`; link lookup may produce a bounded inert form/description but cannot resolve `CapabilityLinkPossessor` | `PublicNoStore`; no application result, authority fact, pinned argument value, effective-principal fact, or token echo |
| `POST /capability-links/{token}/invoke` — `GrantedCapabilityLinkInvoke` | AppData/Public path with the exact `CapabilityLinkBearer` request-secret resolver; after link, link-grant, parent-lineage, target, admission, expiry/use, and local/trusted-local checks, resolves only LLP 0058's `CapabilityLinkPossessor` and prepares the one bound function | `GrantedCapabilityLinkApplicationData`, defined below; always `private, no-store` |
| `DELETE /capability-links/{id}` — `GrantedCapabilityLinkRevoke` | AppData mint-management; sessions-only `RequiredSessionOrScopedToken`. The resolved authority must match the stored exact minter authority reference; a service minter matches by live parent grant/actor/effective lineage rather than by one mint-time token | `PublicNoStore`; successful instant revocation returns no body |

`RequiredSessionOrScopedToken`, `CapabilityLinkBearer`, and the four invocation
sources above are closed registry values. The link URL is never accepted in
`Authorization`, and a session/scoped token is never accepted as the invoke
path secret. Presented-but-wrong credentials fail class dispatch before link
or application lookup; there is no anonymous fall-through.

The grant-bearing mint and invoke branches are **sessions-mode app-data
operations**. They do not add a host-operation alias, `/api/v1` twin, MCP tool,
connection-open carrier, retained-read lane, or WebSocket operation. The GET
landing is the only credential-free presentation operation and never becomes a
function invocation source.

### `GrantedCapabilityLinkApplicationData` response sensitivity

`ResponseSensitivity` gains the closed class
**`GrantedCapabilityLinkApplicationData`** for arbitrary app-derived bytes
authorized under a `CapabilityLinkPossessor` effective principal. It is not an
expansion of `ExternalAnonymousApplicationData`: the result may contain data
that is not anonymously callable or readable, and the bearer URL is the sole
request carrier for the narrowed delegated grant.

Selection requires all of these facts to be rechecked server-side immediately
before the handler runs:

1. the operation is exactly `GrantedCapabilityLinkInvoke`;
2. LLP 0058 resolved `CapabilityLinkPossessor`, not `Anonymous`, a minter
   session, or a credentialed agent;
3. the link grant, parent authority/grant lineage, effective principal,
   exposure declaration, exact function kind/basis, argument template, expiry,
   use bound, integration admission where applicable, and target plane are all
   current;
4. the link grant covers the exact read or write and remains a subset of the
   minter authority; and
5. ordinary network/link budgets and the per-use journal reservation admit the
   request atomically.

Responses are always `Cache-Control: private, no-store` and
`Referrer-Policy: no-referrer`. Application values, arguments, pinned template
values, effective-principal identifiers, minter lineage, grant ids, journal
facts, and bearer material are excluded from body capture, access-log payloads,
diagnostics, analytics, traces, and receipts. The normalized route template,
redacted link id, operation class, function class, status/refusal code, byte
count, duration, and use ordinal are loggable. A response may carry the
server-derived attribution block only on the caller-authorized response; it is
not retained in a less-authorized operator projection by default.

### Secret-URL and preview-crawler discipline

The granted branch inherits the LLP 0150
[closed secret-URL discipline](./0150-agent-token-acquisition.rfc.md#secret-url-discipline)
and strengthens its registry consequences here:

- the request target is normalized to the registered `{token}` template before
  access logging, tracing, diagnostics, error rendering, metrics labels, or
  proxy forwarding can retain it; raw-target logging is incompatible with this
  route;
- mint returns the secret once; storage retains only a domain-separated hash,
  and no redirect, HTML, receipt, form action, third-party subresource, or
  referrer can reproduce it;
- **GET makes no state change**: it does not invoke a read or write, consume or
  reserve a use, create a pending effect, append a per-use journal row, advance
  `last_used_at`, or render an auto-submitting form. A preview crawler can at
  most receive the inert no-store landing;
- actual use requires the explicit POST invoke operation. A query result or
  finite live-query snapshot is fetched only by that POST, never during GET;
- expiry defaults to 7 days and has a hard platform maximum of 30 days, the
  already-shipped S5 Landing A bounds. App source cannot raise either value;
- direct revocation and a parent-lineage ending are checked at the invocation
  gate. Use racing either transition settles to one exact result; and
- every POST attempt that reaches link resolution reserves a monotonic use
  ordinal and appends a bounded durable journal transition with redacted link,
  child/parent grant lineage, function, argument-template digest, admission
  decision, and coded outcome. The token and application values never enter the
  journal. The final outcome settles that ordinal rather than appending an
  unrelated second use.

Infrastructure outside the process — ingress proxies, CDN request logs, error
collectors, and referrer policy — is part of qualification. An implementing
target cannot claim the route while any layer records raw request targets.

### Reads, writes, approval, and hosted refusal

`GrantedCapabilityLinkInvoke` admits reads and writes. Queries and finite
live-query snapshots may execute directly after the shared gate. A mutation or
action must be **approval-gated on every use or single-use**. The approval path
returns the existing typed `202` pending-effect response and later reconstructs
the same link-possessor authority; the approving minter is recorded separately
and never becomes the executing caller. The single-use path consumes the use
and admits execution atomically. Preview-crawler GET, a failed POST, and an
approval-page view can never consume or execute a write.

Every granted-link operation that would resolve or exercise service-principal
authority is local/trusted-local only. Hosted mint through a scoped token,
invoke (reads included), and approval execution refuse under LLP 0055's
wholesale hosted plane boundary before handler evaluation. Existing hosted
support for the external-anonymous link branch cannot select these operation
classes or response sensitivity.

### Registry acceptance obligations

The implementing landing must add all four operation classes to route/source
parity, credential-class substitution, request-secret/body-buffering,
response-control, method/preflight, schema-export, status-family, and hosted
matrix tests. Fixtures must prove inert GET under crawler-like requests; no raw
token in process/proxy logs or referrers; exact 7-day/30-day bounds; wrong-class
and anonymous-branch non-fallthrough; private-result exclusion from logs;
per-use journal settlement; parent revocation and owner re-credential death;
grant-preserving rotation; single-use/approval retry races; and handler-sentinel
absence for every hosted call.

## Status

Active and implemented (accepted in the LLP 0032 R1 batch): LLP 0032
S1 landed the migration and the declared route registry with its enforcement
tests (registry-invariant, retired-root-absent, WebSocket message-kind, and the
field-level public-inspect trim), verified against a running server. D1 now
enforces owner equality from server-bound request metadata and D4's root register
route is retired. A fresh cross-family review of the revised spec remains
outstanding but does not block the implemented contract.

ENG-24594 extends that active contract from a descriptive registry to
router-owned `RegisteredRoute` entries, centralized per-entry middleware, the
independent policy axes, exhaustive operation metadata, and the full auth-mode
matrix above. Its metadata-derived acceptance suite now passes. Classification
alone does not activate sessions, but the later staged-mode, projection,
invalidation, descriptor, and lease work in LLP 0058/0057/0053 has landed and may
consume the overlay in an explicitly staged local sessions deployment.

The five ambiguous classifications are settled (see Resolved
decisions), and the spec drove the route-registry implementation —
the gated `/_snapback/api/{schema/load, functions/load, app/reset}` equivalents
retired the ungated root aliases without breaking the demos and tests that called
them (they repoint through the kit client). A fresh cross-family review of the
revised spec (the one independent pass — the GPT-5 review above — predates these
decisions) remains the outstanding follow-up.
