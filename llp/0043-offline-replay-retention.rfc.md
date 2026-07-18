# LLP 0043: Offline replay and retention

**Type:** RFC
**Status:** Draft
**Systems:** Sync, Storage, Client integration, Auth, API, Realtime, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-07-17 (new server settlements carry nullable authoritative version metadata so a legitimate fresh-database version zero is distinguishable from the predecessor migration sentinel; legacy rows remain readable without fabricated backfill provenance). 2026-07-16 (format-6 terminal anti-rebind boundary: `terminallyUnbound` is mandatory, format 5 migrates deletion-only, only an exact coordinator/store-generation CAS may consume a non-final marker, and the final safe write generation is reserved for terminal deletion). 2026-07-14 (ENG-24992: the Milestone 1 fail-closed list no longer implies client-side cryptographic MAC verification — client custody detects structural/binding/hash/expiry/rollback defects while `key_id`/`mac` are authenticated only by the server keyring, per LLP 0053 §The lease's dated verification-locus amendment; executable one-bit MAC tamper and unknown-key vectors pin both sides). 2026-07-14 (ENG-24606 reconciliation: item 8 now populates the format-5 `queryAuthorization` namespace with never-reused query-instance identities, authorization witnesses, independent pending-scope fences, signed lease custody, and equality-expiry deletion; the earlier ENG-24605 empty reservation remains the historical pre-item-8 checkpoint). 2026-07-13 (ENG-24605 composition: server-issued authority descriptors bind queued work independently from principal-owned retained rows; composed store format 5 resolves item 6/item 7's independent format-4 allocation, migrates both predecessor shapes fail-closed, preserves rows across a same-principal new session while stranding its queue, and reserves but does not implement `queryAuthorization`). 2026-07-12 (ENG-24571: standalone authenticated ACK delivery, auth-tagged client ACK retention, receipt-proven acknowledgement, collision-resistant auth fingerprints with collision-safe v1/FNV quarantine on both client and server, transactionally maintained global/per-auth counters, and an admin-gated recovery purge); 2026-07-12 (ENG-24571: durable mutation settlement is acknowledgement-driven and auth-bound, with hard result/aggregate/count refusal limits and gated retention metrics; no time-based eviction can break exactly-once replay); 2026-07-12 (ENG-24376: retained writes are ordered and compare-and-set by opaque stream/version, while app/database/target/reset-stream identity is persisted and invalidates incompatible rows). 2026-07-09 (ENG-23965 ships the first closed-IR single-query M1/M2
slice: retained auth/artifact-scoped rows, durable monotonic outbox, atomic
client mutation settlement, full-resync-before-replay, and replay tests; broader
conflict/delta-resume work remains as scoped below. Earlier: cross-family review
revisions, ratified by Charlie — see
`reviews/0043-offline-replay-retention.claude.md`: claim language aligned with
LLP 0012's parity rule, client-side replay restored per 0008, DK-9 cited
instead of re-enumerated, suppression/conflict machinery restated; initial
same day)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0008, LLP 0010, LLP 0011, LLP 0012, LLP 0034, LLP 0038, LLP 0039, LLP 0053, LLP 0059

## Summary

This RFC defines the first offline slice for Snapback. It narrows the broad
local-first design in [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)
into two product milestones, plus a named third that stays out of scope:

1. retained authorized query results while offline — the client-side
   realization of LLP 0012's **offline-retained** query class;
