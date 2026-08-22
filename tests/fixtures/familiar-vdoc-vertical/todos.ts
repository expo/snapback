import { action, membershipResource, mutation, query, v } from "./generated/server";
import { api } from "./generated/api";
import { importedTitle } from "./helpers/title";
import { roomMemberships } from "./schema";

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

export const recordList = query({
  args: {},
  returns: v.array(v.object({ title: v.string() })),
  auth: "public",
  reads: ["todos"],
  handler: async () => [{ title: "record" }],
});

export const invalidRecordList = query({
  args: {},
  returns: v.array(v.object({ title: v.string() })),
  auth: "public",
  reads: ["todos"],
  delivery: "read",
  handler: async () => [{ title: "record", hidden: true }],
});

export const boundedRecords = query({
  args: {},
  returns: v.array(v.object({ rank: v.integer() }), { maxItems: 2 }),
  auth: "public",
  reads: ["todos"],
  handler: async () => [{ rank: 1 }, { rank: 2 }],
});

export const overBoundRecords = query({
  args: {},
  returns: v.array(v.object({ rank: v.integer() }), { maxItems: 2 }),
  auth: "public",
  reads: ["todos"],
  delivery: "read",
  handler: async () => [{ rank: 1 }, { rank: 2 }, { rank: 3 }],
});

export const unionRecords = query({
  args: {},
  returns: v.array(v.union([
    v.object({ kind: v.literal("title"), title: v.string() }),
    v.object({ kind: v.literal("count"), count: v.integer() }),
  ])),
  auth: "public",
  reads: ["todos"],
  handler: async () => [
    { kind: "title" as const, title: "union" },
    { kind: "count" as const, count: 2 },
  ],
});

export const invalidUnionRecords = query({
  args: {},
  returns: v.array(v.union([
    v.object({ kind: v.literal("title"), title: v.string() }),
    v.object({ kind: v.literal("count"), count: v.integer() }),
  ])),
  auth: "public",
  reads: ["todos"],
  delivery: "read",
  // @ts-expect-error VCF-F-Q4 deliberately proves runtime union-arm admission.
  handler: async () => [{ kind: "missing", value: true }],
});

export const singletonRecord = query({
  args: {},
  returns: v.tuple([v.object({ title: v.string() })]),
  auth: "public",
  reads: ["todos"],
  handler: async () => [{ title: "singleton" }] as const,
});

export const emptySingletonRecord = query({
  args: {},
  returns: v.tuple([v.object({ title: v.string() })]),
  auth: "public",
  reads: ["todos"],
  delivery: "read",
  // @ts-expect-error VCF-F-Q5 deliberately proves the exact one-row bound.
  handler: async () => [],
});

export const summary = query({
  args: {},
  returns: v.object({ label: v.string(), total: v.integer() }),
  auth: "public",
  reads: ["todos"],
  handler: async () => ({ label: "summary", total: 1 }),
});

export const invalidSummary = query({
  args: {},
  returns: v.object({ label: v.string(), total: v.integer() }),
  auth: "public",
  reads: ["todos"],
  delivery: "read",
  handler: async () => ({ label: "summary", total: 1, hidden: true }),
});

export const count = query({
  args: {},
  returns: v.number(),
  auth: "public",
  reads: ["todos"],
  handler: async () => 2,
});

export const firstTitle = query({
  args: { titles: v.array(v.string()) },
  returns: v.string(),
  auth: "public",
  reads: ["todos"],
  handler: async (_ctx, args) => args.titles[0] ?? "",
});

export const prefixedTitle = query({
  args: { title: v.string() },
  returns: v.string(),
  auth: "public",
  reads: ["todos"],
  handler: async (_ctx, args) => {
    const prefix = "packed";
    return `${prefix}:${args.title}`;
  },
});

// VCF-F-D4: Familiar visibility uses persisted application state and an
// explicit mutation, never an ambient clock inside the read rule.
export const setVisible = mutation({
  args: { id: v.id("todos") },
  returns: v.null(),
  auth: "public",
  reads: ["todos"],
  writes: ["todos"],
  handler: async (ctx, args) => {
    await ctx.db.patch("todos", args.id, { visible: true });
    return null;
  },
});

