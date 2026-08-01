// Clip Locker handlers: canonical attach + clear for the deletion-truth leg.
globalThis.__snapbackHandlers = {
  async saveClip(ctx, args) {
    return await ctx.db.insert('clips', {
      ownerId: ctx.auth.userId,
      title: String(args.title ?? '').trim(),
      video: await ctx.assets.attach(args.assetId, { upload: 'clipUpload' }),
    });
  },
  async clearClip(ctx, args) {
    await ctx.db.patch('clips', args.clipId, { video: null });
    return null;
  },
};
