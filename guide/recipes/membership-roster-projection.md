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
reviewed-authorities-digest: sha256:02fa9a165c7a62e27bd573b9cf13ce0e74a95055035087c96b20285727ed5310
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

Packaged full-prompt probes (kept on literal lines because `snapback guide`
performs substring search):

- Render a chat display roster with join dates and keep send-time recipients, but the membership roster is private.
- list chat members without exposing the private authority rows.
- show roster with roles and join dates for a chat room.
- who is in the room now, and who received a message before someone left?
- Should I make the membership table public so the client can render members?
- enumerate members for a room settings screen and support add, promote, remove, and leave retries.

- a private membership declaration for current authorization; and
- an ordinary app-visible projection table for the display roster.

This is today's sanctioned interim pattern. LLP 0240's D0.4 amendment has
selected platform-generated projection facts as the prototype direction, but
that design and its public spelling, flag, and API have not shipped. The
application owns duplicate writes, fail-closed drift checks, and repair until
the selected generated design lands; do not describe this interim as
Snapback's final mirror protocol.

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

Product-visible does not mean public. For a private room, the projection must
use an admitted membership-scoped table visibility policy and every roster or
historical-recipient handler must require current room admission before it
returns facts. Authentication alone is not room admission. The private
authority declaration remains the only authorization source.

Do not duplicate roster facts onto a public conversation row. The inbox may
assemble its admitted summaries from `conversationMembers`, while the thread UI
reads `conversationRoster`. Conversation metadata and the message feed repeat
the current-room admission check, and `messages` itself uses the same
membership-scoped visibility posture as the roster projection.

## Declare the private authority and visible projection separately

The transition matrix admits owner add, owner promotion, owner remove, and
member/moderator self-leave. The local `authorityProfile` exposes a bounded
`list` with only declared principal/role fields, never a private membership-row
id. It also publicly generates `invite`, `leave`, `changeRole`, `transferOwner`,
and `remove`. None maintains the ordinary projection. Those writers cannot be
made exclusive by application convention, so this composition is partial:
guarded consumers must detect drift and fail closed, an owner-only repair must
be retryable, and acceptance must exercise direct/bypass writers.

```js source=demos/messaging-snapback/snapback/schema.mjs
export const conversationMembers = defineTable({
  conversationId: v.id('conversations'),
  userHandle: v.string(),
  // This copy is presentation state only. Authorization always consults the
  // private conversationMemberships declaration below.
  role: v.string(),
  joinedAt: v.integer(),
})
  // Product-visible does not mean public. Every ordinary read is scoped by
  // current admission through the canonical private membership declaration.
  .visibility({
    kind: 'membership',
    declaration: 'conversationMemberships',
    resourceField: 'conversationId',
    roles: ['member'],
  })
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

Child product tables use an authored `conversationId` resource key. Do not use
Familiar `resourceField: "_id"` when `_id` is outside the authored field union,
and never copy a private membership-row id into the projection.

Render the settings roster from the ordinary projection only, but require
current membership before reading it. The table policy is a second fail-closed
fence; the explicit handler check prevents an authenticated caller from using
arbitrary room ids as a roster oracle. The result returns no authority-row
identity:

```js source=demos/messaging-snapback/snapback/functions.mjs
const rosterRow = v.object({
  userHandle: v.string(),
  role: v.string(),
  joinedAt: v.integer(),
});

