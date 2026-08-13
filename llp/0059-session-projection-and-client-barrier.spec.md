# LLP 0059: Session projection and client authority barrier protocol

**Type:** Spec
**Status:** Accepted
**Systems:** Auth, Runtime, Storage, API, Live Queries, Ephemeral state, Client integration, Contract, Exact, Security, Backup/restore, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-13
**Revised:** 2026-08-12 (first-party unrecognized-authority recovery: a
server-witnessed anonymous handshake at a different authorization-stream
incarnation may enter the standard barrier without an app-visible capture only
after resume/adoption has failed closed or custody is stuck clearing; healthy
settled custody remains capture-scoped). 2026-08-06 (transition ownership split: the clearing CAS now
releases cross-context custody before any awaited participant phase; local
quiesce/blank/clear/commit settlement is fenced by the durable transition id,
epoch, and revision, then an exact owned reacquisition alone may settle the
same intent before the existing resume/final-exposure fence; an external local
`synchronize()` that observes this active clearing barrier joins its terminal
completion before one fresh synchronization instead of returning a hot-retry
refusal, while participant-callback reentry keeps the prompt owned refusal
needed to avoid a barrier self-join). 2026-08-03 (LLP 0109 acceptance: dated amendment recording the
versioned reset carriers' idempotency contract — operation-id/request-digest/
expected-stream binding, same-transaction operation journal, replay that
observes current state before historical completion, no separate seed
journal or publication phase). 2026-07-26 (authorization-reservation contention is an explicit
retryable 409 conflict before any durable effect, with a short-jitter retry
strategy); 2026-07-23 (sender-bound amendment, per the LLP 0077 author
decisions: `BoundGrantAuthorityV2` — the session arm gains the custody key's
JWK thumbprint and the `sender_replay_epoch` at issuance, with exact-tuple
equality and revocation/epoch invalidation; V1 grants stay valid only on
non-sender-bound lanes. The browser custody record's V3 sender extension is
owned by LLP 0077 §The closed AuthCustodyV3 schema; `AuthCustodyV2` here
remains the closed non-sender format). 2026-07-17 (authorization-reservation frontier closure: the SQLite data head and durable authorization witness used by one reservation are read as one snapshot-bound pair, never synthesized across commits). 2026-07-17 (Contract durable-confirmation closure: an exposed
local custody record remains the fail-closed blanking witness even after a
clearing wakeup pre-pauses publication; the local cut snapshots participants
behind completion, isolates every quiesce/blank/clear failure, preserves the
custody diagnostic, types missing resume custody as corruption, and both
single-query and multi-live app-data dispatches reload and exact-compare at
their true transport boundary; offline restore keeps participant/counter cuts
outside non-reentrant ownership, registration-time sync phases observe invalid
thenables, and participant self-unregistration joins fail typed instead of
deadlocking; every destructive cut retains one exact participant snapshot and
completion through its final blank, final phase closure catches late
registrants or overlapping eager cuts inside the ownership fence, and
coordinator close/reentrant staged work cannot reopen or extend resume).
2026-07-17 (background terminal failure ownership: live service
deadline observation surfaces classification/plan/gate/transaction/task
failure without inferring a durable terminal, and idle connection cleanup
retains an exact mint-only retry capture across child failure). 2026-07-17 (service-ending lifecycle serialization: a committed
terminal publishes its disposition after Local, retains the exact domain
ticket through connection/notifier/effect cleanup, and releases that ticket
only as the final after-Local settlement, so an overlapping stronger ending
cannot commit and then lose its typed lifecycle event). 2026-07-17 (grant-deadline fanout closure: both finite HTTP and
live-stream deadline owners retain the complete read-only planned token set
through durable settlement and typed lifecycle cleanup; a managed Local act
fails closed instead of committing ahead of that owner, while direct embedding
retains synchronous persistence). 2026-07-17 (scoped-token/reset ordering closure: `/auth/session`
and connection-open capture their anonymous stream/connection authority before
durable scoped-token resolution and witness registration; reset-before-resolve
deletes the durable predecessor, reset-after-resolve leaves only a stale
predecessor publication, and diagnostic handshake admission does not waive an
installed stream fence). 2026-07-17 (Contract client lifecycle generation closure: resume, socket-loss, and swappable-ephemeral identities share one checked allocator; exhaustion synchronously blanks and terminally detaches the affected publication surface, settles pending barrier work, and never requires a disposal generation). 2026-07-17 (managed-Local/ephemeral separation and room-commit
interlock closure: authorization writes reserve and quiesce their exact room
selector before Local and SQLite, bind only lock-free transaction witnesses,
revalidate durable/app/definition/issuer generations, and settle committed or
known-rollback effects only after Local; neutral writes touch no room registry,
ambiguous commits remain closed, cancellation exact-unmarks, direct embedders
use the same synchronous scoped handoff, and inspect/reset/definition/notifier
effects are split from Local ownership). 2026-07-17 (terminal delivery and retired-id cleanup closure: the
registry installs the exact typed event and wake before infallibly removing
the checked grant, the following exact purge releases predecessor leases
silently, and a mint-only retired grant receives
ephemeral/Local/ephemeral whole-id cleanup; bulk maintenance spawns every
owned cleanup before awaiting any child).
2026-07-17 (post-drain cancellation closure: session/reset
carriers and the drained finite-service domain gate synchronously transfer to
independently owned Local/SQLite/finalize/propagate tasks before another await,
so request cancellation drops only a response waiter). 2026-07-17 (Agent filesystem capability closure: one dedicated
helper retains the validated custody-directory inode and performs the relative
SQLite lock, record, atomic replacement, fsync, and bounded orphan cleanup;
helper loss closes that process until restart rather than re-resolving a mutable
pathname). 2026-07-16 (connection-live staging and teardown closure: reservation-only Local stages cross one exact CAS under the canonical auth/registry/mode order, an owned finalizer retains lock-free stream/session/service work permits through post-cut Local work, terminal premark closes new admission before asynchronously draining predecessor permits, and socket/admin/idle cleanup splits exact grant or generation ownership from ephemeral and Local phases). 2026-07-16 (composed publication lock order: the stream/session leaf and exact connection registry precede the independent mode-admission effect guard at every bounded handoff, forbidding the reverse edge that deadlocked concurrent authenticated live subscriptions). 2026-07-16 (client-store format-6 terminal fencing: the persisted anti-rebind marker is mandatory, v5 migration is deletion-only, delayed adoption compares store generation, the final safe generation is reserved for terminal deletion, and shared client-store writers require coordinated rollout). 2026-07-16 (Agent terminal-ledger reconciliation: tuple witnesses
share one universal gate with primary custody, persist before primary
interpretation, old tombstones backfill before
replacement, adapter partition ownership and coordinated rollout are explicit,
and terminal store replay is distinguished from an exact-current nonterminal
service successor). 2026-07-16 (finite service-authority closure: scoped-token
resolution now registers one exact process witness, terminal transactions
premark only their read-only planned token set before any write, finite and
connection publication use that witness, external native effects use a
begin-to-initiated cut, and monotonic-observed expiry is persisted before it
becomes terminal). 2026-07-16 (client-fence implementation closure: terminal
classification defaults missing or malformed evidence to carrier-only,
finite Agent failures await durable barrier settlement, browser transport
pre-cuts are phase-deduplicated within the exact capture, request start and
publication use final custody comparisons, and identity-counter exhaustion
permanently closes publication). 2026-07-16 (terminal authority-disposition closure: the typed
terminal frame distinguishes a replaceable expired/evicted carrier from a
durable authority deletion, with a closed two-value wire axis and exact source
classification); 2026-07-15 (author ratification: Charlie Cheever explicitly
ratified this Spec after ENG-25001 closed the review findings, the corrected
FINAL7 Codex review returned READY, and the FINAL5 Fable review returned READY;
Status advanced to Accepted without advancing frozen LLP 0039 or LLP 0053);
2026-07-15 (FINAL6 composed-client evidence closure: names the
production `SnapbackClient.authSession()` fixture and completes its owner/peer
matrix for paused success, post-staging custody mismatch, and final locked
`owner.read` failure; wrapped-owner read/phase witnesses prove earlier reads and
transport staging completed before the exact final read throws, every failure
discards staged/in-flight work and remains blank, and only the later clean
synchronization cache becomes visible). 2026-07-15 (FINAL4 bootstrap-gate closure: makes anonymous
establishment creation-only, uses a durable-null synchronization result as the
sole kit bootstrap witness, refuses paused exact captures before handshake or
cache work, and proves real owner/peer success plus mismatch/read-failure cache
discard without reopening publication). 2026-07-15 (FINAL3 publication closure: pauses ordinary
`compareAndCommit` callbacks throughout owner/peer resume; stages exact
capture-bound resume effects and flushes them, in order, only inside the final
locked durable confirmation; discards them on mismatch, clearing/null, read or
callback failure; and adds owner/peer, real-kit handshake-cache, and raw/managed
close-only terminal evidence). 2026-07-15 (final durable-confirmation follow-up: adds a short
exact ownership read after result delivery, before peer barrier entry, and
after owner/peer resume before exposure; treats that final locked read as the
linearization point; and proves missed-broadcast direct, adoption, recovery,
read-failure, and same-authority-revision cuts). 2026-07-15 (final cross-family review follow-up: makes every
owner/peer resume-time reload exact-or-stale, fences pre-barrier reloads that
finish during resume, composes the real Contract participant reload, proves
changed-durable owner/peer races, and reconciles intent-backed recovery and
acceptance evidence; status remains Draft). 2026-07-15 (blind-review readiness closure: landed two consecutive
fallback takeovers, every named Web-Lock-owner loss cut, the finite
duplicate/reordered/dropped broadcast matrix, the delayed stale-authority
one-key localStorage writer, and coordinator/expiry-worker construction
failure before socket bind; production now consumes the `SnapbackApp`
construction receipt before acquiring the listener). 2026-07-15 (ENG-25001 defect resolution: durable terminal
frontiers and monotonic restore; coordinator-only protocol 1; custody format 2
transition intent with embedded-authority validation; ownership release before
resume/network; terminal `auth_error` frame or `4401/auth_error` close latch;
deployment identity and UUIDv7 boundary; counted prepared
handshake authority and durable cache fence; typed construction receipts;
LLP 0008 per-storage-key Web-Lock one-key reconciliation; and dev/test lock-rank assertions).
2026-07-14 (round-2 dual-family revision, /llp-super-refine:
reconciled the LLP 0057/0059 commit-ambiguity contradiction from the 0057 side
(exact-durable-successor reconciliation is now the single owning rule); restated
the **lock-rank assertions as a named defect obligation** (shipped locks are raw
mutexes — no landed rank facility) and removed the landed-evidence overclaim;
flagged the **localStorage segmented-namespace protocol as a genuine conflict
with governing LLP 0008's landed one-key protocol**, requiring
reconciliation not a unilateral override; scoped the grant-mint "indistinguishable"
sentence so it no longer contradicts LLP 0057's `AUTH_REQUIRED` vs
`SESSION_EXPIRED`; cross-referenced the durable-restore clock-floor fix and named
the durable-frontier-before-terminal-event obligation; and recorded the remaining
GPT-family spec-vs-code findings (protocol-1 coordinator prerequisite, durable
transition intent, phase-8 ownership release, close-code terminal latch,
handshake app-identity/UUIDv7, final-fence handshake capture, readiness probes)
as named defect obligations. Full triage in §Open decisions and status.)
2026-07-14 (ENG-24996 review gate: archived the GPT-family review artifact at `reviews/0059-session-projection-and-client-barrier.codex.md` and applied its editorial correction to the public credential-classification prose; material findings remain for author triage). 2026-07-14 (ENG-24982 session-clock-floor audit: persist a durable non-decreasing `auth_session_clock_floor_ms`, seed the process clock from it at startup, and derive every wall-clock lifetime decision at `max(sample, floor)` so a backward wall move across restart cannot rebuild a slid or absolute-expired session as current). 2026-07-14 (leased-handoff reconciliation: share one bounded projection/outbox budget, preserve level-triggered projection suffixes, rank recovery markers through final HTTP/WebSocket transfer, and keep projection-only responses behind the exact outbox cut). 2026-07-14 (client poison-latch reconciliation: a connection-continuity loss permanently closes that ephemeral overlay generation, including against delayed snapshots; only a fresh subscribe may construct its successor, while room-scoped resync retains in-place snapshot recovery). 2026-07-14 (client-store version reconciliation: qualify format 3 as the historical item-5 predecessor and point the composed production format 5 and its v1–v4 migration rules to LLP 0043 without self-ratifying this Draft). 2026-07-14 (overflow containment reconciliation: bound and byte-charge exact recovery markers, collapse exhausted recovery state to one fail-closed all-authority signal, and route connection-wide clear-retained recovery across durable and ephemeral client lanes). 2026-07-14 (resume-transfer reconciliation: keep a changed-generation successor scope and effect fence unpublished until fresh authorization, retry resolution, and any newly available authenticated predecessor-retirement frontier are commit-ready; roll failed staging back to the quarantined retained predecessor). 2026-07-14 (final effect-fence reconciliation: record the exact stream/grant/session fence on retained realtime state, scoped queue overflow/purge, replacement-safe room reauthorization phases, mint-only containment, and the bounded ordinary WebSocket handoff). 2026-07-14 (final auth audit reconciliation: retain mode admission through the final HTTP body sink and make same-mode sessions activation wait for predecessor responses while projecting its exact authorization event before reopen). 2026-07-14 (implementation-evidence reconciliation: record ENG-24603/item 5's landed server/client mechanisms, distinguish its historical activation boundary from the now-composed items 6–8 posture, and remove item 8 from future decisions without self-ratifying this Draft). 2026-07-14 (final audit reconciliation: align the missing/unsupported auth-client offer with LLP 0012's registered `SNAPBACK_AUTH_POLICY_UNAVAILABLE` refusal and preserve independent surface-specific protocol negotiation); 2026-07-13 (initial implementing protocol for ENG-24603 / LLP 0039 landing item 5)
**Related:** LLP 0000, LLP 0007, LLP 0008, LLP 0009, LLP 0011, LLP 0012, LLP 0013, LLP 0031, LLP 0034, LLP 0039, LLP 0043, LLP 0051, LLP 0052, LLP 0053, LLP 0057, LLP 0058, LLP 0060

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
  and acceptance races come from LLP 0039 and the ENG-24603 program
  assignment. This Spec owns the concrete transition table that refines those
  frozen outcomes.
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
- **[inferred — implementation mechanism ratified 2026-07-15]** Exact
  ticket encodings, leaf-fence layout, leased outbox drain, custody record,
  fallback lease timings, and diagnostic allocation below were proposed
  implementation choices and are now implemented. They preserve 0039's required
  outcomes and are accepted by the explicit author ratification; implementation
  evidence alone was not the ratifying act.

