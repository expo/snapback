# LLP 0093: The documented client protocol and first-party native clients

**Type:** RFC
**Status:** Implemented
**Systems:** Wire Protocol, Client SDK, Realtime, Live Queries, Native Clients, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-24
**Revised:** 2026-08-18 (LLP 0276 crate-path relocation); 2026-08-10 (mutation-wire artifact identity amendment: finite
mutation requests offer an exact wire version and carry codegen-time artifact
identity so successor-only migration floors can refuse blind predecessor
writes; see the dated amendment below). 2026-08-04 (dated finite-carrier completeness amendment: ordinary
finite query and authorized-lease responses may carry the LLP 0157 proof /
witness pair, and terminal snapshot-batch continuation delivery may atomically
carry its composed page-set manifest; see the dated amendment below).
2026-08-01 (v0.12 — ratified Implemented by the author; see
Revision history) 2026-07-26 (v0.11 — Partitime clean-room corrections; see
Revision history)
**Related:** LLP 0008, LLP 0012, LLP 0013, LLP 0031, LLP 0034, LLP 0043, LLP 0049, LLP 0051, LLP 0053, LLP 0059, LLP 0064, LLP 0075, LLP 0077, LLP 0082, LLP 0084, LLP 0090, LLP 0091, LLP 0092

> Not to be confused with LLP 0075, "Convex checkpoint protocol," which is a
> competitive-benchmark adjudication protocol, not a wire protocol.

## Summary

Snapback's live-query delta model is its best feature, and today it is
effectively JavaScript-only. Every live-wire envelope family is already a
single-sourced Rust serde + `schemars` type (`crates/snapback/src/live_wire.rs`, plus the
drain wrapper in `crates/snapback/src/ephemeral.rs`), exported to committed JSON Schemas
(`schemas/live.*.schema.json`, `schemas/realtime.envelope.schema.json`) with
drift gates on both
the Rust side (`crates/snapback/tests/artifact_schemas_v0.rs`) and the JS side
(`demos/_kit/tests/live-wire-schema.mjs`), plus exact wire-shape tests
(`crates/snapback/src/live_wire.rs:481-820`; they pin names, casing, tags, and values via
`serde_json::Value`, not serialized byte order). What does not exist is the **external-implementer
view**: no document a Swift or Kotlin author could build a client from, no
conformance definition for what "a Snapback client" must do, and no statement
of the protocol-visible lifecycle facts — most sharply, that **subscribing has
server-side, billing-visible side effects** (demand-armed `WhileLive` cron
activation, LLP 0049) that today are discoverable only by reading a demo's
acceptance-test comments.

This RFC proposes:

- **D1 — A versioned client protocol document.** Ratify the serde types and
  generated schemas as the normative wire contract, publish an implementer
  spec for **wire v1**, and pin an envelope-evolution policy. Byte-level
  contract clusters land as follow-on Specs (the LLP 0090 → 0091/0092
  pattern), not in this RFC.
- **D2 — Client conformance classes** (a common client core with sibling
  poll/live delivery lanes, composed with orthogonal auth profiles per LLP
  0059's independent axes) with cross-language conformance fixtures derived
  from the existing schema instances and byte tests.
- **D3 — A protocol-visible lifecycle contract**: subscription side effects,
  reconnect semantics, drain lease semantics, delta-vs-replace selection —
  the page that would have prevented the warm-poll test surprises.
- **D4 — One first-party proving client, in Swift**, built from the document
  (not from `packages/snapback-client`), Kotlin/Dart deferred until the spec
  survives that second implementation.
- **D5 — Guide capability rows**, making explicit the non-JS-client gap
  `guide/capabilities.md` currently leaves silent.

Both delivery lanes are in scope as supported tiers: the WebSocket stream
(`/live/{connection_id}/stream`) and the HTTP outbox drain
(`/outbox/{connection_id}`), which is already the JS kit's declared fallback
lane and deserves declared, conformance-tested semantics. Lane support is
**arm-scoped**: the hosted arm intentionally serves an empty drain and binds
demand to socket ownership, so the poll lane is local-arm-only in v1 and
hosted poll delivery is a named gap (D2). One-shot socket-less surfaces
(widgets, extensions) are LLP 0090 Channel C *bundle* consumers, not drain
clients; a persistent poll profile for such surfaces is out of scope and
would need LLP 0092 reconciliation.

## Motivation

### The corrected demo evidence

The circulated version of this feedback ("Swift and Dart shipped 2-second
polling loops; every non-JS consumer reverse-engineered the wire format from
`_kit/client.mjs`") is wrong in its specifics, and the corrected record is
*worse* for Snapback, not better:

- No non-JS demo arm ever saw the Snapback wire at all. All ten non-Expo
  chat-matrix stacks poll a **demo gateway's own three-field `/rpc` envelope**
  at 700 ms (`demos/chat-matrix/swiftui/Sources/ChatStore.swift:25-32`,
  `demos/chat-matrix/flutter/lib/main.dart:145`,
  `demos/chat-matrix/gateway/server.ts:13` — the only component in those
  stacks through which Snapback data flows; the three-field envelope shape is at
  `demos/chat-matrix/swiftui/Sources/Gateway.swift:15-25`). The gateway was a deliberate
  matrix design for comparison fairness
  (`demos/chat-matrix/README.md`, "Honest boundaries"), but the reason it had
  to exist is the point: **there is no first-class non-JS client path.**
- partiful-matrix reached the same conclusion independently:
  "If Snapback wants first-class Apple adoption, it needs either a real Swift
  client or an officially generated, well-instrumented gateway/client pair
  with auth, correlation, cancellation, retries, and declared polling
  semantics" (`demos/partiful-matrix/REPORT.md:1533-1544`;
  `diaries/0016-partiful-matrix.diary.md:533-537`).
- The "2-second polling" figure was a misreading of the autodemo *send*
  delay (`ChatStore.swift:35`, `main.dart:147`). The real polling cadences —
  700 ms gateway polls, the JS kit's own 1.5 s drain fallback
  (`DEFAULT_POLL_CADENCE_MS`, `packages/snapback-client/index.mjs:113`) —
  are exactly the "declared polling semantics" no document declares.
- LLP 0051 (Draft) already states the schema-side version of the gap: live
  wire kinds are hand-mirrored in JS
  (`llp/0051-language-neutral-data-tier.rfc.md:203-212`), and "no 'non-JS
  client is unblocked' claim" may be made until the remaining envelopes are
  schema-governed (`:622-629`).

### The warm-poll leakage

All Aboard's headless acceptance suite opens with a determinism note
(`demos/all-aboard/tests/acceptance/headless.mjs:13-18`): the warm-poll cron
job is armed only by a *subscription*, an `everyMs` job is immediately due, so
every exact-value assertion must use one-shot queries and the single
subscription is created last. Browser suites cannot wait 180 s, so they poke
the job via an admin route (`browser.mjs:424`). Diary 0012 records the
production version of the same surprise: an overnight "idle" deployment
wasn't idle because a lingering subscriber kept the poll armed
(`diaries/0012-cloudflare-notes-proof.diary.md:170-178`).

The lifecycle itself is deliberate and well-implemented — LLP 0049's
demand-armed alarm, `reconcileCronActivation()`
(`cloudflare/src/coordinator.js:2437-2461`), `refresh_cron_active()`
(`crates/snapback/src/local.rs:10098-10103`), and the explicit "no last-subscriber linger
window" non-behavior (`coordinator.js:2359-2360`). The defect is that none of
it is stated anywhere a client implementer or test author would look. A
subscribe frame is not a read; it is a demand signal with billing
consequences. That belongs in the protocol document, not in test comments.

### The competitive gap

Convex ships first-party React Native, Swift, and Kotlin realtime clients —
the dated, review-verified citation is LLP 0075's 2026-07-23 doc recheck
(RN/Swift/Kotlin quickstarts), backed by LLP 0074's inventory row (◈, Priority
7 adoption surface). Nothing in the corpus documents Convex's actual client
protocol or `onUpdate` semantics — that is a research hole this RFC carries as
an open question rather than asserting from memory. InstantDB publishes its
architecture openly (LLP 0082 records the essays and open repository; the
corpus holds no evidence either way on first-party Swift/Kotlin/Dart
clients — folded into the same research pass);
Triplit's frozen corpus is the corpus's model for message-level protocol
documentation, and its wholesale protocol break is the versioning cautionary
tale (LLP 0084). Ditto's SDK-v5 rearchitecture retiring 62+ APIs across 7
languages (LLP 0084) is the datapoint against committing to three first-party
clients before the spec has survived one.

