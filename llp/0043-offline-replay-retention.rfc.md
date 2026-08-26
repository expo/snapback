# LLP 0043: Offline replay and retention

**Type:** RFC
**Status:** Draft
**Systems:** Sync, Storage, Client integration, Auth, API, Realtime, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-08-26 (round-27 dispatch/error/contract correction: a final
pre-POST inspection that receives an HTTP error or redirect backs replay off with
`SNAPBACK_OUTBOX_REPLAY_INSPECTION_UNAVAILABLE`, retains the current record and
every successor pending, and retries without an external wake. Standalone ACK
re-reads and requires the shared positive target fact under the
authorization-dispatch lock immediately before POST. The injected-store type
now carries the sixth record-scoped legacy policy, quarantine result fields,
and a versioned `supportsLegacyQuarantine: true` capability; an incapable
store refuses before predecessor bytes can be deleted.)
**Revised:** 2026-08-26 (round-26 generation/privacy correction: string-named
replay sends the complete served generation persisted at enqueue and rechecks
the served generation immediately before POST. Sessions servers additionally
enforce that assertion at mutation time; v0-dev does not. A principal switch
may privacy-delete targetless/pre-v2 rows only when a default, non-injected
store has recorded matching single-origin provenance. Shared, injected, or
unproven stores instead preserve the bytes in predecessor-principal quarantine,
which no successor may project, replay, ACK, recover, or adopt.)
**Revised:** 2026-08-25 (round-23 systemic recovery fence: one shared client
selection boundary admits only locally present v2 records matching the complete
current enqueue target while the authorization-dispatch lock is held. Public
observation, recovery, ACK consumption, custody reconciliation, adoption,
replay, foreground range issuance, and caller-supplied piggyback ACK ids use
that boundary; targetless, legacy, missing, and foreign ids are coded no-ops.)
**Revised:** 2026-08-25 (round-16 target/custody correction: drain and
observation paths no longer reconcile whole-queue custody; replay reconciles
only the target-fenced record at its submission slot; optional
`ledgerIncarnation` plumbing is ready, but real reset quarantine remains
pending the server field tracked in
`issues/20260825-inspect-exposes-ledger-incarnation.md`)
**Revised:** 2026-08-25 (round-15 custody-order correction: shared capability
currency and each persisted enqueue target pass before any custody write;
reconciliation is limited to the already-validated record, so a valid prefix
may settle while the first mismatch remains byte-identical and pending. The
sidecar-adoption path delegates its first custody write to the same ordered
replay fence.)
**Revised:** 2026-08-25 (round-14 target-binding correction: cached evidence
for a string-named mutation is reusable only when the client has an
established application identity and the cached served generation carries the
same app id; unbound clients and identity-free cached manifests remain
online-only. Initial replay target checks are per-record and ordered: a valid
prefix settles before the first mismatch pauses that record and every
successor.)
**Revised:** 2026-08-25 (round-13 replay/redirect correction: every prepared
replay record is checked against the durable enqueue target while the
authorization-dispatch fence is held, before custody reconciliation, range
issuance, dispatch stamping, or mutation transport. Manual redirect refusal is
narrowed to credentialed, capability-inspection, and effect-producing
requests; credential-free ordinary query POSTs retain their historical
redirect behavior.)
**Revised:** 2026-08-25 (durable enqueue-target binding: additive outbox
record schema v2 persists canonical origin, target profile, and generated
artifact generation or string-reference app identity. Replay compares the
record with its fresh pinned target before custody changes or transport;
mismatch and pre-v2 target absence are distinct coded pending refusals.
Cross-target adoption is deliberately not defined by this amendment.)
**Revised:** 2026-08-25 (pinned-target rule: each foreground mutation and
replay cycle captures one immutable transport base URL and canonical origin
before inspection, then completes that target with the positive fact's target
profile and artifact generation. Inspection, fact recording, durable enqueue,
operation-identity issuance, and mutation transport use that target; a client
repoint at the transport-start fence refuses before fetch.)
**Revised:** 2026-08-25 (capability-fact currency and dispatch-safety
clarification: a newer positive continues an observed positive's authority
when canonical origin, target profile, and complete artifact generation are
identical; a negative or target-identity/generation change supersedes it.
Supersession before dispatch retires custody and refuses the POST, while
supersession after dispatch preserves the pending recovery identity through an
ambiguous response. An unreserved IndexedDB follower answer carries only its
observed revision into takeover and is dropped if shared state advanced; it
never mints a takeover request sequence, while a committed takeover answer
stamps the allocator's existing high-water as the durable order floor. The
redirect posture recorded at this checkpoint is superseded by the narrower
round-13 rule above.)
**Revised:** 2026-08-25 (`queue: 'auto'` capability-evidence correction: each
`/inspect` attempts to reserve a store-writer-owned request sequence before
transport, with the broker-unavailable fallback narrowed above;
answered facts compare-and-commit by the observed store revision or a newer
shared request sequence, while no-response failures advance neither the
answered fact nor the client answered high-water. Enqueue and replay re-read
that shared fact/generation at their durable and transport boundaries, and an
ambiguous write whose fact was superseded cannot become replayable. Facts stay
bound to canonical origin plus served app artifact generation; cached evidence
is enqueue-only. Answered gaps refuse queueing and replay, while
`queue: 'auto'` makes one online-only mutation attempt; write redirects
refuse. Replay always requires a fresh positive. Broker-unavailable followers
retain a local negative override. Live-query transitions schedule deduplicated
observation, exposed through a public settlement promise.)
**Revised:** 2026-08-16 (authorization observation amendment: every validated
queue exposes its real payload-free authorization metadata even while a
legacy/destructive record normalization awaits the exact writer; records,
acknowledgements, and inspection remain blank until the writer's transaction
and a confirming reread. IndexedDB routes that work to the exact Web-Lock
holder through a cross-context request/ack broker. An unavailable projection
has no invented authority generation, and delayed work must compare-and-commit
the generation it captured.) 2026-08-16 (author ruling: the JS library default now ingests
LLP 0053 mutation-queue obligations. The durable queue persists a separate
authority generation, compare-and-commit queue generation, and exact roots;
enqueue, foreground dispatch, replay, settlement, and discard share the
suspension fence. Quarantine/error suspends optimistic-create custody until
proof; delete/authority loss closes it.) 2026-08-15 (removed the LLP 0255 amendment after the author
selected LLP 0254 D10 Withdraw)
**Revised:** 2026-08-15 (authorized-lease offer/query-admission separation:
the session-level offer only makes the protocol available; a generated
query's explicit retainable class admits lease custody, so ordinary live
queries never probe the lease endpoint). 2026-08-12 (target settlement-ledger capability gate: durable
JS outbox enqueue and replay require the target's positive
`offline_mutation_replay` advertisement; Cloudflare remains fail-loud while
local SQLite retains its exactly-once replay path). 2026-08-10 (LLP 0218 P3 React dispatch handoff: a queued React
resolution relinquishes foreground settlement to this RFC's durable status,
custody, recovery, and acknowledgement lifecycle). 2026-08-10 (JS/React M1 lease-custody implementation leg:
generated protected live queries now use an owned atomic RQS-v3 sibling
record for never-reused query identity, authorization witness, exact
AuthorizedLease bytes/hash, request-start-derived deadline, and retained
rows; fresh-instance acceptance pins valid display, equality expiry, and
mismatch delete-before-render. The independent real-process restart witness
remains an explicit GAP, so the Guide capability is partial.) · 2026-08-08 (handler-visible settlement identity, Claude Fable 5 /
Codex gpt-5.6-sol: mutation handlers read the durable settlement identity
through `ctx.mutation.settlement()` instead of minting app-owned effect
idempotency keys; queries and actions refuse it typed) · 2026-08-07
(ownership acceptance — LLP 0129 owner-landing
ledger row 4, speculative/settlement receipt shapes ("receipt
projection"), assigned to this RFC by the 2026-08-07 author gate packet
ruling, item 7
(`issues/closed/20260807-local-first-author-gate-packet.md`). This RFC
accepts ownership: speculative receipts carry the content address plus
captured environment, settlement receipts bind them to the
authoritative commit version, and a locally executed result is never
presented as settlement; the design lands here as a dated section when
built, with LLP 0034/0093 as collaborators. Until it lands, LLP 0129's
ledger row 4 continues to bar any `Parity`-by-construction claim.)
2026-08-06 (JS-arm sessions-custody queue implemented: per-record descriptor/principal/fence capture, strand/delete reconciliation, explicit recovery affordances, and card-game acceptance witness; commit 55564b1018eb); 2026-08-05 (C28 lifecycle reconciliation — two-digest tombstones, contiguous closed-prefix floors, and four-range/1,024-identity client epoch capacity); 2026-08-04 (author decision sitting #3
(`issues/closed/20260804-author-decision-sitting-3.md`): the JS-arm
sessions-custody queue recorded design is **RATIFIED** — all four open
points ruled: (1) v1 stays server-refusal-only, no LLP 0053
queue-obligation suspension port, the named Contract-arm asymmetry
stands, revisit only on evidence of meaningful refusal rates;
(2) `SNAPBACK_AUTH_STALE_RESULT` at replay surfaces as *stranded* with
re-record recovery, content refusals stay drop-and-mark-failed;
(3) cross-principal disposition is delete-with-diagnostic-count, no
redacted tombstones; (4) recovery affordance is
read/discard/re-record-as-new-`clientMutationId`, no exactly-once bridge
across authorities. Implemented by the 2026-08-06 lane noted above.) 2026-08-03 (LLP 0163 implementation parameters — v1 authenticated
client ranges admit at most 256 counters over at most 30 days; unacknowledged
results have no time eviction; ACK makes the result payload immediately
reclaimable but requires a tombstone until the audience floor passes the
epoch); 2026-08-03 (`single_table_v1@1` boundary: proof-backed QMK
records under its narrow authority remain retained-not-current; pending
outbox intent withholds token resume but not a verified retained display;
lease and outbox lifecycle are unchanged.); 2026-08-03 (recorded design —
JS-arm sessions-custody offline queue: capture-at-enqueue authority
descriptors + strand-on-authority-change, per the commissioned design pass
at author sitting #2; see §Auth posture's dated subsection. Recorded
awaiting author ratification; **ratified 2026-08-04 at author sitting #3**
— see that entry and the 2026-08-06 implementation note.)
2026-08-03 (terminology note: "cold process" in this document
names the fresh-wrappers-over-retained-state-in-one-process proof class;
no claim change.) 2026-08-03 (Accepted LLP 0166 boundary: v1 lease-family
convergence is fresh-sync-only, close-predecessor-first via terminal
retirement, with a pending-intent precondition; the atomic-move arm
awaits the lease store joining the shared domain.) 2026-08-03 (Accepted LLP 0157 boundary: composition
materializations use its `qmk1` semantic address and proof/witness model;
legacy retained records migrate only under the exact atomic guard recorded in
the dated section below); 2026-08-02 (Accepted LLP 0135 overlay fold: a changeset requiring
sequence-projected placement is withheld whole until settlement);
2026-08-01 (settlement lifecycle amendment: the client crosses one
atomic durable-consumption boundary before publishing a result, retaining the
complete settlement and its ACK obligation until receipt-proven server GC;
ACK capacity refuses instead of evicting recovery state; and a removed
function's committed settlement remains recoverable through a non-executing,
authority-bound lookup until ACK, after which the function is unknown.)
2026-08-01 (0137 A1-Expo f2: connectivity classification for the
M2 enqueue is transport provenance — the fetch dispatch itself rejected, so no
HTTP status, server diagnostic, or receipt can exist — independent of the
rejection's constructor. Expo/RN fetch rejects connection failures with a
plain `Error`, which the previous `instanceof TypeError` gate could never
queue, silently disabling the M2 path on that carrier. Caller-owned
aborts/timeouts and anything the server answered still never queue.)
2026-07-31 (LLP 0129 Phase 0: the JS/React arm
(`packages/snapback-client`) gains its M2 slice — a durable queued-intent
outbox on the persisted RQS store arms (IndexedDB/file/memory) with
client-minted `clientMutationId`, connectivity-refusal enqueue, ordered
full-resync-first replay, drop-and-mark-failed, and ACK-obligation GC
piggyback — plus default-on retention for the rqsEligible subset via the
LLP 0090 store. Environment capture on this arm is honest to §Milestone 2:
with no local execution there is usually no captured `{generatedIds}`
ledger; a caller-supplied ledger is transmitted verbatim under LLP 0008's
accept pin, and the enqueue wall-clock is retained as a labeled claim only.
The arm makes no `Parity` claim (no local IR-derivability) and no
protected-retention claim (M1 lease custody stays Contract-arm;
`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md`). One
scoping note: the lazily minted id attaches at enqueue, so a pre-queue
first delivery that died receipt-less remains the §Milestone 2 ambiguity
class; callers wanting airtight online exactly-once still supply their own
id up front. Proof: `demos/public-dashboard/tests/acceptance/
offline-local-first.mjs`.) 2026-07-17 (new server settlements carry nullable authoritative version metadata so a legitimate fresh-database version zero is distinguishable from the predecessor migration sentinel; legacy rows remain readable without fabricated backfill provenance). 2026-07-16 (format-6 terminal anti-rebind boundary: `terminallyUnbound` is mandatory, format 5 migrates deletion-only, only an exact coordinator/store-generation CAS may consume a non-final marker, and the final safe write generation is reserved for terminal deletion). 2026-07-14 (ENG-24992: the Milestone 1 fail-closed list no longer implies client-side cryptographic MAC verification — client custody detects structural/binding/hash/expiry/rollback defects while `key_id`/`mac` are authenticated only by the server keyring, per LLP 0053 §The lease's dated verification-locus amendment; executable one-bit MAC tamper and unknown-key vectors pin both sides). 2026-07-14 (ENG-24606 reconciliation: item 8 now populates the format-5 `queryAuthorization` namespace with never-reused query-instance identities, authorization witnesses, independent pending-scope fences, signed lease custody, and equality-expiry deletion; the earlier ENG-24605 empty reservation remains the historical pre-item-8 checkpoint). 2026-07-13 (ENG-24605 composition: server-issued authority descriptors bind queued work independently from principal-owned retained rows; composed store format 5 resolves item 6/item 7's independent format-4 allocation, migrates both predecessor shapes fail-closed, preserves rows across a same-principal new session while stranding its queue, and reserves but does not implement `queryAuthorization`). 2026-07-12 (ENG-24571: standalone authenticated ACK delivery, auth-tagged client ACK retention, receipt-proven acknowledgement, collision-resistant auth fingerprints with collision-safe v1/FNV quarantine on both client and server, transactionally maintained global/per-auth counters, and an admin-gated recovery purge); 2026-07-12 (ENG-24571: durable mutation settlement is acknowledgement-driven and auth-bound, with hard result/aggregate/count refusal limits and gated retention metrics; no time-based eviction can break exactly-once replay); 2026-07-12 (ENG-24376: retained writes are ordered and compare-and-set by opaque stream/version, while app/database/target/reset-stream identity is persisted and invalidates incompatible rows). 2026-07-09 (ENG-23965 ships the first closed-IR single-query M1/M2
slice: retained auth/artifact-scoped rows, durable monotonic outbox, atomic
client mutation settlement, full-resync-before-replay, and replay tests; broader
conflict/delta-resume work remains as scoped below. Earlier: cross-family review
revisions, ratified by Charlie — see
`reviews/0043-offline-replay-retention.claude.md`: claim language aligned with
LLP 0012's parity rule, client-side replay restored per 0008, DK-9 cited
instead of re-enumerated, suppression/conflict machinery restated; initial
same day)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0008, LLP 0010, LLP 0011, LLP 0012, LLP 0034, LLP 0038, LLP 0039, LLP 0053, LLP 0059, LLP 0157

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

#### JS/React owned carrier composition (2026-08-10)

The ordinary generated `LiveQuery` path does not import Contract's complete
format-6 store. The JS arm already has one atomic carrier domain across
IndexedDB, Node files, and memory, with its own never-reused query-instance
allocator and authority-transition reset. Importing a second store owner
would split those transitions. Instead, the durable RQS-v3 metadata owns a
separate `authorizedQueryRetention` slot; protected bytes never become RQS
entries and never consume an authority-independent resume token.

This owned composition preserves the item-8 custody invariants that apply to
the generated JS surface:

- preparation allocates the exact `(clientStoreId, queryKey,
  queryInstanceId)` before `subscribe_live`; the live subscription and lease
  request reuse it;
- only a generated `LiveQuery` whose reference carries the explicit
  `opaque-authorized-snapshot-v1` retainable class, with exact deployment
  identity, a durable writer-owned store, and negotiated
  sessions/invalidation/lease v1 protocols enters the path. The session-level
  lease offer is availability, not admission: without that per-query class an
  ordinary online live query proceeds without preparing protected custody or
  calling the authorized-lease endpoint. The server-issued activation hash
  binds the generated deployment and target capability; the JS reference has
  no independent author-supplied `targetProfileId` that the client could
  safely invent;
- request id, query generation, authority tuple, request-start time, and clock
  high-water commit before the full `authorizedLeaseQuery`. The returned full
  snapshot must equal the just-authorized live snapshot, then rows, cursor,
  composite witness, exact lease bytes/hash, and derived deadline commit in
  one transaction;
- cold read is a read-write validation transaction. Structure, namespace,
  principal, issuer, authorization pair, version stream, authority instance,
  activation, witness, cursor/version, lease hash, deadline, and clock
  high-water must all match. Equality is expiry. Any mismatch deletes the
  query instance before returning no rows; and
- a non-retain invalidation or authority transition deletes the protected
  record before acknowledgement/successor observation. This stricter
  delete-on-obligation rule does not mirror Contract's retained
  `pendingByScope` map: once the JS record is deleted there is no local payload
  for a pending disposition to guard, while the live authorization queue still
  owns delivery and acknowledgement.

Package acceptance in `packages/snapback-client/rqs-resume.test.mjs` proves
the custody failure matrix and an online lease acquisition followed by a
fresh client instance rendering while fetch is unreachable. It intentionally
uses fresh wrappers over the same IndexedDB carrier, consistent with this
RFC's dated `cold process` terminology. The independent real JS-runtime
restart witness remains outside this implementation leg and gates promotion
of `sync.offline-js-arm-protected` from partial to shipped.

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

#### Target settlement-ledger capability gate (2026-08-12)

Durable queueing is safe only when duplicate delivery of the same
`clientMutationId` resolves through the atomic server settlement ledger just
described. The target therefore advertises the positive closed capability
`offline_mutation_replay` only when that ledger is registered. Accepting a
mutation id, omitting a capability gap, or successfully handling an ordinary
mutation is not equivalent evidence.

Before creating durable intent, `queue: true` requires a fresh positive fact
and otherwise refuses with the typed client error
`SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED`. The normal online client
lifecycle acquires the answered manifest and persists its replay-capability
fact in the durable client-store domain, bound to canonical server origin and
the target's served app artifact generation (`schemaVersion`, `appId`,
`schemaHash`, `bundleHash`, and `inputsHash`). A generated mutation reference
must match that exact generation before cached evidence can admit its enqueue;
a string-named mutation carries no call-time generation witness, so cached
evidence may admit it only when the client has already established an app id
from its served descriptor/binding and the cached served generation carries
that same app id. An unbound client, a different app id at the same origin, or
an identity-free cached manifest stays online-only instead of guessing the app
identity that record schema v2 would persist.

