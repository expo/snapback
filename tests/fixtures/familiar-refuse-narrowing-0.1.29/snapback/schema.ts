import { defineSchema, defineTable, v } from "./generated/server";

export default defineSchema({
  posts: defineTable({
    body: v.string(),
  }).visibility({ kind: "public-read" }),
});
