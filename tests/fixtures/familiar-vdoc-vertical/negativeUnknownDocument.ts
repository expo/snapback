import { query, v } from "./generated/server";

export const unknownDocument = query({
  args: {},
  returns: v.doc("missingTable"),
  auth: "public",
  reads: ["todos"],
  handler: async () => null,
});
