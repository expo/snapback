import { defineContractModule, mutation } from '@exact/contract/exports';

export default defineContractModule('./newConversation.mutation.ts', {
  newConversation: mutation({ effects: ['conversations.write'], invalidates: ['messages', 'chatInfo'] }),
});
