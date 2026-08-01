import {
  allow,
  defineEphemeral,
  defineSchema,
  defineTable,
  ephemeral,
  v,
} from '@expo/snapback-codegen/define';

// LLP 0137 A4 event and invitation application (contract
// a4-event-invitation.v1). Sessions mode. The event is seeded literally
// (versioned seed); host/cohost/guest seats are claimed through seeded
// invite rows via the documented app-data-invitation self-insert pattern
// (the only authority-creating mutation names the by:['none'] transition).
// Membership rows cannot be seeded and are not reset targets
// (known: finding 0137-a3-f1) — cleanup retires seats by self-removal.
export const eventMembers = defineTable({
  eventId: v.id('events'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'eventMembers',
  principal: 'userId',
  resource: 'eventId',
  role: 'role',
  roles: ['host', 'cohost', 'guest'],
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['none'], target: 'self', to: ['host', 'cohost', 'guest'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['host', 'cohost', 'guest'] },
  ],
});

const schema = defineSchema({
  events: defineTable({
    slug: v.string(), // public deep-link identity
    title: v.string(),
    startsAt: v.integer(),
    city: v.string(),
    blurb: v.string(),
    // Private host-side facts: excluded from the anonymous preview.
    privateAddress: v.string(), // visible to seated guests, never anonymously
    hostNotes: v.string(), // host/cohost only
    capacity: v.integer(), // total seats (guests + plus-ones)
    plusOneLimit: v.integer(), // per-RSVP plus-one ceiling
    wallSeq: v.integer(), // transactional wall-post sequence counter
    // Plain-string flyer asset id: a v.assetRef field would make this table
    // unqueryable on 0.1.7 (known: finding 0137-a1-f1), so the queryable row
    // carries the canonical asset id as a string. '' = no flyer.
    flyerAssetId: v.string(),
  })
    .index('by_slug', ['slug'], { unique: true })
    .sync(),

  invites: defineTable({
    eventId: v.id('events'),
    code: v.string(),
    role: v.string(), // 'cohost' | 'guest'
    invitedByName: v.string(),
    consumed: v.boolean(),
    createdAt: v.integer(),
  })
    .index('by_code', ['code'], { unique: true })
    .index('by_event', ['eventId'])
    .sync(),

  rsvps: defineTable({
    eventId: v.id('events'),
    userId: v.principal(),
    name: v.string(),
    status: v.string(), // 'invited' | 'going' | 'maybe' | 'declined'
    plusOnes: v.integer(),
    // Invitation attribution: how this guest entered.
    inviteCode: v.string(), // '' for seeded fixture guests
    invitedByName: v.string(),
    enteredVia: v.string(), // 'deep-link' | 'seed'
    createdAt: v.integer(),
    updatedAt: v.integer(),
  })
    .index('by_event_user', ['eventId', 'userId'], { unique: true })
    .index('by_event', ['eventId'])
    .sync(),

  wallPosts: defineTable({
    eventId: v.id('events'),
    authorId: v.optional(v.principal()),
    authorName: v.string(),
    body: v.string(),
    seq: v.integer(),
    clientKey: v.string(),
    createdAt: v.integer(),
  })
    .index('by_event_seq', ['eventId', 'seq'], { unique: true })
    .index('by_event_client_key', ['eventId', 'clientKey'], { unique: true })
    .sync(),

  reminders: defineTable({
    eventId: v.id('events'),
    kind: v.string(), // 'day-before'
    remindAt: v.integer(),
    note: v.string(),
  })
    .index('by_event', ['eventId'])
    .sync(),

  reminderDeliveries: defineTable({
    eventId: v.id('events'),
    reminderId: v.id('reminders'),
    dedupeKey: v.string(),
    kind: v.string(),
    recipients: v.integer(),
    deliveredAt: v.integer(),
  })
    .index('by_dedupe', ['dedupeKey'], { unique: true })
    .index('by_event', ['eventId'])
    .sync(),

  // External-notification effect ledger: one intent, append-only attempts.
  notifyIntents: defineTable({
    eventId: v.id('events'),
    dedupeKey: v.string(),
    body: v.string(),
    state: v.string(), // 'pending' | 'sent' | 'ambiguous' | 'failed'
    receiptId: v.string(), // provider receipt when sent; '' otherwise
    attemptCount: v.integer(),
    createdAt: v.integer(),
    settledAt: v.integer(), // 0 until terminal
  })
    .index('by_event_dedupe', ['eventId', 'dedupeKey'], { unique: true })
    .index('by_event', ['eventId'])
    .sync(),

  notifyAttempts: defineTable({
    intentId: v.id('notifyIntents'),
    eventId: v.id('events'),
    attemptSeq: v.integer(),
    outcome: v.string(), // 'sent' | 'failed' | 'ambiguous'
    providerStatus: v.integer(), // HTTP status; 0 when no response arrived
    detail: v.string(),
    at: v.integer(),
  })
    .index('by_intent_seq', ['intentId', 'attemptSeq'], { unique: true })
    .index('by_event', ['eventId'])
    .sync(),

  // Side table for the a1-f2 re-verification probe only: a v.assetRef field
  // makes a table unqueryable (0137-a1-f1), so no query returns this table
  // and the app's queryable flyer reference is events.flyerAssetId above.
  eventFlyers: defineTable({
    eventId: v.id('events'),
    image: v.assetRef(),
  })
    .assetSharing({ kind: 'membership', membership: 'eventMembers' })
    .sync(),

  eventMembers,
}, {
  auth: { mode: 'sessions' },
  ephemeral: defineEphemeral({
    eventPresence: ephemeral.collection({
      scope: { eventId: v.string() },
      routing: ['eventId'],
      key: 'connection',
      ttlMs: 10_000,
      maxTtlMs: 30_000,
      maxValueBytes: 256,
      publishRate: { sustainedHz: 5, burst: 10 },
      delivery: { mode: 'latest', dispatchMs: 33 },
      value: v.object({ name: v.string() }),
      publish: allow.all(),
      subscribe: allow.all(),
    }),
  }),
});

export default schema;
