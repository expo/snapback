globalThis.__snapbackHandlers = {
  async joinApp(ctx) {
    await ctx.membership.appMembers.insert({
      userId: ctx.auth.userId,
      role: 'member',
    });
    return null;
  },

  async inviteApp(ctx, args) {
    await ctx.membership.appMembers.insert({
      userId: args.userId,
      role: 'invited',
    });
    return null;
  },

  async acceptInvite(ctx) {
    await ctx.membership.appMembers.setSelfRole('member');
    return null;
  },

  async leaveApp(ctx) {
    await ctx.membership.appMembers.removeSelf();
    return null;
  },

  async postAnnouncement(ctx, args) {
    await ctx.permissions.appMembers.requireRole(null, 'member', 'admin');
    return await ctx.db.insert('announcements', {
      authorId: ctx.auth.userId,
      message: args.message,
    });
  },

  async rawJoin(ctx) {
    return await ctx.db.insert('appMembers', {
      userId: ctx.auth.userId,
      role: 'member',
    });
  },
};