## What exists today (inventory the spec must cover)

The follow-on Specs document this surface; the RFC pins its extent.
(Line-number citations throughout are refreshed against origin/main
`e1edbbc1`; where the fleet's landing cadence has moved them since,
the named symbol is authoritative — follow-on Specs should cite
file + symbol, with lines as courtesy.)

**Routes** (all governed by LLP 0031's taxonomy): `POST /connection/open`;
`POST /live/{name}/{subscribe,resume,unsubscribe}`;
`GET /live/{connection_id}/stream` (WebSocket upgrade);
`GET /outbox/{connection_id}` (leased drain; entries removed only at the
ownership-transfer cut);
`POST /query/{name}`, `/mutation/{name}`, `/action/{name}`;
`POST /query/{name}/authorized-lease` and
`POST /client-mutations/acknowledge` (the auth-profile routes, LLP
0043/0053); the authorization-invalidation acknowledge/manual-retry pair;
and the `/ephemeral/*` family (LLP 0013). There is no SSE lane. The route surface is
**not arm-uniform**: `POST /live/{name}/resume` is local-arm only (the
Cloudflare gateway forwards `subscribe|unsubscribe`, per LLP 0090), the
hosted `/outbox/{id}` verifies the grant and intentionally returns an empty
batch (`cloudflare/src/coordinator.js:1763`, declared in the hosted
capability manifest), and the follow-on Specs must carry an explicit
arm × route matrix, including the admin/testing seams (D3.1).

**Envelopes** (`crates/snapback/src/live_wire.rs`): `LiveEnvelope`
(`live_replace | live_delta | resync_required | authorization_invalidation`,
snake_case, tag `kind`); `LiveSocketServerFrame` (`sender_nonce | auth_error |
pong | ephemeral_ack | ephemeral_error | ephemeral | durable_bytes`,
camelCase, tag `kind`); `LiveSocketClientMessage` (tag `type`); `Receipt`;
plus `RealtimeEnvelope` (the drain's `{"Durable":{"payload":[u8…]}}`
wrapper), defined in `crates/snapback/src/ephemeral.rs:1406` with the wrapper asymmetry
noted at `live_wire.rs:33-35`.

**Versioning that already exists**: the `snapback.v1` stream subprotocol
(`crates/snapback/src/server.rs:5456`), four exact-match must-understand capability axes with
header-or-subprotocol carriers (`crates/snapback/src/auth/handshake.rs:20-120` — auth-client,
auth-invalidation, authority-descriptor, authorized-lease), the
sender-constrained `snapback.sender-constrained.v2` strings (LLP 0077), and
the doctrine LLP 0064 (Draft) pins: exact tokens, synchronous refusal on
unknown versions, a new token for any incompatible change. One enforcement
gap matters: the server *echoes* `snapback.v1` when offered
(`crates/snapback/src/server.rs:16938`) but does not require the offer.

**The gotcha ledger** — load-bearing facts currently living only in code
comments, all normative in the spec:

1. Casing is intentionally mixed by lane: durable envelopes snake_case,
   socket control frames and receipts camelCase (`live_wire.rs:14-18`).
   Unifying it is a breaking change; the spec documents it as-is.
2. Durable payloads arrive wrapped over the HTTP drain but unwrapped over the
   socket (`live_wire.rs:33-35`).
3. The drain is a **leased batch with an ownership-transfer cut** (LLP
   0059 §"Durable and ephemeral outboxes"):
   entries are selected without removal, acknowledged/removed only once
   ownership transfer is accepted, and retained/released — possibly
   redelivered — on cancellation before the cut
   (`llp/0059…:1415-1479`, `crates/snapback/src/server.rs:19009`). It is destructive
   from the client's perspective only *after* acknowledgement; clients must
   be duplicate-tolerant across cancelled drains.
4. `resume_live` exists server-side but the JS kit never calls it; socket
   loss drops the connection's durable subscriptions and reconnect re-enters
   via fresh `subscribe_live` with `supersedes`
   (`packages/snapback-client/index.mjs:102`).
5. `live_delta` is opt-in-by-analysis: ordered, limit-saturated, and
   membership/semi-join queries silently ride `live_replace`
   (`crates/snapback/src/live_matcher.rs:622-706`). Clients must treat delta-vs-replace as
   the server's choice, always.
6. `resync_required.reason` is deliberately an open string, not an enum
   (`live_wire.rs:74-78`); the `request_id` alias is accepted only on the
   client→server family (`LiveSocketClientMessage`; server frames emit
   `requestId` with no alias). These are two existing envelope-level
   compatibility details (D1 holds the complete evolution policy); the
   envelopes carry no protocol version field (the `version: u64` on
   replace/delta is the storage commit version).
7. Liveness numbers (LLP 0034 D0/D1, implemented in the kit): 5 s heartbeat,
   15 s freshness budget, 250 ms → 10 s reconnect backoff, terminal auth
   close code 4401.

## Design

### D1 — The protocol document, and wire v1

**Normative source.** The serde types and the schemas in `schemas/` are
declared the normative wire contract (the exact wire-shape tests are supporting
evidence and the fixture seed — the precedence ranking below is the single
authority statement); the implementer spec is a *view* of them, and the
existing two-sided drift gates become the mechanism that keeps the document
honest. The document does not restate what
a schema says; it states what a schema cannot: sequencing, lifecycle,
obligations, refusal behavior. (This is the division LLP 0084 praises in the
Triplit read: messages, obligations, and state machines.)

**Version identity and negotiation.** Wire v1 *is* the current wire, gotchas
and all — this RFC introduces no envelope changes, but it does require the
negotiation to become enforceable, because today it is not: the server
merely echoes `snapback.v1` when offered and admits sockets that offer
nothing. The pinned direction, with mechanics in P-0:

- **Socket lane:** a conformant client MUST offer `snapback.v1`; P-0 makes
  the server refuse upgrades that offer no known wire version, following the
  existing must-understand refusal style of `crates/snapback/src/auth/handshake.rs`. The
  socket offer MUST equal the version already bound on the connection at
  open; a mismatch refuses.
- **HTTP lane:** the wire version is bound once, at `POST /connection/open`
  — the body already carries a protocol offer (`authInvalidationProtocol`,
  `schemas/connection.open.input.schema.json`), and the wire-version field
  joins it the same way, giving poll-class clients an exact version carrier
  without any per-request header. The offer matrix is pinned: a **known**
  offer binds that version; an **unknown** offer refuses synchronously
  (exact-token doctrine — a v2 client must never be interpreted under v1);
  an **absent** offer opens a **legacy** connection with a defined
  degradation — it gets today's v1 surface but is ineligible for envelope
  kinds whose gate is the open-time wire offer, mirroring how an absent
  auth offer forecloses session-mode auth-scoped live work. A legacy
  connection is **implicitly bound to v1** for the socket-equality rule: a
  `snapback.v1` socket offer on a legacy connection confirms, never
  upgrades, the binding — today's JS kit (no open-time wire offer, v1
  socket offer) is exactly this shape and stays admitted through the
  bridge. Capability proofs carried at subscribe/resume time (LLP 0091's
  resume path is the existing example) remain available to legacy
  connections; legacy restricts only open-time-gated kinds. Legacy
  admission is a migration bridge, not an end state: P-0 owns its
  deprecation schedule, with refusal the scheduled end state.

