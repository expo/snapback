import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

// Corpus-local class-1 resources. Membership is establishment authority only;
// it is deliberately absent from the rooms table visibility and graph base.
// @ref LLP 0209#33-the-nine-llp-0268-inputs-and-their-carriers — this fixture keeps the delivered
// graph class 1 while binding every room row to the establishment scope.
export const rooms = defineTable({
  scopeId: v.id('rooms'),
  name: v.string(),
  category: v.string(),
  updatedAt: v.integer(),
})
  .index('by_scope_updated', ['scopeId', 'updatedAt'])
  .index('by_category_updated', ['category', 'updatedAt'])
  .visibility({ kind: 'public-read' });

export const roomMembers = defineTable({
  principal: v.principal(),
  roomId: v.id('rooms'),
  role: v.string(),
})
  .membership({
    principal: 'principal',
    resource: 'roomId',
    role: 'role',
    roles: ['member', 'moderator'],
  })
  .visibility({ kind: 'owner', field: 'principal' });

export default defineSchema({ rooms, roomMembers }, { auth: { mode: 'sessions' } });