The first observation is the pre-item baseline; the second records the landed
implementation. Neither thaws LLP 0039/0053; the explicit author decision
recorded in Status accepts this document.

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
| Client custody format | `2` |
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
- Before publishing any time-derived terminal event, the expiry authority
  samples one immutable set of due `(sessionId, generation, deadline)` tuples
  and durably advances the floor to the maximum of that complete set's epoch
  deadlines and the sampled epoch. After the storage await it terminalizes
  only those sampled predecessors whose generation, state, and deadline still
  match. Clock movement during the await cannot add a newly due session to the
  publication; that session waits for the next pass, whose own complete
  frontier is persisted first. This also applies when monotonic time proves
  expiry while the wall sample moved backward and closes the crash window
  before the next GC pass.
- A declared restore computes its destructive timestamp as the maximum of the
  host sample, restored durable floor, and the relevant restored catalog
  timestamp maxima, then advances the floor in the same transaction before
  writing revocations. This is the LLP 0057 restore frontier; it is not limited
  to session creation time.

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
  under the topology/fence update; sibling pending tickets remain. A sampled
  multi-session batch settles every exact ticket independently: a sibling
  terminal mutation or deadline replacement is an expected compare-and-swap
  loss that exact-unmarks only the expiry ticket, while other successfully
  expired sessions remain terminal outputs. A contradictory entry fails the
  projection closed only after all otherwise-settleable entries have been
  processed, and every successful terminal output reaches Propagate before the
  batch error is surfaced. Time cannot roll back into a live session. It
  immediately starts terminal close. Durable
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
  finite-service fence, connection-registry mutex, room mutex, or notifier
  mutex while holding `LocalSnapback`, the provider/catalog mutex, a SQLite
  writer, or a SQLite transaction.
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
- Never acquire a stream/session publication fence or the connection registry
  from beneath a mode-admission effect guard. The mode fence is independent,
  but when the two cuts compose it is always the later lock.
- Connection teardown never acquires activity, room, room-authority, notifier,
  outbox, or rate-bucket locks while the managed `LocalSnapback` write scope is
  active. Direct-library compatibility orchestration is permitted only outside
  that managed scope; debug/test builds make the boundary executable.
- Reset, collection-definition publication, authorization-issuer publication,
  room-authority settlement, notifier wake, and ephemeral diagnostics likewise
  never acquire their process locks while a managed or direct
  `LocalSnapback` write scope is active. A committed Local phase transfers
  immutable callbacks and any exact admission owner to its blocking owner,
  releases Local and the scope, and only then executes those callbacks. The
  logical managed writer remains closed until the callback batch finishes.
  Ordinary successor projections (reset, collection definitions, issuer
  installation, and notifier wakes) form the first callback phase;
  authorization-ticket commit/rollback settlement is a distinct final phase.
  A projection panic skips settlement and leaves the exact protected sinks
  closed.

### Authorization-write handoff

Every storage call capable of advancing or rotating the durable authorization
version uses this choreography:

```text
stage immutable write effects and exact changed rows
-> classify NoAuthorizationEvent, exact AppWrites, or AllProtectedRooms
-> outside Local and SQLite, install the matching room dependency and wait for
   already-admitted affected-room/final-send permits to drain
-> acquire Local; recheck app generation and the snapshot-bound
   (data head, durable authorization) pair,
   protected-collection generation, and exact issuer predecessor
-> install one thread-local reservation carrier
-> open SQLite and bind the carrier to the transaction-derived witness without
   taking a process mutex
-> commit or establish exact durable rollback/ambiguous evidence
-> release SQLite and Local
-> known commit: after every ordinary successor projection, advance the issuer
   and finalize the exact room ticket;
   known rollback or unused carrier: after ordinary cleanup, exact-unmark;
   ambiguous: retain the ticket
```

`NoAuthorizationEvent` allocates no room ticket and does not consult the room
registry. `AppWrites` carries the normalized stored plan or already-buffered
handler effects; a one-shot Ibex handler is never rerun merely because the
reservation became stale. Scope-attributed changes reserve only the exact room,
so another room in the same protected collection remains live while the
affected room drains. Schema, mode, activation, restore, and destructive reset
use the explicit all-protected-room form.

Actions preserve that granularity per nested mutation, not per outer action. A
managed HostPlan action releases Local and runs the full choreography above for
each `RunMutation` step before exposing that step's result binding to the next
step. A detached Ibex action stages a HostPlan target under one short Local
window; an Ibex target executes once against its detached read view and then
re-enters Local only to preview the immutable buffered effects. Both release
Local before room quiescence, revalidate the action generation and durable
snapshot before commit, and retain the existing watchdog commit gate only for
the final SQLite cut. The watchdog cancels an in-flight room reservation after
linearizing abandonment, so an already-admitted room permit cannot strand the
action worker or publish a late receipt/live effect. Direct-library HostPlan
and Ibex actions remain synchronous, but each nested mutation uses the same
off-scope compatibility reservation rather than acquiring a room lock inside
its logical Local scope.

Binding is valid only when the protected-collection generation is unchanged,
the actual transaction selector is covered, and a non-rotating authorization
witness is exactly the reserved issuer successor (same incarnation and epoch
`+1`). The server also rechecks the app generation and reads the SQLite data
head plus durable authorization version in one deferred transaction after
quiescence. Drift returns the typed
stale result and cancels the carrier after Local; it never widens silently or
prepares a replacement from inside the transaction. An installed interlock has
no transaction-time preparation fallback: reaching SQLite without a carrier
fails closed.

Because this stale result is detected before the durable transaction commits,
the operation has no durable effect and is safe to re-enter from its beginning.
The served boundary reports `SNAPBACK_AUTH_RESERVATION_STALE` as HTTP `409`
with closed details `{retryable:true, retryStrategy:"short-jitter",
effectCommitted:false}`. Clients retry the complete operation with short
jitter; they do not treat it as backend unavailability or infer that an
authorization rule denied the attempted write.

