import { mutation, v } from "./generated/server";

export const unsupportedDocumentArray = mutation({
  args: {},
  returns: v.array(v.doc("todos")),
  auth: "public",
  reads: ["todos"],
  writes: ["todos"],
  handler: async (ctx) => ctx.db.query("todos").collect(),
});
