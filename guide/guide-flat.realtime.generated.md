<!-- Generated realtime section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/realtime/live-queries.md -->
---
title: Live queries
id: realtime.live-queries
order: 1
audience: agent-first
capabilities: [realtime.live-queries, realtime.durable-push]
authorities: [llp/0008-local-first-sync-and-realtime.rfc.md, llp/0222-connected-client-predicate.rfc.md, llp/0004-application-data-api.rfc.md, llp/0034-contract-source-seam-provider-side.rfc.md, llp/0108-inline-handlers-and-result-contracts.spec.md, src/connected_clients.rs, packages/snapback-codegen/define.mjs, packages/snapback-contract/keyed-provider.mjs, packages/snapback-client/index.mjs]
examples: [demos/todo/tests/acceptance/headless.mjs, demos/_kit/tests/live-delta-e2e.mjs, demos/all-aboard/surfaces/react/src/main.tsx, demos/partiful-matrix/tests/acceptance/step1-keyed-scopes.mjs, demos/party-wall]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:200cc44a010d410e8d1079febbdeacb45e946479a33ec31a8281c84acce48783
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
conservative boundaries together: ordered or limited queries, membership-gated
queries, generated standard patterns, opaque handlers, and manifests without
the exact schema-derived document contract are replace-only. This fallback is
intentional and correctness-preserving, not evidence that durable push failed.

The kit's end-to-end delta witness
(`demos/_kit/tests/live-delta-e2e.mjs`) drives all of this over a real
socket. Its subscription records every delivered `meta.kind`:

```js source=demos/_kit/tests/live-delta-e2e.mjs
  const handle = await db.liveQuery('listMine', {
    connectionId: 'delta_conn',
    userId: ADA,
    transport: 'stream',
    stream: { heartbeatIntervalMs: 200, freshnessBudgetMs: 800, reconnectBaseDelayMs: 100, reconnectMaxDelayMs: 400 },
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

---

<!-- snapback-guide-source: guide/realtime/ephemeral-state.md -->
---
title: Ephemeral realtime state
id: realtime.ephemeral-state
order: 2
audience: agent-first
capabilities: [realtime.ephemeral]
authorities: [llp/0013-ephemeral-realtime-state.rfc.md, llp/0107-react-presence-and-optimistic-lifecycle.spec.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0247-ordinary-client-normalization-and-recovery.rfc.md, llp/0257-activity-scoped-presence-convenience.rfc.md, llp/0184-agent-accessible-control-plane.rfc.md, src/admin.rs, src/ephemeral.rs, src/server.rs, src/cli.rs, packages/snapback-cli/mcp-control.mjs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-client/index.mjs, packages/snapback-contract/index.mjs, packages/snapback-react/index.mjs, packages/snapback-react/index.d.mts, packages/snapback-react/activity-presence.test.mjs, packages/snapback-expo/activity-presence.mjs, packages/snapback-expo/activity-presence.test.mjs, demos/_kit/tests/regression-multiplexed-lanes.mjs]
examples: [demos/cursors-web, demos/todo-v2/snapback/schema.mjs, demos/messaging-snapback/src/lib/useTyping.ts]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:db92bd62a8b6e44311e5a8b2db0b1bd3e3c76e27bcd1237d3f199aada3ced9f0
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

<!-- since: 0.1.23 -->

## Stop publishing when activity goes idle

In the schema and headless client this feature is named **ephemeral**. In the
React client the base scoped hook is named **`useSnapbackPresence`**, and
**`useSnapbackActivityPresence`** adds the common “publish now, withdraw after
the last activity tick” lifecycle. There is no separate
`useSnapbackEphemeral` hook.

`scope` is the room boundary, so a conversation id gives one typing room per
conversation. `ConnectionEphemeralCollectionReference` describes how each row
inside that room is owned and keyed; it does not force a global or
connection-only scope. Call `touch()` for each keystroke or other activity
tick. The value thunk is sampled only by that call, the provider owns lease
renewal, and the helper withdraws after the absolute `idleMs` deadline.
`withdraw()` clears immediately for events such as editor clear or message
send. The result retains the base `status`, `connection`, `publisher`, and
`diagnostic` fields; action failures use `onError` and `lastError`.

In Expo, import the hook from `@expo/snapback-expo`. Its facade wrapper gates
the first publication until AppState observation is established and withdraws
on backgrounding. A direct `@expo/snapback-react` import has the same deadline
state machine but no platform lifecycle listener.

The messaging demo has one deliberate direct-client exception. Its interactive
server uses dev-mode persona assertions, while the `typing` collection also
requires a client-asserted membership permission. The provider hook does not
accept those direct-dev credentials, so this demo constructs the exact room
permission, passes both assertions when subscribing, and lets the returned
overlay inherit them for publish/delete:

```tsx source=demos/messaging-snapback/src/lib/useTyping.ts
  const scope = useMemo(() => ({ conversationId }), [conversationId]);
  const permissions = useMemo(
    () => [(SnapbackClient as unknown as {
      roomPermission(prefix: string, permissionScope: Record<string, unknown>): string;
    }).roomPermission('m_conversationMemberships', scope)],
    [scope],
  );
