# LLP 0094: Wire envelope contract (LLP 0093 rollout P-0)

**Type:** Spec
**Status:** Draft
**Systems:** Wire Protocol, Realtime, Live Queries, Client SDK, HTTP surface, Cloudflare arm, Schema governance
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-25
**Revised:** 2026-07-25 (initial draft; §0D receipt typing and §0A.4 hosted
route migration implemented with this draft); 2026-07-25 (§0A.5 drain
response contract and §0E live-ownership code scope, from the P-2 Swift
clean-room defect ledger); 2026-07-25 (v0.2, review-round-1 resolutions,
dual-family NOT READY: corrected the hosted kit-socket WS-kinds row and
reconciled it with LLP 0091; added the §0A.0 route-domain rule, proof-route
rows, §0A.6 dev-mode posture, §0C.6 response-shape divergence ledger;
decided re-open binding immutability, the socket offer-classification
matrix with per-stage enforcement, the B1 `wireVersion` response echo
(closes former OQ2), and the pinned §0B.6 decode-class signal; §0F item 2
restated; §0B.7 populations refreshed with the Swift client; citations
re-pinned at `137dee8c`); 2026-07-25 (v0.3, review-round-2 resolutions,
dual-family NOT READY on v0.2, all concerns in-delta: hosted in-band
subscribe **reply** grammar stated as served (mixed proof/kit dialect,
`type: "snapshot"`/`type: "error"` on non-resume and error paths),
decided out of v1 conformance claimability until converged and ledgered
(§0A.1, §0C.6 item 6, §0F item 2); §0B.3 re-open matrix (lineage ×
offer × stage) with echo-witnesses-explicit-binding semantics and
classification-before-equality precedence; §0B.4 predicate rewritten
(bearer exclusion, `snapback.v` prefix candidates, precedence order);
`/app/ensure` closure corrected to closed (it was misclassified open in
v0.2); §0C.6 extended to the full audited error-emitter set
(`requestDiagnostic`, gateway refusals, `platformFailureResponse`);
session-socket schema gap owned in §0F item 4; §0C.5 citation fixed;
decisions log added); 2026-07-26 (Partitime clean-room corrections:
connection-bound session authority, casing exceptions, supersession
witnesses, and refusal/status registry)
**Related:** LLP 0013, LLP 0031, LLP 0034, LLP 0043, LLP 0049, LLP 0051,
LLP 0053, LLP 0059, LLP 0060, LLP 0064, LLP 0077, LLP 0090, LLP 0091,
LLP 0092, LLP 0093

## Summary

This is the **P-0 cluster** of LLP 0093 (the client-protocol RFC): the wire
envelope contract, at the same byte-and-symbol precision LLP 0091 set for
the RQS wire. It pins, as normative contract:

- **§0A** — the **arm × route matrix** for the client-visible app-data
  surface (domain rule in §0A.0), the admin/testing seams per arm, the
  **dev-mode posture** (§0A.6, the named section LLP 0093 D1 requires),
  and the executed migration of the hosted arm's root-level system routes
  under `/_snapback/*` (LLP 0093 former OQ6, decided 2026-07-25: migrate,
  no LLP 0031 exception).
- **§0B** — the **wire-version negotiation mechanics** LLP 0093 D1
  directs: the socket-lane offer requirement on both arms, the
  `/connection/open` `wireVersion` body field with its pinned offer
  matrix, the staged bootstrap, client-side legacy-server detection, and
  the recorded blast-radius checks.
- **§0C** — the audited **per-family DTO closure matrix**, both
  directions, with a decided open/closed posture per family, the
  `authInvalidationProtocol` unknown-value asymmetry decided rather than
  inherited, and the **hosted response-shape divergence ledger** (§0C.6):
  the audited places where served hosted bytes do not satisfy the
  committed schemas, held as defects, not renegotiated contract.
- **§0D** — the **subscription-receipt typing**:
  `LiveSubscribeOutput.receipt` / `LiveUnsubscribeOutput.receipt` from
  `Option<Value>` to `Option<Receipt>`, schemas regenerated in the same
  change (implemented with this draft).
- **§0E** — the new **`SNAPBACK_*` refusal codes** for negotiation
  refusals.
- **§0F** — the inventory of **remaining hand-mirrored frames** under LLP
  0051 §D4, with what this cluster brings under the schema drift gates
  and what is ticketed follow-up.

Authority and precedence are LLP 0093 D1's, restated once: the serde
implementations are ground truth; the generated schemas in `schemas/` are
their authoritative machine view; the fixture corpus (P-1) is normative
for clients; the exact wire-shape tests are illustrative; prose loses to
all of them. One qualification that rule always implied and this revision
makes explicit: on the **hosted** arm several kit routes compose their
bytes in JS (`cloudflare/src/coordinator.js`), so the serde/schema chain
describes the *contract target* there, not automatically the served
bytes; every audited place where served hosted bytes fall short of the
schemas is enumerated in §0C.6 and tracked as a defect. Citations below
are file + symbol, line numbers as courtesy, pinned against origin/main
`137dee8c`.

## 0A — Arm × route matrix

The two served arms are **local** (`src/server.rs` router, built from the
LLP 0031 route registry) and **hosted** (the Cloudflare gateway Worker
`cloudflare/src/gateway.js` fronting the coordinator Durable Object
`cloudflare/src/coordinator.js`).

### 0A.0 Route domain and the absence rule

The matrix is normative **within its route domain**: the client-visible
app-data and connection surface (§0A.1) plus the enumerated system seams
(§0A.2/§0A.3). Within that domain, a route absent from an arm's column is
**not served** on that arm, and a client MUST NOT infer a route's
presence from the other arm. Two surfaces are inside the domain but
**incorporated by reference**, and reference is not absence: the local
arm's full `/_snapback/*` system surface (LLP 0031's matrix, §0A.2) and
the LLP 0040 hosted proof surface (its rows below are presence markers;
its frozen message protocol is specified by LLP 0040, not here). "Conn"
means the LLP 0031 `ConnectionAuth` policy (the
`x-snapback-connection-token` header, with the transport carriers of LLP
0031 §Connection capability grants).

### 0A.1 App-data routes (root)

