import {
  defineAssetUpload,
  defineJsLiveQuery,
  defineJsMutation,
  results,
  v,
} from '../../../_kit/define.mjs';

const reactionResult = v.object({
  emoji: v.string(),
  count: v.integer(),
  reactedByViewer: v.boolean(),
});

// @ref LLP 0044#generated-upload-intents — media bounds, transformations,
// delivery, and attachment ownership travel in one generated upload contract.
export const messageImageUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png'], maxBytes: 10_000_000 },
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  image: {
    location: 'strip',
    variants: [
      { key: 'thumb', width: 160, required: true },
      { key: 'display', width: 960, required: true },
    ],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});

export const listInbox = defineJsLiveQuery({
  auth: 'public',
  args: { viewerId: v.id('users') },
  reads: ['users', 'conversations', 'conversationMembers', 'messages'],
  result: results.records(v.object({
    id: v.string(),
    name: v.string(),
    isGroup: v.boolean(),
    memberCount: v.integer(),
    memberNames: v.array(v.string(), { maxItems: 32 }),
    avatarColor: v.string(),
    lastMessage: v.string(),
    lastMessageAt: v.integer(),
    unreadCount: v.integer(),
  })),
  handler: async (ctx, args) => {
    const mine = await ctx.db
      .query('conversationMembers')
      .withIndex('by_user')
      .eq('userId', args.viewerId)
      .take(64)
      .collect();
    const inbox = [];
    for (const membership of mine) {
      const conversation = await ctx.db.get('conversations', membership.conversationId);
      if (!conversation) continue;
      const members = await ctx.db
        .query('conversationMembers')
        .withIndex('by_conversation')
        .eq('conversationId', membership.conversationId)
        .take(32)
        .collect();
      const people = [];
      for (const member of members) {
        const person = await ctx.db.get('users', member.userId);
        if (person) people.push({ id: member.userId, name: person.displayName, color: person.color });
      }
      const recent = await ctx.db
        .query('messages')
        .withIndex('by_conversation_created')
        .eq('conversationId', membership.conversationId)
        .order('createdAt', 'desc')
        .take(100)
        .collect();
      const latest = recent.at(0);
      const other = people.find((person) => person.id !== args.viewerId) ?? people.at(0);
      const unreadCount = recent.filter((message) => message.createdAt > membership.lastReadAt && message.senderId !== args.viewerId).length;
      inbox.push({
        id: membership.conversationId,
        name: conversation.isGroup ? (conversation.title ?? 'Group') : (other?.name ?? 'Direct message'),
        isGroup: conversation.isGroup,
        memberCount: people.length,
        memberNames: people.map((person) => person.name),
        avatarColor: conversation.isGroup ? conversation.accent : (other?.color ?? conversation.accent),
        lastMessage: latest ? (latest.text || 'Photo') : 'No messages yet',
        lastMessageAt: latest?.createdAt ?? 0,
        unreadCount,
      });
    }
    inbox.sort((left, right) => right.lastMessageAt - left.lastMessageAt);
    return inbox;
  },
});

export const getConversation = defineJsLiveQuery({
  auth: 'public',
  args: { conversationId: v.id('conversations'), viewerId: v.id('users') },
  reads: ['users', 'conversations', 'conversationMembers'],
  result: results.records(v.object({
    id: v.string(),
    name: v.string(),
    isGroup: v.boolean(),
    memberCount: v.integer(),
    memberNames: v.array(v.string(), { maxItems: 32 }),
    avatarColor: v.string(),
  })),
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get('conversations', args.conversationId);
    if (!conversation) return [];
    const members = await ctx.db
      .query('conversationMembers')
      .withIndex('by_conversation')
      .eq('conversationId', args.conversationId)
      .take(32)
      .collect();
    const people = [];
    for (const member of members) {
      const person = await ctx.db.get('users', member.userId);
      if (person) people.push({ id: member.userId, name: person.displayName, color: person.color });
    }
    const other = people.find((person) => person.id !== args.viewerId) ?? people.at(0);
    return [{
      id: args.conversationId,
      name: conversation.isGroup ? (conversation.title ?? 'Group') : (other?.name ?? 'Direct message'),
      isGroup: conversation.isGroup,
      memberCount: people.length,
      memberNames: people.map((person) => person.name),
      avatarColor: conversation.isGroup ? conversation.accent : (other?.color ?? conversation.accent),
    }];
  },
});

