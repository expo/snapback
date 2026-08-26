<!-- Generated recipes section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/recipes/presence-cursors.md -->
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

---

<!-- snapback-guide-source: guide/recipes/hidden-hands.md -->
---
title: "Recipe: hidden hands"
id: recipes.hidden-hands
order: 2
audience: agent-first
capabilities: [auth.scoped-queries, auth.invalidation-barrier, auth.authorized-leases]
authorities: [llp/0053-authorization-invalidation.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, demos/card-game/snapback/functions.mjs, demos/card-game/tests/acceptance/authority-scope.mjs]
examples: [demos/card-game]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-03
reviewed-authorities-digest: sha256:43d4e382c66e7bf80e560ee5956322fc91b488556aee9e1ecfa503c180d0ce86
---

# Recipe: hidden hands

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Per-principal secrecy over shared data: a card game where every player
queries the same `myHand` function and sees only their own cards — live,
across logout, and honestly offline. The working reference is
`demos/card-game`, and every claim here is asserted by its acceptance
suite (which runs in the local proof).

Prerequisite: sessions-mode auth —
[sessions and principals](../auth/sessions-and-principals.md). For the complete
grant/invalidation/lease contract behind this recipe, use
[protecting data](../auth/protecting-data.md).

## One query, disjoint worlds

Each player signs in (email code → session) and calls the same query with
no owner argument. The query's explicit
`eq('ownerId', authUserId())` predicate compares rows with the
server-derived session principal:

```js source=demos/card-game/snapback/functions.mjs
  filter: [
    eq('ownerId', authUserId()),
    eq('gameId', arg('gameId')),
  ],
```

For JS live queries, `authScopeField` can additionally declare the principal
field to the live matcher; it never substitutes for the ownership predicate.

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  const [adaResult, graceResult] = await Promise.all([
    ada.client.query('myHand', { args: { gameId } }),
    grace.client.query('myHand', { args: { gameId } }),
  ]);
```

The suite then asserts the two result sets are disjoint — no card leaks
across principals, finite or live.

## Logout blanks yours, only yours

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  await ada.client.authLogout();
  assert.deepEqual(adaSurface.boundary.current('hand'), []);
  assert.deepEqual(
    graceSurface.boundary.current('hand').map(({ card }) => card),
    ['king-clubs', 'ten-diamonds'],
  );
```

The invalidation barrier is per-principal and immediate on live
boundaries (LLP 0053).

## Offline retention ends at the lease deadline, exactly

With a client store, an authorized retained query survives a cold process
start while the server is down — readable, marked `stale` — until the
signed lease's client deadline, after which store validation deletes the
hidden rows before any fallback could serve them:

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  const offlineSurface = await trackSurface(coldGraceOptions);
  assert.equal(offlineSurface.retained(), true);
  assert.equal(offlineSurface.connection(), 'stale');
```

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  const expiredState = await coldGraceStore.snapshot();
  assert.equal(expiredState.retained[retainedQueryKey], undefined);
  assert.equal(expiredState.queryAuthorization[retainedQueryKey]?.lease, null);
```

## Anti-patterns

- **Do not filter secrets client-side.** Sending the whole game state and
  hiding other hands in the UI is not secrecy; the scoping must be the
  server's.
- **Do not cache authorized rows outside the client store.** The store is
  what enforces the lease deadline; a side cache outlives authorization.
- **Do not pass the player as a query argument.** The server derives the
  principal; an owner argument is spoofable and is rejected in sessions
  mode.

---

<!-- snapback-guide-source: guide/recipes/typing-indicators.md -->
---
title: "Recipe: membership-scoped typing indicators"
id: recipes.typing-indicators
order: 2
audience: agent-first
capabilities: [realtime.ephemeral]
authorities: [llp/0013-ephemeral-realtime-state.rfc.md, llp/0056-scoped-roles-and-memberships.rfc.md, llp/0257-activity-scoped-presence-convenience.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-client/index.mjs, packages/snapback-react/activity-presence.test.mjs, packages/snapback-expo/activity-presence.test.mjs, demos/messaging-snapback/snapback/schema.mjs, demos/messaging-snapback/src/lib/useTyping.ts, demos/messaging-snapback/tests/acceptance/headless.mjs]
examples: [demos/messaging-snapback]
status: current
targets: [local]
maturity: shipped
since: 0.1.24
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:f3312eca75febfc7c4816fc221b7a43ff6fef7bd44af221fb53303200824f7ba
---

# Recipe: membership-scoped typing indicators

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A typing indicator should disappear after inactivity and should be visible and
writable only inside the conversation where the user is a current member. Use
one canonical `membership()` declaration as durable authority and bind both
ephemeral operations with `allow.members()`. The complete working reference is
`demos/messaging-snapback`; the
[ephemeral-state reference](../realtime/ephemeral-state.md) owns every lower-level
collection and recovery option.

## 1. Declare membership and the typing room together

The messaging demo keeps its membership-scoped product projection separate
from this restricted canonical authority table. One row means current
membership; removal deletes the row rather than preserving a historical
incarnation:

```js source=demos/messaging-snapback/snapback/schema.mjs
export const conversationMemberships = defineTable({
  conversationId: v.id('conversations'),
  userHandle: v.principal(),
  role: v.string(),
  // The generated bootstrap owns the creator seat and therefore cannot take
  // app-authored incidental fields for it; initial roster seats still stamp it.
  joinedAt: v.optional(v.integer()),
})
  .visibility({ kind: 'owner', field: 'userHandle' })
  .index('by_conversation', ['conversationId'])
  .index('by_user', ['userHandle'])
  .index('by_conversation_user', ['conversationId', 'userHandle'], { unique: true })
  // @ref LLP 0056#declaring-a-membership-table — typing authority is one
  // canonical current principal/resource/role row, never a historical flag.
  .membership({
    id: 'conversationMemberships',
    principal: 'userHandle',
    resource: 'conversationId',
    role: 'role',
    roles: ['owner', 'moderator', 'member'],
    bootstrapRole: 'owner',
    lastHolder: { protect: 'owner' },
    provenance: 'full',
    transitions: [
      { op: 'insert', by: ['owner'], target: 'other', to: ['member'], fields: ['joinedAt'] },
      { op: 'setRole', by: ['owner'], target: 'other', from: ['member'], to: ['moderator'] },
      { op: 'setRole', by: ['owner'], target: 'other', from: ['moderator'], to: ['member'] },
      { op: 'remove', by: ['owner'], target: 'other', from: ['moderator', 'member'] },
      { op: 'remove', by: ['self'], target: 'self', from: ['moderator', 'member'] },
    ],
  })
  // Today's profile writers are not projection-aware. They remain directly
  // reachable, so the application boundary is explicitly partial: guarded
  // consumers refuse on drift and the owner-only reconciliation mutation
  // repairs interrupted or bypassed writes.
  // @ref LLP 0240#authority-facts-versus-product-facts
  // — option 1 remains the sanctioned interim, not the final generated design.
  .authorityProfile({
    name: 'conversationMemberships',
    hierarchy: {
      owner: ['moderator', 'member'],
      moderator: ['member'],
      member: [],
    },
    roster: { visible: ['userHandle', 'role'] },
  });
```

The room scope uses `v.id('conversations')`, the same nominal resource table as
the declaration. Publish and subscribe name the same stable declaration id:

```js source=demos/messaging-snapback/snapback/schema.mjs
    typing: ephemeral.collection({
      scope: { conversationId: v.id('conversations') },
      routing: ['conversationId'],
      key: 'connection',
      ttlMs: 6_000,
      maxTtlMs: 15_000,
      maxValueBytes: 256,
      publishRate: { sustainedHz: 5, burst: 10 },
      delivery: { mode: 'latest', dispatchMs: 100 },
      value: v.object({
        userHandle: v.string(),
        name: v.string(),
      }),
      // @ref LLP 0013#lowering-and-one-validator-convergence — both operations
      // bind the same active-role subset; a member→moderator downgrade revokes
      // the whole room edge through the ordinary authorization barrier.
      publish: allow.members('conversationMemberships', { roles: ['owner', 'member'] }),
      subscribe: allow.members('conversationMemberships', { roles: ['owner', 'member'] }),
    }),
```

Codegen emits the generated `m_conversationMemberships` permission prefix and
the durable `permissionBacking` projection. V1 intentionally accepts only one
room scope field, and that field must be exactly `v.id()` of the membership
resource table. Omitted `roles` lowers every non-pending declaration role;
explicit roles must be a non-empty subset of the active vocabulary and must be
the same for publish and subscribe. Pending roles never grant room authority.
Codegen still refuses app-scoped memberships, multi-field scope, unknown
declarations, wrong-table ids, and any mix of `allow.members()` with
`allow.all()`.

## 2. Publish on activity and withdraw on idle

For the shorter decision rule between continuous value binding,
`useSnapbackActivityPresence`, and explicit publish/delete ownership, read the
[activity presence recipe](./activity-presence.md).

At the screen boundary, the demo's hook gives the component peers plus two
intent-first actions:

```tsx source=demos/messaging-snapback/src/app/conversation/[id].tsx
  const { typers, publishTyping, clearTyping } = useTyping(id, self.handle, self.name);
```

Each non-empty edit is an activity tick; clearing or sending withdraws without
waiting for TTL:

```tsx source=demos/messaging-snapback/src/app/conversation/[id].tsx
  function onChangeBody(text: string) {
    setBody(text);
    if (text.trim().length > 0) {
      publishTyping();
    } else {
      void clearTyping();
    }
  }
```

LLP 0257's normal provider-owned implementation is
`useSnapbackActivityPresence`: pass the generated typing reference, the
conversation scope, a value thunk, and `idleMs: 3_000`; use its `peers`,
`touch()`, and `withdraw()` results. It owns the absolute idle deadline,
Strict-Mode-safe teardown, scope reset, and Expo background withdrawal while
the provider owns lease renewal.

The messaging demo has a deliberate direct/dev exception. Its provider cannot
carry the asserted persona and generated room permission, so `useTyping`
constructs the exact dev permission:

```tsx source=demos/messaging-snapback/src/lib/useTyping.ts
  const scope = useMemo(() => ({ conversationId }), [conversationId]);
  const permissions = useMemo(
    () => [(SnapbackClient as unknown as {
      roomPermission(prefix: string, permissionScope: Record<string, unknown>): string;
    }).roomPermission('m_conversationMemberships', scope)],
    [scope],
  );
```

It passes both assertions at subscription; overlay publish/delete inherit them:

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

Do not copy that assertion bridge into production auth. Under Sessions,
Snapback ignores caller-asserted identity and permission strings and evaluates
the generated projection against the authenticated principal.

## 3. Prove the three negative observers in Sessions mode

Run privacy acceptance against a Sessions copy of the backend. Anonymous and
authenticated non-member clients must fail both subscribe and publish:

```js source=demos/messaging-snapback/tests/acceptance/headless.mjs
  await suite.check('typing membership (a): anonymous subscribe and publish are denied', async () => {
    const scope = { conversationId: dmId };
    const subscribeError = await captureRejection(app.clients.anonymous.subscribeEphemeral(typingRef, {
      connectionId: 'typing-anonymous-subscribe',
      scope,
      transport: 'poll',
    }), 'anonymous typing subscribe');
    assertPermissionDenied(subscribeError, 'anonymous typing subscribe');

    const publishError = await captureRejection(app.clients.anonymous.publishEphemeral(typingRef, {
      connectionId: 'typing-anonymous-publish',
      scope,
      value: { userHandle: 'anonymous', name: 'Anonymous' },
      ttlMs: typingRef.maxTtlMs,
    }), 'anonymous typing publish');
    assertPermissionDenied(publishError, 'anonymous typing publish');
    return {
      subscribe: subscribeError.diagnostic.code,
      publish: publishError.diagnostic.code,
    };
  });

  await suite.check('typing membership (b): an authenticated non-member is denied', async () => {
    const scope = { conversationId: dmId };
    const subscribeError = await captureRejection(app.clients.outsider.subscribeEphemeral(typingRef, {
      connectionId: 'typing-outsider-subscribe',
      scope,
      transport: 'poll',
    }), 'non-member typing subscribe');
    assertPermissionDenied(subscribeError, 'non-member typing subscribe');

    const publishError = await captureRejection(app.clients.outsider.publishEphemeral(typingRef, {
      connectionId: 'typing-outsider-publish',
      scope,
      value: { userHandle: 'outsider', name: 'Outsider' },
      ttlMs: typingRef.maxTtlMs,
    }), 'non-member typing publish');
    assertPermissionDenied(publishError, 'non-member typing publish');
    return {
      subscribe: subscribeError.diagnostic.code,
      publish: publishError.diagnostic.code,
    };
  });
```

For a role-narrowed room, downgrade a current member outside the admitted
subset while subscriptions are live. The durable membership row remains, but
the downgraded subscriber receives one terminal denial, cannot publish, and
receives no later frames; a surviving allowed role receives the `AuthRevoked`
removal:

```js source=demos/messaging-snapback/tests/acceptance/headless.mjs
  await suite.check('typing membership (e): allowed-to-disallowed role downgrade revokes B and removes B from A', async () => {
    await app.clients.owner.mutate(api.conversationMemberships.changeRole, {
      args: {
        scopeId: typingConversationId,
        principal: recipientAPrincipal,
        role: 'moderator',
      },
    });

    await eventually(async () => {
      await Promise.all([memberAOverlay.drain(), memberBOverlay.drain()]);
      const denied = ephemeralMessage(memberBFrames.at(-1));
      assert(memberBTerminalMessage, 'downgraded member receives the PermissionDenied terminal frame');
      assertEqual(
        denied?.Error?.error?.code,
        'PermissionDenied',
        'PermissionDenied is the last frame received at revocation time',
      );
      assertEqual(
        memberBFrames.length,
        memberBTerminalFrameCount,
        'no frame follows the first PermissionDenied at the revocation checkpoint',
      );
      assertEqual(
        denied.Error.room_authority_generation,
        2,
        'downgraded member terminal frame carries the successor authority generation',
      );
      assertEqual(
        memberBOverlayTerminalNotifications,
        1,
        'removed member overlay notifies its terminal transition once',
      );
      assertEqual(
        memberBOverlayTerminalDiagnostic?.code,
        'SNAPBACK_AUTH_PERMISSION_DENIED',
        'removed member overlay surfaces the trusted permission diagnostic',
      );
      const memberBRoomState = memberBRoom.getSnapshot();
      assertEqual(memberBRoomState.status, 'error', 'removed member room handle is terminally errored');
      assertEqual(
        memberBRoomState.diagnostic?.code,
        'SNAPBACK_AUTH_PERMISSION_DENIED',
        'removed member room handle carries the trusted permission diagnostic',
      );
      assertEqual(memberBRoomState.reason, 'auth_revoked', 'room handle identifies AuthRevoked');
      assertEqual(memberBRoomState.entries.length, 0, 'terminal room handle exposes no denied entries');
      assertEqual(memberBRoomState.selfKey, null, 'terminal room handle exposes no denied self identity');
      const revoked = memberAFrames
        .map(ephemeralMessage)
        .find((message) => (
          message?.Remove?.key === memberBEntryKey
          && message.Remove.reason === 'AuthRevoked'
        ));
      assert(revoked, 'surviving member receives the AuthRevoked removal frame');
      assert(
        !memberAOverlay.currentEntries().some((entry) => entry.key === memberBEntryKey),
        'member A no longer sees downgraded member B typing',
      );
    }, 'membership role downgrade revokes B and deletes B typing');

    const publishError = await captureRejection(memberBOverlay.publish(
      { userHandle: recipientAPrincipal, name: 'Downgraded member B' },
      { ttlMs: typingRef.maxTtlMs },
    ), 'downgraded member typing publish');
    assertPermissionDenied(publishError, 'downgraded member typing publish');

    assertEqual(
      memberBFrames.length,
      memberBTerminalFrameCount,
      'downgraded member receives zero frames between terminal denial and survivor probe',
    );
    await memberAOverlay.publish(
      { userHandle: ownerPrincipal, name: 'Member A after downgrade' },
      { ttlMs: typingRef.maxTtlMs },
    );
    await memberAOverlay.drain();
    await memberBOverlay.drain();
    assertEqual(
      memberBFrames.length,
      memberBTerminalFrameCount,
      'downgraded member subscription stays silent after its terminal frame',
    );
    assertEqual(
      memberBOverlayTerminalNotifications,
      1,
      'later application cannot renotify or reopen the terminal overlay',
    );
    assertEqual(memberBRoom.getSnapshot().status, 'error', 'room handle remains terminal after survivor traffic');
    const removal = memberAFrames
      .map(ephemeralMessage)
      .find((message) => (
        message?.Remove?.key === memberBEntryKey
        && message.Remove.reason === 'AuthRevoked'
      ));
    return {
      downgradedSubscriberFrameCode: memberBTerminalMessage.Error.error.code,
      successorAuthorityGeneration: memberBTerminalMessage.Error.room_authority_generation,
      survivorRemovalReason: removal.Remove.reason,
      disallowedRolePublish: publishError.diagnostic.code,
      overlayDiagnostic: memberBOverlayTerminalDiagnostic.code,
      roomHandleStatus: memberBRoom.getSnapshot().status,
      postTerminalFrames: memberBFrames.length - memberBTerminalFrameCount,
    };
  });
```

Keep the two positive witnesses in the same battery: member A sees member B's
typing entry before downgrade, and B can publish through a fresh subscription
after an upgrade back into the allowed subset. Together these are the five
capability scenarios, not merely three static denials.

The same scenario also pins the base client surface: the overlay notifies
exactly once and the room handle becomes terminal `error` with
`SNAPBACK_AUTH_PERMISSION_DENIED`. Separately, LLP 0257's
[activity-presence unit test](repo:packages/snapback-react/activity-presence.test.mjs)
pins the React activity hook passing that base status and diagnostic through
instead of presenting an empty ready room.

## Sessions and direct/dev prove different things

- **Sessions is the privacy proof.** The authenticated principal and emitted
  durable role-aware projection decide membership. Removal and
  allowed-to-disallowed downgrade invalidate the live room edge and later
  publication.
- **Direct/dev is an assertion harness.** The caller supplies `userId` and
  `roomPermission('m_<declarationId>', scope)`. It proves room behavior, not
  that the server derived the authority from membership.
- **Role narrowing is one room policy.** Publish and subscribe must choose the
  same effective active-role subset. Pending roles are always excluded; a
  downgrade outside the subset is a kick.

## Anti-patterns

- **Do not use `allow.all()` for conversation typing.** Anyone who learns the
  conversation id could observe or inject activity.
- **Do not preserve historical membership rows as the backing declaration.**
  V1 row-existence authority would retain former-member access.
- **Do not treat a direct/dev permission token as Sessions evidence.** Run the
  negative observer battery against an authenticated Sessions server.
- **Do not hand-roll idle timers when the provider owns authority.** Use
  `useSnapbackActivityPresence`; keep a custom `useTyping` only for a real
  credential-carrying seam such as the demo's direct/dev exception.

---

