// Asset conformance fixture handlers. `createPhoto` is the guide's
// transcluded attach example; `forgePhoto` proves the commit hook refuses a
// raw id-shaped string on the handler path.
globalThis.__snapbackHandlers = {
  async createWorkspace(ctx, args) {
    return await ctx.membership.workspaceMembers.bootstrap({
      name: String(args.name ?? '').trim(),
      createdBy: ctx.auth.userId,
    });
  },

  async addMember(ctx, args) {
    return await ctx.membership.workspaceMembers.insert({
      workspaceId: args.workspaceId,
      userId: args.userId,
      role: 'member',
    });
  },

  async leaveWorkspace(ctx, args) {
    await ctx.membership.workspaceMembers.removeSelf(args.workspaceId);
    return null;
  },

  async recordAssetReady(ctx, args) {
    return await ctx.db.insert('assetCallbackLog', {
      assetId: args.assetId,
      event: args.event,
      actorId: ctx.auth.userId,
      actorKind: ctx.auth.actorKind,
      provider: ctx.auth.provider,
      sessionId: ctx.auth.sessionId,
    });
  },

  async listAssetCallbackLog(ctx) {
    return await ctx.db.query('assetCallbackLog').collect();
  },

  async createPhoto(ctx, args) {
    return await ctx.db.insert('photos', {
      caption: String(args.caption ?? '').trim(),
      image: await ctx.assets.attach(args.assetId, { upload: 'photoUpload' }),
    });
  },

  async clearPhoto(ctx, args) {
    await ctx.db.patch('photos', args.id, { image: null });
    return null;
  },

  async forgePhoto(ctx, args) {
    // Deliberately no attach: the raw string must fail the commit with
    // SNAPBACK_ASSET_REF_UNVERIFIED (LLP 0044 §Typed references).
    return await ctx.db.insert('photos', {
      caption: String(args.caption ?? '').trim(),
      image: args.assetId,
    });
  },

};
