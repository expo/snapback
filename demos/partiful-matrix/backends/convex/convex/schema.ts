import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  events: defineTable({
    publicId: v.string(), title: v.string(), emoji: v.string(), description: v.string(),
    location: v.string(), startsAt: v.number(), hostId: v.string(), hostName: v.string(), accent: v.string(),
  }).index('by_public_id', ['publicId']),
  rsvps: defineTable({
    publicId: v.string(), eventId: v.string(), userId: v.string(), guestName: v.string(), status: v.string(),
  }).index('by_event', ['eventId']).index('by_event_user', ['eventId', 'userId']).index('by_public_id', ['publicId']),
  posts: defineTable({
    publicId: v.string(), eventId: v.string(), authorId: v.string(), authorName: v.string(), message: v.string(), createdAt: v.number(),
  }).index('by_event', ['eventId']).index('by_public_id', ['publicId']),
});
