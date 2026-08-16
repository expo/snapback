import {
  defineAssetUpload,
  defineJsMutation,
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

export const createProfile = defineJsMutation({
  auth: 'authenticated',
  args: { displayName: v.string() },
  reads: [],
  writes: ['profiles'],
  result: results.value(v.id('profiles')),
  handler: async (ctx, args) =>
    ctx.db.insert('profiles', {
      ownerId: ctx.auth.userId,
      displayName: args.displayName,
      image: null,
    }),
});

export const setProfileImage = defineJsMutation({
  auth: 'authenticated',
  args: {
    profileId: v.id('profiles'),
    image: v.assetRef({ upload: 'profileImageUpload' }),
  },
  reads: ['profiles'],
  writes: ['profiles'],
  result: results.document('profiles'),
  handler: async (ctx, args) => {
    await ctx.db.patch('profiles', args.profileId, {
      image: await ctx.assets.attach(args.image, { upload: 'profileImageUpload' }),
    });
    return ctx.db.get('profiles', args.profileId);
  },
});

export const returnStoredProfile = defineJsMutation({
  auth: 'authenticated',
  args: { displayName: v.string() },
  reads: ['profiles'],
  writes: ['profiles'],
  result: results.document('profiles'),
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_owner')
      .eq('ownerId', ctx.auth.userId)
      .first();
    await ctx.db.patch('profiles', profile._id, { displayName: args.displayName });
    return ctx.db.get('profiles', profile._id);
  },
});
