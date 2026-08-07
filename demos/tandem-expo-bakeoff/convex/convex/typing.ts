import { internal } from './_generated/api';
import { internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';

const TTL_MS = 4_000;

export const list = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('typingIndicators').withIndex('by_conversation', (q) => q.eq('conversationKey', args.conversationId)).collect();
    return rows.map((row) => ({ userId: row.userKey, name: row.name, color: row.color }));
  },
});

export const set = mutation({
  args: {
    conversationId: v.string(),
    userId: v.string(),
    name: v.string(),
    color: v.string(),
    typing: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('typingIndicators').withIndex('by_conversation_user', (q) => q.eq('conversationKey', args.conversationId).eq('userKey', args.userId)).unique();
    if (!args.typing) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    const nonce = crypto.randomUUID();
    const value = { name: args.name, color: args.color, nonce, expiresAt: Date.now() + TTL_MS };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert('typingIndicators', { conversationKey: args.conversationId, userKey: args.userId, ...value });
    await ctx.scheduler.runAfter(TTL_MS, internal.typing.expire, { conversationId: args.conversationId, userId: args.userId, nonce });
  },
});

export const expire = internalMutation({
  args: { conversationId: v.string(), userId: v.string(), nonce: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('typingIndicators').withIndex('by_conversation_user', (q) => q.eq('conversationKey', args.conversationId).eq('userKey', args.userId)).unique();
    if (row?.nonce === args.nonce) await ctx.db.delete(row._id);
  },
});
