# Refuse permission and ephemeral generation exhaustion

**Status:** Closed
**Severity:** P1
**Systems:** Auth compatibility epochs, Live queries, Ephemeral state, Client overlays
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0013; LLP 0020; LLP 0026; LLP 0059
**Marker:** overflow, aba, permission, ephemeral, realtime

Three production generation allocators used unchecked increment operations:

- `LocalSnapback::advance_permission_epochs` increments after the durable
  mutation commit. Debug overflow can panic after success; release overflow
  returns to zero and lets a stale permission snapshot compare as current.
- `RoomState::allocate_version` can panic or reuse an entry version, breaking
  per-room coalescing and remove/upsert order.
- `next_scope_epoch.fetch_add(1)` wraps room incarnations, so a recreated room
  can become indistinguishable from an extinct client overlay generation.

These are plain-JSON authority and sequencing identities, not telemetry
counters. Their exact domain is `0..=Number.MAX_SAFE_INTEGER`; they must never
wrap, cross that portable boundary, or report success after exhaustion.

**Done when:**

- Every permission-epoch mutation seam checks capacity before the durable
  commit; post-commit publication remains actually infallible.
- Entry-version allocation is checked before mutating an entry, including
  publish, delete, expiry, disconnect, and reauthorization cleanup.
- Entry exhaustion terminally retires the whole room generation, purges the
  exact old room/fence lane, and enqueues only an authority-independent
  `EpochChanged` clearing boundary. A protected authority tombstone blocks
  stale active permits from recreating the room; bounded enqueue failure stays
  fail-closed behind the existing poison marker.
- Scope-epoch creation uses checked atomic allocation and never inserts a room
  after exhaustion.
- Room-authority generations use the same portable maximum and refuse before
  an authorization-changing commit.
- Exhaustion returns or records a stable typed diagnostic, emits no wrapped
  frame or replacement data, and is covered by deterministic max-minus-one,
  max, N+1, teardown, stale-lane, and active-permit race tests.
- Generated schemas publish the same maximum for client-visible permission,
  room, scope, and entry versions.
- Focused Rust tests and diagnostic inventory pass.

## Resolution

Permission, room entry, room authority, collection, and scope generations now
share checked portable allocation. Permission capacity is preflighted before
every durable seam; exhausted rooms retire their exact generation, purge its
lane, and emit only the authority-independent clearing boundary while stale
permits remain fenced. Generated schemas publish the same JavaScript-safe
maximum.

Focused proof includes the permission precommit matrix, final-entry then
retirement, exhausted-scope refusal, room-authority precommit refusal, and
delete/expiry/disconnect/reauthorization retirement cases. The artifact-schema
tests, diagnostic inventory, and full Rust library suite (1,102 passed) all
passed.
