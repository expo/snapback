---
title: Live queries
id: realtime.live-queries
order: 1
audience: agent-first
capabilities: [realtime.live-queries, realtime.durable-push]
authorities: [llp/0008-local-first-sync-and-realtime.rfc.md, llp/0222-connected-client-predicate.rfc.md, llp/0004-application-data-api.rfc.md, llp/0034-contract-source-seam-provider-side.rfc.md, llp/0108-inline-handlers-and-result-contracts.spec.md, crates/snapback-sync/src/connected_clients.rs, packages/snapback-codegen/define.mjs, packages/snapback-contract/keyed-provider.mjs, packages/snapback-client/index.d.mts, packages/snapback-client/index.mjs]
examples: [demos/todo/tests/acceptance/headless.mjs, demos/_kit/tests/live-delta-e2e.mjs, demos/all-aboard/surfaces/react/src/main.tsx, demos/partiful-matrix/tests/acceptance/step1-keyed-scopes.mjs, demos/party-wall]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:c383b6a529c23ecdfb650b27fe18fa9ca5f9378b15491b59e084f02fbfdd300b
---

# Live queries

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A live query is an ordinary query definition that clients can subscribe
to — the paved road to a live-updating list or view: subscribers get an
authoritative initial snapshot **with** the subscription (never a prime
race), then server-pushed updates over the durable lane as commits change
the result.

If a client remains stale, use the client/server snapshot join in
[query costs and runtime attribution](../backend/query-costs.md). It derives a
closed pending-delivery reason and follows the exact subscription into its
server wave; do not diagnose the episode by sleeping through guessed retry
delays.

## Define one

Mark the definition live — declarative or JS style
([your first backend](../getting-started/your-first-backend.md) covers the
two styles). Before writing a JS handler for a plain two-source join
(conversation membership, message ⋈ sender), check
[relational queries](../backend/relational-queries.md) —
`defineRelationalQuery` expresses it declaratively; the honest boundary is
that aggregation and self-joins are not expressible there today
([LLP 0177](repo:llp/0177-chat-aggregate-and-first-related-row-demand.research.md)):

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
[offline retention](../sync/offline-and-retention.md). Note the declaration
forces the experimental `single_table_v1` capability, available on
contributor-source builds and, since `@expo/snapback-*@0.1.11`, on published
packages carrying the packaged-store qualification receipt (see the
offline-retention page).

