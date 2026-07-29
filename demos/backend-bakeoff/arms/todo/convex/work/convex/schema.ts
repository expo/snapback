import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  workspaces: defineTable({
    slug: v.string(),
    name: v.string(),
  }).index("by_slug", ["slug"]),
  memberships: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    active: v.boolean(),
    role: v.union(v.literal("member"), v.literal("owner")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),
  lists: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    taskIds: v.array(v.id("tasks")),
  }).index("by_workspace", ["workspaceId"]),
  tasks: defineTable({
    workspaceId: v.id("workspaces"),
    listId: v.id("lists"),
    title: v.string(),
    completed: v.boolean(),
    revision: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_list", ["listId"]),
});
