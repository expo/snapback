globalThis.__snapbackHandlers = {
  async createWorkspace(ctx, args) {
    return await ctx.membership.workspaceMembers.bootstrap({
      name: String(args.name ?? '').trim(),
      createdBy: ctx.auth.userId,
    });
  },

  async addMember(ctx, args) {
    await ctx.membership.workspaceMembers.insert({
      workspaceId: args.workspaceId,
      userId: args.userId,
      role: 'member',
    });
    return null;
  },

  async addNote(ctx, args) {
    await ctx.permissions.workspaceMembers.requireRole(
      args.workspaceId,
      'owner',
      'member',
    );
    return await ctx.db.insert('notes', {
      workspaceId: args.workspaceId,
      authorId: ctx.auth.userId,
      body: String(args.body ?? '').trim(),
    });
  },
};
