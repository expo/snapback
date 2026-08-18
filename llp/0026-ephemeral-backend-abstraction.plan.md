# LLP 0026: Ephemeral backend abstraction hardening

**Type:** Plan
**Status:** Draft
**Systems:** Realtime, Ephemeral state, Runtime, Deployment, Client integration, Testing, Developer experience
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-29
**Revised:** 2026-07-17 (portable generation exhaustion now retires an exact room incarnation through the protected-authority/routing/outbox order and emits only a terminal epoch boundary); 2026-07-12 (ENG-24574: the historical room-byte budget now covers every conservatively estimated retained room allocation, request metadata has explicit byte/cardinality limits, and WebSocket frames are capped at 64 KiB); 2026-07-12 (ENG-24566/ENG-24570/ENG-24574: lifecycle replacement/reset now excludes old-generation operations, snapshots expose a room high-water version, coalesced drains are sorted, and whole-definition/exact-scope validation is atomic); 2026-07-12 (ENG-24355: the connection→rooms reverse index now tracks current ownership/subscription, rolls back failed creation, and compacts on unsubscribe/delete/expiry/retirement, bounding disconnect by current footprint; earlier: 2026-07-07 ENG-23346: the destructive-replacement boundary
clears only the ephemeral outbox lanes — queued durable live-query payloads
answer subscriptions that survive the boundary and are preserved; the
runtime reset still clears whole outboxes because it retires the durable
world too, and its caller signals the dropped durable subscriptions).
Previously 2026-07-02 (LLP 0032 L9 landed: Phases 1+2 marked landed with
their tests, then reconciled with the concurrently-landed ENG-22478 D2
resync-boundary semantics — EpochChanged on destructive replacement,
Restarted on reset, outboxes cleared at the boundary. Earlier the same day,
the as-built sharding design written before implementation and the
scope-epoch dead-code finding recorded with its resolution)
**Related:** LLP 0000, LLP 0008, LLP 0013, LLP 0014, LLP 0017, LLP 0018, LLP 0020, LLP 0025, LLP 0032, Diary 0007

## Summary

Snapback's ephemeral realtime model is the right product abstraction for cursors,
typing indicators, presence, selections, and other small high-frequency state:
typed, scoped, TTL-bound latest-state rooms, not durable rows and not raw
WebSocket events. The current local implementation has proved the core loop, but
it is still a concrete in-process store embedded in `LocalSnapback`, not a mature
backend abstraction.

This Plan hardens the implementation boundary without changing the app-facing
semantics owned by LLP 0013:

- introduce an explicit `EphemeralBackend` contract with local-memory,
  Redis-compatible, and Cloudflare Durable Object implementations as possible
  targets;
- separate room authority from the durable `LocalSnapback` mutex so one hot room
  cannot delay unrelated rooms or durable acknowledgements;
- add room-level expiry indexes, memory limits, diagnostics, and capability
  reporting;
- make value validation, lifecycle operations, and hosted-adapter behavior
  testable through one shared conformance suite;
- preserve the key rule that ephemeral state is lossy, bounded, Online-class
  runtime state, never durable/offline data.

## Motivation

The LLP 0025 cursor demo showed that the semantic direction works. A browser page
can load one generated ephemeral collection, open two real clients, publish cursor
positions over WebSocket, receive snapshot plus deltas, avoid durable writes, and
remove connection-owned entries on close.

That same work exposed the next abstraction problem. The local store currently
combines several concerns in one concrete Rust type:

- collection definition registry;
- room routing and room state;
- publisher admission and rate limits;
- subscriber registration;
- per-connection outbox coalescing;
- TTL cleanup;
- local diagnostics;
- schema-load lifecycle handling.

That is acceptable for the first local proof, but not enough for hosted targets
or production-grade local behavior. LLP 0013 already says a room authority should
own room maps, entry records, expiry indexes, subscriber lists, coalescing
buffers, and version counters, and that hosted targets may use Redis-compatible
infrastructure or Cloudflare Durable Objects. This document turns that broad
direction into an implementation hardening plan.

