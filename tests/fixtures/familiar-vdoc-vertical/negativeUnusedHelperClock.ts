import { query, v } from "./generated/server";

function unusedClockBranch(thresholdMs: number) {
  if (Date.now() >= thresholdMs) return "after";
  return "before";
}

export const unaffectedQuery = query({
  args: {},
  returns: v.number(),
  auth: "public",
  reads: ["todos"],
  handler: async () => 1,
});
