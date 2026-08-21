// Snapback Messenger — functions.
//
// Reads and writes are JS handlers throughout: the conversation list needs a
// two-table join (conversationMembers -> conversations) and the message feed
// needs a fan-out aggregate (reactions per message, plus a reply preview
// looked up from the same table) that the declarative plan vocabulary does
// not express directly. `defineJsLiveQuery`/`defineJsMutation` are the paved
// choice for exactly this shape (guide/backend/queries.md).
//
// Same-file function declarations are spliced into an inline handler by
// codegen, so the aggregation helpers below live as ordinary top-level
// `function` declarations (not arrow consts, which are NOT captured) and are
// called directly from the handlers that need them.

import {
  defineAssetUpload,
  defineJsLiveQuery,
  defineJsMutation,
  results,
  v,
} from '@expo/snapback-codegen/define';

// ---------------------------------------------------------------------------
// Shared helpers (spliced into whichever inline handler calls them)
// ---------------------------------------------------------------------------

function summarizeReactions(allReactions, messageId) {
  const forMessage = allReactions.filter((r) => r.messageId === messageId);
  const byEmoji = new Map();
  for (const reaction of forMessage) {
    const existing = byEmoji.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, userHandles: [] };
    existing.count += 1;
    existing.userHandles = [...existing.userHandles, reaction.userHandle];
    byEmoji.set(reaction.emoji, existing);
  }
  return Array.from(byEmoji.values());
}

function findReplyPreview(allMessages, replyToId) {
  if (!replyToId) return undefined;
  const parent = allMessages.find((m) => m._id === replyToId);
  if (!parent) return undefined;
  return {
    messageId: parent._id,
    authorName: parent.authorName,
    body: parent.body,
    hasImage: parent.image !== undefined && parent.image !== null,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const listUsers = defineJsLiveQuery({
  args: {},
  result: results.documents('users'),
  reads: ['users'],
  handler: async (ctx) => ctx.db.query('users').withIndex('by_handle').take(200).collect(),
});

const conversationSummary = v.object({
  _id: v.id('conversations'),
  kind: v.string(),
  title: v.string(),
  memberHandles: v.array(v.string()),
  lastMessageText: v.string(),
  lastMessageAuthorName: v.string(),
  lastMessageAt: v.integer(),
  createdAt: v.integer(),
});

/** The inbox: every conversation the viewer belongs to, newest activity
 * first. `conversationMembers` -> `conversations` is a two-table join, so
 * this is a JS live query rather than a declarative single-table plan. */
export const myConversations = defineJsLiveQuery({
  args: { viewerHandle: v.string() },
  result: results.records(conversationSummary),
  reads: ['conversationMembers', 'conversations'],
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query('conversationMembers')
      .withIndex('by_user')
      .eq('userHandle', args.viewerHandle)
      .take(500)
      .collect();
    const rows = [];
    for (const membership of memberships) {
      const conversation = await ctx.db.get('conversations', membership.conversationId);
      // records() is a closed shape — pick exactly the declared fields so a
      // raw stored document's system fields (_version, _updatedAt) never
      // leak into a contract that doesn't name them.
      if (conversation) {
        rows.push({
          _id: conversation._id,
          kind: conversation.kind,
          title: conversation.title,
          memberHandles: conversation.memberHandles,
          lastMessageText: conversation.lastMessageText,
          lastMessageAuthorName: conversation.lastMessageAuthorName,
          lastMessageAt: conversation.lastMessageAt,
          createdAt: conversation.createdAt,
        });
      }
    }
    return rows.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  },
});

export const conversationById = defineJsLiveQuery({
  args: { conversationId: v.id('conversations') },
  result: results.records(conversationSummary),
  reads: ['conversations'],
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get('conversations', args.conversationId);
    if (!conversation) return [];
    return [{
      _id: conversation._id,
      kind: conversation.kind,
      title: conversation.title,
      memberHandles: conversation.memberHandles,
      lastMessageText: conversation.lastMessageText,
      lastMessageAuthorName: conversation.lastMessageAuthorName,
      lastMessageAt: conversation.lastMessageAt,
      createdAt: conversation.createdAt,
    }];
  },
});

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

