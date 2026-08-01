// Faceplate arm functions (ub-a namespace). The official upload path:
// generateUploadUrl → client POSTs bytes → storageId lands in a document.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const ensureProfile = mutation({
  args: { handle: v.string(), displayName: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ub_a_profiles")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("ub_a_profiles", { handle: args.handle, displayName: args.displayName });
  },
});

export const setAvatar = mutation({
  args: { profileId: v.id("ub_a_profiles"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const prior = await ctx.db.get(args.profileId);
    await ctx.db.patch(args.profileId, { avatar: args.storageId });
    return prior?.avatar ?? null;
  },
});

export const avatarUrl = query({
  args: { profileId: v.id("ub_a_profiles") },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.profileId);
    return p?.avatar ? await ctx.storage.getUrl(p.avatar) : null;
  },
});

export const cleanupNamespace = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("ub_a_profiles").collect();
    let files = 0;
    for (const row of rows) {
      if (row.avatar) { await ctx.storage.delete(row.avatar); files += 1; }
      await ctx.db.delete(row._id);
    }
    return { rows: rows.length, files };
  },
});

export const sweepArmOrphans = mutation({
  args: { sinceMs: v.number(), sizeExact: v.number() },
  handler: async (ctx, args) => {
    const files = await ctx.db.system.query("_storage").collect();
    let deleted = 0;
    for (const f of files) {
      if (f._creationTime >= args.sinceMs && f.size === args.sizeExact) {
        await ctx.storage.delete(f._id);
        deleted += 1;
      }
    }
    return { scanned: files.length, deleted };
  },
});
