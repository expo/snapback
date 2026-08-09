import {
  arg,
  defineAssetUpload,
  defineCommand,
  defineJsMutation,
  defineLiveQuery,
  desc,
  ltFilter,
  results,
  v,
} from '@expo/snapback-codegen/define';

export const feedPhotoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 12_000_000 },
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  image: {
    location: 'strip',
    variants: [
      { key: 'thumb', width: 480, required: true },
      { key: 'display', width: 1440, required: true },
    ],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

// This second intent makes the delivery decision concrete for adaptations:
// private-strict never emits a shareable public URL. It is intentionally not
// wired into the public feed's assetRef.
export const privatePhotoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 12_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  image: {
    location: 'strip',
    variants: [{ key: 'display', width: 1440, required: true }],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const liveFeed = defineLiveQuery({
  table: 'entries',
  args: {},
  order: [desc('pageKey')],
  index: 'by_page_key',
  limit: 6,
  auth: 'public',
  authorityIndependent: true,
});

export const olderFeedPage = defineLiveQuery({
  table: 'entries',
  args: { before: v.string() },
  filter: [ltFilter('pageKey', arg('before'))],
  order: [desc('pageKey')],
  index: 'by_page_key',
  limit: 6,
  auth: 'public',
  authorityIndependent: true,
});

export const createEntry = defineJsMutation({
  args: {
    authorName: v.string(),
    caption: v.string(),
    photo: v.assetRef({ upload: 'feedPhotoUpload' }),
  },
  auth: 'authenticated',
  writes: ['entries'],
  result: results.value(v.id('entries')),
  handler: async (ctx, args) => {
    const createdAt = ctx.runtime.now();
    return ctx.db.insert('entries', {
      ownerId: ctx.auth.userId,
      authorName: args.authorName,
      caption: args.caption,
      photo: await ctx.assets.attach(args.photo, { upload: 'feedPhotoUpload' }),
      // Time keeps feed order intuitive; the runtime id makes the boundary
      // unique even when two entries share the same millisecond.
      pageKey: `${String(createdAt).padStart(16, '0')}:${ctx.runtime.id()}`,
      createdAt,
    });
  },
});

export const publishEntry = defineCommand({
  mutation: createEntry,
  assets: {
    photo: { intent: feedPhotoUpload, optional: false, mutationArg: 'photo' },
  },
});
