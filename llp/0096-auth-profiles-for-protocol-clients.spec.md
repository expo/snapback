# LLP 0096: Auth profiles for protocol clients (LLP 0093 rollout cluster P-3)

**Type:** Spec
**Status:** Draft
**Systems:** Auth, Wire Protocol, Client SDK, Native Clients, Realtime, Live Queries, HTTP surface
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-25
**Revised:** 2026-08-15 (native sender-custody ownership) — Draft LLP 0260 now
owns the off-browser sender-constraint questions enumerated in §5. The gap
remains unchanged until that sibling Spec is accepted and implemented.
**Revised:** 2026-07-30 (the §8.4 fixture obligations landed: every §2
profile fixture class is seeded in the format-v3 corpus — auth/rr refusal
surfacing and malformed-offer negatives, the auth/live open-time/subscribe
offer halves, descriptor independence, terminal `authorityDisposition`
fixtures and wrapped invalidation parity, the auth/replay triple reflecting
the §8.1 InvocationSource split, and the auth/lease pair; `auth/sender`
stays deliberately unseeded per §5). 2026-07-26 (external session-bearer
adoption and the trusted
local identity-broker seam are pinned separately from browser/native sender
constraint). 2026-07-25 (initial draft; §7 hosted floor decided —
LLP 0093 OQ5 ratified as recommended; §8.1 decided as defect and fixed —
the invalidation-ack routes no longer demand the `auth/replay` offer, and
§2.2's interop instruction is retired); 2026-07-26 (Partitime clean-room
recipe completion: offer scope, namespace, casing/outcomes/refusals,
connection-bound authority, and client-vs-readiness status split);
2026-07-26 (equal-data-version snapshot application, terminal-delete
delete-before-ACK, and exact duplicate resolution identity); 2026-07-26
(Swift adversarial review: exact held scope/expectation, pending high-water,
resolution floor/shape validation, terminal no-reuse, and supersession witness)
**Related:** LLP 0012, LLP 0031, LLP 0043, LLP 0053, LLP 0055, LLP 0057,
LLP 0058, LLP 0059, LLP 0060, LLP 0064, LLP 0077, LLP 0090, LLP 0093,
LLP 0094, LLP 0095, LLP 0260

## Summary

This is the **P-3 cluster** of LLP 0093 (the client-protocol RFC): the
**auth profile contract** for protocol clients — the named, orthogonal
capability claims a client of either delivery lane may offer, mapped
one-to-one onto Accepted LLP 0059's independent item-5 availability axes.
It pins, as normative contract:

- **§1** — the profile model: five named profiles, their one-to-one axis
  mapping, and the rule that no profile implies another.