Inspection order belongs to the durable store, not a client instance or HTTP
arrival order. Before dispatch, each inspection reserves a monotonic request
sequence from the elected writer and captures the current fact revision. An
answered positive, gap, or HTTP error compare-and-commits only when that
revision is still current or its shared request sequence is newer than the
last answered fact's sequence. A delayed older response therefore cannot
overwrite a newer answer from the same or another client. A request that
produces no HTTP response commits nothing: it advances neither the stored
answered sequence nor the observing client's answered-request high-water, so
it cannot discard an earlier discovery still in flight. The fact revision and
answered request sequence are durable metadata and are preserved across
writer/follower handoff.

`queue: 'auto'` ordinarily uses that fresh answer. Its one narrow exception is
the enqueue fallback: when the capability re-probe itself loses transport and
therefore produces no HTTP response, it may reuse a prior positive fact only
when the canonical origin plus either the operation-carried generation or the
string reference's established app id still match the fact's served target
identity. If no matching positive exists, the ambiguous mutation transport
failure remains the caller-visible error and no outbox record is created. This
exception licenses durable custody only; it is never transport or replay
authority. Consequently cached evidence takes the enqueue-only path without a
foreground mutation POST; only a fresh positive answer may gate a
try-then-queue dispatch.

Answered negative facts replace predecessor positives through the elected
writer when the carrier can prove that route. If IndexedDB has no usable
`BroadcastChannel`, the observing follower retains a local negative override
that wins for that observer. The unreserved answer captures the shared fact
revision observed before its HTTP request but no request sequence. On writer
takeover it compare-and-commits only if that exact revision remains current;
if a writer committed a newer answer, the pending shared replacement is
dropped and no takeover sequence is minted. When the exact-revision commit
wins, the replacement fact stamps the allocator's existing request high-water
without allocating another sequence. That stamp is an order floor: a delayed
reserved answer that observed an older revision may commit only when its
request sequence is strictly newer than the floor. The observing client's
local override may remain fail-closed. A later answered positive from the same
canonical target clears the override; repointing the client to another
canonical origin drops it. A closed client refuses any late capability answer
instead of brokering it to the successor writer. The Node file store routes
peer replacement to an in-process writer. It makes no cross-process broker
claim: a follower in another process cannot replace the writer's bytes and
therefore fails closed locally instead of reusing the predecessor positive.
Cached evidence never licenses a foreground POST; if enqueue custody belongs
to another writer, the client propagates `SNAPBACK_OUTBOX_NOT_WRITER` and
leaves that writer's record untouched.

