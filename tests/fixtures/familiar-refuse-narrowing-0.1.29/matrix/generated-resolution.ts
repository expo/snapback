import { query, v, type FamiliarQueryContext } from "../snapback/generated/server";

type IsNever<Value> = [Value] extends [never] ? true : false;
const refuseReturnIsNever: IsNever<ReturnType<FamiliarQueryContext["refuse"]>> = true;
void refuseReturnIsNever;

export const generatedResolution = query({
  args: { id: v.id("posts") },
  returns: v.string(),
  auth: "public",
  reads: ["posts"],
  handler: async (ctx, args) => {
    const post = await ctx.db.get("posts", args.id);
    return (post ?? ctx.refuse("POST_NOT_FOUND")).body;
  },
});
