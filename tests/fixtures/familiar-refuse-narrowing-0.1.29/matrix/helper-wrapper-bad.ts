import {
  query,
  v,
  type FamiliarQueryContext,
} from "../snapback/generated/server";

function refuseMissing(ctx: FamiliarQueryContext, code: string) {
  ctx.refuse(code);
}

type IsExactlyVoid<Value> = [Value] extends [void]
  ? [void] extends [Value] ? true : false
  : false;
const declarationReturnIsVoid: IsExactlyVoid<ReturnType<typeof refuseMissing>> = true;
void declarationReturnIsVoid;

export const widenedWrapper = query({
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
