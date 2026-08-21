# LLP 0290: Database-bound authorization commit participant and sync outbox split

**Type:** Spec  
**Status:** Accepted  
**Systems:** Security/authorization, Rust core, Storage, Live/realtime, Auth, Verification  
**Author:** codex `gpt-5.6-sol`, synthesizing two independent blind designs — codex
`gpt-5.6-sol` and grok-4.6 — orchestrated by Claude (Opus 5) for Charlie Cheever  
**Date:** 2026-08-20  
**Revised:** 2026-08-21 (caller-boundary closure: authorization outcome lookup,
issuer projection, and kernel settlement are checked after-Local work. The
owner drains the complete batch after releasing Local but before reporting the
initiating operation's outcome. Any checked failure enters the same sticky
`SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` transition, retains the exact
dependency, and returns the typed refusal to the initiating direct or managed
caller. Direct mutation receipts retain committed durable truth; reset and
mode-provision callers classify the already-durable cut as commit-uncertain.
Reset handoff tests now prove a writer is queued while finalization fails and
wakes only after the lasting fail-closed state is installed.)
**Revised:** 2026-08-21 (post-review closure: activation now requires an opaque,
exact-registry `AuthorizationIssuerProjection` whose live lease is retained by
the installed issuer; every issuer clear suspends before removal and advances
an epoch that invalidates every pre-clear carrier. The ready
latch validates that live lease and its exact registry/generation/incarnation
at reservation and bind. Participant replacement refuses a known committed
dependency until its deferred finalizer drains. Seed and versioned-seed
adapters return witness-bearing carriers; because a source-public caller can
still discard such a carrier after durable commit, an unprojected or otherwise
invalid deferred finalizer latches the interlock fail-closed and retains its
dependency instead of panicking. Destructive server reset transfers an opaque
closed-handoff token from the committed transaction through finalizer drain,
reset publication, predecessor suspension, and exact successor-issuer install.
Success reopens only after exact successor installation; postcommit failure
reopens the transient writer-ordering handoff only after issuer projection is
suspended/cleared and the coordinator has installed its lasting typed global
refusal. The reset-only writer preserves the generic writer's activation split:
the `Disabled`/`ParticipantBound` states execute in one direct Local turn, while
`ParticipantReady` requires its exact live issuer-backed reservation; either
known-commit branch transfers the same closed handoff.)
**Revised:** 2026-08-21 (implementation hardening: `ParticipantReady` now
includes a release/acquire issuer-projection availability latch. Public issuer
clear and committed-reset cleanup suspend it before dropping either issuer
projection; authorization reservation and transaction bind fail closed while
suspended, including for a reservation minted before the clear. A committed
reset rebuild reuses exact database activation while the managed writer handoff
remains closed, and installs the successor issuer copy before that handoff
reopens; it has no caller-selected bypass. Missing or too-narrow reservations
under an otherwise available projection retain the existing
`SNAPBACK_AUTH_RESERVATION_STALE` identity.)
**Revised:** 2026-08-20 (b — answers the grok-4.6 LLP 0005 review that returned
NEEDS REVISION: separates issuer projection from kernel settlement in the real
ordinary-effects-before-finalizers order; puts pending/bound/ready participant
state on `LocalDatabase` and makes transaction bind perform the exact A-beside-B
check; moves activation from backend construction to the existing auth-
invalidation enable point; and enumerates every production
`room_authority.state` access)
**Revised:** 2026-08-20 (a — initial blind-design synthesis)  
**Related:** LLP 0285 (§5.2, §6 step 8, §8 risk 4), LLP 0283 (Method lessons 1–2), LLP 0284, LLP 0225, LLP 0276, LLP 0059, LLP 0053, LLP 0005

> **Independence caveat, recorded deliberately.** The two source designs were
> commissioned blind from different model families and neither saw the other. The
> SYNTHESIS, however, was written by the same family as one of the two sources. LLP
> 0283's F-2 lesson is that an author should not adjudicate work it produced, so the
> LLP 0005 review of this document should be sought from a family other than codex —
> and the places where this spec picks the codex source over the grok source deserve
> the most scrutiny.
>
> **Review state.** A grok-4.6 LLP 0005 review — deliberately from a model
> family other than the codex synthesizer — returned **NEEDS REVISION**. Revision
> (b) answered its four load-bearing findings and the same reviewer returned
> **READY**, confirming LLP 0285 §8 risk 4's two named failure modes are closed at
> the specification level.
>
> **Accepted 2026-08-20 by Charlie Cheever. LLP 0285 §6 step 8 is UNBLOCKED.**
>
> Acceptance is of the SPECIFICATION and does not assert the design compiles. The
> reviewer explicitly left open compilation and borrow-shape validation, complete
> producer/caller coverage, exact outcome-lookup uniqueness, and whether a
> kernel-opaque receipt can prove the auth-owned issuer stored its view without
> creating an upward dependency. LLP 0285 §8 risk 7 records that nothing in the
> source designs was ever compiled; that debt is inherited here and must be
> discharged by implementation, not assumed.
>
> **Interaction with LLP 0292.** The straight-path plan rebuilds the authority-
> CREATION surface and explicitly preserves LLP 0059's room, outbox, rollback and
> ambiguity algorithms. This document moves the room-authority MECHANISM into the
> kernel — a different concern — so step 8 may proceed in parallel with the
> chokepoint work rather than waiting behind it. If 0292's final shape absorbs step
> 8, that supersession must be recorded here rather than left implicit.

## Summary

LLP 0285 requires the authorization-commit and room-authority mechanism to move from `snapback-sync` into `snapback-kernel`, but §8 risk 4 correctly blocks that move until `AuthorizationCommitParticipant` is concrete.

This specification resolves that risk:

- `snapback-kernel` owns a database-bound `RoomAuthorityRegistry`, dependency tickets, selectors, reservation binding, settlement, publication permits, committed authorization state, and level-triggered room reauthorization obligations.
- `snapback-sync` continues to own `SharedOutbox`, `OutboundQueue`, `OutboxDrainLease`, `AdmittedRealtimeEnvelope`, `ConnectionEffectFence` queue matching, room subscriber policy, resync materialization, and transport handoff.
- `AuthorizationCommitParticipant` has private fields, no public constructor, no `Clone`, and no public terminal-settlement method. A serving database is the sole production mint.
- Installation uses a pending/bound/ready handshake whose authoritative state
  replaces `LocalDatabase.authorization_interlock: bool` at
  `crates/snapback-kernel/src/storage.rs:1301-1342`. Backend construction reaches
  `ParticipantBound` only; the existing auth-invalidation enable point reaches
  `ParticipantReady`. Ready also carries an acquire/release projection-
  availability latch bound by weak lease to one opaque exact-registry issuer
  projection: issuer removal suspends the latch before dropping the issuer, and
  only database-validated activation with that live carrier reopens it.
  Reservation and transaction bind both compare the live projection against
  the exact ready registry, generation, activation identity, and incarnation.
  A participant minted by database A cannot settle a transaction on database B.
- A public, opaque `AuthorizationCommitReservation` remains because the current server and engine carry it through the independently owned blocking task. It has no public constructor and no public bind method.
- `PreparedAuthorizationCommit` is `pub(crate)`. Its kernel-only `finalize_committed`, `finalize_rolled_back`, and `finalize_ambiguous` methods accept no closure.
- Seed, reset, and versioned-seed adapters that can commit authorization changes
  return witness-bearing carriers instead of output-only results. A discarded
  same-incarnation carrier cannot make the already-durable transaction
  disappear; its checked deferred finalizer retains the exact dependency and
  poisons the projection latch with a typed fail-closed error rather than
  panicking. The batch owner must observe that error before reporting the
  initiating operation as finalized.
- Known commit settlement is a kernel finalizer, not a sync acknowledgement.
  Same-incarnation issuer projection remains an ordinary after-Local effect and
  consumes only a kernel-minted committed outcome; settlement remains a
  distinct finalizer. Destructive rotation retains the tree's existing
  exception: no predecessor issuer is advanced across incarnations, so the
  kernel advances projected and durable facts together in its finalizer and
  the successor issuer binds afterward. The two phases are deliberately
  separate because the tree runs ordinary effects before finalizers
  (`crates/snapback-types/src/exec_guard.rs:193-241`).
- Outbox draining becomes a sync-owned free function or inherent method on the sync-owned backend. It holds a finite kernel admission guard, calls sync-private queue selection, revalidates selected envelopes, and constructs the sync-owned lease wrapper with its load-bearing field order intact.
- LLP 0059’s lock order, premark-before-write, retained-work draining, exact rollback, and fail-closed ambiguity rules remain unchanged.

No `dyn Fn`, `dyn FnMut`, `dyn FnOnce`, `impl Fn`, `impl FnMut`, or
`impl FnOnce` appears in any `snapback-kernel` public signature introduced by
this design.

## Provenance

Two designs were commissioned blind from different model families. Neither source saw the other:

1. **Source design 1 — codex `gpt-5.6-sol`.** It supplied the pending/ready database installation handshake, exact registry identity comparison, kernel-owned authorization expectation view, direct kernel finalization, rechecking outbox admission guard, lease-before-permit rule, and the inventory of sync accesses beyond `drain_outbox`.
2. **Source design 2 — Grok 4.6.** It supplied the database-owned registry posture, sticky registry retirement and generation checks for same-database replacement, exact as-built outbox classification requirements, the collection-generation bind check, the explicit retained-owner and finalizer-site analysis, and the compile-green dual-path migration requirement.

Both designs agreed on the central conclusions:

- The callback factory must be deleted, not relocated.
- The participant must be database-bound and non-forgeable.
- `PreparedAuthorizationCommit` must become kernel-private.
- Bind must not acquire a registry mutex under Local or SQLite.
- The registry cannot carry its present `drain_outbox` method into the kernel.
- Sync must retain its queue, lease, effect-fence, subscriber, and transport responsibilities.
- Ambiguity must retain the exact ticket indefinitely.

Where they disagreed, this synthesis records the choice explicitly in the next section.

## 1. Synthesis decisions at each divergence

### 1.1 Registry ownership and installation

**Disagreement.**

- Source 1 stored the registry principally through the participant and recorded a `Weak` registry in the database’s pending/ready interlock.
- Source 2 made the registry database-owned, with sticky `retired` and generation state, but treated the database-binding rejection primarily as a bind-time check.

**Decision.** Combine the stronger parts:

- The serving database owns a strong `Arc<RoomAuthorityRegistry>`.
- Installation uses Source 1’s pending/ready identity handshake, with an added
  bound-but-dormant state so construction does not enable earlier than the tree.
- The handshake state lives on `LocalDatabase`, replacing the Boolean at
  `crates/snapback-kernel/src/storage.rs:1337`; `ServingDatabase` owns and mutates
  that database at `storage.rs:1380-1395`.
- Transaction bind is the authoritative A-beside-B check: it receives the
  `ParticipantReady` registry from that `LocalDatabase` state and compares the
  reservation binding, exact registry `Arc`, and generation. Construction-time
  binding is earlier diagnostics and composition defense, not the closure proof.
- Source 2’s sticky `retired` flag and registry generation handle controlled same-database replacement.

A bind-time rejection is the load-bearing LLP 0285 §8 risk-4 proof because it
runs on the database that will commit. The earlier construction check remains
required so a mismatched backend never becomes the composed backend or starts
registering rooms. Both checks are exact; neither substitutes a string id for
`DatabaseBinding::matches` or `Arc::ptr_eq`, whose current identity semantics
are at `crates/snapback-kernel/src/storage.rs:532-573`.

### 1.2 Participant fields

**Disagreement.**

- Source 1 proposed the minimal `{ binding, registry }`.
- Source 2 added a registry generation and separated a cloneable internal handle from the non-cloneable participant.

**Decision.** Use explicit binding, exact registry, registry generation, and a
take-specific `Arc<AuthorizationParticipantActivation>`. The activation object
is both the unforgeable take identity and an atomic readiness mirror readable by
the participant; the authoritative pending/bound/ready record remains the field
on `LocalDatabase`. Do not expose a public handle getter. The generation detects
same-database registry replacement; the activation identity detects stale or
substituted pending participants.

### 1.3 Protected-collection custody and prepare input

**Disagreement.**

- Source 1 maintained an authoritative protected-room catalog in the kernel registry; prepare used that catalog.
- Source 2 passed `collections`, collection generation, and issuer expectation into every reserve call. Its reviewed revision correctly restored an atomic collection-generation check at bind.

