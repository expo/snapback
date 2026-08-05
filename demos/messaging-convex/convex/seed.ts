"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { seedImages } from "./seedImageData";

// Populate the deployment with test users, a couple of DMs, a couple of
// group chats, and a realistic backlog of messages (some with images,
// reactions, and replies). Safe to run multiple times: it clears prior
// seed data first (identified via the `seeded` marker conversation title
// isn't used; instead we just wipe everything via internal.seedData.reset).
export const run = action({
  args: {},
  handler: async (ctx): Promise<{ users: number; conversations: number; note: string }> => {
    const imageStorageIds: Record<string, string> = {};
    for (const [file, base64] of Object.entries(seedImages)) {
      const bytes = Buffer.from(base64, "base64");
      const blob = new Blob([bytes], { type: "image/png" });
      const storageId = await ctx.storage.store(blob);
      imageStorageIds[file] = storageId;
    }

    const result = await ctx.runMutation(internal.seedData.insert, {
      imageStorageIds,
    });
    return result;
  },
});
