# LLP 0290: Database-bound authorization commit participant and sync outbox split

**Type:** Spec  
**Status:** Draft  
**Systems:** Security/authorization, Rust core, Storage, Live/realtime, Auth, Verification  
**Author:** codex `gpt-5.6-sol`, synthesizing two independent blind designs — codex
`gpt-5.6-sol` and grok-4.6 — orchestrated by Claude (Opus 5) for Charlie Cheever  
**Date:** 2026-08-20  
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
> **Draft only.** This specification has not been through the LLP 0005 review loop. It authorizes no implementation, no ownership claim, and no F-1 closure claim. LLP 0285 step 8 remains blocked until this document is reviewed and accepted.

## Summary

LLP 0285 requires the authorization-commit and room-authority mechanism to move from `snapback-sync` into `snapback-kernel`, but §8 risk 4 correctly blocks that move until `AuthorizationCommitParticipant` is concrete.

This specification resolves that risk:

- `snapback-kernel` owns a database-bound `RoomAuthorityRegistry`, dependency tickets, selectors, reservation binding, settlement, publication permits, committed authorization state, and level-triggered room reauthorization obligations.
- `snapback-sync` continues to own `SharedOutbox`, `OutboundQueue`, `OutboxDrainLease`, `AdmittedRealtimeEnvelope`, `ConnectionEffectFence` queue matching, room subscriber policy, resync materialization, and transport handoff.
- `AuthorizationCommitParticipant` has private fields, no public constructor, no `Clone`, and no public terminal-settlement method. A serving database is the sole production mint.
- Installation uses a pending/ready handshake that compares the database binding, the exact registry `Arc`, the registry generation, and a take-specific activation identity. A participant minted by database A cannot activate beside database B.
- A public, opaque `AuthorizationCommitReservation` remains because the current server and engine carry it through the independently owned blocking task. It has no public constructor and no public bind method.
- `PreparedAuthorizationCommit` is `pub(crate)`. Its kernel-only `finalize_committed`, `finalize_rolled_back`, and `finalize_ambiguous` methods accept no closure.
- Known commit settlement is a kernel finalizer, not a sync acknowledgement. A kernel-owned `AuthorizationExpectationView` makes the invalidation issuer observe the same committed authorization state as the registry.
- Outbox draining becomes a sync-owned free function or inherent method on the sync-owned backend. It holds a finite kernel admission guard, calls sync-private queue selection, revalidates selected envelopes, and constructs the sync-owned lease wrapper with its load-bearing field order intact.
- LLP 0059’s lock order, premark-before-write, retained-work draining, exact rollback, and fail-closed ambiguity rules remain unchanged.

No `dyn Fn`, `impl Fn`, `impl FnMut`, or `impl FnOnce` appears in any `snapback-kernel` public signature introduced by this design.

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
- Installation uses Source 1’s pending/ready activation handshake and rejects A-beside-B before the composed server becomes usable.
- Bind repeats the binding and exact-`Arc` checks as defense in depth.
- Source 2’s sticky `retired` flag and registry generation handle controlled same-database replacement.

A bind-time rejection alone is insufficient for LLP 0285 §8 risk 4: a mismatched backend could already have registered and suspended the wrong process-local rooms. Activation must reject the mismatch before serving starts.

### 1.2 Participant fields

**Disagreement.**

- Source 1 proposed the minimal `{ binding, registry }`.
- Source 2 added a registry generation and separated a cloneable internal handle from the non-cloneable participant.

**Decision.** Use explicit binding, exact registry, registry generation, and a take-specific activation identity. Do not expose a public handle getter. The generation detects same-database registry replacement; the activation identity detects stale or substituted pending participants.

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

**Decision.** Choose Source 1.

Source 2 removed callbacks, but it still split a known commit into a kernel “ready” fact and a sync-selectable terminal action. That preserves more settlement authority above the kernel than LLP 0285’s “kernel derives, never accepts” rule allows. A caller able to drain and finalize a settlement could skip issuer publication or reorder it.

The kernel instead owns the committed transition. `LiveInvalidationIssuer` reads the same kernel state through `AuthorizationExpectationView`; no sync acknowledgement decides whether rooms reopen. Sync observes level-triggered reauthorization obligations and materializes resync work without controlling settlement.

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

**Decision.** Adopt Source 2’s retirement mechanism within Source 1’s pending/ready database handshake. Old reservations, permits, guards, and participants fail closed after replacement.

### 1.9 Initial durable authorization

**Disagreement.**

- Source 1 required the kernel to read initial durable authorization state itself.
- Source 2 exposed participant installation of a durable authorization expectation from sync.

