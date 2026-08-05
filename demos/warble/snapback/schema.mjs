// Warble — a small local-first microblog (Twitter-shaped) demo.
//
// @ref LLP 0090#authorization-scope-v1 — every table the offline timeline renders from
//   is denormalized flat, because cold retention is derived only for
//   single-table declarative live-query plans. An author join would be correct
//   modeling and would silently cost the whole offline story.

import { defineSchema, defineTable, v } from '../../_kit/define.mjs';

export default defineSchema({
  posts: defineTable({
    // `feed` is a constant partition ('home') so the timeline plan has an
    // index-first equality filter over a literal, which stays authority-free.
    feed: v.string(),
    // Author identity is denormalized: the retainable plan is single-table, so
    // there is nothing to join against while offline.
    authorHandle: v.string(),
    authorName: v.string(),
    body: v.string(),
    likeCount: v.integer(),
    // App-owned sort key. Server-owned _createdAt is not indexable, and the
    // offline outbox mints this through the deterministic ctx ledger so a
    // replayed post keeps the timestamp the UI already rendered.
    createdAt: v.integer(),
  })
    .index('by_feed', ['feed', 'createdAt'])
    .index('by_author', ['authorHandle', 'createdAt'])
    .sync(),

  likes: defineTable({
    postId: v.string(),
    userHandle: v.string(),
  })
    .index('by_user', ['userHandle'])
    // Structural one-like-per-user-per-post, rather than scanning in a handler.
    .index('by_post_user', ['postId', 'userHandle'], { unique: true })
    .sync(),

  profiles: defineTable({
    handle: v.string(),
    displayName: v.string(),
    bio: v.string(),
  })
    .index('by_handle', ['handle'], { unique: true })
    .sync(),
});
