import { defineJsLiveQuery, defineJsMutation, results, v } from '@expo/snapback-codegen/define';

export const recentTriumphs = defineJsLiveQuery({
  args: { limit: v.integer() }, result: results.documents('triumphs'), reads: ['triumphs'],
  handler: async (ctx, args) => ctx.db.query('triumphs').withIndex('by_created').order('createdAt', 'desc').take(Math.max(1, Math.min(args.limit, 50))).collect(),
});

export const celebrate = defineJsMutation({
  args: { text: v.string(), vibe: v.string() }, result: results.value(v.id('triumphs')), reads: [], writes: ['triumphs'],
  handler: async (ctx, args) => {
    const text = args.text.trim();
    if (text.length < 2 || text.length > 120) throw new Error('A tiny triumph must be between 2 and 120 characters.');
    if (!['spark', 'sun', 'leaf'].includes(args.vibe)) throw new Error('Choose one of the supported vibes.');
    return ctx.db.insert('triumphs', { text, vibe: args.vibe, createdAt: ctx.runtime.now() });
  },
});
