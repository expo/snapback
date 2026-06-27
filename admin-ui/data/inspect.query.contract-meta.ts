import { defineContractModule, query } from '@exact/contract/exports';

export default defineContractModule('./inspect.query.ts', {
  inspect: query({ reads: ['inspect'], readMode: 'sync', cacheKey: 'inspect' }),
});