| Route | Method | Auth | Local arm | Hosted arm |
| --- | --- | --- | --- | --- |
| `/` (instance status) | GET | Public | typed public projection (LLP 0031 D3) | not served (asset fallback / 404) |
| `/health` | GET | Public | public metadata + server-binary identity (LLP 0031 §Server-binary identity) | public metadata + deployment identity (`coordinator.js` `route` `/health`) |
| `/inspect` | GET | Public | typed public identity projection (`inspect.public.schema.json`) | **capability manifest** (`gateway.js` — same payload as `/capability`; a different shape from the local `/inspect`) |
| `/capability` | GET | Public | not served under this name (the manifest rides `/inspect`/`/`) | capability manifest (`capability.manifest.schema.json`) |
| `/connection/open` | POST | Public credential; `auth/rr` offer required in sessions mode (grants, never exercises) | closed DTO `OpenConnectionRequest` (`src/server.rs:4081-4094`) | open decoder `kitOpenConnection` (`coordinator.js:4196`) — see §0C.3 |
| `/query/{name}` | POST | app auth (mode-dependent, LLP 0031 matrix) | served | served (`kitQuery`) |
| `/mutation/{name}` | POST | app auth | served | served (`kitMutation`) — response bytes currently diverge from `mutation.output.schema.json` (§0C.6 item 1) |
| `/action/{name}` | POST | app auth | served | served (`executeAction`) |
| `/query/{name}/authorized-lease` | POST | sessions-mode resolved caller + exact protocol offers (LLP 0043/0053) | served | **not served** (hosted auth profile gap) |
| `/client-mutations/acknowledge` | POST | app auth + authority descriptor | served | **not served** |
| `/live/{name}/subscribe` | POST | Conn grant (`Authorization` bearer ignored after open) | served; open decoder body (§0C) | served (`kitSubscribe`); **refuses without a current socket session** (`SNAPBACK_CONNECTION_SOCKET_REQUIRED`, HTTP **409** on this arm — `coordinator.js` `kitSubscribe`/`kitUnsubscribe` guards) |
| `/live/{name}/unsubscribe` | POST | Conn grant (bearer ignored) | served | served (`kitUnsubscribe`) — response bytes currently diverge from `live.unsubscribe.output.schema.json` (§0C.6 item 2) |
| `/live/{name}/resume` (reattach) | POST | Conn grant (bearer ignored) | served (LLP 0090 keeps it; no first-party caller) | **not served** (gateway forwards `subscribe\|unsubscribe` only — `KIT_ROUTE`, `gateway.js:67`) |
| `/live/{connection_id}/stream` | GET (WS upgrade) | Conn grant (header or `snapback.connection-token.<token>` subprotocol; never URL; bearer does not replace bound authority) | served (`stream_live`) | served (`acceptKitSocket`) |
| `/outbox/{connection_id}` | GET | Conn grant (bearer ignored) | leased-batch drain (LLP 0059 ownership cut; response shape §0A.5) | grant-verified, **declared-empty batch** (`coordinator.js` kit outbox arm; `http_outbox_poll_fallback` is a manifest gap) |
| `/live/authorization-invalidation/acknowledge`, `/manual-retry` | POST | Conn + exact negotiated invalidation protocol | served | **not served** |
| `/ephemeral/publish`, `/subscribe`, `/delete` | POST | Conn | served (LLP 0013) | **not served** (`ephemeral_realtime` manifest gap) |
| `/ephemeral/collections/ensure` | POST | Public (validate-only, identity-free) | served | **not served** |
| WS message kinds on the kit stream | — | bound socket (LLP 0031 operation registry) | the `type`-tagged `LiveSocketClientMessage` family: `ephemeral_subscribe\|ephemeral_publish\|ephemeral_delete\|ephemeral_unsubscribe\|ping` (registry operation names prefix-map these; `ping` registers as `live_ping`); **no in-band durable subscribe/unsubscribe** — durable lifecycle is HTTP-only on this arm | request grammar `subscribe\|unsubscribe\|ping` (`webSocketMessage` → `validateLiveSocketFrame`, `coordinator.js`); **no ephemeral kinds**. Reply grammar as served is **mixed-dialect**: ping → kit `kind: "pong"` with `requestId` echo; subscribe with `resumeFromToken` answering rung 1 → kit `kind: "current_as_of"` (the one LLP 0091 step-5-contracted reply); plain subscribe → **proof-dialect** `{type: "snapshot", subscriptionId, function, version, rows, connectionKey}`; every error → proof-dialect `{type: "error", code, …}`; unsubscribe → session-scoped delete, **no reply frame**. Decision (v0.3): the in-band durable **request** surface is recorded as served; its **reply** grammar is **not conformance-claimable wire v1** until converged to kit dialect (§0C.6 item 6 ledger + ticket). The v1 conformant durable entry point on this arm is HTTP subscribe/unsubscribe with a current socket session; no first-party client sends in-band durable frames |
| `/app/ensure` | POST | LLP 0012/0031 intent family | intent family (attest/provision/legacy) | deploy-identity compare + seed-if-empty (`kitEnsureApp`) — provisioning is compile-time |
| `/app/bundle` | POST | LLP 0031 dated amendment (0090) | read + register modes | **read mode only** (register deferred, LLP 0092 step-4 amendment) |
| `/query`, `/mutation` (root, un-named) | POST | LLP 0040 proof protocol | not served | served (`handleQuery`/`handleMutation`, `coordinator.js`; gateway forwards) — **LLP 0040 pinned proof surface, outside wire v1**; presence recorded per §0A.0, protocol specified by LLP 0040 |
| `/live/stream` (proof socket) | GET (WS upgrade) | LLP 0040 proof protocol | not served | served (`acceptLiveSocket`) — same LLP 0040 proof surface, outside wire v1; exempt from §0B.4 |

Consequences already pinned by LLP 0093 and restated as matrix facts, not
renegotiated: the poll lane is local-arm-only in v1 (`poll/hosted` is not
a claimable conformance tuple); reattach is local-arm-only; the hosted
recovery lane is reconnect-resubscribe only (D3.2a).

For every `Conn` row, the grant is both capability and credential. In
sessions mode its authority was resolved once when the connection opened.
Adding, removing, or changing an `Authorization` bearer on a later
connection-scoped request does not change that authority. A user/session
identity change therefore requires a fresh `/connection/open`; reusing the
old grant continues to serve the old identity by design.

### 0A.2 Local-arm system seams (already `/_snapback/*`)

The local arm's admin/testing seams a client-side test author needs are
LLP 0031's rows; the deterministic cron seams called out by LLP 0093 D3.1
are `POST /_snapback/api/cron/tick` and `POST /_snapback/api/cron/{name}/run`
(`src/admin.rs`, AdminWrite). The full local system surface is LLP 0031's
matrix and is not restated here.

### 0A.3 Hosted-arm system seams (migrated under `/_snapback/*`)

Executed with this spec (former LLP 0093 OQ6;
`issues/closed/20260725-hosted-root-system-routes-migration.md`). The
audit enumerated the gateway's actual route set at `6fe11376`; the full
class was seven route families, each keeping its **existing auth gate**
unchanged — the migration moves paths, never authority:

| Old root route | New route | Gate (unchanged) |
| --- | --- | --- |
| `POST /cron/run` | `POST /_snapback/api/cron/run` | admin token (`adminGated`, `x-snapback-admin-token`) |
| `GET /cron/status` | `GET /_snapback/api/cron/status` | public bounded typed projection; admin token escalates to scrubbed operator detail (`cronStatus`) |
| `GET\|POST /config/status` | `GET /_snapback/api/config/status` | admin token, read (`adminReadGated`) |
| `POST /reset` | `POST /_snapback/api/app/reset` | admin token (`adminGated`), destructive, mutex-serialized |
| `POST /evict` | `POST /_snapback/api/object/evict` | admin token (`adminGated`) |
| `POST /host-call` | `POST /_snapback/host-call` | per-invocation host-call token (`x-snapback-host-token`); the handler-isolate re-entrant seam, not an admin API |
| `POST /__test/*` (22 operations at `6fe11376`) | `POST /_snapback/test/*` (same suffixes) | `SNAPBACK_TESTING=1` (`testingGated`); categorically absent from production deploys |

Naming follows LLP 0031 D5 (`subsystem/verb`, flat, inside
`/_snapback/api/*`) where the operation is admin-model-gated;
`/_snapback/host-call` and `/_snapback/test/*` sit inside the reserved
namespace but outside `/api/` because their gates are, respectively, the
per-invocation host-call capability and the testing profile — neither is
the admin authorization model, and parking them under `/api/` would
misstate the gate. **No root aliases were kept**: every consumer is
in-repo (the Cloudflare suites, `deploy.sh`, `config-set.mjs`, the shared
handler harness) and was repointed in the same change. The hosted
`/host-call` path is shared with the local workerd harness
(`packages/snapback-harness/workerd/handler-server.mjs` →
`http://snapback-host/_snapback/host-call`), so the local private
loopback listener (`src/workerd_exec.rs`) accepts the same path — one
seam, one path, both arms. The shared Cloudflare deployment still serves
the old paths until redeploy (recorded in the closed ticket; redeploy
needs fleet coordination).