**Decision.** Use Source 1’s registry-owned catalog and Source 2’s mandatory revision reload at bind.

The transaction-reservation caller must not choose a different collection cut by passing an arbitrary slice to `prepare_authorization_commit`. Sync remains the policy owner and updates the catalog only through the collection-definition lifecycle. Prepare snapshots the registered catalog internally. Bind acquire-loads the catalog revision and rejects drift before evaluating selector coverage.

This does not make the kernel the author of room policy. It makes one already-published policy cut authoritative for one reservation.

### 1.4 Reservation visibility and TLS custody

**Disagreement.**

- Source 1 made the concrete reservation `pub(crate)` and had participant prepare install it directly in the thread-local slot.
- Source 2 retained a public, opaque reservation because server and engine code carry it into the independently owned blocking task.

**Decision.** Retain the public opaque reservation, from Source 2.

Moving preparation and TLS installation wholly into every blocking owner may ultimately be possible, but neither blind design compiled that relocation. The current retained-owner choreography already carries an opaque reservation safely. Its fields and bind method are private, so it is **POWERLESS** rather than forgeable.

### 1.5 Commit settlement and issuer ordering

**Disagreement.**

- Source 1 finalized directly inside a kernel after-Local finalizer and replaced the mutable issuer projection with a kernel-owned expectation view.
- Source 2 used `SettlementSlot` and a sync-drained `BoundSettlement`: sync published the issuer, then consumed a concrete finalize token.

**Decision.** Keep Source 1's kernel-owned terminal settlement, but reject the
part of Source 1 that made the issuer a live read-through of settled registry
state.

Source 2 removed callbacks, but it still split a known commit into a kernel “ready” fact and a sync-selectable terminal action. That preserves more settlement authority above the kernel than LLP 0285’s “kernel derives, never accepts” rule allows. A caller able to drain and finalize a settlement could skip issuer publication or reorder it.

The tree already has two after-Local buckets: storage commit hooks enqueue while
Local is active, `AfterLocalBatch` captures ordinary effects separately from
finalizers, and `run_after_local_batch` runs every ordinary effect before any
finalizer (`crates/snapback-types/src/exec_guard.rs:118-141,193-241`). The
current room carrier instead fuses issuer publication and room settlement in
one finalizer (`crates/snapback-sync/src/ephemeral.rs:4273-4307,4688-4702`), even
though the scheduler explicitly names issuer work as ordinary projection
(`crates/snapback-types/src/exec_guard.rs:193-201`). Revision (b) removes that
contradiction.

Both buckets admit checked authorization work. The drain still runs the whole
ordinary bucket and then the whole finalizer bucket, retaining the first typed
failure. The caller that owns the Local scope may defer the work with respect
to the lock, but may not defer its verdict past the operation boundary: direct
embedders, managed writer tasks, nested action hosts, and reset handoff owners
all drain and inspect the batch before returning. This preserves the lock
ordering without introducing a plain-success “projection pending” state.

The kernel now owns two distinct facts:

- `projected_authorization`, advanced only during the ordinary effect phase by
  presenting an exact kernel-minted `AuthorizationCommitOutcome`; and
- `durable_authorization`, advanced only by the kernel settlement finalizer.

`LiveInvalidationIssuer` binds an `AuthorizationExpectationView` over the first
fact, not the second. For a same-incarnation commit, the finalizer requires
proof that the exact issuer projection occurred, then settles the ticket. A
missing or panicking ordinary projection therefore skips or refuses
finalization and leaves the room ticket installed, matching the fail-closed
scheduler behavior at
`crates/snapback-types/src/exec_guard.rs:199-201,231-241`. For destructive
rotation there is deliberately no predecessor-issuer projection: the current
code skips it at `crates/snapback-sync/src/ephemeral.rs:4279-4283,4698-4701`,
and the kernel finalizer installs the successor into both projected and durable
state before the server authenticates and binds the new issuer. No sync
acknowledgement selects commit, rollback, or ambiguity.

### 1.6 Outbox rewrite

**Disagreement.**

- Source 1 proposed a finite admission guard that classifies during queue selection and reclassifies selected envelopes before minting permits.
- Source 2 specified the current classification predicates, retired-registry failure posture, and sync-owned backend method in more detail.

**Decision.** Combine both:

- Use Source 2’s exact current classification semantics.
- Use Source 1’s second kernel-side validation before permit minting.
- Keep Source 1’s explicit lease-before-permit field order.
- Return an empty batch on admission failure, as Source 2 specified.

### 1.7 Unbound backends

**Disagreement.**

- Source 1 preferred removing direct authorization-capable `new` and `Default` constructors.
- Source 2 retained an unbound backend for standalone room and queue tests.

**Decision.** Preserve an explicitly non-authorizing unbound backend for compatibility. It may register rooms and drain queues, but it cannot enable the storage interlock, prepare an authorization commit, bind a durable authorization expectation, or finalize a transaction ticket.

No public or feature-gated participant factory is introduced for tests.

### 1.8 Same-database room-authority replacement

**Disagreement.**

- Source 1 specified exact-instance activation but not the existing fresh-room-map replacement path.
- Source 2 specified replacement by retiring the old registry `Arc` and minting a new generation.

**Decision.** Adopt Source 2’s retirement mechanism within Source 1’s
pending/bound/ready database handshake. Old reservations, permits, guards, and
participants fail closed after replacement.

### 1.9 Initial durable authorization

**Disagreement.**

- Source 1 required the kernel to read initial durable authorization state itself.
- Source 2 exposed participant installation of a durable authorization expectation from sync.

**Decision.** Choose Source 1. A participant accepts no initial
`AuthorizationVersion`. The serving database reads the durable authorization-
stream row while initializing the bound participant at the existing auth-
invalidation enable point, immediately before it can become ready. It does not
trust the earlier value carried back to engine code by boot-issuer reservation,
although the two exact versions must compare equal before activation.

### 1.10 What moves from `finish_room_authorization_commit`

**Disagreement.**

- Source 1 replaced issuer publication with a kernel view and moved terminal registry settlement into the kernel.
- Source 2 kept an explicit sync settle operation because the current function also publishes the issuer and enqueues resync frames.

**Decision.** The current function does not move intact. For a
same-incarnation commit, its present order is issuer publication followed by
registry finalization
(`crates/snapback-sync/src/ephemeral.rs:4688-4702`), but both operations are
currently invoked from the finalizer callback at `ephemeral.rs:4273-4307`.
Revision (b) preserves the relative order while placing the operations in the
two phases the tree already provides:

- Kernel settlement and committed authorization state move.
- Mutable caller-supplied issuer installation is replaced by an opaque
  expectation view plus exact outcome projection during the ordinary effect
  phase.
- Destructive rotation keeps the current no-predecessor-publication branch
  (`ephemeral.rs:4279-4283,4698-4701`): the finalizer advances both kernel facts,
  and the later reset-owned issuer rebuild binds a view of the settled
  successor.
- Sync-owned subscriber enumeration, resync frame construction, outbox enqueue, and notifier work stay in sync.
- Those sync actions observe level-triggered obligations; they do not acknowledge or complete the kernel settlement.

## 2. Governing constraints

This design is governed by four existing rules.

### 2.1 LLP 0285 closure test

Every capability must be:

1. **UNNAMEABLE:** kernel-`pub(crate)`; or
2. **POWERLESS:** public but unable to assert an unverified durable or settlement fact.

Opaque but powerful is not closed.

### 2.2 LLP 0283 Method lesson 1

No authority-bearing parameter may become:

- a public enum variant;
- a self-implementable public trait;
- a public closure factory;
- a claimable universal root; or
- a public carrier with a caller-selectable terminal method.

### 2.3 LLP 0283 Method lesson 2

An inherent implementation must live with its defining type. Once the registry moves into `snapback-kernel`, `snapback-sync` cannot add `impl RoomAuthorityRegistry`. Queue composition must therefore live on a sync-owned type or as a sync-owned free function.

### 2.4 LLP 0225 ownership and commit boundary

The kernel owns the interlock mechanism and the only SQLite commit primitive. Sync owns ordering, fan-out, queue settlement, and transport—not transaction settlement or durable authorization facts. The kernel may depend only on the contract/type leaf and may not depend upward on sync or auth.

## 3. Concrete types and field privacy

### 3.1 `AuthorizationCommitParticipant`

```rust
pub struct AuthorizationCommitParticipant {
    binding: DatabaseBinding,
    registry: Arc<RoomAuthorityRegistry>,
    registry_generation: u64,
    activation: Arc<AuthorizationParticipantActivation>,
}
```

```rust
struct AuthorizationParticipantActivation {
    state: AtomicU8, // PENDING, BOUND, READY, or RETIRED; kernel-private constants
}
```

All fields are private.

The type has:

- no `Clone`, `Copy`, `Default`, `Serialize`, `Deserialize`, `From`, or `TryFrom`;
- no public `new`, `from_*`, `mint_*`, `claim_*`, or test-support constructor;
- no public method returning its `DatabaseBinding`, registry `Arc`, activation identity, or a general-purpose registry handle;
- no public bind or terminal-settlement method;
- no callback-accepting method.

`Send` and `Sync` may arise automatically from the fields. They are not manually asserted.

Field purposes:

- `binding` names the one database allocation.
- `registry` names the exact process-local room-authority graph.
- `registry_generation` detects replacement of that graph for the same database.
- `activation` binds this take operation to the pending database slot and lets
  prepare acquire-load whether the owning database has enabled the exact
  participant. It is not the source of the transaction bind check.

The current tree has only `DatabaseBinding` plus callback-factory identity
(`crates/snapback-kernel/src/storage.rs:532-605,661-843`); these concrete fields
replace that callback identity rather than wrapping it.

### 3.2 Registry

```rust
pub(crate) struct RoomAuthorityRegistry {
    binding: DatabaseBinding,
    generation: AtomicU64,
    retired: AtomicBool,
    catalog_revision: AtomicU64,
    state: Mutex<RoomAuthorityRegistryState>,
    quiescent: Condvar,
}
```

```rust
struct RoomAuthorityRegistryState {
    next_ticket: u64,
    dependencies: BTreeMap<u64, RoomDependencyPending>,
    rooms: BTreeMap<RoomId, RoomAuthorityControl>,
    durable_authorization: Option<AuthorizationVersion>,
    projected_authorization: Option<AuthorizationVersion>,
    projected_commits: BTreeMap<u64, AuthorizationVersion>, // exact ticket id -> successor
    active_durable_publications: usize,

    protected_collections: Arc<[EphemeralCollection]>,
    protected_collection_revision: u64,

    next_outcome_sequence: u64,
    latest_committed_outcome: Option<AuthorizationCommitOutcome>,
}
```

The type and every field are kernel-private.

Initial values:

- `generation = 1`;
- `retired = false`;
- `catalog_revision = 1`;
- `next_ticket = 1`;
- no dependencies or rooms;
- `durable_authorization = None` until auth-time initialization;
- `projected_authorization = None` until that same initialization;
- no projected-but-unsettled commits;
- no active durable publications;
- an empty protected catalog at revision 1;
- `next_outcome_sequence = 1`;
- no committed outcome.

The participant never accepts the initial durable authorization from sync,
engine, auth, or a test factory. Immediately before readiness, the bound
`ServingDatabase` reads the complete pair through the kernel's pinned-snapshot
reader (`crates/snapback-kernel/src/storage/auth_stream.rs:405-429`) and writes
that kernel-read value into both fields while the registry has no dependency,
active permit, pending room mark, or projected-commit state. Already-registered
room identities and the protected catalog need not be discarded.

The existing registry co-locates dependency state, rooms, durable
authorization, and publication counts at
`crates/snapback-sync/src/ephemeral.rs:3355-3369`. The added projected fact is
deliberately separate from its durable-settlement fact; it exists only to
represent LLP 0059's earlier ordinary issuer phase.

### 3.3 Tickets and selectors

```rust
pub(crate) struct RoomDependencyTicket {
    ticket_id: u64,
    outcome_sequence: u64,
    expected_authorization: Arc<OnceLock<AuthorizationVersion>>,
    known_commit: Arc<OnceLock<KnownAuthorizationCommit>>,
    registry_generation: u64,
}
```

