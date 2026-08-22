import { query, v } from "./generated/server";
import { importedTitle } from "../outside-admitted-backend/title";

export const importedHelper = query({
  args: { title: v.string() },
  returns: v.string(),
  auth: "public",
  reads: ["todos"],
  handler: async (_ctx, args) => importedTitle(args.title),
});
