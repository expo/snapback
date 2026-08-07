import {
  arg,
  asc,
  bind,
  bindingRef,
  defineAssetUpload,
  defineCommand,
  defineLiveQuery,
  defineJsMutation,
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
  returnExpr,
  runtimeNow,
  v,
} from '@expo/snapback-codegen/define';
import { typing } from './surface-model.mjs';

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

export const conversationDetails = defineLiveQuery({
  table: 'conversations',
  args: { conversationId: v.id('conversations') },
  filter: [eq('_id', arg('conversationId'))],
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

export const annotateMessage = defineJsMutation({
  args: {
    conversationId: v.id('conversations'),
    messageId: v.id('messages'),
    note: v.optional(v.string()),
    details: v.object({
      kind: v.string(),
      extra: v.optional(v.string()),
    }),
  },
  auth: 'authenticated',
  writes: ['conversations'],
  result: results.value(v.null()),
  handler: async (ctx, args) => {
    await ctx.db.patch('conversations', args.conversationId, {
      lastPreview: args.note ?? args.details.extra ?? args.details.kind,
    });
    return null;
  },
});

export const sendMessage = defineMutation({
  args: {
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    body: v.optional(v.string()),
    image: v.optional(v.assetRef({ upload: 'messageImageUpload' })),
  },
  auth: 'authenticated',
  plan: insert('messages', {
    conversationId: arg('conversationId'),
    senderId: arg('senderId'),
    kind: lit('command'),
    sentAt: runtimeNow(),
  }, { bindIdAs: 'messageId' }),
  result: results.value(v.object({ messageId: v.id('messages') })),
  returns: returnExpr(record({ messageId: bindingRef('messageId') })),
});

export const send = defineCommand({
  mutation: sendMessage,
  assets: {
    image: {
      intent: messageImageUpload,
      mutationArg: 'image',
      optional: true,
    },
  },
});

// @ref LLP 0179#closed-grammar — conversationId is declared once and every
// child records its inspectable substitution. The generated react callables
// therefore never accept conversationId again.
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
    annotate: bind(annotateMessage, {
      conversationId: param('conversationId'),
      messageId: input('messageId'),
      note: input('note'),
      details: {
        kind: input('detailsKind'),
        extra: input('detailsExtra'),
      },
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
    addReaction: bind(addReaction, {
      conversationId: param('conversationId'),
      messageId: input('messageId'),
      userId: input('userId'),
      emoji: input('emoji'),
    }),
    removeReaction: bind(removeReaction, {
      reactionId: input('reactionId'),
    }),
  },
  commands: {
    send: bind(send, {
      conversationId: param('conversationId'),
      senderId: 'user-ada',
      body: input('body'),
      image: input('image'),
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