```rust
struct KnownAuthorizationCommit {
    sequence: u64,
    predecessor: Option<AuthorizationVersion>,
    authorization: AuthorizationVersion,
    min_commit_version: u64,
    incarnation_rotated: bool,
    issuer_projected: AtomicBool,
}
```

```rust
pub(crate) struct RoomDependencySelector {
    all_protected_rooms: bool,
    collections: BTreeSet<String>,
    rooms: BTreeSet<RoomId>,
}
```

```rust
struct RoomDependencyPending {
    expected_authorization: Arc<OnceLock<AuthorizationVersion>>,
    known_commit: Arc<OnceLock<KnownAuthorizationCommit>>,
    selector: RoomDependencySelector,
    affected_rooms: BTreeSet<RoomId>,
}
```

Their present meanings do not change:

- ticket identity is exact and process-local;
- `expected_authorization.set` at bind and `known_commit.set` after a known
  SQLite commit are the only transaction-time ticket mutations; both are
  lock-free one-shot cells;
- selectors retain their current `matches` and `covers` semantics;
- rollback and cancellation remove only one exact ticket and its marks.

The existing ticket already uses `OnceLock` specifically so bind takes no
ephemeral mutex (`crates/snapback-sync/src/ephemeral.rs:3250-3278`), and current
kernel reconciliation distinguishes known commit, known rollback, and ambiguity
at `crates/snapback-kernel/src/storage.rs:962-1007`. `known_commit` records only
the verdict the kernel derived there; callers cannot set it.

### 3.4 Reservation

```rust
pub struct AuthorizationCommitReservation {
    binding: DatabaseBinding,
    registry: Arc<RoomAuthorityRegistry>,
    registry_generation: u64,

    ticket: Option<RoomDependencyTicket>,
    reserved_selector: Option<RoomDependencySelector>,
    protected_collections: Arc<[EphemeralCollection]>,
    protected_collection_revision: u64,
    reserved_predecessor: Option<AuthorizationVersion>,

    rollback_on_drop: bool,
}
```

All fields are private.

It has no public constructor and does not implement `Clone`, `Copy`, `Default`, or deserialization.

A neutral reservation has:

- `ticket = None`;
- `reserved_selector = None`;
- `rollback_on_drop = false`.

An authorization-event reservation has all event fields populated and `rollback_on_drop = true`.

The existing public ownership methods remain:

```rust
impl AuthorizationCommitReservation {
    pub fn install(self) -> ManagedAuthorizationReservationScope;
    pub fn cancel(self);
}
```

The existing `ManagedAuthorizationReservationScope::take_unused` remains until a separately compiled design proves that every owner can avoid returning an unused reservation. It exposes only the same opaque, powerless reservation.

### 3.5 Prepared commit

```rust
pub(crate) struct PreparedAuthorizationCommit {
    binding: DatabaseBinding,
    registry: Arc<RoomAuthorityRegistry>,
    registry_generation: u64,
    ticket: RoomDependencyTicket,
    predecessor: Option<AuthorizationVersion>,
    authorization: AuthorizationVersion,
    incarnation_rotated: bool,
    rollback_on_drop: bool,
}
```

It has:

- no callback fields;
- no public methods;
- no `Clone`, `Copy`, `Default`, serialization, or deserialization;
- no `test-support` constructor or settlement method.

### 3.6 Committed outcome

```rust
#[derive(Clone)]
pub struct AuthorizationCommitOutcome {
    binding: DatabaseBinding,
    registry: Arc<RoomAuthorityRegistry>,
    registry_generation: u64,
    ticket_id: u64,
    sequence: u64,
    predecessor: Option<AuthorizationVersion>,
    authorization: AuthorizationVersion,
    min_commit_version: u64,
    incarnation_rotated: bool,
}
```

Fields are private. The complete public API is read-only:

```rust
impl AuthorizationCommitOutcome {
    pub fn sequence(&self) -> u64;
    pub fn authorization(&self) -> &AuthorizationVersion;
    pub fn min_commit_version(&self) -> u64;
    pub fn incarnation_rotated(&self) -> bool;
}
```

Observation cannot acknowledge, finalize, roll back, or reopen anything.
It can be presented to the matching `AuthorizationExpectationView` only to
project the exact already-known durable successor during the ordinary
after-Local phase. Because all identity and successor fields are private and
kernel-minted, it cannot name an alternative terminal result.

## 4. Constructor custody and database installation

### 4.1 Sole constructor

The only participant constructor is kernel-private:

```rust
impl AuthorizationCommitParticipant {
    pub(crate) fn new(
        binding: DatabaseBinding,
        registry: Arc<RoomAuthorityRegistry>,
        registry_generation: u64,
        activation: Arc<AuthorizationParticipantActivation>,
    ) -> Self;
}
```

The sole production mint is:

```rust
impl ServingDatabase {
    pub fn take_authorization_commit_participant(
        &mut self,
    ) -> SnapbackResult<AuthorizationCommitParticipant>;

    pub fn replace_authorization_commit_participant(
        &mut self,
    ) -> SnapbackResult<AuthorizationCommitParticipant>;
}
```

A caller may adopt and mint for a database it already owns; LLP 0285 classifies that as a non-escalation. It cannot construct a participant for somebody else’s binding or pair one binding with another registry.

### 4.2 Database-owned installation state

The current Boolean is a field on `LocalDatabase`, not `ServingDatabase`
(`crates/snapback-kernel/src/storage.rs:1301-1342`), is initialized `false` by
all three constructors (`storage.rs:2300-2323,2370-2393,2618-2639`), is cloned
into mutation execution before SQLite opens (`storage.rs:3683-3689,5348`), and
is enabled only after a `DatabaseBinding` comparison
(`storage.rs:2811-2823`). Revision (b) replaces that exact field:

```rust
struct LocalDatabase {
    // existing fields...
    authorization_interlock: AuthorizationInterlockState,
}

#[derive(Clone)]
enum AuthorizationInterlockState {
    Disabled,
    ParticipantPending {
        registry: Arc<RoomAuthorityRegistry>,
        registry_generation: u64,
        activation: Weak<AuthorizationParticipantActivation>,
    },
    ParticipantBound {
        registry: Arc<RoomAuthorityRegistry>,
        registry_generation: u64,
        activation: Weak<AuthorizationParticipantActivation>,
    },
    ParticipantReady {
        registry: Arc<RoomAuthorityRegistry>,
        registry_generation: u64,
        activation: Weak<AuthorizationParticipantActivation>,
    },
}
```

The strong registry `Arc` is held by `LocalDatabase` in pending, bound, and ready
states. The `Weak` activation tracks whether the one participant stored in the
backend still exists without transferring registry ownership out of the
database. `ServingDatabase` methods mutate `self.db.authorization_interlock`;
there is no second state record on the wrapper.

`take_authorization_commit_participant`:

1. Requires `Disabled`.
2. Creates an authorization-uninitialized registry with the database’s
   `DatabaseBinding`.
3. Creates a fresh `AuthorizationParticipantActivation` in `PENDING`.
4. Stores the exact registry, generation, and weak activation as
   `ParticipantPending` on `LocalDatabase`.
5. Returns the non-cloneable participant.
6. A second take returns `SNAPBACK_AUTH_PARTICIPANT_ALREADY_TAKEN`.

`Disabled` and `ParticipantBound` preserve today's `false` behavior; they do
not require a reservation. `ParticipantPending` is a construction-in-progress
state and refuses a write rather than silently behaving disabled. Only
`ParticipantReady` with projection availability enabled activates the
transaction interlock. A ready-but-suspended participant returns
`SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`; it never degrades to disabled behavior.
All detached/read-only database constructions remain `Disabled`.

### 4.3 Bound backend constructor

The public authorization-capable backend constructor takes the serving database, not an independently supplied participant:

```rust
impl LocalEphemeralBackend {
    pub fn for_serving_database(
        limits: EphemeralStoreLimits,
        database: &mut ServingDatabase,
    ) -> SnapbackResult<Self>;
}
```

Its internal sequence is:

1. Validate limits and allocate all fallible sync-owned state before taking the participant.
2. Call `database.take_authorization_commit_participant()`.
3. Store the participant directly inside the private `EphemeralShared`.
4. Call `database.bind_authorization_commit_participant(&participant)`.
5. Return the backend only after binding succeeds.

Backend clones clone `Arc<EphemeralShared>`, not the participant.

The construction-time binding method is:

```rust
impl ServingDatabase {
    pub fn bind_authorization_commit_participant(
        &mut self,
        participant: &AuthorizationCommitParticipant,
    ) -> SnapbackResult<()>;
}
```

Binding succeeds only when:

- the participant binding matches the serving database binding;
- the participant registry binding also matches;
- the database is in `ParticipantPending`;
- `Arc::ptr_eq` matches the exact pending registry;
- the registry generation matches both stored generation values;
- the pending activation identity upgrades;
- `Arc::ptr_eq` matches the participant’s activation identity;
- the registry is not retired.

It then changes the activation atomic `PENDING -> BOUND` and the database field
`ParticipantPending -> ParticipantBound`. The backend is now exactly paired but
the transaction interlock is still disabled.

Failures are closed-form:

- `SNAPBACK_AUTH_PARTICIPANT_DATABASE_MISMATCH`;
- `SNAPBACK_AUTH_PARTICIPANT_REGISTRY_MISMATCH`;
- `SNAPBACK_AUTH_PARTICIPANT_GENERATION_MISMATCH`;
- `SNAPBACK_AUTH_PARTICIPANT_NOT_PENDING`;
- `SNAPBACK_AUTH_PARTICIPANT_DROPPED`;
- `SNAPBACK_AUTH_INTERLOCK_RETIRED`.

No public bound-backend constructor accepts an arbitrary participant. A kernel-private or sync-private helper may do so only inside `for_serving_database`.

This split matches the tree's present composition: engine construction creates
`LocalEphemeralBackend` and installs carriers at
`crates/snapback-engine/src/local/engine.rs:24328-24329`, but does not enable the
database interlock there.

### 4.4 Auth-time activation

Activation stays at today's auth-invalidation enable point. The current engine
first installs the issuer expectation and version stream, stores the local
invalidation state, queues the ephemeral issuer ordinary effect, and only then
calls `enable_authorization_commit_interlock`
(`crates/snapback-engine/src/local/engine.rs:7749-7773`). The issuer is created
from `(authorization, version_stream, boot_sequence)` that the same serving
database reserved immediately beforehand at `engine.rs:7792-7822`; the kernel
reservation reads or creates the authorization pair and reserves the issuer
sequence in one SQLite transaction
(`crates/snapback-kernel/src/storage/auth_invalidation.rs:588-607,1724-1728`).
Revision (b) replaces the caller-installed expectation and final Boolean enable
with one concrete initialization/binding/activation sequence:

```rust
impl LocalEphemeralBackend {
    pub fn authorization_expectation_view_for_install(
        &self,
        database: &mut ServingDatabase,
    ) -> SnapbackResult<AuthorizationExpectationView>;

    pub fn activate_authorization_commit_interlock(
        &self,
        database: &mut ServingDatabase,
    ) -> SnapbackResult<()>;
}

impl ServingDatabase {
    pub fn authorization_expectation_view_for_participant_install(
        &mut self,
        participant: &AuthorizationCommitParticipant,
    ) -> SnapbackResult<AuthorizationExpectationView>;

    pub fn activate_authorization_commit_participant(
        &mut self,
        participant: &AuthorizationCommitParticipant,
        issuer_projection: &AuthorizationIssuerProjection,
    ) -> SnapbackResult<()>;
}
```

Both backend methods borrow the one participant stored in private
`EphemeralShared`; neither accepts a participant argument. View installation:

1. rejects an active `LocalSnapbackWriteScope` and requires
   `ParticipantBound`/activation `BOUND` for first installation, or the exact
   `ParticipantReady`/activation `READY` pair for reset-owned issuer rebuild;
2. repeats the participant/database binding, registry binding, exact-`Arc`, all
   generation, activation-identity, and retirement checks;
3. reads the complete durable authorization pair through
   `read_authorization_version_snapshot(&self.db.conn)` on that same
   `LocalDatabase` (`crates/snapback-kernel/src/storage/auth_stream.rs:405-429`);
4. under the registry mutex, requires no dependency, active permit, pending
   room mark, or projected commit. In `ParticipantBound`, it initializes both
   `durable_authorization` and `projected_authorization` from the fresh kernel
   read; in `ParticipantReady`, it requires both facts to equal that read and,
   when `latest_committed_outcome` is present, requires its successor to equal
   the same read, allowing the post-rotation successor-issuer rebuild or an
   exact idempotent retry; and