The goal is not to make ephemeral state more durable. The goal is to make the
non-durable abstraction honest and portable across targets.

## Current Shape

The implemented local backend already has the important product behaviors:

- generated schemas carry ephemeral collection definitions and budgets;
- publishes validate collection, scope, TTL, value size, auth, key ownership, and
  rate budget before changing the room;
- rooms store latest value per key with `scopeEpoch` and `entryVersion`;
- snapshots and subscriber registration happen as one local operation;
- per-connection outbound queues coalesce pending latest-state messages by room
  and key;
- durable messages drain ahead of ephemeral messages;
- disconnect and TTL cleanup remove entries without touching durable storage;
- client overlays keep ephemeral entries in memory and prune by expiry;
- collection `ensure` verifies loaded definitions without clearing rooms or
  outboxes on exact match.

The implementation gaps are equally clear:

- there is no trait or object boundary for alternate backends —
  **closed 2026-07-02 (Phase 1):** the internally synchronized
  `LocalEphemeralBackend` handle is the boundary; the trait spelling waits
  for the Phase 3 conformance suite;
- all HTTP/WebSocket operations still take the shared `LocalSnapback` mutex —
  **closed 2026-07-02 (Phase 2):** the ephemeral endpoints, WS socket-text
  operations, drains, and admin cleanup reach the room authority with no
  global mutex;
- room state is not a per-room actor, sharded lock, or adapter-owned
  authority — **closed 2026-07-02 (Phase 2):** sharded per-room locks (see
  the as-built note under §Room authority);
- TTL cleanup scans rooms instead of using an expiry heap, timing wheel, or
  adapter-native expiry index — **closed 2026-07-02 (Phase 2):** a
  room-granular expiry index; cleanup visits only due rooms;
- room memory limits and subscriber limits are not enforced as first-class
  capability facts — **closed 2026-07-02 (Phase 2):** store-level hard
  limits with structured `RoomLimitExceeded` rejections and a
  `limit_rejections` diagnostic;
- runtime value validation is byte-budget validation, not the generated value
  schema;
- auth is local and prefix-shaped; durable permission-change revocation is not
  integrated;
- hosted-adapter behavior is documented but not executable.

### Finding: scope-epoch machinery was dead code (recorded 2026-07-02)

LLP 0032's Phase 3 review confirmed, and this Plan now records, that the
shipped local backend allocated `scopeEpoch: 1` for every room and no event
ever advanced any epoch. The stale-detection contract in LLP 0013 §Stored
entry shape was therefore only half real: clients compared
`(scopeEpoch, entryVersion)` correctly, but the server could never produce a
second epoch, so the `RemoveReason::AuthRevoked`,
`ResyncReason::AuthChanged`, `ResyncReason::EpochChanged`, and
`ResyncReason::Restarted` machinery was unreachable. Two concrete
consequences: (a) an explicit runtime reset or a destructive
ephemeral-definition replacement discarded rooms, subscriber registrations,
and queued messages under live connections without any signal — the exact
"silent staleness" LLP 0013 forbids (bounded only by client TTL pruning); and
(b) a room destroyed and re-created restarted both `scopeEpoch` and
`entryVersion` at 1, so a straggling client comparison could classify a fresh
entry as stale instead of failing safe to resync.

