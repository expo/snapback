import { defineAssetUpload, defineJsMutation, v } from '@expo/snapback-codegen/define';

export const avatarUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png'], maxBytes: 2_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const createProfile = defineJsMutation({
  auth: 'authenticated',
  args: { displayName: v.string() },
  source: 'handlers.mjs',
  exportName: 'createProfile',
  writes: ['profiles'],
});

export const setAvatar = defineJsMutation({
  auth: 'authenticated',
  args: { profileId: v.id('profiles'), assetId: v.string() },
  source: 'handlers.mjs',
  exportName: 'setAvatar',
  writes: ['profiles'],
});
