import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const TYPING_TIMEOUT_MS = 4000;

export const setTyping = mutation({
  args: {
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    isTyping: v.boolean(),
  },
  handler: async (ctx, { conversationId, userId, isTyping }) => {
    const existing = await ctx.db
      .query("typingIndicators")
      .withIndex("by_conversation_and_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", userId)
      )
      .unique();

    if (isTyping) {
      if (existing) {
        await ctx.db.patch(existing._id, { updatedAt: Date.now() });
      } else {
        await ctx.db.insert("typingIndicators", {
          conversationId,
          userId,
          updatedAt: Date.now(),
        });
      }
    } else if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// Return the names of users (other than `excludeUserId`) currently typing
// in this conversation, based on a recent heartbeat.
export const listTyping = query({
  args: {
    conversationId: v.id("conversations"),
    excludeUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { conversationId, excludeUserId }) => {
    const rows = await ctx.db
      .query("typingIndicators")
      .withIndex("by_conversation_and_user", (q) =>
        q.eq("conversationId", conversationId)
      )
      .collect();

    const cutoff = Date.now() - TYPING_TIMEOUT_MS;
    const active = rows.filter(
      (r) => r.updatedAt >= cutoff && r.userId !== excludeUserId
    );

    const users = await Promise.all(active.map((r) => ctx.db.get(r.userId)));
    return users
      .filter((u): u is NonNullable<typeof u> => !!u)
      .map((u) => u.name);
  },
});
