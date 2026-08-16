import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

// @ref LLP 0239#d1-vmedia-is-the-zero-or-one-application-field — the avatar
// stays a typed finalized media reference instead of an application URL.
// @ref LLP 0244#d3-vmedia-attachment-is-finalized-only-in-v1 — handlers can
// store this field only through ctx.assets.attach after finalization.
export const profiles = defineTable({
  ownerId: v.principal(),
  displayName: v.string(),
  avatar: v.optional(v.media({
    intent: 'profileImageUpload',
    policy: 'profile-image.v1',
    kinds: ['image'],
    delivery: 'primary',
    variants: ['primary'],
  })),
})
  .index('by_owner', ['ownerId'], { unique: true })
  .visibility({ kind: 'owner', field: 'ownerId' })
  .assetSharing({ kind: 'owner', field: 'ownerId' })
  .sync();

// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation —
// post media lives in the generated collection table, not an opaque row array.
export const posts = defineTable({
  ownerId: v.principal(),
  body: v.string(),
})
  .visibility({ kind: 'owner', field: 'ownerId' })
  .assetSharing({ kind: 'owner', field: 'ownerId' })
  .sync();

export default defineSchema({ profiles, posts }, { auth: { mode: 'sessions' } });
