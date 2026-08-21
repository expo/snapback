# LLP 0095: Client lifecycle and conformance (LLP 0093 rollout cluster P-1)

**Type:** Spec
**Status:** Draft
**Systems:** Wire Protocol, Client SDK, Realtime, Live Queries, Native Clients, Tests
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-25
**Revised:** 2026-08-21 (LLP 0295 D0.5 ruling: provider connection-ownership,
auth-transition teardown/retry, callback-reentrancy, and owner-inspection
contract recorded as a dated amendment; LLP 0278's matching amendment carries
the subscription budgets); 2026-08-18 (LLP 0276 crate-path relocation); 2026-08-10 (remediation-set fixture obligations assigned by the LLP 0146 OQ6 ruling — see the dated section); 2026-07-30 (Swift harness adopts format v3: all four §2.1
judgment rules implemented, T-AUTH-TERM/T-GRANT-LOSS client transitions
aligned to the corpus dispositions); 2026-07-30 (fixture-format v3: `client_to_server` and
`client_lifecycle` directions with request/refusal fixtures, virtual-time and
lifecycle-event steps, and the §2.4 deferred rows seeded — negotiation/offer
refusals, drain-cancel duplicate tolerance, arm-mismatch, grant-loss,
wrapped/unwrapped parity for every durable family, and the T-HB/T-LOSS timing
fixtures); 2026-07-27 (LLP 0108 amendment: result-contract conformance spans
query/live publication and mutation/action completion without adding a new
client lifecycle state); 2026-07-25; 2026-07-25 (live-owner identity rule on
T-UNSUB/T-RECONNECT and the §2.1 fixture judgment rules, from the P-2
Swift clean-room defect ledger); 2026-07-26 (JS kit T-DB-P conformance);
2026-07-26 (format-v2 explicit populations, committed-kind transitions,
auth-invalidation state machine, and reconnect witnesses); 2026-07-26
(equal-data-version authorization replacement, terminal-delete state/action,
and exact duplicate re-ACK fixtures); 2026-07-26 (Swift adversarial review:
terminal no-resurrection, pending high-water, exact scope/expectation binding,
resolution floor/shape validation, and mandatory supersession witness)
**Related:** LLP 0012, LLP 0013, LLP 0031, LLP 0034, LLP 0043, LLP 0049, LLP 0051, LLP 0053, LLP 0059, LLP 0064, LLP 0077, LLP 0090, LLP 0091, LLP 0092, LLP 0093, LLP 0108,
LLP 0278, LLP 0279, LLP 0280, LLP 0295,
`issues/20260821-provider-connection-subscription-budget-decision.md`,
`issues/20260820-familiar-live-subscription-contention.md`,
`issues/20260820-guide-gap-provider-connection-lifecycle-budget.md`

## Summary

LLP 0093 (Review, dual-READY on v0.9) proposes the documented client
protocol and stages its contract into follow-on Spec clusters. This spec is
**P-1 — lifecycle and conformance**: it pins the **abstract client state
machine** (every D3 lifecycle fact as a normative transition), the
**conformance fixture corpus contract** (format, arm × lane tuple routing,
the negative-fixture inventory), and the **fixture emission mechanics**
(closing 0093 OQ3). It also records the four decisions the 0093 loop
delegated to P-1: the fact-2b transition equivalence class, the poll-lane
analogue of fact 2b, the grant-loss recovery semantics, and the end state of
the drain's `?connection_token=` dev affordance.

Wire *shapes* are not defined here — they are P-0's cluster and, until P-0
lands, the committed schemas' (LLP 0093 D1's precedence ranking governs:
serde ground truth → schemas → fixture corpus → wire-shape tests → prose,
prose always losing). This spec owns *behavior*: what a conformant client
must do with the frames those shapes describe.

Citation convention (LLP 0093 v0.10): file + symbol is authoritative; line
numbers, where given, are courtesy against origin/main at the revision this
spec landed with.

## 1. The abstract client state machine

### 1.1 Judgment model

Conformance fixtures are judged against **this model**, never against any
implementation's internals (LLP 0093 D2, "Fixtures"). The model's states are
equivalence classes of client-observable obligation, not required object
layouts: a client conforms if, for every fixture, the actions it takes are
the actions the model requires in the fixture's `given` state. The JS kit
(`packages/snapback-client/index.mjs`) is the reference implementation in
the weak sense only — where the kit and this model disagree, the model wins
and the kit has a defect (the posture that produced
`issues/closed/20260724-durable-bytes-silent-staleness.md`).

### 1.2 Connection states

A client holds at most one state per connection:

