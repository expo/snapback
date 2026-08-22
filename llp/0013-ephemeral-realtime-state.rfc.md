# LLP 0013: Ephemeral realtime state

**Type:** RFC
**Status:** Accepted
**Systems:** Realtime, Sync, Storage, API, Runtime, Auth, Deployment, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-08-22 (membership-backed room role narrowing: optional artifact-compatible `roleField`/`allowedRoles`, active-vocabulary activation, pinned role predicates, default and explicit `allow.members` role lowering, and downgrade-kick evidence).
**Revised:** 2026-08-21 (client overlays now terminally apply ephemeral `Error`
frames, room handles and React/activity bindings surface the trusted
diagnostic, and the Sessions battery pins one notification plus no reopen).
**Revised:** 2026-08-17 (source-authored membership-backed rooms: `allow.members`, fail-closed v1 refusals, deterministic `permissionBacking` lowering, honest row-existence grant semantics, and the Sessions capability battery). 2026-08-15 (first-delivery latency budget: the local target's already-subscribed accept-to-client-apply path has a 1,000 ms regression ceiling, additive accept/dispatch/flush timestamps, and an observation-honesty rule that excludes synthetic typing-action duration). 2026-08-10 (LLP 0222 boundary amendment: server-owned connected-client witnesses are not author-writable ephemeral collections). 2026-07-23 (LLP 0086 CC-8 row 4: deliberate partyserver posture recorded — parallel, not wrap; hibernation bounds noted). 2026-07-17 (client-visible scope, entry, and room-authority generations are bounded by `Number.MAX_SAFE_INTEGER`; entry exhaustion terminally retires the room and emits only a clearing epoch boundary). 2026-07-16 (ENG-24920 companion amendment); 2026-07-14 (item-6 implementation reconciliation: the local target now installs the accepted dependency-indexed room barriers, generation-checks protected-room sinks, and exposes the capability only under exact auth-invalidation negotiation; custom-key authorization remains refused). 2026-07-13 (authorization-invalidation amendment: LLP 0053 item 6 installs and quiesces dependency-indexed room barriers before an authorization-changing commit, generation-checks every effect sink atomically with its act, then projects level-triggered reauthorization and gives `AuthChanged`/`AuthRevoked` an owner); 2026-07-12 (ENG-24574: request metadata and WebSocket frames are hard-bounded, and the per-room byte budget now accounts conservatively for the complete retained room footprint); 2026-07-12 (ENG-24566/ENG-24570/ENG-24574: snapshots carry an authoritative room high-water mark, clients retain bounded delete tombstones, coalesced deltas drain in version order, lifecycle replacement is generation-linearized, and collection definitions/scopes fail closed before state changes); 2026-07-12 (ENG-24353: authenticated session/user identity is authoritative; conflicting payload claims fail closed, and custom keys are connection-owned until generated key-specific authorization exists; earlier: 2026-07-01 status → Accepted, ratified in the LLP 0032 R1 batch: the shipped ephemeral subsystem implements this design, with hardening gaps tracked as LLP 0032 L1/L4/L9; LLP 0032 R3: §App API boundary re-grounded on the ratified commit-time boundary instead of the superseded whole-handler lock model; 2026-06-29: related LLP index updated for LLP 0026)
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0005, LLP 0006, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0014, LLP 0026, LLP 0037, LLP 0039, LLP 0053, LLP 0056, LLP 0083, LLP 0086

## Summary

Snapback should add a first-class **ephemeral realtime state** subsystem for
small, high-frequency, connection-oriented data such as cursors, selections,
typing indicators, online presence, transient drag state, and live viewport
state.

This subsystem is not a second durable database. The app-facing model should be
typed ephemeral collections: scoped latest-state maps with validation, auth,
TTL/leases, snapshot-plus-delta subscriptions, coalescing, and explicit
backpressure. The local v1 implementation should be process-local memory behind
the existing WebSocket transport. Hosted and multi-process targets may back the
same contract with Redis-compatible infrastructure, Cloudflare Durable Objects,
or another adapter, but application code should not speak Redis, memcached, or a
target-specific protocol directly.

The governing rule: **ephemeral state is not faster durable data; it is lossy,
TTL-bound realtime state with an explicit recovery model.**

## Motivation

LLP 0008 deliberately leaves presence and cursor-style state out of ordinary
table sync by default. That boundary is right. Persisting every cursor movement
or typing indicator through SQLite/Postgres would create write amplification,
single-writer pressure, change-log growth, matcher load, and misleading
offline/resume semantics. It would also make the durable database carry data
whose correct behavior is to disappear.

At the same time, treating this as ad-hoc client-to-client events is too weak for
Snapback. The system still needs generated APIs, validation, authorization,
observability, fan-out control, and agent-checkable behavior. A cursor should not
leak across boards just because the client opened a WebSocket and sent a raw
message. A slow subscriber should not silently corrupt durable mutation state.
And agents need a crisp rule for when to use SQLite/Postgres versus the
ephemeral path.

Valet showed two-client cursor presence working as ordinary rows, but did not
stress many high-frequency clients; the same retrospective found a 50 msg/s
wire limit that silently dropped a 52-write burst and stranded pending mutations
([LLP 0006](./0006-valet-retrospective.research.md),
[LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) §Realtime Delivery).
Snapback should answer the presence carrier directly before agents encode that
load into durable tables by default.

## Vocabulary

Snapback should distinguish three concepts in generated APIs and diagnostics:

- **Durable data:** authoritative application state in SQLite/Postgres, retained
  across restart, export/import, backup, local-first sync, and history where
  applicable.
- **Ephemeral realtime state:** small latest-state values that matter only while
  users or sessions are actively present, may vanish on disconnect or restart,
  and are recovered by republishing or resubscribing.
- **Internal cache:** derived performance data that must be recomputable and is
  not part of the app-facing correctness model.

Agents should choose durable data when the user expects persistence, audit,
offline availability, historical queries, or correctness after restart. They
should choose ephemeral state when disappearance is acceptable and the value's
main job is low-latency awareness for currently connected clients. They should
choose cache only for values that can be regenerated from durable sources.

## Proposal

The app-facing primitive is an **ephemeral collection**. A collection is a typed,
authorized, scoped latest-state map. Conceptually:

```ts
export const presence = defineEphemeral({
  boardCursors: ephemeral.collection({
    scope: { boardId: v.id("boards") },
    routing: ["boardId"],
    key: "connection", // a key mode: "connection" | "session" | "user" | custom
    ttlMs: 5000,
    maxTtlMs: 30000,
    maxValueBytes: 1024,
    publishRate: { sustainedHz: 20, burst: 60 },
    delivery: { mode: "latest", dispatchMs: 33 }, // v1: latest-only
    value: v.object({
      x: v.number(),
      y: v.number(),
      selection: v.optional(v.json()),
    }),
    publish: allow.boardMember("boardId"),
    subscribe: allow.boardMember("boardId"),
  }),
});
```

The concrete syntax belongs to LLP 0004 or a follow-on API spec, but the semantic
shape should be pinned here. The names above are illustrative forward references,
not fixed API: `defineEphemeral`, `ephemeral.collection`, and `v.id` extend the
[LLP 0004](./0004-application-data-api.rfc.md) data-API vocabulary, which is itself
explicitly illustrative until a Spec fixes it; `allow.boardMember` assumes the
permission-rule source syntax that
[LLP 0011](./0011-auth-and-permissions.rfc.md) still lists as an open question; and
`ctx.ephemeral` is defined in *App API boundary* below. What this RFC pins is the
semantic shape, not these spellings:

- a collection name is generated and stable;
- a scope partitions fan-out, routing, auth, and snapshots;
- a normalized collection/scope pair maps to one ephemeral room;
- a key identifies the latest value inside that scope;
- every value has a required TTL or connection lease;
- values are small portable JSON-like documents, not asset bytes or large blobs;
- payload, TTL, publish-rate, and dispatch budgets are declared or defaulted;
- publish and subscribe authorization are explicit;
- subscribers receive the current non-expired snapshot first, then deltas, as one
  "current value plus subscription" seam — the same shape durable subscriptions use
  ([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) §Subscription Contract,
  [LLP 0012](./0012-headless-integration-contract.spec.md) §Runtime State) — so a
  subscriber is never left waiting on the next change to learn the current state;
- reconnect means resubscribe and receive a fresh snapshot, not resume from the
  durable database version cursor.

The underlying implementation can be a KV map plus pub/sub, but KV alone is not
the product contract. TTL, leases, auth, fan-out scope, validation, snapshot
recovery, and backpressure are load-bearing parts of the abstraction.

## Semantics

### Scope and keys

Every collection entry is addressed by:

```text
collection + scope values + key
```

Common key modes should include:

- **connection-owned:** one value per active connection, deleted when the
  connection ends or its lease expires; ideal for cursors and selections.
- **session-owned:** one value per authenticated session; useful for typing
  indicators across a reconnect window. The key is derived from authenticated
  context; any caller-supplied identity is assertion-only and must match.
- **user-owned:** one value per user; useful for coarse online status, but only
  when product privacy rules allow it. With multiple connections per user the entry
  is a shared lease: any of the user's active connections refreshes its TTL, and it
  is removed only when the last one lapses, so two tabs do not flap a user's
  presence on and off.
  As with sessions, the authenticated identity is authoritative and conflicting
  payload fields are rejected.
- **custom key:** allowed when generated validation and auth can prove the
  publisher may write that key. Until that key-specific authorization exists,
  the local baseline treats an arbitrary custom key as connection-owned: only
  the connection that created it may replace or delete it (ENG-24353). One
  connection may own several custom keys in a room; removing one key must keep
  the connection→room ownership edge until its final key is gone, so disconnect
  still reclaims every remaining entry.

Connection-owned should be the default for cursor-like state because it avoids
two tabs overwriting each other and gives the server a simple cleanup rule.

### Routing and rooms

The fan-out routing unit is an **ephemeral room**:

```text
collection + normalized scope values
```

Every publish and subscription for one room must reach the same room authority:
one local process, one Durable Object, one Redis channel group, or another
adapter-owned equivalent. The room authority owns the current snapshot,
subscriber list, expiry queue, and per-entry revision allocation for that room.

The generated manifest should identify a routing key for each collection. The
default should be the full normalized scope; a collection may declare a narrower
`routing` list only when doing so does not merge unrelated authorization domains.
Because a narrowing that collapses two auth domains into one room would leak
presence across them, generated validation must *reject* a `routing` declaration it
cannot prove keeps authorization domains separate, rather than treating safety as a
convention the author is trusted to uphold.
For `boardCursors`, `boardId` is the natural routing key. For a nested scope such
as `{ orgId, docId }`, `docId` may route the room only if document ids are unique
across organizations or the normalized route still includes `orgId`.

Process-local memory is correct only when all connections for a room are sticky
to the same process. A multi-instance target without sticky room routing or a
shared adapter must report an ephemeral capability error.

### TTL and leases

Every entry must have an expiry. A collection may express this as a fixed
`ttlMs`, a connection lease, or both. On each accepted publish, the server stores
the value with a server receive timestamp and an expiry deadline.

The server should emit remove deltas for expiry or disconnect when it can, but
clients must also honor server-provided expiry locally. The wire form should give
the client an expiry deadline and enough receive-time or remaining-TTL metadata to
schedule pruning on a client-local monotonic timer; correct disappearance must not
depend on synchronized wall clocks. Any remove can be lost — expiry, explicit
delete, or disconnect-driven cleanup alike; the recovery rule is that the client
prunes expired entries and a fresh subscription snapshot excludes them. The TTL is
therefore the universal backstop for a lost remove, which is why connection-owned
entries still require an expiry even though disconnect is *supposed* to remove them:
if the disconnect remove is dropped, the entry must still age out on its own rather
than linger as a ghost cursor.

Unbounded ephemeral state is invalid. Missing TTL, large payloads, and
unscoped/global high-cardinality collections should be diagnostics or errors,
depending on deployment mode.

### V1 local budgets

The first local target should ship with explicit draft budgets. These numbers are
not production scale claims; they are the starting contract for implementation,
diagnostics, and benchmark-driven revision:

- default TTL: 5 seconds;
- maximum TTL on the paved path: 30 seconds;
- default maximum value size: 1 KiB serialized;
- local hard value-size cap: 4 KiB serialized;
- sustained publish budget: 20 accepted publishes/second per connection per
  collection;
- burst budget: 60 accepted publishes per connection per collection before
  rate-limit recovery. Exact recovery dynamics (token refill, cool-down) are
  adapter-defined but must be observable through ephemeral errors or connection
  state, never a silent stall;
- coalesced dispatch cadence: roughly 33ms for actively changing rooms, with
  faster flush allowed when cheap;
- diagnostic threshold: 100 active publishers or subscribers in one room.

Targets may raise or lower these through capability reports, but applications
should not rely on larger budgets unless the target declares them. A cursor that
needs more than the value-size budget is probably modeling view state that
belongs in durable data or an asset. The `boardCursors` example above deliberately
mirrors these defaults so the example remains an implementation-sized fixture, not
an aspirational hosted-scale claim.

### First-delivery latency budget

For an already-subscribed two-client room on the local target under the
`normal` network profile, the first accepted update has a **1,000 ms
server-accept-to-client-overlay-apply regression ceiling**. This is a
conservative contributor/CI bound with 1,000 ms of headroom against the
2,000 ms interactive typing ceiling that motivated it, not a hosted-target or
paint-time SLO. Its diagnostic allocations are:

| Segment | Timestamp cuts | Allocation |
| --- | --- | ---: |
| publish accept → server fan-out dispatch | `serverObservedAtMs` on the publish acknowledgement / `Upsert.entry.received_at_ms` → `serverDispatchedAtMs` on the acknowledgement | 100 ms |
| server dispatch → connection flush | `serverDispatchedAtMs` → `serverObservedAtMs` on the WebSocket frame | 500 ms |
| connection flush → client overlay apply | frame `serverObservedAtMs` → the overlay `onChange('applied')` observation on the same local machine | 200 ms |
| scheduler and measurement reserve | unallocated | 200 ms |

The dispatch timestamp is sampled only after the synchronous room mutation,
per-subscriber outbox enqueue, and L8 notifier wake return. The WebSocket
timestamp is sampled when the selected frame is serialized for final handoff.
These cuts therefore distinguish the fan-out mechanism from connection
scheduling and client application without adding latency to the delivery
path. `dispatchMs` remains a capability budget for latest-state coalescing; it
is not a poll timer and does not delay an otherwise empty subscriber outbox.

The named two-client regression takes eight sequential first-update samples,
records every segment, and hard-fails only the 1,000 ms end-to-end ceiling so
millisecond-scale scheduling noise does not create three independent flaky
gates. Its 2026-08-15 clean-machine run measured maxima of 0 ms
accept→dispatch, 1 ms dispatch→flush, 1 ms flush→apply, and 1 ms total. That
evidence rules out a fixed runtime batching interval near two seconds, so no
eager-first scheduling change is warranted: delivery is already eager and
only a newer update waiting in the same bounded outbox may supersede an older
one.

Observation starts before the single state transition whose visibility is
being measured and remains armed while it happens. A browser harness must not
start its clock, await a long `pressSequentially` or animation sequence, and
only then begin checking the observer; that measures the synthetic action plus
delivery and cannot be reported as first-delivery latency.

### Stored entry shape

Each accepted value becomes a room-local entry with at least:

- owner identity: connection, authenticated session, authenticated user, or
  the connection owning a custom-key address;
- validated value;
- server receive time;
- expiry deadline;
- the `scopeEpoch` the entry was written under;
- room-local monotonic `entryVersion` stamped on the affected key;
- serialized byte size for budget accounting.

`scopeEpoch` is a **room-current** counter owned by the room authority; an
entry stamps the epoch value that was current when it was accepted so clients
can detect a stale upsert written before a room-wide resync. The room has one
current `scopeEpoch`; entries carry the epoch they were written under. A room
whose current epoch has advanced past an entry's stamped epoch is signaling
that sequencing continuity was lost and clients must resubscribe rather than
trust per-entry version comparisons.

`entryVersion` is allocated by the room authority and is not the durable database
commit version. The room should allocate it from a room-local counter even though
clients use it only to order messages for one collection/scope/key. Different
keys in the same room are latest-state values, not a causally ordered log.
Clients compare `(scopeEpoch, entryVersion)` only within one room, one key, and
one epoch. If the authority restarts, loses sequencing continuity, or changes
epoch, clients must resubscribe instead of comparing versions across epochs.

The shipped plain-JSON profile bounds `scopeEpoch`, `entryVersion`, and
`roomAuthorityGeneration` to `0..=9_007_199_254_740_991`
(`Number.MAX_SAFE_INTEGER`). The final value is usable exactly once; no counter
may cross the boundary or wrap. Scope exhaustion refuses room creation before
insertion. Entry exhaustion is a terminal loss of sequencing continuity for
the whole incarnation: mark the exact room and protected authority control
retired, purge queued data for that room epoch and producer fence, then enqueue
only an authority-independent `EpochChanged` clearing boundary. No partial
delete, expiry, disconnect, or reauthorization result and no replacement
snapshot may escape. The protected control remains a tombstone while any
predecessor permit is alive, and a stale permit must revalidate under the
registry→routing-map cut before it can create a room. Once those permits drain,
a later subscribe may create a fresh checked scope epoch. If the bounded outbox
cannot retain the clearing boundary, its existing all-authority poison marker
is the fail-closed substitute, never silent stale data.

### Room store model

The authoritative ephemeral store is a room-partitioned latest-state store. It
is not a SQLite table, not a Postgres table, and not the retained client offline
store. The v1 local implementation should be ordinary Rust host memory owned by
the Snapback server process, with an adapter boundary that lets hosted targets
replace the mechanics without changing application code.

The local store can be modeled as:

```text
EphemeralStore
  rooms: Map<RoomId, RoomState>

RoomState
  collectionId
  normalizedScope
  routingKey
  scopeEpoch
  nextEntryVersion
  entries: Map<EntryKey, EntryRecord>
  expiryIndex
  subscribers: Map<ConnectionId, SubscriberState>
  pendingDispatch
  metricsAndLimits

EntryRecord
  key
  owner
  validatedValue
  receivedAt
  expiresAt
  scopeEpoch
  entryVersion
  serializedBytes

SubscriberState
  connectionId
  authContext
  visibleKeys or equivalent membership cache
  lastSnapshotEpoch
  boundedOutboundQueue
  backpressureState
```

These names are illustrative; the required shape is the ownership boundary. A
room authority owns the room map, entry records, expiry index, subscriber list,
coalescing buffers, and version counters. No JavaScript invocation owns this
state, and no publish should run under the durable SQLite/Postgres write lock.
A local implementation may use a per-room actor or a per-room mutex, but it
should avoid a global store lock that lets one hot cursor room delay unrelated
rooms or durable mutation acknowledgements.

Room operations should follow this contract:

- `publish` normalizes the scope and key, checks publish auth, validates the
  value, checks value size, TTL, room limits, and rate limits, then allocates a
  new `entryVersion`, replaces the entry, updates the expiry index, and enqueues
  coalesced upserts for subscribers that are currently authorized to see the
  value.
- `delete`, disconnect cleanup, and expiry remove the entry and enqueue remove
  deltas when the key existed. An explicit delete of a missing key is
  idempotent; it may acknowledge the request but must not create durable
  history or a tombstone that survives a fresh snapshot.
- `snapshot` sweeps expired entries first, evaluates subscribe authorization
  against the caller's current auth context, and returns only visible,
  non-expired entries plus the current `scopeEpoch` and the room's authoritative
  high-water `entryVersion` (`nextEntryVersion - 1`, including an empty room).
- `subscribe` must not have a snapshot/register race. The room authority should
  either take one room transaction that sweeps, authorizes, snapshots, and
  registers the subscriber, or use an equivalent actor message that guarantees a
  publish cannot be missed between snapshot creation and subscriber
  registration.
- `cleanupExpired` is a correctness path, not just maintenance. The server
  should maintain an expiry index, such as a min-heap, timing wheel, or adapter
  equivalent, so expired entries are pruned without scanning all rooms on every
  tick. Remove deltas are best effort because clients also prune by expiry.
- `resync_required` is sent when the room cannot preserve the local illusion of
  a current stream: queue overflow, lost adapter events, process restart,
  hibernation recovery with uncertain memory, epoch change, or auth dependency
  changes that cannot be represented as precise removes.

Memory pressure is explicit. The store rejects operations rather than silently
evicting non-expired live entries while pretending subscribers still have a
current stream. The v1 local defaults cap active rooms at 4096, entries and
subscribers at 1024 per room, and the complete conservatively estimated retained
room footprint at 1 MiB. That footprint includes room/scope identity, entry
keys, owners, values, owner-to-connection edges, and subscriber identities;
payload-only `valueBytes` remains available beside `retainedBytes` for
diagnostics. Collection/scope/identity/custom-key/auth metadata has independent
byte and cardinality bounds, and WebSocket frames are capped at 64 KiB before
JSON parsing. These admission limits make the dominant retained state bounded
by the active-room and per-room budgets rather than by attacker-selected string
sizes.

### Client overlay store

Generated clients should keep ephemeral data in an in-memory overlay store keyed
by collection, normalized scope, and key. This overlay is the state a React hook
or other client binding reads when rendering cursors, selections, typing
indicators, and online participants.

The overlay stores the latest visible value, expiry metadata, `scopeEpoch`,
`entryVersion`, the snapshot high-water, a bounded set of delete tombstones,
and subscription state. It rejects any delayed upsert at or below the room or
key high-water so a coalesced delete cannot be followed by stale resurrection.
It is cleared on user/session switch,
page reload, explicit unsubscribe, reconnect that cannot prove continuity, and
any `ephemeral_resync_required` that asks for a fresh snapshot. It may schedule
client-local expiry pruning from server-provided TTL metadata, but it must not
write these entries into IndexedDB, SQLite, export bundles, or any retained
offline replica.

Durable data and ephemeral overlays may be rendered together, but they remain
separate inputs. A component can draw a durable board object and an ephemeral
cursor on the same canvas; a mutation that changes durable board state must not
derive correctness from the overlay unless it revalidates against durable state.

### Conflict behavior

For v1, the conflict rule is **last accepted publish wins per entry**. This is a
different contract from durable mutation replay:

- intermediate states may be coalesced;
- clients should not expect every cursor coordinate to arrive;
- there is no history, undo, audit trail, or durable version cursor;
- same-entry concurrent writes should be treated as a modeling smell unless the
  collection intentionally uses a user-owned or custom key.

CRDTs, OT, and semantic merge are not part of the generic ephemeral subsystem.
They may be needed later for rich-text or whiteboard content, but cursor and
presence state should not force Snapback's ordinary realtime layer into a CRDT
database.

### Subscription contract

An ephemeral subscription is identified by:

- generated collection reference;
- validated scope args;
- authenticated session or impersonated test context;
- target capabilities;
- optional client id / connection id.

As built (ENG-23442), the connection id is no longer a bare caller-chosen
string: it is a granted capability from `POST /connection/open`, and every
ephemeral publish/subscribe/delete, outbox drain, and live-stream upgrade must
present the grant's per-connection token
([LLP 0031](./0031-server-route-taxonomy.spec.md) §Connection capability
grants). The kit handles the handshake transparently; app code still passes
readable connection-id labels.

The server returns:

- a snapshot of current non-expired entries visible to the subscriber,
  **recomputed against the subscriber's current authorization** at snapshot
  time (a subscriber never receives entries for a scope or key it could not
  read under the collection's subscribe rule);
- per-entry server receive time and expiry;
- per-entry `entryVersion` and room `scopeEpoch` for stale detection;
- capability flags and rate-limit/backpressure metadata.

After the snapshot, the server sends:

- `ephemeral_upsert` for latest accepted values;
- `ephemeral_remove` for explicit delete, disconnect, expiry, or auth loss;
- `ephemeral_resync_required` when the server cannot cheaply preserve local
  subscription state;
- `ephemeral_error` for validation, auth, rate-limit, or capability failures.

Messages are idempotent at the latest-state level. Applying the same upsert
twice should produce the same local value. Applying a stale upsert after a newer
one should be rejected by `(scopeEpoch, entryVersion)`. A message from an unknown
or changed `scopeEpoch` requires a fresh snapshot.

Collection installation validates the entire definition set before mutation:
portable unique names and scope/routing fields, exact scope keys, TTL/value/rate/
dispatch/outbox budgets, key mode, and authorization prefixes. The local paved
path rejects TTL maxima above 30 seconds. Replacement/reset is a lifecycle
barrier: no publish, delete, subscribe, or unsubscribe admitted under an old
definition may mutate the new generation after the barrier returns.

### Backpressure and coalescing

Ephemeral state is allowed to be lossy, but it must converge. The server may
drop intermediate updates under pressure, but it must not let a subscriber
believe it has a reliable, current stream after the server has discarded the
state needed to maintain that illusion.

v1 supports only the `latest` delivery mode (supersede-by-key): the room keeps
one value per key and coalesces pending updates by collection/scope/key before
enqueueing. Other modes (ordered-per-key, best-effort datagram, fan-out-per-key)
are deferred and would require their own reliability class and manifest entry.

The v1 dispatcher should:

- keep per-client bounded queues, not one broadcast channel shared by all
  clients;
- coalesce pending updates by collection/scope/key before enqueueing;
- prefer replacing an older pending value with a newer value for the same entry;
- separate ephemeral backpressure from durable mutation acceptance;
- send `ephemeral_resync_required` or force a fresh snapshot when a client falls
  too far behind;
- expose diagnostics for publish rate, dropped intermediate updates, queue
  pressure, and resnapshot count.

This differs from durable mutation delivery. A durable mutation cannot be
silently dropped because it represents committed application state. An ephemeral
cursor update can be superseded, but the subscriber must either converge to the
latest value or be told to resync.

Publisher admission control is separate from subscriber backpressure. A publish
is accepted only after validation, authorization, payload-size checks, TTL checks,
and rate-limit checks. A rejected publish does not change the room snapshot and
does not affect durable mutation state. Clients that publish without awaiting an
ack still need observable ephemeral errors or connection state showing that the
server is rate-limiting or rejecting the stream.

### Delivery lanes

Durable realtime and ephemeral realtime may share one authenticated WebSocket,
but they must not share one failure mode. The wire protocol should have at least
two logical lanes:

- **durable lane:** reliable, ordered by durable commit version, used for
  mutation acks, query-result sync, removes, and resync-required messages from
  LLP 0008;
- **ephemeral latest-state lane:** bounded and coalesced by collection/scope/key,
  allowed to supersede intermediate values, and recovered by room resnapshot.

Durable messages have scheduling priority over ephemeral floods. If a cursor
stream is hot enough to fill its lane, the server should coalesce or resnapshot
that room rather than delaying durable mutation acknowledgements or committed
changesets.

### Authorization and privacy

Ephemeral state still passes through Snapback auth. A collection has separate
publish and subscribe rules. The rules may depend on durable data such as board
membership, channel membership, or document visibility, but ephemeral state must
not grant durable permissions or become the source of truth for auth.

Permission changes should reuse the direction from LLP 0008 and LLP 0011:
server-directed resubscribe or removal is the v1 answer. If a user loses access
to a board, their cursor entries in that scope should be removed and their
subscriptions should receive removal, `ephemeral_resync_required`, or a
permission error depending on the safest target behavior. This revocation is **per
subscriber** and is deliberately distinct from a room-wide `scopeEpoch` bump:
losing one user's access must remove that user from the room and re-authorize the
subscribers who could see them, not force every subscriber in the room to
resnapshot. A `scopeEpoch` change signals lost sequencing continuity for the whole
room; an authorization change signals that one subscriber's visible set shrank.
Unauthorized presence must not be visible merely because it is "temporary."

Entry ownership is a **mutation-authority** boundary, not an implicit
per-entry confidentiality filter. An authenticated subscriber authorized for
the room receives that room's presence snapshot (including other users), which
is the collaborative-presence purpose of the subsystem; a caller without the
room's subscribe permission receives none of it. Within an authorized room, a
connection still cannot address, replace, or delete another authenticated
session/user's key (ENG-24353).

Online status is privacy-sensitive. Snapback should not expose global user
presence by default. Presence should normally be scoped to the object where the
user is actively collaborating: board, document, channel, game, or room.

**Authorization-invalidation amendment (2026-07-13).** LLP 0053 item 6 owns
the producer/ordering contract that this section previously left aspirational.
A protected room collection declares the durable `permissionBacking`
tables/fields used to derive its room permission. Unknown
fields/dependencies/subjects target coarsely; no declaration may suppress the
event in v1. Before an affected backing-table change or another enumerated
authorization event may commit, the writer installs a unique dependency-indexed
registry ticket, interlocks protected-room registration and initial snapshot
publication with that ticket, installs the matching room-authority barriers, and
waits for every already-admitted sink permit to quiesce. Failure to target,
install, or quiesce aborts the write. No registry or room lock is held across the
durable commit.

Rollback compare-removes only its exact ticket; ambiguous commit leaves the
barriers pending until durable reconciliation. Commit finalizes the exact ticket
to a level-triggered
`RoomAuthorityResync { authorization, minCommitVersion,
roomAuthorityGeneration }`, suspends affected subscribers and racing
registrations, and strands or purges old-generation frames. Room mutation,
publish/fanout enqueue, destructive drain, and final HTTP/WebSocket send each
compare the captured non-pending generation **atomically with that sink's act**;
a check released before the act is non-conforming. The room then takes a fresh
durable permission snapshot at or after the cause, re-resolves the
connection-bound authority from LLP 0039, and atomically either:

Room-authority generation itself uses the portable counter domain above. A
transition that would require a successor after the maximum is refused while
the dependency is still precommit; it may not durably change authorization and
then discover that the in-memory sink cannot name its successor.

- rebuilds `authContext`/`visibleKeys`, installs a fresh room snapshot, and
  resumes; or
- unregisters the denied subscriber, deletes its connection-owned entries, and
  emits trusted `SNAPBACK_AUTH_PERMISSION_DENIED`/`AuthRevoked` semantics.

The room obligation acknowledges only after that boundary commits and re-fires
on the room heartbeat until then. Process death destroys local rooms and forces
fresh snapshot/register authorization; a hosted adapter that preserves rooms
must preserve the obligation or fail the capability. `AuthChanged` and
`AuthRevoked` are therefore no longer ownerless vocabulary. This amendment does
not authorize `KeyMode::Custom`; LLP 0039 keeps it refused until key-level
authorization exists.

## Relationship to durable sync

Ephemeral subscriptions are adjacent to, but not part of, the durable
query-result sync contract in LLP 0008.

Ephemeral state:

- is not written to `_snapback_changes`;
- does not advance the global durable commit version;
- is not retained for offline use;
- is kept in a client in-memory overlay, not the retained offline local store;
- is not exported in the logical SQLite-to-Postgres bundle. It is in-memory and
  never durable, so it falls outside that bundle by construction. LLP 0007 already
  excludes ephemeral auth sessions, verification codes, webhook-dedupe state, and
  secrets; ephemeral realtime rooms are the same class of non-durable runtime state
  and should be enumerated there when that portability spec is next revised;
- is not restored from backup;
- is not available for durable query pagination or history;
- is not a valid input to invariant-preserving durable mutations unless the
  application treats it as advisory and revalidates against durable state.

Generated clients and React bindings ([LLP 0005](./0005-contract-exact-react-integration.explainer.md))
may present durable query results and ephemeral overlays together. For example, a
whiteboard screen may render board objects from durable sync and cursors from
`boardCursors`. That composition belongs at the client adapter or generated API
layer; it should not make durable query results depend on transient in-memory
state.

## App API boundary

The first app-facing surface should support:

- generated client publish/delete helpers for ephemeral collections;
- generated client subscribe helpers returning snapshot, live entries,
  connection state, and stale/resync state;
- optional server-side `ctx.ephemeral` helpers for trusted server-origin
  transient state;
- test helpers for impersonated publish/subscribe and expiry control.

Server-side helpers must be carefully scoped. Writes to `ctx.ephemeral` should
not participate in the same atomic transaction as `ctx.db` writes, should not be
reported as durable mutation changesets, and should not be required for durable
correctness. If a mutation needs a durable side effect, it belongs in `ctx.db`.
If it needs a best-effort live annotation, it can publish ephemeral state after
commit. "After commit" is load-bearing: the ratified write path drives the
handler to completion and applies its buffered writes in one brief commit-time
transaction ([LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md)
§Execution and Write Semantics,
[LLP 0009](./0009-code-execution-security.rfc.md) §Runtime Boundary — an
earlier draft of this section cited the superseded whole-handler lock model),
so ephemeral publishes must not join that transaction, and high-frequency
ephemeral fan-out must stay off the durable write path or it would
reintroduce the very write-path pressure this subsystem exists to avoid. Room maps
and subscriber lists are Rust host state, not state inside any JavaScript isolate;
`ctx.ephemeral` is a host call out of the sandbox like `ctx.db`, so it is orthogonal
to the per-invocation handler isolation in
[LLP 0009](./0009-code-execution-security.rfc.md).

Reading ephemeral state from server handlers is more dangerous. For v1, reads are
unsupported on the paved path. A future advisory read API may be added only if
generated types make it impossible to confuse with durable state. A handler that
enforces inventory, payment, authorization, ordering, or ownership from ephemeral
state is outside the paved path.

## Backend adapters

The implementation should hide storage mechanics behind an `EphemeralBackend`
contract, separate from the durable SQLite/Postgres store:

- `route(collection, scope) -> room`
- `publish(room, key, value, lease, authContext) -> accepted entryVersion or
  structured rejection`
- `delete(room, key, authContext) -> remove entryVersion or idempotent no-op`
- `snapshot(room, authContext) -> scopeEpoch + visible entries`
- `subscribe(room, authContext, sink) -> snapshot + registered subscriber`
- `cleanupExpired(room or target)`
- `onDisconnect(connectionId)`
- `inspect(room or target) -> diagnostics`
- diagnostics for queue pressure, expiry, fan-out, rate limits, and adapter
  capability

Target adapters:

- **Local process memory:** the v1 canonical local target. One Rust process holds
  the `EphemeralStore`, room maps, expiry indexes, subscriber lists, coalescing
  buffers, and counters in memory. Restart clears all entries and changes room
  epochs. This target is the first dev/test target and should be the reference
  implementation for snapshot/register atomicity, TTL pruning, local diagnostics,
  and lane separation from durable sync.
- **Redis-compatible adapter:** a plausible hosted/multi-process adapter using
  key TTLs plus a Snapback-owned channel protocol over pub/sub or streams. A
  typical mapping would store room metadata and counters under room keys, entry
  values under per-room/per-entry keys with `PX`/`EX` TTL, a room entry index for
  snapshots, and a channel or stream for deltas. Redis keyspace notifications may
  help with expiry, but must not be the only correctness mechanism; a lost
  notification is recovered by client TTL pruning and fresh snapshots. If pub/sub
  delivery is lost or a stream is truncated past a subscriber's position, the
  adapter sends `ephemeral_resync_required`.
- **Cloudflare Durable Object adapter:** likely scope-routed, connection-driven
  room authority with alarms for expiry and WebSocket hibernation-aware
  subscription handling. LLP 0014 owns the broader Cloudflare strategy. This
  adapter must choose one of two honest behaviors: keep bounded TTL entries and
  epoch metadata in Durable Object storage as adapter-local lease state, still
  excluded from Snapback durable data/export/backup claims, or treat hibernation
  wakeup, migration, or memory loss as sequencing loss and force room
  resnapshot/republish. It must not claim durable/offline presence merely
  because the platform primitive is named "Durable Object."
- **No adapter / degraded mode:** targets may report ephemeral capability gaps
  explicitly, as an instance of the LLP 0012 capability manifest and its "surface,
  don't silently fall back" rule
  ([LLP 0012](./0012-headless-integration-contract.spec.md) §Capability Manifest).
  An ephemeral collection has no local-first parity — there is no retained offline
  replica of presence — so it belongs in the **Online** capability class, never
  reported as local-first. Generated clients must not pretend presence works when
  the target cannot route it correctly.

Process-local memory is only correct for a single-process or sticky-scope target.
In a multi-instance deployment without sticky routing or a shared adapter,
Snapback must report a capability error rather than split one room's presence
across isolated processes.

The adapter owns `scopeEpoch` and `entryVersion` allocation. The local adapter can
use in-process counters. A hosted adapter may use a room-local counter, Redis
`INCR`, Durable Object state, or another equivalent, but it must expose the same
observable stale-update and resnapshot behavior.

## Alternatives considered

### Ordinary durable tables

Durable tables are attractive because Snapback already has sync, auth, queries,
and local retention there. They are wrong for high-frequency cursor state by
default. They create writes for data that should disappear, stress the
SQLite/Postgres write path, pollute the change log, imply offline retention, and
make restart semantics misleading.

Single-row presence in durable tables may still be acceptable for low-frequency,
auditable state such as "last seen at" or "currently assigned reviewer." It is
not the default for cursor coordinates or typing indicators.

### Generic KV store

KV is the right internal primitive, but the user-facing abstraction cannot stop
there. Applications need scoped auth, TTL, subscriptions, snapshots, coalescing,
and diagnostics. A raw KV API would make every app reinvent the same presence
protocol and would give agents too little information to make safe choices.

### Redis as the product API

Redis is a strong backend candidate for hosted deployments. Exposing Redis
commands directly would leak operational choices into Snapback app code, break
Cloudflare/local portability, and make agent validation reason about Redis
semantics instead of Snapback semantics. Keep Redis behind an adapter.

### Memcached-like API

Memcached is cache-shaped: get/set with eviction. It does not provide the
presence-specific contract Snapback needs: subscriptions, auth-aware fan-out,
connection leases, snapshot recovery, or structured backpressure. It may inspire
the simplicity of the storage primitive, but not the product shape.

### SpacetimeDB-style state database

SpacetimeDB and similar systems offer a richer realtime database model. That is
too much of a second programming model for Snapback's v1 direction. Snapback
already has a durable data model, local-first sync, runtime semantics, and a
SQLite-to-Postgres portability contract. The ephemeral subsystem should fill the
presence/high-frequency gap without replacing the durable model.

### UDP or datagram-first transport

Cursor state is a conceptual fit for unreliable latest-state delivery, but a
UDP-first product surface is the wrong v1 default. Browser and mobile clients,
NAT traversal, auth, ordering, congestion/backpressure, observability, and
deployment target support all get harder.

Use the existing WebSocket transport first. Design message semantics so a future
WebTransport, QUIC datagram, or WebRTC data-channel path can carry
best-effort/latest-state updates later, but keep the generated API
transport-neutral. Raw UDP should not be an app-facing Snapback connection mode.

## Transport contract

The v1 transport should be WebSocket over the same authenticated connection
family as durable realtime. The wire protocol should distinguish durable
changeset messages from ephemeral messages so that backpressure, resync, and
failure handling can differ.

The protocol should include enough metadata to support future unreliable
transports:

- lane: durable or ephemeral latest-state;
- collection/scope/key identity;
- room `scopeEpoch` and per-entry `entryVersion`;
- expiry deadline;
- snapshot/resync boundaries;
- a reliability class such as `latest` rather than `durable`.

That metadata lets a future datagram transport drop superseded cursor positions
without changing application semantics.

## Agent and developer diagnostics

The generated manifest and inspection endpoints should make ephemeral behavior
visible:

- collection definitions, scopes, key mode, TTL, payload limit, and auth rules;
- routing key and room identity for active subscriptions;
- target capability: local memory, Redis-compatible, Durable Object, or missing;
- fan-out scope cardinality and subscription count;
- publish rate per connection and per scope;
- coalesced update counts and forced resnapshot counts;
- active room entries, payload value bytes, conservative retained bytes,
  expiry-index depth, subscriber count, pending queue depth, and last
  epoch-change reason;
- durable-lane delay caused by ephemeral pressure, which should be zero under the
  intended scheduler;
- entries nearing payload/TTL/rate limits;
- warnings when an app models high-frequency cursor/presence-like data as
  durable table writes;
- errors when an ephemeral collection lacks TTL, auth, bounded scope, or a
  target implementation.

This is especially important for agent authorship. A human might find two stores
conceptually confusing; an agent can choose correctly if the semantics and
diagnostics are explicit.

## Validation requirements

The accepted implementation must keep the following acceptance proofs green:

- a two-client cursor fixture where subscriber B receives subscriber A's
  connection-owned cursor snapshot and live updates;
- disconnect or TTL expiry removes the cursor without any durable database
  writes;
- reconnect resubscribes and receives a fresh snapshot rather than attempting
  durable-version resume;
- a high-frequency cursor stream is coalesced by key and does not grow
  `_snapback_changes`;
- high-frequency ephemeral publishing does not delay durable mutation acks or
  committed query-result deltas on the same WebSocket;
- over-rate or over-size publishes are rejected with observable ephemeral errors
  and do not modify the room snapshot;
- stale upserts are ignored using `(scopeEpoch, entryVersion)`;
- snapshot and subscriber registration are atomic, so a publish cannot be missed
  between the initial snapshot and live deltas;
- a slow subscriber receives `ephemeral_resync_required` or a fresh snapshot,
  not an unreported stale stream;
- ephemeral snapshots are not retained in the client's offline local store;
- the client overlay prunes an entry after TTL even if an expiry/remove delta is
  lost;
- auth prevents a user outside a board/channel/document from seeing or
  publishing that scope's presence;
- a card-game kick through `gameMembers: permissionBacking` creates the room
  authority obligation before later fanout, rejects the kicked player's queued
  old-generation frames, fresh-snapshots durable membership, unregisters the
  player/removes its entries on denial, and prevents further opponent-state
  delivery even when the first resync/ACK is dropped;
- unknown permission fields/dependencies reauthorize conservatively; a server
  crash clears the room and forces fresh subscribe authorization, while a
  preserving hosted adapter proves obligation persistence or reports a
  capability error;
- server restart clears local-process ephemeral state and clients recover by
  republishing/subscribing;
- a multi-instance deployment without sticky routing or a shared backend reports
  a capability error;
- local memory limits reject or resync explicitly rather than silently evicting
  non-expired live entries;
- diagnostics distinguish durable sync lag from ephemeral fan-out pressure.

## Open questions

- Which document owns the concrete generated API syntax for defining ephemeral
  collections: LLP 0004 directly, or a follow-on API spec?
- Which document owns the permission-rule spellings used illustratively here,
  such as `allow.boardMember`: LLP 0011 directly, or a follow-on auth/API spec?
- Are the draft v1 local budgets above the right defaults, or should some become
  target capabilities only?
- Should the generated API require an explicit `routing` declaration, or infer it
  from the full normalized scope unless an adapter asks for more?
- What is the concrete adapter representation of `scopeEpoch` and `entryVersion`
  on Redis-compatible and Cloudflare targets?
- What hard local defaults should v1 set for maximum entries per room, bytes per
  room, subscribers per room, and active rooms per process?
- When, if ever, should server handlers get an advisory read API for ephemeral
  state?
- How should room routing map onto Cloudflare Durable Object ids, Redis channel
  names, and other hosted target handles?
- Should the Cloudflare Durable Object adapter preserve bounded TTL entries
  through WebSocket hibernation in Durable Object storage, or force
  resnapshot/republish whenever in-memory room state is uncertain?
- Should the Redis-compatible adapter use pub/sub, streams, keyspace
  notifications, or a Snapback-owned channel protocol?
- Which future transport, if any, should graduate from "possible later" to an
  explicit WebTransport/WebRTC milestone?
- Does collaborative rich text need a separate CRDT/operation-presence bridge, or
  can it use ordinary durable editor state plus ephemeral cursor/selection
  collections?
- Should LLP 0007 explicitly list ephemeral realtime rooms among the values
  excluded from the logical portable bundle?
- What is the precise lease model for user-owned presence under multiple
  connections — last-connection-out TTL refresh, or an explicit per-connection
  reference count?

## Dated note: declaration-bound room authority (2026-07-16)

Room membership predicates bind to a membership declaration by stable id, not
table spelling or an ambient role string. Removal is a kick for room
authority: the existing item-6 barrier reauthorizes or unregisters the
affected connection before later effects can escape. A role DOWNGRADE fires
the same barrier; when the room narrows `allowedRoles`, a transition from an
allowed role to a disallowed active role denies the pinned re-read and is a
kick with the same old-generation quiescence and survivor cleanup as removal.

## Dated amendment: source-authored membership-backed rooms (2026-08-17)

This amendment lands the declaration-bound authoring half of the 2026-07-16
note and narrows its role sentence to the still-open completion described
below.

### Authoring surface and v1 refusals

`allow.members(declarationId, opts?)` is the closed membership-backed
ephemeral policy. `declarationId` resolves by stable effective id to one
installed LLP 0056 `membership()` declaration; arbitrary tables, legacy raw
`permissionBacking()` tables, and unknown declarations are not admitted.
`opts` is closed to `scopeField` and `roles`. Omitting `roles` means the
declaration's complete non-pending `roles`; supplying it chooses a non-empty,
unique subset of that active vocabulary. `pendingRoles` are never room grants.

V1 fails closed unless all of these are true:

- publish and subscribe both use `allow.members` with the same declaration;
  neither direction may mix it with `allow.all()` or
  `allow.roomPermission()`. The runtime derives room authority from the
  subscribe policy and then uses it for every operation; per-operation
  membership authority is a future runtime capability, not an authoring-only
  choice;
- the declaration is resource-scoped, the collection has exactly one scope
  field, and any explicit `scopeField` names that field. App-scoped and
  multi-field collections are refused because the current runtime projection
  must back every room-scope field;
- the room scope validator is exactly
  `v.id(<the declaration resource table>)`. A non-id validator, optional id,
  or `v.id()` naming another table is refused: matching field spelling does
  not establish the same nominal resource domain;
- publish and subscribe have the same effective allowed-role set. V1 installs
  one collection-level runtime projection, so per-operation role subsets are
  refused rather than silently widened or intersected.

Generated membership prefixes occupy the `m_<declarationId>` namespace.
Author-supplied `allow.roomPermission()` prefixes may not collide with that
namespace or the platform-reserved `_snapback_stream_server` prefix.

### Lowering and one-validator convergence

For both operations, codegen lowers `allow.members(id)` to the existing
`RequireRoomPermission` policy with prefix `m_<id>`. The collection also emits:

```text
permissionBacking: {
  table: <canonical declaration table>,
  subjectField: <declaration principal field>,
  scopeFields: { <room scope field>: <declaration resource field> },
  roleField: <declaration role field>,
  allowedRoles: <explicit roles or declaration non-pending roles>
}
```

The stable id is therefore the authoring binding; the generated runtime
projection names the resolved canonical table and fields. The emitted artifact
uses the existing Rust-owned manifest shape and passes the same activation
validator as a hand-built manifest. Codegen does not create a parallel
validator or wire concept: this is the one-validator convergence required by
LLP 0037. `roleField` and `allowedRoles` are serde-defaulted optional additions,
so pre-role artifacts remain valid and preserve their role-blind meaning. When
either is present, activation requires the pair, the declaration's actual role
axis, an authorization-affecting field, and a non-empty unique subset of the
declaration's active (not pending) vocabulary.

### V1 grant and invalidation semantics

In Sessions mode the authenticated principal is matched against the emitted
projection with a pinned-snapshot `EXISTS` query over subject, resource, and
`role IN allowedRoles`.
Because only a canonical LLP 0056 declaration may back the policy, row
existence is equivalent to **current membership** rather than a historical
incarnation. An allowed active role can subscribe and publish. Removing the row
or changing its role out of the allowed subset
installs the existing authorization barrier, re-resolves at or after the
membership commit, unregisters the denied subscriber, removes that
connection's entries for survivors, and denies later publication.

Direct/dev mode remains intentionally different: room admission rests solely on
the asserted `roomPermission('m_<id>', scope)` token (the runtime's
RequireRoomPermission checks only `auth.permissions`); the asserted identity
feeds handler semantics, not admission. It exercises room behavior but does not
prove the Sessions projection. Production privacy claims bind to Sessions evidence.

### Capability fixture obligations

Membership-backed ephemeral rooms are a capability claim only while the
messaging demo's Sessions acceptance battery preserves all five scenarios:

1. anonymous subscribe and publish are denied;
2. authenticated non-member and pending-role subscribe and publish are denied;
3. member A observes member B's typing entry;
4. downgrading B from an allowed role to a disallowed active role gives B one
   terminal denial followed by wire silence, removes B's entry from A with
   `AuthRevoked`, and denies B's later publish; and
5. upgrading B back into the allowed subset admits a fresh subscription and
   publication.

These are first-class fixtures, not prose examples. Scenario 4 also pins the
base client projection: the denied overlay applies the terminal `Error` once,
never reopens, and its room handle exposes empty `status: error` with the
trusted `SNAPBACK_AUTH_PERMISSION_DENIED` diagnostic. LLP 0257's
[`activity-presence` unit test](../packages/snapback-react/activity-presence.test.mjs)
separately pins React/activity consumers passing that base status and
diagnostic through.

## Dated note: partyserver posture (2026-07-23)

Recorded as a deliberate decision per
[LLP 0086](./0086-prior-art-course-corrections.plan.md) §CC-8 (row 4),
following this Accepted document's dated-amendment convention. Cloudflare's
**partyserver** (the PartyKit successor) is the closest platform-native
implementation of this RFC's rooms contract
([LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md) §The realtime
layer Cloudflare ships). The recorded posture for hosted ephemeral rooms is
**parallel it**: Snapback keeps its own ratified ephemeral lane and does not
wrap partyserver. Rationale: this RFC's lane is Accepted and implemented on
the local target with its own room-authority, epoch/generation, budget, and
authorization-invalidation semantics, and partyserver's hibernation bounds
— a 16 KB serialized attachment per connection and in-memory state reset on
wake (LLP 0083) — would constrain those semantics from below; a Snapback
Durable Object adapter must instead make the honest hibernation choice this
RFC's §Backend adapters already requires, rather than inherit a wrapper's.
Partyserver remains prior art to consult (room routing, hibernation-aware
subscription handling, partysub's sharded fan-out). This posture is
revisable against a concrete hosted-rooms trigger — when a hosted
ephemeral-rooms target is actually being built, re-evaluate wrap-vs-parallel
against partyserver as it then exists, with LLP 0014 owning the broader
Cloudflare strategy.

## Dated amendment — connected-client facts stay outside collections (2026-08-10)

LLP 0222's connected-client predicate reuses the exact connection/grant/
generation lifecycle of the realtime adapter, but it is not an ephemeral
collection and is not author-writable. It carries no room key, value, merge
policy, durable replay, or client subscription. The server owns a bounded
reverse-principal witness index solely to answer an action host read; restart,
reset, expiry, or exact carrier retirement may turn the advisory answer false.
This preserves this RFC's typed ephemeral-state boundary rather than creating
an ambient presence table beside it.

## Status

Accepted (ratified in the LLP 0032 R1 batch on 2026-07-01). The local-process
implementation now validates the typed collection model, authenticated
connection ownership, WebSocket snapshot/delta behavior, coalescing,
restart/resync handling, bounded room/subscription state, and index-driven
disconnect cleanup. Hosted adapter and multi-process lease choices remain open
without reopening the accepted product boundary: ephemeral state is typed,
lossy, TTL-bound realtime authority rather than durable table sync or a raw
cache protocol. The 2026-07-13 amendment adds the previously missing
authorization-invalidation owner. LLP 0053 item 6 has now landed on the local
target: a room-permission collection may claim live revocation only when the
exact invalidation protocol is negotiated and the installed capability reports
available. Missing/unsupported negotiation still fails closed, and custom-key
authorization remains refused rather than inheriting room-permission semantics.
