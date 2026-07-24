import { defineSchema, defineTable, v } from '@snapback/codegen/define';

export const conversations = defineTable({
  ownerId: v.principal(),
  slug: v.string(),
  title: v.string(),
  model: v.string(),
  pageKey: v.string(),
  createdAt: v.integer(),
  updatedAt: v.integer(),
})
  .index('by_owner_slug', ['ownerId', 'slug'], { unique: true })
  .index('by_owner_page_key', ['ownerId', 'pageKey'], { unique: true })
  .index('by_owner_created', ['ownerId', 'createdAt'])
  .sync();

export const messages = defineTable({
  ownerId: v.principal(),
  conversationId: v.id('conversations'),
  role: v.string(),
  content: v.string(),
  status: v.string(),
  attemptId: v.string(),
  idempotencyKey: v.string(),
  sequence: v.integer(),
  lastProgressAt: v.integer(),
  pageKey: v.string(),
})
  .index('by_owner_conversation', ['ownerId', 'conversationId'])
  .index('by_owner_attempt', ['ownerId', 'attemptId'], { unique: true })
  .index('by_owner_idempotency', ['ownerId', 'idempotencyKey'], { unique: true })
  .sync();

export default defineSchema({ conversations, messages }, { auth: { mode: 'dev' } });
