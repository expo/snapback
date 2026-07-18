---
title: The React arm
id: clients.react
order: 2
audience: agent-first
capabilities: [clients.react]
authorities: [llp/0005-contract-exact-react-integration.explainer.md, demos/_kit/client.mjs]
examples: [demos/all-aboard/surfaces/react/src/main.tsx, demos/cursors-web/surfaces/react/src/useCursorRoom.ts]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-17
reviewed-commit: 8a6bbd1ec980a49010aa67269ee908433a257c9a
---

# The React arm

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

React apps consume Snapback through the framework-neutral client
(`demos/_kit/client.mjs`) **wired by hand** — there is no generated React
binding layer today. That is the deliberate difference between the arms:
the [Contract adapter](./contract-adapter.md) generates the wiring; React
writes ~20 explicit lines per surface. The wiring is small enough to audit,
and this page is the paved version of it — the exact material diary 0010
had to read source to reconstruct.

Boot is identical to the Contract arm: `client.health()`, then the
idempotent `client.ensureApp({ schema, functions, seed })` — never a
destructive reset on reload.

## Wire live queries into state

Bind each live query once, pushing rows and connection state into React
state; keep the handles for disposal:

```ts source=demos/all-aboard/surfaces/react/src/main.tsx
      const liveQuery = client.liveQuery.bind(client) as unknown as LiveQueryFn;
      const delaysLive = await liveQuery('liveTrainStatus', {
        connectionId: CONNECTION,
        transport: 'stream',
        onUpdate: (rows) => setDelayRows(rows as never),
        onConnectionChange: (value) => setConnection('liveTrainStatus', value as never),
      });
      const feedLive = await liveQuery('feedState', {
        connectionId: CONNECTION,
        transport: 'stream',
        onUpdate: (rows) => setFeedRows(rows as never),
        onConnectionChange: (value) => setConnection('feedState', value as never),
      });
      liveHandles = [delaysLive, feedLive];
      setDelayRows(delaysLive.rows as never);
      setFeedRows(feedLive.rows as never);
```

Notes that keep this correct:

- **One `connectionId` per surface.** All of a page's live handles share
  one durable socket; per-handle connection axes still arrive per query.
- **Apply `handle.rows` immediately after subscribing** — the snapshot is
  already on the handle; don't wait for the first push.
- **Dispose on unmount/HMR.** Every handle's `dispose()` runs in the
  effect cleanup (and StrictMode double-mount means a subscribe can resolve
  *after* its cleanup ran — check a `disposed` flag and dispose the
  latecomer instead of leaking it, as `useCursorRoom.ts` does).
- Mutations are direct calls handed down as callbacks:
  `client.mutate(ref, { args, userId })` / `client.action(...)` — the same
  structured results the headless client gets.

## Render connection state honestly

Consume the derived connection axis
(`connecting | live | stale | disconnected` — see
[live queries](../realtime/live-queries.md)) and render degraded states as
degraded: retained rows shown under a `stale` marker, TTL-pruning frozen
while degraded so departed entries stay renderable, resubscribe on
recovery. `demos/cursors-web/surfaces/react/src/useCursorRoom.ts` is the
reference hook for the full pattern (state mapping, `needs_resync`
handling, frozen maps).

For a connection-keyed map, compute `self` as
`entry.key === overlay.grantedConnectionId`. The hook's readable
`connectionId` is only the client registry label; it can differ from the
opaque id that the server granted and used as the entry lease key.

## Anti-patterns

- **Do not build a polling loop where a subscription exists** — wire
  `liveQuery` with `onUpdate` into state.
- **Do not treat `stale` as `live`.** The axis exists so the UI can tell
  the truth; collapsing it to a boolean re-creates the all-aboard red-team
  finding.
- **Do not leak handles across HMR/StrictMode remounts.** Track and
  dispose, including late-resolving subscribes.
- **Do not compare presence keys with a readable connection label.** Read the
  successful overlay's `grantedConnectionId` authority fact.
