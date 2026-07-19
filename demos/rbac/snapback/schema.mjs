// Small source-authored RBAC app: appMembers is the global-role (app singleton)
// form of the same membership primitive used for role-per-resource tables.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export const appMembers = defineTable({
  userId: v.principal(),
  role: v.string(),
}).membership({
  principal: 'userId',
  role: 'role',
  roles: ['member', 'admin'],
  pendingRoles: ['invited'],
  scope: 'app',
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['none'], target: 'self', to: ['member'] },
    { op: 'insert', by: ['member'], target: 'other', to: ['invited'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['invited', 'member'] },
  ],
});

export default defineSchema({
  appMembers,
  announcements: defineTable({
    authorId: v.principal(),
    message: v.string(),
  }).sync(),
}, { auth: { mode: 'sessions' } });