Capability validity is a compare-and-read fence. Admission re-reads the shared
fact and revision immediately before durable enqueue; foreground transport
re-reads them again before POST; and an ambiguous response re-reads them before
the client may resolve `queued`. Fact revision alone is not supersession: a
newer `supported: true` fact with the same canonical origin, target profile,
and complete artifact generation continues the authority of the positive fact
observed at admission. A negative or a change to any of those target-identity
axes supersedes it. Before transport, supersession retires the admitted record
and fails closed without a POST. Once transport has started, an ambiguous
response keeps the durable record pending because deleting its settlement
identity could duplicate an already-committed effect; that record still needs
a fresh positive before replay and cannot be made replayable retroactively by
the ambiguous response itself. Replay performs the same shared re-read
immediately before each POST.

The **pinned-target rule** makes that currency check operationally meaningful.
At the start of each foreground mutation or replay cycle, the client snapshots
one immutable normalized transport base URL and canonical origin. A positive
capability fact completes that operation target with its target profile and
complete artifact generation. The client threads the same target through
inspection, fact recording, durable enqueue admission, operation-identity
range issuance, and the mutation POST URL; those steps never retarget from a
later mutable client configuration. At the transport-start fence, after the
final shared-fact read and before `fetch`, the current client target must still
equal the pin. A mismatch refuses with
`SNAPBACK_CLIENT_OPERATION_TARGET_CHANGED`: foreground pre-dispatch custody is
retired, replay custody remains pending, and neither path sends to the
successor target. Replay performs its fact read before marking the record
dispatched, so capability supersession cannot stamp a record whose transport
never started. For an uncovered replay record, that same read runs under the
authorization-dispatch lock immediately before any operation-identity range
request; a peer negative therefore skips both range issuance and mutation
transport.

