import { query, v } from "./generated/server";

export const visibleByConstructedDate = query({
  args: { visibleAfterMs: v.integer() },
  returns: v.array(v.doc("todos")),
  auth: "public",
  reads: ["todos"],
  handler: async (ctx, args) => (
    new Date().getTime() >= args.visibleAfterMs
    && ctx.db.query("todos").take(1).collect()
  ),
});
