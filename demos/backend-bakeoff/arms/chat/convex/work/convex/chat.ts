import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const namespace = "llp0102-chat-convex-w2";
const seedKey = "llp0102-public-seed-fixture";

async function subject(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("UNAUTHENTICATED");
  return identity.subject;
}

async function profile(ctx: QueryCtx | MutationCtx, actor: string) {
  const row = await ctx.db
    .query("profiles")
    .withIndex("by_namespace_subject", (q) =>
      q.eq("namespace", namespace).eq("subject", actor),
    )
    .unique();
  if (!row) throw new ConvexError("UNKNOWN_ACTOR");
  return row;
}

async function membership(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<"channels">,
  actor: string,
) {
  return await ctx.db
    .query("memberships")
    .withIndex("by_channel_subject", (q) =>
      q.eq("channelId", channelId).eq("subject", actor),
    )
    .unique();
}

async function authorize(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<"channels">,
  actor: string,
) {
  const channel = await ctx.db.get(channelId);
  if (!channel || channel.namespace !== namespace) {
    throw new ConvexError("CHANNEL_NOT_FOUND");
  }
  if (channel.visibility === "private") {
    const member = await membership(ctx, channelId, actor);
    if (!member?.active) throw new ConvexError("UNAUTHORIZED_PRIVATE_CHANNEL");
  }
  return channel;
}

export const seed = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if (args.key !== seedKey) throw new ConvexError("BAD_SEED_KEY");
    const existing = await ctx.db
      .query("channels")
      .withIndex("by_namespace", (q) => q.eq("namespace", namespace))
      .first();
    if (existing) throw new ConvexError("NAMESPACE_ALREADY_SEEDED");

    const actors = [
      { subject: "alice", name: "Alice" },
      { subject: "bob", name: "Bob" },
      { subject: "mallory", name: "Mallory" },
    ];
    for (const actor of actors) {
      await ctx.db.insert("profiles", { namespace, ...actor });
    }

    const definitions = [
      { slug: "general", name: "General", visibility: "public" as const },
      { slug: "random", name: "Random", visibility: "public" as const },
      { slug: "project-alpha", name: "Project Alpha", visibility: "private" as const },
      { slug: "leadership", name: "Leadership", visibility: "private" as const },
    ];
    const channelIds: Record<string, Id<"channels">> = {};
    for (const definition of definitions) {
      const channelId = await ctx.db.insert("channels", {
        namespace,
        ...definition,
        nextSequence: 126,
      });
      channelIds[definition.slug] = channelId;
      if (definition.visibility === "private") {
        await ctx.db.insert("memberships", {
          namespace,
          channelId,
          subject: "alice",
          role: "owner",
          active: true,
        });
        await ctx.db.insert("memberships", {
          namespace,
          channelId,
          subject: "bob",
          role: "member",
          active: true,
        });
      }
      for (let sequence = 1; sequence <= 125; sequence += 1) {
        const authorSubject = sequence % 2 === 0 ? "bob" : "alice";
        await ctx.db.insert("messages", {
          namespace,
          channelId,
          sequence,
          authorSubject,
          authorName: authorSubject === "alice" ? "Alice" : "Bob",
          body: `${definition.slug} seeded message ${sequence}`,
          sentAt: 1_700_000_000_000 + sequence,
        });
      }
      for (const actor of ["alice", "bob"]) {
        await ctx.db.insert("readMarkers", {
          namespace,
          channelId,
          subject: actor,
          lastReadSequence: 125,
        });
      }
    }
    return { namespace, channelIds, channels: 4, messages: 500, profiles: 3 };
  },
});

export const listChannels = query({
  args: {},
  handler: async (ctx) => {
    const actor = await subject(ctx);
    await profile(ctx, actor);
    const rows = await ctx.db
      .query("channels")
      .withIndex("by_namespace", (q) => q.eq("namespace", namespace))
      .collect();
    const visible: Doc<"channels">[] = [];
    for (const channel of rows) {
      if (channel.visibility === "public") {
        visible.push(channel);
      } else if ((await membership(ctx, channel._id, actor))?.active) {
        visible.push(channel);
      }
    }
    return visible.sort((a, b) => a.slug.localeCompare(b.slug));
  },
});

export const channelBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const actor = await subject(ctx);
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_namespace_slug", (q) =>
        q.eq("namespace", namespace).eq("slug", args.slug),
      )
      .unique();
    if (!channel) throw new ConvexError("CHANNEL_NOT_FOUND");
    await authorize(ctx, channel._id, actor);
    return channel;
  },
});

export const latestMessages = query({
  args: { channelId: v.id("channels"), limit: v.number() },
  handler: async (ctx, args) => {
    const actor = await subject(ctx);
    await authorize(ctx, args.channelId, actor);
    return await ctx.db
      .query("messages")
      .withIndex("by_channel_sequence", (q) => q.eq("channelId", args.channelId))
      .order("desc")
      .take(args.limit);
  },
});

