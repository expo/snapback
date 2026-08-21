---
title: "Recipe: list chat members without exposing authority"
id: recipes.membership-roster-projection
order: 14
audience: agent-first
capabilities: [auth.scoped-roles, authority.profile.v1]
authorities: [llp/0056-scoped-roles-and-memberships.rfc.md, llp/0176-expo-messaging-golden-path.plan.md, llp/0240-application-authority-profiles.rfc.md, llp/0295-published-matrix-improvement-program.plan.md, demos/messaging-snapback/snapback/schema.mjs, demos/messaging-snapback/snapback/functions.mjs, demos/messaging-snapback/tests/acceptance/roster-projection.mjs]
examples: [demos/messaging-snapback]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:575790352f75236bb3a66c825aaadac606058b63371e4e785d2870e0db94647d
---

# Recipe: list chat members without exposing authority

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this recipe when the product request sounds like “list chat members,”
“show roster,” “who is in the room,” or “enumerate members.” Do **not** solve
it by making the membership table public. Declare two different stores:

Search phrases: list chat members; show roster; who is in the room; membership
table public; enumerate members.

- a private membership declaration for current authorization; and
- an ordinary app-visible projection table for the display roster.

This is today's sanctioned interim pattern. It does not pre-commit this recipe
to a future LLP 0295 D0.4 option, public spelling, flag, or API. The application
owns the duplicate writes and drift check until a generated design actually
lands; do not describe this as Snapback's final mirror protocol.

## Put each fact in one authoritative home

| Fact | Home | May authorize? | Lifetime |
| --- | --- | --- | --- |
| current `(conversation, principal, role)` and closed transition policy | private `conversationMemberships` declaration | yes | current authority only |
| handle/avatar/name, display role, current `joinedAt` | ordinary `conversationMembers` projection | no | current product incarnation |
| recipients and their roles when a message was sent | `messages.recipientSnapshot` | no | immutable product history |
| delivered/read acknowledgements | `messages.deliveredBy` / `readBy` | no | history over the frozen recipient set |

The creator seat is server-derived and cannot carry arbitrary application
fields through `bootstrap()`. Therefore the authority row's optional
`joinedAt` is not product history. The projection gives every current member a
required join time; leave deletes that current row, and re-add inserts a new
row with a new join time. If the product needs every past incarnation, append
a separate history row rather than preserving departed principals in the
current roster.

The app-visible projection can itself use any ordinary visibility policy the
product requires. This demo keeps its pre-existing `public-read` product
posture; that does not make the owner-visible membership backing public. For a
private chat product, narrow the projection with an admitted table visibility
policy—the authority declaration still remains the only authorization source.

## Declare the private authority and visible projection separately

The transition matrix admits exactly owner add, owner promotion, owner remove,
and member/moderator self-leave. Today's principal-addressed promotion and
removal require a local `authorityProfile`; its bounded `list` reveals only
the declared visible principal/role fields, never a private membership-row id.
The profile also generates direct `changeRole` and `remove` writers. Those
writers do **not** maintain the ordinary projection, so make one application
coordinator the only client call site for the generated operation plus the
checked reconciliation described below. The drift acceptance is mandatory.

```js source=demos/messaging-snapback/snapback/schema.mjs
export const conversationMembers = defineTable({
  conversationId: v.id('conversations'),
  userHandle: v.string(),
  // This copy is presentation state only. Authorization always consults the
  // private conversationMemberships declaration below.
  role: v.string(),
  joinedAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_conversation', ['conversationId'])
  .index('by_user', ['userHandle'])
  .index('by_conversation_user', ['conversationId', 'userHandle'], { unique: true });

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
      { op: 'remove', by: ['owner'], target: 'other', from: ['moderator', 'member'] },
      { op: 'remove', by: ['self'], target: 'self', from: ['moderator', 'member'] },
    ],
  })
  // Today's principal-addressed changeRole/remove commands require a local
  // authority profile. Its generated writers are not projection-aware, so
  // application clients must use the synchronized mutations in functions.mjs;
  // the acceptance drift check makes that interim obligation reviewable.
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

Child product tables use an authored `conversationId` resource key. Do not use
Familiar `resourceField: "_id"` when `_id` is outside the authored field union,
and never copy a private membership-row id into the projection.

Render the settings roster from the ordinary projection only. This query does
not read the private declaration and returns no authority-row identity:

```js source=demos/messaging-snapback/snapback/functions.mjs
const rosterRow = v.object({
  userHandle: v.string(),
  role: v.string(),
  joinedAt: v.integer(),
});

