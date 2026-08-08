import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const entries = defineTable({
  ownerId: v.principal(),
  authorName: v.string(),
  caption: v.string(),
  photo: v.optional(v.assetRef({ upload: 'feedPhotoUpload' })),
  createdAt: v.integer(),
})
  .index('by_created', ['createdAt'])
  // Public immutable delivery and public-read references are a deliberate
  // feed choice. Private media should use the strict intent instead.
  .assetSharing({ kind: 'public-read' })
  .sync();

export default defineSchema({ entries }, { auth: { mode: 'sessions' } });
