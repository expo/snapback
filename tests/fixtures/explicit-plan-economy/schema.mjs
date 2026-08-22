import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    done: v.boolean(),
  }).visibility({ kind: 'public-read' }).sync(),
  otherTodos: defineTable({
    title: v.string(),
  }).visibility({ kind: 'public-read' }).sync(),
});
