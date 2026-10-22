import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
// @ref LLP 3000.009.001.002#4-controls — numeric fixture identities retained across controls; bounded indexed reads
export default defineSchema({
  users: defineTable({ id: v.number(), sent: v.number() }).index("by_fixture_id", ["id"]),
  rooms: defineTable({ id: v.number(), total: v.number() }).index("by_fixture_id", ["id"]),
  memberships: defineTable({ room: v.number(), principal: v.number(), last_read: v.number() })
    .index("by_principal_room", ["principal", "room"]),
  messages: defineTable({ id: v.number(), room: v.number(), sender: v.number(), at: v.number(), body: v.string() })
    .index("by_fixture_id", ["id"]).index("by_room_at_id", ["room", "at", "id"]),
  counters: defineTable({ id: v.number(), owner_id: v.union(v.number(), v.null()), room: v.number(), n: v.number() })
    .index("by_fixture_id", ["id"]),
  // Shard documents for the labelled W5 row. The headline counter document stays exact.
  counterShards: defineTable({ counter: v.number(), shard: v.number(), n: v.number() })
    .index("by_counter_shard", ["counter", "shard"]),
});
