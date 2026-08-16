// @ref LLP 0056#declaring-a-membership-table — workspaceMembers is private
// authority backing with an atomic owner bootstrap.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export const workspaceMembers = defineTable({
  workspaceId: v.id('workspaces'),
  userId: v.principal(),
  role: v.string(),
}).visibility({ kind: 'owner', field: 'userId' }).membership({
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
    { op: 'remove', by: ['self'], target: 'self', from: ['member'] }
  ],
});

export default defineSchema({
  workspaces: defineTable({
    name: v.string(),
    createdBy: v.principal(),
  })
    .visibility({
      kind: 'membership',
      declaration: workspaceMembers,
      resourceField: '_id',
      roles: ['owner', 'member'],
    })
    .sync(),
  workspaceMembers,
  notes: defineTable({
    workspaceId: v.id('workspaces'),
    authorId: v.principal(),
    body: v.string(),
  })
    .visibility({
      kind: 'membership',
      declaration: workspaceMembers,
      resourceField: 'workspaceId',
      roles: ['owner', 'member'],
    })
    .index('by_workspace', ['workspaceId'])
    .sync(),
}, { auth: { mode: 'dev' } });
