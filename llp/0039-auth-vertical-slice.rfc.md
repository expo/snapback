# LLP 0039: Auth vertical slice

**Type:** RFC
**Status:** Draft
**Systems:** Auth, Sync, Storage, API, Security, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-08-04 (implemented the sessions asset-callback service-principal amendment); 2026-08-03 (sessions asset-callback execution authority — author decision sitting #2; see the dated amendment); 2026-07-16 (ENG-24920 companion amendment); 2026-07-15 (ENG-24913 G2 dated implementation amendment: the
non-production step-up slice now reuses the bounded challenge/mailbox protocol
with a distinct operation-bound digest and transactional consumption; production
human delivery remains fail-closed on LLP 0045); 2026-07-13 (ENG-24592 focused exact confirmation completed READY
by both reviewer families on the final ClientQuery/room-seam corpus; the
author-authorized LLP 0053 transition to Accepted is complete while this umbrella
RFC remains Draft/FROZEN); 2026-07-13 (ENG-24593 post-review bounded corrections: closed the
artifact/auth tuple including v1-dev refusal, pinned the actual-predecessor
diagnostic proof, made privileged provisioning the explicit `MODE_PENDING`
recovery branch, and corrected the LLP 0053 ownership seam; one focused exact
confirmation completed READY by both reviewer families — see §Status and
§Changelog); 2026-07-13 (paired LLP 0053 seam reconciliation plus the ENG-24592
local-audit activation closure: sessions may activate after item 5, but every
auth-scoped live surface stays refused until item 6; item 7 remains independent
and proves only finite-invocation isolation until then); 2026-07-12 (super-refine
rounds 1–6; loop stopped on a structural finding — see §Status and §Changelog,
and
`reviews/0039-auth-vertical-slice.{fable,codex}.md`)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0016, LLP 0017, LLP 0020, LLP 0024, LLP 0026, LLP 0030, LLP 0031, LLP 0032, LLP 0034, LLP 0036, LLP 0038, LLP 0042, LLP 0043, LLP 0045, LLP 0046, LLP 0047, LLP 0051, LLP 0053

## Summary

This RFC defines the smallest auth slice that changes Snapback from "dev
impersonation with auth-shaped hooks" into a product that can run a real
multi-user application. It does not replace [LLP 0011](./0011-auth-and-permissions.rfc.md);
it selects a first implementation path through it. Where this document
restates a contract 0011 pins, 0011 wins; divergences from 0011 are called out
explicitly below, not implied.

The slice is:

- server-resolved authority and a stable `ctx.auth` that only the server
  derives, enforced at one shared invocation gate across every entry path,
  with a staged per-app auth mode and a migration path off the legacy
  client-supplied dev auth;
- **closing the existing bypasses** that would otherwise make sessions
  decorative: raw app-data inspection, unprivileged provisioning, and the
  direct function runner's forged body authority
  (§Existing surfaces under sessions);
- one built-in passwordless email-code provider with local capture in dev,
  specified as concrete challenge/code and session state machines;
- **bearer-only session transport** — cookies are deferred with the
  login-CSRF/Origin contract they require;
- protected `_auth_*` identity/session tables never synced to clients, with
  the prefix reserved, catalog versioning and GC, and enforcement points
  named;
- app-visible profile and membership rows keyed by Snapback user id, created
  by app code;
- live/outbox connections bound to the session's authority at
  `POST /connection/open`, through a memory-only validity lease with
  deadline-driven expiry and a fail-closed two-phase revocation protocol;
- a fail-closed client clearing contract owned by a single client coordinator,
  covering every authority-losing transition;
- an opaque server-issued authority instance id giving queued replay a
  consistency input that is never authentication;
- structured diagnostics for the full deny/throttle/lock/supersede/stale
  family, registered in the families LLP 0012 actually owns.

**Authorization invalidation is [LLP 0053](./0053-authorization-invalidation.rfc.md)'s**
— the authorization-event universe, invalidation obligations, dispositions, and
the retained/offline lease all live there. What *moved* at the split included an
early classification proposal and generic `resync_required` shape; 0053 replaced
them with orthogonal declarations and composite witnessed obligations. This
document names that RFC's cross-boundary outcomes without re-owning its protocol.
It remains the umbrella and owns the landing order for both.

**Target scope.** This slice binds the **local Rust server target**.
`auth.mode` is a **must-understand** manifest field — an explicit carve-out
from [LLP 0012](./0012-headless-integration-contract.spec.md)'s
ignore-unknown-fields evolution rule that **must be registered there** (the
companion amendment in this change does so). The concrete hazard,
stated correctly: the Cloudflare coordinator does not honor client-asserted
auth — it hardcodes an empty auth object — so a sessions bundle would run
every request **unscoped with empty auth**, silently serving auth-filtered
queries as if nobody were logged in. That is a different failure than
impersonation, and it is worse.

