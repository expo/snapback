import { query, v } from "./generated/server";

export const ambientClock = query({
  args: { visibleAfterMs: v.integer() },
  returns: v.array(v.doc("todos")),
  auth: "public",
  reads: ["todos"],
  handler: async (ctx, args) => {
    if (Date.now() < args.visibleAfterMs) return [];
    return ctx.db.query("todos").take(1).collect();
  },
});