The reservation wait is cancellation-aware. Cancellation before ownership
transfer removes only that ticket and all of its per-room pending marks, even
while predecessor permits remain active. Once the blocking Local owner has the
carrier, request cancellation cannot drop it; that owner always consumes or
cancels it and flushes the after-Local batch. Direct-library calls reserve
before entering a synchronous `LocalSnapback` write scope and drain after
leaving it, so their externally synchronous behavior does not reintroduce a
SQLite-to-room/notifier edge.

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
stream fence -> optional session fence -> optional finite-service fence
-> connection registry (verify the exact opaque grant id and retain the guard)
-> mode-admission effect guard for the exact counted root
-> exactly one bounded branch:
   - room act -> room -> outbox enqueue -> generation-matched notifier wake; or
   - drain/handoff -> optional generation-matched notifier
     -> room-authority registry/outbox acknowledgement or writer-queue handoff
-> release in reverse order
```

The stream/session and optional finite-service publication fences are therefore
acquired before the connection-registry mutex, and the registry precedes the
mode-admission effect guard. A direct finite response has no connection
registry and uses stream/session, optional finite service, then mode admission.
The registry guard stays held through only
the bounded synchronous ownership transfer, so pressure eviction or authority
mismatch cannot retire the exact grant between validation and handoff. No path
may acquire a stream/session fence from beneath either the registry or a mode
effect guard. The only
network-facing operations nested beneath these locks are a bounded in-memory
writer handoff and the first-frame acknowledgement of an already-built leased
HTTP response. `try_commit(buffer)` and batch acknowledgement are synchronous,
nonblocking, and perform no socket I/O; a connection-writer task or HTTP stack
flushes accepted bytes only after every auth lock is released. A full/closed or
invalidated handoff accepts nothing and returns immediate backpressure or a
fail-closed empty body.

Five connection-bound operations need Local work whose result cannot be
computed safely before the final authority cut: live subscribe, resume,
unsubscribe, authorization-invalidation acknowledgement, and manual retry.
They use this reservation-first exception to the ordinary complete-buffer
shape:

```text
Local: reserve one exact-fence stage and immutable inputs; do no Hermes/SQLite
or obligation/subscription mutation
-> release Local
-> stream/session: reserve bounded authority-work ownership and release locks
-> optional finite-service fence: reserve the same ownership class
-> exact connection act: stream -> session -> optional service -> registry
   -> mode effect guard -> one stage-state CAS(PENDING -> COMMITTED)
-> release every synchronous lock
-> synchronously spawn an owned finalizer carrying the stage, mode root, and
   retained authority-work permits
-> Local: claim COMMITTED, execute the operation, publish or roll back its
   complete local effect, remove the stage
-> release the retained permits with atomic-only drops
```

The request future never owns the post-cut finalization lifetime. Once the CAS
wins, dropping the request-side join handle cannot cancel the owned task or
release its authority permits early. Disconnect and terminal purge change the
same stage control word to terminal under Local; whichever side claims Local
first either completes an honestly pre-terminal effect that teardown then
purges, or prevents finalization altogether. A refused act abandons the stage
without running app/database work. Stage count, per-connection subscription
capacity, and conflicting subscription/obligation keys are reserved and
bounded before the cut.

Retained permits are not mutex guards. A session or stream terminal mutation
first installs its exact pending ticket under the ordinary fence locks, thereby
closing every later reservation, then releases all locks and asynchronously
waits for predecessor permits to reach zero before any durable terminal write.
Finite service authority uses the same pending-first drain rule. Cancellation
while waiting compare-unmarks only the still-owned ticket; it cannot leave a
stranded marker or reopen over a sibling/committed terminal state. This
pending-first choreography gives terminal work priority over a continuous
stream of live requests and forbids revocation starvation.

After a drain returns, there is no further cancellation point while the
request transfers the marker carrier into an independently owned task. That
task owns the Local/SQLite attempt, exact rollback or finalize, and terminal
propagation; the request awaits only its join handle. Dropping that waiter
therefore cannot orphan a marker while queued for Local, reopen authority while
a blocking commit continues, or skip propagation after a known commit. Reset
uses the same ownership boundary around its complete premark-through-finalize
operation.

The room in the first branch is the data-room mutex; the room-authority
registry in the drain branch is a separate control mutex. A generation notifier
is never held while entering a data room. Level-triggered room-authorization
resync materialization occurs before generation-guarded selection, or under a
control state that excludes concurrent data-room mutation, and releases all
data-room locks before waking delivery.

Finalization is sequenced, not nested:

```text
projection/fence finalize and release
-> under registry then notifier: generation/grant-matched typed terminal-event
   install and wake, then infallible checked-grant/reverse-index removal
-> release registry
-> silent exact-fence outbox/room purge and active-lease release
-> for a mint-only retired grant: whole-id ephemeral cleanup
-> Local topology cleanup
-> whole-id ephemeral post-Local sweep
```

No later stage calls back into an earlier stage while holding its lock. The
existing notifier generation remains part of the compare key so teardown of an
old socket cannot unregister or close its replacement. Terminal purge may
remove still-uncommitted outbox/room work, but it cannot retract a buffer already
accepted by a writer handoff before `Begin`; that buffer is honestly in flight.
Terminal installation occurs while the registry still owns the checked grant:
a wake that checked before installation must queue on that registry owner, and
grant removal cannot become visible until the event is visible. The following
exact purge is intentionally silent even when it releases an active lease
containing preserved work. Whole-id cleanup never unregisters or erases the
installed terminal event.

Connection teardown is also sequenced. Ordinary WebSocket close preserves its
reusable grant: while holding registry then notifier, it atomically replaces
the exact socket generation with a teardown claim and marks that grant
temporarily suspended. It then releases both locks, performs whole-connection
ephemeral cleanup, performs Local topology cleanup, repeats the exact-fence
ephemeral purge, and only then clears the suspension/claim under registry then
notifier. A stale socket cannot claim a newer generation. If terminal
retirement already removed the grant, the claim performs exact-fence rather
than readable-id cleanup, so it cannot erase a successor.

Administrator disconnect and idle reaping have different semantics: under the
registry they remove the exact grant and permanently enable mint-only
containment before returning a terminal capture. An independently owned task
then retires only the matching notifier registration, performs whole-id
ephemeral then Local cleanup with no overlap, and repeats the whole-id
ephemeral sweep after Local. The admin
route awaits that task before acknowledging success; cancellation of the
request or maintenance worker does not cancel cleanup. The retired bearer is
invalid before asynchronous cleanup begins, and a caller-suggested readable id
cannot be adopted during whole-id cleanup. Maintenance retirement spawns every
captured cleanup task before awaiting the first one, so cancellation while one
task is blocked cannot drop the unspawned captures for the remainder of a
batch. The batch owner also retains a clone of each exact mint-only capture
until its child joins. A child panic or cancellation is reported without a
readable id and returns that capture to the next maintenance tick for
idempotent notifier/ephemeral/Local retry; registry retirement continues to
forbid requested-id reuse throughout the retry interval.

The server supplies test/dev lock-rank assertions for projection topology →
authorization stream → session leaf. An intentional inversion fails before the
lower-ranked mutex acquisition. Connection/room independence is proven by
`server::tests::protected_room_server_fast_paths_progress_during_affected_commit`
rather than nesting those registries under projection guards. That named L9
fixture holds the affected authorization commit pending while unrelated
protected-room registration, publication, and drain complete over both HTTP and
WebSocket within bounded time; it remains an acceptance obligation.

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
  | {
      kind: "servicePrincipal"
      authorizationStreamIncarnation: CanonicalUuidV7
      authority: ResolvedAppAuthority
      tokenId: TokenId
      deadlineMs: SafeIntegerTimestamp
    }
```

Every Rust variant additionally holds its bearer-free `FencedPublication`; the
session arm of that handle owns an `Arc<SessionFence>`. The service-principal
variant also holds the exact `ServiceAuthorityPublication` for `tokenId`.
Those handles are not serialized or exposed. Session `deadlineMs` is a mutable
cached validity lease updated from its fence after a qualifying use; it is not
session grant identity. Service authority retains the closed resolved durable
principal/grant shape separately from the exact token/deadline carrier. The
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

### BoundGrantAuthorityV2 — sender-bound grants (amendment 2026-07-23)

On sender-constrained lanes (LLP 0077), the session arm is versioned to
`BoundGrantAuthorityV2`: it extends the V1 session variant with exactly two
immutable identity fields — `senderThumbprint` (the custody P-256 key's JWK
thumbprint, 32-byte base64url) and `senderReplayEpochAtIssuance` (the durable
`sender_replay_epoch` current when the grant was minted). Equality is
exact-tuple over the V1 identity fields plus both new fields (the mutable
`deadlineMs` lease stays excluded, as in V1). The grant invalidates — no reuse,
no renewal — when the thumbprint's custody family is revoked or when
`sender_replay_epoch` advances past the issuance value; either condition
closes the grant exactly like an authority mismatch. The anonymous and
service-principal arms are unchanged. V1 session grants remain valid only on
non-sender-bound lanes; a sender-constrained lane MUST refuse to mint or
honor a V1 session grant. The wire/custody half of this shape is owned by
LLP 0077 (§Author decisions item 6); this section is the registry-side
authority it amends.

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
  | { kind: "service"; tokenHash: string /* exactly 64 lowercase hex digits */ }
  | { kind: "anonymous-or-malformed"; incarnation: CanonicalUuidV7 }
  | { kind: "canonical-unknown"; incarnation: CanonicalUuidV7 }
