import { mutation, query, action } from "./_generated/server";
import { v } from "convex/values";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const saveClip = mutation({
  args: { title: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) =>
    await ctx.db.insert("clips", { title: args.title, storageId: args.storageId, ownerId: "owner" }),
});

export const clipUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => await ctx.storage.getUrl(args.storageId),
});

export const clipMeta = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => await ctx.db.system.get(args.storageId),
});

export const deleteClip = mutation({
  args: { storageId: v.id("_storage"), clipId: v.optional(v.id("clips")) },
  handler: async (ctx, args) => {
    if (args.clipId) await ctx.db.delete(args.clipId);
    await ctx.storage.delete(args.storageId);
    return null;
  },
});
