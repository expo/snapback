import { defineContractModule, query } from '@exact/contract/exports';

export default defineContractModule('./runResult.query.ts', {
  runResult: query({ reads: ['runResult'], readMode: 'sync', cacheKey: 'runResult' }),
});
