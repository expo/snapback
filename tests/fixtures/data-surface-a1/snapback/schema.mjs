import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema({
  todos: defineTable({
    ownerId: v.principal(),
    title: v.string(),
    position: v.integer(),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .index('by_owner_position', ['ownerId', 'position'])
    .data(),
}, { auth: { mode: 'sessions' } });
