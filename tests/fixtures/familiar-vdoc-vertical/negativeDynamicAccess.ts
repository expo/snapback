import { query, v } from "./generated/server";

export const dynamicAccess = query({
  args: { titles: v.array(v.string()), index: v.integer() },
  returns: v.string(),
  auth: "public",
  reads: ["todos"],
  handler: async (_ctx, args) => args.titles[args.index] ?? "",
});
