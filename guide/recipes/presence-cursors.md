---
title: "Recipe: presence cursors"
id: recipes.presence-cursors
order: 1
audience: agent-first
capabilities: [realtime.ephemeral]
authorities: [llp/0013-ephemeral-realtime-state.rfc.md, packages/snapback-codegen/define.mjs, demos/_kit/client.mjs]
examples: [demos/cursors-web, demos/todo-v2/snapback/schema.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-16
reviewed-commit: 1af150e0a1acffb372b7ac64fe32b61f1bf64db2
---

# Recipe: presence cursors

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

"Two users see each other's cursors" is ephemeral state, not app data: it
lives in typed in-memory rooms with TTL expiry and connection-owned
cleanup (LLP 0013) — never in tables, never polled. The working reference
is `demos/cursors-web`. This recipe is the shortest paved implementation;
the [ephemeral-state reference](../realtime/ephemeral-state.md) inventories
every collection option, key mode, recovery rule, and Contract link.

## 1. Declare the ephemeral collection in the schema

An ephemeral collection is declared beside your tables, with its scope
(the room key), keying, TTL, payload budget, and publish rate all typed
and enforced server-side. The shape (this one is todo-v2's presence
collection; cursors-web's `webCursors` follows the same form):

```js source=demos/todo-v2/snapback/schema.mjs
  ephemeral: defineEphemeral({
    todoPresence: ephemeral.collection({
      scope: { listId: v.string() },
      routing: ['listId'],
      key: 'connection',
      ttlMs: 20_000,
      maxTtlMs: 30_000,
      maxValueBytes: 512,
      publishRate: { sustainedHz: 20, burst: 40 },
      delivery: { mode: 'latest', dispatchMs: 33 },
      value: v.object({
        name: v.string(),
        editing: v.optional(v.boolean()),
      }),
      publish: allow.all(),
      subscribe: allow.all(),
```

`key: 'connection'` makes the lease key the publisher's connection id —
presence provenance for free: an entry with your connection id *is* you.
Regenerate after editing (the generated publish descriptor carries the
budget facts your client code should assert against, e.g. cursors-web
checks its declared publish rate fits `sustainedHz` at init).

## 2. Subscribe to the room

`subscribeEphemeral` returns an overlay that applies the authoritative
snapshot, then buffers and applies deltas from the shared live socket
(registered before the snapshot request, so nothing can fall in the gap):

```ts source=demos/cursors-web/surfaces/react/src/useCursorRoom.ts
    void client
      .subscribeEphemeral(cursorsRef, { connectionId, scope: { roomId } })
      .then((overlay) => {
        if (disposed) {
          // StrictMode double-mount: the first effect's subscribe may resolve
          // after its cleanup ran — never leak that overlay's lane consumer.
          overlay.dispose();
          return;
        }
        overlayRef.current = overlay;
        subscribedRef.current = true;
        offChange = overlay.onChange(handleChange);
        recompute();
      })
```

Read entries with `overlay.currentEntries()` — each is
`{ key, value, expiresAtMs, ... }`; `entry.key === connectionId` is
"self". `onChange` also delivers a level-triggered `'needs_resync'` when
connection continuity is lost (epoch boundary / queue overflow): present
degraded state, then re-enter with a fresh `subscribeEphemeral` and swap
the overlay.

## 3. Publish samples under the declared budget

```ts source=demos/cursors-web/surfaces/react/src/useCursorRoom.ts
      overlay
        .publish(value, { ttlMs: PRESENCE_TTL_MS })
        .then(() => {
          state.published += 1;
          if (state.establishedAtMs === null) state.establishedAtMs = Date.now();
        })
        .catch(() => {
          state.rejected += 1;
        });
```

The server enforces the schema's rate and payload budgets — count
rejections rather than retrying blindly. Entries expire on the
server-stamped `expiresAtMs`; the reference hook freezes TTL-pruning while
the connection is `stale`/`disconnected` so departed cursors stay
renderable during degradation instead of silently vanishing.

## Anti-patterns

- **Do not store presence in tables.** Cursor positions in app data means
  commits, versions, and history for state that is worthless in ten
  seconds; the ephemeral store exists for exactly this.
- **Do not invent your own presence keys.** `key: 'connection'` gives you
  provenance; a custom name field is spoofable and duplicates on refresh.
- **Do not publish above the declared budget** — assert your sample rate
  fits the generated budget facts at init, like the reference hook does.
