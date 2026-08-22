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
