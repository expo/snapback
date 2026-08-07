import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    handle: v.string(),
    color: v.string(),
    emoji: v.string(),
  }).index("by_handle", ["handle"]),

  conversations: defineTable({
    kind: v.union(v.literal("dm"), v.literal("group")),
    name: v.optional(v.string()), // group name; DMs derive from members
    emoji: v.optional(v.string()),
  }),

  memberships: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_user", ["userId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    authorId: v.id("users"),
    kind: v.union(v.literal("text"), v.literal("image")),
    text: v.optional(v.string()), // body for text, caption for image
    imageStorageId: v.optional(v.id("_storage")),
    replyToId: v.optional(v.id("messages")), // reply pointer, no threads
  }).index("by_conversation", ["conversationId"]),

  reactions: defineTable({
    messageId: v.id("messages"),
    userId: v.id("users"),
    emoji: v.string(),
  })
    .index("by_message", ["messageId"])
    .index("by_message_user_emoji", ["messageId", "userId", "emoji"]),

  typing: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_user", ["conversationId", "userId"]),
});
