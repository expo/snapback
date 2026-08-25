---
title: "Recipe: presence cursors"
id: recipes.presence-cursors
order: 1
audience: agent-first
capabilities: [realtime.ephemeral]
authorities: [llp/0013-ephemeral-realtime-state.rfc.md, llp/0107-react-presence-and-optimistic-lifecycle.spec.md, packages/snapback-codegen/define.mjs, packages/snapback-client/index.mjs, packages/snapback-react/index.mjs]
examples: [demos/cursors-web, demos/todo-v2/snapback/schema.mjs, demos/messaging-snapback/src/lib/useTyping.ts, demos/pointing-room/surfaces/contract/pointing.contract]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-06
reviewed-authorities-digest: sha256:a7db97c928d50b0540d979fcb70b41dd58eb0afedbbfe340eb6201b40817372c
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

For React, start with
[`useSnapbackPresence`](../realtime/ephemeral-state.md#stop-publishing-when-activity-goes-idle),
the managed hook for generated ephemeral collections; that page transcludes a
conversation-scoped typing indicator from `demos/messaging-snapback`. The raw
`subscribeEphemeral` path below remains useful for headless consumers and code
that deliberately owns manual draining, polling, or overlay lifecycle.

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

`key: 'connection'` makes the lease key the publisher's opaque,
server-granted connection id—presence provenance without a spoofable app
field. The readable `connectionId` that app code passes to the kit is only a
local grant/socket label; it may match the lease key after initial dev
adoption, but collision or mint-only containment makes them diverge.
Regenerate after editing (the generated publish descriptor carries the
budget facts your client code should assert against, e.g. cursors-web
checks its declared publish rate fits `sustainedHz` at init).

## 2. Subscribe to the room without React

`subscribeEphemeral` returns an overlay that applies the authoritative
snapshot, then buffers and applies deltas from the shared live socket
(registered before the snapshot request, so nothing can fall in the gap).
The default call acquires and readiness-proves its managed stream itself; do
not prime it with a durable subscription or call `waitUntilReady()` first:

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
`{ key, value, expiresAtMs, ... }`; `entry.key ===
overlay.grantedConnectionId` is "self". `grantedConnectionId` is captured
from the exact successful subscribe attempt, including a token-refresh retry.
`onChange` also delivers a level-triggered `'needs_resync'` when
connection continuity is lost (epoch boundary / queue overflow): present
degraded state, then re-enter with a fresh `subscribeEphemeral` and swap
the overlay. `overlay.dispose()` releases the stream demand. Only manual
headless drain loops should opt into `transport: "poll"`.

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

## Publish ordinary presence from Contract

A Contract surface uses the generated ephemeral read and publish descriptors
with a rated channel. Pointing Room imports both halves plus Exact's channel:

```contract source=demos/pointing-room/surfaces/contract/pointing.contract
use roomPresence from "../../snapback/generated/contract/roomPresence.ephemeral.ts"
use roomPresencePublish from "../../snapback/generated/contract/roomPresence.publish.ts"
use pointerChannel from "@exact/contract/channels"
```

Bind the collection to Contract-owned scope state and declare the channel. The
same `activeRoomId` that keys durable queries keys the presence subscription:

```contract source=demos/pointing-room/surfaces/contract/pointing.contract
  query currentRound = liveRound({ roomId: activeRoomId })
  query tally = liveTally({ roomId: activeRoomId })
  ephemeral presence = roomPresence({ roomId: activeRoomId })

  mutation submitVote = castVote
  mutation flipRound = revealRound
  mutation beginRound = startRound
  use presencePulse = pointerChannel()
```

Publish once at mount so the viewer appears before the first interaction:

```contract source=demos/pointing-room/surfaces/contract/pointing.contract
  task announcePresence mount
    publish(presencePulse)
```

The view clause maps channel pulses to the ordinary collection publisher. It
owns the rate, heartbeat, current scope, payload, and TTL:

```contract source=demos/pointing-room/surfaces/contract/pointing.contract
      publish presencePulse.self -> roomPresencePublish rate=4 heartbeat=0.1 payload={ roomId: activeRoomId, value: { name: viewerName, picking: selected != "" }, ttlMs: 15000 }
```

**Collection publishing is not pointer-only.** `pointerChannel` is the rated
carrier that schedules the clause; it does not restrict the published value to
pointer coordinates. Here it publishes an ordinary `{ name, picking }`
presence value through `roomPresencePublish`.

When `activeRoomId` changes, the `ephemeral presence = ...` binding re-keys the
subscription. The action also pulses the channel *after* updating the scope so
the same view clause publishes current presence into the new room immediately;
payload-changing actions pulse it for the same reason:

```contract source=demos/pointing-room/surfaces/contract/pointing.contract
  action switchRoom(roomId) writes activeRoomId, selected, nextTopic
    activeRoomId = roomId
    selected = ""
    nextTopic = ""
    publish(presencePulse)
  action startNext writes selected, nextTopic mutates beginRound
    beginRound({ roomId: activeRoomId, topic: nextTopic.trim() })
    selected = ""
    nextTopic = ""
    publish(presencePulse)
```

The heartbeat keeps the active lease refreshed between explicit pulses; it is
not a substitute for the scope-change pulse because the new room should not
wait for the next heartbeat.

## Anti-patterns

- **Do not store presence in tables.** Cursor positions in app data means
  commits, versions, and history for state that is worthless in ten
  seconds; the ephemeral store exists for exactly this.
- **Do not invent your own presence keys.** `key: 'connection'` gives you
  provenance; a custom name field is spoofable and duplicates on refresh.
- **Do not compare entry keys with the readable connection label.** Compare
  with `overlay.grantedConnectionId`; only the server grant is lease identity.
- **Do not publish above the declared budget** — assert your sample rate
  fits the generated budget facts at init, like the reference hook does.
- **Do not hand-wire a React overlay for ordinary presence or typing.** Use
  `useSnapbackPresence` so the provider owns Strict Mode replay, heartbeat,
  resync, authority changes, and teardown.
- **Do not build a DOM/timer bridge for Contract presence publishing.** Use a
  rated channel plus the generated publish descriptor; pulse it at mount and
  whenever Contract-owned scope or payload state changes.
