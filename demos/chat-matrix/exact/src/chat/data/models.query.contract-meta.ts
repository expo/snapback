import { defineContractModule, query, shape } from '@exact/contract/exports';

export default defineContractModule('./models.query.ts', {
  models: query({ reads: ['models'], readMode: 'sync', cacheKey: 'models', result: 'ModelRow[]', mode: 'poll', livePush: false, initialSnapshot: true, ephemeral: false, pollCadenceMs: 600000, transport: 'poll' }),
  ModelRow: shape({ fields: { _id: 'string', id: 'string' } }),
});
