import { defineSchema, defineTable, v } from "./generated/server";

const roomMemberships = defineTable({
  roomId: v.id("rooms"),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: "roomMemberships",
  principal: "userId",
  resource: "roomId",
  role: "role",
  roles: ["member"],
});

export default defineSchema({
  rooms: defineTable({ title: v.string() }).visibility({ kind: "public-read" }),
  roomMemberships,
  roomNotes: defineTable({
    roomId: v.id("rooms"),
    body: v.string(),
  }).visibility({
    kind: "membership",
    declaration: "roomMemberships",
    resourceField: "missingRoomId",
    roles: ["member"],
  }),
});
