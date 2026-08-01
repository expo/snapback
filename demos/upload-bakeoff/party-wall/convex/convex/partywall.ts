// Party Wall arm functions (ub_b namespace). Identity posture, disclosed:
// this shared deployment has no auth provider, so "who is calling" is an
// application-supplied string. Membership checks below are therefore
// advisory application logic, not enforced identity — recorded honestly in
// the diary. File URLs are Convex's documented capability-URL model.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function isMember(ctx: any, eventId: any, member: string) {
  const rows = await ctx.db
    .query("ub_b_members")
    .withIndex("by_event", (q: any) => q.eq("eventId", eventId))
    .collect();
  return rows.some((r: any) => r.member === member);
}

export const createEvent = mutation({
  args: { title: v.string(), host: v.string() },
  handler: async (ctx, args) => {
    const eventId = await ctx.db.insert("ub_b_events", { title: args.title, host: args.host });
    await ctx.db.insert("ub_b_members", { eventId, member: args.host });
    return eventId;
  },
});

export const join = mutation({
  args: { eventId: v.id("ub_b_events"), member: v.string(), by: v.string() },
  handler: async (ctx, args) => {
    if (!(await isMember(ctx, args.eventId, args.by))) throw new Error("only members add members (advisory)");
    if (!(await isMember(ctx, args.eventId, args.member))) {
      await ctx.db.insert("ub_b_members", { eventId: args.eventId, member: args.member });
    }
  },
});

export const leave = mutation({
  args: { eventId: v.id("ub_b_events"), member: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("ub_b_members")
      .withIndex("by_event", (q: any) => q.eq("eventId", args.eventId))
      .collect();
    for (const r of rows) if (r.member === args.member) await ctx.db.delete(r._id);
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const addPhoto = mutation({
  args: { eventId: v.id("ub_b_events"), caption: v.string(), author: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    if (!(await isMember(ctx, args.eventId, args.author))) throw new Error("not a member (advisory)");
    return await ctx.db.insert("ub_b_photos", args);
  },
});

// The live feed: membership-gated in application logic; returns serving URLs.
export const wall = query({
  args: { eventId: v.id("ub_b_events"), viewer: v.string() },
  handler: async (ctx, args) => {
    if (!(await isMember(ctx, args.eventId, args.viewer))) return [];
    const photos = await ctx.db
      .query("ub_b_photos")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    return await Promise.all(photos.map(async (p) => ({
      caption: p.caption,
      author: p.author,
      url: await ctx.storage.getUrl(p.storageId),
    })));
  },
});

export const deletePhoto = mutation({
  args: { photoId: v.id("ub_b_photos"), alsoBytes: v.boolean() },
  handler: async (ctx, args) => {
    const photo = await ctx.db.get(args.photoId);
    if (!photo) return { bytesDeleted: false };
    await ctx.db.delete(args.photoId);
    if (args.alsoBytes) { await ctx.storage.delete(photo.storageId); return { bytesDeleted: true }; }
    return { bytesDeleted: false };
  },
});

export const cleanupNamespaceB = mutation({
  args: {},
  handler: async (ctx) => {
    let rows = 0; let files = 0;
    for (const table of ["ub_b_photos", "ub_b_members", "ub_b_events"] as const) {
      const all = await ctx.db.query(table).collect();
      for (const r of all) {
        if (table === "ub_b_photos") { await ctx.storage.delete((r as any).storageId).catch?.(() => {}); files += 1; }
        await ctx.db.delete(r._id);
        rows += 1;
      }
    }
    return { rows, files };
  },
});

export const deletePhotoByCaption = mutation({
  args: { eventId: v.id("ub_b_events"), caption: v.string(), alsoBytes: v.boolean() },
  handler: async (ctx, args) => {
    const photos = await ctx.db
      .query("ub_b_photos")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    const photo = photos.find((p) => p.caption === args.caption);
    if (!photo) return { bytesDeleted: false };
    await ctx.db.delete(photo._id);
    if (args.alsoBytes) { await ctx.storage.delete(photo.storageId); return { bytesDeleted: true }; }
    return { bytesDeleted: false };
  },
});
