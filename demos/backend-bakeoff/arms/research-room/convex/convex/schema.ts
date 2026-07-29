import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  rooms: defineTable({
    slug: v.string(),
    title: v.string(),
  }).index("by_slug", ["slug"]),

  memberships: defineTable({
    roomId: v.id("rooms"),
    subject: v.string(),
    role: v.string(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_subject", ["roomId", "subject"]),

  sources: defineTable({
    roomId: v.id("rooms"),
    sourceKey: v.string(),
    title: v.string(),
    searchText: v.string(),
    ownerSubject: v.string(),
    contentHash: v.string(),
    byteLength: v.number(),
    embedding: v.array(v.float64()),
    storageId: v.optional(v.id("_storage")),
  })
    .index("by_room", ["roomId"])
    .index("by_room_key", ["roomId", "sourceKey"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["roomId"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 32,
      filterFields: ["roomId"],
    }),

  questions: defineTable({
    roomId: v.id("rooms"),
    askerSubject: v.string(),
    dedupeKey: v.string(),
    text: v.string(),
    state: v.string(),
    createdAt: v.number(),
    terminalAt: v.optional(v.number()),
  })
    .index("by_room", ["roomId"])
    .index("by_room_dedupe", ["roomId", "dedupeKey"]),

  progress: defineTable({
    roomId: v.id("rooms"),
    questionId: v.id("questions"),
    step: v.number(),
    label: v.string(),
    createdAt: v.number(),
  })
    .index("by_question", ["questionId"])
    .index("by_room", ["roomId"]),

  answers: defineTable({
    roomId: v.id("rooms"),
    questionId: v.id("questions"),
    text: v.string(),
    citationSourceIds: v.array(v.id("sources")),
    createdAt: v.number(),
  })
    .index("by_question", ["questionId"])
    .index("by_room", ["roomId"]),

  attempts: defineTable({
    roomId: v.id("rooms"),
    questionId: v.id("questions"),
    dedupeKey: v.string(),
    attempt: v.number(),
    disposition: v.string(),
    createdAt: v.number(),
  })
    .index("by_question", ["questionId"])
    .index("by_room_dedupe", ["roomId", "dedupeKey"]),

  lateAttempts: defineTable({
    roomId: v.id("rooms"),
    questionId: v.id("questions"),
    rejected: v.boolean(),
    observedState: v.string(),
    createdAt: v.number(),
  }).index("by_question", ["questionId"]),

  refreshRuns: defineTable({
    roomId: v.id("rooms"),
    dedupeKey: v.string(),
    status: v.string(),
    externalRecordId: v.string(),
    payloadHash: v.string(),
    progress: v.string(),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_dedupe", ["roomId", "dedupeKey"]),

  signals: defineTable({
    roomId: v.id("rooms"),
    seq: v.number(),
    actorSubject: v.string(),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]),
});
