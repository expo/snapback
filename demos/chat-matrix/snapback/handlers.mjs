// Chat matrix — Snapback JS handlers.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
async function createConversation(ctx, args) {
  const id = await ctx.db.insert('conversations', {
    title: args.title,
    model: args.model,
    createdAt: args.createdAt,
  });
  return { conversationId: id };
}

async function sendMessage(ctx, args) {
  const conversation = await ctx.db.get('conversations', args.conversationId);
  if (!conversation) throw new Error('conversation not found');
  await ctx.db.insert('messages', {
    conversationId: args.conversationId,
    role: 'user',
    content: args.content,
    status: 'complete',
    createdAt: args.createdAt,
  });
  const assistantId = await ctx.db.insert('messages', {
    conversationId: args.conversationId,
    role: 'assistant',
    content: '',
    status: 'pending',
    createdAt: args.createdAt + 1,
  });
  return { assistantMessageId: assistantId };
}

async function claimReply(ctx, args) {
  const row = await ctx.db.get('messages', args.messageId);
  if (!row) throw new Error('assistant message not found');
  if (row.status !== 'pending') return { claimed: false, model: null, history: [] };
  const conversation = await ctx.db.get('conversations', row.conversationId);
  if (!conversation) throw new Error('conversation not found');
  const rows = await ctx.db
    .query('messages')
    .withIndex('by_conversation')
    .eq('conversationId', row.conversationId)
    .order('createdAt', 'asc')
    .collect();
  const history = rows
    .filter((message) => message._id !== args.messageId && message.status === 'complete')
    .map((message) => ({ role: message.role, content: message.content }));
  await ctx.db.patch('messages', args.messageId, { status: 'streaming' });
  return { claimed: true, model: conversation.model, history };
}

async function applyAssistantDelta(ctx, args) {
  const row = await ctx.db.get('messages', args.messageId);
  if (!row) throw new Error('assistant message not found');
  await ctx.db.patch('messages', args.messageId, { content: args.content, status: args.status });
  return { status: args.status };
}

async function generateReply(ctx, args) {
  const claim = await ctx.runMutation('claimReply', { messageId: args.messageId });
  if (!claim.claimed) return { outcome: 'already-claimed' };
  const key = ctx.secrets.rotating('openrouter').expose();
  const commit = (content, status) =>
    ctx.runMutation('applyAssistantDelta', { messageId: args.messageId, content, status });
  try {
    // The Ibex action runtime's fetch exposes no ReadableStream, so token
    // streaming cannot be expressed here today: the reply lands as one commit.
    // (Convex/Supabase/SQLite cells stream token deltas; this asymmetry is a
    // recorded Snapback authoring gap — see the chat-matrix diary.) The
    // claim's 'streaming' status still gives surfaces an honest busy state.
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'HTTP-Referer': 'https://github.com/ccheever/snapback',
        'X-Title': 'snapback chat-matrix demo',
      },
      body: JSON.stringify({ model: claim.model, messages: claim.history, stream: false }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      await commit(`(OpenRouter error: HTTP ${response.status} ${detail})`, 'error');
      return { outcome: 'error' };
    }
    const payload = await response.json();
    const accumulated = payload.choices?.[0]?.message?.content ?? '';
    await commit(accumulated.length > 0 ? accumulated : '(empty reply)', 'complete');
    return { outcome: 'complete', characters: accumulated.length };
  } catch (error) {
    await commit(`(generation failed: ${String(error && error.message ? error.message : error)})`, 'error');
    return { outcome: 'error' };
  }
}

globalThis.__snapbackHandlers = {
  createConversation,
  sendMessage,
  claimReply,
  applyAssistantDelta,
  generateReply,
};
