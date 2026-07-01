// All Aboard JavaScript ctx.db handlers (bundled as source into the function
// manifest). Like every Snapback handler this file avoids imports, process/env,
// timers, and network — the only backend power is the ctx surface.
//
// @ref LLP 0027#feed-refresh-and-cron — applyFeedTick is the single durable write
//   path: it advances the recorded feed one tick and upserts trainStatus +
//   feedRefreshState, so the realtime fan-out (mutation commit -> live delta) runs
//   for free. refreshFeed is the ACTION cron invokes; it commits only via the
//   mutation, keeping any future egress off the transactional path.

globalThis.__snapbackHandlers = {
  async applyFeedTick(ctx, args) {
    // Committed schedule patterns (stable seed ids). The refresh sets each
    // pattern's delay from the current recorded tick; absent => on time.
    const PATTERN_IDS = ['sb-local', 'sb-limited', 'sb-bullet', 'nb-local', 'nb-limited', 'nb-bullet'];
    const nowMs = ctx.runtime && ctx.runtime.now ? ctx.runtime.now() : 0;
    const trigger = (args && args.trigger) || 'manual';

    const state = await ctx.db.get('feedRefreshState', 'caltrain');
    const tickCount = state && state.tickCount ? state.tickCount : 1;
    const currentIndex = state && Number.isInteger(state.tickIndex) ? state.tickIndex : 0;
    const nextIndex = (currentIndex + 1) % Math.max(1, tickCount);

    const tick = await ctx.db.get('feedTicks', `tick-${nextIndex}`);
    const delays = (tick && tick.delays) || {};

    for (const patternId of PATTERN_IDS) {
      const delaySeconds = Number(delays[patternId]) || 0;
      const status = delaySeconds >= 120 ? 'delayed' : 'on-time';
      await ctx.db.patch('trainStatus', patternId, { delaySeconds, status, observedAt: nowMs });
    }

    await ctx.db.patch('feedRefreshState', 'caltrain', {
      fetchedAt: nowMs,
      tickIndex: nextIndex,
      lastSource: 'recorded',
      lastRunTrigger: trigger,
      lastError: '',
    });

    return { tickIndex: nextIndex, note: (tick && tick.note) || '' };
  },

  async resetFeed(ctx) {
    const PATTERN_IDS = ['sb-local', 'sb-limited', 'sb-bullet', 'nb-local', 'nb-limited', 'nb-bullet'];
    const nowMs = ctx.runtime && ctx.runtime.now ? ctx.runtime.now() : 0;
    for (const patternId of PATTERN_IDS) {
      await ctx.db.patch('trainStatus', patternId, { delaySeconds: 0, status: 'on-time', observedAt: nowMs });
    }
    await ctx.db.patch('feedRefreshState', 'caltrain', {
      fetchedAt: nowMs,
      tickIndex: 0,
      lastSource: 'reset',
      lastRunTrigger: 'reset',
      lastError: '',
    });
    return { tickIndex: 0 };
  },

  // The cron-invoked action. v0 advances the recorded feed; Phase 3 would fetch
  // the live Caltrain feed here (egress) before committing through the mutation.
  async refreshFeed(ctx, args) {
    const trigger = (args && args.trigger) || 'cron';
    return await ctx.runMutation('applyFeedTick', { trigger });
  },
};
