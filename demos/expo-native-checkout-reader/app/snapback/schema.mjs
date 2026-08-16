import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema({
  witnessRows: defineTable({
    ownerId: v.string(),
    note: v.string(),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .index('by_owner', ['ownerId'])
    .sync(),
});
