import { defineContractModule, query, shape } from '@exact/contract/exports';

export default defineContractModule('./messages.query.ts', {
  messages: query({ reads: ['messages'], readMode: 'sync', cacheKey: 'messages', result: 'MessageRow[]', mode: 'poll', livePush: false, initialSnapshot: true, ephemeral: false, pollCadenceMs: 600, transport: 'poll' }),
  MessageRow: shape({ fields: { _id: 'string', conversationId: 'string', role: 'string', content: 'string', status: 'string', createdAt: 'number' } }),
});
