import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Toggle: if this user already reacted with this emoji on this message,
// remove it; otherwise add it.
export const toggle = mutation({
  args: {
    messageId: v.id("messages"),
    userId: v.id("users"),
    emoji: v.string(),
  },
  handler: async (ctx, { messageId, userId, emoji }) => {
    const existing = await ctx.db
      .query("reactions")
      .withIndex("by_message_and_user_and_emoji", (q) =>
        q.eq("messageId", messageId).eq("userId", userId).eq("emoji", emoji)
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { added: false };
    }

    await ctx.db.insert("reactions", { messageId, userId, emoji });
    return { added: true };
  },
});
