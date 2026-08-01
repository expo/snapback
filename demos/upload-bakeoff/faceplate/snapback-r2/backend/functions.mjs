// Faceplate r2 functions: the avatar upload intent, a profile lookup any
// authenticated user can read, and the upsert mutation that attaches the
// uploaded asset through the canonical `ctx.assets.attach` path.

import {
  arg,
  defineAssetUpload,
  defineJsMutation,
  defineQuery,
  eq,
  results,
  v,
} from '../../../../_kit/define.mjs';

// Avatars: images only, GPS stripped (mandatory location declaration for
// image media), strict private delivery re-authorized per request, readable
// via references from the profiles table's declared sharing.
export const avatarUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/png', 'image/jpeg'], maxBytes: 5_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  image: {
    location: 'strip',
    variants: [{ key: 'thumb', width: 64, required: true }],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

// Any signed-in user can look up a profile (and its avatar reference) by
// principal id — this is what lets user B find user A's avatar.
export const getProfile = defineQuery({
  table: 'profiles',
  args: { userId: v.principal() },
  filter: [eq('ownerId', arg('userId'))],
  index: 'by_owner',
});

// Upsert my profile with a freshly uploaded avatar. The attach admits the
// asset under the declared intent; the row + reverse reference edge commit
// atomically, replacing (and orphaning) any previous avatar reference.
export const setAvatar = defineJsMutation({
  auth: 'authenticated',
  args: { displayName: v.string(), assetId: v.string() },
  writes: ['profiles'],
  result: results.value(v.id('profiles')),
  handler: async (ctx, args) => {
    const avatar = await ctx.assets.attach(args.assetId, { upload: 'avatarUpload' });
    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_owner')
      .eq('ownerId', ctx.auth.userId)
      .collect();
    if (existing.length > 0) {
      await ctx.db.patch('profiles', existing[0]._id, {
        displayName: args.displayName,
        avatar,
      });
      return existing[0]._id;
    }
    return await ctx.db.insert('profiles', {
      ownerId: ctx.auth.userId,
      displayName: args.displayName,
      avatar,
    });
  },
});
