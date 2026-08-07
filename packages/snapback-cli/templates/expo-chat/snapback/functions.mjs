import {
  arg,
  asc,
  bind,
  bindingRef,
  defineAssetUpload,
  defineCommand,
  defineJsMutation,
  defineLiveQuery,
  defineMutation,
  defineSurface,
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

// Retained chat history is public and authority-independent in this starter's
// seeded test-persona world. A production chat scopes reads to membership.
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

export const messagesForConversation = defineLiveQuery({
  table: 'messages',
  args: { conversationId: v.id('conversations') },
  filter: [eq('conversationId', arg('conversationId'))],
  order: [asc('sentAt')],
  index: 'by_conversation_sent',
  auth: 'public',
  authorityIndependent: true,
});

// The upload intent is the only door for message images: it names the
// accepted media types, the byte ceiling, delivery, and the strip+variant
// image pipeline. The schema's assetRef field admits only its assets.
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

// This starter keeps the explicit seeded-persona sender. A production app
// derives sender identity from the adopted session instead of an argument.
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

export const sendMessage = defineJsMutation({
  args: {
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    body: v.optional(v.string()),
    image: v.optional(v.assetRef({ upload: 'messageImageUpload' })),
  },
  auth: 'authenticated',
  writes: ['messages', 'conversations'],
  result: results.value(v.id('messages')),
  handler: async (ctx, args) => {
    const hasImage = typeof args.image === 'string';
    const messageId = await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      senderId: args.senderId,
      kind: hasImage ? 'image' : 'text',
      ...(args.body ? { text: args.body } : {}),
      ...(hasImage ? {
        // Admission, message write, and reverse-reference commit are one
        // mutation: attach() is the sole boundary where a finalized upload
        // becomes an application row reference.
        image: await ctx.assets.attach(args.image, { upload: 'messageImageUpload' }),
      } : {}),
      sentAt: ctx.runtime.now(),
    });
    await ctx.db.patch('conversations', args.conversationId, {
      lastPreview: hasImage
        ? (args.body ? `Photo · ${args.body}` : 'Photo')
        : (args.body ?? ''),
      updatedAt: ctx.runtime.now(),
    });
    return messageId;
  },
});

// The command composes the optional image upload with the mutation: one
// client call uploads through the intent, then commits the message that
// references the finalized asset. Text-only sends skip the upload phase.
export const send = defineCommand({
  mutation: sendMessage,
  assets: {
    image: {
      intent: messageImageUpload,
      optional: true,
      mutationArg: 'image',
    },
  },
});

// The conversation surface declares conversationId once; every bound child
// records its inspectable substitution, and the client drives the whole
// screen through one useSurface handle.
export const conversation = defineSurface({
  params: { conversationId: v.id('conversations') },
  reads: {
    users: bind(users, {}),
    details: bind(conversationDetails, { conversationId: param('conversationId') }),
    messages: bind(messagesForConversation, { conversationId: param('conversationId') }),
  },
  mutations: {
    sendText: bind(sendText, {
      conversationId: param('conversationId'),
      senderId: input('senderId'),
      text: input('text'),
    }),
  },
  commands: {
    send: bind(send, {
      conversationId: param('conversationId'),
      senderId: input('senderId'),
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
