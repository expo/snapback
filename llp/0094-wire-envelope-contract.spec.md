# LLP 0094: Wire envelope contract (LLP 0093 rollout P-0)

**Type:** Spec
**Status:** Draft
**Systems:** Wire Protocol, Realtime, Live Queries, Client SDK, HTTP surface, Cloudflare arm, Schema governance
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-25
**Revised:** 2026-07-25 (initial draft; §0D receipt typing and §0A.4 hosted
route migration implemented with this draft)
**Related:** LLP 0013, LLP 0031, LLP 0034, LLP 0043, LLP 0049, LLP 0051,
LLP 0053, LLP 0059, LLP 0060, LLP 0064, LLP 0077, LLP 0090, LLP 0091,
LLP 0092, LLP 0093

## Summary

This is the **P-0 cluster** of LLP 0093 (the client-protocol RFC): the wire
envelope contract, at the same byte-and-symbol precision LLP 0091 set for
the RQS wire. It pins, as normative contract:

- **§0A** — the complete **arm × route matrix** for the client-visible
  surface, including the admin/testing seams per arm, and the executed
  migration of the hosted arm's root-level system routes under
  `/_snapback/*` (LLP 0093 former OQ6, decided 2026-07-25: migrate, no
  LLP 0031 exception).
- **§0B** — the **wire-version negotiation mechanics** LLP 0093 D1
  directs: the socket-lane offer requirement on both arms, the
  `/connection/open` `wireVersion` body field with its pinned offer
  matrix, the staged bootstrap, client-side legacy-server detection, and
  the recorded blast-radius checks.
- **§0C** — the audited **per-family DTO closure matrix**, both
  directions, with a decided open/closed posture per family and the
  `authInvalidationProtocol` unknown-value asymmetry decided rather than
  inherited.
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
all of them. Citations below are file + symbol, line numbers as courtesy,
pinned against origin/main `6fe11376`.

## 0A — Arm × route matrix

The two served arms are **local** (`src/server.rs` router, built from the
LLP 0031 route registry) and **hosted** (the Cloudflare gateway Worker
`cloudflare/src/gateway.js` fronting the coordinator Durable Object
`cloudflare/src/coordinator.js`). The matrix is normative: a route absent
from an arm's column is **not served** on that arm, and a client MUST NOT
infer a route's presence from the other arm. "Conn" means the LLP 0031
`ConnectionAuth` policy (the `x-snapback-connection-token` header, with
the transport carriers of LLP 0031 §Connection capability grants).

### 0A.1 App-data routes (root)

| Route | Method | Auth | Local arm | Hosted arm |
| --- | --- | --- | --- | --- |
| `/` (instance status) | GET | Public | typed public projection (LLP 0031 D3) | not served (asset fallback / 404) |
| `/health` | GET | Public | public metadata + server-binary identity (LLP 0031 §Server-binary identity) | public metadata + deployment identity (`coordinator.js` `route` `/health`) |
| `/inspect` | GET | Public | typed public identity projection (`inspect.public.schema.json`) | **capability manifest** (`gateway.js` — same payload as `/capability`; a different shape from the local `/inspect`) |
| `/capability` | GET | Public | not served under this name (the manifest rides `/inspect`/`/`) | capability manifest (`capability.manifest.schema.json`) |
| `/connection/open` | POST | Public (grants, never exercises) | closed DTO `OpenConnectionRequest` (`src/server.rs:4070-4083`) | open decoder `kitOpenConnection` (`coordinator.js:4194`) — see §0C.3 |
| `/query/{name}` | POST | app auth (mode-dependent, LLP 0031 matrix) | served | served (`kitQuery`) |
| `/mutation/{name}` | POST | app auth | served | served (`kitMutation`) |
| `/action/{name}` | POST | app auth | served | served (`executeAction`) |
| `/query/{name}/authorized-lease` | POST | sessions-mode resolved caller + exact protocol offers (LLP 0043/0053) | served | **not served** (hosted auth profile gap) |
| `/client-mutations/acknowledge` | POST | app auth + authority descriptor | served | **not served** |
| `/live/{name}/subscribe` | POST | Conn | served; open decoder body (§0C) | served (`kitSubscribe`); **refuses without a current socket session** (`SNAPBACK_CONNECTION_SOCKET_REQUIRED`) |
| `/live/{name}/unsubscribe` | POST | Conn | served | served (`kitUnsubscribe`) |
| `/live/{name}/resume` (reattach) | POST | Conn | served (LLP 0090 keeps it; no first-party caller) | **not served** (gateway forwards `subscribe\|unsubscribe` only — `KIT_ROUTE`, `gateway.js:64`) |
| `/live/{connection_id}/stream` | GET (WS upgrade) | Conn (header or `snapback.connection-token.<token>` subprotocol; never URL) | served (`stream_live`) | served (`acceptKitSocket`) |
| `/outbox/{connection_id}` | GET | Conn | leased-batch drain (LLP 0059 ownership cut) | grant-verified, **declared-empty batch** (`coordinator.js` kit outbox arm; `http_outbox_poll_fallback` is a manifest gap) |
| `/live/authorization-invalidation/acknowledge`, `/manual-retry` | POST | Conn + exact negotiated invalidation protocol | served | **not served** |
| `/ephemeral/publish`, `/subscribe`, `/delete` | POST | Conn | served (LLP 0013) | **not served** (`ephemeral_realtime` manifest gap) |
| `/ephemeral/collections/ensure` | POST | Public (validate-only, identity-free) | served | **not served** |
| WS message kinds on the stream | — | bound socket (LLP 0031 operation registry) | `ephemeral_publish\|ephemeral_subscribe\|ephemeral_delete\|ephemeral_unsubscribe\|live_ping` | `ping` only (kit socket); no ephemeral kinds |
| `/app/ensure` | POST | LLP 0012/0031 intent family | intent family (attest/provision/legacy) | deploy-identity compare + seed-if-empty (`kitEnsureApp`) — provisioning is compile-time |
| `/app/bundle` | POST | LLP 0031 dated amendment (0090) | read + register modes | **read mode only** (register deferred, LLP 0092 step-4 amendment) |