Resolution (LLP 0032 L9, this Plan's Phase 2; the same wiring landed
concurrently upstream as ENG-22478 review fix D, and the sharded authority
adopts those ratified reasons): epochs advance for real — every room
incarnation allocates its `scopeEpoch` from a store-global monotonic
counter — and a `ResyncRequired` boundary is delivered to registered
subscribers when the authority discards their rooms: `Restarted` on explicit
runtime reset, `EpochChanged` on destructive definition replacement (both
covered by tests). At the boundary each outbox's ephemeral lanes are
cleared — everything queued *in those lanes* belongs to the retired epoch
world — while the durable lane survives a definition replacement, because
durable live-query subscriptions are not part of the ephemeral epoch world
and no durable resync would ever signal their queued payloads' loss
(ENG-23346; the runtime reset, which retires the durable world too, clears
whole outboxes and its caller signals the dropped durable subscriptions —
ENG-23333). `AuthRevoked` and
`AuthChanged` still have no owning event — durable permission-change
revocation is deliberately deferred (§Auth and revocation) — so those two
variants are removed until the events that own them exist, rather than
shipping as dead vocabulary.

## Design

### Boundary: semantic contract first

LLP 0013 remains the semantic source of truth. This Plan should not change the
meaning of a collection, room, key, TTL, `scopeEpoch`, `entryVersion`, snapshot,
upsert, remove, or `ResyncRequired`. It changes where that behavior lives and how
targets prove conformance.

The Rust boundary should make the app/runtime code depend on an
`EphemeralBackend`-like interface rather than on a concrete local map. The exact
Rust spelling can evolve, but the boundary should contain these operations:

- load or replace collection definitions as a provisioning operation;
- ensure collection definitions as a non-destructive runtime check;
- publish, delete, subscribe, disconnect, and cleanup expired entries;
- drain or push transport messages for a connection;
- inspect collections, rooms, queues, limits, and target capabilities;
- report capability errors when the target cannot route rooms correctly.

Schema definition changes and live room state must stay separate lifecycle
operations. Definition load may clear incompatible runtime state only as an
explicit provisioning event. Client boot should use non-destructive ensure.
Runtime reset should be explicit and observable.

### Room authority

The room authority is the unit that preserves the latest-state illusion. For the
local backend, move toward either:

- a per-room actor fed by async messages; or
- a sharded map with per-room locks and a small global routing/index lock.

Either is acceptable if it preserves the same externally visible contract:

- snapshot and subscriber registration cannot miss a concurrent publish;
- `entryVersion` allocation is room-local and monotonic within one epoch;
- expiry and disconnect removes are ordered with ordinary publishes for the same
  room;
- queue overflow produces `ResyncRequired` or an equivalent fresh snapshot, not a
  silently stale stream;
- durable mutation acknowledgements are not blocked behind a hot cursor room.

The current single `LocalSnapback` mutex is useful for v0 simplicity, but it
should not be the long-term room authority boundary.

#### As-built: sharded local room authority (written 2026-07-02, before the L9 implementation)

The local backend takes the **sharded map with per-room locks plus a small
global routing lock**, not the actor option: room operations are microsecond
memory operations, so an actor mailbox adds queuing without adding
correctness, and sharded locks match the codebase's existing style
(`ReaderPool`, `DeliveryNotifier`).

- **Boundary spelling.** `LocalEphemeralBackend` becomes an internally
  synchronized, cheaply cloneable handle (an `Arc` around private shared
  state). Its public methods are the backend contract; nothing outside the
  module can reach a room map. The Rust *trait* spelling is deferred to
  Phase 3, when the conformance suite provides a second consumer — until
  then a trait would be dead vocabulary (the same failure class as the
  scope-epoch finding above).
- **Lock decomposition.** Collections registry in a read-mostly `RwLock`;
  a routing map `Mutex<BTreeMap<RoomId, Arc<Mutex<RoomState>>>>` (the small
  global routing lock, held only for lookup/insert/remove); per-connection
  outboxes `Mutex<BTreeMap<ConnectionId, Arc<Mutex<OutboundQueue>>>>`; a
  rate-bucket map mutex; an expiry-index mutex; event counters as atomics.
  Gauges stay computed on demand at inspect time (LLP 0032 L4).
