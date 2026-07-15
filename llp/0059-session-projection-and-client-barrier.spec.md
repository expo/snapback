# LLP 0059: Session projection and client authority barrier protocol

**Type:** Spec
**Status:** Draft
**Systems:** Auth, Runtime, Storage, API, Live Queries, Ephemeral state, Client integration, Contract, Exact, Security, Backup/restore, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-13
**Revised:** 2026-07-14 (round-2 dual-family revision, /llp-super-refine:
reconciled the LLP 0057/0059 commit-ambiguity contradiction from the 0057 side
(exact-durable-successor reconciliation is now the single owning rule); restated
the **lock-rank assertions as a named defect obligation** (shipped locks are raw
mutexes — no landed rank facility) and removed the landed-evidence overclaim;
flagged the **localStorage segmented-namespace protocol as a genuine conflict
with governing LLP 0008's ratified Web-Lock one-key design**, requiring
reconciliation not a unilateral override; scoped the grant-mint "indistinguishable"
sentence so it no longer contradicts LLP 0057's `AUTH_REQUIRED` vs
`SESSION_EXPIRED`; cross-referenced the durable-restore clock-floor fix and named
the durable-frontier-before-terminal-event obligation; and recorded the remaining
GPT-family spec-vs-code findings (protocol-1 coordinator prerequisite, durable
transition intent, phase-8 ownership release, close-code terminal latch,
handshake app-identity/UUIDv7, final-fence handshake capture, readiness probes)
as named defect obligations. Full triage in §Open decisions and status.)
2026-07-14 (ENG-24996 review gate: archived the GPT-family review artifact at `reviews/0059-session-projection-and-client-barrier.codex.md` and applied its editorial correction to the public credential-classification prose; material findings remain for author triage). 2026-07-14 (ENG-24982 session-clock-floor audit: persist a durable non-decreasing `auth_session_clock_floor_ms`, seed the process clock from it at startup, and derive every wall-clock lifetime decision at `max(sample, floor)` so a backward wall move across restart cannot rebuild a slid or absolute-expired session as current). 2026-07-14 (leased-handoff reconciliation: share one bounded projection/outbox budget, preserve level-triggered projection suffixes, rank recovery markers through final HTTP/WebSocket transfer, and keep projection-only responses behind the exact outbox cut). 2026-07-14 (client poison-latch reconciliation: a connection-continuity loss permanently closes that ephemeral overlay generation, including against delayed snapshots; only a fresh subscribe may construct its successor, while room-scoped resync retains in-place snapshot recovery). 2026-07-14 (client-store version reconciliation: qualify format 3 as the historical item-5 predecessor and point the composed production format 5 and its v1–v4 migration rules to LLP 0043 without self-ratifying this Draft). 2026-07-14 (overflow containment reconciliation: bound and byte-charge exact recovery markers, collapse exhausted recovery state to one fail-closed all-authority signal, and route connection-wide clear-retained recovery across durable and ephemeral client lanes). 2026-07-14 (resume-transfer reconciliation: keep a changed-generation successor scope and effect fence unpublished until fresh authorization, retry resolution, and any newly available authenticated predecessor-retirement frontier are commit-ready; roll failed staging back to the quarantined retained predecessor). 2026-07-14 (final effect-fence reconciliation: record the exact stream/grant/session fence on retained realtime state, scoped queue overflow/purge, replacement-safe room reauthorization phases, mint-only containment, and the bounded ordinary WebSocket handoff). 2026-07-14 (final auth audit reconciliation: retain mode admission through the final HTTP body sink and make same-mode sessions activation wait for predecessor responses while projecting its exact authorization event before reopen). 2026-07-14 (implementation-evidence reconciliation: record ENG-24603/item 5's landed server/client mechanisms, distinguish its historical activation boundary from the now-composed items 6–8 posture, and remove item 8 from future decisions without self-ratifying this Draft). 2026-07-14 (final audit reconciliation: align the missing/unsupported auth-client offer with LLP 0012's registered `SNAPBACK_AUTH_POLICY_UNAVAILABLE` refusal and preserve independent surface-specific protocol negotiation); 2026-07-13 (initial implementing protocol for ENG-24603 / LLP 0039 landing item 5)
**Related:** LLP 0000, LLP 0007, LLP 0008, LLP 0009, LLP 0011, LLP 0012, LLP 0013, LLP 0031, LLP 0034, LLP 0039, LLP 0043, LLP 0051, LLP 0052, LLP 0053, LLP 0057, LLP 0058

## Summary

This Spec makes landing item 5 of
[LLP 0039](./0039-auth-vertical-slice.rfc.md) executable. It pins the local
single-process `SessionProjection`, the exact two-phase revocation and token
rotation protocol, connection-bound authority, generation-fenced publication,
the durable authorization-stream incarnation, and the client
`AuthCoordinator` barrier shared by the Snapback kit and Contract.

LLP 0039 remains **Draft / FROZEN**. This document does not amend, repair, or
reinterpret it. Where 0039 pins an outcome, 0039 wins. This document chooses the
record shapes, indexes, tickets, lock ordering, crash choreography, wire errors,
and client compare-and-commit mechanics that 0039 deliberately delegates in
`LLP 0039#protocol-obligations-deferred-to-implementation`.

The existing corpus already covers the topic at design altitude: LLP 0011 owns
the parent auth model, LLP 0039 owns the program and landing order, LLP 0043
owns the two-axis offline policy, LLP 0052 owns Contract's host-state boundary,
LLP 0057 owns durable provider/session state, and LLP 0058 owns staged mode and
the bootstrap handshake. A companion Spec is nevertheless required because
none of those documents defines item 5's executable crash and interleaving
protocol, and both 0039 and 0053 are frozen.

The item has six load-bearing claims:

1. A connection grant is authority, not merely a random token. It is bound to
   one anonymous authorization stream or to one exact session generation, and
   every act validates that binding atomically with publication.
2. A durable session mutation becomes unavailable in memory before its commit
   can become visible. Commit finalizes the exact operation ticket; rollback
   removes only that ticket. Concurrent operations cannot unmark one another.
3. No response, durable outbox entry, live frame, ephemeral effect, or Contract
   callback may become externally observable across an authority transition
   without a final fence check.
4. Reset and declared restore generate a new durable authorization-stream
   incarnation in the same database transaction as the destructive change.
   Ordinary restart preserves it.
5. The browser has one `AuthCoordinator` custody owner per app. Every async
   completion compares its captured authority epoch before it can expose data,
   mutate durable state, reconnect, or clear the current authority.
6. At its landing boundary, item 5 made online finite session requests
   available but did not yet admit auth-scoped live queries, retained reads, or
   queued replay. Items 6–8 have since landed and compose those independent
   capabilities; this Spec still owns only the item-5 mechanisms.

## Provenance and source boundary

- **[confirmed — Charlie Cheever, 2026-07-13, LLP 0039 frozen author
  direction]** The required outcomes, landing position, activation boundary,
  transition table, and acceptance races come from LLP 0039 and the ENG-24603
  program assignment.
- **[observed — Snapback commit `d172fd1`, 2026-07-13]** The current
  `ConnectionRegistry` in `src/server.rs` binds only token/use state;
  `DeliveryNotifier` in `src/ephemeral.rs` already generation-guards waiter
  replacement; `OutboundQueue` entries carry no auth fence; provider commits
  in `src/auth/provider.rs` can return revocation outcomes that callers do not
  project; `demos/_kit/client.mjs` caches grants and reconnects without a typed
  terminal auth frame; `packages/snapback-contract/client-store.mjs` format 2
  has a write generation and user fingerprint but no authority epoch; and
  `packages/snapback-contract/index.mjs` has no shared transition barrier.
- **[observed — Snapback commits `2d75ff7`, `40fd84e`, `e608c58`, and
  `c4b3989`, plus executable suites, 2026-07-14]** The durable session
  projection/coordinator lives in `src/auth/{session_projection,coordinator}.rs`;
  provider, reset, expiry, connection, outbox, and live paths use its tickets and
  final fences; `packages/snapback-contract/auth-coordinator.mjs` and
  `client-store.mjs` implement transactional custody/barrier participation; and
  the coordinator, IndexedDB custody, store-authority, Contract, and kit suites
  exercise the transition and delayed-completion races.
- **[inferred — implementation mechanism pending author ratification]** Exact
  ticket encodings, leaf-fence layout, leased outbox drain, custody record,
  fallback lease timings, and diagnostic allocation below were proposed
  implementation choices and are now implemented. They preserve 0039's required
  outcomes, but implementation evidence alone does not ratify this Draft.

The first observation is the pre-item baseline; the second records the landed
implementation. Neither thaws LLP 0039/0053 or accepts this document on the
author's behalf.

## Scope and ownership

This Spec owns:

- the process-local `SessionProjection`, its indexes, startup rebuild, expiry
  worker, mutation tickets, and projection failure posture;
- begin/commit/finalize and begin/rollback/compare-unmark choreography for
  revocation, cap eviction, refresh-family alarm, logout, and bearer rotation,
  plus expiry's deadline-finalized terminal ticket;
- the durable authorization-stream incarnation and reset/restore coupling;
- anonymous and session `BoundGrantAuthority`, grant reuse, invalidation, and
  exact act-time validation;
- authority fences on finite responses, durable and ephemeral outboxes, live
  sockets, callbacks, and other externally observable effects;
- the typed live `auth_error` and five-second closure bound;
- the client custody record, `AuthCoordinator`, cross-context ownership,
  transition barrier, and bounded-lease fallback;
- client-store authority-epoch CAS, item-5 delete/strand behavior, and Contract
  barrier participation;
- item 5's revision of the bootstrap handshake and readiness facts; and
- executable acceptance and model-checking obligations for these protocols.

This Spec consumes without re-owning:

- LLP 0031's route and operation policies;
- LLP 0057's provider DTOs, credential hashing, durable session rows,
  supersession grace, cap, refresh-family alarm, reset, and restore primitives;
- LLP 0058's shared invocation gate, staged mode, four protocol headers, and
  readiness object;
- LLP 0053's invalidation declarations and item-6/item-8 dispositions; and
- LLP 0043's independent `retainedReads` and `queuedReplay` policy axes.

This Spec does not enable hosted or multi-replica sessions. Distributed
projection coherence, a hosted coordinator, trusted-proxy/TLS posture, and the
client-page XSS contract remain separately owned. It also does not own the
subsequently implemented item-6 protected-query oracle, item-7 public authority
descriptor/two-axis store, or item-8 authorized-lease and retained/offline
invalidation protocols.

## Normative vocabulary and constants

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative. Durable and wire
timestamps are Unix epoch milliseconds within LLP 0007's safe integer range;
in-process deadlines additionally use a monotonic clock. Closed DTOs reject
duplicate keys and unknown fields.

| Name | Exact v1 value |
| --- | --- |
| Session projection format | `1` |
| Authorization-stream record format | `1` |
| Authorization-stream metadata key | `auth_stream_incarnation_v1` |
| Client custody format | `1` |
| Contract client-store format | `3` |
| Bootstrap auth client protocol | `1` |
| Projection startup id | a fresh canonical UUIDv7 per process |
| Revocation ticket | `<projectionStartupId>:<nonzero-u64>` |
| Expiry scan maximum sleep | `1000` monotonic milliseconds |
| Terminal live closure deadline | `5000` monotonic milliseconds |
| Session-authority connection-open budget | `60` attempts per rolling `60000` monotonic milliseconds |
| Anonymous/malformed connection-open prebudget | `240` attempts per rolling `60000` monotonic milliseconds per incarnation |
| Canonical-unknown connection-open budget | `240` attempts per rolling `60000` monotonic milliseconds per incarnation |
| Web-lock name | `snapback-auth-custody:<canonical-app-id>` |
| Browser custody database / version | `snapback-auth-custody` / `1` |
| Browser custody stores / key | `custody`, `leases` / canonical app id |
| Broadcast channel | `snapback-auth-custody:<app-id-hash>` |
| localStorage wakeup hint | `snapback:auth-custody-hint:<app-id-hash>` |
| Fallback custody lease | `5000` epoch milliseconds |
| Fallback lease renewal | `1000` monotonic milliseconds |
| Superseded-custody wait | `2000` monotonic milliseconds |
| Terminal WebSocket close code | `4401` |
| Terminal WebSocket close reason | `auth_error` |

`projectionStartupId` is distinct from LLP 0058's opaque
`serverStartupNonce`; this Spec neither defines nor re-encodes that handshake
value. The ticket counter begins at one and is never reused in a process.
Counter overflow fails the affected mutation closed with
`SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`; it never wraps.

The constants are protocol constants, not casual configuration. A format,
identifier, record-shape, or fence-semantics change requires a version change.
Operational timing changes require updated liveness evidence and may not weaken
the five-second terminal closure bound.

