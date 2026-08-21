import { action, mutation, query, v } from "./generated/server";
import { api } from "./generated/api";

function createMutationReference() {
  return api.todos.create;
}

export const get = query({
  args: { id: v.id("todos") },
  returns: v.union([v.doc("todos"), v.null()]),
  auth: "public",
  reads: ["todos"],
  handler: async (ctx, args) => ctx.db.get("todos", args.id),
});

export const getRequired = query({
  args: { id: v.id("todos") },
  returns: v.doc("todos"),
  auth: "public",
  reads: ["todos"],
  handler: async (ctx, args) => {
    const todo = await ctx.db.get("todos", args.id);
    if (todo === null) return ctx.refuse("TODO_NOT_FOUND");
    return todo;
  },
});

export const list = query({
  args: {},
  returns: v.array(v.doc("todos")),
  auth: "public",
  reads: ["todos"],
  handler: async (ctx) => ctx.db.query("todos").collect(),
});

export const create = mutation({
  args: { title: v.string() },
  returns: v.doc("todos"),
  auth: "public",
  reads: ["todos"],
  writes: ["todos"],
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("todos", {
      title: args.title,
      completed: false,
    });
    const created = await ctx.db.get("todos", id);
    if (created === null) return ctx.refuse("TODO_INSERT_NOT_OBSERVED");
    return created;
  },
});

export const remove = mutation({
  args: { id: v.id("todos") },
  returns: v.null(),
  auth: "public",
  reads: ["todos"],
  writes: ["todos"],
  handler: async (ctx, args) => {
    await ctx.db.delete("todos", args.id);
    return null;
  },
});

export const createFromAction = action({
  args: { title: v.string() },
  returns: v.doc("todos"),
  auth: "public",
  handler: async (ctx, args) => ctx.runMutation(createMutationReference(), args),
});
