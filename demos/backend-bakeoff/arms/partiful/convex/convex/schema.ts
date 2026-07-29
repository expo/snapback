import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  personas: defineTable({
    namespace: v.string(),
    identity: v.string(),
    name: v.string(),
  })
    .index('by_namespace', ['namespace'])
    .index('by_namespace_identity', ['namespace', 'identity'])
    .index('by_namespace_name', ['namespace', 'name']),
  events: defineTable({
    namespace: v.string(),
    eventKey: v.string(),
    slug: v.string(),
    title: v.string(),
    publicDescription: v.string(),
    privateNotes: v.string(),
    startsAt: v.string(),
    venue: v.string(),
    capacity: v.number(),
    guestListVisible: v.boolean(),
    removed: v.boolean(),
    revision: v.number(),
  })
    .index('by_namespace', ['namespace'])
    .index('by_namespace_event', ['namespace', 'eventKey']),
  memberships: defineTable({
    namespace: v.string(),
    eventKey: v.string(),
    identity: v.string(),
    displayName: v.string(),
    role: v.union(v.literal('host'), v.literal('cohost'), v.literal('guest')),
    active: v.boolean(),
  })
    .index('by_namespace', ['namespace'])
    .index('by_namespace_event', ['namespace', 'eventKey'])
    .index('by_namespace_identity', ['namespace', 'identity'])
    .index('by_namespace_event_identity', ['namespace', 'eventKey', 'identity'])
    .index('by_namespace_event_name', ['namespace', 'eventKey', 'displayName']),
  rsvps: defineTable({
    namespace: v.string(),
    eventKey: v.string(),
    identity: v.string(),
    displayName: v.string(),
    status: v.union(v.literal('yes'), v.literal('no'), v.literal('maybe')),
    plusOne: v.number(),
    revision: v.number(),
  })
    .index('by_namespace', ['namespace'])
    .index('by_namespace_event', ['namespace', 'eventKey'])
    .index('by_namespace_event_identity', ['namespace', 'eventKey', 'identity']),
  wallPosts: defineTable({
    namespace: v.string(),
    eventKey: v.string(),
    postKey: v.string(),
    authorIdentity: v.string(),
    authorName: v.string(),
    body: v.string(),
  })
    .index('by_namespace', ['namespace'])
    .index('by_namespace_event', ['namespace', 'eventKey'])
    .index('by_namespace_post', ['namespace', 'postKey']),
  assets: defineTable({
    namespace: v.string(),
    eventKey: v.string(),
    assetKey: v.string(),
    storageId: v.id('_storage'),
    uploaderIdentity: v.string(),
    mimeType: v.string(),
    contentHash: v.string(),
    byteLength: v.number(),
  })
    .index('by_namespace', ['namespace'])
    .index('by_namespace_event', ['namespace', 'eventKey'])
    .index('by_namespace_asset', ['namespace', 'assetKey']),
  reminders: defineTable({
    namespace: v.string(),
    eventKey: v.string(),
    attemptKey: v.string(),
    scheduleId: v.string(),
    state: v.union(v.literal('scheduled'), v.literal('complete')),
    runCount: v.number(),
    actorIdentity: v.string(),
    endpoint: v.string(),
    completedAt: v.optional(v.number()),
  })
    .index('by_namespace', ['namespace'])
    .index('by_namespace_attempt', ['namespace', 'attemptKey']),
  notificationAttempts: defineTable({
    namespace: v.string(),
    eventKey: v.string(),
    dedupeKey: v.string(),
    kind: v.string(),
    state: v.union(
      v.literal('pending'),
      v.literal('succeeded'),
      v.literal('failed'),
      v.literal('ambiguous'),
    ),
    attempts: v.number(),
    providerStatus: v.string(),
  })
    .index('by_namespace', ['namespace'])
    .index('by_namespace_dedupe', ['namespace', 'dedupeKey']),
});
