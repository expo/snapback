const RSVP_STATUSES = new Set(['going', 'maybe', 'cant']);

globalThis.__snapbackHandlers = {
  async rsvp(ctx, args) {
    if (!RSVP_STATUSES.has(args.status)) {
      throw new Error('status must be going, maybe, or cant');
    }
    const existing = (await ctx.db
      .query('rsvps')
      .withIndex('by_event')
      .eq('eventId', args.eventId)
      .collect())
      .find((row) => row.userId === ctx.auth.userId);
    if (existing?.status === 'host') throw new Error('the host is already going');
    if (existing) {
      await ctx.db.patch('rsvps', existing._id, { status: args.status, guestName: args.guestName });
      return existing._id;
    }
    return await ctx.db.insert('rsvps', {
      eventId: args.eventId,
      userId: ctx.auth.userId,
      guestName: args.guestName,
      status: args.status,
    });
  },
};