The operation-lifetime pin is also durable enqueue identity. Every newly
created outbox record uses additive record schema v2 and stores the enqueue
target's canonical origin, target profile, and artifact identity. Generated
references store their complete call-time artifact generation; string-named
references store the complete artifact generation already established by the
served app descriptor/binding, with the app id retained as its compatibility
key. Before replay changes queue custody, assigns an
operation-identity range, marks dispatch, or sends a mutation, the shared
capability fact must remain current and a fresh pinned target must equal every
persisted axis. Replay performs both comparisons in sequence at each record's
custody boundary, and the ensuing custody transaction is limited to that
already-validated record: records in a valid prefix may settle, then the first
difference pauses the drain and leaves that record byte-identical plus every
successor pending. Sidecar adoption delegates its first custody write to the
same ordered replay fence. A difference refuses with
`SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH`; a pre-v2 record with no target
refuses separately with `SNAPBACK_OUTBOX_REPLAY_TARGET_MISSING`. The refused
record produces no mutation POST. An explicit future protocol may adopt
target-bound intent, but neither ordinary replay nor the current
sidecar-adoption checks infer that authority; target adoption is out of scope
for this amendment.

For the final comparison, replay re-inspects the served target immediately
before the mutation POST and compares it with the persisted generation. A
difference pauses with `SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH` before the
dispatch stamp or POST. An answered 4xx, 5xx, redirect, or other answered
inspection failure at this final cut pauses with the retriable
`SNAPBACK_OUTBOX_REPLAY_INSPECTION_UNAVAILABLE`; it never enters the server
mutation-refusal branch, never marks the current record failed, and stops
before visiting successors. A transport loss remains the existing transient
connectivity pause. This narrows, but cannot atomically close, the
inspection-to-POST deployment window. Sessions-mode servers enforce the
carried `expectedGeneration` against the manifest pair selected for the
invocation. v0-dev servers currently tolerate that additive field and do not
perform mutation-time enforcement; server parity is tracked in
`issues/20260825-v0-dev-mutation-generation-enforcement.md`.

All mutation/replay POSTs, other effect-producing requests, capability
inspection, and any request carrying a bearer, lease, session, admin token, or
other secret-classified credential use manual redirect handling. A
301/302/307/308 (or other redirect response) on those requests is an answered
`SNAPBACK_REDIRECT_REFUSED`, never a connectivity failure and never a
queue/replay trigger. Credential-free ordinary query POSTs retain the
platform's previous redirect behavior so existing proxy and trailing-slash
rewrites continue to work; they carry neither transport authority nor an
effect across the second hop.

Ordinary query success and every retained/stale-to-current live transition
schedule the same in-flight-deduplicated observation. Applications may await
`whenOfflineMutationReplayCapabilitySettled()`; polling store metadata is not
part of the lifecycle contract.

Before any queued record is reconciled or re-POSTed,
`replayQueuedMutations()` always performs a fresh inspection and requires its
positive answer. It never reuses process or durable cached evidence; a lost
inspection, answered gap, 4xx, or 5xx refuses with the typed capability error
and leaves the record pending and unchanged. Local SQLite advertises the
capability because `_snapback_client_mutations` settles the id in the
application-write transaction. The Cloudflare coordinator does not own that
ledger and continues to report `offline_mutation_replay` as a gap, so its JS
clients fail loudly instead of accepting at-least-once replay corruption.

The custody write boundary is record-scoped. The platform drain's `runCycle()`
performs no whole-queue custody reconciliation after capability inspection.
For each selected foreground or housekeeping record, `#replayOutboxOnce`
re-reads capability currency, compares the complete persisted enqueue target,
and only then calls `#reconcileQueueCustody(..., { recordIds: [id] })` under
the authorization-dispatch gate. It re-reads that exact durable record after
the scoped transaction; a record no longer pending, or still not sendable
under the current principal/authority instance, stops the lane rather than
letting a successor pass it. A stable target mismatch consumes already-latched
drain wakeups and stays paused until a later real custody/target event, so the
default drain cannot hot-loop the refused head.

Observation and recovery pre-reads are non-mutating: `outboxStatus()`,
`mutationStatus()`, `quarantinedMutations()`, `settledMutations()`,
and `createOptimisticMutationView()` do not reconcile whole-queue custody.
`acknowledgeResultGoneMutations()` is an explicit mutating recovery cut: it
may discard only a locally retained `result-gone` record admitted by the
complete current enqueue-target fence under the authorization-dispatch lock.
Explicit authority-transition and app-directed recovery operations retain
their separately governed, record-scoped custody writes; merely observing a
sidecar-adopted queue can never strand a record before its persisted target
fence runs. Missing, targetless/legacy, and foreign caller ids return a coded
no-op rather than granting record observation or mutation authority.

The named **principal-privacy exception** is narrower than replay authority.
An authority transition includes targetless/pre-v2 rows that cannot satisfy
the v2 recovery target fence only when store provenance makes their origin
disposition safe. A default, non-injected store durably records canonical
origin provenance; only a matching provenance record that remains single-
origin permits the destructive predecessor/successor deletion matrix. An
injected store, a provenance record that observed multiple origins, or absent/
unproven provenance must retain legacy bytes in a durable quarantine stamped
to the predecessor principal. Successor principals cannot project, replay,
ACK, recover, or adopt that quarantine; the explicit adoption protocol owns
its eventual user-authorized disposition. A structurally injected store must
declare the exact versioned `outboxCapabilities` value
`{ schemaVersion: "snapback.rqs-outbox-capabilities.v1",
supportsLegacyQuarantine: true }`, accept the record-scoped method's sixth
`legacyPolicy` argument, and return `quarantined` plus `quarantinedIds`.
Without that capability the client refuses the transition with
`SNAPBACK_OUTBOX_LEGACY_QUARANTINE_UNSUPPORTED` as the recorded cause and does
not call the destructive reconciliation method. The transition emits a coded
deletion or quarantine diagnostic accordingly. A foreign schema-v2 record
whose persisted canonical origin does not match the transition origin remains
outside this privacy cut.

The additive enqueue-target identity also recognizes an opaque
`ledgerIncarnation` whenever inspection provides it. The client persists the
field in both the replay-capability fact and record `enqueueTarget`, and exact
inequality fences custody and POST like the other target axes. Compatibility
is deliberately fail-open only when either the predecessor or current server
omits the field. As of 2026-08-25 public `GET /inspect` exposes no store or
settlement-ledger incarnation: `storage.version` is a mutable data revision,
while `targetProfileId`, the artifact hashes/app id, and
`capabilityManifest.runtimeFacts` remain unchanged across the relevant reset.
Therefore an `app.reset` can still delete `_snapback_client_mutations` without
giving the JS client a changed replay-target axis. The same-origin,
same-artifact reset case is **not closed** until the server publishes
`ledgerIncarnation` and the real reset/zero-POST regression runs; the Rust-side
work and acceptance test are tracked in
`issues/20260825-inspect-exposes-ledger-incarnation.md`.

