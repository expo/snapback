import {
  defineJsLiveQuery,
  results,
  v,
} from '@expo/snapback-codegen/define';

export const eventsVisibleNow = defineJsLiveQuery({
  args: { windowMs: v.integer() },
  result: results.documents('events'),
  auth: 'authenticated',
  reads: ['events'],
  handler: async (ctx, args) => {
    const clockMs = ctx.runtime.now();
    const cutoffMs = clockMs - args.windowMs;
    const rows = await ctx.db.query('events').take(1_024).collect();
    return rows.filter((row) => row.createdAt >= cutoffMs && row.createdAt <= clockMs);
  },
});