2. queued mutation replay when the client reconnects;
3. (later, explicitly out of scope here, mirroring 0008's own pin)
   delta-resume with pending offline mutations.

A note on claims, because LLP 0012 pins the rule: **no local execution means no
local-first/parity claim**. This RFC excludes arbitrary JS handler execution;
LLP 0051 subsequently supplies local execution for the closed IR tier. The
shipped composition may therefore report `Parity` only for a store-configured
surface whose complete mutation set is locally IR-derivable. Retention or queue
support alone, and every mixed/no-store/multi-query/system surface, remains
`Online`.

Terminology: "retention" in this document means the **client's** retained
store. LLP 0008 §Retention and Resume is about the *server's* change journal;
this RFC's reconnect path consumes that machinery but does not redefine it.

## Motivation

Snapback's current realtime model is online-class: clients subscribe, receive an
authoritative snapshot, and get live updates while connected. That is valuable
but not local-first.

Offline support also tests auth, sync, conflict, and client-store boundaries in
one place. It is the feature that forces Snapback to prove that optimistic
client behavior and authoritative server replay agree.

## Design

### Client store: DK-9, not a new decision

The store contract is already decided — 0008 DK-9 (ratified 2026-07-02) pins a
store-agnostic client-store interface with **SQLite as the reference
implementation** (expo-sqlite / wa-sqlite); web targets may instead sit on
IndexedDB/OPFS; tests use an in-memory deterministic store. This RFC binds to
DK-9's stored contract rather than re-enumerating it:

- retained authorized result rows per query identity and args;
- opaque `(stream, version)` cursors (LLP 0007's shape — never bare version
  numbers);
- two independent auth axes: a server-proven principal scope owns retained
  rows, while a server-issued opaque authority-instance descriptor owns queued
  mutations ([LLP 0039](./0039-auth-vertical-slice.rfc.md));
- target profile/capability facts and the schema/artifact hash the results
  were generated against;
- the pending-mutation queue, ordered by a client-local monotonic sequence
  number (0008: ordering uses the sequence, **never a wall clock**);
- diagnostics and stale/resync flags.

### Milestone 1: retained reads

When offline, a subscribed query may return retained rows immediately if:

- the query is in the installed LLP 0053 protected profile and is explicitly
  proved retainable; syncability or a matching principal alone is insufficient;
- the current query instance, principal, authorization pair, issuer, activation
  hash, version stream, accepted snapshot version, and optional authority
  descriptor exactly match the stored composite witness;
- the store holds the complete server-MACed `AuthorizedLease`, its request
  reservation, and a valid derived client deadline. The configured duration is
  at most the 24-hour hard maximum and is clamped by session/provider expiry;
- the serialized client clock has not moved behind its durable high-water and
  current time is strictly before the derived deadline. Equality is expiry and
  commits the query-instance delete tombstone before read or render; and
- the stored `(stream, version)` cursor and target capability facts are valid,
  with no pending query-authorization fence that blocks release.

A missing, malformed, expired, wrong-principal, wrong-query-instance,
wrong-witness, wrong-target, wrong-activation, rollback-tainted, or
hash-mismatched lease deletes the current query instance before exposure.
(Amended 2026-07-14, ENG-24992: that client-side list covers exactly what an
offline client can verify — the closed envelope structure and canonical MAC
form, binding equality, clamps and duration, expiry/rollback, and the stored
unkeyed lease hash that pins the exact issued bytes against post-commit
corruption or substitution. Cryptographic `mac`/`key_id` verification belongs
to the server keyring, which fails closed on unknown keys and refuses a
single flipped MAC bit whenever a lease is presented for revalidation-free
service; a canonically shaped forged MAC passes client custody by design and
buys the holder nothing beyond bytes already on its disk — see LLP 0053 §The
lease, "Verification locus".) Heartbeat, delta,
session refresh, reconnect, mutation success, and ACK never renew it. Only a
fresh full authorization revalidation and snapshot may renew, after the server
atomically proves the captured data head, authorization pair, activation hash,
and absence of a pending obligation still match.

The UI must know the result is retained/stale. Reconnect always asks the server
for a fresh authoritative snapshot or resume path before clearing stale state.
The resume path consumes the retention-floor primitives that already landed on
the server (`resume_requires_resnapshot(from_version)`, the monotonic pruned
watermark) — this RFC is their first real client consumer. Two invalidation
cases are first-class: a schema/artifact change and an `app.reset` that
happened while the client was offline both force resnapshot; retained state
from before either event is never presented as current.

The shipped store persists the complete identity tuple (`appId`, `databaseId`,
`targetProfileId`, `versionStreamId`) beside the opaque cursor and refuses a
record that does not match every known dimension. A target or reset-stream
transition clears retained rows and quarantines queued writes before reads.
Writes are serialized per adapter/query key, and the reference stores also
compare-and-set within a stream by version, so an older asynchronous completion
cannot overwrite a newer authoritative snapshot. A surface without all four
identity facts does not earn offline replay/retention; it reports
`SNAPBACK_RETAINED_IDENTITY_INCOMPLETE` and stays Online.

### Milestone 2: queued mutation replay

When offline, a client may enqueue mutation calls with:

- function id and args;
- the captured replay environment — 0008 pins the wire to exactly
  `{generatedIds, now}`;
- the optimistic read baseline;
- auth context fingerprint;
- the dedicated server-issued authority descriptor captured at enqueue (never
  a ctx-answer-ledger member and never credential material);
- the client-local sequence number;
- local optimistic patch metadata. Absent local handler execution, the
  optimistic overlay is computed from what the client *can* know: host-plan
  write plans and mutation args (0012 allows optimistic UI from mutation
  args). Overlay application is all-or-nothing per changeset — 0008 pins
  multi-row atomicity after Valet's half-applied-kanban bug.

On reconnect the client follows 0008 §Mutation Replay, which is load-bearing
and client-driven: the client first completes a full resync and waits for the
local replica to reach current, **then** replays each pending mutation in
sequence order against fresh server state. It sends the descriptor stored with
that record, never a newly observed descriptor. The server first resolves the
request credential and prepares the invocation authority, then compares the
descriptor before settlement lookup or effects. (Replaying
against an incompletely synced state produces wrong results — 0008's words.)
Two companion rules from 0008 apply verbatim:

- **doc-id suppression:** while a document has an unconfirmed local mutation,
  incoming server deltas for it are dropped even at higher versions; the
  version-cursor dedup alone is not sufficient — a correct client needs both;
- **drop-and-mark-failed:** a mutation whose handler throws on replay is
  dropped and marked failed, never retried.

Success returns authoritative rows and versions. Conflict or denial returns
0008's **typed conflict payload** (LWW-per-field, delete-wins v1 defaults) —
not a generic error — and the client rolls back or rebases the local
optimistic overlay.

The server retains a settled `clientMutationId`, its auth fingerprint, and its
opaque authority-instance id until that same auth identity
returns it either in a later mutation's `acknowledgedClientMutationIds` list or
through `POST /client-mutations/acknowledge`. The standalone path ensures a
one-shot client's final result is reclaimable without waiting for another app
write. The client persists confirmed ids as auth-tagged records. Auth/artifact
scope changes retain those opaque GC proofs but expose and send only records
matching the current authority, so returning to the prior user can finish GC
without sending their ids under another user.

Every newly written server settlement also stores a nullable authoritative
version beside the legacy settlement cursor. A non-null value — including
version zero on a fresh-database no-op — must exactly equal both the replay
payload's version and the legacy cursor before the result can be republished.
`NULL` is reserved for rows written before this metadata existed; those rows
retain the predecessor rule that a nonzero cursor must agree while zero may be
the historical migration sentinel. Upgrade adds the nullable field without
backfilling it from the replay payload, because copying the value being checked
would fabricate independent provenance and could launder existing corruption.

The client removes a local ACK proof only after a successful standalone ACK or
a mutation response proves that the origin ran the piggyback ACK stage. A
successful mutation and a rejected mutation carrying the provider-core receipt
are such proof; a receipt-less proxy/HTTP failure is ambiguous and retains both
the ACKs and the current queued mutation. A request may not acknowledge its own
current id. Acknowledgement and GC are idempotent and auth-bound, so one
principal cannot delete another's replay result.

Exactly-once wins over opportunistic eviction. A retained result is capped at
65,536 serialized bytes; the ledger is capped at 10,000 records and 67,108,864
logical result bytes. One auth fingerprint is separately capped at 1,024
records and 8,388,608 logical result bytes, so a caller that withholds
acknowledgements cannot consume every other principal's global replay capacity.
At any cap the server refuses a new identity rather than evicting an
unacknowledged result.

Admission reads transactionally maintained global and per-auth record/byte
counters, never a ledger-wide `COUNT`/`SUM` on the settlement path. Insert,
authenticated acknowledgement, and counter changes share one SQLite
transaction; an existing pre-counter database performs one grouped backfill on
open. Gated storage inspection reports current global record/byte gauges, the
caps, and cumulative acknowledged-GC count; the public inspection projection
omits these operational retention facts. An explicitly admin-gated recovery
operation at `POST /_snapback/api/client-mutations/purge` may purge all
settlements (`all: true`) or the fingerprint derived server-side from one
supplied `AuthInput` when the original client can no longer acknowledge them.
The explicit selector prevents an empty request from accidentally purging the
whole ledger. That operator action intentionally gives up exactly-once replay
for the purged identities and is not counted as client acknowledgement GC.

### Conflict posture

The first conflict model is server-authoritative replay. Snapback does not need
CRDT merge in this slice. If a queued mutation conflicts, the client should show
the failed mutation and authoritative state, not pretend convergence happened.

### Auth posture

Store format 6 retains format 5's two axes because “who may see these rows?” and “which
credential instance created this outbox entry?” are different questions:

- **Principal/data axis.** `(authMode, authorizationStreamIncarnation,
  userId)` owns retained rows. A replacement session for the same user in the
  same durable stream may keep those rows; another user, logout to anonymous,
  auth-mode change, or stream-incarnation change deletes them. This physical
  namespace does not by itself authorize display. Item 8 now populates the
  closed `queryAuthorization` namespace with a never-reused query-instance id,
  the exact authorization/issuer/artifact witness, independent pending scopes,
  accepted snapshot fence, and signed `AuthorizedLease`. Session-mode reads
  render only through that query record and delete the lease plus retained rows
  before exposure at the exact client-deadline equality boundary. The empty
  `{}` namespace remains only the migrated pre-item-8 state and grants nothing.
- **Authority-instance/queue axis.** The handshake and every credential
  response carry `{ descriptorVersion, authorityInstanceId,
  sessionGeneration }`. The instance id is opaque, stable across refresh, and
  changes with the session authority; dev authority uses the durable stream
  incarnation. Generation is an observability fact, not an equality axis after
  credentials resolve. A different authority instance strands pending/failed
  work as visible, explicitly discardable, and never replayable. It is never
  silently retagged to the successor.

Format 6 additionally requires the top-level boolean `terminallyUnbound`.
An exact terminal purge deletes every privacy- and replay-bearing namespace,
invalidates the queue generation, clears the authority epoch/key, and sets this
bit in one store transaction. Direct `bindAuthority` cannot consume it. A
coordinator may adopt only a still-current proven authority through
`transitionAuthority`, comparing the store's captured write generation so a
terminal cut after observation wins rather than being rebound by delayed boot.
The same exception admits a proven one-epoch successor only while the store is
fully privacy-clean and unbound.

The write generation never wraps. Ordinary writes stop at
`Number.MAX_SAFE_INTEGER - 1`, reserving the final value for an exact terminal
purge. A pre-reservation format-6 writer may already have left a bound record
at the maximum; every authority- and queue-bound public read/act treats that
record as stale even if the final deletion write fails. Terminal purge may
replace those bytes at the same final identity only with a fully clean,
`terminallyUnbound` record, and replay of that clean marker is write-free and
idempotent. A marker at the final generation cannot be consumed by successor
adoption; explicit client-store replacement is required.

The older client-derived auth fingerprint may remain attached to format-6
records solely for settlement-ACK compatibility. Once a modern axis is bound,
that fingerprint cannot delete, preserve, expose, or replay data and therefore
cannot become a hidden third ownership axis.

The server owns error precedence. Invalid, expired, revoked, or superseded
credentials fail during credential preparation. Only a valid credential whose
prepared authority differs from the queued descriptor reaches
`SNAPBACK_AUTH_STALE_RESULT`; absent, malformed, and unknown-version
descriptors use the same non-retryable class. First delivery and duplicate
settlement share that check. Possessing a descriptor never authenticates a
caller, and neither `ctxLedger` nor handler input can override it.

Format 3 had coordinator epoch/key tags but no server-issued queue-authority
proof. Upgrade validates its complete shape, deletes retained rows, and moves
pending/failed records to `legacyV3Stranded` with `replayable: false`. It does
not infer a descriptor from an auth fingerprint or caller claim. The earlier
v1/FNV and v2 migration rules remain deletion/quarantine-only; server-retained
legacy rows remain acknowledgeable or admin-purgeable but never rebound.

Item 6 and item 7 independently used format number 4 before ordered
composition exposed the collision. Format 5 accepts exactly the validated
predecessor shape it can identify. An item-6 shape has the invalidation queue
generation but no server-issued authority descriptor, so pending/failed work
moves to `legacyV4Stranded` and is never replayable. An item-7 shape has the
descriptor/principal axes but no invalidation queue generation, so it gains a
fresh independent queue generation while preserving descriptor-bound work.
Neither migration infers one authority axis from the other.

Format 5 did not possess the mandatory terminal marker. Format-6 migration
therefore validates a complete v5 predecessor but preserves none of its
retained, queue, receipt, stranded, principal, descriptor, or authority bytes:
it clears those namespaces, advances the queue invalidation identity, and
leaves `terminallyUnbound: true`. This deletion-only conversion is deliberate;
there is no safe way to distinguish a legitimate v5 record from a terminal v5
record whose new bit was erased by an older writer. Older readers reject v6.
Every tab/process sharing the physical client-store key must be drained and
upgraded together; if an old writer later replaces v6 with v5, the next v6 read
performs the same deletion-only migration instead of trusting the downgrade.

## Non-goals

- Full local handler execution parity (and therefore any "local-first" parity
  claim — see Summary).
- CRDT or rich-text merge.
- Peer-to-peer sync.
- Offline assets.
- Delta-resume with pending offline mutations (milestone 3, later — 0008 pins
  it as an explicit separate milestone).
- Retaining unauthorized or admin-bypass results.

## Acceptance

- A todo app shows previously authorized rows while offline with a stale marker.
- A queued offline mutation replays successfully after reconnect and converges to
  the authoritative server result.
- Replay is observably ordered by the client sequence number, and replay does
  not begin until resync-to-current completes.
- While a document has an unconfirmed local mutation, an incoming
  higher-version server delta does not flicker the optimistic state
  (suppression works).
- A conflicting queued mutation fails with the typed conflict payload, is
  dropped (not retried), leaves no ghost duplicate row, and remains visible as
  failed client state.
- A multi-row optimistic changeset applies all-or-nothing locally.
- A client reconnecting from beyond the server's retention floor is forced to
  resnapshot (`resume_requires_resnapshot` exercised end to end).
- A user switch prevents the new user from seeing the prior user's retained
  rows or replaying the prior user's queued mutations.
- A same-user new session preserves principal-owned rows but strands the old
  authority instance's queued mutations; refresh of the same opaque instance
  preserves both.
- A non-retainable query reports a capability diagnostic rather than silently
  acting local-first.
- A cold process renders an auth-scoped retained query only through the exact
  current query instance and an unexpired signed `AuthorizedLease`; missing,
  malformed, wrong-bound, rollback-tainted, and equality-expired leases commit
  delete-before-render.
- A lease whose MAC differs by one bit is refused by the server's keyed
  verifier and unknown `key_id`s fail closed at the keyring; the client store
  detects the post-commit substitution by lease-hash inequality and commits
  delete-before-read, while client custody validation alone accepts the
  canonical shape (documented limitation — ENG-24992, LLP 0053 §The lease).
- Lease renewal paused after capturing data head 99 loses to a `public →
  private` write at head 100: it mints no lease and discards the stale snapshot.
  If reservation wins first, the later write raises the normal LLP 0053
  obligation and fences the connected result.
- Heartbeat, delta, refresh, reconnect, mutation success, and ACK leave the
  deadline unchanged. Only a later full revalidation at an exact current head,
  with no pending obligation, can atomically install a replacement lease and
  snapshot.

## Open Questions

Retainability is no longer an open subset choice: LLP 0053 defines a strict
protected/retainable profile, and item 8 requires that proof plus the signed
lease protocol. Syncable-live status alone never admits retained display.

- Should retained rows be encrypted at rest on mobile by default?
- How should generated clients expose conflict UI facts without dictating UI?

## Status

Draft, with the first closed-IR single-query M1/M2 slice implemented by
ENG-23965, hardened by ENG-24376, and the format-5 authority split implemented
by ENG-24605 and retained inside the current format-6 terminal-marker boundary.
ENG-24606/item 8 implements the mandatory query-authorization
namespace, signed-lease issuance and client custody, exact deadline deletion,
rollback protection, and full-revalidation-only renewal. Shipped evidence covers
retained stale boot, reload persistence,
ordered create/toggle/delete replay, lost-response exactly-once settlement,
auth wipe/mismatch, artifact/target/reset-stream quarantine, reverse-completion
write ordering, exact ledger consumption, and
authoritative convergence, format-3 quarantine, refresh stability,
same-principal/new-session row preservation with queue stranding, and
different-principal deletion, cold-process lease-valid display, equality expiry,
malformed/wrong-bound lease refusal, clock rollback, and the renewal/head race.
The broader acceptance rows (richer conflict UI and the explicitly later
delta-resume-with-pending milestone) remain future work; they do not widen the
shipped Parity predicate or ratify this Draft on the author's behalf.
