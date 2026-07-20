import { defineContractModule, query, shape } from '@exact/contract/exports';

export default defineContractModule('./chatInfo.query.ts', {
  chatInfo: query({ reads: ['conversations'], readMode: 'sync', cacheKey: 'chatInfo', result: 'ChatInfoRow[]', mode: 'poll', livePush: false, initialSnapshot: true, ephemeral: false, pollCadenceMs: 600, transport: 'poll' }),
  ChatInfoRow: shape({ fields: { _id: 'string', backend: 'string', model: 'string', conversationId: 'string' } }),
});
