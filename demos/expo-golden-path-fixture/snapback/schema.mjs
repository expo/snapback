import { defineEphemeral, defineSchema, defineTable, v } from '../../_kit/define.mjs';
import { typing } from './surface-model.mjs';

export default defineSchema(
  {
    receiptNotes: defineTable({
      text: v.string(),
      source: v.string(),
    }).index('by_source', ['source']).sync(),
    conversations: defineTable({
      title: v.string(),
    }).sync(),
    messages: defineTable({
      conversationId: v.id('conversations'),
      body: v.string(),
      reaction: v.optional(v.string()),
    }).index('by_conversation', ['conversationId']).sync(),
  },
  {
    auth: { mode: 'sessions' },
    ephemeral: defineEphemeral({ typing }),
  },
);
