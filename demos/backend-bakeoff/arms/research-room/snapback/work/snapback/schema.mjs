// LLP 0102 Research Room: authoritative room membership, deterministic
// source metadata, streamed answer progress, citations, and refresh ledger.
//
// @ref LLP 0056#declaring-a-membership-table — room membership is private
// authorization backing and every protected path checks the declaration.
// @ref LLP 0076#settlement-and-retry — answer rows mirror the host-owned
// streamed-attempt winner and durable effect-certainty fact.

import { defineSchema, defineTable, v } from '../../../../../../_kit/define.mjs';

export const roomMembers = defineTable({
  roomId: v.id('rooms'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'roomMembers',
  principal: 'userId',
  resource: 'roomId',
  role: 'role',
  roles: ['owner', 'member'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['owner'], target: 'other', to: ['member'] },
  ],
});

export default defineSchema({
  rooms: defineTable({
    slug: v.string(),
    name: v.string(),
    createdBy: v.principal(),
    createdAt: v.integer(),
  })
    .index('by_slug', ['slug'], { unique: true })
    .sync(),
  roomMembers,
  roomViews: defineTable({
    roomId: v.id('rooms'),
    userId: v.principal(),
  })
    .index('by_user_room', ['userId', 'roomId'], { unique: true })
    .sync(),
  sources: defineTable({
    roomId: v.id('rooms'),
    slug: v.string(),
    title: v.string(),
    ownerId: v.principal(),
    mediaType: v.string(),
    byteSize: v.integer(),
    sha256: v.string(),
    keywordText: v.string(),
    embeddingJson: v.string(),
    refreshedAt: v.integer(),
  })
    .index('by_room_slug', ['roomId', 'slug'], { unique: true })
    .index('by_room', ['roomId'])
    .sync(),
  questions: defineTable({
    roomId: v.id('rooms'),
    askedBy: v.principal(),
    prompt: v.string(),
    idempotencyKey: v.string(),
    attemptId: v.string(),
    createdAt: v.integer(),
  })
    .index('by_room_idempotency', ['roomId', 'idempotencyKey'], { unique: true })
    .index('by_room', ['roomId'])
    .sync(),
  answers: defineTable({
    roomId: v.id('rooms'),
    questionId: v.id('questions'),
    attemptId: v.string(),
    content: v.string(),
    status: v.string(),
    sequence: v.integer(),
    citationsJson: v.string(),
    effectMayHaveExecuted: v.optional(v.boolean()),
    updatedAt: v.integer(),
  })
    .index('by_question', ['questionId'], { unique: true })
    .index('by_attempt', ['attemptId'], { unique: true })
    .index('by_room', ['roomId'])
    .sync(),
  progressEvents: defineTable({
    roomId: v.id('rooms'),
    answerId: v.id('answers'),
    sequence: v.integer(),
    delta: v.string(),
    recordedAt: v.integer(),
  })
    .index('by_answer_sequence', ['answerId', 'sequence'], { unique: true })
    .index('by_room', ['roomId'])
    .sync(),
  refreshRuns: defineTable({
    slotKey: v.string(),
    sourceSlug: v.string(),
    status: v.string(),
    fetchedRevision: v.string(),
    recordedAt: v.integer(),
  })
    .index('by_slot', ['slotKey'], { unique: true })
    .sync(),
}, {
  auth: { mode: 'sessions' },
});
