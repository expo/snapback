const PAGE_LIMIT = 25;

function requiredText(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

async function channel(ctx, channelId) {
  const row = await ctx.db.get('channels', channelId);
  if (!row) throw new Error('channel not found');
  return row;
}

async function requireAccess(ctx, channelId) {
  const row = await channel(ctx, channelId);
  if (row.visibility === 'private') {
    await ctx.permissions.channelMembers.requireRole(channelId, 'owner', 'member');
  }
  return row;
}

async function profile(ctx) {
  const rows = await ctx.db
    .query('profiles')
    .withIndex('by_user')
    .eq('userId', ctx.auth.userId)
    .collect();
  const row = rows[0];
  if (!row) throw new Error('authenticated profile not found');
  return row;
}

globalThis.__snapbackHandlers = {
  async listChannels(ctx) {
    const channels = await ctx.db.query('channels').withIndex('by_slug').collect();
    const views = await ctx.db
      .query('channelViews')
      .withIndex('by_user_channel')
      .eq('userId', ctx.auth.userId)
      .collect();
    const visibleIds = new Set(views.map((row) => row.channelId));
    return channels
      .filter((row) => row.visibility === 'public' || visibleIds.has(row._id))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  },

  async listMessages(ctx, args) {
    await requireAccess(ctx, args.channelId);
    return await ctx.db
      .query('messages')
      .withIndex('by_channel_sequence')
      .eq('channelId', args.channelId)
      .order('sequence', 'desc')
      .collect();
  },

  async pageMessages(ctx, args) {
    await requireAccess(ctx, args.channelId);
    if (args.limit !== PAGE_LIMIT) throw new Error('frozen page limit is 25');
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_channel_sequence')
      .eq('channelId', args.channelId)
      .order('sequence', 'desc')
      .collect();
    const before = args.beforeSequence ?? Number.MAX_SAFE_INTEGER;
    return rows.filter((row) => row.sequence < before).slice(0, PAGE_LIMIT);
  },

  async listReadMarkers(ctx) {
    return await ctx.db
      .query('readMarkers')
      .withIndex('by_user_channel')
      .eq('userId', ctx.auth.userId)
      .collect();
  },

  async bootstrapChannel(ctx, args) {
    const slug = requiredText(args.slug, 'slug');
    const name = requiredText(args.name, 'channel name');
    if (!['public', 'private'].includes(args.visibility)) {
      throw new Error('visibility must be public or private');
    }
    const now = ctx.runtime.now();
    const channelId = await ctx.membership.channelMembers.bootstrap({
      slug,
      name,
      visibility: args.visibility,
      createdBy: ctx.auth.userId,
      createdAt: now,
      nextSequence: 126,
    });
    await ctx.db.insert('channelViews', {
      channelId,
      userId: ctx.auth.userId,
    });
    const existingProfiles = await ctx.db.query('profiles').withIndex('by_user').collect();
    if (!existingProfiles.some((row) => row.userId === ctx.auth.userId)) {
      await ctx.db.insert('profiles', {
        userId: ctx.auth.userId,
        displayName: 'Alice',
      });
    }
    if (!existingProfiles.some((row) => row.userId === args.bobId)) {
      await ctx.db.insert('profiles', {
        userId: args.bobId,
        displayName: 'Bob',
      });
    }
    for (let sequence = 1; sequence <= 125; sequence += 1) {
      const bob = sequence % 2 === 0;
      await ctx.db.insert('messages', {
        channelId,
        sequence,
        authorId: bob ? args.bobId : ctx.auth.userId,
        authorName: bob ? 'Bob' : 'Alice',
        body: `${slug} seeded message ${sequence}`,
        sentAt: 1_700_000_000_000 + sequence,
      });
    }
    await ctx.db.insert('readMarkers', {
      channelId,
      userId: ctx.auth.userId,
      lastReadSequence: 125,
    });
    await ctx.db.insert('readMarkers', {
      channelId,
      userId: args.bobId,
      lastReadSequence: 125,
    });
    return channelId;
  },

  async addMember(ctx, args) {
    await ctx.permissions.channelMembers.requireRole(args.channelId, 'owner');
    await ctx.membership.channelMembers.insert({
      channelId: args.channelId,
      userId: args.userId,
      role: 'member',
    });
    await ctx.db.insert('channelViews', {
      channelId: args.channelId,
      userId: args.userId,
    });
    return null;
  },

  async leaveChannel(ctx, args) {
    await ctx.membership.channelMembers.removeSelf(args.channelId);
    const views = await ctx.db
      .query('channelViews')
      .withIndex('by_user_channel')
      .eq('userId', ctx.auth.userId)
      .eq('channelId', args.channelId)
      .collect();
    for (const view of views) await ctx.db.delete('channelViews', view._id);
    return null;
  },

  async sendMessage(ctx, args) {
    const room = await requireAccess(ctx, args.channelId);
    const author = await profile(ctx);
    const body = requiredText(args.body, 'message');
    if (body.length > 2_000) throw new Error('message exceeds 2000 characters');
    const sequence = room.nextSequence;
    const sentAt = ctx.runtime.now();
    const id = await ctx.db.insert('messages', {
      channelId: room._id,
      sequence,
      authorId: ctx.auth.userId,
      authorName: author.displayName,
      body,
      sentAt,
    });
    await ctx.db.patch('channels', room._id, { nextSequence: sequence + 1 });
    return { id, sequence, authorId: ctx.auth.userId, authorName: author.displayName, sentAt };
  },

  async markRead(ctx, args) {
    const room = await requireAccess(ctx, args.channelId);
    if (args.sequence < 0 || args.sequence >= room.nextSequence) {
      throw new Error('read sequence is outside channel history');
    }
    const rows = await ctx.db
      .query('readMarkers')
      .withIndex('by_user_channel')
      .eq('userId', ctx.auth.userId)
      .eq('channelId', args.channelId)
      .collect();
    const marker = rows[0];
    if (!marker) {
      return await ctx.db.insert('readMarkers', {
        channelId: args.channelId,
        userId: ctx.auth.userId,
        lastReadSequence: args.sequence,
      });
    }
    await ctx.db.patch('readMarkers', marker._id, {
      lastReadSequence: Math.max(marker.lastReadSequence, args.sequence),
    });
    return marker._id;
  },
};