## Server authority model

### Durable authorization stream

The global Snapback metadata table contains exactly one closed record. Its
durable location is `_snapback_meta.key = 'auth_stream_incarnation_v1'`; its
`value` is the compact UTF-8 JSON encoding of:

```ts
type AuthorizationStreamV1 = {
  formatVersion: 1
  incarnation: CanonicalUuidV7
}
```

The exact value bytes are
`{"formatVersion":1,"incarnation":"<canonical-uuid-v7>"}` with the placeholder
replaced, fields in that order, no whitespace, and no trailing newline.
Duplicate/unknown fields and non-canonical UUID spellings are rejected.
`LocalSnapback` owns reads and writes through the global SQLite write lane. The
value is not an `_auth_*` catalog row, not keyring state, and not writable
through provider or app-table APIs.

The record is created in an explicit startup migration transaction before an
auth-capable server binds any app-data listener, in both dev and sessions mode.
The read-only item-4 stage-time collision inspection does not create it or any
other metadata. Sessions mode additionally requires a complete session
projection. Dev mode preserves the same incarnation through an ordinary
restart, but reset rotates it exactly as sessions mode does, so the subsequently
landed item 7 can key its dev authority instance without making restart look
like reset. The reset/restart distinction remains the governing input. Absence
in a pre-item-5 database means there is no continuity to preserve: startup
creates a fresh incarnation, and clients that previously observed no matching
incarnation clear their privacy-bearing state. Malformed, duplicate, or
unknown-version records fail startup with
`SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT`. Dev mode does not silently repair a
malformed durable record.

An ordinary process restart reads and preserves the exact incarnation. An app
reset, logical import, or declared physical restore generates a new UUIDv7 and
writes it in the same SQLite transaction that establishes the destructive
state. Publication happens only after commit. Copying a database by an
undeclared external mechanism has no continuity guarantee.

### Projected session

`SessionProjection` is the one-process authorization authority around LLP
0057's durable catalog. It contains no plaintext bearer, verification code,
email address, or admin credential.

```rust
struct SessionProjection {
    format_version: 1,
    incarnation: AuthorizationStreamIncarnation,
    by_session: HashMap<SessionId, ProjectedSession>,
    token_index: HashMap<Sha256Digest, ProjectedToken>,
    deadline_index: BTreeSet<DeadlineKey>,
    ticket_index: HashMap<MutationTicket, TicketOwner>,
    next_ticket: NonZeroU64,
    stream_fence: Arc<StreamFence>,
}

struct ProjectedSession {
    session_id: SessionId,
    user_id: UserId,
    provider: ProviderId,
    generation: u64,
    expires_at_ms: i64,
    absolute_expires_at_ms: i64,
    state: ProjectedSessionState,
    pending: BTreeMap<MutationTicket, PendingMutation>,
    fence: Arc<SessionFence>,
}

enum ProjectedSessionState {
    Current,
    Revoked { reason: RevocationReason },
    Expired,
    Uncertain,
}

enum ProjectedToken {
    Current { session_id: SessionId },
    Superseded { session_id: SessionId, superseded_at_ms: i64 },
}

struct DeadlineKey {
    monotonic_deadline: Instant,
    epoch_deadline_ms: i64,
    session_id: SessionId,
    generation: u64,
}
```

The implementation MAY use equivalent Rust layouts, but the indexes and
invariants are normative:

- `by_session` has at most one canonical entry per durable session id.
- A live session has exactly one `Current` token digest. Superseded token
  tombstones remain distinguishable through LLP 0057's grace/absolute horizon
  and can trigger a family alarm, but never mint a new connection grant.
- `deadline_index` has exactly one entry matching each current session's
  generation and effective in-memory deadline.
- Every pending map member has exactly one matching `ticket_index` entry, and
  no ticket names more than one session or stream mutation.
- A session fence is blocked whenever its pending map is non-empty or its state
  is not `Current`. Removing one ticket cannot clear a sibling ticket.
- The durable row is the recovery authority; the projection is the act-time
  authority while the process runs.

### Startup rebuild and deadline derivation

Sessions-mode startup obtains one read snapshot of the authorization-stream
record, session rows, token rows/tombstones, identities needed for provider and
user binding, and reset/restore markers. It validates all ids, generations,
timestamps, referential links, and current-token uniqueness. It builds a
detached projection, checks every invariant, then publishes the complete object
before accepting HTTP, WebSocket, cron, admin, or host-operation traffic.

A partial projection is never reachable. Corrupt or internally contradictory
rows fail startup with `SNAPBACK_AUTH_PROJECTION_CORRUPT`; startup does not pick
a winner, mint a token, or delete evidence.

V1 rebuild is pre-bind only; there is no hot replacement that could leave an
existing grant holding a retired `Arc<SessionFence>`. An in-process uncertain
session remains blocked until controlled restart/rebuild or operator recovery,
while unrelated sessions continue. Reset uses the existing shared
`StreamFence` arc, atomically changes its incarnation at finalize, and then
invalidates all predecessor grants, so no retired stream fence can validate.

At rebuild, the process samples `(epochNow, monotonicNow)` and calculates:

```text
epochNow = max(wallClockSample, durableSessionClockFloor)
remaining = max(0, durableExpiresAt - epochNow)
monotonicDeadline = monotonicNow + remaining
```

An authorization check requires both `epochNow < expiresAt` and
`monotonicNow < monotonicDeadline`. The expiry worker sleeps at most 1000
monotonic milliseconds so a forward wall-clock jump is noticed. Backward
wall-clock movement cannot extend a monotonic deadline. A restart reconstructs
from the coalesced durable expiry and therefore may under-extend an in-memory
sliding use, but may never extend it beyond what the prior process authorized.

The worker uses `(sessionId, generation)` compare semantics when consuming a
deadline entry. A stale deadline from rotation, extension, revocation, or id
reuse cannot expire a newer generation.

### Durable session clock floor

Every session lifetime decision reads the wall clock — sliding expiry,
absolute expiry, superseded-token grace, provider and challenge deadlines, and
startup rebuild all compare against `epochNow`. A monotonic in-process time
alone cannot defend these across a restart: the monotonic clock resets, so a
restart must re-derive lifetimes from durable wall-clock timestamps, and a
backward wall-clock move (operator error, NTP correction, or a hostile local
clock change) between stop and start would otherwise let a lower `epochNow`
reclassify a session the prior process had already slid or absolute-expired
past as current again. Startup GC deletes only at absolute expiry, so a
sliding-expired but absolute-live row survives to be rebuilt.

To make time non-decreasing across restarts, the instance persists a durable
**session clock floor** in `_snapback_meta['auth_session_clock_floor_ms']`: the
maximum epoch the process has ever committed. The rule is:

- The process holds a non-decreasing in-memory floor. Every `now_ms()` read is
  `max(wallClockSample, floor)` and raises the floor to that value, so the
  epoch any lifetime decision observes is monotone for the life of the process
  and never below the durable floor.
- Startup, before deriving any deadline or serving, raises the durable floor to
  at least the current sample, seeds the in-memory floor from the resulting
  (possibly higher) durable value, and rebuilds the projection at that floored
  `epochNow`.
- Every maintenance/GC pass persists the advancing floor atomically with its
  reclamation write, so forward progress made while serving survives a later
  restart up to the maintenance cadence.

Consequently, once either authoritative deadline terminalizes a session
generation at some epoch `E` the process has committed to the floor, no ordinary
restart can rebuild that generation as current under any lower wall sample:
`epochNow >= E` always. The floor only ever fails **closed** — it can make a
lifetime decision expire sooner, never later, consistent with "restart may
under-extend but may never extend prior authority." A spuriously high durable
floor (e.g. a transient clock spike persisted before correction) can therefore
over-expire sessions until real time catches up; this conservative,
availability-only residual is preferred over any risk of reviving terminal
authority, and an operator can recover by advancing real time or reissuing
sessions. The floor is not a secret and carries no per-session state.

## Two-phase mutation protocol

### Tickets and leaf fences

`MutationTicket` identifies one attempted state transition, not merely a
generation. `SessionFence` is a small leaf mutex shared by the projection,
connection grants, and effect publishers. Its logical state is:

```rust
struct SessionFenceState {
    generation: u64,
    deadline: DeadlinePair,
    terminal: Option<RevocationReason>,
    pending_tickets: BTreeSet<MutationTicket>,
}
```

An act is admissible only when its expected generation matches, both deadlines
are live, `terminal` is absent, and `pending_tickets` is empty. The separate
leaf fence lets an act validate and publish without holding the projection
topology mutex or a SQLite/provider lock.

### Plan, begin, commit, finalize

Every provider operation that can revoke, expire, supersede, evict, or reset
authority is split into these phases:

1. **Plan.** Under a read transaction or the provider's `LocalSnapback` access,
   validate the credential and derive an immutable plan containing exact row
   ids, expected generations/digests, intended successor state, and outcome.
   Release every database/provider guard.
2. **Begin.** Under the projection topology lock, verify that the projected
   state still matches the plan, allocate a unique ticket, insert it into both
   indexes, and insert it into the leaf fence. The leaf becomes blocked before
   the topology lock is released. A mismatch restarts planning; it does not
   weaken the projection. An existing pending ticket does not prevent a second
   revocation-class begin against the same still-matching durable generation;
   the pending set represents that overlap explicitly.
3. **Commit.** With no projection or leaf lock held, run one validated SQLite
   transaction whose `WHERE` clauses compare every planned generation and
   token digest. Zero or unexpected affected rows roll the transaction back.
4. **Finalize.** After a known successful commit, use the exact ticket to
   publish the committed generation/state/token/deadline changes, remove only
   that ticket from both indexes, and leave the leaf blocked if any sibling
   ticket remains. Release locks before downstream cleanup.
5. **Propagate.** Invalidate reverse-indexed grants, purge terminal effects,
   wake generation-matched waiters with a terminal event, and return the
   already-committed outcome. No caller may discard this phase.

All inputs whose rejection can be known before `Begin`—route policy, body
shape, credential encoding, required authority, cap candidate, and plan
preconditions—are checked before the marker can complete. No validation that
could turn a successful durable commit into an ordinary request error occurs
after commit.

### Rollback and ambiguous commit

After a known rollback, `compare_unmark(ticket, expectedOwner)` removes the
exact ticket membership if the leaf/projection still attribute it to that
operation, even if a sibling has since advanced the session generation. The
comparison is ticket ownership, not equality with a saved whole-session
snapshot. Any reversible token overlay is removed only if that overlay is still
owned by the same ticket. The operation never restores a saved session snapshot
or removes a sibling marker. The resulting leaf is available only if no pending
ticket remains and no committed terminal state has appeared.

If commit outcome is ambiguous because SQLite reports an I/O outcome whose
commit status cannot be known, the operation rereads the exact durable rows in
a fresh transaction:

- exact planned predecessor state means rollback and exact compare-unmark;
- exact intended successor state means finalize;
- a different valid state means reconcile the ticket against that newer state
  without reverting it; and
- contradictory, unreadable, or still-ambiguous state leaves the session
  `Uncertain` and blocked, emits `SNAPBACK_AUTH_REVOCATION_UNCERTAIN`, and
  requires projection rebuild or operator recovery.

Failing open is forbidden. An uncertain marker may temporarily deny one
session; it may not stop unrelated sessions or hold a global writer.

### Concurrent same-generation revocations

Two revocations A and B may plan against generation `g`. Both may acquire
distinct tickets. The first durable compare that wins advances or terminally
marks the row. The second transaction observes zero matching rows, rereads, and
reconciles as already terminal or replans only if its semantic operation still
applies. A's finalize removes A; B's rollback removes B. At no point can either
operation unmark the other's pending work or return a session to `Current`.

Generation orders durable authority. Ticket identity orders in-flight
operations. Neither substitutes for the other.

### Operation-specific publication

- **Logout, cap eviction, and refresh-family alarm:** `Begin` blocks the exact
  session generation. Commit records LLP 0057's revocation and token outcome.
  Finalize installs the terminal state and generation and then invalidates every
  grant/effect for the predecessor generation.
- **Expiry:** observation of either authoritative deadline installs
  `Expired` through a unique ticket that is allocated, finalized, and removed
  under the topology/fence update; sibling pending tickets remain. Time cannot
  roll back into a live session. It immediately starts terminal close. Durable
  `expires_at_ms` already proves the state, so expiry does not invent a
  generation bump or require a write to become authoritative. Any later
  GC/bookkeeping write is detached, and restart derives the same terminal
  result from durable expiry — the durable session clock floor guarantees the
  restart's `epochNow` is at least the epoch at which the deadline was observed,
  so the comparison against `expires_at_ms` cannot be undone by a backward wall
  move.
