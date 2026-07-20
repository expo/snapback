import { defineContractModule, mutation } from '@exact/contract/exports';

export default defineContractModule('./send.mutation.ts', {
  send: mutation({ effects: ['messages.write', 'conversations.write'], invalidates: ['messages', 'chatInfo'] }),
});