Consequences already pinned by LLP 0093 and restated as matrix facts, not
renegotiated: the poll lane is local-arm-only in v1 (`poll/hosted` is not
a claimable conformance tuple); reattach is local-arm-only; the hosted
recovery lane is reconnect-resubscribe only (D3.2a).

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
  `:5456`, upgrade at `:16941-16945`): axum echoes `snapback.v1` when
  offered and **admits offerless upgrades**.
- **Hosted socket lane:** `acceptKitSocket` echoes only when offered —
  `protocols.includes('snapback.v1') ? { 'sec-websocket-protocol':
  'snapback.v1' } : undefined` (`cloudflare/src/coordinator.js:4598`) —
  and likewise admits offerless upgrades.
- **HTTP lane:** `POST /connection/open` carries one protocol offer
  today, `authInvalidationProtocol` (`OpenConnectionRequest`,
  `src/server.rs:4070-4083`), whose unknown values silently degrade to
  legacy (`:4716-4718`); the hosted `kitOpenConnection` ignores the field
  entirely (§0C.3).
- The JS kit always offers `snapback.v1` on the socket (with the bearer
  subprotocol) and sends no open-time wire-version field.

### 0B.3 The `wireVersion` open-time offer

The `/connection/open` request body gains one optional field:

```json
{ "wireVersion": "snapback.v1" }
```