// Product-visible current roster. Membership-scoped table visibility and the
// explicit admission check below are both mandatory; authentication alone is
// not permission to enumerate an arbitrary room.
export const conversationRoster = defineJsLiveQuery({
  args: { conversationId: v.id('conversations') },
  auth: 'authenticated',
  result: results.records(rosterRow),
  reads: ['conversationMemberships', 'conversationMembers'],
  handler: async (ctx, args) => {
    await ctx.permissions.conversationMemberships.requireRole(
      args.conversationId,
      'owner',
      'moderator',
      'member',
    );
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

The inbox viewer is never an argument. Derive it from `ctx.auth`, and make the
closed `{}` argument contract reject attempts to query another principal's
rooms:

```js source=demos/messaging-snapback/snapback/functions.mjs
export const myConversations = defineJsLiveQuery({
  args: {},
  auth: 'authenticated',
  result: results.records(conversationSummary),
  reads: ['conversationMembers', 'conversations'],
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query('conversationMembers')
      .withIndex('by_user')
      .eq('userHandle', ctx.auth.userId)
      .take(500)
      .collect();
```

Historical recipient/receipt facts are not public merely because they are
immutable. Scope the stored message row by its authored `conversationId`:

```js source=demos/messaging-snapback/snapback/schema.mjs
  // Bodies and frozen recipient facts belong only to current room members.
  // The feed handler repeats this admission check before reading either the
  // messages or their public reaction rows.
  .visibility({
    kind: 'membership',
    declaration: 'conversationMemberships',
    resourceField: 'conversationId',
    roles: ['member'],
  })
```

Take the room id alongside the message id, require **current** admission before
the row read, and confirm the message belongs to that room. This keeps both the
table read and the function path non-enumerating:

```js source=demos/messaging-snapback/snapback/functions.mjs
  handler: async (ctx, args) => {
    await ctx.permissions.conversationMemberships.requireRole(
      args.conversationId,
      'owner',
      'moderator',
      'member',
    );
    const message = await ctx.db.get('messages', args.messageId);
    if (!message || message.conversationId !== args.conversationId) return [];
    return [{
      messageId: message._id,
      recipients: message.recipientSnapshot ?? [],
      deliveredBy: message.deliveredBy ?? [],
      readBy: message.readBy ?? [],
    }];
  },
```

## Keep one retryable coordinator, but do not call it exclusive

Bootstrap, app-authored add, and app-authored self-leave issue one membership
command plus ordinary projection writes in one mutation. Every generated
profile writer remains directly callable. A client coordinator should normally
call the generated authority operation and then one idempotent reconciliation
mutation, but that is ergonomics—not governance and not an exclusivity claim.

The enforceable boundary is:

1. sensitive consumers compare admitted authority facts with the projection
   and refuse with `CONVERSATION_ROSTER_DRIFT` before using stale data;
2. the owner-only reconciliation mutation reads the admitted authority roster
   and converges the display rows; and
3. retrying reconciliation after an interruption is safe and returns
   `unchanged` once converged.

The authority write and reconciliation are not one transaction. A durable
client job/outbox must retain the unfinished reconciliation until it succeeds;
after a process loss, the fail-closed consumer is the backstop and the same
repair is the recovery action. Direct `invite`, `leave`, `changeRole`,
`transferOwner`, or `remove` bypasses may create drift, but cannot feed a new
recipient snapshot because sends check the pair first. This is the cost of the
interim until the selected platform-generated D0.4 design ships.

Keep the recovery call small and idempotent:

```js source=demos/messaging-snapback/tests/acceptance/roster-projection.mjs
async function reconcileRoster(conversationId, userId = OWNER) {
  return (await mutate(api.reconcileConversationRoster, { conversationId }, userId)).result;
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
    // handle written into the product projection.
    const creatorHandle = ctx.auth.userId;
    const uniqueOthers = Array.from(new Set(args.memberHandles.filter((h) => h !== creatorHandle)));
    if (uniqueOthers.length < 1) throw new Error('a group needs at least one other member');
    const allHandles = [creatorHandle, ...uniqueOthers];
    const now = ctx.runtime.now();
    const conversationId = await ctx.membership.conversationMemberships.bootstrap({
      kind: 'group',
      title,
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
  reads: ['conversationMemberships', 'conversationMembers'],
  writes: ['conversationMemberships', 'conversationMembers'],
  handler: async (ctx, args) => {
    // @ref LLP 0176#one-owner-many-projections — the canonical roster and its
    // product projection move together in this one mutation.
    const memberHandle = ctx.auth.userId;
    const admitted = await ctx.permissions.conversationMemberships.allowsRole(
      args.conversationId,
      'owner',
      'moderator',
      'member',
    );
    if (!admitted) return { outcome: 'unchanged' };
    const projectedMembership = await ctx.db
      .query('conversationMembers')
      .withIndex('by_conversation_user')
      .eq('conversationId', args.conversationId)
      .eq('userHandle', memberHandle)
      .first();
    await ctx.membership.conversationMemberships.removeSelf(args.conversationId);
    if (projectedMembership) await ctx.db.delete('conversationMembers', projectedMembership._id);
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
  reads: ['conversationMemberships', 'conversationMembers'],
  writes: ['conversationMemberships', 'conversationMembers'],
  handler: async (ctx, args) => {
    // @ref LLP 0176#one-owner-many-projections — seating a principal updates the
    // authority roster, inbox edge, and member-count projection atomically.
    await ctx.permissions.conversationMemberships.requireRole(args.conversationId, 'owner');
    const authority = await ctx.authority.conversationMemberships.list(
      args.conversationId,
      { limit: 500 },
    );
    const authoritativeMembership = authority.rows
      .find((member) => member.userHandle === args.userHandle);
    const projectedMembership = await ctx.db
      .query('conversationMembers')
      .withIndex('by_conversation_user')
      .eq('conversationId', args.conversationId)
      .eq('userHandle', args.userHandle)
      .first();
    if (authoritativeMembership && projectedMembership) return { outcome: 'unchanged' };
    const now = ctx.runtime.now();
    if (!authoritativeMembership) {
      await ctx.membership.conversationMemberships.insert({
        conversationId: args.conversationId,
        userHandle: args.userHandle,
        role: 'member',
        joinedAt: now,
      });
    }
    if (projectedMembership) await ctx.db.delete('conversationMembers', projectedMembership._id);
    await ctx.db.insert('conversationMembers', {
      conversationId: args.conversationId,
      userHandle: args.userHandle,
      role: authoritativeMembership?.role ?? 'member',
      joinedAt: now,
    });
    return { outcome: 'changed' };
  },
});

export const reconcileConversationRoster = defineJsMutation({
  auth: 'authenticated',
  args: { conversationId: v.id('conversations') },
  result: results.value(v.object({
    outcome: v.string(),
    inserted: v.integer(),
    updated: v.integer(),
    removed: v.integer(),
  })),
  reads: ['conversationMemberships', 'conversationMembers'],
  writes: ['conversationMembers'],
  handler: async (ctx, args) => {
    await ctx.permissions.conversationMemberships.requireRole(args.conversationId, 'owner');
    const authority = await ctx.authority.conversationMemberships.list(
      args.conversationId,
      { limit: 500 },
    );
    const projected = await ctx.db
      .query('conversationMembers')
      .withIndex('by_conversation')
      .eq('conversationId', args.conversationId)
      .take(500)
      .collect();
    const projectedByPrincipal = new Map(
      projected.map((member) => [member.userHandle, member]),
    );
    const authorityByPrincipal = new Map(
      authority.rows.map((member) => [member.userHandle, member]),
    );
    let inserted = 0;
    let updated = 0;
    let removed = 0;
    for (const member of authority.rows) {
      const current = projectedByPrincipal.get(member.userHandle);
      if (!current) {
        await ctx.db.insert('conversationMembers', {
          conversationId: args.conversationId,
          userHandle: member.userHandle,
          role: member.role,
          // A direct generated invite can commit before the app projection.
          // Recovery owns the new visible incarnation time at repair.
          joinedAt: ctx.runtime.now(),
        });
        inserted += 1;
      } else if (current.role !== member.role) {
        await ctx.db.patch('conversationMembers', current._id, { role: member.role });
        updated += 1;
      }
    }
    for (const member of projected) {
      if (!authorityByPrincipal.has(member.userHandle)) {
        await ctx.db.delete('conversationMembers', member._id);
        removed += 1;
      }
    }
    const changed = inserted + updated + removed;
    return {
      outcome: changed === 0 ? 'unchanged' : 'changed',
      inserted,
      updated,
      removed,
    };
  },
});
```

Bootstrap uses the atomic form: call
`conversationMemberships.bootstrap(resourceValues, initialMembers)` once,
then insert the creator and initial members into `conversationMembers` before
the mutation returns. A failed command or ordinary write rolls back the whole
mutation.

The branch contract is explicit: atomic app add/self-leave and the repair
mutation return `unchanged` once their local state is already current. Generated
operations retain their own closed receipt/refusal contract; do not preflight
them from an unfenced product roster and do not relabel an application
short-circuit as coverage of a generated operation's absent/idempotent branch.
Owner mutations call `requireRole` first. Self-leave sees only the
server-derived caller and never accepts a target principal. The app mutations
preflight canonical authority, not the fallible projection: an interrupted
generated remove followed by app add opens a fresh projected incarnation, and
an interrupted generated invite followed by app leave still removes authority.

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
    const authority = await ctx.authority.conversationMemberships.list(
      args.conversationId,
      { limit: 500 },
    );
    const rosterFacts = currentRoster
      .map((member) => `${member.userHandle}:${member.role}`)
      .sort();
    const authorityFacts = authority.rows
      .map((member) => `${member.userHandle}:${member.role}`)
      .sort();
    // @ref LLP 0240#authority-facts-versus-product-facts — the interim mirror
    // is not an authority source. A missed/bypass projection write fails closed
    // before stale members can enter a new historical recipient snapshot.
    if (JSON.stringify(rosterFacts) !== JSON.stringify(authorityFacts)) {
      ctx.refuse('CONVERSATION_ROSTER_DRIFT');
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
async function assertRosterSynchronized(conversationId, label, viewer = OWNER) {
  // The profile's bounded list is the admitted authority view: it exposes no
  // private row id. Compare it with the ordinary product query after every
  // app-owned transition so a missed companion write fails this acceptance.
  const [authority, projection] = await Promise.all([
    query(api.conversationMemberships.list, { scopeId: conversationId }, viewer),
    query(api.conversationRoster, { conversationId }, viewer),
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

The dedicated dev-mode acceptance proves anonymous inbox denial; rejects a
caller-supplied viewer; denies outsiders and authenticated callers from other
rooms at conversation metadata, message-feed, roster, and recipient-snapshot
reads; and admits current members without returning roster facts on the
conversation row. It then commits direct generated `remove`, `invite`,
`changeRole`, `transferOwner`, and `leave` operations without their companion
projection write. Each deliberate divergence makes send refuse before a
snapshot write. It also pins self-leave retry plus the interrupted
remove→app-add and invite→app-leave preflight branches. Idempotent repair
converges the stores, retry returns `unchanged`, and the removed principal is
absent from the next snapshot. This check is mandatory for the interim
app-maintained pattern: a mismatch is a failing invariant, never permission to
authorize from whichever table looks convenient.

For the ephemeral room bound to this same authority declaration, continue with
[declare membership and the typing room together](./typing-indicators.md#1-declare-membership-and-the-typing-room-together).
For typing lifetime, use the separate
[activity presence heartbeat recipe](./activity-presence.md#recipe-activity-presence-heartbeats-and-withdrawal);
roster projection is durable product state, not presence.

## Anti-patterns

- Making the membership table public to “show roster” or “enumerate members.”
- Reading the projection as authority or accepting caller-supplied roles.
- Copying a private membership-row id into an app-visible table.
- Calling an application coordinator exclusive while generated `invite`,
  `leave`, `changeRole`, `transferOwner`, and `remove` remain directly reachable.
- Reading a roster or receipt snapshot after checking only `authenticated`
  instead of current admission to that exact room.
- Leaving message bodies or frozen recipient facts on a `public-read` table.
- Returning roster facts from a public conversation row instead of the
  admitted roster projection.
- Treating `bootstrap()` as able to stamp arbitrary creator-seat product data.
- Recomputing an old recipient set from current membership.
- Removing departed recipients from receipt aggregates.
- Describing D0.4's selected platform-generated direction as undecided, or
  inventing its not-yet-shipped public API.
