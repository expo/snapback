// The A4 event surface: one registered multi-query React view shared verbatim
// between the browser app (src/App.tsx) and the jsdom render proof
// (ui-render.mjs). Three live queries in one provider-owned group: the event
// (with counts), the wall feed, and the guest list.
import { createElement as h } from 'react';
import { useSnapbackQueries, useSnapbackMutation } from '@expo/snapback-react';
import api from '../snapback/generated/api.mjs';

const rowsOf = (entry) =>
  entry && (entry.status === 'ready' || entry.status === 'refreshing') ? entry.data : [];

export function EventView({ eventId }) {
  const live = useSnapbackQueries({
    event: { ref: api.guestEventView, args: { eventId } },
    wall: { ref: api.wallFeed, args: { eventId } },
    guests: { ref: api.guestList, args: { eventId } },
  });
  const updateRsvp = useSnapbackMutation(api.updateRsvp);
  const event = rowsOf(live.queries.event)[0] ?? null;
  const wall = rowsOf(live.queries.wall);
  const guests = rowsOf(live.queries.guests);
  const going = guests.filter((g) => g.status === 'going');

  const rsvp = (status) => {
    updateRsvp({ eventId, status, plusOnes: 0 }).catch(() => {});
  };

  return h('section', { className: 'workspace event-grid', 'aria-label': 'Event application' },
    h('article', { className: 'event-card panel' },
      h('div', { className: 'event-art', 'data-testid': 'event-art' },
        h('span', null, event ? event.title.toUpperCase() : 'LOADING')),
      h('div', { className: 'event-copy' },
        h('p', { className: 'eyebrow' }, event ? new Date(event.startsAt).toDateString() : '…'),
        h('h2', { 'data-testid': 'event-title' }, event ? event.title : 'Loading event'),
        h('p', { 'data-testid': 'event-city' }, event ? `${event.city} · ${event.privateAddress}` : ''),
        h('div', { className: 'rsvp-row', 'data-testid': 'event-rsvp-controls' },
          h('button', { onClick: () => rsvp('going') }, 'Going'),
          h('button', { onClick: () => rsvp('maybe') }, 'Maybe'),
          h('button', { onClick: () => rsvp('declined') }, 'Can’t go')))),
    h('aside', { className: 'panel event-side' },
      h('p', { className: 'section-label', 'data-testid': 'event-guest-count' },
        event ? `${event.goingSeats} / ${event.capacity} attending` : 'counting…'),
      h('div', { className: 'capacity' },
        h('span', { style: { width: event ? `${Math.min(100, (event.goingSeats / event.capacity) * 100)}%` : '0%' } })),
      h('h3', null, 'Guest list'),
      h('p', { 'data-testid': 'event-guest-list' },
        going.map((g) => (g.plusOnes > 0 ? `${g.name} +${g.plusOnes}` : g.name)).join(' · ') || 'nobody yet'),
      h('button', { className: 'primary', 'data-testid': 'event-invite' }, 'Invite guests'),
      h('h3', null, 'Event wall'),
      h('div', { 'data-testid': 'event-wall' },
        wall.map((post) =>
          h('p', { key: post._id, 'data-testid': `event-wall-${post.seq}` },
            h('strong', null, post.authorName), ` ${post.body}`)))),
  );
}
