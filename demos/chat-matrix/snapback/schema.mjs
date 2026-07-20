// Chat matrix schema — one AI conversation product across four backends.
// This is the Snapback column's source of truth.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  conversations: defineTable({
    title: v.string(),
    model: v.string(),
    createdAt: v.integer(),
  })
    .index('by_created', ['createdAt'])
    .sync(),
  messages: defineTable({
    conversationId: v.id('conversations'),
    role: v.string(), // 'user' | 'assistant'
    content: v.string(),
    // 'pending' → claimed 'streaming' → 'complete' | 'error'. The reply
    // lifecycle is table state so every surface renders it the same way.
    status: v.string(),
    createdAt: v.integer(),
  })
    .index('by_conversation', ['conversationId'])
    .sync(),
});
