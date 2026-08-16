import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const profiles = defineTable({
  ownerId: v.principal(),
  displayName: v.string(),
  image: v.optional(v.media({
    intent: 'profileImageUpload',
    policy: 'profile-image.v1',
    kinds: ['image'],
    delivery: 'primary',
    variants: ['primary'],
  })),
})
  .index('by_owner', ['ownerId'])
  .visibility({ kind: 'owner', field: 'ownerId' })
  .assetSharing({ kind: 'owner', field: 'ownerId' })
  .sync();

export default defineSchema({ profiles });
