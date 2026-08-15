import { defineAssetUpload } from './generated/server';

export const videoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['video/mp4'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  video: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
