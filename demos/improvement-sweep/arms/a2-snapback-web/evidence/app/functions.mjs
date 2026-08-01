import {
  asc,
  defineJsLiveQuery,
  defineJsMutation,
  defineJsQuery,
  defineLiveQuery,
  eq,
  lit,
  membershipResource,
  results,
  v,
} from '@expo/snapback-codegen/define';
import { channelMembers } from './schema.mjs';

// ---- channels ----

export const listPublicChannels = defineLiveQuery({
  table: 'channels',
  args: {},
  filter: [eq('visibility', lit('public'))],
  order: [asc('name')],
  index: 'by_name',
});

// Private channels the caller belongs to, via the channelSeats UI mirror
// (the membership declaration cannot semi-join the resource table by its own
// _id; access to each channel's data is still enforced by requireRole).
export const listMyPrivateChannels = defineJsLiveQuery({
  args: {},
  reads: ['channelSeats', 'channels'],
  result: results.records(v.object({
    channelId: v.id('channels'),
    name: v.string(),
    visibility: v.string(),
    status: v.string(),
  })),
  handler: async (ctx) => {
    const seats = await ctx.db
      .query('channelSeats')
      .withIndex('by_user')
      .eq('userId', ctx.auth.userId)
      .collect();
    const out = [];
    for (const seat of seats) {
      const channel = await ctx.db.get('channels', seat.channelId);
      if (!channel || channel.visibility !== 'private') continue;
      out.push({
        channelId: seat.channelId,
        name: channel.name,
        visibility: channel.visibility,
        status: seat.status,
      });
    }
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return out;
  },
});

export const createChannel = defineJsMutation({
  args: { name: v.string() },
  writes: ['channels'],
  result: results.value(v.id('channels')),
  handler: async (ctx, args) => {
    const name = String(args.name ?? '').trim();
    if (!name) throw new Error('channel name is required');
    return await ctx.db.insert('channels', { name, visibility: 'public' });
  },
});

// Bootstrap-only mutation: atomically creates the private channel and seats
// the caller as host.
export const createPrivateChannel = defineJsMutation({
  args: { name: v.string() },
  writes: ['channels', 'channelMembers', 'channelSeats'],
  authorityCreating: false,
  result: results.value(v.id('channels')),
  handler: async (ctx, args) => {
    const name = String(args.name ?? '').trim();
    if (!name) throw new Error('channel name is required');
    const channelId = await ctx.membership.channelMembers.bootstrap({
      name,
      visibility: 'private',
    });
    await ctx.db.insert('channelSeats', {
      channelId,
      userId: ctx.auth.userId,
      status: 'host',
    });
    return channelId;
  },
});

export const inviteToChannel = defineJsMutation({
  args: { channelId: v.id('channels'), userId: v.principal() },
  writes: ['channelMembers', 'channelSeats'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ctx.membership.channelMembers.insert({
      channelId: args.channelId,
      userId: args.userId,
      role: 'invited',
    });
    await ctx.db.insert('channelSeats', {
      channelId: args.channelId,
      userId: args.userId,
      status: 'invited',
    });
    return true;
  },
});

export const acceptChannelInvite = defineJsMutation({
  args: { channelId: v.id('channels') },
  writes: ['channelMembers', 'channelSeats'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ctx.membership.channelMembers.setSelfRole(args.channelId, 'member');
    const seats = await ctx.db
      .query('channelSeats')
      .withIndex('by_channel_user')
      .eq('channelId', args.channelId)
      .eq('userId', ctx.auth.userId)
      .collect();
    if (seats.length > 0) {
      await ctx.db.patch('channelSeats', seats[0]._id, { status: 'member' });
    }
    return true;
  },
});

export const leaveChannel = defineJsMutation({
  args: { channelId: v.id('channels') },
  writes: ['channelMembers', 'channelSeats'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ctx.membership.channelMembers.removeSelf(args.channelId);
    const seats = await ctx.db
      .query('channelSeats')
      .withIndex('by_channel_user')
      .eq('channelId', args.channelId)
      .eq('userId', ctx.auth.userId)
      .collect();
    if (seats.length > 0) {
      await ctx.db.delete('channelSeats', seats[0]._id);
    }
    return true;
  },
});

// ---- messages ----

// Live channel view. Private channels are gated by the membership
// declaration's requireRole, which is revocation-active for live handles.
export const listMessages = defineJsLiveQuery({
  args: { channelId: v.id('channels') },
  reads: ['messages', 'channels'],
  result: results.documents('messages'),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get('channels', args.channelId);
    if (!channel) throw new Error('channel not found');
    if (channel.visibility === 'private') {
      await ctx.permissions.channelMembers.requireRole(args.channelId, 'host', 'member');
    }
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_channel')
      .eq('channelId', args.channelId)
      .collect();
    rows.sort((a, b) =>
      a._version - b._version || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
    return rows;
  },
});

