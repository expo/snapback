// Mirrored verbatim (plus this header) from demos/partiful-matrix/backends/convex/convex/events.ts.
// The two demos share one Convex deployment and `npx convex deploy` pushes a
// whole codebase, so this codebase must carry the union of both demos'
// modules or deploying chat-matrix would delete partiful-matrix's functions.
import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const toEvent = (row: any) => ({ _id: row.publicId, title: row.title, emoji: row.emoji, description: row.description, location: row.location, startsAt: row.startsAt, hostId: row.hostId, hostName: row.hostName, accent: row.accent });
const toRsvp = (row: any) => ({ _id: row.publicId, eventId: row.eventId, userId: row.userId, guestName: row.guestName, status: row.status });
const toPost = (row: any) => ({ _id: row.publicId, eventId: row.eventId, authorId: row.authorId, authorName: row.authorName, message: row.message, createdAt: row.createdAt });

export const listEvents = query({ args: {}, handler: async (ctx) => (await ctx.db.query('events').collect()).sort((a, b) => a.startsAt - b.startsAt).map(toEvent) });
export const eventDetails = query({ args: { eventId: v.string() }, handler: async (ctx, args) => {
  const row = await ctx.db.query('events').withIndex('by_public_id', (q) => q.eq('publicId', args.eventId)).unique();
  return row ? [toEvent(row)] : [];
} });
export const guestList = query({ args: { eventId: v.string() }, handler: async (ctx, args) => (await ctx.db.query('rsvps').withIndex('by_event', (q) => q.eq('eventId', args.eventId)).collect()).map(toRsvp) });
export const eventWall = query({ args: { eventId: v.string() }, handler: async (ctx, args) => (await ctx.db.query('posts').withIndex('by_event', (q) => q.eq('eventId', args.eventId)).collect()).sort((a, b) => a.createdAt - b.createdAt).map(toPost) });

export const createEvent = mutation({
  args: { userId: v.string(), title: v.string(), emoji: v.string(), description: v.string(), location: v.string(), startsAt: v.number(), hostName: v.string(), accent: v.string() },
  handler: async (ctx, args) => {
    const publicId = `event_${crypto.randomUUID()}`;
    await ctx.db.insert('events', { publicId, title: args.title.trim(), emoji: args.emoji || '✨', description: args.description.trim(), location: args.location.trim(), startsAt: args.startsAt, hostId: args.userId, hostName: args.hostName, accent: args.accent });
    await ctx.db.insert('rsvps', { publicId: `rsvp_${crypto.randomUUID()}`, eventId: publicId, userId: args.userId, guestName: args.hostName, status: 'host' });
    return publicId;
  },
});

export const rsvp = mutation({
  args: { userId: v.string(), eventId: v.string(), guestName: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('rsvps').withIndex('by_event_user', (q) => q.eq('eventId', args.eventId).eq('userId', args.userId)).unique();
    if (existing?.status === 'host') throw new Error('the host is already going');
    if (existing) { await ctx.db.patch(existing._id, { guestName: args.guestName, status: args.status }); return existing.publicId; }
    const publicId = `rsvp_${crypto.randomUUID()}`;
    await ctx.db.insert('rsvps', { publicId, eventId: args.eventId, userId: args.userId, guestName: args.guestName, status: args.status });
    return publicId;
  },
});

export const postMessage = mutation({
  args: { userId: v.string(), eventId: v.string(), authorName: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const publicId = `post_${crypto.randomUUID()}`;
    await ctx.db.insert('posts', { publicId, eventId: args.eventId, authorId: args.userId, authorName: args.authorName, message: args.message.trim(), createdAt: Date.now() });
    return publicId;
  },
});

export const seed = mutation({
  args: { events: v.array(v.any()), rsvps: v.array(v.any()), posts: v.array(v.any()) },
  handler: async (ctx, data) => {
    for (const row of data.events) {
      const found = await ctx.db.query('events').withIndex('by_public_id', (q) => q.eq('publicId', row._id)).unique();
      if (!found) await ctx.db.insert('events', { publicId: row._id, title: row.title, emoji: row.emoji, description: row.description, location: row.location, startsAt: row.startsAt, hostId: row.hostId, hostName: row.hostName, accent: row.accent });
    }
    for (const row of data.rsvps) {
      const found = await ctx.db.query('rsvps').withIndex('by_public_id', (q) => q.eq('publicId', row._id)).unique();
      if (!found) await ctx.db.insert('rsvps', { publicId: row._id, eventId: row.eventId, userId: row.userId, guestName: row.guestName, status: row.status });
    }
    for (const row of data.posts) {
      const found = await ctx.db.query('posts').withIndex('by_public_id', (q) => q.eq('publicId', row._id)).unique();
      if (!found) await ctx.db.insert('posts', { publicId: row._id, eventId: row.eventId, authorId: row.authorId, authorName: row.authorName, message: row.message, createdAt: row.createdAt });
    }
    return { events: data.events.length, rsvps: data.rsvps.length, posts: data.posts.length };
  },
});

export const cleanupAcceptanceEvent = mutation({
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db.query('events').withIndex('by_public_id', (q) => q.eq('publicId', args.eventId)).unique();
    if (!event || event.hostId !== 'user_matrix_acceptance' || !event.title.startsWith('[acceptance]')) return false;
    for (const post of await ctx.db.query('posts').withIndex('by_event', (q) => q.eq('eventId', args.eventId)).collect()) await ctx.db.delete(post._id);
    for (const rsvp of await ctx.db.query('rsvps').withIndex('by_event', (q) => q.eq('eventId', args.eventId)).collect()) await ctx.db.delete(rsvp._id);
    await ctx.db.delete(event._id);
    return true;
  },
});
