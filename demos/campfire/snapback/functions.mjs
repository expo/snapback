// Campfire functions. The register group's two live children are declarative
// (`defineLiveQuery`) rather than JS-handler live queries: the served route
// admission derives `$param` types only from schema-derived declarative
// plans (`function_route_arg_types` in src/bundle.rs), so a parameterized
// register-eligible route currently requires declarative children — a JS
// live child behind `$param` is refused at `ensureApp` even though codegen
// marks the route `registerGroupEligible` (recorded as a filed seam; see
// issues/20260731-0112-register-eligibility-js-param-seam.md). The derived
// room summary the paired arms contract therefore stays a JS query for
// callable parity while the React arm derives its live summary from the two
// live children.

import {
  arg,
  asc,
  defineJsMutation,
  defineJsQuery,
  defineLiveQuery,
  eq,
  results,
  v,
} from '../../_kit/define.mjs';

export const liveMessages = defineLiveQuery({
  table: 'messages',
  args: { roomId: v.id('rooms') },
  filter: [eq('roomId', arg('roomId'))],
  order: [asc('sequence')],
  index: 'by_room_sequence',
});

export const liveReactions = defineLiveQuery({
  table: 'reactions',
  args: { roomId: v.id('rooms') },
  filter: [eq('roomId', arg('roomId'))],
  index: 'by_room',
});

export const roomSummary = defineJsQuery({
  args: { roomId: v.id('rooms') },
  result: results.records(v.object({
    roomId: v.id('rooms'),
    name: v.string(),
    messageCount: v.integer(),
    reactionCount: v.integer(),
    participants: v.array(v.string(), { maxItems: 1024 }),
  }), { minItems: 0, maxItems: 1 }),
  reads: ['rooms', 'messages', 'reactions'],
  handler: async (ctx, args) => {
    const room = await ctx.db.get('rooms', args.roomId);
    if (!room) return [];
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_room_sequence')
      .eq('roomId', args.roomId)
      .order('sequence', 'asc')
      .collect();
    const reactions = await ctx.db
      .query('reactions')
      .withIndex('by_room')
      .eq('roomId', args.roomId)
      .collect();
    const participants = [];
    for (const message of messages) {
      if (!participants.includes(message.author)) participants.push(message.author);
    }
    participants.sort();
    return [{
      roomId: room._id,
      name: room.name,
      messageCount: messages.length,
      reactionCount: reactions.length,
      participants,
    }];
  },
});

export const messagePage = defineJsQuery({
  args: {
    roomId: v.id('rooms'),
    beforeSequence: v.optional(v.integer()),
    limit: v.integer(),
  },
  result: results.documents('messages'),
  reads: ['messages'],
  handler: async (ctx, args) => {
    if (args.limit < 1 || args.limit > 50) {
      throw new Error('page limit must be between 1 and 50');
    }
    const page = ctx.db
      .query('messages')
      .withIndex('by_room_sequence')
      .eq('roomId', args.roomId);
    if (args.beforeSequence !== undefined) {
      page.lt('sequence', args.beforeSequence);
    }
    return await page
      .order('sequence', 'desc')
      .take(args.limit)
      .collect();
  },
});

export const sendMessage = defineJsMutation({
  args: {
    roomId: v.id('rooms'),
    author: v.string(),
    body: v.string(),
  },
  result: results.value(v.object({
    messageId: v.id('messages'),
    sequence: v.integer(),
  })),
  reads: ['rooms', 'messages'],
  writes: ['messages'],
  handler: async (ctx, args) => {
    const body = String(args.body ?? '').trim();
    const author = String(args.author ?? '').trim();
    if (!body) throw new Error('message body is required');
    if (!author) throw new Error('message author is required');
    const room = await ctx.db.get('rooms', args.roomId);
    if (!room) throw new Error('room not found');
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_room_sequence')
      .eq('roomId', args.roomId)
      .order('sequence', 'asc')
      .collect();
    const sequence = messages.reduce(
      (maximum, message) => (message.sequence > maximum ? message.sequence : maximum),
      0,
    ) + 1;
    const messageId = await ctx.db.insert('messages', {
      roomId: room._id,
      sequence,
      author,
      body,
    });
    return { messageId, sequence };
  },
});

export const toggleReaction = defineJsMutation({
  args: {
    roomId: v.id('rooms'),
    messageId: v.id('messages'),
    emoji: v.string(),
    userKey: v.string(),
  },
  result: results.value(v.object({
    active: v.boolean(),
    reactionId: v.id('reactions'),
  })),
  reads: ['messages', 'reactions'],
  writes: ['reactions'],
  handler: async (ctx, args) => {
    const message = await ctx.db.get('messages', args.messageId);
    if (!message || message.roomId !== args.roomId) {
      throw new Error('message not found in room');
    }
    const reactions = await ctx.db
      .query('reactions')
      .withIndex('by_message')
      .eq('messageId', args.messageId)
      .collect();
    const existing = reactions.find((reaction) =>
      reaction.emoji === args.emoji && reaction.userKey === args.userKey);
    if (existing) {
      await ctx.db.delete('reactions', existing._id);
      return { active: false, reactionId: existing._id };
    }
    const reactionId = await ctx.db.insert('reactions', {
      roomId: args.roomId,
      messageId: args.messageId,
      emoji: args.emoji,
      userKey: args.userKey,
    });
    return { active: true, reactionId };
  },
});
