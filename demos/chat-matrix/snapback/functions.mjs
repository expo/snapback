// Chat matrix — Snapback functions.
//
// The AI reply follows All Aboard's egress split (@ref LLP 0027#external-data-and-action-egress —
// egress stays out of the transactional path): sendMessage writes the user row
// plus a pending assistant row; the generateReply ACTION fetches OpenRouter
// and commits deltas through mutations, so streaming rides the ordinary
// live-query fan-out.

import {
  arg,
  asc,
  defineAction,
  defineConfig,
  defineJsMutation,
  defineLiveQuery,
  eq,
  v,
} from '../../_kit/define.mjs';

export const appConfig = defineConfig({
  openrouter: {
    description: 'OpenRouter API key',
    purpose: 'Generates assistant replies via the OpenRouter chat-completions API',
    required: true,
    pool: true,
    howToGet: 'Create a key at https://openrouter.ai/keys',
    acquisition: {
      url: 'https://openrouter.ai/keys',
      kind: 'self-serve',
      inputs: ['email'],
      cost: 'pay-per-token',
      humanCommitment: ['terms'],
    },
  },
});

export const listConversations = defineLiveQuery({
  table: 'conversations',
  args: {},
  order: [asc('createdAt')],
  index: 'by_created',
});

export const thread = defineLiveQuery({
  table: 'messages',
  args: { conversationId: v.id('conversations') },
  filter: [eq('conversationId', arg('conversationId'))],
  order: [asc('createdAt')],
  index: 'by_conversation',
});

export const createConversation = defineJsMutation({
  args: { title: v.string(), model: v.string(), createdAt: v.integer() },
  source: 'handlers.mjs',
  exportName: 'createConversation',
  writes: ['conversations'],
});

export const sendMessage = defineJsMutation({
  args: { conversationId: v.id('conversations'), content: v.string(), createdAt: v.integer() },
  source: 'handlers.mjs',
  exportName: 'sendMessage',
  reads: ['conversations'],
  writes: ['messages'],
});

// Claims a pending assistant row for generation: flips it to 'streaming' and
// returns the model plus prior turns, because actions have no ctx.db — the
// mutation is both the read snapshot and the claim barrier (double-claim safe).
export const claimReply = defineJsMutation({
  args: { messageId: v.id('messages') },
  source: 'handlers.mjs',
  exportName: 'claimReply',
  reads: ['conversations', 'messages'],
  writes: ['messages'],
});

export const applyAssistantDelta = defineJsMutation({
  args: { messageId: v.id('messages'), content: v.string(), status: v.string() },
  source: 'handlers.mjs',
  exportName: 'applyAssistantDelta',
  reads: ['messages'],
  writes: ['messages'],
});

export const generateReply = defineAction({
  args: { messageId: v.id('messages') },
  js: { source: 'handlers.mjs', exportName: 'generateReply' },
  uses: ['openrouter'],
  writes: ['messages'],
});
