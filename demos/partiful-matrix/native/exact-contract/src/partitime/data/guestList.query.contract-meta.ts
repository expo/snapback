import { defineContractModule, query, shape } from '@exact/contract/exports';

export default defineContractModule('./guestList.query.ts', {
  guestList: query({ reads: ['rsvps'], readMode: 'sync', cacheKey: 'rsvps', result: 'RsvpRow[]', mode: 'poll', livePush: false, initialSnapshot: true, ephemeral: false, pollCadenceMs: 1000, transport: 'poll' }),
  RsvpRow: shape({ fields: { _id: 'string', eventId: 'string', userId: 'string', guestName: 'string', status: 'string' } }),
});
