import {
  defineJsLiveQuery,
  defineJsMutation,
  results,
  v,
} from '@expo/snapback-codegen/define';

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
