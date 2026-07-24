function fail(code, message) {
  throw new Error(code + ': ' + message);
}

async function ownedAttempt(ctx, attemptId) {
  const rows = await ctx.db
    .query('messages')
    .withIndex('by_owner_attempt')
    .eq('ownerId', ctx.auth.userId)
    .eq('attemptId', attemptId)
    .collect();
  if (rows.length !== 1) fail('SNAPBACK_ROW_NOT_VISIBLE', 'reply attempt is not visible');
  return rows[0];
}

async function startReply(ctx, args) {
  const conversation = await ctx.db.get('conversations', args.conversationId);
  if (!conversation || conversation.ownerId !== ctx.auth.userId) {
    fail('SNAPBACK_ROW_NOT_VISIBLE', 'conversation is not visible');
  }
  const prior = await ctx.db
    .query('messages')
    .withIndex('by_owner_idempotency')
    .eq('ownerId', ctx.auth.userId)
    .eq('idempotencyKey', args.idempotencyKey)
    .collect();
  if (prior.length === 1) {
    return {
      attemptId: prior[0].attemptId,
      assistantMessageId: prior[0]._id,
      replayed: true,
    };
  }
  const now = ctx.runtime.now();
  const attemptId = ctx.runtime.id();
  await ctx.db.insert('messages', {
    ownerId: ctx.auth.userId,
    conversationId: args.conversationId,
    role: 'user',
    content: args.content,
    status: 'complete',
    attemptId: ctx.runtime.id(),
    idempotencyKey: 'user:' + args.idempotencyKey,
    sequence: 0,
    lastProgressAt: now,
    pageKey: ctx.runtime.id(),
  });
  const assistantMessageId = await ctx.db.insert('messages', {
    ownerId: ctx.auth.userId,
    conversationId: args.conversationId,
    role: 'assistant',
    content: '',
    status: 'running',
    attemptId,
    idempotencyKey: args.idempotencyKey,
    sequence: 0,
    lastProgressAt: now,
    pageKey: ctx.runtime.id(),
  });
  return { attemptId, assistantMessageId, replayed: false };
}

async function applyReplyProgress(ctx, args) {
  const row = await ownedAttempt(ctx, args.attemptId);
  if (row.status !== 'running') {
    return {
      applied: false,
      terminal: true,
      status: row.status,
      sequence: row.sequence,
    };
  }
  if (args.sequence <= row.sequence) {
    return { applied: false, terminal: false, sequence: row.sequence };
  }
  if (args.sequence !== row.sequence + 1) fail('SNAPBACK_REPLY_SEQUENCE_GAP', 'reply sequence is not contiguous');
  const now = ctx.runtime.now();
  if (row.sequence > 0 && now - row.lastProgressAt < 100) {
    fail('SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED', 'reply progress exceeds ten commits per second');
  }
  await ctx.db.patch('messages', row._id, {
    content: row.content + args.delta,
    sequence: args.sequence,
    lastProgressAt: now,
  });
  return { applied: true, terminal: false, sequence: args.sequence };
}

async function completeReply(ctx, args) {
  const row = await ownedAttempt(ctx, args.attemptId);
  if (row.status === 'complete') return { status: 'complete', sequence: row.sequence };
  if (row.status !== 'running') fail('SNAPBACK_REPLY_CANCELLED', 'reply is terminal');
  if (args.sequence !== row.sequence + (args.tail.length > 0 ? 1 : 0)) {
    fail('SNAPBACK_REPLY_SEQUENCE_GAP', 'terminal reply sequence is not contiguous');
  }
  await ctx.db.patch('messages', row._id, {
    content: row.content + args.tail,
    sequence: args.sequence,
    status: 'complete',
    lastProgressAt: ctx.runtime.now(),
  });
  return { status: 'complete', sequence: args.sequence };
}

async function settleReply(ctx, args) {
  const allowed = ['failed', 'cancelled', 'timed_out', 'ambiguous'];
  if (!allowed.includes(args.status)) fail('SNAPBACK_REPLY_SETTLEMENT_INVALID', 'unknown terminal settlement');
  const row = await ownedAttempt(ctx, args.attemptId);
  if (row.status !== 'running') return { status: row.status, sequence: row.sequence };
  await ctx.db.patch('messages', row._id, {
    status: args.status,
    lastProgressAt: ctx.runtime.now(),
  });
  return { status: args.status, sequence: row.sequence };
}

async function cancelReply(ctx, args) {
  const row = await ownedAttempt(ctx, args.attemptId);
  if (row.status !== 'running') return { status: row.status, sequence: row.sequence };
  await ctx.db.patch('messages', row._id, {
    status: 'cancelled',
    lastProgressAt: ctx.runtime.now(),
  });
  return { status: 'cancelled', sequence: row.sequence };
}

function safeCode(error) {
  const message = String(error && error.message ? error.message : error);
  const match = message.match(/SNAPBACK_[A-Z0-9_]+/);
  return match ? match[0] : 'SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED';
}

function ascii(bytes) {
  let text = '';
  for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]);
  return text;
}

async function streamReply(ctx, args) {
  let reader = null;
  let pending = '';
  let sequence = 0;
  let readsSinceCommit = 0;
  try {
    const response = await ctx.fetchStream({
      url: args.streamUrl,
      method: args.method,
      body: args.method === 'GET' ? null : '{}',
      idempotencyKey: args.upstreamIdempotent ? args.attemptId : null,
    });
    if (!response.ok) fail('SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED', 'upstream returned a non-success status');
    reader = response.body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += ascii(chunk.value);
      readsSinceCommit += 1;
      if (readsSinceCommit >= 2) {
        sequence += 1;
        const progress = await ctx.runMutation('applyReplyProgress', {
          attemptId: args.attemptId,
          sequence,
          delta: pending,
        });
        if (progress.terminal) {
          await reader.cancel();
          return { outcome: progress.status, sequence: progress.sequence };
        }
        pending = '';
        readsSinceCommit = 0;
      }
    }
    const terminalSequence = sequence + (pending.length > 0 ? 1 : 0);
    await ctx.runMutation('completeReply', {
      attemptId: args.attemptId,
      sequence: terminalSequence,
      tail: pending,
    });
    return { outcome: 'complete', sequence: terminalSequence };
  } catch (error) {
    if (reader) {
      try { await reader.cancel(); } catch (_) {}
    }
    const code = safeCode(error);
    if (code === 'SNAPBACK_REPLY_CANCELLED') return { outcome: 'cancelled', sequence };
    const status = code === 'SNAPBACK_ACTION_STREAM_UPSTREAM_AMBIGUOUS'
      ? 'ambiguous'
      : code === 'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT' || code === 'SNAPBACK_ACTION_STREAM_TIMEOUT'
        ? 'timed_out'
        : 'failed';
    await ctx.runMutation('settleReply', { attemptId: args.attemptId, status });
    return { outcome: status, sequence, code };
  }
}

globalThis.__snapbackHandlers = {
  startReply,
  applyReplyProgress,
  completeReply,
  settleReply,
  cancelReply,
  streamReply,
};
