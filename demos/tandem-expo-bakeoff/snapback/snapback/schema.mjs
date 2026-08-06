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
    displayName: v.string(),
    handle: v.string(),
    color: v.string(),
  })
    .index('by_handle', ['handle'], { unique: true })
    .sync(),

  conversations: defineTable({
    title: v.optional(v.string()),
    isGroup: v.boolean(),
    accent: v.string(),
  }).sync(),

  conversationMembers: defineTable({
    conversationId: v.id('conversations'),
    userId: v.id('users'),
    lastReadAt: v.integer(),
  })
    .index('by_user', ['userId'])
    .index('by_conversation', ['conversationId'])
    .index('by_conversation_user', ['conversationId', 'userId'], { unique: true })
    .sync(),

  // @ref LLP 0044#typed-references-and-atomic-attachment — the owning row
  // carries the verified reference and the reverse edge commits with it.
  messages: defineTable({
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    text: v.string(),
    image: v.optional(v.assetRef({ upload: 'messageImageUpload' })),
    seedImageUrl: v.optional(v.string()),
    replyToId: v.optional(v.id('messages')),
    createdAt: v.integer(),
  })
    .index('by_conversation_created', ['conversationId', 'createdAt'])
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
    .index('by_message_user', ['messageId', 'userId'], { unique: true })
    .sync(),
}, {
  auth: { mode: 'sessions' },
  // @ref LLP 0013#proposal — typing is a scoped, TTL-bound latest-state room,
  // not a durable message-row side channel.
  ephemeral: defineEphemeral({
    typing: ephemeral.collection({
      scope: { conversationId: v.id('conversations') },
      routing: ['conversationId'],
      key: 'connection',
      ttlMs: 4_000,
      maxTtlMs: 10_000,
      maxValueBytes: 512,
      publishRate: { sustainedHz: 4, burst: 12 },
      delivery: { mode: 'latest', dispatchMs: 80 },
      value: v.object({
        userId: v.id('users'),
        name: v.string(),
        color: v.string(),
      }),
      publish: allow.all(),
      subscribe: allow.all(),
    }),
  }),
});