export const listMessages = defineJsLiveQuery({
  auth: 'public',
  args: { conversationId: v.id('conversations'), viewerId: v.id('users') },
  reads: ['users', 'messages', 'reactions'],
  result: results.records(v.object({
    id: v.string(),
    conversationId: v.string(),
    senderId: v.string(),
    senderName: v.string(),
    senderColor: v.string(),
    text: v.string(),
    createdAt: v.integer(),
    imageAssetId: v.optional(v.string()),
    seedImageUrl: v.optional(v.string()),
    replyTo: v.optional(v.object({
      id: v.string(),
      senderName: v.string(),
      preview: v.string(),
    })),
    reactions: v.array(reactionResult, { maxItems: 16 }),
  })),
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_conversation_created')
      .eq('conversationId', args.conversationId)
      .order('createdAt', 'asc')
      .take(200)
      .collect();
    const output = [];
    for (const message of messages) {
      const sender = await ctx.db.get('users', message.senderId);
      let replyTo;
      if (message.replyToId) {
        const replied = await ctx.db.get('messages', message.replyToId);
        const replySender = replied ? await ctx.db.get('users', replied.senderId) : null;
        if (replied) {
          replyTo = {
            id: replied._id,
            senderName: replySender?.displayName ?? 'Unknown',
            preview: replied.text || 'Photo',
          };
        }
      }
      const rawReactions = await ctx.db
        .query('reactions')
        .withIndex('by_message')
        .eq('messageId', message._id)
        .take(100)
        .collect();
      const summaries = [];
      for (const reaction of rawReactions) {
        const existing = summaries.find((entry) => entry.emoji === reaction.emoji);
        if (existing) {
          existing.count += 1;
          if (reaction.userId === args.viewerId) existing.reactedByViewer = true;
        } else {
          summaries.push({
            emoji: reaction.emoji,
            count: 1,
            reactedByViewer: reaction.userId === args.viewerId,
          });
        }
      }
      const row = {
        id: message._id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderName: sender?.displayName ?? 'Unknown',
        senderColor: sender?.color ?? '#777777',
        text: message.text,
        createdAt: message.createdAt,
        reactions: summaries,
      };
      if (message.image) row.imageAssetId = message.image;
      if (message.seedImageUrl) row.seedImageUrl = message.seedImageUrl;
      if (replyTo) row.replyTo = replyTo;
      output.push(row);
    }
    return output;
  },
});

export const sendMessage = defineJsMutation({
  auth: 'authenticated',
  args: {
    conversationId: v.id('conversations'),
    senderId: v.id('users'),
    text: v.string(),
    replyToId: v.optional(v.id('messages')),
    imageAssetId: v.optional(v.string()),
  },
  reads: ['conversationMembers', 'messages'],
  writes: ['messages'],
  result: results.value(v.id('messages')),
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query('conversationMembers')
      .withIndex('by_conversation_user')
      .eq('conversationId', args.conversationId)
      .eq('userId', args.senderId)
      .first();
    if (!membership) throw new Error('sender is not a conversation member');
    const text = String(args.text ?? '').trim();
    if (!text && !args.imageAssetId) throw new Error('message or image is required');
    if (args.replyToId) {
      const replied = await ctx.db.get('messages', args.replyToId);
      if (!replied || replied.conversationId !== args.conversationId) {
        throw new Error('reply target is outside this conversation');
      }
    }
    const values = {
      conversationId: args.conversationId,
      senderId: args.senderId,
      text,
      createdAt: ctx.runtime.now(),
    };
    if (args.replyToId) values.replyToId = args.replyToId;
    if (args.imageAssetId) {
      values.image = await ctx.assets.attach(args.imageAssetId, { upload: 'messageImageUpload' });
    }
    return await ctx.db.insert('messages', values);
  },
});

export const toggleReaction = defineJsMutation({
  auth: 'public',
  args: {
    conversationId: v.id('conversations'),
    messageId: v.id('messages'),
    userId: v.id('users'),
    emoji: v.string(),
  },
  reads: ['messages', 'reactions'],
  writes: ['reactions'],
  result: results.value(v.object({ reacted: v.boolean(), emoji: v.string() })),
  handler: async (ctx, args) => {
    const message = await ctx.db.get('messages', args.messageId);
    if (!message || message.conversationId !== args.conversationId) throw new Error('message not found');
    const existing = await ctx.db
      .query('reactions')
      .withIndex('by_message_user')
      .eq('messageId', args.messageId)
      .eq('userId', args.userId)
      .first();
    if (existing?.emoji === args.emoji) {
      await ctx.db.delete('reactions', existing._id);
      return { reacted: false, emoji: args.emoji };
    }
    if (existing) {
      await ctx.db.patch('reactions', existing._id, { emoji: args.emoji });
    } else {
      await ctx.db.insert('reactions', {
        conversationId: args.conversationId,
        messageId: args.messageId,
        userId: args.userId,
        emoji: args.emoji,
      });
    }
    return { reacted: true, emoji: args.emoji };
  },
});
