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

export const sendMessage = defineJsMutation({
  args: {
    conversationId: v.id('conversations'),
    authorHandle: v.string(),
    authorName: v.string(),
    body: v.string(),
    replyToId: v.optional(v.id('messages')),
    assetId: v.optional(v.string()),
  },
  result: results.value(v.id('messages')),
  reads: ['conversations'],
  writes: ['messages', 'conversations'],
  handler: async (ctx, args) => {
    const body = String(args.body ?? '').trim();
    if (!body && !args.assetId) throw new Error('a message needs text or an image');
    const conversation = await ctx.db.get('conversations', args.conversationId);
    if (!conversation) throw new Error('conversation not found');
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
      createdAt: now,
    });
    await ctx.db.patch('conversations', args.conversationId, {
      lastMessageText: body || '📷 Photo',
      lastMessageAuthorName: args.authorName,
      lastMessageAt: now,
    });
    return messageId;
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
  args: {
    selfHandle: v.string(),
    selfName: v.string(),
    otherHandle: v.string(),
    otherName: v.string(),
  },
  result: results.value(v.id('conversations')),
  reads: ['conversationMembers', 'conversations'],
  writes: ['conversations', 'conversationMembers'],
  handler: async (ctx, args) => {
    if (args.selfHandle === args.otherHandle) throw new Error('pick someone else to message');
    const mine = await ctx.db
      .query('conversationMembers')
      .withIndex('by_user')
      .eq('userHandle', args.selfHandle)
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
    const conversationId = await ctx.db.insert('conversations', {
      kind: 'dm',
      title: '',
      memberHandles: [args.selfHandle, args.otherHandle],
      lastMessageText: 'Say hello 👋',
      lastMessageAuthorName: '',
      lastMessageAt: now,
      createdAt: now,
    });
    await ctx.db.insert('conversationMembers', { conversationId, userHandle: args.selfHandle, joinedAt: now });
    await ctx.db.insert('conversationMembers', { conversationId, userHandle: args.otherHandle, joinedAt: now });
    return conversationId;
  },
});

export const createGroup = defineJsMutation({
  args: {
    title: v.string(),
    creatorHandle: v.string(),
    creatorName: v.string(),
    memberHandles: v.array(v.string()),
  },
  result: results.value(v.id('conversations')),
  writes: ['conversations', 'conversationMembers'],
  handler: async (ctx, args) => {
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('a group needs a name');
    const uniqueOthers = Array.from(new Set(args.memberHandles.filter((h) => h !== args.creatorHandle)));
    if (uniqueOthers.length < 1) throw new Error('a group needs at least one other member');
    const allHandles = [args.creatorHandle, ...uniqueOthers];
    const now = ctx.runtime.now();
    const conversationId = await ctx.db.insert('conversations', {
      kind: 'group',
      title,
      memberHandles: allHandles,
      lastMessageText: `${args.creatorName} created the group`,
      lastMessageAuthorName: '',
      lastMessageAt: now,
      createdAt: now,
    });
    for (const handle of allHandles) {
      await ctx.db.insert('conversationMembers', { conversationId, userHandle: handle, joinedAt: now });
    }
    return conversationId;
  },
});