// Product-visible current roster. This demo retains its public product-read
// posture; private products should narrow this projection's ordinary table
// visibility without making the authority rows enumerable.
export const conversationRoster = defineJsLiveQuery({
  args: { conversationId: v.id('conversations') },
  auth: 'authenticated',
  result: results.records(rosterRow),
  reads: ['conversationMembers'],
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('conversationMembers')
      .withIndex('by_conversation')
      .eq('conversationId', args.conversationId)
      .take(500)
      .collect();
    return rows.map((row) => ({
      userHandle: row.userHandle,
      role: row.role,
      joinedAt: row.joinedAt,
    }));
  },
});
```

## Keep one governed transition path

Bootstrap, add, and self-leave issue one membership command plus their ordinary
projection writes in one mutation. Promotion and other-member removal have a
shipped limitation: the principal-addressed authority command is callable only
through its codegen-synthesized profile operation. For those two operations,
one application coordinator must:

1. decide `absent`/`unchanged` from the admitted product roster;
2. call `api.conversationMemberships.changeRole` or `.remove`; then
3. call the matching reconciliation mutation, which re-reads the admitted
   authority roster through `ctx.authority` and refuses to project a state the
   authority operation did not establish.

That pair is not a single transaction and the page makes no atomicity claim
for it. This is the known cost of today's sanctioned interim. Do not scatter
the pair across UI components or expose a generic projection patch endpoint.
The future D0.4 work may replace this seam, but this recipe does not invent its
option or public API in advance.

Keep the two non-atomic operations behind one coordinator with explicit
preflight branches:

```js source=demos/messaging-snapback/tests/acceptance/roster-projection.mjs
async function promoteMember(conversationId, userHandle) {
  const roster = await query(api.conversationRoster, { conversationId }, OWNER);
  const current = roster.rows.find((member) => member.userHandle === userHandle);
  if (!current) return { outcome: 'absent' };
  if (current.role === 'moderator') return { outcome: 'unchanged' };
  await mutate(api.conversationMemberships.changeRole, {
    scopeId: conversationId,
    principal: userHandle,
    role: 'moderator',
  }, OWNER);
  return (await mutate(api.promoteConversationMember, {
    conversationId,
    userHandle,
  }, OWNER)).result;
}

