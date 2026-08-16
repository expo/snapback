// Snapback Messenger — schema.
//
// Seven durable tables (users, conversations, conversationMembers, messages,
// reactions, viewOnceMessages, viewOnceConsumptions) plus one ephemeral
// collection (typing). The interactive surface uses dev-mode client-asserted
// personas, the same trade-off Warble documents. The view-once handlers are
// deliberately different: they derive principals from auth and are witnessed
// by the acceptance suite's Sessions-mode copy of this backend.

import {
  allow,
  defineEphemeral,
  defineSchema,
  defineTable,
  ephemeral,
  v,
} from '@expo/snapback-codegen/define';

export const users = defineTable({
  handle: v.string(),
  name: v.string(),
  avatarEmoji: v.string(),
  avatarColor: v.string(),
}).visibility({ kind: 'public-read' }).index('by_handle', ['handle'], { unique: true });

export const conversations = defineTable({
  kind: v.string(), // 'dm' | 'group'
  title: v.string(), // group display title; empty string for a dm
  // Table fields have no array node — v.array() is result-contract-only.
  // Stored as v.json() (a string[] by convention) and re-validated as
  // v.array(v.string()) on the way out through conversationSummary.
  memberHandles: v.json(),
  // Denormalized preview fields so the conversation list is a single-table
  // scan ordered by recency — no per-row join into `messages` needed to
  // render the list (mirrors the todo/signal-desk `updatedAt` pattern).
  lastMessageText: v.string(),
  lastMessageAuthorName: v.string(),
  lastMessageAt: v.integer(),
  createdAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_updated', ['lastMessageAt']);

export const conversationMembers = defineTable({
  conversationId: v.id('conversations'),
  userHandle: v.string(),
  joinedAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_conversation', ['conversationId'])
  .index('by_user', ['userHandle'])
  .index('by_conversation_user', ['conversationId', 'userHandle'], { unique: true });

export const messages = defineTable({
  conversationId: v.id('conversations'),
  authorHandle: v.string(),
  authorName: v.string(),
  body: v.string(),
  image: v.optional(v.assetRef({ upload: 'messageImageUpload' })),
  replyToId: v.optional(v.id('messages')),
  createdAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_conversation', ['conversationId', 'createdAt'])
  // Demo-scoped sharing: any signed-in persona may view any message image.
  // A production app would gate this by conversation membership instead.
  .assetSharing({ kind: 'public-read' });

export const reactions = defineTable({
  messageId: v.id('messages'),
  userHandle: v.string(),
  emoji: v.string(),
  createdAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_message', ['messageId'])
  // One reaction per (message, user, emoji) — structural dedup instead of a
  // handler scan, same trick as Warble's likes table.
  .index('by_message_user_emoji', ['messageId', 'userHandle', 'emoji'], { unique: true });

export const viewOnceMessages = defineTable({
  conversationId: v.id('conversations'),
  authorPrincipal: v.string(),
  // This typed reverse reference, not the pending grants, protects the asset
  // from reference GC until every recipient has had a chance to open it.
  asset: v.assetRef({ upload: 'viewOnceImageUpload' }),
  // OWNER-VISIBLE liveness bookkeeping: recipient principal -> live grantId.
  grants: v.json(),
  caption: v.string(),
  createdAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_conversation', ['conversationId']);

export const viewOnceConsumptions = defineTable({
  viewOnceMessageId: v.id('viewOnceMessages'),
  principal: v.string(),
  openedAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  // Product state, not asset state: this is what makes a second logical open
  // refuse even while the first activation remains live.
  .index('by_message_principal', ['viewOnceMessageId', 'principal'], { unique: true });

export default defineSchema({
  users,
  conversations,
  conversationMembers,
  messages,
  reactions,
  viewOnceMessages,
  viewOnceConsumptions,
}, {
  ephemeral: defineEphemeral({
    // "X is typing…" — connection-keyed so a departing tab clears itself,
    // scoped per conversation so a busy inbox never fans typing state into
    // conversations nobody is viewing.
    typing: ephemeral.collection({
      scope: { conversationId: v.string() },
      routing: ['conversationId'],
      key: 'connection',
      ttlMs: 6_000,
      maxTtlMs: 15_000,
      maxValueBytes: 256,
      publishRate: { sustainedHz: 5, burst: 10 },
      delivery: { mode: 'latest', dispatchMs: 100 },
      value: v.object({
        userHandle: v.string(),
        name: v.string(),
      }),
      publish: allow.all(),
      subscribe: allow.all(),
    }),
  }),
});
