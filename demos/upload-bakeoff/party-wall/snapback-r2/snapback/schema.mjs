// Party Wall round-2 (fresh-context rebuild) — members-only live photo feed.
// Sessions auth; the private eventMembers roster is the photo-read authority
// via the posts table's assetSharing declaration.
import { defineSchema, defineTable, v } from '../../../../_kit/define.mjs';

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
    // The host seats a guest directly (members-only wall: no open self-join).
    { op: 'insert', by: ['host'], target: 'other', to: ['guest'] },
    // A guest may leave; the host is lastHolder-protected anyway.
    { op: 'remove', by: ['self'], target: 'self', from: ['guest'] },
  ],
});

export default defineSchema(
  {
    events: defineTable({
      title: v.string(),
      hostName: v.string(),
    }),
    eventMembers,
    posts: defineTable({
      eventId: v.id('events'),
      authorId: v.principal(),
      authorName: v.string(),
      caption: v.string(),
      photo: v.optional(v.assetRef({ upload: 'photoUpload' })),
    })
      .index('by_event', ['eventId'])
      .assetSharing({ kind: 'membership', membership: 'eventMembers' })
      .sync(),
  },
  { auth: { mode: 'sessions' } },
);