async function removeMember(conversationId, userHandle) {
  const roster = await query(api.conversationRoster, { conversationId }, OWNER);
  if (!roster.rows.some((member) => member.userHandle === userHandle)) {
    return { outcome: 'unchanged' };
  }
  await mutate(api.conversationMemberships.remove, {
    scopeId: conversationId,
    principal: userHandle,
  }, OWNER);
  return (await mutate(api.removeConversationMember, {
    conversationId,
    userHandle,
  }, OWNER)).result;
}
```

Bootstrap creates the resource, private creator/initial seats, and ordinary
projection rows in one mutation:

```js source=demos/messaging-snapback/snapback/functions.mjs
export const createGroup = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {
    title: v.string(),
    creatorHandle: v.string(),
    creatorName: v.string(),
    memberHandles: v.array(v.string()),
  },
  result: results.value(v.id('conversations')),
  writes: ['conversations', 'conversationMembers', 'conversationMemberships'],
  handler: async (ctx, args) => {
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('a group needs a name');
    // @ref LLP 0056#dated-amendment-bounded-atomic-bootstrap-rosters-2026-08-15 — do
    // not let an authenticated caller split the creator principal from the
    // handle written into the legacy product projections.
    const creatorHandle = ctx.auth.userId;
    const uniqueOthers = Array.from(new Set(args.memberHandles.filter((h) => h !== creatorHandle)));
    if (uniqueOthers.length < 1) throw new Error('a group needs at least one other member');
    const allHandles = [creatorHandle, ...uniqueOthers];
    const now = ctx.runtime.now();
    const conversationId = await ctx.membership.conversationMemberships.bootstrap({
      kind: 'group',
      title,
      memberHandles: allHandles,
      lastMessageText: `${args.creatorName} created the group`,
      lastMessageAuthorName: '',
      lastMessageAt: now,
      createdAt: now,
    }, uniqueOthers.map((userHandle) => ({ userHandle, role: 'member', joinedAt: now })));
    for (const handle of allHandles) {
      await ctx.db.insert('conversationMembers', {
        conversationId,
        userHandle: handle,
        role: handle === creatorHandle ? 'owner' : 'member',
        joinedAt: now,
      });
    }
    return conversationId;
  },
});
```

```js source=demos/messaging-snapback/snapback/functions.mjs
// These two ordinary product mutations are also the sessions acceptance seam:
// a member may leave, and the conversation owner may seat that principal again.
export const leaveConversation = defineJsMutation({
  auth: 'authenticated',
  args: { conversationId: v.id('conversations') },
  result: results.value(v.object({ outcome: v.string() })),
  reads: ['conversationMembers', 'conversations'],
  writes: ['conversationMemberships', 'conversationMembers', 'conversations'],
  handler: async (ctx, args) => {
    // @ref LLP 0176#one-owner-many-projections — the canonical roster and both
    // legacy read projections move together in this one mutation.
    const memberHandle = ctx.auth.userId;
    const projectedMembership = await ctx.db
      .query('conversationMembers')
      .withIndex('by_conversation_user')
      .eq('conversationId', args.conversationId)
      .eq('userHandle', memberHandle)
      .first();
    if (!projectedMembership) return { outcome: 'unchanged' };
    const conversation = await ctx.db.get('conversations', args.conversationId);
    if (!conversation) throw new Error('conversation not found');
    await ctx.membership.conversationMemberships.removeSelf(args.conversationId);
    await ctx.db.delete('conversationMembers', projectedMembership._id);
    await ctx.db.patch('conversations', args.conversationId, {
      memberHandles: conversation.memberHandles.filter((handle) => handle !== memberHandle),
    });
    return { outcome: 'changed' };
  },
});

export const addConversationMember = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {
    conversationId: v.id('conversations'),
    userHandle: v.principal(),
  },
  result: results.value(v.object({ outcome: v.string() })),
  reads: ['conversationMemberships', 'conversationMembers', 'conversations'],
  writes: ['conversationMemberships', 'conversationMembers', 'conversations'],
  handler: async (ctx, args) => {
    // @ref LLP 0176#one-owner-many-projections — seating a principal updates the
    // authority roster, inbox edge, and member-count projection atomically.
    await ctx.permissions.conversationMemberships.requireRole(args.conversationId, 'owner');
    const conversation = await ctx.db.get('conversations', args.conversationId);
    if (!conversation) throw new Error('conversation not found');
    const projectedMembership = await ctx.db
      .query('conversationMembers')
      .withIndex('by_conversation_user')
      .eq('conversationId', args.conversationId)
      .eq('userHandle', args.userHandle)
      .first();
    if (projectedMembership) return { outcome: 'unchanged' };
    const now = ctx.runtime.now();
    await ctx.membership.conversationMemberships.insert({
      conversationId: args.conversationId,
      userHandle: args.userHandle,
      role: 'member',
      joinedAt: now,
    });
    await ctx.db.insert('conversationMembers', {
      conversationId: args.conversationId,
      userHandle: args.userHandle,
      role: 'member',
      joinedAt: now,
    });
    if (!conversation.memberHandles.includes(args.userHandle)) {
      await ctx.db.patch('conversations', args.conversationId, {
        memberHandles: [...conversation.memberHandles, args.userHandle],
      });
    }
    return { outcome: 'changed' };
  },
});

