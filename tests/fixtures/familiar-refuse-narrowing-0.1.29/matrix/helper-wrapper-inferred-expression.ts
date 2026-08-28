import {
  query,
  v,
  type FamiliarQueryContext,
} from "../snapback/generated/server";

const refuseMissing = (
  ctx: FamiliarQueryContext,
  code: string,
) => ctx.refuse(code);

type IsNever<Value> = [Value] extends [never] ? true : false;
const inferredReturnIsNever: IsNever<ReturnType<typeof refuseMissing>> = true;
void inferredReturnIsNever;

export const inferredExpressionWrapper = query({
  args: { id: v.id("posts") },
  returns: v.string(),
  auth: "public",
  reads: ["posts"],
  handler: async (ctx: FamiliarQueryContext, args) => {
    const post = await ctx.db.get("posts", args.id);
    if (!post) refuseMissing(ctx, "POST_NOT_FOUND");
    return post.body;
  },
});
