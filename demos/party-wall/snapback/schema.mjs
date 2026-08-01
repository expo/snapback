// Party Wall — a photos wall for events, and the first demo consumer of the
// full LLP 0044 asset surface: strip-declared image uploads with required
// variants, membership-backed `via-references` sharing, public-immutable
// covers, reference-tracked GC, and seeded photo fixtures through the
// trusted finalization path.
//
// Sharing design: the roster (eventMembers) backs authorization; `posts`
// carries the photos and declares membership asset-sharing, so a photo is
// readable exactly by the people who can see the post that references it —
// joining an event grants, leaving revokes, and nothing in the handlers
// re-implements any of that.
// @ref LLP 0044#asset-read-authorization — via-references decides only
//   through the asset-sharing-declared row-visibility policy below.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['host', 'guest'],
  bootstrapRole: 'host',
  lastHolder: { protect: 'host' },
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['host'], target: 'other', to: ['guest'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['guest'] },
  ],
});

export default defineSchema(
  {
    events: defineTable({
      title: v.string(),
      emoji: v.string(),
      startsAt: v.integer(),
      hostName: v.string(),
      // The cover delivers `public-immutable`: its bytes are cacheable by
      // anyone with the URL, so the browser wall renders covers without a
      // session. Metadata reads still follow the sharing declaration below.
      cover: v.optional(v.assetRef({ upload: 'coverUpload' })),
    })
      .assetSharing({ kind: 'membership', membership: 'eventMembers' })
      .sync(),
    eventMembers,
    // The wall rows the browser live-queries. Deliberately assetRef-free:
    // the live-query result contract does not admit AssetRef validators
    // today (found building this demo — see the diary), so the typed
    // reference lives in photoShares and the wall carries a display copy.
    posts: defineTable({
      eventId: v.id('events'),
      authorId: v.principal(),
      authorName: v.string(),
      caption: v.string(),
      photoId: v.optional(v.string()),
    })
      .index('by_event', ['eventId'])
      .sync(),
    // The typed reference + sharing edge, one row per posted photo. Never
    // live-queried; exists so via-references authorization rides the
    // membership declaration and deletion clears the edge with the row.
    photoShares: defineTable({
      eventId: v.id('events'),
      postId: v.id('posts'),
      photo: v.optional(v.assetRef({ upload: 'photoUpload' })),
    })
      .index('by_post', ['postId'])
      .index('by_event', ['eventId'])
      .assetSharing({ kind: 'membership', membership: 'eventMembers' }),
  },
  {
    auth: { mode: 'sessions' },
    // Reference GC with a demo-visible grace: an unreferenced photo (its
    // post deleted) is reclaimed about a minute later. 61s clears the
    // target's Enforced graceMinMs of 60s.
    assets: { referenceGc: { graceMs: 61_000 } },
  },
);