```

```tsx source=demos/messaging-snapback/src/lib/useTyping.ts
    void client.subscribeEphemeral(typingRef, {
      connectionId,
      scope,
      userId: selfHandle,
      permissions,
    }).then((subscribed) => {
      overlay = subscribed;
      if (cancelled) {
        void subscribed.delete().catch(() => {}).finally(() => subscribed.dispose());
        return;
      }
      overlayRef.current = subscribed;
      const refresh = () => setEntries(subscribed.currentEntries());
      stopObserving = subscribed.onChange(refresh);
      refresh();
    }).catch((error) => {
      if (!cancelled) reportTypingFailure('subscribe', error);
    });
```

That is a dev/production split, not a production permission pattern. A
Sessions server ignores client-asserted identity and permission strings and
derives both from the session and server-side roster. Prefer
`useSnapbackActivityPresence` whenever the provider owns that authority; use a
direct overlay only when the dev surface genuinely must carry direct
assertions, and then recreate the idle withdrawal and AppState cleanup shown
by the demo.

The helper removes only the current connection's `selfKey`. The visible
`userHandle` filter is still required to hide the same user typing from
another device when that is the application's desired behavior.

Keep the thunk stable in meaning. A timestamp, counter, or other volatile
field changes the canonical value on every `touch()`, defeats the base
unchanged-value/TTL no-op, and creates a real wire publish for every tick. At
keystroke rates that can reach the collection budget and surface as
`publisher.status === 'publish-error'`. It is not descriptor churn: the
helper's observer descriptor remains stable.

The example memoizes its scope for compatibility with published closure
0.1.15. On affected versions, a per-render managed presence value combined
with per-render query args can create a zero-diagnostic
render/resubscribe/publish loop that saturates the browser main thread, not
merely waste a subscription. Current source content-keys both inputs; see
[Use inline hook inputs without subscription churn](../clients/react.md#use-inline-hook-inputs-without-subscription-churn).

See [the React client](../clients/react.md#publish-and-observe-ephemeral-presence)
for the base state and lifecycle contract.

### How it works underneath

The convenience composes the existing hook in observer mode. That base mode
uses `value: skip`, then exposes imperative `publish` and `delete` actions:

```tsx fragment reason="Anatomy of the convenience; production code also needs its absolute-deadline and generation fences, complete error algebra, and Expo lifecycle gate."
const base = useSnapbackPresence(typingRef, { scope, value: skip });
const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

function touch() {
  void base.publish({ userHandle: selfHandle, name: selfName });
  if (timer.current) clearTimeout(timer.current);
  timer.current = setTimeout(() => void base.delete(), 3_000);
}

