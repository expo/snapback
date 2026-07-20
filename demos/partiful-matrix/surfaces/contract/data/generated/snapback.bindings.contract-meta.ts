// GENERATED provider/binding contract-meta — do not hand-edit (LLP 0373 phase 2; LLP 0179 §8.1).
// Source authority: provider-native declaration "snapback" partitime-provider-v1 (inputsHash 5e96f75eae7192af).
// Generator: generateFromDeclaration (@exact/contract). generatedAt: DETERMINISTIC.
import { defineContractModule, mutation, query, shape } from '@exact/contract/exports';

export default defineContractModule('./provider.generated.ts', {
  EventRow: shape({ fields: { _id: 'string', accent: 'string', description: 'string', emoji: 'string', hostId: 'string', hostName: 'string', location: 'string', startsAt: 'number', title: 'string' } }),
  PostRow: shape({ fields: { _id: 'string', authorId: 'string', authorName: 'string', createdAt: 'number', eventId: 'string', message: 'string' } }),
  RsvpRow: shape({ fields: { _id: 'string', eventId: 'string', guestName: 'string', status: 'string', userId: 'string' } }),
  eventDetails: query({
    reads: ['events'],
    result: 'EventRow[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  eventWall: query({
    reads: ['posts'],
    result: 'PostRow[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  guestList: query({
    reads: ['rsvps'],
    result: 'RsvpRow[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  listEvents: query({
    reads: ['events'],
    result: 'EventRow[]',
    mode: 'live',
    livePush: true,
    initialSnapshot: true,
  }),
  createEvent: mutation({
    params: { accent: 'string', description: 'string', emoji: 'string', hostName: 'string', location: 'string', startsAt: 'number', title: 'string' },
    effects: ['data:events', 'data:rsvps'],
    invalidates: ['events', 'rsvps'],
  }),
  postMessage: mutation({
    params: { authorName: 'string', eventId: 'string', message: 'string' },
    effects: ['data:posts'],
    invalidates: ['posts'],
  }),
  rsvp: mutation({
    params: { eventId: 'string', guestName: 'string', status: 'string' },
    effects: ['data:rsvps'],
    invalidates: ['rsvps'],
  }),
});
