// Asset conformance fixture (LLP 0044 §Language-neutral protocol): the four
// sharing postures the vectors exercise — owner-field, membership-declared,
// deliberately undeclared (mixed), and an unrestricted handler-only field.
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const workspaceMembers = defineTable({
  workspaceId: v.id('workspaces'),
  userId: v.principal(),
  role: v.string(),
})
  .visibility({ kind: 'owner', field: 'userId' })
  .membership({
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
    })
      .visibility({
        kind: 'membership',
        declaration: workspaceMembers,
        resourceField: '_id',
        roles: ['owner', 'member'],
      })
      .sync(),
    workspaceMembers,
    assetCallbackLog: defineTable({
      assetId: v.string(),
      event: v.string(),
      actorId: v.principal(),
      actorKind: v.string(),
      provider: v.string(),
      sessionId: v.optional(v.string()),
    })
      .visibility({ kind: 'public-read' })
      .sync(),
    notes: defineTable({
      workspaceId: v.id('workspaces'),
      authorId: v.principal(),
      body: v.string(),
      photo: v.optional(v.assetRef({ upload: 'photoUpload' })),
    })
      .index('by_workspace', ['workspaceId'])
      .visibility({
        kind: 'membership',
        declaration: workspaceMembers,
        resourceField: 'workspaceId',
        roles: ['owner', 'member'],
      })
      .assetSharing({ kind: 'membership', membership: 'workspaceMembers' })
      .sync(),
    photos: defineTable({
      ownerId: v.principal(),
      caption: v.string(),
      image: v.optional(v.assetRef({ upload: 'photoUpload' })),
    })
      .visibility({ kind: 'owner', field: 'ownerId' })
      .assetSharing({ kind: 'owner', field: 'ownerId' })
      .sync(),
    mixedDocs: defineTable({
      ownerId: v.principal(),
      title: v.string(),
      attachment: v.optional(v.assetRef({ upload: 'photoUpload' })),
    })
      .visibility({ kind: 'owner', field: 'ownerId' })
      .sync(),
    openDocs: defineTable({
      ownerId: v.principal(),
      title: v.string(),
      attachment: v.optional(v.assetRef({ upload: null })),
    })
      .visibility({ kind: 'owner', field: 'ownerId' })
      .sync(),
  },
  { auth: { mode: 'sessions' } },
);
