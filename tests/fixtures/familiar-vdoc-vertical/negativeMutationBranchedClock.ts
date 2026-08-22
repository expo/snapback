import { mutation, v } from "./generated/server";

export const mutationBranchedClock = mutation({
  args: { thresholdMs: v.integer() },
  returns: v.integer(),
  auth: "public",
  reads: [],
  writes: ["todos"],
  handler: async (_ctx, args) => {
    if (Date.now() >= args.thresholdMs) return 1;
    return 0;
  },
});