Every newly written server settlement also stores a nullable authoritative
version beside the legacy settlement cursor. A non-null value — including
version zero on a fresh-database no-op — must exactly equal both the replay
payload's version and the legacy cursor before the result can be republished.
`NULL` is reserved for rows written before this metadata existed; those rows
retain the predecessor rule that a nonzero cursor must agree while zero may be
the historical migration sentinel. Upgrade adds the nullable field without
backfilling it from the replay payload, because copying the value being checked
would fabricate independent provenance and could launder existing corruption.

#### Settlement consumption and acknowledgement lifecycle (2026-08-01)

One durable client record owns the whole lifecycle. Its normative states and
transitions are:

1. **pending** — the complete intent, original `clientMutationId`, replay
   inputs, and authority descriptor are durable before an explicit-id online
   delivery or offline replay. A receipt-less transport outcome stays pending.
2. **settled / acknowledgement-pending** — after an authoritative result is
   received, one atomic store transaction retains the complete response,
   marks the intent non-replayable, and adds the ACK obligation tagged by
   both user and the server-echoed authority-instance descriptor. The ACK is
   not eligible for automatic delivery yet.
   Only after that transaction commits may the result be published to the
   caller. There is no intermediate published-but-unrecoverable state.
3. **durably consumed / acknowledgement-ready** — after a crash or relaunch,
   `settledMutations()` re-attests the current authority and republishes only
   responses from that exact user/authority cohort; nonmatching predecessor
   results remain opaque and retained. The application
   then calls `markMutationSettlementsConsumed(ids)` to admit piggyback ACK,
   or sends an explicit standalone ACK for those ids. This explicit cut
   prevents a later mutation from deleting the only recovery copy before its
   result has been observed.
4. **acknowledged / removed** — only proof that the server processed a
   standalone or piggyback ACK permits one atomic local transition to remove
   both the retained settlement and its ACK obligation.

A typed server refusal becomes a visible terminal `failed` record and is never
ACKed as the current id: no server settlement exists to collect. An ambiguous
or locally unpersistable result remains pending and replays under the same id;
the persistence error must not enter drop-and-mark-failed.
Unknown outcomes are never ACKed. Local ACK capacity is a correctness bound:
at the cap, new settlement consumption refuses rather than discarding an old
ACK or publishing a result without recovery state. Server retention pressure
has the same shape: it refuses a new identity rather than evicting an
unacknowledged result.

