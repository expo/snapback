import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  workouts: defineTable({
    title: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_startedAt", ["startedAt"]),
  sets: defineTable({
    workoutId: v.id("workouts"),
    exercise: v.string(),
    reps: v.number(),
    weightKgX10: v.number(),
    completed: v.boolean(),
    at: v.number(),
  }).index("by_workoutId", ["workoutId"]).index("by_at", ["at"]),
});