5. returns an `AuthorizationExpectationView` bound to that exact registry,
   generation, activation identity, current issuer-suspension epoch, and
   kernel-read incarnation.

In `install_auth_invalidation`, the engine requests this view first, requires
`view.current() == authorization` for the value returned by the immediately
preceding boot-issuer reservation, and passes the view to
`issuer.bind_authorization_expectation`. That bind converts the view into and
retains an opaque `AuthorizationIssuerProjection`; activation accepts that
exact carrier rather than a caller-provided authorization value. A mismatch is
`SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE`; it leaves the database
in its prior state and admits no new authorization write. The engine then
installs the version stream and local obligation state and queues the existing
ephemeral issuer ordinary effect. Only after all of those steps succeed does it
call `activate_authorization_commit_interlock`, replacing today's call at
`engine.rs:7772`.

Activation again requires the exact `ParticipantBound` tuple, initialized
registry, and issuer projection whose registry `Arc`, generation, activation
identity, suspension epoch, and incarnation match the newly read view. It then changes the
activation atomic `BOUND -> READY` and the
`LocalDatabase` field `ParticipantBound -> ParticipantReady`. In the exact
`ParticipantReady` reset-rebuild case it re-enables the same latch; any
mismatched or already-dropped projection fails. The latch retains only a weak
lease; dropping every exact projection carrier makes reservation fail closed
even if no clear helper ran. Direct/startup installation stores the issuer copy
before activation. A managed reset rebuild retains an opaque closed-handoff
token from before the destructive finalizer through reset publication and
successor installation. Its token-owned Local turn re-enables the database-
validated latch and drains the queued sync issuer copy while generic managed
writers remain outside the mutex; only then may the token reopen the handoff.
The current boot/reset entry point calls
`install_auth_invalidation` only after its durable boot reservation
(`engine.rs:7792-7822`); normal startup invokes that entry point before
publishing the shared serving state
(`crates/snapback-cli/src/cli.rs:8637-8666`). After destructive reset, the
server rebuilds the issuer only after committed reset publication returns
(`crates/snapback-server/src/server.rs:23755-23801`), matching the ready-state
rebind branch. Early construction activation is forbidden.

Issuer removal is the inverse fail-closed cut, not a reverse participant state
transition. Every public sync `clear_authorization_issuer` call suspends the
participant before removing the issuer; engine clear and committed-reset
cleanup use that same intrinsic ordering. Suspension advances an internal
epoch, so every carrier minted before the clear is permanently invalid for
reactivation even if another clone remains live. The transition is denial-only;
only exact database activation with a freshly obtained live projection carrier
can store true again.
A concurrent reservation either observes suspension during prepare or is
rejected by the mandatory bind-time acquire-load. The supported
clear and write entry points both require exclusive `&mut LocalSnapback`, so a
clear cannot interleave between that bind check and the immediately following
SQLite commit. Destructive reset settlement already has a known committed
rotation and retains §5.5's no-predecessor-projection finalizer branch. Its
successor rebuild uses the same exact ready-tuple activation, not a separate
flag: the latch is re-established while the sole writer is held and the queued
issuer-copy installation drains before the managed handoff reopens. Abandoned
clear has no such rebuild and therefore remains suspended.

The complete mutator inventory is:

- public `LocalSnapback::install_authenticated_auth_invalidation` installs the
  engine issuer, the sync issuer, and its bound expectation before the exact
  database activation enables projection availability;
- public `LocalSnapback::clear_installed_auth_invalidation` exact-matches its
  opaque issuer binding, then suspends projection availability before clearing
  either issuer copy;
- private failed-reset cleanup and private committed-reset finalization use the
  same suspend-first clear helper; the latter was the only additional direct
  `auth_invalidation = None` assignment and no direct clear assignment remains.
  A successful committed-reset successor rebuild then uses the ordinary exact
  database activation while its managed handoff is still closed;
- public `ServingDatabase::take_authorization_commit_participant` changes
  `Disabled -> ParticipantPending`, where authorization writes refuse;
- public `ServingDatabase::bind_authorization_commit_participant` changes
  `ParticipantPending -> ParticipantBound`, the deliberately dormant state
  where no reservation or finalizer is installed;
- public `ServingDatabase::activate_authorization_commit_participant` changes
  the exact initialized `ParticipantBound` tuple to `ParticipantReady`, or
  re-enables the same exact ready tuple during reset rebuild, but only when
  given the opaque live projection carrier matching that tuple. In the production
  graph its sole call is behind
  `LocalEphemeralBackend::activate_authorization_commit_interlock`, which now
  requires the installed issuer and its bound expectation first. These kernel
  and sync crates are non-published composition crates; the supported public
  product surface cannot call the lower-level transition directly;
- public `ServingDatabase::replace_authorization_commit_participant` first
  retires the old participant, which also suspends projection, and then changes
  the database to `ParticipantPending`; and
- public sync-owned `install_authorization_issuer`,
  `clear_authorization_issuer`, and `suspend_authorization_commit_projection`
  are internal composition operations. Product installation/clearing orders
  them through the engine methods above; the suspend transition is denial-only.

Thus no activation API accepts a Boolean or an `AuthorizationVersion` as
projection proof. The kernel validates the opaque carrier's exact identity and
keeps only a weak lease, while the auth-owned live issuer retains the strong
lease. A copied or forked database at the same durable version cannot activate,
an issuer clear intrinsically suspends, and a reservation minted before the cut
cannot cross transaction bind.

### 4.5 Why A cannot be installed beside B

Four checks close LLP 0285’s named failure:

1. Public bound composition takes `&mut ServingDatabase`, not a participant argument.
2. Construction binding compares the `DatabaseBinding`, exact registry `Arc`, generation, and activation identity before returning the backend.
3. Auth-time activation repeats those checks against `ParticipantBound`.
4. Transaction bind obtains `ParticipantReady` from the committing `LocalDatabase` and compares the reservation binding, registry binding, exact registry `Arc`, all three generation values, ready activation, and retirement state.

A participant from A cannot bind or activate against B. More importantly, a
reservation prepared by A cannot bind inside B's transaction: B's
`LocalDatabase` supplies B's ready registry, not a registry argument from sync.
A stale participant from an earlier registry generation also fails. The
construction and activation checks prevent a bad composed graph; transaction
bind is the settlement safety proof.

### 4.6 Same-database replacement

`replace_authorization_commit_participant` is permitted only from `ParticipantReady`.

It:

1. locks the old registry and refuses with
   `SNAPBACK_AUTH_PARTICIPANT_DEPENDENCY_PENDING` if any dependency already has
   a known committed verdict awaiting its deferred finalizer;
2. sets `old_registry.retired = true` with `Release` only after that check;
3. notifies `quiescent`, waking blocked prepare waiters, and waits for admitted
   active operations to leave;
4. retires the old activation, intrinsically suspending projection;
5. creates a new registry with the same `DatabaseBinding` and generation `old + 1`;
6. leaves the new registry authorization-uninitialized;
7. installs it as `ParticipantPending`;
8. returns a new non-cloneable participant; and
9. requires the same auth-time initialization and exact issuer-view binding
   before the replacement can become `ParticipantReady`.

Every operation on the old registry acquire-loads `retired` and fails closed. A prepare waiter awakened by retirement compare-removes its own ticket and returns `SNAPBACK_AUTH_INTERLOCK_RETIRED`.

No state is copied from the old room map. The caller must rebuild sync-owned rooms and collection policy through the normal lifecycle before activation.

### 4.7 Unbound backend

`LocalEphemeralBackend::new` and `with_limits` may remain for standalone room/queue use, but their authority mode is explicitly unbound:

- no `AuthorizationCommitParticipant`;
- no database binding;
- no durable authorization initialization;
- `reserve_authorization_commit` returns `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`;
- no method can enable the storage authorization interlock;
- no test can obtain a participant from this mode.

## 5. Finite participant API

There is no participant trait and no caller-provided implementation.

### 5.1 Protected-room catalog

```rust
impl AuthorizationCommitParticipant {
    pub fn replace_protected_room_catalog(
        &self,
        definitions: &[EphemeralCollection],
    ) -> Result<u64, EphemeralError>;
}
```

The method:

1. verifies the participant is live and construction-bound (`BOUND` or `READY`), rejecting pending or retired state;
2. validates definitions using the canonical collection validator;
3. retains only collections whose publish or subscribe policy requires room permission;
4. stores an owned `Arc<[EphemeralCollection]>`;
5. increments the non-wrapping protected-catalog revision;
6. publishes the revision through `catalog_revision.store(revision, Release)`;
7. returns the installed revision.

There is no separate public “publish generation” method and no method accepting an empty selector as a reservation proof.

Sync calls this method inside the same collection-definition lifecycle exclusion that publishes its collection map. It validates and owns the new definitions before entering either lock. The kernel catalog is updated before the sync map becomes visible; the registry lock is released before the sync collection map is published. Failure after the kernel update may over-fence but must not under-fence.

The tree's source facts are the collection map/generation at
`crates/snapback-sync/src/ephemeral.rs:4020-4022`, the protected snapshot at
`ephemeral.rs:4585-4600`, and the lifecycle-serialized registration/replacement
at `ephemeral.rs:5094-5154`. The migration must reuse that lifecycle exclusion;
it must not invent an independent catalog publisher.

### 5.2 Room registration and acts

```rust
impl AuthorizationCommitParticipant {
    pub fn begin_protected_room_act(
        &self,
        room: &RoomId,
    ) -> Result<RoomAuthorityPermit, EphemeralError>;

    pub fn validate_admitted_room_act(
        &self,
        permit: &RoomAuthorityPermit,
        room: &RoomId,
    ) -> Result<u64, EphemeralError>;

    pub fn room_generation(&self, room: &RoomId) -> u64;

    pub fn retire_room(&self, room: &RoomId);
}
```

`begin_protected_room_act` atomically:

1. validates the room against the protected catalog and canonical room-ID derivation;
2. rejects any matching dependency selector;
3. inserts the room control lazily if absent;
4. rejects retired, pending-ticket, or resync-pending state;
5. increments `active_permits`;
6. returns an opaque permit bound to the exact registry, room, and generation.

`retire_room` is monotone-restrictive. It cannot clear a dependency, pending mark, or active permit. A retired room is removed only after its pending-ticket and active-permit counts reach zero.

These are the current registry semantics, not new policy: act admission is at
`crates/snapback-sync/src/ephemeral.rs:3505-3525`, permit validation/drop at
`ephemeral.rs:3427-3468`, and monotone retirement at
`ephemeral.rs:3951-3961`.

### 5.3 Prepare

```rust
impl AuthorizationCommitParticipant {
    pub fn prepare_authorization_commit(
        &self,
        preflight: AuthorizationCommitPreflight,
        cancellation: Arc<AuthorizationReservationCancellation>,
    ) -> SnapbackResult<AuthorizationCommitReservation>;
}
```

`AuthorizationReservationCancellation` has private fields and exactly:

```rust
impl AuthorizationReservationCancellation {
    pub fn new() -> Self;
    pub fn cancel(&self);
    pub fn is_cancelled(&self) -> bool;
}
```

It has no `Default`.

Prepare runs:

- outside managed and direct Local;
- outside SQLite;
- in the independently owned blocking task that will install, consume, or cancel the reservation.

For `NoAuthorizationEvent`, prepare allocates no ticket and does not lock the registry.

For `AllProtectedRooms` or `AppWrites`, prepare:

1. acquire-loads `participant.activation.state` and requires `READY` with a
   live issuer-projection lease whose registry, generation, activation identity,
   and incarnation match this participant's current projected fact;
2. snapshots the protected catalog, catalog revision, and durable predecessor under the registry mutex;
3. derives the conservative selector;
4. allocates one exact ticket and reserves one non-wrapping outcome sequence;
5. computes the affected existing-room set;
6. prechecks ticket, outcome-sequence, and generation exhaustion;
7. inserts the ticket into every affected room;
8. inserts the dependency;
9. waits for durable and room publication permits to drain;
10. on cancellation or retirement, compare-removes only that ticket and its marks;
11. returns the opaque reservation with its owned snapshot.

Steps 7 and 8 occur before the wait. Only after the wait succeeds may the blocking owner acquire Local and enter SQLite.

