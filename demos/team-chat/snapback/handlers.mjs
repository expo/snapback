const MAX_ACTIVE_RECIPIENTS = 64;
const MAX_ROOM_DELIVERIES_PER_MUTATION = 256;
const MAX_ROOM_MESSAGES = 256;

function requiredText(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

async function myParticipant(ctx, roomId) {
  return (await ctx.db
    .query('roomParticipants')
    .withIndex('by_user')
    .eq('userId', ctx.auth.userId)
    .collect())
    .find((row) => row.roomId === roomId);
}

async function myRoomDeliveries(ctx, roomId) {
  return await ctx.db
    .query('deliveries')
    .withIndex('by_recipient_room')
    .eq('recipientId', ctx.auth.userId)
    .eq('roomId', roomId)
    .collect();
}

globalThis.__snapbackHandlers = {
  async createRoom(ctx, args) {
    const title = requiredText(args.title, 'room title');
    const displayName = requiredText(args.displayName, 'display name');
    const now = ctx.runtime.now();
    const roomId = await ctx.membership.roomMembers.bootstrap({
      title,
      createdBy: ctx.auth.userId,
      createdAt: now,
    });
    await ctx.db.insert('roomParticipants', {
      roomId,
      userId: ctx.auth.userId,
      displayName,
      status: 'owner',
      changedAt: now,
    });
    return roomId;
  },

  async inviteMember(ctx, args) {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner');
    const displayName = requiredText(args.displayName, 'display name');
    const existing = (await ctx.db
      .query('roomParticipants')
      .withIndex('by_room')
      .eq('roomId', args.roomId)
      .collect())
      .find((row) => row.userId === args.userId);
    if (existing !== undefined && existing.status !== 'left' && existing.status !== 'removed') {
      throw new Error('room participant already exists');
    }
    await ctx.membership.roomMembers.insert({
      roomId: args.roomId,
      userId: args.userId,
      role: 'invited',
    });
    if (existing !== undefined) {
      await ctx.db.patch('roomParticipants', existing._id, {
        displayName,
        status: 'invited',
        changedAt: ctx.runtime.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert('roomParticipants', {
      roomId: args.roomId,
      userId: args.userId,
      displayName,
      status: 'invited',
      changedAt: ctx.runtime.now(),
    });
  },

  async acceptInvite(ctx, args) {
    const participant = await myParticipant(ctx, args.roomId);
    if (participant === undefined || participant.status !== 'invited') {
      throw new Error('room invitation not found');
    }
    await ctx.membership.roomMembers.setSelfRole(args.roomId, 'member');
    await ctx.db.patch('roomParticipants', participant._id, {
      status: 'member',
      changedAt: ctx.runtime.now(),
    });
    return participant._id;
  },

  async leaveRoom(ctx, args) {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'member');
    const participant = await myParticipant(ctx, args.roomId);
    if (participant === undefined || participant.status !== 'member') {
      throw new Error('active room membership not found');
    }
    const deliveries = await myRoomDeliveries(ctx, args.roomId);
    if (deliveries.length > MAX_ROOM_DELIVERIES_PER_MUTATION) {
      throw new Error('room inbox exceeds the bounded leave mutation');
    }
    for (const delivery of deliveries) {
      await ctx.db.delete('deliveries', delivery._id);
    }
    await ctx.membership.roomMembers.removeSelf(args.roomId);
    await ctx.db.patch('roomParticipants', participant._id, {
      status: 'left',
      changedAt: ctx.runtime.now(),
    });
    return { removedDeliveries: deliveries.length };
  },

  // @ref LLP 0100#3-host-resolution-and-linearization — removePrincipal is
  // invoked before any product-row lookup so an unauthorized caller is
  // refused before target-dependent application work. The display and
  // delivery cleanup is branch-insensitive: it converges product state to
  // "removed" even when the private membership pair was already absent.
  async ownerRemoveMember(ctx, args) {
    await ctx.membership.roomMembers.removePrincipal(
      args.roomId,
      args.targetPrincipal,
    );
    const participant = (await ctx.db
      .query('roomParticipants')
      .withIndex('by_room')
      .eq('roomId', args.roomId)
      .collect())
      .find((row) => row.userId === args.targetPrincipal);
    // @ref LLP 0264#migration-and-rollout — Phase 1a cannot let an owner
    // mutate another principal's owner slice. Cross-principal inbox cleanup
    // remains an explicit IR-extension dependency for Phase 1b closure.
    if (participant !== undefined && participant.status !== 'removed') {
      await ctx.db.patch('roomParticipants', participant._id, {
        status: 'removed',
        changedAt: ctx.runtime.now(),
      });
    }
    return null;
  },

  async sendMessage(ctx, args) {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner', 'member');
    const body = requiredText(args.body, 'message');
    const existingMessages = await ctx.db
      .query('messages')
      .withIndex('by_room_page_key')
      .eq('roomId', args.roomId)
      .collect();
    if (existingMessages.length >= MAX_ROOM_MESSAGES) {
      throw new Error('room message history exceeds the admitted application bound');
    }
    const participants = (await ctx.db
      .query('roomParticipants')
      .withIndex('by_room')
      .eq('roomId', args.roomId)
      .collect())
      .filter((row) => row.status === 'owner' || row.status === 'member');
    if (participants.length === 0 || participants.length > MAX_ACTIVE_RECIPIENTS) {
      throw new Error('room recipient fan-out exceeds the admitted application bound');
    }
    const author = participants.find((row) => row.userId === ctx.auth.userId);
    if (author === undefined) throw new Error('active display participant not found');
    const now = ctx.runtime.now();
    const messageId = await ctx.db.insert('messages', {
      roomId: args.roomId,
      authorId: ctx.auth.userId,
      authorName: author.displayName,
      body,
      pageKey: ctx.runtime.id(),
      createdAt: now,
    });
    // @ref LLP 0264#migration-and-rollout — the owner slice admits only the
    // sender's delivery until an explicit cross-principal fan-out write model
    // exists. The local pressure kernel makes no production chat claim.
    await ctx.db.insert('deliveries', {
      roomId: args.roomId,
      messageId,
      authorId: ctx.auth.userId,
      authorName: author.displayName,
      body,
      pageKey: ctx.runtime.id(),
      createdAt: now,
      unread: false,
    });
    return { messageId, recipients: 1 };
  },

  async markRoomRead(ctx, args) {
    await ctx.permissions.roomMembers.requireRole(args.roomId, 'owner', 'member');
    const deliveries = await myRoomDeliveries(ctx, args.roomId);
    if (deliveries.length > MAX_ROOM_DELIVERIES_PER_MUTATION) {
      throw new Error('room inbox exceeds the bounded mark-read mutation');
    }
    let changed = 0;
    for (const delivery of deliveries) {
      if (!delivery.unread) continue;
      await ctx.db.patch('deliveries', delivery._id, { unread: false });
      changed += 1;
    }
    return { changed };
  },
};