The corresponding LLP 0031 route-taxonomy entries land as that spec's
dated amendment (2026-07-25) in this change.

### 0A.4 Matrix maintenance rule

A new client-visible route joins this matrix in the same change that
lands it, with an explicit per-arm entry (served / not served / different
shape); the LLP 0031 registry enforces the local arm's placement, and the
Cloudflare acceptance suites are the hosted arm's enforcement seam.

### 0A.5 The drain response shape (Lane P)

Added 2026-07-25 from the P-2 clean-room defect ledger
(`issues/20260725-0093-p2-spec-defect-drain-response-shape.md`): the
documents named the drain's *semantics* (LLP 0095 T-DRAIN) but never its
*wire shape*, forcing a clean-room implementer to guess. Normative, audited
against `drain_outbox` (`src/server.rs`):

- **The response body is a bare JSON array of `RealtimeEnvelope`** —
  `drain_outbox` ends in `Json(drained)` with
  `drained: Vec<RealtimeEnvelope>`. Not NDJSON, not an object wrapper
  (`{"batch": …}` does not exist). The array may be empty. Each element is
  governed by `realtime.envelope.schema.json`; the array wrapper itself is
  pinned here and by the P-1 fixture corpus's `batchContext` mechanics —
  a committed `live.outbox-drain.output.schema.json` does not exist yet
  (the defect ticket stays open for that machine-governance residual).
- **Unknown or reaped connections answer in-band, not with an HTTP
  error.** When the connection grant still admits the request but the
  outbox registry no longer holds an active connection (the
  `admitted.is_none()` arm of `drain_outbox`), the drain synthesizes a
  **single-element batch**: one `Durable`-wrapped
  `LiveEnvelope::ResyncRequired` with `reason: "unknown_or_reaped"`, no
  `subscription_id`, and `clear_retained: true`. A client treats it as the
  connection-wide clear-retained resync class (LLP 0095 T-OVERFLOW). This
  is load-bearing for poll-lane recovery: a reaped connection whose grant
  has *also* been invalidated refuses with
  `SNAPBACK_CONNECTION_TOKEN_INVALID` (LLP 0095 T-GRANT-LOSS), but a
  connection the registry has dropped while the token still admits is
  reported through this synthesized batch, not an error.
- **There is no client acknowledgement step.** The LLP 0059
  ownership-transfer cut rides the response handoff itself
  (`retain_realtime_handoff_in`): leases are accepted as part of
  successfully sending the body, and released — possibly redelivered — if
  the drain is cancelled before the cut. The client's only verb is GET;
  no ack route exists, and inventing one client-side is non-conformant
  guessing.

### 0A.6 Dev-mode posture

The named section LLP 0093 D1 requires: precisely what a dev-mode server
accepts **without an auth handshake**. Dev mode is the local development
authorization profile (LLP 0031's `AppAuth` = dev-mode client
assertion); sessions mode replaces this posture wholesale.

- **App-data invocations** (`/query/{name}`, `/mutation/{name}`,
  `/action/{name}`): the optional body `auth` member (`query.input` /
  `mutation.input` schemas; carried through `HandlerInput`) is a
  **client assertion** — the server trusts it as `ctx.auth` without any
  handshake. An absent `auth` runs the handler unauthenticated. There is
  no token exchange, no session, no signature.
- **Connection surface**: dev mode does **not** waive `ConnectionAuth`.
  `/connection/open` mints the per-connection token in every mode, and
  `/live/*`, `/outbox/{connection_id}`, and the ephemeral routes require
  it (LLP 0031 §Connection capability grants). Caller-suggested
  connection ids are adopted in non-prod profiles only.
- **Socket grammar**: the dev-mode socket speaks the open
  `LiveSocketClientMessage` family (§0C.1) with the bearer-subprotocol
  or header token carrier.
- **What sessions mode changes**: body-carried auth members are
  **rejected**, not trusted (LLP 0031's body-auth rejection family);
  identity comes from the LLP 0043 handshake; the closed
  `SessionLiveSocketClientMessage` family replaces the open socket
  grammar; the authorized-lease and invalidation routes (§0A.1) become
  reachable. A clean-room client MUST key its auth carriage on the
  negotiated mode, never on route availability probes.

### 0A.7 Sessions-mode connection binding

In sessions mode, `POST /connection/open` is Public only in the
credential-resolution sense when no bearer is present; it is still behind
the `auth/rr` exact-offer fence. When a bearer is present and accepted, the
resolved session authority is captured in the new connection grant. Every
`ConnectionAuth` route thereafter authorizes with that grant and does not
re-resolve an `Authorization` header.

Live body auth is mode-specific. Subscribe carries dev identity at nested
`input.auth`; unsubscribe and resume carry it at top-level `auth`. Sessions
mode rejects either client-provided body identity with
`SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED`; it uses only the authority already
bound into the connection. Changing users means releasing demand, opening a
fresh connection with the new bearer, and re-establishing subscriptions.

## 0B — Wire-version negotiation

### 0B.1 Version identity

`snapback.v1` names the connection-scoped surface exactly as LLP 0093 D1
pins it (handshake, live envelopes, socket frames, drain, and every
connection-authenticated request/response DTO; finite routes and
`/ephemeral/collections/ensure` ride route stability instead). This spec
adds no envelope changes; it makes the negotiation enforceable.

### 0B.2 What exists today (both arms, audited)

- **Local socket lane:** `stream_live` calls
  `.protocols([LIVE_STREAM_SUBPROTOCOL])` (`src/server.rs`, constant at
  `:5467`, upgrade at `:16966`): axum echoes `snapback.v1` when
  offered and **admits offerless upgrades**.
- **Hosted socket lane:** `acceptKitSocket` echoes only when offered —
  `protocols.includes('snapback.v1') ? { 'sec-websocket-protocol':
  'snapback.v1' } : undefined` (`cloudflare/src/coordinator.js:4600`) —
  and likewise admits offerless upgrades.
- **HTTP lane:** `POST /connection/open` carries one protocol offer
  today, `authInvalidationProtocol` (`OpenConnectionRequest`,
  `src/server.rs:4081-4094`), whose unknown values silently degrade to
  legacy (`:4727-4728`); the hosted `kitOpenConnection` ignores the field
  entirely (§0C.3).
- The JS kit always offers `snapback.v1` on the socket (with the bearer
  subprotocol) and sends no open-time wire-version field.

### 0B.3 The `wireVersion` open-time offer

The `/connection/open` request body gains one optional field:

```json
{ "wireVersion": "snapback.v1" }
```

- **Name:** `wireVersion` (camelCase, `wire_version` accepted as alias —
  the DTO's existing convention: every `OpenConnectionRequest` member
  carries a `#[serde(alias = "snake_case")]` twin).
- **Value:** an exact version token (LLP 0064 doctrine). The only token
  defined by this spec is `"snapback.v1"`.
- **Offer matrix** (normative, per LLP 0093 D1):

| Offer | Server behavior |
| --- | --- |
| known token (`snapback.v1`) | binds the connection to that version; from B1 the response **echoes the bound version** as an additive `wireVersion` member on the open response (the explicit bound-version witness — decided this revision, closing former OQ2; it is what makes hosted post-B1 servers distinguishable, §0B.6) |
| unknown token | synchronous refusal, `SNAPBACK_WIRE_VERSION_UNSUPPORTED` (HTTP 400, `error.response.schema.json` envelope) — a v2 client must never be interpreted under v1 |
| absent | opens a **legacy** connection, implicitly bound to v1 for the socket-equality rule; ineligible for envelope kinds gated on the open-time offer; no echo member; admitted through the bootstrap bridge, refusal (`SNAPBACK_WIRE_VERSION_REQUIRED`) is the scheduled end state |

**Binding is once, at open, and immutable for the life of the
connection grant lineage.** A lineage is in exactly one of two states,
fixed at first open: **explicitly bound** (the open carried a known
offer) or **legacy** (offerless open; implicitly v1 for the equality
rules; ineligible for offer-gated envelope kinds). No re-open changes
the state — the only way to a different binding (or from legacy to
explicit) is a fresh connection. Rationale: local and hosted re-open
both preserve the connection id and token
(`ConnectionRegistry::open_prepared`, `src/server.rs`;
`kitOpenConnection`, `coordinator.js`) and neither retires a live
socket, so any mid-lineage change would put two versions inside one
connection-scoped surface.

**Echo semantics (B1+):** the `wireVersion` response member witnesses
the lineage's **explicit binding** — it appears on every successful
open *and re-open* response of an explicitly bound lineage (with or
without an offer on the re-open body) and **never** on a legacy
lineage's responses (a confirming `snapback.v1` re-open offer does not
produce it: confirmation is not upgrade, and eligibility stays legacy).
Echo present ⇔ explicitly bound; echo absent ⇔ legacy lineage or
pre-B1 server (§0B.6).

