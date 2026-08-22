import { query, v } from "./generated/server";

export const unknownTable = query({
  args: {},
  returns: v.array(v.doc("missingTable")),
  auth: "public",
  reads: ["todos"],
  handler: async () => [],
});