function withdraw() {
  if (timer.current) clearTimeout(timer.current);
  timer.current = null;
  return base.delete();
}
```

That sketch explains the composition, but it is not a substitute for the
helper: it omits the canceled-timer generation fence, absolute-deadline
backstop after suspension, typed error channels, scope-reset semantics,
Strict Mode cleanup, and Expo background withdrawal. Use the lower-level
`subscribeEphemeral` overlay below only in headless code or when you
deliberately need to own overlay lifecycle, manual draining, or polling.

> **Coming from Convex/Supabase?** Supabase steers slower-changing state
> (online/typing) toward Presence and high-frequency state (cursors) toward
> Broadcast — two different primitives. Snapback uses one mechanism for
> both — see
> [Typing indicators and cursors: presence vs. broadcast](../recipes/coming-from-convex-and-supabase.md#ephemeral-presence)
> for the TTL-vs-connection-driven expiry distinction that actually matters.

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
  disconnect or expiry. Its key is the opaque id granted to the transport,
  not the app's readable connection label. It is the normal cursor/presence
  choice.
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
deltas, then applies them after the snapshot boundary. Its default
`transport: "stream"` path acquires managed-socket demand and proves current
ping/pong readiness itself before subscribing; a fresh connection label needs
no prior durable query and no manual
`liveStreamManager(connectionId).waitUntilReady()` call. The overlay owns that
demand until `dispose()`. Use `transport: "poll"` only for an explicit
headless/manual-drain consumer.

The returned overlay
provides `currentEntries()`, `onChange`, `publish`, `delete`, `drain`, and
`dispose`, plus `grantedConnectionId`: the exact opaque connection id used by
that successful subscribe. Compare a connection-owned entry's `key` with this
field to identify self. Do not compare it with the readable `connectionId`
argument, which only keys the client's grant/socket registries and may diverge
after collision or mint-only containment.

Each current entry is:

```text fragment reason="Normalized public entry shape assembled by EphemeralOverlay.currentEntries()."
{ key, value, expiresAtMs, receivedAtMs, scopeEpoch, entryVersion }
```

The client prunes by the server-stamped expiry deadline. Server expiry,
explicit delete, and disconnect normally emit remove deltas, but TTL is the
backstop when that remove is lost.

<!-- since: 0.1.22 -->

### Measure first visibility without timing the input action

On the local target, an already-subscribed two-client room has a **1,000 ms
server-accept-to-overlay-apply regression ceiling** under the `normal` network
profile. The budget keeps 1,000 ms of headroom under a 2,000 ms interactive
typing ceiling:

| Segment | Diagnostic allocation |
| --- | ---: |
| publish accept → fan-out dispatch | 100 ms |
| fan-out dispatch → WebSocket flush | 500 ms |
| WebSocket flush → overlay apply | 200 ms |
| scheduler and measurement reserve | 200 ms |

The default client negotiation exposes the cuts needed for a contributor
measurement: the publish acknowledgement's `serverObservedAtMs` is the accept
cut, its additive `serverDispatchedAtMs` is sampled after room fan-out and the
delivery wake, and the ephemeral WebSocket frame's `serverObservedAtMs` is the
flush cut. Observe `onChange('applied')` on the same local machine for the last
cut. These are diagnostic timestamps; ordinary application rendering should
continue to read `currentEntries()`.

The regression in
[`regression-multiplexed-lanes.mjs`](repo:demos/_kit/tests/regression-multiplexed-lanes.mjs)
takes eight first-update samples and records every hop. Its clean-machine
2026-08-15 run measured maxima of 0 ms accept→dispatch, 1 ms dispatch→flush,
1 ms flush→apply, and 1 ms total. The first delivery is already eager; an empty
subscriber outbox does not wait for `dispatchMs` or a poll tick.

For a browser proof, arm the observer before triggering one input state
transition. Do not start the clock, await an entire multi-character
`pressSequentially` action, and only then check the second browser: that number
includes the synthetic typing duration and is not first-visibility latency.

### Do not use two tabs as a two-device presence test

Two tabs in the same browser profile share the client store's leader-owned
live connection. Connection-keyed presence can therefore identify both tabs
with the same granted `selfKey`; filtering each tab's own row may make the
other tab disappear as “self.” This is the expected shared-leader result, not
evidence that multi-device or multi-user presence is broken.

Use isolated browser profiles/contexts, separate browser instances, or real
devices when a proof needs two independent connection identities. Per-tab
connection identity inside one shared profile is not a shipped capability.

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
publish budget. Generated result rows preserve the collection's schema-known
value type; a typed value must not degrade to `unknown` at provider
introspection. Keep imperative overlays in headless/React code and generated
ephemeral links in Contract code—do not mix a second polling or publish lane
into the same surface.

<!-- since: 0.1.10 -->

## Delete one entry as an operator

Use `snapback ephemeral operator-delete` or the
`snapback_ephemeral_operator_delete` MCP tool only for local dev/test repair
after inspecting the exact collection, scope, entry key, `scopeEpoch`, and
`entryVersion`. Supply both coordinates as `--expected-scope-epoch` and
`--expected-entry-generation`; a room can be pruned and recreated with a new
epoch while its entry generation restarts at 1, so generation alone is not a
safe fence. The CLI requires `--ready-file` because the server also verifies
that descriptor's process-bound startup nonce.

```sh fragment reason="Operator repair example uses inspected runtime coordinates and a local readiness descriptor, not a repository fixture."
snapback ephemeral operator-delete \
  --ready-file .snapback/dev.ready.json \
  --collection boardCursors \
  --scope-json '{"boardId":"board-1"}' \
  --entry-key conn_owner \
  --expected-scope-epoch 7 \
  --expected-entry-generation 3 \
  --reason 'remove stuck cursor after inspection'
