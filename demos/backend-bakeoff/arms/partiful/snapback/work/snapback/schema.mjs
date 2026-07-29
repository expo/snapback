import { defineSchema, defineTable, v } from '@snapback/codegen/define';

export default defineSchema({
  events: defineTable({
    namespace: v.string(),
    slug: v.string(),
    hostId: v.principal(),
    title: v.string(),
    description: v.string(),
    location: v.string(),
    startsAt: v.integer(),
    capacity: v.integer(),
    attendanceCount: v.integer(),
    guestListVisibility: v.string(),
    publicActive: v.boolean(),
    revision: v.integer(),
  })
    .index('by_namespace_slug', ['namespace', 'slug'], { unique: true })
    .sync(),
  invitations: defineTable({
    namespace: v.string(),
    eventId: v.id('events'),
    userId: v.principal(),
    guestName: v.string(),
    role: v.string(),
    status: v.string(),
  })
    .index('by_event_user', ['eventId', 'userId'], { unique: true })
    .index('by_user', ['userId'])
    .index('by_event', ['eventId'])
    .sync(),
  rsvps: defineTable({
    namespace: v.string(),
    eventId: v.id('events'),
    userId: v.principal(),
    guestName: v.string(),
    response: v.string(),
    plusOneCount: v.integer(),
    seats: v.integer(),
    synthetic: v.boolean(),
  })
    .index('by_event_user', ['eventId', 'userId'], { unique: true })
    .index('by_event', ['eventId'])
    .sync(),
  posts: defineTable({
    namespace: v.string(),
    eventId: v.id('events'),
    authorId: v.principal(),
    authorName: v.string(),
    body: v.string(),
    ordinal: v.integer(),
  })
    .index('by_event_ordinal', ['eventId', 'ordinal'])
    .sync(),
  reminderAttempts: defineTable({
    namespace: v.string(),
    eventId: v.id('events'),
    deliveryKey: v.string(),
    trigger: v.string(),
    attemptCount: v.integer(),
    status: v.string(),
  })
    .index('by_delivery_key', ['deliveryKey'], { unique: true })
    .index('by_event', ['eventId'])
    .sync(),
  notificationEffects: defineTable({
    namespace: v.string(),
    eventId: v.id('events'),
    requestedBy: v.principal(),
    idempotencyKey: v.string(),
    attemptCount: v.integer(),
    status: v.string(),
    certainty: v.string(),
    providerReceipt: v.optional(v.string()),
  })
    .index('by_idempotency', ['idempotencyKey'], { unique: true })
    .index('by_event', ['eventId'])
    .sync(),
}, { auth: { mode: 'sessions' } });
