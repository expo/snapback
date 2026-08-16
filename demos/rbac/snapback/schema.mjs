// Small source-authored RBAC app: appMembers is the global-role (app singleton)
// form of the same membership primitive used for role-per-resource tables.

import { defineAuth, defineSchema, defineTable, v } from '../../_kit/define.mjs';

const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});

export const appMembers = defineTable({
  userId: v.principal(),
  role: v.string(),
}).visibility({ kind: 'owner', field: 'userId' }).membership({
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
  }).visibility({ kind: 'public-read' }).sync(),
}, { auth: { mode: 'sessions' }, authProgram });
