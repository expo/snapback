import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

async function userByKey(ctx: any, key: string) {
  return ctx.db.query('users').withIndex('by_key', (q: any) => q.eq('key', key)).unique();
}

async function conversationByKey(ctx: any, key: string) {
  return ctx.db.query('conversations').withIndex('by_key', (q: any) => q.eq('key', key)).unique();
}

export const listInbox = query({
  args: { viewerId: v.string() },
  handler: async (ctx, args) => {
    const mine = await ctx.db.query('conversationMembers').withIndex('by_user', (q) => q.eq('userKey', args.viewerId)).collect();
    const inbox = [];
    for (const membership of mine) {
      const conversation = await conversationByKey(ctx, membership.conversationKey);
      if (!conversation) continue;
      const members = await ctx.db.query('conversationMembers').withIndex('by_conversation', (q) => q.eq('conversationKey', membership.conversationKey)).collect();
      const people = (await Promise.all(members.map((member) => userByKey(ctx, member.userKey)))).filter(Boolean);
      const recent = await ctx.db.query('messages').withIndex('by_conversation_created', (q) => q.eq('conversationKey', membership.conversationKey)).order('desc').take(100);
      const latest = recent[0];
      const other = people.find((person) => person?.key !== args.viewerId) ?? people[0];
      inbox.push({
        id: membership.conversationKey,
        name: conversation.isGroup ? (conversation.title ?? 'Group') : (other?.displayName ?? 'Direct message'),
        isGroup: conversation.isGroup,
        memberCount: people.length,
        memberNames: people.map((person) => person!.displayName),
        avatarColor: conversation.isGroup ? conversation.accent : (other?.color ?? conversation.accent),
        lastMessage: latest ? (latest.text || 'Photo') : 'No messages yet',
        lastMessageAt: latest?.createdAt ?? 0,
        unreadCount: recent.filter((message) => message.createdAt > membership.lastReadAt && message.senderKey !== args.viewerId).length,
      });
    }
    return inbox.sort((left, right) => right.lastMessageAt - left.lastMessageAt);
  },
});

export const getConversation = query({
  args: { conversationId: v.string(), viewerId: v.string() },
  handler: async (ctx, args) => {
    const conversation = await conversationByKey(ctx, args.conversationId);
    if (!conversation) return null;
    const members = await ctx.db.query('conversationMembers').withIndex('by_conversation', (q) => q.eq('conversationKey', args.conversationId)).collect();
    const people = (await Promise.all(members.map((member) => userByKey(ctx, member.userKey)))).filter(Boolean);
    const other = people.find((person) => person?.key !== args.viewerId) ?? people[0];
    return {
      id: args.conversationId,
      name: conversation.isGroup ? (conversation.title ?? 'Group') : (other?.displayName ?? 'Direct message'),
      isGroup: conversation.isGroup,
      memberCount: people.length,
      memberNames: people.map((person) => person!.displayName),
      avatarColor: conversation.isGroup ? conversation.accent : (other?.color ?? conversation.accent),
    };
  },
});

export const listMessages = query({
  args: { conversationId: v.string(), viewerId: v.string() },
  handler: async (ctx, args) => {
    const messages = await ctx.db.query('messages').withIndex('by_conversation_created', (q) => q.eq('conversationKey', args.conversationId)).order('asc').take(200);
    return Promise.all(messages.map(async (message) => {
      const sender = await userByKey(ctx, message.senderKey);
      let replyTo;
      if (message.replyToKey) {
        const replied = await ctx.db.query('messages').withIndex('by_key', (q) => q.eq('key', message.replyToKey!)).unique();
        const replySender = replied ? await userByKey(ctx, replied.senderKey) : null;
        if (replied) replyTo = { id: replied.key, senderName: replySender?.displayName ?? 'Unknown', preview: replied.text || 'Photo' };
      }
      const rawReactions = await ctx.db.query('reactions').withIndex('by_message', (q) => q.eq('messageKey', message.key)).collect();
      const reactions: Array<{ emoji: string; count: number; reactedByViewer: boolean }> = [];
      for (const reaction of rawReactions) {
        const existing = reactions.find((entry) => entry.emoji === reaction.emoji);
        if (existing) {
          existing.count += 1;
          if (reaction.userKey === args.viewerId) existing.reactedByViewer = true;
        } else {
          reactions.push({ emoji: reaction.emoji, count: 1, reactedByViewer: reaction.userKey === args.viewerId });
        }
      }
      const imageUrl = message.imageStorageId ? await ctx.storage.getUrl(message.imageStorageId) : message.seedImageUrl;
      return {
        id: message.key,
        conversationId: message.conversationKey,
        senderId: message.senderKey,
        senderName: sender?.displayName ?? 'Unknown',
        senderColor: sender?.color ?? '#777777',
        text: message.text,
        createdAt: message.createdAt,
        ...(imageUrl ? { imageUrl } : {}),
        ...(replyTo ? { replyTo } : {}),
        reactions,
      };
    }));
  },
});

export const sendMessage = mutation({
  args: {
    conversationId: v.string(),
    senderId: v.string(),
    text: v.string(),
    replyToId: v.optional(v.string()),
    imageStorageId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db.query('conversationMembers').withIndex('by_conversation_user', (q) => q.eq('conversationKey', args.conversationId).eq('userKey', args.senderId)).unique();
    if (!membership) throw new Error('sender is not a conversation member');
    const text = args.text.trim();
    if (!text && !args.imageStorageId) throw new Error('message or image is required');
    if (args.replyToId) {
      const replied = await ctx.db.query('messages').withIndex('by_key', (q) => q.eq('key', args.replyToId!)).unique();
      if (!replied || replied.conversationKey !== args.conversationId) throw new Error('reply target is outside this conversation');
    }
    const key = `msg_${crypto.randomUUID()}`;
    await ctx.db.insert('messages', {
      key,
      conversationKey: args.conversationId,
      senderKey: args.senderId,
      text,
      ...(args.replyToId ? { replyToKey: args.replyToId } : {}),
      ...(args.imageStorageId ? { imageStorageId: args.imageStorageId } : {}),
      createdAt: Date.now(),
    });
    return key;
  },
});

export const toggleReaction = mutation({
  args: { conversationId: v.string(), messageId: v.string(), userId: v.string(), emoji: v.string() },
  handler: async (ctx, args) => {
    const message = await ctx.db.query('messages').withIndex('by_key', (q) => q.eq('key', args.messageId)).unique();
    if (!message || message.conversationKey !== args.conversationId) throw new Error('message is outside this conversation');
    const existing = await ctx.db.query('reactions').withIndex('by_message_user', (q) => q.eq('messageKey', args.messageId).eq('userKey', args.userId)).unique();
    if (existing?.emoji === args.emoji) {
      await ctx.db.delete(existing._id);
      return 'removed';
    }
    if (existing) {
      await ctx.db.patch(existing._id, { emoji: args.emoji });
      return 'changed';
    }
    await ctx.db.insert('reactions', {
      key: `reaction_${crypto.randomUUID()}`,
      conversationKey: args.conversationId,
      messageKey: args.messageId,
      userKey: args.userId,
      emoji: args.emoji,
    });
    return 'added';
  },
});
