import {
  defineSchema,
  defineTable,
  v,
} from '../../../packages/snapback-codegen/define.mjs';

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
  }).sync().index('by_completed', ['completed']),
});
