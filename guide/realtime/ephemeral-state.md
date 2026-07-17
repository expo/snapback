---
title: Ephemeral realtime state
id: realtime.ephemeral-state
order: 2
audience: agent-first
capabilities: [realtime.ephemeral]
authorities: [llp/0013-ephemeral-realtime-state.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, demos/_kit/client.mjs, packages/snapback-contract/index.mjs]
examples: [demos/cursors-web, demos/todo-v2/snapback/schema.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-16
reviewed-commit: a8bfff367ed5e203faaa78a56a39ab42f5d2cfa8
---

# Ephemeral realtime state

> **Local target only.** This page describes the process-local dev/test
> target. A hosted target needs sticky room routing or a shared room adapter;
> Snapback does not currently claim that hosted capability.

Ephemeral collections are typed, authorized, TTL-bounded latest-state maps for
presence, cursors, selections, typing, drag state, and live viewport state.
They are deliberately lossy: if a value must survive restart, support offline
reads, or enter history/audit, put it in a durable table instead.

Start with the [presence-cursors recipe](../recipes/presence-cursors.md) when
building a feature. Use this page when choosing collection options or handling
recovery.

## Declare the complete collection contract

One collection declaration contains every routing, ownership, budget,
delivery, validation, and access fact:

```js source=demos/cursors-web/snapback/schema.mjs
    webCursors: ephemeral.collection({
      scope: { roomId: v.string() },
      routing: ['roomId'],
      key: 'connection',
      ttlMs: 5_000,
      maxTtlMs: 30_000,
      maxValueBytes: 1_024,
      publishRate: { sustainedHz: 20, burst: 40 },
      delivery: { mode: 'latest', dispatchMs: 33 },
      value: v.object({
        x: v.number(),
        y: v.number(),
        name: v.string(),
        color: v.string(),
        updatedAt: v.optional(v.number()),
      }),
      publish: allow.all(),
      subscribe: allow.all(),
    }),
```

The option inventory is:

| Option | Local contract |
| --- | --- |
| `scope` | Required non-empty validator object. Its normalized values partition snapshots, fan-out, and authorization. |
| `routing` | Defaults to every scope field; must be a non-empty, duplicate-free subset of `scope`. |
| `key` | `connection` by default; also `session`, `user`, or `custom`. |
| `ttlMs` | Required positive default lease. There is no immortal entry. |
| `maxTtlMs` | Defaults to and may not exceed 30,000ms; must be at least `ttlMs`. |
| `maxValueBytes` / `hardMaxValueBytes` | Defaults 1,024/4,096 bytes; neither may cross the 4 KiB local hard cap. |
| `publishRate` | Defaults to `{ sustainedHz: 20, burst: 60 }`, enforced per connection/collection. |
| `delivery` | Defaults to `{ mode: 'latest', dispatchMs: 33 }`; `latest` is the only shipped mode. |
| `publish` / `subscribe` | Both required explicit policies: `allow.all()` or `allow.roomPermission(prefix)`. |
| `value` | Required portable validator; generated clients and the server validate it. |
| `targets` | Defaults to `local-dev-sqlite-ibex`; codegen rejects an undeclared selected target. |
| `maxPendingEphemeralKeys` | Defaults to 1,024, bounding coalesced keys retained for dispatch. |

Codegen rejects unsafe routing, absent TTL/auth, unsupported modes/targets,
invalid validators, and over-budget declarations before it writes artifacts.
Do not treat authoring defaults as hosted scale promises.

## Choose a key mode deliberately

- `connection` gives each active connection its own value and reclaims it on
  disconnect or expiry. It is the normal cursor/presence choice.
- `session` derives the key from the authenticated session, so reconnecting
  can refresh the same lease. A caller-supplied session id is only an
  assertion and must match transport authority.
- `user` derives the key from the authenticated user. Multiple connections
  refresh one shared lease; use it only when presence privacy permits.
- `custom` accepts several connection-owned keys. Until generated
  key-specific authorization exists, only the creating connection may replace
  or delete each key.

Never put a display name or caller-asserted user id in charge of ownership.
The transport-derived connection/session/user identity is authoritative.

## Authorize publish and subscribe separately

`allow.all()` is explicit public room access. For protected rooms, use the
same room permission prefix on publish and subscribe and grant the normalized
permission through the connection authority:

```js fragment reason="Policy fragment; protected room fixture uses a different domain-specific prefix."
publish: allow.roomPermission('boardPresence'),
subscribe: allow.roomPermission('boardPresence'),
```

The matching permission string is
`SnapbackClient.roomPermission('boardPresence', scope)`. A room protected by
durable membership also participates in the authorization-invalidation
barrier. Membership-backed room authority binds to the declaration's stable id,
not a table name or ambient role string; removing or downgrading a required role
quiesces affected room sinks before the commit becomes visible. Custom-key
authorization beyond connection ownership is not shipped.

## Subscribe to snapshot plus deltas

`subscribeEphemeral(ref, { connectionId, scope, ... })` registers the lane
consumer before requesting its authoritative snapshot, buffers in-flight
deltas, then applies them after the snapshot boundary. The returned overlay
provides `currentEntries()`, `onChange`, `publish`, `delete`, `drain`, and
`dispose`.

Each current entry is:

```text fragment reason="Normalized public entry shape assembled by EphemeralOverlay.currentEntries()."
{ key, value, expiresAtMs, receivedAtMs, scopeEpoch, entryVersion }
```

The client prunes by the server-stamped expiry deadline. Server expiry,
explicit delete, and disconnect normally emit remove deltas, but TTL is the
backstop when that remove is lost.

## Treat epochs and versions as one-room coordinates

`entryVersion` is a monotonic room-local high-water coordinate, meaningful
only for one collection/scope and within one `scopeEpoch`. The overlay ignores
stale versions and keeps bounded tombstones so an old upsert cannot resurrect
a removed entry.

An epoch mismatch, queue overflow, or connection-wide continuity loss produces
the level-triggered `needs_resync` state. Blank/degrade the UI, create a fresh
overlay with `subscribeEphemeral`, attach its listener, then dispose the old
overlay. Do not compare ephemeral versions with durable commit versions, and
do not reopen a connection-poisoned overlay with a delayed snapshot.

## Use generated Contract links

Codegen emits a typed `*.ephemeral.ts` read descriptor, a
`*.publish.ts` descriptor, their Contract metadata, and runtime links. A
Contract component reads the map as an `ephemeral` binding:

```contract source=demos/cursors-web/surfaces/contract/app.contract
  ephemeral cursors = webCursors({ roomId: "lobby" })
```

The surface prewarms the room and configures the generated links; authored
`publish ... rate=N` channels are statically checked against the generated
publish budget. Keep imperative overlays in headless/React code and generated
ephemeral links in Contract code—do not mix a second polling or publish lane
into the same surface.

## Anti-patterns

- **Do not store transient motion in tables.** Durable commits and history are
  the wrong correctness model for cursor samples.
- **Do not invent global/unscoped rooms.** Scope is the fan-out and
  authorization boundary.
- **Do not retry rate-limit failures blindly.** Lower the publisher rate and
  observe rejections.
- **Do not trust deltas after `needs_resync`.** Establish a fresh snapshot
  boundary.
- **Do not claim multi-instance presence.** The current shipped adapter is
  process-local.
