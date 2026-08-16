globalThis.__snapbackHandlers = {
  async createApp(ctx, args) {
    return await ctx.membership.appAccess.bootstrap({ name: args.name });
  },

  async postAnnouncement(ctx, args) {
    return await ctx.db.insert('announcements', {
      appId: args.appId,
      authorId: ctx.auth.userId,
      message: args.message,
    });
  },

  async rawJoin(ctx, args) {
    return await ctx.db.insert('appMembers', {
      appId: args.appId,
      userId: ctx.auth.userId,
      role: 'member',
    });
  },
};
