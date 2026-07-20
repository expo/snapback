import { defineContractModule, query, shape } from '@exact/contract/exports';
export default defineContractModule('./guestList.query.ts', {
  guestList: query({ reads: ['rsvps'], readMode: 'sync', cacheKey: 'rsvps', result: 'RsvpRow[]', mode: 'live', livePush: true, initialSnapshot: true, ephemeral: false, pollCadenceMs: 1000, transport: 'push' }),
  RsvpRow: shape({ fields: { _id:'string', eventId:'string', userId:'string', guestName:'string', status:'string' } }),
});