// Keyset page over server commit order (_version). `after` is the opaque
// cursor returned by the previous page; page size is fixed at 5.
export const listMessagesPage = defineJsQuery({
  args: { channelId: v.id('channels'), after: v.optional(v.string()) },
  reads: ['messages', 'channels'],
  result: results.records(v.object({
    kind: v.string(), // 'message' | 'cursor'
    id: v.string(),
    authorId: v.string(),
    body: v.string(),
    sentAt: v.integer(),
    commitOrder: v.integer(),
    cursor: v.string(),
  })),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get('channels', args.channelId);
    if (!channel) throw new Error('channel not found');
    if (channel.visibility === 'private') {
      await ctx.permissions.channelMembers.requireRole(args.channelId, 'host', 'member');
    }
    // NOTE (finding a2-f5): a bounded keyset (`.gt/.order/.take`) is not on
    // the packaged 0.1.7 ctx.db chain ("undefined is not a function"), so the
    // page is computed over a collected channel read. Bounded storage work
    // for shared-visibility history is not expressible in this closure.
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_channel')
      .eq('channelId', args.channelId)
      .collect();
    rows.sort((a, b) =>
      a._version - b._version || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
    let start = 0;
    if (args.after !== undefined) {
      const parts = String(args.after).split(':');
      if (parts.length !== 3 || parts[0] !== 'a2v1') throw new Error('malformed cursor');
      const boundaryVersion = Number(parts[1]);
      const boundaryId = parts[2];
      if (!Number.isSafeInteger(boundaryVersion)) throw new Error('malformed cursor');
      start = rows.findIndex((row) =>
        row._version > boundaryVersion
        || (row._version === boundaryVersion && row._id > boundaryId));
      if (start === -1) start = rows.length;
    }
    const hasMore = start + 5 < rows.length;
    const page = rows.slice(start, start + 5);
    const out = page.map((row) => ({
      kind: 'message',
      id: row._id,
      authorId: row.authorId,
      body: row.body,
      sentAt: row.sentAt,
      commitOrder: row._version,
      cursor: '',
    }));
    if (hasMore) {
      const last = page.at(-1);
      out.push({
        kind: 'cursor',
        id: '',
        authorId: '',
        body: '',
        sentAt: 0,
        commitOrder: 0,
        cursor: 'a2v1:' + String(last._version) + ':' + last._id,
      });
    }
    return out;
  },
});

// Idempotent send: (channelId, clientKey) is a unique index; a retry that
// finds the committed row returns its id instead of inserting twice.
export const sendMessage = defineJsMutation({
  args: {
    channelId: v.id('channels'),
    body: v.string(),
    clientKey: v.string(),
    authorName: v.optional(v.string()),
  },
  writes: ['messages'],
  result: results.value(v.id('messages')),
  handler: async (ctx, args) => {
    const body = String(args.body ?? '').trim();
    if (!body) throw new Error('message body is required');
    const channel = await ctx.db.get('channels', args.channelId);
    if (!channel) throw new Error('channel not found');
    if (channel.visibility === 'private') {
      await ctx.permissions.channelMembers.requireRole(args.channelId, 'host', 'member');
    }
    const existing = await ctx.db
      .query('messages')
      .withIndex('by_channel_client_key')
      .eq('channelId', args.channelId)
      .eq('clientKey', args.clientKey)
      .collect();
    if (existing.length > 0) return existing[0]._id;
    return await ctx.db.insert('messages', {
      channelId: args.channelId,
      authorId: ctx.auth.userId,
      authorName: String(args.authorName ?? ''),
      body,
      sentAt: ctx.runtime.now(),
      clientKey: args.clientKey,
    });
  },
});

// ---- unread ----

export const markChannelRead = defineJsMutation({
  args: { channelId: v.id('channels') },
  writes: ['channelReads'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get('channels', args.channelId);
    if (!channel) throw new Error('channel not found');
    if (channel.visibility === 'private') {
      await ctx.permissions.channelMembers.requireRole(args.channelId, 'host', 'member');
    }
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_channel')
      .eq('channelId', args.channelId)
      .collect();
    let head = 0;
    for (const row of rows) if (row._version > head) head = row._version;
    const marks = await ctx.db
      .query('channelReads')
      .withIndex('by_channel_user')
      .eq('channelId', args.channelId)
      .eq('userId', ctx.auth.userId)
      .collect();
    if (marks.length > 0) {
      await ctx.db.patch('channelReads', marks[0]._id, { lastReadVersion: head });
    } else {
      await ctx.db.insert('channelReads', {
        channelId: args.channelId,
        userId: ctx.auth.userId,
        lastReadVersion: head,
      });
    }
    return head;
  },
});

export const unreadCount = defineJsLiveQuery({
  args: { channelId: v.id('channels') },
  reads: ['messages', 'channelReads', 'channels'],
  result: results.records(v.object({
    userId: v.string(),
    channelId: v.id('channels'),
    unread: v.integer(),
  })),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get('channels', args.channelId);
    if (!channel) throw new Error('channel not found');
    if (channel.visibility === 'private') {
      await ctx.permissions.channelMembers.requireRole(args.channelId, 'host', 'member');
    }
    const marks = await ctx.db
      .query('channelReads')
      .withIndex('by_channel_user')
      .eq('channelId', args.channelId)
      .eq('userId', ctx.auth.userId)
      .collect();
    const marker = marks.length > 0 ? marks[0].lastReadVersion : 0;
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_channel')
      .eq('channelId', args.channelId)
      .collect();
    let unread = 0;
    for (const row of rows) {
      if (row._version > marker && row.authorId !== ctx.auth.userId) unread += 1;
    }
    return [{ userId: ctx.auth.userId, channelId: args.channelId, unread }];
  },
});
