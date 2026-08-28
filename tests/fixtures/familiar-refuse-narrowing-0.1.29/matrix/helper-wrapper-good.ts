import {
  query,
  v,
  type FamiliarQueryContext,
} from "../snapback/generated/server";

function refuseMissingAnnotated(
  ctx: FamiliarQueryContext,
  code: string,
): never {
  ctx.refuse(code);
}

const refuseMissingExpression: (
  ctx: FamiliarQueryContext,
  code: string,
) => never = (
  ctx: FamiliarQueryContext,
  code: string,
) => ctx.refuse(code);

export const annotatedWrapper = query({
  args: { id: v.id("posts") },
  returns: v.string(),
  auth: "public",
  reads: ["posts"],
  handler: async (ctx: FamiliarQueryContext, args) => {
    const post = await ctx.db.get("posts", args.id);
    if (!post) refuseMissingAnnotated(ctx, "POST_NOT_FOUND");
    return post.body;
  },
});

export const expressionWrapper = query({
  args: { id: v.id("posts") },
  returns: v.string(),
  auth: "public",
  reads: ["posts"],
  handler: async (ctx: FamiliarQueryContext, args) => {
    const post = await ctx.db.get("posts", args.id);
    if (!post) refuseMissingExpression(ctx, "POST_NOT_FOUND");
    return post.body;
  },
});
