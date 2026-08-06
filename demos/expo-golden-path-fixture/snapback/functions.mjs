import {
  arg,
  asc,
  bind,
  bindingRef,
  defineAssetUpload,
  defineJsMutation,
  defineLiveQuery,
  defineMutation,
  defineSurface,
  del,
  eq,
  input,
  insert,
  lit,
  param,
  patch,
  record,
  results,
  returnBinding,
  returnExpr,
  runtimeNow,
  v,
} from '../../_kit/define.mjs';
import { typing } from './surface-model.mjs';

export const listReceiptNotes = defineLiveQuery({
  table: 'receiptNotes',
  args: {},
  order: [asc('_createdAt')],
  auth: 'public',
  authorityIndependent: true,
});

export const addReceiptNote = defineMutation({
  args: { text: v.string(), source: v.string() },
  auth: 'authenticated',
  plan: insert('receiptNotes', {
    text: arg('text'),
    source: arg('source'),
  }, { bindIdAs: 'receiptNoteId' }),
  result: results.value(v.id('receiptNotes')),
  returns: returnBinding('receiptNoteId'),
});

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

// @ref LLP 0090#authorization-scope-v1 — retained conversation history is
// public and authority-independent in this visibly test-persona fixture.
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

export const conversationDetails = defineLiveQuery({
  table: 'conversations',
  args: { conversationId: v.id('conversations') },
  filter: [eq('_id', arg('conversationId'))],
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

// These mutations keep Relay Room's explicit test-persona behavior. A
// production app derives sender identity from the adopted session.
export const sendText = defineMutation({
  args: {
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    text: v.string(),
  },
  auth: 'authenticated',
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
  result: results.value(v.object({ messageId: v.id('messages') })),
  returns: returnExpr(record({ messageId: bindingRef('messageId') })),
});

export const sendReply = defineMutation({
  args: {
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    text: v.string(),
    replyToId: v.id('messages'),
  },
  auth: 'authenticated',
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
  result: results.value(v.object({ messageId: v.id('messages') })),
  returns: returnExpr(record({ messageId: bindingRef('messageId') })),
});

export const addReaction = defineMutation({
  args: {
    conversationId: v.id('conversations'),
    messageId: v.id('messages'),
    userId: v.id('users'),
    emoji: v.string(),
  },
  auth: 'authenticated',
  plan: insert('reactions', {
    conversationId: arg('conversationId'),
    messageId: arg('messageId'),
    userId: arg('userId'),
    emoji: arg('emoji'),
  }, { bindIdAs: 'reactionId' }),
  result: results.value(v.object({ reactionId: v.id('reactions') })),
  returns: returnExpr(record({ reactionId: bindingRef('reactionId') })),
});

export const removeReaction = defineMutation({
  args: { reactionId: v.id('reactions') },
  auth: 'authenticated',
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
  auth: 'authenticated',
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
      // @ref LLP 0044#typed-references-and-atomic-attachment — admission,
      // message write, and reverse-reference commit are one mutation.
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

// @ref LLP 0179#closed-grammar — conversationId is declared once and every
// child records its inspectable substitution. The raw asset lane remains
// separate from ordinary mutations; no G3 command is introduced here.
export const conversation = defineSurface({
  params: { conversationId: v.id('conversations') },
  reads: {
    users: bind(users, {}),
    details: bind(conversationDetails, { conversationId: param('conversationId') }),
    memberships: bind(membershipsForConversation, { conversationId: param('conversationId') }),
    messages: bind(messagesForConversation, { conversationId: param('conversationId') }),
    reactions: bind(reactionsForConversation, { conversationId: param('conversationId') }),
  },
  mutations: {
    // @ref LLP 0176#g2--conversation-surface — keep the generated member at
    // the accepted north-star spelling while the underlying function remains
    // the ordinary addReaction mutation.
    react: bind(addReaction, {
      conversationId: param('conversationId'),
      messageId: input('messageId'),
      userId: input('userId'),
      emoji: input('emoji'),
    }),
    sendText: bind(sendText, {
      conversationId: param('conversationId'),
      senderId: input('senderId'),
      text: input('text'),
    }),
    sendReply: bind(sendReply, {
      conversationId: param('conversationId'),
      senderId: input('senderId'),
      text: input('text'),
      replyToId: input('replyToId'),
    }),
    removeReaction: bind(removeReaction, {
      reactionId: input('reactionId'),
    }),
    sendImage: bind(sendImage, {
      conversationId: param('conversationId'),
      senderId: input('senderId'),
      assetId: input('assetId'),
      caption: input('caption'),
      replyToId: input('replyToId'),
    }),
  },
  assets: {
    image: bind(messageImageUpload, {}),
  },
  presence: {
    typing: bind(typing, {
      scope: { conversationId: param('conversationId') },
    }),
  },
});
