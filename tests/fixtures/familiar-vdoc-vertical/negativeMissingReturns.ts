import { mutation, v } from "./generated/server";

export const missingReturns = mutation({
  args: {},
  auth: "public",
  reads: [],
  writes: [],
  handler: async () => null,
});
