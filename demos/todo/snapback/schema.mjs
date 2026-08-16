// Todo demo schema — the source of truth for the `todos` table.
//
// @ref LLP 0015#todo-demo-requirements — the floor app: source-authored schema,
//   user-scoped data, server-owned system fields, one indexed/syncable table.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
    userId: v.string(),
  })
    .visibility({ kind: 'owner', field: 'userId' })
    // by_user backs the user-scoped live query's index-first lookup.
    .index('by_user', ['userId'])
    // Declared syncable so it can back the restricted syncable-live subset.
    .sync(),
});
