import { defineContractModule, query, shape } from '@exact/contract/exports';

export default defineContractModule('./listEvents.query.ts', {
  listEvents: query({ reads: ['events'], readMode: 'sync', cacheKey: 'events', result: 'EventRow[]', mode: 'poll', livePush: false, initialSnapshot: true, ephemeral: false, pollCadenceMs: 1000, transport: 'poll' }),
  EventRow: shape({ fields: { _id: 'string', title: 'string', emoji: 'string', description: 'string', location: 'string', startsAt: 'number', hostId: 'string', hostName: 'string', accent: 'string' } }),
});
