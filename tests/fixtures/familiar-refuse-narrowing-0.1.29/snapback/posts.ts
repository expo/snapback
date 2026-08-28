import { query, v } from "./generated/server";

export const byId = query({
  args: { id: v.id("posts") },
  returns: v.string(),
  auth: "public",
  reads: ["posts"],
  handler: async (ctx, args) => {
    const post = await ctx.db.get("posts", args.id);
    return (post ?? ctx.refuse("POST_NOT_FOUND")).body;
  },
});
