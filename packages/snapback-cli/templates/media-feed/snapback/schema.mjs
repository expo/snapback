import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const entries = defineTable({
  ownerId: v.principal(),
  authorName: v.string(),
  caption: v.string(),
  photo: v.optional(v.assetRef({ upload: 'feedPhotoUpload' })),
  pageKey: v.string(),
  createdAt: v.integer(),
})
  // @ref LLP 0234#phase-g2--d2-enforcing-closure — liveFeed/olderFeedPage are
  // anonymous global feeds, so every entry row is public by design. Private
  // feeds should use owner/membership visibility and the strict asset intent.
  .visibility({ kind: 'public-read' })
  // @ref LLP 0100#5-index-and-continuation-contract — the load-more boundary
  // is independently unique; equal display timestamps cannot skip a row.
  .index('by_page_key', ['pageKey'], { unique: true })
  .assetSharing({ kind: 'public-read' })
  .sync();

export default defineSchema({ entries }, { auth: { mode: 'sessions' } });
