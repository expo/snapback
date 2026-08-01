// Party Wall functions: two upload intents (the wall photos and the public
// cover), the membership-gated wall queries, and the mutation set — with
// `createPost` as the canonical handler-side `ctx.assets.attach` consumer.

import { eventMembers } from './schema.mjs';
import {
  arg,
  asc,
  authUserId,
  defineAssetUpload,
  defineJsMutation,
  defineJsQuery,
  defineLiveQuery,
  eq,
  membershipResource,
  v,
} from '../../_kit/define.mjs';

// Wall photos: strip GPS (mandatory declaration for image media), two
// pre-materialized variants with the thumbnail required, strict delivery,
// and via-references sharing over the posts table's membership declaration.
export const photoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/png', 'image/jpeg'], maxBytes: 5_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  image: {
    location: 'strip',
    variants: [
      { key: 'thumb', width: 96, required: true },
      { key: 'display', width: 640 },
    ],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

// Event covers are the public face: immutable public delivery, so the
// browser wall renders them without a session and caches them forever.
export const coverUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/png', 'image/jpeg'], maxBytes: 5_000_000 },
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  image: {
    location: 'strip',
    variants: [{ key: 'card', width: 320, required: true }],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const eventWall = defineLiveQuery({
  table: 'posts',
  args: { eventId: v.id('events') },
  membership: [eventMembers.memberOf(membershipResource.arg('eventId'))],
  filter: [eq('eventId', arg('eventId'))],
  order: [asc('_createdAt')],
  index: 'by_event',
});

export const getEvent = defineJsQuery({
  auth: 'authenticated',
  args: { eventId: v.id('events') },
  source: 'handlers.mjs',
  exportName: 'getEvent',
  reads: ['events'],
});

export const createEvent = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { title: v.string(), emoji: v.string(), startsAt: v.integer(), hostName: v.string() },
  source: 'handlers.mjs',
  exportName: 'createEvent',
  writes: ['events', 'eventMembers'],
});

export const addGuest = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { eventId: v.id('events'), userId: v.principal() },
  source: 'handlers.mjs',
  exportName: 'addGuest',
  writes: ['eventMembers'],
});

export const leaveEvent = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { eventId: v.id('events') },
  source: 'handlers.mjs',
  exportName: 'leaveEvent',
  writes: ['eventMembers'],
});

// The canonical attach path: the handler admits the uploaded photo through
// ctx.assets.attach and the row + reverse edge commit atomically.
export const createPost = defineJsMutation({
  auth: 'authenticated',
  args: { eventId: v.id('events'), caption: v.string(), authorName: v.string(), assetId: v.string() },
  source: 'handlers.mjs',
  exportName: 'createPost',
  writes: ['posts', 'photoShares'],
});

export const setCover = defineJsMutation({
  auth: 'authenticated',
  args: { eventId: v.id('events'), assetId: v.string() },
  source: 'handlers.mjs',
  exportName: 'setCover',
  writes: ['events'],
});

export const deletePost = defineJsMutation({
  auth: 'authenticated',
  args: { postId: v.id('posts') },
  source: 'handlers.mjs',
  exportName: 'deletePost',
  writes: ['posts', 'photoShares'],
});
