import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema({
  probeRows: defineTable({
    key: v.string(),
    note: v.string(),
    payload: v.json(),
    at: v.integer(),
  }).index('by_key', ['key'], { unique: true }).sync(),
}, {
  auth: { mode: 'sessions' },
});
