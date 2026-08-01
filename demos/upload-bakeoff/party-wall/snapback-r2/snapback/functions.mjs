import { eventMembers } from './schema.mjs';
import {
  arg,
  asc,
  defineAssetUpload,
  defineJsMutation,
  defineLiveQuery,
  eq,
  membershipResource,
  results,
  v,
} from '../../../../_kit/define.mjs';

// One upload intent: JPEG photos, GPS stripped from the canonical bytes,
// a required 128px thumbnail gating readiness, private-strict delivery,
// read authority only via table references (posts.assetSharing → members).
export const photoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 5_000_000 },
  image: { location: 'strip', variants: [{ key: 'thumb', width: 128, required: true }] },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

// Members-only live feed: the membership semi-join makes an outsider's
// subscription simply empty (no existence leak).
export const eventFeed = defineLiveQuery({
  auth: 'authenticated',
  table: 'posts',
  args: { eventId: v.id('events') },
  membership: [eventMembers.memberOf(membershipResource.arg('eventId'))],
  filter: [eq('eventId', arg('eventId'))],
  order: [asc('_createdAt')],
  index: 'by_event',
});

// Create an event and atomically seat the caller as host.
export const createEvent = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: false,
  args: { title: v.string(), hostName: v.string() },
  writes: ['events', 'eventMembers'],
  result: results.value(v.id('events')),
  handler: async (ctx, args) =>
    ctx.membership.eventMembers.bootstrap({ title: args.title, hostName: args.hostName }),
});

// Host adds a guest by principal id.
export const addGuest = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { eventId: v.id('events'), userId: v.principal() },
  writes: ['eventMembers'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ctx.membership.eventMembers.insert({
      eventId: args.eventId,
      userId: args.userId,
      role: 'guest',
    });
    return true;
  },
});

// A guest leaves; membership deletion blanks their live feed and revokes
// reference-derived photo-read authority.
export const leaveEvent = defineJsMutation({
  auth: 'authenticated',
  args: { eventId: v.id('events') },
  writes: ['eventMembers'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ctx.membership.eventMembers.removeSelf(args.eventId);
    return true;
  },
});

// Post a photo to the wall (members only; denial is explicit on this write
// path rather than a silent no-op).
export const createPost = defineJsMutation({
  auth: 'authenticated',
  args: {
    eventId: v.id('events'),
    caption: v.string(),
    authorName: v.string(),
    assetId: v.string(),
  },
  writes: ['posts'],
  result: results.value(v.id('posts')),
  handler: async (ctx, args) => {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'guest');
    return await ctx.db.insert('posts', {
      eventId: args.eventId,
      authorId: ctx.auth.userId,
      authorName: args.authorName,
      caption: args.caption,
      photo: await ctx.assets.attach(args.assetId, { upload: 'photoUpload' }),
    });
  },
});

// Author deletes their own post; the typed reference edge goes with the row.
export const deletePost = defineJsMutation({
  auth: 'authenticated',
  args: { postId: v.id('posts') },
  writes: ['posts'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    const post = await ctx.db.get('posts', args.postId);
    if (!post) throw new Error('post not found');
    if (post.authorId !== ctx.auth.userId) throw new Error('only the author may delete a post');
    await ctx.db.delete('posts', args.postId);
    return true;
  },
});
