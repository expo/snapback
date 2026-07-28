import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  serviceState: defineTable({
    serviceId: v.string(),
    status: v.string(),
    tickCount: v.integer(),
    lastCheckedAt: v.integer(),
  })
    .index('by_service', ['serviceId'], { unique: true })
    .sync(),
});