export const promoteConversationMember = defineJsMutation({
  auth: 'authenticated',
  args: {
    conversationId: v.id('conversations'),
    userHandle: v.principal(),
  },
  result: results.value(v.object({ outcome: v.string() })),
  reads: ['conversationMemberships', 'conversationMembers'],
  writes: ['conversationMembers'],
  handler: async (ctx, args) => {
    await ctx.permissions.conversationMemberships.requireRole(args.conversationId, 'owner');
    const projectedMembership = await ctx.db
      .query('conversationMembers')
      .withIndex('by_conversation_user')
      .eq('conversationId', args.conversationId)
      .eq('userHandle', args.userHandle)
      .first();
    if (!projectedMembership) return { outcome: 'absent' };
    const authority = await ctx.authority.conversationMemberships.list(
      args.conversationId,
      { limit: 500 },
    );
    const authoritativeMember = authority.rows.find(
      (member) => member.userHandle === args.userHandle,
    );
    if (authoritativeMember?.role !== 'moderator') {
      throw new Error('run conversationMemberships.changeRole before reconciling the projection');
    }
    if (projectedMembership.role === 'moderator') return { outcome: 'unchanged' };
    await ctx.db.patch('conversationMembers', projectedMembership._id, { role: 'moderator' });
    return { outcome: 'changed' };
  },
});

export const removeConversationMember = defineJsMutation({
  auth: 'authenticated',
  args: {
    conversationId: v.id('conversations'),
    userHandle: v.principal(),
  },
  result: results.value(v.object({ outcome: v.string() })),
  reads: ['conversationMemberships', 'conversationMembers', 'conversations'],
  writes: ['conversationMembers', 'conversations'],
  handler: async (ctx, args) => {
    await ctx.permissions.conversationMemberships.requireRole(args.conversationId, 'owner');
    const projectedMembership = await ctx.db
      .query('conversationMembers')
      .withIndex('by_conversation_user')
      .eq('conversationId', args.conversationId)
      .eq('userHandle', args.userHandle)
      .first();
    const authority = await ctx.authority.conversationMemberships.list(
      args.conversationId,
      { limit: 500 },
    );
    if (authority.rows.some((member) => member.userHandle === args.userHandle)) {
      throw new Error('run conversationMemberships.remove before reconciling the projection');
    }
    if (!projectedMembership) return { outcome: 'unchanged' };
    const conversation = await ctx.db.get('conversations', args.conversationId);
    if (!conversation) throw new Error('conversation not found');
    await ctx.db.delete('conversationMembers', projectedMembership._id);
    await ctx.db.patch('conversations', args.conversationId, {
      memberHandles: conversation.memberHandles.filter((handle) => handle !== args.userHandle),
    });
    return { outcome: 'changed' };
  },
});
```

Bootstrap uses the atomic form: call
`conversationMemberships.bootstrap(resourceValues, initialMembers)` once,
then insert the creator and initial members into `conversationMembers` before
the mutation returns. A failed command or ordinary write rolls back the whole
mutation.

The branch contract is explicit:

- add existing → `unchanged`;
- promote missing → `absent`, promote an existing moderator → `unchanged`;
- remove missing → `unchanged`; and
- leave with no current projection row → `unchanged`.

Those are app outcomes, not membership-existence oracles for an unauthorized
caller. Owner mutations call `requireRole` first. Self-leave sees only the
server-derived caller and never accepts a target principal.

## Freeze receipt membership when the message is sent

Authorize the send against the private declaration, enumerate the synchronized
product projection with an explicit ceiling, and write the recipient snapshot
on the message in the same transaction. The projection supplies product data;
it does not grant send authority.

```js source=demos/messaging-snapback/snapback/functions.mjs
    const currentRoster = await ctx.db
      .query('conversationMembers')
      .withIndex('by_conversation')
      .eq('conversationId', args.conversationId)
      .take(501)
      .collect();
    if (currentRoster.length > 500) {
      ctx.refuse('MESSAGE_RECIPIENT_LIMIT', { limit: 500 });
    }
    const recipientSnapshot = currentRoster
      .filter((member) => member.userHandle !== ctx.auth.userId)
      .map((member) => ({ userHandle: member.userHandle, roleAtSend: member.role }));
    const now = ctx.runtime.now();
    const messageId = await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      authorHandle: args.authorHandle,
      authorName: args.authorName,
      body,
      ...(args.replyToId ? { replyToId: args.replyToId } : {}),
      ...(args.assetId
        ? { image: await ctx.assets.attach(args.assetId, { upload: 'messageImageUpload' }) }
        : {}),
      recipientSnapshot,
      deliveredBy: [],
      readBy: [],
      createdAt: now,
    });
    // @ref LLP 0240#authority-facts-versus-product-facts — freeze receipt
    // membership from the synchronized product roster in the send transaction.
    // Later joins, leaves, kicks, and promotions never rewrite this snapshot.
