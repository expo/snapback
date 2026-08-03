globalThis.__snapbackHandlers = {
  async joinAsHost(ctx) {
    await ctx.membership.appMembers.insert({
      principal: ctx.auth.userId,
      role: 'host',
    });
    return null;
  },

  async leaveHost(ctx) {
    await ctx.membership.appMembers.removeSelf();
    return null;
  },

  async sendSelected(ctx, args) {
    return ctx.push.send({
      to: ctx.push.audiences.selectedGuests({
        principalIds: args.principalIds,
      }),
      title: args.title,
      body: args.body,
      data: { fixture: true },
      dedupeKey: args.dedupeKey,
      ...(args.redriveAmbiguous === true ? { redriveAmbiguous: true } : {}),
    });
  },
};