| State | Meaning |
| --- | --- |
| `IDLE` | No connection grant held. |
| `GRANTED` | Grant held (`POST /connection/open` succeeded — `open_connection`, `crates/snapback/src/server.rs`); no delivery attachment. The wire version is bound here (P-0). |
| `ATTACHED_LIVE` | Lane L: the managed socket is open (`GET /live/{connection_id}/stream`). At most one live socket per connection (LLP 0034 §2.1). |
| `ATTACHED_POLL` | Lane P: the client is the connection's drain owner, polling `GET /outbox/{connection_id}` at a **declared, bounded cadence** with backoff (the kit's default: `DEFAULT_POLL_CADENCE_MS` = 1.5 s). Exactly one drain owner; non-overlapping drains (LLP 0093 D2 demand ownership). |
| `RECOVERING` | Lane L socket lost; bounded-backoff reconnect in progress (250 ms → 10 s, LLP 0034 D0/D1). Where the arm serves Lane P and the client claims it, drain fallback may run concurrently; on the hosted arm there is no fallback (T-BLACKOUT). |
| `TERMINAL_AUTH` | Terminal authority loss: `auth_error` socket frame or close code 4401. Not reconnectable with the presented credential (LLP 0059's typed terminal closure). |
| `GRANT_LOST` | The server refused the held token (`SNAPBACK_CONNECTION_TOKEN_INVALID`) — local idle reaping or hosted grant expiry. See T-GRANT-LOSS. |
| `CLOSED` | Client-initiated teardown after demand release. |

### 1.3 Per-subscription states and the version guard

| State | Meaning |
| --- | --- |
| `PENDING` | `subscribe_live` in flight. The snapshot rides the subscribe response — snapshot-with-subscribe, one operation, no prime race (LLP 0034 §1). |
| `LIVE(version)` | Holding rows current as of `version` (the storage commit version — not a protocol version, LLP 0093 inventory item 6). |
| `RESYNC_PENDING` | A resync or unresolved authorization obligation is held. Rows may be retained internally but are unreadable and must not render until a satisfying snapshot is atomically applied. |
| `TERMINAL_DELETED` | The exact authorization-scoped materialization has been destructively retired and fenced by a `terminalDelete` resolution. It has no readable rows. Ordinary `live_replace`, `live_delta`, `current_as_of`, `resync_required`, reconnect/supersession, foreground/background reuse, and retained callbacks are diagnosed and ignored rather than resurrecting it. Only exact duplicate resolution re-ACK and explicit lifecycle cleanup remain; recreating the query allocates a fresh never-reused `queryInstanceId` and fresh-subscribes without reusing the terminal predecessor. |
| `DROPPED` | The server no longer holds the subscription (socket loss — D3 fact 2). Client-side demand may still exist; re-entry is T-RECONNECT. |
| `RELEASED` | Explicitly unsubscribed (the only *normal* release path). |

**Version guard (normative):** in `LIVE(v)`, a durable frame carrying
`version <= v` is dropped without effect; a frame carrying `version > v`
applies and advances the held version. Delta application is by operation
`id` against the durable system `_id` member of rows
(`add`/`update`/`remove`, unordered by contract); replace substitutes the
row set while preserving that identity space. A user field named `id` is
irrelevant. Fixture: `durable.live_delta.stale_version_dropped`.

This strict-greater guard applies to ordinary data envelopes. A first-seen,
current, exact authorization resolution is a separate transition: its
snapshot data version is **nondecreasing**, so `snapshot.version == held
version` is valid when the resolution witness covers the obligation and the
authenticated authorization expectation is current. Authorization and data
versions are orthogonal. Only an exact redelivery of that already-applied
resolution may skip the equal-version row application and re-acknowledge its
original token.

### 1.4 Transition catalogue

Every transition below is normative. "Both lanes" means the frame class
arrives lane-P-wrapped (`{"Durable":{"payload":[u8…]}}`,
`RealtimeEnvelope`, `crates/snapback/src/ephemeral.rs`) and lane-L-unwrapped
(`crates/snapback/src/live_wire.rs` module doc) — unwrapping is a lane obligation, not core.

- **T-OPEN** (`IDLE → GRANTED`): `POST /connection/open`. Grant carriage
  splits by transport per LLP 0031's matrix (header;
  `snapback.connection-token.<token>` subprotocol for browser-class socket
  upgrades; never a URL credential — the dev query carrier is §4.1's
  decision).
- **T-SUB** (`GRANTED/ATTACHED_* → subscription PENDING → LIVE`):
  `subscribe_live`. **Subscribe is a demand signal** with billing-visible
  side effects (LLP 0049 `WhileLive` arming; D3 fact 1): arming is
  recomputed on subscribe, unsubscribe, socket close, and connection purge;
  there is no linger window. On the **hosted arm** subscribe refuses without
  a current socket session (`SNAPBACK_CONNECTION_SOCKET_REQUIRED`,
  `targets/cloudflare/src/coordinator.js`) — socketless HTTP cannot arm hosted
  demand (LLP 0090; the one sanctioned exception is 0090/0092 bundle
  register mode, owned there). Fixture:
  `arm.hosted_subscribe_requires_socket`.
- **T-UNSUB** (`LIVE → RELEASED`): explicit unsubscribe on normal shutdown
  and backgrounding. This is a conformance obligation, not etiquette
  (LLP 0093 D2 demand ownership). **Release must present the
  subscription's establishing live owner**: the resolved authority
  identity the subscribe carried (dev mode: the `auth` object of the
  subscribe input, e.g. `auth.user_id`) on the same connection grant.
  The server's ownership predicate is `LiveSubscription::is_owned_by`
  (`crates/snapback/src/local.rs`) over `RetainedLiveAuthority::matches`
  (`crates/snapback/src/auth/invocation.rs`) — resolved-identity key, auth mode, profile,
  and exact connection effect fence — and a mismatch (including an absent
  `auth` on an authed subscription) refuses HTTP 403
  `SNAPBACK_LIVE_RESUME_OWNERSHIP` (the shared live-ownership code; scope
  documented in LLP 0094 §0E). Because T-UNSUB is an obligation, the
  identity requirement is itself conformance-load-bearing. The carriers
  are mode- and route-specific:

  | Mode | Subscribe owner | Unsubscribe/resume owner |
  | --- | --- | --- |
  | dev | nested `input.auth` | top-level `auth` |
  | sessions | bearer resolved once at `/connection/open`, then the bound connection grant | the same bound connection grant; body `auth` is refused with `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` and a later bearer is ignored |

  A conformant client retains at least the function name and original args
  for every subscription so it can reconstruct unsubscribe/reconnect. An
  `auth/live` subscription additionally retains its exact
  `authorizationNamespace` tuple
  (`clientStoreId`/`queryKey`/`queryInstanceId`); reconstructing a new
  tuple would name different client materialization state. In dev it also
  retains the establishing body identity. In sessions it never synthesizes
  body identity; a user switch opens a fresh connection.
