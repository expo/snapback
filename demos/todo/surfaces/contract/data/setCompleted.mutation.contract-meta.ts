import { defineContractModule, mutation } from '@exact/contract/exports';

export default defineContractModule('./setCompleted.mutation.ts', {
  setCompleted: mutation({ effects: ['todos.write'], invalidates: ['todos'] }),
});
