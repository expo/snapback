import {
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';

export default defineSchema({
  events: defineTable({
    ownerId: v.principal(),
    label: v.string(),
    createdAt: v.integer(),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .sync(),
});
