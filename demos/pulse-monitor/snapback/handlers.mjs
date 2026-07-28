globalThis.__snapbackHandlers = {
  async applyProbe(ctx, args) {
    const rows = await ctx.db
      .query('serviceState')
      .withIndex('by_service')
      .eq('serviceId', args.serviceId)
      .collect();
    const current = rows[0];
    if (!current) throw new Error('unknown service');
    await ctx.db.patch('serviceState', current._id, {
      status: current.tickCount % 2 === 0 ? 'healthy' : 'degraded',
      tickCount: current.tickCount + 1,
      lastCheckedAt: ctx.runtime.now(),
    });
    return { tickCount: current.tickCount + 1 };
  },

  async probeServices(ctx) {
    return await ctx.runMutation('applyProbe', { serviceId: 'api' });
  },
};
