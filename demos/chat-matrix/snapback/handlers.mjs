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

// SSE arrives as raw bytes; lines are split at the byte level (a UTF-8
// continuation byte is never 0x0A, so \n is a safe boundary) and only
// complete lines are decoded, keeping multibyte tokens intact across
// chunk boundaries.
function utf8Decode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let cp;
    let extra;
    if (b < 0x80) { cp = b; extra = 0; }
    else if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; extra = 1; }
    else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; extra = 2; }
    else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; extra = 3; }
    else { cp = 0xfffd; extra = 0; }
    for (let j = 0; j < extra; j += 1) {
      const c = bytes[i + 1 + j];
      cp = (c & 0xc0) === 0x80 ? (cp << 6) | (c & 0x3f) : 0xfffd;
    }
    i += 1 + extra;
    out += String.fromCodePoint(cp > 0x10ffff ? 0xfffd : cp);
  }
  return out;
}

function sseEvent(line) {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (payload === '[DONE]') return { done: true };
  try {
    const parsed = JSON.parse(payload);
    const token = parsed.choices?.[0]?.delta?.content;
    return typeof token === 'string' && token.length > 0 ? { token } : null;
  } catch (_) {
    return null;
  }
}

function streamCode(error) {
  const message = String(error && error.message ? error.message : error);
  const match = message.match(/SNAPBACK_[A-Z0-9_]+/);
  return match ? match[0] : null;
}

async function generateReply(ctx, args) {
  const claim = await ctx.runMutation('claimReply', { messageId: args.messageId });
  if (!claim.claimed) return { outcome: 'already-claimed' };
  const key = ctx.secrets.rotating('openrouter');
  const commit = (content, status) =>
    ctx.runMutation('applyAssistantDelta', { messageId: args.messageId, content, status });
  let accumulated = '';
  let reader = null;
  try {
    // @ref LLP 0076#surface — ctx.fetchStream consumes OpenRouter's SSE
    // incrementally; each throttled commit crosses applyAssistantDelta, so
    // token deltas ride the ordinary live-query fan-out like the Convex cell.
    const response = await ctx.fetchStream({
      url: OPENROUTER_URL,
      method: 'POST',
      headers: {
        Authorization: key.asBearer(),
        'content-type': 'application/json',
        'HTTP-Referer': 'https://github.com/ccheever/snapback',
        'X-Title': 'snapback chat-matrix demo',
      },
      body: JSON.stringify({ model: claim.model, messages: claim.history, stream: true }),
    });
    if (!response.ok) {
      await commit(`(OpenRouter error: HTTP ${response.status})`, 'error');
      return { outcome: 'error' };
    }
    reader = response.body.getReader();
    let carry = [];
    let lastCommitElapsed = 0;
    let uncommitted = false;
    let finished = false;
    while (!finished) {
      const chunk = await reader.read();
      if (chunk.done) break;
      let grew = false;
      for (let i = 0; i < chunk.value.length; i += 1) {
        const byte = chunk.value[i];
        if (byte !== 0x0a) { carry.push(byte); continue; }
        if (carry.length > 0 && carry[carry.length - 1] === 0x0d) carry.pop();
        const event = sseEvent(utf8Decode(carry));
        carry = [];
        if (!event) continue;
        if (event.done) { finished = true; break; }
        accumulated += event.token;
        grew = true;
      }
      if (grew) uncommitted = true;
      // @ref LLP 0076#authority-and-lifecycle — the progress-rate fence allows ten
      // authoritative commits per second; actions have no wall clock, so the
      // reader's trusted elapsedMs paces commits at >=200 ms spacing.
      if (uncommitted && chunk.elapsedMs - lastCommitElapsed >= 200) {
        await commit(accumulated, 'streaming');
        lastCommitElapsed = chunk.elapsedMs;
        uncommitted = false;
      }
    }
    if (finished) {
      try { await reader.cancel(); } catch (_) {}
    }
    await commit(accumulated.length > 0 ? accumulated : '(empty reply)', 'complete');
    return { outcome: 'complete', characters: accumulated.length };
  } catch (error) {
    if (reader) {
      try { await reader.cancel(); } catch (_) {}
    }
    const code = streamCode(error);
    const bounded =
      code === 'SNAPBACK_ACTION_STREAM_TIMEOUT' ||
      code === 'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT' ||
      code === 'SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED';
    // Hitting a stream ceiling with tokens in hand is a truncated reply, not
    // a failure: the wall/idle/byte limits are the platform's boundedness
    // contract, and the demo surfaces what arrived before the ceiling.
    if (bounded && accumulated.length > 0) {
      await commit(`${accumulated}\n\n(truncated: ${code})`, 'complete');
      return { outcome: 'truncated', code };
    }
    await commit(`(generation failed: ${String(error && error.message ? error.message : error)})`, 'error');
    return { outcome: 'error', code };
  }
}

globalThis.__snapbackHandlers = {
  createConversation,
  sendMessage,
  claimReply,
  applyAssistantDelta,
  generateReply,
};
