import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

// @ref LLP 0239#d1-vmedia-is-the-zero-or-one-application-field
// @ref LLP 0244#d3-vmedia-attachment-is-finalized-only-in-v1
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
  .visibility({ kind: 'public-read' })
  .assetSharing({ kind: 'owner', field: 'ownerId' })
  .sync();

// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation
export const posts = defineTable({
  ownerId: v.principal(),
  body: v.string(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .assetSharing({ kind: 'owner', field: 'ownerId' })
  .sync();

export const messages = defineTable({
  ownerId: v.principal(),
  conversationId: v.string(),
  text: v.string(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .assetSharing({ kind: 'owner', field: 'ownerId' })
  .sync();

export default defineSchema({ profiles, posts, messages });
