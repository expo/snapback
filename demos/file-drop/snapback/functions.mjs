import {
  asc,
  defineAssetUpload,
  defineJsMutation,
  defineLiveQuery,
  results,
  v,
} from '@expo/snapback-codegen/define';

export const photoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png'], maxBytes: 10_000_000 },
  // @ref LLP 0044#delivery-profiles — a plain <img> cannot carry dev-mode
  // identity, so a public gallery uses the explicit immutable delivery lane.
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  image: {
    location: 'strip',
    variants: [{ key: 'display', width: 1280, required: true }],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const listPhotos = defineLiveQuery({
  table: 'photos',
  args: {},
  order: [asc('_createdAt')],
});

export const createPhoto = defineJsMutation({
  auth: 'authenticated',
  args: { title: v.string(), assetId: v.string() },
  writes: ['photos'],
  result: results.value(v.id('photos')),
  handler: async (ctx, args) => ctx.db.insert('photos', {
    ownerId: ctx.auth.userId,
    title: args.title,
    // @ref LLP 0044#typed-references-and-atomic-attachment — attachment and
    // its reverse-reference edge commit with the gallery row.
    image: await ctx.assets.attach(args.assetId, { upload: 'photoUpload' }),
  }),
});