- **Bearer rotation:** `Begin` adds a `TokenSupersede { predecessorDigest }`
  pending overlay owned by its ticket; token resolution treats that predecessor
  as unavailable even though the base token index still says current. The
  successor digest is not visible in the projection. Commit atomically writes
  the successor and predecessor tombstone. Finalize changes the token index
  from predecessor-current to predecessor-superseded/successor-current.
  Rollback restores predecessor availability by exact overlay/ticket removal
  only if no sibling terminal state won. The session generation remains LLP
  0057's durable value unless that owning protocol advances it.
- **Sliding-use extension:** a positive use may commit a coalesced durable
  extension without a precommit unavailability marker because failure leaves a
  shorter safe deadline. It publishes a later deadline only after commit and
  only if `(sessionId, generation)` still matches. In-memory extensions that do
  not cross LLP 0057's coalescing threshold remain bounded by the absolute
  expiry and disappear on restart. The no-write path updates
  `deadline_index` and the leaf together under topology-then-session lock after
  the qualifying act. The coalesced-write path releases all projection locks,
  commits the exact-generation durable extension, then publishes both indexes
  under the same order. A race may lose an extension but cannot revive or
  over-extend a session.
- **Session issuance and cap eviction:** the plan names the exact eviction
  candidate and expected generation. Eviction uses its own ticket. After the
  transaction commits both eviction and issuance, finalize publishes the
  revoked predecessor and new session/current token before returning the new
  bearer. An inability to publish leaves the new session unavailable and is
  reconciled from durable state; it never returns an unprojected credential.
- **Reset and declared restore:** use the stream-level variant described below;
  individual session tickets are not acquired serially.

Provider APIs that currently return a committed `SessionRevocation` MUST be
rewired so their only public success path includes propagation. A route,
refresh handler, alarm, or cap path cannot acknowledge success after durable
commit while discarding projection finalization.

The exact sliding-use callers remain LLP 0057's: a successfully authenticated
app-data request, a current-bearer connection open, and generation-valid
live-socket liveness extend the session. An ordinary request accepted with a
superseded token inside its ten-second grace is also an authenticated use.
`POST /auth/refresh` alone never extends expiry. Live liveness is recorded from
the socket's existing authenticated heartbeat/activity cadence only after the
grant and leaf fence validate; merely retaining an unresponsive socket object
is not use.

## Locking and linearization

### Prohibited overlap

The following rules are unconditional:

- Never hold the projection topology mutex, stream fence, session fence,
  connection-registry mutex, room mutex, or notifier mutex while holding
  `LocalSnapback`, the provider/catalog mutex, a SQLite writer, or a SQLite
  transaction.
- The narrow existing post-commit live fan-out may take its per-connection
  outbox enqueue mutex while `with_snapback` still holds the global write guard.
  That enqueue may only copy an already-prepared effect stamp and bytes; it may
  not consult projection/stream/session state, drain, send, await, or call back
  into any earlier lock. No outbox lock is held during SQLite transaction work.
- Never hold a synchronous mutex across `.await`, network I/O, email delivery,
  filesystem I/O, or client callback execution.
- Never invoke app/Contract code while any server or coordinator lock is held.
- The projection topology lock is not a substitute for the global database
  writer and is never acquired underneath it.

### Allowed order

When topology construction requires nesting, the only order is:

```text
projection topology -> stream fence -> session fence
```

That construction nesting is released before touching the connection registry,
an outbox, a room, or a notifier. A direct finite bearer act, which has no
connection grant, uses its prepared stream/session publication fence and then
one bounded leaf operation. An exact connection act instead uses this order:

```text
stream fence -> optional session fence
-> connection registry (verify the exact opaque grant id and retain the guard)
-> exactly one bounded branch:
   - room act -> room -> outbox enqueue -> generation-matched notifier wake; or
   - drain/handoff -> optional generation-matched notifier
     -> room-authority registry/outbox acknowledgement or writer-queue handoff
-> release in reverse order
```

The stream/session publication fence is therefore acquired before the
connection-registry mutex. The registry guard stays held through only the
bounded synchronous ownership transfer, so pressure eviction or authority
mismatch cannot retire the exact grant between validation and handoff. No path
may acquire a stream/session fence from beneath the registry. The only
network-facing operations nested beneath these locks are a bounded in-memory
writer handoff and the first-frame acknowledgement of an already-built leased
HTTP response. `try_commit(buffer)` and batch acknowledgement are synchronous,
nonblocking, and perform no socket I/O; a connection-writer task or HTTP stack
flushes accepted bytes only after every auth lock is released. A full/closed or
invalidated handoff accepts nothing and returns immediate backpressure or a
fail-closed empty body.

The room in the first branch is the data-room mutex; the room-authority
registry in the drain branch is a separate control mutex. A generation notifier
is never held while entering a data room. Level-triggered room-authorization
resync materialization occurs before generation-guarded selection, or under a
control state that excludes concurrent data-room mutation, and releases all
data-room locks before waking delivery.

Finalization is sequenced, not nested:

```text
projection/fence finalize and release
-> connection reverse-index invalidation and release
-> outbox/room purge and release
-> generation-matched notifier terminal wake and release
```

No later stage calls back into an earlier stage while holding its lock. The
existing notifier generation remains part of the compare key so teardown of an
old socket cannot unregister or close its replacement. Terminal purge may
remove still-uncommitted outbox/room work, but it cannot retract a buffer already
accepted by a writer handoff before `Begin`; that buffer is honestly in flight.

The server **is obligated to** supply lock-rank assertions in test/dev builds:
this is a **named defect obligation, not a landed fact**. The shipped locks are
raw mutexes with no rank facility or inversion assertion
(`src/auth/session_projection.rs`, `src/auth/coordinator.rs`, `src/server.rs`),
so §Implementation handoff must not claim rank-aware guards landed; a rank-aware
dev/test guard with intentional inversion-failure tests is the obligation. The
L9 concurrency suite must show that a stalled revocation transaction for session
A does not delay an unrelated finite request or publication for session B beyond
normal scheduler noise — and that stalled-revocation-independence fixture is
itself an acceptance obligation, since it is not currently discoverable in the
suite.

## Connection-bound authority

### Grant shape

The connection registry stores one of these internal bindings whose identity
fields are immutable:

```ts
type BoundGrantAuthorityV1 =
  | {
      kind: "anonymous"
      authorizationStreamIncarnation: CanonicalUuidV7
    }
  | {
      kind: "session"
      authorizationStreamIncarnation: CanonicalUuidV7
      sessionId: CanonicalUuidV7
      userId: CanonicalUuidV7
      provider: ProviderId
      generation: SafePositiveInteger
      deadlineMs: SafeIntegerTimestamp
    }
```

The Rust session variant additionally holds an `Arc<SessionFence>`; that handle
is not serialized or exposed. `deadlineMs` is a mutable cached validity lease
updated from that fence after a qualifying use; it is not grant identity. The
grant contains neither bearer digest, plaintext bearer, email address,
`authority_instance_id`, nor admin/impersonation capability.

Grant opening resolves a presented bearer through `SessionProjection`. Only a
current token with an available, unexpired session can mint a session grant. A
superseded token remains attributable for LLP 0057's tiered request/refresh and
family-alarm rules but never mints or renews a grant during its grace interval.
This narrow grant rule does not change LLP 0057's ordinary finite-request rule:
a superseded family token is honored inside its inclusive ten-second grace,
fails `SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED` outside grace, and cannot be used to
refresh a delegated connection capability.

### Reuse and mismatch

The existing `previousToken` optimization is idempotent only when its stored
binding and the newly resolved authority have exact equality over variant,
incarnation, session id, user id, provider, and generation. The mutable
deadline is refreshed from the current leaf and is excluded from identity
equality. An exact match returns the same grant and updates normal use/LRU
state.

Anonymous-to-session, session-to-anonymous, a different session, user,
provider, generation, or incarnation is a mismatch. It returns
`SNAPBACK_CONNECTION_AUTHORITY_MISMATCH`, invalidates the predecessor grant,
and never silently rebinds or mints a replacement from that request. The client
must complete its authority transition and open a fresh connection.

The existing registry capacity, unused/used LRU, idle lease, and redacted-debug
behavior remain required. Item 5 adds a process-local connection-open throttle
with three closed bucket kinds:

```ts
type LocalOpenBucketV1 =
  | { kind: "session"; incarnation: CanonicalUuidV7; sessionId: SessionId; generation: SafePositiveInteger }
  | { kind: "anonymous-or-malformed"; incarnation: CanonicalUuidV7 }
  | { kind: "canonical-unknown"; incarnation: CanonicalUuidV7 }
```

Every `POST /connection/open` attempt counts, including rejected and
exact-`previousToken` attempts. Ordering is exact:

1. bounded request-shape and bearer-syntax parsing occurs without provider or
   SQLite access;
2. an absent bearer or malformed presented bearer consumes the
   anonymous/malformed prebudget before any authority lookup;
3. a canonical bearer is SHA-256-indexed only in `SessionProjection`—connection
   open MUST NOT fall through to provider/database resolution;
4. a current or attributable superseded bearer consumes its exact session
   generation bucket; and
5. an unknown canonical digest consumes the canonical-unknown bucket.

The invalid buckets are separate from session buckets, so a hostile anonymous
local page cannot consume every current session's open allowance. Malformed and
unknown credentials retain LLP 0057's same public invalid-credential response;
throttling returns only HTTP 429 `SNAPBACK_AUTH_THROTTLED`, with no bucket kind,
token classification, session fact, or identifier. A superseded token may map
to its known session bucket for accounting while still being refused a grant.

Under the registry lock, each bounded deque drops timestamps at least 60000
monotonic milliseconds old, rejects when its length already equals its exact
limit with a rounded-up `Retry-After`, or appends the attempt. Thus attempts
1–60 for one session and 1–240 for either coarse bucket enter normal admission;
the next attempt inside the window is throttled. Empty session buckets are
removed after the window; reset replaces both coarse buckets with the successor
incarnation.

This is the exact local-target meaning of per-source: one resolved authority,
or one of two fail-closed process-wide invalid/anonymous sources. Canonical
unknown lookup is bounded in-memory work; canonical-token spray remains a named
local hostile-page CPU residual rather than permission to consult SQLite. The
baseline has no peer identity and this Spec does not pretend loopback
`peer_addr` is a deployer source behind a proxy. IP/trusted-proxy and distributed
throttling remain ENG-24607's hosted deployment-security obligation.

A reverse index from `(incarnation, sessionId, generation)` to grant ids
supports bounded invalidation. Anonymous grants are indexed by incarnation for
reset/restore.

The registry and delegated grant tokens remain process-memory-only; ordinary
restart invalidates them even though it preserves session and stream
incarnation. Clients reopen from current bearer custody after the fresh
handshake.

### Act-time validation

Possession of a random grant token is necessary but insufficient. Middleware
may clone a connection binding and its leaf handle while resolving a token, but
that snapshot is preparation only. At the final effect cut a connection-token
act enters the prepared stream/session publication fence, revalidates the exact
opaque grant id under the registry mutex, and retains that registry guard
through the one bounded synchronous handoff. A direct finite bearer request
instead carries the projection-resolved `PreparedAuthority` and leaf handles
from the shared LLP 0058 invocation gate; it does not invent or enter a
connection grant. Both paths then:

1. validate matching stream incarnation under `StreamFence`;
2. for a session, validate exact generation, availability, and deadline under
   `SessionFence`; and
3. for a connection act, revalidate and retain the exact registry grant; and
4. perform the synchronous in-memory leaf act or transfer its complete buffer
   into a bounded writer/HTTP ownership handoff while every relevant guard
   remains locked.

The leaf operation must be small and nonblocking. A direct finite response or
effect is computed before it in an unpublished buffer. A queued live delta may
already have been computed and enqueued under the global write guard; for that
path the leaf operation is drain/send, never enqueue. This removes the old
check-then-act delivery window without putting app execution beneath an auth
lock.

Every path that removes a grant outside ordinary auth finalization returns its
exact terminal capture after releasing the publication and registry locks. The
retirement sink then purges the captured effect fence, releases any leased
batch bound to it, wakes the current registration for preserved successor or
authority-independent work, and retires only a notifier registration carrying
the removed opaque grant id. Pressure eviction and authority mismatch therefore
cannot leave a delayed HTTP body or predecessor socket with handoff authority,
and cannot unregister a same-readable-id successor.

## Fenced effects and live closure

### Effect stamp

Every authority-sensitive queued or delayed effect carries this internal
stamp:

