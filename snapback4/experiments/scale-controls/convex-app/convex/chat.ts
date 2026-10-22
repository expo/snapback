import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";

async function principal(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !/^(0|[1-9][0-9]*)$/.test(identity.subject)) throw new Error("Unauthorized");
  const p = Number(identity.subject);
  if (p < 0 || p > 255) throw new Error("Unauthorized");
  return p;
}
async function member(ctx: QueryCtx, p: number, room: number) {
  const m = await ctx.db.query("memberships").withIndex("by_principal_room", q => q.eq("principal", p).eq("room", room)).unique();
  if (!m) throw new Error("Forbidden");
  return m;
}
const messageValue = (m: {id: number; room: number; sender: number; at: number; body: string}) =>
  ({ id: m.id, room: m.room, sender: m.sender, at: m.at, body: m.body });

// @ref LLP 3000.009.001.002#5-workloads — identical member visibility and ordered page semantics
export const point = query({ args: { message: v.number() }, handler: async (ctx, a) => {
  const p = await principal(ctx);
  const m = await ctx.db.query("messages").withIndex("by_fixture_id", q => q.eq("id", a.message)).unique();
  if (!m) throw new Error("Missing");
  await member(ctx, p, m.room);
  return messageValue(m);
}});
export const page = query({ args: { room: v.number() }, handler: async (ctx, a) => {
  await member(ctx, await principal(ctx), a.room);
  const rows = await ctx.db.query("messages").withIndex("by_room_at_id", q => q.eq("room", a.room)).order("desc").take(20);
  return rows.map(messageValue);
}});
export const inbox = query({ args: {}, handler: async ctx => {
  const p = await principal(ctx);
  const memberships = await ctx.db.query("memberships").withIndex("by_principal_room", q => q.eq("principal", p).lt("room", 1024)).take(32);
  return await Promise.all(memberships.map(async m => {
    const r = await ctx.db.query("rooms").withIndex("by_fixture_id", q => q.eq("id", m.room)).unique();
    if (!r) throw new Error("Missing room");
    return { room: r.id, total: r.total, unread: Math.max(0, r.total - m.last_read) };
  }));
}});
// Ordinary read-modify-write mutations: Convex owns OCC, retries and durable commit.
export const increment = mutation({ args: { counter: v.number() }, handler: async (ctx, a) => {
  const p = await principal(ctx);
  const c = await ctx.db.query("counters").withIndex("by_fixture_id", q => q.eq("id", a.counter)).unique();
  if (!c) throw new Error("Missing");
  if (c.owner_id === null) await member(ctx, p, c.room);
  else if (c.owner_id !== p) throw new Error("Forbidden");
  await ctx.db.patch(c._id, { n: c.n + 1 });
  return { id: c.id, n: c.n + 1 };
}});
// Labelled row only. Headline `increment` still returns the single document's new total.
// Convex's sharded-counter guidance: writers must not share one document, or OCC retries serialize them.
// Shard by principal % 32. At C=32 the writer ids are 0..31, a bijection, so two writers never patch the same document.
// A random shard plus the default 100 ms OCC backoff would miss the 100 ms write SLO on any retry.
const SHARDS = 32;
export const incrementSharded = mutation({ args: { counter: v.number() }, handler: async (ctx, a) => {
  const p = await principal(ctx);
  const c = await ctx.db.query("counters").withIndex("by_fixture_id", q => q.eq("id", a.counter)).unique();
  if (!c) throw new Error("Missing");
  if (c.owner_id === null) await member(ctx, p, c.room);
  else if (c.owner_id !== p) throw new Error("Forbidden");
  const shard = p % SHARDS;
  const row = await ctx.db.query("counterShards").withIndex("by_counter_shard", q => q.eq("counter", a.counter).eq("shard", shard)).unique();
  const n = (row ? row.n : 0) + 1;
  if (row) await ctx.db.patch(row._id, { n });
  else await ctx.db.insert("counterShards", { counter: a.counter, shard, n });
  // Shard-local n. The exact total, including every shard, is the separate `count` query.
  return { id: c.id, n };
}});
export const count = query({ args: { counter: v.number() }, handler: async (ctx, a) => {
  const p = await principal(ctx);
  const c = await ctx.db.query("counters").withIndex("by_fixture_id", q => q.eq("id", a.counter)).unique();
  if (!c) throw new Error("Missing");
  if (c.owner_id === null) await member(ctx, p, c.room);
  else if (c.owner_id !== p) throw new Error("Forbidden");
  const shards = await ctx.db.query("counterShards").withIndex("by_counter_shard", q => q.eq("counter", a.counter)).take(SHARDS + 1);
  if (shards.length > SHARDS) throw new Error("shard page truncated");
  return { id: c.id, n: c.n + shards.reduce((s, r) => s + r.n, 0) };
}});
// Admin-only. Insert n=0 shard rows before measurement so the hot path is a patch, not an insert race.
export const ensureShards = internalMutation({ args: { counter: v.number(), shards: v.number() }, handler: async (ctx, a) => {
  if (a.shards !== SHARDS) throw new Error("shard count");
  let created = 0;
  for (let shard = 0; shard < a.shards; shard++) {
    const row = await ctx.db.query("counterShards").withIndex("by_counter_shard", q => q.eq("counter", a.counter).eq("shard", shard)).unique();
    if (!row) {
      await ctx.db.insert("counterShards", { counter: a.counter, shard, n: 0 });
      created++;
    }
  }
  return { created };
}});
export const post = mutation({ args: { room: v.number(), id: v.number(), at: v.number(), body: v.string() }, handler: async (ctx, a) => {
  const p = await principal(ctx);
  await member(ctx, p, a.room);
  if (a.body.length > 4000) throw new Error("Body too long");
  const r = await ctx.db.query("rooms").withIndex("by_fixture_id", q => q.eq("id", a.room)).unique();
  const u = await ctx.db.query("users").withIndex("by_fixture_id", q => q.eq("id", p)).unique();
  if (!r || !u) throw new Error("Missing");
  // @ref LLP 3000.009.001.002#4-controls — insert and maintained room/sender totals share one transaction
  await ctx.db.insert("messages", { ...a, sender: p });
  await ctx.db.patch(r._id, { total: r.total + 1 });
  await ctx.db.patch(u._id, { sent: u.sent + 1 });
  return { id: a.id, room: a.room, sender: p, at: a.at, body: a.body };
}});
// Admin-only observation; never used to execute measured operations.
export const witness = internalQuery({ args: {}, handler: async ctx => {
  // Index range, not a table scan. Fixture counter ids are 0..256.
  const cs = await ctx.db.query("counters").withIndex("by_fixture_id", q => q.gte("id", 0)).take(258);
  if (cs.length > 257) throw new Error("counter page truncated");
  const shards = await ctx.db.query("counterShards").withIndex("by_counter_shard", q => q.eq("counter", 256)).take(SHARDS + 1);
  if (shards.length > SHARDS) throw new Error("shard page truncated");
  const extra = shards.reduce((s, c) => s + c.n, 0);
  const hot = cs.find(c => c.id === 256)?.n ?? 0;
  return { sum: cs.reduce((s,c) => s+c.n,0) + extra, hot: hot + extra };
}});
export const inspect = internalQuery({ args: {}, handler: async ctx => ({
  room: await ctx.db.query("rooms").withIndex("by_fixture_id", q => q.eq("id",0)).unique(),
  user: await ctx.db.query("users").withIndex("by_fixture_id", q => q.eq("id",0)).unique(),
}) });

// Admin-only restoration after the black-box atomic-maintain witness.
export const removeTestPost = internalMutation({ args: { id: v.number() }, handler: async (ctx, a) => {
  if (a.id !== -1) throw new Error("Only the test row");
  const m = await ctx.db.query("messages").withIndex("by_fixture_id", q => q.eq("id", a.id)).unique();
  if (!m) throw new Error("Missing test row");
  const r = await ctx.db.query("rooms").withIndex("by_fixture_id", q => q.eq("id", m.room)).unique();
  const u = await ctx.db.query("users").withIndex("by_fixture_id", q => q.eq("id", m.sender)).unique();
  if (!r || !u) throw new Error("Missing");
  await ctx.db.delete(m._id);
  await ctx.db.patch(r._id, { total: r.total - 1 });
  await ctx.db.patch(u._id, { sent: u.sent - 1 });
}});