This preserves the current off-Local choreography: the backend snapshots
protected definitions and issuer predecessor, installs the registry ticket, and
returns an opaque carrier at
`crates/snapback-sync/src/ephemeral.rs:4585-4685`; the registry premarks before
waiting at `ephemeral.rs:3586-3682`. The activation atomic is only a fast
prepare-time readiness check. It cannot prove A-beside-B because prepare has no
borrow of the committing database; §5.4 performs that proof.

### 5.4 Bind

Only kernel transaction code may call:

```rust
impl AuthorizationCommitReservation {
    pub(crate) fn bind(
        self,
        database_binding: &DatabaseBinding,
        authorization_interlock: &AuthorizationInterlockState,
        durable_predecessor: Option<&AuthorizationVersion>,
        witness: &AuthorizationCommitWitness,
        impact: AuthorizationCommitImpact<'_>,
    ) -> SnapbackResult<PreparedAuthorizationCommit>;
}
```

`authorization_interlock` is not supplied by sync. It is cloned directly from
the committing `LocalDatabase.authorization_interlock` immediately before that
database opens SQLite, replacing the Boolean captures now at
`crates/snapback-kernel/src/storage.rs:3683-3689,5348`. The transaction helper
already consumes the TLS reservation and calls bind at
`storage.rs:930-955`; revision (b) changes that helper to pass the database's
state and `DatabaseBinding`, plus the durable predecessor already read inside
the transaction at `storage.rs:5020-5024,5873-5877`.

Bind performs, in this order:

1. pattern-match `authorization_interlock` as `ParticipantReady`; every other state fails with `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` once `witness.event` is true;
2. acquire-load the ready activation and require both `READY` and the same live,
   exact-registry issuer projection; this closes the race with an issuer clear,
   projection drop, or incarnation rotation after reservation;
3. compare the reservation binding with the committing database's `DatabaseBinding` using `DatabaseBinding::matches`;
4. compare the ready registry's private binding with that same database binding;
5. require `Arc::ptr_eq(&reservation.registry, ready_registry)`;
6. require equality among reservation generation, ready-state generation, and the registry's acquire-loaded generation;
7. acquire-load `retired`, rejecting a retired registry;
8. require `witness.event`;
9. acquire-load `catalog_revision` and require equality with the reservation snapshot;
10. derive the actual selector from the transaction’s actual schema and changes using the reservation’s protected-catalog snapshot;
11. require `reserved_selector.covers(actual_selector)`;
12. for a non-rotating witness:
   - require the reserved predecessor to equal the transaction-read durable predecessor;
   - require the same incarnation;
   - require exact epoch `+1`;
13. bind the ticket’s `expected_authorization` `OnceLock` to `witness.version`;
14. transfer rollback ownership, the transaction-read predecessor, and the
    pre-reserved outcome sequence to `PreparedAuthorizationCommit`.

A neutral reservation presented with an authorization event, an actual selector
that exceeds its prepared selector, or an authorization event that reaches a
ready projection without its matching off-Local reservation returns
`SNAPBACK_AUTH_RESERVATION_STALE`. In all three cases the projection exists;
the precommit reservation is what became stale or incomplete. A missing or
suspended issuer projection remains `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`.

Bind acquires no registry, room, outbox, issuer, or SQLite-adjacent process
mutex. Its only mutation is `expected_authorization.set`. Pointer comparisons,
atomic loads, selector computation over owned data, and predecessor comparisons
preserve LLP 0059’s transaction-time lock prohibition. This extends the current
collection-generation/selector/successor bind checks at
`crates/snapback-sync/src/ephemeral.rs:4207-4253`; it does not relocate a
registry lock under SQLite.

### 5.5 Finalize

Only kernel commit code may call:

```rust
impl PreparedAuthorizationCommit {
    pub(crate) fn finalize_committed(
        self,
        min_commit_version: u64,
    ) -> SnapbackResult<()>;

    pub(crate) fn finalize_rolled_back(self);

    pub(crate) fn finalize_ambiguous(self);
}
```

No public or `test-support` method exposes these transitions.

#### Known commit

`finalize_committed`:

1. disables rollback-on-drop before any fallible terminal operation;
2. uses the non-wrapping outcome sequence reserved with the ticket during the
   off-Local prepare critical section;
3. installs the exact predecessor, successor, commit version, rotation bit, and
   `issuer_projected = false` into `ticket.known_commit` with one
   `OnceLock::set`; and
4. schedules a kernel-owned checked finalizer through
   `run_or_defer_after_local_finalizer_checked`.

An enabled authorization interlock requires an active managed or direct
`LocalSnapbackWriteScope` before SQLite commit. The check happens in
`prepare_authorization_commit_interlock`, before the commit primitive; a ready
participant outside such a scope returns
`SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`. Therefore the finalizer is always
deferred for a participant-enabled commit and can never take the helper's
immediate branch at `crates/snapback-types/src/exec_guard.rs:202-208`. The
direct-library compatibility path already enters a scope, transfers the batch,
drops the scope, and runs the batch synchronously at
`crates/snapback-engine/src/local/engine.rs:7865-7890`.
Managed writer owners and nested action guards perform the same drain after
dropping Local and before completing their result. `run_after_local_batch` is
`#[must_use]`: it runs every queued phase, returns the first checked error, and
cannot be treated as a unit notification seam.

The finalizer locks the registry and, before mutating, validates:

- the registry is not retired;
- the registry generation matches;
- the exact dependency still exists;
- the ticket is bound;
- the bound authorization equals the committed authorization;
- `durable_authorization` equals the known commit's predecessor;
- the affected-room marks still name this ticket.

For a same-incarnation commit it additionally requires
`issuer_projected` to acquire-load true and
`projected_commits[ticket_id]` to equal the committed authorization. For a
destructive rotation it instead requires `issuer_projected == false`, no entry
for this ticket in `projected_commits`, and `projected_authorization` equal to
the predecessor. This is the concrete counterpart of the current branch that
refuses to advance the predecessor issuer across an incarnation
(`crates/snapback-sync/src/ephemeral.rs:4279-4283,4698-4701`).

It then atomically:

1. for destructive rotation only, updates `projected_authorization` to the
   successor; for a same-incarnation commit, leaves the already-projected
   successor unchanged;
2. updates `durable_authorization` to the successor;
3. removes only this ticket from `projected_commits` when present;
4. removes only the exact dependency;
5. removes only this ticket from affected rooms;
6. increments each live affected room generation;
7. installs each level-triggered reauthorization obligation;
8. records `latest_committed_outcome`;
9. notifies the condition variable.

If validation unexpectedly fails, no ticket or mark is removed and a known
commit is never converted into rollback. The deferred finalizer suspends the
projection latch and stores a `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` failure on
the activation; the batch owner returns that same sticky typed failure to the
initiating caller, and subsequent authorization reservation/activation returns
it again. Outcome lookup failure and issuer projection failure enter this same
transition before the kernel finalizer runs; neither is discardable. This is
deliberately a wedged, fail-closed store requiring operator recovery, not a
process panic. The source-public seed APIs make this necessary: their
witness-bearing result prevents accidental output-only adapters, but Rust
callers can still explicitly discard it after SQLite has committed.

The durable verdict source remains the current kernel reconciliation:
successful COMMIT settles committed, exact durable predecessor settles rollback,
exact durable successor after a lost acknowledgement settles committed, and
unreadable/other state settles ambiguous
(`crates/snapback-kernel/src/storage.rs:962-1007`). No higher crate supplies that
choice.

#### Known rollback

`finalize_rolled_back` consumes the prepared value with rollback enabled. Drop schedules exact rollback through the finalizer phase when Local is active. Rollback removes only this ticket’s dependency and per-room marks.

#### Ambiguous result

`finalize_ambiguous` disables rollback and consumes the value without removing the ticket. No timeout, cancellation, participant observation, or Drop path may reopen it.

### 5.6 Issuer expectation and committed observation

```rust
#[derive(Clone)]
pub struct AuthorizationExpectationView {
    registry: Arc<RoomAuthorityRegistry>,
    registry_generation: u64,
    activation: Arc<AuthorizationParticipantActivation>,
    issuer_incarnation: Arc<str>,
}

pub struct AuthorizationIssuerProjection {
    // private Arc identity retaining the exact view above
}
```

Fields are private; there is no public constructor.

```rust
impl AuthorizationCommitParticipant {
    pub fn committed_outcome(
        &self,
        witness: &AuthorizationCommitWitness,
        min_commit_version: u64,
    ) -> SnapbackResult<AuthorizationCommitOutcome>;

    pub fn latest_committed_outcome(
        &self,
    ) -> Option<AuthorizationCommitOutcome>;

    pub fn pending_reauthorizations(
        &self,
    ) -> Vec<PendingRoomReauthorization>;
}

impl AuthorizationExpectationView {
    pub fn current(&self) -> SnapbackResult<AuthorizationVersion>;

    pub fn into_issuer_projection(
        self,
    ) -> SnapbackResult<AuthorizationIssuerProjection>;
}

impl AuthorizationIssuerProjection {
    pub fn current(&self) -> SnapbackResult<AuthorizationVersion>;

    pub fn project_committed(
        &self,
        outcome: &AuthorizationCommitOutcome,
    ) -> SnapbackResult<()>;
}
```

Only the database method in §4.4 creates a view. It requires a live `BOUND` or
`READY` activation and exact equality among the same database's fresh durable
snapshot, registry durable fact, and registry projected fact. There is no
participant method or `AuthorizationVersion`-accepting constructor that can
mint a view beside another database. The `READY` branch is what binds a freshly
authenticated successor issuer after destructive-reset settlement.

`committed_outcome` does not trust its public witness arguments. It locks the
registry outside Local, finds the still-installed exact dependency whose
kernel-only `known_commit` matches both the witness and minimum commit version,
and returns the private-field outcome for that record. No match is
`SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE`; caller input cannot mint an
outcome.

The engine composes `committed_outcome` and `project_committed` as one checked
ordinary after-Local effect. Failure of either operation is passed through the
participant's denial-only `fail_closed_authorization_projection` seam, which
installs or returns the first sticky
`SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`. The seam exposes no reopening value,
authorization version, or caller-selected bypass.

The projection carrier owns the exact view identity. Activation stores only a
weak lease to it, while `LiveInvalidationIssuer` retains the strong carrier;
therefore `ParticipantReady` cannot remain projection-available after the last
live issuer projection is dropped. `project_committed`:

1. asserts that Local is inactive;
2. compares the view and outcome bindings, exact registry `Arc`, and registry generation;
3. requires the registry and activation to remain live;
4. requires the exact dependency and `known_commit` to remain installed;
5. rejects `incarnation_rotated == true` because the predecessor issuer must
   not cross an incarnation;
6. requires `projected_authorization` to equal the outcome predecessor;
7. requires the view's issuer incarnation to equal the successor incarnation;
8. writes only that exact successor to `projected_authorization`;
9. inserts the exact `(ticket_id, successor)` in `projected_commits`; and
10. release-stores `issuer_projected = true` on that exact known commit.

It does not touch `durable_authorization`, dependencies, room marks,
generations, resync obligations, or `latest_committed_outcome`. Those remain the
finalizer's operations.

For destructive rotation, `project_committed` is not called. After reset-owned
ordinary effects run, the kernel finalizer validates the unprojected rotation
and advances both kernel facts atomically. The existing server then reserves
and authenticates the successor issuer after reset publication and calls the
`ParticipantReady` view-install branch
(`crates/snapback-engine/src/local/engine.rs:8491-8505`;
`crates/snapback-server/src/server.rs:23755-23801`).

The separate `projected_commits` ledger is required for same-incarnation
commits because one
`AfterLocalBatch` drains all ordinary effects before any finalizer. If two
authorization commits ever share a batch, projections A then B may make
`projected_authorization` equal B before finalizer A runs. Each finalizer
therefore validates and removes its own exact projected ticket entry and checks
that `durable_authorization` still equals its predecessor; it does not require
the latest projected value to equal its own successor. This follows the batch
shape at `crates/snapback-types/src/exec_guard.rs:224-241` without assuming an
unproved one-commit-per-batch invariant.

`current` reads `projected_authorization`, not `durable_authorization`, and fails closed if:

- the registry is retired;
- the registry generation changed;
- the projected authorization is absent; or
- the projected incarnation no longer matches the issuer.

