import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export const profiles = defineTable({
  handle: v.string(),
  displayName: v.string(),
  bio: v.string(),
  avatarUrl: v.string(),
  verified: v.boolean(),
  followers: v.integer(),
}).visibility({ kind: 'public-read' }).index('by_handle', ['handle'], { unique: true });

export const posts = defineTable({
  authorHandle: v.string(),
  body: v.string(),
  createdAt: v.integer(),
  replyToId: v.optional(v.id('posts')),
  likeCount: v.integer(),
  replyCount: v.integer(),
}).visibility({ kind: 'public-read' })
  .index('by_created', ['createdAt']).index('by_author_created', ['authorHandle', 'createdAt']);

export const likes = defineTable({
  postId: v.id('posts'),
  userHandle: v.string(),
}).visibility({ kind: 'public-read' })
  .index('by_post_user', ['postId', 'userHandle'], { unique: true });

export default defineSchema({ profiles, posts, likes });