- **Lock order.** Ordinary state uses rooms-map → one room → { outbox map,
  one outbox, expiry index }, inner locks taken one at a time as leaves.
  Protected reauthorization and terminal generation retirement prepend the
  room-authority registry: registry → rooms-map → one room → one outbox. Never
  two room locks; never a room lock while holding an outbox or index lock. A
  room holder discovering exhaustion marks that room retired and releases it
  before the terminal helper acquires the registry/routing order; no room
  holder waits on the rooms map, so there is no cycle.
- **Room-operation atomicity.** A room operation holds the room lock across
  both the state change and the fan-out enqueues. Per-room outbox arrival
  order therefore equals `entryVersion` order — the property that makes
  supersede-by-key coalescing safe (a pending upsert is only ever replaced
  by a newer one) and keeps snapshot-plus-registration atomic (LLP 0013
  §Room store model). Publisher-side admission (auth, TTL, size, rate)
  stays outside the room lock.
- **Snapshot/delta high water.** Every snapshot carries
  `next_entry_version - 1`, even when it contains no entries. Outbox coalescing
  remains latest-by-key, but drain sorts room/epoch/version before delivery;
  Rust and JS overlays combine the snapshot high-water with at most 1,024
  delete tombstones so delayed upserts cannot resurrect removed state.
- **Definition-generation barrier.** Definition replacement and reset take the
  lifecycle write side; publish/delete/subscribe/unsubscribe take the read side.
  Single-collection registration follows the same rule: adding a new name is
  setup-only, an identical definition is idempotent, and changing an existing
  name retires rooms and queues exactly like whole-manifest replacement. Once a
  replacement returns, no operation admitted against the retired definition
  generation can recreate its rooms or entries.
- **Room lifecycle and epochs.** Rooms are created on demand and pruned when
  they hold no entries and no subscribers, via a retire-and-retry protocol
  (`retired` is set while holding map and room; operations that acquired a
  retired room re-consult the map). Every room incarnation allocates its
  `scopeEpoch` from a store-global monotonic counter, so recreation after
  prune, reset, or definition replacement yields a strictly newer epoch and
  stragglers fail safe to resync instead of stale-comparing across
  incarnations (the finding above).
- **Generation exhaustion.** Client-visible scope, entry, and protected-room
  authority generations stop at `Number.MAX_SAFE_INTEGER`. Scope allocation
  refuses before routing-map insertion. Entry allocation preflights the whole
  operation (including expiry/disconnect/reauthorization batches); exhaustion
  retires the exact room, purges its exact epoch/fence lane, and enqueues only
  an authority-independent `EpochChanged` clearing boundary while the routing
  lock excludes replacement creation. A retired protected control refuses new
  acts and stale permits must revalidate registry state under room creation;
  the control remains until predecessor permits drain. Queue-capacity failure
  collapses through the bounded all-authority poison marker rather than
  preserving stale data.
- **Resync boundaries.** Runtime reset and destructive definition
  replacement retire every room and deliver a `ResyncRequired` boundary to
  each registered subscriber (previously: silent discard) — `Restarted` for
  reset, `EpochChanged` for replacement, the reasons ratified upstream by
  ENG-22478 review fix D. Each outbox's ephemeral lanes are cleared before
  the boundaries are pushed: everything queued in those lanes belongs to
  the retired epoch world, and the boundary is what turns the epoch bump
  into a resubscription instead of silent stale drops. Durable lanes are
  not the ephemeral store's to wipe (ENG-23346): queued
  `live_replace`/`live_delta` payloads answer durable subscriptions that
  survive a definition replacement, so they are preserved. Only the runtime
  reset — which retires the durable world too — clears whole outboxes, and
  `LocalSnapback::reset` follows it with a durable `resync_required` per
  dropped subscription (ENG-23333), keeping the drop signaled.