const recipientSnapshotRow = v.object({
  messageId: v.id('messages'),
  recipients: v.array(v.object({
    userHandle: v.string(),
    roleAtSend: v.string(),
  })),
  deliveredBy: v.array(v.string()),
  readBy: v.array(v.string()),
});

export const messageRecipientSnapshot = defineJsLiveQuery({
  args: { messageId: v.id('messages') },
  auth: 'authenticated',
  result: results.records(recipientSnapshotRow),
  reads: ['messages'],
  handler: async (ctx, args) => {
    const message = await ctx.db.get('messages', args.messageId);
    if (!message) return [];
    return [{
      messageId: message._id,
      recipients: message.recipientSnapshot ?? [],
      deliveredBy: message.deliveredBy ?? [],
      readBy: message.readBy ?? [],
    }];
  },
});

const messageRow = v.object({
  _id: v.id('messages'),
  conversationId: v.id('conversations'),
  authorHandle: v.string(),
  authorName: v.string(),
  body: v.string(),
  image: v.optional(v.assetRef()),
  replyToId: v.optional(v.id('messages')),
  createdAt: v.integer(),
  reactions: v.array(v.object({
    emoji: v.string(),
    count: v.integer(),
    userHandles: v.array(v.string()),
  })),
  replyPreview: v.optional(v.object({
    messageId: v.id('messages'),
    authorName: v.string(),
    body: v.string(),
    hasImage: v.boolean(),
  })),
});

/** The message feed for one conversation, oldest first, each row carrying
 * its aggregated reactions and (for replies) a lightweight quoted preview of
 * the original message — WhatsApp-style: a pointer plus a small excerpt,
 * never a nested thread view. */
export const conversationMessages = defineJsLiveQuery({
  args: { conversationId: v.id('conversations') },
  result: results.records(messageRow),
  reads: ['messages', 'reactions'],
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_conversation')
      .eq('conversationId', args.conversationId)
      .order('createdAt', 'asc')
      .take(500)
      .collect();
    const reactions = await ctx.db
      .query('reactions')
      .withIndex('by_message')
      .take(1024)
      .collect();
    // Pick exactly the declared fields — records() is a closed shape, so a
    // raw stored document's system fields (_version, _updatedAt) must not
    // leak through the spread.
    return messages.map((message) => ({
      _id: message._id,
      conversationId: message.conversationId,
      authorHandle: message.authorHandle,
      authorName: message.authorName,
      body: message.body,
      ...(message.image ? { image: message.image } : {}),
      ...(message.replyToId ? { replyToId: message.replyToId } : {}),
      createdAt: message.createdAt,
      reactions: summarizeReactions(reactions, message._id),
      ...(message.replyToId ? { replyPreview: findReplyPreview(messages, message.replyToId) } : {}),
    }));
  },
});

const viewOnceMessageRow = v.object({
  _id: v.id('viewOnceMessages'),
  conversationId: v.id('conversations'),
  authorPrincipal: v.string(),
  asset: v.assetRef(),
  grants: v.json(),
  caption: v.string(),
  createdAt: v.integer(),
  consumedPrincipals: v.array(v.string()),
});

/** Demo-scoped inspection query. It intentionally omits conversation
 * membership policy so the headless witness can inspect owner-visible grant
 * bookkeeping; a product surface would scope this to the author/recipients. */
