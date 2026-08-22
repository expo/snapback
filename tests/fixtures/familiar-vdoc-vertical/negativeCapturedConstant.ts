import { query, v } from "./generated/server";

const PREFIX = "captured";

export const capturedConstant = query({
  args: { title: v.string() },
  returns: v.string(),
  auth: "public",
  reads: ["todos"],
  handler: async (_ctx, args) => `${PREFIX}:${args.title}`,
});
