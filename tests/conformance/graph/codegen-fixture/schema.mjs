import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const issues = defineTable({
  title: v.string(),
  updatedAt: v.integer(),
})
  .index('by_updated', ['updatedAt'])
  .permissionBacking(['title'])
  .visibility({ kind: 'public-read' })
  .sync();

export default defineSchema({ issues });
