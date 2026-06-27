import { defineContractModule, mutation } from '@exact/contract/exports';

export default defineContractModule('./loadTable.mutation.ts', {
  loadTable: mutation({ effects: ['tableScan.load'], invalidates: ['tableScan'] }),
});
