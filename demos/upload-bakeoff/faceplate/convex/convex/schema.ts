import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ub_a_profiles: defineTable({
    handle: v.string(),
    displayName: v.string(),
    avatar: v.optional(v.id("_storage")),
  }).index("by_handle", ["handle"]),
});