<!-- snapback-guide-source: guide/recipes/optimistic-toggle.md -->
---
title: "Recipe: optimistic toggle"
id: recipes.optimistic-toggle
order: 3
audience: agent-first
capabilities: [clients.react]
authorities: [llp/0090-resumable-query-snapshots.rfc.md, llp/0107-react-presence-and-optimistic-lifecycle.spec.md, llp/0114-first-class-react-and-query-groups.spec.md, packages/snapback-react/index.mjs, demos/warble/snapback/functions.mjs, demos/warble/app/src/post-card.tsx, demos/warble/tests/acceptance/offline-local-first.mjs]
examples: [demos/warble, packages/snapback-react/optimistic.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-07
reviewed-authorities-digest: sha256:8ffcd721327b6729764c25465d6d319fb5fa7b07e57369539fd1b23287147fd5
---

# Recipe: optimistic toggle

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A like/favorite button with a count has two honest query layouts. When one
viewer-aware query returns both `liked` and `likeCount`, the heart and count
flip instantly and the authoritative live query settles both without a
flicker or double increment. When cold retention requires a separate public
viewer-fact query, both facts remain query-owned, but the current optimistic
path can move only the count; the heart settles from that second query's live
delivery. The joined layout is the paved implementation of
`useSnapbackMutation`'s two-field optimistic projection
([the React client](../clients/react.md#run-a-mutation)) for the
toggle-plus-counter shape, and its behavioral claims are asserted by
`packages/snapback-react/optimistic.test.mjs` (run by the package's CI test
suite).

The failure this recipe prevents is real and easy to reach: keep the heart in
component state, add a local `+1` to the count, and the live query
independently delivers the authoritative increment — the UI briefly shows a
two-count jump, and a rebase can visibly flip the heart back. Every fact
below exists to make that impossible.

## Model the viewer's fact in query data

The toggle state is per-viewer data, not UI state. It must come from canonical
query data in one of the two layouts below.

### Joined layout: both fields on the rendered row

The query that renders the button returns both fields for the current viewer
— a server-side join against the viewer's like row plus the denormalized count:

```text
timeline(viewer) -> [{ id, body, ..., liked: boolean, likeCount: number }]
```

If `liked` is absent from all query data, there is nothing authoritative to
reconcile against, and component state is the only place left to put it —
which is exactly the anti-pattern. The joined projection sections below assume
this layout.

### Cold-retained public layout: split the viewer fact

`rqsEligible` v1 is a closed single-table plan, so a retainable posts timeline
cannot join in the viewer's like row. It can coexist with a second public
query keyed by an explicit viewer argument: keep `{ ..., likeCount }` in the
posts query, query like rows with `{ handle: viewerHandle }`, and derive the
heart from the second query:

```tsx fragment reason="generated application query types and component props vary by app"
const likeSet = new Set(myLikes.data?.map((like) => like.postId));
const liked = likeSet.has(post._id);
```

The exact retention declaration and its security boundary are in
[retain public viewer facts by argument, not authority](../sync/offline-and-retention.md#retain-public-viewer-facts-by-argument-not-authority).
An argument is caller-controlled and does not enforce privacy, so this layout
is only for public facts. Private viewer data must use server-derived authority
and the Contract arm's `retainable: true`, `AuthorizedLease` path; never
replace `authUserId()` with an argument merely to make a query retainable.

An optimistic layer is validated against the generated result contract of the
one query store it targets. If `liked` is not a field on the posts result,
projecting `{ liked, likeCount }` into a post row is refused before mutation
dispatch with `SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED`. Project only the
field that belongs to that row:

```tsx fragment reason="generated application query types and component props vary by app"
optimistic: {
  query: api.timeline,
  args: {},
  ...projectRecordFields(post._id, { likeCount }),
}
```

The count then moves optimistically, while the heart changes when the
authoritative `myLikes` delivery adds or removes the like row. The boolean is
still derived from canonical query data, not component state. A symmetric
instant heart for the like case would require appending a missing row to
`myLikes`; optimistic create has no paved path in v1, so this split layout does
not promise the joined layout's zero-latency heart. Warble implements this
count-only projection; its acceptance suite proves retained rendering plus
exactly-once like settlement.

## Project both fields atomically when they share a row

For the joined layout, declare one optimistic projection beside the mutation
hook. Two rules carry the recipe, and both are visible in the CI-exercised
fixture:

```js source=packages/snapback-react/optimistic.test.mjs
// Capture the intended outcome at admission. The projection is replayed over
// every newer authoritative base during rebase, so it must set the captured
// outcome; toggling or incrementing the incoming row would re-run the user
// action on replay and visibly invert or double-apply it.
const intended = { liked: true, likeCount: 11 };
const optimisticLike = {
  query: timeline,
  args: {},
  update: (posts) => posts.map((post) => post.id === 'p1' ? { ...post, ...intended } : post),
  isAuthoritative: (posts, receipt) => posts.some((post) => post.id === 'p1'
    && post.liked === receipt.liked && post.likeCount === receipt.likeCount),
};
```

- **`update` is a replayable projection, not an action.** The layer is
  recomputed over every newer authoritative base (overlapping attempts,
  interleaved deliveries, rejection rollback). Compute the intended
  `{ liked, likeCount }` once, outside the reducer, and have the reducer
  *set* that outcome. A reducer that toggles (`liked: !row.liked`) or
  increments (`likeCount: row.likeCount + 1`) re-runs the user action on
  every replay and inverts or double-applies it.
- **Change both fields in one projection.** One layer over one store flips
  the heart and moves the count in the same frame. Splitting them (heart in
  component state, count optimistic — or either combined with a local delta)
  reintroduces the double increment.

In application code the same shape reads:

```tsx fragment reason="mutation and query fields come from the generated application API"
const liked = !post.liked;
const likeCount = Math.max(0, post.likeCount + (post.liked ? -1 : 1));
const toggleLike = useSnapbackMutation(api.toggleLike, {
  optimistic: {
    query: api.timeline,
    args: { viewerHandle: viewer },
    update: (posts) => posts.map((item) =>
      item._id === post._id ? { ...item, liked, likeCount } : item),
    isAuthoritative: (posts, receipt) => posts.some((item) =>
      item._id === post._id
        && item.liked === receipt.liked
        && item.likeCount === receipt.likeCount),
  },
});
```

Return the complete receipt — `{ liked, likeCount }` — from the mutation, and
match **both** fields in `isAuthoritative`. A mutation that writes the like
row and the denormalized count separately can produce a live delivery
containing only half the outcome (`liked: true` with the old count). A
matcher that checks only `liked` retires the layer on that partial delivery
and the count visibly dips. Matching the full receipt keeps the layer
installed across partial deliveries — the projection simply rebases over
them:

```js source=packages/snapback-react/optimistic.test.mjs
likeClient.emit('timeline', [{ id: 'p1', liked: true, likeCount: 10 }]);
assert.equal(view().timeline.data[0].liked, true, 'replay does not invert the heart');
assert.equal(view().timeline.data[0].likeCount, 11, 'partial delivery keeps the layer installed');
```

## Or declare it: `projectRecordFields`

Both rules are mechanical, so `@expo/snapback-react` derives them from one
declaration. `projectRecordFields(recordId, fields)` returns a frozen
`{ update, isAuthoritative }` pair — the idempotent capture-and-set
projection and the complete-receipt matcher — to spread into the same
optimistic options:

```js source=packages/snapback-react/optimistic.test.mjs
// One declaration derives the idempotent capture-and-set update and the
// complete-receipt matcher; spread it into the ordinary optimistic options.
const optimisticHelperLike = {
  query: timeline,
  args: {},
  ...projectRecordFields('p2', { liked: true, likeCount: 4 }, { idField: 'id' }),
};
```

The fixture's rows key on `id`; generated application rows carry the default
`_id`, so application code omits the `idField` option. Intended values must
be primitives (`boolean | number | string | null`) — the helper deliberately
expresses only the capture-and-set shape, so it cannot encode the replay
hazard. Prefer it over a hand-written reducer whenever the projection is
"set these fields on this row". The helper's layers also carry a strand
backstop hand-written matchers do not get (LLP 0107, 2026-08-07 ruling): once
confirmed, the layer retires when its identified row is absent from an
authoritative delivery — a field projection on a row that is not present has
nothing to project — so a row filtered out or deleted server-side cannot
strand the layer and its subscription pin until store teardown. In the split cold-retained layout, pass only
`{ likeCount }`; injecting `liked` into the posts row violates that query's
generated result contract.

Hand-written reducers get a development safety net: at admission the
provider replays the just-validated projection through the reducer a second
time, and a reducer that returns a different result over its own output — a
toggle or an increment — logs one
`SNAPBACK_REACT_OPTIMISTIC_REPLAY_DIVERGENT` console warning per
(mutation, query) site, pointing back at this recipe. The advisory is
observational only: it never changes admission, and an explicit production
`NODE_ENV` skips it. (The heuristic is deliberately broad: a reducer that
intentionally appends a row — an optimistic create, which has no paved path
yet — also trips it.)

## Response and query authority can arrive in either order

The mutation's HTTP response and the live query's delivery of the resulting
commit race, and the layer reconciles both orders without double-applying:

- **Response before query:** the validated response settles the mutation
  promise, but a response is not live-query authority. The layer stays
  installed until a live delivery matches the complete receipt, then retires:

```js source=packages/snapback-react/optimistic.test.mjs
likeClient.inspection().attempts[0].resolve({ liked: true, likeCount: 11 });
assert.deepEqual(await like, { status: 'settled', result: { liked: true, likeCount: 11 } });
assert.equal(view().timeline.data[0].likeCount, 11, 'settled response alone does not retire the layer');
likeClient.emit('timeline', [{ id: 'p1', liked: true, likeCount: 11 }]);
assert.equal(view().timeline.data[0].likeCount, 11);
likeClient.emit('timeline', [{ id: 'p1', liked: true, likeCount: 12 }]);
assert.equal(view().timeline.data[0].likeCount, 12, 'layer retired after the complete receipt');
```

- **Query before response:** the authoritative delivery advances the base
  first and the projection rebases over it (capture-and-set makes this a
  no-op rather than a second increment); when the response then identifies
  the receipt, the matcher recognizes it in the already-current rows and
  retires the layer.

Rejection needs no handling beyond the promise: the layer rolls back
automatically, removing only itself and recomputing anything stacked above it
over the newest authoritative base.

## The same record on multiple surfaces

A post renders in the timeline, on the author's profile, maybe in a detail
view — each a distinct canonical query store. In v1 one optimistic projection
targets exactly one canonical query/args pair: the store that rendered the
component the user touched. Configure the mutation per surface, commonly
through a small surface-specific wrapper around a shared card:

```tsx fragment reason="surface wrappers depend on the application's query surfaces"
export function TimelinePostCard({ post }: { post: Post }) {
  const toggleLike = useToggleLike(post, api.timeline, { viewerHandle: viewer });
  return <PostCard post={post} toggleLike={toggleLike} />;
}

export function ProfilePostCard({ post, handle }: { post: Post; handle: string }) {
  const toggleLike = useToggleLike(post, api.profilePosts, { handle, viewerHandle: viewer });
  return <PostCard post={post} toggleLike={toggleLike} />;
}
```

Only the touched surface gets the zero-latency projection. Every other
mounted store showing the same record updates through its own authoritative
subscription when the commit's live delivery arrives — do not try to install
the same layer into sibling stores or mirror the change into them by hand:

```js source=packages/snapback-react/optimistic.test.mjs
// Other mounted stores rendering the same record update through their own
// authoritative subscriptions, not through the optimistic layer.
likeClient.emit('profilePosts', [{ id: 'p1', liked: true, likeCount: 12 }]);
assert.equal(view().profile.data[0].liked, true, 'other surfaces settle authoritatively');
assert.equal(view().profile.data[0].likeCount, 12);
```

The tradeoff is honest: on the untouched surfaces the like lands at
live-delivery latency rather than instantly. That brief skew is
self-reconciling; a hand-mirrored update is a second source of truth that is
not.

## Anti-patterns

- **Do not add a component-local delta to a count a live query already
  supplies.** `likeCount + localBump` double-counts the moment the
  authoritative increment arrives. The count on screen is either the query's
  value or the optimistic layer's projection of it — never query value plus
  local arithmetic.
- **Do not keep the toggle in component state.** `useState(liked)` has no
  reconciliation with query authority: it drifts on other-client changes,
  survives rejection, and fights the live delivery. Model the fact in query
  data: either as a field on the rendered row or as a boolean derived from a
  separate canonical likes query.
- **Do not project a field into the wrong query's row contract.** In the split
  cold-retained layout, `{ liked, likeCount }` is not a valid posts row when
  `liked` lives in `myLikes`; the layer is refused. Project `{ likeCount }`
  only and let the heart settle from the authoritative viewer-fact query.
- **Do not toggle or increment inside `update`.** The projection is replayed
  during rebase; capture the intended outcome and set it (or let
  `projectRecordFields` do both rules for you). In development the replay
  advisory warns when a reducer diverges over its own output.
- **Do not retire on a partial receipt.** Match every field the mutation
  returns in `isAuthoritative`, or a delivery carrying half the outcome
  retires the layer early and the UI dips.
- **Do not treat the mutation HTTP response as live-query authority.** It
  settles the promise; the layer retires on the matching live delivery.
- **Do not fan one optimistic config out to every store showing the record.**
  v1 targets one canonical query/args pair; sibling surfaces settle through
  their own subscriptions.
- **Do not hand-write a matcher that may never become true.** A layer with a
  supplied `isAuthoritative` never uses the fallback next-delivery
  retirement: if a matched field can settle to a value differing from both
  receipt and intent — or, for a hand-written matcher, the matched row can
  be filtered out of the query result — the confirmed layer stays installed
  (and keeps its subscription pin) until the store tears down. Match rows
  the query is guaranteed to keep returning, and match fields the mutation
  actually settles. `projectRecordFields` layers retire on row-absent
  authoritative deliveries (the backstop above), and any confirmed layer
  still installed is visible in `provider.inspection()` as a
  `confirmedOptimisticLayers` entry naming its mutation/query pair — check
  there when a subscription refuses to go idle. (Overriding the helper's
  `isAuthoritative` with your own function is a hand-written matcher: the
  backstop does not travel.)

---

<!-- snapback-guide-source: guide/recipes/chunked-semijoin-feed.md -->
---
title: "Recipe: chunk a membership feed across in()"
id: recipes.chunked-semijoin-feed
order: 4
audience: agent-first
capabilities: [backend.query-in-chunking]
authorities: [llp/0277-coterie-clique-run-observations.research.md, llp/0278-paged-live-results-and-relational-composition.rfc.md, demos/coterie/snapback/schema.mjs, demos/coterie/snapback/functions.mjs, demos/coterie/snapback/acceptance-m2.test.mjs]
examples: [demos/coterie]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:b8739e9379714807830ce2539b2ad050a64c0bc97bdac6e0fc84031abd28c2ba
---

# Recipe: chunk a membership feed across `in()`

<!-- @ref LLP 0277#f3-the-in-operand-bound-turns-membership-feeds-into-bespoke-query-planning--repeated — this is the checked interim recipe requested by the Coterie run -->

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this composition when one top-N feed spans an application-owned bounded
set of actors and one `.in()` query cannot carry the whole set. If the feed is
one ordered table with no membership fan-in, use the simpler
[paginated-list recipe](./paged-list.md).

Coterie's Following feed is the executable carrier. It normalizes posts and
reposts into `feedEvents`, chunks the visible actor IDs, reads the indexed top
20 in each chunk (the run's "indexed top-20 per chunk"), and merges those
candidate pages by one global `pageKey`.
This is a hand-built composition over shipped query primitives, not a
first-class Snapback semi-join.

## Reserve cursor and visibility bindings before sizing a chunk

One builder admits at most 500 total `.in()` operands and at most 500 total
filter bindings. The latter count includes every `.eq()`/range predicate and
every item passed to `.in()`. Coterie's `feedEvents` table is explicitly
`public-read`, so the host adds no owner or membership visibility predicate.
For that public-read table, a page after the first adds
`.lt('pageKey', before)`: use **at most 499 actor IDs per chunk** and reserve
the 500th binding for that cursor predicate. Keep that reservation on the
first page so the same chunk shape remains valid later.

The 499 value is not universal. On a protected table, host-added owner and
membership visibility bindings consume the same 500-binding budget. Reserve
one slot for every such host-owned binding, plus every application predicate
and the optional cursor, before assigning the remainder to actor IDs:

```text
actor IDs per chunk <= 500 - cursor slots - application-predicate slots
                              - host-visibility-binding slots
```

Copy Coterie's 499 only when the queried table is `public-read` and the cursor
is the sole non-`.in()` filter. For a protected table, inspect its generated
visibility plan and reserve every host-owned slot; otherwise a nominally safe
chunk can still refuse with `SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED`.

More than 500 total `.in()` items refuses with
`SNAPBACK_QUERY_IN_ITEMS_EXCEEDED`; 500 actor items plus the cursor predicate
instead exceeds the total binding budget and refuses with
`SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED`. Coterie keeps the ceiling and the
generic chunk helper explicit:

```js source=demos/coterie/snapback/functions.mjs
function pageKeyFor(ctx, createdAt) {
  return `${String(createdAt).padStart(16, '0')}:${ctx.runtime.id()}`;
}

function queryFilterBindingLimit() {
  return 500;
}
```

```js source=demos/coterie/snapback/functions.mjs
function chunkValues(values, maxItems) {
  const chunks = [];
  for (let start = 0; start < values.length; start += maxItems) {
    chunks.push(values.slice(start, start + maxItems));
  }
  return chunks;
}
```

Do not use a 500-item chunk merely because the cursor is absent on the first
page. The next page would add the 501st binding and change the query's
admissibility at the page boundary.

## Normalize every feed event behind one immutable total order

The merge is exact only when every candidate shares one immutable, unique,
totally ordered key. Coterie creates `pageKey` from server time plus a fresh
runtime ID, never patches it, and makes the global index unique. Its
actor-plus-page index makes each chunk read indexed rather than a table scan:

```js source=demos/coterie/snapback/schema.mjs
    feedEvents: defineTable({
      eventKind: v.string(),
      sourceKey: v.string(),
      postId: v.id('posts'),
      actorProfileId: v.id('profiles'),
      pageKey: v.string(),
      createdAt: v.integer(),
    })
      .index('by_page_key', ['pageKey'], { unique: true })
      .index('by_actor_page', ['actorProfileId', 'pageKey'])
      .index('by_source_key', ['sourceKey'], { unique: true })
      .visibility({ kind: 'public-read' })
      .sync(),
```

`feedEvents` is the normalization seam: an original post and a repost can
have different source rows and hydration rules while the feed planner sees
the same `actorProfileId` and `pageKey` columns. If every source kind cannot
produce the same immutable total order, this merge proof does not apply.

## Read top N per chunk, then merge the candidates

Apply the same strict global cursor to every chunk before ordering and taking
N rows. Merge all chunk candidates by the same descending key and take N
again:

```js source=demos/coterie/snapback/functions.mjs
async function followingFeedEvents(ctx, visibleActorIds, before, actorChunkSize) {
  const chunkPages = [];
  for (const actorIds of chunkValues(visibleActorIds, actorChunkSize)) {
    let eventsQuery = ctx.db
      .query('feedEvents')
      .withIndex('by_actor_page')
      .in('actorProfileId', actorIds);
    if (before) eventsQuery = eventsQuery.lt('pageKey', before);
    chunkPages.push(...await eventsQuery.order('pageKey', 'desc').take(20).collect());
  }
  // Every row outside a chunk's top 20 has at least 20 newer rows in that
  // same chunk, so it cannot belong to the global top 20. Merging the chunk
  // tops and taking the first 20 is therefore exact, not an approximation.
  return chunkPages
    .sort((left, right) => (left.pageKey > right.pageKey ? -1 : left.pageKey < right.pageKey ? 1 : 0))
    .slice(0, 20);
}
```

The proof generalizes from 20 to N: a row below rank N in its own chunk has
at least N globally newer candidates in that chunk alone, so it cannot enter
the global top N. It depends on indexed per-chunk reads, the identical strict
cursor on every chunk, and the immutable total order above.

The production path fixes the chunk size at 499 and exposes only the cursor.
There is no caller-selected chunk size on `followingFeed`:

```js source=demos/coterie/snapback/functions.mjs
export const followingFeed = defineJsLiveQuery({
  auth: 'authenticated',
  args: { before: v.optional(v.string()) },
  result: results.records(feedRow, { minItems: 0, maxItems: 20 }),
  reads: [
    'feedEvents',
    'posts',
    'profiles',
    'postImages',
    'postVideos',
    'likes',
    'reposts',
    'follows',
  ],
  refusals: ['PROFILE_REQUIRED'],
  handler: async (ctx, args) => feedRows(ctx, args, true),
});
```

Bound the membership read separately. Coterie's shared ordinary/fixture follow
writer admits the 1,024th edge and refuses an attempted 1,025th edge before
insert. Because every follow write goes through that admission check, the
feed's `.take(1024)` is complete rather than a truncating prefix:

```js source=demos/coterie/snapback/functions.mjs
// @ref LLP 0278#d3-closed-membership-semi-join — the interim manual plan
// must admit a finite actor set instead of truncating an unbounded follow graph.
function followingSetLimit() {
  return 1024;
}

function requireFollowingSetCapacity(ctx, currentFollowingCount) {
  if (currentFollowingCount >= followingSetLimit()) {
    ctx.refuse('FOLLOWING_SET_LIMIT_EXCEEDED');
  }
}
```

Declare that refusal on every follow mutation, and prove both sides of the
boundary. If an application has legacy rows written outside the bounded
writer, audit or migrate them before relying on the invariant. Chunking makes
a declared finite actor set queryable; it does not make an unbounded follow
graph or unbounded fan-out safe.

## Keep one cursor owner across all chunks

The feed function owns one global `before` value. It is the last returned
row's raw `pageKey`, not one cursor per actor chunk and not a chunk offset.
Every chunk receives the same boundary, and the merge returns the next global
window. Coterie's acceptance cursor walk demonstrates that ownership:

```js source=demos/coterie/snapback/acceptance-m2.test.mjs
async function feedPages(client, reference) {
  const pages = [];
  let before;
  for (let page = 0; page < 20; page += 1) {
    const rows = (await client.query(reference, {
      args: { ...(before ? { before } : {}) },
    })).rows;
    pages.push(rows);
    if (rows.length < 20) return pages;
    before = rows.at(-1).pageKey;
  }
  throw new Error('feed pagination did not terminate within twenty pages');
}

async function allPages(client, reference) {
  return (await feedPages(client, reference)).flat();
}
```

This raw application-owned cursor is specific to this recipe. Do not pass it
to `defineMembershipKeysetPages` or another standard-pattern page: those
surfaces own opaque custody-bound cursors, as the
[paged-list recipe explains](./paged-list.md#use-opaque-cursors-for-protected-pages).

## Force the multi-chunk path in acceptance

A fixture with fewer than 500 visible actors can silently exercise only one
chunk. Every `define*` export in an application's production `functions.mjs`
is generated and ships; leaving an operation out of product call sites or
provider mappings does not make it test-only. Coterie's production module
therefore has no forced-size query at all. Its M2 test copies the production
schema and functions into a temporary backend, injects a harness-only query,
runs codegen for that temporary backend, and provisions those temporary
artifacts on the isolated acceptance server. The committed production
manifest and generated API are separately asserted not to contain the
acceptance operation.

The harness-only query accepts only the global cursor and always uses three
actors per chunk. This definition lives in `acceptance-m2.test.mjs`, which
production codegen does not load; production `followingFeed` neither declares
nor reads `actorChunkSize`:

```js source=demos/coterie/snapback/acceptance-m2.test.mjs
export const followingFeedAcceptance = defineJsQuery({
  auth: 'authenticated',
  args: { before: v.optional(v.string()) },
  result: results.records(feedRow, { minItems: 0, maxItems: 20 }),
  reads: [
    'feedEvents',
    'posts',
    'profiles',
    'postImages',
    'postVideos',
    'likes',
    'reposts',
    'follows',
  ],
  refusals: ['PROFILE_REQUIRED'],
  handler: async (ctx, args) => feedRows(ctx, args, true, 3),
});
```

The test makes the viewer plus three followed actors span two chunks, walks a
full 20-row page and a non-empty second page through that forced-multi-chunk
path, and compares the complete sequence against an independently filtered
global feed:

```js source=demos/coterie/snapback/acceptance-m2.test.mjs
  await t.test('forced following-feed chunks paginate exactly across actor sets', async () => {
    created.dave = (await dave.client.mutate(api.createPost, {
      args: { kind: 'text', body: 'Dave crosses the chunk boundary.', imageAssetIds: [] },
    })).result;
    const followed = [alice, carol, dave];
    for (const actor of followed) {
      await bob.client.mutate(api.setFollow, {
        args: {
          profileId: actor.profile._id,
          following: true,
          mutationId: `chunk-follow-${actor.profile.handle}`,
        },
      });
    }

    const chunkedPages = await feedPages(bob.client, api.followingFeedAcceptance);
    assert.equal(chunkedPages[0]?.length, 20);
    assert((chunkedPages[1]?.length ?? 0) > 0, 'forced multi-chunk path must fill a second page');
    const chunked = chunkedPages.flat();
    const visibleActors = new Set([
      bob.profile._id,
      ...followed.map((actor) => actor.profile._id),
    ]);
    const expected = (await allPages(bob.client, api.globalFeed))
      .filter((row) => visibleActors.has(
        row.eventKind === 'repost' ? row.repostedByProfileId : row.authorProfileId,
      ));
    assert.deepEqual(
      chunked.map(({ itemId }) => itemId),
      expected.map(({ itemId }) => itemId),
    );
    assert(chunked.some(({ _id }) => _id === created.dave));

    for (const actor of followed) {
      await bob.client.mutate(api.setFollow, {
        args: {
          profileId: actor.profile._id,
          following: false,
          mutationId: `chunk-unfollow-${actor.profile.handle}`,
        },
      });
    }
  });
```

Keep the fixed-size query in harness-owned source that production codegen does
not load. Never put it in production `functions.mjs`: every `define*` there is
a deployed operation even when product code never calls or maps it.
Application behavior must not depend on a caller-selected chunk size, and an
ordinary product query must never accept `actorChunkSize`.

## Design reference: the closed semi-join does not ship

LLP 0278 D3 proposes a closed membership semi-join in which the runtime owns
chunking, indexed reads, merge, bounded-actor admission, cursor semantics, and
codegen-visible cost facts. **LLP 0278 D3 remains design-only.** There is no
shipped `semiJoin()` helper, and this manual recipe does not let codegen prove
maximum chunks × per-chunk take or cursor correctness. Do not copy the RFC's
pseudocode into an application or claim the author-visible chunk seam has
disappeared; use the checked Coterie composition above until a published
surface replaces it.

## Anti-patterns

- Do not copy the 499-actor public-read calculation onto a protected table;
  reserve cursor, application, and host visibility bindings first.
- Do not collect every matching event and sort in JavaScript; take the
  indexed top N inside each chunk.
- Do not merge on a mutable timestamp, a non-unique display value, or
  different keys per source kind.
- Do not keep one cursor per chunk; one global ordered feed owns one global
  boundary.
- Do not let production callers tune `actorChunkSize` or mistake chunking for
  an unbounded-fan-out primitive.
- Do not claim LLP 0278 D3's closed semi-join ships.

---

<!-- snapback-guide-source: guide/recipes/paged-list.md -->
---
title: "Recipe: paginated and load-more lists"
id: recipes.paged-list
order: 4
audience: agent-first
capabilities: [clients.react-paged-list]
authorities: [llp/0100-membership-addressed-operations-and-pages.rfc.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0196-template-and-recipe-portfolio.plan.md, packages/snapback-cli/templates/media-feed/snapback/schema.mjs, packages/snapback-cli/templates/media-feed/snapback/functions.mjs, packages/snapback-cli/templates/media-feed/App.tsx, packages/snapback-cli/templates/media-feed/pagination.mjs, packages/snapback-cli/templates/media-feed/acceptance.mjs, packages/snapback-cli/templates/media-feed/acceptance.static.mjs]
examples: [packages/snapback-cli/templates/media-feed]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:cfa8b56a1cc17fecd9a9c7199933bca32ed9ab24d7610ceca52419d7bc039923
---

# Recipe: paginated and load-more lists

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use a live query for the current window and a second bounded query for rows
strictly before its oldest unique key. In React, keep older whole-result pages
in a small presentation sidecar and deduplicate the combined list by canonical
row id. The `media-feed` template is the complete executable carrier:

```sh
npx create-snapback-app my-feed --template media-feed
cd my-feed
npm run prove
```

This recipe is for a public/shared feed with a raw, application-owned unique
boundary. Owner- and membership-protected generated pages have an opaque
cursor and a different custody contract; [use that path](#use-opaque-cursors-for-protected-pages)
instead of copying this public-feed shape.

If one global page instead fans in rows from a bounded membership set and the
actor IDs approach the `.in()` operand ceiling, use the
[chunked membership-feed recipe](./chunked-semijoin-feed.md). It preserves one
global cursor while reading and merging indexed top-N windows per actor chunk.

## Give every row a unique immutable page key

A display timestamp is not a keyset boundary. Two rows can share one
millisecond, and `createdAt < before` would skip the second row if the page
break landed between them. Keep `createdAt` for display, but order and filter
on an independently unique immutable string. The template combines a
zero-padded server time with a server runtime id:

```js source=packages/snapback-cli/templates/media-feed/snapback/functions.mjs
  handler: async (ctx, args) => {
    const createdAt = ctx.runtime.now();
    return ctx.db.insert('entries', {
      ownerId: ctx.auth.userId,
      authorName: args.authorName,
      caption: args.caption,
      photo: await ctx.assets.attach(args.photo, { upload: 'feedPhotoUpload' }),
      // Time keeps feed order intuitive; the runtime id makes the boundary
      // unique even when two entries share the same millisecond.
      pageKey: `${String(createdAt).padStart(16, '0')}:${ctx.runtime.id()}`,
      createdAt,
    });
  },
```

Declare `pageKey` required and the index unique. If the application permits
editing rows, make `pageKey` immutable explicitly; moving a boundary field
during traversal can legitimately move that row across the boundary. This is
the unique continuation contract in [safe standard patterns](../backend/standard-patterns.md#generate-keyset-pages),
applied here to a public unpartitioned feed.

## Query the current window and one older window

Both queries are bounded and use the same descending index. The older query's
strict comparison means the boundary row cannot repeat:

```js source=packages/snapback-cli/templates/media-feed/snapback/functions.mjs
export const liveFeed = defineLiveQuery({
  table: 'entries',
  args: {},
  order: [desc('pageKey')],
  index: 'by_page_key',
  limit: 6,
  auth: 'public',
  authorityIndependent: true,
});

export const olderFeedPage = defineLiveQuery({
  table: 'entries',
  args: { before: v.string() },
  filter: [ltFilter('pageKey', arg('before'))],
  order: [desc('pageKey')],
  index: 'by_page_key',
  limit: 6,
  auth: 'public',
  authorityIndependent: true,
});
```

These are live queries, so each delivery replaces the complete result for its
exact `(query, args)` identity. Do not append every replacement blindly. The
current window remains query-owned; only the accumulated archive is local
presentation state.

## Accumulate replacements without duplicating rows

Start the older hook as `skip`, then activate it with the oldest rendered
`pageKey`. This feed is append-only. When a newer insert slides the live head,
move rows displaced from the previous head into the archive; otherwise the
old boundary excludes that row from the older page and it briefly vanishes.
Merge whole older-page replacements through the same helper, deduplicate by
canonical id, and sort by the immutable page key:

```tsx source=packages/snapback-cli/templates/media-feed/App.tsx
  const first = useSnapbackQuery(api.liveFeed, {});
  const [before, setBefore] = useState<string | null>(null);
  const [archive, setArchive] = useState<readonly Entry[]>([]);
  const previousFirstRows = useRef<readonly Entry[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const older = useSnapbackQuery(api.olderFeedPage, before === null ? skip : { before });
```

```tsx source=packages/snapback-cli/templates/media-feed/App.tsx
  useEffect(() => {
    if (!firstReady) return;
    setArchive((current) => mergePagedArchive({
      archive: current,
      head: firstRows,
      previousHead: previousFirstRows.current,
    }));
    previousFirstRows.current = firstRows;
  }, [firstReady, firstRows]);

  useEffect(() => {
    if (older.status !== 'ready' && older.status !== 'refreshing') return;
    setArchive((current) => mergePagedArchive({ archive: current, head: firstRows, page: older.data }));
    setExhausted(older.data.length < 6);
  }, [firstRows, older]);

  const entries = useMemo(() => {
    const seen = new Set<string>();
    return [...firstRows, ...archive].filter((entry) => {
      if (seen.has(entry._id)) return false;
      seen.add(entry._id);
      return true;
    });
  }, [firstRows, archive]);
```

Advance only when there is a row and the boundary actually changed. A short
page is terminal; a full final page needs one more request to observe the
empty terminal page:

```tsx source=packages/snapback-cli/templates/media-feed/App.tsx
  const loadOlder = () => {
    if (exhausted || older.status === 'pending') return;
    const oldest = entries.at(-1);
    if (oldest && oldest.pageKey !== before) setBefore(oldest.pageKey);
  };
```

`FlatList.onEndReached` calls `loadOlder`; a button can call the same function.
Keep `_id` as the render key. The template's live acceptance deliberately puts
equal `createdAt` values on opposite sides of the page break, proves twelve
unique rows, inserts a newer row, and proves the historical page did not
shift. Its executable static acceptance also slides the live head and proves
the displaced boundary row remains in the merged list. If rows can be deleted,
do not use append-only rollover unchanged: carry deletion/tombstone semantics
into the presentation merge so a removed head row is not archived forever.

## Treat retention and the archive as different things

The provider may render a retained snapshot for an eligible exact
`(query, args)` registration and reports that fact through
`QueryState.freshness`/`retention`. The `archive` array above is ordinary React
state. It is **not** part of the retained query store and disappears on reload.
Do not label the assembled infinite list offline-complete merely because the
current window or one previously registered page can render retained.

For protected data, also clear every caller-owned accumulated page at the
same authorization cut that blanks the protected current window. Retaining an
archive past logout or membership removal would turn presentation state into
an ungoverned cache.

## Use opaque cursors for protected pages

`defineOwnedKeysetPages` and `defineMembershipKeysetPages` return an envelope
with `rows` and an opaque custody-bound cursor. The membership pair is
callable-only by design. That envelope is not the array-shaped generated live
query accepted by `useSnapbackQuery`, and the React `QueryState` does not
surface a hidden cursor. Invoke those pages with the
[headless client's `query`](../clients/headless.md) from an application-owned
control, thread the returned cursor verbatim, and clear accumulated rows on an
authority cut. Do not substitute the raw `pageKey` or cast the callable page
into a live hook.

This is an honest API boundary: the public media-feed recipe needs no new
platform primitive, while a first-class React hook for opaque callable pages
would be a separate client feature.

## Anti-patterns

- Do not paginate on a non-unique timestamp or offset.
- Do not append every live replacement; merge by canonical `_id`.
- Do not claim the React archive is retained or offline-complete.
- Do not feed a raw boundary to a standard-pattern cursor argument.
- Do not stretch this single-table recipe across a large membership set; use
  the chunked membership-feed composition.
- Do not keep protected accumulated rows across logout, membership loss, or
  another authority partition change.

---

<!-- snapback-guide-source: guide/recipes/browser-auth.md -->
---
title: "Recipe: browser sign-in and reload custody"
id: recipes.browser-auth
order: 5
audience: agent-first
capabilities: [auth.sessions, auth.external-identity-broker, auth.browser-session-custody, auth.scoped-queries, auth.invalidation-barrier]
authorities: [llp/0057-auth-provider-protocol.spec.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0060-hosted-auth-security.rfc.md, llp/0151-first-party-identity-integrations.rfc.md, packages/snapback-client/index.mjs, packages/snapback-contract/auth-coordinator.mjs, demos/browser-auth/snapback/schema.mjs, demos/browser-auth/snapback/functions.mjs, demos/browser-auth/server/gateway.mjs, demos/browser-auth/surfaces/web/main.mjs, demos/browser-auth/tests/acceptance/browser-auth.mjs]
examples: [demos/browser-auth, demos/pointing-room/surfaces/contract, demos/file-drop/vite.config.ts]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-16
reviewed-authorities-digest: sha256:447ad2cfdbee049fb2d7e2d7f0194fd66fad70c7cab7a47afcc65c3c4e5ef739
---

# Recipe: browser sign-in and reload custody

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this recipe when a browser app already has an identity front door and
app-owned user rows. The registered [`browser-auth` demo](repo:demos/browser-auth)
proves the complete local composition in real Chrome:

If the app uses Snapback's built-in password entry, use the ordinary
[first-party application-auth journey](../auth/passwords.md#sign-up-then-sign-in)
instead. This page remains the advanced external-broker/custom-composition
path.

1. an app-owned trusted server verifies an external assertion;
2. immutable `(issuer, subject)` selects the app user;
3. the server binds the resulting Snapback principal before releasing a
   one-use browser exchange;
4. `AuthCoordinator` stores the bearer in IndexedDB;
5. a full reload restores the protected user without another exchange; and
6. logout blanks protected data, revokes the session, and leaves reload
   anonymous.

This is a **product-shaped local recipe**, not hosted or production-ready
authentication. Its signed-assertion identity provider and capture mailbox are
hermetic fixtures. Draft LLP 0151's first-party provider and completion
protocol are larger unimplemented surfaces, described under
[the boundary](#know-exactly-where-this-stops).

## Bind the immutable identity, not email

Provider email and display name can change. The durable external identity key
is `(issuer, subject)`, and every side of the app-level join is unique:

```js source=demos/browser-auth/snapback/schema.mjs
  identityBindings: defineTable({
    principal: v.principal(),
    appUserId: v.id('appUsers'),
    externalIssuer: v.string(),
    externalSubject: v.string(),
  })
    .index('by_principal', ['principal'], { unique: true })
    .index('by_app_user', ['appUserId'], { unique: true })
    .index('by_external_identity', ['externalIssuer', 'externalSubject'], { unique: true }),
```

The trusted server verifies the assertion first, derives a stable opaque local
email from issuer + subject for the shipped email-code provider, and invokes
the private binder through a direct server-side client. It stages a second,
one-use challenge/code for the browser. The browser never receives the admin
token, impersonation capability, mailbox reader, provider assertion, private
backend origin, or a bearer in a redirect URL.

Do not expose the binder merely because `/mutation/{name}` is generally an app
route. The demo's app gateway uses an exact method + route allowlist:

```js source=demos/browser-auth/server/gateway.mjs
const PUBLIC_ROUTES = Object.freeze(new Set([
  'GET /auth/session',
  'POST /auth/exchange',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /query/viewer',
]));
```

Both `brokerBindPrincipal` and its closed fixture setup mutation are absent.
The acceptance suite requests them through the public origin and requires an
allowlist refusal before Snapback sees the request.

For the rationale and the frozen-fixture alternative, read
[bind a principal to your app's user identity](../auth/app-identity-binding.md).

## Let the server-derived principal select protected data

The protected query takes no user, email, issuer, or subject argument. It
starts at `ctx.auth.userId`, follows the private binding, and returns exactly
that app user's row:

```js source=demos/browser-auth/snapback/functions.mjs
export const viewer = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['appUsers', 'identityBindings'],
  result: results.records(v.object({
    principal: v.principal(),
    externalIssuer: v.string(),
    externalSubject: v.string(),
    displayName: v.string(),
    privateNote: v.string(),
  }), { minItems: 1, maxItems: 1 }),
  handler: async (ctx) => {
    const { appUser, binding } = await requireBoundUser(ctx);
    return [{
      principal: ctx.auth.userId,
      externalIssuer: binding.externalIssuer,
      externalSubject: binding.externalSubject,
      displayName: appUser.displayName,
      privateNote: appUser.privateNote,
    }];
  },
});
```

This is application-level identity binding. It does not replace the future
platform-owned `_auth_identities` lifecycle in Draft LLP 0151.

## Get the sign-in code in local development

For a non-React Contract/Vite surface, use a **serve-only dev mailbox relay**.
The Vite process reads the ready-file carriers server-side; page code never
does. Pointing Room accepts explicit environment carriers for harnesses or
reads the owner-only files named by the ready descriptor:

```ts source=demos/pointing-room/surfaces/contract/vite.config.ts
function localMailboxCredentials(): { adminToken: string; impersonation: string } | null {
  const explicitAdmin = process.env.SNAPBACK_POINTING_ADMIN_TOKEN?.trim();
  const explicitImpersonation = process.env.SNAPBACK_POINTING_IMPERSONATION_CAPABILITY?.trim();
  if (explicitAdmin && explicitImpersonation) {
    return { adminToken: explicitAdmin, impersonation: explicitImpersonation };
  }
  const readyFile = process.env.SNAPBACK_POINTING_READY_FILE;
  if (!readyFile) return null;
  const descriptor = JSON.parse(readFileSync(readyFile, 'utf8')) as {
    adminTokenFile: string;
    impersonationCapabilityFile: string;
  };
  return {
    adminToken: readFileSync(descriptor.adminTokenFile, 'utf8').trim(),
    impersonation: readFileSync(descriptor.impersonationCapabilityFile, 'utf8').trim(),
  };
}
```

The plugin applies only to `vite serve`, recognizes one relay route, calls only
the gated mailbox endpoint, disables caching, and passes every other request to
the next middleware. It is not an arbitrary Snapback proxy:

```ts source=demos/pointing-room/surfaces/contract/vite.config.ts
// The local provider has no mail delivery. This serve-only middleware keeps
// the admin and impersonation carriers in the Vite process and relays only the
// one-time code to the browser. It never proxies arbitrary Snapback routes.
const pointingRoomMailbox = {
  name: 'pointing-room-local-mailbox',
  apply: 'serve' as const,
  configureServer(server: { middlewares: { use: Function } }) {
    server.middlewares.use(async (
      request: { url?: string },
      response: {
        statusCode: number;
        setHeader(name: string, value: string): void;
        end(body: string): void;
      },
      next: () => void,
    ) => {
      if (!request.url?.startsWith('/__pointing-mailbox')) return next();
      const challengeId = new URL(request.url, 'http://pointing-room.local')
        .searchParams.get('challengeId');
      const credentials = localMailboxCredentials();
      if (!challengeId) {
        response.statusCode = 400;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        return response.end(JSON.stringify({ error: 'missing challengeId' }));
      }
      if (!credentials) {
        response.statusCode = 503;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        return response.end(JSON.stringify({
          error: 'local mailbox credentials unavailable',
          recovery: 'set SNAPBACK_POINTING_READY_FILE or both SNAPBACK_POINTING_ADMIN_TOKEN and SNAPBACK_POINTING_IMPERSONATION_CAPABILITY',
        }));
      }
      const mailbox = await fetch(
        `${snapbackTarget}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(challengeId)}`,
        {
          headers: {
            'x-snapback-admin-token': credentials.adminToken,
            'x-snapback-impersonation-capability': credentials.impersonation,
          },
        },
      );
      response.statusCode = mailbox.status;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      return response.end(await mailbox.text());
    });
  },
};
```

The browser half remains the ordinary public flow: request a challenge, fetch
the relayed one-time code, and exchange it into coordinator-owned custody.

```ts source=demos/pointing-room/surfaces/contract/main.ts
async function signIn(client: SnapbackClient, email: string) {
  const challenge = await client.authRequestCode(email);
  const mailboxResponse = await fetch(
    `/__pointing-mailbox?challengeId=${encodeURIComponent(challenge.challengeId)}`,
  );
  if (!mailboxResponse.ok) {
    throw new Error(`local sign-in mailbox refused (${mailboxResponse.status}): ${await mailboxResponse.text()}`);
  }
  const mailbox = await mailboxResponse.json() as { code: string };
  return await client.authExchange({ challengeId: challenge.challengeId, code: mailbox.code });
}
```

The browser receives only the one-time code. The admin token, impersonation
capability, mailbox reader, and any private backend origin must never enter
`define`, `import.meta.env`, page code, the bundle, or logs. Pointing Room's
ordinary app-data origin is separately browser-reachable; that does not make a
private relay origin safe to publish. The React-side sibling is
[`demos/file-drop/vite.config.ts`](repo:demos/file-drop/vite.config.ts); the
custody rule is framework-independent.

This relay is a local dev fixture, not production challenge delivery. Replace
it with the admitted provider/delivery path when one exists; do not deploy the
Vite middleware as an auth service.

## Put browser custody in IndexedDB

Construct exactly one coordinator with the generated app id and the shipped
IndexedDB adapter, then pass it to the client:

```js source=demos/browser-auth/surfaces/web/main.mjs
export const authCoordinator = new AuthCoordinator({
  appId: APP_ID,
  storage: createIndexedDbAuthCustodyStorage(),
});

export const client = new SnapbackClient('/__snapback', {
  authCoordinator,
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  clientStoreId: 'browser-auth-recipe-web',
  rqsStore: null,
});
```

`createMemoryAuthCustodyStorage()` is useful for headless tests and
document-lifetime flows, but it cannot prove browser reload custody. A SPA
route change does not reconstruct the JavaScript process; use a true page
reload as the distinguishing acceptance check.

The callback redirects to `/?login=complete`. Only that boot consumes the
one-use challenge/code and calls `authExchange`; it then removes the marker
from browser history. An ordinary reload finds no bootstrap and lets the
coordinator restore its settled session from IndexedDB. The acceptance suite
asserts that neither the bootstrap-consumption count nor `/auth/exchange`
count advances on reload.

Bearer-v1 IndexedDB custody survives reload, but page JavaScript can still use
the credential. It is not XSS-resistant or sender constrained — see
[target claims](../auth/targets.md).

## Recover browser custody after a dev reset

Resetting the local Snapback store rotates its authorization-stream
incarnation and removes its sessions. A browser profile may still hold the old
bearer in IndexedDB, but the first-party client now recovers automatically; the
app should not delete the custody database or reconstruct the client itself.

The recovery is deliberately narrower than “401 means logout”:

1. the stale bearer receives a terminal `carrier` refusal, which by itself
   preserves durable custody;
2. the client makes one bearerless `GET /auth/session` probe;
3. only a valid settled anonymous handshake whose
   `authorizationStreamIncarnation` differs from stored custody may enter the
   coordinator barrier; and
4. the standard quiesce, blank, durable clear, settle, and resume sequence
   reopens the app directly on the observed anonymous incarnation.

This also repairs a cold-reload coordinator whose initial resume failed closed,
so anonymous-eligible operations such as `health()`, `authRequestCode()`, and
logout can proceed without app-side custody surgery. A concurrent tab that has
already signed in wins the coordinator's exact durable comparison; the stale
tab cannot blank or replace it.

The incarnation difference is the security predicate. A network intermediary
can strip an `Authorization` header and provoke a refusal, but cannot fabricate
the origin's valid anonymous handshake at a new incarnation. A failed probe or
a same-incarnation anonymous response therefore leaves custody untouched.
Unsupported partial deletion that removes session rows while preserving the
stream incarnation does not use this recovery path; use the supported reset or
declared-restore workflow, which rotates the incarnation, instead of weakening
the witness.

## Treat logout as a visibility barrier

Remove app-visible protected state before awaiting logout, then let
`authLogout()` perform the coordinator's revocation transition. The acceptance
gateway deliberately holds the `/auth/logout` request while Chrome proves the
private row is absent. After release it requires anonymous durable custody,
protected-query refusal, and an anonymous full reload.

Do not implement logout by deleting an app variable or IndexedDB row yourself.
That skips server revocation and the coordinator barrier.

## Run the witness

```sh
cd demos/browser-auth
SNAPBACK_RUNTIME_BINARY=/path/to/qualified/snapback bun run prove
```

The witness also changes the fixture email and requires the same principal and
app-user binding, then signs in a second subject and proves it cannot see the
first user's private note.

## Know exactly where this stops

The recipe deliberately does **not** claim:

- a shared broker or broker-issued identity namespace;
- a generic OIDC adapter or any first-party Google/Apple/GitHub/Expo provider;
- Draft LLP 0151's discovery, JWKS rotation, PKCE/state/mix-up, sender-
  constrained completion-code, provider config/secrets, and two-arm matrix;
- production challenge delivery — the local capture mailbox is
  admin + impersonation gated; or
- an admitted hosted auth target.

Draft LLP 0151 chooses app-owned provider credentials as the paved production
direction and keeps a shared Google relay preview-only and conditional. A real
provider integration must wait for that RFC's implementing completion/lifecycle
specs; do not generalize this fixture into those contracts.

## Anti-patterns

- Do not expose the private binding mutation through the browser app gateway.
- Do not key identity by email or auto-link across providers by matching email.
- Do not return a broker-minted bearer to browser app state and call it
  coordinator custody.
- Do not recover a dev reset with `indexedDB.deleteDatabase(...)`; it is
  database-scoped rather than app-scoped and bypasses the coordinator barrier.
- Do not put mailbox/admin/impersonation material in browser code or logs.
- Do not expose the mailbox as a generic proxy or publish its private backend
  origin through Vite environment replacement.
- Do not use memory custody and claim reload persistence.
- Do not label this local fixture hosted, OIDC-complete, or production-ready.

---

<!-- snapback-guide-source: guide/recipes/optimistic-create.md -->
---
title: "Recipe: optimistic create with a server-minted ID"
id: recipes.optimistic-create
order: 6
audience: agent-first
capabilities: [clients.optimistic-create, clients.optimistic-mutation-view]
authorities: [llp/0107-react-presence-and-optimistic-lifecycle.spec.md, llp/0133-local-settlement.spec.md, llp/0155-local-sync-product-direction.rfc.md, packages/snapback-client/index.mjs, packages/snapback-react/index.mjs, packages/snapback-react/index.d.mts, packages/snapback-react/optimistic-create.test.mjs, demos/_kit/tests/provider-live-conformance.mjs, demos/zero-bakeoff/apps/contention-calendar/snapback/functions.mjs, tests/acceptance/contention-calendar-rung2-v1.mjs]
examples: [packages/snapback-react/optimistic-create-types.fixture.ts, packages/snapback-react/optimistic-create.test.mjs, demos/_kit/tests/provider-live-conformance.mjs, demos/zero-bakeoff/apps/contention-calendar]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:a12838a91ec8d10412f534c734aafbb28bb727c1177f2a49cbf91363932cd3ec
---

# Recipe: optimistic create with a server-minted ID

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback can render an optimistic insert before the server mints its canonical
row id without forging a generated `Id<Table>`. React applications use
`useSnapbackOptimisticCreate`, a provider-owned projection over the exact
canonical query store. The lower-level
`SnapbackClient.createOptimisticMutationView` remains available for headless
compositions. Both paths use the durable outbox, the same locally executable
generated mutation IR, and the same LLP 0133 logical-mint settlement.

The React package tests prove typed provisional presentation, filtering,
ordering, relationship projection, both response/query orderings, overlapping
rejection, Strict Mode remount, authority cuts, and cleanup. The real-server
provider conformance gate drops a response after commit, replays the exact
durable intent, consumes the same `idMap`, and observes one canonical rendered
row.

## Author one generated insert

Use `defineMutation`, not a server JS mutation plus a separate application
optimistic reducer. The generated plan is the one authored operation the local
evaluator predicts and the server executes authoritatively:

```js source=demos/zero-bakeoff/apps/contention-calendar/snapback/functions.mjs
export const reserve = defineMutation({
  args: {
    idempotencyKey: v.string(),
    resourceKey: v.string(),
    slotKey: v.string(),
    ownerId: v.string(),
    title: v.string(),
    now: v.integer(),
  },
  result: results.value(v.id('reservations')),
  plan: insert('reservations', {
    idempotencyKey: arg('idempotencyKey'),
    resourceKey: arg('resourceKey'),
    slotKey: arg('slotKey'),
    resourceSlotKey: concat(arg('resourceKey'), '|', arg('slotKey')),
    ownerId: arg('ownerId'),
    title: arg('title'),
    createdAt: arg('now'),
  }, { bindIdAs: 'reservationId' }),
  returns: returnBinding('reservationId'),
});
```

Generation must classify the mutation `local-executable`. Unsupported local
IR refuses or degrades explicitly; do not add a handwritten reducer while
claiming same-operation parity.

## Project the provider-owned query

The hook pairs one generated insert with one generated documents live query.
Its `select` function is where provisional and canonical entities share
filtering, ordering, counts, and relationship projection:

```ts source=packages/snapback-react/optimistic-create-types.fixture.ts
const calendar = useSnapbackOptimisticCreate(api.reserve, {
  query: api.schedule,
  args: {},
  select: (entities) => entities
    .filter((entity) => entity.fields.slotKey === 'slot-a')
    .sort((left, right) => left.fields.resourceKey.localeCompare(right.fields.resourceKey)),
});
```

The generated `OptimisticCreateEntity<Row>` union has a top-level `kind`.
Canonical identity is the server's `Id<Table>` and canonical fields include
the server metadata. Provisional identity is a distinct generated
`ProvisionalId<Table>` backed by `clientMutationId`; its fields omit all
server-authored identity/version/timestamp fields. TypeScript therefore
refuses a provisional identity where a canonical id is required. The private
speculative mint used by local IR evaluation is never application data.

Call `calendar.create(args)` rather than `client.mutate` plus a handwritten
append reducer. The provider opens one shared optimistic view for the exact
canonical query store, replays private layers over every authoritative base,
and closes it after its consumers and durable work are gone. Because this is a
generated insert rather than the generic reducer API, it does not trigger the
append-reducer replay advisory.

## Settle by durable intent identity

A successful server-minted insert carries an LLP 0133 `idMap`. The provider
does not guess from equal row content, call order, or mint counts: it pairs the
local and authoritative ids by logical mint identity `(site, occurrence)`.
Response-first success bridges the provisional entity until canonical
delivery. Query-first delivery is held behind the unresolved mutation, then
the mapping retires the provisional layer atomically. The lower-level
Contention Calendar acceptance checks every mapping member:

```js source=tests/acceptance/contention-calendar-rung2-v1.mjs
  assert.equal(mapping.speculative, claim.claimed);
  assert.equal(mapping.site, claim.site);
  assert.equal(mapping.occurrence, claim.occurrence);
  assert.equal(mapping.authoritative, settlement.result);
  assert.equal(mapping.disposition, 'mapped');
```

On rejection, only the rejected private layer retires and later layers replay.
Show a stable declared application refusal when the backend supplies one;
never parse handler message text
([declared refusals](../backend/mutations.md#consume-the-structured-result)).

## Reuse the exact intent after an ambiguous response

Do not call the mutation again as a new user intent after response loss. The
durable outbox replays the original `clientMutationId` and its exact
semantics-affecting identity. The server's settlement ledger republishes the
stored result and the same logical-mint mapping, so one intent creates one
canonical row.

The provider-live conformance gate proves two wire attempts, one authoritative
application, the same durable `clientMutationId`, the same `idMap`, and one
canonical entity after a simulated response loss **after commit**:

```sh
node demos/_kit/tests/provider-live-conformance.mjs
```

`create` rejects a queued dispatch with
`SNAPBACK_REACT_MUTATION_QUEUED`, but the provider keeps the provisional layer
and discovers the retained settlement after outbox replay. Never issue a fresh
create to recover an ambiguous response. Authority replacement blanks the old
view; Strict Mode and HMR remounts share the provider-owned view instead of
duplicating durable work.

## Choose the right current path

| Need | Shipped path |
| --- | --- |
| React create participates in one provider-owned canonical query projection | `useSnapbackOptimisticCreate`. |
| Acceptance adapter needs the exact hook path without a React renderer | `observeSnapbackOptimisticCreate`. |
| A headless composition genuinely needs direct view/rebase control | `SnapbackClient.createOptimisticMutationView`. |

## Anti-patterns

- Do not cast or admit a speculative mint as `Id<Table>`.
- Do not author a generated mutation IR and a second optimistic reducer for
  the same operation.
- Do not settle by row-content equality, response order, or mint count.
- Do not retry an ambiguous mutation under a fresh intent identity.
- Do not hand-author a parallel pending sidecar when the row needs the query's
  filtering, ordering, counts, or relationships.

---

<!-- snapback-guide-source: guide/recipes/coming-from-convex-and-supabase.md -->
---
title: "Recipe: coming from Convex and Supabase"
id: recipes.coming-from-convex-and-supabase
order: 7
audience: agent-first
capabilities: [backend.functions, auth.scoped-queries, clients.react, backend.assets, backend.relational-queries, realtime.ephemeral]
authorities: [llp/0186-agent-authoring-efficiency-program.plan.md, llp/0257-activity-scoped-presence-convenience.rfc.md, demos/card-game/snapback/functions.mjs, demos/card-game/tests/acceptance/authority-scope.mjs, demos/expo-golden-path-fixture/snapback/schema.mjs, demos/expo-golden-path-fixture/snapback/functions.mjs, demos/expo-golden-path-fixture/src/screens/chat-screen.tsx, demos/competitive-checkpoint/snapback/functions.mjs, demos/messaging-snapback/src/lib/useTyping.ts, demos/cursors-web/snapback/schema.mjs, packages/snapback-react/exact-result-types.fixture.ts]
examples: [demos/card-game, demos/expo-golden-path-fixture, demos/competitive-checkpoint, demos/messaging-snapback, demos/cursors-web, demos/partiful-matrix]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:ce7e2b314843aeeb1d854b89474a0d27a688e2849f63a74aaabb340bba401cce
---

# Recipe: coming from Convex and Supabase

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

This page is for an agent that already knows Convex or Supabase and is
looking for the Snapback shape of a task it already knows how to do
there — so it can start from a real, CI-verified translation instead of
composing one from prose. Each journey below is a complete, minimal-but-real
slice, not a symbol-substitution table.

**Non-goals.** This is not a feature-parity claim and not a marketing
comparison. Where Snapback has no equivalent for a Convex/Supabase
primitive that the [capability index](../capabilities.md) already tracks
as a GAP, this page says so plainly instead of forcing a translation.
Two examples that come up often: generic multi-way joins beyond the
bounded two-source shapes in
[relational queries](../backend/relational-queries.md), and ANN/approximate
vector search — [vector search](../backend/vector-search.md) ships exact
k-NN only, and calls out ANN as a nonclaim. Every claim on this page is
local-target-only, like every other Snapback destination it names; it does
not imply hosted parity.

## Quick map

Routes that need no code at all — go straight there:

| Convex / Supabase | Snapback |
| --- | --- |
| Convex dashboard / Supabase Studio | The [admin console](../operating/admin-console.md), opened with `snapback admin --ready-file .snapback/dev.ready.json` (the command `snapback dev --expo` prints as `adminConsoleCommand`) |
| `convex dev` / Supabase local dev | The generate → dev → verify [authoring loop](../getting-started/the-authoring-loop.md) |
| Schema and indexes | [`defineSchema`](../getting-started/your-first-backend.md) |
| Seed functions / SQL seed scripts | [Versioned seed and reset](../backend/versioned-seeds.md) |
| Offline cache | [Retained-query and outbox guarantees](../sync/offline-and-retention.md) |
| A complete app running on Convex, Supabase, and Snapback at once | `demos/partiful-matrix` — see [reactive queries](#reactive-queries) below |

## Deep worked journeys

<a id="protected-live-crud"></a>
### Protected live CRUD, end to end

**Find this page by:** "Convex useQuery", "Supabase RLS", "row level
security", "row-level security", "per-user query", "scoped query",
"hidden data", "row security".

**Use this when** you have a table of per-user rows and need a query that
returns only the signed-in caller's own rows — live, and rejecting any
attempt to pass the owner as an argument.

In Convex, a query function calls `ctx.auth.getUserIdentity()` and filters
by it; the paired React hook is automatically reactive:

```ts fragment reason="illustrative Convex snippet, not CI-run"
// convex/hands.ts
export const myHand = query({
  args: { gameId: v.string() },
  handler: async (ctx, { gameId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ctx.db
      .query("hands")
      .withIndex("by_owner_game", (q) =>
        q.eq("ownerId", identity.subject).eq("gameId", gameId),
      )
      .collect();
  },
});

// App.tsx
const hand = useQuery(api.hands.myHand, { gameId });
```

In Supabase, the scoping lives in a Postgres Row Level Security policy on
the table, evaluated against the caller's JWT, and the client just selects:

```sql fragment reason="illustrative Supabase policy, not CI-run"
-- once, on the `hands` table
create policy "own_hand" on hands
  for select using (auth.uid() = owner_id);
```

```ts fragment reason="illustrative Supabase/js snippet, not CI-run"
const { data: hand } = await supabase
  .from("hands")
  .select("*")
  .eq("game_id", gameId);
```

Snapback's version is a `defineLiveQuery` whose filter is the security
boundary — no owner argument, no RLS policy, no client-side trust:

```js source=demos/card-game/snapback/functions.mjs
  filter: [
    eq('ownerId', authUserId()),
    eq('gameId', arg('gameId')),
  ],
```

The acceptance suite proves it with two real, signed-in principals hitting
the same query and getting disjoint results:

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  const [adaResult, graceResult] = await Promise.all([
    ada.client.query('myHand', { args: { gameId } }),
    grace.client.query('myHand', { args: { gameId } }),
  ]);
  assert.deepEqual(adaResult.rows.map(({ card }) => card), ['ace-spades', 'queen-hearts']);
  assert.deepEqual(graceResult.rows.map(({ card }) => card), ['king-clubs', 'ten-diamonds']);
```

**Structural difference — get this exactly right.** The `eq('ownerId',
authUserId())` predicate above is the entire security boundary, in the
same sense the RLS policy is for Supabase. `authScopeField` (used on the
live-query definition) is a *different* thing: it tells the live matcher
which result field represents the principal, so it can reason about
disjoint subscriptions when rows move in or out of the result set live.
It does not inject a filter and does not scope anything by itself. See
[sessions and principals — "Queries are scoped by the server, not by
arguments"](../auth/sessions-and-principals.md#queries-are-scoped-by-the-server-not-by-arguments)
for the full statement.

The other structural difference: Convex's `useQuery` is automatically
reactive client-side — subscribe and render is one call. Snapback
separates the two: the backend declares a live query
(`defineLiveQuery`), and the client subscribes to it with
[`useSnapbackQuery`](../clients/react.md) — a real seam split, not a
rename, because it lets a non-React client (headless, Swift, another
JS runtime) subscribe to the identical live query with no React in the
picture.

**Not equivalent when** you need a client-supplied identity for
service-to-service or admin tooling — use the
[admin-impersonated CLI lane](../operating/host-ops.md#respect-admin-secret-read-and-impersonation-gates)
or an explicit [agent principal](../auth/agent-principals.md), not a query
argument; passing identity through the request body is rejected outright.

**Verify it yourself:** `demos/card-game/tests/acceptance/authority-scope.mjs`
(runs in the local proof) — it asserts the disjoint result sets above and
that logout blanks only the logged-out principal's live boundary.

**Read next:** [sessions and principals](../auth/sessions-and-principals.md),
[queries](../backend/queries.md), [React client](../clients/react.md).

<a id="expo-media-upload"></a>
### Upload and attach an Expo image under session custody

**Find this page by:** "Supabase Storage", "Convex generateUploadUrl",
"file upload", "image upload", "object storage", "Expo ImagePicker upload".

**Use this when** an app needs to let a signed-in user pick a photo and
attach it to a row, with the server — not the client — owning
finalization, GPS/EXIF stripping, and delivery authorization.

Convex mints a short-lived signed upload URL from a mutation-callable
action; the client POSTs raw bytes to it, gets back a storage ID, then a
second mutation writes that ID onto a document field:

```ts fragment reason="illustrative Convex snippet, not CI-run"
// convex/files.ts
export const generateUploadUrl = mutation(async (ctx) => {
  return await ctx.storage.generateUploadUrl();
});

// client
const postUrl = await generateUploadUrl();
const result = await fetch(postUrl, {
  method: "POST",
  headers: { "Content-Type": file.type },
  body: file,
});
const { storageId } = await result.json();
await saveAvatar({ avatar: storageId }); // a second mutation
```

Supabase uploads a file straight to a bucket from the client (authorized
by Storage RLS policies on `storage.objects`), then stores the returned
path as a plain string column:

```ts fragment reason="illustrative Supabase/js snippet, not CI-run"
const { data, error } = await supabase.storage
  .from("avatars")
  .upload(`${userId}/${file.name}`, file);

await supabase
  .from("profiles")
  .update({ avatar_path: data?.path })
  .eq("id", userId);
```

Snapback declares the upload as a typed intent and the attaching field as
a typed `v.assetRef()`, not a bare string. The whole slice below is one
demo (`demos/expo-golden-path-fixture`): the schema field, the upload
intent it names, and the client flow. First the attaching field:

```js source=demos/expo-golden-path-fixture/snapback/schema.mjs
    messages: defineTable({
      conversationId: v.id('conversations'),
      senderId: v.id('users'),
      kind: v.string(),
      text: v.optional(v.string()),
      image: v.optional(v.assetRef({ upload: 'messageImageUpload' })),
      replyToId: v.optional(v.id('messages')),
      sentAt: v.integer(),
    })
      .index('by_conversation_sent', ['conversationId', 'sentAt'])
      // @ref LLP 0044#asset-read-authorization — this test-persona fixture is
      // intentionally public-read; production chat derives byte authority
      // from admitted conversation membership.
      .assetSharing({ kind: 'public-read' })
      .sync(),
```

Then the upload intent that field names — note the declared media-type
allowlist, the size ceiling, and the image pipeline's explicit
`location: 'strip'`. Public immutable delivery is the recommended performance
default for this deliberately public-read fixture, and remains explicit so
the policy is reviewable:

```js source=demos/expo-golden-path-fixture/snapback/functions.mjs
export const messageImageUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 12_000_000 },
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  image: {
    location: 'strip',
    variants: [{ key: 'chat', width: 1440, required: true }],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

(This fixture deliberately shares bytes `public-read` because its chat
personas are test users; the owner-scoped equivalent of a Supabase
Storage RLS policy is `.assetSharing({ kind: 'owner', field: ... })` —
see [assets](../backend/assets.md) for the sharing kinds.)

On the client, application code hands the picker's own asset straight to
a generated command — no manual `fetch`, no raw upload, no asset id
threaded by hand:

```tsx source=demos/expo-golden-path-fixture/src/screens/chat-screen.tsx
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.86 });
    if (result.canceled || !result.assets[0]) {
      emitG3('picker-cancelled');
      return;
    }
    const picked = result.assets[0];
    emitG3('picker-image-selected', {
      source: 'photo-library-picker',
      uriScheme: picked.uri.slice(0, picked.uri.indexOf(':')).toLowerCase(),
      fileName: picked.fileName ?? null,
      mimeType: picked.mimeType ?? null,
      fileSize: picked.fileSize ?? null,
    });
    try {
      const body = proofEnabled ? G3_IMAGE_BODY : draft.trim() || undefined;
      const outcome = await observeCommand(
        conversation.commands.send({ ...(body ? { body } : {}), image: picked }),
        'picked-image',
      );
```

**Structural differences worth naming.** Ownership is never anonymous,
even when the upload intent's `auth` is `'public'`: every upload attempt
records a non-optional owner principal from `authorize`, and a dev/test
server with no real client session cannot complete a multi-step upload
over the ordinary HTTP surface at all — see
[assets — "Upload and attach"](../backend/assets.md) for the exact
refusal (`SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE`) and the two paved
local-dev answers (impersonated CLI, or a real session). GPS/EXIF
stripping happens server-side, at trusted finalization, on the canonical
bytes — never client-side and never optional-by-omission. And the
attaching field is a typed `v.assetRef()` the storage layer verifies at
commit time, not a bare URL or path string a client could forge.

**Not equivalent when** you need byte-level backup or on-the-fly
transcoding — the [asset capability](../capabilities.md) is explicit that
those remain non-claims here; the pipeline strips location metadata and
produces declared renditions, it does not back up or transcode.

**Verify it yourself:** the golden-path fixture's acceptance run
exercises this exact slice end to end — schema
(`demos/expo-golden-path-fixture/snapback/schema.mjs`), upload intent
(`demos/expo-golden-path-fixture/snapback/functions.mjs`), and the G3
image-command flow in
`demos/expo-golden-path-fixture/src/screens/chat-screen.tsx`.
`packages/snapback-codegen/asset-upload-authoring.test.mjs` pins the
schema/intent authoring rules.

**Read next:** [assets](../backend/assets.md).

<a id="relational-queries"></a>
### Reading related data without hand-writing the wrong join

**Find this page by:** "Convex joins", "Supabase joins", "nested joins",
"joins", "relational queries", "denormalized reads", "materialized views",
"conversation membership", "message sender", "chat joins",
"defineRelationalQuery", "defineMaintainedProjection".

**Use this when** a read is "each row plus its one related row" — a
conversation joined to its model, a message joined to its sender — and you
want that join proven at authoring time instead of hand-rolled.

Convex has no join operator; joins are ordinary JS-side traversal, usually an
indexed lookup per related id:

```ts fragment reason="illustrative Convex snippet, not CI-run"
// convex/conversations.ts
export const listWithModel = query({
  handler: async (ctx) => {
    const conversations = await ctx.db.query("conversations").collect();
    return await Promise.all(
      conversations.map(async (conversation) => {
        const model = await ctx.db
          .query("models")
          .withIndex("by_slug", (q) => q.eq("slug", conversation.model))
          .unique();
        return { ...conversation, modelName: model?.displayName ?? null };
      }),
    );
  },
});
```

Supabase instead exposes the join declaratively, through PostgREST's
foreign-key-derived nested selection:

```ts fragment reason="illustrative Supabase/js snippet, not CI-run"
const { data } = await supabase
  .from("conversations")
  .select("slug, title, model:models(display_name, provider)");
```

These are not one source concept: Convex's shape is imperative traversal
code you write per query; Supabase's is a declarative selection modifier the
client library expands into SQL. Snapback picks a shape by asking whether the
join needs to be re-read on demand or kept durably up to date. For an
on-demand read, `defineRelationalQuery` is a closed, bounded two-source plan
— no SQL text, no callback, proven at generation time:

```js source=demos/competitive-checkpoint/snapback/functions.mjs
export const conversationsWithModel = defineRelationalQuery({
  root: schema.tables.conversations,
  joined: schema.tables.models,
  join: [{ root: 'model', joined: 'slug' }],
  // Left: a conversation whose model is not registered still returns, with
  // null model leaves; the owner evidence rides the root.
  kind: 'left',
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'public-read' },
    output: 'owner',
  },
  projection: {
    slug: { root: 'slug' },
    title: { root: 'title' },
    model: { root: 'model' },
    modelName: { joined: 'displayName' },
    modelProvider: { joined: 'provider' },
  },
  take: 8,
  rootIndex: 'by_owner_created',
  joinedIndex: 'models_by_slug',
});
```

When that same join should instead be a durable, always-current table —
because most reads are "give me the joined row" rather than "recompute the
join now" — the sibling declaration is `defineMaintainedProjection`, which
keeps an output table in sync inside every source mutation's own commit. The
same file declares one right next to this query
(`conversationCardsProjection`); see
[relational queries — "Maintained projections"](../backend/relational-queries.md#maintained-projections)
for that snippet and its fan-out/coupling rules. Pick `defineRelationalQuery`
for an occasional or parameterized read; pick `defineMaintainedProjection`
when the joined shape is what most callers read most of the time and paying
the write-time maintenance cost is worth the read-time win.

**The GAP, plainly.** Both shapes are bounded to exactly two sources and
refuse a self-join outright (the same table cannot be both `root` and
`joined`). Generic multi-way joins, self-joins (reply-preview, reaction
counts), grouping, and aggregation are not hidden relational options here —
they are missing capability. Reach for a hand-written `defineJsLiveQuery`
when a read needs any of those.

**Structural differences worth naming.** The joined side must be provably
unique — `joinedIndex` names a declared `unique` index over exactly the join
key, so cardinality is a codegen-checked fact, not a runtime hope. Visibility
is explicit and separately declared per source and for the output, and the
output can never be broader than a contributing source. A live subscription
on either shape delivers whole-result replacement on any commit that touches
either source — there is no incremental delta.

**Not equivalent when** the read needs more than two sources, a self-join, or
post-join grouping/aggregation — that is a named GAP, not a translation
target.

**Verify it yourself:**
`demos/competitive-checkpoint/tests/acceptance/relational-conversations.mjs`
and `demos/competitive-checkpoint/tests/acceptance/step5-both-helpers.mjs`
(both run in the local proof) exercise `conversationsWithModel` and
`conversationCardsProjection` against the same schema.

**Read next:** [relational queries](../backend/relational-queries.md).

<!-- since: 0.1.23 -->

<a id="ephemeral-presence"></a>
### Typing indicators and cursors: presence vs. broadcast

**Find this page by:** "Supabase Presence", "Supabase Broadcast", "presence",
"cursors", "typing indicator", "ephemeral", "useSnapbackPresence",
"useSnapbackActivityPresence".

**Use this when** you need to show who else is here (online/typing state) or
where their cursor is (high-frequency motion), and you're deciding whether
that's one primitive or two.

Supabase's own docs steer these toward two different primitives. Presence
tracks slower-changing per-client state and syncs a shared roster:

```ts fragment reason="illustrative Supabase/js snippet, not CI-run"
const channel = supabase.channel("room-1");
channel
  .on("presence", { event: "sync" }, () => {
    const state = channel.presenceState(); // { [key]: [{ typing: true }] }
  })
  .subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel.track({ typing: true, user: "ada" });
    }
  });
```

`track()` state is connection-lived until `untrack()`, channel leave, or
disconnect; it does not disappear merely because typing went idle. Snapback's
bound surface presence is the closest lifecycle analogue, with a provider
heartbeat sustaining its TTL lease while mounted. For the extra idle-stop
choreography on both systems, use the
[activity presence recipe](./activity-presence.md) rather than treating TTL as
the inactivity timer.

Broadcast is a fire-and-forget pub/sub message, recommended for high-frequency
state like cursors precisely because it does not maintain roster state:

```ts fragment reason="illustrative Supabase/js snippet, not CI-run"
channel.on("broadcast", { event: "cursor" }, ({ payload }) => {
  renderCursor(payload.userId, payload.x, payload.y);
});
channel.send({ type: "broadcast", event: "cursor", payload: { userId, x, y } });
```

Snapback uses one mechanism for both: a typed ephemeral collection. The base
projection is `useSnapbackPresence`; typing normally uses its activity-scoped
convenience. The messaging demo's dev-mode roster is the direct-client
exception: it must carry the asserted persona and exact room permission on the
subscription, after which publish/delete inherit them:

```tsx source=demos/messaging-snapback/src/lib/useTyping.ts
  const scope = useMemo(() => ({ conversationId }), [conversationId]);
  const permissions = useMemo(
    () => [(SnapbackClient as unknown as {
      roomPermission(prefix: string, permissionScope: Record<string, unknown>): string;
    }).roomPermission('m_conversationMemberships', scope)],
    [scope],
  );
```

Sessions ignores those client assertions and resolves the same identity and
room edge server-side. The transport primitive remains identical; only the
source of authority differs.

And the cursor case is the same ephemeral mechanism over a collection tuned
for high-frequency, small-payload publishes — the difference is entirely in
the collection's declared budget, not a different wire API:

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

**Structural difference worth naming — this is the one that actually
matters, not a rename.** Supabase's two primitives differ in *expiry model*
as much as frequency: Presence state disappears when the client's realtime
connection drops, while Broadcast has no state at all to expire. Snapback's
one mechanism declares both behaviors explicitly: a connection-keyed entry is
reclaimed on disconnect (the removal normally arrives as a delta, much like a
Presence leave), and every entry additionally carries a required `ttlMs`
lease — there is no immortal entry — that bounds how long it can linger if
that remove delta is lost. TTL plus the declared publish budget
(`publishRate`, `delivery`) are the knobs that make one collection behave
"presence-like" (longer TTL, low publish rate — the `typing` collection
above) or "broadcast-like" (short TTL, high-frequency latest-state delivery —
`webCursors`), rather than needing two different wire protocols.

**Not equivalent when** you are relying on removal being
guaranteed-immediate: a remove delta can be lost, and until the `ttlMs`
lease expires peers may still see the stale entry — the lease, not the
disconnect, is the hard staleness bound. Naming this once is enough — see
[ephemeral realtime state](../realtime/ephemeral-state.md) for TTL bounds,
key modes, and the `needs_resync` recovery path, not a claim of
feature-for-feature Presence/Broadcast parity.

**Verify it yourself:** `demos/messaging-snapback/tests/acceptance/headless.mjs`
exercises the typing collection; `demos/cursors-web/tests/acceptance/react-browser.mjs`
and `demos/cursors-web/tests/acceptance/contract-browser.mjs` exercise the
high-frequency `webCursors` collection end to end (both run in the local
proof).

**Read next:** [ephemeral realtime state](../realtime/ephemeral-state.md).

<a id="reactive-queries"></a>
### Reactive queries: useQuery vs. declare-then-subscribe

**Find this page by:** "Convex useQuery", "useQuery", "reactive query",
"live query hook".

**Use this when** you already know Convex's `useQuery` and want the
Snapback shape of "subscribe to a query and re-render on change."

The auth-scoping half of this translation — why Snapback splits the backend
declaration from the client subscription, and what that split buys you — is
already covered in full in
[Protected live CRUD, end to end](#protected-live-crud); this journey does
not repeat it. What's here instead is the bare code shape, then a pointer to
a complete real app instead of another snippet.

Convex's idiomatic call is one line, auto-reactive:

```ts fragment reason="illustrative Convex snippet, not CI-run"
const data = useQuery(api.foo.bar, { arg: 1 });
```

Snapback's call site is the same one-hook shape — a generated operation
reference plus its exact arguments:

```ts source=packages/snapback-react/exact-result-types.fixture.ts
const query = useSnapbackQuery(todos, { owner: 'ada' });
```

Same one-hook-call shape at the call site; the difference is what backs it.
`api.foo.bar` is Convex's query-function reference resolved against a global
client, while `todos` is a generated reference into a backend-declared live
query, and reactivity comes from the mounted `SnapbackProvider` — the
provider owns canonical query identity, subscription lifecycle, and auth
custody, so the hook itself takes no client, provider, or identity
arguments. See [the React client](../clients/react.md) for the
prepare-binding/provider setup that precedes the first hook call.

**If a snippet isn't enough:** `demos/partiful-matrix` is a real,
CI-exercised app — events, RSVPs, and a message wall — built for LLP 0063's
comparative-fairness leg, running against Snapback, Convex, and Supabase
behind one shared provider interface. Its React surface's
`surfaces/react/src/provider.ts` and `surfaces/react/src/convex-direct.ts`
implement that interface for each backend natively (Convex over
`ConvexClient`'s own WebSocket, Snapback over `SnapbackClient.liveQuery`, no
comparison gateway in between), and
`tests/acceptance/convex-realtime-web.mjs` drives both a real Snapback and a
real Convex deployment through the identical rendered app, recording each
provider file's content hash as a `sourceInputs` entry. This is provider
implementation code, not a tutorial — its surfaces subscribe through the
harness's own provider seam (`@partitime/snapback-react`), not the canonical
`@expo/snapback-react` hooks above — so read it as "here is the whole seam,
for both backends, actually running," not as application code to copy.

**Read next:** [Protected live CRUD, end to end](#protected-live-crud),
[the React client](../clients/react.md).

## Anti-patterns

- **Do not treat this page as a symbol dictionary.** A renamed function is
  not the point; each journey above states where the shape actually
  differs and where it does not translate at all.
- **Do not skip the "not equivalent when" boundary.** Following a link
  from here into the authoritative feature page for more depth is
  succeeding, not failing.

---

<!-- snapback-guide-source: guide/recipes/view-once-media.md -->
---
title: "Recipe: view-once media with per-recipient access"
id: recipes.view-once-media
order: 8
audience: agent-first
capabilities: [backend.assets]
authorities: [llp/0220-recipient-bound-asset-grants.plan.md, llp/0210-asset-upload-dx-closure.rfc.md, llp/0044-asset-storage-pipeline.rfc.md, crates/snapback-kernel/src/storage/asset_grants.rs, demos/messaging-snapback/snapback/schema.mjs, demos/messaging-snapback/snapback/functions.mjs, demos/messaging-snapback/tests/acceptance/headless.mjs]
examples: [demos/messaging-snapback]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:b2f44450f65c94d36f116a994a9586c316339fadc42dc0e20ca51f8c17976f9c
---

# Recipe: view-once media with per-recipient access

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this recipe for **view once**, a **disappearing photo**, or other
**ephemeral media** that needs independently revocable **per-recipient
access**. It composes an application-owned consumption record with Snapback's
first-class recipient grant edge. The grant surface is claimed only on the
local target, so this page is partial: a hosted deployment must capability-gate
the feature rather than infer support from the local recipe.

Read [Grant and revoke per-recipient access](../backend/assets.md#grant-and-revoke-per-recipient-access)
for the complete operation, authorization, GC, quota, and delivery semantics.
If a target lacks first-class grants or the application needs filterable grant
metadata as product state, use the separately documented
[portable app-owned grant-row fallback](../backend/assets.md#portable-fallback-app-owned-grant-rows).
Do not implement both authority paths for the same recipient.

The registered [`messaging-snapback` demo](repo:demos/messaging-snapback) is
the executable witness. Its
[`headless.mjs` acceptance suite](repo:demos/messaging-snapback/tests/acceptance/headless.mjs)
proves pending and outsider denial, one successful open, repeated and
race-concurrent second-open refusal from product consumption state, strict
denial after close, two-recipient delete-for-everyone, and close-then-delete.

## 1. Send the view-once or disappearing photo

Attach the asset once and keep that typed reference on the message row. The
reference is storage-integrity state: pending grants confer no authority and
do **not** protect the asset from reference GC. The product rule keeps the
`grants` map private and owner-visible so later close and delete operations can
find only the live edges they own.

The current demo's explicit `public-read` row declaration is a compatibility
boundary, not that product rule: the v1 table-policy IR cannot express its
author-or-recipient JSON-map audience, while its acceptance inspection and
recipient mutation flows must keep working. Handler checks still protect the
demo's operations, but do not copy this declaration into a production view-once
model; use a row-normalized recipient relation with membership/owner policy or
wait for a governed alternate-scope implementation.

The demo's durable model makes those two roles explicit and gives the
consumption record a unique `(message, principal)` identity:

```js source=demos/messaging-snapback/snapback/schema.mjs
export const viewOnceMessages = defineTable({
  conversationId: v.id('conversations'),
  authorPrincipal: v.string(),
  // This typed reverse reference, not the pending grants, protects the asset
  // from reference GC until every recipient has had a chance to open it.
  asset: v.assetRef({ upload: 'viewOnceImageUpload' }),
  // OWNER-VISIBLE liveness bookkeeping: recipient principal -> live grantId.
  grants: v.json(),
  caption: v.string(),
  createdAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_conversation', ['conversationId']);

export const viewOnceConsumptions = defineTable({
  viewOnceMessageId: v.id('viewOnceMessages'),
  principal: v.string(),
  openedAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  // Product state, not asset state: this is what makes a second logical open
  // refuse even while the first activation remains live.
  .index('by_message_principal', ['viewOnceMessageId', 'principal'], { unique: true });
```

The demo's inspection query deliberately exposes this bookkeeping to its
headless suite. That is witness scaffolding, not the product rule: a production
query must keep the grants map owner-visible and let recipients reach only
authorized open/close mutations.

In one authorized owner mutation, attach first, insert the message with its
typed reference, mint one **pending** grant per recipient, and persist the map.
The staged app-row writes and grant operations commit or abort together:

```js source=demos/messaging-snapback/snapback/functions.mjs
export const sendViewOnce = defineJsMutation({
  args: {
    conversationId: v.id('conversations'),
    assetId: v.string(),
    recipients: v.array(v.string()),
    caption: v.optional(v.string()),
  },
  auth: 'authenticated',
  refusals: ['VIEW_ONCE_RECIPIENTS_EMPTY', 'VIEW_ONCE_RECIPIENT_DUPLICATE'],
  result: results.value(v.id('viewOnceMessages')),
  reads: ['conversations'],
  writes: ['viewOnceMessages'],
  handler: async (ctx, args) => {
    const owner = ctx.auth.userId;
    if (args.recipients.length === 0) {
      ctx.refuse('VIEW_ONCE_RECIPIENTS_EMPTY');
    }
    const recipients = Array.from(new Set(args.recipients));
    if (recipients.length !== args.recipients.length) {
      ctx.refuse('VIEW_ONCE_RECIPIENT_DUPLICATE');
    }
    const conversation = await ctx.db.get('conversations', args.conversationId);
    if (!conversation) throw new Error('conversation not found');
    const asset = await ctx.assets.attach(args.assetId, { upload: 'viewOnceImageUpload' });
    const messageId = await ctx.db.insert('viewOnceMessages', {
      conversationId: args.conversationId,
      authorPrincipal: owner,
      asset,
      grants: {},
      caption: String(args.caption ?? '').trim(),
      createdAt: ctx.runtime.now(),
    });
    const grantEntries = [];
    for (const recipient of recipients) {
      const { grantId } = await ctx.assets.grant(args.assetId, recipient, { state: 'pending' });
      grantEntries.push([recipient, grantId]);
    }
    const grants = Object.fromEntries(grantEntries);
    await ctx.db.patch('viewOnceMessages', messageId, { grants });
    return messageId;
  },
});
```

`grants: true` is admission-frozen. Adding it to an upload intent later does
not make already-admitted assets grantable; upload those bytes under the
grant-enabled intent from the start.

## 2. Open ephemeral media exactly once

The recipient's authorized mutation must establish product consumption
**first**, then activate that recipient's pending grant. Verify the caller is
in the private grants map, look up the unique consumption row, refuse if it
exists, insert it, and only then stage `ctx.assets.activate(grantId)`:

```js source=demos/messaging-snapback/snapback/functions.mjs
export const openViewOnce = defineJsMutation({
  args: { viewOnceMessageId: v.id('viewOnceMessages') },
  auth: 'authenticated',
  refusals: ['VIEW_ONCE_NOT_RECIPIENT', 'VIEW_ONCE_ALREADY_CONSUMED'],
  result: results.value(v.boolean()),
  reads: ['viewOnceMessages', 'viewOnceConsumptions'],
  writes: ['viewOnceConsumptions'],
  handler: async (ctx, args) => {
    const principal = ctx.auth.userId;
    const message = await ctx.db.get('viewOnceMessages', args.viewOnceMessageId);
    let grantId = null;
    for (const [recipient, recipientGrantId] of Object.entries(message?.grants ?? {})) {
      if (recipient === principal) grantId = recipientGrantId;
    }
    if (typeof grantId !== 'string') {
      ctx.refuse('VIEW_ONCE_NOT_RECIPIENT');
    }

    // @ref LLP 0220#design-detail-the-recipe-this-plan-pages — product
    // consumption must refuse before activation is staged, so a fresh second
    // open never falls through to SNAPBACK_ASSET_GRANT_STATE_INVALID.
    const consumed = await ctx.db
      .query('viewOnceConsumptions')
      .withIndex('by_message_principal')
      .eq('viewOnceMessageId', args.viewOnceMessageId)
      .eq('principal', principal)
      .first();
    if (consumed) {
      ctx.refuse('VIEW_ONCE_ALREADY_CONSUMED', { openedAt: consumed.openedAt });
    }
    await ctx.db.insert('viewOnceConsumptions', {
      viewOnceMessageId: args.viewOnceMessageId,
      principal,
      openedAt: ctx.runtime.now(),
    });
    await ctx.assets.activate(grantId);
    return true;
  },
});
```

The consumption row is product state, not a substitute spelling of the grant.
A bare second activation refuses separately with
`SNAPBACK_ASSET_GRANT_STATE_INVALID`. A retry with the same mutation
`clientKey` replays the original result. Neither behavior prevents a fresh
second logical open, so the unique consumption check must run before
activation is staged. The unique index also makes concurrent opens settle as
one successful consumption and one application refusal.

## 3. Close one recipient or delete for everyone

These are two distinct verbs.

**Recipient close** revokes only the caller's grant and clears the matching
entry from the owner-visible grants map in the same mutation:

```js source=demos/messaging-snapback/snapback/functions.mjs
export const closeViewOnce = defineJsMutation({
  args: { viewOnceMessageId: v.id('viewOnceMessages') },
  auth: 'authenticated',
  refusals: ['VIEW_ONCE_NOT_RECIPIENT'],
  result: results.value(v.boolean()),
  reads: ['viewOnceMessages'],
  writes: ['viewOnceMessages'],
  handler: async (ctx, args) => {
    const principal = ctx.auth.userId;
    const message = await ctx.db.get('viewOnceMessages', args.viewOnceMessageId);
    let grantId = null;
    for (const [recipient, recipientGrantId] of Object.entries(message?.grants ?? {})) {
      if (recipient === principal) grantId = recipientGrantId;
    }
    if (typeof grantId !== 'string') {
      ctx.refuse('VIEW_ONCE_NOT_RECIPIENT');
    }
    const grants = Object.fromEntries(
      Object.entries(message.grants).filter(([recipient]) => recipient !== principal),
    );

    // @ref LLP 0220#design-detail-the-recipe-this-plan-pages — revoke removes
    // the system edge, so clearing its id in the same mutation keeps a later
    // owner delete-for-everyone from staging an unknown-grant refusal.
    await ctx.assets.revoke(grantId);
    await ctx.db.patch('viewOnceMessages', args.viewOnceMessageId, { grants });
    return true;
  },
});
```

Revoke removes the edge rather than recording a `revoked` state. A later
operation on that `grantId` refuses as unknown, and one staged refusal aborts
the whole mutation. Clearing the map entry is therefore what keeps a later
owner delete executable.

**Owner delete-for-everyone** derives the remaining live grant IDs from that
map, revokes each one, removes the consumption rows, and deletes the message's
typed reference in one mutation:

```js source=demos/messaging-snapback/snapback/functions.mjs
export const deleteViewOnceForEveryone = defineJsMutation({
  args: { viewOnceMessageId: v.id('viewOnceMessages') },
  auth: 'authenticated',
  refusals: ['VIEW_ONCE_NOT_FOUND', 'VIEW_ONCE_NOT_AUTHOR'],
  result: results.value(v.boolean()),
  reads: ['viewOnceMessages', 'viewOnceConsumptions'],
  writes: ['viewOnceMessages', 'viewOnceConsumptions'],
  handler: async (ctx, args) => {
    const message = await ctx.db.get('viewOnceMessages', args.viewOnceMessageId);
    if (!message) {
      ctx.refuse('VIEW_ONCE_NOT_FOUND');
    }
    if (message.authorPrincipal !== ctx.auth.userId) {
      ctx.refuse('VIEW_ONCE_NOT_AUTHOR');
    }
    // The map contains only still-live edges because recipient close clears
    // its entry atomically with revoke.
    for (const grantId of Object.values(message.grants)) {
      await ctx.assets.revoke(grantId);
    }
    const consumptions = await ctx.db
      .query('viewOnceConsumptions')
      .withIndex('by_message_principal')
      .eq('viewOnceMessageId', args.viewOnceMessageId)
      .take(1024)
      .collect();
    for (const consumption of consumptions) {
      await ctx.db.delete('viewOnceConsumptions', consumption._id);
    }
    await ctx.db.delete('viewOnceMessages', args.viewOnceMessageId);
    return true;
  },
});
```

`ctx.assets.revoke` takes one grant ID. Independent grants survive a sibling's
revoke, so revoking one edge and deleting the message would leave every other
recipient authorized. Delete-for-everyone must revoke **every still-live
edge** before removing the typed reference.

Explicit close is not crash-safe. If the recipient process crashes after
activation and before close, the grant stays active until the owner revokes it
or deletes the message. The local surface has no activation TTL or crash lease;
do not claim that this recipe bounds that gap.

## 4. Deliver through the grant alone and revoke media access

The grant must be the recipient's **sole authority path**. Admit the asset with
`grants: true`, an `owner-only` read policy, and `private-strict` delivery so
close or delete denies the next governed byte request:

```js source=demos/messaging-snapback/snapback/functions.mjs
export const viewOnceImageUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  reads: [],
  accept: { mediaTypes: ['image/jpeg', 'image/png'], maxBytes: 8_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  grants: true,
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

A public URL, a recipient-visible `via-references` row, an app-owned fallback
grant row beside the first-class edge, or any other readable reference bypasses
pending activation and revoke. The [Deliver section](../backend/assets.md#deliver)
has the route and cache contract. Under `private-signed`, revoke stops new URL
issuance, but an already-issued bearer URL remains usable until its TTL;
`private-strict` is the profile for next-request denial. Neither profile can
retract bytes already delivered. Do not place view-once bytes in a durable
client, image, filesystem, service-worker, or application cache.

## Limits and capability gate

- **The 1,024-edge ceiling is global per app.** It counts all outstanding
  pending plus active grants across every asset, not the fanout for one
  message. Revoke releases capacity. Sustained large audiences are not a fit
  for per-recipient edges; they belong to the membership-backed authority
  program rather than this recipe.
- **View once is a product behavior, not DRM.** It cannot prevent screen
  capture, another camera, or byte retention after delivery.
- **Grant support is local-only today.** Hosted targets are a nonclaim. Check
  the target's `backend.assets` capability before enabling the product and
  refuse or hide it when recipient grants are absent.

## Anti-patterns

- **Do not give the asset a second recipient-visible authority path.** Use
  either the first-class grant edge or the
  [portable fallback row](../backend/assets.md#portable-fallback-app-owned-grant-rows),
  never both, and keep the message's typed reference owner-only.
- **Do not skip or reorder the unique consumption row.** Activation state and
  `clientKey` replay do not prevent a fresh second logical open.
- **Do not revoke one edge and call the message deleted.** Revoke every
  still-live grant and remove the typed reverse reference in the same owner
  mutation.
- **Do not retain dead grant IDs.** Recipient close removes the edge, so clear
  its owner-visible bookkeeping entry in the same mutation.
- **Do not durably cache view-once bytes.** Revocation controls future governed
  requests, not bytes the client already copied.
- **Do not call explicit close crash-safe or hosted-ready.** The active edge
  survives a crash gap, and the shipped recipient-grant claim is local-only.

---

<!-- snapback-guide-source: guide/recipes/sessions-fixture-install.md -->
---
title: "Recipe: install sessions fixtures with profiles and avatars"
id: recipes.sessions-fixture-install
order: 9
audience: agent-first
capabilities: [auth.passwords, backend.assets]
authorities: [llp/0057-auth-provider-protocol.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0061-agent-first-snapback-guide.rfc.md, llp/0266-coterie-exact-contract-benchmark.plan.md, demos/coterie/snapback/schema.mjs, demos/coterie/snapback/functions.mjs, demos/coterie/snapback/seed-m1.mjs]
examples: [demos/coterie]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-17
reviewed-authorities-digest: sha256:31512f6cc26158c28004237b72dafe2261f13253628e5a1675164ebfb29caae7
---

# Recipe: install sessions fixtures with profiles and avatars

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this recipe when one deterministic fixture in a sessions-mode app must
include a real password account, a principal-owned application profile, and
typed media. A [versioned seed](../backend/versioned-seeds.md) cannot contain
captured principal ids, and a raw seed asset id would bypass the ordinary
asset lifecycle. The paved composition is therefore one app-owned,
idempotent installer that uses an ordinary session for every fixture identity.

This is one **logical install**, not one database transaction. Account signup,
profile mutation, upload finalization, and typed attachment settle at their
ordinary boundaries. If a run stops midway, the same installer resumes through
its match-or-repair checks.

## Give each fixture its own ordinary session

Read personas and media digests from committed fixture inputs. For each
persona, create a client with its own custody partition, then close that auth
context before advancing. Coterie uses the same `AuthCoordinator` and
`SnapbackClient` path as application auth; no admin impersonation or seeded
principal id enters the flow:

```js source=demos/coterie/snapback/seed-m1.mjs
function createPasswordClient(baseUrl, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId: schemaManifest.appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
    rqsStore: null,
    offlineQueue: false,
  });
  return { client, coordinator };
}
```

The backend profile shape must bind ownership to `ctx.auth.userId`, expose an
owner-scoped lookup with no caller-supplied owner argument, and attach avatars
through a restricted `v.assetRef`. Coterie's `ensureMyProfile` derives
`ownerId` from server authority, while `attachMyAvatar` rechecks profile
ownership and calls `ctx.assets.attach(..., { upload: 'avatarUpload' })`.

## Verify fixture media before reporting a match

Pin a fixture-source digest independently of Snapback's asset record. Coterie
loads the expected SHA-256 from the committed media manifest, hashes the local
bytes before any request, and later requires the profile's
`avatarSourceDigest` to equal that value:

```js source=demos/coterie/snapback/seed-m1.mjs
function expectedAvatarDigest(persona) {
  const filename = basename(persona.profile.avatar);
  const digest = mediaManifest.artifacts?.[filename]?.sha256;
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`fixture ${persona.id} has no expected avatar digest for ${filename}`);
  }
  const bytes = readFileSync(join(fixtureRoot, persona.profile.avatar));
  const observed = createHash('sha256').update(bytes).digest('hex');
  if (observed !== digest) {
    throw new Error(`fixture ${persona.id} avatar bytes do not match ${digest}`);
  }
  return digest;
}
```

A match also requires a ready, end-to-end-verified asset record. Do not call an
account a match merely because its email already exists, or because the
profile carries some nonempty asset id.

## Sign up first; on existence, sign in and prove the whole fixture

Attempt password signup on the first install. If it succeeds, the client owns
the new ordinary session and proceeds to application writes. The only
duplicate-account branch accepted is `SNAPBACK_AUTH_PASSWORD_EXISTS`; on that
code, sign in with the fixture password and inspect the owner-scoped profile:

```js source=demos/coterie/snapback/seed-m1.mjs
      let accountDisposition = 'created';
      let rows = [];
      try {
        await fixture.client.authPasswordSignup({
          email: persona.email,
          password: persona.password,
        });
      } catch (error) {
        if (diagnosticCode(error) !== 'SNAPBACK_AUTH_PASSWORD_EXISTS') throw error;
        const signin = await fixture.client.authPasswordSignIn({
          email: persona.email,
          password: persona.password,
        });
        rows = (await fixture.client.query(generatedApi.getMyProfile, { args: {} })).rows;
        const current = rows[0];
        const fixtureMatches = rows.length === 1
          && current
          && current.ownerId === signin.session.userId
          && current.fixtureId === persona.id
          && current.handle === persona.profile.handle
          && current.displayName === persona.profile.displayName
          && current.bio === persona.profile.bio
          && current.location === persona.profile.location
          && current.link === persona.profile.link
          && await avatarMatchesFixture(fixture.client, current, avatarDigest);
        if (fixtureMatches) {
          accounts.push({ id: persona.id, email: persona.email, disposition: 'matched' });
          profiles.push(profileSnapshot(current));
          continue;
        }
        accountDisposition = 'repaired';
      }
```

The `continue` is the idempotence boundary: a matched repeat performs the
password sign-in and read-only verification, then performs **no asset upload
and no application write**. Wrong passwords, multiple owner rows, owner
mismatch, fixture-field drift, missing media, or digest drift never report
`matched`; they fail or enter the explicit repair path.

## Create or repair the profile, then upload and attach ordinarily

Use one server-authorized ensure mutation for the application row. Re-read the
owner-scoped profile and confirm the returned id. Upload only when the current
typed avatar does not already match the fixture digest; require the upload task
to reach `ready`, then attach the asset through the application mutation:

```js source=demos/coterie/snapback/seed-m1.mjs
      const profileId = (await fixture.client.mutate(generatedApi.ensureMyProfile, {
        args: {
          fixtureId: persona.id,
          handle: persona.profile.handle,
          displayName: persona.profile.displayName,
          bio: persona.profile.bio,
          location: persona.profile.location,
          link: persona.profile.link,
        },
      })).result;

      rows = (await fixture.client.query(generatedApi.getMyProfile, { args: {} })).rows;
      if (rows.length !== 1 || rows[0]._id !== profileId) {
        throw new Error(`fixture ${persona.id} did not resolve its own profile`);
      }
      if (!await avatarMatchesFixture(fixture.client, rows[0], avatarDigest)) {
        const bytes = readFileSync(join(fixtureRoot, persona.profile.avatar));
        const assets = createAssetClient(fixture.client);
        const upload = assets.start({
          upload: generatedApi.avatarUpload,
          file: new Blob([bytes], { type: 'image/png' }),
          declaredFilename: `${persona.id}-avatar.png`,
          declaredContentType: 'image/png',
        });
        const terminal = await upload.done;
        if (terminal.status !== 'ready') {
          throw new Error(`fixture ${persona.id} avatar failed: ${JSON.stringify(terminal.diagnostic ?? terminal)}`);
        }
        await fixture.client.mutate(generatedApi.attachMyAvatar, {
          args: {
            profileId,
            assetId: terminal.assetId,
            sourceDigest: avatarDigest,
          },
        });
        rows = (await fixture.client.query(generatedApi.getMyProfile, { args: {} })).rows;
      }
```

Finish by repeating the whole avatar match predicate before emitting the
report. Use `created`, `repaired`, and `matched` as distinct dispositions;
only `matched` promises the no-write repeat path.

## Anti-patterns

- **Do not seed captured principal ids.** Install real accounts through
  password signup and let server-derived session authority own the profile.
- **Do not treat `SNAPBACK_AUTH_PASSWORD_EXISTS` as success by itself.** Sign
  in and verify owner, fixture fields, source digest, and asset readiness.
- **Do not upload before the match check.** A matched repeat must perform no
  upload and no application mutation after sign-in.
- **Do not store a raw asset id in the profile.** Finalize through the ordinary
  asset client and attach through the typed, owner-authorized mutation.
- **Do not call this atomic.** It is restart-safe application installation;
  each account, mutation, upload, and attach keeps its own settlement boundary.

---

<!-- snapback-guide-source: guide/recipes/fixed-origin-development.md -->
---
title: "Recipe: fixed-origin development and attach"
id: recipes.fixed-origin-development
order: 10
audience: agent-first
capabilities: [operating.packaged-dev-loop]
authorities: [llp/0041-packaged-dev-loop.rfc.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0223-zero-config-connect-and-knowledge-closure.plan.md, llp/0224-prepared-standalone-operation.rfc.md, crates/snapback-activation/src/operational_readiness.rs, crates/snapback-server/src/server.rs, packages/snapback-cli/index.mjs, packages/snapback-cli/expo-dev.mjs, packages/snapback-vite/index.mjs, packages/snapback-vite/lifecycle.mjs, packages/snapback-expo/provider.mjs, packages/snapback-expo/supervised-environment.mjs]
examples: [packages/snapback-cli/dev-loop.test.mjs, packages/snapback-cli/sessions-dev-loop.test.mjs, packages/snapback-vite/package.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:292afba7d581f22c9589ba1001a721982aac4a31981bb4e036132804ee06b148
---

# Recipe: fixed-origin development and attach

> **Local target only.** This page describes an explicitly owned development
> server. It is not a hosted deployment recipe.

Use this route when a test, browser shell, or native harness must keep one
backend origin stable while generated artifacts continue to change. Ordinary
`snapback dev` selects a free port. Its fixed profile keeps the same lifecycle
owner while pinning the backend port and declaring the separately owned client
origin.

## Run one fixed-profile development loop

For a Vite client on port 5173 and a backend pinned to 42080:

```sh
snapback dev snapback \
  --port 42080 \
  --external-client-origin http://127.0.0.1:5173
```

Snapback owns the backend child and generate/load watcher. It adds the declared
client origin to the exact development **request-body origin admission** used by
auth and other authority-bearing dev requests; `SNAPBACK_DEV_AUTH_ORIGINS` does
not define `/health` CORS, which is loopback-open and therefore is not evidence
that a client origin reached the admission set. Snapback does not launch or stop
the Vite process. Start that client with its own normal command in another
terminal.

The declared origin must equal the browser's actual Vite origin. A Vite server
bound as `127.0.0.1` is not the `localhost` origin even when both reach the same
machine. The authoritative receipt records the server's full normalized
admission set: the declared origins, valid ambient
`SNAPBACK_DEV_AUTH_ORIGINS`, and any provider-owned aliases.

Re-running the same command with `--attach` is idempotent only for the exact
intended lifecycle:

```sh
snapback dev snapback --attach \
  --port 42080 \
  --external-client-origin http://127.0.0.1:5173
```

Attach validates the host descriptor and live startup nonce, then compares the
owner-only receipt's application deployment, authority settlement, artifacts,
target profile, capability digest, actual client origins, app binding,
qualified native binary, and CLI wrapper with fresh live operational readiness
before it changes the listener. A stale listener or wrong binding refuses
without adopting, killing, or replacing the process. An expired binding on an
otherwise matching cut is reissued rather than treated as a foreign child.
Closing an attached handle never shuts down the original owner's child.
`SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER` means the port actually accepts
connections but does not expose the intended receipt-bound lifecycle.
`SNAPBACK_DEV_FIXED_PORT_STALE_DESCRIPTOR` instead means the ready descriptor
appears stale because the pinned port refused the connection at probe time;
remove the named descriptor and rerun `snapback dev` without `--attach` to start
fresh. A timeout or any other socket error preserves the descriptor and reports
`SNAPBACK_DEV_SERVER_ATTACH_FAILED` with the underlying probe error.
`SNAPBACK_DEV_FIXED_BINDING_MISMATCH` names a live lifecycle whose admitted
binding facts differ from the request, and
`SNAPBACK_DEV_APPLICATION_READY_STALE` names a same-host receipt that differs
from live application or authority facts.

Do not infer readiness or origin from logs. The host descriptor names the
listener; its deterministic `<ready-file>.application-ready` sibling is the
authoritative `snapback.application-ready.v1` settlement and admission
receipt.

## Preserve the sessions startup carrier

The lifecycle owner writes the complete sessions startup carrier before first
bind and rewrites it on every successful regenerate before hot-load. An
additive successor preserves the database, accounts, custody, sessions, and
client stores while advancing the complete active deployment identity. The
event stream reports the old and new identities; continuity does not mean
identity equality. `dev-fresh` is the explicit destructive verb and is never
implied by regenerate or attach.

`snapback start --startup-artifacts ...` remains available for lower-level
diagnosis and lifecycle acceptance harnesses. It is not the application
authoring path and shifts carrier correctness and process ownership to the
caller.

## Bind a separately owned client honestly

For web, `@expo/snapback-vite` managed/auto mode invokes this same fixed
profile. Configure `setup.backendDirectory` and the plugin's backend `port`;
Vite pins its own loopback port with `strictPort`, declares that client origin,
and consumes the application receipt. `virtual:snapback/dev` projects the
receipt-issued binding through the same-origin relay. It does not manufacture
binding provenance or expose the private backend origin, receipt path, or
qualified-binary facts to browser code.

The default `SnapbackExpoProvider` is supervisor-owned. A raw `{ origin }` or
raw binding override is not a supported substitute for its admitted
environment and can refuse as binding unavailable or with
`SNAPBACK_APP_BINDING_OVERRIDE_UNCONFIRMED`. For a separately owned native
Expo process, the application shell must own a complete admitted
`SnapbackExpoEnvironmentV1` (binding plus authority/custody lifecycle), or use
the lower-level app client with that admitted binding. There is currently no
safe “just pass the fixed URL” shortcut.

The supervised Expo profile declares Metro's `127.0.0.1`, `[::1]`, and
`localhost` loopback aliases into `runDev` before backend start. The Rust
server's consumed dev-body origin set is therefore the set written to the
receipt. Expo keeps
its device-route binding in owner-only transient `expo-supervisor.json` and the
rendezvous response; it never writes that projection back into the
application-ready file. Those are inspection/admission projections; attach
still trusts the application receipt.

## Anti-patterns

- Starting a second public lifecycle with `snapback start` for ordinary app
  authoring.
- Running `--attach` without the exact live ready descriptor and database.
- Treating port occupancy as server identity or deleting a stale listener on
  attach refusal.
- Parsing server logs instead of consuming the host and application receipts.
- Passing a raw origin to `SnapbackExpoProvider` or weakening binding
  admission after an override refusal.
- Hand-editing `startup-artifacts.json`, binding environments, or `.env*`
  origins instead of declaring the fixed profile.

---

<!-- snapback-guide-source: guide/recipes/multi-persona-clients.md -->
---
title: "Recipe: multiple Node personas and storage partitions"
id: recipes.multi-persona-clients
order: 11
audience: agent-first
capabilities: [clients.headless, auth.sessions, auth.browser-session-custody]
authorities: [llp/0059-session-projection-and-client-barrier.spec.md, llp/0219-client-dev-diagnostics-channel.rfc.md, llp/0258-first-party-application-auth-bootstrap.rfc.md, llp/0295-published-matrix-improvement-program.plan.md, packages/snapback-client/app-client-defaults.mjs, packages/snapback-client/app-client.mjs, packages/snapback-client/app-client.d.mts, packages/snapback-client/app-client.test.mjs, scripts/check-guide-multi-persona-clients.mjs]
examples: [tests/fixtures/guide-multi-persona-clients/multi-persona-clients.mts, packages/snapback-client/app-client.test.mjs, demos/messaging-snapback/tests/acceptance/headless.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:d56068f2769d0ee7471e5c73374a68201d6530108e5c480db2ca34b3fff6e9b2
---

# Recipe: multiple Node personas and storage partitions

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

In one Node process, `createSnapbackAppClient` deliberately shares durable
auth custody for the same application and storage partition. The default
partition is literally `"default"`. That is useful for two handles belonging
to one persona, but wrong for an acceptance harness, bot runner, or seed replay
that represents several users. Without explicit partitions, every persona can
restore and write as the last principal in the shared default custody — the
classic “every persona wrote as Henry” failure.

In the diary's vocabulary, durable custody is “process-global in Node” unless
the multi-persona harness selects distinct partitions.

> **Multiple clients can mean the same session.** If personas share login, a
> second client can have the same user because both calls omitted
> `storagePartition` and selected the default owner. Separate JavaScript
> objects do not separate custody. The common symptom searches are “multiple
> clients same session,” “personas share login,” and “second client same
> user.”

## Fix “multiple clients same session” with a stable partition per persona

The “second client same user” symptom has the same repair.

Choose a deterministic, non-secret partition per logical actor and worker, and
pass it at construction. The packed external fixture imports the current root
constant spelling, `DEFAULT_AUTH_STORAGE_PARTITION`, and rejects accidental
use of it:

```ts source=tests/fixtures/guide-multi-persona-clients/multi-persona-clients.mts
import {
  DEFAULT_AUTH_STORAGE_PARTITION,
  createSnapbackAppClient,
} from '@expo/snapback-client';

type AppClientInput = Parameters<typeof createSnapbackAppClient>[0];
type PersonaClientInput = Omit<AppClientInput, 'rqsStore' | 'storagePartition'>;

export async function createAcceptancePersonas(
  input: PersonaClientInput,
  workerId: string,
) {
  const uncheckedInput = input as AppClientInput;
  if (uncheckedInput.storagePartition === DEFAULT_AUTH_STORAGE_PARTITION) {
    throw new Error('do not pass DEFAULT_AUTH_STORAGE_PARTITION to a multi-persona helper');
  }
  if (Object.hasOwn(uncheckedInput, 'rqsStore')) {
    throw new Error('multi-persona clients must not share one injected rqsStore');
  }
  const partitionFor = (persona: string) => `acceptance:${workerId}:${persona}`;
  const henryPartition = partitionFor('henry');
  const miaPartition = partitionFor('mia');

  const [henry, mia] = await Promise.all([
    createSnapbackAppClient({
      ...input,
      storagePartition: henryPartition,
    }),
    createSnapbackAppClient({
      ...input,
      storagePartition: miaPartition,
    }),
  ]);
  return { henry, mia };
}
```

The custody owner key is `(app identity, storagePartition)`. Reusing a
partition means “same persona, shared durable session”; changing it means
“different persona, isolated durable session.” The value must be non-empty,
at most 128 characters, and contain no NUL. It is an isolation label, not a
password, principal assertion, or server-side authorization boundary.

Sign in each client independently, wait for its authority to settle, and
assert `henry.auth.currentPrincipal().userId` before performing
persona-labelled writes. That assertion catches an accidentally reused
partition at the test boundary instead of after corrupted expectations.

The helper also refuses an explicitly injected `rqsStore`. Because `...input`
would pass the same store object to both clients, distinct auth partitions would
still share one live/queued-work store. If a harness needs injected stores,
construct each persona separately with a distinct store whose lifetime matches
that persona's auth custody.

Dispose every app client at teardown. Durable state intentionally survives
that disposal, so reuse the same partition only when a later run is meant to
restore the same actor. Give parallel test workers an additional stable worker
prefix when they must not share custody.

## Read the implicit-reuse warning

In Node, multiple implicit-default handles emit one bounded warning on the
shared client's diagnostics channel when their durable owner is authenticated.
This covers both create → sign in → create and create → create → sign in:

`SNAPBACK_AUTH_STORAGE_PARTITION_IMPLICIT_REUSE`

The warning does not refuse construction, log credentials, change custody, or
guess that two callers represent different people. It names the default
partition, this guide page, and the supported repair: pass one stable explicit
`storagePartition` per persona or worker. It does not fire for explicit
partition reuse, anonymous custody, or volatile custody.

## Anti-patterns

- Creating multiple Node clients without `storagePartition` and assuming
  object identity isolates their sessions.
- Passing `DEFAULT_AUTH_STORAGE_PARTITION` as the per-persona value; that
  explicitly asks every persona to share the default durable session.
- Passing one injected `rqsStore` through shared `...input`; auth partitions do
  not partition a deliberately shared live/queued-work store.
- Using a display name as authorization evidence instead of checking the
  settled principal.
- Generating a fresh random partition on every boot when session restoration
  is part of the test.
- Treating a storage partition as a server-side tenant or permission scope.

---

<!-- snapback-guide-source: guide/recipes/auth-transition-writes.md -->
---
title: "Recipe: writes during authentication transitions"
id: recipes.auth-transition-writes
order: 12
audience: agent-first
capabilities: [clients.outbox-drain, clients.mutation-outcomes, auth.invalidation-barrier]
authorities: [llp/0043-offline-replay-retention.rfc.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0218-outbox-settlement-contract.rfc.md, packages/snapback-client/index.mjs, packages/snapback-client/outbox-shared.mjs, packages/snapback-client/rqs-store-sqlite.mjs, packages/snapback-react/implementation.mjs, packages/snapback-client/authority-transition-conformance.test.mjs, packages/snapback-client/authorization-invalidation.test.mjs, packages/snapback-client/generated-optimistic-default.test.mjs, packages/snapback-client/outbox-drain.test.mjs, packages/snapback-client/outbox-store.test.mjs, scripts/auth-settlement-packed-proof.mjs, scripts/check-guide-auth-settlement-packed-proof.mjs]
examples: [packages/snapback-client/authority-transition-conformance.test.mjs, packages/snapback-client/authorization-invalidation.test.mjs, packages/snapback-client/generated-optimistic-default.test.mjs, packages/snapback-client/outbox-drain.test.mjs, packages/snapback-client/outbox-store.test.mjs, scripts/auth-settlement-packed-proof.mjs, demos/browser-local-first]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:147f274f197b8fb2e15b67c559278c0858f9505d608634b3e7acaf8d24da0fdf
---

# Recipe: writes during authentication transitions

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Login, logout, refresh, and bearer replacement create a real authority
barrier. Protected subscriptions blank and foreground sends may pause while
the predecessor is retired and the successor is proven. A background effect
that writes during that interval can receive
`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`; this is a custody signal, not a
content refusal and not evidence that the mutation reached the server.
This includes the reproduced “eager route-entry receipt” and broader
“background writes during auth transitions” cases, as well as an
authorization-suspended foreground gesture.

In the vocabulary builders actually searched, this is the **write after login**,
**mutation during sign-in**, **outbox suspended**, or **background write auth**
recipe.

## Read the settlement state first

The shipped generated-client vocabulary distinguishes a stable signed-out
state from an authority transition. `blocked:authentication-required` and
`blocked:authentication-not-settled` below are compact spellings for the two
field pairs, not single status strings:

| Situation | Protected live-query state | Imperative one-shot refusal | Caller response |
| --- | --- | --- | --- |
| Settled signed out | `status: "blocked"`, `reason: "authentication-required"`, `transitionOwner: "auth-coordinator"` | `SNAPBACK_AUTH_REQUIRED` with `reason: "authentication-required"` and `diagnostic.details.transitionOwner: "auth-coordinator"` | Keep the intent undispatched; ask for authentication. Do not start a retry timer. |
| Signing in or signing out | `status: "blocked"`, `reason: "authentication-not-settled"`, `transitionOwner: "auth-coordinator"` | `SNAPBACK_CLIENT_AUTHORITY_CLEARING` with `reason: "authentication-not-settled"` and `diagnostic.details.transitionOwner: "auth-coordinator"` | Wait for the in-flight auth operation to settle. No transport was issued. |
| Settled signed in | `ready` or `refreshing` | admitted | Dispatch under the settled principal. |
| Terminal auth failure | `status: "error"` with `transitionOwner: "auth-coordinator"` | the recorded terminal code | Stop automatic retry, restore the control, and render/report the terminal diagnostic. |

A protected live query leaving `blocked:authentication-not-settled` is a
useful framework-visible settlement observation. Awaiting the sign-in or
sign-out call is the corresponding gesture-owned barrier. Do not invent a
second timer, a `waitForAuthSettlement` API, or a private coordinator probe.

## Prefer queueable generated mutations

For receipts, route-entry bookkeeping, feed acknowledgements, and other
background work that remains meaningful after the same logical user settles,
use the default queueable generated mutation path. In React,
`useSnapbackMutation(reference)` uses the `queue: "auto"` behavior and returns
the truthful `settled | queued` union. Call the hook with no `queue` option —
the React hook admits only omitted `queue` or `queue: false`
(`useSnapbackSettledMutation` is the settled-only spelling); passing
`queue: "auto"` or `queue: true` to the hook throws a `TypeError`. Those
option spellings belong to the headless `client.mutate()` surface only. On the local target with a qualified
outbox and settlement ledger, accepted intent held behind the authorization
barrier resolves `queued`; the headless outcome additionally reports
`authorizationDisposition: "authorization-suspended"`. The outbox drain
resumes only after authority proof. Render that branch as pending and observe
the mutation settlement rather than declaring success.

`queue: "auto"` is capability-sensitive: without a qualified outbox it
degrades to `queue: false` and rejects instead of pretending the intent is
durable. Explicit `queue: true` requires outbox support.

## Declare only genuine housekeeping

The headless client has a separate shipped lane for background work that is
idempotent, latest-wins for one stable key, and valid under the successor
principal:

```js fragment reason="illustrative application declaration; function references and route keys are app-specific"
const outcome = await client.mutate(refreshRouteReceipt, {
  args: { route: "/inbox" },
  housekeeping: {
    key: "route-inbox",
    idempotent: true,
    successorValid: true,
  },
});
```

During an active auth barrier, that exact declaration may resolve `queued`
with `blockedReason: "auth-barrier"`; it performs zero transport until the
successor settles. A later pending record with the same key supersedes the
older one, whose `mutationStatus(clientMutationId)` becomes `failed` with
`SNAPBACK_HOUSEKEEPING_SUPERSEDED`. Do not mark a user gesture as
housekeeping: ordinary foreground query/mutation admission promptly refuses
with `SNAPBACK_CLIENT_AUTHORITY_CLEARING` during the barrier.

In compact terms: declare `{ key, idempotent: true, successorValid: true }`
only for latest-wins housekeeping. `blockedReason: auth-barrier` means zero
transport. Observe `SNAPBACK_HOUSEKEEPING_SUPERSEDED` through mutation status.

Foreground and housekeeping transports are independent lanes. A suspended or
slow housekeeping request does not head-of-line block a replayable foreground
record; authority/root cuts remain exclusive across both. Cross-lane ordering
is not promised: foreground admission is independent of suspended housekeeping.

Predecessor work is reconciled before successor observation. Anonymous →
authenticated, dev → sessions, and same-user/new-session intent strands for
explicit discard or re-record. A → B, authenticated → anonymous, sessions →
dev, and authorization-stream incarnation changes privacy-delete predecessor
intent. No stranded record is automatically sent under the successor.

Capture the logical intent once. Do not let a React effect manufacture a new
mutation id on every auth snapshot or retry tick. After a principal change,
the outbox custody rules may strand or privacy-delete predecessor work; follow
the reported disposition rather than silently replaying it as the successor.

## Fence non-queueable gestures

A foreground operation declared with `queue: false` rejects locally while
authority is suspended and does not reach transport. This includes
`useSnapbackSettledMutation` and Familiar `useMutation`. Disable or defer the
gesture while its sign-in/sign-out promise is in flight or its protected query
state is `blocked:authentication-not-settled`.

If a race still makes an interactive feed mutation reject with
`SNAPBACK_CLIENT_AUTHORITY_CLEARING` or
`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`, keep the same logical intent, wait
for that barrier to settle once, and offer or perform one bounded retry only
if the resulting principal is still the intended actor. A
`SNAPBACK_AUTH_REQUIRED` result after settlement is not another transient
attempt: return the gesture to an enabled state and route the user to sign-in.

Every dispatched promise must be awaited or have a rejection handler attached
immediately. An event handler that starts async work must end in an observed
`try`/`catch` path (or attach `.catch(...)` at dispatch), including the final
retry. Always restore disabled/pending UI in `finally`. This makes the
authorization race a rendered terminal branch instead of an unhandled rejection
that leaves the Expo error overlay intercepting later gestures.

Treat every terminal branch explicitly: success, queued, application refusal,
auth terminal status, and genuine transport/lifecycle failure. An uncaught
authorization-suspended rejection can poison a route even though the system is
behaving correctly.

The run that exposed the poisoned overlay also used six live subscriptions.
Consolidating them removed its repeated trigger, but that behavior remains a
separate open contention investigation:
[the retained ticket](repo:issues/20260820-familiar-live-subscription-contention.md).
This recipe settles the foreground promise safely; it does not classify the
subscription behavior or make one aggregate query a universal requirement.

## What proves this contract

The [packed-external settlement fixture](repo:scripts/auth-settlement-packed-proof.mjs)
is executed by the Guide check against freshly packed Contract, client, and
React packages and proves the
signed-out, signing-in, signed-in, signing-out, and revoked rows for both
one-shot and live-query projections. Its retained tarball-integrity receipt is
in the [signed-out settlement closure](repo:issues/closed/20260820-authenticated-query-signed-out-settlement.md).

```js source=scripts/auth-settlement-packed-proof.mjs
const result = Object.freeze({
  oneShot: await proveOneShots(),
  live: await proveLive(),
  modePendingReload: await proveModePendingReload(),
  housekeeping: await proveHousekeepingBarrier(),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
```

That packed closure stops at the advertised settlement spelling: it does not
exercise mutation queueing or a component event handler. Those promises are
separately CI-enforced by the client package suite. In
[`generated-optimistic-default.test.mjs`](repo:packages/snapback-client/generated-optimistic-default.test.mjs),
“generated read-free insert cannot repaint after authorization quarantine”
proves the default generated mutation resolves `queued` with
`authorizationDisposition: "authorization-suspended"`. In
[`authorization-invalidation.test.mjs`](repo:packages/snapback-client/authorization-invalidation.test.mjs),
“client-owned outbox suspension” independently proves explicit queueing does
not cross transport, while “offlineQueue:false persists live roots” proves
`queue: false` rejects with `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` before
transport. In
[`outbox-store.test.mjs`](repo:packages/snapback-client/outbox-store.test.mjs),
“default foreground mutation without an explicit id” independently pins the
same no-transport foreground rejection and the item-5 strand/delete rows.
[`authority-transition-conformance.test.mjs`](repo:packages/snapback-client/authority-transition-conformance.test.mjs)
proves declared housekeeping queues under `auth-barrier` with zero transport,
and [`outbox-drain.test.mjs`](repo:packages/snapback-client/outbox-drain.test.mjs)
holds a real housekeeping fetch while a later replayable foreground record
enters and settles transport. SQLite's focused store suite pins the same lane
gate and authorization-generation CAS on the Expo carrier.

## Anti-patterns

- Dispatching from an effect whose dependency is a mutation function or
  changing auth object; effect identity changes can turn one intent into
  repeated writes.
- Fire-and-forget foreground dispatch with no rejection handler; the first
  auth refusal can poison the development UI.
- Converting authorization suspension into a content refusal or “server
  failed” message.
- Assuming a foreground rejection means the mutation may already have
  committed.
- Re-recording predecessor work under a successor principal without the
  explicit stranded-intent workflow.
- Hiding queued status and declaring success before settlement.

---

<!-- snapback-guide-source: guide/recipes/activity-presence.md -->
---
title: "Recipe: activity presence, heartbeats, and withdrawal"
id: recipes.activity-presence
order: 13
audience: agent-first
capabilities: [realtime.ephemeral]
authorities: [llp/0013-ephemeral-realtime-state.rfc.md, llp/0257-activity-scoped-presence-convenience.rfc.md, llp/0310.000-successor-identity-and-paved-loop-repair.rfc.md, packages/snapback-react/index.mjs, packages/snapback-react/implementation.mjs, packages/snapback-expo/activity-presence.mjs, scripts/activity-presence-vertical-contract.mjs]
examples: [demos/messaging-snapback, packages/snapback-cli/templates/expo-chat, tests/fixtures/activity-presence-vertical]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:5c414006932d9f0eb514956db50a553409b41e37225216f041f93dd64b12c598
---

# Recipe: activity presence, heartbeats, and withdrawal

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback presence is an ephemeral lease. The key rule is: **a surface presence
value is a continuous publish**. A value other than `skip` bound through
`useSurface(surface, params, { presence: { typing: value } })` remains desired
while that binding is mounted, so the provider heartbeat keeps renewing it. A
five-second TTL or acceptance ceiling does not make that value disappear after
five seconds of no typing. Bound withdrawal is `skip`; `null` is a value publish
attempt and fails the generated value contract.

For URL-first web under a bare `SnapbackProvider`, import
`useSnapbackActivityPresence` from `@expo/snapback-react`; that is the paved
choice. Under a bare `SnapbackProvider`, the React hook has no
AppState-driven background withdrawal, so backgrounded typing intent expires
by the presence deadline rather than being withdrawn immediately. There is no
third activity-presence hook.
The `@expo/snapback-expo` facade of the same name is the *gated* variant: it
adds AppState-driven background withdrawal. It does **not** require a
`SnapbackExpoProvider` tree — the Expo lifecycle context is optional, and under
a bare `SnapbackProvider` on web the facade resolves `react-native-web`'s
`AppState` through LLP 0257's fallback ([the bare-provider probe](repo:tests/probes/expo-presence-bare-provider-20260826/summary.md)). Choose between
the two by whether you want immediate background withdrawal on web, not by
which provider you mounted.

This is the usual cause of a “typing indicator stuck” or “presence not
expiring” report. The heartbeat-vs-bound-value decision comes before choosing
a TTL:

Search vocabulary: typing indicator stuck; presence not expiring; track() equivalent; supabase track; presence heartbeat; surface presence value is a continuous publish.

- **Continuous bound value:** keep publishing while the component and scope
  are active. Use for “online in this room” when mounting is the activity.
- **Activity-driven value:** use `useSnapbackActivityPresence` when input,
  focus, pointer, or another activity signal should touch the lease. It owns
  the absolute idle deadline and calls the delete path after that window; the
  provider owns presence heartbeat/renewal.
- **Explicit event:** call the presence publisher on activity and the delete
  path on blur, send, cancel, scope change, or unmount. Use this in a
  headless/adapter owner that already owns those transitions.

For a typing indicator, the supported spelling is touch-on-keystroke and
delete-on-idle. `withdraw()` is the helper's explicit delete action for send,
clear, blur, room change, and dispose:

```ts source=tests/fixtures/activity-presence-vertical/client-projection.ts
export function TypingComposer() {
  const presence = useSnapbackActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => ({ userHandle: 'ada', name: 'Ada' }),
    idleMs: 3_000,
  });

  const onKeystroke = () => presence.touch();
  const onClearOrSend = () => void presence.withdraw();
  void onKeystroke;
  void onClearOrSend;
  return null;
}
```

The provider renews the admitted lease while the activity owner remains
active; do not add a second app timer or heartbeat loop. TTL is the
crash/disconnect backstop. Explicit or idle delete is the ordinary stop
signal. Choose `idleMs` below the product expiry deadline, leaving room for the
delete to become visible: for a five-second ceiling, the shown three-second
idle window leaves that convergence budget. TTL will not enforce the deadline
while the activity owner is active.

<!-- since: 0.1.27 -->

## Keep presence values stable

Volatile values defeat the no-op dedup. `touch()` evaluates `value` on every
activity tick; a timestamp, counter, draft body, or other changing field turns
every keystroke into a real publish. At typing speed this can reach the presence
rate limit and suspend the publisher with `publish-error`.

Search vocabulary: presence rate limit; typing indicator too many publishes;
volatile presence value; `SNAPBACK_REACT_PRESENCE_VALUE_CHURN`.

Before — the timestamp changes the canonical value on every touch:

```tsx source=tests/fixtures/activity-presence-vertical/client-projection.ts
export function VolatileTypingValue({ displayName }: { displayName: string }) {
  const presence = useSnapbackActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => ({ userHandle: 'ada', name: `${displayName}-${Date.now()}` }),
    idleMs: 3_000,
  });
  const onKeystroke = () => presence.touch();
  void onKeystroke;
  return null;
}
```

After — bind and memoize only the small state peers actually need:

```tsx source=tests/fixtures/activity-presence-vertical/client-projection.ts
export function StableTypingValue({ displayName }: { displayName: string }) {
  const boundValue = useMemo(
    () => ({ userHandle: 'ada', name: displayName }),
    [displayName],
  );
  const presence = useSnapbackActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => boundValue,
    idleMs: 3_000,
  });
  const onKeystroke = () => presence.touch();
  void onKeystroke;
  return null;
}
```

In a positively identified development build, N consecutive actual
changed-value publishes for one presence key inside the short diagnostic
window emit `SNAPBACK_REACT_PRESENCE_VALUE_CHURN`. The warning names the key
and this repair without recording the presence value. Repeated unchanged
touches, provider heartbeats, and superseded intents do not count.

## Coming from Supabase `track()`

Supabase `track()` is the lifecycle analogue of bound `useSurface` presence or
a non-`skip` `useSnapbackPresence` value: Supabase keeps the state until
`untrack()`, channel leave, or disconnect; Snapback keeps the value desired
while its binding is mounted and uses the provider heartbeat to sustain its
TTL lease. Neither expires merely because the user went idle.

Idle typing therefore needs extra stop choreography on both systems:
`track()`/`untrack()` in Supabase, or **touch + provider heartbeat + delete**
in Snapback:

- `touch()` on each meaningful activity tick;
- let the provider renew the unchanged admitted value;
- let `useSnapbackActivityPresence` delete at `idleMs`, and call
  `withdraw()` for earlier product transitions.

The hook admits `idleMs` only as a finite safe integer from 250 through
2,147,483,647 milliseconds. Invalid configuration refuses during render with
`SNAPBACK_REACT_ACTIVITY_IDLE_MS_INVALID`; fix the deadline instead of
clamping or adding another timer. That legal range is not a product-timing
guarantee: `idleMs` plus delete visibility still must fit the expiry ceiling
the application promises.

The generated room scope and membership admission remain authoritative.
Heartbeat extends only an already admitted ephemeral entry; it does not grant
membership or make presence durable history.

## Anti-patterns

- Passing a truthy presence value continuously when the product means “for a
  few seconds after activity.”
- Publishing once and relying on a long TTL as the normal stop mechanism.
- Adding an independent app timer when the activity-presence owner already
  owns heartbeat and withdrawal.
- Putting timestamps, counters, or draft text in an activity-presence value
  when a stable typing/active marker is enough.
- Treating an expired or deleted entry as a durable offline-status record.
- Reusing presence as membership, authorization, or message history.

The packed external vertical receipt is
`node scripts/activity-presence-vertical-contract.mjs`. It proves the `typing`
Guide route, generated reference and public imports, runtime publish/delete,
React idle and explicit withdrawal, Expo background withdrawal, and the
invalid-`idleMs` diagnostic from one installed package closure. It also proves
that a bound surface value persists past TTL under renewal and that switching
that binding to `skip` withdraws it before TTL.

---

<!-- snapback-guide-source: guide/recipes/membership-roster-projection.md -->
---
title: "Recipe: list members without exposing authority"
id: recipes.membership-roster-projection
order: 14
audience: agent-first
capabilities: [auth.scoped-roles, authority.profile.v1]
authorities: [llp/0056-scoped-roles-and-memberships.rfc.md, llp/0240-application-authority-profiles.rfc.md, llp/0278-paged-live-results-and-relational-composition.rfc.md, llp/0295-published-matrix-improvement-program.plan.md, packages/snapback-codegen/rbac-authoring.test.mjs, packages/snapback-codegen/authority-projection-packed.test.mjs, crates/snapback-kernel/src/storage.rs, crates/snapback-engine/src/runtime/host_glue.rs]
examples: [packages/snapback-codegen/authority-projection-packed.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-22
reviewed-authorities-digest: sha256:6b7e76ab01d5b050deb6a5298ea2f1aa0519b7a5de8100d7b992d00369606239
---

# Recipe: list members without exposing authority

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use an authority profile product projection when the product needs a private
room roster, display history, leave/rejoin incarnations, or a send-time
recipient set. Do not make the membership table public and do not maintain a
second app-owned mirror. The membership row remains the current authorization
source; Snapback captures declared product facts from its before/after row
images inside the same writer transaction.

Search phrases: list chat members; private membership roster; private roster;
product-visible roster projection; display roster; show roster; who is in the room;
enumerate members; member history; join date; leave and rejoin;
recipient snapshot; send-time recipient set; who received a message; roster
mirror; authority product projection.

## Declare the generated projection

Projection capture is available only on a membership declaration with
`provenance: "full"`. The writer seam must be able to observe every
authorization-relevant transition; `creation` provenance is refused with
`SNAPBACK_AUTHORITY_PROJECTION_FULL_PROVENANCE_REQUIRED`.

The history field list is historical product data. It may not repeat the
principal/resource/role axes or a current roster field. In this example,
`auditLabel` is historical while the ordinary current roster stays the small
`userId`/`role` projection:

```js fragment reason="Minimal public spelling; the packed Explicit/Familiar contract fixture constructs and verifies the complete schema."
export const eventDeliveries = defineTable({
  eventId: v.id('events'),
  senderId: v.principal(),
  body: v.string(),
  recipientIds: v.array(v.principal(), { maxItems: 1024 }),
}).visibility({ kind: 'owner', field: 'senderId' });

export const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
  auditLabel: v.optional(v.string()),
})
  .membership({
    id: 'eventMembers',
    principal: 'userId',
    resource: 'eventId',
    role: 'role',
    roles: ['owner', 'member'],
    pendingRoles: ['invited'],
    bootstrapRole: 'owner',
    lastHolder: { protect: 'owner' },
    provenance: 'full',
    transitions,
  })
  .authorityProfile({
    name: 'eventMembers',
    hierarchy: { owner: ['member'], member: [] },
    roster: { visible: ['userId', 'role'] },
    projection: {
      history: { visible: ['auditLabel'] },
      recipients: {
        ceiling: 1024,
        sinks: [{
          operation: 'sendDelivery',
          table: 'eventDeliveries',
          scopeField: 'eventId',
          recipientsField: 'recipientIds',
        }],
      },
    },
  })
  .visibility({ kind: 'owner', field: 'userId' });
```

Explicit and Familiar accept the same declaration shape. As with every
Familiar operation reference, a Familiar sink uses its exact two-segment
operation identity (for example, `messages.sendDelivery`) while Explicit uses
the exported name. Familiar's `defineTable` adds its normal sync default; it
does not change authority, projection, or history semantics.

## Read current state and history through different operations

`eventMembers.list` and `eventMembers.myRole` are unchanged. `list` remains
the bounded, redacted current roster; it does not expose membership row ids.
Enabling `projection` adds `eventMembers.history` and
`eventMembers.incarnations`. Both require current roster admission before
cursor parsing, use sealed operation/scope/generation/caller-bound cursors,
and return the D1 envelope:

History does not widen roster visibility. `principal`, `scope`, and
role-derived fields appear only when their membership fields are declared in
`roster.visible`; private row/incarnation ids never appear. Pending-only
invitations are omitted from history and incarnation results. Once an
incarnation becomes active or departed, its admitted, redacted history can be
returned.

```ts fragment reason="Generated type spelling verified by the packed authority-projection fixture."
interface AuthorityHistoryPageV1<Row> {
  readonly rows: readonly Row[];
  readonly cursor: string | null;
  readonly boundary: 'exact' | 'at-limit';
  readonly horizon: {
    readonly earliestCoveredCommit: number;
    readonly coverageClass: 'full' | 'authorization-facts-only';
  };
}
```

`boundary` says whether this page hit its pagination limit. It never describes
history completeness. The separate horizon says the earliest covered commit
and whether older ledger backfill carries only role/status facts. A leave
closes one incarnation; a later invite/rejoin opens a new one; role changes
remain interior events. Projection activation captures existing current rows
at its horizon, so they are not misrepresented as pre-activation history.

Projection reads do not imply offline retention. Treat them as ordinary
authorized live results unless a separate retention profile explicitly says
otherwise.

## Freeze recipients inside the sending mutation

The `recipients.sinks` declaration binds the helper to an exact sending
mutation and product field. Insert the product row, then call
`ctx.authority.eventMembers.snapshotRecipients(eventId, rowId)`. The host
writes `recipientIds` onto that row in the same transaction and returns
`null`; application JavaScript never receives or enumerates the principals.
Use from another mutation, against another table/field, or without the sink
row is refused. The host keeps the resolved patch outside the handler's
read-your-writes overlay until commit, so a later `ctx.db.get` or query sees
only the handler-authored row, not the private recipient set. Once frozen, a
later patch of `recipientIds` or deletion of the row refuses with
`SNAPBACK_AUTHORITY_RECIPIENT_SINK_FROZEN`.

Later membership changes do not rewrite the frozen product row.

Keep recipient sinks behind an owner or membership visibility policy unless
publishing the set is deliberate. A `public-read` sink remains allowed, but
codegen emits `SNAPBACK_AUTHORITY_RECIPIENT_SINK_PUBLIC_READ` to name that
publication choice.

```js fragment reason="The packed projection fixture verifies this exact generated helper and sink identity."
export const sendDelivery = defineJsMutation({
  auth: 'authenticated',
  args: { eventId: v.id('events'), body: v.string() },
  reads: ['eventMembers', 'eventDeliveries'],
  writes: ['eventDeliveries'],
  handler: async (ctx, args) => {
    const rowId = await ctx.db.insert('eventDeliveries', {
      eventId: args.eventId,
      body: args.body,
      recipientIds: [],
    });
    await ctx.authority.eventMembers.snapshotRecipients(args.eventId, rowId);
    return rowId;
  },
});
```

The declared ceiling may be at most 1,024. Resolution reads at most one row
past the declaration and refuses with
`SNAPBACK_AUTHORITY_RECIPIENT_CEILING_EXCEEDED` instead of truncating. The
refused read remains dependency-captured. Never resolve a recipient list on
the client and pass it back as authority.

For receipt counts across many message or profile keys, use
`defineSetKeyedAggregate` from `@expo/snapback-codegen/standard-patterns` when
the UI requires one atomic cross-set snapshot. Declare `maxKeys` and
`rowCeiling`; the generated live handler owns 499-item operand chunks. When
cross-set atomicity is unnecessary, bounded independent reads remain correct.

## Rely on the generated outcome contract

The manifest publishes the closed three-class matrix per generated mutation:

| Branch class | Result |
| --- | --- |
| requested state already holds, or `remove` target is absent | idempotent success, no write/transition receipt |
| visible target violates a precondition | typed precondition refusal |
| target or scope is hidden | non-enumerating denial |

For example, changing a member to its current role performs no write; inviting
an already-active visible member is a typed precondition; changing the role of
an absent visible target is a typed precondition; removing an absent target is
an idempotent no-op; and hidden targets/scopes deny without enumeration. Clients may retry, but
must not convert a denial into existence evidence.

## Adopt from an app-owned mirror

Preview adoption without opening the database for writes:

```sh
snapback authority plan --db ./snapback.db --schema ./snapback/generated/schema.manifest.json --profile eventMembers --mirror-table conversationMembers --json
```

The plan reports only counts and digests for matched, missing, extra, or
mismatched rows; it does not print private row values. It also reports the
activation horizon and whether authorization-ledger backfill is available.
Activate the generated projection through the normal schema generation
rotation. If reviewed historical role/status recovery is desired, apply it
explicitly:

```sh
snapback authority backfill --db ./snapback.db --profile eventMembers --apply --confirm authorization-facts-only
```

That operation is idempotent. It moves the horizon backward for available
authorization facts only; it never fabricates display values or timestamps.
After comparing the generated projection, stop writing the old mirror and
retire it through the normal reviewed migration path.

## Use authored resource fields

Child product tables scope visibility with an authored resource field such as
`conversationId` or `eventId`. Do not spell Familiar
`resourceField: "_id"` when `_id` is outside the authored field union, and
never copy a private membership-row id into product storage.

## Anti-patterns

- Making a membership table public to render a roster.
- Maintaining a second app-authored roster mirror beside a generated
  projection.
- Declaring a projection without `provenance: "full"`.
- Treating D1 `boundary` as history completeness or fabricating facts before
  the reported horizon.
- Reusing one incarnation across leave and rejoin.
- Resolving recipients outside the sending transaction, accepting a
  client-supplied recipient array, or truncating at the ceiling.
- Treating generated history as retained/offline-capable without a separate
  retention declaration.
- Using `resourceField: "_id"` where the schema requires an authored relation
  field.

---

<!-- snapback-guide-source: guide/recipes/time-windowed-live-reads.md -->
---
title: "Recipe: time-windowed live reads"
id: recipes.time-windowed-live-reads
order: 14
audience: agent-first
capabilities: [realtime.live-queries, auth.sessions]
authorities: [llp/0053-authorization-invalidation.rfc.md, packages/snapback-codegen/guide-time-windowed-live-reads.test.mjs, tests/fixtures/guide-time-windowed-live-reads/schema.mjs, tests/fixtures/guide-time-windowed-live-reads/functions.mjs, tests/fixtures/guide-time-windowed-live-reads/time-windowed-live-reads.mjs]
examples: [tests/fixtures/guide-time-windowed-live-reads]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-26
reviewed-authorities-digest: sha256:6bfc3ac33d1e7ee1a1051a9ec16fa99109947a76c2c5c183476596234dcd252d
---

# Recipe: time-windowed live reads

<!-- diagnostic-primary: SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY -->

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Authenticated live queries cannot make visibility depend on an ambient clock.
Calling `ctx.runtime.now()` in one produces
`SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`. The refusal protects deterministic
reruns and authorization invalidation; do not weaken it or replace it with
`Date.now()` inside the handler.

Use a load-pinned client clock argument and server-authored row timestamps.
The clock becomes an immutable input to one subscription generation, while
the row time remains a captured database fact:

```js source=tests/fixtures/guide-time-windowed-live-reads/functions.mjs
import {
  defineJsLiveQuery,
  defineJsMutation,
  results,
  v,
} from '@expo/snapback-codegen/define';

export const eventsVisibleAtPinnedClock = defineJsLiveQuery({
  args: { clockMs: v.integer(), windowMs: v.integer() },
  result: results.documents('events'),
  auth: 'authenticated',
  reads: ['events'],
  handler: async (ctx, args) => {
    const cutoffMs = args.clockMs - args.windowMs;
    const rows = await ctx.db.query('events').take(1_024).collect();
    return rows.filter((row) => (
      row.createdAt >= cutoffMs && row.createdAt <= args.clockMs
    ));
  },
});
```

Stamp `createdAt` on the server when the row is written. A mutation or action
may sample `ctx.runtime.now()` because that time becomes durable data rather
than a mutable input to protected live visibility:

```js source=tests/fixtures/guide-time-windowed-live-reads/functions.mjs
export const insertServerTimedEvent = defineJsMutation({
  args: { label: v.string() },
  result: results.value(v.id('events')),
  auth: 'authenticated',
  reads: [],
  writes: ['events'],
  handler: async (ctx, args) => ctx.db.insert('events', {
    label: args.label,
    createdAt: ctx.runtime.now(),
  }),
});
```

Pin the clock once when loading the view and pass it as an ordinary generated
argument. Use stream transport for push updates caused by database commits:

```js source=tests/fixtures/guide-time-windowed-live-reads/time-windowed-live-reads.mjs
export async function openTimeWindow(client, reference, connectionId) {
  const clockMs = Date.now();
  const handle = await client.liveQuery(reference, {
    connectionId,
    args: { clockMs, windowMs: HOUR_MS },
    transport: 'stream',
  });
  return { clockMs, handle };
}
```

This result is current for database changes relative to the pinned `clockMs`;
it is not current relative to the advancing wall clock. Rows do not age out
merely because time passes, because no database commit invalidates the query.
Re-issue with a fresh clock when product freshness requires it: route focus,
pull-to-refresh, an explicit refresh control, or an application-owned coarse
boundary such as the next minute or five-minute bucket. Dispose the predecessor
handle before installing the fresh generation:

```js source=tests/fixtures/guide-time-windowed-live-reads/time-windowed-live-reads.mjs
export async function refreshTimeWindow(current, client, reference, connectionId) {
  await current.handle.dispose();
  return openTimeWindow(client, reference, connectionId);
}
```

Choose the refresh cadence from the product promise, not from live-query push:
“last hour, refreshed on focus” can remain pinned for a screen visit; an
“expires in under a minute” view needs a boundary refresh near that minute.
This recipe does not provide a trusted clock, autonomous expiry, or generated
time buckets. Those remain a primitive-design question.

## Anti-patterns

- Do not call `ctx.runtime.now()`, `Date.now()`, or `new Date()` inside an
  authenticated live query whose result visibility depends on the value.
- Do not omit the generated `clockMs`/`windowMs` argument contract and pass an
  unchecked bag to the handler.
- Do not claim that live push advances the pinned clock or ages rows out when
  no database commit occurs.
- Do not refresh every render. Choose a product boundary, dispose the old
  handle, and open one successor generation with a fresh clock.

---

<!-- snapback-guide-source: guide/recipes/capability-links.md -->
---
title: "Recipe: capability links for Expo and web"
id: recipes.capability-links
order: 15
audience: agent-first
capabilities: [api.capability-links]
authorities: [llp/0204-app-external-surfaces.rfc.md, llp/0150-agent-token-acquisition.rfc.md, llp/0031-server-route-taxonomy.spec.md, llp/0294-early-expo-workflow-closure.plan.md, crates/snapback-server/src/server.rs, crates/snapback-kernel/src/storage/capability_links.rs, crates/snapback/tests/route_policy_v1.rs, packages/snapback-codegen/auth-artifacts.test.mjs, scripts/check-guide-capability-link-example.mjs]
examples: [packages/snapback-codegen/auth-artifacts.test.mjs, scripts/check-guide-capability-link-example.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.24
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:dc636112af1bf4c02640204a13226a5e75261f71c7ea013eb578170b04bfaf6b
---

# Recipe: capability links for Expo and web

> **Local target only.** Snapback 0.1.24 ships the local anonymous-set slice,
> and only over local carriers. Use it from a same-host web app, iOS Simulator, or an
> Android emulator whose supervised carrier can reach the loopback backend.
> Public-recipient sharing, physical-device delivery, hosted capability links,
> granted-operation links, and identity-bearing links are not shipped. The
> shipped local guest-session entry is a separate auth route, never authority
> conferred by an `sbl_` URL. Do not expose the local server through a public
> tunnel.

Use this recipe for an expiring **share-to-view** URL whose target query is
already callable by an anonymous user. The exact minting session can revoke it
while that session remains current. The recipe covers signed-in mint, share,
crawler-safe inert `GET`, Expo/web intake, explicit `POST` invoke,
use-count/replay handling, expiry, and same-session revocation.

The minted URL names the Snapback server origin. On another computer or phone,
its loopback host names that recipient's device, not the development machine.
The URL is therefore not a public share carrier. The supported journey here is
same-host web or a supervised simulator/emulator route; a hosted application
edge and physical-device recipient carrier remain future work. Use the
[Expo carrier table](../clients/react-expo.md#choose-simulator-emulator-or-usb-routing)
for exact routing constraints, and keep the
[local-target boundary](../auth/targets.md#a-public-tunnel-does-not-make-the-loopback-server-production-ready)
when choosing a carrier.

An `sbl_…` capability-link token is a secret URL and bearer invocation input
for one link. It is **not** a session, user, principal, login, guest identity,
OAuth token, or general deep link grant. Never place it in a `SnapbackClient`
`bearerToken`, `Authorization`, an auth coordinator, SecureStore, AsyncStorage,
localStorage, IndexedDB, the RQS store, an app table, logs, analytics, crash
reports, or referrers.

## Choose the right link before building

The shipped link adds pinned arguments, attribution, a budget, expiry, and an
optional use count to one exposed function in the **external anonymous set**:
`auth: 'public'`, or `auth: 'optional-user'` invoked without a user. It does
not make protected data or a protected operation anonymous.

| App intent | Use today | Boundary |
| --- | --- | --- |
| **Invite link** | Shipped capability link only for an already-anonymous RSVP/capture function; otherwise an app-owned invitation-token row | Group membership, protected content, principal creation, and identity-bearing acceptance require the unshipped granted-operation/identity flow. |
| **Capture link** | Shipped single-use or approval-per-use link when the capture mutation/action is deliberately anonymous and exposed | First-party guest entry is separate: call `auth.enterAsGuest()` under an enabled generated guest policy, then store the draft as that principal; the link itself grants no session. |
| **Share-to-view** | Shipped query link when the exact query is anonymous and exposed | A private row, owner query, or membership query needs the unshipped granted-operation link; do not weaken the function to make the link fit. |
| **Upload request** | App-owned request row plus the normal authenticated [asset upload](../backend/assets.md) flow | A capability link is not upload custody or an asset-owner session. The implemented slice has no capability-link asset-upload ceremony. |
| **Account claim** / **claim link** | Use `auth.claimGuestWithPassword(...)` only for the shipped guest→password transition; otherwise use an app-owned one-time claim-token row and authenticated ceremony | Account claim is identity authority. A capability link cannot claim an account, and guest claim refuses an existing password identity rather than taking it over. |

An app-owned token row remains appropriate when the token represents durable
product workflow state rather than one function invocation: named invite
acceptance, staged upload ownership, account claim, guest continuity, or a
workflow with product-specific resend/rotation rules. Do not build such a row
for the share-to-view case below.

## Expose one anonymous query

The function must say `auth: 'public'` (or explicitly `optional-user`) and the
schema must expose that exact name. This codegen fixture is the minimal shape
used by the Guide's CI:

```js source=packages/snapback-codegen/auth-artifacts.test.mjs
export const listTodos = defineLiveQuery({
  table: 'todos',
  index: 'by_title',
  filter: [eq('title', lit('fixed'))],
  auth: 'public',
  authorityIndependent: true,
});
```

```js source=packages/snapback-codegen/auth-artifacts.test.mjs
  api: {
    enabled: true,
    functions: { listTodos: { expose: true, since: 'v1' } },
    origins: ['https://example.com:8443'],
  },
```

Capability-link storage and routes activate with `api.enabled` on a
sessions-mode app. V1 mint admission requires a live signed-in human session,
an exposed function whose effective auth is `public` or `optional-user`, and a
valid pinned/caller argument template. It does **not** ask whether the issuer
could invoke a protected function through their session: even an exposed
protected function the issuer can call directly is refused with
`SNAPBACK_CAPABILITY_LINK_FUNCTION_NOT_ANONYMOUS`.

Landing and invoke re-check that the API is enabled and the function remains
exposed and anonymously callable. They also require an active, unexpired,
unexhausted link and a still-live human minter principal. Use-time life follows
the principal, not the minting session: refreshing, rotating, or ending that
session does not kill an otherwise valid link.

## Mint and share from the issuer boundary

`POST /capability-links` requires a signed-in session bearer and returns the
raw token exactly once inside `url`. The current first-party application client
does not ship a typed `mintCapabilityLink` wrapper and deliberately does not
reveal coordinator-owned bearer bytes. Use the HTTP helper only inside an
issuer integration that already owns an explicit session bearer. Do not read
an undocumented `appClient.client.bearerToken` property or copy browser/native
custody into application state to make this call.

```js source=scripts/check-guide-capability-link-example.mjs
export async function mintShareLink(
  fetchImpl,
  serverOrigin,
  sessionBearer,
  { functionName = 'listTodos', expiresInMs = 3_600_000, uses = 1 } = {},
) {
  const response = await fetchImpl(new URL('/capability-links', serverOrigin), {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: {
      authorization: `Bearer ${sessionBearer}`,
      'content-type': 'application/json',
      'x-snapback-auth-client-protocol': '1',
    },
    body: JSON.stringify({
      function: functionName,
      pinnedArgs: {},
      callerArgs: [],
      expiresInMs,
      uses,
    }),
  });
  if (!response.ok) throw new Error('capability-link mint failed');
  const minted = await response.json();
  return Object.freeze({
    id: minted.id,
    serverUrl: new URL(minted.url, serverOrigin).href,
    expiresAtMs: minted.expiresAtMs,
    remainingUses: minted.remainingUses,
  });
}
```

Use `serverUrl` directly only when the recipient carrier can reach that exact
server origin. Do not print it. The response also returns the safe management
id `cplk_…`. Retain that id for a revoke button only while the exact minting
session and authority instance remain current; a replacement session cannot
use it. The URL token itself must not enter durable app state.

For a supervised simulator/emulator app, construct a custom-scheme URL only by
validating the minted server URL against the one configured origin and closed
token shape:

```js source=scripts/check-guide-capability-link-example.mjs
export function toExpoCapabilityUrl(serverUrl, options) {
  const target = resolveCapabilityTarget(serverUrl, options);
  if (target === null || !/^[a-z][a-z0-9+.-]*$/u.test(options.expoScheme)) {
    throw new TypeError('capability server URL or Expo scheme is invalid');
  }
  const token = new URL(target).pathname.split('/').at(-1);
  return `${options.expoScheme}://share/${token}`;
}
```

This changes only the app ingress carrier; invocation still targets the exact
local `serverOrigin`. It does not make a physical device or public recipient
able to reach a loopback server.

The local target defaults to seven days and refuses expiry beyond thirty days.
Set a shorter application-specific `expiresInMs` whenever possible. `uses: 1`
is a **single-use token**. Omit `uses` for an expiry-bounded query link (with
same-session revoke while that session remains current), or set a positive
count for a bounded multi-use query link.

For mutations/actions, `uses: 1` is required unless every use is approval-
gated by the function declaration or mint request (`approval: true`). An
approval-per-use link creates a pending effect; the minter must explicitly
approve it. Possession never chooses an approver. Multi-use approval is not
multi-use direct write authority.

## Keep shared URLs crawler-safe

The minted server URL is safe to unfurl: `GET /capability-links/{token}` only
returns bearer-free metadata (`id`, function, kind, caller-argument names,
expiry, remaining uses, and approval mode). It does not invoke the function,
consume a use, mutate link state, or create an approval request. The actual
read or write happens only at `POST /capability-links/{token}/invoke` after an
explicit user action.

Snapback marks the mint and token-bearing routes `no-store`, applies
`Referrer-Policy: no-referrer`, and normalizes the registered `{token}` path
for diagnostics/telemetry. Keep those properties through any proxy. A custom
web landing route such as `/share/{token}` must also:

- redact the path before access/application/error logging;
- send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`;
- render no third-party scripts, pixels, fonts, images, or auto-submitting
  forms; and
- scrub the address bar before analytics or other app subsystems mount.

If the frontend cannot guarantee all four, share the minted Snapback URL
directly. Do not put it in a `?token=` parameter, redirect it through a link
shortener, or add campaign parameters.

## Strip Expo links before router state exists

Do not add a `Linking.addEventListener` beside Expo Router. That listener is
additive: the router or another subscriber can persist the same secret URL
before your callback runs. Reserve capability-link ingress at Expo Router's
native-intent boundary instead. Put this wrapper in `app/+native-intent.tsx`:

```ts fragment reason="application-owned Expo Router boundary wiring"
import { redirectCapabilitySystemPath } from '../capability-link-intake';
import { capabilityLinkOptions } from '../capability-link-options';

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return redirectCapabilitySystemPath({ path }, capabilityLinkOptions);
}
```

The checked implementation runs before Expo Router creates navigation state.
It moves a valid target into a process-local, one-use handoff and returns a
changing clean route such as `/shared/1`. The sequence is not a secret and
contains no token; changing it makes a second intent observable while the
shared screen is already warm. A malformed token-bearing path returns the
clean `/invalid-link` route; unrelated paths pass through unchanged.

```js source=scripts/check-guide-capability-link-example.mjs
let nativeCapabilityHandoffSequence = 0;
let pendingNativeCapabilityTarget = null;

export function redirectCapabilitySystemPath({ path }, options) {
  const target = resolveCapabilityTarget(path, options);
  if (target !== null) {
    nativeCapabilityHandoffSequence += 1;
    const handoffSequence = String(nativeCapabilityHandoffSequence);
    pendingNativeCapabilityTarget = Object.freeze({ handoffSequence, target });
    return `/shared/${handoffSequence}`;
  }
  if (typeof path === 'string' && path.includes('sbl_')) return '/invalid-link';
  return path;
}

export function takePendingNativeCapabilityTarget(handoffSequence) {
  if (pendingNativeCapabilityTarget?.handoffSequence !== String(handoffSequence)) return null;
  const { target } = pendingNativeCapabilityTarget;
  pendingNativeCapabilityTarget = null;
  return target;
}
```

Implement the screen as `app/shared/[handoffSequence].tsx`. Take the pending
target whenever that non-secret route parameter changes, not only on mount;
then construct `openCapabilityLink` and render analytics or other application
subsystems. This is the warm-start signal for a second share intent. If the
take returns `null`, render the unavailable state.

```tsx fragment reason="application-owned dynamic Expo Router screen wiring"
const { handoffSequence } = useLocalSearchParams<{ handoffSequence: string }>();
const handledHandoffSequence = useRef<string | null>(null);

useEffect(() => {
  if (handledHandoffSequence.current === handoffSequence) return;
  handledHandoffSequence.current = handoffSequence;
  const target = takePendingNativeCapabilityTarget(handoffSequence);
  // Open target, or render unavailable when it is null.
}, [handoffSequence]);
```

Do not mirror the secret target into params, navigation state, a React store,
or durable storage. The checked parser accepts only one fixed server origin,
one fixed web origin, one fixed Expo scheme, and the exact `sbl_` token shape;
it rejects query strings, fragments, embedded credentials, foreign origins,
and arbitrary callback origins.

```js source=scripts/check-guide-capability-link-example.mjs
const TOKEN_PATTERN = /^sbl_[A-Za-z0-9_-]{43}$/u;
const UNAVAILABLE = 'SNAPBACK_CAPABILITY_LINK_UNAVAILABLE';
```

```js source=scripts/check-guide-capability-link-example.mjs
function resolveCapabilityTarget(rawUrl, {
  serverOrigin,
  webOrigin,
  expoScheme,
}) {
  let incoming;
  try {
    incoming = new URL(rawUrl);
  } catch {
    return null;
  }
  if (incoming.username || incoming.password || incoming.search || incoming.hash) return null;

  const expectedWebOrigin = new URL(webOrigin).origin;
  const expectedServerOrigin = new URL(serverOrigin).origin;
  let token = null;
  if (incoming.origin === expectedServerOrigin) {
    token = incoming.pathname.match(/^\/capability-links\/(sbl_[A-Za-z0-9_-]{43})$/u)?.[1] ?? null;
  } else if (incoming.origin === expectedWebOrigin) {
    token = incoming.pathname.match(/^\/share\/(sbl_[A-Za-z0-9_-]{43})$/u)?.[1] ?? null;
  } else if (
    incoming.protocol === `${expoScheme}:`
    && incoming.hostname === 'share'
  ) {
    token = incoming.pathname.match(/^\/(sbl_[A-Za-z0-9_-]{43})$/u)?.[1] ?? null;
  }
  if (!TOKEN_PATTERN.test(token ?? '')) return null;
  return new URL(`/capability-links/${token}`, serverOrigin).href;
}
```

For web, read and scrub the URL before mounting analytics or third-party
subresources:

```js source=scripts/check-guide-capability-link-example.mjs
export function consumeWebCapabilityLocation(windowLike) {
  const rawUrl = windowLike.location.href;
  windowLike.history.replaceState(null, '', '/shared');
  return rawUrl;
}
```

The initial web request still reaches your edge with the token path, so
`replaceState` complements rather than replaces the proxy controls above.
Neither native-intent rewriting nor `replaceState` can erase OS/browser share
history, notification previews, clipboard history, or records retained by the
channel that delivered the URL. Bound that residual exposure with the shortest
practical expiry, a small use count, and same-session issuer revocation while
it remains available.

## Preview, then invoke only on a user action

The checked controller keeps the token-bearing server URL only in a volatile
closure. Its public snapshot contains only the server's bearer-free landing
projection. Opening performs one `GET`; it never invokes automatically.

Set `fetchImpl` to raw platform fetch, for example
`globalThis.fetch.bind(globalThis)`, or to a wrapper proven never to add the
coordinator bearer. Do not pass a `SnapbackClient` authenticated transport.
The token is the complete credential on both landing and invoke: the server
refuses **any** `Authorization` header on either request with
`SNAPBACK_CAPABILITY_LINK_UNAVAILABLE`, even when the bearer is otherwise a
valid signed-in session.

```js source=scripts/check-guide-capability-link-example.mjs
async function requestCapability(fetchImpl, url, method, args) {
  const response = await fetchImpl(url, {
    method,
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify({ args }) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return Object.freeze({
      ok: false,
      code: payload?.diagnostic?.code ?? 'REQUEST_FAILED',
    });
  }
  return Object.freeze({ ok: true, payload });
}
```

```js source=scripts/check-guide-capability-link-example.mjs
export async function openCapabilityLink(rawUrl, options) {
  let target = resolveCapabilityTarget(rawUrl, options);
  if (target === null) return Object.freeze({ status: 'invalid-link' });

  let previewRequest = await requestCapability(options.fetchImpl, target, 'GET');
  if (!previewRequest.ok) {
    target = null;
    return Object.freeze({
      status: previewRequest.code === UNAVAILABLE ? 'unavailable' : 'request-failed',
      code: previewRequest.code,
    });
  }
  let preview = previewRequest.payload;
  let terminal = null;

  const snapshot = () => Object.freeze(terminal ?? { status: 'ready', preview });
  const refresh = async () => {
    if (target === null) return snapshot();
    previewRequest = await requestCapability(options.fetchImpl, target, 'GET');
    if (!previewRequest.ok) {
      terminal = Object.freeze({
        status: previewRequest.code === UNAVAILABLE ? 'unavailable' : 'request-failed',
        code: previewRequest.code,
      });
      target = null;
    } else {
      preview = previewRequest.payload;
    }
    return snapshot();
  };

  return Object.freeze({
    snapshot,
    refresh,
    async invoke(args = {}) {
      if (target === null) return Object.freeze({ invoked: false, state: snapshot() });
      const invokeTarget = `${target}/invoke`;
      const result = await requestCapability(options.fetchImpl, invokeTarget, 'POST', args);
      if (!result.ok && result.code === UNAVAILABLE) {
        terminal = Object.freeze({ status: 'unavailable', code: result.code });
        target = null;
      } else if (result.ok && preview.remainingUses === 1) {
        terminal = Object.freeze({ status: 'used' });
        target = null;
      } else {
        await refresh();
      }
      return Object.freeze({ invoked: true, result, state: snapshot() });
    },
  });
}
```

Create this controller after URL intake. Render `controller.snapshot()` and
wire `controller.invoke({})` to a button press; never call it in a mount effect,
route loader, preview render, or link listener. Pass only raw fetch:

```js fragment reason="application-owned controller construction"
const controller = await openCapabilityLink(rawUrl, {
  ...capabilityLinkOptions,
  fetchImpl: globalThis.fetch.bind(globalThis),
});
```

| State | UI | Network behavior |
| --- | --- | --- |
| `invalid-link` | “This link is malformed.” | None. |
| `ready` | Function label, expiry, remaining-use facts, and an explicit View/Submit button | Inert `GET` already completed; button performs `POST`. |
| `used` | “This single-use link has been used.” | The volatile target is cleared; replay performs no request. |
| `unavailable` | “This link is expired, used, revoked, or unavailable.” | The server deliberately gives the same non-enumerating refusal for all terminal causes. |
| `request-failed` | Retry without echoing the URL | No diagnostic, exception, or UI copy includes the token. |

After a multi-use invocation, the controller performs another inert `GET` to
refresh `remainingUses`. A successful single-use invocation clears the target
locally. A server-side expiry, exhausted use count, successful same-session
revocation, or deactivated minter principal returns the same
`SNAPBACK_CAPABILITY_LINK_UNAVAILABLE`; the app must not distinguish them.

The issuer can revoke with `DELETE /capability-links/{id}` only from the exact
minting session and authority instance. A successful same-session revoke is
immediate at the next landing/invoke gate. Refresh and password change keep the
same session, so revoke still works when it sends the rotated bearer. Sign-out
or a newly minted session cannot revoke: `DELETE` returns
`SNAPBACK_CAPABILITY_LINK_REVOKE_DENIED`, while the link remains usable until
expiry, use exhaustion, or minter-principal deactivation. Treat revoke as a
same-session convenience, not a durable issuer control. Bound every link with
the shortest practical `expiresInMs` and a small `uses` count.

Keep `id` and token roles separate: management uses the safe id; recipients use
the secret URL.

```js source=scripts/check-guide-capability-link-example.mjs
export async function revokeShareLink(fetchImpl, serverOrigin, sessionBearer, id) {
  const response = await fetchImpl(
    new URL(`/capability-links/${encodeURIComponent(id)}`, serverOrigin),
    {
      method: 'DELETE',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: {
        authorization: `Bearer ${sessionBearer}`,
        'x-snapback-auth-client-protocol': '1',
      },
    },
  );
  if (response.status !== 204) throw new Error('capability-link revoke failed');
}
```

The issuer bearer remains in its existing custody boundary; only the safe
management id crosses into the revoke-button state. After a successful
same-session revocation, a recipient's next `refresh()` or `invoke()` converges
on `unavailable` without revealing whether revocation, expiry, exhaustion, or
principal deactivation caused it.

## Run the executable proof

The Guide consistency lane runs:

```sh
node scripts/check-guide-capability-link-example.mjs
```

It generates a sessions/API fixture, boots the configured native Snapback
runtime, signs in, and proves against the real routes that protected functions
fail the v1 anonymous mint gate; repeated crawler `GET` is inert; any
`Authorization` on token `GET`/`POST` is refused; explicit raw-fetch `POST`
consumes uses; exhausted server-side replay, an injected expiry boundary, and
real same-session `DELETE` revocation converge on the unavailable diagnostic;
another session cannot revoke; ending the minting session does not kill the
link; and every mint/token/management response carries `Cache-Control:
no-store` and `Referrer-Policy: no-referrer`. It also proves that cold and warm
Expo native-intent rewriting gives the router only changing clean non-secret
routes, each volatile handoff is one-use, web scrubbing precedes opening, and
public UI state contains no token.

## Anti-patterns

- Creating an app token table for an anonymous share-to-view query that fits
  this shipped slice.
- Weakening a protected query to `public` so an anonymous-set link can reach it.
- Treating a capability URL as a guest session, login, principal, or general
  deep link grant. Guest entry remains unshipped and awaits owner review.
- Putting the token in `Authorization`, client auth custody, durable storage,
  logs, analytics, crash reports, query parameters, redirects, or referrers.
- Reusing an authenticated client transport for landing/invoke, or assuming a
  replacement session can revoke a link minted by an earlier session.
- Adding a capability-link `Linking` listener beside a router or another URL
  consumer; intercept and strip at the exclusive pre-navigation boundary.
- Treating a loopback server URL or custom-scheme wrapper as a public or
  physical-device share carrier, or tunnelling the local server to make it one.
- Invoking on `GET`, mount, route load, link receipt, crawler preview, or any
  event other than an explicit user action.
- Claiming granted-operation capability links ship. They are commissioned
  design only; the current link cannot reveal protected data or acquire
  identity/authority.

---

<!-- snapback-guide-source: guide/recipes/provider-lifecycle.md -->
---
title: "Recipe: provider connection and subscription lifecycle"
id: recipes.provider-lifecycle
order: 15
audience: agent-first
capabilities: [clients.headless, clients.external-store, clients.contract-provider-generation]
authorities: [llp/0034-contract-source-seam-provider-side.rfc.md, llp/0063-partitime-platform-roadmap.plan.md, llp/0095-client-lifecycle-and-conformance.spec.md, llp/0278-paged-live-results-and-relational-composition.rfc.md, llp/0280-cross-system-write-seams.rfc.md, llp/0295-published-matrix-improvement-program.plan.md, packages/snapback-client/index.mjs, packages/snapback-client/external-store.mjs, packages/snapback-react/implementation.mjs, packages/snapback-react/auth-blocked-resource.test.mjs, packages/snapback-react/package.test.mjs]
examples: [packages/snapback-contract/keyed-provider.mjs, packages/snapback-react/package.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:cb5e02859abd85c24cbcce91cb00673c057e42b4d444f21c54d3701bb3a6d6b1
---

# Recipe: provider connection and subscription lifecycle

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The provider adapter pattern is one manager above the cells it serves. This
applies to `ContractDataProvider` and other provider-neutral adapters. Within
that manager, one stable readable `connectionId` belongs to each
**(application, storage partition, server origin, settled authority)** tuple.
Every query cell under that tuple reuses the id: N cells create N logical
subscriptions only when their canonical queries differ; they do not create N
transport connections. A second client with another authority or storage
partition owns another tuple and another manager. Do not build a process-global
connection pool that coalesces distinct custody contexts.

This is the route for searches such as “one connection per query”, “too many
websockets”, “connection pool”, “provider adapter pattern”, and “rebuild stream
on auth”. It also reports active connections and subscriptions by owner. One
provider view warns above 16 logical subscriptions and supports independent
subscriptions through the 64-per-connection hard ceiling. The warning is
guidance, not a correctness boundary.

Exact retrieval vocabulary from provider failures:

- connection per subscription
- N cells imply N transport connections
- provider lifecycle budget
- too many websockets

## Own one manager above all provider cells

Construct the `SnapbackClient`, connection manager, external-store registry,
and provider at adapter scope, not inside a cell or query callback. Mint the
readable connection label once for that manager and pass it to every
`liveQuery`/`startLiveQuery` owned by the tuple. A canonical
provider/query/authority/args key shares one upstream store and refcounts its
listeners; different keys remain separate logical subscriptions on the same
connection.

For a two-client acceptance adapter, build this owner once per client. Client A
and client B may therefore report one connection each while each serves many
cells. Never reuse A's manager for B merely because their server origin is the
same: settled authority and storage partition are part of ownership.

The React package fixture mounts several distinct cells under one provider
against the real headless manager. Its injected WebSocket counts actual opens
and closes, so the regression fails if the headless client creates a transport
per cell even while reusing the same readable connection label:

```js source=packages/snapback-react/package.test.mjs
  try {
    const providerLifecycleBinding = await prepareReactBindingForClient(
      providerLifecycleClient,
      { generatedManifest },
    );
    providerLifecycle = createSnapbackReactProvider(providerLifecycleBinding, {
      connectionId: 'provider-lifecycle-shared-authority-origin',
    });
    const providerCellCount = 6;
    providerCells = observeSnapbackQueries(
      providerLifecycle,
      Object.fromEntries(Array.from({ length: providerCellCount }, (_, index) => [
        `cell${index}`,
        { ref: capacityFeeds[index], args: {} },
      ])),
      () => {},
    );
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (
        providerLifecycle.inspection().serverSubscriptions === providerCellCount
        && transportOpens === 1
      ) break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(transportOpens, 1, 'six provider cells open exactly one real transport');
    const lifecycleInspection = providerLifecycle.inspection();
    assert.equal(
      lifecycleInspection.connections[0].ownershipTuple.canonicalAppId,
      inspectionPseudonymV1('react-fixture'),
    );
    assert.equal(
      lifecycleInspection.connections[0].ownershipTuple.storagePartition,
      inspectionPseudonymV1(providerLifecycleClient.clientStoreId),
    );
    assert.equal(
      lifecycleInspection.connections[0].ownershipTuple.serverInstance,
      'self',
    );
    assert.equal(
      JSON.stringify(lifecycleInspection).includes('http://provider-lifecycle.test'),
      false,
      'the D0.5 projection carries instance-self rather than a literal endpoint',
```

## Subscribe after authority settlement, without a timeout

Consume the provider's landed settlement vocabulary. A protected React query
is `status: "blocked"`, `reason: "authentication-required"`, and
`transitionOwner: "auth-coordinator"` while signed out. During sign-in,
sign-out, or authority replacement it is `status: "blocked"`,
`reason: "authentication-not-settled"`, with the same `transitionOwner`.
Those are stable, owned states—not retry failures. Branch on them and wait for
the next provider snapshot; never add a timeout or poll a client object to
guess when authority settled.

The provider itself starts no live transport while the coordinator owns the
blocked transition:

```js source=packages/snapback-react/auth-blocked-resource.test.mjs
      assert.deepEqual(mounted.registry.snapshot(mounted.descriptor), {
        status: 'blocked',
        reason: 'authentication-not-settled',
        transitionOwner: 'auth-coordinator',
        data: undefined,
        error: null,
        connection: 'idle',
        freshness: 'unknown',
        answerClass: 'unknown',
        retention: null,
        optimisticPresentation: null,
      });
      assert.equal(client.state.attempts, 0, 'held custody starts no live transport');
```

On a principal-class change, quiesce and dispose every predecessor-owned
subscription before opening the successor connection. The settled successor
then starts a fresh snapshot-with-subscribe. This teardown-before-rebuild order
is the persona-replacement seam; “rebuild stream on auth” must not mean rebind
an old sessions connection to a new bearer.

## Keep update callbacks non-reentrant and deduplicate adapter projections

An update callback copies the delivered rows and lifecycle facts into its
store, then returns. Do not synchronously subscribe, unsubscribe, or dispatch a
mutation from inside it. A one-shot read is admitted but usually means the
adapter ignored rows it already has. If delivery must trigger more lifecycle
work, schedule it at a microtask/framework-effect boundary.

The provider deduplicates on the complete consumer-visible snapshot—rows plus
exposed status, connection, freshness, answer class, retention, and optimistic
presentation. A value-equal authoritative frame advances internal
version/resume bookkeeping without notifying consumers. Row equality never
hides a lifecycle transition such as `refreshing` to `ready`, a connection
change, or the successor's first authoritative delivery after reconnect.

Synchronous subscribe/unsubscribe/mutation dispatch inside a delivery callback
refuses with `SNAPBACK_REACT_DELIVERY_REENTRANCY_UNSUPPORTED`. Schedule that
work at a microtask or framework-effect boundary.

## Let the manager retry; explicitly tear down owners

Transport loss uses the client's existing bounded reconnect/resubscribe
machinery. Do not wrap it in a provider retry loop, open a fallback WebSocket,
or mint another connection label. Grant loss similarly reopens and
re-establishes through the client. An auth transition is different: retire the
predecessor, wait for settled successor authority, then create the fresh
subscription described above.

Each cell releases its listener. The last listener releases its logical
subscription; provider disposal closes scopes/registries and conditionally
releases the idle connection. Await `client.close()` only when the adapter owns
that client. A handle's `settled()` waits for its cleanup boundary; it never
replaces `dispose()`.

## Report active connections and subscriptions by owner

Combine the provider's inspection (logical stores/subscriptions) with the
headless client's `localResourceInspection([connectionId])` (managers, grants,
socket demand, timers, and listeners). This CI-verified helper produces one
bounded row per provider owner:

```js source=packages/snapback-react/package.test.mjs
function inspectProviderOwners(client, providers) {
  return Object.freeze(providers.map((provider) => {
    const providerResources = provider.inspection();
    const connectionId = provider.registry.connectionId;
    const clientResources = client.localResourceInspection([connectionId]);
    return Object.freeze({
      owner: providerResources.providerInstanceId,
      connectionId,
      activeConnections: clientResources.managers.filter(
        (manager) => !manager.closed && (manager.open || manager.socketDemand > 0),
      ).length,
      activeSubscriptions: providerResources.serverSubscriptions,
      clientSubscriptionOwners: clientResources.subscriptions.map(
        (subscription) => subscription.owner,
      ).sort(),
      socketDemand: clientResources.socketDemand,
      timers: clientResources.timers,
      listeners: clientResources.listeners,
    });
  }));
}
```

For two independently owned clients, call the helper once per client and
concatenate the rows. Assert the expected owner rows after delivery, then
dispose cells, providers, and owned clients and assert zero active connections,
subscriptions, demand, timers, and listeners. These inspections are
acceptance/debug facts only; they are neither application state nor authority
evidence, and the readable `connectionId` is not the server's opaque wire id.

## Duplicate-subscription diagnostics

The same positively identified local recorder groups active subscriptions by
function identity, canonical argument hash, and the complete provider
ownership tuple. The readable owner label is deliberately not part of that
key: two providers that open the same query under the same custody tuple form
one duplicate fact whose `ownerLabels` attribute both owners. Different
arguments or a different settled-authority/storage/origin tuple never form the
same fact.

`SNAPBACK_LIVE_DUPLICATE_SUBSCRIPTION_MULTIPLICITY` is warning-only. Use its
owner labels to move the common provider or external-store owner above the
duplicate consumers. It neither refuses a subscription nor changes the
existing 16-warning/64-hard envelope, and it is absent from hosted/public
diagnostic surfaces.

## Enforce the warning budget without narrowing correctness

The provisional ordinary-view budget is 16 logical subscriptions. The 17th
emits `SNAPBACK_REACT_SUBSCRIPTION_VIEW_BUDGET_EXCEEDED` with owner, count,
warning budget, hard ceiling, and paved alternatives. It remains admitted.
Independent subscriptions—including six ordinary cells—stay supported and
live-correct through 64. Entry 65 first emits the warning and then refuses with
the existing typed group/capacity diagnostic; there is no partial attachment.

Use `defineSetKeyedAggregate` when many keys need one atomic cross-set fact or
when one stream is materially cheaper. It is an optimization when independent
snapshots are acceptable, not the only correct architecture. Use
`defineChunkedSemiJoin` for the bounded actor-set/top-N shape; it owns 499-item
operand chunks and refuses actor overflow instead of truncating.

Provider inspection reports the warning/hard budgets, connection owner,
per-subscription owner labels, lifecycle state, snapshot version,
auth-barrier/readiness, and outbox suspension reason. Record those owner rows
when debugging fan-out; never infer authority from them.

## Anti-patterns

- One connection per query, cell, render, or retry.
- A process-global connection pool that crosses settled authority or storage
  partitions.
- Starting protected subscriptions while an auth-coordinator-owned blocked
  state is visible, or deriving settlement from a timeout.
- Synchronously subscribing, unsubscribing, or mutating inside an update
  callback.
- Deduplicating equal rows while hiding a real lifecycle transition.
- Rebuilding every query owner after transport-only reconnect.
- Treating `settled()` as disposal, or leaving the owned client open after the
  provider is terminal.
- Treating the 16 warning as a hard cap, or forcing every view into one
  aggregate query despite independent snapshots being sufficient.
- Opening a 65th subscription or partially attaching an over-capacity group.

---

<!-- snapback-guide-source: guide/recipes/split-sensitive-fields.md -->
---
title: "Recipe: split a sensitive field into its own table"
id: recipes.split-sensitive-fields
order: 16
audience: agent-first
capabilities: [auth.table-visibility]
authorities: [llp/0231-entity-and-permissioning-recommendation.rfc.md, llp/0235-field-masking-class-m.spec.md, issues/20260821-0235-field-masking-productization.md, packages/snapback-codegen/define.mjs]
examples: []
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-22
reviewed-authorities-digest: sha256:63d23e482aea60de8c68499c0859b310ae1b231463e358958c6118307eed5e84
---

# Recipe: split a sensitive field into its own table

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this workaround only when most of a row may be visible to a wider audience
but row-level absence of its private half is acceptable to unauthorized
readers. Snapback does not currently provide field masking: it cannot keep one
row visible while conditionally returning one stored field as `null`. If the
public row must remain present with one cell replaced by `null`, as with votes
or tallies, there is no shipped answer. [LLP
0235](repo:llp/0235-field-masking-class-m.spec.md) is the Accepted governing
design, scheduled for implementation after LLP 0294 W6 closes. When row-level
absence is acceptable, the honest supported pattern is to move the sensitive
value to a second table and give that table its own row visibility.

Find this page by: `maskField`, "mask a field", "hide one field",
"mask phone number", "private column", "field level security", or
"column visibility".

## Apply the Messtimate phone-number split

Messtimate needed a consumer-visible record while its phone number stayed
private. Model that record here as a profile split across two tables rather
than as one partially visible record:

| Table | Fields | Visibility |
| --- | --- | --- |
| `profiles` | a stable `profileKey` plus consumer-visible name and status fields | the audience that may see the profile, such as `public-read` or a membership policy |
| `profilePhoneNumbers` | `ownerId`, the same `profileKey`, and `phoneNumber` | `owner` on `ownerId`, or the narrower membership policy that should see the phone row |

Declare a unique index on `profiles.profileKey`. On the private table, declare
an index led by the visibility field, such as
`by_owner_profile: [ownerId, profileKey]`, and make it unique when one phone
record per profile is the product rule. Set `ownerId` from the server-derived
principal; never accept the owner as trusted client input. See
[Protecting data](../auth/protecting-data.md#declare-who-can-read-each-table) for the
supported `public-read`, `owner`, membership, and `anyOf` table policies.

If profile creation requires both records, write them in one mutation so the
public and private halves commit atomically. Table visibility controls reads;
the mutation must still enforce who may create, replace, or delete each half.

The protection comes from row visibility on the second table. On read surfaces
that compose the table policy, an unauthorized reader receives no phone row at
all; Snapback is not masking a field on the public profile row. Search and
vector indexes carry their own visibility and do not inherit the table's
`.visibility(...)` policy. Do not put a public, or otherwise
broader-than-table, search or vector index on the private table. See
[Protecting data](../auth/protecting-data.md#declare-who-can-read-each-table).

## Read the public and private halves

Choose the read shape from the caller's product view:

- For a consumer profile or profile list, query only `profiles`. Its result
  contract must not contain `phoneNumber` or a value derived from it.
- For the signed-in owner's settings screen, query `profilePhoneNumbers` with
  the ordinary caller-bound `ownerId == authUserId()` filter and its
  owner-leading index, then read the matching public profile. Merge the two
  authorized results in the owner-only screen.
- For one server-produced owner-only result, use a bounded
  [`defineRelationalQuery`](../backend/relational-queries.md): make
  `profilePhoneNumbers` the owner-visible root, `profiles` the public or
  appropriately visible joined table, join on the stable unique `profileKey`,
  and declare the output owner-visible. The private table belongs on the root
  side so root access is bounded by the caller's owner-leading index.

Never make the joined output public. Relational output cannot be broader than
either source, and an invisible joined row is treated as absent. If the base
profile must remain visible when the phone row is absent or unauthorized, use
the two-read pattern: a left join whose only owner evidence is on the
omissible private side is deliberately refused.

## Know what this workaround does not protect

This split is row-level authorization, not field-level security or class-M
field masking. In particular, it does not:

- preserve one result-row shape while changing `phoneNumber` between a value
  and `null`;
- protect a phone number left on `profiles`, even if a query projection, JS
  handler, or UI omits it;
- make filters, ordering, indexes, search, aggregates, joins, or handlers over a
  hidden field noninterfering;
- prevent a unique or other constraint over the sensitive field from leaking it
  through success versus refusal, or hide refusal and error codes, public error
  details, public diagnostics, or log text;
- hide public correlation facts such as `hasPhone`, a phone-derived sort key,
  or a public relationship key that the application chose to store;
- suppress client-visible live wake or delivery events, delivery kind,
  invalidation disposition, or delivery timing that could reveal a hidden-value
  change;
- make query or write execution timing constant-time or otherwise
  noninterfering;
- authorize writes, `ctx.db.elevated`, operator/admin access, exports, logs,
  analytics, actions, or external services that receive the value; or
- implement conditional disclosure such as "show the phone after approval"
  without changing which private rows the caller may read.

Accepted [LLP 0235](repo:llp/0235-field-masking-class-m.spec.md) owns the
stronger field-masking design, including logical and physical noninterference.
Acceptance establishes design authority; it does not ship the capability.
Until an implementation proves that contract, keep sensitive bytes out of the
wider table rather than adding projection-only nulling.

## Anti-patterns

- Using this split when unauthorized readers must still receive the public row
  with one field set to `null`; vote and tally shapes need the unshipped class-M
  answer governed by Accepted LLP 0235, not this recipe.
- Keeping `phoneNumber` on `profiles` and removing it in the client, a result
  projection, or a JS handler.
- Giving a search or vector index on `profilePhoneNumbers` public visibility,
  or any visibility broader than the private table policy.
- Fetching the private table with elevated access and deciding in application
  code which callers receive it.
- Publishing the private row or a public joined projection to make the merge
  convenient.
- Treating a missing private row as proof that no phone number exists.
- Claiming the split-table workaround provides field masking or column-level
  noninterference.
