import { defineContractModule, mutation } from '@exact/contract/exports';

export default defineContractModule('./refresh.mutation.ts', {
  refresh: mutation({ effects: ['inspect.refresh'], invalidates: ['inspect'] }),
});
