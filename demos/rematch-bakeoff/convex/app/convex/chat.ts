import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});

export const listConversations = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const out = [];
    for (const m of memberships) {
      const convo = await ctx.db.get(m.conversationId);
      if (!convo) continue;
      const memberRows = await ctx.db
        .query("memberships")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", convo._id)
        )
        .collect();
      const members = (
        await Promise.all(memberRows.map((r) => ctx.db.get(r.userId)))
      ).filter((u): u is Doc<"users"> => u !== null);
      const lastMessage = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", convo._id)
        )
        .order("desc")
        .first();
      let lastAuthor = null;
      if (lastMessage) lastAuthor = await ctx.db.get(lastMessage.authorId);
      const others = members.filter((u) => u._id !== userId);
      const title =
        convo.kind === "group"
          ? convo.name ?? "Group"
          : others.map((u) => u.name).join(", ") || "Just you";
      const avatar =
        convo.kind === "group" ? convo.emoji ?? "👥" : others[0]?.emoji ?? "👤";
      out.push({
        _id: convo._id,
        kind: convo.kind,
        title,
        avatar,
        memberNames: members.map((u) => u.name),
        lastMessage: lastMessage
          ? {
              text:
                lastMessage.kind === "image"
                  ? `📷 ${lastMessage.text ?? "Photo"}`
                  : lastMessage.text ?? "",
              authorName: lastAuthor?.name ?? "?",
              at: lastMessage._creationTime,
            }
          : null,
      });
    }
    out.sort(
      (a, b) => (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0)
    );
    return out;
  },
});

export const listMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId)
      )
      .order("asc")
      .collect();
    const userCache = new Map<string, Doc<"users"> | null>();
    const getUser = async (id: Id<"users">) => {
      const key = id as string;
      if (!userCache.has(key)) userCache.set(key, await ctx.db.get(id));
      return userCache.get(key) ?? null;
    };
    const byId = new Map(messages.map((m) => [m._id as string, m]));
    const out = [];
    for (const m of messages) {
      const author = await getUser(m.authorId);
      const reactionRows = await ctx.db
        .query("reactions")
        .withIndex("by_message", (q) => q.eq("messageId", m._id))
        .collect();
      // NOTE: emoji cannot be object keys in Convex values (field names must
      // be ASCII), so reactions are returned as an array.
      const reactionMap = new Map<
        string,
        { emoji: string; count: number; userIds: string[] }
      >();
      for (const r of reactionRows) {
        const entry = reactionMap.get(r.emoji) ?? {
          emoji: r.emoji,
          count: 0,
          userIds: [],
        };
        entry.count++;
        entry.userIds.push(r.userId as string);
        reactionMap.set(r.emoji, entry);
      }
      const reactions = [...reactionMap.values()];
      let replyTo = null;
      if (m.replyToId) {
        const target = byId.get(m.replyToId as string) ?? (await ctx.db.get(m.replyToId));
        if (target) {
          const targetAuthor = await getUser(target.authorId);
          replyTo = {
            _id: target._id,
            authorName: targetAuthor?.name ?? "?",
            preview:
              target.kind === "image"
                ? `📷 ${target.text ?? "Photo"}`
                : (target.text ?? "").slice(0, 80),
          };
        }
      }
      out.push({
        _id: m._id,
        at: m._creationTime,
        kind: m.kind,
        text: m.text ?? null,
        imageUrl: m.imageStorageId
          ? await ctx.storage.getUrl(m.imageStorageId)
          : null,
        authorId: m.authorId,
        authorName: author?.name ?? "?",
        authorEmoji: author?.emoji ?? "👤",
        authorColor: author?.color ?? "#888",
        replyTo,
        reactions,
      });
    }
    return out;
  },
});

export const sendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    authorId: v.id("users"),
    text: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    replyToId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    if (!args.text && !args.imageStorageId) {
      throw new Error("Message must have text or an image");
    }
    const id = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      authorId: args.authorId,
      kind: args.imageStorageId ? "image" : "text",
      text: args.text,
      imageStorageId: args.imageStorageId,
      replyToId: args.replyToId,
    });
    // Sending clears your typing state.
    const t = await ctx.db
      .query("typing")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", args.conversationId).eq("userId", args.authorId)
      )
      .unique();
    if (t) await ctx.db.delete(t._id);
    return id;
  },
});

export const toggleReaction = mutation({
  args: {
    messageId: v.id("messages"),
    userId: v.id("users"),
    emoji: v.string(),
  },
  handler: async (ctx, { messageId, userId, emoji }) => {
    const existing = await ctx.db
      .query("reactions")
      .withIndex("by_message_user_emoji", (q) =>
        q.eq("messageId", messageId).eq("userId", userId).eq("emoji", emoji)
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { toggled: "off" as const };
    }
    await ctx.db.insert("reactions", { messageId, userId, emoji });
    return { toggled: "on" as const };
  },
});

export const setTyping = mutation({
  args: {
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    isTyping: v.boolean(),
  },
  handler: async (ctx, { conversationId, userId, isTyping }) => {
    const existing = await ctx.db
      .query("typing")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", userId)
      )
      .unique();
    if (isTyping) {
      if (existing) {
        await ctx.db.patch(existing._id, { updatedAt: Date.now() });
      } else {
        await ctx.db.insert("typing", {
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

export const listTyping = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const rows = await ctx.db
      .query("typing")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId)
      )
      .collect();
    const out = [];
    for (const row of rows) {
      const user = await ctx.db.get(row.userId);
      if (!user) continue;
      out.push({
        userId: row.userId,
        name: user.name,
        updatedAt: row.updatedAt,
      });
    }
    return out;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