`LiveInvalidationIssuer` replaces its caller-installed mutable authorization expectation with a bind-once view:

```rust
pub struct LiveInvalidationIssuer {
    // existing authenticated issuer, signer, stream, and counters...
    authorization_expectation: Arc<OnceLock<AuthorizationIssuerProjection>>,
}

impl LiveInvalidationIssuer {
    pub fn bind_authorization_expectation(
        &self,
        view: AuthorizationExpectationView,
    ) -> SnapbackResult<()>;

    pub fn project_authorization_expectation(
        &self,
        outcome: &AuthorizationCommitOutcome,
    ) -> SnapbackResult<()>;
}
```

After binding, `authorization_expectation()` reads the projected kernel view.
`project_authorization_expectation` delegates to the already-bound view and
accepts no caller-supplied authorization version. Production
`install_authorization_expectation(AuthorizationVersion)` at
`crates/snapback-auth/src/auth/invalidation.rs:225-257` is removed.
The current mutable field and its clone-sharing initialization are at
`invalidation.rs:152-158,177-196`; the `Arc<OnceLock<_>>` preserves clone
sharing while making binding one-shot.

The ordinary effect is queued by the existing Local successor-projection
orchestration, not by storage's commit hook. For ordinary authorization events,
`notify_authorization_event_in_frame_with_policy` already identifies issuer
publication as after-Local work
(`crates/snapback-engine/src/local/engine.rs:27748-27762`) and is reached from
normal and activation commits at `engine.rs:16411-16416,9233-9240`. It must
queue, at the issuer slot in the ordinary effect sequence, a closure that:

1. resolves `committed_outcome(witness, min_commit_version)` through the bound backend; and
2. calls `issuer.project_authorization_expectation(&outcome)`.

Schema/collection replacement is already queued as an ordinary effect at
`engine.rs:7976-7981`, and reset publication is queued at
`engine.rs:8615-8635`; those effects stay before successor issuer projection.
Notifier/fan-out effects stay after it. This projection is queued only for a
same-incarnation commit. Destructive rotation runs its reset-owned ordinary
effects without asking the predecessor issuer to cross incarnations; its
successor issuer is authenticated and bound later as described above. An error
in a queued same-incarnation projection leaves `issuer_projected` false and
returns normally so the settlement finalizer can retain the exact dependency
and poison the latch with the typed fail-closed diagnostic. The issuer callback
must not panic before that finalizer
(`crates/snapback-types/src/exec_guard.rs:224-241`).

Consequences:

- issuer projection and room settlement are kernel-validated but intentionally
  distinct phase facts;
- no sync callback or acknowledgement decides whether a commit finalizes;
- destructive incarnation rotation makes the predecessor view fail closed;
- ignoring a same-incarnation committed outcome cannot select another terminal
  result; it leaves `issuer_projected = false`, so the kernel finalizer retains
  the exact ticket and latches projection fail-closed without panicking;
- ignoring `latest_committed_outcome` or pending reauthorization work after
  settlement can delay delivery but cannot reopen rooms.
- an authorization witness is never reclassified as neutral merely because the
  engine issuer is absent; absence is a typed precommit projection refusal.

All seed-family commit adapters were audited with the same rule. Ordinary
`seed`, low-level `SchemaSeedKernel::seed`, and fresh
`ensure_versioned_seed` return witness-bearing carriers; replayed
or matched versioned ensures carry no publication because they made no commit.
The engine consumes each fresh carrier under the one existing seed
`AdmissionEffectGuard`, queues issuer projection only after that guard drops,
and creates no re-entrant admission guard. Reset adapters return their rotated
witness; coordinated reset intentionally uses the no-predecessor-projection
branch and the closed-handoff protocol below.

## 6. Sync-owned outbox rewrite

### 6.1 What remains in sync

The following do not move:

- `SharedOutbox = Arc<Mutex<OutboundQueue>>`;
- `OutboundQueue` and its durable, resync, and ephemeral lanes;
- effect-fence matching and recovery-marker precedence;
- lease bookkeeping;
- `OutboxDrainLease`;
- `OutboxLeaseWake`;
- `AdmittedRealtimeEnvelope`;
- subscriber policy and resync materialization;
- transport handoff;
- the queue’s private closure-based selection helper.

`ConnectionEffectFence` itself is currently defined in rank-0 `snapback-types`, not privately in sync. Both source designs identified this correction to LLP 0285’s wording. Its queue ownership, matching, and recovery-marker behavior remain sync-owned, so the outbox move is still impossible. The blocking foreign types are principally `SharedOutbox`, `OutboundQueue`, `OutboxDrainLease`, `OutboxLeaseWake`, and `AdmittedRealtimeEnvelope`.

Private closures wholly inside `snapback-sync` are permitted. No closure crosses the kernel boundary.

This inventory is concrete in the current file: `OutboxDrainLease` and its
release/ack behavior are at
`crates/snapback-sync/src/ephemeral.rs:1229-1405`,
`AdmittedRealtimeEnvelope` is at `ephemeral.rs:1407-1427`, `SharedOutbox` is at
`ephemeral.rs:3205-3206`, and the foreign inherent `drain_outbox` that forces
the split is at `ephemeral.rs:3790-3949`.

### 6.2 Kernel disposition and permit

```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OutboxFrameDisposition {
    Send,
    Retain,
    DropStale,
}
```

The enum is caller-constructible but no kernel method accepts a caller-produced value as proof.

The existing durable/room permit enum moves with the mechanism:

```rust
pub enum RealtimePublicationPermit {
    Durable(DurableAuthorizationPermit),
    Room(RoomAuthorityPermit),
}
```

All variant payload fields remain opaque. Possession proves only that the registry counted one already-admitted publication.

### 6.3 Admission guard

```rust
pub struct AuthorizationOutboxAdmission<'a> {
    registry: &'a Arc<RoomAuthorityRegistry>,
    state: MutexGuard<'a, RoomAuthorityRegistryState>,
    admit_fenced: bool,
}
```

Fields are private.

```rust
impl AuthorizationCommitParticipant {
    pub fn begin_outbox_admission(
        &self,
        admit_fenced: bool,
    ) -> Result<AuthorizationOutboxAdmission<'_>, EphemeralError>;
}
```

```rust
impl AuthorizationOutboxAdmission<'_> {
    pub fn classify_durable(
        &self,
        message: &DurableMessage,
    ) -> OutboxFrameDisposition;

    pub fn classify_ephemeral(
        &self,
        message: &EphemeralMessage,
    ) -> OutboxFrameDisposition;

    pub fn admit_selected(
        &mut self,
        envelope: &RealtimeEnvelope,
    ) -> Result<Option<RealtimePublicationPermit>, EphemeralError>;
}
```

The guard must not implement `Send` and cannot cross `.await`.

`classify_durable` preserves the current semantics exactly:

- no authorization stamp → `Send`;
- any pending dependency → `Retain`;
- matching durable authorization and fenced admission → `Send`;
- matching authorization without fenced admission → `Retain`;
- different authorization → `DropStale`.

`classify_ephemeral` preserves the current semantics exactly:

- authority-independent epoch boundary → `Send`;
- no room authority → `Send`;
- missing room with generation zero → `Send`;
- missing room with nonzero generation → `DropStale`;
- retired or generation-mismatched room → `DropStale`;
- pending ticket → `Retain`;
- current `AuthChanged` resync at the exact generation → `Send` only when fenced, otherwise `Retain`;
- any other frame while a resync obligation exists → `Retain`;
- stale `AuthChanged` without an obligation → `DropStale`;
- otherwise fenced → `Send`, unfenced → `Retain`.

`admit_selected` reclassifies the envelope under the same guard. It never trusts sync’s earlier disposition. It returns a permit only if the envelope still classifies as `Send`.

The branch list above is the branch list implemented today at
`crates/snapback-sync/src/ephemeral.rs:3804-3884`; permit accounting and wrapper
construction follow at `ephemeral.rs:3886-3948`. Revision (b) does not infer a
new disposition.

### 6.4 Sync-owned drain function

The foreign inherent implementation is replaced by a private sync function, or equivalently an inherent method on the sync-owned `LocalEphemeralBackend`:

```rust
fn drain_outbox_with_authorization(
    participant: &AuthorizationCommitParticipant,
    outbox: &SharedOutbox,
    admit_fenced: bool,
    expected_effect_fence: Option<&ConnectionEffectFence>,
    max_batch: usize,
    max_handoff_bytes: usize,
    wake: Arc<OutboxLeaseWake>,
) -> Vec<AdmittedRealtimeEnvelope>;
```

Its exact order is:

1. call `participant.begin_outbox_admission`;
2. on admission error, return an empty batch;
3. lock the sync outbox;
4. invoke the sync-private bounded queue drain;
5. retain `ConnectionEffectFence` matching and recovery-marker behavior inside that queue drain;
6. pass classifier closures that call only `admission.classify_durable` and `admission.classify_ephemeral`;
7. release the outbox lock;
8. while retaining the registry guard, call `admit_selected` for each selected envelope;
9. if revalidation refuses a selected envelope, release its queue lease for retry or stale cleanup according to the existing queue disposition;
10. construct the sync-owned `OutboxDrainLease`;
11. construct `AdmittedRealtimeEnvelope`;
12. drop the registry guard;
13. return the admitted wrappers.

The `AdmittedRealtimeEnvelope` declaration retains this semantic field order:

```rust
pub struct AdmittedRealtimeEnvelope {
    envelope: RealtimeEnvelope,
    lease: OutboxDrainLease,
    publication_authority: Option<RealtimePublicationPermit>,
    recovery_marker: bool,
}
```

Rust drops fields in declaration order. The lease must be dropped while the publication permit remains live. Reversing those fields opens a revocation cut between sink acknowledgement and publication-permit release.

That order is already explicit and documented as semantic at
`crates/snapback-sync/src/ephemeral.rs:1419-1426`; it is not a source-design
guess.

The selected frame remains physically leased in the sync queue. The kernel receives only borrowed rank-0 message shapes and mints only its publication permit.

### 6.5 Other direct registry accesses

Moving the registry also requires replacing every direct sync access:

```rust
impl AuthorizationCommitParticipant {
    pub fn pending_reauthorizations(&self) -> Vec<PendingRoomReauthorization>;
    pub fn room_generation(&self, room: &RoomId) -> u64;

    pub fn begin_room_creation_admission(
        &self,
        room: &RoomId,
    ) -> Result<RoomCreationAdmission<'_>, EphemeralError>;

    pub fn begin_room_retirement_admission(
        &self,
        room: &RoomId,
    ) -> Result<RoomRetirementAdmission<'_>, EphemeralError>;

    pub fn begin_room_reauthorization_admission(
        &self,
        room: &RoomId,
        generation: u64,
    ) -> Result<RoomReauthorizationAdmission<'_>, EphemeralError>;
}
```

Each guard has private fields and a finite, operation-specific method set. None accepts a closure, caller disposition, registry state value, or raw registry accessor.

Required lock orders:

- room creation: registry admission, then sync room map;
- retirement: registry admission, then sync room map;
- reauthorization completion: sync lifecycle read guard, then registry admission, then sync room map;
- resync snapshot: copy under registry guard, release it, then lock rooms/outboxes;
- generation-exhaustion retirement: registry admission before room mutation.

A general-purpose public registry lock or state getter is forbidden.

The production census is finite. Excluding the registry's own implementation
and `#[cfg(test)]` assertions, exactly five `self.shared.room_authority.state`
sites exist today, and each has a named replacement:

