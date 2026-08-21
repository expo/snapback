import { action, v } from "./generated/server";

export const unsupportedDocumentArray = action({
  args: {},
  returns: v.array(v.doc("todos")),
  auth: "public",
  handler: async () => [],
});
