import {
  defineSchema,
  defineTable,
  v,
} from '../../../packages/snapback-codegen/define.mjs';

export const todos = defineTable({
  title: v.string(),
  completed: v.boolean(),
  ownerId: v.principal(),
  createdAt: v.integer(),
})
  .index('by_owner_created', ['ownerId', 'createdAt'])
  .visibility({ kind: 'owner', field: 'ownerId' })
  .sync();

export default defineSchema({ todos });
