import { query, v } from "../snapback/generated/server";

export const contextuallyTypedDirectCall = query({
  args: { id: v.id("posts") },
  returns: v.string(),
  auth: "public",
  reads: ["posts"],
  handler: async (ctx, args) => {
    const post = await ctx.db.get("posts", args.id);
    if (!post) ctx.refuse("POST_NOT_FOUND");
    return post.body;
  },
});

export const contextuallyTypedCallbackCall = query({
  args: { id: v.id("posts") },
  returns: v.string(),
  auth: "public",
  reads: ["posts"],
  handler: async (ctx, args) => {
    const post = await ctx.db.get("posts", args.id);
    return [post].map((candidate) => {
      if (!candidate) ctx.refuse("POST_NOT_FOUND");
      return candidate.body;
    })[0] ?? ctx.refuse("POST_NOT_FOUND");
  },
});