```ts
type EffectFenceV1 = {
  authorizationStreamIncarnation: CanonicalUuidV7
  connectionGrantId: OpaqueGrantId | null
  authority:
    | { kind: "anonymous" }
    | {
        kind: "session"
        sessionId: CanonicalUuidV7
        generation: SafePositiveInteger
      }
}
```

`connectionGrantId` is an internal identifier, not the reusable wire token. It
is null only for a direct finite bearer request; queued, live, outbox,
ephemeral, and room effects require a non-null bound grant. Finite-response
buffers, durable outbox entries, live result frames, ephemeral effects, room
receipts, and delayed callback envelopes use the stamp. LLP 0058's live-owner
predicate stores the same bound owner at subscribe time.

Direct app/database work produces an unpublished buffer.
`FencedPublication::commit` performs the final stream/session validation and
consumes that buffer into a synchronous finite-response handoff, bounded
connection-writer queue, direct in-memory ephemeral/room act, or
callback-visible slot while the leaf fence is held. This nonblocking ownership
transfer is the publication linearization cut. Socket/HTTP flushing happens
later with no auth lock held. If validation or `try_commit` fails, the buffer is
not published and the caller receives the matching auth/backpressure outcome. A
revocation marker that begins after a successful transfer sees the effect as
already in flight and need not retract it; a marker that begins before the
transfer prevents publication.

A leased HTTP outbox drain is deliberately not transferred when its handler
selects or serializes the batch. The response body retains the leases,
publication permits, exact connection act, registry, and provider clock. On its
first ready body frame it re-enters the same stream/session publication fence,
holds the exact registry grant current, locks the exact outbox, atomically
validates and acknowledges the complete lease set, and only then exposes bytes
to the HTTP stack. A projection-only response performs the same outbox cut with
an empty lease set, so a recovery marker installed after handler selection
still wins. A pending body poll retains the whole batch without exposing a
frame. A ready error, cancellation, grant retirement, leaf
expiry/revocation/reset, a higher-priority marker, or any stale lease exposes
no frame and releases the whole batch for retry or exact purge. This first-body
cut uses the connection act's publication handle once; the registered
`PreparedAuthority` contains the same non-reentrant handle and is not nested
around it a second time.

The stream/session leaf fence composes with LLP 0058's process-local mode
admission fence. A registered finite HTTP response retains its exact admission
root inside the response body—not merely in response extensions—through every
body frame and final sink/drop. Therefore a same-mode sessions deployment
activation cannot commit while a predecessor response is paused after handler
computation: the response either finishes under the still-current predecessor
epoch before the activation cut, or a retired/cancelled epoch suppresses its
remaining frames. The activation's sole transition-owned projection lease may
publish only the exact post-commit authorization obligations and rerun
snapshots; ordinary successor requests remain closed until that projection is
complete and the lease has been dropped. This mode fence is independent of,
and does not replace, the session/connection leaf validation above.
The same closed projection phase also terminally resyncs and drops every
retained authority-independent predecessor query: it cannot inherit successor
authority because it owns no invalidation scope. Data-only deployment seeds
rerun retained queries even when the storage witness correctly reports no
authorization event. Any activation preprojection failure keeps mode admission
closed instead of using ordinary mutation fanout's diagnostic-only fallback.
If an affected unscoped connection already has durable predecessor frames,
activation atomically replaces that backlog with the existing connection-wide
clear-retained overflow sentinel (including its room-resync preservation), so
no unstamped old frame can transfer after the successor cut.

Queued live deltas are different by design. Production/enqueue is allowed
inside `with_snapback`'s global write guard and therefore MUST NOT acquire any
projection or leaf fence. It copies the producing `PreparedAuthority`/stored
live-owner incarnation, grant id, session id, and generation into
`EffectFenceV1`. Enqueue is not an authorization effect boundary; the atomic
boundary is the later drain/send.

The as-built internal representation is `ConnectionEffectFence`. It is stored
on every retained `LiveSubscription` and protected-room subscriber and copied
onto each recipient's durable, ephemeral, resync, or control queue item. The
readable connection id remains only the routing address. An exact transport
drain sends matching items, drops predecessor items after replacement, and
leaves fenced items retained for compatibility drains that have no grant
proof. Production connection-scoped enqueues always carry a fence; `None` is
kept for authority-independent traffic and legacy embedding seams. Queue
overflow, sticky resync state, and terminal purge are scoped to one exact
effect fence; a delayed predecessor cannot clear or coalesce away a
successor's queued effect. Non-exact grant retirement (including authority
mismatch, generation invalidation, and stream reset) immediately places the
local registry in mint-only posture, so readable-id adoption is unavailable
while any delayed cleanup could remain.

An auth-scoped resume that changes invalidation connection generation treats
its replacement scope, owner continuity, connection, and effect fence as
unpublished staging. It reads the durable witness floor and reserves every
identity first, then registers and quarantines only that exact replacement for
the fresh query; the retained producer and client-visible queues still name the
predecessor. Fresh authorization, its snapshot resolution, durable retry
resolution, and any newly available authenticated predecessor
scope-retirement frontier MUST all be ready before the commit retires the
predecessor and repoints retained ownership. Any earlier failure removes the
staged scope without reusing its
sequence, preserves a pre-existing connection-root obligation, and projects
the fail-closed quarantine through the still-owned predecessor fence. Thus an
error response exposes no replacement scope and owes the client no missing
retirement frontier. After success, a queued wake hint MAY carry the successor
obligation alone; a snapshot resolution ticket MUST travel only with its rows,
and the resume response carries that complete proof together with any scope
retirement.

The registry exposes exactly one **current consumable** effect fence for a
readable connection id. Exact overflow markers left behind by delayed cleanup
are therefore exceptional containment state, not a grant history: the local
queue caps them at eight and conservatively charges their synthesized durable
signal, tree node, and retained fence strings against the same 64 MiB outbox
ceiling. If either the exact-marker count, the byte ceiling, or the bounded
room-recovery ledger cannot admit the next non-silent recovery obligation, the
queue clears every physical lane and scoped marker, parks all authority
domains, and retains one all-authority poison signal. Compatibility and stale
predecessor drains cannot consume it. The registry-verified current exact drain
materializes it once as a connection-wide, clear-retained durable frame stamped
with that current fence. The client routes only that connection-wide control
shape (absent subscription id, `clear_retained: true`, with the historical
`clearRetained` spelling accepted) to both durable consumers and every
ephemeral overlay on HTTP and WebSocket delivery; subscription-scoped resyncs
remain in the durable lane. Every overlay blanks and permanently latches that
overlay generation closed: every later ephemeral envelope, including a delayed
predecessor snapshot, is rejected. Recovery disposes it and constructs a
successor overlay through a fresh `subscribeEphemeral`; an ordinary room-scoped
resync does not set this connection-continuity latch and may still accept its
same-overlay fresh snapshot.

Protected-room reauthorization is split into four non-overlapping phases:
snapshot `(connectionId, EffectFenceV1)` under room authority, resolve the
current grant/session without `LocalSnapback`, query durable permission while
holding only `LocalSnapback`, then exact-complete under room authority. A fence
mismatch or subscriber-set change leaves the level-triggered obligation
pending; a result resolved for a predecessor is never installed on a same-id
replacement. This split also enforces the prohibited-overlap rule above:
registry/coordinator locks are never acquired from beneath `LocalSnapback`.

The bounded writer handoff has a 5000-monotonic-millisecond ordinary-send
deadline as well as the terminal close deadline. A peer that does not read may
therefore delay one accepted in-flight effect only to that bound. Timeout
cancels the send, drops its admission and final-publication permits, closes the
writer task, and allows authorization quiescence to finish; socket I/O never
holds a projection, registry, or room lock.

An auth operation that intentionally terminates its own authority needs one
narrow completion rule. Successful finalization may mint a one-shot internal
`CommittedAuthOutcome { ticket, incarnation, responseClass }` for only the
fixed, no-store provider response already selected before begin: logout `204`,
family-alarm `202`, or a typed provider auth error. Its publisher validates the
stream incarnation and exact finalized ticket outcome, then consumes it into
the same nonblocking response handoff. It cannot carry app rows, invoke a
function, enqueue an effect, open a connection, or authorize follow-on work.
Thus logout may acknowledge its committed result after making its old leaf
terminal without treating that leaf as current; an ordinary stale app response
has no such carrier and remains fenced.

### Durable and ephemeral outboxes

`OutboundQueue` replaces destructive all-at-once drain with a leased batch:

1. allow at most one active batch for the outbox, select a bounded batch without
   removing it, attach unique drain leases, and bind an exact selection to its
   full current effect fence;
2. select any eligible recovery marker alone and before ordinary durable or
   ephemeral work; otherwise group only entries admissible under the exact
   current effect fence;
3. for WebSocket delivery, under the final stream/session fence, exact registry
   grant, and notifier generation, synchronously `try_commit` one frame into
   the bounded writer queue; for HTTP, retain the bounded batch through the
   first-body cut defined above;
4. acknowledge/remove only entries whose complete ownership transfer was
   accepted; network flush is asynchronous and outside every auth lock; and
5. retain/release an entry when the writer queue is full, the response is
   cancelled, or a pending marker blocks it; treat a coalesced replacement as
   superseded rather than a socket failure; or purge it when its exact authority
   is terminal/superseded.

Marker eligibility lasts through acknowledgement even while another response
owns its lease. At the final HTTP or WebSocket transfer cut, an ordinary batch
loses to any eligible marker, an exact marker loses to a later unbound marker,
and either loses to all-authority poison. The winning recovery marker is sent
alone. Direct authorization-invalidation projections are level-triggered and
are deferred rather than acknowledged whenever a marker wins.

WebSocket selection is one frame, so a single live task cannot hold a large set
of publication permits while awaiting sequential writer offers. HTTP selection
may use the bounded batch because its complete JSON frame is acknowledged
atomically at one body poll. Exact purge invalidates a predecessor's active
lease binding but preserves unbound/global recovery obligations, compacts or
charges physical queue capacity, releases every queue/room lock, and then wakes
the currently registered generation. Lease acknowledgement/release likewise
performs a guaranteed post-lock wake whenever eligible work remains; notifier
contention cannot downgrade that wake to a safety-tick retry.

The physical outbox ceiling and transport-handoff ceiling are separate
64 MiB budgets. Before cloning any selected envelope or eagerly serializing an
HTTP batch, selection charges a conservative JSON upper bound: byte arrays use
at least their four-byte-per-element worst case, strings use the six-byte escape
worst case, and every envelope/batch carries structural slack. Direct
authorization-invalidation projections and selected outbox envelopes share one
cumulative handoff budget on both HTTP and WebSocket paths. Projection emits a
bounded prefix and leaves the suffix level-triggered for a later drain; one
unsplittable projection that cannot fit returns
`SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` as HTTP 503 before any ordinary outbox
lease is taken. Queue selection stops before the remaining estimate crosses the
handoff ceiling. A globally valid queue entry that merely does not fit the
projection-consumed remainder stays queued; only a first eligible candidate
that cannot fit the full 64 MiB budget is converted without cloning into its
correctly scoped sticky overflow/recovery obligation. Thus one active batch may
temporarily coexist with the physical queue, but its clone and serialized body
are each independently bounded; the 64 MiB queue diagnostic is not presented
as a bound on total handoff memory.

The public embedding wrapper preserves its pre-lease compatibility contract:
after an embedding accepts a frame into its sink, ordinary wrapper drop counts
as acknowledgement. An embedding that could not accept the frame must call the
explicit release operation so a later drain retries it. Snapback's built-in
HTTP and WebSocket transports convert the wrapper to an internal leased form
whose drop defaults to release; their cancellation/error paths therefore retry
without requiring external cleanup. Compatibility drop-as-success is not used
by either built-in transport.

An entry with an old incarnation, grant, session, or generation never drains
under a successor authority. Queue cleanup compares the full fence and cannot
delete a successor entry because it shares a connection id. Ephemeral lanes
use the same fence but may drop rather than retain an unsent item according to
their existing delivery semantics.

No projection lookup or authority revalidation occurs at enqueue. A mutation
that races revocation may still compute, serialize, and enqueue an old-generation
delta under the global write guard. This protocol promises non-delivery, not
non-computation: the drain sees the stamp and refuses it once the marker or
successor generation is visible. A delta transferred to the writer queue before
the marker is in flight and may flush afterward; terminal close may prevent that
flush but does not claim to retract it. The projection-to-`EphemeralApi` drain
wiring is therefore an explicit readiness prerequisite.

### Typed terminal auth error

The live server adds this closed server frame:

```ts
type LiveAuthErrorFrameV1 = {
  kind: "auth_error"
  code:
    | "SNAPBACK_AUTH_SESSION_EXPIRED"
    | "SNAPBACK_AUTH_STREAM_RESET"
    | "SNAPBACK_AUTH_MODE_PENDING"
  reason:
    | "expired"
    | "revoked"
    | "reset"
    | "restore"
    | "downgrade"
    | "mode_transition"
}
```