```

Later joins never enter an old snapshot. Later leave/remove never deletes a
recipient or acknowledgement from it. Later promotion never changes
`roleAtSend`. Receipt aggregates use the frozen set as their denominator; a
newly joined principal cannot acknowledge an older message, while a departed
recipient's already-recorded delivery/read fact remains history.

## Prove authority and projection cannot drift silently

The acceptance uses the profile's admitted, bounded authority roster—not an
operator scan—and compares only declared principal/role facts with the product
projection. No app result contains a private authority-row id.

```js source=demos/messaging-snapback/tests/acceptance/roster-projection.mjs
async function assertRosterSynchronized(conversationId, label) {
  // The profile's bounded list is the admitted authority view: it exposes no
  // private row id. Compare it with the ordinary product query after every
  // app-owned transition so a missed companion write fails this acceptance.
  const [authority, projection] = await Promise.all([
    query(api.conversationMemberships.list, { scopeId: conversationId }, OWNER),
    query(api.conversationRoster, { conversationId }, OWNER),
  ]);
  const normalize = (rows) => rows
    .map((row) => `${row.userHandle}:${row.role}`)
    .sort();
  assertEqual(
    normalize(projection.rows),
    normalize(authority.rows),
    `${label}: product roster matches admitted authority roster`,
  );
  return normalize(authority.rows);
}
```

The dedicated dev-mode acceptance calls that comparison after bootstrap, add and
retry, promotion plus missing/current-role branches, a later join and leave,
remove and absent retry, and leave and retry. The later join is refused when it
tries to acknowledge the older message. The check then proves that the earlier
message still names its departed principals and their receipt state. This check
is mandatory for the interim app-maintained pattern: a projection mismatch is
a failing invariant, never permission to authorize from whichever table looks
convenient.

For the ephemeral room bound to this same authority declaration, continue with
[declare membership and the typing room together](./typing-indicators.md#1-declare-membership-and-the-typing-room-together).
For typing lifetime, use the separate
[activity presence heartbeat recipe](./activity-presence.md#recipe-activity-presence-heartbeats-and-withdrawal);
roster projection is durable product state, not presence.

## Anti-patterns

- Making the membership table public to “show roster” or “enumerate members.”
- Reading the projection as authority or accepting caller-supplied roles.
- Copying a private membership-row id into an app-visible table.
- Scattering the required generated-operation/reconciliation pair across UI
  call sites instead of keeping it in one application coordinator.
- Treating `bootstrap()` as able to stamp arbitrary creator-seat product data.
- Recomputing an old recipient set from current membership.
- Removing departed recipients from receipt aggregates.
- Teaching this interim composition as the chosen future D0.4 API.