```

Every `POST /connection/open` attempt counts, including rejected and
exact-`previousToken` attempts. Ordering is exact:

1. bounded request-shape and bearer-syntax parsing occurs without provider or
   SQLite access;
2. an absent bearer or malformed presented bearer consumes the
   anonymous/malformed prebudget before any authority lookup;
3. a syntactically valid scoped service token consumes its token-hash service
   bucket before durable token/grant resolution;
4. a canonical session bearer is SHA-256-indexed only in `SessionProjection`—connection
   open MUST NOT fall through to provider/database resolution;
5. a current or attributable superseded bearer consumes its exact session
   generation bucket; and
6. an unknown canonical digest consumes the canonical-unknown bucket.

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
4. perform the synchronous in-memory leaf act, transfer its complete buffer
   into a bounded writer/HTTP ownership handoff, or commit one reservation-only
   Local stage by CAS while every relevant guard remains locked.

The leaf operation must be small and nonblocking. A direct finite response or
effect is computed before it in an unpublished buffer. A queued live delta may
already have been computed and enqueued under the global write guard; for that
path the leaf operation is drain/send, never enqueue. The five staged Local
operations are the explicit exception: only their immutable reservation exists
before the cut, and a retained non-locking authority-work permit excludes
terminal durable commit until owned post-cut finalization finishes. This
removes the old check-then-act delivery window without putting app execution
beneath an auth lock.

Every path that removes a grant outside ordinary auth finalization returns its
exact terminal capture after releasing the publication and registry locks. The
retirement sink then purges the captured effect fence, releases any leased
batch bound to it, and retires only a notifier registration carrying the
removed opaque grant id. An unused or unpublished exact retirement has no
whole-id activity and may wake preserved successor or authority-independent
work after its exact purge. A used pressure eviction, authority mismatch, or
auth-terminal retirement first enables mint-only containment and then runs
whole-id ephemeral/Local/ephemeral cleanup; there can be no same-readable-id
successor to preserve or unregister. These paths therefore cannot leave a
delayed HTTP body, rate bucket, owned outbox entry, room subscription, Local
topology, or predecessor socket with handoff authority.

### Finite service authority fence

A successfully resolved scoped token registers one process-local witness while
the caller still owns the database/app lock used for resolution:

```text
tokenId, grantId, actorUserId, effectiveUserId,
credentialId, credentialGeneration, tokenDeadline, optionalGrantDeadline
```

The registry is owned by the database and shared by every clone of its one
`AppState` graph. Constructing a second independent connection/lifecycle graph
for that database is invalid: terminal publication, finite invocation, and
connection acts must all meet at the same token fence. The witness retains no
bearer secret. Re-registration of the same token must match the entire tuple
and may only tighten its monotonic deadlines.

Finite query, mutation, action, `/auth/session`, connection-open, and every
later connection act carry this exact publication handle. Its closed result is
`Current(witness)`, `Terminal(carrier | durableDelete)`, or `Unavailable`.
Pending or ambiguous termination, clock rollback, poisoned state, a missing
handle, and a deadline not yet persisted all produce `Unavailable`; none may be
treated as current or terminal by inference. A bounded synchronous connection
act holds the token-fence mutex through its app mutation/publication handoff.
Nested local validation on that same thread reuses the already-sampled witness;
it must not recursively acquire the non-reentrant mutex or take a later clock
sample as a new linearization point.

Scoped-token resolution and witness registration require Local/SQLite, while
the stream fence is prohibited beneath that owner. The caller therefore first
captures the current anonymous `FencedPublication` (or anonymous connection
authority), releases every stream/topology lock, and only then resolves and
registers the token under Local. If reset wins before the capture, preparation
fails without consulting SQLite. If reset starts after capture but before the
lookup, the destructive transaction deletes the predecessor token and the
lookup fails. If reset commits after a successful lookup, the retained
predecessor publication refuses the response or grant insertion. The
diagnostic admission used by `/auth/session` bypasses mode availability only;
it never bypasses an installed stream/session fence at final publication.

Every durable operation that can end scoped-token authority follows this exact
transaction order:

```text
read-only terminal plan
-> install exact service-fence pending ticket outside LocalSnapback
-> asynchronously drain predecessor authority-work permits with no Local,
   provider, or SQLite lock held
-> BEGIN IMMEDIATE
-> read-only plan of exact affected token ids
-> premark those token fences
-> first durable write and remaining operation
-> COMMIT
-> publish the committed terminal disposition after releasing Local/SQLite
-> propagate typed connection/notifier/effect lifecycle cleanup
-> settle and release the exact process ticket
```

A known rollback removes only that ticket. If rollback or commit cannot be
proved, the exact planned token set stays unavailable until an operation-
specific durable reread proves predecessor or successor and settles that same
ticket. The process-fence premark/drain happens before entering the Local
database owner; it may never wait for a live finalizer while holding Local.
Planning and catalog validation before the premark are read-only, so
an unprovable rollback there has made no ending write and cannot justify either
a token marker or a process-global quarantine. Unrelated tokens always remain
usable. Token revoke, token expiry, and token-cap eviction settle `carrier`;
grant revoke/expiry, credential rotation/revoke, principal deactivation, and
the other durable-family endings settle `durableDelete`.

The drained process-domain gate is itself a carrier. The code synchronously
hands that gate to an independently owned task before awaiting again; the task
retains it through Local/SQLite work, terminal publication, and connection
lifecycle propagation, then releases the exact ticket as an after-Local
finalizer. An overlapping ending for any token in that domain cannot acquire
its successor gate until predecessor lifecycle propagation has completed. If
publication or lifecycle propagation panics, final settlement does not run and
the exact domain stays closed. Request cancellation drops only the join waiter. This
rule applies equally to explicit grant/credential/token endings, on-demand
deadline maintenance, and connection deadline observation.

Deadline propagation retains the transaction's complete planned token-id set,
not merely the carrier that first observed time. A grant deadline therefore
commits every grant-token ending and sends typed `expired` / `durableDelete`
closure plus exact effect/topology cleanup to every same-grant connection.
Managed Local execution may refuse an already-due act, but cannot persist that
deadline before the independently owned drain/write/settle/propagate task; a
direct library embedder with no server lifecycle graph keeps the synchronous
persistence seam.

Live deadline observation treats classification, read-only planning, exact
gate acquisition, durable transaction, after-Local lifecycle publication, and
owned-task join as one required result. Poison, ordinary errors, panics, and
`JoinError` are surfaced to the socket owner; they may not be converted to an
apparently successful observation. A failed attempt emits no inferred typed
terminal. Its already-due publication remains `Unavailable`, closing every act
that reaches that witness. Before the socket owner returns that first error, it
transfers the complete observation protocol to an independently owned retry
task. Each attempt is panic-isolated through a child task; exponential backoff
starts at 10 ms and caps at 60 s until another ending wins or the exact durable
protocol completes the full planned-token fanout. Ungated process logging
contains only the stable observer code and stable cause code, never durable ids
or provider/storage text.

Both wall and monotonic deadlines are checked at every act. A bare monotonic
observation is not yet a durable terminal fact: it first commits the exact
token revocation, or grant plus all grant-token revocations for a grant
deadline, through the transaction protocol above. Only the committed ticket
publishes `Terminal`. This prevents a backward wall clock and process restart
from reviving authority already observed terminal by the prior process.

An Ibex action native fetch adds one smaller external-effect cut. After all
application-controlled `Request` normalization, `Begin` reserves the exact
current token fence; the trusted native fetch is invoked synchronously; and an
`Initiated` acknowledgement releases the permit in `finally`, including a
synchronous native refusal. A terminal premark waits for an already-open
initiation and prevents every later begin. Workerd and the sealed ambient-deny
slot retain their existing ownership and are not replaced by this wrapper.

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

A reservation-only Local stage is not a response buffer and carries no query
snapshot, acknowledgement result, retry result, or provisional live state.
Its exact CAS is the authority cut; its retained work permit makes the
subsequent Local operation part of the already-admitted predecessor work for
terminal ordering. A terminal marker that wins first blocks reservation/CAS.
A marker that begins after CAS closes new work and drains this owner before its
durable terminal write, so it cannot commit between the act and Local effect.

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
    | "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
  reason:
    | "expired"
    | "revoked"
    | "reset"
    | "restore"
    | "downgrade"
    | "mode_transition"
  authorityDisposition: "carrier" | "durableDelete"
}
```

The frame contains no session id, user id, address, provider subject, token,
grant, or generation. Item 7 retains ownership of the public generation-bearing
authority descriptor. `authorityDisposition` is independent of the diagnostic
reason: `carrier` means only the exact presented session/scoped-token carrier
ended and a surviving durable authority may establish a replacement;
`durableDelete` means the server observed a committed ending of the backing
authority and the client must compare-and-delete its matching durable local
authority state. Session or scoped-token expiry and session/token cap eviction
are `carrier`. Logout/family revocation, grant revocation (single or bulk),
credential rotation, credential-family revoke-self, agent deactivation,
stream reset/restore, and mode transition are `durableDelete`. A producer must
choose from the committed cause; clients must not infer this axis from
`reason: "revoked"`, which is shared by carrier eviction and durable deletion.

A pending mutation ticket blocks new validation but is
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
authority and suppresses generic reconnect. It replaces/re-establishes only a
`carrier` disposition; for `durableDelete` it invokes the coordinator's
capture-guarded durable deletion. A delayed terminal frame for A cannot clear
or close B because both the socket-generation guard and captured authority
epoch must match. If the frame is lost, the next handshake/grant/request still
converges through the projection and incarnation checks.

A missing frame, malformed frame, unrecognized disposition, or close-only
terminal signal is never proof of a committed backing-authority deletion. The
client classifies that evidence as `carrier`, quarantines the exact transport
capture, and requires a fresh handshake to learn current authority. Only the
closed server field `authorityDisposition: "durableDelete"` may authorize the
destructive durable barrier. Finite Agent HTTP failures carry the same axis and
await the accepted barrier's settlement before returning the terminal error.
For browser bearer custody, that fresh handshake is one bearerless
`GET /auth/session`. A valid settled anonymous response may replace custody
only when its `authorizationStreamIncarnation` differs from the stored
authority. The carrier refusal alone, a failed bearerless probe, a non-anonymous
response, or a same-incarnation anonymous response never clears custody. The
different-incarnation server witness is the downgrade-resistance predicate: an
intermediary that strips the bearer can induce the refusal but cannot fabricate
the origin's valid successor-incarnation handshake.

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

The coordinator's closed durable record is below. (2026-07-23: the
sender-constrained `formatVersion: 3` extension — `senderConstraint` and
`pendingSenderConstraint` — is owned by LLP 0077 §The closed AuthCustodyV3
schema; `AuthCustodyV2` remains the closed non-sender format, and v3 shells
settle back to anonymous v2 on logout.)

```ts
type AuthCustodyV2 = {
  formatVersion: 2
  appId: CanonicalAppId
  authorityEpoch: SafeNonnegativeInteger
  revision: SafePositiveInteger
  phase: "settled" | "clearing" | "exhausted"
  authority: ClientAuthorityV1 | null
  pendingAuthority: ClientAuthorityV1 | null
  bearer: string | null
  pendingBearer: string | null
  refreshAfterMs: SafeIntegerTimestamp | null
  transitionIntent: ClientAuthorityTransitionIntentV1 | null
}
```

