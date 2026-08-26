---
title: Ephemeral realtime state
id: realtime.ephemeral-state
order: 2
audience: agent-first
capabilities: [realtime.ephemeral]
authorities: [llp/0013-ephemeral-realtime-state.rfc.md, llp/0056-scoped-roles-and-memberships.rfc.md, llp/0107-react-presence-and-optimistic-lifecycle.spec.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0247-ordinary-client-normalization-and-recovery.rfc.md, llp/0257-activity-scoped-presence-convenience.rfc.md, llp/0310.000-successor-identity-and-paved-loop-repair.rfc.md, llp/0184-agent-accessible-control-plane.rfc.md, crates/snapback-server/src/admin.rs, crates/snapback-sync/src/ephemeral.rs, crates/snapback-server/src/server.rs, crates/snapback-cli/src/cli.rs, packages/snapback-cli/mcp-control.mjs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-client/index.mjs, packages/snapback-contract/index.mjs, packages/snapback-react/index.mjs, packages/snapback-react/index.d.mts, packages/snapback-react/activity-presence.test.mjs, packages/snapback-react/activity-presence-react-characterization.test.mjs, packages/snapback-expo/activity-presence.mjs, packages/snapback-expo/activity-presence.test.mjs, demos/_kit/tests/regression-multiplexed-lanes.mjs, demos/messaging-snapback/snapback/schema.mjs, demos/messaging-snapback/tests/acceptance/headless.mjs]
examples: [demos/cursors-web, demos/todo-v2/snapback/schema.mjs, demos/messaging-snapback]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:c5511fceb534f1c9facbe5d09103e913d37281afe0b2800a4be5ab674c479a4c
---

# Ephemeral realtime state

> **Local target only.** This page describes the process-local dev/test
> target. A hosted target needs sticky room routing or a shared room adapter;
> Snapback does not currently claim that hosted capability.

Ephemeral collections are typed, authorized, TTL-bounded latest-state maps for
presence, cursors, selections, typing, drag state, and live viewport state.
They are deliberately lossy: if a value must survive restart, support offline
reads, or enter history/audit, put it in a durable table instead.

Start with the [typing-indicators recipe](../recipes/typing-indicators.md) for
a membership-scoped conversation or the
[presence-cursors recipe](../recipes/presence-cursors.md) for a public room.
Use this page when choosing collection options or handling recovery.

<!-- since: 0.1.23 -->

## Stop publishing when activity goes idle

First decide whether the value is continuously bound or activity-driven. The
[activity presence recipe](../recipes/activity-presence.md) is the bounded API
and lifecycle guide, including the Supabase `track()` analogue, bound `skip`
withdrawal, `idleMs` product deadline, heartbeat ownership, and delete path.

For URL-first web under a bare `SnapbackProvider`, import
`useSnapbackActivityPresence` from `@expo/snapback-react`; that is the paved
choice. Use the `@expo/snapback-expo` facade only in a
`SnapbackExpoProvider` tree; there it gates the first publication until
AppState observation is established and withdraws on backgrounding. The React
hook under a bare `SnapbackProvider` has no AppState-driven background
withdrawal, so backgrounded typing intent expires by the presence deadline
rather than being withdrawn immediately. Do not invent a third hook.
The shipped facade currently also mounts under a bare `SnapbackProvider` and,
through LLP 0257's AppState fallback, withdraws immediately on backgrounding.
That behavior conflicts with the paved provider boundary and is pending the
owner decision in [the still-open LLP 0257 conflict](repo:issues/20260825-ruling-3-vs-llp-0257-background-withdrawal.md);
use it only if immediate background withdrawal on web today outweighs relying
on the currently non-paved boundary. Do not treat the provider boundary as
settled while that conflict remains open.

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
| `publish` / `subscribe` | Both require explicit policies: `allow.all()`, `allow.roomPermission(prefix)`, or declaration-bound `allow.members(declarationId, { roles? })`. Omitted roles mean all non-pending declaration roles. |
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
durable membership also participates in the authorization-invalidation barrier.
Custom-key authorization beyond connection ownership is not shipped.

For conversation, channel, or document rooms, the normal protected posture is
`allow.members(declarationId)` on both operations. The messaging demo binds its
typing room to the canonical `conversationMemberships` declaration:

```js source=demos/messaging-snapback/snapback/schema.mjs
      // @ref LLP 0013#lowering-and-one-validator-convergence — both operations
      // bind the same active-role subset; a member→moderator downgrade revokes
      // the whole room edge through the ordinary authorization barrier.
      publish: allow.members('conversationMemberships', { roles: ['owner', 'member'] }),
      subscribe: allow.members('conversationMemberships', { roles: ['owner', 'member'] }),
```

The stable declaration id lowers to a generated `m_<declarationId>` room
permission and a `permissionBacking` projection over the declaration's
canonical table. The session principal must have a current membership row whose
resource id equals the room scope and whose role is in the emitted
`allowedRoles`. Omitted `roles` lowers the declaration's complete non-pending
role vocabulary; an explicit non-empty active-role subset narrows it. That ships
current-membership reads, removal and downgrade invalidation, and write
scoping—only an admitted active role may subscribe or publish. Pending roles,
including invited rows, grant nothing. Both policies must name the same
declaration and have the same effective role set;
mixing `allow.members` with `allow.all()` is refused because room authority is
currently derived from the subscribe policy. V1 also refuses app-scoped or
multi-field scopes, a scope validator other than `v.id()` of the declaration's
resource table, unknown declarations, role names outside the declaration's
active vocabulary, and different publish/subscribe subsets.

Sessions mode enforces the emitted projection: identity comes from the session,
and client permission strings are ignored. Direct/dev mode instead admits room
subscribe/publish solely on the exact asserted
`SnapbackClient.roomPermission('m_<declarationId>', scope)` token; the asserted
`userId` supplies handler identity (entry ownership, bootstrap writes), not
room admission. The messaging
demo's `useTyping` wrapper shows that dev-only bridge; it is not a production
authorization proof. Run the recipe's Sessions acceptance shape before claiming
membership privacy.

Removal and allowed-to-disallowed role downgrade are terminal through every
shipped client surface. The revoked subscriber receives one `PermissionDenied`
frame and then no later frames, while survivors receive `AuthRevoked` removal.
The base overlay applies the error once and latches its trusted
`SNAPBACK_AUTH_PERMISSION_DENIED` diagnostic; a later frame or socket-loss
event cannot reopen the overlay or replace that diagnostic with transport
noise. `startEphemeralRoom` projects an empty `status: "error"` room with
`reason: "auth_revoked"`, and React presence and activity-presence consumers
pass through that status and diagnostic rather than presenting an empty ready
room.

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
