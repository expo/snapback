import { defineSchema, defineTable, v } from "./generated/server";

export default defineSchema({
  // @ref LLP 0234#phase-g2--d2-enforcing-closure — this dual-profile fixture's
  // public operations share synthetic rows, so every todo is public by design.
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
  }).visibility({ kind: "public-read" }).index("by_completed", ["completed"]),
});