In `settled`, `authority` is non-null and is the only readable authority;
`pendingAuthority` and `pendingBearer` are null. Anonymous settled custody has
a null bearer and null refresh time; a settled session has a non-null bearer
and bounded refresh time. In `clearing`, current authority and bearer are null,
the record is non-readable to app participants, and pending fields plus
`refreshAfterMs` describe the successor being installed. A required clearing
intent carries its version/digest, predecessor and successor epochs, authority
keys and complete authorities, reason, and disposition. The intent remains on
the settled successor so peer contexts can idempotently apply the same physical
store transition before resume. No broadcast
contains either bearer field.

`exhausted` is the permanent, secret-free terminal state for a monotonic
authority-epoch or custody-revision failure. Both authority fields, both bearer
fields, refresh time, and transition intent are null; the record retains only
its app id, exhausted epoch, terminal revision, and phase. It cannot be adopted,
resumed, refreshed, or transitioned in place. Every observing context closes
publication synchronously, quiesces and blanks all participants, and returns
`SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED` (or the exact owner-side counter
diagnostic). Recovery requires explicit replacement of the custody store, not
counter reuse.

Validation derives both authority keys from the intent's embedded predecessor
and successor authorities. A clearing record additionally derives the
transition digest from its exact predecessor revision, successor epoch, and
successor key. A retained intent on a settled record must name that containing
record's exact successor epoch, key, and authority; when its revision history
also proves that no bearer-only increment occurred, validation derives the
transition digest there too. Later bearer-only rotations may advance the
settled revision while retaining the intent, so they do not pretend the
original predecessor revision remains derivable.

Recovery of a validated clearing intent applies the same transition row as the
original owner; it does not discard the embedded predecessor merely because a
different context finishes the barrier. In particular, an intent that proves
authenticated A to a different session for the same user strands
predecessor-scoped queued payloads as non-replayable/rerecordable exactly as
the table below requires. A missing, malformed, digest-inconsistent, or
containing-record-inconsistent intent is custody corruption and grants no such
preservation.

A fresh store is created only after a successful anonymous bootstrap handshake,
at `authorityEpoch: 0` and `revision: 1`. Every custody record replacement,
including clearing, settling, and bearer rotation, increments revision by
exactly one. Every authority transition increments epoch by exactly one at the
clearing write and keeps that epoch through settle. Neither counter wraps. The
last safe revision is reserved for an `exhausted` marker, so an operation that
cannot retain enough revision space first strips all publishable authority and
credential state through that exact CAS. A legacy or externally injected
non-terminal record that already consumed the maximum revision cannot be
rewritten, but is durable poison: ownership still blanks the context and no
predecessor publication callback may run. An exhausted epoch uses the
dedicated diagnostic below and the same terminal marker when a revision remains.
The same rule is normative for durable Agent custody: persist the terminal
marker while revision space remains, and treat a legacy non-terminal record at
the maximum revision as poison on every read, never as current authority. The
Agent marker deliberately retains its exact closed
`(actorUserId, credentialId, credentialGeneration, grantId)` tuple while
removing bearer, token, and carrier material. That tuple is the non-secret
identity of the poison and terminal witness; unlike browser `AuthCustodyV2`, it
cannot null every authority field without losing the anti-resurrection key.

Durable Agent custody additionally owns a permanent side ledger keyed by
`(custodyId, authorityKey)`. An exact `durableDelete` writes that tuple-specific
witness before reading, validating, or cleaning the primary row. Primary
corruption may reject settlement, but repair cannot erase the already-durable
terminal fact. Primary reads/writes, witness reads/writes,
active installation and final publication comparison all take one reserved
universal gate, then an independently owned primary or witness partition. A
matching witness makes every active operation stale, including an already-open
peer; witness I/O failure blanks and wedges just like primary custody I/O
failure. A terminal proposal for B never rewrites a distinct active A. If B
loses a fresh null CAS, it re-enters the gate and re-evaluates the winner rather
than deleting it. A pre-ledger primary `settled/deleted` row is backfilled to
the side ledger before a distinct active successor replaces it.

Agent adapters therefore advertise `partitionOwnership: "partitioned-v1"` and
the gate owner provides `withPartition`. One global non-reentrant mutex does
not satisfy this contract and is rejected before use; ownership callbacks are
themselves non-reentrant. Caller ids cannot enter the reserved gate/witness
namespaces. Witnesses have no automatic retention deadline because deleting a
witness would re-admit its old descriptor; explicit custody-store replacement
is the current compaction boundary. This protocol requires coordinated process
rollout: every process sharing one custody store is drained before upgrade,
because a pre-ledger binary does not take the universal gate or inspect the
side ledger.

The reference Node adapter acquires one retained POSIX directory capability
before its first partition lock. A dedicated helper validates the configured
directory's exact device/inode/owner, changes into it once, and thereafter
accepts only derived single-component names. SQLite `BEGIN IMMEDIATE`, record
reads, temporary creation, atomic rename, unlink, and directory fsync therefore
share that kernel-held CWD inode even if the configured pathname is renamed or
replaced. The helper is the lock owner and sole file actor; if it dies, the
lock and stale writer die together and the parent permanently refuses that
capability until process restart. The process retains at most 32 directory
capabilities and does not idle-evict them. Under each primary or witness
partition lock it scans at most 4,096 entries and removes only up to 128 / 8 MiB
of validated files in that exact record's temporary namespace; limit and
partial-cleanup outcomes are typed diagnostics.

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

  recoverUnrecognizedAuthority(
    observedAnonymousAuthority: AnonymousAuthority,
    reason: AuthorityTransitionReason,
  ): Promise<AuthorityCaptureV1>

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
While an owner or peer publication barrier is paused, `compareAndCommit` MUST
return `{committed:false}` without invoking its callback, even if durable
custody already contains the exact successor. Resume work uses the staging
interface below instead; this prevents a nominally current callback from
becoming observable before the barrier's final exact durable confirmation.

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

### Unrecognized authority recovery

`recoverUnrecognizedAuthority` is the coordinator-owned, app-scoped escape for
a context that cannot obtain the capture required by ordinary recovery. Its
input is a server-witnessed anonymous authority from a bearerless
`GET /auth/session`, never an app assertion and never a capture substitute. It
is admissible only while the local publication gate is paused after a failed
resume/adoption, or while the exact locally observed durable record remains in
`clearing`. A healthy settled coordinator refuses it; `transition` and
`compareAndClear` remain the only sanctioned capture-scoped tools there.

Under custody ownership, recovery reloads and exact-compares the local phase,
revision, authority epoch/key, and transition id against durable custody. It
then requires the observed authority to be anonymous and its authorization-
stream incarnation to differ from the current durable settled or pending
authority. Any peer change wins and returns
`SNAPBACK_CLIENT_AUTHORITY_STALE` before participant work. An admitted recovery
writes the ordinary `clearing` successor by exact-revision CAS and runs the
same quiesce → blank → clear-memory → durable-participant commit →
clearing-to-settled CAS → reverse resume → final exact durable confirmation and
exposure barrier as `transition`. It targets the observed incarnation directly,
including removal of a format-3 sender-custody shell when the successor is
anonymous format 2; it never routes through `establishAnonymous` and never
deletes the shared IndexedDB database.

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
  phase: "clearing" | "settled" | "exhausted"
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

Failure to acquire ownership or read/validate custody after a context has an
exposed validated local record is itself a local fail-closed barrier. The
record, not the current publication-pause bit, is the exposure witness: an
ordinary clearing wakeup may already have paused new publication without yet
blanking the predecessor materialization. The failure cut snapshots every
registered participant behind a completion handle, observes every quiesce
result, and attempts synchronous blank and memory-clear for every snapshot
entry even when another participant fails. A quiesce-time unregistration
request cannot remove its entry until those destructive phases finish.
Participant failures remain secondary evidence; the ownership/read/corruption
diagnostic stays primary. Null custody is compatible only with a fresh context
that has no local record and began blank; null encountered during active resume
or after prior exposure is `SNAPBACK_AUTH_CUSTODY_CORRUPT`.

Offline restore uses the same ownership discipline. Its owned callbacks only
read and validate durable custody; counter-exhaustion cuts, fail-closed cuts,
and peer-adoption participant phases run after the non-reentrant owner is
released. A peer adoption confirms the exact durable successor before its
participant barrier and again under the final publication fence before local
exposure. Fresh and same-authority restores likewise install only the exact
second read. A participant registered while the coordinator is paused MUST
complete `blank` and `clearMemory` synchronously. Any returned thenable is
observed, rejected as `SNAPBACK_AUTH_PARTICIPANT_ASYNC_SYNC_PHASE`, and retained
as a registration failure; a fresh offline restore cannot expose custody over
that failed blank.

The same registration-failure check governs fresh anonymous establishment and
every other first exposure. No bootstrap/adoption path may expose while a
registered participant retains a synchronous blank/clear failure. An owned
read or terminal-marker write returns only deferred terminal metadata; the
coordinator latches exhaustion, invokes participants, publishes the wakeup,
and waits for the terminal cut only after the storage owner has released.
Terminal and eager-wakeup cuts install their completion before invoking the
exact participant snapshot, synchronously blank once, await best-effort
quiescence, then blank and clear that same snapshot again. Unregistration joins
all active barrier and destructive-cut completions before removal.

An `exhausted` wakeup is additionally an immediate local terminal cut: the
receiver pauses publication and runs best-effort quiesce/blank/clear phases
before any asynchronous durable reload. The reload remains authoritative and
converges missed wakeups; the eager cut exists so an already-rendered peer does
not retain predecessor materialization while ownership is pending. Its cut
generation remains an exposure veto until the final blank completes. If it
overlaps owner/peer resume, the barrier discards staged publication, repeats
the participant phases erased by the cut, and reconfirms durable custody before
reopening.

The transition owner does not wait for acknowledgements from unknown, crashed,
or suspended contexts. The durable clearing epoch makes every predecessor
compare/expected-epoch write stale immediately. An active peer receiving the
broadcast runs its own local quiesce/blank barrier; a peer that missed it or was
suspended runs that barrier on its mandatory lifecycle/publication check before
its first resumed exposure. This is fail-closed commit/exposure fencing, not a
claim of globally simultaneous DOM blanking.

