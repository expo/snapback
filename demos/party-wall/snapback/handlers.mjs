// Party Wall handlers. `createPost` and `setCover` are the demo's canonical
// `ctx.assets.attach` consumers; everything else is ordinary membership and
// app-data plumbing — no handler re-implements photo authorization, because
// the sharing declaration on the referencing tables owns it.
globalThis.__snapbackHandlers = {
  async createEvent(ctx, args) {
    return await ctx.membership.eventMembers.bootstrap({
      title: String(args.title ?? '').trim(),
      emoji: String(args.emoji ?? '🎉'),
      startsAt: args.startsAt,
      hostName: String(args.hostName ?? '').trim(),
    });
  },

  async getEvent(ctx, args) {
    return await ctx.db.get('events', args.eventId);
  },

  async addGuest(ctx, args) {
    return await ctx.membership.eventMembers.insert({
      eventId: args.eventId,
      userId: args.userId,
      role: 'guest',
    });
  },

  async leaveEvent(ctx, args) {
    await ctx.membership.eventMembers.removeSelf(args.eventId);
    return null;
  },

  async createPost(ctx, args) {
    const postId = await ctx.db.insert('posts', {
      eventId: args.eventId,
      authorId: ctx.auth.userId,
      authorName: String(args.authorName ?? '').trim(),
      caption: String(args.caption ?? '').trim(),
      photoId: args.assetId,
    });
    await ctx.db.insert('photoShares', {
      eventId: args.eventId,
      postId,
      photo: await ctx.assets.attach(args.assetId, { upload: 'photoUpload' }),
    });
    return postId;
  },

  async setCover(ctx, args) {
    await ctx.db.patch('events', args.eventId, {
      cover: await ctx.assets.attach(args.assetId, { upload: 'coverUpload' }),
    });
    return null;
  },

  async deletePost(ctx, args) {
    const shares = await ctx.db
      .query('photoShares')
      .withIndex('by_post', (q) => q.eq('postId', args.postId))
      .collect();
    for (const share of shares) {
      await ctx.db.delete('photoShares', share._id);
    }
    await ctx.db.delete('posts', args.postId);
    return null;
  },
};
