import {
  allow,
  defineEphemeral,
  defineSchema,
  defineTable,
  ephemeral,
  v,
} from '@expo/snapback-codegen/define';

export default defineSchema(
  {
    users: defineTable({
      handle: v.string(),
      name: v.string(),
      email: v.string(),
      color: v.string(),
    })
      .index('by_handle', ['handle'], { unique: true })
      .sync(),

    conversations: defineTable({
      kind: v.string(), // 'dm' | 'group'
      title: v.string(),
      sortKey: v.number(),
    })
      .index('by_sort', ['sortKey'])
      .sync(),

    members: defineTable({
      conversationId: v.id('conversations'),
      handle: v.string(),
    })
      .index('by_conversation', ['conversationId'])
      .index('by_conversation_handle', ['conversationId', 'handle'], { unique: true })
      .sync(),

    messages: defineTable({
      conversationId: v.id('conversations'),
      senderHandle: v.string(),
      kind: v.string(), // 'text' | 'image'
      text: v.optional(v.string()),
      image: v.optional(v.assetRef({ upload: 'messageImageUpload' })),
      replyToId: v.optional(v.string()),
      sentAt: v.number(),
    })
      .index('by_conversation', ['conversationId', 'sentAt'])
      .assetSharing({ kind: 'public-read' })
      .sync(),

    reactions: defineTable({
      messageId: v.id('messages'),
      conversationId: v.id('conversations'),
      handle: v.string(),
      emoji: v.string(),
    })
      .index('by_conversation', ['conversationId'])
      .index('by_message_handle_emoji', ['messageId', 'handle', 'emoji'], { unique: true })
      .sync(),
  },
  {
    auth: { mode: 'sessions' },
    ephemeral: defineEphemeral({
      typing: ephemeral.collection({
        scope: { conversationId: v.string() },
        routing: ['conversationId'],
        key: 'connection',
        ttlMs: 4_000,
        maxTtlMs: 8_000,
        maxValueBytes: 256,
        value: v.object({
          handle: v.string(),
          name: v.string(),
        }),
        publish: allow.all(),
        subscribe: allow.all(),
      }),
    }),
  },
);
