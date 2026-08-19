# LLP 0094: Wire envelope contract (LLP 0093 rollout P-0)

**Type:** Spec
**Status:** Accepted
**Systems:** Wire Protocol, Realtime, Live Queries, Client SDK, HTTP surface, Cloudflare arm, Schema governance
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-25
**Revised:** 2026-08-10 (sessions live-update delivery amendment: one content
frame per commit version per subscription; auth-scoped row changes use the
obligation-backed `authorization_invalidation` envelope — see §0C.8);
2026-08-10 (LLP 0146 OQ6 remediation-carrier amendment: `diagnostic.details.remediationSet`, nested versioning, closed outer envelopes unchanged — see the dated section); 2026-08-08 (ErrorResponse v1 amendment: every HTTP error envelope
now requires `formatVersion: "snapback.error-response.v1"`; receivers ignore
unknown top-level members for forward-additive evolution while the version is
must-understand. This does not resolve LLP 0146 OQ6 or add a remediation
carrier). 2026-08-04 (dated LLP 0157 finite-carrier amendment: optional
proof/witness members on ordinary query and authorized-lease responses, plus
atomic snapshot-batch page-set-manifest delivery; see the dated section).
2026-08-03, later (LLP 0109 acceptance reconciliation: the
versioned-seed closed families land under the reserved admin namespace —
`/app/ensure` unchanged on both arms; see the dated section).
2026-08-03 (Accepted 2026-08-03 by the author — decision
sitting #2, "accept all that verify",
`issues/20260803-author-decision-sitting-2.md`; gate verified: no unresolved
blocking review finding, the remaining §Open questions carry recorded
leanings and are not pre-acceptance-blocking; status Review → Accepted);
2026-08-02 (Accepted LLP 0136 staged wire fold:
`liveSearchProtocol` offer semantics and closed-DTO routing, unimplemented);
2026-07-30 (operational: the shared Cloudflare deployment was
redeployed with the 2026-07-27 wire landings — B1 negotiation echo/refusal
verified live and the §0C.6 pre-convergence-bytes caveat retired; see
`issues/closed/20260727-cloudflare-redeploy-wire-landings.md`).
2026-07-28 (unreviewed post-corrective-round reconciliation:
use-only live qualification transport, carrier-stripped sender binding, and
the exact hosted-ephemeral per-boundary/refusal contract; the status remains
Review). 2026-07-28 (LLP 0113 corrective addendum: complete
qualification-use/refusal contract, hosted-ephemeral authority-instance wire
closure, and HTTP-400 invalidation-protocol reconciliation). 2026-07-28 (LLP 0110 qualification amendment: exact
connection-open DTO members and query/mutation headers carry the bounded hidden
candidate grant; live frames inherit only the bound connection session).
2026-07-27 (LLP 0108 amendment: result-contract failures use the
existing error envelope and refusal registry; no expected-operation wire
carrier is introduced); 2026-07-25 (initial draft; §0D receipt typing and §0A.4 hosted
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
witnesses, and refusal/status registry); 2026-07-27 (§0F items 1–4
implemented: marker envelopes, the kit-socket in-band request grammar,
the §0C gap-row families, and the drain-response schema joined the LLP
0051 §D4 drift gates; the hosted executable schema-validation gate landed
as `targets/cloudflare/test/wire-schema-gate.mjs`; §0A.5/§0C rows updated in
place — the in-band reply grammar deliberately stays out pending its
§0C.6 item-6 convergence); 2026-07-27 (§0C.6 convergence
executed under its ticket: ledger items 1-4 and 6-9 converged — hosted
emitters now satisfy the committed schemas, the in-band kit-socket reply
grammar is kit dialect, the local `attribution` flatten is admitted into
the regenerated `mutation.output.schema.json`, and the executable
emitter audit landed as `targets/cloudflare/test/acceptance.wire-shapes.mjs`;
the tolerate-the-divergence caveat is retired for the converged items);
2026-07-27 (§0B stages B1–B3
implemented on both arms with the kit offer, under
`issues/20260725-0093-p0-wire-version-negotiation.md`: §0B.5 stage record,
§0B.7 blast-radius re-run with a corrected in-crate-population finding,
§0C.5 alignment implemented; B4 stays staged); 2026-07-27 (P-0
self-review hardening: the hosted nullable offer now matches the Rust
`Option<String>` authority and committed schema; concurrent first opens
single-flight the endpoint probe; the kit validates the exact B1 echo,
conservatively surfaces a successful missing-echo open as a legacy
downgrade, and strict mode refuses both missing and cached-legacy
witnesses); 2026-07-27 (the remaining §0F item-2 residual landed: the converged
kit-socket reply grammar now has the `KitSocketReplyFrame` Rust authority,
the committed `live.kit-socket-reply.schema.json`, positive/negative schema
instances, and real served-frame validation for all four reply variants;
the §0A.1 conformance caveat is retired); 2026-07-30 (live attribution
seam: `LiveSubscribeOutput`/`LiveResumeOutput` gained the optional
`attribution` member — the sanctioned additive-optional evolution the
§0C.2 open-family row licenses — carrying the LLP 0055 §Audit block as
immutable establishment metadata; both live output schemas regenerated;
see `issues/closed/20260717-app-cli-attribution-seams.md`)
**Related:** LLP 0013, LLP 0031, LLP 0034, LLP 0043, LLP 0049, LLP 0051,
LLP 0053, LLP 0059, LLP 0060, LLP 0064, LLP 0077, LLP 0090, LLP 0091,
LLP 0092, LLP 0093, LLP 0108, LLP 0110, LLP 0113

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
bytes in JS (`targets/cloudflare/src/coordinator.js`), so the serde/schema chain
describes the *contract target* there, not automatically the served
bytes; every audited place where served hosted bytes fall short of the
schemas is enumerated in §0C.6 and tracked as a defect. Citations below
are file + symbol, line numbers as courtesy, pinned against origin/main
`137dee8c`.

## 0A — Arm × route matrix

