import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
  }).index('by_title', ['title']).sync(),
});
