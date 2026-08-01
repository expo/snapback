import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Clip Locker — Convex arm. The file id is an ordinary field on the row
// (their model: storage is a side table you reference by id).
export default defineSchema({
  clips: defineTable({
    title: v.string(),
    storageId: v.id("_storage"),
    ownerId: v.string(),
  }),
});
