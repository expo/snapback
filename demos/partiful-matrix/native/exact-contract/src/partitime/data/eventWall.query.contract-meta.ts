import { defineContractModule, query, shape } from '@exact/contract/exports';

export default defineContractModule('./eventWall.query.ts', {
  eventWall: query({ reads: ['posts'], readMode: 'sync', cacheKey: 'posts', result: 'PostRow[]', mode: 'poll', livePush: false, initialSnapshot: true, ephemeral: false, pollCadenceMs: 1000, transport: 'poll' }),
  PostRow: shape({ fields: { _id: 'string', eventId: 'string', authorId: 'string', authorName: 'string', message: 'string', createdAt: 'number' } }),
});