**Re-open matrix (normative, B1+).** Offer classification runs first
and uses §0B.4's predicate; equality runs second (an uninterpretable
token can never be a mismatch):

| Lineage state | Re-open offer | Behavior |
| --- | --- | --- |
| explicitly bound | absent | admitted; binding and eligibility unchanged; echo emitted |
| explicitly bound | = bound version | admitted; echo emitted |
| explicitly bound | known, ≠ bound | refuse `SNAPBACK_WIRE_VERSION_MISMATCH`; the existing connection, socket, and subscriptions are undisturbed |
| explicitly bound | unknown candidate | refuse `SNAPBACK_WIRE_VERSION_UNSUPPORTED` (classification precedence — never `MISMATCH`) |
| legacy | absent | admitted; stays legacy; no echo. **B4 exemption:** `SNAPBACK_WIRE_VERSION_REQUIRED` applies to fresh opens only — an authenticated `previousToken` re-open stays admitted offerless, so the legacy population drains through lineage turnover (process restarts open fresh), not mid-lineage breakage |
| legacy | `snapback.v1` | admitted; **confirms** implicit v1 for the equality rules; stays legacy (no upgrade, no echo) |
| legacy | known, ≠ v1 | refuse `SNAPBACK_WIRE_VERSION_MISMATCH` (differs from the implicit binding) |
| legacy | unknown candidate | refuse `SNAPBACK_WIRE_VERSION_UNSUPPORTED` |

### 0B.4 Socket-offer requirement and the equality rule

A conformant client MUST offer `snapback.v1` in the
`Sec-WebSocket-Protocol` list of the kit stream upgrade
(`GET /live/{connection_id}/stream`), on both arms.

**Token classification (normative; one executable predicate).** The
subprotocol list is an offer *set* (WebSocket semantics: the client
offers, the server selects at most one). Classify each entry in order:

1. an entry starting `snapback.connection-token.` is the **bearer
   carrier** — excluded before any version classification;
2. any remaining entry starting `snapback.v` is a **version
   candidate**; a candidate exactly equal to a supported token (this
   spec defines one: `snapback.v1`) is **known**, every other candidate
   — `snapback.v2`, `snapback.vx`, `snapback.v1.0`, any malformed
   suffix — is **unknown** (malformed never falls through to ignored or
   absent);
3. every other entry (unrelated subprotocols) is **ignored** for
   versioning. Duplicates are harmless.

Then apply the first matching row (precedence is this table order —
"bound version present wins"; classification precedes equality, so an
offer set with no known candidate can never be a mismatch). Refusals in
the must-understand style of `src/auth/handshake.rs` (pre-upgrade HTTP
responses):

| Offer set (after classification) | Server behavior | Enforced from |
| --- | --- | --- |
| contains the connection's bound version (however many other candidates ride along) | accept; select and echo the bound version | today (echo); equality meaningful from B1 |
| contains ≥1 known candidate, none equal to the bound version | refuse, `SNAPBACK_WIRE_VERSION_MISMATCH` | B1 |
| contains ≥1 version candidate, none known | refuse, `SNAPBACK_WIRE_VERSION_UNSUPPORTED` | B1 |
| contains no version candidate (absent) | bridge: admit as the implicit-v1 confirmation path; refuse `SNAPBACK_WIRE_VERSION_REQUIRED` at end state | B3 |

Present-offer enforcement (`MISMATCH`/`UNSUPPORTED` rows) begins at
**B1**: no deployed consumer offers a conflicting or unknown version
(§0B.7), so refusing present-but-wrong offers has zero blast radius and
must not wait for the absent-offer bridge to close. Absence refusal is
**B3** only. A `snapback.v1` offer on a legacy (offerless-open)
connection **confirms** the implicit v1 binding, never upgrades it —
today's JS kit is exactly this shape and stays admitted through the
bridge.

The refusal lands on **both arms**: local `stream_live` and hosted
`acceptKitSocket` change together. The scope is the kit stream route
only: the hosted `GET /live/stream` **proof socket**
(`acceptLiveSocket`) is LLP 0040's pinned regression surface, speaks its
own frozen three-message protocol, is not part of wire v1, and is
exempt (its consumers deliberately offer no subprotocol).

### 0B.5 Staged bootstrap

Because today's *closed* local open-DTO rejects an unknown body member as
a decode failure, offers cannot ship before servers admit the field. The
stages, each a named gate:

- **B1 — field-admitting servers.** Both arms admit `wireVersion` and
  implement the §0B.3 matrix (known binds / unknown refuses / absent =
  legacy). On the local arm this is a member added to the closed
  `OpenConnectionRequest`; on the hosted arm `kitOpenConnection` must
  first **start reading** the field — its open decoder ignores unknown
  members today, so without B1 the hosted arm would silently feature-off
  every offer (the §0C hazard, live on this exact field). B1 also emits
  the `wireVersion` response echo (§0B.3), enables the present-offer
  socket refusals (§0B.4), and aligns `authInvalidationProtocol`
  unknown-value handling (§0C.5).
- **B2 — client offers.** The JS kit sends `wireVersion: "snapback.v1"`
  at open. Gate: B1 deployed on every arm the kit targets (for the shared
  Cloudflare deployment, a redeploy carrying B1). Non-kit clients are
  **sanctioned to offer early** — before B1, carrying §0B.6's
  legacy-server detection and downgrade diagnostic (the Swift client's
  shipped behavior); B2's gate binds the kit because the kit cannot
  surface a per-app downgrade diagnostic to every embedding demo.
- **B3 — socket refusal enabled.** The §0B.4 offerless-upgrade
  (absent-class) refusal turns on, after the recorded blast-radius check
  (§0B.7) is re-verified at enablement time.
- **B4 — absent-offer refusal (end state).** `POST /connection/open`
  without `wireVersion` refuses with `SNAPBACK_WIRE_VERSION_REQUIRED`.
  Deprecation schedule: B4 is not scheduled by calendar; its gate is the
  §0B.7 all-consumers audit reporting **zero** absent-offer consumers in
  the repo and one full release cycle after B2 in which the deployment's
  own suites all pass while offering. B4 is a breaking change for legacy
  clients and requires its own dated amendment here when enabled.