- **Expiry index.** An ordered `(deadline, RoomId)` set with at most one
  entry per room — a lower bound on the room's earliest expiry, mirrored as
  the room's `indexed_deadline`. A publish touches the index only when it
  improves the bound, so a steady-TTL hot room never touches it after its
  first entry. `cleanup_expired` pops due rooms only, sweeps each under its
  own lock, and re-indexes or prunes — no scan of all rooms. Per-operation
  room sweeps are unchanged, so a snapshot still never contains expired
  entries. **Review fix (MEDIUM 1):** a resync-boundary wipe removes only the
  retired rooms' own index entries (each via its `indexed_deadline` mirror),
  never a wholesale `expiry_index.clear()` — a room created concurrently on an
  async worker after the wipe's `room_ids` snapshot survives the wipe, and a
  wholesale clear would have destroyed its index entry while the mirror still
  claimed it was indexed, detaching it from `cleanup_expired` forever (a room
  leaked per definition hot-reload under live connections). Guarded by
  `l9_wipe_does_not_detach_surviving_rooms_from_the_expiry_index`.
- **Disconnect via a connection→rooms index (ENG-23348).** `disconnect`
  visits only the rooms in a per-connection reverse index (recorded at
  subscribe/publish time, *before* the room mutation becomes visible), never
  a full-store scan — its cost scales with the connection's footprint, not
  the store's. This matters because callers amplify it: the stale-connection
  reaper runs one disconnect per stale id in a single maintenance tick, and
  WS teardown runs it while holding the global write mutex, so at the
  documented limits (4096 rooms × 1024 entries) the old full sweep made one
  network blip stall all durable writes behind thousands of room locks. The
  index provisions an edge before the operation becomes visible so disconnect
  sees in-flight work, reasserts it after success, rolls it back on failure,
  and removes it once the connection no longer owns or subscribes in the room.
  Unsubscribe/delete/expiry/room retirement therefore compact lifetime churn
  instead of making disconnect O(all rooms ever touched) (ENG-24355). Rate
  buckets are keyed connection-first so their removal is one map
  operation instead of an O(all-buckets) retain. Expired entries in rooms
  the connection never touched are `cleanup_expired`'s job via the expiry
  index, no longer a disconnect side effect. Guarded by
  `disconnect_visits_only_the_connections_rooms` and
  `connection_room_index_covers_publish_only_rooms`.
- **Limits (first hard defaults, answering the open question).** Store-level
  capability facts, constructor-overridable: max active rooms 4096, max
  entries per room 1024, max subscribers per room 1024, max aggregate retained
  bytes per room 1 MiB. Retained-byte admission conservatively includes the
  room/scope identity, entry key/owner/value records, owner-connection edges,
  and subscriber identities; `valueBytes` remains the payload-only diagnostic
  and `retainedBytes` exposes the admission quantity. Collection and scope
  fields, identities, custom keys, authorization metadata, and permission
  cardinality also have fixed parser-boundary limits; the HTTP WebSocket
  boundary rejects frames over 64 KiB. Enforced as structured
  `RoomLimitExceeded` or `MetadataTooLarge` rejections counted in diagnostics.
  Never silent eviction of live entries.
- **L6/L7 interaction.** The durable fan-out
  (`notify_live_subscriptions`) runs under the global write mutex on a
  `spawn_blocking` thread (LLP 0032 L7) and enqueues into these outboxes
  from that thread. Every enqueue site pushes the message before waking the
  L8 delivery notifier, and the WS loop registers its waker before its first
  drain, so the lost-wakeup argument no longer relies on the global mutex
  serializing enqueues — it relies on push-before-wake plus
  register-before-first-drain. Durable-before-ephemeral drain order is a
  per-outbox property and is unchanged. **Review fix (LOW 3, coverage):**
  the whole event-driven delivery claim now rests on push-before-wake, so it
  is guarded — `l9_enqueue_is_push_before_wake_no_lost_wakeup` drives 30k
  strict enqueue→wake→drain ping-pongs with no safety-net poll, failing a
  bounded timeout if a wake ever precedes its push. (`DeliveryNotifier` also
  moved to the poison-recovering lock helper for consistency; behavior
  unchanged. `RoomLimitExceeded` stays HTTP 400, consistent with
  `RateLimited`.)