```

This operation is an explicit administrator bypass: it never evaluates
application authorization or ownership, and its receipt says
`authorizationEvaluated: false`. It remains distinct from an application's
ordinary `delete`, while still using the ordinary removal and subscriber
notification path. The server refuses it on production and on derived
instances; LLP 0158 does not yet recognize derived identity for this purpose.

## Clean up expired entries operationally

The server's background expiry sweep remains automatic. For an explicit,
auditable maintenance pass, preview a bounded cutoff before applying it:

```sh fragment reason="Operator example uses a runtime URL rather than a repository-owned server fixture."
snapback ephemeral cleanup --url http://127.0.0.1:4287 \
  --older-than-ms 60000 --dry-run --max-entries 1000
```

`--older-than-ms` means “expired for at least this long”; it is not the age of
the last publish. Use `--cutoff-timestamp-ms` instead when a wall-clock expiry
deadline is the operator's source of truth. Exactly one cutoff and exactly one
of `--dry-run` or `--apply` are required. `--max-entries` is bounded from 1 to
10,000.

The CLI and the destructive `snapback_ephemeral_cleanup` MCP tool bind each
request to the current process startup nonce. The receipt reports examined,
eligible, would-delete, deleted, and remaining counts by collection and opaque
room digest; it never exposes raw room scope. Apply emits the ordinary
`Expired` removals and subscription notifications. Cleanup is room-linearized,
so repeat an apply when `bounds.truncated` is true or `complete` is false.

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
- **Do not derive self from a readable connection label.** The granted id on
  the overlay is the connection-owned lease key.
- **Do not infer independent presence identities from same-profile tabs.**
  The shared leader connection can make both tabs the same connection-owned
  self; use isolated browser contexts for a two-device proof.

---

<!-- snapback-guide-source: guide/realtime/snapshot-bundles.md -->
---
title: Route snapshot bundles
id: realtime.snapshot-bundles
order: 3
audience: agent-first
capabilities: [realtime.snapshot-bundles]
authorities: [llp/0090-resumable-query-snapshots.rfc.md, llp/0092-rqs-manifest-bundle-and-channel-a-contract.spec.md, llp/0157-composition-algebra-and-completeness.spec.md, llp/0166-local-persistent-store.spec.md, packages/snapback-client/index.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-codegen/index.mjs, packages/snapback-codegen/authoring-validation.test.mjs, demos/public-dashboard/snapback/routes.mjs, demos/public-dashboard/tests/acceptance/headless.mjs, src/bundle.rs, src/local.rs]
examples: [demos/public-dashboard]
status: current
targets: [local, cloudflare]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:6d5cd59fd7ab84930ebac769356d7cfed715e10fc0afcc055f529917d9d25cd7
---

# Route snapshot bundles

A snapshot bundle evaluates every query declared for one route at a single
commit cut. Use it to boot a deep-linked page without issuing unrelated query
requests that can observe different database versions. Eligible entries also
carry resumable-query tokens.

The local target supports read and authenticated register mode. The Cloudflare
target supports read-mode bundles and token resume; register mode remains
deferred there.

For a qualifying public authority-independent single-table live query, the
local target now uses the host-derived experimental `single_table_v1@1` class
and QMK identity. Existing legacy RQS entries do not change identity merely
because this class is active: LLP 0090 grandfathers them until a connected
prove-or-fresh adoption installs the QMK record and switches custody in one
atomic same-domain transaction. Adoption never relabels old bytes in place and
never drops pending outbox intent.

### Mix live and read-only children without losing the live siblings

On the contributor local target, a route containing at least one generated
`LiveQuery` and one generated `Query` receives a separate format-2 generated
group with profile `mixed-route.v2`. Preparing that group still evaluates
every child at one `commitVersion`. Only the `LiveQuery` children acquire
subscriptions; ordinary `Query` children return an explicit
`delivery.kind: "read-only"`, keep snapshot freshness, and never open a later
ordinary subscription.

The generated reference carries the LLP 0157 plan and per-child node hashes.
The server rebuilds them from the served manifests before execution. A query's
plan shape never makes it live: changing only its declaration from `Query` to
`LiveQuery` changes the identity-bound capability and therefore rotates the
node and group plan hashes.

Mixed responses are wire `formatVersion: 2`, repeat
`profile: "mixed-route.v2"` and `planHash`, and report a weakest aggregate of
`read-only`. This is intentionally separate from the existing all-live
format-1 group. Capability `mixed_bundle_boot_v2` is Experimental and local-
only; a target without it refuses mixed-group preparation because an ordinary
`Query` cannot honestly be upgraded into a live fallback.

## Declare the route and its query arguments

Routes are generated artifacts. Bind URL parameters through `routeParam`
instead of accepting an ad hoc query list from the caller:

```js source=demos/public-dashboard/snapback/routes.mjs
  {
    route: '/dashboards/:dashboardId',
    queries: [
      {
        function: 'dashboardMetrics',
        args: { dashboardId: routeParam('dashboardId') },
      },
    ],
  },
