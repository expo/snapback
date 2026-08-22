import { mutation, v } from "./generated/server";

export const allocateSequence = mutation({
  args: { scope: v.string() },
  returns: v.integer(),
  auth: "public",
  reads: [],
  writes: [],
  handler: async (ctx, args) => ctx.sequence.allocate("packed", args.scope),
});
