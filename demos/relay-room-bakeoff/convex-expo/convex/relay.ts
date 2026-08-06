import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';

async function requireMembership(ctx: any, conversationId: Id<'conversations'>, userId: Id<'users'>) {
  const membership = await ctx.db.query('memberships')
    .withIndex('by_conversation_user', (q: any) => q.eq('conversationId', conversationId).eq('userId', userId))
    .unique();
  if (!membership) throw new Error('User is not a member of this conversation');
}

export const users = query({
  args: {},
  handler: async (ctx) => ctx.db.query('users').collect(),
});

export const conversationsForUser = query({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const memberships = await ctx.db.query('memberships').withIndex('by_user', (q) => q.eq('userId', args.userId)).collect();
    const rows = await Promise.all(memberships.map((membership) => ctx.db.get(membership.conversationId)));
    return rows.filter((row) => row !== null).sort((left, right) => right.updatedAt - left.updatedAt);
  },
});

export const conversation = query({
  args: { conversationId: v.id('conversations') },
  handler: async (ctx, args) => ctx.db.get(args.conversationId),
});

export const members = query({
  args: { conversationId: v.id('conversations') },
  handler: async (ctx, args) => ctx.db.query('memberships')
    .withIndex('by_conversation', (q) => q.eq('conversationId', args.conversationId)).collect(),
});

export const messages = query({
  args: { conversationId: v.id('conversations') },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('messages')
      .withIndex('by_conversation_sent', (q) => q.eq('conversationId', args.conversationId))
      .order('asc')
      .collect();
    return Promise.all(rows.map(async (message) => ({
      ...message,
      imageUrl: message.imageStorageId ? await ctx.storage.getUrl(message.imageStorageId) : null,
    })));
  },
});

export const reactions = query({
  args: { conversationId: v.id('conversations') },
  handler: async (ctx, args) => ctx.db.query('reactions')
    .withIndex('by_conversation', (q) => q.eq('conversationId', args.conversationId)).collect(),
});

export const typing = query({
  args: { conversationId: v.id('conversations') },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rows = await ctx.db.query('typing').withIndex('by_conversation', (q) => q.eq('conversationId', args.conversationId)).collect();
    return rows.filter((row) => row.expiresAt > now);
  },
});

export const sendText = mutation({
  args: {
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    text: v.string(),
    replyToId: v.optional(v.id('messages')),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.conversationId, args.senderId);
    const text = args.text.trim();
    if (!text) throw new Error('Message cannot be empty');
    if (args.replyToId) {
      const target = await ctx.db.get(args.replyToId);
      if (!target || target.conversationId !== args.conversationId) throw new Error('Reply target is outside this conversation');
    }
    const sentAt = Date.now();
    const messageId = await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      senderId: args.senderId,
      kind: 'text',
      text,
      ...(args.replyToId ? { replyToId: args.replyToId } : {}),
      sentAt,
    });
    await ctx.db.patch(args.conversationId, { lastPreview: text, updatedAt: sentAt });
    return messageId;
  },
});

export const toggleReaction = mutation({
  args: {
    conversationId: v.id('conversations'),
    messageId: v.id('messages'),
    userId: v.id('users'),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.conversationId, args.userId);
    const existing = await ctx.db.query('reactions')
      .withIndex('by_message_user_emoji', (q) => q.eq('messageId', args.messageId).eq('userId', args.userId).eq('emoji', args.emoji))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { active: false };
    }
    await ctx.db.insert('reactions', args);
    return { active: true };
  },
});

export const generateUploadUrl = mutation({
  args: { conversationId: v.id('conversations'), userId: v.id('users') },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.conversationId, args.userId);
    return ctx.storage.generateUploadUrl();
  },
});

export const sendImage = mutation({
  args: {
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    storageId: v.id('_storage'),
    caption: v.optional(v.string()),
    replyToId: v.optional(v.id('messages')),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.conversationId, args.senderId);
    const sentAt = Date.now();
    const messageId = await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      senderId: args.senderId,
      kind: 'image',
      imageStorageId: args.storageId,
      ...(args.caption?.trim() ? { text: args.caption.trim() } : {}),
      ...(args.replyToId ? { replyToId: args.replyToId } : {}),
      sentAt,
    });
    await ctx.db.patch(args.conversationId, {
      lastPreview: args.caption?.trim() ? `Photo · ${args.caption.trim()}` : 'Photo',
      updatedAt: sentAt,
    });
    return messageId;
  },
});