None of B1–B4 is implemented at this draft's landing; the server changes
are ticketed (`issues/20260725-0093-p0-wire-version-negotiation.md`).
This spec is the contract they are built to.

### 0B.6 Client-side legacy-server detection

A pre-B1 local server rejects a `wireVersion`-carrying open as a body
decode failure (closed DTO). The pinned client rule — the trigger is
exact, not heuristic: a **decode-class rejection** is
`SNAPBACK_REQUEST_JSON_INVALID` (HTTP 400; `ApiError::request_json_invalid`,
minted by `parse_optional_json`, `src/server.rs`) **and** the
differential — the rejection disappears when the offer member alone is
removed. That code also fires for missing `Content-Type` and non-object
bodies, which is what the differential re-try disambiguates. No other
code may trigger the fallback; in particular
`SNAPBACK_WIRE_VERSION_UNSUPPORTED` MUST NOT (it is a §0B.3
must-not-retry-lower refusal from a version-aware server), and unrelated
open-time 400s (e.g. the hosted `SNAPBACK_CONNECTION_ID_INVALID`) MUST
NOT. The pinned fallback: the client re-opens **offerless, as legacy,
exactly once per endpoint**, caches the verdict for the process
lifetime, and MUST surface the downgrade as a structured diagnostic
(never silently). A client may be configured strict (refuse instead of
downgrade); conformance claims made against a strict configuration are
claims about v1-bound connections only. (The P-2 Swift client currently
triggers on any 400/422 except `UNSUPPORTED` — over-broad against this
pin; ticketed, `issues/20260725-0094-swift-decode-class-heuristic.md`.)

Hosted caveat, stated plainly: a pre-B1 **hosted** server produces **no
distinguishing bytes at all** for a `wireVersion`-carrying open — the
open decoder ignores the member and answers success bytes identical to
an offerless open. Pre-B1 hosted legacy detection from the response is
therefore **impossible**; it becomes possible only at B1 via the
`wireVersion` response echo (§0B.3): echo present = bound, echo absent =
legacy server (or a pre-echo B1 build, which B1 excludes by shipping the
echo). Until the shared deployment carries B1, hosted version posture is
a deployment-gating fact, not a runtime-detectable one — which is
precisely why B2 gates on B1 deployment rather than on runtime
detection.

### 0B.7 Blast-radius record (audited at `6fe11376`, refreshed at `137dee8c`)

**Kit-stream socket consumers offering no wire version: none found.** The
enumerable population of the repo's own socket consumers:

- `packages/snapback-client/index.mjs` (and its `demos/_kit/client.mjs`
  re-export shim): offers `snapback.v1` + bearer subprotocol — compliant.
- `clients/swift/SnapbackClient` (landed after the original audit;
  refresh addition): offers `snapback.v1` + bearer subprotocol on the
  stream upgrade (`SnapbackClient.swift`, `wireVersionToken`) —
  compliant.
- `demos/_kit/tests/regression-reconnect-nuke.mjs`: raw socket, offers
  `['snapback.v1', 'snapback.connection-token.<token>']` — compliant.
- Rust in-crate socket tests (`src/server.rs` test modules): offer
  `LIVE_STREAM_SUBPROTOCOL` — compliant.
- `cloudflare/test/acceptance.remote.mjs`, `measure.remote.mjs`,
  `cloudflare/test/harness.mjs:364`: offerless, but on the **proof
  socket** `/live/stream`, which §0B.4 exempts.
- Browser/demo suites (all-aboard, cursors-web, shindig, graffiti,
  partiful-matrix, chat-matrix): reach the wire through the kit —
  compliant; partiful-matrix's `supabase-realtime-web.mjs` /
  `convex-realtime-web.mjs` sockets are third-party services, out of
  scope.

**`/connection/open` consumers (the B4 gate population):** the kit is
the only *JS* in-repo caller that constructs the open body (every demo,
suite, and generated client goes through it), plus the Swift client
(`clients/swift/.../SnapbackClient.swift`, which constructs its own open
body and already sends `wireVersion` with §0B.6 fallback — refresh
addition at `137dee8c`), the hosted-suite direct opens in
`cloudflare/test/*` (via the gateway with kit-shaped bodies), and Rust
in-crate tests constructing `OpenConnectionRequest` directly. All
inherit B2 when the kit and test fixtures add the offer (the Swift
client offers already); the B4 audit re-runs this enumeration — it is a
repo-wide search for `/connection/open` constructors, not a fixed list —
and must find zero offerless callers before absent may refuse.

## 0C — Per-family DTO closure matrix

Scope: the wire families of the §0A.1 matrix, both directions —
enumerated exhaustively below, with the families that have **no
committed standalone schema** carried as named gaps rather than omitted
(the §0F residual and its tickets own closing them). "Closed" means the
decoder rejects unknown members (`deny_unknown_fields` /
`additionalProperties: false`); "open" means unknown members are
silently ignored. The rule from LLP 0093 D1 binds every row: a new
client-sent field is **never** an ungated addition — it requires a
capability proof, a compatible fallback, or a new version token; the
failure mode differs (closed → old server refuses; open → silent
feature-off).

### 0C.1 Client→server families

