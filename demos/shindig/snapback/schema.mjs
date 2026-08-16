// Shindig — a Partiful-style events demo. The authorization roster
// (eventMembers) and the displayable RSVP state (invites) are deliberately
// separate tables: v1 membership declarations are private authorization
// backing with no roster visibility preset, so everything the UI renders —
// the feed card, the guest list, RSVP statuses — is ordinary app data gated
// *by* the roster, never the roster itself.
//
// Pending invites live in ordinary app data because they are displayable
// product state; the private membership row is created when a guest first
// responds. Self-service membership transitions are available when a product
// does model pending authority in the roster, without exposing roster ids.
// @ref LLP 0056#declaring-a-membership-table — private by default: the roster
//   backs authorization only; everything rendered is denormalized app data.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
}).visibility({ kind: 'owner', field: 'userId' }).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['host', 'guest'],
  bootstrapRole: 'host',
  lastHolder: { protect: 'host' },
  provenance: 'full',
  transitions: [
    // A first RSVP seats the responder as a guest. The rsvp mutation only
    // reaches this insert for principals holding an invites row, but the
    // matrix itself admits any self-seat — the membership boundary enforces
    // who/role shape, the invite check is product policy in the handler.
    { op: 'insert', by: ['none'], target: 'self', to: ['guest'] },
  ],
});

export default defineSchema({
  events: defineTable({
    title: v.string(),
    emoji: v.string(),
    description: v.string(),
    location: v.string(),
    startsAt: v.integer(),
    hostName: v.string(),
  }).visibility({
    kind: 'membership',
    declaration: eventMembers,
    resourceField: '_id',
    roles: ['host', 'guest'],
  }),
  eventMembers,
  // One row per (event, person): the host's own seat, pending invitations,
  // and responses. Carries denormalized event fields so the feed can render
  // a card from the by_user index alone.
  invites: defineTable({
    eventId: v.id('events'),
    userId: v.principal(),
    guestName: v.string(),
    status: v.string(), // 'host' | 'invited' | 'going' | 'maybe' | 'cant'
    note: v.optional(v.string()),
    eventTitle: v.string(),
    eventEmoji: v.string(),
    eventStartsAt: v.integer(),
    hostName: v.string(),
  })
    .visibility({
      kind: 'any-of',
      arms: [
        { kind: 'owner', field: 'userId' },
        {
          kind: 'membership',
          declaration: eventMembers,
          resourceField: 'eventId',
          roles: ['host', 'guest'],
        },
      ],
    })
    .index('by_user', ['userId'])
    .index('by_event', ['eventId'])
    .index('by_event_user', ['eventId', 'userId'], { unique: true })
    .sync(),
  posts: defineTable({
    eventId: v.id('events'),
    authorId: v.principal(),
    authorName: v.string(),
    message: v.string(),
  })
    .visibility({
      kind: 'membership',
      declaration: eventMembers,
      resourceField: 'eventId',
      roles: ['host', 'guest'],
    })
    .index('by_event', ['eventId'])
    .sync(),
});
