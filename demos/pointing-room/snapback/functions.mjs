// Pointing Room functions.
//
// The disclosure boundary is deliberately a JS live query over two tables:
// votes are never published in their stored shape. The caller receives a
// computed row whose value is null until the current round is revealed, except
// for the caller's own vote.
//
// @ref LLP 0005#design-implications — authorization and sync cannot be a
//   frontend-only visual filter.
// @ref LLP 0108#result-contract-vocabulary — the computed nullable row is a
//   closed results.records contract, not an inferred or stored document.

import {
  defineJsLiveQuery,
  defineJsMutation,
  results,
  v,
} from '../../_kit/define.mjs';

export const liveRound = defineJsLiveQuery({
  auth: 'authenticated',
  args: { roomId: v.id('rooms') },
  result: results.documents('rounds'),
  reads: ['rounds'],
  handler: async (ctx, args) => {
    const rounds = await ctx.db
      .query('rounds')
      .withIndex('by_room_sequence')
      .eq('roomId', args.roomId)
      .order('sequence', 'desc')
      .take(1)
      .collect();
    return rounds;
  },
});

export const liveTally = defineJsLiveQuery({
  auth: 'authenticated',
  args: { roomId: v.id('rooms') },
  result: results.records(v.object({
    roomId: v.id('rooms'),
    roundId: v.id('rounds'),
    userId: v.principal(),
    hasVoted: v.boolean(),
    value: v.union([v.string(), v.null()]),
  })),
  // @ref LLP 0231#d3--composed-into-the-plan-sized-by-a-plan-class-model —
  //   this interim residual is handler-enforced and projected as not proven.
  fieldBoundary: {
    fields: ['value'],
    condition: 'the round is revealed or the caller owns the vote',
  },
  reads: ['rounds', 'votes'],
  handler: async (ctx, args) => {
    const rounds = await ctx.db
      .query('rounds')
      .withIndex('by_room_sequence')
      .eq('roomId', args.roomId)
      .order('sequence', 'desc')
      .take(1)
      .collect();
    const round = rounds[0];
    if (!round) return [];
    const votes = await ctx.db
      .query('votes')
      .withIndex('by_room_round')
      .eq('roomId', args.roomId)
      .eq('roundId', round._id)
      .take(512)
      .collect();
    return votes.map((vote) => ({
      roomId: vote.roomId,
      roundId: vote.roundId,
      userId: vote.userId,
      hasVoted: true,
      value: round.revealed || vote.userId === ctx.auth.userId ? vote.value : null,
    }));
  },
});

export const startRound = defineJsMutation({
  auth: 'authenticated',
  args: { roomId: v.id('rooms'), topic: v.string() },
  result: results.value(v.id('rounds')),
  refusals: ['TOPIC_REQUIRED', 'ROOM_NOT_FOUND'],
  reads: ['rooms', 'rounds'],
  writes: ['rounds'],
  handler: async (ctx, args) => {
    const topic = args.topic.trim();
    if (!topic) ctx.refuse('TOPIC_REQUIRED');
    const room = await ctx.db.get('rooms', args.roomId);
    if (!room) ctx.refuse('ROOM_NOT_FOUND');
    const prior = await ctx.db
      .query('rounds')
      .withIndex('by_room_sequence')
      .eq('roomId', args.roomId)
      .order('sequence', 'desc')
      .take(1)
      .collect();
    return await ctx.db.insert('rounds', {
      roomId: args.roomId,
      topic,
      sequence: (prior[0]?.sequence ?? 0) + 1,
      revealed: false,
    });
  },
});

export const castVote = defineJsMutation({
  auth: 'authenticated',
  args: {
    roundId: v.id('rounds'),
    value: v.union([
      v.literal('1'),
      v.literal('2'),
      v.literal('3'),
      v.literal('5'),
      v.literal('8'),
      v.literal('13'),
      v.literal('?'),
    ]),
  },
  result: results.value(v.id('votes')),
  refusals: ['ROUND_NOT_FOUND', 'ROUND_REVEALED'],
  reads: ['rounds', 'votes'],
  writes: ['votes'],
  handler: async (ctx, args) => {
    const round = await ctx.db.get('rounds', args.roundId);
    if (!round) ctx.refuse('ROUND_NOT_FOUND');
    if (round.revealed) ctx.refuse('ROUND_REVEALED', { roundId: round._id });
    const existing = await ctx.db
      .query('votes')
      .withIndex('by_round_user')
      .eq('roundId', round._id)
      .eq('userId', ctx.auth.userId)
      .first();
    if (existing) {
      await ctx.db.patch('votes', existing._id, { value: args.value });
      return existing._id;
    }
    return await ctx.db.insert('votes', {
      roundId: round._id,
      roomId: round.roomId,
      userId: ctx.auth.userId,
      value: args.value,
    });
  },
});

export const revealRound = defineJsMutation({
  auth: 'authenticated',
  args: { roundId: v.id('rounds') },
  result: results.value(v.null()),
  refusals: ['ROUND_NOT_FOUND'],
  reads: ['rounds'],
  writes: ['rounds'],
  handler: async (ctx, args) => {
    const round = await ctx.db.get('rounds', args.roundId);
    if (!round) ctx.refuse('ROUND_NOT_FOUND');
    if (!round.revealed) {
      await ctx.db.patch('rounds', round._id, { revealed: true });
    }
    return null;
  },
});