"Durably consumed" means recovery does not depend on the current process or
its stdout. A long-lived provider must commit the complete settlement to its
durable client store. The file arm flushes the replacement bytes and
synchronizes the parent directory after rename before returning success. A
process-per-invocation caller must also use such a
store (the packaged Node arm's file store is the default) or explicitly opt out
of queue custody and accept that stdout/report publication is not durable
recovery. An in-memory injected store is an explicitly reported degraded test
arm, not a durable-consumption claim: automatic queueing is disabled on it and
`queue: true` produces a typed durability refusal before dispatch.
The Expo File/Directory adapter currently reports `durable: false` for this
purpose: its API exposes neither a file/directory sync primitive nor an always
atomic replacement. It may persist RQS cache state but cannot own settlement
publication until the platform supplies that cut.

Piggyback is the normal amortized path: pending ACKs for the same user and
authority-instance cohort
ride a later mutation, excluding that mutation's own id. Standalone
`POST /client-mutations/acknowledge` is the completion path for one-shot
callers and quiet apps. Both are idempotent. A lost or receipt-less ACK response
retains the local obligation and retries it; a successful standalone response,
a successful mutation response, or a rejected mutation carrying the
provider-core receipt proves the server ACK stage ran and permits local GC.
Every successful mutation response echoes its server-derived descriptor, which
the client stores with the settlement separately from the immutable request
descriptor that is part of the replay identity. A descriptor on the standalone request
is re-attested before GC;
local confirmation is restricted to that exact cohort, so a new grant or
authority cannot silently discard an old cohort's only retry proof.

A committed settlement outlives executable-code removal. Before selecting an
active mutation function, the server revalidates the live prepared authority,
compares the supplied descriptor when required, canonicalizes the request
under that authority, and looks up the exact `(clientMutationId, function,
input, auth fingerprint, authority instance)` identity. A hit republishes the
stored result without handler dispatch or successor result-contract
validation. Changed user, grant, authority instance, credential generation,
descriptor, function name, or input refuses with zero dispatch. A miss then
uses ordinary active-function selection; therefore, after authenticated ACK
GC, replay of an id whose function was removed returns
`SNAPBACK_UNKNOWN_FUNCTION`. Renames are removals plus additions and follow the
same rule.

The client removes a local ACK proof only after a successful standalone ACK or
a mutation response proves that the origin ran the piggyback ACK stage. A
successful mutation and a rejected mutation carrying the provider-core receipt
are such proof; a receipt-less proxy/HTTP failure is ambiguous and retains both
the ACKs and the current queued mutation. A request may not acknowledge its own
current id. Acknowledgement and GC are idempotent and auth-bound, so one
principal cannot delete another's replay result.

#### Raw settlement facts and projection ownership (2026-07-20, LLP 0063 Step 1)

**React dispatch handoff (2026-08-10 — LLP 0218 P3).** LLP 0218 owns the
foreground dispatch union and React presentation stamp. Once that facade
resolves `status: 'queued'`, this RFC continues to own the durable mutation
record, retained settlement result, total disposition/status observation,
replay ordering, custody recovery affordances, and result acknowledgement.
Retiring a process-local optimistic layer never discards or rewrites those
durable facts.

The provider exposes facts; it does not collapse uncertainty into a product
state. The raw Snapback facts are the effect-call settlement (pending,
returned, or threw), the optimistic overlay lifecycle and class, the
provider-core mutation receipt when one exists, its correlation identity,
confirmed/rejected outcome, rollback reason, durable snapshot version, and
whether delivery was immediate, late, duplicated, or absent. A receipt-less
timeout remains ambiguous and queued; retry and duplicate delivery retain the
same `clientMutationId` and cannot imply a second effect.

Exact owns the total projection of those facts into renderable attempt,
overlay, and evidence-join state under its LLP 0330/0342/0329 authorities.
Snapback never rewrites a committed Exact outcome when later provider evidence
disagrees; it supplies the receipt/settlement observation so Exact can render
the disagreement. The two-provider fault gate must exercise timeout, retry,
duplicate delivery, idempotent settlement, late confirmation, rejection, and
receipt-less ambiguity against both Snapback's raw-fact seam and a non-Snapback
provider.

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

#### Handler-visible settlement identity (2026-08-08)

A settled duplicate never re-enters the handler, so until now the handler had
no way to name the settlement it was executing. Applications that need an
effect idempotency key — a provider call that must not fire twice for one
logical mutation — were minting their own from `ctx.runtime.id()` and
threading identity arguments through generated calls. The Zerobugs control hit
this twice independently (LLP 0183 D5/D7 seam;
`issues/closed/20260808-handler-settlement-identity-surface.md`).

The mutation handler context therefore exposes the identity the server has
already constructed:

```
await ctx.mutation.settlement()
// { clientMutationId: string | null, settlementId: string | null }
```

- `clientMutationId` is the opaque id the client minted, verbatim, or `null`
  when the request carried none.
- `settlementId` is the durable settlement identity digest — the same
  provenance digest the activity lane already writes
  (`ClientMutationIdentity::activity_digest`), a `sha256:` value over
  `{authFingerprint, authorityInstanceId, clientMutationId, function,
  inputFingerprint[, operationIssuance]}`. It is `null` exactly when
  `clientMutationId` is.

Both fields are read-only own properties of a fresh, frozen, null-prototype
object, and both are derived from the request rather than from handler state.
The identity is replay-stable by construction: the same logical mutation —
same client id, function, auth, and inputs — yields the same `settlementId` on
every entry, including the re-entry that follows a first attempt which threw
before any settlement was retained. It is not host-generated, so it neither
consumes nor extends LLP 0051 D1's ctx-answer ledger and reads identically in
record and replay mode.

`settlementId` is deliberately not named `settlementIdentity`: LLP 0133 uses
that name on the mutation request wire for retained implementation/activation
claims, which are a different fact.

Queries and actions expose the member but refuse it with
`SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE`, thrown without a host round-trip,
following `ctx.jobs.enqueue`. The idempotency key is mutation-only (M1/M2
above): queries are server-authoritative reads and are never queued or
ledgered as writes, and an action's durable work crosses `ctx.runMutation`,
where the mutation it invokes carries its own settlement.

Stated rather than papered over: the hosted coordinator keeps no
client-mutation replay ledger and never echoes `clientMutationId`, so the
hosted arm answers the honest all-null twin. An application that needs a
replay-stable effect key gets one on the local target.

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

#### JS-arm sessions-custody queue — Recorded design (2026-08-03, commissioned at author sitting #2) — RATIFIED (2026-08-04, author sitting #3); implementation authorized as a lane

Commissioned by `issues/20260803-0043-sessions-custody-design.md` (leg 2 of
`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md`). Today the JS
arm (`packages/snapback-client`) deliberately refuses to queue under
browser-session (`AuthCoordinator`) or agent (`AgentAuthorityFence`) custody:
`#offlineQueueStore()` returns null when an authority fence is present, and a
required call fails with `SNAPBACK_OFFLINE_QUEUE_CUSTODY_UNSUPPORTED`. This
recording lands on the working hypothesis — **capture-at-enqueue authority
descriptors + strand-on-authority-change**, the discipline this section
already states and the Contract arm already ships — realized per durable
outbox record on the JS arm's RQS store, not by porting the Contract store's
format-6 epoch machinery wholesale. **The author ratified this recording on
2026-08-04 at author decision sitting #3
(`issues/closed/20260804-author-decision-sitting-3.md`), ruling all four
open points below; implementation is now authorized as a lane.** **Implemented
2026-08-06 by the JS-arm sessions-custody lane (commit 55564b1018eb):** the
refusal above is removed, the per-record custody matrix and recovery surfaces
ship across every RQS store arm, and the card-game acceptance suite witnesses
the sessions-mode rows. One implementation consequence recorded for
completeness: an *unattributable* queue record (no captured
descriptor/principal/custody triple — dev-era or foreign-writer bytes) in a
store observed under a settled authority fence is privacy-deleted at
reconciliation with the same diagnostic count, because it can neither prove
the current principal nor ever be transmitted under a captured authority —
"intent is never queued under unknown authority" extends to observation and
replay.

**Captured at enqueue.** A sessions-custody enqueue is admitted only while the
authority fence is settled (a clearing/unsettled fence —
`SNAPBACK_CLIENT_AUTHORITY_CLEARING` — refuses enqueue, and the caller then
surfaces the original connectivity error; intent is never queued under unknown
authority). The durable record captures, at the enqueue slot, exactly:

- **`authorityDescriptor`** `{ descriptorVersion: 1, authorityInstanceId,
  sessionGeneration }` — the server-issued descriptor from the settled
  session, verbatim. This is the replay-identity axis (this section's queue
  axis) and the value transmitted at replay. `sessionGeneration` is recorded
  observability, not a stranding-equality axis, per the rule above.
- **`principalScope`** `{ authMode, authorizationStreamIncarnation, userId }`
  — the server-proven principal from the settled authority (the same triple
  format 6 uses). Local stranding/attribution axis only; it is never sent as
  authority. Under agent custody the durable principal identity is the grant
  tuple (LLP 0055): token id and carrier generation deliberately do not enter
  queued-replay identity.
- **`custody`** `{ authorityEpoch, authorityKey }` from the fence's capture —
  the local custody fence, persisted so a relaunch can detect records that
  predate a custody transition. `custodyRevision` is excluded: revision churn
  (refresh, sender rotation) must not perturb queue identity.
- The existing arm-neutral fields (`id`/`clientMutationId`, function, args,
  readSet, sequence, `capturedNow` as a labeled claim, optional caller
  ledger). **Never captured:** bearer or any credential material, sender
  keys/nonces, DPoP material, lease state.

The enqueue commits only if the fence capture taken before the write is still
current at the write (capture–validate–commit); a fence transition racing the
enqueue loses, and the caller sees the original delivery error, not queued
success.

**Persistence and privacy at rest.** The descriptor triple and custody pair
are opaque non-credential identifiers. `principalScope.userId` and the
mutation args/ledger are app data in the same at-rest exposure class as the
retained rows already in the same RQS blob; encryption at rest remains this
RFC's open question, unchanged by this design. At every cross-principal
boundary (below) payload-bearing fields (`args`, ledger, readSet, settlement
claims) are stripped before the successor authority can read the store.

**Strand-on-authority-change — the matrix.** Stranding is a durable, visible,
never-replayable disposition: a stranded record is surfaced through
`outboxStatus()` (which gains a `stranded` count) and `subscribeOutbox`, is
never silently dropped from the current principal's own view, and is never
transmitted under a changed authority. The triggers, reconciled with the
Contract arm's shipped format-6 transitions:

1. **Same principal, new authority instance** (re-login as the same user, a
   replacement session): pending and failed records strand **rerecordable** —
   full bytes retained, tagged with the predecessor `principalScope`, reason
   `authority_instance_changed`, `replayable: false`. This mirrors
   `strandCurrentQueue(..., { rerecordable: true })` on the Contract arm.
2. **The LLP 0059 item-5 predecessor matrix governs principal/mode changes.**
   Anonymous → authenticated and dev → sessions pending/failed/quarantined
   records strand rerecordable, as does row 1's same-user replacement. A → B,
   authenticated → anonymous, sessions → dev, and any stream-incarnation
   change are privacy deletion boundaries: payload-bearing predecessor bytes
   are removed before successor observation and the cut is recorded as an
   outbox diagnostic. No stranded record is automatically attributed to or
   replayed under the successor; re-record remains an explicit user action.
3. **Terminal authority loss** (`authTerminalStatus().terminated === true`):
   records stay pending but the drain is inadmissible (below); the eventual
   successor bind resolves them through row 1 or row 2.
4. **Permission-epoch advance (LLP 0053) under an unchanged authority
   instance: suspends locally until proof.** The descriptor is unchanged, so
   the permission advance does not itself strand. The client nevertheless
   persists the exact LLP 0053 query root before ACK and prevents enqueue,
   foreground transport, replay, settlement, and discard from crossing the
   queue-generation cut. Quarantine/error records admitted while suspended
   remain pending and rebase onto the proof generation; delete records are
   immediately payload-redacted and terminal.
5. **Lease expiry: does not strand.** The lease bounds retained *display*
   (M1); the queue axis is the descriptor. Queue custody neither requires nor
   consumes leases.
6. **Bearer refresh of the same opaque instance: never strands** — the client
   already hard-fails a refresh response that changes
   `authorityInstanceId` (`SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID`), and
   this section already pins refresh-preserves-both.

**Replay admission.** The drain adds one custody gate ahead of the existing
resync-first/sequence-order/single-flight discipline: it runs only while the
fence is settled and current, and at each record's submission slot it
compares the stored `authorityDescriptor` and `principalScope` against the
current settled authority **before transport**. Reconciliation applies the
item-5 strand/delete row locally without a round trip — a record must never be marked
`failed` by a refusal the client could prove in advance was an authority
change, and must never be transmitted under an authority other than the one
that captured it. Records that pass the gate replay with the **stored**
descriptor, per this milestone's normative rule (never a newly observed one).

The queue's authorization state has two independent monotones. The
**authority generation** advances atomically in the AuthCoordinator durable
transition, retiring every predecessor root and resolution token before
successor publication. The queue persists the exact durable transition key,
paired with its monotone successor epoch, so a peer tab replaying the same
transition reuses that generation while a genuinely newer transition advances
it and a delayed older transition is refused. Custody reconciliation is bound to
that exact generation, then deletes or strands predecessor records before the
successor may observe them. The **queue
generation** advances on root/proof changes. Enqueue stamps both generations;
enqueue compare-and-commits the captured pair; prepare returns the exact pair;
the shared authorization dispatch gate is acquired at the exact pre-transport
cut and retained through successful settlement, ACK collection, or terminal
local disposition; raw transport and post-dispatch authority failures release
it with the pair still compare-and-committed by any later disposition. Root
installation therefore cannot split transport from its successful durable
consume. Re-entry and every destructive disposition also compare-and-commit
the pair. Delete roots immediately payload-redact pending, failed,
quarantined, and rerecordable stranded intent into terminal discard-only
records. Root, proof, acknowledgement-token, and scope
retirement operations separately compare-and-commit the captured authority
generation, so a predecessor task cannot reinstall custody after an authority
advance. Generation capture rejects typed normalization unavailability and
never substitutes the generation current at eventual commit time.

Authorization observation is a split projection. A readonly, validated
`authorizationQueue` always exposes payload-free metadata with the real
`authorityGeneration`, `generation`, `suspended`, `pendingScopeCount`, and
`effectiveDisposition`; this projection does not wait for a destructive
legacy-record rewrite. Records, acknowledgement custody, and inspection stay
blank until the exact writer has committed that rewrite and the requesting
context has confirmed the durable bytes by reread. IndexedDB routes the
normalization request across tabs/workers to the exact long-held Web-Lock
holder, which acknowledges only after its transaction completes; a realm-local
object registry is not a writer broker. If there is no reachable holder, the
payload-bearing projection is typed unavailable rather than fabricating queue
metadata. A proof or authenticated retirement releases local presentation only
after the exact matching queue transition is durable. Authorization-root,
authority-transition, and custody-reconciliation writes remain the narrow
exceptions to the long-held drain-writer lock: any tab owning the live query or
transition may commit the cut in the shared transaction domain, while a short
cross-tab Web Lock serializes it with writer transport.

The server remains authoritative regardless of captured claims — captured
facts are claims, and possessing a descriptor never authenticates a caller.
At replay the server, in its owned precedence order: resolves the request
credential (invalid/expired/revoked/superseded fail here with their
credential-preparation codes); prepares the invocation authority; compares
the transmitted descriptor — a valid credential whose prepared authority
differs from the queued descriptor, and every absent/malformed/
unknown-version descriptor, refuses `SNAPBACK_AUTH_STALE_RESULT` with zero
dispatch — then performs settlement lookup and ordinary execution, where
handler and authorization refusals produce their own typed outcomes. On the
client, `SNAPBACK_AUTH_STALE_RESULT` on a replayed record is recorded as
**stranded** (authority changed), while content refusals keep
drop-and-mark-**failed**; both are terminal and never retried, so the
exactly-once discipline is unchanged (the taxonomy is ratified point 2,
ruled at sitting #3).

**Settlement presentation and recovery affordances.** The shipped
descriptor-cohort discipline extends unchanged: `settledMutations()` /
`markMutationSettlementsConsumed()` re-attest the current authority and
expose only the matching user/descriptor cohort, and acknowledgement remains
one authority cohort per request (`SNAPBACK_OUTBOX_ACK_AUTHORITY_UNKNOWN` /
`_MIXED`). Recovery for stranded records is explicit and app-driven: a read
surface listing stranded records (the current principal's own, rerecordable
ones with full bytes), an explicit discard, and — for rerecordable records
only — explicit re-recording, which mints a **new** `clientMutationId` under
the current descriptor. Re-recording is a new intent, not a replay: the old
settlement identity is bound to the old descriptor and carries no
exactly-once bridge across authorities (the affordance shape is ratified
point 4, ruled at sitting #3).

**Interaction boundaries.**

- **M1 lease custody (implementation leg landed 2026-08-10):** independent
  axes. This queue design neither requires nor provides leases. Generated
  protected live queries may now retain through the JS-arm composition above;
  unsupported references/protocols still report
  `SNAPBACK_RETENTION_NOT_RETAINABLE`. Sessions-custody queueing remains
  independent and queue-before-lease remains valid.
- **LLP 0090 retained snapshots:** the D3 outbox rule is unchanged — token
  resume only over an empty outbox, fail-closed. Sessions-custody **pending**
  records hold that gate exactly like dev-custody ones; **stranded** records
  are terminal and do not.
- **Contract arm (remaining deliberate asymmetries, named):** (a) both arms
  now ingest LLP 0053 queue-obligation suspension (matrix row 4); (b) no port of
  format-6 `bindAuthority`/`transitionAuthority`/`terminallyUnbound` store
  machinery — the JS arm fences through the coordinator plus per-record
  descriptor/principal/custody equality, and its terminal cut is the
  authority fence's custody clear plus `authTerminalStatus`, not a store
  format bit. Everything else — capture-at-enqueue requirement, stranding
  dispositions, cohort-scoped ACK — matches the Contract arm's semantics.
- **LLP 0166 (Accepted):** the store Spec consumes this RFC's custody,
  outbox, and settlement contracts unchanged; its pending-intent
  precondition applies to sessions-custody pending records identically.
  Nothing in this design imports LLP 0166 machinery as a built dependency.

**Ratified points (2026-08-04, author decision sitting #3)** — each was a
genuine under-determination of the hypothesis, recorded 2026-08-03 as an
open alternative; each is now ruled. The design text above stands as
recorded; the rulings resolve the alternatives:

1. **LLP 0053 queue-obligation ingestion — SUPERSEDED 2026-08-16 by author
   ruling.** The earlier server-refusal-only v1 ruling is retained here as
   history, but no longer governs: the JS arm persists `pendingByScope`,
   enforces the two-generation suspension fence at every queue lifecycle cut,
   and redacts delete-disposition records at obligation delivery.
2. **Stranded-vs-failed taxonomy for `SNAPBACK_AUTH_STALE_RESULT` on
   replay — RULED: the refinement stands.** An authority-change refusal at
   replay surfaces client-side as *stranded* (a custody outcome, with the
   re-record recovery affordance), exactly as recorded — still terminal,
   never retried. Content refusals stay drop-and-mark-*failed*. (Ruled at
   sitting #3.)
3. **Cross-principal disposition — RULED: delete-with-diagnostic-count**
   (Contract parity, matrix row 2). The principal change is a privacy
   deletion boundary: no payload-free redacted tombstones, and nothing is
   retained for, attributed to, or replayed under the successor. (Ruled at
   sitting #3.)
4. **Rerecord affordance shape — RULED: explicit
   read/discard/re-record-as-new-`clientMutationId`.** Re-recording mints
   a new intent under the current descriptor; there is no automatic
   re-submission and no exactly-once bridge across authorities. (Ruled at
   sitting #3.)

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

## LLP 0135 acceptance fold — 2026-08-02

M2's all-or-nothing changeset presentation rule gains one withholding case: if
any row in a changeset requires sequence-projected placement, the client
withholds the entire changeset from optimistic presentation until settlement
returns the authoritative allocation. It may not guess, locally allocate, or
show the unaffected subset. This extends the existing changeset-atomicity
rule and does not claim the sequence surface or its client projection is
implemented.

## LLP 0157 acceptance boundary — 2026-08-03

Accepted LLP 0157 owns `QueryMaterializationKeyV1` (`qmk1`), completeness
proofs, and the retained-fragment seam for composed reads. This RFC continues
to own carrier custody, leases, fences, pending-intent preservation, and
crash-safe migration. A legacy `retainedQueryKey(name,args)` record adopts
`qmk1` only when the exact registered plan, function reference, activation,
canonical arguments, and authority partition are recomputable and payload,
lease, fence high-waters, obligations, and pending-intent references move
atomically. Otherwise it remains non-renderable under its old fence until a
fresh sync creates the new address, then retires; it is never relabeled in
place. This boundary changes no implementation or capability claim here.

**Dated boundary note (2026-08-03, LLP 0166 acceptance):** Accepted
LLP 0166 is the Move-2 owning Spec for the client local persistent
store; this RFC's custody, lease, outbox, and settlement contracts are
consumed by it unchanged. The adoption arms of the boundary note above
are pinned for v1: the atomic-move arm is **not exercisable** while the
lease store and LLP 0166's domain remain separate artifacts (no
transaction spans them), so v1 convergence is the fresh-sync arm only,
executed **close-predecessor-first** — the predecessor instance's
LLP 0053 terminal retirement *begins* (durably non-renderable) before
any successor establishment is published, and *finalizes* after — with a
pending-intent precondition: a convergence attempt refuses while pending
outbox intent depends on the predecessor, waiting for settlement or
explicit discard. Direct atomic adoption awaits a future dated step
moving the lease store into the shared transaction domain (LLP 0166
OQ5). No custody semantics change here.

**Dated boundary note (2026-08-03, `single_table_v1@1` owner
acceptance):** a QMK materialization held under
`rqs-authority-independent-snapshot-v1` remains labeled `retained`, never
`current`, while offline. Pending outbox intent withholds the legacy token
resume path and takes full resync then replay, but it does not blank an
otherwise verified retained display. The class uses LLP 0157 proof, witness,
fence, and trusted-activation custody rather than an `AuthorizedLease`; this
note adds no lease envelope and changes no outbox lifecycle. Acceptance is
semantic only and grants no implementation or capability claim.

## Amendment (2026-08-03 — LLP 0162, effective with its acceptance)

Accepted LLP 0162 (with LLP 0163 carrying the contracts) touches this RFC's
lifecycle as follows; the core rules are affirmed, not weakened.

- **Affirmed:** unacknowledged results are never evicted; capacity refuses
  new identities; operator purge explicitly forfeits exactly-once.
- **Added:** reclamation of acknowledged identities inside a still-open
  issuance epoch leaves a payload-free tombstone until the audience floor
  passes the epoch, so a reclaimed identity can never re-execute as novel.
  A retry answered from a surviving compact envelope receives
  `result-expired` (outcome-known, payload gone) instead of the stored
  result — a client-visible change owned here by dated revision. The
  per-audience epoch floor is a retention mechanism owned here: a retry
  bearing an epoch below the floor refuses with `identity-horizon-passed`,
  an explicit outcome-unknown disposition that clients must never record
  as a terminal `failed` (LLP 0012/0095 carry the client obligation).
  Offline
  minting draws on server-preallocated authenticated finite identity
  ranges; exhaustion while offline degrades to disclosed uncovered local
  queueing with refresh at reconnect. This RFC owns the ACK/retention and
  range size/window parameter values (LLP 0133 owns collision/identity
  semantics and LLP 0163 the schemas and disposition spellings; they
  reference these parameters rather than fixing them).

### Dated v1 parameter record (2026-08-03 — LLP 0163 durable slice)

The implemented v1 server bounds are a maximum **256 identities per
authenticated client range**, at most **four contiguous ranges / 1,024
identities in aggregate per authenticated client epoch**, and a maximum
**30-day issuance window**. The aggregate aligns with the existing 1,024-record
client outbox and per-auth settlement limits. Smaller ranges, fewer ranges,
and shorter windows are valid. Exact response-loss recovery may re-serve the
already committed unadmitted successor; a fifth range refuses atomically with
`SNAPBACK_OPERATION_RANGE_EXHAUSTED` and continued admission requires a fresh
authenticated session/epoch. An identity-null intent may atomically adopt that
fresh descriptor/range only after its durable principal id matches the fresh
authenticated principal; otherwise it remains pending with
`uncovered-reauth-required`. An admitted result that has not been
receipt-proven acknowledged has no time-based eviction and therefore holds its
epoch open. On ACK, the replay payload is immediately eligible for reclamation;
if the epoch floor has not passed it, reclamation writes a payload-free
tombstone atomically. That tombstone retains separate domain-separated digests
of the complete identity and its authorization facts, plus the counter
projection, outcome, and receipt digest; exact agreement returns
`result-expired`, authorization divergence
returns `SNAPBACK_AUTH_STALE_RESULT`, and other identity divergence returns
`SNAPBACK_CLIENT_MUTATION_ID_REUSED`. The tombstone is deleted only when the
per-audience floor advances over the contiguous closed epoch prefix; closing a
later epoch cannot leap any lower nonclosed epoch. Terminal and pending writer
insertion transactions re-run this retained classifier before publication, so
a pre-handler lookup cannot authorize replay after reclamation. These are the
constants and lifecycle rules exported by
`crates/snapback/src/operation_ledger.rs`; changing them requires another dated revision and
updated lifecycle corpus.

### Dated C28 lifecycle reconciliation (2026-08-05)

This record supersedes any earlier reading that bounded only an individual
range while permitting unbounded same-epoch successors, or that allowed any
closed epoch to advance the floor independently of lower sequences. The
payload-free digest projections and the 1,024-identity aggregate cap are
normative retention parameters; they do not advertise a capability. LLP 0043
remains Draft and all related capabilities remain `Missing` until LLP 0162's
publication gates pass.

## Terminology note (2026-08-03) — "cold process" proof classes

The corpus has used "cold process" for two materially different proof
classes (`issues/closed/20260801-cold-process-claim-vocabulary-collision.md`,
found by the LLP 0129 super-refine). This note pins the vocabulary for
this document; no normative claim changes.

- **Fresh wrappers over retained state in one process:** the witness
  constructs new client wrappers in the same OS process over explicitly
  retained store state. This is the class the "cold process" beats in
  §Acceptance and §Status actually execute today — the Contract-arm
  `demos/card-game/tests/acceptance/authority-scope.mjs` (new wrappers
  over shared memory-store state) and the JS-arm
  `demos/public-dashboard/tests/acceptance/offline-local-first.mjs`
  (whose check labels were renamed to "fresh client instance (same
  process)" on 2026-08-01).
- **Genuinely process-isolated restart:** the client process terminates
  and a new process renders from durable state alone. No current suite
  proves this class; the owning ticket for that witness is
  `issues/20260801-js-arm-integrated-authenticated-restart-witness.md`
  (the LLP 0129 exit-criterion 1/2 conjunction).

Wherever "cold process" appears in this document it claims the first
class only. The lease, deletion, and rendering rules it states are
unchanged.
