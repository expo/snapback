import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  serviceState: defineTable({
    serviceId: v.string(),
    status: v.string(),
    tickCount: v.integer(),
    lastCheckedAt: v.integer(),
  })
    .visibility({ kind: 'public-read' })
    .index('by_service', ['serviceId'], { unique: true })
    .sync(),
});