The frame contains no session id, user id, address, provider subject, token,
grant, or generation. Item 7 retains ownership of the public generation-bearing
authority descriptor. A pending mutation ticket blocks new validation but is
not itself a terminal event; a rollback emits no terminal frame. After durable
revocation/reset commit is finalized, or after the expiry deadline is
authoritatively observed, the terminal event wins the notifier-generation
compare, synchronously offers this frame to the bounded writer handoff, stops
ordinary drain, releases every lock, and schedules close with code `4401` and
reason `auth_error`. It never awaits the socket while holding the notifier or
session fence. Its hard `closeBy` is
commit/finalize time plus 5000 ms for revocation/reset, the projected monotonic
expiry plus 5000 ms for an ordinary expiry, or forward-wall-jump observation
plus 5000 ms when the epoch clock newly proves expiry. Expiry-worker scheduling
latency consumes this budget; it does not add a second five-second wait. Failure
to send the frame does not postpone close.

The kit classifies this frame or close code as terminal for its captured
authority, suppresses generic reconnect, and invokes coordinator
`compareAndClear(capture, reason)`. A delayed terminal frame for A cannot clear
or close B because both the socket-generation guard and captured authority
epoch must match. If the frame is lost, the next handshake/grant/request still
converges through the projection and incarnation checks.

## Reset, restore, and stream publication

Reset and any future live logical import use a unique stream mutation ticket
rather than walking per-session markers:

1. fully authorize and validate the operation, then generate the successor
   incarnation;
2. under projection topology plus stream fence, install the stream ticket and
   block every new act; release both locks;
3. in the same `LocalSnapback` global-writer transaction that deletes/replaces
   app and auth state, insert the successor `_snapback_meta` value after any
   broad metadata delete and before commit;
4. after known commit, install an empty detached session projection behind the
   still-blocked stream fence with the successor incarnation (logical import
   may carry identity rows but never imports sessions);
5. under topology plus the shared stream fence, atomically install the
   successor incarnation and remove the exact stream ticket; only then
   invalidate every predecessor grant/effect, issue terminal wakes, and allow
   successor opens; and
6. after known rollback, exact compare-unmark the stream ticket and retain the
   predecessor incarnation.

Declared physical restore is pre-bind and follows LLP 0057's validated
declaration path. Before any database mutation, startup validates the strict
`restore-declaration.json`, its owner-only file identity, the exact
`--restored-from-backup <declarationId>` argument, and the canonical UUIDv7.
There is no listener, published projection, or grant registry at this point;
the pre-bind gate is the stream block.

One auth transaction then reads
`_snapback_meta['auth_restore_declaration_id']`. If it already equals the
validated id, the declaration is idempotent: it does not revoke again, delete
new challenges, or regenerate the incarnation. Otherwise, the same transaction
revokes all still-live restored sessions, deletes every verification challenge,
writes a freshly generated `auth_stream_incarnation_v1`, and writes the
declaration id as its final statement. That commit is the declared restore cut.
Only after it succeeds may startup remove the declaration file, build/publish
the revoked-session projection under the new incarnation, and bind. A validation
failure or transaction rollback preserves the predecessor durable value and
never publishes a generated incarnation.

An ambiguous commit is reconciled by reading the durable incarnation and the
operation's durable marker. If neither exact predecessor nor exact successor
state can be proven, all authority stays blocked and startup/operator recovery
is required. A new incarnation is never published before durable commit and an
old incarnation is never accepted after successor publication.

This protocol is the item-5 wiring from `app.reset` through
`ConnectionRegistry`. Direct reset helpers, tests, restore entry points, and
admin aliases all call the same coordinator; no destructive path updates app
tables without updating the incarnation.

## Client custody and `AuthCoordinator`

### Authority identity and captures

Each JavaScript/native execution context returns exactly one local
`AuthCoordinator` for each canonical Snapback app id and storage partition.
Those coordinators share one durable custody record and serialize through one
cross-context owner, so they form one logical authority state without pretending
one tab can directly enumerate or await another tab's objects. The coordinator
owns bearer custody, authority transitions, connection lifecycle, and exposure
barriers. Contract, the kit, live transport, and durable client store are local
participants; none keeps an independent notion of current auth.

```ts
type ClientAuthorityV1 =
  | {
      kind: "anonymous"
      authMode: "dev" | "sessions"
      authorizationStreamIncarnation: CanonicalUuidV7
    }
  | {
      kind: "session"
      authMode: "sessions"
      authorizationStreamIncarnation: CanonicalUuidV7
      sessionId: CanonicalUuidV7
      userId: CanonicalUuidV7
    }

type AuthorityCaptureV1 = {
  authorityEpoch: SafeNonnegativeInteger
  custodyRevision: SafePositiveInteger
  authorityKey: CanonicalAuthorityKey
}
```

`CanonicalAuthorityKey` is `sha256:` plus 64 lowercase hex digits over the UTF-8
bytes `snapback.auth-authority.v1\n` followed by compact JSON with fields in
this exact order: `{appId,kind,authMode,authorizationStreamIncarnation}` for
anonymous, and
`{appId,kind,authMode,authorizationStreamIncarnation,sessionId,userId}` for
session. The JSON uses the already-canonical string spellings and no whitespace
or trailing newline. This digest is not a bearer and is safe only as a local
comparison key. Client authority deliberately contains neither provider nor
session generation because LLP 0058's item-5 handshake exposes neither and item
7 owns the public generation-bearing authority descriptor. Server grants still
bind both fields internally. The bearer remains private coordinator custody.
Rotating a bearer for the same exact authority updates custody revision but
does not advance authority epoch or invalidate healthy connection grants.
Anonymous to session, session to anonymous, a different session/user, an auth
mode change, or an authorization-stream incarnation change is an authority
transition and does advance the epoch. Including mode prevents anonymous dev
state authorized by client assertions from being relabeled anonymous sessions
state merely because reset did not rotate the incarnation.

Every request, grant open, socket, subscription, ephemeral send, Contract
execution, async callback, optimistic layer, client-store write, and durable
completion captures authority before beginning. It may expose or commit only
through `isCurrent` or `compareAndCommit` after its final await. A success,
failure, timeout, abort, and terminal auth error are equally fenced. In
particular, delayed failure A cannot clear B and delayed success A cannot write
under B.

Authority freshness compares `authorityEpoch` and `authorityKey`.
`custodyRevision` is additionally captured so credential-changing operations
can perform a no-lost-update CAS, but an ordinary app-state completion remains
current across a same-authority bearer rotation. Rotation, refresh scheduling,
and custody replacement compare all three fields. This distinction is
load-bearing: treating any custody revision as a new authority would tear down
healthy connections on rotation; ignoring revision for bearer writes would let
a late tab overwrite a successor credential.

### Durable custody record

The coordinator's closed durable record is:

```ts
type AuthCustodyV1 = {
  formatVersion: 1
  appId: CanonicalAppId
  authorityEpoch: SafeNonnegativeInteger
  revision: SafePositiveInteger
  phase: "settled" | "clearing"
  authority: ClientAuthorityV1 | null
  pendingAuthority: ClientAuthorityV1 | null
  bearer: string | null
  pendingBearer: string | null
  refreshAfterMs: SafeIntegerTimestamp | null
}
```

In `settled`, `authority` is non-null and is the only readable authority;
`pendingAuthority` and `pendingBearer` are null. Anonymous settled custody has
a null bearer and null refresh time; a settled session has a non-null bearer
and bounded refresh time. In `clearing`, current authority and bearer are null,
the record is non-readable to app participants, and pending fields plus
`refreshAfterMs` describe only the successor being installed. No broadcast
contains either bearer field.

A fresh store is created only after a successful anonymous bootstrap handshake,
at `authorityEpoch: 0` and `revision: 1`. Every custody record replacement,
including clearing, settling, and bearer rotation, increments revision by
exactly one. Every authority transition increments epoch by exactly one at the
clearing write and keeps that epoch through settle. Neither counter wraps; an
exhausted revision is custody corruption requiring replacement, and an
exhausted epoch uses the dedicated diagnostic below.

The record is keyed by canonical app id in IndexedDB database
`snapback-auth-custody`, version 1, object store `custody`; fallback lease rows
use object store `leases` in the same database so one transaction can compare
both. Native clients use an equivalently transactional credential store. A
localStorage mirror at the constants-table key MAY contain only
`{formatVersion, appId, authorityEpoch, revision, phase}` as a wakeup hint; it
is not custody authority. Malformed shapes, unsafe integers, app mismatch, a
bearer in an anonymous record, inconsistent phase fields, or a revision/epoch
regression produce `SNAPBACK_AUTH_CUSTODY_CORRUPT` and a blank, fail-closed
surface until explicit clear/recovery.

This storage is coordination, not an XSS defense. A script executing in the app
origin can read or invoke the same custody path and may exfiltrate a bearer.
That residual is the separately owned client-page XSS contract; item 5 does not
claim that IndexedDB makes an extractable bearer safe from app-origin code.
The baseline kit at `d172fd1` keeps only a caller-supplied bearer in process
memory; durable plaintext bearer custody is therefore an intentional item-5
behavior change required for cross-tab refresh recovery, not a description of
existing posture. It is allowed only for this local-target slice. ENG-24607's
client-page XSS contract must explicitly ratify this at-rest/browser choice or
replace it before hosted auth can be enabled.

An epoch advances by exactly one. Attempting to advance the maximum safe
integer fails closed with `SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED` and requires
new storage custody rather than wrapping or losing comparison identity.

### Coordinator interface

The normative semantic API is:

```ts
interface AuthCoordinator {
  capture(): AuthorityCaptureV1
  isCurrent(capture: AuthorityCaptureV1): boolean

  compareAndCommit<T>(
    capture: AuthorityCaptureV1,
    commit: (current: SettledCustodyView) => T,
  ): Promise<{ committed: true; value: T } | { committed: false }>

  compareAndClear(
    capture: AuthorityCaptureV1,
    reason: AuthClearReason,
  ): Promise<{ cleared: boolean }>

  transition(
    expected: AuthorityCaptureV1,
    successor: AuthorityInput,
    reason: AuthorityTransitionReason,
  ): Promise<AuthorityCaptureV1>

  registerParticipant(participant: AuthBarrierParticipant): Unregister
}
```

`capture` succeeds only in `settled`. During `clearing`, new participant work is
paused and app reads remain blank. `isCurrent` compares epoch and authority key
as a fast in-memory hint; it does not authorize a durable write.
`compareAndCommit` reacquires cross-context custody, reloads the durable settled
record, compares epoch and authority key, and invokes a synchronous,
non-reentrant `commit` before releasing ownership. `commit` cannot await, call
user code, or start another coordinator operation. The coordinator has an
internal `compareAndRotateBearer` operation that additionally compares custody
revision and is the only path that may replace a bearer or refresh schedule.

`compareAndClear` first performs the same epoch-and-authority-key comparison. A
stale capture returns `{cleared:false}` without blanking, disconnecting,
deleting, or broadcasting. A capture whose only difference is a newer
same-authority custody revision remains current, because revocation of that
session also revokes the rotated bearer. A current capture runs a transition to
anonymous. A terminal auth error therefore has no wider power than the
socket/request that observed it.

`transition` throws local `SNAPBACK_CLIENT_AUTHORITY_STALE` when E names a
different current authority. If the durable record is already settled at the
exact requested successor, it returns that capture idempotently; no other
mismatch is silently adopted.

### Cross-context ownership

The preferred browser mutex is the Web Locks API with the exact lock name in
the constants table. After acquiring it, a caller always reloads durable
custody; an in-memory capture alone cannot justify a write. `BroadcastChannel`
messages are wakeups, not state:

```ts
type AuthCustodyBroadcastV1 = {
  formatVersion: 1
  appIdHash: string
  authorityEpoch: SafeNonnegativeInteger
  revision: SafePositiveInteger
  phase: "clearing" | "settled"
}
```

`appIdHash` is 64 lowercase hex digits of SHA-256 over
`snapback.auth-app.v1\n<canonical-app-id>` and selects the channel/hint names in
the constants table. It is routing metadata, not authority.

Receivers ignore wrong-app, malformed, duplicate, or older messages, then
reload custody under ownership. Reordering or loss is harmless because every
foreground operation and connection attempt also reloads/compares durable
custody. Each context also performs this check on `pageshow`, transition to
visible, focus, and before publishing a Contract boundary. A context suspended
during a transition cannot run callbacks; on resumption it blanks before it can
commit or expose work under the predecessor capture.

