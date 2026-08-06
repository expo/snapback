import {
  allow,
  defineEphemeral,
  defineSchema,
  defineTable,
  ephemeral,
  v,
} from '../../../_kit/define.mjs';

export default defineSchema({
  users: defineTable({
    handle: v.string(),
    name: v.string(),
    color: v.string(),
  })
    .index('by_handle', ['handle'], { unique: true })
    .sync(),

  conversations: defineTable({
    kind: v.string(),
    title: v.string(),
    updatedAt: v.integer(),
    lastPreview: v.string(),
  })
    .index('by_updated', ['updatedAt'])
    .sync(),

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
    // @ref LLP 0044#asset-read-authorization — messages are public only in
    // this explicitly labeled test-persona demo; production would derive
    // byte-read authority from conversation membership.
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
}, {
  // @ref LLP 0013#summary — typing is lossy TTL state, not durable chat data.
  ephemeral: defineEphemeral({
    typing: ephemeral.collection({
      scope: { conversationId: v.string() },
      routing: ['conversationId'],
      key: 'connection',
      ttlMs: 4_000,
      maxTtlMs: 8_000,
      maxValueBytes: 512,
      publishRate: { sustainedHz: 4, burst: 8 },
      delivery: { mode: 'latest', dispatchMs: 80 },
      value: v.object({
        userId: v.string(),
        name: v.string(),
      }),
      publish: allow.all(),
      subscribe: allow.all(),
    }),
  }),
});