- **§2** — the per-profile contract: exact carriers (header, WebSocket
  subprotocol, open-time body member — per LLP 0031's transport matrix),
  offer/refusal semantics composing with LLP 0094 §0B's negotiation
  (including which profiles are open-time vs subscribe-time vs
  per-request gated), the arm matrix verified against code, and the
  conformance obligations a claiming client takes on, tied into LLP
  0095's state machine with the fixture classes each profile adds.
- **§3** — discovery: how `GET /auth/session` projects the axis
  availability matrix, and the dev-mode posture.
- **§4** — the **LLP 0012 mapping**: how profile combinations project
  onto `Online`/`Parity` capability reports, with LLP 0064's per-OS
  evidence rules inherited unchanged.
- **§5** — **off-browser sender-constraint**: precisely what is and is
  not defined today, and what a native custody story must pin —
  coordinated with LLP 0077, not invented here.
- **§6** — the **integration index** of provider auth lifecycle routes a
  client touches, each with a pointer to its owning LLP — referenced,
  never re-specified (0093 P-3's rule).
- **§7** — the **hosted-production mandatory-profile floor** (LLP 0093
  OQ5), decided 2026-07-25: the recommended floor is ratified.
- **§8** — verification findings from the code pass, including two
  divergences between doctrine and shipped code, filed as tickets.

The auth *lifecycle* — provider state machines, session projection,
invalidation semantics, sender-proof algorithms — stays owned by LLP
0053/0057/0058/0059/0060/0077. This spec owns only the **client-facing
profile surface**: what a client offers, where it offers it, what refusal
looks like, and what claiming a profile obligates.

Citation convention (LLP 0093 v0.10): file + symbol is authoritative;
line numbers are courtesy, pinned against origin/main `0de3e875`.

## 1. The profile model

### 1.1 Five named profiles

| Profile id | Claim | LLP 0059 axis | Owning docs |
| --- | --- | --- | --- |
| `auth/rr` | authenticated request/response | `onlineRequestResponse` | LLP 0057/0058/0059 |
| `auth/live` | auth-scoped live with the invalidation acknowledge protocol | `authScopedLive` | LLP 0053/0059 |
| `auth/replay` | authority descriptors / queued replay | `queuedReplay` | LLP 0043/0059 |
| `auth/lease` | authorized leases / retained reads | `retainedReads` | LLP 0059 (lease shape: `src/auth/lease.rs`) |
| `auth/sender` | sender-constrained custody (browser-class) | — (custody plane, not an availability axis) | LLP 0077 (posture: LLP 0060) |

The first four map **one-to-one** onto LLP 0059's independent item-5
availability axes (`AuthSessionAvailability`,
`src/auth/handshake.rs:282-289`: `onlineRequestResponse`,
`authScopedLive`, `retainedReads`, `queuedReplay`). `auth/sender` is
deliberately **not** a fifth axis: LLP 0059's matrix is about what work a
session admits; sender-constraint is about how credentials are custodied
and presented on a deployment posture (LLP 0077). Flattening it into the
axis matrix would re-bundle independent planes, which Accepted LLP 0059
forbids.

### 1.2 Orthogonality rules (normative)

- **No profile implies another.** A client claims each profile
  independently; an authenticated poll-only client (`auth/rr` alone) is a
  legitimate shape (LLP 0093 D2's rationale for rejecting cumulative
  tiers). Missing protocol evidence keeps only its owning axis false
  (LLP 0059 §Independent item-5 availability axes).
- **Declared composition is not bundling.** Two server-side availability
  couplings exist and are declared in the wire DTO, not inferred:
  `auth/lease` availability requires the invalidation offer
  (`RetainedReadAvailability` carries both
  `minimumAuthInvalidationProtocol` and
  `minimumAuthorizedLeaseProtocol`, `src/auth/handshake.rs:251-268`; the
  route enforces both, §2.4), and every sessions-mode axis requires
  `auth/rr`'s offer (the `availability()` computation gates each axis on
  `online_ready`, `src/auth/handshake.rs:467-521`). A client claiming
  `auth/lease` therefore must also offer the invalidation protocol —
  the *server's declared* dependency, restated here, never extended.
- **Profiles compose with conformance tuples.** A full conformance claim
  is LLP 0093 D2's machine-readable arm × lane tuple **plus** the set of
  profile ids claimed on that tuple (e.g. `live/local + auth/rr +
  auth/live`). Profiles are claimed per tuple; LLP 0064's per-OS
  evidence rule applies to the composed claim (§4.3).
- **Exact tokens.** Every profile version is an exact must-understand
  value (LLP 0064 doctrine). The only defined version for the four axis
  profiles is `1` (`AUTH_PROTOCOL_V1`, `src/auth/handshake.rs:29`); for
  `auth/sender` it is the string `snapback.sender-constrained.v2`
  (LLP 0077 §Protocol and algorithms). A different integer is a
  different protocol, not an additive change (`src/auth/handshake.rs`
  `AuthSessionResponse` schema note, `:345-349`).

### 1.3 Carrier grammar (shared by the four axis profiles)

The four axis profiles share one carrier grammar, implemented in
`AuthClientProtocolOffers` (`src/auth/handshake.rs:34-134`):

- **HTTP requests** carry decimal offers in exactly four named headers
  (`x-snapback-auth-client-protocol`,
  `x-snapback-auth-invalidation-protocol`,
  `x-snapback-authority-descriptor-protocol`,
  `x-snapback-authorized-lease-protocol` — constants at
  `src/auth/handshake.rs:21-24`). `from_http_headers` accepts **only**
  these headers; a `Sec-WebSocket-Protocol` header on an ordinary HTTP
  request is never an offer carrier (doc comment `:42-44`).
- **WebSocket upgrades** may carry the same offers in closed subprotocol
  tokens (`snapback.auth-client.1`, `snapback.auth-invalidation.1`,
  `snapback.authority-descriptor.1`, `snapback.authorized-lease.1` —
  prefixes at `:25-28`), because browser WebSockets cannot set custom
  headers. A present custom header is authoritative; a
  present-but-malformed or duplicated header never falls through to the
  subprotocol carrier (`decimal_protocol_offer`, `:107-134`). The only
  route parsed with the upgrade grammar is the kit stream
  (`src/server.rs:7865-7875`: `/live/{connection_id}/stream` uses
  `from_headers`, every other route `from_http_headers`) — with one
  code divergence recorded in §8.2.
- **One open-time body member**: `authInvalidationProtocol` on
  `POST /connection/open` (`OpenConnectionRequest.auth_invalidation_protocol`,
  `src/server.rs:4083-4093`) — §2.2's open-time half of `auth/live`.

Offers are **stateless discovery plus per-boundary repetition**: the
handshake never becomes server-side state; every protected boundary
re-presents its offer on the carrier available to that boundary
(`src/auth/handshake.rs` module doc; @ref LLP 0058#bootstrap-handshake).
The one exception is deliberate and connection-scoped: the open-time
`authInvalidationProtocol` binding, which the acknowledge routes consult
(§2.2).

## 2. Per-profile contract

Every table below states the **local arm** (the Rust server,
`src/server.rs`) in **sessions mode**. Dev mode is §3.2; the hosted
(Cloudflare) arm is §2.6 — it currently has **no sessions surface at
all**, so no profile is negotiable there.

### 2.1 `auth/rr` — authenticated request/response

- **Axis:** `onlineRequestResponse`.
- **Carrier:** `x-snapback-auth-client-protocol: 1` on every
  sessions-mode AppData request; `snapback.auth-client.1` subprotocol on
  the kit stream upgrade. **Per-request gated.**
- **Scope:** every `RouteClass::AppData` route except the diagnostic
  trio `/`, `/health`, `/auth/session` (`auth_diagnostic_app_route`,
  `src/server.rs:7744`) and `/app/ensure`
  (`session_online_protocol_refusal`, `src/server.rs:7843-7889`).
  This includes `/connection/open`: Public there means no credential is
  required to mint an anonymous grant, not that sessions-mode protocol
  offers are skipped.
- **Refusal:** server readiness failure is
  `SNAPBACK_AUTH_POLICY_UNAVAILABLE` (HTTP 503). A missing/inexact client
  offer is `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` (HTTP 400) with
  `{capability: "onlineRequestResponse", minimumAuthClientProtocol: 1}`;
  its message names `x-snapback-auth-client-protocol: 1` for HTTP and
  `snapback.auth-client.1` for WebSocket repair. An unknown integer is no
  valid offer and is a non-retryable 400, never silent degradation.
- **Credential:** finite AppData routes resolve the session bearer per
  request under LLP 0057's matrix. `/connection/open` resolves it once into
  a connection authority; later `ConnectionAuth` routes use only the grant
  (LLP 0094 §0A.7). Profile offers are never credentials.
- **Conformance obligations:** send the offer on every in-scope request;
  surface an axis refusal as a structured capability diagnostic (LLP
  0064's compatibility-refusal discipline), never a blind retry; run the
  refresh/logout lifecycle through §6's routes; never place a bearer in
  a URL (LLP 0031 §Token transports).
- **Fixture classes** (0095 corpus — **seeded 2026-07-30**):
  `auth.rr.offer_refusal_surfaced`, a three-step `client_to_server`
  fixture: the 503 readiness refusal surfaced as a structured capability
  diagnostic (no retry storm), then the two malformed-offer negatives
  (missing offer; unknown integer `2`) refusing 400 non-retryably. The
  wire-version/open-time malformed-offer negatives live beside it as the
  `negotiation.*` fixtures (LLP 0095 §2.4).

### 2.2 `auth/live` — auth-scoped live + invalidation acknowledge

- **Axis:** `authScopedLive`.
- **Carriers — two stages, both required:**
  1. **Open-time (connection-scoped):** `authInvalidationProtocol: 1` in
     the `POST /connection/open` body
     (`OpenConnectionRequest.auth_invalidation_protocol`,
     `src/server.rs:4083-4093`). Exact match binds the invalidation
     connection state; any other or absent value opens a legacy
     connection (`src/server.rs:4727-4729` exact-match-else-`None`).
     LLP 0094 §0C.5 (decided): from its stage B1, **unknown values
     refuse** (`SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED`)
     instead of silently degrading; absent keeps opening legacy. This
     is the profile-offer composition with 0094 §0B's negotiation: the
     wire-version offer and this profile offer are the two open-time
     body offers, and B1 gives them one matrix (known binds / unknown
     refuses / absent = legacy).
  2. **Live-lifecycle time (per operation):**
     `x-snapback-auth-invalidation-protocol: 1` on
     every `POST /live/{name}/subscribe` and
     `POST /live/{name}/unsubscribe` in sessions mode. Authority
     independence is a compiled server fact not projected to protocol
     clients, so clients cannot safely branch on it; always offering is the
     conformant rule. The server may omit the requirement only for a target
     it proves authority-independent (`session_live_protocol_refusal`,
     `src/server.rs`).
- **Refusals:** server not ready →
  `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE` (HTTP 503);
  missing/inexact client offer
  → `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED`
  (HTTP 400; `src/server.rs`). A missing namespace is
  `SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED` (HTTP 400). The
  acknowledge routes refuse
  `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED` ("connection did not
  negotiate authInvalidationProtocol: 1") when the open-time half was
  not bound (`acknowledge_authorization_invalidation`,
  `src/server.rs:16537-16554`; `manual_retry_authorization_invalidation`,
  `:16613-16630`).
- **Routes owned by the claim:**
  `POST /live/authorization-invalidation/acknowledge` and
  `POST /live/authorization-invalidation/manual-retry`
  (registered `src/server.rs:7049-7059`; ConnectionAuth + the negotiated
  connection). Both are **local-arm only** (LLP 0094 §0A.1). Their closed
  request bodies are camelCase:
  acknowledge `{connectionId, ackToken}`; manual retry
  `{connectionId, subscriptionId, manualRetryId}`.

**`authorizationNamespace` (required client state).** Every sessions-mode
auth-scoped live subscribe carries this camelCase object in the top-level
subscribe input. Its exact tuple is retained for reconnect:

| Member | Validation and lifetime |
| --- | --- |
| `clientStoreId` | Opaque canonical id: 1–256 bytes, first character ASCII alphanumeric, remainder ASCII alphanumeric or `._:-`. It identifies the client store that owns the query bytes and is stable across restarts and every tab/worker sharing that store. |
| `queryKey` | Nonempty, at most 8192 bytes. It is the store's canonical function-plus-arguments retained-key. The server treats the bytes as an opaque equality component; canonicalization is owned by the client store, and clients sharing a store must agree. |
| `queryInstanceId` | Integer 1…9,007,199,254,740,991. Allocate from one store-wide durable monotone, never-reused allocator when retained state initializes; live-only state uses a never-reused process allocator. Recreating terminally retired state allocates a new id. |

The exact tuple names one client materialization fence, not authority.
Different live subscription scopes can coexist over the tuple and must be
tracked independently by full obligation scope; a client never acknowledges
one subscription's obligation on another's behalf. Reusing an instance id
for different state is non-conformant even if the server accepts the scalar
shape. Absence refuses
`SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED` (HTTP 400).
Reconnect repeats the exact active tuple, but the client retains its
predecessor until the subscribe response carries either the exact
`superseded` witness or a typed `supersessionRefusal`; HTTP success or a
replacement snapshot alone is not disposal evidence. A terminally deleted
tuple is never used for reconnect, foreground/background restoration, or
another live callback. Recreating that canonical query allocates a fresh
never-reused `queryInstanceId` and performs a fresh subscribe.

- **Conformance obligations** (protocol semantics owned by LLP 0053,
  referenced): apply a superseding snapshot atomically before
  acknowledging (acknowledge-after-apply; a sent-but-unapplied snapshot
  never discharges). The invalidation transition is separate from the
  ordinary live-frame strict-greater version guard: a first-seen exact
  resolution may apply a snapshot at the **same** data version when its
  witness covers the obligation and its authorization expectation is
  current. Bind by complete held `scopeId` plus the authenticated issuer,
  connection generation, namespace, authorization pair, and version
  stream — matching `subscriptionId` alone is never sufficient. Persist an
  accepted obligation's exact scope/revision/witness high-water before
  quarantine; quarantine cannot lower it, so an older resolved ticket
  remains stale while a newer obligation is unresolved.

  A `snapshot` resolution requires a present snapshot whose version covers
  the resolution data floor and the obligation floor. A `terminalDelete`
  resolution requires no snapshot; wire omission and JSON `null` are the
  two absent forms. Any kind/shape or floor mismatch is diagnosed and
  never applied or acknowledged. A valid terminal delete destroys the
  exact materialization and installs its terminal fence before
  acknowledging; ordinary live/current/resync frames, reconnect,
  background reuse, and retained callbacks cannot resurrect it.
  Exact redelivery reuses the original token without repeating snapshot
  application or deletion; a conflicting ticket/token identity is never
  acknowledged. Honor quarantine semantics (hide from render and block
  reads until a satisfying superseding snapshot); drive exhausted bounded
  retries through manual-retry; treat the
  `authorization_invalidation` `LiveEnvelope` kind as known-with-
  required-action (the closure matrix rows for its DTOs are LLP 0094
  §0C — `AuthorizationInvalidationSnapshot` and the ack input/output are
  closed both ways); take LLP 0095's T-AUTH-TERM on `auth_error`/close
  4401 with the `authorityDisposition` distinction.
- **Acknowledge outcomes:** both `"discharged"` and `"duplicate"` mean the
  exact obligation is discharged; neither should re-apply or escalate.
  `"stale"` means this token no longer names the current obligation: do not
  mark a newer obligation discharged, and let the next level-triggered
  delivery drive apply-then-acknowledge.
- **Acknowledge refusal actions:**

  | Status/code | Client action |
  | --- | --- |
  | 409 `SNAPBACK_LIVE_STAGE_CONFLICT` | Keep rows quarantined. Bounded-jitter retry of the same acknowledgement is safe, or let the next redelivery re-drive it; do not spend manual-retry budget. |
  | 409 `SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE` / `SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE` | The token/resolution lost its race. Do not retry it blindly or mark discharge; accept the current redelivery and re-evaluate/apply its resolution. |
  | 409 `SNAPBACK_AUTH_INVALIDATION_PENDING` / `SNAPBACK_AUTH_GRANT_PENDING` / `SNAPBACK_AUTH_GRANT_SCOPE_STALE` | Keep quarantine and wait for the level-triggered current obligation/connection state, then re-drive. These are not manual-retry exhaustion. |
  | 409 `SNAPBACK_AUTH_RESNAPSHOT_REQUIRED` | The retained subscription/scope cannot satisfy the ack; fresh subscribe/resnapshot, preserving the namespace lifecycle rules. |
  | 400 `SNAPBACK_AUTH_INVALIDATION_ACK_BEFORE_COMMIT` | Client ordering bug: apply/commit the satisfying disposition or snapshot before acknowledging; unchanged retry is forbidden. |
  | 400 `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED` | Open a correctly negotiated connection; unchanged retry cannot succeed. |
  | 403 `SNAPBACK_LIVE_RESUME_OWNERSHIP` | Wrong connection/live owner; do not retry under that grant. Re-open/re-establish under the intended identity. |
  | 503 `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE` | Server readiness fault: retain quarantine and use bounded readiness backoff; never infer discharge. |

  `/manual-retry` is reserved for an exhausted automatic episode:
  `SNAPBACK_AUTH_RETRY_NOT_EXHAUSTED`/`_NOT_PENDING` (409) mean do not
  open one; successful outcomes are `"attached"` (idempotently joined an
  existing episode), `"resolved"`, `"denied"` (terminal permission
  result), and `"exhausted"` (still unresolved). None implicitly
  acknowledges a snapshot; the resulting level-triggered resolution still
  follows apply-before-ack.
- **Fixture classes added:**
  `auth.live.invalidation_snapshot_apply_then_ack`,
  `auth.live.invalidation_authorization_snapshot_same_data_version`,
  `auth.live.invalidation_terminal_delete_apply_then_ack`,
  `auth.live.invalidation_terminal_delete_blocks_ordinary_live_reuse`,
  `auth.live.invalidation_newer_pending_rejects_older_resolution`,
  `auth.live.invalidation_owned_id_mismatched_scope_never_acknowledged`,
  `auth.live.invalidation_invalid_resolution_never_acknowledged`,
  `auth.live.invalidation_without_snapshot_quarantines`, and
  `auth.live.foreign_obligation_never_acknowledged` are seeded in the
  format-v2 corpus. Seeded 2026-07-30 (format v3):
  `auth.live.subscribe_missing_invalidation_offer_refused` (the lifecycle
  carrier half), `auth.live.ack_requires_negotiated_connection` (the
  open-time half — the per-request header cannot substitute),
  `auth.live.ack_needs_no_descriptor_offer` (descriptor independence,
  below), the terminal-disposition pair
  `auth.live.terminal_auth_carrier_disposition` /
  `auth.live.terminal_auth_durable_delete_disposition` (T-AUTH-TERM with
  the `authorityDisposition` distinction), and
  `poll.wrapped_authorization_invalidation.apply_then_ack` (Lane-P
  framing parity for the invalidation family).
- **Descriptor independence (ratified 2026-07-25):** the acknowledge
  routes require **only** this profile's offers — they never demand the
  `auth/replay` (`x-snapback-authority-descriptor-protocol`) offer. The
  shipped coupling this spec originally flagged was decided a defect and
  fixed (§8.1): the routes now classify as
  `InvocationSource::InvalidationAcknowledgement`, outside the
  queued-replay fence. A descriptor offer sent on these routes is
  ignored, not required; clients written against the earlier interop
  instruction may keep sending it harmlessly, but new clients should
  not.

### 2.3 `auth/replay` — authority descriptors / queued replay

- **Axis:** `queuedReplay`.
- **Carrier:** `x-snapback-authority-descriptor-protocol: 1`
  (subprotocol form on the stream upgrade). **Per-request gated**, and
  demanded only when the request *requests replay semantics*: a
  `/mutation/{name}` body carrying `clientMutationId` /
  `acknowledgedClientMutationIds` (either casing), or any
  standalone-acknowledgement route (`queued_replay_requested`,
  `src/server.rs:8084-8095`; gate at
  `prepare_registered_route_authority`, `src/server.rs:8117-8130`).
- **Refusal:** unavailable authority-descriptor readiness is
  `SNAPBACK_AUTH_POLICY_UNAVAILABLE` (HTTP 503) with
  `{capability: "queuedReplay"}`. Once ready, a missing/inexact client
  offer is `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` (HTTP 400) with
  `minimumAuthorityDescriptorProtocol: 1`; unchanged retry is forbidden.
- **Routes owned by the claim:** `POST /client-mutations/acknowledge`
  (registered `src/server.rs:6977`; local-arm only, LLP 0094 §0A.1),
  plus the replay members on ordinary mutation bodies.
- **Conformance obligations** (semantics owned by LLP 0043/0059/0064,
  referenced): treat the authority descriptor as consistency evidence,
  never authority ("possession never authorizes an invocation",
  `AuthSessionResponse.authority_descriptor` doc,
  `src/auth/handshake.rs:370-371`); durable ordered queue with
  idempotent redelivery under a retained `clientMutationId`; acknowledge
  consumed results via `/client-mutations/acknowledge` (the route
  exists precisely so a one-shot client's final mutation is reclaimable
  — handler doc, `src/server.rs:16253-16256`); suspend a
  predecessor-authority queue on authority-instance mismatch, never
  replay it under successor authority (LLP 0064 §4).
- **Fixture classes** (**seeded 2026-07-30**):
  `auth.replay.descriptor_offer_required` (two steps — the
  replay-requesting mutation body and `/client-mutations/acknowledge`,
  reflecting the §8.1 split: the settlement acknowledgement stays
  descriptor-fenced, the invalidation acks do not),
  `auth.replay.duplicate_settlement_idempotent` (exact-request
  redelivery settles once; re-applying is non-conformant), and
  `auth.replay.predecessor_queue_suspends` (a `client_lifecycle`
  authority-instance-changed event; the predecessor queue suspends and is
  never replayed under successor authority).

### 2.4 `auth/lease` — authorized leases / retained reads

- **Axis:** `retainedReads`.
- **Carrier:** `x-snapback-authorized-lease-protocol: 1` **and**
  `x-snapback-auth-invalidation-protocol: 1` together on
  `POST /query/{name}/authorized-lease` (registered
  `src/server.rs:6973`; enforced in `invoke_authorized_lease_query`,
  `src/server.rs` — readiness failure is
  `SNAPBACK_AUTH_POLICY_UNAVAILABLE` (HTTP 503), while a missing/inexact
  offer pair is `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` (HTTP 400)).
  **Per-request gated.** The
  dual-offer requirement is the declared composition of §1.2, mirrored
  in the handshake's `RetainedReadAvailability` minima
  (`src/auth/handshake.rs:251-268`).
- **Conformance obligations** (lease semantics owned by LLP 0059,
  referenced; shape/limits in `src/auth/lease.rs` —
  `AUTHORIZED_LEASE_PROTOCOL_VERSION = 1`, default and hard-max lease
  86 400 000 ms, `:26-28`): retain rows only under a current exact
  signed lease; delete retained material on the LLP 0059 transition
  table's events (session loss, principal change, incarnation change);
  never infer retention from a matching user id or from being online
  (LLP 0059's axis-independence rule).
- **Fixture classes** (**seeded 2026-07-30**):
  `auth.lease.offer_pair_required` (only the lease half offered refuses
  exactly like an offerless request — the §1.2 declared composition) and
  `auth.lease.expiry_fences_retained_rows` (virtual-time: the retained
  rows fence at `expiresAtServerMs` with no wire event; LLP 0059's
  transition table owns the semantics).
- **Verified parser divergence on this route:** §8.2.

### 2.5 `auth/sender` — sender-constrained custody (browser-class)

- **Plane:** credential custody, not an LLP 0059 axis (§1.1).
- **Protocol id:** `snapback.sender-constrained.v2` (LLP 0077). Not
  offered through the §1.3 header grammar: the claim is exercised by
  *presenting proofs*, and its "offer" is the key enrollment at
  exchange (LLP 0077 §Issuance).
- **Carriers:** one `DPoP` header per protected HTTP request; on the
  kit stream upgrade, a dedicated subprotocol value
  `snapback.sender-proof.<compact-jws>`
  (`SENDER_PROOF_SUBPROTOCOL_PREFIX`, `src/server.rs:5462`; parsed with
  duplicate/oversize refusal by `sender_proof_subprotocol`,
  `src/server.rs:8993-9018`). The server never selects or echoes the
  proof-bearing value as the negotiated subprotocol (LLP 0077
  §WebSocket and connection binding).
- **Refusals:** `SNAPBACK_AUTH_SENDER_PROOF_{REQUIRED, INVALID,
  REPLAYED, AUTHORITY_UNAVAILABLE}` and the terminal
  `SNAPBACK_AUTH_SESSION_EXPIRED` durable-delete outcome
  (`sender_admission_response`, `src/server.rs:9030-9086`).
- **Scope today:** browser-class transports on the local (Rust) server
  under LLP 0060's hosted admission posture. A sender-bound grant
  requires a valid proof on **every** subsequent use — each
  connection-token HTTP act and each upgrade — with no bare-bearer
  carrier (LLP 0077, defect-2 enforcement landed 2026-07-24).
- **Conformance obligations:** entirely LLP 0077's client custody
  contract, by reference — non-extractable P-256 WebCrypto key,
  one-challenge nonce resynchronization, nonce redaction, the in-band
  `sender_nonce` first-frame flight release on sender-gated sockets,
  indeterminate-outcome handling. This spec adds none.
- **Off-browser:** **not defined** — §5.
- **Fixture classes:** deferred with §5; the corpus must not encode
  browser-custody obligations as if they bound native clients.

### 2.6 Arm matrix (verified)

| Profile | Local arm (sessions) | Hosted (Cloudflare) arm |
| --- | --- | --- |
| `auth/rr` | served (§2.1) | **not negotiable** — no sessions surface |
| `auth/live` | served (§2.2) | **not negotiable**; ack routes not served (LLP 0094 §0A.1) |
| `auth/replay` | served (§2.3) | **not negotiable**; `/client-mutations/acknowledge` not served |
| `auth/lease` | served (§2.4) | **not negotiable**; `/query/{name}/authorized-lease` not served |
| `auth/sender` | served under hosted admission posture (§2.5) | **not applicable** |

The hosted arm's generated capability manifest declares
`supportedAuthModes: ["dev"]` with `external_auth` in `capabilityGaps`
and every `hostedAuth` fact `unavailable`
(`cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json`),
and neither `cloudflare/src/gateway.js` nor `cloudflare/src/coordinator.js`
registers any `/auth/*` route. Every auth profile is therefore
**local-arm-only today**; on the hosted arm the entire profile surface is
a named gap, subordinate to the hosted-auth program (LLP 0060). When
hosted sessions land, profile-offer wiring rides LLP 0094's B-stages
(the hosted `kitOpenConnection` open decoder must *read*
`authInvalidationProtocol` — today it ignores it entirely, LLP 0094
§0B.2/§0C.3 — before any hosted `auth/live` claim is possible). "Hosted
production" in §7 therefore means the Rust server operated as a hosted
deployment (LLP 0060's posture), not the Cloudflare arm.

### 2.7 Gate-timing summary (composes with LLP 0094 §0B)

| Gate time | What is offered | Profiles |
| --- | --- | --- |
| `POST /connection/open` (open-time) | body: `wireVersion` (0094), `authInvalidationProtocol`; header: `x-snapback-auth-client-protocol: 1`; optional bearer establishes sessions authority | `auth/rr`, `auth/live` (connection half) |
| kit stream upgrade (subprotocol list) | the four axis tokens + bearer token + sender proof | all, as upgrade-time restatement |
| per request (HTTP headers) | the four axis headers; `DPoP` | `auth/rr`, `auth/replay`, `auth/lease`, `auth/sender` |
| every sessions live subscribe/unsubscribe | invalidation header (authority independence is not client-observable) | `auth/live` (lifecycle half) |

Legacy connections (offerless open, LLP 0094 §0B.3) are ineligible for
session-mode auth-scoped live work — the same absent-offer-forecloses
rule LLP 0093 D1 cites as the model for wire-version legacy degradation.

Credential timing is intentionally unlike offer repetition. A sessions
bearer is resolved when `/connection/open` establishes the connection
authority. Later `ConnectionAuth` routes use the grant as their credential
and ignore `Authorization`; changing a bearer on those requests does not
change the served identity. Logout/login or any principal switch must release
demand and open a fresh connection grant before re-establishing live state.

## 3. Discovery and the dev-mode posture

### 3.1 `GET /auth/session` projects the axis matrix

The bootstrap handshake echoes exactly the offers this binary
understands (`ClientProtocols` — v1 or null, never another integer,
`src/auth/handshake.rs:215-229`) and computes per-axis availability from
mode, readiness, and the presented offers (`availability()`,
`src/auth/handshake.rs:438-522`). Each axis carries its own
`available`/`reason` and its minimum-protocol members, so a client can
learn *which* profile is refused and why before attempting protected
work. Discovery is never authentication: every protected request still
resolves its own credential and repeats its own offer (@ref LLP
0058#bootstrap-handshake). Readiness items unlock axes independently and
in order (`later_items_unlock_only_their_owned_surfaces` test,
`src/auth/handshake.rs:717-765`).

### 3.2 Dev mode

In settled dev mode all four axes report available with **null** minima
and no offers required (`src/auth/handshake.rs:445-465`); the profile
gates of §2 are sessions-mode gates and do not run
(`session_online_protocol_refusal` returns early unless active mode is
Sessions). A dev-mode client may send the offers; they are echoed but
gate nothing. This is the auth-profile half of the dev-mode posture LLP
0093 D1 assigns to the P-0 protocol document.

## 4. LLP 0012 mapping: profiles → capability reports

### 4.1 The projection

LLP 0012's capability classes are claims about a *client surface on a
target*; profiles are claims about *negotiated auth planes*. The
projection for a sessions-mode target:

- **`Online`** (LLP 0012 §Online-vs-Parity; LLP 0064 §3's seven receipt
  facts) requires `auth/rr` — fact 4 ("authority rotation followed by a
  fresh authorized query") is unprovable without it — and requires
  `auth/live` whenever the surface subscribes to any auth-scoped live
  function, because without the invalidation protocol the server refuses
  the subscription outright (§2.2), and a surface that silently drops to
  one-shot reads would be exactly the silent fallback LLP 0012 forbids.
- **`Parity`** (LLP 0064 §4) additionally requires `auth/replay`
  (durable queued mutations, replay/rebase, predecessor-queue
  suspension are `queuedReplay`-axis work) and `auth/lease` (retained
  reads while offline are `retainedReads`-axis work). **No local handler
  execution still means no Parity claim** — profiles are necessary, not
  sufficient; the execution obligations stay LLP 0064's.
- **`auth/sender`** projects onto neither class: it is required by the
  *deployment posture* (a sender-constrained hosted deployment refuses
  unproven senders regardless of capability class), not by the
  capability claim. A capability report must not list sender-constraint
  as satisfied on any non-browser surface until §5's story is defined.

A capability report for a dev-mode-only target claims no profile; the
axes are open there without negotiation (§3.2), and pretending a profile
was exercised would be the inference LLP 0059 forbids.

### 4.2 Report shape

A profile claim enters the report as part of the machine-readable tuple
(§1.2): `arm × lane × profile-set`, beside LLP 0064's immutable
surface/OS profile id. An unavailable combination remains a
machine-readable GAP row, exactly as LLP 0064 §7 requires for surface
tuples — `poll/hosted` (0093's named gap) and every `* /hosted`
profile combination (§2.6) are the current standing GAPs.

### 4.3 Per-OS evidence (inherited)

LLP 0064's evidence doctrine applies to the composed claim unchanged: an
iOS receipt never establishes Android; passing one carrier on an OS
never establishes the other carrier; and a profile exercised on one
tuple is not evidence for another tuple. Receipts may record opaque
authority identifiers and transition facts but never bearer material
(LLP 0064 §Security).

## 5. Off-browser sender-constraint

**Specified only by a Draft follow-on.** LLP 0077 pins sender-constrained custody for
browser-class clients: the key is a non-extractable P-256 **WebCrypto**
key in IndexedDB, the WS carrier exists because browsers cannot set
upgrade headers, and the in-band `sender_nonce` first frame exists
because browser JavaScript cannot read 101-response headers. None of
those constraints holds for a native (Swift/Kotlin) client, and no LLP
previously defined what sender-constraint means off-browser. Draft LLP 0260
now owns that closed native follow-on; because it is neither accepted nor
implemented, no capability claim changes here. LLP 0077 itself remains scoped
to browser custody.

LLP 0260 must pin at minimum:

1. **Key custody equivalent**: what stands in for the non-extractable
   WebCrypto key — Secure Enclave / Android Keystore residency, its
   attestation posture, and what "non-extractable" verifiably means per
   OS (per-OS evidence per LLP 0064).
2. **Proof transport**: native clients *can* set upgrade headers, so
   whether the upgrade proof rides the `DPoP` header (preferable — the
   subprotocol carrier exists only as a browser workaround) or the
   `snapback.sender-proof.<jws>` subprotocol for cross-client
   uniformity; and whether the server accepts both from a single grammar
   without widening the browser contract.
3. **Nonce delivery**: whether a native client that can read upgrade
   response headers still consumes the in-band `sender_nonce` frame
   (uniformity) or the header (fewer states), and how the
   consumed-unknown recovery rule maps.
4. **Enrollment and migration**: how a native installation performs the
   v2 exchange enrollment, and whether one authority family may span
   browser and native custody installations or each installation is its
   own family (LLP 0077's custody-generation machinery presumes the
   latter shape).
5. **The failure matrix**: which of §2.5's refusal codes a native client
   must handle, and what its equivalents of the one-challenge rule and
   indeterminate-outcome handling are.

Until that story exists, a native client **cannot claim `auth/sender`**,
and a sender-constrained deployment (LLP 0060 posture) **cannot admit
native clients** to protected surfaces — this is a real, named adoption
gap for the P-2 Swift client on sender-constrained deployments, recorded
here rather than papered over. Native clients against non-sender-bound
sessions deployments are unaffected (bearer custody per LLP 0057/0064).

### 5.1 External session-bearer adoption (non-sender-bound)

A protocol client may receive a genuine Snapback session bearer from a trusted
server-side identity broker rather than driving `/auth/request-code` and
`/auth/exchange` itself. The carrier's origin does not change the profile
contract: the client repeats `auth/rr` on every protected request and, when it
subscribes, the complete `auth/live` open/subscribe/unsubscribe/invalidation
acknowledgement sequence. Connection-scoped routes use the bound grant and
ignore the bearer; an identity replacement therefore opens a fresh grant and
fresh subscriptions.

The first-party JS constructor for this posture is
`createExternalSessionClient`, and the Swift client accepts the same posture as
`Configuration.sessionBearer`. Both are **ordinary bearer custody**, not
`AuthCoordinator` ownership and not `auth/sender`; they cannot access a
sender-constrained deployment.

On the current local target, a sanctioned broker may use
`auth.mintSession` only in dev/test/demo with AdminWrite plus the process-bound
impersonation capability (LLP 0024/0057). Those authorities stay server-side.
This resolves the native/demo session-entry seam without making a production
mail or hosted-auth claim; LLP 0045 still owns production challenge delivery.

## 6. Integration index: provider auth lifecycle routes

Routes a protocol client touches to *hold* a session, each owned
elsewhere and referenced, never re-specified (LLP 0093 P-3's rule).
Registration verified at `src/server.rs:6719-6975`; policies are LLP
0031's matrix rows (LLP 0031 §Route matrix, `/auth/*` rows).

| Route | Client purpose | Owner |
| --- | --- | --- |
| `GET /auth/session` | bootstrap discovery; axis availability matrix (§3.1); Public, optional bearer | LLP 0058 (DTO: `src/auth/handshake.rs` `AuthSessionResponse`) |
| `POST /auth/request-code` | provider challenge issuance | LLP 0057 |
| `POST /auth/exchange` | challenge proof → session mint (`ChallengeProof`, never session/admin substitution) | LLP 0057; sender-bound issuance overlay: LLP 0077 |
| `POST /auth/refresh` | session rotation (required bearer; grace rules) | LLP 0057 (grace/supersession composition: LLP 0059) |
| `POST /auth/logout` | session termination (exact empty-204; tombstone) | LLP 0057; sender overlay: LLP 0077 |
| `POST /auth/family-alarm` | revoke-only refresh-family alarm; never resolves invocation authority | LLP 0057 |
| `POST /auth/step-up/request` | operation-bound step-up challenges | LLP 0055 |
| `/auth/pairing-codes`, `/auth/agents/*`, `/auth/grant-requests*`, `/auth/grants*`, `/auth/sessions/revoke-all` | agent principals, pairing, scoped grants | LLP 0055; route classes: LLP 0031 dated amendment (2026-07-16); provisioning surface: LLP 0089 |
| `POST /connection/open` | connection grant mint; the open-time offer carrier (§2.7) | LLP 0031 §Connection capability grants; negotiation: LLP 0094 §0B |

Cross-cutting overlays a client encounters on these routes without ever
implementing them: hosted admission and the shared authentication
throttle (LLP 0060 D3), sender admission ordering (LLP 0077 §HTTP
binding), and the body-auth rejection family (LLP 0031). All are
local-arm; none of these routes exists on the Cloudflare arm (§2.6).

## 7. Decided: the hosted-production mandatory-profile floor (LLP 0093 OQ5)

**Decision (Charlie, 2026-07-25):** the recommendation below is accepted
as written. The floor is **`auth/rr` always; `auth/live` for any client
that subscribes to auth-scoped live functions; `auth/sender` for
browser-class clients on sender-constrained deployments**; `auth/replay`
and `auth/lease` remain optional. Per the honest form stated in the
trade-offs, this ratifies the shipped refusals as the floor — the
`auth/rr` and `auth/live` halves are current behavior, so no code binds
today; enforcement-at-open beyond the shipped gates rides the LLP 0094
§0B negotiation program (B4 end state), and the mandatory-`auth/sender`
question stays with §5's definition work. The paragraphs below are
preserved as the decision record.

**The decision (as it was posed):** which profiles, if any, a
production client on a hosted deployment (LLP 0060 posture) **must**
offer — i.e., whether hosted production refuses clients that negotiate
less, the way LLP 0094 §0B.5's B4 end state refuses offerless opens.

**Recommendation (accepted 2026-07-25):** floor =
**`auth/rr` always; plus `auth/live` for any client that subscribes to
auth-scoped live functions; plus `auth/sender` for browser-class
clients on sender-constrained deployments**. Leave `auth/replay` and
`auth/lease` optional (they are Parity-class enrichments; a floor that
demands them excludes every legitimate Online-class client).
`auth/live`'s membership is conditional rather than absolute so the
floor does not forbid the authenticated request/response-only client
that LLP 0093 D2 explicitly legitimizes.

**Trade-offs, stated:**

- *For this floor:* it eliminates the silent-degradation states — a
  production client that forgot an offer discovers it as a synchronous
  refusal at the first protected boundary, not as mysteriously missing
  live updates (the same rationale as 0094's unknown-refuses rule); it
  shrinks the conformance matrix the hosted operator must reason about;
  and `auth/sender`'s conditional inclusion simply restates what a
  sender-constrained deployment already enforces per-request.
- *Against / costs:* it hardens the minimal-client recipe (LLP 0093
  v0.8's one-hour-to-first-data path) — curl-class and one-shot
  integrations must learn the offer headers even when dev-mode parity
  would have carried them; it must define "client that subscribes"
  operationally (the natural mechanic: the floor is enforced at the
  gate that already exists — subscribe refuses without the offer —
  rather than at open, which is exactly current behavior, making the
  `auth/live` half of the floor a documentation act, not a code
  change); and enforcing `auth/rr` at the floor is *also* current
  sessions-mode behavior (§2.1), so the honest form of this decision
  is: **ratify the shipped refusals as the floor, and decide whether
  anything more (e.g. mandatory `auth/sender` for all clients once §5
  is defined) is wanted.** A stricter alternative — floor includes
  `auth/replay` so every production client is replay-capable — buys
  crash-consistent mutation semantics everywhere at the cost of
  excluding every thin client; a looser alternative — no floor —
  preserves maximal admission but re-opens the undeclared-degradation
  class this whole RFC family exists to end.
- *Timing:* the floor binds no code today on the Cloudflare arm (§2.6 —
  no sessions surface exists to enforce it) and is already de facto on
  the local arm; deciding it early costs little and pre-empts drift.

## 8. Verification findings and tickets

The §2 pass checked every carrier/axis/route claim against
`src/auth/handshake.rs`, `src/server.rs` route registrations and
handlers, LLP 0031's matrix, and the hosted gateway/coordinator plus the
generated hosted capability manifest, at `0de3e875`. Two divergences and
one gap-class surfaced:

### 8.1 The acknowledge routes demand the `auth/replay` offer (coupling)

`registered_invocation_source` maps
`/live/authorization-invalidation/acknowledge` and `/manual-retry` to
`InvocationSource::StandaloneAcknowledgement`
(`src/server.rs:7993-7997`), and `queued_replay_requested` returns
`true` for every standalone acknowledgement (`src/server.rs:8084-8095`),
so in sessions mode both invalidation-ack routes require
authority-descriptor **readiness and the
`x-snapback-authority-descriptor-protocol: 1` offer**
(`src/server.rs:8117-8130`) — `auth/live`'s acknowledge path is coupled
to `auth/replay`'s plane. In the readiness interval where invalidation
is ready but the descriptor program is not (a state LLP 0059's item
ordering admits — `later_items_unlock_only_their_owned_surfaces`,
`src/auth/handshake.rs:736-745`), `authScopedLive` advertises available
while its own acknowledge protocol refuses. This is either a deliberate
descriptor-bound-acknowledgement rule (then LLP 0053/0059 should state
it and this spec's §2.2 flag becomes ratified contract) or an
axis-independence defect (then the invalidation acks need their own
`queued_replay_requested` classification). Author decision;
ticket: `issues/20260725-0093-p3-invalidation-ack-descriptor-coupling.md`.

**Decided 2026-07-25 (Charlie Cheever): defect — fixed.** An
investigation pass found no rationale in the introducing commit
(`73772836`), the descriptor unused downstream of the gate on these
routes, no security invariant depending on the coupling, and LLP
0053/0058/0059 axis-ownership text contradicting it.
`InvocationSource::StandaloneAcknowledgement` is split into
`MutationSettlementAcknowledgement` (`/client-mutations/acknowledge`,
still queued-replay fenced — that coupling is deliberate) and
`InvalidationAcknowledgement` (the two invalidation-ack routes,
`queued_replay_requested` → `false`), with a server-level regression test
(`invalidation_ack_routes_do_not_require_the_authority_descriptor_plane`)
covering the item-6-ready/item-7-not interval. §2.2's interop
instruction is retired in the same change; the ticket is closed. Fixed
in the commit carrying this amendment.

### 8.2 The lease route parses offers with the upgrade grammar

`invoke_authorized_lease_query` reads offers via
`AuthClientProtocolOffers::from_headers` (`src/server.rs:16205`) — the
WebSocket-upgrade parser whose subprotocol fallback exists solely for
genuine browser upgrades — on an ordinary HTTP route. The route-level
gate's own rule is explicit ("Keep every non-upgrade route on the
HTTP-only parser: a forged Sec-WebSocket-Protocol header must not
become a second HTTP grammar", `src/server.rs:7865-7875`;
`src/auth/handshake.rs:42-44`), so a `Sec-WebSocket-Protocol` header on
the lease POST is currently an accepted alternate offer carrier there.
Offers are not credentials, so this is a doctrine/second-grammar
divergence, not a credential hole; the fix (use `from_http_headers`) is
one token but changes observable refusal behavior for any caller relying
on it, so it is ticketed, not landed here:
`issues/20260725-0093-p3-lease-offer-parser-carrier.md`.

**Fixed 2026-07-27.** The lease route now parses offers with
`from_http_headers`, and the route-level regression
(`authorized_lease_route_requires_readiness_and_exact_protocol_offer`)
asserts that a lease offer riding only the `Sec-WebSocket-Protocol`
grammar refuses `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` exactly like
an absent offer. Blast radius: the only observable change is on callers
that carried lease offers in the subprotocol header on the HTTP POST —
none exist in-repo (the kit and the Swift client send the decimal
headers); such a caller now receives the same refusal as an offerless
request. §2's "every other route `from_http_headers`" rule now holds
without exception.

### 8.3 Hosted profile surface

No hosted finding beyond §2.6's structural fact (dev-only, no `/auth/*`
routes, profile routes unserved) — consistent with LLP 0094 §0A.1's
"hosted auth profile gap" rows. Profile-offer wiring for a future hosted
sessions surface belongs to LLP 0094's B-stage ticket
(`issues/20260725-0093-p0-wire-version-negotiation.md`, B1's hosted
`authInvalidationProtocol` read) plus the hosted-auth program (LLP
0060); no separate P-3 ticket is filed for a surface that does not
exist yet.

### 8.4 Fixture classes

The §2 fixture classes extend LLP 0095's corpus (§2.4's deferred
"malformed capability offers" row was the placeholder for this
cluster). **Landed 2026-07-30** with fixture-format v3 (the
`client_to_server` request/refusal direction and the
advance/event step forms — LLP 0095 §2.1): every §2.1-§2.4 class above is
seeded, gate-checked by `tests/wire_fixtures_v1.rs`
(`auth_profile_fixtures_pin_refusals_split_dispositions_and_lease_rules`,
plus the census and the LLP 0096 §2.6 local-arm tuple gate). `auth/sender`
remains deliberately unseeded until §5's off-browser custody story
exists. Tickets closed:
`issues/closed/20260725-0093-p3-profile-fixture-classes.md`,
`issues/closed/20260725-0093-p1-fixture-corpus-coverage.md`.

## Open questions

1. §8.1's coupling: deliberate contract or defect (author decision on
   the ticket).
2. ~~The hosted-production floor (§7)~~ — decided 2026-07-25; the
   recommended floor is ratified (see §7).
3. Whether profile claims should be *echoed* machine-readably at open
   (a bound-profile witness beside LLP 0094's OQ2 `wireVersion` echo),
   so a conformance harness can read the negotiated profile set off the
   wire instead of inferring it from refusals. Additive; could ride
   B1's shape if 0094's OQ2 is decided yes.
4. Off-browser sender-constraint ownership: dated LLP 0077 amendment or
   sibling Spec (§5) — unowned.
