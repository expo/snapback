import { query, v } from "./generated/server";

export const scalarClockComparison = query({
  args: { thresholdMs: v.integer() },
  returns: v.boolean(),
  auth: "public",
  reads: ["todos"],
  handler: async (_ctx, args) => Date.now() >= args.thresholdMs,
});
