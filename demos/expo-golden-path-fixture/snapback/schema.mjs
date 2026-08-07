import { defineEphemeral, defineSchema, defineTable, v } from '../../_kit/define.mjs';
import { typing } from './surface-model.mjs';

export default defineSchema(
  {
    receiptNotes: defineTable({
      text: v.string(),
      source: v.string(),
    }).index('by_source', ['source']).sync(),
    users: defineTable({
      handle: v.string(),
      name: v.string(),
      color: v.string(),
    }).index('by_handle', ['handle'], { unique: true }).sync(),
    conversations: defineTable({
      kind: v.string(),
      title: v.string(),
      updatedAt: v.integer(),
      lastPreview: v.string(),
    }).index('by_updated', ['updatedAt']).sync(),
    memberships: defineTable({
      conversationId: v.id('conversations'),
      userId: v.id('users'),
    })
      .index('by_user', ['userId'])
      .index('by_conversation', ['conversationId'])
      .index('by_conversation_user', ['conversationId', 'userId'], { unique: true })
      .sync(),
    messages: defineTable({
      conversationId: v.id('conversations'),
      senderId: v.id('users'),
      kind: v.string(),
      text: v.optional(v.string()),
      image: v.optional(v.assetRef({ upload: 'messageImageUpload' })),
      replyToId: v.optional(v.id('messages')),
      sentAt: v.integer(),
    })
      .index('by_conversation_sent', ['conversationId', 'sentAt'])
      // @ref LLP 0044#asset-read-authorization — this test-persona fixture is
      // intentionally public-read; production chat derives byte authority
      // from admitted conversation membership.
      .assetSharing({ kind: 'public-read' })
      .sync(),
    reactions: defineTable({
      conversationId: v.id('conversations'),
      messageId: v.id('messages'),
      userId: v.id('users'),
      emoji: v.string(),
    })
      .index('by_conversation', ['conversationId'])
      .index('by_message', ['messageId'])
      .index('by_message_user_emoji', ['messageId', 'userId', 'emoji'], { unique: true })
      .sync(),
  },
  {
    auth: { mode: 'sessions' },
    ephemeral: defineEphemeral({ typing }),
  },
);
