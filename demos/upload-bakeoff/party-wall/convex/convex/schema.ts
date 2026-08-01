import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Union schema: App A's tables preserved (deploys replace the deployment's
// schema+functions wholesale — the disclosed shared-target caveat), plus
// App B's ub_b_* namespace.
export default defineSchema({
  ub_a_profiles: defineTable({
    handle: v.string(),
    displayName: v.string(),
    avatar: v.optional(v.id("_storage")),
  }).index("by_handle", ["handle"]),
  ub_b_events: defineTable({
    title: v.string(),
    host: v.string(),
  }),
  ub_b_members: defineTable({
    eventId: v.id("ub_b_events"),
    member: v.string(),
  }).index("by_event", ["eventId"]),
  ub_b_photos: defineTable({
    eventId: v.id("ub_b_events"),
    caption: v.string(),
    author: v.string(),
    storageId: v.id("_storage"),
  }).index("by_event", ["eventId"]),
});