| Family | Decoder (local arm) | Schema | Decided posture |
| --- | --- | --- | --- |
| `OpenConnectionRequest` (`src/server.rs:4081-4094`) | **closed** | `connection.open.input.schema.json`, closed | stays closed; the §0B.5 B1 member is the sanctioned evolution path |
| `AuthorizationInvalidationAckInput` (`src/local.rs`) | **closed** | closed | stays closed |
| manual-retry input (`src/local.rs`, `AuthorizationInvalidationManualRetryInput`) | **closed** | closed | stays closed |
| `SessionLiveSocketClientMessage` (`src/server.rs`, sessions-mode socket) | **closed** (auth-mode-dependent third family) | — | stays closed |
| `LiveSubscribeInput` / `LiveResumeInput` / `LiveUnsubscribeInput` (`src/local.rs`) | **open** | open | **stays open** — LLP 0091's `resumeFromToken` rides the open subscribe body as its compatible fallback, and closing an open decoder changes observable behavior for every deployed caller; the silent-feature-off hazard is mitigated by response witnesses: `resumeRefusal` for token resume, and `superseded` or `supersessionRefusal` for every presented `supersedes` id |
| `HandlerInput` (`src/manifest.rs`) | **open** | open (`query.input` / `mutation.input`) | stays open (it is the app-args carrier; the sessions-mode body-auth **rejection family** of LLP 0031 is the enforced closed subset — auth-bearing members are rejected, not ignored) |
| dev-mode socket client message (`LiveSocketClientMessage`, `src/live_wire.rs`) | **open** | `live.socket-client.schema.json` | stays open in dev mode; sessions mode already substitutes the closed family above |
| `AuthorizedLeaseQueryRequest` (`src/server.rs`) | **closed** | `authorized-lease.query.input.schema.json`, closed | stays closed (exact-protocol lease surface, LLP 0043/0053) |
| client-mutation acknowledge input (`client-mutation.ack.input.schema.json`) | **closed** | closed | stays closed |
| `/app/ensure` intent body (`EnsureAppInput` / `EnsureAppExplicitInput`, `src/local.rs`) | **closed** (`deny_unknown_fields` on the legacy struct and every intent variant) | `app.ensure.input.schema.json`, closed definitions | stays closed (v0.2 misclassified this row open — corrected; the closed-family gating rule applies to any addition). Hosted `kitEnsureApp` decodes it open, per §0C.3 |
| `/app/bundle` request (`app.bundle.input.schema.json`) | **open** | open | stays open (LLP 0090's dated amendment owns evolution) |
| ephemeral HTTP requests (`PublishRequest`/`SubscribeRequest`/`DeleteRequest`, `src/ephemeral.rs`) | **open** | no standalone committed schemas (they appear embedded in the socket-client schema) | stays open; standalone schema commitment is a named gap riding the §0F item-1 ticket |

### 0C.2 Server→client families

Schemas describe what current servers **emit**; the acceptance grammar
(P-1 fixture corpus + abstract state machine) defines what clients must
**accept**; on unknown fields the acceptance grammar wins (skip, never
crash), and an addition to any family whose deployed schema-validating
clients are not proven tolerant needs capability gating or a new token
(LLP 0093 D1, cited not renegotiated).

| Family | Emission closure | Notes |
| --- | --- | --- |
| `LiveEnvelope` (`live.envelope.schema.json`) | closed `oneOf` over the current kind set | new kinds always offer-gated (LLP 0091 `CurrentAsOf` is the pattern); `resync_required.reason` is the open-string escape hatch. Casing follows each serde DTO: outer durable fields are generally snake_case, but the `authorization_invalidation` obligation/resolution/scope/namespace/snapshot subtree is camelCase |
| `LiveSocketServerFrame` (`live.socket-server.schema.json`) | closed `oneOf` | `durable_bytes` carries the required recovery transition (LLP 0093 D3 fact 2b) |
| `Receipt` (`receipt.schema.json`) | closed variants | §0D ratifies its appearance on subscribe/unsubscribe outputs as typed |
| `AuthorizationInvalidationSnapshot` (`src/live_wire.rs:128-136`) | **closed** (`additionalProperties: false`) | additions need gating per the rule above |
| `AuthorizationInvalidationAckOutput` (`src/local.rs:790-794`) | **closed** | same |
| `LiveSubscribeOutput` / `LiveUnsubscribeOutput` / `LiveResumeOutput` | open objects | additive optional fields are the sanctioned in-v1 evolution (server→client direction) |
| `RealtimeEnvelope` drain wrapper (`realtime.envelope.schema.json`) | closed | lane-P framing only |
| `RealtimeEnvelope::EphemeralAck` | nominally closed variant with a flattened ack payload | deliberate unknown-field-detection exception: serde `flatten` consumes extra top-level members into the ack payload, so a generic closed-envelope decoder cannot distinguish a future wrapper field. Do not seed an unknown-field tolerance fixture for this variant until the payload is typed or flattening is removed |
| `ConnectionGrant` (`connection.grant.schema.json`) | open object | the §0B.3 `wireVersion` echo lands here as the sanctioned additive member |
| `ErrorResponse` (`error.response.schema.json`) | **closed** (`deny_unknown_fields`, `src/server.rs`) | `diagnostic` required; optional `receipt`/`attribution`; the inner `Diagnostic` requires `code`/`severity`/`subsystem`/`message`/`details` — the hosted arm currently under-fills it (§0C.6 item 3) |
| `MutationResponse` (`mutation.output.schema.json`) | **closed** | but the served local bytes ride `FunctionResponse<T>`, which flattens an optional `attribution` member the closed schema does not admit — a real schema-generation defect, §0C.6 item 4 |
| `QueryOutput` / action output (`src/manifest.rs`) | open | **no standalone committed schemas** — typed in Rust, exported only through composite manifests; named gap riding the §0F item-1 ticket |
| `/app/ensure` outcomes (`EnsureAppAttestOutcome` / `EnsureAppProvisionOutcome` / legacy `EnsureAppOutcome`, `src/local.rs`) | **closed** (`deny_unknown_fields`; `additionalProperties: false` in `app.ensure.output.schema.json`) | closed-family rule: additions need gating or a new token (v0.2 misclassified this row open — corrected) |
| `/app/bundle` output (`app.bundle.output.schema.json`) | open object | additive-optional evolution, same rule as the live outputs |
| `AuthorizedLeaseQueryResponse` / lease envelope (`authorized-lease.*` schemas) | **closed** | exact-protocol surface; evolution under LLP 0043/0053, cited not restated |
| client-mutation acknowledge output (`client-mutation.ack.output.schema.json`) | **closed** | stays closed |
| ephemeral HTTP outcomes (`src/ephemeral.rs`) | open | no standalone committed schemas — same named gap as the request side |

Socket server→client union rule: on the kit stream, durable-lane
payloads arrive **unwrapped** — bare `LiveEnvelope` kinds
(`live_replace`/`resync_required`/`current_as_of`…) interleave with
`LiveSocketServerFrame` kinds on the same socket (the kit implements
exactly this union, `packages/snapback-client/index.mjs`), so a
clean-room client's socket decoder is the union of the two families,
dispatched on `kind`.

### 0C.3 The hosted-arm caveat

The closure matrix above describes the **local** decoders. The hosted
arm's kit routes are JS-composed (`kitOpenConnection`, `kitSubscribe`,
`kitUnsubscribe`, `kitEnsureApp`) and are **open decoders in every
family**, including the two families the local arm closes
(`/connection/open`, and there is no hosted sessions-mode socket
family). The closure claims of §0C.1 are therefore per-arm facts, and
any contract that leans on closed-DTO refusal (§0B.6's legacy
detection) must state which arm it holds on. Bringing the hosted open
handshake to the local closure posture is **not** required by this spec
— hosted B1 requires only that the offer member be *read* — but the
asymmetry is recorded here so it is a decision, not drift.

### 0C.4 By transport and auth mode

The socket carries two client→server grammars selected by auth mode
(dev: open `LiveSocketClientMessage`; sessions: closed
`SessionLiveSocketClientMessage`) — the closure posture of "the socket"
is therefore mode-dependent and both rows above are normative. HTTP
bodies keep one grammar per route across modes; sessions mode adds the
body-auth rejection family (LLP 0031), which is a *rejection* subset
inside otherwise-open decoders, not a closure.

### 0C.5 `authInvalidationProtocol`: decided, not inherited

Today an **unknown** `authInvalidationProtocol` value silently degrades
to a legacy connection (`src/server.rs:4727-4728` — exact-match-v1 else
`None`), the opposite of §0B.3's unknown-refuses rule for the adjacent
field. Decision: **aligned to refuse**. From stage B1, both offer fields
on `/connection/open` follow one matrix — known binds, unknown refuses
(`SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED`), absent degrades to
legacy. Rationale: a client offering invalidation-protocol v2 must not
be silently downgraded to v1 semantics it may be unable to satisfy
(exact-token doctrine, LLP 0064); blast radius is empty — the only
value any in-repo caller ever offers is `1`, and absent behavior is
unchanged, so no deployed caller observes the difference. The change
ships inside B1, not independently, so the two fields' semantics never
diverge again.

### 0C.6 Response-shape divergences (audited at `137dee8c`): defects, not contract

The precedence rule (Summary) holds the committed schemas as the
contract target on both arms. This ledger enumerates every audited place
where **served bytes today do not satisfy them**. Divergences are
**defects** — tracked by
`issues/20260725-0094-hosted-response-shape-divergences.md` — not
renegotiated contract; until they are fixed, a client targeting the
hosted arm MUST tolerate the enumerated shapes (tolerate means: accept
these specific narrower/looser payloads; it licenses no other
deviation), and a conformance claim on the affected tuples carries this
ledger by reference.

1. **Hosted `/mutation/{name}`** (`kitMutation`, `coordinator.js`)
   returns `{version, changed_count, result}` — no `receipt`, which
   `mutation.output.schema.json` requires.
