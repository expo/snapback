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
[`useSnapbackPresence`](../realtime/ephemeral-state.md#find-the-react-hook-from-ephemeral-vocabulary),
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
reviewed: 2026-08-17
reviewed-authorities-digest: sha256:6655d93fe02e6bd5a58ecd5bd0240c2479195e265404cec00047e8fdd5e2e4fd
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

The messaging demo keeps its public conversation projection separate from this
restricted canonical authority table. One row means current membership; removal
deletes the row rather than preserving a historical incarnation:

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
    roles: ['owner', 'member'],
    bootstrapRole: 'owner',
    provenance: 'full',
    transitions: [
      { op: 'insert', by: ['owner'], target: 'other', to: ['member'], fields: ['joinedAt'] },
      { op: 'remove', by: ['self'], target: 'self', from: ['member'] },
    ],
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
      // @ref LLP 0013#authorization-and-privacy — both operations bind to one
      // durable membership declaration so removal revokes the whole room edge.
      publish: allow.members('conversationMemberships'),
      subscribe: allow.members('conversationMemberships'),
    }),
```

Codegen emits the generated `m_conversationMemberships` permission prefix and
the durable `permissionBacking` projection. V1 intentionally accepts only one
room scope field, and that field must be exactly `v.id()` of the membership
resource table. It refuses `pendingRoles`, `roles` narrowing, app-scoped
memberships, multi-field scope, unknown declarations, wrong-table ids, and any
mix of `allow.members()` with `allow.all()`.

## 2. Publish on activity and withdraw on idle

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

For a former member, remove the canonical row while subscriptions are live.
The former member receives one terminal denial, cannot publish, and receives no
later frames; a surviving member receives the `AuthRevoked` removal:

```js source=demos/messaging-snapback/tests/acceptance/headless.mjs
  await suite.check('typing membership (e): removing B revokes B and removes B from A', async () => {
    await app.clients.recipientA.mutate(api.leaveConversation, {
      args: { conversationId: typingConversationId },
    });

    await eventually(async () => {
      await Promise.all([memberAOverlay.drain(), memberBOverlay.drain()]);
      const denied = ephemeralMessage(memberBFrames.at(-1));
      assert(memberBTerminalMessage, 'removed member receives the PermissionDenied terminal frame');
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
        'removed member terminal frame carries the successor authority generation',
      );
      const revoked = memberAFrames
        .map(ephemeralMessage)
        .find((message) => (
          message?.Remove?.key === memberBEntryKey
          && message.Remove.reason === 'AuthRevoked'
        ));
      assert(revoked, 'surviving member receives the AuthRevoked removal frame');
      assert(
        !memberAOverlay.currentEntries().some((entry) => entry.key === memberBEntryKey),
        'member A no longer sees member B typing',
      );
    }, 'membership removal revokes B and deletes B typing');

    const publishError = await captureRejection(memberBOverlay.publish(
      { userHandle: recipientAPrincipal, name: 'Removed member B' },
      { ttlMs: typingRef.maxTtlMs },
    ), 'removed member typing publish');
    assertPermissionDenied(publishError, 'removed member typing publish');

    assertEqual(
      memberBFrames.length,
      memberBTerminalFrameCount,
      'removed member receives zero frames between terminal denial and survivor probe',
    );
    await memberAOverlay.publish(
      { userHandle: ownerPrincipal, name: 'Member A after removal' },
      { ttlMs: typingRef.maxTtlMs },
    );
    await memberAOverlay.drain();
    await memberBOverlay.drain();
    assertEqual(
      memberBFrames.length,
      memberBTerminalFrameCount,
      'removed member subscription stays silent after its terminal frame',
    );
    const removal = memberAFrames
      .map(ephemeralMessage)
      .find((message) => (
        message?.Remove?.key === memberBEntryKey
        && message.Remove.reason === 'AuthRevoked'
      ));
    return {
      removedSubscriberFrameCode: memberBTerminalMessage.Error.error.code,
      successorAuthorityGeneration: memberBTerminalMessage.Error.room_authority_generation,
      survivorRemovalReason: removal.Remove.reason,
      formerMemberPublish: publishError.diagnostic.code,
      postTerminalFrames: memberBFrames.length - memberBTerminalFrameCount,
    };
  });
```

Keep the two positive witnesses in the same battery: member A sees member B's
typing entry before removal, and B can publish through a fresh subscription
after rejoin. Together these are the five capability scenarios, not merely
three static denials.

The terminal behavior above is currently a wire-level proof. The base client
overlay has no `Error` arm, so React/activity hooks do not yet expose the
removed member's terminal status or diagnostic; follow
[`issues/20260817-ephemeral-overlay-missing-error-arm.md`](repo:issues/20260817-ephemeral-overlay-missing-error-arm.md).

## Sessions and direct/dev prove different things

- **Sessions is the privacy proof.** The authenticated principal and emitted
  durable projection decide membership. Removal invalidates the live room edge
  and later publication.
- **Direct/dev is an assertion harness.** The caller supplies `userId` and
  `roomPermission('m_<declarationId>', scope)`. It proves room behavior, not
  that the server derived the authority from membership.
- **Role is not a v1 predicate.** `allow.members(..., { roles })` and
  declarations with `pendingRoles` fail closed. A role downgrade is not yet a
  kick; track the role-narrowing follow-on from the reference page.

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
authorities: [llp/0220-recipient-bound-asset-grants.plan.md, llp/0210-asset-upload-dx-closure.rfc.md, llp/0044-asset-storage-pipeline.rfc.md, src/storage/asset_grants.rs, demos/messaging-snapback/snapback/schema.mjs, demos/messaging-snapback/snapback/functions.mjs, demos/messaging-snapback/tests/acceptance/headless.mjs]
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
        rows = (await fixture.client.query(api.getMyProfile, { args: {} })).rows;
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
      const profileId = (await fixture.client.mutate(api.ensureMyProfile, {
        args: {
          fixtureId: persona.id,
          handle: persona.profile.handle,
          displayName: persona.profile.displayName,
          bio: persona.profile.bio,
          location: persona.profile.location,
          link: persona.profile.link,
        },
      })).result;

      rows = (await fixture.client.query(api.getMyProfile, { args: {} })).rows;
      if (rows.length !== 1 || rows[0]._id !== profileId) {
        throw new Error(`fixture ${persona.id} did not resolve its own profile`);
      }
      if (!await avatarMatchesFixture(fixture.client, rows[0], avatarDigest)) {
        const bytes = readFileSync(join(fixtureRoot, persona.profile.avatar));
        const assets = createAssetClient(fixture.client);
        const upload = assets.start({
          upload: api.avatarUpload,
          file: new Blob([bytes], { type: 'image/png' }),
          declaredFilename: `${persona.id}-avatar.png`,
          declaredContentType: 'image/png',
        });
        const terminal = await upload.done;
        if (terminal.status !== 'ready') {
          throw new Error(`fixture ${persona.id} avatar failed: ${JSON.stringify(terminal.diagnostic ?? terminal)}`);
        }
        await fixture.client.mutate(api.attachMyAvatar, {
          args: {
            profileId,
            assetId: terminal.assetId,
            sourceDigest: avatarDigest,
          },
        });
        rows = (await fixture.client.query(api.getMyProfile, { args: {} })).rows;
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