| Current production site | What it does now | Required replacement after the move |
| --- | --- | --- |
| `pending_room_reauthorizations`, `crates/snapback-sync/src/ephemeral.rs:4729-4770` | Copies settled, no-pending-ticket resync obligations, then joins them to sync-owned subscribers under the rooms map. | `participant.pending_reauthorizations()` returns only the copied kernel obligations; sync retains the subscriber join. Registry is released before rooms, preserving the current order. |
| `complete_room_reauthorization`, `ephemeral.rs:4772-4799` (the registry guard continues through the room update) | Under lifecycle → registry → rooms → room, validates the exact generation/obligation, applies subscriber resolutions, and clears or removes the obligation. | `begin_room_reauthorization_admission(room, generation)` returns a non-`Send` exact guard. Its only terminal methods are `complete_exact()` and `remove_missing_room()`, both bound to the already-validated room/generation; sync retains subscriber mutation and denial cleanup. No method accepts an authorization version, generation, or arbitrary disposition after construction. |
| `enqueue_room_authority_resyncs`, `ephemeral.rs:7312-7368` | Copies ready obligations under registry, releases it, then materializes sync-owned resync frames under rooms/outboxes and wakes delivery. | `participant.pending_reauthorizations()` supplies the copy. Frame construction, effect fences, queue push accounting, and notifier wake remain exactly here in sync. |
| `retire_generation_exhausted_room`, `ephemeral.rs:7551-7631` | Takes registry → rooms → room/outbox, monotonically retires the authority control, purges the room, and emits `EpochChanged`. | `begin_room_retirement_admission(room)` retains the registry guard and exposes only `retire_generation_exhausted()`. Sync retains routing removal, expiry-index cleanup, outbox purge/resync, reverse-index reconciliation, and wake. |
| protected branch of `with_room_create`, `ephemeral.rs:7639-7665` | Holds registry while checking the exact non-retired generation, then takes the rooms map so a stale permit cannot recreate a retired room. | `begin_room_creation_admission(room, generation)` retains a non-`Send` exact guard through sync room-map lookup/insert. It has no mutation or raw-state accessor. |

This table is also the deletion checklist: after the move, a production search
for `room_authority.state` in `snapback-sync` must be empty. Direct test
inspection sites currently begin at `ephemeral.rs:10123`; they migrate to
kernel unit tests or the finite public composition paths in §8 step 9, not to a
test-only raw state getter.

## 7. Exact preservation of LLP 0059

### 7.1 Lock ordering

The following remain unconditional:

- No participant, registry, room, notifier, or outbox lock is acquired while managed/direct Local or SQLite is held.
- Transaction bind uses only binding comparison, `Arc::ptr_eq`, atomic revision/generation loads, selector computation over owned snapshots, predecessor comparison, and `OnceLock::set`.
- Outbox drain acquires registry before outbox.
- Room creation, retirement, and reauthorization use finite guards that acquire registry before sync room state.
- Resync snapshotting releases registry before taking sync rooms or outboxes.
- No synchronous guard crosses `.await`, network I/O, filesystem I/O, client callbacks, or app/Contract execution.
- No general-purpose public lock accessor is introduced.

### 7.2 Premark before write

For an authorization event:

1. allocate the exact ticket;
2. add the ticket to every affected existing room;
3. add the dependency;
4. wait for active durable and room publication permits to drain;
5. transfer the reservation to the independently owned blocking task;
6. only then enter Local and SQLite.

No bind-time fallback may prepare a new reservation.

### 7.3 Retained-work draining

Every protected room or durable publication increments its active count under the registry guard and retains an opaque permit through final transport acceptance.

Permit `Drop`:

- decrements only the corresponding count;
- removes a retired room only when both pending tickets and active permits are empty;
- notifies `quiescent`.

The request future never owns the post-drain lifetime. Once the independently owned task takes the reservation, request cancellation cannot remove its ticket. That task always binds, cancels, rolls back, finalizes, or retains it as ambiguous.

### 7.4 Rollback

Known rollback compare-removes only the exact ticket and its own per-room marks. It never:

- restores a saved registry snapshot;
- resets a room generation from saved state;
- removes a sibling ticket;
- clears a sibling resync obligation.

A leaf becomes available only when no pending ticket remains.

### 7.5 Ambiguity

The kernel reconciles exact durable evidence:

- exact successor → committed finalization;
- exact predecessor → rollback;
- a valid newer state → reconcile without reverting it;
- unreadable, contradictory, or unresolved state → ambiguity.

Ambiguity disables rollback and retains the exact ticket indefinitely. No timeout, cancellation, observation, Drop path, or sync lifecycle event may reopen it.

### 7.6 After-Local sequencing

The tree stores ordinary effects and finalizers in separate thread-local
vectors, transfers both into `AfterLocalBatch`, and drains the complete ordinary
vector before the finalizer vector
(`crates/snapback-types/src/exec_guard.rs:41-46,118-141,224-241`). This ordering,
not callback registration order alone, is normative here.

Known commit settlement uses
`run_or_defer_after_local_finalizer_checked`; rollback remains an infallible
exact-remove finalizer. A ready interlock additionally requires an active Local
write scope before commit, so participant settlement cannot execute through
the helper's immediate outside-Local branch (`exec_guard.rs:202-208`).

Ordinary successor effects run first:

- reset;
- collection-definition publication;
- issuer replacement/binding;
- notifier work;
- other successor projections.

For a same-incarnation commit, at the issuer slot the engine resolves the exact
kernel-minted committed outcome and projects it through the already-bound
expectation view. This updates only `projected_authorization` and the exact
commit's `issuer_projected` bit. The drain records any checked ordinary failure,
continues to the finalizer so all cleanup/fail-closed work runs, and returns the
first typed failure. Only after exact issuer projection does the kernel
finalizer update
`durable_authorization`, the exact dependency/room marks, room generations, and
level-triggered obligations. If the outcome lookup or projection returns an
error, the activation is first latched closed and the finalizer refuses
settlement, leaving the ticket installed. If an ordinary effect panics,
finalizers are skipped and the ticket likewise stays installed; this is the
explicit behavior at `exec_guard.rs:199-201,231-241`.

For destructive rotation, the ordinary reset effect runs but there is no issuer
projection: the current carrier explicitly skips predecessor-issuer publication
across incarnations (`crates/snapback-sync/src/ephemeral.rs:4279-4283,4698-4701`).
The kernel finalizer advances projected and durable state together, settles the
room ticket, and records the outcome. Before dropping the transaction's Local
guard, the reset-only writer wrapper closes `ManagedLocalHandoff`; after the
batch and finalizer drain it returns an opaque `CommittedResetHandoff` token
without reopening. Before that transaction, the wrapper follows the generic
writer's activation state machine: `Disabled` and `ParticipantBound` have no
live issuer from which to mint an off-Local reservation and therefore execute
in one direct Local turn; `ParticipantReady` must prove its exact live
issuer-backed reservation, and an unavailable Ready projection refuses rather
than taking the direct branch. Both known-commit branches close and transfer
the same opaque handoff. The server uses token-owned Local turns to publish the
reset, suspend/clear the predecessor issuer, and authenticate/bind the exact
successor. Generic managed writers remain queued throughout. Successful
successor installation consumes the token by reopening. A classified
postcommit failure first suspends and clears every issuer projection and
globally closes the coordinator, then consumes the token to release the
transient writer-ordering latch; queued authorization writers wake only to
receive the lasting typed `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` refusal.
Cancellation or panic before that classified fail-closed transition still
leaves the handoff closed. This is a reset-only type transition, not a
caller-settable flag on the generic writer wrapper
(`crates/snapback-engine/src/local/engine.rs:8491-8505`;
`crates/snapback-server/src/server.rs:23755-23801`).

The expectation view therefore removes caller-supplied authorization values
without fusing issuer projection into settlement. The current fused callback
path at `crates/snapback-sync/src/ephemeral.rs:4273-4307,4688-4702` is deleted.
No ordinary effect can select rollback or ambiguity, and no finalizer can run
before the issuer phase.

## 8. Migration sequence

Every step below must end green with:

```text
cargo check --all-targets --workspace
```

No step may merge red. The temporary dual path is migration machinery, not closure.

### Step 1 — Add the kernel module additively

Introduce private registry, selector, ticket, known-commit state,
reservation-state, prepared-state, outcome, projected-authorization state,
expectation-view, permit, and admission-guard types under temporary
non-conflicting names. Existing sync behavior remains active.

### Step 2 — Add database-owned participant custody

Add:

- strong database-owned registry state;
- pending/bound/ready `LocalDatabase` interlock;
- take-once participant mint;
- activation identity;
- exact construction-binding and auth-time activation checks;
- sticky retirement and registry generation;
- controlled replacement.

Keep the existing Boolean interlock active until production switches.

### Step 3 — Add concrete storage carriers beside legacy callbacks

Change the existing reservation/prepared implementation internally to:

```rust
enum AuthorizationReservationImpl {
    Legacy(/* existing callback carrier */),
    Native(/* concrete fields from this spec */),
}
```

and the equivalent prepared enum.

No new public callback signature is added. The legacy variant remains visibly defective until deleted.

### Step 4 — Add the bound sync constructor

Add `LocalEphemeralBackend::for_serving_database` and a private internal backend mode selecting legacy, native, or unbound authority. Production does not switch yet.

### Step 5 — Mirror protected collection lifecycle

Add `replace_protected_room_catalog`. Update collection registration/replacement under the existing lifecycle exclusion. Characterize revision drift and bind-time stale behavior before switching transactions.

### Step 6 — Land the sync-owned outbox rewrite

Add `drain_outbox_with_authorization` or the equivalent backend inherent method. Switch every drain call. Preserve:

- exact classification;
- effect-fence matching;
- recovery markers;
- registry-before-outbox order;
- revalidation before permit mint;
- lease field before permit field;
- permit Drop accounting.

Replace all other direct registry-state access with the finite participant and guard APIs.

No inherent implementation in sync targets a kernel-owned type.

### Step 7 — Bind invalidation issuers to the kernel view

Add `AuthorizationExpectationView`, exact committed-outcome lookup, and
outcome-only same-incarnation projection. Switch `LiveInvalidationIssuer` to
bind once, read the projected view, and project only a kernel-minted outcome in
the ordinary after-Local issuer slot. Preserve rotation's no-predecessor-
projection branch and bind the successor view after settlement. Remove
production mutable installation of caller-supplied authorization expectations.
Characterize same-incarnation advancement, reset, retirement signing,
destructive-incarnation rotation, ordinary-effect panic, and missing
same-incarnation projection.

### Step 8 — Switch production composition and transactions

Production construction:

1. mints through the serving database;
2. builds the sync backend;
3. binds the backend against the same serving database but leaves it dormant;
4. at the existing auth-invalidation enable point, obtains the exact
   database-owned view, binds the issuer, and activates `ParticipantReady` (or
   performs the exact ready-state successor-issuer rebind after reset);
5. prepares native reservations only after the participant activation acquire-loads ready;
6. passes the committing `LocalDatabase` interlock state into bind;
7. queues issuer projection as an ordinary after-Local effect and kernel settlement as a finalizer, using only concrete kernel types.

At this step the legacy path may remain only for unmigrated tests. Defect 2 is still open while the public factory exists.

### Step 9 — Migrate tests

- Move registry state-machine tests into kernel unit tests.
- Run sync queue/permit tests through real serving composition where authorization behavior matters.
- Use the explicitly unbound backend only for tests that do not reserve or settle authorization commits.
- Introduce no public or `test-support` participant constructor.
- Introduce no public bind, committed, rollback, or ambiguous test seam.

### Step 10 — Delete the legacy sync registry core

Remove sync’s:

- `RoomAuthorityRegistry`;
- selector and dependency state;
- room reservation/prepared wrappers;
- registry `prepare_unbound`;
- registry finalize/rollback core;
- direct registry fields.

Sync retains queue, subscriber, resync materialization, and transport code.

### Step 11 — Delete callback carriers

Remove:

- `AuthorizationCommitCarrierFactory`;
- every public callback constructor;
- callback fields in reservation and prepared carriers;
- `install_authorization_commit_carriers`;
- `for_test`;
- `bind_for_test`;
- `committed_for_test`;
- `ambiguous_for_test`;
- `AuthorizationReservationCancellation::default()`.

Collapse the internal dual-path enums to their native concrete forms. Make `PreparedAuthorizationCommit` `pub(crate)`.

### Step 12 — Run closure, ownership, and reference gates

Require:

- no `dyn Fn`, `dyn FnMut`, `dyn FnOnce`, `impl Fn`, `impl FnMut`, or
  `impl FnOnce` in any `snapback-kernel` public signature;
- no callback type alias reachable from a kernel public API;
- no feature-selectable settlement or participant factory;
- no public prepared carrier;
- no sync inherent implementation for a kernel-owned type;
- no kernel dependency on sync or auth;
- updated LLP 0225 ownership records;
- updated LLP 0284 acceptance fixtures;
- `./ref-check --verbose`;
- affected inventory and guide checks where applicable.

No F-1 closure claim is allowed until steps 10–12 delete the legacy path.

## 9. LLP 0285 acceptance classification