export const viewOnceMessageById = defineJsLiveQuery({
  args: { viewOnceMessageId: v.id('viewOnceMessages') },
  auth: 'authenticated',
  result: results.records(viewOnceMessageRow),
  reads: ['viewOnceMessages', 'viewOnceConsumptions'],
  handler: async (ctx, args) => {
    const message = await ctx.db.get('viewOnceMessages', args.viewOnceMessageId);
    if (!message) return [];
    const consumptions = await ctx.db
      .query('viewOnceConsumptions')
      .withIndex('by_message_principal')
      .eq('viewOnceMessageId', args.viewOnceMessageId)
      .take(1024)
      .collect();
    // `results.records` is closed: return only fields named above, never the
    // stored document's _version/_updatedAt system fields.
    return [{
      _id: message._id,
      conversationId: message.conversationId,
      authorPrincipal: message.authorPrincipal,
      asset: message.asset,
      grants: message.grants,
      caption: message.caption,
      createdAt: message.createdAt,
      consumedPrincipals: consumptions.map((consumption) => consumption.principal).sort(),
    }];
  },
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

// Asset ownership is enforced by matching the resolved caller principal at
// every step (create, transfer, finalize, attach) against this owner — so
// `owner` must come from `ctx.auth.userId`, the same identity the *attaching*
// mutation call needs to carry (dev-mode `userId`, i.e. DevImpersonation).
// `auth: 'public'` alone is not enough: the plain HTTP asset client always
// resolves an anonymous caller in dev mode (guide/backend/assets.md's
// browser-session caveat, generalized), so uploads here go through
// `snapback assets put --user <handle>` or an equivalent admin-impersonated
// caller, never the raw fetch-based asset client.
// See issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md.
export const messageImageUpload = defineAssetUpload({
  args: {},
  auth: 'public',
  reads: [],
  accept: { mediaTypes: ['image/jpeg', 'image/png'], maxBytes: 8_000_000 },
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  image: {
    location: 'strip',
    variants: [{ key: 'thumb', width: 320 }],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

// The owner-only policy is load-bearing: recipients must have no authority
// path except their first-class grant edge. This intent is exercised only by
// the Sessions-mode headless witness; the interactive dev-mode UI is unchanged.
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

export const sendMessage = defineJsMutation({
  args: {
    conversationId: v.id('conversations'),
    authorHandle: v.string(),
    authorName: v.string(),
    body: v.string(),
    replyToId: v.optional(v.id('messages')),
    assetId: v.optional(v.string()),
  },
  auth: 'authenticated',
  refusals: ['MESSAGE_RECIPIENT_LIMIT'],
  result: results.value(v.id('messages')),
  reads: ['conversations', 'conversationMembers', 'conversationMemberships'],
  writes: ['messages', 'conversations'],
  handler: async (ctx, args) => {
    await ctx.permissions.conversationMemberships.requireRole(
      args.conversationId,
      'owner',
      'moderator',
      'member',
    );
    const body = String(args.body ?? '').trim();
    if (!body && !args.assetId) throw new Error('a message needs text or an image');
    const conversation = await ctx.db.get('conversations', args.conversationId);
    if (!conversation) throw new Error('conversation not found');
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
    await ctx.db.patch('conversations', args.conversationId, {
      lastMessageText: body || '📷 Photo',
      lastMessageAuthorName: args.authorName,
      lastMessageAt: now,
    });
    return messageId;
  },
});

export const acknowledgeMessage = defineJsMutation({
  args: {
    messageId: v.id('messages'),
    kind: v.string(),
  },
  auth: 'authenticated',
  refusals: ['MESSAGE_ACK_KIND_INVALID', 'MESSAGE_ACK_NOT_RECIPIENT'],
  result: results.value(v.object({ outcome: v.string() })),
  reads: ['messages', 'conversationMemberships'],
  writes: ['messages'],
  handler: async (ctx, args) => {
    if (args.kind !== 'delivered' && args.kind !== 'read') {
      ctx.refuse('MESSAGE_ACK_KIND_INVALID');
    }
    const message = await ctx.db.get('messages', args.messageId);
    if (!message) ctx.refuse('MESSAGE_ACK_NOT_RECIPIENT');
    await ctx.permissions.conversationMemberships.requireRole(
      message.conversationId,
      'owner',
      'moderator',
      'member',
    );
    const recipients = message.recipientSnapshot ?? [];
    if (!recipients.some((recipient) => recipient.userHandle === ctx.auth.userId)) {
      ctx.refuse('MESSAGE_ACK_NOT_RECIPIENT');
    }
    const deliveredBy = message.deliveredBy ?? [];
    const readBy = message.readBy ?? [];
    const nextDeliveredBy = deliveredBy.includes(ctx.auth.userId)
      ? deliveredBy
      : [...deliveredBy, ctx.auth.userId];
    const nextReadBy = args.kind === 'read' && !readBy.includes(ctx.auth.userId)
      ? [...readBy, ctx.auth.userId]
      : readBy;
    const changed = nextDeliveredBy !== deliveredBy || nextReadBy !== readBy;
    if (!changed) return { outcome: 'unchanged' };
    await ctx.db.patch('messages', args.messageId, {
      deliveredBy: nextDeliveredBy,
      readBy: nextReadBy,
    });
    return { outcome: 'changed' };
  },
});

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

export const toggleReaction = defineJsMutation({
  args: {
    messageId: v.id('messages'),
    userHandle: v.string(),
    emoji: v.string(),
  },
  result: results.value(v.object({ reacted: v.boolean() })),
  reads: ['messages', 'reactions'],
  writes: ['reactions'],
  handler: async (ctx, args) => {
    const message = await ctx.db.get('messages', args.messageId);
    if (!message) throw new Error('message not found');
    const existing = await ctx.db
      .query('reactions')
      .withIndex('by_message_user_emoji')
      .eq('messageId', args.messageId)
      .eq('userHandle', args.userHandle)
      .eq('emoji', args.emoji)
      .first();
    if (existing) {
      await ctx.db.delete('reactions', existing._id);
      return { reacted: false };
    }
    await ctx.db.insert('reactions', {
      messageId: args.messageId,
      userHandle: args.userHandle,
      emoji: args.emoji,
      createdAt: ctx.runtime.now(),
    });
    return { reacted: true };
  },
});

export const startDirectMessage = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {
    selfHandle: v.string(),
    selfName: v.string(),
    otherHandle: v.string(),
    otherName: v.string(),
  },
  result: results.value(v.id('conversations')),
  reads: ['conversationMembers', 'conversations'],
  writes: ['conversations', 'conversationMembers', 'conversationMemberships'],
  handler: async (ctx, args) => {
    // @ref LLP 0056#dated-amendment-bounded-atomic-bootstrap-rosters-2026-08-15 — the
    // creator seat and every product projection use the server-resolved
    // principal. In dev mode that principal comes from the direct client's
    // asserted userId; Sessions mode ignores client assertions.
    const selfHandle = ctx.auth.userId;
    if (selfHandle === args.otherHandle) throw new Error('pick someone else to message');
    const mine = await ctx.db
      .query('conversationMembers')
      .withIndex('by_user')
      .eq('userHandle', selfHandle)
      .take(500)
      .collect();
    for (const membership of mine) {
      const conversation = await ctx.db.get('conversations', membership.conversationId);
      if (
        conversation
        && conversation.kind === 'dm'
        && conversation.memberHandles.length === 2
        && conversation.memberHandles.includes(args.otherHandle)
      ) {
        return conversation._id;
      }
    }
    const now = ctx.runtime.now();
    const conversationId = await ctx.membership.conversationMemberships.bootstrap({
      kind: 'dm',
      title: '',
      memberHandles: [selfHandle, args.otherHandle],
      lastMessageText: 'Say hello 👋',
      lastMessageAuthorName: '',
      lastMessageAt: now,
      createdAt: now,
    }, [{ userHandle: args.otherHandle, role: 'member', joinedAt: now }]);
    await ctx.db.insert('conversationMembers', {
      conversationId, userHandle: selfHandle, role: 'owner', joinedAt: now,
    });
    await ctx.db.insert('conversationMembers', {
      conversationId, userHandle: args.otherHandle, role: 'member', joinedAt: now,
    });
    return conversationId;
  },
});

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
