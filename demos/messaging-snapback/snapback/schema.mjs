// Snapback Messenger — schema.
//
// Eight durable tables (users, conversations, conversationMembers,
// conversationMemberships, messages, reactions, viewOnceMessages,
// viewOnceConsumptions) plus one ephemeral collection (typing). The interactive
// surface uses dev-mode client-asserted personas, the same trade-off Warble
// documents. The view-once handlers are deliberately different: they derive
// principals from auth and are witnessed by the acceptance suite's Sessions-
// mode copy of this backend.

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
  // This copy is presentation state only. Authorization always consults the
  // private conversationMemberships declaration below.
  role: v.string(),
  joinedAt: v.integer(),
})
  .visibility({ kind: 'public-read' })
  .index('by_conversation', ['conversationId'])
  .index('by_user', ['userHandle'])
  .index('by_conversation_user', ['conversationId', 'userHandle'], { unique: true });

export const conversationMemberships = defineTable({
  conversationId: v.id('conversations'),
  userHandle: v.principal(),
  role: v.string(),
  // The generated bootstrap owns the creator seat and therefore cannot take
  // app-authored incidental fields for it; initial roster seats still stamp it.
  joinedAt: v.optional(v.integer()),
})
  .visibility({ kind: 'owner', field: 'userHandle' })
  .index('by_conversation', ['conversationId'])
  .index('by_user', ['userHandle'])
  .index('by_conversation_user', ['conversationId', 'userHandle'], { unique: true })
  // @ref LLP 0056#declaring-a-membership-table — typing authority is one
  // canonical current principal/resource/role row, never a historical flag.
  .membership({
    id: 'conversationMemberships',
    principal: 'userHandle',
    resource: 'conversationId',
    role: 'role',
    roles: ['owner', 'moderator', 'member'],
    bootstrapRole: 'owner',
    lastHolder: { protect: 'owner' },
    provenance: 'full',
    transitions: [
      { op: 'insert', by: ['owner'], target: 'other', to: ['member'], fields: ['joinedAt'] },
      { op: 'setRole', by: ['owner'], target: 'other', from: ['member'], to: ['moderator'] },
      { op: 'remove', by: ['owner'], target: 'other', from: ['moderator', 'member'] },
      { op: 'remove', by: ['self'], target: 'self', from: ['moderator', 'member'] },
    ],
  })
  // Today's principal-addressed changeRole/remove commands require a local
  // authority profile. Its generated writers are not projection-aware, so
  // application clients must use the synchronized mutations in functions.mjs;
  // the acceptance drift check makes that interim obligation reviewable.
  // @ref LLP 0240#authority-facts-versus-product-facts
  // — option 1 remains the sanctioned interim, not the final generated design.
  .authorityProfile({
    name: 'conversationMemberships',
    hierarchy: {
      owner: ['moderator', 'member'],
      moderator: ['member'],
      member: [],
    },
    roster: { visible: ['userHandle', 'role'] },
  });

export const messages = defineTable({
  conversationId: v.id('conversations'),
  authorHandle: v.string(),
  authorName: v.string(),
  body: v.string(),
  image: v.optional(v.assetRef({ upload: 'messageImageUpload' })),
  replyToId: v.optional(v.id('messages')),
  // Frozen product history. The roster projection determines this set only
  // inside sendMessage; later membership transitions never rewrite it.
  recipientSnapshot: v.optional(v.json()),
  deliveredBy: v.optional(v.json()),
  readBy: v.optional(v.json()),
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
  conversationMemberships,
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
      scope: { conversationId: v.id('conversations') },
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
      // @ref LLP 0013#authorization-and-privacy — both operations bind to one
      // durable membership declaration so removal revokes the whole room edge.
      publish: allow.members('conversationMemberships'),
      subscribe: allow.members('conversationMemberships'),
    }),
  }),
});
