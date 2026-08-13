import { defineSchema, defineTable, v } from "./_generated/server";

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
  }).index("by_completed", ["completed"]),
});
