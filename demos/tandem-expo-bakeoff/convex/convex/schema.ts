import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  users: defineTable({
    key: v.string(),
    displayName: v.string(),
    handle: v.string(),
    color: v.string(),
  }).index('by_key', ['key']),
  conversations: defineTable({
    key: v.string(),
    title: v.optional(v.string()),
    isGroup: v.boolean(),
    accent: v.string(),
  }).index('by_key', ['key']),
  conversationMembers: defineTable({
    key: v.string(),
    conversationKey: v.string(),
    userKey: v.string(),
    lastReadAt: v.number(),
  })
    .index('by_user', ['userKey'])
    .index('by_conversation', ['conversationKey'])
    .index('by_conversation_user', ['conversationKey', 'userKey']),
  messages: defineTable({
    key: v.string(),
    conversationKey: v.string(),
    senderKey: v.string(),
    text: v.string(),
    imageStorageId: v.optional(v.id('_storage')),
    seedImageUrl: v.optional(v.string()),
    replyToKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_conversation_created', ['conversationKey', 'createdAt']),
  reactions: defineTable({
    key: v.string(),
    conversationKey: v.string(),
    messageKey: v.string(),
    userKey: v.string(),
    emoji: v.string(),
  })
    .index('by_message', ['messageKey'])
    .index('by_message_user', ['messageKey', 'userKey']),
  typingIndicators: defineTable({
    conversationKey: v.string(),
    userKey: v.string(),
    name: v.string(),
    color: v.string(),
    nonce: v.string(),
    expiresAt: v.number(),
  })
    .index('by_conversation', ['conversationKey'])
    .index('by_conversation_user', ['conversationKey', 'userKey']),
});
