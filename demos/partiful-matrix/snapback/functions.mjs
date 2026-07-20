import {
  arg,
  asc,
  defineJsMutation,
  defineLiveQuery,
  eq,
  v,
} from '../../_kit/define.mjs';

export const listEvents = defineLiveQuery({
  table: 'events',
  args: {},
  order: [asc('startsAt')],
});

export const eventDetails = defineLiveQuery({
  table: 'events',
  args: { eventId: v.id('events') },
  filter: [eq('_id', arg('eventId'))],
});

export const guestList = defineLiveQuery({
  table: 'rsvps',
  args: { eventId: v.id('events') },
  filter: [eq('eventId', arg('eventId'))],
  order: [asc('_createdAt')],
  index: 'by_event',
});

export const eventWall = defineLiveQuery({
  table: 'posts',
  args: { eventId: v.id('events') },
  filter: [eq('eventId', arg('eventId'))],
  order: [asc('createdAt')],
  index: 'by_event',
});

export const createEvent = defineJsMutation({
  args: {
    title: v.string(),
    emoji: v.string(),
    description: v.string(),
    location: v.string(),
    startsAt: v.integer(),
    hostName: v.string(),
    accent: v.string(),
  },
  source: 'handlers.mjs',
  exportName: 'createEvent',
  writes: ['events', 'rsvps'],
});

export const rsvp = defineJsMutation({
  args: {
    eventId: v.id('events'),
    guestName: v.string(),
    status: v.string(),
  },
  source: 'handlers.mjs',
  exportName: 'rsvp',
  reads: ['rsvps'],
  writes: ['rsvps'],
});

export const postMessage = defineJsMutation({
  args: {
    eventId: v.id('events'),
    authorName: v.string(),
    message: v.string(),
    createdAt: v.integer(),
  },
  source: 'handlers.mjs',
  exportName: 'postMessage',
  writes: ['posts'],
});
