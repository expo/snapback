import { query, v } from "./generated/server";

const DEFAULT_LABEL = "captured";

export const labelTodo = query({
  args: { title: v.string() },
  returns: v.string(),
  auth: "public",
  reads: ["todos"],
  handler: async (_ctx, args) => `${DEFAULT_LABEL}:${args.title}`,
});
