// Intentionally-valid schema; the invalid reference lives in functions.mjs.
import { defineSchema, defineTable, v } from '../../../../../_kit/define.mjs';

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    userId: v.string(),
  }).index('by_user', ['userId']),
});
