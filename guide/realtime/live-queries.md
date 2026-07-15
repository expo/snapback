---
title: Live queries
id: realtime.live-queries
order: 1
audience: agent-first
capabilities: [realtime.live-queries, realtime.durable-push]
authorities: [llp/0008-local-first-sync-and-realtime.rfc.md, llp/0004-application-data-api.rfc.md, packages/snapback-codegen/define.mjs, demos/_kit/client.mjs]
examples: [demos/todo/tests/acceptance/headless.mjs, demos/_kit/tests/live-delta-e2e.mjs, demos/all-aboard/surfaces/react/src/main.tsx]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-15
reviewed-commit: b0e8431ade5325b794d3f62bad2b58567215d74e
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

## What arrives: replace and delta

Durable updates carry a `meta.kind`: `live_replace` (a full snapshot of the
result) or `live_delta` (incremental add/remove — the analyzable
unordered/filtered subset gets deltas; ordered queries fall back to
replace; LLP 0008 §DK-3). `resync_required` tells the client to
re-snapshot; `authorization_invalidation` is the auth barrier
([protecting data](../auth/sessions-and-principals.md)). A subscription
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
reconnect backoff 250ms → 10s. The [clients pages](../clients/contract-adapter.md)
show each arm consuming this axis.

## Anti-patterns

- **Do not poll a query you can subscribe to.** `liveQuery` exists;
  hand-rolled `setInterval` re-query loops re-derive a worse version of the
  poll transport and never get durable push.
- **Do not treat a socket as fresh because it is open.** `budget-missed`
  exists precisely because "open" and "fresh" diverge; consume the
  connection axis, not `isOpen()`.
- **Do not leak handles.** Every `liveQuery`/overlay handle is `dispose()`d
  in teardown (React: effect cleanup; suites: `cleanups`).