The coordinator installs the local barrier's terminal completion before it
publishes `clearing`. A `synchronize()` begun outside a participant callback
that observes that same active local clearing barrier MUST await this completion
and then start one fresh durable synchronization; it MUST NOT return a prompt
`SNAPBACK_CLIENT_AUTHORITY_CLEARING` refusal that client machinery can answer
with an unbounded promise-microtask retry. The completion resolves only after
successful post-resume confirmation/exposure or after the barrier's failure cut
has finished, and is therefore a progress and settlement fence rather than a
wakeup hint. A `synchronize()` invoked from an executing participant callback
MUST NOT join that completion: it acquires custody after the clearing owner has
released it and receives the prompt exact-clearing/stale refusal, because an
awaited `quiesce` may depend on that result and the barrier completion depends
on `quiesce`.

Resume runs after cross-context ownership is released but while the owner's
local exposure barrier remains closed. A resume participant may therefore run
a handshake or durable-authority check. Every `synchronize()` during owner or
peer resume re-acquires custody only to compare the exact settled revision,
epoch, and authority already owned by that active local barrier. An exact match
returns the capture without recursively starting a peer-adoption barrier. Any
different durable record aborts the current resume as stale; it cannot replace
the active barrier, replay resume, or be adopted until a later clean
synchronization starts with no barrier active. The failed barrier remains
blank/paused and never returns its obsolete capture.
A synchronization begun before the barrier but completing after settle follows
the same rule: an exact record is confirmation only, while a mismatch fails
stale; neither completion may replace the now-active barrier.
The ownership read that first discovers a result is provisional. After that
result is delivered outside ownership, the coordinator reacquires ownership
only long enough to compare the exact settled revision, epoch, and authority.
Peer adoption performs this confirmation before participant work and repeats
it after resume before unpausing. An owner transition likewise confirms after
durable settle and again after resume before unpausing. Participant quiesce,
durable clearing, and resume never run while this confirmation ownership is
held. The last successful locked read is the return/exposure linearization
point. Resume participants may prepare app-visible effects outside ownership,
but they enqueue each effect with its exact successor capture. The coordinator
flushes those synchronous, non-reentrant callbacks in enqueue order while the
final locked confirmation and publication fence still hold, before unpausing
the gate. A mismatch, clearing/null record, failed read, or failed callback
discards every callback not yet run and leaves the local gate paused and
fail-closed; participant state is reblanked after a callback failure. The
changed record may be adopted only by a later clean synchronization. The same
rule applies whether delivery occurs during the barrier, after it has
completed, or after a same-authority revision rotation.

Final confirmation also closes the participant set under the ownership fence.
Immediately before staged publication/exposure, every nonremoved participant
must have completed quiesce, blank, clearMemory, commitDurable, and (for online
adoption) resume for that exact barrier. A participant that registered after a
prior loop observed no remaining work causes an internal retry: ownership is
released, missing phases run, and the exact durable row is reconfirmed. Offline
peer adoption applies the same rule without resume. A requested successor that
a peer already settled is a no-op only when the local record is already that
exact successor; a missed-wakeup predecessor runs the full peer barrier.

Any barrier failure retains its completion and exact participant snapshot
until an isolation-safe quiesce/final blank/clear cut runs after ownership is
released. The original transition diagnostic remains primary. Closing a
coordinator is an exposure veto: `isCurrent` becomes false, dynamic resume
selection stops before invoking another participant, final phase closure runs
before staged callbacks, and each staged callback rechecks closure before the
next callback. Participant registration during a staged commit is rejected as
`SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT`.

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
these ordered phases across two short exclusive cross-context ownership
sections. The first reloads and compares E, then CASes the exact predecessor to
`clearing`. That durable record carries the transition id, expected/successor
authority keys, next epoch, and clearing revision; it is the fence while
ownership is released for all local participant work in phases 4--7. The
coordinator then reacquires ownership and may CAS to `settled` only if that
exact clearing intent remains current. An exact already-settled record carrying
the same transition id is idempotent peer completion; any other record is
stale. Its awaited participant set is the owner's local registered set, not
every tab. Neither Web Locks nor the fallback lease is retained while awaiting
participants. Loss of either short ownership section aborts that section, and
the durable clearing intent permits a successor to recover:

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
8. Reacquire exclusive ownership, reload the exact clearing transition id,
   epoch, and revision, then durable-CAS custody to `settled` at the same next
   epoch, move pending authority/bearer into current fields, clear pending
   fields, and increment revision. A peer's exact completion is accepted
   idempotently; any different intent or authority fails stale.
9. Broadcast `settled`, reload the owner context's settled record, call local
   `resume`, obtain a fresh LLP 0058 handshake and connection grant, then
   resubscribe only permitted surfaces. Receiving/resuming peer contexts reload
   independently. A context's exposure resumes only after its own mandatory
   participants report readiness.

Every identity-bearing epoch, revision, socket generation, request generation,
and barrier generation is a checked safe integer. Exhaustion first closes local
publication and transport gates, then records a permanent fault; it never
wraps, retains a predecessor cache, or resumes under a reused identity. A peer
that encounters an exhausted durable revision reaches the same blank,
fail-closed state through the ownership protocol.

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

The final locked publication callback rechecks this per-registration phase set
even when the ordinary resume/commit loop already observed no work. That fence
turns a late registration into catch-up and reconfirmation, never successor
exposure over an entry that received only registration-time blank/clear.

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
`establishAnonymous` is creation-only: it succeeds only when the locked durable
read is null and never adopts or recovers an existing settled/clearing record.
An existing local record or active barrier refuses bootstrap without changing
the paused gate. The coordinated kit treats only `synchronize() === null` as a
fresh-custody witness. A non-null exact capture returned by `synchronize()`
during resume is still paused and therefore cannot be relabeled as missing
custody, start anonymous bootstrap, issue a normal handshake, or publish/cache
through ordinary `compareAndCommit`.

Every successful fresh coordinated handshake path — initial anonymous
establishment, same-authority refresh, authority transition, and participant
resume — performs an exact durable custody fence immediately before placing the
response in the cache or returning it. Outside a barrier this is
`compareAndCommit`. During owner/peer resume it is an exact-capture staged cache
write flushed only by the coordinator's final locked confirmation. An in-memory
`isCurrent` hint or a missed or delayed broadcast cannot substitute for this
final durable comparison; a stale response is discarded and may be retried once
against the adopted successor.

## Durable client store protocol

### Format 3 and authority tags

Format 3 is the historical item-5 predecessor pinned by this Spec. At that
landing boundary, `packages/snapback-contract/client-store.mjs` advanced from
format 2 to format 3. Its existing top-level `generation` remained the
monotonic store-write revision; it MUST NOT be repurposed as auth authority.
The store added a distinct `authorityEpoch` matching settled custody.

The current composed production store is format 6, owned by
[LLP 0043#auth-posture](./0043-offline-replay-retention.rfc.md#auth-posture).
It preserves this section's epoch/key barrier semantics while composing item
6's query/queue fences, item 7's principal/authority-descriptor axes, and item
8's `queryAuthorization` and signed-lease custody. Format 5 remains the
historical composed predecessor. The current migrator recognizes formats 1
through 5: it accepts only the exact identifiable v1-v4 predecessor shapes,
then treats every validated v5 record as deletion-only before producing v6. It
never retags an earlier format as current authority.

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

The localStorage adapter adopts governing LLP 0008's landed one-key
load/modify/save protocol under the canonical per-storage-key Web Lock. It performs no
read-then-`setItem` CAS outside that lock and keeps no independently mutable
current pointer. Each operation reloads the one record under ownership and
compares its expected authority epoch/key before replacement. A delayed
predecessor writer that resumes after a successor therefore waits for the Web
Lock, reloads the successor, and fails the expected-authority comparison without
writing or exposing predecessor bytes.

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
shapes, and historically produced format 5. Partial, hybrid, extended, or otherwise
ambiguous format-4 state supplies no authority proof and is quarantined or
deleted fail closed. Format 6 requires `terminallyUnbound`; every validated
format-5 predecessor is privacy-cleared, queue-invalidated, and left marked
unbound because a missing bit cannot prove that an old writer did not erase a
terminal cut. Older clients reject format 6 rather than downgrading or
rewriting it, and all contexts sharing one client-store key require coordinated
drain during rollout.

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
  commitTerminalDurable?(ctx: BarrierContext): Promise<void>
  resume(ctx: SettledBarrierContext): Promise<void>
}

