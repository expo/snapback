import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  metrics: defineTable({
    dashboardId: v.string(),
    label: v.string(),
    value: v.integer(),
  })
    .index('by_dashboard', ['dashboardId'])
    .sync(),
});
