import {
  arg,
  asc,
  defineAssetUpload,
  defineJsMutation,
  defineLiveQuery,
  eq,
  results,
  v,
} from '@expo/snapback-codegen/define';

// ---------------------------------------------------------------------------
// Live queries — all public + authorityIndependent so they are rqsEligible
// (cold offline retention on the JS arm).
// ---------------------------------------------------------------------------

export const listUsers = defineLiveQuery({
  table: 'users',
  args: {},
  order: [asc('handle')],
  index: 'by_handle',
  auth: 'public',
});

export const listConversations = defineLiveQuery({
  table: 'conversations',
  args: {},
  order: [asc('sortKey')],
  index: 'by_sort',
  auth: 'public',
});

export const listMembers = defineLiveQuery({
  table: 'members',
  args: { conversationId: v.id('conversations') },
  filter: [eq('conversationId', arg('conversationId'))],
  index: 'by_conversation',
  auth: 'public',
});

export const listMessages = defineLiveQuery({
  table: 'messages',
  args: { conversationId: v.id('conversations') },
  filter: [eq('conversationId', arg('conversationId'))],
  order: [asc('sentAt')],
  index: 'by_conversation',
  auth: 'public',
});

export const listReactions = defineLiveQuery({
  table: 'reactions',
  args: { conversationId: v.id('conversations') },
  filter: [eq('conversationId', arg('conversationId'))],
  index: 'by_conversation',
  auth: 'public',
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const sendMessage = defineJsMutation({
  auth: 'authenticated',
  args: {
    conversationId: v.id('conversations'),
    senderHandle: v.string(),
    text: v.optional(v.string()),
    imageAssetId: v.optional(v.string()),
    replyToId: v.optional(v.string()),
    sentAt: v.number(),
  },
  reads: ['messages'],
  writes: ['messages'],
  result: results.value(v.id('messages')),
  handler: async (ctx, args) => {
    const text = String(args.text ?? '').trim();
    const hasImage = typeof args.imageAssetId === 'string' && args.imageAssetId.length > 0;
    if (!text && !hasImage) throw new Error('message needs text or an image');
    const values = {
      conversationId: args.conversationId,
      senderHandle: args.senderHandle,
      kind: hasImage ? 'image' : 'text',
      sentAt: args.sentAt,
    };
    if (text) values.text = text;
    if (typeof args.replyToId === 'string' && args.replyToId.length > 0) {
      values.replyToId = args.replyToId;
    }
    if (hasImage) {
      values.image = await ctx.assets.attach(args.imageAssetId, { upload: 'messageImageUpload' });
    }
    return await ctx.db.insert('messages', values);
  },
});

export const toggleReaction = defineJsMutation({
  auth: 'authenticated',
  args: {
    messageId: v.id('messages'),
    conversationId: v.id('conversations'),
    handle: v.string(),
    emoji: v.string(),
  },
  reads: ['reactions'],
  writes: ['reactions'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('reactions')
      .withIndex('by_message_handle_emoji')
      .eq('messageId', args.messageId)
      .eq('handle', args.handle)
      .eq('emoji', args.emoji)
      .take(1)
      .collect();
    if (existing.length > 0) {
      await ctx.db.delete('reactions', existing[0]._id);
      return 'removed';
    }
    await ctx.db.insert('reactions', {
      messageId: args.messageId,
      conversationId: args.conversationId,
      handle: args.handle,
      emoji: args.emoji,
    });
    return 'added';
  },
});

// ---------------------------------------------------------------------------
// Assets — image messages
// ---------------------------------------------------------------------------

export const messageImageUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], maxBytes: 10_000_000 },
  image: { location: 'strip', variants: [{ key: 'thumb', width: 480 }] },
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
