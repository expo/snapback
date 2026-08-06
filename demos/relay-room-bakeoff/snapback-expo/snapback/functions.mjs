import {
  arg,
  asc,
  bindingRef,
  defineAssetUpload,
  defineJsMutation,
  defineLiveQuery,
  defineMutation,
  del,
  eq,
  insert,
  lit,
  patch,
  record,
  results,
  returnExpr,
  runtimeNow,
  v,
} from '../../../_kit/define.mjs';

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

// @ref LLP 0090#authorization-scope-v1 — all history views are public,
// authority-independent single-table plans so a launched app can render its
// retained rows before reconnecting. Persona IDs are test-only explicit args.
export const users = defineLiveQuery({
  table: 'users',
  args: {},
  auth: 'public',
  authorityIndependent: true,
});

export const conversations = defineLiveQuery({
  table: 'conversations',
  args: {},
  order: [asc('updatedAt')],
  index: 'by_updated',
  auth: 'public',
  authorityIndependent: true,
});

export const membershipsForUser = defineLiveQuery({
  table: 'memberships',
  args: { userId: v.id('users') },
  filter: [eq('userId', arg('userId'))],
  index: 'by_user',
  auth: 'public',
  authorityIndependent: true,
});

export const membershipsForConversation = defineLiveQuery({
  table: 'memberships',
  args: { conversationId: v.id('conversations') },
  filter: [eq('conversationId', arg('conversationId'))],
  index: 'by_conversation',
  auth: 'public',
  authorityIndependent: true,
});

export const messagesForConversation = defineLiveQuery({
  table: 'messages',
  args: { conversationId: v.id('conversations') },
  filter: [eq('conversationId', arg('conversationId'))],
  order: [asc('sentAt')],
  index: 'by_conversation_sent',
  auth: 'public',
  authorityIndependent: true,
});

export const reactionsForConversation = defineLiveQuery({
  table: 'reactions',
  args: { conversationId: v.id('conversations') },
  filter: [eq('conversationId', arg('conversationId'))],
  index: 'by_conversation',
  auth: 'public',
  authorityIndependent: true,
});

// This is deliberately a public test-persona mutation. A production app would
// use sessions mode and derive senderId from ctx.auth.userId.
export const sendText = defineMutation({
  args: {
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    text: v.string(),
  },
  plan: [
    insert('messages', {
      conversationId: arg('conversationId'),
      senderId: arg('senderId'),
      kind: lit('text'),
      text: arg('text'),
      sentAt: runtimeNow(),
    }, { bindIdAs: 'messageId' }),
    patch('conversations', arg('conversationId'), {
      lastPreview: arg('text'),
      updatedAt: runtimeNow(),
    }),
  ],
  result: results.value(v.object({ messageId: v.string() })),
  returns: returnExpr(record({ messageId: bindingRef('messageId') })),
});

// A separate reply operation avoids forcing a declarative plan to read an
// absent optional arg: the stored relation is still just a pointer, not a
// thread or nested conversation.
export const sendReply = defineMutation({
  args: {
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    text: v.string(),
    replyToId: v.id('messages'),
  },
  plan: [
    insert('messages', {
      conversationId: arg('conversationId'),
      senderId: arg('senderId'),
      kind: lit('text'),
      text: arg('text'),
      replyToId: arg('replyToId'),
      sentAt: runtimeNow(),
    }, { bindIdAs: 'messageId' }),
    patch('conversations', arg('conversationId'), {
      lastPreview: arg('text'),
      updatedAt: runtimeNow(),
    }),
  ],
  result: results.value(v.object({ messageId: v.string() })),
  returns: returnExpr(record({ messageId: bindingRef('messageId') })),
});

export const addReaction = defineMutation({
  args: {
    conversationId: v.id('conversations'),
    messageId: v.id('messages'),
    userId: v.id('users'),
    emoji: v.string(),
  },
  plan: insert('reactions', {
    conversationId: arg('conversationId'),
    messageId: arg('messageId'),
    userId: arg('userId'),
    emoji: arg('emoji'),
  }, { bindIdAs: 'reactionId' }),
  result: results.value(v.object({ reactionId: v.string() })),
  returns: returnExpr(record({ reactionId: bindingRef('reactionId') })),
});

export const removeReaction = defineMutation({
  args: { reactionId: v.id('reactions') },
  plan: del('reactions', arg('reactionId')),
  result: results.value(v.object({ removed: v.boolean() })),
  returns: returnExpr(record({ removed: lit(true) })),
});

export const sendImage = defineJsMutation({
  args: {
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    assetId: v.string(),
    caption: v.optional(v.string()),
    replyToId: v.optional(v.id('messages')),
  },
  reads: ['messages'],
  writes: ['messages', 'conversations'],
  result: results.value(v.id('messages')),
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      senderId: args.senderId,
      kind: 'image',
      ...(args.caption ? { text: args.caption } : {}),
      ...(args.replyToId ? { replyToId: args.replyToId } : {}),
      // @ref LLP 0044#typed-references-and-atomic-attachment — asset admission,
      // message write, and reverse reference commit together.
      image: await ctx.assets.attach(args.assetId, { upload: 'messageImageUpload' }),
      sentAt: ctx.runtime.now(),
    });
    await ctx.db.patch('conversations', args.conversationId, {
      lastPreview: args.caption ? `Photo · ${args.caption}` : 'Photo',
      updatedAt: ctx.runtime.now(),
    });
    return messageId;
  },
});