- **Name:** `wireVersion` (camelCase, `wire_version` accepted as alias,
  matching the DTO's existing alias convention).
- **Value:** an exact version token (LLP 0064 doctrine). The only token
  defined by this spec is `"snapback.v1"`.
- **Offer matrix** (normative, per LLP 0093 D1):

| Offer | Server behavior |
| --- | --- |
| known token (`snapback.v1`) | binds the connection to that version; the response is unchanged in shape |
| unknown token | synchronous refusal, `SNAPBACK_WIRE_VERSION_UNSUPPORTED` (HTTP 400, `error.response.schema.json` envelope) — a v2 client must never be interpreted under v1 |
| absent | opens a **legacy** connection, implicitly bound to v1 for the socket-equality rule; ineligible for envelope kinds gated on the open-time offer; admitted through the bootstrap bridge, refusal (`SNAPBACK_WIRE_VERSION_REQUIRED`) is the scheduled end state |

Binding is once, at open; re-open under `previousToken` re-binds from the
re-open body by the same matrix (an idempotent re-open that changes the
offer is a new binding decision, not a mutation of a live socket's
binding).

### 0B.4 Socket-offer requirement and the equality rule

A conformant client MUST offer `snapback.v1` in the
`Sec-WebSocket-Protocol` list of the kit stream upgrade
(`GET /live/{connection_id}/stream`), on both arms. Server side, in the
end state:

- an upgrade offering **no** known wire-version token is refused before
  upgrade — `SNAPBACK_WIRE_VERSION_REQUIRED`, HTTP 400, in the
  must-understand refusal style of `src/auth/handshake.rs` (exact tokens;
  a present-but-malformed offer never falls through to "absent");
- the socket offer MUST equal the version bound on the connection at open
  — a mismatch refuses with `SNAPBACK_WIRE_VERSION_MISMATCH`. A
  `snapback.v1` offer on a legacy (offerless-open) connection **confirms**
  the implicit v1 binding, never upgrades it — today's JS kit is exactly
  this shape and stays admitted through the bridge.

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
  every offer (the §0C hazard, live on this exact field). B1 also aligns
  `authInvalidationProtocol` unknown-value handling (§0C.5).
- **B2 — client offers.** The JS kit sends `wireVersion: "snapback.v1"`
  at open. Gate: B1 deployed on every arm the kit targets (for the shared
  Cloudflare deployment, a redeploy carrying B1).
- **B3 — socket refusal enabled.** The §0B.4 offerless-upgrade refusal
  turns on, after the recorded blast-radius check (§0B.7) is re-verified
  at enablement time.
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
decode failure (closed DTO). The pinned client rule: a **decode-class
rejection** of `/connection/open` that disappears when the offer member
is removed is **legacy-server detection**. The pinned fallback: the
client re-opens **offerless, as legacy, exactly once per endpoint**,
caches the verdict for the process lifetime, and MUST surface the
downgrade as a structured diagnostic (never silently). A client may be
configured strict (refuse instead of downgrade); conformance claims made
against a strict configuration are claims about v1-bound connections
only. Caveat recorded honestly: a pre-B1 **hosted** server does not
produce the decode-class signal (open decoder — it ignores the offer),
so hosted legacy detection is absence-of-echo, not rejection; the client
cannot distinguish a pre-B1 hosted server from a B1 server that bound
the offer, which is precisely why B2 gates on B1 deployment rather than
on runtime detection.

### 0B.7 Blast-radius record (audited at `6fe11376`)

**Kit-stream socket consumers offering no wire version: none found.** The
enumerable population of the repo's own socket consumers:

- `packages/snapback-client/index.mjs` (and its `demos/_kit/client.mjs`
  re-export shim): offers `snapback.v1` + bearer subprotocol — compliant.
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

**`/connection/open` consumers (the B4 gate population):** the kit is the
only in-repo caller that constructs the open body (every demo, suite,
and generated client goes through it), plus the hosted-suite direct
opens in `cloudflare/test/*` (via the gateway with kit-shaped bodies)
and Rust in-crate tests constructing `OpenConnectionRequest` directly.
All inherit B2 when the kit and test fixtures add the offer; the B4
audit re-runs this enumeration and must find zero offerless callers
before absent may refuse.

## 0C — Per-family DTO closure matrix

Scope: every wire family of the §0A matrix, both directions. "Closed"
means the decoder rejects unknown members (`deny_unknown_fields` /
`additionalProperties: false`); "open" means unknown members are
silently ignored. The rule from LLP 0093 D1 binds every row: a new
client-sent field is **never** an ungated addition — it requires a
capability proof, a compatible fallback, or a new version token; the
failure mode differs (closed → old server refuses; open → silent
feature-off).

### 0C.1 Client→server families

| Family | Decoder (local arm) | Schema | Decided posture |
| --- | --- | --- | --- |
| `OpenConnectionRequest` (`src/server.rs:4070-4083`) | **closed** | `connection.open.input.schema.json`, closed | stays closed; the §0B.5 B1 member is the sanctioned evolution path |
| `AuthorizationInvalidationAckInput` (`src/local.rs:783-788`) | **closed** | closed | stays closed |
| manual-retry input (`src/local.rs`, `AuthorizationInvalidationManualRetryInput`) | **closed** | closed | stays closed |
| `SessionLiveSocketClientMessage` (`src/server.rs:18204`, sessions-mode socket) | **closed** (auth-mode-dependent third family) | — | stays closed |
| `LiveSubscribeInput` / `LiveResumeInput` / `LiveUnsubscribeInput` (`src/local.rs:614-767`) | **open** | open | **stays open** — LLP 0091's `resumeFromToken` rides the open subscribe body as its compatible fallback, and closing an open decoder changes observable behavior for every deployed caller; the silent-feature-off hazard is accepted and mitigated by response witnesses (`resumeRefusal` is the existing example: an ignored capability field must have a response-visible echo or refusal so the client can detect feature-off) |
| `HandlerInput` (`src/manifest.rs:2937`) | **open** | open | stays open (it is the app-args carrier; the sessions-mode body-auth **rejection family** of LLP 0031 is the enforced closed subset — auth-bearing members are rejected, not ignored) |
| dev-mode socket client message (`LiveSocketClientMessage`, `src/live_wire.rs`) | **open** | `live.socket-client.schema.json` | stays open in dev mode; sessions mode already substitutes the closed family above |

### 0C.2 Server→client families

Schemas describe what current servers **emit**; the acceptance grammar
(P-1 fixture corpus + abstract state machine) defines what clients must
**accept**; on unknown fields the acceptance grammar wins (skip, never
crash), and an addition to any family whose deployed schema-validating
clients are not proven tolerant needs capability gating or a new token
(LLP 0093 D1, cited not renegotiated).

| Family | Emission closure | Notes |
| --- | --- | --- |
| `LiveEnvelope` (`live.envelope.schema.json`) | closed `oneOf` over the current kind set | new kinds always offer-gated (LLP 0091 `CurrentAsOf` is the pattern); `resync_required.reason` is the open-string escape hatch |
| `LiveSocketServerFrame` (`live.socket-server.schema.json`) | closed `oneOf` | `durable_bytes` carries the required recovery transition (LLP 0093 D3 fact 2b) |
| `Receipt` (`receipt.schema.json`) | closed variants | §0D ratifies its appearance on subscribe/unsubscribe outputs as typed |
| `AuthorizationInvalidationSnapshot` (`src/live_wire.rs:128-136`) | **closed** (`additionalProperties: false`) | additions need gating per the rule above |
| `AuthorizationInvalidationAckOutput` (`src/local.rs:790-794`) | **closed** | same |
| `LiveSubscribeOutput` / `LiveUnsubscribeOutput` / `LiveResumeOutput` | open objects | additive optional fields are the sanctioned in-v1 evolution (server→client direction) |
| `RealtimeEnvelope` drain wrapper (`realtime.envelope.schema.json`) | closed | lane-P framing only |

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
to a legacy connection (`src/server.rs:4716-4718` — exact-match-v1 else
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
| `SNAPBACK_WIRE_VERSION_UNSUPPORTED` | 400 | `POST /connection/open` (B1+) | the offered `wireVersion` token is not understood; the client must not retry under a lower version without an explicit decision |
| `SNAPBACK_WIRE_VERSION_MISMATCH` | 400 | kit stream upgrade (B1+) | the socket offer does not equal the connection's bound version |
| `SNAPBACK_WIRE_VERSION_REQUIRED` | 400 | kit stream upgrade (B3+), `POST /connection/open` (B4) | no wire-version offer where one is required |
| `SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED` | 400 | `POST /connection/open` (B1+) | unknown `authInvalidationProtocol` value (§0C.5 alignment) |

Existing codes this spec touches but does not change:
`SNAPBACK_CONNECTION_TOKEN_REQUIRED` / `SNAPBACK_CONNECTION_TOKEN_INVALID`
(grant gate), `SNAPBACK_CONNECTION_SOCKET_REQUIRED` (hosted
socket-session gate). The migrated hosted system routes keep their
existing codes unchanged (`SNAPBACK_ADMIN_*`, `SNAPBACK_CRON_*`, etc.).

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
2. **The hosted proof-protocol socket messages** (`acceptLiveSocket`'s
   `subscribe`/`unsubscribe`/`ping` and their responses,
   `coordinator.js:5318-5347`): LLP 0040's frozen pinned regression
   surface. Decision: **out of wire v1 and out of the gate inventory**
   — frozen means frozen; schematizing it would imply evolution support
   it does not have. Recorded so its absence from the gates is a
   decision, not an oversight.
3. **The hosted kit-route response composition** (`kitSubscribe` et al.
   compose subscribe outputs in JS): governed by the committed schemas
   but with no hosted-side executable drift gate. The
   conformance-twin/acceptance suites are the current enforcement seam;
   a hosted schema-validation gate rides the same ticket as item 1.
4. Everything else client-visible is schema-governed (LLP 0051 §D4's
   ENG-23891/ENG-23964 completion; §0D closes the last untyped member
   inside an already-governed family).

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
in the landing commit.

## Open questions

1. Should the B2 kit offer also ride the generated clients' pinned
   fixtures (so every generated client inherits the offer atomically),
   or is the kit the single mint point? (Leaning: single mint point —
   generated clients call the kit.)
2. Whether `wireVersion` should additionally be echoed in the
   `/connection/open` response (an explicit bound-version witness) or
   stay implicit. Echoing is additive and may ride B1; deciding it here
   was skipped to keep B1's shape minimal.