The transition owner does not wait for acknowledgements from unknown, crashed,
or suspended contexts. The durable clearing epoch makes every predecessor
compare/expected-epoch write stale immediately. An active peer receiving the
broadcast runs its own local quiesce/blank barrier; a peer that missed it or was
suspended runs that barrier on its mandatory lifecycle/publication check before
its first resumed exposure. This is fail-closed commit/exposure fencing, not a
claim of globally simultaneous DOM blanking.

Where Web Locks is unavailable, the storage adapter must provide an atomic
compare-and-swap lease in the same transactional domain as custody:

```ts
type AuthCustodyLeaseV1 = {
  holderNonce: Base64Url128
  fencingToken: SafePositiveInteger
  expiresAtMs: SafeIntegerTimestamp
}
```

Acquisition increments `fencingToken`, selects a fresh CSPRNG holder nonce, and
sets a five-second expiry in one IndexedDB/native transaction. The holder
renews every one second. Every custody write validates holder, fencing token,
and unexpired lease in the same transaction as the write. A paused former
holder can never overwrite a newer holder. A synchronous publication commit
that performs no custody write — `compareAndCommit`, which exposes external
Contract boundary and app/observer state under the fenced read — is fenced the
same way: the lease row is revalidated transactionally immediately before the
commit and rechecked on the owning operation's completion, so a former holder
paused between its read and its commit rejects with lock loss instead of
publishing under a successor, and app/observer effects run only after the
commit resolves current, never inside it. After lease loss it aborts and
reloads. A contender may replace a lease when its epoch expiry has passed or
when it has observed the exact unchanged `(holderNonce, fencingToken, lease
record)` for five local monotonic seconds; replacement is a CAS against those
exact bytes and allocates the next fencing token. A renewal changes the observed
lease record and restarts that wait. Thus wall-clock rollback cannot wedge
custody indefinitely, while a paused old holder is still fenced after a
monotonic takeover. Fencing-token exhaustion fails closed as custody-lock
unavailability rather than wrapping.

If neither Web Locks nor a transactional CAS adapter exists, sessions-mode
custody fails closed with `SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE`.
localStorage test-and-set, `storage` events, tab-election timestamps, and
unfenced timeout stealing are not acceptable fallbacks.

### Disposition interface

Item 5 introduces the closed coordinator interface type required by LLP 0039:

```ts
type AuthDispositionV1 = "retain" | "quarantine" | "delete"
```

Its severity order is `retain < quarantine < delete`; combining dispositions
selects the maximum. The type exists now so item 6 can add producers without
replacing the barrier API. At item 5, the only invalidation disposition ever
produced or executed is `delete`, and it is produced for every session-authority
loss. Item 5 has no permission-change quarantine machinery and no producer may
request `retain` or `quarantine` yet. Ordinary custody switches that are not
authority-loss invalidations still follow the explicit transition table below.

### Transition barrier

For expected settled capture E and successor authority S, `transition` performs
these ordered phases while retaining exclusive cross-context ownership from
the initial reload through settled publication or a recorded clearing failure.
Its awaited participant set is the owner's local registered set, not every tab.
The fallback owner renews its fenced lease while awaiting those participants;
loss of ownership aborts immediately and permits a successor to recover:

1. Reload custody and compare E's epoch and authority key. A different
   authority returns a stale result or reloads the already-settled successor;
   it never repeats effects against that authority. A newer revision of the
   same authority is adopted as the exact CAS predecessor.
2. Durable CAS that exact loaded revision to `clearing` at
   `E.authorityEpoch + 1`, with current authority/bearer removed and S in the
   pending fields. Increment revision. This is the authority-transition
   linearization point.
3. Broadcast the secret-free `clearing` wakeup. Every receiving context
   immediately stops starting app-visible work; a context that misses it must
   observe durable custody at its next publication/lifecycle gate.
4. Call every locally registered participant's `quiesce`: abort finite
   requests, stop reconnect, detach live/ephemeral callbacks, and wait for
   currently executing local compare-and-commit sections to finish. Delayed
   underlying operations may complete later but retain E and cannot commit.
5. Call `blank` on every local app-data boundary before performing deletion.
   This switches visibility to an explicit empty/loading projection without yet
   erasing backing objects; no retained row, optimistic overlay, pending
   mutation, receipt, cached grant, or old live result remains visible.
6. Call `clearMemory` after visibility is blank. This distinct phase erases the
   old optimistic state, queues, grants, socket generations, ephemeral receipts,
   and callback registrations.
7. Call `commitDurable(expectedEpoch, nextEpoch, disposition)` for each durable
   participant. All use expected-epoch CAS. Failure leaves custody in
   `clearing`, surfaces blank, and retries/recovery continue; no participant may
   expose a partly cleared successor.
8. Durable CAS custody from the exact clearing revision to `settled` at the
   same next epoch, move pending authority/bearer into current fields, clear
   pending fields, and increment revision.
9. Broadcast `settled`, reload the owner context's settled record, call local
   `resume`, obtain a fresh LLP 0058 handshake and connection grant, then
   resubscribe only permitted surfaces. Receiving/resuming peer contexts reload
   independently. A context's exposure resumes only after its own mandatory
   participants report readiness.

Local participant registration during `clearing` joins in a paused and blank
state and participates in the remaining phases; it cannot observe pending
custody. The coordinator tracks the active barrier's phase completion per
registration: a participant that registers after a required phase already
completed globally — in particular `commitDurable`, when registration lands
between phase 7 and its `resume` — receives that phase as a catch-up, with the
same expected-epoch CAS context, before its `resume` may execute. A late
registrant is therefore never resumed over uncleared predecessor durable
state, and a catch-up exception is a transition failure exactly like any other
phase exception. Unregistration waits for an executing local barrier method to
finish. Barrier calls have deterministic registration order and reverse-order
resume, and a participant exception is classified as a transition failure
rather than skipped.

The custody transition behavior at item 5 is:

| From | To | Retained reads | Queued writes/receipts | Connection |
| --- | --- | --- | --- | --- |
| anonymous | authenticated | hide until a fresh authenticated snapshot; item 5 admits no retained private rows | strand predecessor | fresh |
| authenticated A | different user B | delete | delete | fresh |
| authenticated A | same user, different session | no principal-data wipe; blank online/session-dependent results and fresh-snapshot them | strand predecessor | fresh |
| authenticated | anonymous | delete | delete | fresh anonymous |
| dev | sessions | delete legacy retained privacy bytes | strand predecessor queue; never send automatically | fresh sessions grant |
| sessions | dev downgrade | delete | delete | fresh dev connection |
| any incarnation | different incarnation | delete | delete | fresh |

The same-user/new-session row is not an excuse to expose stale session-dependent
results: boundaries blank and refetch, while the principal-scoped durable data
collection is not wiped. At item 5 `retainedReads:false`, so a conforming
sessions store has no admitted retained private rows and preservation is a
no-op. Item 8 may make that preservation observable only through LLP 0053's
declaration and lease protocol; it may not weaken the blank/fresh-snapshot or
queue-stranding rules.

On bearer supersession for the same exact session authority, the coordinator
does not transition epochs. It waits up to 2000 monotonic milliseconds for a
newer settled custody revision, woken by broadcast and backed by durable reload.
If a current successor bearer appears, it retries the failed operation once.
If no successor exists, it invokes LLP 0057's family-alarm path and calls
`POST /auth/family-alarm` with the suspect bearer before compare-and-clearing the
still-current capture. Failure or loss of the alarm retains LLP 0057's named
stolen-successor residual; it does not justify clearing first. The coordinator
does not log out simply because another tab rotated first.

Refresh always acquires ownership and reloads current settled custody
immediately before sending `POST /auth/refresh`. A successful successor is
written through the revision-comparing `compareAndRotateBearer` before it is
returned to any caller or used on a request. `SNAPBACK_AUTH_REFRESH_SUPERSEDED`
uses the same bounded wait/reload and never clears a healthy family. Refresh
alone records no sliding use.

On boot, every participant begins blank. The coordinator acquires ownership,
loads settled custody, performs LLP 0058's handshake using the exact current
bearer if present, and compares the returned stream incarnation and session
projection, active mode, and app-data availability before opening a grant or
resuming Contract. A valid same authority settles without advancing epoch.
Pending/unavailable mode remains blank. Missing/invalid custody, a rejected
session, an auth-mode change, or an incarnation mismatch runs the corresponding
transition barrier. A fresh store establishes anonymous custody only from the
server's current handshake; it does not invent an incarnation offline.

## Durable client store protocol

### Format 3 and authority tags

Format 3 is the historical item-5 predecessor pinned by this Spec. At that
landing boundary, `packages/snapback-contract/client-store.mjs` advanced from
format 2 to format 3. Its existing top-level `generation` remained the
monotonic store-write revision; it MUST NOT be repurposed as auth authority.
The store added a distinct `authorityEpoch` matching settled custody.