A new field cannot bind a receiver that predates it (ignore-unknown-fields is
0012's rule), so the gate must be **structural, not semantic**, and enforced
at three points:

1. **Sender-side.** Codegen/deploy tooling refuses to emit or ship a
   `sessions` bundle for a target whose capability manifest lacks session
   support (the existing `scripts/cf-check-compat` REFUSED pattern). Necessary
   but insufficient: any bundle reaching a target outside this repo's tooling
   would fail open.
2. **Structurally, for legacy receivers — with a discriminator each legacy
   target already understands, not the new field.** On Cloudflare, an earlier
   draft claimed a bumped metadata version would be rejected
   by deployed validators. **That is false and is corrected here:** Cloudflare's
   `validateDeploymentMetadata` compares stored `schema_hash`, `bundle_hash`,
   and `inputs_hash` against this deployment's compiled-in hashes and *iterates
   the expected keys*,
   so unknown metadata is **silently ignored** — it fails **open** on formats it
   has never seen. The 409 it can raise fires on a hash mismatch, not an
   unrecognized version.

   The true deployment fact is narrower. Cloudflare builds the app from **one
   source tree into separate Worker artifacts**: the handler Worker contains the
   compiled app bundle, while the gateway Worker contains the coordinator. The
   checked-in deploy script updates them sequentially, **handler first, then
   gateway/coordinator**. That makes ordinary source skew unlikely, but it does
   not make the pair atomic: during every first-party deploy there is a real
   interval in which a new sessions-aware handler can receive calls from the old,
   session-unaware coordinator. A third-party fork can create the same state for
   longer by vendoring either side stale.

   The hosted receiver-side backstop is therefore an **invocation-level
   must-understand marker**, not the false one-artifact argument. Every coordinator
   invocation identifies the authority protocol it enforced. A sessions handler
   refuses an absent, unknown, or session-unaware marker **before handler
   execution**; an old coordinator cannot synthesize the marker and therefore
   cannot run the new bundle with empty auth during the sequential-deploy window.
   Sender-side compatibility checking remains necessary for the opposite skew and
   for third-party deployment tooling. The exact wire field, deployment
   interleavings, and rollback proof belong to protocol obligation 8 and the
   hosted deployment-security contract.

   **The local target needs its own backstop — and a new field cannot be one.**
   Database open deserializes the stored manifest without artifact validation, and
   `SchemaManifest` does not use `deny_unknown_fields`, so an **older binary can
   reopen a sessions-mode database, silently ignore `auth.mode`, and serve it under
   legacy body authority.** A rollback across the sessions boundary is a downgrade
   attack on yourself. Adding a `requiredCapabilities` field does **not** fix this:
   a pre-slice binary ignores that field for exactly the same reason it ignores
   `auth.mode`. (An earlier draft claimed it did — the same "a new field cannot bind
   a receiver that predates it" error this section correctly identifies for
   Cloudflare, made locally.)

   There are two distinct local downgrade boundaries, and each needs its own
   structural defense.

   **First installation uses the artifact version that pre-auth binaries already
   reject.** Every sessions deployment carries `schemaVersion: "snapback.v1"`
   on **both** its schema and function manifests. The immediately preceding
   binary's existing artifact-header check accepts only `snapback.v0`, so a
   fresh v1 sessions deployment reaches a hard version refusal rather than
   dropping `auth.mode`. The admissible `(schemaVersion, auth mode)` set is
   closed and contains exactly `(snapback.v0, dev)` and
   `(snapback.v1, sessions)`. An auth-aware binary rejects every other tuple —
   specifically v0-sessions and **v1-dev** — plus schema/function version skew
   and unknown versions, before hashes or effects.

   Version alone is insufficient when that predecessor already has the same app
   content loaded: today's `/app/ensure` compares raw `schemaHash` and
   `bundleHash` values and can report `matched` before artifact-header
   validation. Therefore LLP 0012's exact v1 contract gives `schemaHash`,
   `bundleHash`, and the shared `inputsHash` serialized namespaces that are
   disjoint from v0 and domain-separates their framed SHA-256 preimages by
   artifact kind (or pair), `snapback.v1`, `sessions`, and `appId`. Identical app
   sources emitted as v0-dev and v1-sessions cannot have equal identity strings.
   The structural string difference forces an actual pre-auth predecessor past
   its equality shortcut and into its existing
   `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION` refusal. The proof runs that
   unmodified predecessor in its provisioning-allowed `dev` profile and asserts
   the exact code, not only an absence of mutation.

   That discriminator is not allowed to hide behind today's `/app/ensure`
   hash shortcut. Every auth-aware ingress path constructs the complete
   candidate artifact pair (posted half plus an already-loaded, attested sibling
   for a one-half update), resolves explicit operation intent and branch
   authorization, and checks the closed version/mode tuple and pair consistency
   (equal `schemaVersion`, `appId`, and `inputsHash`, with non-empty `appId`,
   `schemaHash`, `bundleHash`, and `inputsHash` required for v1), target
   capabilities, and the branch-specific policy **before** comparing
   `schemaHash`/`bundleHash`/`inputsHash`, running DDL, persisting desired mode,
   replacing functions, or seeding. A first sessions deployment therefore
   requires both v1 halves. Matching hashes attest content only; they never
   bypass authority compatibility or privilege. Target capability manifests
   register `supportedArtifactVersions` and `supportedAuthModes`, which both
   sender and receiver consume. Those arrays advertise dimensions; they do not
   authorize a Cartesian product or make v1-dev admissible.

   **Reopen and rollback after activation retain relocate-and-poison.** On
   sessions activation, the persisted manifest is
   **relocated to a new meta key**, and a valid-JSON, greppable sentinel whose
   top-level type cannot deserialize as `SchemaManifest` is written at the legacy
   key (for example, `"SNAPBACK_SESSIONS_MANIFEST_RELOCATED: session-aware binary
   required"`). A pre-slice binary reaches that key at open, its
   `serde_json::from_str` fails, and the existing `?` propagation makes it **fail
   closed** — it refuses to open rather than serving a sessions database under
   legacy authority. This works against *today's* binaries because it exploits
   parsing, not semantics. Capability-aware binaries read the new key and honor
   `requiredCapabilities` (`SNAPBACK_CAPABILITY_UNSUPPORTED`), which remains the
   portable mechanism for *future* must-understand fields. The relocated manifest,
   active-mode metadata, and poison commit atomically; a missing legacy key is
   never a valid committed post-activation state. Once sessions has activated,
   capability-aware binaries read the relocated key exclusively and the legacy
   key remains poisoned permanently. `--allow-auth-downgrade` permits a
   **session-aware** binary to serve dev mode after revoking sessions; it does not
   authorize a pre-slice binary to reopen a database that still contains auth
   tables and state. Landing item 4 owns the artifact-pair preflight and this
   separate post-activation poison mechanism.

   Generalization note: the invocation marker is specific to a split receiver in
   which the new handler can reject an old coordinator's call; the paired v1
   discriminator works because pre-auth local receivers already reject non-v0;
   and relocate-and-poison is specific to "receivers that parse before they
   validate." None is a general must-understand mechanism, and the corpus does
   not have one — a future field will need its own argument.
3. **Receiver-side, before any durable mutation.** A knowing target refuses
   `auth.mode: "sessions"` it cannot enforce **before** system-table
   migration, app-table creation, desired-mode persistence, function replacement,
   seed, or subscription rebuilding — including when posted hashes equal the
   loaded hashes. Today hosted
   `initializeSchema()` creates `_snapback_meta` before deployment validation,
   then validates before `ensureCurrentSchema()` and subscription migration.
   The sessions preflight must move ahead of even that metadata-table DDL;
   acceptance proves a refused sessions bundle leaves the target byte-for-byte
   unchanged.

Scope honesty: with capture-only delivery, this slice proves real multi-user
auth for local development, tests, and admin-onboarded same-origin
deployments; self-serve signup additionally needs
[LLP 0045](./0045-notifications-outbox.rfc.md)'s real delivery seam.
**And it costs something the project already shipped: a session-enabled app has
no offline retained reads** until landing item 8. The first closed-IR,
single-query M1/M2 slice in
[LLP 0043](./0043-offline-replay-retention.rfc.md) shipped retained stale boot,
but that capability is disabled under `auth.mode: "sessions"` until LLP 0053's
reviewed fail-closed retained-authorization contract and durable client fence
land; in-memory clearing alone is not fail-closed across a restart. Adopting auth
therefore trades offline reads away temporarily, and that trade is stated here
rather than discovered. It also temporarily refuses every **auth-scoped live**
surface: items 1–5 may activate sessions for finite request/response work and
explicitly `authorityIndependent` live behavior, but item 6 must land before an
auth-scoped durable subscription or protected ephemeral room can register.
Session-enabled apps refuse plaintext non-loopback binds. Three contracts
this slice depends on are **unowned today** and are named rather than
implied: hosted deployment security (TLS termination, trusted-proxy source
addressing, distributed throttling and session invalidation —
[LLP 0009](./0009-code-execution-security.rfc.md) is the security umbrella;
[LLP 0047](./0047-hosted-execution-limits.rfc.md) owns only execution
limits); the **client-page XSS posture** that bearer custody rests on; and
the fence's limit — refusing plaintext non-loopback binds does not fence out
a loopback bind behind a reverse proxy, which is hosted exposure and remains
operator-owned risk.

## Motivation

Auth is the offering hole with the widest blast radius. Without it, Snapback
cannot honestly support private rooms, team apps, card games with hidden state,
authorized partial sync, generated app-data MCP with hosted authority, or the
"auth data next to your data" claim from [LLP 0000](./0000-snapback.explainer.md).

The implementation should be deliberately narrow. The goal is not to become
Clerk or WorkOS in one pass. The goal is to make one real session flow drive the
same query, mutation, live, sync, diagnostics, and test machinery that app
authors will use for every later provider.

## Design

### Authority resolution

Every function invocation — over HTTP app-data routes, WebSocket-carried
operations, `ConnectionAuth` transports, host-ops, cron, actions, or nested
`ctx.runMutation` — resolves, server-side, to a **resolved authority** before
the handler runs:

- `anonymous`;
- `session { userId, sessionId, provider }`;
- `devImpersonation { userId, roles, localDevOnly: true }` — the local-dev
  authority [LLP 0024](./0024-agent-operating-surface.spec.md) models (0024's
  `devUser`; `adminBypass` ↔ 0024's `devAdminBypass`; 0024 gains a `session`
  mode when this lands). Stated honestly: the shipped host-ops request
  carries only `userId`, roles population (`--as-role`) is 0024-specified and
  unbuilt, and 0024's audit fact today is the envelope `authority` block
  (0024 says "emit **or retain**");
- `adminBypass { reason }` — host-ops and admin surfaces only; **bypass
  grants no identity and suppresses no check** (below);
- `system` — cron and server-originated executions; carries no user;
- `servicePrincipal` — scoped agent actor plus effective user, admitted only by
  the generated app-data gate described in the dated amendment below
  ([LLP 0042](./0042-agent-mcp-surface.rfc.md)).

**One gate, every path — the composition matrix.**

- `authRequirement` (`public | optional-user | authenticated`; absent/legacy
  means `optional-user`): `public` skips only the *requirement* — a presented
  credential is still validated, and an invalid one still errors;
  `optional-user` resolves a credential when presented; `authenticated` fails
  `SNAPBACK_AUTH_REQUIRED` when the resolved authority carries no user.
- `system` (cron): carries no user; a function declared `authenticated` is an
  invalid cron entry, rejected at manifest load.
- Nested `ctx.runMutation` inherits the invoking execution's authority.
- Actions ride HTTP-200 `FunctionRunResult` envelopes; the gate applies at
  invocation and the same codes ride inside the envelope.
- `adminBypass` (the direct admin function runner, which today executes
  queries tokenless on loopback with a body `HandlerInput`): under sessions
  its reads require a live `AdminSecretRead` lease covering every table the
  response can expose, and it executes under an **anonymous
  handler projection** plus an envelope-level `adminBypass` audit fact —
  auth-variable expressions fail `AUTH_USER_MISSING`, `authenticated`
  functions fail `AUTH_REQUIRED`, auth-filtered queries return what anonymous
  sees. Bypass is an access capability, not an identity; user-scoped admin
  reads go through host-ops impersonation. Refused on `prod`.
- The route registry gains independent per-entry axes — path policy,
  credential resolution, invocation authority, legacy-body acceptance, effect
  policy, and response sensitivity — plus
  a **session-mode overlay**, because several behaviors switch on mode
  against a fixed route (the `?connection_token=` fallback, body-auth
  acceptance, the direct runner's token requirement, the surfaces in
  §Existing surfaces under sessions). The acceptance sweep is derived from
  that registry metadata, so it mechanically covers every entry point.

Three distinct internal types, distinctly named: the raw **wire auth input**
(untrusted; today `auth: { principal, session_id, user_id }`, snake_case,
`#[serde(default)]`, so presence is currently erased — ingress must preserve
presence); the **resolved authority** (server-only); the immutable **handler
projection** `ctx.auth`. The internal type must not collide with the
room-permission-shaped Rust `AuthContext` in `crates/snapback/src/ephemeral.rs`. Under
sessions, ingress **rejects** every client-auth-bearing field — nested
`HandlerInput.auth`, live resume/unsubscribe owner auth, the ephemeral identity
fields (which need mode-dependent DTOs: today's wire types *require* `auth`, so
omission cannot deserialize), and the public `ctx_ledger.auth_fingerprint`
member. "Stamp and ignore" is not the contract; rejection is.

**Rejection must be paired with a replacement predicate, or it opens the hole it
closes.** The shipped live-subscription ownership guard compares the *stored*
`principal`/`user_id` against the caller's, and **short-circuits when both are
absent** — `if (owner.principal.is_some() || owner.user_id.is_some()) && …`
(resume and unsubscribe share this short-circuit guard; supersede-on-resubscribe
uses a different gate — positive owner equality *plus* same-connection — so its
protection does not collapse when the stored owner is empty. A code fact, not an
LLP 0031 statement: 0031 pins only that app routes trust client-supplied
`ctx.auth`. The replacement predicate below covers all three regardless.) Simply removing those fields under sessions would
leave every stored owner empty, the guard would never engage, and **cross-owner
resume/unsubscribe protection would disappear** for anyone holding a connection
grant and a subscription id. The anonymous case would short-circuit even under a
charitable implementation, and anonymous grants are first-class here.

Pinned instead: under sessions a subscription records, at subscribe time, both
its **server-resolved authority** and its **connection grant**. Resume,
unsubscribe, and supersede compare the caller's *bound* authority against both —
and the anonymous case is compared on the **connection grant**, never on "no
user." Acceptance carries the negative in both the anonymous and authenticated
cases: connection B cannot resume or unsubscribe connection A's subscription.

**Auth mode: declared, staged, handshake-gated.** `auth.mode:
"dev" | "sessions"` is compiled into the schema manifest (absent = `dev`;
unknown values are a manifest-load error). Because the server's only schema
path hot-applies and persists — and because the listener binds before any
app-data schema arrives — activation is **staged, and mixed-mode execution is
refused**:

- A manifest apply that changes `auth.mode` never hot-applies. The rest of
  the schema applies; the mode change is recorded as **desired**.
- While `desired != active`, the server **refuses app-data operations** with
  `SNAPBACK_AUTH_MODE_PENDING` (health, identity, the bootstrap handshake, and
  the single privileged provisioning recovery branch below still serve, so the
  state is diagnosable and fixable). There is no window
  in which session-oriented functions run under dev authority or vice versa.
- The next startup consumes `desired` **before binding**, running the
  transition rules below. Enabling sessions on an empty database is the same
  path (staged, then consumed) rather than a direct-activation exception —
  the exception could not be honored pre-bind anyway.
- **Bootstrap handshake:** `GET /auth/session` returns
  `{ activeMode, desiredMode, modeState }`, the client protocol/DTO version,
  separate auth-scoped-live, retained-read, and queued-replay availability, the
  minimum invalidation- and disposition/fence-aware client protocols, and the
  caller's projection. It is **exempt from
  the dev-mode `/auth/*` refusal** (it is the discovery endpoint, not a
  provider operation) and it serves during `MODE_PENDING` (that is how the
  state is diagnosable). The kit must complete it before any **online**
  interaction — first connection, first auth-bearing request, first
  resubscribe — so DTOs and offline behavior are never chosen from stale
  static capabilities. It is deliberately **not** a precondition for offline
  cold boot: an offline client may render from its stored last-known mode and
  retained-authorization metadata with staleness marked (the retained-stale-boot
  behavior shipped by LLP 0043's first closed-IR, single-query slice, which a
  mandatory live handshake would break). A mode change discovered at the
  eventual handshake forces the clearing transition. Once item 8 enables
  session-mode retained reads, both server and kit refuse them for an absent,
  unknown, or too-old disposition/fence protocol; reporting availability is not
  permission for a legacy client to ignore invalidation commands.
- Incidental property worth pinning: because mode is never hot-applied, no
  schema-apply surface (including `/app/ensure`) can flip auth mode at
  runtime.

Combined with the existing `ServerProfile` (`dev | demo | test | prod`):

| Manifest mode | dev / test / demo profile | prod profile |
|---|---|---|
| `dev` (default) | today's client-asserted behavior, **newly fenced to loopback binds only** on every profile, absent an explicit dangerous override. This fence is **new work, not current behavior** — the server binds any `--host` today and merely disables admin on non-loopback without a token; profiles are not bind boundaries (`demo` is selectable on public binds). LAN/phone development still works through [LLP 0030](./0030-managed-snapback-vite-dev.rfc.md)'s proxy (Vite binds the LAN; Snapback stays loopback) — **and that path re-opens exactly what the fence prevents.** Stated plainly, because the alternative is a fence with a hole in it: the proxy forwards app-data, so a LAN-bound Vite re-exposes client-asserted dev auth to the LAN just as a direct `--host` bind would. The fence protects **un-proxied defaults, not proxied opt-ins.** This is the dev-mode twin of the reverse-proxy residual §Summary names for sessions, and it is 0030's own warning (a non-loopback Vite "can still expose the read surface and the token-gated lane to the network"), not a posture 0030 blesses | **refuses all app-data operations** (health/identity still serve); no override |
| `sessions` | sessions enforced; impersonation via host-ops only | sessions enforced; no impersonation |

Transitions, with their failure paths (a staged transition must never wedge an
instance — this repo treats wedge traps as first-class defects, ENG-22659):

- **dev → sessions.** The catalog collision check runs **at stage time** as a
  fast-fail, so a doomed transition is refused *before* the restart barrier
  and while the sanctioned `auth.rescueCollidingTable` recovery (§Protected
  identity core) is still reachable. It runs again pre-bind at consume time.
- **Consume failure** (collision, catalog error) does **not** fail startup into
  an unreachable state: the server boots in the **still-active** mode with
  `desired` quarantined and a startup diagnostic — and **app data stays refused**
  (`MODE_PENDING`). Quarantining the desired mode does **not** silently resume
  service under the old one: a scripted stage-and-restart that hits a consume
  failure must not quietly keep serving client-asserted authority after the
  operator staged enforcement. The quarantined state is surfaced through the
  handshake's `modeState`, so scripts can detect it. The operator fixes the schema
  and re-stages, or unstages explicitly. `--clear-desired-auth-mode` unstages non-destructively
  (distinct from `--drop-orphaned-auth-tables`, which deletes).
- **During `MODE_PENDING`**, ordinary app-data and Public
  `/app/ensure { intent: "attest" }` are refused. The sole schema-apply recovery
  exception is `/app/ensure { intent: "provision" }`, explicitly authorized by
  `AdminWrite` or pre-bind startup authority. It may correct or re-stage the
  candidate pair, but its branch authorization and complete closed-tuple/pair/
  capability preflight still run before hashes or effects. There is no generic
  admin/host-ops bypass and no fallback from a denied ordinary request.
  `--clear-desired-auth-mode` remains the distinct pre-bind operator unstage.
- **Fresh apps** provision through pre-bind startup authority and activate
  sessions with no pending window.
- **sessions → dev** over auth-created `_auth_*` state **fails closed** with
  `SNAPBACK_AUTH_MODE_DOWNGRADE`. The audit-logged override
  (`--allow-auth-downgrade`) deletes nothing but **revokes every durable
  session** — re-enabling sessions later must require fresh logins rather than
  resurrecting credentials that were live under a different trust model. It
  leaves the relocated manifest and legacy-key poison in place permanently:
  downgrade authorizes dev mode in a session-aware binary, never rollback to a
  pre-slice binary while auth tables and state remain.

**Credential precedence under sessions.** (1) a bearer session credential;
(2) unauthenticated. A presented-but-invalid credential is an error, never a
silent fall-through: structurally invalid or unknown → `AUTH_REQUIRED`;
expired or revoked → `AUTH_SESSION_EXPIRED`; a superseded family token on an
ordinary request past the grace window → `AUTH_CREDENTIAL_SUPERSEDED`
(distinct precisely so the client recovers a *healthy* session instead of
destructively clearing it). Legacy body auth is its own error
(`AUTH_BODY_AUTH_UNSUPPORTED`) regardless of any valid bearer. Under
sessions, `Authorization` is reserved for session bearers; admin authority
must use `x-snapback-admin-token` (today either header is accepted — the
precedence would otherwise be subtle).

The credential carriers are deliberately distinct. The ordinary admin bearer may
satisfy `AdminRead`/`AdminWrite`, but **never** `AdminSecretRead` and never
impersonation. A root secret-read minting authority stays on the operator plane
(CLI/keyring) and **never enters app-origin browser memory at all**; it mints a
short-lived `AdminSecretRead` lease scoped to explicit table names, with per-lease
row and byte ceilings and **no wildcard scope**. Only that derived lease may be
handed to console memory, and it is never persisted; expiry, a table mismatch, or
either exhausted ceiling fails closed. `ImpersonationCapability` is a separate
operator-plane effect authority; neither the admin bearer nor a secret-read lease
satisfies it.

**Dev impersonation under sessions is host-ops-only, and gated by the
impersonation capability — every path, not just the new ones.** No app-data
impersonation carrier exists in code, and inventing one would re-open the hole
this slice closes; impersonation lives on the host-ops surface. But the gate is
**not** the admin token: `auth.mintSession`, the capture mailbox, **and host-ops
`function.run --as-user` / `--as-role`** are all impersonation, and all three
require the `ImpersonationCapability` (the 0600 keyring read directly, or a
per-boot terminal secret) — never the console's browser-held `localStorage`
token. Gating only the two *new* capabilities while leaving `--as-user` on the
admin token would leave the same app-XSS → any-user path open through the older
door. For cheap suites, host-ops gains a gated
**`auth.mintSession`** verb (dev/test/demo only, `AdminWrite` route policy plus
`ImpersonationCapability`, audit-marked
`issuedBy: admin`, refused on `prod`): it takes an email and runs the normal
provisioning path — find-or-create user and identity (`provider:
"email-code"`, `verified_at` = mint time), mint a session with `identity_id`
set — so provenance is coherent and `ctx.auth.provider` well-defined.

**`ctx.auth`.**

```ts
type AuthContext = {
  userId: string | null
  sessionId: string | null
  isAuthenticated: boolean
  provider?: string
  roles?: string[]
}
```

`isAuthenticated` is derived (true iff the authority carries a user);
`provider` comes from the session's identity, absent for anonymous; `roles`
is **always `[]` for real sessions** — carried because 0011 pins it in the
minimum shape, populated only by (unbuilt) dev impersonation, with
role-based permission *checks* a non-goal. The anonymous projection is
exactly `{ userId: null, sessionId: null, isAuthenticated: false }`. The
projection is deep-frozen. Queued replay under roleful impersonation is
refused outright.

### Existing surfaces under sessions

Sessions are decorative if a hostile local page can read the same rows
without one. **Three** shipped surfaces do exactly that today, and closing them is
part of this slice (not a follow-on):

- **Raw app-data inspection.** `GET /_snapback/api/data/{table}` is
  `AdminRead`, which is **tokenless on loopback**, and the CORS layer echoes
  any localhost origin — so any local page can dump every private table. On
  session-enabled apps, raw row inspection requires a live, table-scoped
  **`AdminSecretRead` lease**; the ordinary admin bearer and tokenless loopback
  reads are limited to
  aggregates/metadata. Same rule for identity/session inspection that would
  expose subjects (§Protected identity core).

  **Closing the front door is not enough — the same values can escape through
  side channels.** Receipts carry an
  arbitrary adapter-supplied `correlation` echoed verbatim plus subscription
  `scope`, and are `AdminRead` (tokenless on loopback). `PublicInspect` is served
  on the **`Public`** routes `/inspect` and `/`, tokenless on **any** bind, not
  merely loopback. Its current typed projection is already the correct baseline:
  `PublicDiagnostic` retains only `code`, `severity`, and `subsystem`, while
  free-form diagnostic message/details, executable source, paths, and other
  operator facts stay on the gated twin. That shipped trim does not make a
  route-level policy capable of protecting future fields. LLP 0031 D3 says
  exactly that and protects the public-vs-gated projection with exhaustive
  destructuring and the ENG-23441 source-sentinel pattern; LLP 0009 separately
  requires secrets never to enter diagnostics. So a
  **response-sensitivity audit is a prerequisite of sessions becoming
  enableable**: every public or tokenless response is classified for
  app-derived and identity-derived content, and anything that can carry it moves
  to `AdminSecretRead` or to a typed projection that structurally cannot.
  Acceptance carries a field-level public-vs-gated projection sentinel following
  0031 D3 **and a separate secret-redaction test** across rows, handler error
  messages/details, executable source, query arguments, receipt correlation and
  scope, identity subjects, config values, tokens, and codes. (The route registry
  gains a **response-sensitivity axis** beside path policy and credential
  resolution, so this is checkable rather than remembered.)
- **Unprivileged provisioning.** `POST /app/ensure` is `Public` and applies
  schema and **executable function bundles** — a hostile page can install a
  public function that reads whatever sessions were meant to protect. On
  session-enabled apps, Public `/app/ensure` becomes **match/attestation-only**
  through LLP 0012's exact identity-only `{ intent: "attest", requestedMode,
  pair }` DTO (verify the running pair matches the expected identity; report,
  never mutate). Full manifests, seed, desired-mode material, and unknown fields
  are rejected on that branch. Schema, function, and seed provisioning use the
  distinct `{ intent: "provision", ... }` variant and require `AdminWrite` or
  pre-bind startup authority. The server selects a branch from `intent` before
  comparing hashes and never infers or falls back between branches based on a
  match. **The provisioning privilege gate is evaluated before any
  half of the payload applies, against `(requested mode, active mode, desired
  mode)` — not against active mode alone.** Otherwise the activation itself is
  the hole: while active mode is still `dev`, today's Public ensure could stage
  sessions and persist attacker-chosen schema before the restart. Concretely:
  any provisioning payload *requesting* sessions, and every provisioning ensure
  while `desired == sessions`, requires `AdminWrite` or pre-bind startup
  authority. Public attestation remains observational and cannot carry an
  effect-bearing payload.
- **The direct function runner is the third such surface**, and the worst of
  them: `admin_run_function` classifies a *query* as a read and authorizes it
  tokenless on loopback while accepting a body `HandlerInput.auth` — so a hostile
  local page can run **auth-filtered queries under a forged identity**, which is
  strictly worse than scanning raw rows. Its closure (a live
  `AdminSecretRead` lease required for reads under sessions; anonymous
  projection; `adminBypass` audit fact; refused on `prod` — §Authority
  resolution) is part of landing item 2, not item 4:
  sessions must not be enableable while it stands open.

- **Cold-start bundle loading, with attested provenance.** Executable function
  manifests are process memory and reset to defaults on reopen, so a
  session-enabled app cannot reload its bundle through the ordinary browser mount
  path after the mode restart. The bundle is supplied by **pre-bind startup
  provisioning** (a startup-time bundle path/manifest) — and *only* that.

  The tempting alternative, "persist the loaded bundle across the restart," is
  **forbidden**, because it would carry an attacker's code into the session trust
  domain. While `active == dev` (the state every app passes through before
  staging, and the state `--allow-auth-downgrade` returns it to), `/app/ensure`
  is Public and calls `load_functions` whenever provisioning is allowed
  (`!Prod` — and the loopback default profile is `Dev`), reachable by a hostile
  local page through the CORS echo. An attacker-installed bundle could therefore
  be the last one loaded before staging, and `AdminWrite` on the *staging*
  payload authorizes the staging request — it attests nothing about the bundle
  already resident. The session app would then boot running attacker-chosen
  handler code with server-resolved `ctx.auth` and full `ctx.db`, defeating the
  entire slice.

  So: the staged transition **pins the expected bundle hash**, and the pre-bind
  consume **verifies it and refuses otherwise**. Acceptance: a bundle installed
  through Public `/app/ensure` while in dev mode is **not executable** after a
  sessions transition. The suite also walks fresh database → sessions deployment
  → restart → authenticated function execution.

The owning-document amendments are [LLP 0017](./0017-admin-console-inspection-surface.rfc.md)
§Security Defaults for the inspection/console/runner read boundary and
[LLP 0034](./0034-contract-source-seam-provider-side.rfc.md) for the ensure
seam. Both amendments are listed in §Landing order's companion obligations;
the direct runner is part of the 0017-side surface closure, not an unnamed
third amendment. Acceptance carries hostile-origin proofs for each surface. The
full **existing-route × mode matrix** (data explorer, receipts, the Public `/`
and `/inspect` projections plus their gated twin, config status, `/app/ensure`,
host-ops, every WebSocket operation) is enumerated in the 0031 revision this
slice requires, so no surface is left implicitly open.

### Protected identity core

Snapback owns protected identity tables:

- `_auth_users` — `id` (Snapback-issued principal id, immutable),
  `created_at`.
- `_auth_identities` — `id`, `user_id`, `provider`, `subject` (canonical
  address), `verified_at`. Unique on `(provider, subject)`.
- `_auth_sessions` — `id` (stable across refresh), `user_id`, `identity_id`,
  `authority_instance_id`, `token_hash` (SHA-256 of a 256-bit bearer),
  `generation` (bumped by revocation-class events — logout, admin revoke,
  refresh-reuse — never by rotation), `created_at`, `last_used_at`,
  `expires_at` (sliding), `absolute_expires_at`, `revoked_at`. Live sessions
  per user are capped (default 20; minting the 21st revokes the oldest).
- `_auth_session_tokens` — token-family tombstones (`token_hash`,
  `session_id`, `superseded_at`), retained to the session's absolute expiry
  so N-2/N-3 reuse stays attributable, then GC'd.
- `_auth_verification_codes` — `challenge_id`, `canonical_address`,
  `code_digest` (keyed), `key_id`, `attempts`, `max_attempts`, `expires_at`,
  `consumed_at`, `superseded_by`.

Field lists and invariants, not DDL. One deliberate narrowing of LLP 0011
(ratified by Charlie, 2026-07-07): 0011 distinguishes user, **account**, and
session; this slice merges the account into `_auth_identities`, since the only
provider is built-in email code. Whether `_auth_accounts` returns with the
first external OAuth provider is an open question.

**Reserved prefix.** `_auth_*` joins `_snapback*` as reserved, mirroring the
existing checks at their existing scopes (codegen: table **and index** names;
storage's
`validate_user_identifier`: table, field, and index names). An app schema
declaring `_auth_users` passes both today and would collide; after this slice
it is a load-time error at both.

**Existing databases and the auth catalog.** Database open loads the stored
manifest without revalidating, schema application is additive, and dropped
tables keep their physical tables. Enabling sessions therefore runs a
**pre-DDL physical catalog check**: a physical `_auth_*` table the auth
subsystem did not create fails startup with
`SNAPBACK_AUTH_TABLE_COLLISION`.

**The reservation is absolute and admits no per-database exemption** — after this
slice, an app schema declaring `_auth_*` is a load error at codegen *and* storage,
and `ctx.db` refuses the prefix. That is exactly what makes an app-level
rename-and-copy migration **impossible**: no manifest can simultaneously declare
the colliding table (to read it) and its successor (to write it), because the first
declaration is rejected. (An earlier draft prescribed precisely that recovery; it
was unexecutable, and the contradiction is recorded here rather than quietly
dropped.)

The recovery is therefore a **dedicated operator verb**,
`auth.rescueCollidingTable` — host-ops, dev/test profiles only, with
`AdminWrite` path policy plus an `ImpersonationCapability` effect gate, refused
on `prod`. It reads the foreign `_auth_*` table **through the storage layer
directly**, below `ctx.db` and below manifest validation, transactionally copies
its schema and rows into an operator-named non-reserved app table, and drops the
source only after the copy succeeds. It is the **only recovery code** permitted
to read a foreign/unowned reserved-prefix table (the auth subsystem necessarily
reads the catalog-owned tables), and it exists precisely *because* the
reservation admits no exemption. A failure leaves the source intact. The
operator then stages the sessions transition. (`--drop-orphaned-auth-tables`
remains available as a separately tested blunt, destructive alternative,
documented backup-first.) Acceptance walks the whole path on a colliding
database. Logical export/import is **not** a dependency — it does
not exist (no host-ops verb, no CLI), and building it is
[LLP 0007](./0007-storage-portability.spec.md)/[LLP 0046](./0046-postgres-graduation-path.rfc.md)
work; this document pins only the contract those tools must honor (below).
The auth catalog is **versioned** (a durable `auth_catalog_version` marker
written when the subsystem creates its tables) — what the collision check
trusts and future migrations key on. GC: consumed/expired challenges swept
periodically; expired/revoked sessions and tombstones retained to absolute
expiry, then swept.

**Outside the app manifest.** `_auth_*` is a system catalog like the
`_snapback_*` internals, and its persistence **bypasses the app-data write
machinery**: no `_snapback_changes` journal rows (the journal stores full
`row_json` — token hashes and code digests must never enter the change
stream), no app commit-version advance, no live-matcher wake — the pattern
`_snapback_client_mutations` already uses.

**Enforcement points.** Generated client types do not expose `_auth_*`;
`ctx.db` name resolution refuses them; sync and live paths refuse them; the
journal and commit stream never carry them. Admin surfacing is **new
behavior**, not a redaction tweak (today the console's table list derives
from the app manifest, so `_auth_*` is hidden by omission): identity/session
inspection exposing subjects or session metadata requires `AdminSecretRead`,
resolved only by a scoped in-memory lease, and the DTO never includes token
hashes or code digests. Tokens are stored
hashed; tokens, codes, and secret claims are redacted from logs and
diagnostics (LLP 0011 §Security Considerations).

**Lifecycle matrix.** `app.reset` wipes auth state with the rest — users,
identities, sessions, challenges, tombstones, **and connection grants**; that
last one is new cross-component wiring (the `ConnectionRegistry` lives in
server `AppState`, deliberately surviving reset today) and is owned by
landing item 5, not assumed. **Logical export/import** (future 0007/0046
tooling; contract pinned here): export includes durable identity facts —
`_auth_users`, `_auth_identities`, subjects included (addresses are identity
data, not secrets) — and excludes sessions, tokens, challenges, and all
digest material; import targets an empty database, rejects identity
collisions, never imports sessions. **Physical backup** of the instance
directory contains everything — the SQLite file *and* the keyring beside it —
and custody is the operator's (the posture LLP 0036 pins: instance backups
"carry live keys"). **Physical restore is operator-declared, not detected.**
Restoring an older file can resurrect sessions revoked after the backup, and
challenges rolled back to unconsumed while their codes are still within TTL —
but because the pinned backup unit is the whole instance directory (SQLite
*and* keyring), a restored pair is internally consistent, so **no in-directory
anchor can distinguish restore from an ordinary restart**, and an ordinary
restart must *preserve* sessions. Rather than assert a mechanism that cannot
exist, this slice pins a **restore procedure**: a documented startup flag /
host-ops verb (`--restored-from-backup`) that regenerates the
authorization-stream incarnation, revokes every restored session, and purges
unconsumed challenges. The residual is named honestly: **an undeclared restore
leaves resurrected sessions live until expiry or the next revocation event.**
Closing that would require a monotonic anchor outside the backup unit (a host
marker, or a monotonic counter the restore cannot roll back) — an open
question, not a claim.

**App-visible profile and membership rows** are ordinary app tables keyed by
`ctx.auth.userId` — the joinable "auth next to data" surface — **created by
app code** (an idempotent `ensureProfile`-style mutation on first
authenticated entry). Nothing mirrors `_auth_*` facts automatically; the
transactional first-login guarantee covers the `_auth_*` core, not app
profile rows.

### Built-in first provider

Passwordless email code, as a state machine:

- **Request.** `POST /auth/request-code { email }` canonicalizes (trim,
  Unicode NFC, lowercase the full address — a deliberate v1 account-identity
  rule — length-capped), throttles (`AUTH_THROTTLED`), supersedes any active
  challenge for the address (single active challenge; accepted consequence: an
  attacker inside the throttle window can repeatedly supersede a victim's
  in-flight challenge — a bounded login-DoS, chosen over multi-challenge
  bookkeeping), stores the challenge, delivers via the capture mailbox, and
  returns **`{ challengeId, expiresAt }` for every accepted request** — the
  id is opaque and issued whether or not the address maps to an existing
  user, so `/auth/exchange` has its key without creating an enumeration
  channel. Throttle honesty: in every supported topology all requests arrive
  from 127.0.0.1, so a per-source key degenerates to a global bucket; v1 uses
  a per-address key plus a global request-code budget, consciously — a
  bounded DoS lever on a dev box, low-stakes while delivery is capture-only.
  Forwarded-header source trust belongs to the deployment-security contract.
- **Code and digest.** 6 random digits, TTL 10 minutes, 5 attempts
  (`AUTH_CODE_LOCKED` on exhaustion; single-use). A salted-but-unkeyed hash
  of a 6-digit code is offline-brute-forceable in milliseconds, so digests
  are **keyed and domain-separated**, over a length-prefixed encoding:
  `HMAC(key, len‖digestVersion ‖ len‖challenge_id ‖ len‖canonical_address ‖
  len‖code)`. The pepper lives in an **auto-minted 0600 keyring file beside
  the database** (the ENG-23443 admin-token pattern) — *not*
  [LLP 0036](./0036-app-secrets-and-config.rfc.md) config, whose ratified v1
  holds app-declared secret entries granted to action VMs only (non-secret
  entries fail closed today: `SNAPBACK_CONFIG_NON_SECRET_UNIMPLEMENTED`).
  Keyring contract: versioned JSON `{ format_version, active_key_id, keys }`;
  atomic replacement (write-temp, fsync, rename); rotation adds the new
  active key **before** new challenges use it and retains old keys at least
  one challenge TTL; missing or corrupt keyring fails closed
  (`AUTH_PROVIDER_UNAVAILABLE` plus a startup diagnostic); `--memory`
  instances mint an ephemeral keyring. Hashing-polarity note (LLP 0009 pins
  "never hash secret values into audit logs"): plain SHA-256 at rest is fine
  for 256-bit bearers; low-entropy codes need the keyed construction; neither
  may appear in logs, hashed or plain.
- **Knobs are constants in v1** (TTLs, attempt limits, throttle budgets,
  grace window, session cap, rotation cadence) — 0036 v1 cannot hold them and
  this slice does not extend 0036.
- **Exchange — verify and consume in ONE transaction.** `POST /auth/exchange
  { challengeId, code }`. First-login provisioning is **transactional from the
  verified request**, never contingent on a webhook (LLP 0011). Earlier drafts
  additionally moved *verification* outside the single-writer lock and then spent
  a paragraph closing the compare-and-consume race that creates. **That race was
  self-inflicted.** 0011's outside-the-lock pin is about **Argon2 password
  hashing** (~100 ms, which would genuinely serialize the write lane), not a
  keyed HMAC over a 6-digit code (microseconds) — and **attempt accounting is a
  durable write on every attempt anyway**, so a wrong code must take the lock
  regardless. The outside-the-lock choice bought nothing here and cost a race.

  V1 therefore verifies and consumes atomically in one transaction: check
  `consumed_at IS NULL` **and** `superseded_by IS NULL` and not expired, verify
  the digest in constant time, increment attempts, consume, and create
  user/identity/session. Concurrent exchanges of one challenge yield exactly one
  session; a superseded challenge is never exchangeable; concurrent first-logins
  for one address yield exactly one user. Wrong, unknown, expired, consumed, and
  superseded codes return one non-enumerating `AUTH_CODE_INVALID` (attempt
  exhaustion stays `CODE_LOCKED` — different client guidance). The
  outside-the-lock *shape* stays documented for a future password provider, where
  it is genuinely required.
- **Sessions, refresh, and reuse — tiered, with a recoverable superseded
  state.** Bearers are 256-bit random with a greppable, checksummed prefix
  (`sbs_` + CRC, so secret scanners can validate candidates cheaply), stored
  hashed. Sliding expiry 30 days, absolute cap 90 days; the kit **rotates any
  bearer older than 7 days** (sliding expiry means an active client never
  organically refreshes; without a cadence both the stolen-bearer exposure
  window and tombstone growth are unbounded). `POST /auth/refresh` with the
  **current** bearer rotates — new token, tombstone the predecessor, same
  session id, same generation, same `authorityInstanceId` — so healthy
  connections and queued mutations survive. Superseded handling is **tiered by
  surface**: an **ordinary request** with a superseded family token is honored
  inside the grace window (10 s) and outside it fails
  `AUTH_CREDENTIAL_SUPERSEDED` — *not* expiry: the session is healthy, another
  custody holder has the successor. The client reloads shared custody and
  retries once; only a missing or invalid successor becomes the
  authenticated→anonymous transition. A **refresh** with a superseded token is
  `AUTH_REFRESH_SUPERSEDED` inside the window and **revokes the session**
  outside it (post-rotation refresh is never legitimate — reuse detection
  applies where its precondition holds). That discrimination depends on a kit
  rule, pinned here because missing it destroys healthy sessions: **a refresh
  always reads current custody immediately before sending**, and a
  `REFRESH_SUPERSEDED` response is followed by a bounded wait-and-reload, not
  a single read. Lost-response recovery: if a refresh commits but no custody
  holder retains the successor, the session is unrecoverable by design —
  re-authentication is the v1 answer (rare at a 7-day cadence; any
  successor-reissue scheme would let a thief rotate the family).
  `POST /auth/logout` revokes (generation bump).
- **The unreconciled-supersession hole, and why it is not closed here.** A
  thief who steals bearer N can rotate *first* and keep N+1. The victim then
  presents N on an ordinary request, finds no successor in custody, and — per
  the rule above — transitions to anonymous, while the thief's family stays
  healthy and reuse detection **never fires**, because the victim's prescribed
  recovery deliberately avoids refreshing. The tiered design that protects the
  sleeping tab is exactly what a thief exploits. Two partial mitigations are
  pinned: an ordinary-request supersession that the client cannot reconcile
  against custody **revokes the family server-side before local clearing**
  (so the thief loses the session too — the safe direction to fail), and the
  bounded-lease custody fallback carries a **fencing token** so a late former
  lease-holder cannot overwrite newer custody. Neither *distinguishes* theft
  from a shared-custody race; doing so needs stronger evidence than a bearer
  carries — a device/attempt identifier, or sender-binding the bearer to a
  non-extractable WebCrypto key (a DPoP/RFC 9449 shape). That is the named
  trajectory for the client-XSS posture too, and it is an open question, not a
  claim.
- **Client custody (kit deliverables).** An atomic custody record with mutual
  exclusion — **Web Locks plus BroadcastChannel, with a bounded-lease
  fallback** — owning bearer persistence, the 7-day rotation schedule,
  read-custody-before-refresh, the reload-and-retry-once superseded recovery,
  boot restoration, and logout broadcast. Custody trade named: the bearer
  lives in app-origin storage, so app-origin XSS can exfiltrate it — the trade
  bearer-first makes against the CSRF surface cookies would open, and **no LLP
  owns the client-page XSS posture today** (§Summary).
- **Delivery.** A minimal capture path first, migrating onto
  [LLP 0045](./0045-notifications-outbox.rfc.md)'s outbox once stable (0045
  owns the mailbox design and records the handoff). The capture mailbox is a
  **bounded in-memory store keyed by `challenge_id`**: TTL-scoped, erased on
  consume/supersede/reset, capacity-capped, and by construction never in the
  journal, exports, or backups. **Handoff constraint, pinned:** 0045's outbox
  is *durable* — auth-code payloads must never persist in durable intents (a
  plaintext code in a durable row lands in the database, exports, and backups,
  defeating the keyed-digest posture), so the migration requires an
  ephemeral/capture-class payload seam, which is a 0045 obligation of the
  handoff. The mailbox route has `AdminWrite` path policy and an additional
  **`ImpersonationCapability` effect gate**. Neither an ordinary admin bearer nor
  an `AdminSecretRead` lease satisfies the effect gate. (Plain `AdminRead` was
  never viable either: it is tokenless on loopback, and under the CORS echo a
  tokenless mailbox would let any local page mint sessions.) Reading a login code
  **is** minting a session; see below.

**The admin token is not a sufficient gate for session minting, and claiming it
is would be this slice's worst security error.** The mailbox (read any address's
login code) and `auth.mintSession` (mint a session for any email) each convert
*holds the admin token* into *is any user*. The shipped admin console persists
that token in **browser-readable `localStorage` on the server's own origin** and
calls the admin API at `location.origin` — so in the admin-onboarded same-origin
topology §Summary blesses, an **app-page XSS reads the admin token and becomes
any user**. "A 0600 file a browser page cannot read" is true of the *file* and
false of the *running system*. This is a privilege escalation the slice
introduces, and it is strictly worse than the bearer-exfiltration residual
§Summary names.

So **session-minting effects are not reachable by any browser-held credential.**
They require a distinct **impersonation capability** the console's token cannot
satisfy — the 0600 keyring read directly (CLI / host-ops path), or a per-boot
secret printed to the terminal. `AdminWrite` gates the route; the impersonation
capability gates the effect. Acceptance proves that a caller holding **only** an
ordinary admin or console credential — precisely what an app-origin XSS can
obtain — can neither read the mailbox nor mint a session. This also means the
admin console never displays login codes; the CLI does.

Related pin (LLP 0017 amendment): the console's persisted credential is an
*administer-without-secret-read* credential, never an `AdminSecretRead` or
*impersonate* credential, and this slice is what makes those distinctions
load-bearing.

**The read half is closed by separating administration from secret reads.** The
shipped server always serves console and app from one origin, so "do not co-locate
them" is unfollowable advice. Landing item 2 instead makes the console-persisted
credential and the durable admin bearer categorically unable to satisfy
`AdminSecretRead`. To inspect raw rows, an operator-plane CLI/keyring operation
mints a short-lived `AdminSecretRead` lease **outside the browser**. Only the
derived lease is handed to console memory. It names each permitted table
explicitly, has row and byte ceilings, admits no wildcard, and fails closed on
expiry, table mismatch, or limit exhaustion. The root minting authority never
enters app-origin browser memory or storage. The 0017 amendment records the
contract.
Acceptance proves that an app-origin script holding every persisted console value
cannot bulk-read `/_snapback/api/data/{table}` under sessions.

Residual after that lands, stated because it survives: an app-page XSS active
while an in-memory `AdminSecretRead` lease exists can steal that lease and read
within its remaining TTL, named-table scope, and unused row/byte budget. The
window and extent are bounded; they are not zero.

### Session transport and connection binding

**Bearer-only.** `Authorization` is the only session transport. **Cookies are
deferred** with the contract they require — origin allowlisting keyed on
cookie provenance *including credential-establishing requests* (login CSRF),
absent-Origin rules, cookie attributes and issuance/deletion, and the
`Access-Control-Allow-Credentials` prohibition under the loopback origin-echo.
Same-origin deployments via LLP 0030's proxy use bearer through the proxy.

**Non-loopback binds.** Session-enabled apps refuse plaintext non-loopback
binds (`SNAPBACK_AUTH_TRANSPORT_INSECURE`); dev-mode apps refuse non-loopback
binds absent the dangerous override. `?connection_token=` becomes
**dev-mode-only** — under sessions the connection token is a real-authority
capability and travels only in the header or the existing WebSocket
subprotocol.

**Connection binding.** The transport guard exists:
`/outbox/{connection_id}` and `/live/{connection_id}/stream` are
`ConnectionAuth` and require the server-minted `connectionToken` (the
unauthenticated surface [LLP 0038](./0038-snapback-system-review.research.md)
Part 4 #6 reported was closed after that review). This slice adds the
*authority* binding at **`POST /connection/open`**: the open presents the
**current** bearer (a grace-window superseded bearer may not mint a delegated
capability that would outlive its own tolerance), and the grant carries a
**bound authority** — `anonymous`, or
`session { sessionId, userId, provider, generation }`. The upgrade and outbox
drains keep presenting only the `connectionToken`. Honest framing: that token
is a **delegated bearer** — possession acts under the bound authority; there
is no second caller identity to compare on token-only operations. What the
binding guarantees is narrower and real: token A cannot address connection B,
anonymous tokens carry no user authority, and a bound token dies with its
session.

**Grant bounds.** The shipped local registry is already fixed at **16,384**
grants. Under pressure it evicts never-used grants first, retires a used grant
only after its existing idle lease, and otherwise refuses admission with the
already-emitted HTTP-429
`SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED` ([LLP 0031](./0031-server-route-taxonomy.spec.md)
§Connection capability grants). This slice preserves that capacity contract and
code. Its new work is authority binding, session-deadline expiry for bound
grants, and per-source open throttling. Per-source refusal is the distinct
`SNAPBACK_AUTH_THROTTLED`; fixed-cap refusal remains
`SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED`. Anonymous grants retain the shipped
used-grant idle lease rather than gaining a second overlapping timer.

**Validity is memory-only, with a fail-closed two-phase revocation.** LLP 0031
pins grant verification as registry-lookup plus constant-time compare in a
dedicated small lock — *never* the global write mutex — and LLP 0026's L9
tests (labeled LLP 0032 L9 in code) assert ephemeral operations proceed while
a mutation holds the write lane. Holding the small lock across a durable
commit would violate exactly that, and it would still not close the
check-then-act gap (an operation can validate, release, and act *after* a
revocation commits). So:

- The session write path maintains an **in-memory session projection**
  (`sessionId → { generation, expiresAt, state }`) plus a deadline index and a
  token index; sound because the instance lock guarantees exactly one process
  owns the database.
- **Revocation-class writes are two-phase and fail-closed:** publish a
  `pending-revoked` marker into the projection **before** the durable commit
  (new connection-scoped operations for that session are denied immediately),
  finalize after commit, and un-mark on rollback. Spurious denials during a
  rolled-back revocation are fail-closed and acceptable; the small lock is
  never held across the commit, so L9's isolation and latency bounds hold.
- **Markers carry fencing identities.** A bare boolean marker is unsafe under
  concurrency: operation A's rollback would un-mark operation B's *still
  pending* revocation. Each marker records the fencing generation of the
  operation that set it, and un-marking is **compare-and-unmark** — only the
  operation that owns the marker may clear it, and only if no stronger marker
  has superseded it.
- **Markers are identified by a unique per-operation token**, allocated under
  the projection lock, with the generation retained as the *ordering* key. A
  generation alone cannot identify an operation: two concurrent revocation-class
  writes against one session (a logout racing an admin revoke) read the same
  current generation, so "the operation that owns the marker" would be
  ambiguous, and B's rollback could clear a marker A still owns — reopening
  exactly the interleaving fencing exists to prevent. Two-concurrent-revocations
  of one session is a generated-interleaving acceptance case.
- **The effect boundary is the drain, not the enqueue** — and this is a
  correction, because the two rules could not both hold as previously written.
  Live deltas are produced *and enqueued inside the global write lock* (the
  mutation's post-commit fan-out re-executes each subscription's query,
  serializes it, and enqueues it, all within `with_snapback`'s guard), so
  "re-check the fencing generation immediately before the delta takes effect"
  at the point of production would mean taking the projection lock **inside the
  write lane** — precisely what the lock-order rule below forbids. The drain
  side is lock-order-compatible (`/outbox/{connection_id}` and the WebSocket
  sender reach the per-connection outbox through `EphemeralApi` and never touch
  the snapback mutex), so:
  - the **enqueued payload carries the fencing generation** it was produced
    under;
  - the **drain** compares it against the session projection and refuses to
    deliver a payload produced under a superseded generation;
  - the **session projection → `EphemeralApi` wiring** is an explicit item-5
    deliverable, alongside the `app.reset` → `ConnectionRegistry` wiring;
  - revoked streams are notified and closed within **5 seconds**, not an
    unbounded sweep.

  Stated honestly: a revoked session's rows are still **computed and serialized**
  under the write lock. The guarantee is **non-delivery, not non-computation**.
- Every other connection-scoped **act** re-checks the fencing generation
  atomically with the act itself — not check-then-act. This is the discipline
  [LLP 0034](./0034-contract-source-seam-provider-side.rfc.md) already ratified
  for `live_stream` teardown (ENG-23426: "the ownership check is now atomic with
  the destructive act"), and it is the same rule.
- Lock order is pinned (projection lock is never taken while holding the write
  lane), so no future deadlock.
- **Rotation gets the same treatment**: the tombstone write and token-index
  swap are ordered so a token is never honored before it durably exists —
  publish-after-commit for the successor, mark-superseded-before-commit for
  the predecessor.
- **Semantics of "in-flight" are stated rather than overclaimed:** an
  operation authorized *before* a revocation commits may complete; the
  guarantee is that no operation **validates** after the marker is published.
  Long-lived effects (an open stream) are closed by the deadline/generation
  sweep, not retroactively.
- Restart rebuilds the projection from `_auth_sessions` and can only
  **under**-extend a session, never over-extend (write-behind means the
  durable value lags) — acceptance-tested, not merely argued.

**Sliding-expiry writes are coalesced** (at most once per tenth of the window
per session, write-behind) because the single-writer lane's measured ceiling
is ~1,050–1,280 mutations/s (LLP 0038 Part 3). **"Use" is defined:**
authenticated app-data requests, connection opens, **and live-socket liveness**
extend the session (a read-only dashboard on a WebSocket is visibly in use and
must not slide out mid-use); `/auth/refresh` alone does **not** extend it —
refresh must not immortalize an abandoned session.

**Live-path auth errors are typed.** The live socket frame set gains an
auth-error variant (code plus safe detail) sent before the server closes a
socket for expiry or revocation; today the enum has no auth vocabulary and the
kit treats every close as generic loss and reconnects. The kit suppresses
auto-reconnect on auth-coded closes, surfaces the diagnostic, and runs the
clearing transition. A lost close frame converges: the next request fails the
same way. (Note: a bound socket presents only its connection token, so
`AUTH_CREDENTIAL_SUPERSEDED` has no live-socket path — it is a request-path
code.)

**Authority transitions, owned by one client coordinator.** 0011's ratified
call names the user-switch full wipe; sign-out/expiry cleanup appears as
adapter guidance and a "largely answered" note, so the dated 0011 addendum
this slice lands folds in an explicit sign-out-clearing ratification (exact
provenance, not a stretched citation). Clearing is **not** a per-handle
concern: a late terminal error from session A must not wipe a newer healthy
session B, and clearing rows alone is insufficient because the Contract
surface reapplies in-flight optimistic reducers whenever authoritative rows
are written. The kit therefore owns a single **`AuthCoordinator`**: an atomic
custody record plus a local monotonic authority epoch; every request,
connection, and subscription records the epoch it started under; terminal
handling is **`compareAndClear(expectedAuthority)`**, which is a no-op against
newer authority. Its clear barrier blanks live boundaries, disables callbacks
and reconnect, **removes optimistic overlays** and pending queues, **commits the
durable delete**, and only then exposes state or resubscribes.

**The epoch check guards every write into client state, not just failures.** A
delayed *success* — a late query response, a subscription callback, an
optimistic reconciliation, a retained write queued before the authority
transition — can repopulate
user A's data after an A→B wipe just as surely as a late error can clear B's.
So every success, failure, callback, queue mutation, optimistic
reconciliation, and durable-store write is an authority-epoch
**compare-and-commit**: work started under a superseded authority is dropped,
never applied. Acceptance covers a delayed *successful* A response arriving
after A→B.

**Retained scope, settled.** Retained rows are scoped by `userId` alone
(§Replay parity), while `ctx.auth` also exposes `sessionId` and `provider`.
Therefore v1 pins the cross-document rule from LLP 0053 categorically:
**`Retainable` implies declared `userId`-only authority dependence.** A function
whose visibility depends on `sessionId`, `provider`, or any other authority
dimension is `Online`, not retainable. Session-mode retained/offline reads remain
disabled until item 8. Widening retained scope later requires a versioned protocol
that includes every result-affecting authority dimension; it is not an item-8
alternative.

| Transition | Obligation |
|---|---|
| anonymous → authenticated | fresh connection; anonymous queued writes are **not** silently replayed under the new authority — they are surfaced for discard-or-re-record. Once item 8 exists, retained slices whose result depends on `userId` are hidden until a fresh authenticated snapshot; public authority-independent slices need no wipe |
| authenticated → different user | full wipe — data, queues, subscriptions — before resubscribing (0011's ratified rule); fresh connection |
| authenticated → same user, new session | no user-data wipe (principal scope unchanged); fresh connection; queued mutations from the old session strand (authority-instance scope changed) and surface discard-or-re-record |
| authenticated → anonymous (logout, expiry, revocation, auth-coded close, boot with an invalid persisted session) | `compareAndClear`: blank auth-scoped results, stop reconnect loops, drop grants/descriptors, remove optimistic overlays, and **delete** retained rows and queued mutations — before control returns to the UI |
| `CREDENTIAL_SUPERSEDED` | **not** an authority loss: reload custody, retry once; only a missing/invalid successor becomes authenticated→anonymous |

**Ephemeral rooms.** Today the ephemeral authorization inputs are
client-supplied and the wire types *require* `auth`, so session mode needs
**mode-dependent DTOs**: dev keeps the legacy required shape; session-mode
schemas omit the client-auth fields and reject their presence (including
explicit `null`), with both HTTP and WebSocket wire schemas registered under
LLP 0051 D4.
Under sessions the operation's identity is the connection's bound authority.
Two closures, not one:

- Collections whose `AccessPolicy` requires room permissions are a **declared
  capability gap** — before item 6 their registration fails closed with
  `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE`; after item 6 a fresh authorization
  denial is `SNAPBACK_AUTH_PERMISSION_DENIED`. The
  [LLP 0013](./0013-ephemeral-realtime-state.rfc.md)/0053 item-6 integration
  derives room grants from durable `permissionBacking` data and projects every
  relevant authorization event into room-authority suspension plus fresh
  snapshot reauthorization. This is an item-6 deliverable, not an unowned later
  gap.
- **`KeyMode::Custom` is rejected at manifest load under sessions.** Key mode
  is independent of `AccessPolicy` today. ENG-24353 already made the local
  baseline connection-owned: once one connection creates a custom key, another
  connection cannot replace or delete it merely by guessing the key
  ([LLP 0013](./0013-ephemeral-realtime-state.rfc.md) §Scope and keys). The
  surviving gaps are **first-writer squatting** and ownership whose durability
  is only the connection grant rather than server-resolved user/session
  authority. Those are unacceptable for sessions, so `Custom` remains rejected
  until generated key-level authorization exists. Only `Connection`, `Session`,
  and `User` key modes are available under sessions.

- **The rejection list must name the fields that decide the key — not just
  `auth`.** This is the trap §Authority resolution's own rule exists to catch.
  `PublishRequest` and `DeleteRequest` carry **`session_id`, `user_id`, and
  `custom_key` as siblings of `auth`, not inside it**; `SubscribeRequest` carries
  `auth` but not those three siblings. An earlier publish/delete resolver
  *preferred the sibling wire fields over the auth context* — which left
  `KeyMode::Session` and `KeyMode::User`, two of the three modes just declared
  safe, fully caller-controlled.

  **ENG-24566 has since closed that inconsistency:** `resolved_identity` now
  *requires* an authenticated identity and *rejects* a claimed identity that
  disagrees with it. But it closes the inconsistency, **not the forgery** — today
  `request.auth` is *itself client-supplied*, so a caller sets the claimed field
  and the auth field to the same victim and passes. That guard only becomes
  meaningful once `auth` is server-resolved, which is what this slice does. **This
  pin is what makes ENG-24566 real, not a duplicate of it.**

  Pinned per operation: under sessions, publish/delete reject **`session_id`,
  `user_id`, `custom_key`, and `auth`** if present, including explicit `null`;
  subscribe/unsubscribe reject `auth`, and their closed session DTOs reject
  injected unknown identity fields rather than silently ignoring them. Both HTTP
  and WebSocket families enforce the same rule. The entry key derives **solely**
  from the connection's bound authority. A key mode whose dimension the bound
  authority lacks (`KeyMode::User` under an anonymous grant) **fails explicitly**
  rather than collapsing callers onto a shared synthetic key. Acceptance carries
  the cross-user overwrite and delete negatives on **every** permitted key mode,
  not just `Custom`.

Through item 5 the "private rooms" claim is limited to finite request/response
data. Auth-scoped durable live and protected room collections stay
capability-refused. Item 6 adds the live-obligation and commit-ordered room-
authority invalidation contracts; only then may either live surface claim that a
membership kick stops delivery.

### Permission dependencies — owned by LLP 0053

**Authorization invalidation is [LLP 0053](./0053-authorization-invalidation.rfc.md)'s.**
It was split out of this document on 2026-07-12: six rounds of dual-model review
settled the authority, provider, transport, and connection contracts here while
that mechanism failed three successive design attempts, and both reviewer
families independently concluded it needed a surface small enough for its
contradictions to be detectable. **0053 owns authorization invalidation** — how a
permission change reaches every client that must stop seeing rows, and what a
client may read while offline. This document does not name the mechanism (0053 has
redesigned it six times; "classification" and "`resync_required` per write" were
both *rejected* attempts, and an earlier version of this sentence named them).

**The authorization-stream incarnation lives here, not in 0053.** It is an
*authority-stream* anchor — a durable value regenerated on **reset, logical
import, and declared physical restore** — and this document already needs it for
`app.reset` fencing (§Session transport) and for the restore procedure it owns
(§Protected identity core). It is not a permission-classification mechanism, so
keeping it in 0053 would have made landing items 3, 4, and 5 secretly depend on
item 6 and quietly falsified this document's own claim that the settled core can
land while 0053 is under review. It lands with **item 5**, alongside the session
projection it fences. LLP 0053 **consumes** it, pairing it with its epoch as
`(incarnation, epoch)`.

Pinned here, since this document owns it: the incarnation **persists across
ordinary restarts** — restart does not itself invalidate, quarantine, or delete
lease-valid retained bytes — and regenerates **only** on reset, import, and
declared restore. Any later auth-scoped live resumption still fresh-snapshots;
that is LLP 0053's continuity rule, not an incarnation rotation. A **missing**
persisted incarnation provides no continuity proof: retained state is deleted
before a fresh snapshot.

What this slice depends on from 0053, and must not contradict:

- **Ordinary writes cause no coarse authorization resync.** An ordinary write
  advances no authorization epoch, creates no global quarantine, and clears no
  unrelated client. A result-shrinking delivery still carries LLP 0053's scoped
  delivery obligation; that reliability mechanism is not a coarse authorization
  event. (Stated as an *outcome*: 0053 rejected "classification" as its primitive,
  so this document does not name the mechanism that produces the outcome.)
- **Permission changes fail closed.** A user who loses access stops receiving the
  affected rows — durably, including if the delivery carrying that removal is lost.
  LLP 0011's ratified v1 direction (server-directed resubscribe, not universal live
  re-evaluation) is preserved.

  Stated as an **outcome only**, deliberately. An earlier draft asserted the
  *mechanism* — "advance an epoch in the same transaction and send
  `resync_required` to affected subscriptions" — which is both stale and,
  ironically, **the design 0053 rejected as its first failed attempt** (it is the
  resync storm). 0053 has redesigned this mechanism six times; any mechanism this
  document names will go stale again. It names none.
- **Protected ephemeral rooms reauthorize under the same item-6 event.** A
  permission-backing membership change installs a dependency-indexed pending
  registry fence atomically with affected-room enumeration, installs and
  quiesces each room sink barrier before commit, then fresh-snapshots durable
  membership and either rebuilds the room authority or unregisters the denied
  subscriber. LLP 0013 owns the room state machine; 0053 owns the event
  projection/obligation and the registration/snapshot/publish/enqueue/drain/send
  linearization. Until item 6, the capability stays refused rather than claiming
  partial private-room support.
- **Auth-scoped live is admission-refused until item 6.** Items 1–5 may activate
  sessions for finite request/response work and explicitly
  `authorityIndependent` live surfaces. The server creates no auth-scoped live
  boundary until item 6 advertises the invalidation protocol and the client
  negotiates it; item 7 does not relax this gate.
- **Invalidation carries a disposition, not a boolean** (`retain < quarantine
  < delete`), and the client `AuthCoordinator` specified in §Authority
  transitions is what *executes* it. **Ownership is split the same way as the
  incarnation, and for the same reason:** this document owns the coordinator **and
  the disposition enum itself** (`retain < quarantine < delete` — it is a
  coordinator interface type, and item 5 needs it to exist); LLP 0053 owns **when
  each disposition is produced** for authorization events, and the escalation rules
  (item 6). Without that split, item 5 would need a 0053 deliverable and the
  landing-independence claim below would be false — the precise error the
  incarnation move already had to correct once.

  The coordinator's clear barrier therefore **takes a disposition from day one**
  (item 5), and at item 5 the **only value it ever produces is `delete`** (every
  authority loss). It needs no quarantine machinery, so item 6 is purely additive
  rather than reopening the client barrier.

  **Session loss deletes; this document owns that decision.** On any
  authenticated→anonymous transition (logout, expiry, revocation, auth-coded
  close, boot with an invalid persisted session), affected retained slices and
  queues are **deleted** — one behavior, no alternatives. This is 0039's own
  conservative v1 default, chosen deliberately: it is fail-closed, it is simple,
  and — critically — it keeps landing item 5 free of 0053's *query-scoped quarantine/delete* primitive,
  which lands at item 6. If item 5's barrier needed quarantine, item 5 would depend
  on 0053 and the split's landing independence would be fiction.
  (0053's quarantine-then-prove is the **item-6 live outcome** for
  *permission*-change invalidation, which is a different transition and a cheaper
  one; item 8 extends that outcome to retained/offline state through the
  `AuthorizedLease`/store capability. Neither is what happens when a session
  ends. An earlier draft cited 0053 as *requiring* deletion here — that
  attribution was stale and is withdrawn.)
- **Retained/offline reads are disabled under session mode** until item 8 lands
  0053's reviewed fail-closed retained-authorization outcome, its durable client
  fence, its `AuthorizedLease`/store capability over the query-scoped
  quarantine/delete primitive and stored `(incarnation, epoch)`, and the minimum
  disposition-aware client protocol. The bootstrap handshake reports retained
  availability and that minimum separately from item 6's auth-scoped-live
  availability; an older or unknown client is refused. This is why landing item
  8 is last — and the product consequence is stated plainly in §Summary rather
  than buried: **adopting sessions temporarily removes the retained stale-boot
  capability shipped by LLP 0043's first closed-IR, single-query slice**.

The auth-variable expression half already ships and is unchanged by the split:
`authUserId()` / `ValueExpr::AuthUserId` with fail-closed evaluation via
`SNAPBACK_AUTH_USER_MISSING`, which this slice regression-pins for
session-derived contexts (§Acceptance).

**This document names 0053's outcomes, never its internals.** 0053's model has
already been redesigned twice under review, so any vocabulary this document
copied would go stale — as it did. The seam is therefore stated only as the
outcome invariants above, and 0053 owns every declaration name, diagnostic code, and
manifest/wire vocabulary that implements them. If an implementer needs those
names, they read 0053.

(Naming note that outlives the split: this corpus says "authorization epoch";
the code and wire say "permission epoch" — same mechanism.)

### Replay parity and the authority instance id

Replay parity of `ctx.auth` between optimistic client runs and authoritative
replay is a hard 0011 requirement whose queued-replay half is LLP 0043's
milestone. What ships today, precisely: the server computes a tagged,
domain-separated, length-delimited **SHA-256** fingerprint over the
`(principal, session_id, user_id)` **wire** tuple and retains it per settled
client mutation; duplicate settlement under a changed current-format fingerprint
is refused with the shipped `SNAPBACK_AUTH_STALE_RESULT`. FNV-1a survives only
as a legacy deletion/acknowledgement alias. A retained `fnv1a:` row cannot be
rebound to the current identity and instead fails with the distinct shipped
`SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED`.
Server-produced wire ledgers leave the fingerprint channel unset
([LLP 0051](./0051-language-neutral-data-tier.rfc.md) D1 pins that split as
settled and landed), though the public `CtxAnswerLedger` still carries a
deserializable `auth_fingerprint` member, which session-mode ingress rejects.
The gaps: the retained fingerprint derives from **client-asserted body auth**
(the trust hole this slice closes), the contract store's mirror derives from
`userId` alone, and there is no **server-authoritative** guard on first
delivery.

V1 closes this with an **opaque authority instance id** — deliberately not a
canonicalized hash, so there is nothing to canonicalize across languages and
nothing a reader could mistake for authentication — and a **two-axis client
store**, because one axis cannot express the transition matrix:

- **Principal/data scope** = `userId` (or `anonymous`). Governs **retained
  rows**: same-user re-login preserves them; a different user wipes them.
- **Authority-instance/queue scope** = `authorityInstanceId` (minted per
  session, stable across refresh). **In dev mode it is keyed to the
  authorization-stream incarnation — per-reset, and stable across an ordinary
  restart.** A per-boot value would strand the client's queued mutations on every
  `cargo run`, which is the most common event in development and would regress the
  queued-replay flow shipped by LLP 0043's first closed-IR, single-query M1/M2
  slice; it would also conflate an ordinary restart with a reset, the exact
  conflation this document's own incarnation rule rejects. Governs **queued
  mutations**: a new session strands the old session's queue as
  non-executable-but-visible for discard-or-re-record, without touching
  retained data.
- The server issues `{ descriptorVersion: 1, authorityInstanceId,
  sessionGeneration }` on login, refresh, and the `GET /auth/session`
  handshake. Compared fields on delivery are `authorityInstanceId` only
  (`sessionGeneration` is an observability fact — a revoked session already
  fails credential resolution, which precedes descriptor comparison).
- **The descriptor-required predicate:** a request carrying a
  `clientMutationId` (i.e. queued/replayable) must carry the descriptor in a
  dedicated `MutationRequest` field (`authorityDescriptor`), never inside the
  client-supplied ledger. Under sessions, absent / unknown-version /
  mismatched descriptors fail with `AUTH_STALE_RESULT` (detail distinguishes
  the three) on **first delivery as well as duplicate settlement**. Non-queued
  requests need no descriptor.
- Anonymous callers get an anonymous-scope descriptor; anonymous queued writes
  are never silently replayed under a new authority (§Authority transitions).
- Precedence: credential validity resolves first — invalid/expired/superseded
  credentials fail with their own diagnostics before any descriptor
  comparison. `STALE_RESULT` is reserved for delivery under a *valid but
  different* authority; its client guidance is discard-or-re-record (a
  user-visible decision), never automatic retry.
- The descriptor is a **consistency input, never authentication** — possession
  grants nothing; the server always re-resolves authority from credentials.
  `descriptorVersion` exists so a future userId-scoped v2 is additive.

Companion amendments this needs, named: **LLP 0051** (the descriptor is a new
channel beside the D1 split. D1 already pins auth context/fingerprint as
server-retained and never wire-crossing; the real semantic reconciliation is
that D1 freezes and re-supplies the identity the handler observed, while this
document requires **current credential resolution plus descriptor mismatch
refusal before execution**. The retained auth evidence/fingerprint cannot become
replay execution authority) and **LLP 0043** (whose first closed-IR,
single-query M1/M2 slice shipped retained stale boot and queued replay, so it
adopts the descriptor and item-8 invalidation outcome rather than waiting for a
broader milestone).

### Diagnostics and route registry

| Code | Meaning boundary | HTTP | Live path | Retry |
|---|---|---|---|---|
| `SNAPBACK_AUTH_REQUIRED` | Authentication required and absent, or the credential is structurally invalid/unknown | 401 | typed auth-error frame | after login |
| `SNAPBACK_AUTH_SESSION_EXPIRED` | A well-formed credential is expired or revoked | 401 | auth-error frame, then close; grant invalidated | after re-auth |
| `SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED` | Ordinary request presented a superseded family token past the grace window; the session is healthy | 401 | n/a (bound sockets present only the connection token) | reload custody, retry once |
| `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` | Legacy body auth presented under sessions (regardless of any valid bearer) | 400 | typed auth-error frame | remove body auth |
| `SNAPBACK_AUTH_PERMISSION_DENIED` | Authenticated but not authorized (handler deny; item-6 protected-room reauthorization deny) | 403 | typed auth-error frame | no |
| `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE` | The server can enforce sessions but item 6's auth-scoped-live invalidation protocol is not installed; refusal occurs before registration/materialization | 503 | subscribe/resume refusal before a live boundary exists | after item 6 lands |
| `SNAPBACK_AUTH_THROTTLED` | Rate limit (per-address code requests; per-source connection opens) | 429 | n/a | after window |
| `SNAPBACK_AUTH_CODE_INVALID` | Wrong, unknown, expired, consumed, or superseded challenge/code — one non-enumerating outcome | 401 | n/a | new challenge |
| `SNAPBACK_AUTH_CODE_LOCKED` | Attempt limit exhausted; challenge dead | 403 | n/a | new challenge |
| `SNAPBACK_AUTH_REFRESH_SUPERSEDED` | Refresh presented a superseded bearer inside the grace window | 409 | n/a | wait-and-reload custody, else re-auth |
| `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` | Provider, keyring, or delivery seam unavailable | 503 | n/a | yes |
| `SNAPBACK_AUTH_STALE_RESULT` | A queued mutation was produced under a valid authority that is not the current one (descriptor absent, unknown version, or mismatched) | 400 (preserves the shipped mapping) | error envelope on the affected item | discard or re-record (user decision) |
| `SNAPBACK_AUTH_USER_MISSING` | Expression/scope evaluation required an authenticated user and none was present | 400 | error envelope | after login |
| `SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED` | The shipped fixed-cap registry has no unused or idle-expired grant to retire | 429 | n/a | after a grant idles/exits |
| `SNAPBACK_AUTH_MODE_PENDING` | Ordinary app data and Public attestation are refused because a staged auth-mode change has not been consumed (`desired != active`); only the privileged provisioning correction/re-stage branch is exempt | 503 | typed auth-error frame | after the operator corrects/re-stages and restarts, or unstages; the handshake's `modeState` says which |
| `SNAPBACK_AUTH_MODE_DEV` | An `/auth/*` provider route was called on a dev-mode app (the bootstrap handshake `GET /auth/session` is exempt and answers normally) | 404 | n/a | no — enable `auth.mode: "sessions"` |

Startup/load-time: `SNAPBACK_AUTH_TABLE_COLLISION`,
`SNAPBACK_AUTH_MODE_DOWNGRADE`, and `SNAPBACK_AUTH_TRANSPORT_INSECURE`.
`SNAPBACK_AUTH_MODE_PENDING` is a request-path 503 and handshake/runtime-state
fact, not a manifest-load failure. (Authorization-invalidation load-time
diagnostics are LLP 0053's and are registered there.)

Two request-path codes already ship and are adopted rather than re-minted:
`AUTH_USER_MISSING` (unchanged; the surface-level gate `AUTH_REQUIRED` is
distinct from this evaluation-level requirement) and `AUTH_STALE_RESULT`
(shipped replay/idempotency meaning kept, enforcement extended to first
delivery — changing an emitted code's meaning would be an LLP 0012
compatibility event, so unifying is the compatible choice).

Enforcement plumbing, named so it cannot be skipped: the HTTP status mapper
already maps the two shipped auth codes — `SNAPBACK_AUTH_STALE_RESULT` and
`SNAPBACK_AUTH_USER_MISSING` — to 400, already maps
`SNAPBACK_CONNECTION_GRANT_LIMIT_EXCEEDED` to 429, and deliberately defaults
unknown codes to 500. It gains the new auth-family mappings above while keeping
those compatible baselines. Handler-facing denial gets a typed helper so a deny
surfaces as `AUTH_PERMISSION_DENIED` instead of normalizing to
`SNAPBACK_HANDLER_FAILED`; and `authRequirement` — emitted
today as a hardcoded `optional-user` string with **no runtime consumer** —
becomes a closed enum with a typed authoring spelling
(`auth: 'authenticated'`), enforced at the shared gate on **session-mode and
dev-mode apps alike**, so apps discover their gates in development.

Redaction: tokens, codes, and keyring material never appear in logs,
diagnostics, or details, hashed or plain; addresses appear in identity data
and the operator-plane mailbox only. Acceptance carries a field-level
public-vs-gated projection sentinel following LLP 0031 D3/ENG-23441 **plus a
separate secret-redaction test**; a projection sentinel is not evidence that a
credential was safe to retain in the first place.

**Route table.** The 0031 revision adds **`SessionAuth`** and
**`AdminSecretRead`**, and makes **`ImpersonationCapability`** a composable
effect-policy requirement. It re-scopes `AppAuth` to dev-mode semantics, pins
**router↔registry parity** plus centralized policy middleware, records the
independent axes — path policy, credential resolution, invocation authority,
legacy-body acceptance, effect policy, response sensitivity — and adds the
session-mode overlay. A policy is not a credential: the path/effect columns say
*what must be proven*, while credential resolution says which distinct carrier
can prove it. The 0031 revision owns the full existing-route × mode matrix; these
are the load-bearing auth rows:

| Route / operation | Path policy | Credential resolution | Invocation authority / effect policy | Mode / response-sensitivity overlay |
|---|---|---|---|---|
| `POST /auth/request-code` | Public (app-data) | none | provider service, no caller identity | sessions provider route; typed public response |
| `POST /auth/exchange` | Public (app-data) | challenge proof, not a caller credential | provider service; issues session credential | sessions provider route; credential response is no-store |
| `POST /auth/refresh` | `SessionAuth` | required, family-aware bearer | resolved session | sessions only; credential response is no-store |
| `POST /auth/logout` | `SessionAuth` | required bearer | resolved session | sessions only |
| `GET /auth/session` | Public (app-data) | optional-user; any presented bearer is validated | resolved caller projection | all modes and `MODE_PENDING`; HTTP 200 anonymous; reports retained/queued availability and minimum client protocol |
| `POST /connection/open` | Public (app-data) | optional-user; a bearer must be current | binds the resolved authority | dev/session body-auth overlay; secret delegated capability response |
| `GET /` and `GET /inspect` | Public | none | none | typed public projection; D3/response-sensitivity sentinel |
| `GET /_snapback/api/auth/mailbox` | `AdminWrite` | admin-write credential **plus** separate operator-plane capability carrier | `ImpersonationCapability` effect required | credential-sensitive; never reachable with admin/console/secret-read lease alone |
| `GET /_snapback/api/data/{table}` | `AdminSecretRead` under sessions | short-lived in-memory lease naming this table; ordinary admin bearer is insufficient | raw operator inspection, no user identity | row/byte bounded; no wildcard; expiry/table mismatch fails |
| `POST /app/ensure` `{ intent: "attest" }` | Public under sessions | none | exact identity-only pair; compare only, never mutate | typed hash/identity projection; rejects manifests, seed, and mode-stage fields; refused during `MODE_PENDING` |
| `POST /app/ensure` `{ intent: "provision" }` | `AdminWrite` | admin-write credential or pre-bind startup authority | operator/system provisioning | explicit branch gate runs before hashes or any payload effect; sole schema-apply correction/re-stage branch during `MODE_PENDING`; no fallback to attest |
| direct runner query | `AdminSecretRead` under sessions | table/response-scoped secret-read lease | anonymous handler projection plus `adminBypass` audit fact | refused on `prod`; client auth fields rejected |
| direct runner mutation | `AdminWrite` | admin-write credential | anonymous handler projection plus `adminBypass` audit fact | refused on `prod`; client auth fields rejected |
| host-ops `auth.mintSession` | `AdminWrite` | admin-write credential plus separate operator-plane capability carrier | `ImpersonationCapability` effect required | dev/test/demo only; refused on `prod`; audit-marked |
| host-ops `auth.rescueCollidingTable` | `AdminWrite` | admin-write credential plus separate operator-plane capability carrier | `ImpersonationCapability` effect required | dev/test only; refused on `prod`; transactional recovery |
| host-ops `function.run --as-user/--as-role` | `AdminWrite` | admin-write credential plus separate operator-plane capability carrier | `ImpersonationCapability`; resolved `devImpersonation` | refused on `prod`; no browser carrier |

On dev-mode apps the provider routes return a typed HTTP 404
(`SNAPBACK_AUTH_MODE_DEV`), **not an untyped missing-route response**. The
bootstrap `GET /auth/session` exception continues to answer HTTP 200.

**Observability and contract registration.** Admin and host-ops surfaces
display whether an operation ran as unauthenticated, a real session, local-dev
impersonation, or admin bypass. Target capability manifests carry what the
target *supports*, including `supportedArtifactVersions` and
`supportedAuthModes` (the must-understand rule checks this at both ends, while
the closed tuple rule prevents treating the two arrays as a Cartesian product);
the
bootstrap handshake and gated runtime-state surface report the effective app
facts — active/desired `authMode`, providers, enabled transports,
`writeAuthorization: "handler"`, `authScopedLiveAvailable`, retained-read and
queued-replay availability,
and the minimum disposition/fence-aware client protocol. Registration is
partitioned by the owning registry: **LLP 0012** owns the `SNAPBACK_AUTH_*`
diagnostic family, capability/runtime-state auth facts, and the must-understand
carve-out for `auth.mode`; **LLP 0051 D4** owns wire/serde schemas (typed live
auth-error frame, mode-dependent ephemeral DTOs, `authorityDescriptor`, the
two-axis store migration, incarnation-bearing subscribe/resume/store schemas,
and the hosted coordinator→handler invocation marker); the hosted
deployment-security contract owns the mixed-version deployment proof; and **LLP
0053** registers its own manifest and wire vocabulary — this document registers
none of it.

## Landing order and companion obligations

This document is the **umbrella**: it owns the sequencing for the auth program,
including the items [LLP 0053](./0053-authorization-invalidation.rfc.md) designs.
The lands-before edges:

1. **0031 revision** (policies, `AppAuth` re-scope, router↔registry parity,
   per-entry axes and session-mode overlay, the existing-route × mode matrix)
   — everything routing depends on it.
2. **Existing-surface closure** (`/_snapback/api/data/{table}` under
   `AdminSecretRead`; `/app/ensure` split into identity-only Public attestation
   and privileged provisioning; direct-runner closure; the
   response-sensitivity audit; and the short-lived, out-of-browser-minted,
   browser-memory-only `AdminSecretRead` lease replacing any persisted
   secret-read credential) with the LLP
   0017/0034 amendments — lands with or before sessions become enableable, so
   sessions are never decorative.
3. **Auth catalog + keyring + provider core** (tables, reservation, collision
   check, transactional `auth.rescueCollidingTable`, state machines, mailbox,
   diagnostics plumbing). This item is incomplete until the collision and rescue
   acceptance cases pass.
4. **Shared invocation gate + mode machinery + bootstrap handshake** (staged
   activation, paired-v1 sessions artifacts and pre-effect
   intent/branch-authorization/version/mode/pair/capability preflight,
   `MODE_PENDING` refusal,
   loopback-only dev auth, body-auth rejection, `authRequirement` enforcement,
   `auth.mintSession`, and the full
   session-mode ephemeral closure: operation-specific closed DTOs, sibling
   identity-field rejection, `KeyMode::Custom` prohibition, and fail-closed
   permission-policy collections) — requires 1–3. This item is incomplete until
   the corresponding predecessor fresh/provisioned-v0 artifact matrix and HTTP
   and WebSocket acceptance cases pass.
5. **Connection binding + two-phase revocation + typed auth-error frame + kit
   `AuthCoordinator`/custody/clearing** — requires 3–4; owns the
   `app.reset` → `ConnectionRegistry` wiring.
6. **Authorization invalidation** (**LLP 0053**: declarations, the
   authorization-event universe, epochs, obligations, dispositions, protected-
   query admission, and room-authority reauthorization) — requires
   **5**, which supplies the `AuthCoordinator`, disposition execution, serialized
   clear barrier, and durable incarnation. LLP 0053 supplies and owns its own
   item-6 authorization-invalidation fence; this document asserts no queue-fence
   keying to item-5 custody or generation. Item 7's authority descriptor is only
   an additional equality axis once available. **LLP 0053 is Accepted and
   ENG-24592's review blocker is closed.** Item 6 still requires item 5 and starts
   only in its ordered landing slot; acceptance settles the contract rather than
   claiming its implementation exists.
7. **Authority descriptor + two-axis store + first-delivery enforcement**
   (this document) — requires 3 and item 5's kit work; independent of 6.
8. **Retained reads under sessions** (**LLP 0053**) — requires 5, 6, and 7; lands
   last. It requires 0053's accepted fail-closed retained-authorization contract,
   durable client fence, a disposition-aware client, and the full
   `AuthorizedLease` contract. LLP 0053 pins the 24-hour default and hard
   maximum, rollback clocks, and session/provider clamps; this seam names only
   the required outcome.

**Activation gate, pinned:** `auth.mode: "sessions"` is not enableable until
items **1–5** are present. Items 1–4 alone would allow sessions with
authority-unbound grants, no revocation fencing, and no client barrier — an
intermediate state strictly worse than dev mode, because it *looks*
authenticated.

**The item-5→7 window is explicit and fail-closed.** Online sessions may enable
at item 5: credential resolution, connection binding, revocation, and the client
clear barrier are then enforced. Session-mode **queued mutation replay remains
unavailable**, however, because there is not yet a server first-delivery authority
guard. The handshake reports it unavailable; the kit reports that mutation
surface `Online`, refuses new offline enqueues, and strands every pre-existing,
anonymous, or old-session queue entry for explicit discard or re-record **before
any send**. Item 5 claims only this client-side refusal, not descriptor security.
Item 7 enables queued replay only when the two-axis store is migrated and every
`clientMutationId` carries a descriptor enforced on first delivery and duplicate
settlement.

**Session activation matrix (identical in LLP 0039 and LLP 0053):**

| Landed items | Session-mode admission |
|---|---|
| **1–5** | `auth.mode: "sessions"` may activate. Ordinary online request/response and explicitly `authorityIndependent` live surfaces are allowed. Every auth-scoped live surface (durable subscribe/resume or protected ephemeral-room registration) is refused server-side with `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE`; retained/offline reads remain refused. |
| **+6** | Auth-scoped live surfaces unlock only when server and client negotiate `authInvalidationProtocol: 1`; retained/offline reads remain refused. |
| **+7** | No admission change. The authority descriptor is an optional additional equality axis and item 7 may land before item 6. |
| **+8** | Retained/offline reads unlock only when the item-8 lease/store capability is also negotiated. |

Because items 6 and 8 are 0053's, and items 1–5 and 7 depend on **no 0053
deliverable** (the incarnation having moved here — §Permission dependencies), the
settled core can land and be proven while 0053 is in review. That separation is
the point of the split, and it only holds because the incarnation moved.

**What item 7 proves while item 6 is still blocked, stated honestly:** two users
receive different authorized results through fresh finite invocations, and the
authority descriptor/two-axis queue rejects cross-authority replay. It proves no
auth-scoped live behavior: subscribe/resume is still admission-refused. Item 7
remains implementation-independent of item 6. The card game's full subscribed
hidden-state and kick proof runs only after **both** items 6 and 7: item 6 supplies
witnessed durable invalidation and commit-ordered room-authority reauthorization;
item 7 supplies the replay/storage equality axis. Say so in acceptance and the
LLP 0016 diary rather than discovering it when the demo ships.

Companion obligations: the **0031 revision** (item 1); the **0017 and 0034
amendments** (item 2); the **0051 amendment** (descriptor channel; reconcile
0051's frozen handler-observed identity with current-authority descriptor refusal);
the **0043 amendment** (its first closed-IR, single-query M1/M2 slice adopts the
descriptor here and item-8 invalidation outcome); the **0012 registrations** (§Observability,
including the must-understand carve-out; 0053 registers its own manifest and
wire vocabulary); the **0000/0008/0011 dated authorization-invalidation
amendments** (0053 precedence without weakening fail-closed/fresh-snapshot
fundamentals); the **0013 room-authority amendment**; the remaining **0011
dated addendum** (write-authorization interim narrowing; explicit sign-out-
clearing ratification); the **0024 amendment**
(`session` authority mode; `auth.mintSession` verb); the **0045 handoff**
(capture mailbox **and** the ephemeral-payload seam keeping codes out of durable
intents); the **0004 example alignment** (0053's, since it turns on the
analyzable filter forms); and **LLP 0020 §Remaining Phase 4** closes when 0053
lands. The full subscribed proving demo lands only after both items 6 and 7.

## Protocol obligations deferred to implementation

**Ratified by Charlie, 2026-07-12: this is an RFC, not a protocol spec.** The
dual-model loop surfaced a genuine methodological split — one reviewer family held
this document to *executable-protocol* standards (durable state machines,
linearization proofs, a named carrier for every failure path), the other to
RFC-altitude design pins. Both are defensible; LLP 0005 reserves the call to the
author, and the author's call is that **design intent is pinned here and protocol
rigor lands in the implementing LLPs/specs.**

That is a deferral, not a dismissal. These are the obligations an implementing
document must discharge before the corresponding landing item can be called done.
They are recorded so they cannot be quietly lost:

1. **Revocation linearization** (item 5). A multi-operation state machine for
   concurrent revocation-class writes on one session: unique operation tickets, a
   representation for overlapping markers, rollback and ambiguous-commit
   behavior, and — per LLP 0034's ratified precedent (ENG-23426) — a check that is
   *atomic with the act* at every sink (outbox **drain** / WebSocket send, room
   mutation, response publication, refresh, reset). Enqueue stamps the production
   generation; it is not the effect boundary.
2. **Client barrier fencing** (item 5). A conditional-write contract across
   IndexedDB / SQLite / localStorage and multiple tabs: the expected authority
   generation persisted *in the same transaction* as each write, reads suppressing
   mismatched records, and generation-segmented namespaces where the store offers
   no conditional transaction.
3. **Staged-mode, artifact compatibility, and bundle transition** (item 4). A
   durable transition-state table over `(active, desired, requested deployment
   identity, modeState, app-data availability)`, with crash traces at every
   boundary. The implementation defines one pre-effect candidate-pair check:
   explicit operation intent and branch authorization, schema and function
   `schemaVersion`, effective mode, cross-artifact identity,
   `supportedArtifactVersions`, and `supportedAuthModes` are all resolved before
   a matching-hash shortcut, DDL, desired-mode write,
   function replacement, or seed. Its matrix covers the two accepted tuples
   v0-dev and v1-sessions, plus rejected v0-sessions, **v1-dev**, mixed and
   unknown versions, a missing initial half, unsupported
   target facts, insufficient privilege, malformed/cross-variant intent, and
   matching-hash negatives. A pinned, actual unmodified pre-auth predecessor runs
   in its provisioning-allowed `dev` profile and receives the full v1-sessions
   `/app/ensure` payload against both a fresh database and an already-provisioned
   identical-content v0-dev database. Each request asserts
   `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION` and no request-attributable byte or
   logical change; the latter proves the disjoint v1 hashes cannot take the
   predecessor's `matched` shortcut. Public attestation is tested as
   identity-only and non-mutating; smuggled full manifests, seed, or mode-stage
   fields are rejected. During `MODE_PENDING`, ordinary app-data and Public
   attestation are refused while only an explicitly privileged provisioning
   request can correct or re-stage, still after full preflight. Relocate-and-poison
   is tested separately as the post-activation reopen/rollback defense.
4. **Refresh-family alarm** (item 3). An idempotent revoke-only operation that
   accepts an attributable tombstoned bearer, grants no authority, leaks no family
   state, and can only destroy that family — plus its offline/lost-response
   residual.
5. **Replay-descriptor persistence** (item 7). The authority-instance id persisted
   atomically with each settlement, and the legacy/null-settlement migration,
   including current `sha256:` records and `fnv1a:` deletion-only aliases that
   refuse with `SNAPBACK_CLIENT_MUTATION_LEGACY_AUTH_QUARANTINED`.
6. **Backup consistency** (item 3). A quiesced copy, SQLite online backup, or
   atomic snapshot spanning database + WAL + keyring — "copy the instance
   directory" is not a consistency protocol for a live WAL database.
7. **The `ImpersonationCapability` carrier** (items 2–4). It gates the mailbox,
   `auth.mintSession`, `auth.rescueCollidingTable`, and host-ops `function.run
   --as-user`/`--as-role` — and
   host-ops has an HTTP projection (LLP 0024), so it needs a wire carrier that
   never puts raw keyring bytes on a request. A per-boot derived secret (e.g. HKDF
   over the keyring key and the boot nonce) satisfies the "never the `localStorage`
   token" pin cleanly; the alternative is declaring impersonation verbs CLI-only.
   Pin one.
8. **Hosted mixed-version and pre-mutation refusal** (companion; hosted
   deployment-security contract). One source tree produces separate handler and
   gateway/coordinator Workers, and `deploy.sh` updates the handler first. The
   protocol spec must define the coordinator→handler must-understand invocation
   marker, make a sessions handler refuse an absent/unknown/session-unaware marker
   before execution, and model handler-first deploy, activation delay, rollback,
   and third-party stale-worker interleavings. Separately, hosted
   `initializeSchema()` currently creates `_snapback_meta` before deployment
   validation, then validates before `ensureCurrentSchema()` and subscription
   migration. Thus "a refused sessions bundle leaves the target unchanged"
   requires moving sessions preflight before the initial metadata DDL; it does not
   rely on the false claim that destructive migration currently precedes
   validation. LLP 0051 D4 registers the marker's wire schema; the hosted contract
   owns deployment ordering and proof.
9. **The `AdminSecretRead` lease** (item 2). The implementing spec pins an
   operator-plane-only mint operation whose root authority is read directly by
   CLI/keyring code and never serialized into an app-origin request. The derived
   bearer is opaque and redacted, process/reset bounded, short-lived, names a
   non-empty finite table set (no wildcard), and carries row and byte budgets.
   Concurrent reads reserve both budgets atomically before returning any rows, so
   two scans cannot each spend the same remainder; a response that would exceed a
   remainder is refused rather than partially leaked. Expiry and table scope are
   checked atomically with admission. Console custody is memory-only and tested
   against every persistence adapter.
10. **Protected-room sink linearization** (item 6). LLP 0053's implementing spec
   must install a unique dependency-indexed registry ticket atomically with
   affected-room enumeration, interlock protected-room registration/initial
   snapshot installation with that ticket, install and quiesce each pending
   room-authority barrier before an authorization-changing commit,
   finalize/compare-rollback by exact ticket, and generation-check atomically
   with room mutation, fanout enqueue, destructive drain, and final send. A
   post-commit callback, enumerate-then-register gap, or loose validate-then-act
   check is not sufficient while those sinks bypass the global write mutex.

## Non-goals

- OAuth/OIDC provider adapters in the first slice.
- Cookie session transport (deferred with its login-CSRF/Origin contract).
- Organizations, teams, invitations, SCIM, SAML, enterprise policy.
- Role-based permission checks (`roles` is carried, pinned `[]`; roleful
  impersonation is unbuilt 0024 work).
- Declarative write-side row-level rules. An explicit, ratified narrowing of
  LLP 0011 (2026-07-07): 0011's validation list calls for two-sided write-RLS
  proof; this slice substitutes `authRequirement` enforcement plus handler
  rejects, reports it (`writeAuthorization: "handler"`), proves the substitute
  per write class in §Acceptance, and records the interim in the 0011
  addendum.
- Custom ephemeral keys under sessions (still fail closed until generated
  key-level authorization exists). Room-permission invalidation is no longer a
  non-goal: LLP 0053 item 6 owns it.
- Automatic mirroring of `_auth_*` facts into app tables.
- Identity-subject (email) change or rename, and built-in user deletion —
  both will eventually press on the `(provider, subject)` uniqueness model;
  0011's `UserDeleted` guidance covers BYOP, not the built-in provider.
- Self-serve signup beyond admin-driven onboarding (gates on LLP 0045).
- An auth event/audit trail beyond `identity_id` provenance.
- Logical export/import tooling (0007/0046; contract pinned here only).
- Cross-provider identity linking policy.
- Client-side visual hiding of unauthorized rows.
- Encryption at rest for client-retained data (LLP 0043's open question).
- **Authorization invalidation** — how a permission change reaches every client
  that must stop seeing rows, and what a client may read offline — is
  [LLP 0053](./0053-authorization-invalidation.rfc.md)'s, split out of this
  document (§Permission dependencies). This document names no mechanism there;
  0053 has redesigned it six times. Universal incremental permission re-evaluation
  stays a non-goal in both.
- Hosted service-principal tokens (LLP 0042).
- Hosted/non-loopback deployment security and the client-page XSS posture —
  both unowned; session apps refuse plaintext non-loopback binds meanwhile.

## Acceptance

**Existing-surface closure (proves sessions are not decorative):** under
sessions, a hostile-local-origin page cannot read raw rows from
`/_snapback/api/data/{table}` with the ordinary admin bearer or any
browser-persisted console value, and cannot provision schema or functions
through `/app/ensure`; provisioning succeeds with `AdminWrite` authority.
Raw inspection succeeds only with an operator-plane-minted, memory-only
`AdminSecretRead` lease: it reads only explicitly named tables and only within
its row/byte budget; wildcard minting is refused, and the same lease fails for
another table, after expiry, and after either limit is exhausted. The root
minting authority never enters browser memory or storage.

**Provider flow:** request-code returns `{challengeId, expiresAt}` for every
accepted request (non-enumerating) and the code is readable only from the
operator-plane mailbox (`AdminWrite` plus `ImpersonationCapability`; no
credential, ordinary admin bearer, secret-read lease, wrong capability, and
hostile-origin reads fail;
entries vanish on consume, supersede, TTL, and reset; capacity cap holds);
codes are single-use and attempt-limited (`CODE_INVALID` uniformly;
`CODE_LOCKED` on exhaustion; `THROTTLED` on repeat); concurrent exchanges of
one challenge yield exactly one session and concurrent first-logins one user;
the per-user session cap revokes the oldest; a corrupt/missing keyring fails
closed and rotation keeps pre-rotation challenges verifiable for one TTL;
generated-interleaving traces over both state machines reach only pinned
outcomes — including N-2/N-3 reuse, lost-refresh-response, **a woken tab whose
scheduled refresh fires before custody reload** (must not revoke), and a woken
tab on the ordinary path (reload-and-retry, no wipe).

Every impersonation effect has a credential non-substitutability matrix:
mailbox access, `auth.mintSession`, `auth.rescueCollidingTable`, and host-ops
`function.run --as-user` / `--as-role` each reject an ordinary admin bearer,
every persisted console credential, an `AdminSecretRead` lease, and the
secret-read root minting authority when presented without the separate
`ImpersonationCapability`. The correct capability succeeds only in its declared
dev/test/demo profiles; every impersonation effect is refused on `prod`.

**Authority and handlers:** all handler kinds receive the same server-derived,
immutable `ctx.auth`; `authenticated` without a session fails `AUTH_REQUIRED`
before the handler runs on **both** modes; an `authenticated` cron entry is a
manifest-load error; a `public` function with an invalid bearer still errors;
negative write authorization per class (forged-owner insert, cross-user
update, scope-moving update, cross-user delete) yields
`AUTH_PERMISSION_DENIED` with no write, no commit-version advance, no leaked
row — including inside an action's HTTP-200 envelope; the
registry-metadata-driven sweep proves every `AppAuth`/`ConnectionAuth` route,
WebSocket operation, and the direct runner rejects client-auth-bearing fields
under sessions; a direct-runner query requires a live `AdminSecretRead` lease
covering every table its response can expose, while a mutation requires
`AdminWrite`; both project anonymous with an `adminBypass` audit fact and are
refused on `prod`.

**Mode and lifecycle:** `prod` + dev auth refuses app-data on every bind while
health serves; dev mode on a non-loopback bind is refused absent the override;
a mode change is staged, app-data is refused with `MODE_PENDING` while
`desired != active`, and the next startup consumes it pre-bind. During that
pending state, Public `attest` is also refused; only an explicitly privileged
`provision` request may correct or re-stage the pair, and it still completes the
closed-tuple/pair/capability preflight before hashes or effects. An unknown
`auth.mode` is a manifest-load error; **deploy tooling refuses a sessions
bundle for a session-less target, and the target itself refuses it at manifest
load** (both ends). Target capability output advertises the exact
`supportedArtifactVersions` and `supportedAuthModes` used by both checks.

The local artifact matrix proves the first-install boundary independently of
post-activation poison. A pinned actual, unmodified pre-auth predecessor runs in
its provisioning-allowed `dev` profile and is exercised from two snapshots: a
fresh database and a database already provisioned with the identical app content
as v0-dev. A complete `/app/ensure` containing v1 sessions schema, v1 functions,
and seed is refused with `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION` in both cases;
the exact diagnostic is asserted in addition to the no-change proof. The test
asserts the v1 `schemaHash`, `bundleHash`, and
`inputsHash` strings differ from their v0 counterparts, so the provisioned case
cannot return `matched` before header validation. Relative to each
immediately-before-request snapshot, the database/WAL image is byte-for-byte
unchanged, the logical schema and version are unchanged, no function generation
replaces, no desired mode is written, and no seed row appears. The auth-aware
binary positively accepts exactly v0-dev and paired-v1 sessions, then walks the
staged restart into authenticated execution. It rejects v0-sessions,
**v1-dev**, v0/v1 mixed pairs, missing initial halves, unknown versions,
unsupported mode/capability
facts, and insufficient privilege before any of those effects. Each auth-aware
refusal is repeated with schema/bundle/inputs hashes equal to the currently
loaded values, proving its hash shortcut cannot bypass preflight. Separately, a
Public `{ intent: "attest" }` request accepts only LLP 0012's closed identity
projection, reports match/mismatch without mutation, and rejects full manifests,
seed, or mode-stage material; `{ intent: "provision" }` requires `AdminWrite` or
pre-bind startup authority regardless of hash equality.

In the first-party Cloudflare handler-first mixed-version
window, a sessions handler refuses an old coordinator's absent/session-unaware
invocation marker before handler execution; current pairs succeed, rollback and
activation-delay traces never run a sessions handler under empty auth, and the
one-tree/two-Worker deployment fact is asserted rather than collapsed into one
artifact. Downgrade over real auth state fails `MODE_DOWNGRADE` and the override
deletes nothing, revokes every session, and leaves the relocated manifest plus
legacy poison permanently in place.

After sessions activation, a capability-aware binary reads the relocated key
and opens normally; the legacy key remains present with a sentinel that fails
typed `SchemaManifest` deserialization. A pinned actual pre-slice binary fails
database open with `SNAPBACK_SCHEMA_PARSE_FAILED`, binds no listener, and performs no
logical or durable mutation. A missing-legacy-key fixture is a negative control:
it demonstrates that relocation alone would fail open and therefore does **not**
satisfy the backstop. Crash injection before and after every transition write
commits only either the old parseable-key/dev state or the relocated-key +
poison/sessions state — never new-key + missing/parseable-legacy. The same
predecessor remains refused after `--allow-auth-downgrade`.

Given a dev/test database containing an unowned physical `_auth_*` table,
staging sessions fails pre-DDL with `SNAPBACK_AUTH_TABLE_COLLISION`. Without
`ImpersonationCapability`, and on `prod`, `auth.rescueCollidingTable` is refused
without mutation. With the capability, rescue transactionally copies schema and
rows into an operator-named non-reserved app table, drops only the source after a
successful copy, and leaves the source intact on every injected failure. The
next collision check and sessions activation succeed. The destructive
`--drop-orphaned-auth-tables` fallback is tested separately; app-level
rename/copy remains impossible. `_auth_*` in an app schema
is a load-time error; `_auth_*` writes produce no journal rows and no
commit-version advance; physical restore invalidates restored sessions and
regenerates the incarnation; GC sweeps challenges, sessions, and tombstones.

**Sync and permissions** (invalidation acceptance is
[LLP 0053](./0053-authorization-invalidation.rfc.md)'s; these are the rows this
slice owns, and they must hold jointly with 0053's no-regression pin):

- Unauthenticated subscribe to an auth-filtered query fails closed rather than
  receiving all rows.
- With only items 1–5 — including when independent item 7 has also landed — an
  authenticated auth-scoped subscribe/resume or protected-room registration is
  refused before registration with `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE`.
  Finite request/response and explicitly `authorityIndependent` live surfaces
  remain available.
- Item 7 proves two users receive different authorized results through fresh
  finite invocations and that its authority descriptor/two-axis queue rejects
  cross-authority replay. It makes no auth-scoped live claim.
- After item 6, two protocol-1 clients subscribed to the same logical query
  receive different authorized results — 0011's sharpest partial-sync proof and
  the card game's core mechanic. A missing/older client is refused before
  registration, and a legacy connected client is closed.
- `SNAPBACK_AUTH_USER_MISSING` behavior is unchanged for session-derived
  contexts (regression pin on the shipped fail-closed evaluation).
- Retained/offline reads are disabled under session mode until item 8's reviewed
  fail-closed retained-authorization outcome and durable client fence land. The
  handshake reports both availability and the minimum disposition/fence-aware
  client protocol; server and kit refuse session-mode retained subscriptions
  from absent, unknown, and too-old clients. Every retainable function declares
  `userId`-only authority dependence; a `sessionId`/`provider`-dependent function
  remains `Online`.
- On an items-1–5 build, online sessions work but the handshake reports queued
  replay unavailable, the client reports the mutation surface `Online`, new
  offline enqueue is refused, and a network sentinel proves pre-existing,
  anonymous, A→B, and same-user/new-session queues strand before any send. After
  item 7, queued replay becomes available only with the two-axis migration and
  descriptor enforcement on first delivery and duplicate settlement; absent,
  unknown-version, and mismatched descriptors are each refused.
- A session-scoped authorization change (logout, revocation) clears through the
  same `AuthCoordinator` barrier as a permission-epoch change — the two paths
  share one client mechanism, so a session invalidation cannot leave rows a
  permission invalidation would have cleared.
- Item 6's card-game kick closes both carriers: the durable board follows 0053's
  witnessed disposition/ACK path, while the `gameMembers` permission-backing
  event installs its dependency-indexed registry ticket atomically with
  enumeration, makes racing registration/snapshot publication either precede and
  join that set or observe pending, installs and quiesces each exact-ticket room
  barrier before commit, and generation-checks room mutation, enqueue, drain,
  and final send atomically with each act. It then fresh-snapshots membership and
  unregisters the denied player. Before item 6 the room capability remains
  refused; after item 6 no trace permits a kicked player to receive opponent room
  state.

**Sessions, connections, clearing:** expiry and logout produce
`SESSION_EXPIRED` on both paths (typed frame then close; reconnect suppressed;
deadline close fires under heartbeats); a swallowed close frame converges on
the next request; **two-phase revocation** proves no operation validates after
the pending-revoked marker publishes, a rolled-back revocation only ever
denies (fail-closed), and unrelated sessions stay responsive during a
revocation commit (L9 bounds hold). Generated interleavings cover two concurrent
revocation-class operations on one session with unique operation tickets: either
rollback can clear only its own marker, a committed sibling remains fenced, and
an outbox payload stamped under the old generation never drains. Rotation's
tombstone/index order never
honors a token before it durably exists; restart rebuild only under-extends;
`CREDENTIAL_SUPERSEDED` triggers reload-and-retry with no wipe; a **delayed
terminal error from session A after an A→B transition is a no-op**
(`compareAndClear`), and a delayed successful response, subscription callback,
optimistic reconciliation, or durable-write completion from A cannot repopulate
B; clearing removes optimistic overlays, not just rows;
connection binding proves token A cannot address connection B, a superseded
bearer cannot bind, a `previousToken` re-open under a different authority is
rejected, per-source opens refuse with `AUTH_THROTTLED`, and the shipped
16,384-entry pressure path still refuses with
`CONNECTION_GRANT_LIMIT_EXCEEDED` only after unused and idle-expired grants are
unavailable; live-socket liveness extends the session while
`/auth/refresh` alone does not. Over both HTTP and WebSocket, session-mode
publish/delete reject `auth`, `session_id`, `user_id`, and `custom_key`, including
explicit null; subscribe/unsubscribe reject `auth`, and their closed DTOs reject
injected unknown identity fields. Every permitted key mode derives solely from
bound authority, a missing authority dimension fails explicitly, cross-user
replace/delete fail for every permitted key mode, `KeyMode::Custom` fails manifest
load under sessions, and room-permission collections fail closed.

**Surface and hygiene:** a test app creates a profile row after first login and
an authorized query joins it (two-user); the bootstrap handshake precedes any
**online retained-data promotion/release**, resubscribe, auth-bearing request, or
connection open, while marked-stale offline cold boot remains permitted;
`GET /auth/session` returns the anonymous projection with HTTP 200. A
public-vs-gated projection sentinel following LLP 0031 D3 proves executable
source and diagnostic message/details remain gated, while separate planted
token, code, keyring, query-argument, receipt correlation/scope, identity-subject,
and config-value sentinels never appear on unauthorized/public surfaces (and
credentials never appear even on the gated twin). Every provider route enforces
its policy at runtime and the parity check covers them; provider routes on
dev-mode apps return the typed HTTP 404, while `GET /auth/session` remains the
HTTP-200 exception.

The proving demo is the card game — the slice LLP 0038 names as blocked on auth
— whose hidden-state mechanic is exactly the two-clients-different-results
acceptance. Item 7 may land and prove the finite form independently; the full
subscribed hidden-state and kick diary evidence lands only after both items 6
and 7.

## Open Questions

- Should the first external provider be OIDC, GitHub OAuth, Google OAuth, or a
  generic bring-your-own verified-token hook? Does `_auth_accounts` return with
  it, or does the identity merge hold?
- Are the 10 s grace window and the 7-day rotation cadence right, and does
  multi-tab custody need a shared worker beyond Web Locks in practice?
- Who writes the deployment-security contract (TLS, trusted-proxy source
  addressing, distributed throttling, multi-replica session invalidation) and
  the client-page XSS posture — extensions of LLP 0009, or new LLPs? Both want
  owners before landing item 5.
- Which other secret-adjacent gated reads (config status, parts of the gated
  inspect twin, receipts) should migrate to `AdminSecretRead` in the 0031
  revision?
- When cookies return, what is the full issuance/rotation/deletion and
  Origin/CSRF contract, including credential-establishing requests and
  absent-Origin rules?
- What does key-level authorization for `KeyMode::Custom` look like? Protected
  room-permission invalidation now closes with LLP 0053 item 6; custom entry
  ownership remains separate.
- Does email canonicalization need an IDNA/Unicode policy beyond
  trim/NFC/lowercase/length?
- Can the thief-vs-shared-custody ambiguity in refresh supersession be closed
  without stronger evidence than a bearer carries — a device/attempt
  identifier, or sender-binding the bearer to a non-extractable key (a
  DPoP/RFC 9449 shape, which is also the named trajectory for the unowned
  client-XSS posture)?

The remaining invalidation questions — structural proof for subject-scoped
suppression, non-user scope algebra, and hosted-coordinator parity — live in
[LLP 0053](./0053-authorization-invalidation.rfc.md) §Open Questions. Mutable
protected inputs and the 24-hour lease default/hard maximum are pinned, not open.

## Dated amendment: sessions asset-callback execution authority (2026-08-03)

Ruled by the author at decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`), resolving
`issues/20260731-0044-sessions-callback-authority.md` as its option (a):
sessions-mode asset lifecycle callbacks (LLP 0044) execute under a
**per-app scoped LLP 0055-style service principal named
`asset-callbacks`** — not under a minted user session, and not under a
new "server-scheduled execution as user X" authority class. No session
is counterfeited: the runner presents the service principal's scoped,
auditable grant, so "who ran this" stays explicit in receipts. Inside
the callback, `ctx.auth` projects the authority honestly per LLP 0053's
sealed closure — the callback context is explicitly distinguishable from
an interactive session (its `actorKind` names the service principal),
never ambiguous. Callback writes participate in
commit-time validation and can produce authorization events like any
mutation; no new LLP 0053 machinery is expected. The grant scoping and
lifecycle vocabulary is LLP 0055's (see its matching dated amendment).

**Implemented 2026-08-04.** The asset runner now resolves the per-app
principal and exact callback-mutation grant from the protected auth catalog,
projects `ctx.auth.actorKind = "asset-callbacks"` with no session id, and sends
the callback through the ordinary staged mutation, commit validation, receipt,
and client-mutation-ledger path. The asset work-completion receipt names the
service actor and exact grant. The sessions witness is
`tests/acceptance/asset-conformance-v1.mjs`.

## Dated amendment: agent authority and lifecycle (2026-07-16)

LLP 0055/0056 extend this frozen auth program without weakening its operator
plane. `Authorization` means an app-plane bearer: either the existing session
bearer or an agent scoped token. Scoped tokens are accepted only by generated
app-data invocation and `/connection/open`; host operations and lifecycle or
provisioning routes never resolve them. `servicePrincipal` connections bind
both durable authority `(actorUserId, credentialId, credentialGeneration,
grantId)` and carrier authority `(tokenId, connectionId)`, with deadline
`min(token, grant)`. Item-7 settlement compares the durable tuple and then
revalidates live authority; token churn ends only the carrier.

The user compromise surface is `POST /auth/sessions/revoke-all`: it revokes the
user's sessions, credentials for owned agents, and grants issued by the user.
The non-browser process carrier gains a distinct `AgentDestroyCapability` for
the production kill verbs; neither it nor impersonation authority can be
satisfied by the browser console credential. Declared restore revokes restored
credentials, tokens, and grants and purges invitations and pairing requests.
Sessions-to-dev downgrade does the same terminally, so re-enabling sessions
revives nothing. Pure grant/credential/token/principal endings are authority
transitions, not LLP 0053 authorization events; manifest activation remains
existing event 2.

The catalog marker is refuse-at-open from the first catalog-creating binary.
The item-7 descriptor gains the durable service-principal axes. For item 8,
`auth.kind` remains a pure function of immutable `userId`; `auth.actorKind`
and `auth.isDelegated` make a result retention-ineligible. Hosted
service-principal admission remains gated by LLP 0060, and hosted mutations
also require LLP 0019 F8's durable audit log.

## Dated amendment: operation-bound step-up (2026-07-15)

ENG-24913 G2 adds a narrow fresh-authentication projection without widening the
frozen provider protocol or pretending that production delivery exists:

- `POST /auth/step-up/request` is `SessionAuth`. Its closed request currently
  names `grantApproval` plus the exact pairing-request id. The server derives
  the canonical email address from the exact still-live session; callers cannot
  redirect delivery.
- The challenge uses the existing bounded `_auth_verification_codes` lifecycle
  and process-local capture mailbox, with a five-minute lifetime and the same
  five-attempt ceiling. Its HMAC has a distinct step-up domain and binds the
  canonical address, user, session id, session generation, authority-instance
  id, operation, and target. Ordinary login challenges and step-up challenges
  are therefore non-interchangeable despite sharing bounded storage.
- The protected operation carries `{challengeId, code}` as a redacted proof
  candidate. Verification, failed-attempt accounting, single-use
  `consumed_at_ms` CAS, and authority-creating grant creation share one SQLite
  transaction. A rollback consumes neither proof nor effect; concurrent use can
  create at most one grant. There is no boolean "step-up proven" trust seam and
  no second durable bearer registry. Time is sampled after the asynchronous
  admission waits, immediately before the durable effect. If SQLite loses the
  commit acknowledgement, the server reconciles the exact request, candidate
  grant, and challenge successor state; any mismatch fails unavailable with
  `SNAPBACK_AUTH_GRANT_COMMIT_UNCERTAIN` instead of guessing success.
- `authorityCreating` grant approval requires this proof; ordinary grant
  approval does not. The closed operation vocabulary can grow when the owner
  invitation, credential, and deactivation routes land, but those routes are
  not claimed by this checkpoint.
- Capture remains available only in `dev`, `test`, and `demo`. On `prod`,
  challenge creation returns
  `SNAPBACK_AUTH_STEP_UP_DELIVERY_UNAVAILABLE`; no capture fallback is exposed.
  LLP 0045's future ephemeral human-delivery adapter is the prerequisite for
  enabling this path in production, and plaintext codes remain forbidden from
  the durable notifications outbox.

This amendment implements only the non-production proof and
`authorityCreating` consent slice. LLP 0055's owner re-credentialing and
compromise-response cascade remain separate pending work.

## Status

**Draft — FROZEN by the author, 2026-07-13.** The dual-model refine loop ran to
its useful end and was stopped deliberately, not because the document is finished.
Read this before implementing.

**What the loop bought.** Twelve rounds; ~24 independent reviews across two model
families. The last three rounds returned **zero HIGH concerns**, and the final one
records: *"the architecture is sound, the settled core is implementable as written,
the seam to LLP 0053 is correctly drawn against 0053's actual text, and the
document's factual reliability is exceptional."* Every serious defect the loop
surfaced is fixed — the app-XSS → any-user privilege escalation; the ephemeral key
fail-open (two of three "safe" key modes were caller-controlled); the body-auth
rejection that would have **deleted** the live-subscription ownership guard; the
bundle-provenance hole that carried an attacker's `/app/ensure` code across the
mode boundary; a fencing rule that contradicted its own lock order; a
must-understand gate that did not exist; and two seam contradictions with LLP 0053.

**Why it stopped.** The loop reached an asymptote: MEDIUM/LOW findings held steady
at 4–8 per round without decreasing, and — the decisive signal — each round's list
was substantially composed of defects introduced by *the previous round's fixes*.
The author's judgment: a frozen Draft with an honest residual list is worth more
than a `Review` badge that must be continuously re-earned. The RFC-vs-spec altitude
was ratified separately (§Protocol obligations deferred to implementation).

**Focused gate reviewed and confirmed.** The ENG-24593 focused rounds first
closed the five carried LOWs
and their propagation debris. Two blind confirmations then reviewed exact SHA-256
`6a801ed0bee048b681a69b7aff0001a69e0a11db4e2e516c767bcb6e172c650a`.
Neither reopened the architecture. GPT found one HIGH enforcement hole: the
relocate-and-poison defense protected rollback only *after* activation, while a
fresh sessions artifact could reach a pre-auth binary with no discriminator that
binary already rejected. Fable found three MEDIUM stale-source facts: grant bounds
and their emitted code, the HTTP mapper baseline, and the current SHA-256 versus
legacy-FNV fingerprint split; it also found bounded Custom-key and scope/citation
edits.

The subsequent LLP 0053 seam reconciliation — including the shared activation
matrix and protected-room sink obligation — changes no 0039-owned authority
architecture. ENG-24592's focused exact confirmation completed READY in both
reviewer families and the author accepted LLP 0053; that separate transition does
not thaw this umbrella Draft.

The final bounded review then found four propagation defects in the operative
documents, not a new design: the separate capability dimensions accidentally left
v1-dev admissible; the actual-predecessor proof omitted its provisioning-allowed
profile and exact diagnostic; `MODE_PENDING` recovery named only a vague admin
surface; and the LLP 0053 seam incorrectly attributed its item-6 fence to item-5
custody/generation. This revision closes only those defects. The admissible tuple
set is now exactly v0-dev and v1-sessions, with every other tuple rejected before
hashes or effects. The predecessor proof runs the actual unmodified binary in its
`dev` profile and asserts `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION`. Privileged
`{ intent: "provision" }` is the sole pending-mode correction/re-stage branch;
ordinary attestation and app-data remain refused. Item 5 supplies the coordinator,
disposition execution, serialized clear barrier, and incarnation; LLP 0053 owns
its own item-6 fence. LLP 0053 is now Accepted after ENG-24592.

The exact post-review candidate — LLP 0039 SHA-256
`8ba5becada849cb1d074b17a5858134de807abe103d3f086047cfac751b893fc`
paired with LLP 0012 SHA-256
`ade9da47881828342fd591ff4d1bb1c0bff643c2f67b9fb086a987b56bf51170`
— then received blind focused READY verdicts from both GPT and Claude. Both
reviewers confirmed the four closures above, found no blocking issue, and said
ENG-24593 can close. Their reports are archived verbatim in
`reviews/0039-auth-vertical-slice.{codex,fable}.md`.

The former unnamed enforcement window is now closed explicitly: item 5 makes
sessions enableable while refusing auth-scoped live surfaces; item 6 unlocks
those surfaces; item 7 changes no admission state and remains independent.

The previously reviewed corrections remain intact: sessions schema **and**
function artifacts use the raw-value-disjoint `snapback.v1` discriminator; LLP
0012 registers the compatibility exception and optional-additive capability
facts; and acceptance separates first-install predecessor refusal from the
post-activation poison proof. The current
registry's 16,384-entry cap, pressure eviction, idle lease, and
`CONNECTION_GRANT_LIMIT_EXCEEDED` code are preserved; the mapper keeps both
shipped auth codes at 400 and unknown codes at 500; the fingerprint baseline is
tagged SHA-256 with FNV as a deletion-only quarantined alias; Custom keys are
described as connection-owned with first-writer/durability residuals; and the
reserved-prefix/Cloudflare/amendment wording matches source.

The document remains **Draft / FROZEN by the author** after the review gate.
ENG-24593 did not authorize an acceptance transition, and neither reviewer
accepted on the author's behalf. The completed gate removes the five LOW
residuals and their bounded propagation defects. ENG-24592 subsequently accepted
LLP 0053 after its separate two-family gate; that does not change 0039's own
Draft/FROZEN status.

**Standing residuals — properties, not bugs to be fixed later.** An active
app-page XSS can steal an in-memory `AdminSecretRead` lease for its remaining TTL,
named-table scope, and unused row/byte budget. The dev-mode loopback fence protects
un-proxied defaults, not proxied opt-ins. Hosted deployment security and the
client-page XSS posture remain blocking companion contracts rather than guarantees
made by this RFC.

## Changelog

- **2026-07-13 (ENG-24592 focused exact confirmation; LLP 0053 Accepted).**
  Rebased the already-reviewed ENG-24593 corpus with the final 0053 enforcement
  seam, corrected live item-6 quarantine versus item-8 retained/offline scope,
  and mirrored the precommit protected-room ticket/barrier/quiescence contract
  into LLP 0013. Codex round 7 and Fable round 8 independently returned READY on
  the exact operative hashes with no blocker. Under ENG-24592's explicit author
  authorization, LLP 0053 moved Draft → Review → Accepted. This umbrella remains
  Draft/FROZEN; only the item-6/item-8 review blocker was removed.
- **2026-07-13 (ENG-24593 post-review bounded corrections; focused exact
  confirmation complete).** Closed the clean-confirmation first-install HIGH by
  requiring raw-value-disjoint, domain-separated `snapback.v1` identities on
  both sessions artifacts, registering the exact LLP 0012 compatibility and
  optional-additive capability facts, splitting `/app/ensure` into a closed
  identity-only Public attestation DTO and privileged provisioning DTO, and
  moving complete intent/branch-authorization/version/mode/pair/capability
  preflight ahead of hash shortcuts and every effect. The final bounded review
  closed the tuple to exactly v0-dev and v1-sessions, added v1-dev to every
  negative/acceptance matrix, and made the capability dimensions explicitly
  non-Cartesian. It pinned the actual unmodified predecessor to its
  provisioning-allowed `dev` profile and required the exact
  `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION` result as well as no change for both
  fresh and identical-content provisioned-v0 databases. It made privileged
  `{ intent: "provision" }` the sole correction/re-stage branch during
  `MODE_PENDING`, with ordinary attestation and app-data refused. It corrected
  LLP 0053 provenance: item 5 supplies coordinator/disposition execution/clear
  serialization/incarnation, while 0053 owns its item-6 fence and remains
  Draft/FROZEN until ENG-24592 closes. The revision keeps
  relocate-and-poison as the distinct post-activation defense. Reconciled the
  source audit without changing architecture: preserved
  the shipped 16,384-entry grant cap/pressure/idle behavior and diagnostic;
  retained the 400 status of both shipped auth codes and the 500 unknown-code
  default; corrected current SHA-256 versus legacy FNV quarantine semantics;
  restated Custom-key residuals against ENG-24353; mirrored `_auth_*` across the
  actual codegen/storage prefix scopes; included Cloudflare `inputs_hash`; and
  clarified the two owning-document amendments. The exact operative pair then
  received independent READY verdicts from GPT and Claude with no blocking
  findings. Status remains Draft/FROZEN by the author; the gate did not
  authorize an acceptance transition.
- **2026-07-13 (ENG-24593 focused correction; confirmation pending).** Closed the
  five carried LOWs and propagated the focused-review findings without moving the
  frozen Draft. Pinned the item-5→7 behavior as online-only sessions with queued
  replay disabled; kept `MODE_DEV` as typed HTTP 404; separated route policy,
  credential resolution, invocation authority, effect policy, legacy-body, and
  response-sensitivity axes; made `Retainable ⇒ userId-only` categorical; tightened
  the 0031/0043/0051 provenance; and added actual-predecessor, missing-key,
  crash-boundary, and permanent-poison downgrade acceptance. Replaced the vague
  console token with an operator-plane-minted, in-memory-only, named-table,
  row/byte-bounded `AdminSecretRead` lease whose root minting authority never enters
  the browser; completed transactional collision-rescue acceptance; corrected the
  per-operation ephemeral field set; and replaced the false Cloudflare
  one-artifact claim with the real handler-first two-Worker deployment plus a
  must-understand coordinator invocation marker. The current `PublicInspect` typed
  projection is now stated as a shipped baseline protected by projection and
  secret-redaction sentinels, not described as a current raw-message leak. A blind
  confirmation then found four bounded propagation/source-fact defects: this
  revision assigns rescue and ephemeral closure to landing items 3/4, adds the
  all-impersonation credential non-substitutability matrix, and corrects the
  hosted initialization-order and `SchemaManifest` serde claims.
- **2026-07-13 (independent local-audit correction; still FROZEN).** Closed the
  item-5/item-7 enforcement-window contradiction with the shared activation
  matrix: sessions may activate after item 5, auth-scoped live remains refused
  until item 6, item 7 changes no admission state, and retained/offline reads
  wait for item 8. Recast item 7's independent proof as finite invocation plus
  replay isolation and deferred the subscribed card-game proof until both items
  6 and 7. Mirrored 0053's exact-ticket, precommit protected-room barrier and
  dependency-indexed registration/snapshot/mutation/enqueue/drain/send sink
  requirement. These fixes are unreviewed; no status transition.
- **2026-07-13 (LLP 0053 paired-confirmation seam only).** Reflected the
  bounded post-review contract without changing 0039-owned authority/session
  architecture: item 6 now includes `permissionBacking` projection into
  protected-room suspension and fresh membership reauthorization; the proving
  demo's kick must close both durable and ephemeral carriers; root/0008/0011/
  0013 dated amendments are companion obligations; the stale mutable-input and
  lease-number questions are removed; AuthorizedLease now has a 24-hour default
  and hard maximum; authenticated boot/retry details remain 0053's; and item 7's
  authority descriptor is only an optional additional equality axis for item 6.
  Both RFCs remain Draft/FROZEN.
- **2026-07-13 (LLP 0053 gate seam only).** Mirrored the gate's precise
  distinction between ordinary-write delivery obligations and coarse
  authorization-event resync, and reconciled restart wording: incarnation
  persistence avoids an unsolicited retained-data clear, while a later live
  resumption still fresh-snapshots. Updated item 6 from "unreviewed fixes" to the
  actual NOT READY gate plus pending confirmation, and removed rejected
  classification/pinned-lease questions from the hand-off. No 0039-owned auth
  architecture changed.
- **2026-07-13 (rounds 11–12; FROZEN).** Three consecutive rounds at **zero HIGH**.
  Round 12's findings were two-thirds *the previous round's own debris*, which is
  what identified the asymptote and ended the loop. Fixed: a **factual error** —
  `PublicInspect` is served on the **`Public`** routes `/inspect` and `/`, tokenless
  on *any* bind, not `AdminRead` on loopback. Its typed `PublicDiagnostic`
  projection already strips free-form message/details; the globally public
  projection is therefore the response-sensitivity regression boundary, not a
  current raw-message leak. The **console read-token residual** became a
  landing-item deliverable rather than impossible advice: an earlier draft told
  operators not to serve console and app from one origin, which the shipped server
  **always** does — so the console now takes a short-lived derived token instead of
  persisting a durable master read key in `localStorage`. Also: the
  catalog-collision recovery reconciled with the (absolute, no-exemption)
  reservation — the rescue verb reads *below* `ctx.db` and manifest validation,
  which is the only way the recovery is executable at all; the dev-mode
  `authorityInstanceId` keyed to the incarnation so a `cargo run` no longer strands
  queued mutations; the LAN fence's own escape hatch named honestly (the 0030 proxy
  re-exposes client-asserted auth — the fence protects un-proxied defaults, not
  proxied opt-ins); and `MODE_PENDING`/`MODE_DEV` given HTTP mappings.
- **2026-07-12 (rounds 9–10 + joint consistency pass).** Reached **zero HIGH** at
  the author-ratified RFC altitude in round 9, then closed two more in round 10 —
  including an **ephemeral key fail-open**: the shipped resolver prefers the
  caller's `session_id`/`user_id` *sibling wire fields* over the auth context, so
  rejecting only `auth` would have left `KeyMode::Session` and `KeyMode::User` —
  two of the three modes this document *declares safe* — fully caller-controlled,
  reproducing the exact cross-user hole `KeyMode::Custom` is banned to prevent.
  (This document's own rule caught it: *rejection must be paired with a replacement
  predicate, or it opens the hole it closes* — stated for the live path two rounds
  earlier and not applied here.) Also: session loss now **deletes** as 0039's own
  decision (one behavior, replacing three); the `requiredCapabilities` overclaim
  replaced with a mechanism that binds **today's** binaries (relocate the manifest
  key; poison the legacy one, so a pre-slice binary fails closed at parse); the
  mailbox gate corrected everywhere (one surviving sentence still said
  `AdminSecretRead` — the escalation this document calls its worst error); and the
  seam now states **outcomes only, naming no mechanism**, because 0053 has been
  redesigned six times and every mechanism named here went stale.
  The **joint consistency pass** then found two defects no single-document review
  could have: 0053's event 4 claimed this document's *session* revocation called
  into it — conflating an **authority transition** (identity ends → delete) with an
  **authorization event** (permission narrows → quarantine) — and the disposition
  enum was owned by neither document while item 5 required it, which would have
  silently falsified the landing-independence claim for the second time. Both fixed;
  items 1–5 and 7 re-verified to depend on **no** 0053 deliverable.
- **2026-07-12 (round 7, post-split).** Fixed five fail-open traps the round-5/6
  revisions had created, plus a claim that falsified the split's own premise.
  **The split's promise is restored:** the authorization-stream **incarnation**
  moves from LLP 0053 to this document (items 3–5 depended on it, so the "settled
  core lands independently" claim was false as written); it is an authority-stream
  anchor, persists across ordinary restarts, and regenerates only on
  reset/import/declared restore — 0053 now consumes it.
  **Privilege escalation closed:** the mailbox and `auth.mintSession` made the
  admin token a universal impersonation credential while the shipped console
  keeps that token in browser-readable `localStorage` on the server's origin — so
  session-minting effects now require a distinct impersonation capability
  (0600 keyring / CLI), and the console never displays login codes.
  **Ownership guard preserved:** rejecting body auth on the live path would have
  deleted the only fields the shipped resume/unsubscribe guard compares (it
  short-circuits when they are empty), so subscriptions now record their
  server-resolved authority **and** connection grant, with anonymous compared on
  the grant. **Bundle provenance attested:** "persisted across the restart" is
  deleted — it would have carried a bundle installed through the still-Public
  `/app/ensure` into the session trust domain; the staged transition now pins the
  expected bundle hash and the pre-bind consume verifies it. **Fencing corrected:**
  the effect boundary is the **drain**, not the enqueue (live deltas are produced
  inside the global write lock, so the previous rule contradicted this document's
  own lock order); the payload carries the fencing generation, the
  projection→`EphemeralApi` wiring is an item-5 deliverable, the close bound is 5
  seconds, markers get unique per-operation tokens, and the guarantee is stated
  honestly as **non-delivery, not non-computation**. **Must-understand gate
  corrected:** the claimed version-rejection does not exist (the Cloudflare
  validator ignores unknown metadata and fails *open*); replaced with the true
  deploy-channel argument. ENG-24593 later corrected that argument's
  one-artifact factual error: one tree produces two sequentially deployed Workers,
  so the receiver-side invocation marker above is load-bearing. Also: the
  **direct function runner** named as
  the third "sessions are decorative" surface and folded into item 2; a
  **response-sensitivity audit** made a prerequisite (receipts and inspect
  diagnostics leak the same rows the raw-table closure blocks); **verify-and-consume
  in one transaction** (0011's outside-the-lock pin is about Argon2, not a
  microsecond HMAC — the race was self-inflicted); an **activation gate** (sessions
  not enableable before items 1–5); the coordinator takes a disposition from day
  one; and the offline-capability cost stated in §Summary.
- **2026-07-12 (split).** On Charlie's authorization, **authorization
  invalidation split out to [LLP 0053](./0053-authorization-invalidation.rfc.md)**
  — the dependency classification model, authorization epochs,
  `resync_required` dispositions, and the retained/offline authorization
  contract. Both reviewer families recommended this across multiple rounds: the
  mechanism failed three successive design attempts while the rest of the
  document settled, and the umbrella had grown past the point where its own
  contradictions were detectable. 0039 keeps the settled core and remains the
  umbrella owning the landing order for both; §Permission dependencies becomes
  the seam, naming the invariants this slice depends on from 0053. Landing
  items 6 and 8 are now 0053's, and item 7 is independent of them — so the
  settled core can land and be proven while 0053 is reviewed. LLP 0020's
  §Remaining Phase 4 open thread ("dependency vocabulary and auth epochs") now
  has an owner.
- **2026-07-12 (round 6 — terminal for the refine loop).** Fixed every defect
  round 6 verified, including three the round-5 revision had introduced.
  **Authorization invalidation:** replaced the two-class lint — which could
  not classify the proving demo's membership-gated shared tables without
  either a staleness false negative or an epoch-per-move storm — with a
  **four-class model** (row-scoped / permission-backing / membership-gated via
  declared `permissionDependencies` / authority-independent), defined
  "auth-scoped function" and the subscription-to-scope attachment rule,
  resolved the suppression self-contradiction (declarations **narrow, never
  suppress** in v1), added an L4-style convergence assertion to catch lying
  class-(a) declarations, and corrected the false "exactly 0008's analyzable
  subset" appositive. **Clearing:** `clear_retained` becomes a monotone
  `retain < quarantine < delete` disposition that sticky-ORs on queue collapse
  — the round-5 boolean would have let an outbox overflow **erase a queued
  authorization revocation**. **Bootstrap:** `/auth/session` is exempt from the
  dev-mode refusal, returns `{activeMode, desiredMode, modeState}`, and gates
  only *online* interactions, so LLP 0043's shipped offline cold boot still
  works. **Activation:** the `/app/ensure` privilege gate is evaluated against
  `(requested, active, desired)` mode before any payload applies (otherwise
  staging sessions was itself an unprivileged hole), cold-start bundle loading
  is owned, and staged transitions gain non-destructive unstage, stage-time
  collision pre-check, and consume-failure semantics so no instance wedges.
  **Must-understand:** enforcement becomes structural (a deployment-metadata
  version bump legacy receivers already reject) and must precede any durable
  mutation on the target. **Restore:** restated honestly as an operator-declared
  procedure with the undeclared-restore residual named — no in-directory anchor
  can detect a restore of the whole instance directory. **Revocation:** markers
  carry fencing identities (compare-and-unmark) and fencing extends to the
  effect boundary and outbound deltas, not just the check. **Client barrier:**
  authority-epoch compare-and-commit guards every write into client state, not
  just terminal errors, since a delayed *success* can repopulate wiped data.
  Also: the refresh-family takeover hole named with partial mitigations and an
  open question; retained-scope caveat named; baseline corrections (the
  loopback fence is new work, not shipped behavior; the demos' ordered/Ibex
  queries fall back to `live_replace`, not DK-3 deltas).
- **2026-07-12 (round 5).** Fixed the round-4 defect both reviewer families
  independently flagged first: the derived auth-relevant floor made every
  ordinary write in the todo and card-game demos a global resync with
  synchronous clearing, contradicting the section's own premise and regressing
  the shipped matcher/DK-3 path. Replaced coarse-always with a **load-time
  classification lint** (every table an auth-scoped function reads is either
  row-scope-mediated or `permissionBacking`, or manifest load fails);
  `authScopeField` keeps its narrow disjointness meaning and ACL dependence
  moves to `permissionDependencies`. Also: closed the existing session
  bypasses (`/_snapback/api/data/{table}` raw rows, public `/app/ensure`
  bundle-load); receiver-side must-understand enforcement (and corrected the
  Cloudflare failure mode — empty-auth/unscoped, not client-asserted);
  app-data refused while `desired != active` plus a bootstrap handshake;
  fail-closed two-phase revocation replacing lock-across-commit, extended to
  rotation; a two-axis client store (principal/data vs authority-instance/
  queue) with the descriptor-required predicate; a client `AuthCoordinator`
  with `compareAndClear` that also removes optimistic overlays; server-side
  `clear_retained` emission semantics; `KeyMode::Custom` rejected under
  sessions; read-custody-before-refresh; auth codes barred from durable 0045
  intents; `app.reset` → grant-registry wiring owned; sliding-expiry "use"
  defined; physical-restore session posture; citation batch; history moved
  here.
- **2026-07-12 (round 4).** Coarse epochs never suppressed by declarations;
  staged desired→active mode; `auth.mode` as a must-understand field with a v1
  target-scope rule; `AUTH_CREDENTIAL_SUPERSEDED` with reload-and-retry-once;
  descriptor simplified to an opaque `authorityInstanceId`; invocation-policy
  matrix with pinned `adminBypass` semantics; executable collision recovery;
  session-projection linearization; mode-dependent ephemeral DTOs;
  `auth.mintSession` provenance; per-user session cap; kit rotation cadence;
  domain-separated code HMACs; Landing order and companion obligations.
- **2026-07-12 (rounds 1–3).** Authority resolution and the legacy
  body-`AuthInput` migration; connection binding at `POST /connection/open`;
  challenge/code and session state machines with keyed digests and token-family
  tombstones; `_auth_*` reservation, catalog, and keyring; typed
  permission-scope authoring over an unprefixed subject vocabulary;
  `authRequirement` enforcement; fail-closed clearing and the
  authority-transition matrix; diagnostics and route tables with
  `SessionAuth`/`AdminSecretRead`; host-ops-only impersonation; memory-only
  grant leases with deadline expiry; durable incarnation-scoped epochs;
  bearer-only transport.
- **2026-07-07.** Cross-family review revisions ratified by Charlie
  (`reviews/0039-auth-vertical-slice.claude.md`): connection-namespace
  ownership, 0011 alignment on `roles`/accounts/user-switch, provisioning and
  redaction constraints restated, acceptance expanded. Same day: connection
  section corrected against post-0038 code — the transport-level
  `connectionToken` guard had already shipped; this slice binds it to
  principals. Initial draft same day.
