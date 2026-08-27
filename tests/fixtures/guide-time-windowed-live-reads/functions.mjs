import {
  defineJsLiveQuery,
  defineJsMutation,
  results,
  v,
} from '@expo/snapback-codegen/define';

// @ref LLP 0053#the-authorization-event-universe-closed — Protected reads pin
// clock input; mutations materialize server time as database facts.
export const eventsVisibleAtPinnedClock = defineJsLiveQuery({
  args: { clockMs: v.integer(), windowMs: v.integer() },
  result: results.documents('events'),
  auth: 'authenticated',
  reads: ['events'],
  handler: async (ctx, args) => {
    const cutoffMs = args.clockMs - args.windowMs;
    const rows = await ctx.db.query('events').take(1_024).collect();
    return rows.filter((row) => (
      row.createdAt >= cutoffMs && row.createdAt <= args.clockMs
    ));
  },
});

export const insertServerTimedEvent = defineJsMutation({
  args: { label: v.string() },
  result: results.value(v.id('events')),
  auth: 'authenticated',
  reads: [],
  writes: ['events'],
  handler: async (ctx, args) => ctx.db.insert('events', {
    label: args.label,
    createdAt: ctx.runtime.now(),
  }),
});

export const typingLeasesExpiringSoon = defineJsLiveQuery({
  args: { clockMs: v.integer(), soonWithinMs: v.integer() },
  result: results.documents('typingLeases'),
  auth: 'authenticated',
  reads: ['typingLeases'],
  handler: async (ctx, args) => {
    const soonHorizonMs = args.clockMs + args.soonWithinMs;
    const rows = await ctx.db.query('typingLeases').take(1_024).collect();
    return rows.filter((row) => (
      row.expiresAt > args.clockMs && row.expiresAt <= soonHorizonMs
    ));
  },
});

export const renewTypingLease = defineJsMutation({
  args: { typerLabel: v.string() },
  result: results.value(v.id('typingLeases')),
  auth: 'authenticated',
  reads: ['typingLeases'],
  writes: ['typingLeases'],
  handler: async (ctx, args) => {
    const expiresAt = ctx.runtime.now() + 5_000;
    const existing = await ctx.db.query('typingLeases')
      .withIndex('by_owner_and_typer')
      .eq('ownerId', ctx.auth.userId)
      .eq('typerLabel', args.typerLabel)
      .first();
    if (existing) {
      await ctx.db.patch('typingLeases', existing._id, { expiresAt });
      return existing._id;
    }
    return ctx.db.insert('typingLeases', {
      typerLabel: args.typerLabel,
      expiresAt,
    });
  },
});
