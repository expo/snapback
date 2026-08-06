import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema(
  {
    receiptNotes: defineTable({
      text: v.string(),
      source: v.string(),
    }).index('by_source', ['source']).sync(),
  },
  {
    auth: { mode: 'sessions' },
  },
);