interface SettledBarrierContext extends BarrierContext {
  capture: AuthorityCaptureV1
  authority: ClientAuthorityV1
  stagePublication<T>(
    capture: AuthorityCaptureV1,
    commit: (current: SettledCustodyView) => T,
  ): void
}
```

`blank` and `clearMemory` are synchronous and cannot call app code.
`commitDurable` must use the exact expected/next epoch supplied by the
coordinator. Its physical-store transition receives an explicit terminal bit
derived from `nextAuthority === null`; a null browser principal scope alone is
not terminal because ordinary Agent/service-principal successors also have no
browser principal scope. Thus exact-current terminal replay verifies or
reapplies deletion, while exact-current nonterminal Agent successor replay is
idempotent and preserves successor bytes.

Every terminal Agent barrier prefers `commitTerminalDurable` with B's exact key
over the ordinary epoch-transition callback. A durable store purges B at any
local epoch, including when the custody store was reset while the client store
survived. If shared primary custody belongs to distinct A, the coordinator also
preserves A byte-for-byte. The exact-key purge leaves a local A store untouched
and unbinds B so old queue captures cannot enqueue after deletion. Format 6
persists this state as `terminallyUnbound: true`; a direct bind cannot consume
the marker. If a terminal callback wins while an initially empty store is
between authority boot and direct bind, Contract may adopt the exact still-
current same-epoch capture only by comparing the store generation observed with
the marker. If durable custody later proves a one-epoch active successor from a
deleted record, the ordinary callback may likewise bind a fully privacy-clean,
fully unbound store to that proven successor. Neither exception applies to a
dirty or partially bound store, and the successor case MUST still use exactly
`expectedEpoch + 1`.

The store write generation reserves `Number.MAX_SAFE_INTEGER` for the final
terminal deletion identity: ordinary commits refuse before consuming it. A
bound record already at that ceiling (possible from a pre-reservation writer)
is authority- and queue-stale for every public data read/act. Terminal purge
may overwrite that final identity only with a fully privacy-clean,
`terminallyUnbound` record; repeated purge of the clean marker is write-free.
No transition may consume a final-generation marker—recovery requires explicit
replacement of the physical client store.

The terminal invocation snapshots its mandatory participants before any
synchronous cut. Scheduled/fresh deletion attempts every snapshotted exact-key
purge after the witness attempt even when witness I/O or primary counter
planning fails. If replay of an interrupted nonterminal clearing intent can
rebind B, both its success and error paths repeat the exact terminal purge
before final settlement. One failing terminal participant does not prevent
later snapshotted participants from attempting their purges; settlement
preserves the first failure. This preserves re-grant availability without
reviving any capture for the terminal tuple.
`resume` receives no bearer directly; it asks coordinator custody
through a narrow request/grant API. It may perform network and other preparatory
work while ownership is released, but any resulting cache, callback, observer,
or boundary effect MUST be submitted through `stagePublication` with the exact
resume capture. Staged callbacks are synchronous and non-reentrant, use the
same callback restrictions as `compareAndCommit`, and execute only at the final
locked confirmation. A participant MUST NOT publish directly during resume.
Awaited `commitDurable`, `commitTerminalDurable`, and `resume` callbacks MUST
NOT call `synchronize()`. No awaited participant callback, including
`quiesce`, may await its own unregistration. Any participant callback may
request its own unregistration without awaiting it; removal remains deferred
behind the active barrier. The coordinator fence rejects a self-join promptly with
`SNAPBACK_AUTH_CUSTODY_PARTICIPANT_REENTRANT`; it never leaves a silently
self-dependent barrier Promise. Synchronous `blank`/`clearMemory` callbacks
may likewise request unregistration; settlement selection is deferred until
the transition publishes its terminal handle, and that unregistration cannot
resolve before every callback already snapshotted for the participant has
finished or failed. After any unregistration resolves, no future participant
callback may begin. A participant registered while durable Agent
custody is initially closed is synchronously quiesced, blanked, and
memory-cleared before any recovery decision, including terminal-only recovery.
An awaited `quiesce` may nevertheless depend on already-running request or
listener settlement whose own custody gate reaches `synchronize()`. Because
the clearing CAS has released ownership, that gate acquires in queue order and
receives a prompt clearing/stale result; it cannot recursively replace the
same coordinator's active barrier or leave the participant waiting on the
owner that is waiting on it. This prompt result is restricted to synchronization
invoked while a participant callback is executing; external publication
listeners use the terminal-completion join in §Cross-context ownership.

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

Contract participant resume generations, ephemeral socket-loss epochs, and
swappable ephemeral-wiring generations are safe nonnegative integers allocated
through one checked client allocator. The last exact identity may be consumed
once; a request for a successor after `Number.MAX_SAFE_INTEGER` produces
`SNAPBACK_CONTRACT_LIFECYCLE_GENERATION_EXHAUSTED` with the owning axis. The
affected surface synchronously publishes its non-sensitive blank, detaches
predecessor callbacks and transport demand, permanently refuses resume or
replacement, and settles any pending resume timer so the surrounding barrier
can finish. A callback whose captured value equals the terminal numeric value
is still refused by the permanent terminal gate. Disposal is idempotent and
uses that gate rather than allocating another generation. A terminal
socket-loss record dispatches its exact room unsubscribe before releasing
socket demand and repeats the unsubscribe after any already-in-flight
subscribe resolves, so the late registration is consumed rather than leaked.

Exact/Contract host callbacks, mutation completion, retained write chains,
optimistic settle/rollback, subscription result/error, ephemeral acknowledgement,
and reconnect completion each carry the capture from their initiating work.
Before changing boundary or durable state they call coordinator
`compareAndCommit`. A delayed completion under A may free its private temporary
buffer, but it cannot alter B, reapply A's optimistic layer, clear B's error,
or publish an A result.

Before invoking app-data transport, both the single-query and multi-live
Contract adapters run the mandatory durable synchronization and exact capture
comparison. Query, live-query, ephemeral subscribe/publish, standalone
mutation acknowledgement, first-send mutation, and queued replay dispatches
place that check after the last awaited local-store operation and immediately
before calling a generic client. The single-query mutation adapter additionally
performs the gate before optimistic publication. Thus a peer transition during
pending-ACK loading or queue CAS cannot reach generic transport under the
predecessor capture. The production Snapback transport retains the stronger
rule below and repeats the comparison around the actual request start.

The transport begins each finite request inside the final exact custody
comparison rather than checking and releasing custody before network start.
Response parsing and publication repeat the capture fence. Terminal browser
handling may pre-cut transport phases synchronously, but records completion per
exact predecessor capture and phase; the coordinator barrier skips only those
already-completed transport phases, while every other participant and every
failed phase still runs or retries normally.

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
deploymentIdentity: DeploymentIdentity | null
```

The response's session projection, deployment identity, and incarnation are
captured from one counted prepared authority and retained through the final
body sink. Sessions mode requires non-null deployment identity and the client
checks its app id before custody changes. A sessions-mode success without the
field, an invalid UUID,
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
only when their named implementation and typed production-construction
receipts are installed:

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
  prerequisite; composed production satisfies it through LLP 0043's format 6,
  which preserves the item-5 epoch/key barrier, migrates formats 1 through 4
  through their closed historical rules, and migrates format 5 deletion-only.

These receipts are opaque Rust construction plans, not route-name or
source-substring probes. The connection plan owns the exact typed route
registrations from the same registration edge as `app()` and is consumed to
construct the production `SnapbackApp`. The two-phase plan is bound to the
inspected runtime's provider and is consumed to spawn the process-critical
expiry worker. The coordinator plan is bound to that same provider, includes
the canonical client custody module in the production distribution, and is
used for the actual durable projection rebuild. Provider-identity mismatch,
coordinator rebuild failure, or expiry-worker start failure aborts before the
listener. Browser protocol 1 is offered only through the real coordinator with
the mandatory kit transport participant, and Contract/client stores register
their barrier participants when those surfaces are constructed. The server
does not claim that a native construction plan proves a browser instance is
alive.

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
   stale deadline entries with a fake dual clock. Pause a pass after it samples
   the first of two sessions but before its storage-floor write, advance both
   clocks until the second is due, then prove only the exact sampled first set
   terminalizes and a rollback-clock restart keeps the second live.
7. Corrupt each index source independently: duplicate current token, dangling
   identity, invalid generation/timestamp, malformed incarnation, and
   contradictory reset marker. Startup refuses before listener bind with the
   correct stable code and performs no repair.
8. Hold the affected authorization commit at a failpoint. An unrelated L9
   protected room registers, publishes, and drains over both HTTP and WebSocket
   without waiting for the affected transaction or projection ticket.
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
   predecessor HTTP batch unpolled, then pressure-evict or
   authority-mismatch-retire it. The old body emits no bytes, mint-only
   containment prevents same-id adoption, and whole-id activity, rate, owned
   outbox, room, and Local topology state disappear. Separately force exact
   stale cleanup while a real same-readable-id successor's initial drain parks;
   the successor is awakened without a heartbeat and preserved
   unbound/global recovery work drains exactly once. For maintenance bulk
   retirement, block the first cleanup on Local, abort the worker, and prove all
   later captures were already transferred into independently owned tasks.
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
7. Expiry/revocation/reset produces at most one notifier-generation-matched
   `auth_error`, stops ordinary drain/reconnect, and installs a close deadline
   equal to the sampled monotonic instant plus the exact 5000-ms protocol
   grace. Structural deadline assertions prove the ordering; a bounded real
   transport test is only the liveness smoke proving close still occurs when
   the writer handoff/socket cannot accept the frame. Old-socket teardown
   cannot close or unregister a replacement. A pending ticket that rolls back
   produces no terminal frame or close. Hold an active exact outbox lease at
   terminal retirement: the registry installs the typed event and performs the
   terminal wake before grant removal; the following lease release produces no
   extra wake, and the socket observes that event even after the mint-only
   whole-id cleanup and post-Local sweep. Also inject an unrelated pre-event
   notifier wake while terminal retirement owns the registry and prove the
   socket's failed exact act converges on the already-installed typed event.
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
3. Kill a per-storage-key Web-Lock owner before the clearing CAS, during the
   short clearing-to-settled reacquisition, and during final confirmation;
   pause after clearing at every participant boundary and prove no owner is
   retained there. A successor owner reloads the durable phase, resumes
   idempotently, and never exposes partial data.
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
10. During both owner and peer resume, ordinary `compareAndCommit` refuses
    without running its callback. Exact-capture staged callbacks run in enqueue
    order only during the final locked confirmation. Advance or clear the
    durable record, fail that read, and throw or reenter from a staged callback;
    mismatched/unconfirmed work never runs, later queued work is discarded, and
    the local gate remains blank. The real kit transport handshake cache uses
    this staging path rather than publishing from resume.
11. In `demos/_kit/tests/auth-coordinator-client.mjs`, compose the production
    `SnapbackClient` and `AuthCoordinator` over controllable custody/fetch seams.
    Hold owner and peer resume before final confirmation, then invoke a
    concurrent ordinary `authSession`: it recognizes the paused exact capture,
    performs no bootstrap/handshake/cache publication, and cannot enable a
    `compareAndCommit` callback. On success, only the staged transport handshake
    becomes cached after final confirmation. After the real transport stages
    its handshake, independently advance custody and fail the final locked
    `owner.read` in **both owner and peer modes**. The read-failure storage seam
    wraps the owner passed to the production ownership callback; its read-count
    and resume-phase witnesses prove initial/preconfirmation reads completed,
    the transport participant returned after staging, and the very next read in
    `#confirmDurableExact` threw. Each in-flight ordinary session returns stale,
    capture remains clearing, staged cache work is discarded, and only a later
    clean `synchronize()` may fetch/cache the durable successor; the following
    ordinary `authSession` performs no additional handshake.
12. Pause tab A after failed resume and after a durable `clearing` write. A
    different-incarnation anonymous handshake recovers through every standard
    barrier phase, while non-anonymous and same-incarnation witnesses refuse.
    Race a fresh tab-B sign-in ahead of A's recovery CAS: A returns stale
    without invoking blank or replacing B. Repeat from a format-3 sender shell
    and require settled anonymous format 2 with no bearer or sender key.

