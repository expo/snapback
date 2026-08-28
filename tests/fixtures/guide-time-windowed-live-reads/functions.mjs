import {
  defineJsLiveQuery,
  defineJsMutation,
  results,
  v,
} from '@expo/snapback-codegen/define';

// @ref LLP 0053#the-authorization-event-universe-closed — Protected reads pin
// clock input; mutations materialize server time as database facts.
// @ref LLP 0004#ctxdb-contract — Window predicates belong in an indexed query
// range, before collection, so an unrelated prefix cannot hide matches.
export const eventsVisibleAtPinnedClock = defineJsLiveQuery({
  args: { clockMs: v.integer(), windowMs: v.integer() },
  result: results.documents('events'),
  auth: 'authenticated',
  reads: ['events'],
  handler: async (ctx, args) => {
    const cutoffMs = args.clockMs - args.windowMs;
    return ctx.db.query('events')
      .withIndex('by_owner_and_created_at')
      .eq('ownerId', ctx.auth.userId)
      .gte('createdAt', cutoffMs)
      .lte('createdAt', args.clockMs)
      .collect();
  },
});

// @ref LLP 0004#ctxdb-contract — The explicit prefix is intentional only
// after the owner/window range and newest-first order define its meaning.
export const mostRecentEventsVisibleAtPinnedClock = defineJsLiveQuery({
  args: { clockMs: v.integer(), windowMs: v.integer(), limit: v.integer() },
  result: results.documents('events'),
  auth: 'authenticated',
  reads: ['events'],
  handler: async (ctx, args) => {
    const cutoffMs = args.clockMs - args.windowMs;
    return ctx.db.query('events')
      .withIndex('by_owner_and_created_at')
      .eq('ownerId', ctx.auth.userId)
      .gte('createdAt', cutoffMs)
      .lte('createdAt', args.clockMs)
      .order('createdAt', 'desc')
      .take(args.limit)
      .collect();
  },
});

// @ref LLP 0264#d3-owner-inserts-are-host-stamped — The owner policy derives
// ownerId from ctx.auth; accepting or supplying an owner value is forbidden.
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
    return ctx.db.query('typingLeases')
      .withIndex('by_owner_and_expires_at')
      .eq('ownerId', ctx.auth.userId)
      .gt('expiresAt', args.clockMs)
      .lte('expiresAt', soonHorizonMs)
      .collect();
  },
});

// @ref LLP 0264#d3-owner-inserts-are-host-stamped — The owner policy derives
// ownerId for a new lease and the unique lookup stays inside that owner.
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
