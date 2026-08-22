import { query, v } from "./generated/server";

export const ordinaryClock = query({
  args: {},
  returns: v.integer(),
  auth: "public",
  reads: ["todos"],
  handler: async () => Date.now(),
});
