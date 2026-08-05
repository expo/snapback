import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    avatarColor: v.string(), // hex color used for avatar background
    avatarEmoji: v.string(), // emoji shown as avatar
  }).index("by_name", ["name"]),

  conversations: defineTable({
    kind: v.union(v.literal("dm"), v.literal("group")),
    title: v.optional(v.string()), // group name, unused for dm
    lastMessageAt: v.number(),
  }).index("by_lastMessageAt", ["lastMessageAt"]),

  conversationMembers: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_user", ["userId"])
    .index("by_conversation_and_user", ["conversationId", "userId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    authorId: v.id("users"),
    text: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    replyToId: v.optional(v.id("messages")),
  }).index("by_conversation", ["conversationId"]),

  reactions: defineTable({
    messageId: v.id("messages"),
    userId: v.id("users"),
    emoji: v.string(),
  })
    .index("by_message", ["messageId"])
    .index("by_message_and_user_and_emoji", ["messageId", "userId", "emoji"]),

  typingIndicators: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    updatedAt: v.number(),
  }).index("by_conversation_and_user", ["conversationId", "userId"]),
});
