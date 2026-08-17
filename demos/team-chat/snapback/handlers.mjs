const MAX_ACTIVE_RECIPIENTS = 64;
const MAX_ROOM_DELIVERIES_PER_MUTATION = 256;
const MAX_ROOM_MESSAGES = 256;

function requiredText(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

async function myRoomDeliveries(ctx, roomId) {
  return await ctx.db
    .query('deliveriesV2')
    .withIndex('by_recipient_room')
    .eq('recipientId', ctx.auth.userId)
    .eq('roomId', roomId)
    .collect();
}

globalThis.__snapbackHandlers = {
  async createRoom(ctx, args) {
    const title = requiredText(args.title, 'room title');
    const now = ctx.runtime.now();
    return await ctx.membership.roomMembersV2.bootstrap({
      title,
      createdBy: ctx.auth.userId,
      createdAt: now,
    });
  },

  async sendMessage(ctx, args) {
    await ctx.permissions.roomMembersV2.requireRole(args.roomId, 'owner', 'admin', 'member');
    const body = requiredText(args.body, 'message');
    const existingMessages = await ctx.db
      .query('messagesV2')
      .withIndex('by_room_page_key')
      .eq('roomId', args.roomId)
      .collect();
    if (existingMessages.length >= MAX_ROOM_MESSAGES) {
      throw new Error('room message history exceeds the admitted application bound');
    }
    const roster = await ctx.authority.roomMembersV2.list(args.roomId, { limit: 100 });
    const participants = roster.rows;
    if (participants.length === 0 || participants.length > MAX_ACTIVE_RECIPIENTS) {
      throw new Error('room roster exceeds the admitted application bound');
    }
    const now = ctx.runtime.now();
    const messageId = await ctx.db.insert('messagesV2', {
      roomId: args.roomId,
      authorName: ctx.auth.userId,
      body,
      pageKey: ctx.runtime.id(),
      createdAt: now,
    });
    // @ref LLP 0264#d3-owner-inserts-are-host-stamped — generic owner-table
    // insertion may create only the caller's slice. The roster read remains a
    // canonical-authority witness; cross-recipient delivery awaits a governed
    // write-policy sibling and is not simulated here.
    await ctx.db.insert('deliveriesV2', {
      roomId: args.roomId,
      messageId,
      authorId: ctx.auth.userId,
      authorName: ctx.auth.userId,
      body,
      pageKey: ctx.runtime.id(),
      createdAt: now,
      unread: false,
    });
    return { messageId, recipients: 1, rosterSize: participants.length };
  },

  async markRoomRead(ctx, args) {
    await ctx.permissions.roomMembersV2.requireRole(args.roomId, 'owner', 'admin', 'member');
    const deliveries = await myRoomDeliveries(ctx, args.roomId);
    if (deliveries.length > MAX_ROOM_DELIVERIES_PER_MUTATION) {
      throw new Error('room inbox exceeds the bounded mark-read mutation');
    }
    let changed = 0;
    for (const delivery of deliveries) {
      if (!delivery.unread) continue;
      await ctx.db.patch('deliveriesV2', delivery._id, { unread: false });
      changed += 1;
    }
    return { changed };
  },
};