export const pageMessages = query({
  args: {
    channelId: v.id("channels"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const actor = await subject(ctx);
    await authorize(ctx, args.channelId, actor);
    return await ctx.db
      .query("messages")
      .withIndex("by_channel_sequence", (q) => q.eq("channelId", args.channelId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const sendMessage = mutation({
  args: { channelId: v.id("channels"), body: v.string() },
  handler: async (ctx, args) => {
    const actor = await subject(ctx);
    const actorProfile = await profile(ctx, actor);
    const channel = await authorize(ctx, args.channelId, actor);
    const body = args.body.trim();
    if (!body || body.length > 2000) throw new ConvexError("INVALID_MESSAGE");
    const sequence = channel.nextSequence;
    const id = await ctx.db.insert("messages", {
      namespace,
      channelId: channel._id,
      sequence,
      authorSubject: actor,
      authorName: actorProfile.name,
      body,
      sentAt: Date.now(),
    });
    await ctx.db.patch(channel._id, { nextSequence: sequence + 1 });
    return { id, sequence, authorSubject: actor, authorName: actorProfile.name };
  },
});

export const setTyping = mutation({
  args: { channelId: v.id("channels"), ttlMs: v.number() },
  handler: async (ctx, args) => {
    const actor = await subject(ctx);
    const actorProfile = await profile(ctx, actor);
    await authorize(ctx, args.channelId, actor);
    const old = await ctx.db
      .query("typing")
      .withIndex("by_channel_subject", (q) =>
        q.eq("channelId", args.channelId).eq("subject", actor),
      )
      .unique();
    const value = {
      namespace,
      channelId: args.channelId,
      subject: actor,
      name: actorProfile.name,
      expiresAt: Date.now() + args.ttlMs,
    };
    if (old) await ctx.db.patch(old._id, value);
    else await ctx.db.insert("typing", value);
    return value.expiresAt;
  },
});

export const activeTyping = query({
  args: { channelId: v.id("channels"), now: v.number() },
  handler: async (ctx, args) => {
    const actor = await subject(ctx);
    await authorize(ctx, args.channelId, actor);
    return (await ctx.db.query("typing").collect()).filter(
      (row) =>
        row.namespace === namespace &&
        row.channelId === args.channelId &&
        row.expiresAt > args.now,
    );
  },
});

export const heartbeatPresence = mutation({
  args: {
    channelId: v.id("channels"),
    connectionId: v.string(),
    ttlMs: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await subject(ctx);
    const actorProfile = await profile(ctx, actor);
    await authorize(ctx, args.channelId, actor);
    const old = await ctx.db
      .query("presence")
      .withIndex("by_channel_subject", (q) =>
        q.eq("channelId", args.channelId).eq("subject", actor),
      )
      .unique();
    const value = {
      namespace,
      channelId: args.channelId,
      subject: actor,
      name: actorProfile.name,
      connectionId: args.connectionId,
      expiresAt: Date.now() + args.ttlMs,
    };
    if (old) await ctx.db.patch(old._id, value);
    else await ctx.db.insert("presence", value);
    return value.expiresAt;
  },
});

export const activePresence = query({
  args: { channelId: v.id("channels"), now: v.number() },
  handler: async (ctx, args) => {
    const actor = await subject(ctx);
    await authorize(ctx, args.channelId, actor);
    return (await ctx.db.query("presence").collect()).filter(
      (row) =>
        row.namespace === namespace &&
        row.channelId === args.channelId &&
        row.expiresAt > args.now,
    );
  },
});

export const markRead = mutation({
  args: { channelId: v.id("channels"), sequence: v.number() },
  handler: async (ctx, args) => {
    const actor = await subject(ctx);
    await authorize(ctx, args.channelId, actor);
    const old = await ctx.db
      .query("readMarkers")
      .withIndex("by_channel_subject", (q) =>
        q.eq("channelId", args.channelId).eq("subject", actor),
      )
      .unique();
    if (old) {
      await ctx.db.patch(old._id, {
        lastReadSequence: Math.max(old.lastReadSequence, args.sequence),
      });
    } else {
      await ctx.db.insert("readMarkers", {
        namespace,
        channelId: args.channelId,
        subject: actor,
        lastReadSequence: args.sequence,
      });
    }
    return args.sequence;
  },
});

export const unread = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const actor = await subject(ctx);
    const channel = await authorize(ctx, args.channelId, actor);
    const marker = await ctx.db
      .query("readMarkers")
      .withIndex("by_channel_subject", (q) =>
        q.eq("channelId", args.channelId).eq("subject", actor),
      )
      .unique();
    const lastRead = marker?.lastReadSequence ?? 0;
    return {
      lastRead,
      latest: channel.nextSequence - 1,
      unread: Math.max(0, channel.nextSequence - 1 - lastRead),
    };
  },
});

export const revokeMember = mutation({
  args: { channelId: v.id("channels"), subject: v.string() },
  handler: async (ctx, args) => {
    const actor = await subject(ctx);
    const caller = await membership(ctx, args.channelId, actor);
    if (!caller?.active || caller.role !== "owner") {
      throw new ConvexError("OWNER_REQUIRED");
    }
    const target = await membership(ctx, args.channelId, args.subject);
    if (!target) throw new ConvexError("MEMBERSHIP_NOT_FOUND");
    await ctx.db.patch(target._id, { active: false });
    return { revoked: args.subject };
  },
});

export const inspect = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if (args.key !== seedKey) throw new ConvexError("BAD_SEED_KEY");
    const count = async (table: "profiles" | "channels" | "memberships" | "messages" | "readMarkers" | "typing" | "presence") =>
      (await ctx.db.query(table).collect()).filter((row) => row.namespace === namespace).length;
    return {
      namespace,
      profiles: await count("profiles"),
      channels: await count("channels"),
      memberships: await count("memberships"),
      messages: await count("messages"),
      readMarkers: await count("readMarkers"),
      typing: await count("typing"),
      presence: await count("presence"),
    };
  },
});

export const cleanup = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if (args.key !== seedKey) throw new ConvexError("BAD_SEED_KEY");
    const tables = [
      "presence",
      "typing",
      "readMarkers",
      "messages",
      "memberships",
      "channels",
      "profiles",
    ] as const;
    let deleted = 0;
    for (const table of tables) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) {
        if (row.namespace === namespace) {
          await ctx.db.delete(row._id);
          deleted += 1;
        }
      }
    }
    return { namespace, deleted };
  },
});
