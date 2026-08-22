import {
  allow,
  defineEphemeral,
  defineSchema,
  defineTable,
  ephemeral,
  v,
} from "./generated/server";

export const roomMemberships = defineTable({
  roomId: v.id("rooms"),
  userId: v.principal(),
  role: v.string(),
})
  .visibility({ kind: "owner", field: "userId" })
  .index("by_room", ["roomId"])
  .index("by_user", ["userId"])
  .index("by_room_user", ["roomId", "userId"], { unique: true })
  .membership({
    id: "roomMemberships",
    principal: "userId",
    resource: "roomId",
    role: "role",
    roles: ["owner", "member"],
    bootstrapRole: "owner",
    lastHolder: { protect: "owner" },
    provenance: "full",
    transitions: [
      { op: "insert", by: ["owner"], target: "other", to: ["member"] },
      { op: "remove", by: ["owner"], target: "other", from: ["member"] },
      { op: "remove", by: ["self"], target: "self", from: ["member"] },
    ],
  })
  .authorityProfile({
    name: "roomMemberships",
    hierarchy: { owner: ["member"], member: [] },
    roster: { visible: ["userId", "role"] },
  });

export const rooms = defineTable({
  title: v.string(),
}).visibility({
  kind: "membership",
  declaration: "roomMemberships",
  resourceField: "_id",
  roles: ["owner", "member"],
});

export const roomNotes = defineTable({
  roomId: v.id("rooms"),
  body: v.string(),
}).visibility({
  kind: "membership",
  declaration: "roomMemberships",
  resourceField: "roomId",
  roles: ["owner", "member"],
}).index("by_room", ["roomId"]);

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
    visible: v.boolean(),
  }).visibility({ kind: "public-read" }).index("by_visible", ["visible"]),
  otherTodos: defineTable({
    title: v.string(),
  }).visibility({ kind: "public-read" }),
  rooms,
  roomMemberships,
  roomNotes,
}, {
  auth: { mode: "sessions" },
  ephemeral: defineEphemeral({
    typing: ephemeral.collection({
      scope: { roomId: v.id("rooms") },
      routing: ["roomId"],
      key: "connection",
      ttlMs: 6_000,
      maxTtlMs: 15_000,
      maxValueBytes: 256,
      publishRate: { sustainedHz: 5, burst: 10 },
      delivery: { mode: "latest", dispatchMs: 100 },
      value: v.object({ name: v.string() }),
      publish: allow.members("roomMemberships"),
      subscribe: allow.members("roomMemberships"),
    }),
  }),
});
