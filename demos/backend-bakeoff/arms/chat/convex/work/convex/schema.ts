import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  profiles: defineTable({
    namespace: v.string(),
    subject: v.string(),
    name: v.string(),
  }).index("by_namespace_subject", ["namespace", "subject"]),

  channels: defineTable({
    namespace: v.string(),
    slug: v.string(),
    name: v.string(),
    visibility: v.union(v.literal("public"), v.literal("private")),
    nextSequence: v.number(),
  })
    .index("by_namespace", ["namespace"])
    .index("by_namespace_slug", ["namespace", "slug"]),

  memberships: defineTable({
    namespace: v.string(),
    channelId: v.id("channels"),
    subject: v.string(),
    role: v.union(v.literal("owner"), v.literal("member")),
    active: v.boolean(),
  })
    .index("by_channel_subject", ["channelId", "subject"])
    .index("by_namespace", ["namespace"]),

  messages: defineTable({
    namespace: v.string(),
    channelId: v.id("channels"),
    sequence: v.number(),
    authorSubject: v.string(),
    authorName: v.string(),
    body: v.string(),
    sentAt: v.number(),
  })
    .index("by_channel_sequence", ["channelId", "sequence"])
    .index("by_namespace", ["namespace"]),

  readMarkers: defineTable({
    namespace: v.string(),
    channelId: v.id("channels"),
    subject: v.string(),
    lastReadSequence: v.number(),
  })
    .index("by_channel_subject", ["channelId", "subject"])
    .index("by_namespace", ["namespace"]),

  typing: defineTable({
    namespace: v.string(),
    channelId: v.id("channels"),
    subject: v.string(),
    name: v.string(),
    expiresAt: v.number(),
  })
    .index("by_channel_subject", ["channelId", "subject"])
    .index("by_namespace", ["namespace"]),

  presence: defineTable({
    namespace: v.string(),
    channelId: v.id("channels"),
    subject: v.string(),
    name: v.string(),
    connectionId: v.string(),
    expiresAt: v.number(),
  })
    .index("by_channel_subject", ["channelId", "subject"])
    .index("by_namespace", ["namespace"]),
});