- **T-REAP** (crash backstop, never normal release): on the local arm the
  120 s idle TTL (`CONNECTION_IDLE_TTL_MS`, `crates/snapback/src/server.rs`) reaps an
  abandoned socketless connection and releases its demand; on the hosted
  arm demand release is the socket close/error teardown (`webSocketClose`
  teardown, `targets/cloudflare/src/coordinator.js`) — the 24 h default grant TTL
  is grant *expiry*, not demand release. A conformant client treats reaping
  as the crash backstop only.
- **T-HB** (`ATTACHED_LIVE` self-loop / `→ RECOVERING`): 5 s heartbeat
  ping, 15 s freshness budget; a missed budget while the socket claims open
  forces the loss path (LLP 0034 D0/D1; the kit's `#startHeartbeat`).
  Fixtures (virtual-time, §2.1 rule 4):
  `timing.heartbeat.ping_and_pong_freshness`,
  `timing.freshness.budget_exhausted_forces_loss`.
- **T-LOSS** (`ATTACHED_LIVE → RECOVERING`; every subscription
  `→ DROPPED`): **socket loss drops the connection's durable
  subscriptions** server-side (`disconnect_topology_for_transport`,
  `crates/snapback/src/local.rs`; D3 fact 2), including a subscription whose subscribe was
  still in flight — the ambiguous in-flight outcome resolves to `DROPPED`
  and is never assumed established. Backoff 250 ms → 10 s. Fixtures:
  `arm.socket_loss_mid_subscribe`, `timing.reconnect.backoff_bounds`.
- **T-RECONNECT** (`RECOVERING → ATTACHED_LIVE`; each dropped subscription
  `→ PENDING` with `supersedes`): reconnect is **fresh subscribe with
  `supersedes`**, never implicit resumption. The fresh subscribe **must
  repeat the establishing identity**: the `supersedes` validation applies
  the same ownership predicate as T-UNSUB, and a superseded subscription
  owned by a different live owner fails closed with
  `SNAPBACK_LIVE_RESUME_OWNERSHIP` (the known-foreign-owner check in
  `subscribe_live`'s supersession validation, `crates/snapback/src/local.rs`) — so for
  authed subscriptions the retained per-subscription identity of T-UNSUB
  is also what makes reconnect possible. The successful subscribe response
  must echo the exact retired id in `superseded`; an already-absent target
  must answer `supersessionRefusal:
  "SNAPBACK_LIVE_SUPERSESSION_TARGET_UNKNOWN"`. Success without either
  witness does not prove predecessor disposal and the client must surface a
  protocol diagnostic rather than silently forgetting the predecessor.
  The predecessor remains retained until that mandatory response witness is
  processed; request success, a replacement snapshot, reconnect completion,
  or backgrounding alone is never permission to forget it.
  The reattach route
  (`resume_live`) and RQS token resume are decided ground documented as-is
  (LLP 0090/0091 §0B.4; reattach local-arm-only; no first-party client
  calls it today).
- **T-BLACKOUT** (D3 fact 2a; `live/hosted` only): during a hosted socket
  outage the drain delivers nothing (the hosted drain is declared-empty,
  `targets/cloudflare/src/coordinator.js`); reconnect-resubscribe is the **only**
  recovery lane for `live/hosted`. Fixture:
  `arm.live_hosted_drain_declared_empty_blackout`.
- **T-DB** (D3 fact 2b; `ATTACHED_LIVE`, connection-wide): a
  `durable_bytes` socket frame (`LiveSocketServerFrame::DurableBytes`,
  `crates/snapback/src/live_wire.rs`) is a **known kind with a required recovery action**.
  Its payload's outbox lease was already released at socket handoff; the
  update is unrecoverable and unattributable. The normative obligation is
  the forced-resync **equivalence class** of §4.2: every durable
  subscription re-enters fresh snapshot-with-subscribe and retained
  ephemeral overlays clear. Ignoring is non-conformant. Fixture:
  `socket.durable_bytes.forced_resync`.
- **T-DB-P** (the poll-lane analogue of fact 2b — decided here, §4.3): a
  durable item in an **acknowledged** drain batch whose payload fails to
  decode is lost the same way (the ownership cut has passed; no redelivery
  will occur). The client MUST deliver the remainder of the batch (nothing
  per-item aborts an acknowledged batch) **and** take the same
  connection-wide forced-resync transition class as T-DB. Fixture:
  `poll.acknowledged_batch.malformed_item_forces_resync`.
- **T-DRAIN** (`ATTACHED_POLL` self-loop): the drain is the LLP 0059
  **leased batch with an ownership-transfer cut**: entries are selected
  without removal, removed only once ownership transfer is accepted, and
  released — possibly redelivered — on cancellation before the cut
  (`drain_outbox`, `crates/snapback/src/server.rs`). Clients MUST be duplicate-tolerant
  across cancelled drains. Batch bound `MAX_OUTBOX_DRAIN_BATCH = 64`;
  handoff/retention budgets 64 MiB (`crates/snapback/src/ephemeral.rs`). Fixture:
  `poll.drain_cancel.redelivered_duplicates_tolerated`.
- **T-OVERFLOW** (both lanes; connection-wide): a `resync_required` with no
  `subscription_id` and `clear_retained: true` (the `outbox_overflow`
  class) voids the whole connection's retained continuity: every durable
  subscription `→ RESYNC_PENDING` → resubscribe, and retained **ephemeral**
  overlays blank too — the one control shape that crosses the lane boundary
  (LLP 0059; the kit's `isConnectionWideClearRetainedResync`). Fixture:
  `durable.resync_required.connection_wide_clear_retained`.
- **T-RESYNC** (subscription-scoped): `resync_required` with a
  `subscription_id` sends that subscription `→ RESYNC_PENDING` →
  resubscribe. `reason` is an **open string** (`crates/snapback/src/live_wire.rs`,
  `LiveEnvelope::ResyncRequired`): recovery is identical for every reason
  and an unknown reason must not change the transition.
- **T-APPLY** (D3 fact 4): `live_replace` vs `live_delta` is **the server's
  choice, always** (`crates/snapback/src/live_matcher.rs` decides analyzability). A client
  implements both paths and never infers query shape from which arrives.
- **T-CURRENT-AS-OF** (`LIVE(v) → LIVE(v')`, `v' > v`): adopt the
  mandatory fresh resume token and advance the held version without
  replacing or mutating rows. Equal/stale versions obey the ordinary
  version guard. Fixture:
  `durable.current_as_of.adopts_token_without_rows`.
- **T-AUTH-INVALIDATION** (auth/live; level-triggered): locate the exact
  held subscription by the complete bound `scopeId`, not
  `subscriptionId` alone, and require its issuer/connection generation,
  namespace, and authorization/data expectation to match the authenticated
  current connection. A same-id frame with a different namespace or
  expectation is foreign: diagnose and ignore it without quarantine or ACK.
  For an accepted obligation, persist its exact scope, revision, and witness
  high-water **before** immediately making held rows unreadable. Quarantine
  never discards or lowers that pending high-water; an older resolved ticket
  cannot apply or acknowledge while a newer obligation remains unresolved.

  Validate a resolution against the exact full
  `scopeId`, revision, authorization witness, data stream/floor,
  disposition, owner continuity, kind, and token before applying it.
  `kind: "snapshot"` requires a present snapshot and its version must cover
  `resolution.witness.data.minCommitVersion` as well as the obligation
  floor. `kind: "terminalDelete"` requires snapshot absent/`null`; either
  kind/shape mismatch is diagnosed and never applied or acknowledged.
  If a satisfying snapshot resolution is present, its data version must be
  nondecreasing against the held version; atomically apply its
  rows/version and return to `LIVE` even when the data version is equal
  but the authenticated authorization expectation is new. Only after that
  apply succeeds may the client acknowledge the exact resolution
  `ackToken`.

  A `terminalDelete` resolution carries no snapshot (wire omission and
  JSON `null` are equivalent). Atomically destroy the exact
  materialization, install its terminal fence/live boundary, and enter
  `TERMINAL_DELETED`; only after that destructive commit succeeds may the
  client acknowledge its exact token. With no satisfying resolution,
  remain `RESYNC_PENDING` with rows retained-but-unreadable and do not
  acknowledge.

  An exact duplicate delivery of an already-applied resolution may
  re-acknowledge the same token without reapplying equal-version rows or
  repeating terminal destruction. A reused token with changed ticket
  fields, or a conflicting ticket for one scope/revision, is surfaced as a
  protocol diagnostic and never acknowledged. An obligation for a
  subscription the client does not hold is surfaced and ignored, never
  acknowledged on the foreign owner's behalf. Failure to acknowledge
  leaves the obligation held and redelivered (LLP 0053's level-triggered
  rule). Fixtures:
  `auth.live.invalidation_snapshot_apply_then_ack`,
  `auth.live.invalidation_authorization_snapshot_same_data_version`,
  `auth.live.invalidation_terminal_delete_apply_then_ack`,
  `auth.live.invalidation_terminal_delete_blocks_ordinary_live_reuse`,
  `auth.live.invalidation_newer_pending_rejects_older_resolution`,
  `auth.live.invalidation_owned_id_mismatched_scope_never_acknowledged`,
  `auth.live.invalidation_invalid_resolution_never_acknowledged`,
  `auth.live.invalidation_without_snapshot_quarantines`, and
  `auth.live.foreign_obligation_never_acknowledged`.
- **T-AUTH-TERM** (`→ TERMINAL_AUTH`): `auth_error` frame / close code
  4401. The `authorityDisposition` distinguishes carrier loss from durable
  authority deletion (`LiveAuthorityDisposition`, `crates/snapback/src/live_wire.rs`).
  Fixtures: `auth.live.terminal_auth_carrier_disposition`,
  `auth.live.terminal_auth_durable_delete_disposition`.
- **T-GRANT-LOSS** (`→ GRANT_LOST → IDLE`): on
  `SNAPBACK_CONNECTION_TOKEN_INVALID`, recovery **re-opens the connection
  and re-establishes every subscription** (§4.4): a reaped/expired grant's
  server state — subscriptions, outbox, retained continuity — is gone, so a
  fresh grant is a fresh connection identity; treating recovery as
  grant-refresh-only would resurrect the fake-healthy-handle defect class.
  Fixture: `grant.connection_token_invalid_reopens_everything` (one
  fixture covers both the reap and expiry origins — the refusal is
  indistinguishable and the recovery identical).
- **Tolerance floor** (defense-in-depth, both lanes): unknown envelope
  kinds are skipped, never fatal (new kinds are always offer-gated per LLP
  0093 D1, so a conformant server never sends one ungated); unknown fields
  on known kinds are ignored. Tolerance is not a license for known kinds —
  T-DB is the counterexample. Fixtures: `negative.unknown_kind.skipped`,
  `negative.unknown_field.tolerated`.

### 1.5 Action vocabulary

Fixture `expect.actions` draw from this closed set (additions revise this
spec): `replace_rows`, `apply_delta_by_id`, `drop_stale`,
`resubscribe_subscription`, `resubscribe_all`, `clear_retained_overlays`,
`unwrap_durable`, `deliver_batch_remainder`, `surface_decode_diagnostic`,
`ignore_frame`, `ignore_unknown_fields`, `surface_terminal_auth`,
`reopen_connection`, `adopt_resume_token`, `quarantine_rows`,
`apply_invalidation_snapshot`, `apply_invalidation_terminal_delete`,
`acknowledge_obligation`, `surface_protocol_diagnostic`.

Format v3 adds, for the refusal/lifecycle/timing classes:
`surface_capability_diagnostic` (a structured LLP 0064-style capability
refusal surfaced to the caller), `retry_unchanged` (appears only in
`forbiddenActions` — the blind-retry anti-obligation),
`establish_live_socket`, `send_ping`, `force_socket_loss`, and
`attempt_reconnect` (the two timer actions of §2.1 rule 4); and for the
LLP 0096 profile classes: `delete_local_durable_authority` (T-AUTH-TERM's
`durableDelete` disposition), `settle_client_mutation`,
`discard_duplicate_settlement`, `suspend_predecessor_queue`,
`replay_queued_mutations` (forbidden-only), and `fence_retained_rows`
(lease expiry, LLP 0059's transition table).

## 2. The conformance fixture corpus contract

### 2.1 Artifact and format

The corpus is the committed artifact `schemas/live.wire-fixtures.v1.json`
(`artifactKind: liveWireFixtureCorpus`, `formatVersion: 3`,
`wireVersion: "snapback.v1"`), generated by
`snapback::wire_fixtures::wire_fixture_corpus()` (`crates/snapback-types/src/wire_fixtures.rs`).
Each fixture carries: `name`, `family` (the committed schema file the frame
instantiates; `null` for unknown-kind negatives), `lane`
(`core`/`live`/`poll`), `tuples`, `direction`, `schemaValid`, either
`frame` or ordered `steps[]` of `{frame, expect}` (plus optional
`batchContext` for drain-batch semantics), `given` (§1
preconditions), `expect` (transitions + actions from §1.5), `notes`.

**Format v3** (2026-07-30) grows the shape in three ways — a version bump,
not additive drift, because a v2 consumer's judgment (feed every fixture's
frame to the client) would misjudge the new classes:

- **`direction: "client_to_server"`** fixtures pin the refusal half of the
  negotiation/offer surface. They carry a `request`
  (`{method, route, headers?, subprotocols?, body?}`) instead of a
  `frame`; `family` (when non-null) is the committed schema the request
  **body** instantiates (the `schemaValid` claim covers that body), and
  exactly one of `refusal` (`{status, code, details?}` — the shipped
  server answer, code-pinned against the served refusal registry) or
  `response` (`{status}`) accompanies each request. `expect` holds the
  client's obligations on processing that answer. Multi-step request
  fixtures put `request`/`refusal`/`response` on each step, and a step
  may override `family` when its body instantiates a different committed
  schema.
- **`direction: "client_lifecycle"`** fixtures carry no wire frames at
  all: their steps are advance/event steps only, and `family` is `null`.
- **Step forms**: besides `{frame, expect}`, a step may be a
  virtual-clock advance (`{"advanceVirtualTimeMs": N, "expect": …}`,
  positive, only in fixtures declaring `"clock": "virtual"`) or a named
  client-observable lifecycle event (`{"event": {"kind": …}, "expect": …}`
  — kinds so far: `socket_lost`, `authority_instance_changed`).

The `given.connection` population rule (rule 3 below) applies to the
populated connection states (`attached`, `recovering`); the v3
pre-population states (`idle`, `granted`) have no subscriptions to pin by
construction.

**Canonical frames in, expected transitions/actions out**: a per-client
conformance harness feeds each `frame` to the client in the `given` state
and asserts the `expect` obligations against the §1 model. The corpus is
**normative for clients** (LLP 0093 D1 precedence) — complete over the
specified behavior classes, not exhaustive over all valid schema values.

**Judgment rules** (rules 1–3 pinned 2026-07-25 from the P-2 clean-room
defect ledger, rule 4 with format v3 — without them two independent
harnesses could pass the same corpus under different judgments; the Swift
harness, `clients/swift/SnapbackClient`, `FixtureHarness.swift`, is the
first consumer implementing all four, with the rule-4 virtual clock in
`VirtualTransportSupervisor`, `TransportTiming.swift`):

1. **Actions are an exact, unordered set.** A client's emitted actions for
   a fixture must equal `expect.actions` as a set — no omissions, no
   extras; order is not asserted unless `orderedActions` is present.
   `expect.actions` is neither a trace nor a minimum obligation the client
   may exceed.
   A step may additionally carry `orderedActions`; only that list asserts
   ordering, and it must be observed exactly. Top-level `expect` on a
   multi-step fixture is the cumulative/final judgment after all steps.
2. **Batch composition and subsumption.** For fixtures carrying
   `batchContext`, the evaluated drain batch is the fixture's `frame`
   followed by the `batchContext` entries in order. In a batch containing
   an undecodable item, all per-item effects of the remaining items —
   both actions and transitions — are **subsumed**
   under the single `deliver_batch_remainder` action; a clean batch
   reports per-item actions explicitly (contrast
   `poll.acknowledged_batch.malformed_item_forces_resync` with
   `poll.wrapped_durable.unwrap`).
3. **Attached-connection population.** Every fixture with a populated
   `given.connection` (states `attached`/`recovering`) carries an
   explicit, non-empty `given.subscriptions` list. Harnesses instantiate
   those exact ids, states, versions, and rows; no implicit/arbitrary
   population exists.
4. **Virtual time** (format v3). A `clock: "virtual"` fixture's harness
   holds a virtual clock starting at 0; frame/request/event steps are
   instantaneous, and an advance step advances the clock by exactly its
   `advanceVirtualTimeMs` with no wire input. Over an advance interval
   `expect.actions` remains the exact **set** of action kinds emitted —
   the timer actions (`send_ping`, `attempt_reconnect`) may repeat within
   the interval — and an optional `expect.pacing`
   (`{action, maxIntervalMs}`) bounds the spacing of consecutive
   emissions of that action inside the interval.

Positive frames are constructed **through the serde wire types**, so a
fixture can never drift from the wire; negative frames are raw JSON.
`crates/snapback/tests/wire_fixtures_v1.rs` proves every `schemaValid` claim against the
committed family schema, and additionally proves each family-less negative
is unknown to *both* live-wire families (the known-kind/unknown-kind
distinction fact 2b turns on).

### 2.2 Arm × lane tuple routing

Fixtures are evaluated per conformance tuple. The v1 claimable set is
`poll/local`, `live/local`, `live/hosted` (LLP 0093 D2); **`poll/hosted` is
not claimable** and never appears in a fixture's `tuples` (gate-enforced in
`crates/snapback/tests/wire_fixtures_v1.rs`). Wrapper-framing fixtures are assigned to
their lane (`lane: "poll"`), never core; `live/hosted` inherits no drain
obligations. Tuples are claimed independently; composition is permitted,
not required. LLP 0064's per-OS evidence rule applies unchanged.

### 2.3 `schemaValid` vs acceptance

`schemaValid` is the **emission** claim (does the committed schema, which
describes what current servers emit, admit this frame?). The **acceptance**
claim is `expect`, and where they diverge the acceptance grammar wins (LLP
0093 D1): `negative.unknown_kind.skipped` is `schemaValid: false` yet must
be tolerated; `socket.durable_bytes.forced_resync` is `schemaValid: true`
yet mere tolerance is non-conformant.

### 2.4 Negative-fixture inventory

The positive corpus now covers all five committed `LiveEnvelope` kinds:
`live_replace`, `live_delta`, `resync_required`, `current_as_of`, and
`authorization_invalidation`. The last two are judged by
T-CURRENT-AS-OF and T-AUTH-INVALIDATION rather than by the tolerance floor.
The auth/live class includes first application at an equal data version,
snapshot and terminal-delete exact duplicate re-ACK, quarantine without a
resolution, terminal no-resurrection, pending revision/witness high-water,
snapshot-floor and kind/shape refusal, and foreign exact-scope refusal.

The full inventory LLP 0093 D2/P-1 enumerates, with seeding status:

| Class | Fixture / status |
| --- | --- |
| Unknown kind | `negative.unknown_kind.skipped` — **seeded** |
| Unknown field on known kind | `negative.unknown_field.tolerated` — **seeded** |
| `durable_bytes` vs unknown-kind distinction | `socket.durable_bytes.forced_resync` + the unknown-kind fixture — **seeded** |
| Malformed item in an acknowledged batch | `poll.acknowledged_batch.malformed_item_forces_resync` — **seeded** |
| Connection-wide resync / overflow | `durable.resync_required.connection_wide_clear_retained` — **seeded** |
| Malformed capability offers | `negotiation.open.unknown_wire_version_refused`, `negotiation.open.unknown_auth_invalidation_protocol_refused`, `negotiation.socket.wire_version_required`, `negotiation.socket.unknown_wire_version_refused` (format-v3 `client_to_server`; the auth-profile offer negatives are LLP 0096 §8.4's) — **seeded** |
| Cancelled/duplicated drains (duplicate tolerance) | `poll.drain_cancel.redelivered_duplicates_tolerated` — **seeded** |
| Arm-mismatch transitions (`poll/hosted` attempt; hosted subscribe before socket establishment; socket loss mid-subscribe) | `arm.live_hosted_drain_declared_empty_blackout`, `arm.hosted_subscribe_requires_socket`, `arm.socket_loss_mid_subscribe` — **seeded** |
| Grant-loss recovery (`SNAPBACK_CONNECTION_TOKEN_INVALID`, both reap and expiry paths) | `grant.connection_token_invalid_reopens_everything` (one fixture — the refusal is origin-indistinguishable, §4.4) — **seeded** |
| Wrapped/unwrapped parity per durable family | `poll.wrapped_durable.unwrap` + `poll.wrapped_live_delta.unwrap`, `poll.wrapped_resync_required.*`, `poll.wrapped_current_as_of.adopts_token_without_rows` (byte-exact against the core siblings, gate-enforced) — **seeded** |
| Heartbeat/freshness/backoff timing | `timing.heartbeat.ping_and_pong_freshness`, `timing.freshness.budget_exhausted_forces_loss`, `timing.reconnect.backoff_bounds` (virtual time, §2.1 rule 4) — **seeded** |

The formerly deferred rows landed 2026-07-30 with fixture-format v3
(`issues/closed/20260725-0093-p1-fixture-corpus-coverage.md`). The
`durable_bytes` socket frame deliberately has no wrapped form — it is
Lane-L framing itself, and its Lane-P analogue is the acknowledged-batch
malformed item.

## 3. Fixture emission mechanics (closes LLP 0093 OQ3)

**Decision: extend `artifact_instances()`** (`crates/snapback/src/schema_export.rs`) — the
least-drift path OQ3 anticipated. The corpus rides the exact pipeline the
data-tier profile and the LLP 0080 golden vectors already ride: one
generator (`wire_fixture_corpus()`), two callers (`snapback-schemagen`
writes; `crates/snapback/tests/artifact_schemas_v0.rs`
`dk7_committed_public_instances_match_rust_types` compares), so the
committed file cannot diverge from the generator, and a live-wire serde
change that skips regeneration fails CI. `crates/snapback/tests/wire_fixtures_v1.rs` adds
the corpus-internal honesty gates (§2.1, §2.2). No separate generator
binary exists or is planned; a second emission path would reintroduce
exactly the drift the single-generator rule prevents.

## 4. Decisions recorded

### 4.1 The drain's `?connection_token=` dev affordance — **retained, constrained**

The query carrier (`ConnectionGrantCarrierKind::DevQuery`,
`crates/snapback/src/server.rs`) is kept as a dev-arm convenience: sessions-mode route
policy already refuses it (`dev query credential fallback remains live in
sessions` is a route-validation failure, `crates/snapback/src/server.rs`), it never carries
a sender proof, and header/subprotocol carriage is the conformant path. It
is **not** part of any conformance tuple's obligations — a conformant
client never sends it. Removing it would break the local-arm curl/debug
workflow for no security gain the sessions-mode constraint doesn't already
provide. The `drain_outbox` doc comment now states this posture, so code
comment and spec teach the same thing.

### 4.2 Fact 2b's transition equivalence class

Per LLP 0093 v0.10: the obligation is defined by its transitions — every
durable subscription re-enters fresh snapshot-with-subscribe and retained
ephemeral overlays clear. The kit's **in-place sentinel**
(`dispatchDurableBytesFrame` synthesizing the server's outbox-poison shape
with reason `durable_bytes_undecodable`) is the **reference behavior**; a
**socket bounce** (close/reconnect with fresh subscribe) achieving the same
transitions is a **permitted equivalent** — a Swift client need not
implement the sentinel. The reason string is **client-synthesized, never
wire-emitted**: the server's `resync_required.reason` namespace does not
contain it, and the fixture corpus must not teach implementers to expect it
from the wire.

### 4.3 The poll-lane analogue of fact 2b — **symmetric**

Decided (Round-7 Fable suggestion 4): the two lanes' never-silently-stale
guarantees stay symmetric. A post-cut undecodable durable item forces the
same connection-wide resync class as `durable_bytes` (T-DB-P), because the
loss is identical in kind: unattributable, unrecoverable, already paid for.
The JS kit now conforms: `drainConnection`
(`packages/snapback-client/index.mjs`) surfaces
`SNAPBACK_ENVELOPE_DECODE_FAILED`, routes the existing authority-captured
`durable_bytes_undecodable` connection-wide clear-retained sentinel through
the shared durable-lane recovery choke point, and then continues the batch.
`demos/_kit/tests/regression-poll-decode-resync.mjs` proves diagnostic plus
durable/ephemeral remainder delivery, all-durable resubscribe with lost-state
recovery, and retained-overlay clearing. The closed implementation ticket is
`issues/closed/20260725-0093-p1-poll-lane-decode-failure-resync.md`.

### 4.4 Grant-loss recovery — **re-open and re-establish everything**

On `SNAPBACK_CONNECTION_TOKEN_INVALID` (local idle reap or hosted grant
expiry), recovery re-opens the connection (fresh grant) and re-establishes
**every** subscription; retained overlays are treated as void. Rationale in
T-GRANT-LOSS. "Refresh only the grant" is rejected: the server kept no
subscription or outbox state to refresh against, and the client cannot
distinguish reap from expiry at the refusal.

## 5. Companion changes landed with this spec

- **Fixture generator skeleton**: `crates/snapback-types/src/wire_fixtures.rs`, the
  `artifact_instances()` entry, the committed
  `schemas/live.wire-fixtures.v1.json`, and `crates/snapback/tests/wire_fixtures_v1.rs`.
- **The dispatch-wiring test seam** (`issues/closed/20260725-durable-bytes-dispatch-test-seam.md`):
  `LiveStreamManager.debugInjectFrame(frame)` routes through the extracted
  `#receiveFrame` — the real receive path (authority-fence commit into
  `#dispatch`) shared with the live `message` listener — and
  `demos/_kit/tests/regression-durable-bytes-resync.mjs` gains a third
  section (4 checks) proving frame-at-seam → sentinel-in-registry with the
  propagated authority capture asserted non-vacuously.
- **Stale destructive-drain comments retired** (the 0093 P-1 obligation):
  the kit's `drainConnection` header and `crates/snapback/src/server.rs` `drain_outbox`
  header now state the LLP 0059 leased-batch ownership-cut contract, and
  the latter records §4.1's decision.
- **Poll-lane post-cut decode recovery** (T-DB-P): the kit now routes an
  acknowledged malformed durable item through the same connection-wide
  client-synthesized recovery sentinel as `durable_bytes`, while preserving
  the diagnostic and acknowledged-batch remainder; the focused regression is
  wired into `scripts/verify-local-proof`.

### LLP 0108 result-contract conformance

Result-contract validation adds no client state and does not retarget resume or
replay identity. Conformance evidence covers these existing envelope families:

- an invalid query or live-query row array yields the registered structured
  refusal and is never installed, cached, or delivered as a snapshot/update;
- an invalid mutation result rolls back writes, creates no successful
  settlement, and advances no durable version;
- an invalid action result is refused before response publication, without
  claiming rollback of external effects; and
- a valid retained mutation result replays under LLP 0043's existing identity
  and 65,536-byte settlement ceiling using its frozen effective validator.

Generated-reference exactness is tested separately from wire lifecycle:
headless and first-party React calls infer their argument/result payload from
the reference and expose no caller result-generic override. Legacy untyped
references remain `unknown`. The v1 fixture corpus does not gain an
expected-operation tuple or compatibility-policy transition.

## 6. Deferred work

- ~~The §2.4 deferred rows, wrapped-vs-unwrapped parity, and the
  heartbeat/backoff timing fixtures~~ — landed 2026-07-30 as fixture-format
  v3 (`issues/closed/20260725-0093-p1-fixture-corpus-coverage.md`).
- ~~The per-client conformance harness that replays the corpus against a
  real client~~ — the Swift harness (`FixtureHarness.swift`) adopted
  format v3 on 2026-07-30
  (`issues/closed/20260730-swift-fixture-harness-format-v3.md`): it
  implements all four §2.1 judgment rules (the rule-4 virtual clock lives
  in `VirtualTransportSupervisor`, `TransportTiming.swift`) and evaluates
  every fixture the corpus routes to the claimed `poll/local`/`live/local`
  tuples (77 per-tuple evaluations across all 49 fixtures; the only skips
  are the two `live/hosted`-only fixtures under §2.2 tuple routing). The
  JS kit still binds via this spec's normative force and its regression
  suites; a kit-side corpus replay remains open.

## Amendment (2026-08-03 — LLP 0162, effective with its acceptance)

Accepted LLP 0162 (contracts in LLP 0163) extends the conformance surface at
this tier: the operation-identity obligations of LLP 0012's same-dated
amendment (pre-attempt minting on covered lanes, versioned negotiation and
cutover, atomic range persistence and reconnect refresh, outcome-unknown
handling of `identity-horizon-passed`, outcome-known handling of
`result-expired`) apply to protocol clients, and the wire shapes for
identity, epoch, and range negotiation are the generated schemas LLP 0163
owns rather than hand-authored frames.

## Remediation-set fixture obligations (LLP 0146 OQ6 ruling) — 2026-08-10

The 2026-08-10 author ruling (LLP 0094's matching dated amendment) assigns
this Spec the conformance surface for `diagnostic.details.remediationSet`.
Because remediation is a cross-projection Diagnostic concern rather than a
live-lifecycle frame, its committed companion corpus is
`schemas/remediation.wire-fixtures.v1.json`, with exact
`formatVersion: "snapback.remediation-fixtures.v1"`; the live corpus stays at
format v3 and its structure does not change. The companion corpus is emitted
through `artifact_instances()` and drift-gated by the same one-generator,
two-caller discipline as §3.
Required fixture families, all cross-projection (CLI, HTTP, MCP, hosted):
positive offers (each landed refusal family that constructs a set); unknown
remediation kind ignored without failing the diagnostic; unknown member
inside `remediationSet` ignored; stale-artifact-hash repair refusal (named
code, no write); disclosure negatives (no secret, no rejected value, no
pre-gate existence oracle in any offer); approval semantics
(`requiresApproval: true` items never auto-applied by the reference
consumers); and byte-for-byte diagnostic parity across projections. New
semantics require explicit fixtures and lifecycle actions per this Spec's
standing rule; the carrier's nested `schemaVersion` advances rather than
drifting incompatibly. Within recognized v1, additive unknown members are
ignored, an unknown kind is skipped, and an unknown nested schema or registry
version disables remediation interpretation without invalidating the
surrounding diagnostic. The hard bound is eight items; every
machine-applicable fixture binds item and carrier to the exact same observed
artifact hash.

## Provider connection-ownership and lifecycle contract (LLP 0295 D0.5 ruling) — 2026-08-21

**Adopted per LLP 0295; author may revise.** This amendment records the
connection-lifecycle half of the D0.5 decision packet
(`issues/20260821-provider-connection-subscription-budget-decision.md`); the
LLP 0278 amendment of the same date carries the subscription budgets,
independent-versus-aggregate consistency ruling, equal-snapshot deduplication,
fan-out, and callback-reentrancy contract. LLP 0280's matching note registers
the auth-transition rebuild as a consumer of the persona-replacement seam.
The numeric bounds here are **explicit provisional bounds**: the parallel
six-subscription investigation
(`issues/20260820-familiar-live-subscription-contention.md`, LLP 0295 1D) may
tighten or confirm them before they are conformance-frozen as fixtures.

### Connection ownership per app authority/origin

- The unit of connection ownership is the tuple **(app, server origin,
  settled authority)** within one client runtime. A conformant
  provider/headless composition holds **one** managed connection per tuple,
  shared through a connection manager; N provider cells, hooks, or views over
  the same tuple never imply N transport connections
  (`issues/20260820-guide-gap-provider-connection-lifecycle-budget.md`'s
  regression fixture proves exactly this).
- The provisional total budget is **at most 2 concurrent connections per
  tuple-adjacent pair**, and only transiently: the sanctioned overlap is an
  authority replacement in flight (predecessor draining teardown while the
  successor opens). Steady-state parallel connections for one tuple are
  unsupported composition and earn a structured diagnostic, not silent
  admission.
- Distinct settled authorities (two principals in a two-client test harness,
  anonymous versus authenticated) are distinct tuples and rightly hold
  distinct connections; the budget is per tuple, not per process.

### Teardown and retry after auth transitions

- **Subscribe-after-settle.** Providers subscribe against the auth
  coordinator's *settled* authority state, never by polling their own client
  objects or retrying on an empirical cadence. An operation started during an
  authorization barrier follows LLP 0295 D0.2's transition matrix (owned
  there); this spec's obligation is that the provider consumes that settled
  state as an event, not a poll.
- **Principal-class change tears down before it builds.** On authority
  replacement the provider releases every predecessor-owned subscription
  (T-UNSUB, presenting the establishing owner) and, in sessions mode, opens a
  fresh connection for the successor — the bearer is bound at
  `/connection/open`, so a user switch is never a rebind (§1.4 T-UNSUB table;
  LLP 0280's two-transition persona-replacement composition).
- **Retry is the existing bounded machinery.** Socket loss and grant loss
  recover through T-LOSS/T-RECONNECT backoff (250 ms → 10 s) and
  T-GRANT-LOSS re-open-everything. Providers add no parallel retry loops on
  top; a rebuilt stream after an auth transition is a fresh
  snapshot-with-subscribe, and transport-only rebuilds that deliver
  value-equal rows must not republish to consumers (dedup contract, LLP 0278
  amendment).

### Runtime and diagnostic inspection of active owners

The client exposes an inspection surface (exact carrier named by the
implementation ticket; the shape aligns with LLP 0295 W5) enumerating, per
connection: the ownership tuple, connection state (§1.2), and grant age; and
per subscription: the owning surface label (provider cell, hook, view, or
headless caller), function name, subscription state (§1.3), held snapshot
version, auth-barrier/readiness state, and — when delivery is suspended — the
outbox suspension reason. This is the observability floor the Diary 0105
investigation lacked: every "missed delivery" claim should be answerable from
inspection output rather than source reading. Diagnostics fire *before* a
budget or ceiling refuses: approaching the 64-per-connection transport
ceiling or exceeding the provisional per-view budget emits a structured
warning naming the owner labels and the paved alternatives.

### Consumers

Exact's `ContractDataProvider` runtime consumes this contract through LLP
0279 (provider-lifecycle integration, W7 step 3) rather than inventing a
parallel Snapback-specific adapter policy, and the provider guide recipe
(`issues/20260820-guide-gap-provider-connection-lifecycle-budget.md`) teaches
this contract rather than empirical adapter folklore once the follow-on
tickets land.