**Version domain.** `snapback.v1` names the **connection-scoped surface**:
the `/connection/open` handshake itself, live envelopes, socket frames, the
outbox drain, and every connection-authenticated request/response DTO —
the subscribe/resume/unsubscribe bodies (which origin/main's LLP 0091
already evolves), the invalidation acknowledge/manual-retry pair (also
governed by its own capability axis), and the connection-authenticated
`/ephemeral/*` operations (publish, subscribe, delete, and the socket
message kinds). `POST /ephemeral/collections/ensure` is **excluded**: it
is a Public, identity-free compatibility route (LLP 0031's matrix) that
carries no grant to inherit a version from — it rides route stability
like the finite routes. The finite routes (`/query`, `/mutation`,
`/action`) carry no connection grant today
(`packages/snapback-client/index.mjs:3435-3443`) and are governed by
route stability plus the additive-fields policy — not by the
connection-bound version. Receipts are owned precisely, with one honest
seam: the typed `Receipt` union today rides only `/mutation` responses;
the subscribe/unsubscribe outputs carry `receipt` as untyped
`Option<Value>` (`crates/snapback/src/local/live_protocol.rs`), so the subscription receipt is
currently an **untyped compatibility seam**. P-0 types both fields as
`Option<Receipt>` and regenerates the schemas — only then is the shared
union a ratified claim, evolving under the stricter connection-scoped
rule everywhere it appears. One stated consequence: because finite routes
have no offer carrier, receipt evolution on `/mutation` responses is
limited to optional fields on existing variants within v1. Pulling the
finite surface under an explicit version carrier is out of scope for v1
and would be its own proposal.

**Evolution policy.** Within v1, ungated evolution is limited to what an
existing decoder provably survives, and that is **direction-specific**.
Server→client: new *optional fields* on existing envelopes, and new
`resync_required` reason strings (the open-string escape hatch that exists
for this purpose). Client→server the wire is **heterogeneous today**, and
the policy states it honestly rather than assuming closure: the handshake
and invalidation-ack DTOs are closed (`deny_unknown_fields` —
`OpenConnectionRequest`, `crates/snapback/src/server.rs:4072`;
`AuthorizationInvalidationAckInput`, `crates/snapback/src/local/live_protocol.rs`), sessions-mode
socket requests decode a third, auth-mode-dependent closed family
(`SessionLiveSocketClientMessage`, `crates/snapback/src/server.rs:18204`), while the
subscribe/resume/unsubscribe bodies, `HandlerInput`
(`crates/snapback/src/manifest.rs:2937`), and the generated dev-mode socket message are
**open decoders** that silently ignore unknown client fields. The rule is the same
either way — a new client-sent field is **never** an ungated addition; it
requires a capability proof, a compatible fallback, or a new version — but
the failure mode differs: on a closed DTO an old server refuses; on an
open DTO the hazard is **silent feature-off** (which is exactly why LLP
0091's `resumeFromToken` rides the open subscribe body as its compatible
fallback). P-0 audits a per-family closure matrix (decoder, schema
closure, fallback semantics — by route, transport, and auth mode) and
decides which families stay open; closing an open DTO changes observable
behavior and needs its own blast-radius evidence. The matrix covers
**both directions**: several server→client families are closed today too
(`AuthorizationInvalidationSnapshot`, `crates/snapback/src/live_wire.rs:128-136`;
`AuthorizationInvalidationAckOutput`, `crates/snapback/src/local/live_protocol.rs` — their
schemas say `additionalProperties: false`), so the schemas describe what
current servers *emit* while the fixture corpus and abstract state
machine define what clients must *accept*; on unknown fields the
acceptance grammar wins, and an addition to any family whose deployed
schema-validating clients are not proven tolerant needs capability
gating or a new wire token. The matrix also audits the existing
body-carried `authInvalidationProtocol` offer, whose unknown values
silently degrade to legacy (`crates/snapback/src/server.rs:4716-4718`) — the opposite of
this RFC's unknown-refuses rule — so the two adjacent open-body fields
get deliberately decided, not inherited, semantics. The open handshake gets
a **staged bootstrap**, scoped to servers that carry the field: first ship
servers that admit the offer member and return a typed unknown-version
refusal; then enable client offers (the JS kit offering the open-time
version is a named gate); only after the compatibility window does absent
refuse. A genuinely pre-P-0 server cannot make that promise — its closed
open-DTO rejects the unknown offer member as a body-decode failure — so
the client-side rule is pinned too: a decode-class rejection of the offer
on `/connection/open` is **legacy-server detection**, with the fallback
(re-open offerless as legacy, or refuse) defined in P-0. **New envelope kinds are always
offer-gated**: the server sends a new kind only on connections whose open
(or subscribe) proved the matching capability — the pattern origin/main's
LLP 0091 pins for `CurrentAsOf`, which is explicitly not old-decoder
tolerant. Clients MUST still skip-not-crash on unknown kinds and unknown
fields as defense-in-depth, and generated decoders (a Swift enum most
obviously) must be written tolerant — the negative fixtures in D2 enforce
this rather than trusting prose. Tolerance is not a license for known
kinds: `durable_bytes` carries a **required recovery transition** (D3
fact 2b) — the JS kit's historical ignore-it posture was exactly such a
defect, fixed alongside this revision
(`issues/closed/20260724-durable-bytes-silent-staleness.md`). Anything else — field removal,
casing changes, tag changes, wrapper changes — mints `snapback.v2` and
follows LLP 0064's migration doctrine. The committed schemas describe the
current kind set (closed `oneOf` unions); tolerance is a client conformance
rule layered on top, not a schema claim. Wire additions continue to land
through LLP 0051's schema-governed drift gates; RQS additions are already
pinned by LLP 0091/0092 and are citations here, not re-specification.
There is no lane-wide casing rule: casing follows the defining serde type.
In particular the outer `authorization_invalidation` envelope is
snake_case while its imported obligation, resolution, scope, namespace,
and snapshot subtrees are camelCase. Generated schemas are authoritative
for every member.

**Shape authority and precedence.** Ranked: the serde implementations are
ground truth; the generated schemas are their authoritative machine view;
the fixture corpus is normative for clients (it also pins facts schemars
cannot express, like the accepted aliases — `request_id` on the socket
client family and `authorization_namespace` on the subscribe body,
`crates/snapback/src/local/live_protocol.rs`); the exact wire-shape tests are
illustrative. Where prose disagrees with any of these, prose loses; where
schema and served bytes disagree, that is a drift-gate defect, not a spec
question. The existing exact wire-shape tests (`live_wire.rs:481-820`) are
representative, not exhaustive; the fixture corpus (D2) becomes the
committed conformance corpus — complete over the specified behavior
classes, not exhaustive over all valid schema values — including a
fixture for the `durable_bytes` recovery transition (a known kind with a
required action, distinguished from a genuinely unknown future kind). Its seed is honest but thin:
`artifact_instances()` (`crates/snapback/src/schema_export.rs:337-344`) today emits only
the data-tier profile artifact, so P-1 extends it (or adds a wire-fixture
generator) — it does not presently provide live-wire instances. One
namespace note for external implementers: the committed schema `$id`s use
`snapback.v0`, the artifact-format namespace (`crates/snapback/src/schema_export.rs:370`),
which is distinct from and does not contradict the wire identity
`snapback.v1`.
For row-bearing live frames, the durable row identity is the system `_id`
member; it is in the same string space as `LiveDeltaWireOp.id`. A user
field named `id` has no protocol identity role.

**Publication.** The spec content lands as follow-on Spec LLPs (see Rollout);
a rendered implementer page joins the guide (`guide/protocol/`), with
`guide/capabilities.md` rows pointing at it. Snippets in the guide page are
CI-verified per guide conventions. The guide surface also carries a
**minimal-client recipe** beside the implementer page: the app-data route
set, the three `LiveEnvelope` kinds a poll client must handle, and the
`x-snapback-connection-token` carriage, sized so a new client stack reaches
first data without reading the normative spec — the All Aboard external
review (2026-07-24) measured four client stacks independently re-deriving
exactly this from source at roughly an hour each. The **dev-mode posture** —
precisely what a dev-mode server accepts without an auth handshake — becomes
a named section of the P-0 protocol document (and is restated on the recipe),
not folklore distributed across route handlers.

### D2 — Client conformance classes

A common **client core**, two sibling **delivery lanes** (not cumulative
tiers — a lane obligation exists only where the arm serves the lane), and
orthogonal **auth profiles** — orthogonal because Accepted LLP 0059
requires its item-5 availability axes to stay independently negotiated,
and because an authenticated poll-only client is a legitimate shape a
cumulative tier would forbid:

- **Client core (every conformant client).** `POST /connection/open`
  (which binds the wire version, D1) → grant carriage split by transport,
  per LLP 0031's matrix: connection-authenticated **HTTP** carries the
  `x-snapback-connection-token` header (the drain's `?connection_token=`
  query fallback is rejected under sessions mode and documented dev-only
  otherwise; P-1 pins its end state); a **WebSocket upgrade** carries the header where the host
  API allows it or the production `snapback.connection-token.<token>`
  subprotocol (the conformant browser path — browsers cannot set upgrade
  headers; never a URL credential). The bearer subprotocol is distinct
  from the wire-version subprotocol. Core also owns: live
  subscribe/unsubscribe with the demand-ownership rules below;
  `LiveEnvelope` state transitions (version guards, `resync_required`
  including the connection-wide form); one-shot queries, mutations, and
  actions (receipts per D1's receipt ownership).
- **Lane P (poll delivery).** Drain `GET /outbox/{id}` on a **declared,
  bounded cadence** with backoff; `RealtimeEnvelope` unwrapping (the
  `{"Durable":{"payload":…}}` form is lane-P framing); duplicate-tolerant
  across cancelled drains (the 0059 ownership cut). This is the blessed fallback lane — the
  JS kit already runs it at 1.5 s. "Declared polling semantics"
  (REPORT.md's phrase) is a conformance requirement, not aspiration. (P-1
  pins whether the server's existing `?connection_token=` dev affordance
  on the drain is retained, constrained, or removed, so spec and code
  comment don't teach opposite postures.)

  **Lane P is local-arm-only in v1.** The hosted arm deliberately binds
  demand to socket ownership: subscribe refuses without a current socket
  session (`SNAPBACK_CONNECTION_SOCKET_REQUIRED`,
  `cloudflare/src/coordinator.js:4400`) and the drain returns a
  declared-empty batch (`:1763`), consistent with LLP 0090's
  socketless-HTTP-cannot-arm-demand posture. One sanctioned exception
  exists and is owned elsewhere: LLP 0090/0092's credentialed
  `POST /app/bundle` **register mode** atomically mints the connection
  grant and subscriptions under a bounded pending-registration owner
  before socket attach, with attach-deadline and reaper release (0092
  §0D.7 names it "the one sanctioned socketless-demand exception").
  Channel C register-mode client obligations stay governed by LLP
  0090/0092 and are outside 0093 conformance claims; it is a bootstrap
  into Lane L, not a poll lane — `poll/hosted` remains unclaimable, and
  ordinary socketless subscribe still cannot arm hosted demand. Hosted
  poll delivery beyond that is a **named gap** (D5): closing it means a
  hosted socketless-subscription ownership and durable-outbox contract
  reconciled with LLP 0090 — a product decision this RFC records but does
  not propose.
- **Lane L (live delivery).** The WebSocket stream: subprotocol offer/echo
  agreeing with the connection-bound version, unwrapped durable-envelope
  and control-frame dispatch (lane-L framing), heartbeat and freshness
  budget, backoff, reconnect-as-resubscribe-with-`supersedes`,
  version-guarded delta application (drop stale `version`, apply
  `add/update/remove` by operation `id` against each row's `_id`), replace
  fallback.

A conformance claim is core **plus** the lanes the arm serves: `live/hosted`
carries no drain obligations (the hosted drain is declared-empty), and its
recovery lane is reconnect-resubscribe *only* — the hosted fallback
blackout in D3.2a.

**Demand ownership (both classes).** Because a subscription is a demand
signal with billing-visible consequences on the hosted arm (D3.1), bounded
demand ownership is part of conformance, not etiquette: explicit
unsubscribe on normal shutdown and backgrounding; exactly one drain owner
per connection with non-overlapping drains; and defined crash behavior per
an **arm-specific lifecycle matrix**: on both arms socket close drops the
connection's durable subscriptions (server-side:
`disconnect_topology_for_transport`, `crates/snapback/src/local.rs:10164`, and the
hosted teardown below; the kit comment at
`packages/snapback-client/index.mjs:102` restates it); on the local arm the 120 s idle TTL (`CONNECTION_IDLE_TTL_MS`,
`crates/snapback/src/server.rs:14113`) additionally reaps an abandoned socketless
connection and releases its demand; on the hosted arm demand is released
by the socket close/error teardown
(`webSocketClose` teardown, `cloudflare/src/coordinator.js:5062`) — the 24 h default grant TTL
(`:141`) is grant expiry, not demand release. A
conformant client treats reaping as the crash backstop, never the normal
release path.

**Auth profiles (orthogonal, per LLP 0059's independent axes).** Named
capability claims a client of either delivery lane may offer, mapped
one-to-one onto the negotiation planes that already exist: authenticated
request/response; auth-scoped live with the invalidation acknowledge
protocol (LLP 0053/0059); authority descriptors / queued replay; authorized
leases / retained reads; and sender-constrained custody (LLP 0077,
browser-class transports). How profile combinations map onto LLP 0012's
`Online`/`Parity` capability reports is stated in P-3, which owns the
profile contract.

**Conformance is per-arm.** A conformance claim is a machine-readable
arm × lane tuple — `poll/local`, `live/local`, `live/hosted` are the v1
set; `poll/hosted` is not claimable (the named gap above) and unsupported
tuples must never be flattened into a bare lane claim. Tuples are claimed
independently — a client supporting both local lanes lists both tuples
(no composite claim), and `live/local` does not require `poll/local` (the
JS kit composes both; composition is permitted, not required). Fixtures
are evaluated per tuple against the arm × route matrix, with wrapper
framing fixtures assigned to their lane.

**Fixtures.** A language-neutral conformance corpus: canonical frames in,
expected client state/actions out, judged against an **abstract client
state machine** that P-1 defines as an explicit deliverable (fixtures are
evaluated against that model, not each implementation's internals) —
seeded from `artifact_instances()` and
the exact-byte tests, and including **negative fixtures**: unknown kinds,
unknown fields, malformed capability offers, cancelled/duplicated drains,
and a malformed item inside an acknowledged batch that must not abort the
remainder, plus multi-step `CurrentAsOf` and authorization-invalidation
apply-before-ack/quarantine cases. The MUST-ignore and refusal rules of D1 are conformance-tested,
not prose. The fixture corpus is the deliverable that makes "first-party"
cheap for languages we don't write: a Kotlin author consumes the same
fixtures the Swift client passes. LLP 0064's per-OS evidence rule applies
unchanged — an iOS receipt never establishes Android.

Whether the ephemeral lane (LLP 0013) is required for Lane L or is a
separate optional profile is an open question; the RFC's default is optional
profile `E`, since presence semantics are separable and separately budgeted.

### D3 — Protocol-visible lifecycle facts

The spec must state, as normative client-facing contract:

1. **Subscribe is a demand signal.** A live subscription may arm
   `WhileLive`-activated cron jobs (LLP 0049); arming is recomputed on
   subscribe, unsubscribe, socket close, and connection purge; there is no
   linger window. Consequences a client author must know: subscriptions have
   billing-visible side effects on hosted targets, and exact-value test
   assertions against demand-driven data must use one-shot queries (which never arm demand), isolated from other
   live subscribers, with time driven through the admin seams. The
   deterministic seams are **arm-specific and documented as such** (they
   join the arm × route matrix): on the local arm,
   `POST /_snapback/api/cron/tick` and the per-job
   `POST /_snapback/api/cron/{name}/run` the existing browser suites use
   (`crates/snapback/src/admin.rs:1953-1985`, AdminWrite); on the hosted arm, the
   admin-gated `POST /cron/run` with `{job}` forwarded to the coordinator
   (`cloudflare/src/gateway.js:128-135`,
   `cloudflare/src/coordinator.js:912-924`) — there is no hosted tick
   route. Documenting only one arm's seam would recreate the folklore
   problem for the other arm's test authors. The hosted route is
   root-level, which conflicts with Active LLP 0031's invariant that no
   system operation lives at the root; P-0 must either migrate it into the
   reserved `/_snapback/*` namespace or land an explicit LLP 0031
   amendment, and the arm × route matrix records the outcome. Demand release is a
   conformance obligation (D2's demand-ownership rules).
2. **Socket loss drops durable subscriptions.** Reconnect is fresh
   subscribe with `supersedes`; snapshots ride the subscribe response (no
   prime race, LLP 0034). The response must witness the exact retired id in
   `superseded`, or name an already-absent target in
   `supersessionRefusal`; subscribe success without either witness does not
   prove disposal. The reattach route (`resume_live`) and RQS token
   resume are **decided ground**: Accepted LLP 0090 keeps both as disjoint
   mechanisms (reattach continues a server-retained subscription; a token
   seeds a new one from client-held state), and LLP 0091 §0B.4 pins the
   client dispatch order between them, with reattach local-arm-only in v1.
   The spec documents that split as-is, with a non-normative note that no
   first-party client currently calls reattach (the JS kit always
   re-subscribes, `index.mjs:102`, and the retention window reattach
   presupposes is future work). Retirement is **not** proposed; it would be
   an explicit LLP 0090 renegotiation under LLP 0051's deprecation rules.
   **(2a) The hosted fallback blackout.** On the hosted arm the drain
   delivers nothing during a socket outage; delivery resumes only at
   resubscribe. Reconnect-resubscribe is therefore the *only* recovery
   lane for `live/hosted`, and the spec states this as a lifecycle fact.
   **(2b) `durable_bytes` requires recovery.** The frame exists so an
   undecodable durable payload is never dropped silently
   (`crates/snapback/src/live_wire.rs:280-283`), and its outbox lease is already released
   at delivery — a client that ignores it can stay silently stale while
   reporting current. The normative transition is forced resync:
   close/reconnect with fresh subscribe (or an equivalent), encoded in
   P-1's abstract state machine and fixtures. Ignoring is
   non-conformant. The obligation is defined by its transitions — every
   durable subscription re-enters fresh snapshot-with-subscribe and
   retained ephemeral overlays clear; the kit's in-place poison sentinel
   is the reference behavior and a socket bounce achieving the same
   transitions is a permitted equivalent. The sentinel's reason string
   (`durable_bytes_undecodable`) is client-synthesized, never
   wire-emitted. (Implemented in the kit alongside this revision:
   `dispatchDurableBytesFrame`; regression-durable-bytes-resync.mjs
   covers both halves; the dispatch-wiring test seam is follow-up
   `issues/20260725-durable-bytes-dispatch-test-seam.md`.)
3. **Drain semantics are the 0059 leased-batch contract.** The
   ownership-transfer cut and duplicate-tolerance rule (inventory item 3),
   cadence, batch bounds (`MAX_OUTBOX_DRAIN_BATCH=64`), backlog/overflow
   behavior (`outbox_overflow` → connection-wide resync, `clear_retained`),
   and the 64 MiB handoff/retention budgets (`crates/snapback/src/ephemeral.rs:798`)
   are spec facts.
4. **Delta is the server's choice.** Clients implement both paths and never
   infer query shape from which arrives.

### D4 — The Swift proving client

One first-party client, Swift, claiming tuples in order — `poll/local`,
then `live/local`, then `live/hosted` (auth
profiles follow once P-3 lands). The proving host is a **foreground iOS
app** — the simplest demand lifecycle; widget/extension surfaces are LLP
0090/0092 bundle consumers and are out of proving scope. Discipline: it is
built **from the spec and fixtures, not from reading
`packages/snapback-client`**; every place the author needs the JS source to
proceed is a spec defect, filed and fixed before the client works around
it. That rule — spec-first, divergence-is-a-defect — is what makes one
client "proving." The defect ledger lives as filesystem tickets under
`issues/` (the repo's convention), with the build experience in a diary.
Distribution (SwiftPM package name, repo placement,
generated-vs-handwritten Codable types from the JSON Schemas) is deferred
to the client's own Spec/plan.
Kotlin and Dart are explicitly deferred: the Convex parity claim (LLP 0075)
is answered first by a protocol any of them can be built from, then by
clients in demand order.

### D5 — Guide and corpus obligations

- `guide/capabilities.md`: add rows for the client protocol document and the
  Swift client as they ship, plus an explicit, dated record of two gaps —
  the non-JS client gap and the `poll/hosted` gap (D2) — as GAP rows if the
  index's LLP 0061 semantics admit roadmap gaps, otherwise as linked
  tickets the index points at. Today the file has zero occurrences of
  swift/kotlin/dart/non-js; whichever form, the gaps stop being silent.
- `guide/clients/`: a `swift.md` page when D4 ships; `headless.md` gains a
  pointer to the protocol document.
- LLP 0064: amended to add the third surface class (protocol-native clients)
  alongside RN/Expo and Exact Native, keeping its exact-token and per-OS
  evidence doctrines — and reconciling reconnect identity: 0064's RN text
  says reconnect "obtains a fresh connection grant"
  (`llp/0064…:94-98`) while this RFC pins grant-preserving
  reconnect-resubscribe-with-`supersedes` (LLP 0031: socket close does
  not revoke the grant); the amendment decides whether "fresh grant"
  means idempotent re-open of the surviving grant or is superseded.
  Status dependency, noted: 0064 and 0051 are both Draft — as are 0091
  and 0092, whose fallback and register-mode contracts v0.6+ leans on —
  so the doctrines this RFC cites inherit their review risk; the 0064
  amendment should ride with advancing 0064 itself.
- LLP 0051: this RFC takes the protocol-documentation half of its non-JS
  claim; 0051 retains local execution (mutation IR, WASM handlers). A
  core+lane client executes nothing locally.

**Status (2026-07-26): landed.** The guide now exposes the protocol and Swift
client pages, capability rows for the protocol and Swift artifact, and dated
GAP rows for additional non-JS distributions and `poll/hosted`. The headless
page routes external-bearer and lifecycle users into the same contract.

## Rollout sketch

Follow-on Spec clusters, 0091/0092-style, in landing order:

- **P-0 — Wire envelope contract**: the envelope/route/versioning spec —
  the arm × route matrix, the socket-lane offer requirement and the
  `/connection/open` wire-version binding with its bootstrap rule (D1),
  the subscription-receipt typing (`Option<Receipt>`), and the remaining
  hand-mirrored frames LLP 0051 §D4 lists — landed through the schema
  drift gates. The socket-refusal change lands on **both arms** (the
  hosted coordinator independently echoes-only-when-offered,
  `cloudflare/src/coordinator.js` `acceptKitSocket` subprotocol echo). Before enabling refusal, P-0
  records the blast-radius check — starting from the enumerable
  population of the repo's own non-kit socket consumers (acceptance
  suites, demo gateways) — of whether any consumer today offers no wire
  version (none is known; the check makes it a fact). The absent-offer
  deprecation gate audits **all** `/connection/open` consumers, not just
  the socket population.
  *Status (2026-07-25):* spec authored as LLP 0094; hosted root
  system-route migration done; receipt typing done; negotiation server
  changes and marker-frame gates ticketed
  (`issues/20260725-0093-p0-*.md`).
- **P-1 — Lifecycle and conformance**: D3's facts plus the core/lane and
  demand-ownership definitions, the abstract client state machine, and the
  fixture corpus with its negative fixtures — including arm-mismatch
  transitions (attempting `poll/hosted`, hosted subscribe before socket
  establishment, socket loss mid-subscribe) and grant-loss recovery
  (`SNAPBACK_CONNECTION_TOKEN_INVALID` after local idle reaping or hosted
  grant expiry, pinning whether recovery refreshes only the grant or
  re-establishes every subscription); also retires the stale
  destructive-drain comments the 0059 change left behind
  (`packages/snapback-client/index.mjs:3846`,
  `crates/snapback/src/server.rs:19004`).
  *Status (2026-07-25): landed as LLP 0095 (Draft) — state machine, corpus
  contract + seeded generator (`crates/snapback-types/src/wire_fixtures.rs`), dispatch seam,
  comment retirement; remaining coverage tracked by
  `issues/20260725-0093-p1-*`.*
  *Status (2026-07-30): the remaining corpus coverage landed as
  fixture-format v3 (LLP 0095 §2.1/§2.4) — negotiation/offer refusals
  (`client_to_server` direction), drain-cancel duplicate tolerance,
  arm-mismatch and grant-loss recovery, wrapped/unwrapped parity for every
  durable family, and virtual-time heartbeat/freshness/backoff fixtures;
  `issues/closed/20260725-0093-p1-fixture-corpus-coverage.md`.*
- **P-2 — Swift client** (`poll/local` → `live/local` → `live/hosted`),
  with its own plan/diary and the
  spec-defect ledger from D4's discipline.
  *Status (2026-07-25):* clean-room SwiftPM package landed
  (`clients/swift/SnapbackClient`): client core + both local lanes, all 10
  seeded corpus fixtures pass, 13-check live harness green against the todo
  backend; `live/hosted` and the iOS proving host remain; defect ledger
  `issues/20260725-0093-p2-spec-defect-*.md` (4 tickets), diary 0020.
- **P-3 — Auth profiles** for non-browser clients: the profile contract,
  its mapping onto LLP 0012 `Online`/`Parity` reports, and what
  sender-constraint means off-browser — coordinated with LLP 0077. P-3
  documents capability carriage plus an integration index of the
  lifecycle routes a client touches (`/auth/session`, request-code,
  exchange, refresh, logout); the lifecycle itself stays owned by LLP
  0059/0060/0077 and is referenced, not re-specified.
  *Status (2026-07-25): landed as LLP 0096 (Draft) — five profiles
  mapped one-to-one onto LLP 0059's axes plus the sender-custody
  plane, 0012 Online/Parity projection, off-browser sender-constraint
  scoped as undefined, lifecycle integration index; OQ5 floor carried
  open with a recommendation; two code-vs-doctrine findings ticketed
  (`issues/20260725-0093-p3-*`).*

## Open questions

Two prior open questions were closed in v0.2: the `resume_live` fork
(decided ground — LLP 0090 keeps both routes; see D3.2) and the HTTP
version carrier (bound at `/connection/open`; see D1).

1. **Ephemeral profile**: optional profile E as proposed, or required for
   Lane L?
2. **Convex client-protocol research pass**: primary-source read of Convex's
   client protocol and `onUpdate`/consistency semantics, plus the
   InstantDB native-client question (0074's inventory re-verification rule
   applies). Unowned.
3. **Fixture emission mechanics**: extend `crates/snapback/tests/artifact_schemas_v0.rs` to
   emit the corpus alongside its drift check, or a separate generator over
   `artifact_instances()`? (The authority question is settled in D1; this
   is plumbing — the drift gate already walks `artifact_instances()`, so
   extending it is the least-drift path.)
4. **Warm-poll client-facing name**: "demand-armed activation" is the
   internal term; the spec needs a name that survives external
   documentation — and whatever is chosen must appear in both the protocol
   document and the billing-facing guide page, or the discoverability
   defect recurs.
5. ~~Mandatory profiles for hosted production~~ — **DECIDED (author,
   2026-07-25): LLP 0096 §7's recommended floor is ratified** —
   `auth/rr` always; `auth/live` for clients subscribing to auth-scoped
   live functions; `auth/sender` for browser-class clients on
   sender-constrained deployments; `auth/replay`/`auth/lease` stay
   optional. Recorded in LLP 0096 §7; enforcement beyond the shipped
   gates rides LLP 0094 §0B's negotiation end state.
6. ~~Hosted root system surface vs LLP 0031~~ — **DECIDED (author,
   2026-07-25): migrate.** The hosted arm's root-level system operations
   (`/cron/run`, `/cron/status`, `cloudflare/src/gateway.js:128-135`;
   plus `/config/status`, `/host-call`, `/reset`, `/evict`, the
   `/__test/*` family — non-exhaustive, audit driven by the gateway's
   actual route set) move under the reserved `/_snapback/*` namespace;
   no LLP 0031 exception is minted. Execution is P-0 scope, tracked by
   `issues/20260725-hosted-root-system-routes-migration.md`.

## Finite-carrier completeness amendment — 2026-08-04

This dated normative amendment extends the finite wire families without
changing LLP 0157's closed semantic records. A successful ordinary finite
query for an LLP 0157-admitted plan may carry the optional pair
`completenessProof: CompletenessProofV1` and
`authorizationWitness: AuthorizationWitnessRecordV1` when the request names
the exact proof namespace (`clientStoreId`, `queryKey`, and
`queryInstanceId`) and `queryKey` is the admitted `qmk1` materialization key.
The successful `AuthorizedLeaseQueryResponse` gains the same optional pair,
bound to its existing exact namespace fields. The members are a pair: a
server emits both or neither, and a client treats either member alone as an
invalid carrier. The envelope conveys the proof and witness preimage but
cannot rewrite the Ed25519/JCS domain, signed record, identity bindings,
result digest, key custody, or validation rules owned by LLP 0157 §D3.

For snapshot-batch continuation delivery, the same ordinary finite response
carries the proof and witness for that one page. A continuation request may
present the already-held ordered proof chain. The server verifies every
presented signature before use and, when the new terminal page plus that
chain satisfy LLP 0157 §D3's first-to-terminal, same-identity, same-version
composition rule, the response additionally carries optional
`pageSetManifest: PageSetManifestV1`. Its `identity` is the digest of the
exact `PageSetIdentityRecordV1` and its `orderedProofDigests` are the exact
ordered proof digests. The terminal page bytes, its proof/witness pair, and
the composed manifest are one response publication: minting, verification,
or composition failure cannot publish a partial carrier. A valid page whose
prior pages no longer share one commit remains individually provable, but no
page-set manifest is emitted and the set remains `unknown`, never `prefix`.

Compatibility is deliberate. These response records were closed, so this
section is the dated normative act admitting exactly these optional members;
it is not an inference from the former closure matrix. Old clients continue
to consume the required finite fields and ignore unknown optional response
members. New clients accept their absence and classify completeness as
`unknown`, taking fresh establishment rather than treating absence, an
unknown/retired proof key, or verification failure as authorization or
integrity evidence. The optional ordinary-query request context is likewise
absent for old callers; a caller sends it only when it is prepared to consume
the proof contract. No capability row or wire-version identity moves in this
amendment.

### 2026-08-04 bundle-metrology receipt boundary

The shipped client verifier intentionally changes the measured Full/root
closures that already contain the public client entry and the public
materialization-store subpath. LLP 0063 and LLP 0145 therefore require a
prospective workload-version rollover for exactly those 16 profiles. The 15
shared closures name the typed offline-unavailable receipt as predecessor; the
store-only closure names the local-read-admission receipt. Both historical
receipts remain immutable, and every unaffected profile retains its existing
active ceiling.

## Watermark amendment — 2026-08-08

LLP 0200 Phase 1 made the `current_as_of` envelope subscription-scoped
and routine: servers emit it for matcher-skip and no-change fan-out
dispositions (`resume` is now optional on the wire — additive), so every
subscription's observed version advances on every commit's fan-out pass
and convergence ("this subscription reflects version ≥ V") is
client-decidable. Clients MUST treat rows-free `current_as_of` frames as
version-only advancement (existing decoders already do); protocol
consumers MUST NOT assume mutation settlement implies prior frame
delivery — the mutate response's committed version plus the watermark is
the ordering carrier. Contracts: LLP 0200 §2.1.

## Alternatives considered

- **Extend LLP 0064 instead of a new RFC.** 0064 defines surface
  equivalence classes and evidence rules; it deliberately does not document
  the wire. The wire contract is a new claim with its own follow-on Specs;
  0064 gets a scoped amendment (D5) instead of absorbing it.
- **Extend LLP 0051.** 0051's answer to non-JS is local execution (promoted
  mutation IR, WASM handlers) — a superset need. Protocol-only clients are
  deliverable years earlier and are what the demo evidence actually asked
  for; the two documents now partition the claim (D5).
- **A single self-contained Spec.** Rejected for the 0090 pattern: direction
  and contract review at different cadences, and the contract halves
  (envelopes, lifecycle, auth axes) have different reviewers.
- **Ship three clients at once.** Rejected on the Ditto datapoint (LLP 0084)
  and on the observation that fixtures-plus-spec, proven by one clean-room
  client, is the artifact that makes each further client cheap.
- **WebSocket-only conformance.** Rejected: the drain lane already exists
  and the JS kit uses it as its declared fallback; refusing to bless it
  would re-create the undeclared-polling problem this RFC exists to end.
  (Socket-less one-shot surfaces are *not* the justification — they are
  0090/0092 bundle consumers.)

## Revision history

- **v0.2 (2026-07-24)** — Round-1 dual-family review fixes: negotiation made
  enforceable and bound at `/connection/open`; auth restructured as LLP
  0059-aligned orthogonal profiles; `resume_live` question closed per
  Accepted LLP 0090; demand-teardown conformance added; drain description
  corrected to LLP 0059's leased-batch cut; citation fixes.
- **v0.3 (2026-07-24)** — Round-2 delta-round fixes: Class P scoped
  local-arm-only with hosted poll delivery a named gap (hosted subscribe
  requires a socket session; hosted drain is declared-empty); HTTP offer
  matrix pinned (known binds, unknown refuses, absent opens a
  deprecation-scheduled legacy bridge) with socket/connection version
  agreement; `snapback.v1`'s domain pinned to the connection-scoped
  surface; arm-specific lifecycle matrix and cron-seam matrix;
  per-arm machine-readable conformance tuples; shape-authority precedence
  ranked; residual pre-0059 "destructive" wording reconciled.

- **v0.4 (2026-07-24)** — Round-3 fixes, applied after the original round
  budget was exhausted and reviewed in Round 4 under the author-extended
  budget.
  Classes restructured as client core + sibling poll/live delivery lanes
  (`live/hosted` inherits no drain obligations; hosted fallback blackout
  stated as lifecycle fact 2a); legacy connections pinned as implicitly
  v1-bound for socket equality with subscribe-scoped capability proofs
  preserved; version domain extended to the connection handshake and
  connection-authenticated DTOs with receipt ownership corrected; hosted
  `/cron/run` vs LLP 0031 root-boundary conflict recorded (new OQ6);
  normative-source wording aligned with the precedence ranking; smaller
  reviewer-suggested fixes.

- **v0.5 (2026-07-24)** — Round-4 fixes: grant carriage split by transport
  (browser subprotocol carrier conformant, per LLP 0031's matrix); wrapper
  framing moved from core to its lane; subscription receipt named an
  untyped seam with P-0 typing it (`Option<Value>` today); ephemeral
  `collections/ensure` excluded from the version domain as Public;
  evolution policy made direction-specific (client→server DTOs are
  closed) with the open-handshake bootstrap rule assigned to P-0;
  finite-lane receipt freeze stated; auth-profile routes added to the
  inventory; OQ6 widened to the hosted root system-route class; fixture
  seed and `snapback.v0` schema-namespace notes added; tuple independence
  pinned.

- **v0.6 (2026-07-24)** — Round-5 fixes: evolution policy corrected to the
  heterogeneous per-family truth (subscribe/resume/unsubscribe bodies are
  open decoders; silent feature-off named as the open-DTO hazard; P-0
  closure matrix); handshake bootstrap staged and scoped to
  field-carrying servers, with decode-rejection pinned as legacy-server
  detection; LLP 0090/0092 bundle-register mode recorded as the one
  sanctioned socketless-demand exception (owned by 0090/0092, outside
  0093 claims); 0064 reconnect-identity reconciliation added to D5; OQ6
  made non-exhaustive over the hosted root system surface; citation and
  fixture-scope corrections.

- **v0.7 (2026-07-24)** — Round-6 fixes applied after the
  author-extended budget closed; first examined (and passed) in Round 7. Server→client closure authority reconciled (P-0 closure
  matrix made bidirectional; schemas describe emitted instances, the
  fixture corpus and state machine define the acceptance grammar;
  `authInvalidationProtocol`'s degrade-to-legacy asymmetry added to the
  audit); `durable_bytes` given a required recovery transition (D3 fact
  2b — the kit's ignore posture named a defect); "only forward-compat
  escape hatches" narrowed; wire-shape test naming corrected; grant-loss
  recovery fixtures and the all-consumers absent-offer gate added to
  P-0/P-1; 0091/0092 Draft status recorded; citation precision fixes.

- **v0.8 (2026-07-24) — UNREVIEWED.** Additive deliverables from the All
  Aboard matrix external review (Kimi): D1's publication surface gains a
  minimal-client recipe on the guide page, and the dev-mode no-auth
  posture becomes a named section of the P-0 protocol document. No
  normative wire semantics changed. Rollout execution is now tracked by
  `issues/20260724-llp-0093-rollout-execution.md`.

- **v0.9 (2026-07-24)** — the `durable_bytes` recovery transition is now
  implemented (kit fix + regression test landed with this revision;
  issues/closed/20260724-durable-bytes-silent-staleness.md), and the D1
  sentence describing the kit's ignore posture updated to past tense.
  Numbering note: **v0.8** is a concurrent additive amendment riding the
  0074-tranche branch (`e969973b` — guide minimal-client recipe and
  dev-mode-posture deliverables, labeled unreviewed there); this
  main-side entry is numbered around it so the histories interleave
  without collision when that branch lands.

- **v0.10 (2026-07-25) — post-convergence.** Round 7 reached dual-READY
  on v0.9; this entry applies the round's mechanical resolutions and one
  author decision, none touching normative wire semantics: line-number
  citations refreshed against `e1edbbc1` with a symbol-authoritative
  convention noted; the v0.7 history label corrected (first examined in
  Round 7); fact 2b's transition class pinned (in-place sentinel is
  reference behavior, socket bounce a permitted equivalent;
  client-synthesized reason string); former OQ6 decided by the author —
  hosted root system routes migrate under `/_snapback/*`, tracked by
  issues/20260725-hosted-root-system-routes-migration.md. When the
  0074-tranche branch lands its v0.8, the tranche lander owns the
  history interleave (this side is numbered around it).

- **v0.11 (2026-07-26) — Partitime clean-room corrections.** Recorded
  serde/schema-defined casing (including the camelCase invalidation
  subtree exception), made `_id` the explicit replace/delta identity
  bridge, required observable `superseded`/`supersessionRefusal`
  reconnect witnesses, and expanded the P-1 corpus obligation to the
  multi-step CurrentAsOf and authorization-invalidation transitions.

- **v0.12 (2026-08-01) — ratified: Status → Implemented.** Author
  ratification (Charlie, 2026-08-01), recorded with the landed evidence
  verified against the tree: the P-0..P-3 delivery Specs exist as LLP 0094
  (Review), LLP 0095 (Draft), and LLP 0096 (Draft); the P-0..P-3 execution
  tickets are filed and closed (ten `issues/closed/20260725-0093-p*` files,
  including the four P-2 spec-defect ledger entries); the D4 Swift proving
  client is landed at `clients/swift/SnapbackClient` (client core + both
  local lanes; this document's P-2 status records all 10 seeded corpus
  fixtures passing and the 13-check live harness green against the todo
  backend, and the harness has since adopted fixture-format v3,
  `4494d557`); D1/D5 publication shipped as
  `guide/protocol/client-protocol.md` plus the `clients.protocol`
  capability row (witness: `ClientStateMachine` in the Swift client) and
  the `clients.non-js` / `clients.poll-hosted` GAP rows. Statuses of the
  delivery Specs are their own review loops and are not changed by this
  ratification; `live/hosted` and the iOS proving host remain open work
  under those documents' own trackers.

Review artifacts: `llp/reviews/0093-client-protocol-and-native-clients.{fable,codex}.md`.

## Mutation-wire artifact identity amendment — 2026-08-10

The finite `POST /mutation/{name}` carrier gains two optional, closed request
members: `wireVersion` and `expectedGeneration`. `expectedGeneration` is the
existing exact five-member artifact identity (`schemaVersion`, `appId`,
`schemaHash`, `bundleHash`, and `inputsHash`) emitted into generated function
references. Its provenance is the application build: a server-returned
deployment identity or handshake echo MUST NOT be substituted, because that
would attest only the target being called, not the code that authored the
write.

An ordinary mutation is not connection-scoped and therefore cannot inherit
the version bound by `/connection/open`. It carries its own exact
`wireVersion` offer and follows LLP 0094's compatibility matrix at this finite
boundary: `snapback.v1` is known and binds the request, any present unknown
token refuses `SNAPBACK_WIRE_VERSION_UNSUPPORTED`, and absence is the legacy
offerless envelope. This does not widen or silently inherit LLP 0094's B1–B3
connection lineage; it reuses the same exact-token negotiation rule for the
otherwise unversioned finite carrier.

For a fresh, read-set-free mutation after a successor-only schema-transition
publication, a v1-bound request MUST carry `expectedGeneration` whose
`schemaHash` identifies the active side of the transition (successor for
`schema-resync`, predecessor for `rollback-resync`). Missing identity or a
non-active identity refuses `SNAPBACK_MIGRATION_UPGRADE_REQUIRED` before
function selection, acknowledgement consumption, or handler effects. An
offerless legacy request remains admitted when it carries no identity; if it
does carry identity, a non-active claim is actionable advisory evidence and
refuses. Baseline-bearing mutations remain governed by LLP 0081's row-aware
retention-floor validation.

Exactly-once settlement recovery keeps precedence: an already committed exact
mutation identity may return its recorded result before the fresh-write
migration gate, so a deployment cannot strand a settlement the server has
already made. The JavaScript client offers `snapback.v1` on every direct and
outbox-replay mutation and obtains `expectedGeneration` from its generated
reference. The Swift client does the same and accepts the build-time
`ArtifactGeneration` through configuration; absence is explicit and will be
upgrade-required only when a successor-only floor makes blind identity
mandatory.