**Decision.** Choose Source 1. A participant accepts no initial `AuthorizationVersion`. The serving database reads the durable authorization-stream row when minting the registry.

### 1.10 What moves from `finish_room_authorization_commit`

**Disagreement.**

- Source 1 replaced issuer publication with a kernel view and moved terminal registry settlement into the kernel.
- Source 2 kept an explicit sync settle operation because the current function also publishes the issuer and enqueues resync frames.

**Decision.** The current function does not move intact:

- Kernel settlement and committed authorization state move.
- Mutable issuer installation is replaced by the read-only kernel view.
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
    activation_identity: Arc<()>,
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
- `activation_identity` binds this take operation to the pending database slot.

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
- `durable_authorization` read by the kernel from the durable authorization stream;
- no active durable publications;
- an empty protected catalog at revision 1;
- `next_outcome_sequence = 1`;
- no committed outcome.

The participant never accepts the initial durable authorization from sync, engine, auth, or a test factory.

### 3.3 Tickets and selectors

```rust
pub(crate) struct RoomDependencyTicket {
    ticket_id: u64,
    expected_authorization: Arc<OnceLock<AuthorizationVersion>>,
    registry_generation: u64,
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
    selector: RoomDependencySelector,
    affected_rooms: BTreeSet<RoomId>,
}
```

Their present meanings do not change:

- ticket identity is exact and process-local;
- `OnceLock::set` is the only transaction-time ticket mutation;
- selectors retain their current `matches` and `covers` semantics;
- rollback and cancellation remove only one exact ticket and its marks.

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
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorizationCommitOutcome {
    sequence: u64,
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

## 4. Constructor custody and database installation

### 4.1 Sole constructor

The only participant constructor is kernel-private:

```rust
impl AuthorizationCommitParticipant {
    pub(crate) fn new(
        binding: DatabaseBinding,
        registry: Arc<RoomAuthorityRegistry>,
        registry_generation: u64,
        activation_identity: Arc<()>,
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

The current Boolean interlock becomes:

```rust
enum AuthorizationInterlockState {
    Disabled,
    ParticipantPending {
        registry: Arc<RoomAuthorityRegistry>,
        registry_generation: u64,
        activation_identity: Weak<()>,
    },
    ParticipantReady {
        registry: Arc<RoomAuthorityRegistry>,
        registry_generation: u64,
    },
}
```

The strong registry `Arc` is held by the database in both pending and ready states. The `Weak` value tracks whether the one returned participant still exists without transferring registry ownership out of the database.

`take_authorization_commit_participant`:

1. Requires `Disabled`.
2. Reads the durable authorization stream through the kernel-owned database.
3. Creates the registry with the database’s `DatabaseBinding`.
4. Creates a fresh `activation_identity`.
5. Stores the exact registry, generation, and weak activation identity as `ParticipantPending`.
6. Returns the non-cloneable participant.
7. A second take returns `SNAPBACK_AUTH_PARTICIPANT_ALREADY_TAKEN`.

No authorization-changing transaction may proceed in `ParticipantPending`.

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
4. Call `database.activate_authorization_commit_participant(&participant)`.
5. Return the backend only after activation succeeds.

Backend clones clone `Arc<EphemeralShared>`, not the participant.

The activation method is:

```rust
impl ServingDatabase {
    pub fn activate_authorization_commit_participant(
        &mut self,
        participant: &AuthorizationCommitParticipant,
    ) -> SnapbackResult<()>;
}
```

Activation succeeds only when:

- the participant binding matches the serving database binding;
- the participant registry binding also matches;
- the database is in `ParticipantPending`;
- `Arc::ptr_eq` matches the exact pending registry;
- the registry generation matches both stored generation values;
- the pending activation identity upgrades;
- `Arc::ptr_eq` matches the participant’s activation identity;
- the registry is not retired.

It then transitions atomically to `ParticipantReady`.

Failures are closed-form:

- `SNAPBACK_AUTH_PARTICIPANT_DATABASE_MISMATCH`;
- `SNAPBACK_AUTH_PARTICIPANT_REGISTRY_MISMATCH`;
- `SNAPBACK_AUTH_PARTICIPANT_GENERATION_MISMATCH`;
- `SNAPBACK_AUTH_PARTICIPANT_NOT_PENDING`;
- `SNAPBACK_AUTH_PARTICIPANT_DROPPED`;
- `SNAPBACK_AUTH_INTERLOCK_RETIRED`.

No public bound-backend constructor accepts an arbitrary participant. A kernel-private or sync-private helper may do so only inside `for_serving_database`.

### 4.4 Why A cannot be installed beside B

Four checks close LLP 0285’s named failure:

1. Public bound composition takes `&mut ServingDatabase`, not a participant argument.
2. Activation compares the `DatabaseBinding` before returning the backend.
3. Activation compares the exact registry `Arc`, generation, and activation identity.
4. Transaction bind repeats database, registry, generation, ready-state, and retirement checks.

A participant from A cannot activate against B. A stale participant from an earlier registry generation cannot activate against a replacement registry for A. Even if composition code is later changed incorrectly, transaction bind still refuses the mismatch.

### 4.5 Same-database replacement

`replace_authorization_commit_participant` is permitted only from `ParticipantReady`.

It:

1. sets `old_registry.retired = true` with `Release`;
2. notifies `quiescent`, waking blocked prepare waiters;
3. creates a new registry with the same `DatabaseBinding` and generation `old + 1`;
4. reads the current durable authorization stream;
5. installs the new registry as `ParticipantPending`;
6. returns a new non-cloneable participant.

Every operation on the old registry acquire-loads `retired` and fails closed. A prepare waiter awakened by retirement compare-removes its own ticket and returns `SNAPBACK_AUTH_INTERLOCK_RETIRED`.

No state is copied from the old room map. The caller must rebuild sync-owned rooms and collection policy through the normal lifecycle before activation.

### 4.6 Unbound backend

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

1. verifies the participant is live and activated against its database;
2. validates definitions using the canonical collection validator;
3. retains only collections whose publish or subscribe policy requires room permission;
4. stores an owned `Arc<[EphemeralCollection]>`;
5. increments the non-wrapping protected-catalog revision;
6. publishes the revision through `catalog_revision.store(revision, Release)`;
7. returns the installed revision.

There is no separate public “publish generation” method and no method accepting an empty selector as a reservation proof.

Sync calls this method inside the same collection-definition lifecycle exclusion that publishes its collection map. It validates and owns the new definitions before entering either lock. The kernel catalog is updated before the sync map becomes visible; the registry lock is released before the sync collection map is published. Failure after the kernel update may over-fence but must not under-fence.

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

1. requires the participant’s registry to be the database’s `ParticipantReady` registry;
2. snapshots the protected catalog, catalog revision, and durable predecessor under the registry mutex;
3. derives the conservative selector;
4. allocates one exact ticket;
5. computes the affected existing-room set;
6. prechecks ticket and generation exhaustion;
7. inserts the ticket into every affected room;
8. inserts the dependency;
9. waits for durable and room publication permits to drain;
10. on cancellation or retirement, compare-removes only that ticket and its marks;
11. returns the opaque reservation with its owned snapshot.

Steps 7 and 8 occur before the wait. Only after the wait succeeds may the blocking owner acquire Local and enter SQLite.

### 5.4 Bind

Only kernel transaction code may call:

```rust
impl AuthorizationCommitReservation {
    pub(crate) fn bind(
        self,
        database_binding: &DatabaseBinding,
        ready_registry: &Arc<RoomAuthorityRegistry>,
        ready_registry_generation: u64,
        durable_predecessor: Option<&AuthorizationVersion>,
        witness: &AuthorizationCommitWitness,
        impact: AuthorizationCommitImpact<'_>,
    ) -> SnapbackResult<PreparedAuthorizationCommit>;
}
```

Bind performs, in this order:

1. exact `DatabaseBinding` comparison;
2. exact `Arc::ptr_eq` registry comparison;
3. registry-generation comparison;
4. acquire-load of `retired`, rejecting a retired registry;
5. require `witness.event`;
6. acquire-load `catalog_revision` and require equality with the reservation snapshot;
7. derive the actual selector from the transaction’s actual schema and changes using the reservation’s protected-catalog snapshot;
8. require `reserved_selector.covers(actual_selector)`;
9. for a non-rotating witness:
   - require the reserved predecessor to equal the transaction-read durable predecessor;
   - require the same incarnation;
   - require exact epoch `+1`;
10. bind the ticket’s `OnceLock` to `witness.version`;
11. transfer rollback ownership to `PreparedAuthorizationCommit`.

A neutral reservation presented with an authorization event returns `SNAPBACK_AUTH_RESERVATION_STALE`.

Bind acquires no registry, room, outbox, issuer, or SQLite-adjacent process mutex. Its only mutation is `OnceLock::set`. Pointer comparisons, atomic loads, selector computation over owned data, and predecessor comparisons preserve LLP 0059’s transaction-time lock prohibition.

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
2. verifies lock-free facts that can be checked before scheduling;
3. schedules a kernel-owned finalizer through `run_or_defer_after_local_finalizer`, or runs immediately only when already outside Local and ordinary successor publication is complete.

The finalizer locks the registry and, before mutating, validates:

- the registry is not retired;
- the registry generation matches;
- the exact dependency still exists;
- the ticket is bound;
- the bound authorization equals the committed authorization;
- the affected-room marks still name this ticket.

It then atomically:

1. updates `durable_authorization`;
2. removes only the exact dependency;
3. removes only this ticket from affected rooms;
4. increments each live affected room generation;
5. installs each level-triggered reauthorization obligation;
6. records `latest_committed_outcome`;
7. notifies the condition variable.

If validation unexpectedly fails, no ticket or mark is removed. A known commit is never converted into rollback. In a deferred finalizer, an invariant failure is fail-closed and may panic after leaving the ticket installed, matching the current finalizer posture.

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
    issuer_incarnation: Arc<str>,
}
```

Fields are private; there is no public constructor.

```rust
impl AuthorizationCommitParticipant {
    pub fn authorization_expectation_view(
        &self,
        issuer_incarnation: &str,
    ) -> SnapbackResult<AuthorizationExpectationView>;

    pub fn latest_committed_outcome(
        &self,
    ) -> Option<AuthorizationCommitOutcome>;

    pub fn pending_reauthorizations(
        &self,
    ) -> Vec<PendingRoomReauthorization>;
}

impl AuthorizationExpectationView {
    pub fn current(&self) -> SnapbackResult<AuthorizationVersion>;
}
```

Creating the view verifies the requested incarnation against the registry’s kernel-read durable authorization. `current` fails closed if:

- the registry is retired;
- the registry generation changed;
- the durable authorization is absent; or
- the committed incarnation no longer matches the issuer.

`LiveInvalidationIssuer` replaces its caller-installed mutable authorization expectation with a bind-once view:

```rust
impl LiveInvalidationIssuer {
    pub fn bind_authorization_expectation(
        &self,
        view: AuthorizationExpectationView,
    ) -> SnapbackResult<()>;
}
```

After binding, `authorization_expectation()` reads the kernel view. Production `install_authorization_expectation(AuthorizationVersion)` is removed.

Consequences:

- issuer and room registry observe one committed kernel fact;
- no sync callback or acknowledgement decides whether a commit finalizes;
- destructive incarnation rotation makes the predecessor view fail closed;
- ignoring `latest_committed_outcome` or pending reauthorization work can delay delivery but cannot alter settlement.

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

Known commit and rollback settlement use `run_or_defer_after_local_finalizer`.

Ordinary successor effects run first:

- reset;
- collection-definition publication;
- issuer replacement/binding;
- notifier work;
- other successor projections.

Only then does the kernel finalizer update committed room-authority state. If an ordinary effect panics, finalizers are skipped and the ticket stays installed.

The authorization expectation view removes the former mutable issuer-update callback from settlement. A finalizer updates the registry’s durable authorization and room obligations as one kernel-owned transition; every bound issuer subsequently observes that state.

## 8. Migration sequence

Every step below must end green with:

```text
cargo check --all-targets --workspace
```

No step may merge red. The temporary dual path is migration machinery, not closure.

### Step 1 — Add the kernel module additively

Introduce private registry, selector, ticket, reservation-state, prepared-state, outcome, expectation-view, permit, and admission-guard types under temporary non-conflicting names. Existing sync behavior remains active.

### Step 2 — Add database-owned participant custody

Add:

- strong database-owned registry state;
- pending/ready interlock;
- take-once participant mint;
- activation identity;
- exact activation checks;
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

Add `AuthorizationExpectationView`. Switch `LiveInvalidationIssuer` to bind once and read the view. Remove production mutable installation of caller-supplied authorization expectations. Characterize same-incarnation advancement, reset, retirement signing, and destructive-incarnation rotation.

### Step 8 — Switch production composition and transactions

Production construction:

1. mints through the serving database;
2. builds the sync backend;
3. activates against the same serving database;
4. enables the ready interlock;
5. prepares native reservations;
6. binds and finalizes using only concrete kernel types.

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

- no `dyn Fn` or `impl Fn*` in any kernel public signature;
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
| `RoomDependencySelector` | **UNNAMEABLE** | Kernel-`pub(crate)`; derived from the registered catalog and actual transaction impact. |
| `RoomDependencyTicket` | **UNNAMEABLE** | Kernel-`pub(crate)`; never returned cross-crate. |
| `PreparedAuthorizationCommit` | **UNNAMEABLE** | Kernel-`pub(crate)`; only kernel commit reconciliation consumes it. |
| `AuthorizationCommitParticipant` | **POWERLESS** | Public for composition, but cannot bind a transaction, select a terminal outcome, assert a successor, or finalize. |
| `AuthorizationCommitReservation` | **POWERLESS** | Public opaque owner value; no constructor or public bind method. |
| `ManagedAuthorizationReservationScope` | **POWERLESS** | Manages TLS ownership and cleanup only. |
| `DatabaseBinding` | **POWERLESS** | Routing identity; asserts no durable authorization fact. |
| `AuthorizationExpectationView` | **POWERLESS** | Read-only view of kernel-owned committed state. |
| `AuthorizationCommitOutcome` | **POWERLESS** | Observation cannot acknowledge or alter settlement. |
| `AuthorizationOutboxAdmission` | **POWERLESS** | Kernel classifies and rechecks borrowed messages before minting permits. |
| `OutboxFrameDisposition` | **POWERLESS** | Caller-constructible, but never accepted by the kernel as proof. |
| `RealtimePublicationPermit` | **POWERLESS** | Opaque count for already-admitted work; Drop only releases it. |
| `RoomAuthorityPermit` | **POWERLESS** | Bound to exact registry, room, and generation. |
| `DurableAuthorizationPermit` | **POWERLESS** | Bound to one registry’s durable-publication count. |
| `RoomCreationAdmission` and other finite guards | **POWERLESS** | Operation-specific validation only; no raw state access. |
| `AuthorizationCommitCarrierFactory` | **DELETED** | No callback factory remains. |
| Public test settlement/factory seams | **DELETED** | Tests use kernel-private unit seams or real composition. |

Constructor custody is defense in depth, not the security proof. Possession of a participant still provides no method that can manufacture a prepared carrier or select a committed, rolled-back, or ambiguous outcome.

## 10. Required verification

### 10.1 Database binding

Tests must establish:

- participant A cannot activate against database B;
- a second registry for A cannot activate against A’s pending exact registry;
- bind repeats both binding and exact-registry checks;
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
- bind acquires no registry mutex.

### 10.3 Settlement

Tests must establish:

- known commit schedules the finalizer;
- ordinary successor effects execute before registry settlement;
- an ordinary-effect panic leaves the ticket installed;
- known rollback removes only the exact ticket;
- ambiguous outcome retains the ticket;
- issuer expectation and registry durable authorization are the same kernel state;
- destructive rotation makes the old issuer view fail closed;
- ignoring committed outcomes or reauthorization observations cannot reopen rooms.

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
5. Whether all current commit sites invoke `finalize_committed` while the after-Local finalizer phase is available, including direct-library compatibility paths.
6. Whether `AuthorizationExpectationView` preserves every `LiveInvalidationIssuer` clone, reset, retirement-signing, and destructive-incarnation path.
7. Whether protected-catalog replacement can share the collection lifecycle exclusion without introducing a collection-lock-to-registry inverse.
8. Whether canonical room-ID derivation can move or be shared without semantic drift or an upward dependency.
9. Whether every direct registry test can move into kernel tests or real serving composition without a forbidden public test factory.
10. Whether the same-database replacement path needs additional state transfer beyond deliberate room/catalog rebuild. Neither source compiled that integration.
11. Whether the proposed strong database-owned registry plus weak activation identity fits the current `ServingDatabase` move and borrow structure without borrow-checker repair.
12. LLP 0284’s public-surface fixtures and ownership classifications must be amended with this change; their exact expected diagnostics remain to be validated.
13. Source 2’s `SettlementSlot` design avoided calling registry settlement under Local but introduced a split terminal. This synthesis rejects the slot, so its slot-list and `OnceLock` extraction questions do not apply. The replacement question—whether direct kernel finalization covers every current after-Local site—remains open.
14. `ConnectionEffectFence` is rank-0 today. If its ownership moves before implementation, the outbox boundary must be re-audited rather than relying on this census.

If the cross-crate `MutexGuard` shape fails, the permitted fallback is an opaque, non-`Send` admission session with the same finite classify, recheck, and permit methods. The following are not acceptable fallbacks:

- a callback;
- a public trait implemented by sync;
- a caller-supplied disposition accepted as proof;
- a raw registry accessor;
- a public settlement acknowledgement;
- a public terminal token;
- moving sync queue ownership into the kernel.

## 12. Status

This document is **Draft**.

It has not passed the LLP 0005 review loop, has not been compiled, and authorizes no implementation. LLP 0285 step 8 remains blocked pending review and acceptance of this specification.