export const visibleTodos = query({
  args: {},
  returns: v.array(v.doc("todos")),
  auth: "public",
  reads: ["todos"],
  handler: async (ctx) => ctx.db
    .query("todos")
    .withIndex("by_visible", (q) => q.eq("visible", true))
    .collect(),
});

export const helperTitle = query({
  args: { title: v.string() },
  returns: v.string(),
  auth: "public",
  reads: ["todos"],
  handler: async (_ctx, args) => importedTitle(args.title),
});

export const getRoom = query({
  args: { id: v.id("rooms") },
  returns: v.union([v.doc("rooms"), v.null()]),
  auth: "authenticated",
  reads: ["rooms"],
  handler: async (ctx, args) => ctx.db.get("rooms", args.id),
});

export const listRoomNotes = query({
  args: { roomId: v.id("rooms") },
  returns: v.array(v.doc("roomNotes")),
  auth: "authenticated",
  reads: ["roomNotes"],
  handler: async (ctx, args) => ctx.db
    .query("roomNotes")
    .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
    .collect(),
});

export const createRoom = mutation({
  args: { title: v.string() },
  returns: v.id("rooms"),
  auth: "authenticated",
  reads: [],
  writes: ["roomMemberships"],
  handler: async (ctx, args) => ctx.membership.roomMemberships.bootstrap({ title: args.title }),
});

export const addRoomNote = mutation({
  args: { roomId: v.id("rooms"), body: v.string() },
  returns: v.id("roomNotes"),
  auth: "authenticated",
  reads: [],
  writes: ["roomNotes"],
  membership: [roomMemberships.hasRole(membershipResource.arg("roomId"), "owner")],
  handler: async (ctx, args) => ctx.db.insert("roomNotes", args),
});

export const invalidCount = query({
  args: {},
  returns: v.number(),
  auth: "public",
  reads: ["todos"],
  delivery: "read",
  // @ts-expect-error VCF-F-Q8 deliberately proves runtime scalar admission.
  handler: async () => "two",
});

export const wrongTablePoint = query({
  args: { id: v.id("otherTodos") },
  returns: v.union([v.doc("todos"), v.null()]),
  auth: "public",
  reads: ["otherTodos"],
  delivery: "read",
  // @ts-expect-error VCF-F-Q6 deliberately proves the table-bound document contract.
  handler: async (ctx, args) => ctx.db.get("otherTodos", args.id),
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
      visible: false,
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

export const returnTodoId = mutation({
  args: { id: v.id("todos") },
  returns: v.id("todos"),
  auth: "public",
  reads: ["todos"],
  writes: ["todos"],
  handler: async (_ctx, args) => args.id,
});

export const returnForeignId = mutation({
  args: {},
  returns: v.id("todos"),
  auth: "public",
  reads: ["otherTodos"],
  writes: ["otherTodos"],
  // @ts-expect-error VCF-F-M2 deliberately proves nominal table-id admission.
  handler: async (ctx) => ctx.db.insert("otherTodos", { title: "foreign" }),
});

export const partialDocument = mutation({
  args: {},
  returns: v.doc("todos"),
  auth: "public",
  reads: ["todos"],
  writes: ["todos"],
  // @ts-expect-error VCF-F-M1 deliberately proves complete document admission.
  handler: async () => ({ title: "partial", completed: false, visible: false }),
});

export const createFromAction = action({
  args: { title: v.string() },
  returns: v.doc("todos"),
  auth: "public",
  handler: async (ctx, args) => ctx.runMutation(createMutationReference(), args),
});

export const createFromRawString = action({
  args: { title: v.string() },
  returns: v.doc("todos"),
  auth: "public",
  // @ts-expect-error VCF-F-A1 deliberately proves generated-reference custody at runtime.
  handler: async (ctx, args) => ctx.runMutation("todos.create", args),
});