- **Connection liveness (LLP 0032 L2).** The last-seen map moves out of
  `LocalSnapback`'s exclusive state into a shared `ConnectionActivity`
  handle touched by the lock-free ephemeral/drain paths and by the
  write-lane live subscribe/resume; the reaper still runs on the write lane
  because teardown touches durable subscriptions. **Review fix (MEDIUM 2):**
  because the store is off the global mutex, an async-worker
  `EphemeralApi::subscribe` can interleave with a write-lane `disconnect`.
  Both sides are ordered so a *surviving registration implies a surviving
  activity entry*: `disconnect` removes the activity entry **before** it tears
  down registrations/outbox, and the `EphemeralApi` ops touch activity
  **after** the store op succeeds (touch-after-success). The banned state — a
  registered subscriber the reaper can never see, whose room never prunes —
  is thereby unreachable; the only residual (a bare activity entry with no
  registration) is self-healing, reaped by an idempotent disconnect. Guarded
  by `l9_reap_vs_revival_subscribe_leaves_no_unreapable_zombie`.
- **Server surface.** `/ephemeral/*`, `/outbox/*`, the WS socket-text
  operations, WS drains, and the admin ephemeral cleanup reach the store
  directly with no global mutex. Disconnect keeps the write lane (it tears
  down durable subscriptions). Ephemeral operations run inline on async
  workers deliberately: they are pure memory operations outside the L7
  exec-guard's blocking classes (no Hermes, no SQLite), so `spawn_blocking`
  would only add latency.
- **Known bounded races (accepted, same class as the L6 manifest note).**
  A publish that read the collections registry immediately before a
  destructive replacement can validate against the old budgets or create a
  room for a just-removed collection; the room stores no definition (every
  operation re-reads the registry), the window is microseconds, and an
  orphaned room is unreachable for new operations and is pruned once empty.
- **Documented local thresholds (hot-room acceptance).** Under continuous
  hot-room publish load, unrelated-room cleanup and a durable
  enqueue-plus-drain complete in under 250 ms, and ephemeral
  publish/subscribe complete in under 500 ms while a ~900 ms mutation holds
  the global write mutex (debug-build bounds asserted by the `l9_*` tests).

### Backend targets

The first implementation target remains local process memory. It should become
the reference backend and conformance fixture, not special-case application logic.

Redis-compatible and Cloudflare Durable Object backends should be treated as
adapter targets behind the same contract:

- **Local memory:** stores rooms and outboxes in Rust host memory. Restart clears
  entries and forces resubscribe/republish. It is the fastest path for local dev
  and tests.
- **Redis-compatible:** stores TTL entries and room indexes under Snapback-owned
  keys, uses a channel/stream protocol for deltas, and treats lost pub/sub or
  truncated streams as resync boundaries.
- **Cloudflare Durable Object:** routes one room or room group to a Durable
  Object authority, uses alarms or bounded stored lease state for expiry, and
  treats hibernation/migration memory uncertainty as either preserved adapter-local
  lease state or forced resnapshot/republish.
- **Missing adapter:** reports an Online capability gap. It must not silently
  emulate room presence with isolated process maps in a multi-instance target.

Adapters may use different mechanics, but they must expose the same observable
message, version, expiry, and resync behavior.

### Limits and diagnostics

The abstraction should define limits as capability facts, not incidental
constants:

- max active rooms per process/adapter partition;
- max entries per room;
- max value bytes per entry;
- max aggregate retained bytes per room, including room metadata, keys,
  ownership edges, and subscribers;
- max subscribers per room;
- max pending ephemeral keys per connection;
- sustained and burst publish rates per connection and collection;
- cleanup and dispatch cadence;
- target-specific fan-out warnings.

When a limit is hit, the backend may reject the publish, force resync, or report a
capability error. It must not silently evict non-expired live entries while
pretending the stream is current.

