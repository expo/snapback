// Chat matrix — Convex column. The idiomatic Convex shape: the public
// sendMessage mutation schedules an internal action; the action streams
// OpenRouter output and commits throttled deltas through an internal mutation,
// so subscribed clients watch the assistant row fill in.

import { internal } from './_generated/api';
import { internalAction, internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';

const DELTA_INTERVAL_MS = 350;

const toConversation = (row: any) => ({ _id: row.publicId, title: row.title, model: row.model, createdAt: row.createdAt });
const toMessage = (row: any) => ({ _id: row.publicId, conversationId: row.conversationId, role: row.role, content: row.content, status: row.status, createdAt: row.createdAt });

export const listConversations = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('chatConversations').withIndex('by_created').collect()).map(toConversation),
});

export const thread = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) =>
    (await ctx.db.query('chatMessages').withIndex('by_conversation', (q) => q.eq('conversationId', args.conversationId)).collect())
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(toMessage),
});

export const createConversation = mutation({
  args: { title: v.string(), model: v.string(), createdAt: v.number() },
  handler: async (ctx, args) => {
    const publicId = `conv_${crypto.randomUUID()}`;
    await ctx.db.insert('chatConversations', { publicId, title: args.title, model: args.model, createdAt: args.createdAt });
    return publicId;
  },
});

export const sendMessage = mutation({
  args: { conversationId: v.string(), content: v.string(), createdAt: v.number() },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.query('chatConversations').withIndex('by_public_id', (q) => q.eq('publicId', args.conversationId)).unique();
    if (!conversation) throw new Error('conversation not found');
    await ctx.db.insert('chatMessages', {
      publicId: `msg_${crypto.randomUUID()}`,
      conversationId: args.conversationId,
      role: 'user',
      content: args.content,
      status: 'complete',
      createdAt: args.createdAt,
    });
    const assistantId = `msg_${crypto.randomUUID()}`;
    await ctx.db.insert('chatMessages', {
      publicId: assistantId,
      conversationId: args.conversationId,
      role: 'assistant',
      content: '',
      status: 'pending',
      createdAt: args.createdAt + 1,
    });
    await ctx.scheduler.runAfter(0, internal.chat.generateReply, { messageId: assistantId });
    return assistantId;
  },
});

export const claimReply = internalMutation({
  args: { messageId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('chatMessages').withIndex('by_public_id', (q) => q.eq('publicId', args.messageId)).unique();
    if (!row || row.status !== 'pending') return { claimed: false, model: '', history: [] as { role: string; content: string }[] };
    const conversation = await ctx.db.query('chatConversations').withIndex('by_public_id', (q) => q.eq('publicId', row.conversationId)).unique();
    if (!conversation) return { claimed: false, model: '', history: [] as { role: string; content: string }[] };
    const rows = (await ctx.db.query('chatMessages').withIndex('by_conversation', (q) => q.eq('conversationId', row.conversationId)).collect())
      .sort((left, right) => left.createdAt - right.createdAt);
    const history = rows
      .filter((message) => message.publicId !== args.messageId && message.status === 'complete')
      .map((message) => ({ role: message.role, content: message.content }));
    await ctx.db.patch(row._id, { status: 'streaming' });
    return { claimed: true, model: conversation.model, history };
  },
});

export const applyDelta = internalMutation({
  args: { messageId: v.string(), content: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('chatMessages').withIndex('by_public_id', (q) => q.eq('publicId', args.messageId)).unique();
    if (!row) throw new Error('assistant message not found');
    await ctx.db.patch(row._id, { content: args.content, status: args.status });
  },
});

export const generateReply = internalAction({
  args: { messageId: v.string() },
  handler: async (ctx, args) => {
    const claim = await ctx.runMutation(internal.chat.claimReply, { messageId: args.messageId });
    if (!claim.claimed) return;
    const key = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.OPENROUTER_API_KEY;
    const commit = (content: string, status: string) =>
      ctx.runMutation(internal.chat.applyDelta, { messageId: args.messageId, content, status });
    if (!key) {
      await commit('(OPENROUTER_API_KEY is not set on the Convex deployment)', 'error');
      return;
    }
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          'HTTP-Referer': 'https://github.com/ccheever/snapback',
          'X-Title': 'snapback chat-matrix demo',
        },
        body: JSON.stringify({ model: claim.model, messages: claim.history, stream: true }),
      });
      if (!response.ok || !response.body) {
        await commit(`(OpenRouter error: HTTP ${response.status} ${(await response.text()).slice(0, 300)})`, 'error');
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let lastCommitAt = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const newline = buffer.indexOf('\n');
          if (newline < 0) break;
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let parsed: any;
          try { parsed = JSON.parse(data); } catch { continue; }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) accumulated += delta;
          if (parsed.error?.message) throw new Error(parsed.error.message);
        }
        const now = Date.now();
        if (accumulated.length > 0 && now - lastCommitAt >= DELTA_INTERVAL_MS) {
          lastCommitAt = now;
          await commit(accumulated, 'streaming');
        }
      }
      await commit(accumulated.length > 0 ? accumulated : '(empty reply)', 'complete');
    } catch (error: any) {
      await commit(`(generation failed: ${String(error?.message ?? error)})`, 'error');
    }
  },
});
