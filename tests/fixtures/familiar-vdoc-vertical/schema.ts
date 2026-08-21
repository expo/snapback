import { defineSchema, defineTable, v } from "./generated/server";

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
  }).visibility({ kind: "public-read" }),
});