Inspection should show the active backend, collection budgets, rooms, entries,
subscriber counts, pending queue sizes, coalesced update counts, resync counts,
rate-limit counts, expired/disconnected removes, payload and retained byte
estimates, and last epoch/resync reason.

### Value validation

Ephemeral values should be validated against the generated collection value
schema before they enter the room. Byte size is necessary but not sufficient.

For v1, validation can reuse the generated manifest format rather than invoking
app JavaScript. The runtime should reject invalid values with a structured
ephemeral diagnostic and leave the current room snapshot unchanged. The client
overlay may still decode bytes leniently for old tests, but generated clients
should publish values through typed helpers.

### Auth and revocation

Publish and subscribe auth remain part of the collection definition. The improved
backend boundary should make auth decisions explicit inputs and avoid storing
implicit durable permission state in the room.

Permission changes from durable writes should eventually trigger one of the LLP
0013 revocation behaviors:

- remove affected entries;
- remove affected subscribers;
- send `ResyncRequired` to affected subscribers;
- report a permission error on the next operation.

This Plan does not choose the full auth dependency tracker. It requires the
backend API to make that integration possible instead of baking in local
permission-prefix assumptions.

## Phases

### Phase 1: Extract the local backend boundary

- Define the Rust backend trait or equivalent internal interface.
- Move collection load, ensure, publish, delete, subscribe, disconnect, cleanup,
  inspect, enqueue, and drain behind it.
- Keep the existing local-memory implementation behavior unchanged.
- Preserve all current tests and the cursor-web acceptance test.

Acceptance:

- no app/server code reaches directly into local room maps;
- existing `local_v0` ephemeral tests pass;
- cursor-web browser acceptance still passes;
- diagnostics still expose the current counter set.

**Landed 2026-07-02 (with Phase 2, as LLP 0032 L9).** `LocalEphemeralBackend`
became an internally synchronized handle whose public API is the boundary
(`crates/snapback/src/ephemeral.rs`); `LocalSnapback` and the server consume it through the
same surface (`EphemeralApi` in `crates/snapback/src/local.rs`). All four acceptance items
verified: no code outside the module touches a room map, the `local_v0`
ephemeral suite and the cursors-web browser acceptance (7/7) pass, and
diagnostics keep every prior counter (plus the new `limit_rejections`).

### Phase 2: Shard or actorize local room authority

- Remove room operations from the shared `LocalSnapback` mutex path where
  practical.
- Introduce per-room or sharded synchronization.
- Add an expiry index instead of scanning every room for cleanup.
- Add hard limits for entries, subscribers, aggregate bytes, and active rooms.

Acceptance:

- snapshot/register atomicity remains covered;
- durable messages still drain before ephemeral latest-state messages;
- hot-room publish tests do not block unrelated room cleanup or durable outbox
  drain beyond a documented local threshold;
- memory-limit tests produce rejection or resync diagnostics, never silent
  eviction.

**Landed 2026-07-02 (LLP 0032 L9).** Sharded per-room locks with a small
routing lock (as-built note under §Room authority); room operations left the
global `LocalSnapback` mutex entirely; the expiry index replaced
scan-all-rooms cleanup; hard limits landed as `RoomLimitExceeded` rejections.
Tests: `l9_snapshot_registration_is_atomic_under_concurrent_publishes`
(atomicity under real thread contention),
`durable_lane_drains_before_ephemeral_lane` (unchanged, still green),
`l9_hot_room_publish_does_not_stall_unrelated_rooms_or_durable_drain` and
`l9_ephemeral_ops_proceed_while_a_busy_mutation_holds_the_write_lane` (the
documented thresholds: <250 ms under hot-room load, <500 ms while a ~900 ms
mutation holds the write lane), `l9_room_limits_reject_never_silently_evict`,
plus `l9_recreated_room_gets_a_fresh_scope_epoch`,
`l9_cleanup_expired_visits_due_rooms_and_prunes_empty_ones`, and
`l9_reset_and_destructive_replace_signal_resync_boundaries` for the
scope-epoch finding's resolution (plus upstream's
`d2_collection_replace_bumps_epoch_and_signals_resync`, which passes
unchanged against the sharded authority).

