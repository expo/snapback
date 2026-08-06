import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  users: defineTable({
    handle: v.string(),
    name: v.string(),
    color: v.string(),
  }).index('by_handle', ['handle']),

  conversations: defineTable({
    kind: v.union(v.literal('dm'), v.literal('group')),
    title: v.string(),
    updatedAt: v.number(),
    lastPreview: v.string(),
  }).index('by_updated', ['updatedAt']),

  memberships: defineTable({
    conversationId: v.id('conversations'),
    userId: v.id('users'),
  })
    .index('by_user', ['userId'])
    .index('by_conversation', ['conversationId'])
    .index('by_conversation_user', ['conversationId', 'userId']),

  messages: defineTable({
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    kind: v.union(v.literal('text'), v.literal('image')),
    text: v.optional(v.string()),
    imageStorageId: v.optional(v.id('_storage')),
    replyToId: v.optional(v.id('messages')),
    sentAt: v.number(),
  }).index('by_conversation_sent', ['conversationId', 'sentAt']),

  reactions: defineTable({
    conversationId: v.id('conversations'),
    messageId: v.id('messages'),
    userId: v.id('users'),
    emoji: v.string(),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_message_user_emoji', ['messageId', 'userId', 'emoji']),

  typing: defineTable({
    conversationId: v.id('conversations'),
    userId: v.id('users'),
    name: v.string(),
    expiresAt: v.number(),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_conversation_user', ['conversationId', 'userId']),

  seedMarkers: defineTable({ key: v.string() }).index('by_key', ['key']),
});
