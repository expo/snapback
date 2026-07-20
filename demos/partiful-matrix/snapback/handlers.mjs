const RSVP_STATUSES = new Set(['going', 'maybe', 'cant']);

globalThis.__snapbackHandlers = {
  async createEvent(ctx, args) {
    const title = String(args.title ?? '').trim();
    const location = String(args.location ?? '').trim();
    if (!title || !location) throw new Error('title and location are required');
    const eventId = await ctx.db.insert('events', {
      title,
      emoji: String(args.emoji || '✨'),
      description: String(args.description ?? '').trim(),
      location,
      startsAt: args.startsAt,
      hostId: ctx.auth.userId,
      hostName: args.hostName,
      accent: args.accent,
    });
    await ctx.db.insert('rsvps', {
      eventId,
      userId: ctx.auth.userId,
      guestName: args.hostName,
      status: 'host',
    });
    return eventId;
  },

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

  async postMessage(ctx, args) {
    const message = String(args.message ?? '').trim();
    if (!message) throw new Error('message is required');
    return await ctx.db.insert('posts', {
      eventId: args.eventId,
      authorId: ctx.auth.userId,
      authorName: args.authorName,
      message,
      createdAt: args.createdAt,
    });
  },
};