### Phase 3: Conformance suite

- Create target-neutral tests for the `EphemeralBackend` contract.
- Run the suite against local memory first.
- Include stale update ordering, TTL expiry, disconnect cleanup, queue overflow,
  value validation, auth failures, restart/epoch loss, and ensure/load/reset
  lifecycle.

Acceptance:

- a backend can be added without copying local-only tests;
- each required behavior has one conformance test name;
- capability gaps are explicit test outcomes, not skipped behavior.

### Phase 4: Hosted adapter prototype

- Prototype either Redis-compatible or Cloudflare Durable Object backing, chosen
  by the next deployment milestone.
- Keep the same collection manifest and generated client surface.
- Document target-specific limits and recovery behavior.

Acceptance:

- two clients in the same room converge through the hosted adapter;
- multi-instance room splitting is rejected or correctly routed;
- adapter loss or restart produces resync/republish behavior rather than stale
  presence;
- inspect reports the hosted adapter identity and limits.

## Non-Goals

- Do not make ephemeral state durable, exportable, or offline-retained.
- Do not introduce CRDT/OT semantics for rich text or whiteboard content.
- Do not expose Redis, Durable Object storage, or any adapter-specific primitive
  as the application API.
- Do not support high-frequency competitive games as the default realtime target.
- Do not let server handlers enforce durable invariants from ephemeral reads.

## Risks

- A trait extracted too early could freeze the wrong shape. Mitigation: start with
  the behavior already required by LLP 0013 and the current local tests, then
  expand only when the conformance suite needs it.
- Per-room actors could complicate the simple local server. Mitigation: allow
  sharded locks if they preserve the same external contract.
- Redis and Durable Object adapters may need different recovery mechanics.
  Mitigation: specify observable resync behavior, not identical internal storage.
- Value validation may duplicate schema logic. Mitigation: define a compact
  manifest-level validator for ephemeral values instead of running application
  code inside the room hot path.

## Open Questions

- Should the first backend extraction be a Rust trait, an enum of target
  implementations, or an actor interface? **Answered 2026-07-02 (Phase 1
  as-built):** a single concrete type whose public API is the contract — an
  internally synchronized handle. The trait spelling waits for Phase 3's
  conformance suite, the first second consumer.
- Should local room authority be implemented first with actors or sharded locks?
  **Answered 2026-07-02 (Phase 2 as-built):** sharded per-room locks with a
  small global routing lock; see the as-built note under §Room authority for
  the lock order and atomicity argument.
- Which hosted adapter should be prototyped first: Redis-compatible or Cloudflare
  Durable Object?
- What are the first hard defaults for active rooms, entries per room, room bytes,
  and subscribers per room? **Answered 2026-07-02 (Phase 2 as-built):** 4096
  active rooms, 1024 entries/room, 1024 subscribers/room, 1 MiB aggregate
  retained bytes/room — store-level, constructor-overridable, to be revised
  once the LLP 0035 benchmarks exercise them. The public field retains its
  historical `maxRoomValueBytes` name for compatibility, but admission applies
  it to the full conservative retained footprint.
- Should `dispatchMs` become a real scheduler control in Phase 2, or stay only a
  manifest capability until hosted adapters exist?
- Where should generated value validators live so Rust, JavaScript tests, and
  generated clients agree on the same ephemeral value shape?

## Status

Draft, with Phases 1 and 2 landed 2026-07-02 (executed together as LLP 0032
L9: the boundary extraction and the sharding shipped as one arc because the
internally synchronized handle *is* the boundary). The scope-epoch dead-code
finding is recorded above with its resolution. Phases 3 (conformance suite)
and 4 (hosted adapter prototype) remain open; the first extraction confirmed
the §Design contract operations are the right surface, and deferred only the
trait spelling to Phase 3.