2. **Hosted `/live/{name}/unsubscribe`** (`kitUnsubscribe`) returns
   `{removed: true}` — neither `subscription_id` nor `disposed`, both
   required by `live.unsubscribe.output.schema.json`.
3. **Hosted error envelopes** (`kitError`/`kitFailure`) emit
   `{diagnostic: {code, message[, details]}}` — the envelope shape is
   right, but the inner `Diagnostic` omits `severity` and `subsystem`
   and makes `details` optional, all required by the schema.
4. **Local function responses** ride `FunctionResponse<T>`
   (`src/server.rs`), which serde-flattens an optional `attribution`
   member onto the output; `mutation.output.schema.json` is closed and
   does not admit it, so a sessions-mode mutation response with
   attribution violates the committed schema on the **local** arm. The
   schema should be generated from the served envelope (or `attribution`
   admitted explicitly); this is the one divergence whose fix is a
   schema-side correction rather than a JS emitter fix.
5. **Hosted `/query/{name}`** (`kitQuery`) returns `{version, rows}` —
   shape-compatible with `QueryOutput` (no committed standalone schema;
   §0C.2 gap row), noted here for completeness, not a schema violation.
6. **Hosted in-band durable subscribe replies** (§0A.1 WS-kinds row):
   plain (non-resume) subscribe answers proof-dialect
   `{type: "snapshot", …, connectionKey}` and every in-band error is
   proof-dialect `{type: "error", code, …}` — frames outside both
   committed socket-frame families. Convergence target: kit dialect
   (`kind`-tagged), matching the already-kit-dialect `current_as_of`
   and `pong` replies; until then the reply grammar is
   conformance-unclaimable (the §0A.1 decision).
7. **Hosted kit-route request-parse refusals** (`requestDiagnostic` via
   `parseJsonObjectRequest`, `coordinator.js`) emit
   `{ok, code, message, diagnostic}` — top-level members the closed
   `ErrorResponse` does not admit, plus the under-filled inner
   `Diagnostic` of item 3.
8. **Gateway-lane refusals** (`cloudflare/src/gateway.js`): kit-route
   method refusals emit an under-filled `Diagnostic`
   (`SNAPBACK_METHOD_NOT_ALLOWED`); the kit-stream non-upgrade branch
   emits `{error: "expected websocket upgrade"}` (426) and the
   `/_snapback/*`/fallthrough 404s emit `{error: "not found", path}` —
   no `diagnostic` envelope at all.
9. **Hosted platform-failure responses on kit routes**
   (`platformFailureResponse`, `cloudflare/src/platform-errors.js`,
   non-proof branch): `{diagnostic: {code, message, details}}` with the
   under-filled inner `Diagnostic` (no `severity`/`subsystem`; `details`
   dropped when undefined).

Governance decision (answers what the envelope rule covers):
`error.response.schema.json` governs **every** non-2xx JSON failure on
§0A.1 kit routes on both arms — gateway lane, parse lane, platform lane,
and handler lane alike; items 3 and 7–9 are the audited divergences from
that rule. The ledger enumerates **emitter functions**, not sampled
responses (`kitError`, `kitFailure`, `requestDiagnostic`, the gateway
`json(...)` refusal sites, `platformFailureResponse`); the convergence
ticket owns an executable audit that fails when a new non-conformant
emitter appears. The fix direction is decided: **converge the emitters
to the schemas** (hosted kit routes gain the missing members; the local
`attribution` flatten gets admitted into the generated schema; in-band
replies converge to kit dialect), with a hosted-side executable
response-schema gate riding the §0F item-1/item-3 ticket. Nothing in
this ledger is an evolution precedent.

## 0D — Subscription receipt typing (implemented)

`LiveSubscribeOutput.receipt` and `LiveUnsubscribeOutput.receipt` were
`Option<serde_json::Value>` (`src/local.rs:674,774` at `e1edbbc1`) — the
untyped compatibility seam LLP 0093's version-domain section names. With
this spec they are `Option<crate::live_wire::Receipt>`:

- both emission sites construct the typed `Receipt::Subscription` and
  convert to `Value` only at the retention-ring boundary
  (`Receipt::into_value`, which predates the typed wire);
- `schemas/live.subscribe.output.schema.json` and
  `live.unsubscribe.output.schema.json` are regenerated in the same
  change (`cargo run --bin snapback-schemagen`), so the `receipt` member
  now references the `Receipt` union definition instead of `true`;
- the `tests/artifact_schemas_v0.rs` instance test upgrades its
  hand-written `json!({ "kind": "subscription" })` receipt to a full
  typed instance, and the JS gate
  (`demos/_kit/tests/live-wire-schema.mjs`) continues to pass unchanged
  (it pins kinds and fields, which do not move).

Only now is the shared `Receipt` union a **ratified** claim: it evolves
under the stricter connection-scoped v1 rule everywhere it appears, and
the finite-lane consequence stands — on `/mutation` responses (no offer
carrier) receipt evolution within v1 is limited to optional fields on
existing variants.

Wire-shape note (no bytes changed): the serialization of the emitted
receipt was already the `Receipt` shape; the typing turns a prose
guarantee into a compiler-and-schema guarantee.

## 0E — Refusal-code registry (negotiation)

New codes, registered here in the LLP 0091 §0B.6 style; all use the
standard `error.response.schema.json` diagnostic envelope; socket-lane
refusals are pre-upgrade HTTP responses in the handshake.rs
must-understand style:

| Code | HTTP | Where | Meaning |
| --- | --- | --- | --- |
| `SNAPBACK_WIRE_VERSION_UNSUPPORTED` | 400 | `POST /connection/open` and kit stream upgrade (B1+) | the offer contains no known wire-version token but at least one wire-version-shaped one (§0B.4 classification); the client must not retry under a lower version without an explicit decision |
| `SNAPBACK_WIRE_VERSION_MISMATCH` | 400 | kit stream upgrade and `previousToken` re-open (B1+) | a known offer that does not equal the connection's bound version (§0B.3 immutability / §0B.4 equality) |
| `SNAPBACK_WIRE_VERSION_REQUIRED` | 400 | kit stream upgrade (B3+), `POST /connection/open` (B4) | no wire-version-shaped offer where one is required (absent class only) |
| `SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED` | 400 | `POST /connection/open` (B1+) | unknown `authInvalidationProtocol` value (§0C.5 alignment) |
| `SNAPBACK_AUTH_POLICY_UNAVAILABLE` | 503 | sessions-profile routes | the server/process has not installed the required policy plane; retry only under a bounded readiness policy |
| `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` | 400 | sessions `auth/rr`, queued replay, authorized lease | the server is ready but this request omitted or mismatched an exact client protocol offer; repair the named header/subprotocol, do not retry unchanged |
| `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED` | 400 | auth-scoped live and invalidation acknowledgement | the server is ready but the request/connection did not offer invalidation protocol 1; repair negotiation, do not retry unchanged |
| `SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED` | 400 | sessions auth-scoped live subscribe | the required `authorizationNamespace` was absent |
| `SNAPBACK_LIVE_RESUME_FUNCTION_MISMATCH` | 400 | unsubscribe/resume | the retained subscription belongs to a different function than the route path |
| `SNAPBACK_CONNECTION_TOKEN_REQUIRED` | 401 | every `ConnectionAuth` route | no connection credential was presented |
| `SNAPBACK_CONNECTION_TOKEN_INVALID` | 403 | every `ConnectionAuth` route | the grant is invalid/reaped/expired; take LLP 0095 T-GRANT-LOSS, do not retry the dead grant |

