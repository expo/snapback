---
title: Live queries
id: realtime.live-queries
order: 1
audience: agent-first
capabilities: [realtime.live-queries, realtime.durable-push]
authorities: [llp/0008-local-first-sync-and-realtime.rfc.md, llp/0004-application-data-api.rfc.md, llp/0034-contract-source-seam-provider-side.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-contract/keyed-provider.mjs, demos/_kit/client.mjs]
examples: [demos/todo/tests/acceptance/headless.mjs, demos/_kit/tests/live-delta-e2e.mjs, demos/all-aboard/surfaces/react/src/main.tsx, demos/partiful-matrix/tests/acceptance/step1-keyed-scopes.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-17
reviewed-commit: 8a6bbd1ec980a49010aa67269ee908433a257c9a
---

# Live queries

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A live query is an ordinary query definition that clients can subscribe
to: subscribers get an authoritative initial snapshot **with** the
subscription (never a prime race), then server-pushed updates over the
durable lane as commits change the result.

## Define one

Mark the definition live — declarative or JS style
([your first backend](../getting-started/your-first-backend.md) covers the
two styles):

```js source=demos/todo/snapback/functions.mjs
export const listTodos = defineJsLiveQuery({
  args: {},
  source: 'handlers.mjs',
  exportName: 'listTodos',
  reads: ['todos'],
  authScopeField: 'userId',
```

`defineLiveQuery` is the declarative twin (same spec as `defineQuery` plus
`defaultLive: false` to make live opt-in per subscription). `reads:` and
`authScopeField:` matter: they drive invalidation and per-principal scoping
(see [auth](../auth/sessions-and-principals.md)). Subscribing to a non-live
function fails with `SNAPBACK_FUNCTION_NOT_LIVE`.

Offline cold retention is a separate per-query opt-in: `auth: 'public'` +
`authorityIndependent: true` on a declarative live query makes it
`rqsEligible`; without the declaration nothing persists and the handle's
`retention` fact names the refusal. The full recipe is in
[offline retention](../sync/offline-and-retention.md).

## Subscribe

`client.liveQuery(ref, options)` returns a handle with the snapshot already
applied — `rows`, `connection`, `poll()`, `dispose()`:

```js source=demos/todo/tests/acceptance/headless.mjs
    const handle = await db.liveQuery(api.listTodos, { connectionId: 'client_a', userId: ADA });
    assertEqual(handle.rows.length, 3, 'snapshot rows');
```

Cross-client delivery is the point — one client mutates, the other's
subscription updates:

```js source=demos/todo/tests/acceptance/headless.mjs
    const b = await db.liveQuery(api.listTodos, { connectionId: 'client_b', userId: ADA });
    assertEqual(b.rows.length, 3, 'b initial');
    await db.mutate(api.createTodo, { args: { title: 'Added by another client' }, userId: ADA });
    const rows = await b.poll();
    assertEqual(rows.length, 4, 'b did not receive realtime update');
```

Key options: `transport: 'stream'` for durable WebSocket push (`'poll'` is
the default, cadence `pollCadenceMs`, with `fallbackToPoll` when a stream
can't be established), `onUpdate(rows, meta)`, `onConnectionChange`,
`connectionId` (one shared socket per connection id multiplexes all of that
connection's live handles), and per-socket `stream:` tuning
(heartbeat/freshness/reconnect). Always `dispose()` handles you created.
The supplied `connectionId` is a readable client-local label; the kit resolves
and refreshes its opaque granted wire id for high-level calls. A low-level
adapter constructing raw frames must use
`(await client.connectionGrant(label)).id`, never the readable label.

## Logical keyed bindings

One physical handle is not necessarily one component binding. The dynamic
Contract provider lets Exact key a logical attempt by opaque authority
partition, stable descriptor identity and compatibility token, and canonical
arguments. Same-key siblings share data/error/reconnect state but dispose by
independent refcount; different args, descriptors, providers, or authority
partitions stay isolated. An authority change clears predecessor rows before
reopening, so a late result cannot cross the privacy cut.

This layer is for generated/framework integrations. Direct headless callers
still own each `client.liveQuery()` handle they create. See
[the Contract adapter](../clients/contract-adapter.md) for the shipped dynamic
mode and its current live-push/no-offline profile boundary.

## What arrives: replace and delta

Durable updates carry a `meta.kind`: `live_replace` (a full snapshot of the
result) or `live_delta` (incremental add/remove — the analyzable
unordered/filtered subset gets deltas; ordered queries fall back to
replace; LLP 0008 §DK-3). `resync_required` tells the client to
re-snapshot; `authorization_invalidation` is the auth barrier
([protecting data](../auth/protecting-data.md)). A subscription
asserts on delta kinds like this:

```js source=demos/_kit/tests/live-delta-e2e.mjs
  const handle = await db.liveQuery('listMine', {
    connectionId: 'delta_conn',
    userId: ADA,
    transport: 'stream',
    stream: { heartbeatIntervalMs: 200, freshnessBudgetMs: 800, reconnectBaseDelayMs: 100, reconnectMaxDelayMs: 400 },
    onUpdate: rec.onUpdate,
  });
```

Membership-gated live replacement does not make a query safe for offline
retention. V1 refuses retained role-gated queries until an authorized lease can
bind the exact membership declaration/resource dependency and expiry floor.
For online live state, declaration-bound `requireRole` dependencies are
revocation-active: resource- or app-scoped membership deletion/downgrade first
blanks the established result, then a trusted denial terminally deletes it and
ACKs the exact obligation. Fresh reads remain denied and later writes cannot
repopulate that handle.

## Connection state an author can observe

The stream manager emits `'connecting'`, `'open'`, `'lost'`
(`{ wasOpen }`), `'budget-missed'` (socket claims open but the freshness
budget lapsed), and `'closed'`. The kit derives a per-query `connection`
axis from these and pushes it through `onConnectionChange`; the conventional
author-facing mapping (from the cursors-web hook) is:

```ts source=demos/cursors-web/surfaces/react/src/useCursorRoom.ts
export type ConnectionAxis = 'connecting' | 'live' | 'stale' | 'disconnected';
```

`open → live`; `budget-missed`/`lost → stale` (degraded — render retained
data, marked); `closed → disconnected`. Defaults:
`LIVE_HEARTBEAT_INTERVAL_MS = 5_000`, `LIVE_FRESHNESS_BUDGET_MS = 15_000`,
reconnect backoff 250ms → 10s. The
[headless client](../clients/headless.md) owns this state machine; the
[Contract adapter](../clients/contract-adapter.md) and React arm consume it.

## Anti-patterns

- **Do not poll a query you can subscribe to.** `liveQuery` exists;
  hand-rolled `setInterval` re-query loops re-derive a worse version of the
  poll transport and never get durable push.
- **Do not treat a socket as fresh because it is open.** `budget-missed`
  exists precisely because "open" and "fresh" diverge; consume the
  connection axis, not `isOpen()`.
- **Do not leak handles.** Every `liveQuery`/overlay handle is `dispose()`d
  in teardown (React: effect cleanup; suites: `cleanups`).
