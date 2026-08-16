import {
  assetCollection,
  assetSharing,
  defineAssetUpload,
  defineJsMutation,
  defineLiveQuery,
  defineMediaCommand,
  results,
  v,
} from '@expo/snapback-codegen/define';

export const profileImageUpload = defineAssetUpload({
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png'], maxBytes: 8_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const listProfiles = defineLiveQuery({
  table: 'profiles',
  args: {},
  auth: 'public',
});

export const sharedMediaUpload = defineAssetUpload({
  auth: 'authenticated',
  accept: {
    mediaTypes: ['image/jpeg', 'image/png', 'video/mp4'],
    maxBytes: 20_000_000,
  },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  image: { location: 'strip' },
  video: { location: 'strip' },
  grants: true,
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation
export const postMedia = assetCollection({
  ownerTable: 'posts',
  intent: 'sharedMediaUpload',
  maxItems: 4,
  order: 'manual',
  kinds: ['image', 'video'],
  grants: 'none',
});

export const createPostMutation = defineJsMutation({
  auth: 'authenticated',
  args: {
    body: v.string(),
    assetIds: v.array(v.assetRef({ upload: 'sharedMediaUpload' }), { maxItems: 4 }),
  },
  writes: ['posts'],
  result: results.value(v.object({ _id: v.id('posts') })),
  handler: async (ctx, args) => ({
    _id: await ctx.db.insert('posts', { ownerId: ctx.auth.userId, body: args.body }),
  }),
});

// @ref LLP 0239#d3-one-mediacommand-owns-multi-upload-plus-atomic-commit
export const createPost = defineMediaCommand({
  media: {
    input: 'media',
    intent: 'sharedMediaUpload',
    minItems: 1,
    maxItems: 4,
    kinds: ['image', 'video'],
  },
  mutation: createPostMutation,
  mapping: {
    passthrough: ['body'],
    assetsToMutationArg: 'assetIds',
    parentResultPath: '_id',
    collection: 'postMedia',
    operation: 'append',
  },
  sharing: assetSharing.none(),
});

export const messageMedia = assetCollection({
  ownerTable: 'messages',
  intent: 'sharedMediaUpload',
  maxItems: 8,
  order: 'manual',
  kinds: ['image', 'video'],
  grants: {
    ceiling: {
      owner: { kind: 'owner-only' },
      recipients: { kind: 'recipients', state: 'active', maxRecipients: 8 },
    },
    default: 'owner',
  },
});

export const sendMessageMutation = defineJsMutation({
  auth: 'authenticated',
  args: {
    conversationId: v.string(),
    text: v.string(),
    assetIds: v.array(v.assetRef({ upload: 'sharedMediaUpload' }), { maxItems: 8 }),
  },
  writes: ['messages'],
  result: results.value(v.object({ _id: v.id('messages') })),
  handler: async (ctx, args) => ({
    _id: await ctx.db.insert('messages', {
      ownerId: ctx.auth.userId,
      conversationId: args.conversationId,
      text: args.text,
    }),
  }),
});

export const sendMessage = defineMediaCommand({
  media: {
    input: 'media',
    intent: 'sharedMediaUpload',
    minItems: 1,
    maxItems: 8,
    kinds: ['image', 'video'],
  },
  mutation: sendMessageMutation,
  mapping: {
    passthrough: ['conversationId', 'text'],
    assetsToMutationArg: 'assetIds',
    parentResultPath: '_id',
    collection: 'messageMedia',
    operation: 'append',
    principals: { input: 'recipients', minItems: 1, maxItems: 8 },
  },
  sharing: assetSharing.recipients({ state: 'active', maxRecipients: 8 }),
});
