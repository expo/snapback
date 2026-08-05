import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// List all conversations a user belongs to, newest activity first, with
// member info and a short preview of the last message.
export const listForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const memberships = await ctx.db
      .query("conversationMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const conversations = await Promise.all(
      memberships.map(async (m) => {
        const conversation = await ctx.db.get(m.conversationId);
        if (!conversation) return null;

        const members = await ctx.db
          .query("conversationMembers")
          .withIndex("by_conversation", (q) =>
            q.eq("conversationId", conversation._id)
          )
          .collect();
        const memberUsers = await Promise.all(
          members.map((mm) => ctx.db.get(mm.userId))
        );

        const lastMessage = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) =>
            q.eq("conversationId", conversation._id)
          )
          .order("desc")
          .first();

        let lastMessageAuthor = null;
        if (lastMessage) {
          lastMessageAuthor = await ctx.db.get(lastMessage.authorId);
        }

        return {
          ...conversation,
          members: memberUsers.filter((u): u is NonNullable<typeof u> => !!u),
          lastMessage,
          lastMessageAuthorName: lastMessageAuthor?.name ?? null,
        };
      })
    );

    return conversations
      .filter((c): c is NonNullable<typeof c> => !!c)
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  },
});

export const get = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) return null;
    const members = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId)
      )
      .collect();
    const memberUsers = await Promise.all(
      members.map((mm) => ctx.db.get(mm.userId))
    );
    return {
      ...conversation,
      members: memberUsers.filter((u): u is NonNullable<typeof u> => !!u),
    };
  },
});

export const createDm = mutation({
  args: { userId: v.id("users"), otherUserId: v.id("users") },
  handler: async (ctx, { userId, otherUserId }) => {
    // Reuse an existing DM between the two users if one exists.
    const myMemberships = await ctx.db
      .query("conversationMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const m of myMemberships) {
      const conversation = await ctx.db.get(m.conversationId);
      if (!conversation || conversation.kind !== "dm") continue;
      const members = await ctx.db
        .query("conversationMembers")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversation._id)
        )
        .collect();
      if (
        members.length === 2 &&
        members.some((mm) => mm.userId === otherUserId)
      ) {
        return conversation._id;
      }
    }

    const conversationId = await ctx.db.insert("conversations", {
      kind: "dm",
      lastMessageAt: Date.now(),
    });
    await ctx.db.insert("conversationMembers", {
      conversationId,
      userId,
    });
    await ctx.db.insert("conversationMembers", {
      conversationId,
      userId: otherUserId,
    });
    return conversationId;
  },
});

export const createGroup = mutation({
  args: {
    title: v.string(),
    memberIds: v.array(v.id("users")),
  },
  handler: async (ctx, { title, memberIds }) => {
    const conversationId = await ctx.db.insert("conversations", {
      kind: "group",
      title,
      lastMessageAt: Date.now(),
    });
    for (const userId of memberIds) {
      await ctx.db.insert("conversationMembers", {
        conversationId,
        userId,
      });
    }
    return conversationId;
  },
});
