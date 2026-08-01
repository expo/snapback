// Clip Locker (round 2) — upload intents + the mutations the checklist
// implies (create/attach, list, delete), inline-handler form.
import {
  arg,
  asc,
  authUserId,
  defineAssetUpload,
  defineJsMutation,
  defineQuery,
  eq,
  results,
  v,
} from '../../../../_kit/define.mjs';

// The vault lane: big MP4s, strict private delivery (per-request auth,
// HTTP ranges for seeking). maxBytes bounds the ~120 MB fixture with room.
export const clipUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['video/mp4'], maxBytes: 200_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  // Codegen refuses video intents without a location policy; 'strip' for
  // video refuses at generation (asset-video-finalization is a declared
  // Missing nonclaim), so 'retain' is the only admissible video policy.
  image: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

// The share lane: private-signed issues bounded bearer URLs (TTL), which
// private-strict refuses by design — sharing is a different intent.
export const shareClipUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['video/mp4'], maxBytes: 200_000_000 },
  delivery: { kind: 'private-signed' },
  access: { read: 'owner-only' },
  image: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const listClips = defineQuery({
  table: 'clips',
  args: {},
  filter: [eq('ownerId', authUserId())],
  order: [asc('_createdAt')],
  index: 'by_owner',
});

export const createClip = defineJsMutation({
  auth: 'authenticated',
  args: { title: v.string(), assetId: v.string() },
  writes: ['clips'],
  result: results.value(v.id('clips')),
  handler: async (ctx, args) =>
    ctx.db.insert('clips', {
      ownerId: ctx.auth.userId,
      title: args.title,
      video: await ctx.assets.attach(args.assetId, { upload: 'clipUpload' }),
    }),
});

export const createShareClip = defineJsMutation({
  auth: 'authenticated',
  args: { title: v.string(), assetId: v.string() },
  writes: ['clips'],
  result: results.value(v.id('clips')),
  handler: async (ctx, args) =>
    ctx.db.insert('clips', {
      ownerId: ctx.auth.userId,
      title: args.title,
      shareVideo: await ctx.assets.attach(args.assetId, { upload: 'shareClipUpload' }),
    }),
});

export const deleteClip = defineJsMutation({
  auth: 'authenticated',
  args: { clipId: v.id('clips') },
  writes: ['clips'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    const clip = await ctx.db.get('clips', args.clipId);
    if (!clip) throw new Error('clip not found');
    if (clip.ownerId !== ctx.auth.userId) throw new Error('not your clip');
    await ctx.db.delete('clips', args.clipId);
    return 1;
  },
});
