import { action, mutation, query, v } from "./_generated/server";
import { api } from "./_generated/api";
import { titleValidator } from "./contracts";

function createMutationReference() {
  return api.todos.create;
}

export const list = query({
  args: { completed: v.boolean() },
  returns: v.array(v.doc("todos")),
  auth: "public",
  reads: ["todos"],
  handler: async (ctx, args) => ctx.db
    .query("todos")
    .withIndex("by_completed", (q) => q.eq("completed", args.completed))
    .collect(),
});

export const create = mutation({
  args: { title: titleValidator },
  returns: v.id("todos"),
  auth: "public",
  reads: [],
  writes: ["todos"],
  handler: async (ctx, args) => ctx.db.insert("todos", {
    title: args.title,
    completed: false,
  }),
});

export const createFromAction = action({
  args: { title: titleValidator },
  returns: v.id("todos"),
  auth: "public",
  handler: async (ctx, args) => ctx.runMutation(createMutationReference(), args),
});