export const setTyping = mutation({
  args: { conversationId: v.id('conversations'), userId: v.id('users'), name: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.conversationId, args.userId);
    const existing = await ctx.db.query('typing')
      .withIndex('by_conversation_user', (q) => q.eq('conversationId', args.conversationId).eq('userId', args.userId))
      .unique();
    if (!args.active) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    const expiresAt = Date.now() + 4_000;
    const id = existing
      ? (await ctx.db.patch(existing._id, { name: args.name, expiresAt }), existing._id)
      : await ctx.db.insert('typing', { conversationId: args.conversationId, userId: args.userId, name: args.name, expiresAt });
    await ctx.scheduler.runAfter(4_100, internal.relay.clearTyping, { id, expiresAt });
  },
});

export const clearTyping = internalMutation({
  args: { id: v.id('typing'), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (row && row.expiresAt === args.expiresAt && row.expiresAt <= Date.now()) await ctx.db.delete(args.id);
  },
});

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const key = 'relay-room.2026-08-05.1';
    if (await ctx.db.query('seedMarkers').withIndex('by_key', (q) => q.eq('key', key)).unique()) return { seeded: false };

    const ada = await ctx.db.insert('users', { handle: 'ada', name: 'Ada Lovelace', color: '#7C5CFC' });
    const grace = await ctx.db.insert('users', { handle: 'grace', name: 'Grace Hopper', color: '#E05B8D' });
    const alan = await ctx.db.insert('users', { handle: 'alan', name: 'Alan Turing', color: '#168C8C' });
    const katherine = await ctx.db.insert('users', { handle: 'katherine', name: 'Katherine Johnson', color: '#D17A22' });

    const adaGrace = await ctx.db.insert('conversations', { kind: 'dm', title: 'Ada & Grace', updatedAt: 1785852300000, lastPreview: 'The compiler note is perfect.' });
    const adaAlan = await ctx.db.insert('conversations', { kind: 'dm', title: 'Ada & Alan', updatedAt: 1785849300000, lastPreview: 'Tea after the lecture?' });
    const engine = await ctx.db.insert('conversations', { kind: 'group', title: 'Engine Room', updatedAt: 1785855600000, lastPreview: 'Katherine: I checked the numbers twice ✓' });

    for (const [conversationId, userId] of [
      [adaGrace, ada], [adaGrace, grace], [adaAlan, ada], [adaAlan, alan],
      [engine, ada], [engine, grace], [engine, alan], [engine, katherine],
    ] as const) await ctx.db.insert('memberships', { conversationId, userId });

    const firstDm = await ctx.db.insert('messages', { conversationId: adaGrace, senderId: ada, kind: 'text', text: "I left a note about the engine's loops.", sentAt: 1785851700000 });
    const secondDm = await ctx.db.insert('messages', { conversationId: adaGrace, senderId: grace, kind: 'text', text: 'Found it. The compiler note is perfect.', replyToId: firstDm, sentAt: 1785852300000 });
    await ctx.db.insert('messages', { conversationId: adaAlan, senderId: alan, kind: 'text', text: 'Tea after the lecture?', sentAt: 1785849300000 });
    const groupQuestion = await ctx.db.insert('messages', { conversationId: engine, senderId: grace, kind: 'text', text: 'Can everyone confirm the launch calculation?', sentAt: 1785854400000 });
    await ctx.db.insert('messages', { conversationId: engine, senderId: alan, kind: 'text', text: 'The machine agrees with my hand calculation.', replyToId: groupQuestion, sentAt: 1785855000000 });
    const checked = await ctx.db.insert('messages', { conversationId: engine, senderId: katherine, kind: 'text', text: 'I checked the numbers twice ✓', replyToId: groupQuestion, sentAt: 1785855600000 });

    await ctx.db.insert('reactions', { conversationId: engine, messageId: checked, userId: ada, emoji: '❤️' });
    await ctx.db.insert('reactions', { conversationId: engine, messageId: checked, userId: grace, emoji: '👍' });
    await ctx.db.insert('reactions', { conversationId: adaGrace, messageId: secondDm, userId: ada, emoji: '✨' });
    await ctx.db.insert('seedMarkers', { key });
    return { seeded: true };
  },
});
