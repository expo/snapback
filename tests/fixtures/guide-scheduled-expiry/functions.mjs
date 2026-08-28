import {
  defineAction,
  defineCron,
  defineJsLiveQuery,
  defineJsMutation,
  results,
  v,
} from '@expo/snapback-codegen/define';

const sweepResult = v.object({
  nowMs: v.integer(),
  examined: v.integer(),
  changed: v.integer(),
  hasMore: v.boolean(),
});

export const linksByExpiry = defineJsLiveQuery({
  args: {},
  result: results.documents('links'),
  auth: 'public',
  reads: ['links'],
  handler: async (ctx) => ctx.db.query('links')
    .withIndex('by_expires_at')
    .order('expiresAt', 'asc')
    .take(100)
    .collect(),
});

// @ref LLP 0028#execution-the-action-class — Keep each scheduled write in one
// bounded mutation so commit, invalidation, and live delivery stay atomic.
export const expireDueLinks = defineJsMutation({
  args: {},
  result: results.value(sweepResult),
  auth: 'public',
  reads: ['links'],
  writes: ['links'],
  handler: async (ctx) => {
    const sweepLimit = 3;
    const nowMs = ctx.runtime.now();
    const candidates = await ctx.db.query('links')
      .withIndex('by_status_and_expires_at')
      .eq('status', 'active')
      .lte('expiresAt', nowMs)
      .order('expiresAt', 'asc')
      .take(sweepLimit + 1)
      .collect();
    const batch = candidates.slice(0, sweepLimit);

    for (const link of batch) {
      await ctx.db.patch('links', link._id, {
        status: 'expired',
        expiredAt: nowMs,
      });
    }

    return {
      nowMs,
      examined: candidates.length,
      changed: batch.length,
      hasMore: candidates.length > sweepLimit,
    };
  },
});

export const runExpirySweep = defineAction({
  args: {},
  result: results.value(sweepResult),
  auth: 'public',
  handler: async (ctx) => ctx.runMutation('expireDueLinks', {}),
});

export const expiryCron = defineCron({
  expireLinks: {
    // This product promises a sweep at each exact minute boundary. Omit
    // jitter:false unless the cadence is itself a product requirement.
    schedule: { everyMs: 60_000, jitter: false },
    action: 'runExpirySweep',
    overlapPolicy: 'NoOverlap',
    retryPolicy: { mode: 'NextTick' },
  },
});