The current composed production store is format 5, owned by
[LLP 0043#auth-posture](./0043-offline-replay-retention.rfc.md#auth-posture).
It preserves this section's epoch/key barrier semantics while composing item
6's query/queue fences, item 7's principal/authority-descriptor axes, and item
8's `queryAuthorization` and signed-lease custody. Its migrator recognizes
formats 1 through 4, accepts only the exact identifiable predecessor shapes,
and migrates them to format 5 fail closed; it never retags an earlier format as
current authority.

Every privacy-bearing record in retained rows, pending writes, failed writes,
stranded writes, acknowledgements, mutation receipts, and any implementation
index carries its producing `authorityEpoch` and canonical authority key. A
record without both tags is unreadable in sessions mode.

All operations have expected-epoch semantics:

- reads accept an expected epoch/key and suppress records with any mismatch;
- retained put/delete, enqueue, settle, fail, retry, acknowledge, receipt
  creation, and compaction compare the expected epoch before mutation;
- stale durable mutations return `SNAPBACK_CLIENT_STORE_AUTHORITY_STALE` and
  make no change; and
- a transition atomically compares the predecessor epoch, advances to exactly
  the coordinator's next epoch, deletes or strands predecessor collections per
  the table, and installs no successor data.

Stranded is not replayable or part of ordinary app reads. A separate explicit
discard-or-re-record view may expose a stranded payload only when the recorded
transition was anonymous-to-authenticated or the predecessor and successor
have the same server-resolved `userId`, and only under a current-epoch
coordinator check. Different-user, logout, and incarnation transitions delete
the queue instead. Re-record means user-confirmed creation of a new online
mutation under the current capture; it never retags or sends the predecessor
record. Item 5's `queuedReplay:false` forbids every automatic send.

Transactional IndexedDB/SQLite adapters publish their current namespace pointer
with the same expected-epoch CAS as collection changes.

**The localStorage adapter's protocol must be reconciled with governing LLP
0008, which currently ratifies the opposite design — this is a genuine
cross-document conflict, flagged not papered over.** This section pins that a
non-transactional localStorage adapter MUST NOT emulate CAS with
read-then-`setItem` or keep a mutable current pointer, and MUST use immutable
generation-segmented namespaces keyed by `(appIdHash, authorityEpoch,
authorityKey)`. But LLP 0008 §Serialization ratifies a one-key load/modify/save
protocol under a Web Lock, and the shipped adapter implements *that*
(`client-store.mjs`, `storage.setItem(key, JSON.stringify(state))` under a Web
Lock). One protocol must win across this Spec, LLP 0008, and the implementation:
either LLP 0059 adopts the ratified Web-Lock one-key design (and this
segmented-namespace text is withdrawn), **or** a dated LLP 0008 amendment adopts
the segmented-namespace design with its stale-writer/GC proof and the adapter is
rewritten. Until that reconciliation lands, this is a **named cross-document
defect obligation**, and the segmented-namespace acceptance below is contingent
on it — this Draft does not unilaterally override the governing RFC. The
remainder of this paragraph describes the segmented design *if* it is the one
chosen: every writer selects only its captured namespace; the sole current
pointer is the settled transactional custody record. A late old writer
can therefore add bytes only to an unreachable old namespace. Transition makes
the predecessor unreachable by settling the next custody epoch, and later GC
may delete its keys. A reader derives the namespace from current custody and
never scans/falls back to another epoch. It is forbidden to delete sequentially
while leaving the old namespace readable or to retag an old segment as current.

The historical item-5 migration from format 2 validated the old shape but did
not reinterpret its `generation` or client-asserted `authFingerprint` as an
authority epoch. On a dev-to-sessions transition it deleted retained rows and
privacy caches, moved pending/failed queue records into a dedicated
`legacyV2Stranded` namespace that was never replayable or retagged current, and
created format 3 at the current settled epoch. A legacy record that the exact
v2 shape proved was anonymous could be discarded or explicitly re-recorded
through the current coordinator check; a record carrying a client-asserted
fingerprint was delete-only because that fingerprint was not server
provenance. Non-private static metadata survived only when explicitly
allowlisted by the migration. In dev mode migration could defer this conversion
until a sessions transition.

The composed migration now follows LLP 0043: it recognizes formats 1, 2, and 3,
plus the two exact and mutually exclusive item-6/item-7 format-4 predecessor
shapes, and produces format 5. Partial, hybrid, extended, or otherwise
ambiguous format-4 state supplies no authority proof and is quarantined or
deleted fail closed. Older clients reject format 5 rather than downgrading or
rewriting it.

### Independent item-5 availability axes

Store APIs represent `retainedReads` and `queuedReplay` separately. Neither is
inferred from the other, from a matching user id, from being online, or from a
session existing. At item 5 the session capability is exactly:

```json
{
  "onlineRequestResponse": true,
  "authScopedLive": false,
  "retainedReads": false,
  "queuedReplay": false
}
```

Accordingly the item-5 implementation deletes retained material on session
loss, principal change, and incarnation change, and either strands or deletes
old queued work as the transition table specifies. Same-user/new-session does
not wipe principal-scoped data, although no such retained data is admitted yet.
It implements the epoch/disposition interface now so later items can safely add
producers; it does not manufacture those outcomes early.

That matrix is the historical item-5 boundary, not the current composed local
target. With the independently negotiated later protocols installed, item 6
sets `authScopedLive:true` for admitted protected profiles, item 7 sets
`queuedReplay:true` for admitted descriptor-bound work, and item 8 sets
`retainedReads:true` for admitted retainable queries with an exact signed lease.
No axis is inferred from another, and missing protocol/capability evidence keeps
only its owning axis false.

## Contract and kit barrier participation

### Participant contract

The coordinator participant interface has these semantics:

```ts
interface AuthBarrierParticipant {
  name: string
  quiesce(ctx: BarrierContext): Promise<void>
  blank(ctx: BarrierContext): void
  clearMemory(ctx: BarrierContext): void
  commitDurable(ctx: BarrierContext): Promise<void>
  resume(ctx: SettledBarrierContext): Promise<void>
}
```

`blank` and `clearMemory` are synchronous and cannot call app code.
`commitDurable` must use the exact expected/next epoch supplied by the
coordinator. `resume` receives no bearer directly; it asks coordinator custody
through a narrow request/grant API.

Mandatory participants are:

- the Snapback HTTP/connection/live transport, which aborts finite requests,
  disables reconnect, closes old sockets, clears grants and waiter
  generations, and performs a fresh handshake/grant on resume;
- each Contract surface, which detaches live and ephemeral callbacks, blanks
  query boundaries, removes last rows, optimistic overlays, pending callback
  state, receipts, and connection state, commits the store transition, then
  reconstructs and resubscribes under the successor; and
- each durable Contract store, registered once per physical app partition, so
  duplicate surfaces cannot race the epoch CAS.

Exact/Contract host callbacks, mutation completion, retained write chains,
optimistic settle/rollback, subscription result/error, ephemeral acknowledgement,
and reconnect completion each carry the capture from their initiating work.
Before changing boundary or durable state they call coordinator
`compareAndCommit`. A delayed completion under A may free its private temporary
buffer, but it cannot alter B, reapply A's optimistic layer, clear B's error,
or publish an A result.

The kit no longer treats `setBearerToken` as a local token swap. It requests a
coordinator rotation or transition. Clearing a bearer, receiving a terminal
auth error, changing app/incarnation, or replacing the session follows the
barrier. Direct cache invalidation remains an implementation detail inside the
registered transport participant.

### Exposure invariant

Within each running context, every Contract boundary publication is in exactly
one state after its mandatory custody gate:

```text
Settled(E): all visible records and callbacks are tagged E
BlankClearing(E+1): no privacy-bearing record/callback is visible
```

There is no mixed publication state. `blank` precedes that context's first
destructive durable step; `resume` follows the final settled custody write and
all of that context's mandatory participant commits. Rendering code may observe
an explicit auth-loading/blank state but never publish predecessor data labeled
as successor data. A suspended context is governed by the resume gate above,
not by a false instantaneous-global-blank claim.

## Handshake and readiness

### Bootstrap response revision

LLP 0058's closed `GET /auth/session` success body gains the required field:

```ts
authorizationStreamIncarnation: CanonicalUuidV7
```

The response's session projection and this incarnation are captured from one
prepared authority. A sessions-mode success without the field, an invalid UUID,
or a value different from settled client custody is a protocol error and
triggers a blank coordinator transition/reload. Anonymous responses carry the
same current incarnation. Dev mode thereby claims only authorization-stream
continuity across ordinary restart, not session-credential continuity or a
user-bearing authority.

The existing four protocol headers remain independently mandatory for the
surfaces that consume them. Item 5 does not increment the auth client protocol
because protocol 1 was reserved by LLP 0058 for this client sequence; it
completes that sequence. For finite online work, the server returns the
registered `SNAPBACK_AUTH_POLICY_UNAVAILABLE` capability refusal before auth
resolution when the auth-client header is missing or unsupported. Live,
queued-replay, and retained-read admission additionally enforce their own
surface-specific protocol offers.

### Readiness facts

Item 5 changes exactly these LLP 0058 runtime facts from false to true when and
only when their named implementation and executable probes are installed:

```json
{
  "connectionBinding": true,
  "twoPhaseRevocation": true,
  "authCoordinator": true
}
```

- `connectionBinding` requires exact grant binding, current-bearer admission,
  act-time leaf validation, reverse invalidation, and stamped effect drains.
- `twoPhaseRevocation` requires projection rebuild, all provider call-site
  rewiring, exact-ticket begin/finalize/compare-unmark, expiry worker, reset and
  restore incarnation coupling, and five-second terminal closure.
- `authCoordinator` requires durable custody, cross-context mutex or fenced
  lease, all mandatory participants, client-store format 3, and delayed-race
  acceptance in at least two contexts. Format 3 is the historical item-5
  prerequisite; composed production satisfies it through LLP 0043's format 5,
  which preserves the item-5 epoch/key barrier and migrates formats 1 through 4
  fail closed.

No manifest field, environment variable, dev flag, or mocked readiness object
may assert one early. `sessionActivationReady` remains derived as LLP 0058
defines and becomes true only when every item-1-through-item-5 prerequisite is
true. A projection that has not completed rebuild or a terminal worker that is
not running prevents sessions-mode listener bind rather than merely clearing a
readiness bit after traffic starts.

With the full derived readiness true, item 5 admits authenticated and anonymous
online finite request/response through the shared invocation gate. It continues
to reject auth-scoped live subscriptions, retained reads, and queued replay with
their existing capability diagnostics. `authorityIndependent` live behavior
remains only the conservative LLP 0058 exception; item 5 does not broaden it.

## Diagnostics and safe exposure

Diagnostics are stable machine-readable codes following LLP 0012. Public
responses remain generic where a distinction would expose session existence or
operator state; logs attach redacted structured context and never bearer,
digest, address, code, or custody secrets.

| Code | Boundary and status | Meaning / required action |
| --- | --- | --- |
| `SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT` | startup / no bind | Missing, invalid-version, or malformed durable stream after migration rules; operator recovery. |
| `SNAPBACK_AUTH_PROJECTION_CORRUPT` | startup / no bind | Durable rows cannot form one valid projection; preserve evidence. |
| `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` | request `503` | Projection/ticket allocation is unavailable; no effect committed. |
| `SNAPBACK_AUTH_REVOCATION_UNCERTAIN` | affected request `503`; affected session blocked | Ambiguous commit cannot be reconciled; rebuild/operator recovery. |
| `SNAPBACK_AUTH_STREAM_RESET` | live frame / terminal close | The bound authorization-stream incarnation is no longer current; no reset/restore internals exposed beyond the safe frame reason. |
| `SNAPBACK_CONNECTION_AUTHORITY_MISMATCH` | grant open `401` | `previousToken` is bound to a different authority; client barrier then fresh open. |
| `SNAPBACK_AUTH_THROTTLED` | grant open `429` | The applicable local open bucket is exhausted; safe rounded-up `Retry-After`, no bucket/session detail. |
| `SNAPBACK_CLIENT_AUTHORITY_STALE` | local typed stale result | Async completion capture is not current; discard without clearing successor. |
| `SNAPBACK_CLIENT_STORE_AUTHORITY_STALE` | local typed stale result | Store expected-epoch CAS failed; reload custody/store. |
| `SNAPBACK_AUTH_CUSTODY_CORRUPT` | local fail-closed blank state | Durable custody shape or monotonicity invalid; explicit recovery. |
| `SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE` | local sessions refusal | No safe Web Lock or transactional fenced lease. |
| `SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED` | local fail-closed blank state | Epoch cannot advance without wrap; replace custody store. |

The existing `SNAPBACK_AUTH_SESSION_EXPIRED` (covering both expired and
revoked sessions), provider-family alarm, mode, and protocol
diagnostics retain their owning definitions. On public finite routes,
projection lookup still follows LLP 0057's credential resolution matrix: a
structurally invalid or unknown bearer is uniformly `SNAPBACK_AUTH_REQUIRED`
and does not reveal whether the token ever existed, while expired/revoked
sessions and out-of-grace superseded tokens return LLP 0057's typed
`SESSION_EXPIRED` and `CREDENTIAL_SUPERSEDED` outcomes as the deliberate
recovery exceptions.

## Executable acceptance

Every acceptance below is required before its readiness fact can be true.
Tests use deterministic schedulers/failpoints where an interleaving is named;
wall-clock sleeps are not proof of ordering.

### Projection and mutation model

1. A property/state-machine test generates issue, use, rotate, logout, expire,
   cap eviction, family alarm, reset, restore, restart, commit failure, and
   ambiguous-commit events. After every step, durable rows, projection indexes,
   ticket indexes, fences, grants, and effect stamps satisfy their invariants.
2. Two revocations plan the same `(session, generation)`. Pause A after begin,
   begin B, commit/finalize one, roll back/reconcile the other in both orders.
   Neither compare-unmark makes the committed session current or removes the
   sibling ticket.
3. Inject an ambiguous result before and after SQLite commit. Exact durable
   predecessor unmarks, exact successor finalizes, and contradictory state
   stays blocked with `SNAPBACK_AUTH_REVOCATION_UNCERTAIN`.
4. Pause rotation after begin: the predecessor cannot mint a grant and the
   successor is unknown. Rollback restores only the predecessor; commit makes
   exactly the successor current and preserves the superseded alarm path.
5. Race cap issuance with use/logout/another issue. The exact candidate CAS
   either commits eviction plus fully projected successor or returns no bearer.
6. Restart after an uncoalesced in-memory sliding extension. Rebuilt expiry is
   no later than durable expiry. Exercise forward/backward wall-clock jumps and
   stale deadline entries with a fake dual clock.
7. Corrupt each index source independently: duplicate current token, dangling
   identity, invalid generation/timestamp, malformed incarnation, and
   contradictory reset marker. Startup refuses before listener bind with the
   correct stable code and performs no repair.
8. Hold session A's database commit at a failpoint. Session B completes an L9
   finite request and fenced publication without waiting for A's transaction or
   projection ticket.
9. Authenticated finite use, current-bearer connection open, grace-window
   ordinary use, and live-socket liveness each extend the in-memory deadline and
   coalesce durable writes. Refresh-only and an unresponsive retained socket do
   not. Restart never recovers an uncommitted extension.

### Grants, effects, and closure

1. An anonymous grant cannot be reused after incarnation change. A session
   grant cannot be reused for anonymous, another session/user/provider, or a
   newer generation. Exact reuse refreshes only the mutable deadline. A grant
   for connection A cannot address, resume, unsubscribe, or drain connection B,
   including when both are anonymous or otherwise share authority. Ordinary
   process restart invalidates every grant while preserving the stream
   incarnation and durable sessions.
2. A current bearer mints a grant. A superseded bearer within grace does not
   mint one, while an ordinary finite request with that same bearer is honored
   under LLP 0057. Outside grace it produces credential-superseded recovery;
   missing successor custody calls the family alarm before clear. The
   grant-mint refusal for revoked, expired, malformed, and random bearers is
   uniform **at the grant-mint surface** (none mints a grant), but this does
   **not** flatten LLP 0057's deliberate credential-resolution distinctions:
   an unknown/malformed bearer resolves `SNAPBACK_AUTH_REQUIRED` while a
   validly-shaped expired/revoked one resolves `SNAPBACK_AUTH_SESSION_EXPIRED`
   on the ordinary authenticated surface (§Diagnostics and safe exposure, LLP
   0057). The "indistinguishable" claim is scoped to grant minting, not to the
   whole public posture, so it no longer contradicts the diagnostics section.
3. Exercise the 16,384-entry cap, unused/used LRU, idle expiry, source throttle,
   and reverse index under concurrent opens/invalidation. Eviction cannot
   reassign a token or leave an indexed ghost. With a fake monotonic clock,
   attempts 1–60 for one session and 1–240 for anonymous/malformed and
   canonical-unknown buckets reach ordinary admission, the next is
   `SNAPBACK_AUTH_THROTTLED`, and the exact 60000-ms boundary reopens. An
   invalid-bucket flood does not consume a current session's budget; no
   prebudget rejection calls provider or SQLite; malformed and unknown public
   failures reveal no bucket/session distinction.
4. Produce and enqueue a live delta while holding the global write guard and
   assert that enqueue takes no projection/stream/session lock. Begin
   revocation before drain: the stamped delta is not delivered. A drain/send
   transferred into the bounded writer queue before begin may flush as in
   flight and is not claimed retractable. No socket await holds a leaf fence,
   and no old generation/incarnation payload transfers after successor
   publication.
5. Begin a marker then roll it back while an outbox batch is leased. Entries are
   retained and later drain under the still-current exact fence. Terminal
   finalize purges them. A stale cleanup cannot purge successor entries. Hold a
   predecessor HTTP batch unpolled while a successor's initial drain parks,
   then pressure-evict, authority-mismatch-retire, and exact-purge the
   predecessor independently. The old body emits no bytes, the successor is
   awakened without a heartbeat, and preserved unbound/global recovery work
   drains exactly once.
6. For finite responses, live results, durable outbox, ephemeral effects, room
   receipts, and callback envelopes, independently pause between computation
   and commit and prove the final fence rejects old authority.
   Separately pause a predecessor finite HTTP body, begin a same-mode sessions
   deployment activation, and prove the activation cannot reach its durable cut
   until the body finishes; after it finishes, require the exact durable
   authorization witness and live successor projection before new admission.
   For a leased outbox response, revoke, reset, expire with a fake provider
   dual clock, cancel, and coalesce between selection and first body poll. No
   invalid batch is acknowledged or exposed, and retry preserves queue order.
   Exhaust projection sequencing and prove the committed successor stays
   closed. Change one retained authority-independent function to protected and
   remove another; both receive clear-retained terminal resyncs before reopen.
   A data-only seed refreshes retained results without inventing an auth epoch.
7. With a fake monotonic clock, expiry/revocation/reset produces at most one
   notifier-generation-matched `auth_error`, stops ordinary drain/reconnect,
   and closes by 5000 ms even when the writer handoff/socket cannot accept the
   frame. Old-socket teardown cannot close or unregister a replacement. A
   pending ticket that rolls back produces no terminal frame or close.
8. Reset and declared restore each change incarnation in the same durable
   transaction, invalidate all old anonymous/session grants and queues, and
   survive crash at every phase. Restore declaration validation failure causes
   no mutation; retry of an already-recorded declaration id does not regenerate
   again. Ordinary restart preserves incarnation.
9. Logout and revoking refresh-family outcomes publish only their exact fixed
   provider response through a one-shot committed-outcome carrier after
   finalize. The carrier cannot publish planted app bytes, be reused, or survive
   an incarnation change; an ordinary old-authority response remains denied.

### Coordinator and two-context races

1. Run two tabs A and B against one durable custody store. Delay A's successful
   response, error, terminal auth frame, live callback, optimistic settle,
   client-store write, grant open, and reconnect in separate tests. Transition
   to B, release the delay, and prove each A completion has no visible or
   durable effect on B.
2. A delayed terminal `auth_error` for A calls `compareAndClear(A)` after B is
   settled. It returns false without blanking B, closing B's socket, deleting
   B's store, or broadcasting a new epoch.
3. Kill a Web-Lock owner before clearing, during every participant phase, and
   before settled publication. A successor owner reloads the durable phase,
   resumes idempotently, and never exposes partial data.
4. Repeat using the fallback lease. Pause an expired holder, let a new holder
   acquire a larger fencing token and settle, then release the old holder. Every
   old write fails the same-transaction lease check.
5. Duplicate, reorder, delay, and drop clearing/settled broadcasts. Receivers
   converge by durable reload, never consume a bearer from a message, and never
   regress epoch or revision.
6. Rotate a bearer in A. B observes supersession, reloads the newer custody
   revision within the bounded wait, retries once, and retains the same epoch.
   Existing app completions and connection grants remain current. Withhold the
   successor and prove family alarm plus compare-and-clear occurs only if the
   original epoch/authority key remains current.
7. Register and unregister Contract surfaces during clearing. A new surface is
   blank/paused and cannot expose pending custody; unregistration cannot skip an
   executing durable phase.
8. Crash or throw each participant phase. Custody remains `clearing`, all
   owner-local boundaries remain blank, stale peer commits fail the durable
   epoch, idempotent recovery continues from durable state, and no successor
   becomes visible before every mandatory durable CAS.
9. Suspend peer B before A transitions. A does not wait for or claim to blank B
   globally; durable epoch CAS immediately rejects B's delayed writes. On
   resume, B reloads and blanks before its first callback, render publication,
   reconnect, or app operation.

### Client store and Contract boundaries

1. At the historical item-5 boundary, migrate representative and adversarial
   format-2 stores without retagging any privacy record as a format-3 successor.
   In the composed production suite, migrate formats 1 through 4 into LLP
   0043's format 5, distinguish the two exact format-4 predecessor shapes, and
   quarantine or delete ambiguous format-4 state fail closed. Older readers
   reject format 5.
2. For every store operation, race transition between expected-epoch read and
   commit. CAS rejects the stale mutation and reads suppress mismatched tags.
   Repeat for generation-segmented fallback namespaces.
3. Transition anonymous to auth, A to different-user B, A to same-user/new
   session, auth to anonymous, and incarnation to successor. Verify the exact
   delete/strand table, same-user principal data is not wiped, different-user
   queues are deleted, and retained/replay admission remains false.
4. Observe Contract boundaries on every barrier step. They become blank before
   the first delete, contain no optimistic/last-row/receipt/grant residue while
   clearing, and expose only successor-tagged results after settled resume.
5. Delay old live, ephemeral, mutation, retained-write, optimistic rollback,
   and error callbacks. None may change the successor boundary or durable
   store. A fresh handshake, grant, and resubscribe of each permitted surface
   occurs exactly once per successful local transition.
6. On a localStorage segmented adapter, release an old writer after successor
   custody settles. It writes only its old namespace; current reads do not scan
   or expose it, and no mutable localStorage pointer can select it.
7. The item-5 producer matrix emits `delete` for every session-authority loss
   and never emits `retain` or `quarantine`; unsupported injected values fail
   rather than bypassing the barrier.

### Handshake and activation

1. The bootstrap response contains a canonical durable incarnation captured
   with its authority. Missing, malformed, stale, or cross-app values fail
   before a grant or callback can become visible.
2. The complete item-1-through-item-5 readiness matrix is generated and tested.
   Each omitted module/wiring/worker keeps its owning fact false and therefore
   keeps `sessionActivationReady` false. No override can force it true.
3. At the item-5 boundary, readiness true admits online finite
   anonymous/authenticated requests while auth-scoped live, retained reads, and
   queued replay remain refused; the conservative authority-independent live
   exception is unchanged. The current composed target admits each later axis
   only through its separate item-6/item-7/item-8 negotiation and proof.
4. Dev-to-sessions and sessions-to-dev tests prove that no predecessor grant,
   session data, client epoch, outbox entry, or Contract callback crosses the
   mode transition while ordinary incarnation continuity is preserved. Reset
   separately proves that no old incarnation crosses its rotating transition.

## Implementation handoff

The implementation landed in this dependency order without splitting a safety
invariant across an externally enableable commit:

1. added authorization-stream storage/migration and detached projection rebuild;
2. added leaf fences, tickets, mutation planning, and rewired every LLP 0057
   revocation/rotation/reset/restore call site;
3. extended connection bindings, reverse indexes, publication stamps, leased
   drain, notifier terminal events, and typed live errors;
4. added custody storage, coordinator ownership/transition recovery, the
   historical item-5 client-store format 3, and mandatory kit/Contract
   participants; composed production now uses LLP 0043's format 5, which
   preserves these barriers and migrates formats 1 through 4 fail closed;
5. revised the closed handshake DTO and ran the full interleaving and activation
   matrix (the "real readiness probes" claim is corrected: production readiness
   currently passes literal facts, and rank-aware guards plus module/wiring/
   worker probes are named defect obligations, not landed evidence); and
6. ran `./ref-check --verbose` and added non-mechanical `@ref LLP 0059#...`
   annotations at each non-obvious ticket, lock-order, fence, custody, and
   epoch-CAS implementation boundary.

Intermediate commits were allowed to compile and test, but sessions activation
stayed unavailable until all six stages and acceptance obligations were present. A
compatibility shim may read old state only as explicitly specified above; it
cannot emulate readiness or bypass a fence.

## Open decisions and status

There is no open decision that blocks ENG-24603 implementation. The following
choices are deliberately non-blocking and may be revised by a later accepted
Spec without weakening this one:

- whether a future browser implementation adds a `SharedWorker` fast path;
- the internal batching size for leased outbox drains;
- garbage-collection cadence for unreachable client-store epoch segments.

ENG-24603/item 5 and its executable evidence have landed: durable projection,
two-phase mutation publication, connection and effect fences, authorization
stream handshake, browser custody/coordinator, Contract/store participation,
and delayed-predecessor race suites. Item 8 is no longer a future decision here;
LLP 0053 and LLP 0043 own its implemented dispositions and signed-lease path.

This document remains **Draft** pending explicit author ratification and review
scaled to its security stakes. Implementation evidence does not make LLP 0039
or LLP 0053 unfrozen and does not accept this Spec on the author's behalf.

The ENG-24996 review gate obtained a cross-family GPT (Codex) review on
2026-07-14 (round 1, verdict: NOT READY). A second dual-family round (fresh Codex
ultra + fresh Fable Max, blind, via /llp-super-refine) reviewed the committed
revision at `b11a6fa`; both artifacts are archived with provenance in
`reviews/0059-session-projection-and-client-barrier.{codex,fable}.md`.

### Review triage

**Resolved in text (round 2):** the LLP 0057 vs LLP 0059 commit-ambiguity
contradiction (GPT #2) — reconciled **from the LLP 0057 side**, which now defers
to this document's exact-durable-successor reconciliation (0057 §Concurrency no
longer states the contradictory discard-and-unavailable rule); the lock-rank
overclaim (both families) — restated as a named defect obligation, since the
shipped locks are raw mutexes and §Implementation handoff must not claim
rank-aware guards landed; the localStorage protocol conflict with governing LLP
0008 (GPT #10) — flagged as a genuine cross-document conflict requiring either
0059 adopting LLP 0008's ratified Web-Lock one-key design or a dated 0008
amendment for the segmented-namespace design, not a unilateral override; the
grant-mint "indistinguishable" acceptance sentence (both) — scoped to grant
minting so it no longer flattens LLP 0057's `AUTH_REQUIRED` vs `SESSION_EXPIRED`
distinction; and the durable-time terminal irreversibility (GPT #1) — cross-
referenced to the LLP 0057 declared-restore clock-floor fix, with "durably
advance a shared frontier to the authoritative deadline before publishing a
time-derived terminal event" named as an obligation.

**Named defect obligations (spec pins the behavior; shipped code has the gap —
code fixes with acceptance obligations, not design changes):** auth-client
protocol 1 must not be advertised without the canonical coordinator and
mandatory participants (a no-coordinator client fails closed) (#3); durable
transition intent must carry predecessor+successor authority so crash/cross-
context recovery reproduces every transition-table row, or the conservative
delete-all data-loss policy is explicitly ratified (#4); an explicit phase-8
ownership release so no network request holds the cross-context mutex and all
contexts stay blank until successor-fenced readiness (#5); both live APIs must
terminal-latch `4401/auth_error` on a close-code-only event and suppress
reconnect (#6); a server-proven canonical app/deployment identity validated
before custody transition, and canonical UUIDv7 enforcement at the wire boundary
(#7); one prepared authority+incarnation carried through the response's final
body-publication fence, with client cache reads passing a durable
compare-and-commit (#8); and readiness facts derived from executable
module/wiring/worker probes rather than literal `true`, or static build facts
distinguished from runtime readiness with the landed-evidence claim removed (#9).
The rank-aware dev/test guards, the stalled-revocation-independence fixture, and
the segmented-namespace acceptance are the associated test obligations.

This document remains **Draft** pending author triage completion and explicit
ratification; the reviews advise, they do not ratify, and neither LLP 0039 nor
LLP 0053 is unfrozen.
