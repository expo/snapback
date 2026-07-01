# LLP 0026: Ephemeral backend abstraction hardening

**Type:** Plan
**Status:** Draft
**Systems:** Realtime, Ephemeral state, Runtime, Deployment, Client integration, Testing, Developer experience
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-29
**Revised:** 2026-06-29
**Related:** LLP 0000, LLP 0008, LLP 0013, LLP 0014, LLP 0017, LLP 0018, LLP 0020, LLP 0025, Diary 0007

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

- there is no trait or object boundary for alternate backends;
- all HTTP/WebSocket operations still take the shared `LocalSnapback` mutex;
- room state is not a per-room actor, sharded lock, or adapter-owned authority;
- TTL cleanup scans rooms instead of using an expiry heap, timing wheel, or
  adapter-native expiry index;
- room memory limits and subscriber limits are not enforced as first-class
  capability facts;
- runtime value validation is byte-budget validation, not the generated value
  schema;
- auth is local and prefix-shaped; durable permission-change revocation is not
  integrated;
- hosted-adapter behavior is documented but not executable.

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
- max aggregate value bytes per room;
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
rate-limit counts, expired/disconnected removes, memory estimates, and last
epoch/resync reason.

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
  implementations, or an actor interface?
- Should local room authority be implemented first with actors or sharded locks?
- Which hosted adapter should be prototyped first: Redis-compatible or Cloudflare
  Durable Object?
- What are the first hard defaults for active rooms, entries per room, room bytes,
  and subscribers per room?
- Should `dispatchMs` become a real scheduler control in Phase 2, or stay only a
  manifest capability until hosted adapters exist?
- Where should generated value validators live so Rust, JavaScript tests, and
  generated clients agree on the same ephemeral value shape?

## Status

Draft. This Plan operationalizes LLP 0013's backend-adapter section and the LLP
0025 collection-lifecycle correction. It should be revised after Phase 1 lands,
because the first extraction will likely reveal which parts of today's concrete
store are true contract and which are local implementation detail.
