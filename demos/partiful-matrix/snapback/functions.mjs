import {
  arg, asc, authUserId, bindingRef, call, cond, defineJsMutation,
  defineLiveQuery, defineMutation, eq, guard, insert, lit, ne,
  returnBinding, runtimeNow, v,
} from '../../_kit/define.mjs';

// @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
// common multi-row writes stay in the portable declarative mutation tier.
// @ref LLP 0065#3-common-pattern-contracts — wall timestamps are trusted
// runtime values and never client-forgeable mutation arguments.
const trimmed = (name) => call('trim', arg(name));

export const listEvents = defineLiveQuery({
  table: 'events', args: {}, order: [asc('startsAt')],
});

export const eventDetails = defineLiveQuery({
  table: 'events', args: { eventId: v.id('events') }, filter: [eq('_id', arg('eventId'))],
});

export const guestList = defineLiveQuery({
  table: 'rsvps', args: { eventId: v.id('events') },
  filter: [eq('eventId', arg('eventId'))], order: [asc('_createdAt')], index: 'by_event',
});

export const eventWall = defineLiveQuery({
  table: 'posts', args: { eventId: v.id('events') },
  filter: [eq('eventId', arg('eventId'))], order: [asc('createdAt')], index: 'by_event',
});

export const createEvent = defineMutation({
  args: {
    title: v.string(), emoji: v.string(), description: v.string(), location: v.string(),
    startsAt: v.integer(), hostName: v.string(), accent: v.string(),
  },
  plan: [
    guard(ne(trimmed('title'), lit('')), 'SNAPBACK_EVENT_TITLE_REQUIRED'),
    guard(ne(trimmed('location'), lit('')), 'SNAPBACK_EVENT_LOCATION_REQUIRED'),
    insert('events', {
      title: trimmed('title'),
      emoji: cond(ne(arg('emoji'), lit('')), arg('emoji'), lit('✨')),
      description: trimmed('description'), location: trimmed('location'),
      startsAt: arg('startsAt'), hostId: authUserId(),
      hostName: arg('hostName'), accent: arg('accent'),
    }, { bindIdAs: 'eventId' }),
    insert('rsvps', {
      eventId: bindingRef('eventId'), userId: authUserId(),
      guestName: arg('hostName'), status: lit('host'),
    }),
  ],
  returns: returnBinding('eventId'),
});

export const rsvp = defineJsMutation({
  args: { eventId: v.id('events'), guestName: v.string(), status: v.string() },
  source: 'handlers.mjs', exportName: 'rsvp', reads: ['rsvps'], writes: ['rsvps'],
});

export const postMessage = defineMutation({
  args: { eventId: v.id('events'), authorName: v.string(), message: v.string() },
  plan: [
    guard(ne(trimmed('message'), lit('')), 'SNAPBACK_POST_MESSAGE_REQUIRED'),
    insert('posts', {
      eventId: arg('eventId'), authorId: authUserId(), authorName: arg('authorName'),
      message: trimmed('message'), createdAt: runtimeNow(),
    }, { bindIdAs: 'postId' }),
  ],
  returns: returnBinding('postId'),
});
