// Asset conformance fixture (LLP 0044 §Language-neutral protocol): the four
// sharing postures the vectors exercise — owner-field, membership-declared,
// deliberately undeclared (mixed), and an unrestricted handler-only field.
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

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

export default defineSchema(
  {
    workspaces: defineTable({
      name: v.string(),
      createdBy: v.principal(),
    }).sync(),
    workspaceMembers,
    notes: defineTable({
      workspaceId: v.id('workspaces'),
      authorId: v.principal(),
      body: v.string(),
      photo: v.optional(v.assetRef({ upload: 'photoUpload' })),
    })
      .index('by_workspace', ['workspaceId'])
      .assetSharing({ kind: 'membership', membership: 'workspaceMembers' })
      .sync(),
    photos: defineTable({
      ownerId: v.principal(),
      caption: v.string(),
      image: v.optional(v.assetRef({ upload: 'photoUpload' })),
    })
      .assetSharing({ kind: 'owner', field: 'ownerId' })
      .sync(),
    mixedDocs: defineTable({
      ownerId: v.principal(),
      title: v.string(),
      attachment: v.optional(v.assetRef({ upload: 'photoUpload' })),
    }).sync(),
    openDocs: defineTable({
      ownerId: v.principal(),
      title: v.string(),
      attachment: v.optional(v.assetRef({ upload: null })),
    }).sync(),
  },
  { auth: { mode: 'sessions' } },
);
