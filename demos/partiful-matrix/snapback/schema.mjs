import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema({
  events: defineTable({
    title: v.string(), emoji: v.string(), description: v.string(), location: v.string(),
    startsAt: v.integer(), hostId: v.principal(), hostName: v.string(), accent: v.string(),
  }).sync(),
  rsvps: defineTable({
    eventId: v.id('events'), userId: v.principal(), guestName: v.string(), status: v.string(),
  })
    .index('by_event', ['eventId'])
    .index('by_event_user', ['eventId', 'userId'], { unique: true })
    .sync(),
  posts: defineTable({
    eventId: v.id('events'), authorId: v.principal(), authorName: v.string(),
    message: v.string(), createdAt: v.integer(),
  })
    .index('by_event', ['eventId'])
    .sync(),
});
