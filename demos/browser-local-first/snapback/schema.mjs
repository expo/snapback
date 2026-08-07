import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  todos: defineTable({
    listId: v.string(),
    title: v.string(),
    done: v.boolean(),
    note: v.optional(v.string()),
  })
    .index('by_list_title', ['listId', 'title'])
    .sync(),
});
