const RSVP_STATUSES = new Set(['going', 'maybe', 'cant']);

globalThis.__snapbackHandlers = {
  // Members-only event detail. requireRole is the boundary: the denial is
  // invariant and reveals neither event existence nor roster contents.
  async getEvent(ctx, args) {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'guest');
    const event = await ctx.db.get('events', args.eventId);
    if (event === null) throw new Error('event not found');
    // Query handlers return row arrays, even for a point read.
    return [event];
  },

  async createEvent(ctx, args) {
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('event title is required');
    const eventId = await ctx.membership.eventMembers.bootstrap({
      title,
      emoji: args.emoji,
      description: args.description,
      location: args.location,
      startsAt: args.startsAt,
      hostName: args.hostName,
    });
    await ctx.db.insert('invites', {
      eventId,
      userId: ctx.auth.userId,
      guestName: args.hostName,
      status: 'host',
      eventTitle: title,
      eventEmoji: args.emoji,
      eventStartsAt: args.startsAt,
      hostName: args.hostName,
    });
    return eventId;
  },

  async invite(ctx, args) {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host');
    const event = await ctx.db.get('events', args.eventId);
    if (event === null) throw new Error('event not found');
    return await ctx.db.insert('invites', {
      eventId: args.eventId,
      userId: args.userId,
      guestName: args.guestName,
      status: 'invited',
      eventTitle: event.title,
      eventEmoji: event.emoji,
      eventStartsAt: event.startsAt,
      hostName: event.hostName,
    });
  },

  async rsvp(ctx, args) {
    if (!RSVP_STATUSES.has(args.status)) {
      throw new Error('rsvp status must be going, maybe, or cant');
    }
    const mine = (await ctx.db
      .query('invites')
      .withIndex('by_user')
      .eq('userId', ctx.auth.userId)
      .collect())
      .find((row) => row.eventId === args.eventId);
    // Product policy: only invited people can respond. The membership matrix
    // below additionally enforces that the seat is a self-insert as 'guest'.
    if (mine === undefined) throw new Error('you are not invited to this event');
    if (mine.status === 'host') throw new Error('the host is already going');
    if (mine.status === 'invited') {
      await ctx.membership.eventMembers.insert({
        eventId: args.eventId,
        userId: ctx.auth.userId,
        role: 'guest',
      });
    }
    await ctx.db.patch('invites', mine._id, {
      status: args.status,
      ...(args.note === undefined ? {} : { note: args.note }),
    });
    return mine._id;
  },

  async postToWall(ctx, args) {
    await ctx.permissions.eventMembers.requireRole(args.eventId, 'host', 'guest');
    const message = String(args.message ?? '').trim();
    if (!message) throw new Error('message is required');
    return await ctx.db.insert('posts', {
      eventId: args.eventId,
      authorId: ctx.auth.userId,
      authorName: args.authorName,
      message,
    });
  },
};