The two served arms are **local** (`crates/snapback/src/server.rs` router, built from the
LLP 0031 route registry) and **hosted** (the Cloudflare gateway Worker
`targets/cloudflare/src/gateway.js` fronting the coordinator Durable Object
`targets/cloudflare/src/coordinator.js`).

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
| `/connection/open` | POST | Public credential; `auth/rr` offer required in sessions mode (grants, never exercises) | closed DTO `OpenConnectionRequest` (`crates/snapback/src/server.rs:4081-4094`) | open decoder `kitOpenConnection` (`coordinator.js:4196`) — see §0C.3 |
| `/query/{name}` | POST | app auth (mode-dependent, LLP 0031 matrix) | served | served (`kitQuery`) |
| `/mutation/{name}` | POST | app auth | served | served (`kitMutation`) — emits the committed `mutation.output.schema.json` envelope including the required `receipt` (§0C.6 item 1, converged 2026-07-27) |
| `/action/{name}` | POST | app auth | served | served (`executeAction`) |
| `/query/{name}/authorized-lease` | POST | sessions-mode resolved caller + exact protocol offers (LLP 0043/0053) | served | **not served** (hosted auth profile gap) |
| `/client-mutations/acknowledge` | POST | app auth + authority descriptor | served | **not served** |
| `/live/{name}/subscribe` | POST | Conn grant (`Authorization` bearer ignored after open) | served; open decoder body (§0C) | served (`kitSubscribe`); **refuses without a current socket session** (`SNAPBACK_CONNECTION_SOCKET_REQUIRED`, HTTP **409** on this arm — `coordinator.js` `kitSubscribe`/`kitUnsubscribe` guards) |
| `/live/{name}/unsubscribe` | POST | Conn grant (bearer ignored) | served | served (`kitUnsubscribe`) — emits the committed `live.unsubscribe.output.schema.json` shape (§0C.6 item 2, converged 2026-07-27) |
| `/live/{name}/resume` (reattach) | POST | Conn grant (bearer ignored) | served (LLP 0090 keeps it; no first-party caller) | **not served** (gateway forwards `subscribe\|unsubscribe` only — `KIT_ROUTE`, `gateway.js:67`) |
| `/live/{connection_id}/stream` | GET (WS upgrade) | Conn grant (header or `snapback.connection-token.<token>` subprotocol; never URL; bearer does not replace bound authority) | served (`stream_live`) | served (`acceptKitSocket`) |
| `/outbox/{connection_id}` | GET | Conn grant (bearer ignored) | leased-batch drain (LLP 0059 ownership cut; response shape §0A.5) | grant-verified, **declared-empty batch** (`coordinator.js` kit outbox arm; `http_outbox_poll_fallback` is a manifest gap) |
| `/live/authorization-invalidation/acknowledge`, `/manual-retry` | POST | Conn + exact negotiated invalidation protocol | served | **not served** |
| `/ephemeral/publish`, `/subscribe`, `/delete` | POST | Conn | served (LLP 0013) | **not served** (`ephemeral_realtime` manifest gap) |
| `/ephemeral/collections/ensure` | POST | Public (validate-only, identity-free) | served | **not served** |
| WS message kinds on the kit stream | — | bound socket (LLP 0031 operation registry) | the `type`-tagged `LiveSocketClientMessage` family: `ephemeral_subscribe\|ephemeral_publish\|ephemeral_delete\|ephemeral_unsubscribe\|ping` (registry operation names prefix-map these; `ping` registers as `live_ping`); **no in-band durable subscribe/unsubscribe** — durable lifecycle is HTTP-only on this arm | request grammar `subscribe\|unsubscribe\|ping` (`webSocketMessage` → `validateLiveSocketFrame`, `coordinator.js`), schema-governed by `live.kit-socket-request.schema.json` (Rust authority `KitSocketRequestFrame`, `crates/snapback/src/live_wire.rs`; verdict parity with the served validator proven by `targets/cloudflare/test/wire-schema-gate.mjs`); **no ephemeral kinds**. Reply grammar is **kit dialect throughout** (§0C.6 item 6, converged and schema-governed 2026-07-27 by `live.kit-socket-reply.schema.json`, Rust authority `KitSocketReplyFrame`): ping → `kind: "pong"` with `requestId` echo; subscribe with `resumeFromToken` answering rung 1 → `kind: "current_as_of"` (the one LLP 0091 step-5-contracted reply); plain subscribe → `kind: "snapshot"` with the kit frames' snake_case members (`subscription_id`, `function`, `version`, `rows`, optional `resume`/`resumeRefusal`; no proof `connectionKey`); every error → `kind: "error"` with the full committed `Diagnostic`; unsubscribe → session-scoped delete, **no reply frame**. Positive/negative Rust instances and real served-frame validation for all four reply variants live in the shared schema gates. The row is conformance-claimable; no first-party client currently sends in-band durable frames |
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
(`crates/snapback/src/admin.rs`, AdminWrite). The full local system surface is LLP 0031's
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
loopback listener (`crates/snapback/src/workerd_exec.rs`) accepts the same path — one
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
against `drain_outbox` (`crates/snapback/src/server.rs`):

