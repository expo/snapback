import { defineContractModule, mutation } from '@exact/contract/exports';

export default defineContractModule('./setModel.mutation.ts', {
  setModel: mutation({ effects: ['conversations.write'], invalidates: ['messages', 'chatInfo'] }),
});
