// Small source-authored RBAC app. One application row is the resource scope;
// appMembers is simultaneously the product roster and authority relation.

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
  appId: v.id('applications'),
  userId: v.principal(),
  role: v.string(),
}).visibility({ kind: 'owner', field: 'userId' }).membership({
  id: 'appAccess',
  principal: 'userId',
  resource: 'appId',
  role: 'role',
  roles: ['owner', 'admin', 'member'],
  pendingRoles: ['invited'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['owner', 'admin'], target: 'other', to: ['invited'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['invited', 'admin', 'member'] },
    { op: 'setRole', by: ['owner'], target: 'other', from: ['admin', 'member'], to: ['admin', 'member'] },
    { op: 'remove', by: ['owner'], target: 'other', from: ['invited', 'admin', 'member'] },
    { op: 'remove', by: ['admin'], target: 'other', from: ['invited', 'member'] },
  ],
}).authorityProfile({
  name: 'appAccess',
  hierarchy: {
    owner: ['admin', 'member'],
    admin: ['member'],
    member: [],
  },
  roster: { visible: ['userId', 'role'] },
});

export const announcements = defineTable({
  appId: v.id('applications'),
  authorId: v.principal(),
  message: v.string(),
}).visibility({
  kind: 'membership',
  declaration: 'appAccess',
  resourceField: 'appId',
  roles: ['member'],
}).searchIndex('search_announcements', {
  semanticVersion: 'rbac-profile-search.v1',
  textFields: { message: { weight: 4, classification: 'private' } },
  fieldClassifications: {
    appId: 'private',
    authorId: 'private',
  },
  storedFields: ['appId', 'authorId', 'message'],
  highlightFields: ['message'],
  visibility: {
    kind: 'membership',
    declaration: 'appAccess',
    resourceField: 'appId',
    roles: ['member'],
  },
}).sync();

export default defineSchema({
  applications: defineTable({
    name: v.string(),
  }).visibility({
    kind: 'membership',
    declaration: 'appAccess',
    resourceField: '_id',
    roles: ['member'],
  }),
  appMembers,
  announcements,
}, { auth: { mode: 'sessions' }, authProgram });