```

For anonymous Channel A boot, the query must explicitly declare all three
disclosure facts. None is inferred from the route:

```js source=demos/public-dashboard/snapback/functions.mjs
export const dashboardMetrics = defineLiveQuery({
  table: 'metrics',
  args: { dashboardId: v.string() },
  filter: [eq('dashboardId', arg('dashboardId'))],
  order: [asc('label')],
  index: 'by_dashboard',
  auth: 'public',
  authorityIndependent: true,
  publicInline: true,
});
```

Codegen emits `routes.manifest.json`; provision it beside schema and functions
with `ensureApp({ routes })`. A route may name several queries, but every
argument must be a literal or a declared route-parameter binding.

This example works on contributor-source builds and, since
`@expo/snapback-*@0.1.11`, on published packages carrying the packaged-store
qualification receipt — see [offline retention](../sync/offline-and-retention.md).

<!-- since: 0.1.16 -->

## Bind route parameters inside structured query arguments

A `routeParam()` may sit at any object-reachable leaf of a query argument.
Keep the surrounding context literal: objects may recursively contain `null`,
literal-union values, arrays of literal values, and finite-number vector
literals. Public Dashboard binds the URL id inside `context` while carrying a
nullable cursor, sort direction, and tags beside it:

```js source=demos/public-dashboard/snapback/routes.mjs
  {
    route: '/context-dashboards/:dashboardId',
    queries: [
      {
        function: 'dashboardMetricsByContext',
        args: {
          context: {
            dashboardId: routeParam('dashboardId'),
            cursor: null,
            sort: 'asc',
            tags: ['current', 'critical'],
          },
        },
      },
    ],
  },
```

The query validator remains the authority for the whole structure. Codegen
checks every literal member against it and confirms that the nested binding
lands on a scalar string-, number-, or boolean-compatible leaf. At runtime the
bound value preserves that scalar type; it is not flattened or merged by a
handler.

Some shapes deliberately refuse generation:

- A bare `routeParam()` as the whole `args` root has no declared argument key.
- A reference inside an array, or a reference object mixed with sibling keys,
  is ambiguous and refuses. Arrays are literal context only.
- A non-string `$param`, defaults, transforms, optional route parameters, and
  tuple-style argument invention are outside this surface.
- Register and mixed-route groups require every reference at every depth to
  target a string-typed leaf. A number- or boolean-typed binding remains valid
  for read-mode argument lowering but makes that group ineligible.

Targets with an older routes-manifest validator fail closed on the structured
shape. Do not flatten the object or add a server-side merge to work around
version skew; align the codegen and runtime closure instead.

## Fetch one consistent page snapshot

Read mode is socketless and does not create live demand:

```js source=demos/public-dashboard/tests/acceptance/headless.mjs
    bundle = await app.client.fetchBundle({
      route: '/dashboards/:dashboardId',
      params: { dashboardId: 'ops' },
      mode: 'read',
    });
    assertEqual(bundle.entries.length, 1, 'bundle entry count');
    assertEqual(bundle.entries[0].rows.map(({ label }) => label), ['latency_ms', 'uptime_pct'], 'ops rows');
    assert(typeof bundle.entries[0].resume?.token === 'string', 'resume token missing');
```

The response has one shared `commitVersion` and one entry per declared query.
Each entry contains rows and either a verified resume object or `null`,
according to that query's resumable-query eligibility. An undeclared route is
refused with `SNAPBACK_BUNDLE_ROUTE_UNKNOWN`.

## Arm live demand at the same cut

Authenticated local clients may use `mode: 'register'`. The response then
includes a connection grant and live registration for each entry at the same
commit cut. Pass each returned registration to `liveQuery` as
`registeredSubscription`; the client adopts the bundle-owned subscription
without taking a duplicate snapshot.

Anonymous register mode is refused. Retry it in read mode only when a
socketless public snapshot is acceptable. Register mode on Cloudflare is not
currently claimed.

## Anti-patterns

- Do not send a caller-chosen list of function names to `/app/bundle`.
- Do not mark an authenticated or authority-dependent query `publicInline`.
- Do not compare entry versions as though independently fetched queries share
  a commit; use the bundle's `commitVersion`.
- Do not open a second live subscription after register mode; adopt the
  returned registration.
- Do not treat a resume token as application data or decode it.