- **The response body is a bare JSON array of `RealtimeEnvelope`** —
  `drain_outbox` serves the transparent authority type
  `OutboxDrainOutput(Vec<RealtimeEnvelope>)` (`crates/snapback/src/live_wire.rs`). Not
  NDJSON, not an object wrapper (`{"batch": …}` does not exist). The array
  may be empty. Each element is governed by
  `realtime.envelope.schema.json`; the array wrapper is machine-governed
  by the committed `live.outbox-drain.output.schema.json` (added
  2026-07-27, closing the P-2 defect ticket's residual): the local arm
  serializes the authority type directly, the hosted arm's declared-empty
  drain is validated against the same schema by
  `targets/cloudflare/test/wire-schema-gate.mjs`, and the positive instances
  (empty array; the synthesized `unknown_or_reaped` batch below) are
  pinned in `crates/snapback/tests/artifact_schemas_v0.rs`.
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

### 0B.2 What existed before B1 (both arms, audited)

**Superseded 2026-07-27 by the B1–B3 landing (§0B.5).** The bullets below
are kept as the audited **pre-B1** state: it is exactly what §0B.6's
legacy-server detection still detects in deployed pre-B1 servers (the
shared Cloudflare deployment until its post-B1 redeploy, executed
2026-07-30).

- **Local socket lane:** `stream_live` calls
  `.protocols([LIVE_STREAM_SUBPROTOCOL])` (`crates/snapback/src/server.rs`, constant at
  `:5467`, upgrade at `:16966`): axum echoes `snapback.v1` when
  offered and **admits offerless upgrades**.
- **Hosted socket lane:** `acceptKitSocket` echoes only when offered —
  `protocols.includes('snapback.v1') ? { 'sec-websocket-protocol':
  'snapback.v1' } : undefined` (`targets/cloudflare/src/coordinator.js:4600`) —
  and likewise admits offerless upgrades.
- **HTTP lane:** `POST /connection/open` carries one protocol offer
  today, `authInvalidationProtocol` (`OpenConnectionRequest`,
  `crates/snapback/src/server.rs:4081-4094`), whose unknown values silently degrade to
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
  defined by this spec is `"snapback.v1"`. The Rust authority is
  `Option<String>` and the generated input schema admits `null`; therefore
  explicit JSON `null` follows the absent/legacy row on both arms. Other
  present non-string values are invalid or unsupported according to the
  arm's decoder posture (§0C.3), never known.
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
(`ConnectionRegistry::open_prepared`, `crates/snapback/src/server.rs`;
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
the must-understand style of `crates/snapback/src/auth/handshake.rs` (pre-upgrade HTTP
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
  shipped behavior, since corrected to the exact decode-class signal under
  `issues/closed/20260725-0094-swift-decode-class-heuristic.md`); B2's
  gate binds the kit because the kit cannot
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

**Stage record (2026-07-27, under
`issues/20260725-0093-p0-wire-version-negotiation.md`):** B1, B2, and B3
are **implemented**, in one landing so the offering kit and the
field-admitting servers never cross a repo state where one exists without
the other:

- **B1** on both arms — local `OpenConnectionRequest.wire_version` +
  registry lineage binding (`crates/snapback/src/server.rs`), hosted `kitOpenConnection`
  reading the member and persisting the binding in a
  `_snapback_connections.wire_version` column (`coordinator.js`); the
  `ConnectionGrant.wireVersion` echo on both; the §0B.4 present-offer
  socket refusals (shared predicate: `crates/snapback/src/wire_version.rs`,
  `classifySocketWireVersionOffer` in `coordinator.js`); and the §0C.5
  alignment. Re-open immutability is enforced in the registry/DO re-open
  branch.
- **B2** — the kit offers `wireVersion: "snapback.v1"` at open
  (`packages/snapback-client/index.mjs`), with the §0B.6 fallback, a
  process-lifetime per-endpoint verdict cache, the structured
  `SNAPBACK_CLIENT_WIRE_VERSION_DOWNGRADED` diagnostic, and an optional
  `strictWireVersion` mode. Concurrent first opens single-flight the
  endpoint probe. An offered success is considered explicitly bound only
  when its echo is exactly `snapback.v1`; a missing echo conservatively
  records/surfaces a legacy downgrade (without an unnecessary second open),
  an unequal echo refuses client-side, and strict mode refuses missing-echo
  and cached-legacy cases rather than opening offerless. Gate reading,
  recorded: B1 exists on every
  in-repo arm in the same tree; toward the not-yet-redeployed shared
  Cloudflare deployment the offer is non-breaking by the §0B.6 hosted
  caveat itself — a pre-B1 hosted open decoder ignores the member and
  answers bytes identical to an offerless open — so the kit offer lands
  with B1 and the shared-deployment redeploy remains the operational
  step that turns the echo on there. (That redeploy executed 2026-07-30:
  a `wireVersion: "snapback.v1"` open against the shared deployment now
  returns the exact echo, and a bogus offer refuses
  `SNAPBACK_WIRE_VERSION_UNSUPPORTED` — probed live, recorded in
  `issues/closed/20260727-cloudflare-redeploy-wire-landings.md`.)
- **B3** — the absent-class socket refusal is **on** (both arms), after
  re-running the §0B.7 enumeration at enablement (record appended
  there). The hosted `/live/stream` proof socket keeps its exemption,
  pinned by fixture (`targets/cloudflare/test/acceptance.wire-version.mjs`).

**B4 remains staged** and unimplemented; its gate and dated-amendment
requirement above are unchanged.

### 0B.6 Client-side legacy-server detection

A pre-B1 local server rejects a `wireVersion`-carrying open as a body
decode failure (closed DTO). The pinned client rule — the trigger is
exact, not heuristic: a **decode-class rejection** is
`SNAPBACK_REQUEST_JSON_INVALID` (HTTP 400; `ApiError::request_json_invalid`,
minted by `parse_optional_json`, `crates/snapback/src/server.rs`) **and** the
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
claims about v1-bound connections only. (The P-2 Swift client formerly
triggered on any 400/422 except `UNSUPPORTED`; that over-broad heuristic is
resolved under
`issues/closed/20260725-0094-swift-decode-class-heuristic.md`.)
The JS kit implements this pin as of B2 (2026-07-27):
the exact HTTP 400 + `SNAPBACK_REQUEST_JSON_INVALID` pair triggers the
differential (the same code at 422 or any other status does not), the
verdict cache is per endpoint for the process lifetime, the downgrade
surfaces as `SNAPBACK_CLIENT_WIRE_VERSION_DOWNGRADED` (client-minted,
`SNAPBACK_CLIENT_*` namespace — deliberately not in the §0E server
registry), and `strictWireVersion: true` refuses with
`SNAPBACK_CLIENT_WIRE_VERSION_STRICT`; a failed differential re-try
records no verdict. Concurrent first opens share one endpoint probe, so the
decode-class differential cannot race into multiple offers. The B1 echo is
also validated: exact `snapback.v1` caches a modern verdict, a different echo
refuses `SNAPBACK_CLIENT_WIRE_VERSION_ECHO_INVALID`, and an absent echo after
an offered success is treated conservatively as an unproven/legacy binding,
surfaced without reopening; strict mode refuses that case and any cached
legacy verdict.

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
detection. (The shared deployment carries B1 as of the 2026-07-30
redeploy; the echo is live there.)

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
- Rust in-crate socket tests (`crates/snapback/src/server.rs` test modules): offer
  `LIVE_STREAM_SUBPROTOCOL` — compliant.
- `targets/cloudflare/test/acceptance.remote.mjs`, `measure.remote.mjs`,
  `targets/cloudflare/test/harness.mjs:364`: offerless, but on the **proof
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
`targets/cloudflare/test/*` (via the gateway with kit-shaped bodies), and Rust
in-crate tests constructing `OpenConnectionRequest` directly. All
inherit B2 when the kit and test fixtures add the offer (the Swift
client offers already); the B4 audit re-runs this enumeration — it is a
repo-wide search for `/connection/open` constructors, not a fixed list —
and must find zero offerless callers before absent may refuse.

**B3-enablement re-run (2026-07-27, this worktree).** The enumeration was
re-run before turning on the absent-class socket refusal, with one
**correction to the record above**: the claim that the Rust in-crate
socket tests were compliant was **wrong** — ten offerless kit-stream
upgrade constructions existed (`crates/snapback/src/server.rs`: the protected-room,
pressure-eviction, and terminal-socket tests; `crates/snapback/tests/admin_v0.rs` ×4
including the header-transport probe; `crates/snapback/tests/concurrency_v0.rs` ×1;
`crates/snapback/tests/route_policy_v1.rs` ×1), and the hosted suites held eleven more
(`targets/cloudflare/test/acceptance.security-hardening.mjs` ×8,
`acceptance.protocol-hardening.mjs` ×1, `acceptance.rqs.mjs` ×1, plus the
kit-socket probe the wire-version suite itself adds). All were brought
compliant (offering `snapback.v1`) in the B3 landing. The rest of the
population re-verified as recorded: the kit (socket offer unchanged, open
offer added at B2), the Swift client, `regression-reconnect-nuke.mjs`,
and `demos/competitive-checkpoint/.../hosted-sender-matrix.mjs` offer;
the offerless `/live/stream` consumers (`harness.mjs`,
`acceptance.remote*.mjs`, `measure.remote.mjs`,
`acceptance.security-hardening.mjs` proof-socket probes) ride the §0B.4
proof-socket exemption; browser demo suites reach the wire through the
kit, and their raw `new WebSocket` uses are Chrome DevTools (CDP)
sockets, not Snapback sockets. Auth-refusal probes that expect
401/403/429 pre-upgrade stay valid: credential gates run before the
version classification on both arms. The **B4 population** is unchanged
in kind — offerless `/connection/open` constructors remain in Rust
in-crate tests, hosted-suite direct opens (including the deliberate
legacy fixtures in `acceptance.wire-version.mjs`), and the bundle-mint
lane — so the B4 gate stays far from met, as intended.

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
| `OpenConnectionRequest` (`crates/snapback/src/server.rs:4081-4094`) | **closed** | `connection.open.input.schema.json`, closed | stays closed; the §0B.5 B1 member and LLP 0136's staged `liveSearchProtocol` member are sanctioned gated evolution paths |
| `AuthorizationInvalidationAckInput` (`crates/snapback/src/local/live_protocol.rs`) | **closed** | closed | stays closed |
| manual-retry input (`crates/snapback/src/local/live_protocol.rs`, `AuthorizationInvalidationManualRetryInput`) | **closed** | closed | stays closed |
| `SessionLiveSocketClientMessage` (`crates/snapback/src/server.rs`, sessions-mode socket) | **closed** (auth-mode-dependent third family) | `live.socket-client.sessions.schema.json`, closed (committed 2026-07-27, closing the §0F item-4 gap) | stays closed |
| `LiveSubscribeInput` / `LiveResumeInput` / `LiveUnsubscribeInput` (`crates/snapback/src/local/live_protocol.rs`) | **open** | open | **stays open** — LLP 0091's `resumeFromToken` rides the open subscribe body as its compatible fallback, and closing an open decoder changes observable behavior for every deployed caller; the silent-feature-off hazard is mitigated by response witnesses: `resumeRefusal` for token resume, and `superseded` or `supersessionRefusal` for every presented `supersedes` id |
| `HandlerInput` (`crates/snapback/src/manifest.rs`) | **open** | open (`query.input` / `mutation.input`) | stays open (it is the app-args carrier; the sessions-mode body-auth **rejection family** of LLP 0031 is the enforced closed subset — auth-bearing members are rejected, not ignored) |
| dev-mode socket client message (`LiveSocketClientMessage`, `crates/snapback/src/live_wire.rs`) | **open** | `live.socket-client.schema.json` | stays open in dev mode; sessions mode already substitutes the closed family above |
| `AuthorizedLeaseQueryRequest` (`crates/snapback/src/server.rs`) | **closed** | `authorized-lease.query.input.schema.json`, closed | stays closed (exact-protocol lease surface, LLP 0043/0053) |
| client-mutation acknowledge input (`client-mutation.ack.input.schema.json`) | **closed** | closed | stays closed |
| `/app/ensure` intent body (`EnsureAppInput` / `EnsureAppExplicitInput`, `crates/snapback/src/local.rs`) | **closed** (`deny_unknown_fields` on the legacy struct and every intent variant) | `app.ensure.input.schema.json`, closed definitions | stays closed (v0.2 misclassified this row open — corrected; the closed-family gating rule applies to any addition). Hosted `kitEnsureApp` decodes it open, per §0C.3 |
| `/app/bundle` request (`app.bundle.input.schema.json`) | **open** | open | stays open (LLP 0090's dated amendment owns evolution) |
| ephemeral HTTP requests (`PublishRequest`/`SubscribeRequest`/`DeleteRequest`, `crates/snapback/src/ephemeral.rs`) | **open** | `ephemeral.publish.input` / `ephemeral.subscribe.input` / `ephemeral.delete.input` schemas (committed 2026-07-27; the dev wire shape — sessions mode substitutes the closed identity-free `Session*` DTOs per §0A.7) | stays open |

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
| `AuthorizationInvalidationSnapshot` (`crates/snapback/src/live_wire.rs:128-136`) | **closed** (`additionalProperties: false`) | additions need gating per the rule above |
| `AuthorizationInvalidationAckOutput` (`crates/snapback/src/local/live_protocol.rs`) | **closed** | same |
| `LiveSubscribeOutput` / `LiveUnsubscribeOutput` / `LiveResumeOutput` | open objects | additive optional fields are the sanctioned in-v1 evolution (server→client direction). Exercised 2026-07-30: subscribe/resume outputs gained optional `attribution` (the LLP 0055 §Audit block, same `FunctionAttribution` type as the finite envelopes) — establishment-derived, immutable subscription metadata re-answered unchanged on resume; schemas regenerated under the LLP 0051 §D4 drift gates |
| `RealtimeEnvelope` drain wrapper (`realtime.envelope.schema.json`) | closed | lane-P framing only |
| `RealtimeEnvelope::EphemeralAck` | nominally closed variant with a flattened ack payload | deliberate unknown-field-detection exception: serde `flatten` consumes extra top-level members into the ack payload, so a generic closed-envelope decoder cannot distinguish a future wrapper field. Do not seed an unknown-field tolerance fixture for this variant until the payload is typed or flattening is removed |
| `ConnectionGrant` (`connection.grant.schema.json`) | open object | the §0B.3 `wireVersion` echo lands here as the sanctioned additive member |
| `ErrorResponse` (`error.response.schema.json`) | **versioned, forward-additive v1** | required `formatVersion: "snapback.error-response.v1"` and `diagnostic`; optional `receipt`/`attribution`/`ephemeralAuthorityInstance`; receivers reject an unknown format version but ignore unknown top-level members of v1. The inner `Diagnostic` remains closed and requires `code`/`severity`/`subsystem`/`message`/`details` — see §0C.7 |
| `MutationResponse` (`mutation.output.schema.json`) | **closed** | `attribution` is admitted explicitly since the §0C.6 item-4 convergence (2026-07-27): the type carries `Option<FunctionAttribution>` directly and the schema is regenerated from the served envelope |
| `QueryOutput` / action output (`QueryOutput` in `crates/snapback/src/manifest.rs`; the action route serves `FunctionResponse<FunctionRunResult>`, `crates/snapback/src/local.rs`) | open | `query.output.schema.json` / `action.output.schema.json` (committed 2026-07-27); open families, so the served `FunctionResponse` attribution flatten validates |
| `/app/ensure` outcomes (`EnsureAppAttestOutcome` / `EnsureAppProvisionOutcome` / legacy `EnsureAppOutcome`, `crates/snapback/src/local.rs`) | **closed** (`deny_unknown_fields`; `additionalProperties: false` in `app.ensure.output.schema.json`) | closed-family rule: additions need gating or a new token (v0.2 misclassified this row open — corrected) |
| `/app/bundle` output (`app.bundle.output.schema.json`) | open object | additive-optional evolution, same rule as the live outputs |
| `AuthorizedLeaseQueryResponse` / lease envelope (`authorized-lease.*` schemas) | **closed** | exact-protocol surface; evolution under LLP 0043/0053, cited not restated |
| client-mutation acknowledge output (`client-mutation.ack.output.schema.json`) | **closed** | stays closed |
| ephemeral HTTP outcomes (`crates/snapback/src/ephemeral.rs`) | open | `ephemeral.publish.output` (`PublishOutcome`) / `ephemeral.subscribe.output` (`EphemeralMessage`) / `ephemeral.delete.output` (nullable `EphemeralMessage`) schemas, committed 2026-07-27 |

### 0C.7 ErrorResponse format version and forward skew (2026-08-08)

Every non-2xx JSON `ErrorResponse` now carries the required exact member
`formatVersion: "snapback.error-response.v1"`. The token is
must-understand: a receiver that does not recognize it refuses the envelope
rather than guessing its semantics. Within recognized v1, top-level evolution
is additive: receivers **must ignore unknown top-level members** while still
validating the known members they consume. The Rust decoder therefore no
longer uses `deny_unknown_fields`, the generated schema admits additional
members, the Swift `WireErrorResponse` decoder recognizes the v1 token while
field-plucking known members, and the hosted gateway/coordinator/platform
emitters all compose the same versioned envelope. Positive tolerance and
unknown-version negative witnesses live in the schema drift and Swift client
suites.

This amendment changes only versioning/forward-skew mechanics. The known v1
members are `diagnostic`, optional `receipt`, optional `attribution`, and
optional `ephemeralAuthorityInstance`. It does **not** add or reserve a
remediation member, select a remediation carrier, or otherwise decide LLP
0146 OQ6; typed suggestions continue to ride only the already-governed
diagnostic `details` allowlists until that separate question is decided.

### 0C.8 Sessions live-update envelope and delivery multiplicity

For one live subscription, a commit version that changes its result **MUST
produce exactly one content frame for that subscription and version in one
delivery turn**. A server MUST NOT publish the same snapshot through both a
queued durable frame and a direct level-triggered projection. Independent
redelivery after loss, reconnect, or absence of the exact acknowledgement is
still permitted and required by the obligation protocol; that later retry is
not permission to emit byte-identical copies in the same delivery turn.

In sessions mode, an auth-scoped data change is delivered as an
`authorization_invalidation` envelope whose `snapshot` carries the replacement
rows. This does not assert that the authorization policy changed. The wrapper
is used because ordinary auth-scoped replacement — including any potentially
shrinking result — raises a persistent quarantine delivery obligation. The
envelope atomically binds that obligation, its resolution ticket, and the
replacement snapshot, so only the exact post-apply acknowledgement discharges
the reliable row-delivery obligation. Each subscription owns one such scope;
the envelope is not multiplied by the number of negotiated auth protocols.

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

Before B1 an **unknown** `authInvalidationProtocol` value silently
degraded to a legacy connection (`crates/snapback/src/server.rs` — exact-match-v1 else
`None`), the opposite of §0B.3's unknown-refuses rule for the adjacent
field. Decision: **aligned to refuse** — implemented 2026-07-27 with B1
on both arms (`open_connection`, `crates/snapback/src/server.rs`; `kitOpenConnection`,
`coordinator.js`, which reads the member for exactly this refusal while
still implementing no invalidation surface). From stage B1, both offer fields
on `/connection/open` follow one matrix — known binds, unknown refuses
(`SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED`), absent degrades to
legacy. Rationale: a client offering invalidation-protocol v2 must not
be silently downgraded to v1 semantics it may be unable to satisfy
(exact-token doctrine, LLP 0064); blast radius is empty — the only
value any in-repo caller ever offers is `1`, and absent behavior is
unchanged, so no deployed caller observes the difference. The change
ships inside B1, not independently, so the two fields' semantics never
diverge again. On the hosted open decoder, conflicting camelCase and
snake_case alias values are unsupported rather than silently preferring one;
the local closed serde DTO already refuses duplicate aliases at decode time.

### 0C.6 Response-shape divergences (audited at `137dee8c`): defects, not contract

The precedence rule (Summary) holds the committed schemas as the
contract target on both arms. This ledger enumerates every audited place
where served bytes **as of the audit** did not satisfy them. Divergences
are **defects** — tracked by
`issues/20260725-0094-hosted-response-shape-divergences.md` — not
renegotiated contract.

**Convergence record (2026-07-27, executed under the ticket):** items
1–4 and 6–9 are **converged** — the emitters now satisfy the committed
schemas, with per-item assertions plus a schema-validating audit gate in
`targets/cloudflare/test/acceptance.wire-shapes.mjs` (registered in the
non-remote local suite). The per-item entries below keep the audited
divergence as a dated historical record and note what converged. The
former caveat — clients targeting the hosted arm MUST tolerate the
enumerated shapes, and conformance claims on affected tuples carry this
ledger by reference — is **retired for the converged items**: served
bytes on those lanes are the committed schemas, and no tolerance license
remains. (The shared Cloudflare deployment was redeployed 2026-07-30 and
serves the converged shapes; verified by the remote acceptance run and
wire-version probes recorded in
`issues/closed/20260727-cloudflare-redeploy-wire-landings.md`.)

1. **Hosted `/mutation/{name}`** (`kitMutation`, `coordinator.js`)
   returned `{version, changed_count, result}` — no `receipt`, which
   `mutation.output.schema.json` requires. **Converged 2026-07-27**: the
   route emits the required terminal mutation receipt with honest
   hosted facts — a per-invocation minted `mutationId` (this arm has no
   client-mutation replay ledger, so `clientMutationId` is never
   echoed), declared-write-set `affectedTables` (`null` = explicitly
   unknown), `snapshotVersion` at the commit, `transport: "http"`, and
   the caller's opaque `correlation` echoed verbatim. Hosted rejected
   mutations still omit the *optional* `ErrorResponse.receipt` member:
   this arm has no retention ring, and its failure lane cannot yet
   distinguish gate refusals from post-admission rejections, so it does
   not fabricate a receipt boundary it does not have.
2. **Hosted `/live/{name}/unsubscribe`** (`kitUnsubscribe`) returned
   `{removed: true}` — neither `subscription_id` nor `disposed`, both
   required by `live.unsubscribe.output.schema.json`. **Converged
   2026-07-27**: the route answers `{subscription_id, disposed}`;
   unknown/foreign ids answer `disposed: false` (the session-scoped
   delete is this arm's ownership cut, unlike the local arm's
   ownership refusal).
3. **Hosted error envelopes** (`kitError`/`kitFailure`) emitted
   `{diagnostic: {code, message[, details]}}` — the envelope shape was
   right, but the inner `Diagnostic` omitted `severity` and `subsystem`
   and made `details` optional, all required by the schema. **Converged
   2026-07-27**: every kit-lane emitter composes the full Diagnostic
   through `targets/cloudflare/src/wire-diagnostic.js`, whose code-family →
   subsystem classification mirrors the local vocabulary (`realtime`,
   `server`, `storage`, `auth`, default `runtime`) and always emits
   `details` (`{}` when empty, the local default).
4. **Local function responses** rode `FunctionResponse<T>`
   (`crates/snapback/src/server.rs`), which serde-flattened an optional `attribution`
   member onto the output; `mutation.output.schema.json` is closed and
   did not admit it, so a sessions-mode mutation response with
   attribution violated the committed schema on the **local** arm — the
   one schema-side divergence. **Converged 2026-07-27** by admitting
   `attribution` explicitly: `MutationResponse` carries
   `Option<FunctionAttribution>` directly (the mutation route no longer
   wraps in `FunctionResponse`), and `mutation.output.schema.json` was
   regenerated (`snapback-schemagen`; served bytes unchanged, the
   member set is identical). The schema stays closed.
5. **Hosted `/query/{name}`** (`kitQuery`) returns `{version, rows}` —
   shape-compatible with `QueryOutput` (no committed standalone schema;
   §0C.2 gap row), noted here for completeness, not a schema violation.
6. **Hosted in-band durable subscribe replies** (§0A.1 WS-kinds row):
   plain (non-resume) subscribe answered proof-dialect
   `{type: "snapshot", …, connectionKey}` and every in-band error was
   proof-dialect `{type: "error", code, …}` — frames outside both
   committed socket-frame families. **Converged 2026-07-27** to kit
   dialect on kit sockets: `kind: "snapshot"` with the same snake_case
   members as the kit `live_replace`/`current_as_of` frames (no
   proof-only `connectionKey`), and `kind: "error"` carrying the full
   committed `Diagnostic`; `pong`/`current_as_of` were already kit
   dialect, and unsubscribe keeps its no-reply semantics. Proof sockets
   keep the LLP 0040 pinned `type`-tagged frames byte-for-byte.
   The now-uniform reply grammar entered the drift gates on 2026-07-27
   through `KitSocketReplyFrame` /
   `live.kit-socket-reply.schema.json`, completing §0F item 2.
7. **Hosted kit-route request-parse refusals** (`requestDiagnostic` via
   `parseJsonObjectRequest`, `coordinator.js`) emitted
   `{ok, code, message, diagnostic}` — top-level members the then-closed
   `ErrorResponse` did not admit, plus the under-filled inner
   `Diagnostic` of item 3. **Converged 2026-07-27**: kit routes parse
   with `errorDialect: 'kit'` and refuse with the versioned ErrorResponse;
   the LLP 0040 proof and `/_snapback/*` system/testing lanes keep the
   pinned `{ok, code, message, diagnostic}` shape (outside the
   governance rule below, byte-pinned by the protocol-hardening suite).
8. **Gateway-lane refusals** (`targets/cloudflare/src/gateway.js`): kit-route
   method refusals emitted an under-filled `Diagnostic`
   (`SNAPBACK_METHOD_NOT_ALLOWED`); the kit-stream non-upgrade branch
   emitted `{error: "expected websocket upgrade"}` (426) and the
   `/_snapback/*`/fallthrough 404s emitted `{error: "not found", path}`
   — no `diagnostic` envelope at all. **Converged 2026-07-27**: method
   refusals fill the Diagnostic (with `path`/`expectedMethod` details);
   the non-upgrade 426 mints `SNAPBACK_UPGRADE_REQUIRED` (the same code
   the coordinator's own pre-upgrade gate mints); the `/_snapback/*`
   and fallthrough 404s mint `SNAPBACK_ROUTE_UNKNOWN` diagnostics. The
   `/__exact/*` asset-lane JSON 404s are Exact-protocol surface and
   deliberately keep their shapes (pinned in the audit gate's
   exemption inventory).
9. **Hosted platform-failure responses on kit routes**
   (`platformFailureResponse`, `targets/cloudflare/src/platform-errors.js`,
   non-proof branch): `{diagnostic: {code, message, details}}` with the
   under-filled inner `Diagnostic` (no `severity`/`subsystem`; `details`
   dropped when undefined). **Converged 2026-07-27**: the kit branch
   composes the full Diagnostic and never drops `details`.

Governance decision (answers what the envelope rule covers):
`error.response.schema.json` governs **every** non-2xx JSON failure on
§0A.1 kit routes on both arms — gateway lane, parse lane, platform lane,
and handler lane alike; items 3 and 7–9 were the audited divergences from
that rule. The convergence also brought the previously-unenumerated
kit-lane emitters under the rule: the `appBundle` failure helper, the
action kind-mismatch 400, the coded-refusal catch
(`SNAPBACK_CAPABILITY_UNSUPPORTED` et al.), and the stale-deployment 409
now emit the governed ErrorResponse **on kit routes only** (proof/system lanes
keep their pinned shapes). The ledger enumerates **emitter functions**,
not sampled responses; the executable audit the ticket owned is
implemented in `targets/cloudflare/test/acceptance.wire-shapes.mjs`: it
schema-validates every enumerated lane's served bytes against the
committed schemas AND pins the exact fingerprint set of remaining
non-`wireDiagnostic` 4xx/5xx emitters in the served sources, so a **new**
non-conformant error emitter fails the suite. The broader hosted-side
response-schema gate landed the same day as
`targets/cloudflare/test/wire-schema-gate.mjs` (§0F items 1/3): conformant kit
routes are hard-validated against the committed schemas, and its
`KNOWN_DIVERGENT` allowlist — seeded from this ledger — shrinks to empty
with this convergence. Nothing in this ledger is an evolution precedent.

## 0D — Subscription receipt typing (implemented)

`LiveSubscribeOutput.receipt` and `LiveUnsubscribeOutput.receipt` were
`Option<serde_json::Value>` (`crates/snapback/src/local.rs:674,774` at `e1edbbc1`) — the
untyped compatibility seam LLP 0093's version-domain section names. With
this spec they are `Option<crate::live_wire::Receipt>`:

- both emission sites construct the typed `Receipt::Subscription` and
  convert to `Value` only at the retention-ring boundary
  (`Receipt::into_value`, which predates the typed wire);
- `schemas/live.subscribe.output.schema.json` and
  `live.unsubscribe.output.schema.json` are regenerated in the same
  change (`cargo run --bin snapback-schemagen`), so the `receipt` member
  now references the `Receipt` union definition instead of `true`;
- the `crates/snapback/tests/artifact_schemas_v0.rs` instance test upgrades its
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
| `SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION` | existing invocation status | query/live/mutation/action response | the handler's post-JSON output violates its effective LLP 0108 contract or egress ceiling; the ordinary error envelope carries bounded operation/hash/kind/path facts and never the rejected value |

LLP 0108 adds no `ExpectedOperationV1`, compatibility-policy offer, request
member, response member, socket subprotocol, or resume/replay tuple in this
version. Generated references retain the existing whole-artifact compatibility
behavior. Result-contract validation is an implementation seam behind the
existing query/live/mutation/action envelope families; only the structured
refusal above is additive to this registry.

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
`live_owner_mismatch` / the same ownership predicate (`crates/snapback/src/local.rs`;
predicate `LiveSubscription::is_owned_by` →
`RetainedLiveAuthority::matches`, `crates/snapback/src/auth/invocation.rs` — resolved
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

Audit at `6fe11376` of what remained outside the schema drift gates
(`crates/snapback/tests/artifact_schemas_v0.rs` + `demos/_kit/tests/live-wire-schema.mjs`);
items 1–4 were **executed 2026-07-27** under the item-1 ticket
(`issues/20260725-0093-p0-marker-envelope-schemas.md`):

1. **The LLP 0060 D6 private marker envelopes** — the
   coordinator→handler invocation request, the handler→coordinator
   response envelope, and the handler→host call body, live on both arms
   (`packages/snapback-harness/workerd/handler-server.mjs`,
   `targets/cloudflare/src/coordinator.js` `serveHostCall` / `invokeHandler`,
   `crates/snapback/src/workerd_exec.rs` loopback transport) and previously
   hand-mirrored JS↔JS↔Rust; being private is not a hand-mirror
   exemption. **Implemented 2026-07-27**: Rust authorities in
   `crates/snapback/src/handler_wire.rs` (`HandlerInvokeRequest` /
   `HandlerInvokeResponse` / `HandlerHostCallRequest`), committed as
   `handler.invoke.input` / `handler.invoke.output` /
   `handler.host-call.input` schemas with positive/negative instances in
   `crates/snapback/tests/artifact_schemas_v0.rs`. The schemas contract the envelopes
   **as served today** (closed emission; tolerant field-pluck
   receivers): the D6 `SNAPBACK_AUTH_HANDLER_V1` versioned marker set is
   still unimplemented on every arm, and its semantics, rollout, and
   future field evolution stay owned by LLP 0060 D6. Real produced
   bytes are validated on both arms: the local twin serializes the
   authority type and validates workerd-produced response/host-call
   bytes through a capture seam
   (`crates/snapback/tests/workerd_twin_v0.rs::handler_boundary_wire_bytes_validate_against_committed_schemas`),
   and the hosted arm's service-binding bytes are captured and
   validated by `targets/cloudflare/test/wire-schema-gate.mjs`.
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
   **inside wire v1** — **implemented 2026-07-27** as
   `live.kit-socket-request.schema.json` (authority
   `KitSocketRequestFrame`, `crates/snapback/src/live_wire.rs`), with verdict parity
   between the served validator and the schema proven over a shared
   corpus (Rust fixtures in `crates/snapback/tests/artifact_schemas_v0.rs`; served-arm
   corpus in `wire-schema-gate.mjs`). The in-band **reply** grammar
   converged to kit dialect the same day (§0C.6 item 6) and is
   **implemented** as `live.kit-socket-reply.schema.json` (authority
   `KitSocketReplyFrame`, `crates/snapback/src/live_wire.rs`). Positive/negative Rust
   instances cover the closed grammar, and `wire-schema-gate.mjs`
   validates real served `pong`, `snapshot`, `current_as_of`, and `error`
   frames against it. Schematizing the previously mixed as-built replies
   would have contracted the wrong protocol; the proof-socket exemption
   remains scoped to that socket only.
3. **The hosted kit-route response composition** (`kitSubscribe` et al.
   compose subscribe outputs in JS): governed by the committed schemas
   but previously with no hosted-side executable drift gate.
   **Implemented 2026-07-27**: `targets/cloudflare/test/wire-schema-gate.mjs`
   (a `local-suite` gate) validates the served bytes of the conformant
   kit routes (`/connection/open`, `/live/{name}/subscribe`,
   `/query/{name}`, `/outbox/{connection_id}`, `/app/ensure`) against
   the committed schemas; the §0C.6-ledgered divergent emitters ride
   its single `KNOWN_DIVERGENT` allowlist (report-only) until the
   convergence ticket fixes them.
4. **Families typed in Rust but without standalone committed schemas**
   (audited, §0C's gap rows): `QueryOutput` and the action output, the
   ephemeral HTTP request/outcome families, and
   `SessionLiveSocketClientMessage` (the sessions-mode socket family —
   its schema absence was an oversight, not an LLP 0043 exemption; the
   sessions surface governs its semantics, this spec owned its
   schema-commitment gap). **Implemented 2026-07-27**: committed as
   `query.output` / `action.output` / `ephemeral.{publish,subscribe,delete}.{input,output}`
   / `live.socket-client.sessions` schemas through the same export
   mechanism (updated §0C rows carry the per-family facts). The §0A.5
   drain response likewise gained `live.outbox-drain.output.schema.json`
   with the served path moved onto its authority type.
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
§0A.3 migration. Landed with the 2026-07-27 §0F execution: the extended
`artifact_schemas_v0` instance fixtures, the local twin real-bytes
capture test (`workerd_twin_v0`), and
`node targets/cloudflare/test/wire-schema-gate.mjs` (registered in
`local-suite-manifest.mjs`). The §0B/§0C.5 server changes land under their ticket
with: offer-matrix acceptance fixtures on both arms (known/unknown/absent
× open/socket), the socket-refusal style test mirroring
`crates/snapback/src/auth/handshake.rs`, and a re-run of the §0B.7 enumeration recorded
in the landing commit. The §0C.6 convergence lands under its own ticket
with hosted response-schema assertions in the Cloudflare acceptance
suite for each ledger item. The §0F item-2 reply residual extends the
artifact-schema instances and the hosted wire-schema gate with all four
served kit reply variants.

Landed with the B1–B3 stage record (2026-07-27): `cargo test --lib
wire_version` (the pure predicates plus the registry/HTTP/socket offer
matrices in `server::tests`); `cargo test --test artifact_schemas_v0
--test admin_v0 --test route_policy_v1 --test concurrency_v0`;
`node targets/cloudflare/test/local-suite.mjs` (now 23 suites, including
`acceptance.wire-version.mjs`, 23/23 checks); the `@snapback/client`
package suite including `wire-version.test.mjs`;
`node demos/_kit/tests/live-wire-schema.mjs`; schema regen via
`snapback-schemagen` + the todo-v2 remote-service codegen; and
`./ref-check --verbose`.

## Decisions log (review loop)

- **B1 echoes the bound version** as an additive `ConnectionGrant`
  member (round 1; both families independently converged on it). The
  echo witnesses the lineage's **explicit binding** — never emitted for
  legacy lineages, emitted on every open/re-open response of an
  explicitly bound lineage (§0B.3).
- **In-band durable subscribe on the hosted kit socket** (round 2,
  implemented 2026-07-27): the request surface is served and the reply
  grammar converged to kit dialect (§0A.1, §0C.6 item 6). Both directions
  now have committed schemas and hosted executable gates, so the in-band
  entry point is conformance-claimable; the HTTP subscribe/unsubscribe
  entry point remains available with a current socket session.
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

## LLP 0110 hidden-qualification wire amendment — 2026-07-28

The acceptance-only qualification protocol is `sqg1`. It is not an ordinary
client capability offer and never appears in generated application APIs.

The route matrix gains exactly:

| Route | Qualification carrier |
| --- | --- |
| `POST /connection/open` | optional closed DTO members `qualificationGrant` (compact `sqg1`, max 8,192 bytes) and `qualificationUse` |
| `POST /query/{name}` | paired `Snapback-Qualification-Grant` and `Snapback-Qualification-Use` headers |
| `POST /mutation/{name}` | paired `Snapback-Qualification-Grant` and `Snapback-Qualification-Use` headers |
| `POST /live/{name}/subscribe` | no free token; inherits the qualification session immutably bound to the connection token |

The two carriers are paired: one without the other is a body/header decode
refusal. Unknown grant versions, oversize values, duplicate headers, or either
carrier on any other route return a bounded `SNAPBACK_QUALIFICATION_*` refusal
before function evaluation. The sender-proof canonical request binds the exact
compact grant and use nonce. The open response adds no reusable qualification
secret; its ordinary connection token is server-bound to the qualification
session. WebSocket/live frames carry only that existing connection token and
cannot switch candidate generation or grant.

Qualification errors use the existing error-envelope family and never expose
candidate function inventory, remaining budget, signature bytes, or whether a
different hidden generation exists.

## LLP 0113 corrective wire closure — 2026-07-28

LLP 0113 owns the complete `QualificationUseV1` grammar, signature preimage,
operation-specific optionality, durable reservation order, replay retention,
budgets, and refusal matrix. The route carriers above are unchanged, except
that their `qualificationUse` value is the compact JCS object defined there
and is bounded to 2,048 bytes. Ordinary authentication precedes qualification
diagnostics. After ordinary auth, the exact qualification status assignments
are 400 for malformed/unsupported/pair-required/route-forbidden, 403 for
refused/expired, 409 for replay-mismatch/candidate-unavailable, 429 for budget
exhaustion, 410 for collected replay, and 503 for unavailable durable state.

This Draft also reconciles the pre-existing invalidation refusal conflict:
`SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED` is HTTP **400**, as already
registered in §0E and emitted by the server. It means the authenticated client
omitted or mismatched the must-understand invalidation offer. Retrying unchanged
is incorrect; the caller repairs the offer. LLP 0113 is the later addendum to
Accepted LLP 0058 for this status assignment.

### Hosted-ephemeral authority instance

The generated and hand-served wire families gain one negotiated protocol:

| Boundary | Required members |
| --- | --- |
| `POST /connection/open` request | optional `ephemeralAuthorityProtocol: 1` offer |
| successful open/reopen response | exact echo `ephemeralAuthorityProtocol: 1` and `ephemeralAuthorityInstance` |
| every hosted ephemeral HTTP or socket request | the bound `ephemeralAuthorityInstance` |
| every hosted ephemeral success, refusal, acknowledgement, snapshot, change, resync, drain, and final frame | the same bound `ephemeralAuthorityInstance` |

`ephemeralAuthorityInstance` uses the closed scalar `eai1.<43 unpadded
base64url characters>`. It is opaque and comparison is byte equality. The
flattened acknowledgement envelopes are not an exception: their existing
top-level shape adds the same required member. No receiver derives or rewrites
it from a connection id.

A missing offer preserves legacy local operation and withholds the hosted
ephemeral capability. A hosted target claiming that capability requires the
offer and exact response echo. Missing, old, or mismatched instance values use
the hosted-ephemeral stale-authority refusal and force reconnect/resnapshot;
unknown protocol versions use the ordinary must-understand HTTP-400 refusal.
Every committed schema, Rust authority type, hosted serializer, JS client
validator, and real-served-byte gate must agree on the matrix. A serializer
that cannot stamp the bound instance withholds the hosted claim rather than
emitting a partially governed frame.

## Unreviewed post-round wire closure — 2026-07-28

This section supersedes the incomplete route and hosted-ephemeral tables above.
It applies the terminal LLP 0113 review dispositions, has not received a
further independent review, and does not advance this Spec beyond Review.

### Qualification transport

The complete route matrix is:

| Route/boundary | Grant carrier | Use carrier |
| --- | --- | --- |
| `POST /connection/open` new/reopen | required closed `qualificationGrant` body member | required closed `qualificationUse` body member |
| `POST /query/{name}` | required `Snapback-Qualification-Grant` header | required `Snapback-Qualification-Use` header |
| `POST /mutation/{name}` | required `Snapback-Qualification-Grant` header | required `Snapback-Qualification-Use` header |
| `POST /live/{name}/subscribe` over a qualification-bound connection | **forbidden**, inherited immutably from the connection | required `Snapback-Qualification-Use` header |
| in-band socket `subscribe` over a qualification-bound connection | **forbidden**, inherited immutably from the connection | required closed `qualificationUse` frame member |

The paired-carrier rule applies to open, query, and mutation. Live subscribe is
the sole use-only exception: a use on an ordinary connection, a grant supplied
on subscribe, or a missing use on a qualification-bound connection refuses.
The live use binds connection and function but omits the server-assigned
subscription id; reservation atomically assigns and retains that id. No later
frame carries a grant or use.

For open, `requestBodySha256` hashes JCS of the successfully decoded body after
removing `qualificationGrant` and `qualificationUse`; for the socket frame it
removes `qualificationUse`; an empty body hashes the empty byte string. The
sender-proof extension separately binds method, canonical route template,
function id, that carrier-stripped digest, and SHA-256 of the exact compact
grant/inherited-grant and use bytes under LLP 0113's domain. This prevents the
open-body carrier from recursively hashing itself.

Before ordinary authentication, only the route's generic transport byte/time
ceiling may refuse and it emits no qualification-specific code. After
authentication, the server decodes carriers, verifies signatures/bindings, and
applies LLP 0113's journal-first replay/expiry precedence and refusal matrix.

### Hosted-ephemeral per-boundary contract

The protocol token is the JSON integer `1`. The former string token
`"ephemeral-authority.v1"` is invalid. The exact carriers are:

| Boundary | Offer/presentation | Required response/frame |
| --- | --- | --- |
| local legacy open | offer absent is permitted | protocol/instance absent |
| hosted-authority-required open/reopen request | body `ephemeralAuthorityProtocol: 1` | body echo `ephemeralAuthorityProtocol: 1` plus `ephemeralAuthorityInstance` |
| hosted ephemeral HTTP publish/subscribe/delete/drain/ack | `x-snapback-ephemeral-authority-instance: <eai1 token>` | every success and error body carries `ephemeralAuthorityInstance` |
| hosted ephemeral WebSocket upgrade | offered subprotocol `snapback.ephemeral-authority-instance.<eai1 token>` beside the connection/sender-proof subprotocols | selected ordinary live subprotocol; the bound instance is stamped in every snapshot/change/upsert/remove/ack/resync/drain/error/final frame |
| in-band socket ephemeral request after upgrade | no duplicate free instance member; the upgrade-bound value controls | every response/frame carries the upgrade-bound instance |

The connection grant lineage contains
`hostedEphemeralAuthorityRequired: true` whenever a current hosted admission
provides the single-instance sticky-memory profile. On that lineage the server
must not accept an offerless open or `(expected=None, presented=None)`;
absence is legal only for legacy local operation whose lineage carries false.
An exact instance is opaque `eai1.<43 unpadded base64url characters>`.

The stable status matrix is:

| Code | HTTP/pre-upgrade status | Meaning and recovery |
| --- | ---: | --- |
| `SNAPBACK_EPHEMERAL_AUTHORITY_UNSUPPORTED` | 400 | required offer absent or unsupported; negotiate protocol 1 |
| `SNAPBACK_EPHEMERAL_AUTHORITY_PROTOCOL_MISMATCH` | 400 | reopen/request lineage disagrees with the bound protocol; open a new connection |
| `SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_REQUIRED` | 400 | governed HTTP/upgrade request omitted the bound instance; reconnect |
| `SNAPBACK_EPHEMERAL_AUTHORITY_INSTANCE_CHANGED` | 409 | presented instance differs from the connection/admission epoch; reconnect and resnapshot |

When a mismatch is detected before socket upgrade, the ordinary generated
error envelope carries the table status. After upgrade, the server emits one
generated error frame stamped with the current instance when safe, closes the
socket, and requires reconnect/resnapshot; it never continues under a replaced
authority. Generated schemas, Rust authorities, hosted serializers, client
validators, and the four-way old/new local/hosted corpus use this table
literally.

## LLP 0136 live-search protocol amendment — 2026-08-02

Accepted LLP 0136 stages an optional integer `liveSearchProtocol` member on
the closed `OpenConnectionRequest`. Value `1` binds cursor-aware live-search
decoding to the connection lineage and is immutable across authenticated
reopens. An unknown value refuses open with
`SNAPBACK_SEARCH_LIVE_PROTOCOL_UNSUPPORTED`; absence creates a legacy lineage
on which live-search subscribe refuses with
`SNAPBACK_SEARCH_LIVE_CLIENT_UNSUPPORTED`. No response echo is added:
unknown-refuses makes a successful offered open the binding witness, matching
the `authInvalidationProtocol` precedent.

This member is capability-preflighted: generated clients offer it only toward
a target advertising `live_full_text_search_v1`, and the hosted open decoder
must read and enforce it rather than silently feature it off. The staged
amendment requires the §0C.5 matrix row, connection-record subscribe check,
regenerated closed input schema, hosted decoder, and LLP 0093 offered/legacy/
unknown fixtures when implementation lands. None is claimed present by this
docs-only fold.

## LLP 0109 versioned-seed wire reconciliation — 2026-08-03

Accepted LLP 0109 (author acceptance 2026-08-03, decision sitting #2
extension, `issues/20260803-author-decision-sitting-2.md`) lands its closed
request/response/reset families **outside** wire v1's client-visible
matrix: the four carriers live under the reserved admin namespace
(`/_snapback/api/app/seed/{ensure-v1,preview-v1,reset-install-v1,clear-v1}`
— §0A.2's rule, LLP 0031's matrix owns them) with the
`app.seed.{ensure,preview,reset-install,clear}.v1` host operations, whose
closed Rust-owned bodies ride only under `HostOpsRequest.input`; wrapper
fields never enter the seed request digests, and host failures use LLP
0024's understood-failure HTTP-200 envelope. Consequences for this
contract:

- `/app/ensure` is unchanged in both directions: the §0C.1 closed intent
  body row and the §0C.2 closed outcomes row gain no `install` member (LLP
  0109 §15.3 supersedes its §3.1 sketch for the first landing), and the
  hosted `kitEnsureApp` open-decode + seed-if-empty row stays as recorded.
- No legacy fallback exists on the wire: a versioned client that cannot
  preflight `versioned_seed_install_v1` / `versioned_seed_reset_v1`
  (`supportedCapabilities` ids) refuses locally with
  `SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED` and never retries through
  legacy `provision`, untagged ensure, or the legacy reset carriers.
- The hosted arm advertises neither capability id: hosted compiled-seed
  custody is the conformance manifest's declared GAP row
  (`tests/conformance/versioned-seed-v1.manifest.json`); LLP 0040's dated
  amendment owns the compiled-identity invariant that arm must satisfy
  first.

This is a docs reconciliation of shipped, locally conformance-gated
surface; it adds no new wire obligation to v1 clients.

## LLP 0157 finite-carrier completeness amendment — 2026-08-04

This section is the normative closed-record amendment authorizing the finite
completeness carriers. It supersedes §0C.2 only for the exact optional members
listed here; all other closure/evolution rules remain unchanged.

The ordinary `POST /query/{name}` request's closed carrier becomes
`FiniteQueryRequest`, which flattens the unchanged `FunctionCallRequest` fields
and adds optional `completenessNamespace: QueryNamespace` plus optional bounded
`priorCompletenessProofs: CompletenessProofV1[]`. The namespace is a
non-authorizing request context: it names the exact `clientStoreId`, admitted
`qmk1` `queryKey`, and positive `queryInstanceId` that the proof must bind.
The prior-proof array is absent/empty on a first page and is accepted only
beside that namespace for snapshot-batch continuation composition. Every
presented proof is verified under the current trusted activation before it can
contribute to a manifest.

The successful ordinary query response and the closed
`AuthorizedLeaseQueryResponse` gain this optional pair:

```ts
completenessProof?: CompletenessProofV1
authorizationWitness?: AuthorizationWitnessRecordV1
```

The pair is emitted atomically or omitted together. Ordinary query issuance
uses the request's `completenessNamespace`; authorized-lease issuance uses the
request's already-closed `clientStoreId` / `queryKey` / `queryInstanceId`
triple. The plan must be admitted by LLP 0157 and the namespace must be exact.
Minting occurs before response publication; a signing, result-binding,
witness-binding, or current-activation failure refuses the operation and emits
neither member. The wire envelope only transports the exact LLP 0157 §D3
proof and witness preimage. It cannot reinterpret, re-sign, or weaken them.

For a snapshot-batch continuation page, the ordinary response may additionally
carry:

```ts
pageSetManifest?: {
  identity: `sha256:${string}`
  orderedProofDigests: readonly `sha256:${string}`[]
}
```

When the presented prior chain plus the newly minted terminal-page proof
satisfy LLP 0157 §D3's `PageSetIdentityRecordV1.compose` rules, the server
computes `identity` from that exact closed record and publishes the page,
proof/witness pair, and manifest in one response. A chain spanning different
commit versions or otherwise not composing receives no manifest; each valid
page remains complete only at its own version and the set is `unknown`. A
tampered or unverifiable presented proof refuses before publication. No
parallel page-set identity or cursor grammar is introduced; LLP 0135's single
outer `sbsb1` continuation remains unchanged.

Compatibility is additive in the server→client direction despite the former
closed records because this dated normative act amends those records. Existing
clients consume the old required members and ignore these unknown optional
members. New clients tolerate their absence, classify completeness as
`unknown`, and fresh-sync; they do the same for an unknown/retired proof key or
any verification failure. Old callers omit the optional request context and
receive the pre-amendment response shape. This amendment changes no frame kind,
required member, capability row, or wire-version token.

## LLP 0146 OQ6 remediation-carrier amendment — 2026-08-10

Author ruling (option B of
`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`): contextual
typed remediations ride **inside the existing diagnostic `details` member**,
never as a new member of any closed outer envelope family and never as a
separate lookup. The carrier is `diagnostic.details.remediationSet`, an
object with `schemaVersion: "snapback.remediation-set.v1"`,
`registryVersion: "snapback.remediation-kinds.v1"`, the exact contextual
`artifactHash` where a machine-applicable item exists, and bounded `items`
whose axes (kind, riskClass, machineApplicable, requiresApproval,
authorityEffect, precondition) come from the global versioned
remediation-kind registry LLP 0146 D7 defines. Compatibility rule: outer
envelopes are unchanged in every family (`ErrorResponse` remains the
forward-additive, must-understand v1 envelope defined by §0C.7;
`hostOpsResult.v1` stands). `items` has a hard maximum of **8** and emitters
truncate deterministically. Every machine-applicable item has an
`artifact-hash` precondition equal byte-for-byte to the set's contextual
`artifactHash`; the hash is the exact served identity at the refusal site
(currently `sha256:` plus 16 or 64 lowercase hexadecimal digits, according
to the owning artifact contract), never a recomputed approximation in a
projection.

The carrier and registry version independently. A consumer that does not
recognize `remediationSet` ignores it (ordinary `details`-member openness).
A v1 consumer ignores unknown object members at the set and item levels and
skips an unknown remediation kind without failing the enclosing diagnostic.
It refuses to interpret the remediation set on an unknown `schemaVersion` or
`registryVersion`, while retaining the enclosing diagnostic as usable. An
incompatible carrier change advances `schemaVersion`; an incompatible kind
vocabulary change advances `registryVersion`. Consumers that recognize the
versions use the shared typed decoder. Construction happens only at the authorization-aware diagnostic
construction site, after gates, with caller-visible facts — identical
across CLI, HTTP, MCP, and hosted projections, which all pass the
diagnostic through verbatim. The repair-apply consumer owns the named
stale-artifact refusal (hash observed at refusal time versus currently
served generation under the same selection fence; no write, alias,
regeneration, or invocation on mismatch). Conformance fixtures are LLP
0095's (see its matching 2026-08-10 record).
