import { defineSchema, defineTable, v } from '@snapback/codegen/define';

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
    userId: v.string(),
  }).index('by_user', ['userId']).sync(),
});
