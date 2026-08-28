import {
  query,
  v,
  type FamiliarQueryContext,
} from "../snapback/generated/server";

export const explicitContextAnnotation = query({
  args: { id: v.id("posts") },
  returns: v.string(),
  auth: "public",
  reads: ["posts"],
  handler: async (ctx: FamiliarQueryContext, args) => {
    const post = await ctx.db.get("posts", args.id);
    if (!post) ctx.refuse("POST_NOT_FOUND");
    await Promise.resolve();
    return post.body;
  },
});

export const explicitReturn = query({
  args: { id: v.id("posts") },
  returns: v.string(),
  auth: "public",
  reads: ["posts"],
  handler: async (ctx, args) => {
    const post = await ctx.db.get("posts", args.id);
    if (!post) return ctx.refuse("POST_NOT_FOUND");
    return post.body;
  },
});

export const valuePosition = query({
  args: { id: v.id("posts") },
  returns: v.string(),
  auth: "public",
  reads: ["posts"],
  handler: async (ctx, args) => {
    const post = await ctx.db.get("posts", args.id);
    const present = post ?? ctx.refuse("POST_NOT_FOUND");
    return present.body;
  },
});
