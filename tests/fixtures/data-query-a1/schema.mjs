import {
  defineSchema,
  defineTable,
  v,
} from '../../../packages/snapback-codegen/define.mjs';

export const todos = defineTable({
  ownerId: v.principal(),
  bucket: v.integer(),
  createdAt: v.optional(v.integer()),
  title: v.string(),
  cursorText: v.string(),
})
  .index('by_owner_bucket_created', ['ownerId', 'bucket', 'createdAt'])
  .index('by_owner', ['ownerId'])
  .index('by_owner_cursor_text', ['ownerId', 'cursorText'])
  .visibility({ kind: 'owner', field: 'ownerId' })
  .data({
    listIndex: 'by_owner_bucket_created',
    createDefaults: { createdAt: 'now' },
    immutable: ['createdAt'],
  });

export default defineSchema({ todos });
