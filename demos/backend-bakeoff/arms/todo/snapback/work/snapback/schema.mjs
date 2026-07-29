// LLP 0102 Todo calibration: sessions-mode shared workspace data.
//
// @ref LLP 0056#invalidation-the-llp-0053-mapping — workspace membership is
// authorization backing, so joins/leaves drive the protected-live barrier.

import { defineSchema, defineTable, v } from '../../../../../../_kit/define.mjs';

export const workspaceMembers = defineTable({
  workspaceId: v.id('workspaces'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'workspaceMembers',
  principal: 'userId',
  resource: 'workspaceId',
  role: 'role',
  roles: ['owner', 'member'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['owner'], target: 'other', to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['member'] },
  ],
});

export default defineSchema({
  workspaces: defineTable({
    name: v.string(),
    createdBy: v.principal(),
  }).sync(),
  workspaceMembers,
  lists: defineTable({
    workspaceId: v.id('workspaces'),
    name: v.string(),
    position: v.integer(),
  })
    .index('by_workspace_position', ['workspaceId', 'position'])
    .sync(),
  tasks: defineTable({
    workspaceId: v.id('workspaces'),
    listId: v.id('lists'),
    title: v.string(),
    completed: v.boolean(),
    assigneeId: v.principal(),
    dueDate: v.string(),
    position: v.integer(),
  })
    .index('by_workspace_position', ['workspaceId', 'position'])
    .index('by_list_position', ['listId', 'position'])
    .sync(),
}, { auth: { mode: 'sessions' } });
