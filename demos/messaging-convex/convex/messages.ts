import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// List messages in a conversation, oldest first, with author, resolved
// image URL, reactions grouped by emoji, and a lightweight quoted preview
// of the message being replied to (WhatsApp-style: pointer, not a thread).
export const list = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId)
      )
      .order("asc")
      .collect();

    return await Promise.all(
      messages.map(async (message) => {
        const author = await ctx.db.get(message.authorId);
        const imageUrl = message.imageStorageId
          ? await ctx.storage.getUrl(message.imageStorageId)
          : null;

        // Convex object return values require ASCII-only field names, so
        // emoji can't be used as object keys here (attempted originally —
        // failed at runtime with "Field name invalid character"). Return an
        // array of {emoji, count, userIds} instead and group client-side.
        const reactionDocs = await ctx.db
          .query("reactions")
          .withIndex("by_message", (q) => q.eq("messageId", message._id))
          .collect();
        const order: string[] = [];
        const counts = new Map<string, { count: number; userIds: string[] }>();
        for (const r of reactionDocs) {
          let bucket = counts.get(r.emoji);
          if (!bucket) {
            bucket = { count: 0, userIds: [] };
            counts.set(r.emoji, bucket);
            order.push(r.emoji);
          }
          bucket.count += 1;
          bucket.userIds.push(r.userId);
        }
        const reactions = order.map((emoji) => ({
          emoji,
          count: counts.get(emoji)!.count,
          userIds: counts.get(emoji)!.userIds,
        }));

        let replyTo: {
          _id: string;
          authorName: string;
          text: string | null;
          hasImage: boolean;
        } | null = null;
        if (message.replyToId) {
          const original = await ctx.db.get(message.replyToId);
          if (original) {
            const originalAuthor = await ctx.db.get(original.authorId);
            replyTo = {
              _id: original._id,
              authorName: originalAuthor?.name ?? "Unknown",
              text: original.text ?? null,
              hasImage: !!original.imageStorageId,
            };
          }
        }

        return {
          ...message,
          authorName: author?.name ?? "Unknown",
          authorEmoji: author?.avatarEmoji ?? "❓",
          authorColor: author?.avatarColor ?? "#999999",
          imageUrl,
          reactions,
          replyTo,
        };
      })
    );
  },
});

export const send = mutation({
  args: {
    conversationId: v.id("conversations"),
    authorId: v.id("users"),
    text: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    replyToId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      authorId: args.authorId,
      text: args.text,
      imageStorageId: args.imageStorageId,
      replyToId: args.replyToId,
    });
    await ctx.db.patch(args.conversationId, { lastMessageAt: Date.now() });

    // Sending a message implicitly clears the sender's typing indicator.
    const typing = await ctx.db
      .query("typingIndicators")
      .withIndex("by_conversation_and_user", (q) =>
        q.eq("conversationId", args.conversationId).eq("userId", args.authorId)
      )
      .unique();
    if (typing) {
      await ctx.db.delete(typing._id);
    }

    return messageId;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
