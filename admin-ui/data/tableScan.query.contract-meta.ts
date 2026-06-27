import { defineContractModule, query } from '@exact/contract/exports';

export default defineContractModule('./tableScan.query.ts', {
  tableScan: query({ reads: ['tableScan'], readMode: 'sync', cacheKey: 'tableScan' }),
});