| Item | Status | Reason |
| --- | --- | --- |
| `RoomAuthorityRegistry` | **UNNAMEABLE** | Kernel-`pub(crate)`; no cross-crate state access. |
| `RoomAuthorityRegistryState` | **UNNAMEABLE** | Kernel-private mutex interior; neither projected nor settled authorization is returned mutably. |
| `RoomDependencySelector` | **UNNAMEABLE** | Kernel-`pub(crate)`; derived from the registered catalog and actual transaction impact. |
| `RoomDependencyTicket` | **UNNAMEABLE** | Kernel-`pub(crate)`; never returned cross-crate. |
| `KnownAuthorizationCommit` | **UNNAMEABLE** | Kernel-`pub(crate)`; set only from the kernel-derived SQLite verdict. |
| `AuthorizationParticipantActivation` | **UNNAMEABLE** | Kernel-private state and constants; public code receives no readiness setter. |
| `AuthorizationInterlockState` | **UNNAMEABLE** | Private `LocalDatabase` field; sync cannot supply the ready registry passed to bind. |
| `PreparedAuthorizationCommit` | **UNNAMEABLE** | Kernel-`pub(crate)`; only kernel commit reconciliation consumes it. |
| `AuthorizationCommitParticipant` | **POWERLESS** | Public for composition and exact observation, but cannot bind a transaction, select a terminal outcome, manufacture an outcome, or finalize. |
| `AuthorizationCommitReservation` | **POWERLESS** | Public opaque owner value; no constructor or public bind method. |
| `AuthorizationReservationCancellation` | **POWERLESS** | `new` creates only a cancel flag; it cannot mint a reservation, bind, or select a result. `Default` remains deleted. |
| `ManagedAuthorizationReservationScope` | **POWERLESS** | Manages TLS ownership and cleanup only. |
| `DatabaseBinding` | **POWERLESS** | Routing identity; asserts no durable authorization fact. |
| `AuthorizationExpectationView` | **POWERLESS** | Reads projected state and can project only the exact private-field kernel outcome; it accepts no authorization value or terminal disposition. |
| `AuthorizationCommitOutcome` | **POWERLESS** | Opaque evidence of the kernel's known-commit verdict; it can project only its own successor and cannot acknowledge, finalize, roll back, or make ambiguity committed. |
| `PendingRoomReauthorization` | **POWERLESS** | Copied observation of a level-triggered obligation; construction or omission cannot clear it. |
| `AuthorizationOutboxAdmission` | **POWERLESS** | Kernel classifies and rechecks borrowed messages before minting permits. |
| `OutboxFrameDisposition` | **POWERLESS** | Caller-constructible, but never accepted by the kernel as proof. |
| `RealtimePublicationPermit` | **POWERLESS** | Opaque count for already-admitted work; Drop only releases it. |
| `RoomAuthorityPermit` | **POWERLESS** | Bound to exact registry, room, and generation. |
| `DurableAuthorizationPermit` | **POWERLESS** | Bound to one registry’s durable-publication count. |
| `RoomCreationAdmission` | **POWERLESS** | Exact room/generation validation retained through sync room creation; no mutation or raw state access. |
| `RoomRetirementAdmission` | **POWERLESS** | Only monotone retirement of its exact room is exposed. |
| `RoomReauthorizationAdmission` | **POWERLESS** | Can complete or remove only its already-validated exact room/generation obligation. |
| `AuthorizationCommitCarrierFactory` | **DELETED** | No callback factory remains. |
| Public test settlement/factory seams | **DELETED** | Tests use kernel-private unit seams or real composition. |

Constructor custody is defense in depth, not the security proof. Possession of a participant still provides no method that can manufacture a prepared carrier or select a committed, rolled-back, or ambiguous outcome.

## 10. Required verification

### 10.1 Database binding

Tests must establish:

- participant A cannot bind or activate against database B;
- a second registry for A cannot activate against A’s pending exact registry;
- backend construction ends `ParticipantBound`, not `ParticipantReady`;
- auth-invalidation installation at the current enable point performs the `Bound -> Ready` transition;
- transaction bind reads the committing `LocalDatabase` state and repeats database-binding, registry-binding, exact-registry, activation, and all-generation checks;
- old reservations fail after same-database replacement;
- a dropped pending participant leaves the database fail-closed;
- unbound backends cannot reserve.

### 10.2 Prepare and bind

Tests must establish:

- pending marks exist before the quiescence wait;
- cancellation exact-unmarks only the owned ticket;
- retirement wakes a blocked prepare and exact-unmarks it;
- catalog replacement after prepare produces `SNAPBACK_AUTH_RESERVATION_STALE`;
- neutral preflight plus an actual authorization event fails stale;
- actual selector coverage is checked;
- non-rotating successor comparison is exact;
- a ready participant outside a managed/direct Local write scope fails before COMMIT;
- bind acquires no registry mutex.

### 10.3 Settlement

Tests must establish:

- known commit schedules the finalizer;
- ordinary successor effects execute before registry settlement;
- issuer projection changes `projected_authorization` but not `durable_authorization`;
- the finalizer refuses settlement when the exact outcome was not projected;
- outcome-observation failure and issuer-projection failure each return
  `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` to the initiating direct and managed
  operation, retain the dependency, and refuse later reservations;
- a direct mutation whose durable commit precedes the failure returns an error
  while retaining a `Confirmed` receipt, and direct reset/mode provisioning
  classify the result as commit-uncertain rather than rolled back;
- two exact outcomes in one synthetic after-Local batch project A then B and finalize A then B without requiring finalizer A to mistake latest projected B for its own projection;
- a forged witness cannot obtain an outcome;
- an outcome from database A or an old registry generation cannot project a view for B/current A;
- destructive rotation cannot project through the predecessor view, advances
  both kernel facts in the finalizer, and binds a successor view only after the
  same database snapshot matches the settled registry outcome;
- an ordinary-effect panic leaves the ticket installed;
- known rollback removes only the exact ticket;
- ambiguous outcome retains the ticket;
- issuer expectation advances in the ordinary phase and converges with registry durable authorization only after the finalizer;
- destructive rotation makes the old issuer view fail closed;
- ignoring committed outcomes or reauthorization observations cannot reopen rooms.
- clearing the exact installed issuer suspends projection before either issuer
  copy is dropped; a later authorization-affecting seed returns
  `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` before SQLite changes;
- a reservation minted before projection suspension fails transaction bind and
  exact-rolls back its ticket rather than committing or reaching finalization.
- a writer is observably queued on the closed reset handoff when reset
  finalization fails; after the lasting global/projection refusal is installed,
  the handoff releases and that exact writer wakes with the typed refusal
  without entering its Local committing closure.

### 10.4 Outbox and retained work

Characterization must cover every current classification branch:

- durable no-auth;
- durable dependency pending;
- durable matching or stale authorization;
- authority-independent ephemeral boundary;
- missing room at generation zero or nonzero;
- retired room;
- generation mismatch;
- room dependency pending;
- current and stale `AuthChanged` resync;
- ordinary frame during resync;
- fenced and unfenced admission.

Additional tests must establish:

- registry is acquired before outbox;
- effect-fence and recovery-marker behavior is unchanged;
- selected envelopes are rechecked before permit mint;
- lease drop occurs while the publication permit remains live;
- permit Drop wakes prepare waiters;
- no synchronous guard crosses `.await`;
- reauthorization retains lifecycle → registry → rooms order.

### 10.5 Security surface

Compile-fail fixtures must reject:

- participant struct literals;
- reservation struct literals;
- prepared carrier naming or construction;
- participant cloning;
- committed-outcome struct literals;
- an authorization-expectation view constructed from a caller-supplied `AuthorizationVersion`;
- any deleted callback factory method;
- any `Default` participant, reservation, prepared carrier, or cancellation token;
- any public `Fn`-accepting kernel constructor for these types.

## 11. Honest limitations and open proof obligations

Neither blind design was compiled. This synthesis does not convert that uncertainty into assurance.

The following remain open until implementation compiles and affected tests pass:

1. Whether a public opaque guard containing `std::sync::MutexGuard<'a, _>` crosses the kernel/sync boundary with the intended privacy and lifetime shape.
2. Whether the two sync-private classifier closures can immutably borrow one admission guard during queue selection and permit a later mutable `admit_selected` call without restructuring.
3. Whether storing the non-`Clone` participant inside `Arc<EphemeralShared>` satisfies every existing `Send` and `Sync` bound.
4. Whether every reservation owner preserves cancellation and watchdog behavior after replacing callback carriers with concrete fields.
5. Whether every current authorization-commit caller is inside the managed or
   direct `LocalSnapbackWriteScope` that revision (b) now requires before
   COMMIT. The main direct compatibility owner is concrete at
   `crates/snapback-engine/src/local/engine.rs:7865-7890`, but the call sites in
   `storage/auth.rs`, `storage/auth_mode.rs`, `storage/schema_seed.rs`, and
   `storage/auth_logical_transfer.rs` have not been compiled against the new
   precommit check.
6. Whether `AuthorizationExpectationView`'s separate projected state preserves
   every `LiveInvalidationIssuer` clone, reset, retirement-signing, and
   destructive-incarnation path. The exact insertion point for ordinary
   projection is named for normal and activation commits
   (`engine.rs:16411-16416,9233-9240,27748-27762`) and the reset/collection
   effects are named (`engine.rs:7976-7981,8615-8635`), but a compiled
   all-producer census remains required.
7. Whether protected-catalog replacement can share the collection lifecycle exclusion without introducing a collection-lock-to-registry inverse.
8. Whether canonical room-ID derivation can move or be shared without semantic drift or an upward dependency.
9. Whether every direct registry test can move into kernel tests or real serving composition without a forbidden public test factory.
10. Whether the same-database replacement path needs additional state transfer beyond deliberate room/catalog rebuild. Neither source compiled that integration.
11. Whether the proposed strong `LocalDatabase`-owned registry plus weak
    activation and the backend method that co-borrows `LocalEphemeralBackend`
    and `&mut ServingDatabase` fit the current engine borrow structure without
    borrow-checker repair.
12. LLP 0284’s public-surface fixtures and ownership classifications must be amended with this change; their exact expected diagnostics remain to be validated.
13. Source 2’s `SettlementSlot` design avoided calling registry settlement under
    Local but introduced a split terminal. This synthesis still rejects the
    slot. Revision (b)'s replacement — kernel-only `known_commit`, exact outcome
    projection in the ordinary bucket, and settlement in the finalizer bucket —
    is concrete, but has not been compiled. In particular, the proposed
    `committed_outcome(witness, min_commit_version)` lookup must prove unique for
    seed, reset, activation, auth-mode, and ordinary mutation results without
    adding a new serialized field or callback carrier.
14. `ConnectionEffectFence` is rank-0 today. If its ownership moves before implementation, the outbox boundary must be re-audited rather than relying on this census.
15. Kernel code cannot inspect an auth-owned `LiveInvalidationIssuer` to prove
    that it stored the boot or reset expectation view without introducing the
    upward dependency forbidden by LLP 0225. Revision (b) therefore specifies
    the replacement order at the current engine seam
    (`engine.rs:7749-7773`) and makes it testable, but leaves open whether
    implementation discovers a kernel-opaque bind receipt that strengthens
    this check without becoming a caller-asserted readiness fact. The fallback
    is not early construction activation.
16. The `ParticipantReady` successor-issuer rebind is matched to the current
    post-publication server reset path
    (`crates/snapback-server/src/server.rs:23755-23801`), but the proposed
    database/view API and its exact latest-outcome comparison have not been
    compiled through both legacy and versioned coordinated-reset carriers.

If the cross-crate `MutexGuard` shape fails, the permitted fallback is an opaque, non-`Send` admission session with the same finite classify, recheck, and permit methods. The following are not acceptable fallbacks:

- a callback;
- a public trait implemented by sync;
- a caller-supplied disposition accepted as proof;
- a raw registry accessor;
- a public settlement acknowledgement;
- a public terminal token;
- moving sync queue ownership into the kernel.

## 12. Status

This document is **Accepted** (Charlie Cheever, 2026-08-20), which unblocks LLP 0285
§6 step 8. Acceptance is of the specification; the open items below are inherited by
implementation and are not resolved by acceptance.

The grok-4.6 LLP 0005 review returned **NEEDS REVISION**; revision (b) answers
that review but has not itself received a READY verdict, has not been compiled,
and has not been accepted by the author. It authorizes no implementation. LLP
0285 step 8 remains blocked pending author acceptance of this specification.
