import {
  assetCollection,
  assetSharing,
  authUserId,
  defineAssetUpload,
  defineCommand,
  defineJsMutation,
  defineLiveQuery,
  defineMediaCommand,
  desc,
  eq,
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
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const listProfiles = defineLiveQuery({
  table: 'profiles',
  args: {},
  auth: 'authenticated',
  filter: [eq('ownerId', authUserId())],
  index: 'by_owner',
});

export const listPosts = defineLiveQuery({
  table: 'posts',
  args: {},
  auth: 'authenticated',
  filter: [eq('ownerId', authUserId())],
  order: [desc('_createdAt')],
});

export const ensureProfile = defineJsMutation({
  auth: 'authenticated',
  args: { displayName: v.string() },
  reads: ['profiles'],
  writes: ['profiles'],
  result: results.value(v.id('profiles')),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_owner')
      .eq('ownerId', ctx.auth.userId)
      .first();
    if (existing) {
      if (existing.displayName !== args.displayName) {
        await ctx.db.patch('profiles', existing._id, { displayName: args.displayName });
      }
      return existing._id;
    }
    return ctx.db.insert('profiles', {
      ownerId: ctx.auth.userId,
      displayName: args.displayName,
    });
  },
});

export const changeAvatarMutation = defineJsMutation({
  auth: 'authenticated',
  args: {
    profileId: v.id('profiles'),
    avatar: v.assetRef({ upload: 'profileImageUpload' }),
  },
  reads: ['profiles'],
  writes: ['profiles'],
  result: results.value(v.id('profiles')),
  handler: async (ctx, args) => {
    const profile = await ctx.db.get('profiles', args.profileId);
    if (!profile || profile.ownerId !== ctx.auth.userId) {
      throw new Error('Profile is unavailable for this persona.');
    }
    await ctx.db.patch('profiles', profile._id, {
      avatar: await ctx.assets.attach(args.avatar, { upload: 'profileImageUpload' }),
    });
    return profile._id;
  },
});

export const changeAvatar = defineCommand({
  mutation: changeAvatarMutation,
  assets: {
    avatar: { intent: profileImageUpload, optional: false, mutationArg: 'avatar' },
  },
});

// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation —
// one bounded, manually ordered collection owns each post's media children.
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
  handler: async (ctx, args) => {
    const body = args.body.trim();
    if (body.length === 0 || body.length > 280) {
      throw new Error('Post text must be between 1 and 280 characters.');
    }
    return {
      _id: await ctx.db.insert('posts', { ownerId: ctx.auth.userId, body }),
    };
  },
});

// @ref LLP 0239#d3-one-mediacommand-owns-multi-upload-plus-atomic-commit —
// text-only input omits media; one task otherwise owns all uploads and append.
export const createPost = defineMediaCommand({
  media: {
    input: 'media',
    intent: 'sharedMediaUpload',
    minItems: 0,
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
