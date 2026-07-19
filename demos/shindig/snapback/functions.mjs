import { eventMembers } from './schema.mjs';
import {
  arg,
  asc,
  authUserId,
  defineJsMutation,
  defineJsQuery,
  defineLiveQuery,
  eq,
  membershipResource,
  v,
} from '../../_kit/define.mjs';

// The home feed: every invite/seat row for the signed-in user, rendered as
// cards from the denormalized event fields. No membership gate — a pending
// invitee must see their own card to be able to respond to it.
export const myFeed = defineLiveQuery({
  table: 'invites',
  args: {},
  filter: [eq('userId', authUserId())],
  order: [asc('eventStartsAt')],
  index: 'by_user',
});

// The guest list is members-only: RSVP first, then see who's coming.
export const guestList = defineLiveQuery({
  table: 'invites',
  args: { eventId: v.id('events') },
  membership: [eventMembers.memberOf(membershipResource.arg('eventId'))],
  filter: [eq('eventId', arg('eventId'))],
  order: [asc('_createdAt')],
  index: 'by_event',
});

// The event wall, same boundary as the guest list.
export const eventWall = defineLiveQuery({
  table: 'posts',
  args: { eventId: v.id('events') },
  membership: [eventMembers.memberOf(membershipResource.arg('eventId'))],
  filter: [eq('eventId', arg('eventId'))],
  order: [asc('_createdAt')],
  index: 'by_event',
});

// Live, IR-tier variant of the event read for the Contract arm: the
// multi-live surface can only serve configured live queries, so the event
// hero binds this instead of the snapshot getEvent. Non-members get empty
// rows (the membership semi-join, no existence leak) — the Contract UI
// renders that as the locked page.
export const eventDetails = defineLiveQuery({
  table: 'events',
  args: { eventId: v.id('events') },
  membership: [eventMembers.memberOf(membershipResource.arg('eventId'))],
  filter: [eq('_id', arg('eventId'))],
});

export const getEvent = defineJsQuery({
  args: { eventId: v.id('events') },
  source: 'handlers.mjs',
  exportName: 'getEvent',
  reads: ['events', 'eventMembers'],
});

// Bootstrap-only wrapper: atomically inserts the event and seats the caller
// as host, then writes the host's own feed row. authorityCreating stays false
// because bootstrap cannot name a principal other than the effective caller.
export const createEvent = defineJsMutation({
  args: {
    title: v.string(),
    emoji: v.string(),
    description: v.string(),
    location: v.string(),
    startsAt: v.integer(),
    hostName: v.string(),
  },
  source: 'handlers.mjs',
  exportName: 'createEvent',
  writes: ['events', 'eventMembers', 'invites'],
});

export const invite = defineJsMutation({
  args: { eventId: v.id('events'), userId: v.string(), guestName: v.string() },
  source: 'handlers.mjs',
  exportName: 'invite',
  reads: ['events', 'eventMembers'],
  writes: ['invites'],
});

// First response seats the guest (membership insert); later responses just
// update the displayed status. authorityCreating: the self-seat creates
// durable authority over the event's gated queries.
export const rsvp = defineJsMutation({
  authorityCreating: true,
  args: {
    eventId: v.id('events'),
    status: v.string(),
    note: v.optional(v.string()),
  },
  source: 'handlers.mjs',
  exportName: 'rsvp',
  reads: ['invites'],
  writes: ['eventMembers', 'invites'],
});

export const postToWall = defineJsMutation({
  args: { eventId: v.id('events'), message: v.string(), authorName: v.string() },
  source: 'handlers.mjs',
  exportName: 'postToWall',
  reads: ['eventMembers'],
  writes: ['posts'],
});
