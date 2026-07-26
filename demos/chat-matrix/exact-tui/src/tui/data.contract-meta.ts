// Contract import-boundary descriptors for the Exact TUI chat cell.
// Pure exports are argument-dependent; gateway calls are explicit network/chat
// capabilities rather than generator-produced opaque descriptors.

import { capability, defineContractModule, pure } from '@exact/contract/exports';

export default defineContractModule('./data.ts', {
  backendTabs: pure({ params: [], result: 'object[]', depends: 'args' }),
  formatTranscript: pure({ params: ['messages', 'backend', 'sending'], result: 'string[]', depends: 'args' }),
  pollConversation: capability({
    params: { backend: 'string', conversationId: 'string' },
    effects: ['network.fetch', 'chat.read'],
  }),
  sendMessage: capability({
    params: {
      backend: 'string',
      existingConversationId: 'string | null',
      model: 'string',
      content: 'string',
    },
    effects: ['network.fetch', 'chat.write', 'chat.read'],
  }),
});