Existing codes this spec touches but does not change:
`SNAPBACK_CONNECTION_SOCKET_REQUIRED` (hosted
socket-session gate; HTTP **409** on the hosted arm — §0A.1). The
migrated hosted system routes keep their existing codes unchanged
(`SNAPBACK_ADMIN_*`, `SNAPBACK_CRON_*`, etc.).

**Scope clarification (2026-07-25, P-2 defect ledger):**
`SNAPBACK_LIVE_RESUME_OWNERSHIP` (HTTP 403) is, despite its name, the
**shared live-ownership refusal** for every retained-live-owner check, not
a resume/reattach-only concern: explicit unsubscribe
(`unsubscribe_live_prepared`), the `supersedes` replacement check on
subscribe (known foreign owners fail closed), resume/reattach, and
authorization-invalidation manual retry all mint it through
`live_owner_mismatch` / the same ownership predicate (`src/local.rs`;
predicate `LiveSubscription::is_owned_by` →
`RetainedLiveAuthority::matches`, `src/auth/invocation.rs` — resolved
authority identity plus exact connection grant). The name is historical
(first minted for resume, LLP 0032 S2); sharing one code across the
live-ownership checks is intentional. The client-side consequence is LLP
0095's: T-UNSUB and T-RECONNECT require presenting the subscription's
establishing identity.

The diagnostic `details` include `subscriptionId`, a redacted
`expectedIdentity`, and `presentedIdentity` as either a presence marker or
`null`. This makes an omitted/misplaced open-body `auth` distinguishable
from a presented-but-wrong owner without disclosing either identity.

## 0F — Remaining hand-mirrored frames (LLP 0051 §D4)

Audit at `6fe11376` of what remains outside the schema drift gates
(`tests/artifact_schemas_v0.rs` + `demos/_kit/tests/live-wire-schema.mjs`):

1. **The LLP 0060 D6 private marker envelopes** — the
   coordinator→handler invocation request, the handler→coordinator
   response envelope with its required marker echo, and the
   handler→host call body. All three are live on the Cloudflare arm
   today (`packages/snapback-harness/workerd/handler-server.mjs`,
   `cloudflare/src/coordinator.js` `serveHostCall` /
   `invokeHandler`) and hand-mirrored JS↔JS↔Rust. LLP 0051 §D4 already
   assigns them Rust serde authorities + committed schemas + the shared
   drift gate; being private is not a hand-mirror exemption. **Not
   implemented here** — ticketed
   (`issues/20260725-0093-p0-marker-envelope-schemas.md`).
2. **The hosted in-band socket frame grammar** — one validator,
   `validateLiveSocketFrame` (`coordinator.js`), serves **both** socket
   populations: the LLP 0040 proof sockets and the kit sockets (§0A.1
   WS-kinds row). The earlier "frozen three-message protocol"
   characterization was inaccurate as a description of the validator:
   the subscribe frame has already evolved under LLP 0091 (it accepts
   `resumeFromToken` and tolerates `membershipWitness`). The decision,
   restated precisely: the **proof-socket response framing** (LLP
   0040's pinned regression surface, `type`-tagged replies) stays out
   of wire v1 and out of the gate inventory — its consumers are the
   pinned proof suites, and schematizing their frozen reply shapes
   would imply evolution support they do not have. The **kit-socket
   in-band request grammar** (`subscribe`/`unsubscribe`/`ping`) is
   **inside wire v1** and its schema/gate coverage rides the item-1
   ticket alongside the marker envelopes; the in-band **reply** grammar
   is mixed-dialect as served (§0A.1) and enters the gates only at its
   §0C.6 item-6 convergence to kit dialect — schematizing the mixed
   as-built replies would contract the wrong protocol. The exemption is
   scoped to the proof socket only.
3. **The hosted kit-route response composition** (`kitSubscribe` et al.
   compose subscribe outputs in JS): governed by the committed schemas
   but with no hosted-side executable drift gate. The
   conformance-twin/acceptance suites are the current enforcement seam;
   a hosted schema-validation gate rides the same ticket as item 1.
4. **Families typed in Rust but without standalone committed schemas**
   (audited, §0C's gap rows): `QueryOutput` and the action output, the
   ephemeral HTTP request/outcome families, and
   `SessionLiveSocketClientMessage` (the sessions-mode socket family —
   its schema absence is an oversight, not an LLP 0043 exemption; the
   sessions surface governs its semantics, this spec owns its
   schema-commitment gap). They are serde-typed and drift-gated at the
   type level but not independently schema-committed; closing them
   rides the item-1 ticket.
5. Everything else client-visible is schema-governed (LLP 0051 §D4's
   ENG-23891/ENG-23964 completion; §0D closes the last untyped member
   inside an already-governed family), with the served-bytes exceptions
   ledgered in §0C.6.

## Verification

Landed with this draft: `./ref-check --verbose`;
`node demos/_kit/tests/live-wire-schema.mjs`;
`node demos/_kit/tests/regression-durable-bytes-resync.mjs`; targeted
`cargo test` over the schema drift gates (`artifact_schemas_v0`) and the
live subscribe/unsubscribe paths; the Cloudflare non-remote suite for the
§0A.3 migration. The §0B/§0C.5 server changes land under their ticket
with: offer-matrix acceptance fixtures on both arms (known/unknown/absent
× open/socket), the socket-refusal style test mirroring
`src/auth/handshake.rs`, and a re-run of the §0B.7 enumeration recorded
in the landing commit. The §0C.6 convergence lands under its own ticket
with hosted response-schema assertions in the Cloudflare acceptance
suite for each ledger item.

## Decisions log (review loop)

- **B1 echoes the bound version** as an additive `ConnectionGrant`
  member (round 1; both families independently converged on it). The
  echo witnesses the lineage's **explicit binding** — never emitted for
  legacy lineages, emitted on every open/re-open response of an
  explicitly bound lineage (§0B.3).
- **In-band durable subscribe on the hosted kit socket** (round 2): the
  request surface is recorded as served; the reply grammar is
  mixed-dialect as built and **not conformance-claimable** in v1 until
  converged to kit dialect (§0A.1, §0C.6 item 6). The v1 durable entry
  point on that arm is HTTP subscribe/unsubscribe with a current socket
  session.
- **Error-envelope governance** (round 2): `error.response.schema.json`
  governs every non-2xx JSON failure on §0A.1 kit routes, all lanes,
  both arms; divergent emitters are ledgered in §0C.6, not exempted.
- **Session-socket schema gap** (round 2): owned by §0F item 4 as an
  oversight to close, not an LLP 0043 exemption.

## Open questions

1. Should the B2 kit offer also ride the generated clients' pinned
   fixtures (so every generated client inherits the offer atomically),
   or is the kit the single mint point? (Leaning: single mint point —
   generated clients call the kit.)
2. May clients mint client-side diagnostic codes inside the
   `SNAPBACK_*` namespace (the Swift client's
   `SNAPBACK_CLIENT_WIRE_VERSION_DOWNGRADE` for the §0B.6 downgrade
   diagnostic), or does the namespace belong to servers with clients
   required to use a `SNAPBACK_CLIENT_*` sub-namespace or their own?
   (Leaning: reserve `SNAPBACK_CLIENT_*` for client-minted codes and
   register them beside §0E.)
3. When the shared Cloudflare deployment redeploys with §0A.3, should
   the acceptance suite assert the old root system routes actually
   stopped answering (the no-aliases claim as deployed, not just
   in-repo)? (Leaning: yes — one negative probe per migrated family in
   the remote suite, paired with a positive probe of its migrated
   replacement in the same run.)