Stored document contracts include typed `v.assetRef` fields. A photo-bearing
table can therefore be queried directly as a live feed; the reference arrives
as its opaque asset-id string. Keep the typed reference on the row that owns
its sharing and GC semantics instead of maintaining a second string copy or a
side table for live delivery (see [Assets](../backend/assets.md#put-typed-photos-directly-in-a-live-feed)).

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
    // Phase 1 (LLP 0200): fan-out is scheduled off the commit turn, so poll
    // until the frame lands instead of asserting one immediate drain.
    const rows = await eventually(async () => {
      const polled = await b.poll();
      assertEqual(polled.length, 4, 'b did not receive realtime update');
      return polled;
    }, 'realtime update for client_b');
```

Mutation settlement does not imply your subscription already delivered the
matching frame (LLP 0200 §2.1): fan-out runs on the evaluation scheduler
after the commit is durable, and skipped subscriptions converge via a
rows-free `current_as_of` watermark. Wait on delivery (as above) rather
than asserting immediately after `mutate` resolves.

## Matching inserts in point and parent queries

**HostPlan matching inserts are guaranteed.** A subscribed point filter such
as `eq('_id', arg('id'))` or parent list such as
`eq('parentId', arg('parentId'))` must keep every matching row. The server may
publish an incremental Add or conservatively re-run and `live_replace`; the
result must not be empty merely because a sibling row was inserted. Ordered
lists and a populated `limit: 1` point result take the replacement lane.

These are matcher characterization results, not a faithful replay of every
application boundary in Diary 0106. The engine cases run a `writePost`-shaped
child insert plus parent `replyCount` patch and cover the populated point,
ordered parent, pre-insert, and post-insert subscription cuts. The real-socket
kit case uses a second client, keeps a `SnapbackProvisionalId`/outbox identity
distinct from the canonical row id, records the raw Add operations, and
observes `snapshot` before `live_delta`.

**Clique still observed a blank.** Its React thread used `postById` and
`repliesForPost` around a JS `writePost`, then recovered after switching to
`defineJsLiveQuery` plus a local cache. The available diary is an application
observation, not the original wire/probe trace, so the HostPlan
characterizations do not rule the matcher out for that observed product path.
Keep these three create-and-navigate cuts separate:

1. **Never put a provisional id on a point query.** A
   `SnapbackProvisionalId` identifies durable optimistic/outbox intent, not a
   row. Keep it in the optimistic-create projection. Use the canonical
   `Id<Table>` from settlement or its logical-mint mapping for `_id` filters.
2. **Wait for live delivery only when subscribed before the insert.** Mutation
   settlement does not await subscriber convergence; an already-open handle
   can still hold its empty pre-insert snapshot until its Add or replacement
   arrives.
3. **A post-settlement subscribe with the canonical id must snapshot the row.**
   It cannot receive the earlier delta because it did not exist then. If its
   authoritative initial snapshot is empty, that is a defect—do not wait for a
   future live frame to repair it.

For `blank after insert`, `Loading thread`, or `live_delta empty`, capture the
query args and canonical/provisional identity at each render, the mutation
settlement and subscription ids/versions, raw `snapshot`/`live_delta`/
`live_replace` frames, authorization boundary events, and React mount/remount
state. Mutation timing, provisional identity, authorization blanking,
optimistic-create projection, and HMR/remount are diagnostic hypotheses, not
the established fix.

While the faithful trace remains open, `defineJsLiveQuery` plus a local cache
remains the documented application workaround for the Clique symptom. It
changes the server lane to handler re-run/replacement and changes application
cache timing; its success is useful mitigation, not proof of which boundary
caused the blank and not disproven physics. For new code without the symptom,
the ordinary selection rule still applies: keep `defineLiveQuery` when the
table plan expresses the read, and choose JS for bounded logic or computed
results the declarative and relational carriers cannot express. See
[Queries](../backend/queries.md#choose-declarative-or-javascript-execution).

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

Two vocabularies meet here, and they are not the same list. **Wire frames**
on the durable lane carry one of five kinds: `live_replace` (a full snapshot
of the result), `live_delta` (incremental add/remove — the analyzable
unordered/filtered subset gets deltas; ordered queries fall back to
replace; LLP 0008 §DK-3), `resync_required` (the client must re-snapshot),
`authorization_invalidation` (the auth barrier —
[protecting data](../auth/protecting-data.md)), and `current_as_of` (the
answer to a resume-token subscribe: version advances, rows untouched).
Two of those never reach your callback as-is: the client consumes
`resync_required` by re-snapshotting, and it consumes
`authorization_invalidation` internally, resurfacing the boundary as the
`authorization_*` events below.

**What your `onUpdate(rows, meta)` receives** is different. A plain
(non-auth-scoped) subscription sees `meta.kind: 'live_replace'` or
`'live_delta'` (plus `'current_as_of'` when it resumed from a token). An
auth-scoped subscription — anything gated by a membership predicate or
another protected-query input — delivers through the witnessed lane instead
and never sees a bare `live_replace`. Its `meta.kind` values are this closed
set; handle all five:

- `authorization_snapshot` — an auth-verified result snapshot;
- `authorization_quarantine` — the result blanked at a governed boundary
  (e.g. the caller leaves the membership), awaiting a fresh satisfying
  snapshot or a trusted denial;
- `authorization_delete` — the terminal denial: rows deleted, fresh reads
  stay denied ([protecting data](../auth/protecting-data.md) describes the
  quarantine→delete ladder);
- `authorization_error` — the boundary machinery itself faulted; the handle
  blanks and the connection reports stale;
- `authorization_denied` — a server-answered denial on a fresh subscribe or
  authority transition; the same fact freezes on
  `handle.authorizationDenial` for rendering.

Incremental publication also requires the query's exact, schema-derived
`Documents` result contract. A `live_delta` publishes committed storage rows
without rerunning the complete query, so a `Documents` tag, table name, or
hand-written narrower descriptor is not enough to prove that those rows match
the operation's egress contract. Codegen supplies the exact contract and hash
for an ordinary authored declarative query. Internal fixtures that construct a
function manifest directly must derive the contract through the same codegen
path, as the linked executable fixture does; do not invent a descriptor by
hand. A missing or non-exact contract does not make the live query unloadable:
the server honestly takes the full re-query plus `live_replace` path instead.

When an apparently analyzable query receives replacements, check all of the
conservative boundaries together: ordered queries, limited windows once their
held membership reaches the cap, membership-gated queries, generated standard
patterns, opaque handlers, and manifests without the exact schema-derived
document contract are replace-only. This fallback is intentional and
correctness-preserving, not evidence that durable push failed.

The kit's end-to-end delta witness
(`demos/_kit/tests/live-delta-e2e.mjs`) drives all of this over a real
socket. Its subscription records every delivered `meta.kind`:

```js source=demos/_kit/tests/live-delta-e2e.mjs
  const handle = await db.liveQuery('listMine', {
    connectionId: 'delta_conn',
    userId: ADA,
    transport: 'stream',
    stream: FAST_STREAM,
    onUpdate: rec.onUpdate,
  });
```

and it asserts a matching insert arrived as a delta, not a replace:

```js source=demos/_kit/tests/live-delta-e2e.mjs
      const delta = rec.updates.find((u) => u.kind === 'live_delta');
      assert(delta, `expected a live_delta update; saw kinds ${rec.updates.map((u) => u.kind)}`);
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

## Ask whether a principal has a fresh client

In a session-auth action, use
`ctx.realtime.hasFreshClient({ principalId })` when an advisory routing choice
depends on whether any client for that opaque principal has contacted this app
authority recently:

```ts fragment reason="Representative action policy; applications supply their own generated action and push audience types"
const connected = await ctx.realtime.hasFreshClient({ principalId });
if (connected) return { skipped: true, reason: 'connected' };
return ctx.push.send(pushRequest);
```

The answer is existential across devices. It is `true` when at least one
session-authenticated managed WebSocket or authenticated poll-lane act has a
client-originated signal inside the fixed 15-second monotonic budget. Known
socket close, grant/session retirement, reset, and process restart remove the
relevant witness; otherwise expiry makes it false. Anonymous and scoped-service
clients never count.

Treat both answers narrowly: `false` means “no fresh witness,” not “offline,”
and `true` does not prove that the client observed a live event. The predicate
is action-only, non-durable, and does not join a query read set or advance a
database version. Local serving uses one app-instance authority. Hosted or
multi-instance targets must either route both client activity and the action to
one declared authority or implement a sound shared union; targets without that
property omit the capability instead of returning a process-local lie.

## Anti-patterns

- **Do not poll a query you can subscribe to.** `liveQuery` exists;
  hand-rolled `setInterval` re-query loops re-derive a worse version of the
  poll transport and never get durable push.
- **Do not treat a socket as fresh because it is open.** `budget-missed`
  exists precisely because "open" and "fresh" diverge; consume the
  connection axis, not `isOpen()`.
- **Do not leak handles.** Every `liveQuery`/overlay handle is `dispose()`d
  in teardown (React: effect cleanup; suites: `cleanups`).
- **Do not combine component-local state or counter deltas with a value a
  live query already delivers.** Viewer-specific facts (a `liked` flag, a
  count) belong in the query result; zero-latency interaction comes from an
  optimistic projection over that same store, which reconciles with later
  authoritative deliveries instead of double-applying — see
  [the optimistic toggle recipe](../recipes/optimistic-toggle.md).
