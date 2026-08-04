import { defineAssetUpload, defineJsMutation, v } from '@expo/snapback-codegen/define';

export const clipUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['video/mp4'], maxBytes: 130_000_000 },
  delivery: { kind: 'private-signed' },
  access: { read: 'owner-only' },
  video: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const saveClip = defineJsMutation({
  auth: 'authenticated',
  args: { title: v.string(), assetId: v.string() },
  source: 'handlers.mjs',
  exportName: 'saveClip',
  writes: ['clips'],
});

export const clearClip = defineJsMutation({
  auth: 'authenticated',
  args: { clipId: v.id('clips') },
  source: 'handlers.mjs',
  exportName: 'clearClip',
  writes: ['clips'],
});
