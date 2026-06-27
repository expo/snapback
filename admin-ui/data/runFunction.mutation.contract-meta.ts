import { defineContractModule, mutation } from '@exact/contract/exports';

export default defineContractModule('./runFunction.mutation.ts', {
  runFunction: mutation({ effects: ['runResult.run'], invalidates: ['runResult'] }),
});
