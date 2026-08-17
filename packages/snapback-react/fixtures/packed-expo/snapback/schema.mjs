import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
  })
    // @ref LLP 0234#phase-g2--d2-enforcing-closure — this packed-fixture
    // starter serves anonymous public functions only, so every row is
    // public by design.
    .visibility({ kind: 'public-read' })
    .index('by_title', ['title'])
    .sync(),
});
