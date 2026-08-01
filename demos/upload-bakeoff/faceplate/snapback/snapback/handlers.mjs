globalThis.__snapbackHandlers = {
  async createProfile(ctx, args) {
    return await ctx.db.insert('profiles', {
      ownerId: ctx.auth.userId,
      displayName: String(args.displayName ?? '').trim(),
    });
  },
  async setAvatar(ctx, args) {
    await ctx.db.patch('profiles', args.profileId, {
      avatar: await ctx.assets.attach(args.assetId, { upload: 'avatarUpload' }),
    });
    return null;
  },
};