The landed coordinator suites now prove ordered participant phases,
clearing-state recovery, delayed/missed wakeups, stale-owner rejection, and two
consecutive fallback takeovers whose fencing tokens advance exact predecessor
plus one. The Web-Lock harness covers owner loss at the clearing write and
later owned reacquisitions; the queued-lock participant regression proves that
`quiesce`, `blank`, `clearMemory`, `commitDurable`, and `resume` run with no
owner retained, including a quiesce acknowledgment whose work requests
`synchronize()`. A second socket-free queued-lock regression reacts to every
clearing/settled publication with client-style synchronization, retries typed
`CLEARING` in a microtask, and bounds the attempt count; it fails against the
prompt external refusal and terminates when the observer joins barrier
settlement. Every successor begins blank, reloads durable custody, reruns
its complete local barrier, and exposes only settled successor authority. The
broadcast harness delays delivery until durable settlement and
exercises drop-all, either single phase, both phase orders, and every unique
permutation of duplicate clearing/settled messages. These are readiness-gating
tests, not claims inferred from the underlying reload mechanism.
The composed Contract test also mounts single- and multi-live surfaces on one
coordinator and proves that a durable-authority reload started by successor
resume does not recursively replay that barrier or starve its completion. The
real single- and multi-live participants await `coordinator.synchronize()`
while the exposure barrier is still closed; the coordinator suite separately
advances durable custody during both owner and peer resume and proves the stale
barrier runs resume once, returns no obsolete capture, stays blank, and adopts
the actual successor only in a later clean synchronization. Those resume-race
tests do not ask the participant to call `synchronize()` after advancing the
peer: the coordinator's own post-resume confirmation detects the change. The
same suite delays ownership-result delivery with broadcasts disabled and proves
both direct A-to-B and peer-adoption B-to-C advances fail stale and remain
blank. It also covers failed-clearing peer recovery followed by synchronization
in the original context, null-to-established custody, a failed final durable
read, a same-authority revision advance, and a same-authority write during
resume that cannot reopen exposure. These cuts distinguish the final locked
confirmation from the earlier local-record delivery fences. The FINAL3 closure
also proves successful owner/peer staged ordering, discard on changed custody
and failed final confirmation, callback failure/non-reentrancy cleanup, and the
real kit resume-handshake cache path. Raw and managed live-stream suites inject
a close-only `4401/auth_error`, assert the terminal latch and exact
`compareAndClear`, and prove that neither path constructs a reconnect socket.
FINAL4 adds real-kit concurrent `authSession` cuts for owner and peer success,
owner mismatch, and peer final-read failure, plus direct creation-only
bootstrap regressions; these prove a paused exact result is never confused with
genuinely absent custody.
FINAL6 completes the same production-client matrix in
`demos/_kit/tests/auth-coordinator-client.mjs` with peer mismatch and owner
final-read failure. Both final-read cuts wrap the acquired owner and arm only
after the reverse-ordered production transport participant has staged its
handshake cache; read-count/phase witnesses pin the injected exception to the
next production final `owner.read`, not ownership acquisition. Together the six
composed cuts cover owner/peer paused success, owner/peer post-staging mismatch,
and owner/peer failed final ownership reads, with explicit stale in-flight
results, blank capture, repeated clean handshake after discard, and cache-only
return after clean synchronization.

### Client store and Contract boundaries

1. At the historical item-5 boundary, migrate representative and adversarial
   format-2 stores without retagging any privacy record as a format-3 successor.
   In the composed production suite, migrate formats 1 through 4 through LLP
   0043's historical format-5 rules, distinguish the two exact format-4
   predecessor shapes, and quarantine or delete ambiguous format-4 state fail
   closed. Then migrate validated format 5 deletion-only into format 6 and
   require older readers to reject format 6.
2. For every store operation, race transition between expected-epoch read and
   commit. CAS rejects the stale mutation and reads suppress mismatched tags.
   Repeat for a delayed LLP 0008 one-key writer released after the successor.
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
6. On the LLP 0008 localStorage adapter, release an old writer after successor
   custody settles. Web-Lock serialization forces a reload and the stale
   expected-authority comparison rejects without changing the one stored key.
7. The item-5 producer matrix emits `delete` for every session-authority loss
   and never emits `retain` or `quarantine`; unsupported injected values fail
   rather than bypassing the barrier.
8. Seed single- and multi-surface resume, ephemeral socket-loss, and swappable
   wiring generations at the final exact values. Retain predecessor timer,
   subscribe, and source callbacks across exhaustion; each surface blanks,
   pending barrier work settles, delayed callbacks cannot publish even at
   equal numeric generations, and repeated disposal performs no allocation.

### Handshake and activation

1. The bootstrap response contains a canonical durable incarnation captured
   with its authority. Missing, malformed, stale, or cross-app values fail
   before a grant or callback can become visible.
2. The complete item-1-through-item-5 readiness matrix is generated and tested.
   Each omitted typed construction receipt keeps its owning fact false and
   therefore keeps `sessionActivationReady` false; negative startup tests omit
   connection binding, two-phase revocation, and coordinator receipts one at a
   time and prove sessions remains quarantined before bind. Coordinator rebuild
   or expiry-worker construction failure separately aborts production startup.
   No override can force readiness true.
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
   participants; composed production now uses LLP 0043's format 6, which
   preserves these barriers, carries the mandatory terminal marker, migrates
   formats 1 through 4 through their closed historical rules, and migrates
   format 5 deletion-only;
5. revised the closed handshake DTO, derived activation facts from opaque typed
   plans issued by the actual connection, two-phase runtime, and canonical
   coordinator construction edges, consumed those same plans to construct the
   app, rebuild the coordinator, and spawn the worker before acquiring a socket,
   and ran the interleaving and activation matrix; coordinator and worker
   construction-failure tests prove the selected port remains unbound; and
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

This document is **Accepted**. ENG-25001 closed the material review findings,
the corrected FINAL7 Codex review and FINAL5 Fable review returned READY, and
Charlie Cheever explicitly ratified the resulting Spec on 2026-07-15.
Acceptance does not unfreeze LLP 0039 or LLP 0053.

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
overclaim (both families) and localStorage conflict with governing LLP 0008
(GPT #10) were accurately recorded as implementation defects at that revision;
ENG-25001 subsequently landed rank guards and selected LLP 0008's landed
one-key design under a per-storage-key Web Lock; the
grant-mint "indistinguishable" acceptance sentence (both) — scoped to grant
minting so it no longer flattens LLP 0057's `AUTH_REQUIRED` vs `SESSION_EXPIRED`
distinction; and the durable-time terminal irreversibility (GPT #1) — cross-
referenced to the LLP 0057 declared-restore clock-floor fix, with "durably
advance a shared frontier to the authoritative deadline before publishing a
time-derived terminal event" named as an obligation.

**Resolved defect obligations (ENG-25001):** protocol 1 now requires the
canonical coordinator; custody format 2 carries durable predecessor/successor
intent and peers run the physical-store commit; phase 8 and credential refresh
release ownership before network work; both live APIs latch terminal state on
an `auth_error` frame or `4401/auth_error` close; the handshake carries
canonical deployment/app
identity and UUIDv7 boundaries; stable pending handshakes retain one counted
prepared authority through final publication and every fresh coordinated
handshake cache/return uses durable compare-and-commit; readiness uses typed
construction plans consumed by the fallible pre-bind runtime gates; projection
locks carry dev/test rank assertions; the L9 fixture proves unrelated
publication during a stalled affected commit; and this Spec adopts LLP 0008's
per-storage-key Web-Lock one-key localStorage protocol.

The reviews advised and the author ratified after their material findings were
closed. This document is Accepted; neither LLP 0039 nor LLP 0053 is unfrozen.

## Dated amendment: versioned seed reset reuse (2026-07-27)

LLP 0109 reset-install and clear are callers of this Spec's existing single
reset coordinator, not alternate reset implementations. Their protected
identity/operation writes occur in the same SQLite transaction as deletion and
data-stream rotation. They retain the stream ticket, blocked admission,
successor projection/issuer publication, commit-uncertainty reconciliation,
and release/response ordering defined here. A postcommit failure therefore
reconciles the committed successor and never reruns seed row effects.

## Dated amendment: versioned seed reset idempotency and predecessor binding (2026-08-03, LLP 0109 acceptance)

Supplementing the 2026-07-27 amendment above with the accepted first
landing's idempotency contract (LLP 0109 §15.4/§16; author acceptance
2026-08-03, decision sitting #2 extension,
`issues/20260803-author-decision-sitting-2.md`): every versioned reset
carrier binds a caller-minted canonical UUIDv7 `operationId`, a
domain-separated JCS request digest over the complete closed body, and the
tagged `expectedDataVersionStream` (`absent`, or `present` with the exact
predecessor stream), so a stale-predecessor request refuses before this
Spec's coordinator closes any lane — and a deployed predecessor binary
cannot execute the effect while discarding the versioned body, because it
does not know the carrier names at all. Completed effectful operations are
journaled in `_snapback_seed_operations_v1` inside the same single reset
SQLite transaction this Spec owns; there is no separate seed journal or
publication phase, and recovery has only `not committed` and `committed`.
Replay observes current state before historical completion: an identical
retry returns the stored receipt only after the stored successor stream
matches the current stream and the active installation matches the stored
receipt; a differing stream refuses `SNAPBACK_SEED_OPERATION_HISTORICAL`, a
reused id with different bytes refuses
`SNAPBACK_SEED_OPERATION_ID_REUSED`, and effects are never rerun. A
`matched` ensure is a pure observation and journals nothing.

## Dated amendment: unrecognized session custody recovery (2026-08-12)

A browser that retains bearer custody across a local database wipe no longer
requires app-owned `indexedDB.deleteDatabase(...)` surgery. A terminal
`carrier` refusal triggers at most one bearerless session probe. When that
probe returns a valid settled anonymous authority at a different stream
incarnation, a healthy coordinator uses its ordinary captured transition and a
failed-closed/stuck-clearing coordinator uses
`recoverUnrecognizedAuthority`; both paths run the standard barrier and target
the observed incarnation directly. Cold boot, warm forced handshake,
request-code, logout, health, same-incarnation refusal, peer-wins CAS, and v3
shell downgrade are executable regressions.

The predicate deliberately does not recover unsupported partial destruction
that removes session rows while preserving `auth_stream_incarnation_v1`, nor an
undeclared external database copy whose continuity is unspecified. Proper app
reset, logical import, and non-idempotent `snapback auth restore` rotate the
incarnation; ordinary restart and an idempotent replay of the same declared
restore preserve it. A preserving session-loss path must use its typed terminal
disposition or operator repair rather than weakening the incarnation witness.
