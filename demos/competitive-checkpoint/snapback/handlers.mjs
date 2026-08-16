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
    fail('SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED', 'reply progress exceeds ten commits per second');
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
  if (row.status !== 'running') {
    // Already terminal (for example a durable client cancel): the authored
    // row may still adopt the host-derived certainty mirror exactly once
    // (LLP 0076 decision 2; protocol amendment v0.5).
    if (args.effectMayHaveExecuted != null && row.effectMayHaveExecuted == null) {
      await ctx.db.patch('messages', row._id, {
        effectMayHaveExecuted: args.effectMayHaveExecuted === true,
      });
    }
    return { status: row.status, sequence: row.sequence };
  }
  await ctx.db.patch('messages', row._id, {
    status: args.status,
    lastProgressAt: ctx.runtime.now(),
    ...(args.effectMayHaveExecuted == null
      ? {}
      : { effectMayHaveExecuted: args.effectMayHaveExecuted === true }),
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

// Bounded conflict reconcile for the action's inner mutations. A concurrent
// committed writer (the durable client cancel racing a progress commit — hit
// reliably on the slow shared-CPU remote drill machine, rarely locally)
// rejects the whole inner mutation as SNAPBACK_MUTATION_CONFLICT. Re-invoking
// IS the reconcile the guide requires (guide/backend/mutations.md: reconcile,
// never last-writer-wins): each of these mutations re-reads the row in a
// fresh transaction and re-evaluates its terminal/stale-sequence branches, so
// a cancel that won the race is observed as `terminal`, never overwritten.
async function runReconciled(ctx, name, mutationArgs) {
  for (let attemptsLeft = 3; ; attemptsLeft -= 1) {
    try {
      return await ctx.runMutation(name, mutationArgs);
    } catch (error) {
      if (attemptsLeft <= 1 || safeCode(error) !== 'SNAPBACK_MUTATION_CONFLICT') throw error;
    }
  }
}

async function streamReply(ctx, args) {
  let reader = null;
  let pending = '';
  let sequence = 0;
  let readsSinceCommit = 0;
  // The host-owned StreamAttemptV1 control plane (LLP 0076; protocol
  // amendment v0.5): the fence-critical identity, lease, and certainty live
  // on the host record keyed by the server-issued authored attemptId; the
  // authored row references it and mirrors the certainty read-only.
  const attempt = await ctx.streamAttempt.start('reply:' + args.attemptId);
  if (attempt.terminal) {
    // A durable winner already exists (a previous runner settled, or the
    // trusted terminalizer did): return it verbatim, never re-run.
    await runReconciled(ctx, 'settleReply', {
      attemptId: args.attemptId,
      status: attempt.terminal.cause === 'complete' ? 'failed' : attempt.terminal.cause,
      effectMayHaveExecuted: attempt.terminal.effectMayHaveExecuted,
    });
    return { outcome: attempt.terminal.cause, sequence: 0, replayedWinner: true };
  }
  const settleHost = async (cause) => {
    try {
      return await ctx.streamAttempt.settle(attempt.attemptToken, cause);
    } catch (_) {
      // Lease loss or abandonment: the trusted terminalizer owns the winner.
      return null;
    }
  };
  try {
    const response = await ctx.fetchStream({
      url: args.streamUrl,
      method: args.method,
      body: args.method === 'GET' ? null : '{}',
      idempotencyKey: args.upstreamIdempotent ? args.attemptId : null,
      attemptToken: attempt.attemptToken,
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
        const progress = await runReconciled(ctx, 'applyReplyProgress', {
          attemptId: args.attemptId,
          sequence,
          delta: pending,
        });
        if (progress.terminal) {
          await reader.cancel();
          const settled = await settleHost(progress.status === 'complete' ? 'complete' : progress.status);
          if (settled) {
            await runReconciled(ctx, 'settleReply', {
              attemptId: args.attemptId,
              status: settled.cause === 'complete' ? progress.status : settled.cause,
              effectMayHaveExecuted: settled.effectMayHaveExecuted,
            });
          }
          return { outcome: progress.status, sequence: progress.sequence };
        }
        pending = '';
        readsSinceCommit = 0;
      }
    }
    const terminalSequence = sequence + (pending.length > 0 ? 1 : 0);
    await runReconciled(ctx, 'completeReply', {
      attemptId: args.attemptId,
      sequence: terminalSequence,
      tail: pending,
    });
    await settleHost('complete');
    return { outcome: 'complete', sequence: terminalSequence };
  } catch (error) {
    if (reader) {
      try { await reader.cancel(); } catch (_) {}
    }
    const code = safeCode(error);
    if (code === 'SNAPBACK_REPLY_CANCELLED') {
      const settled = await settleHost('cancelled');
      if (settled) {
        await runReconciled(ctx, 'settleReply', {
          attemptId: args.attemptId,
          status: settled.cause === 'complete' ? 'cancelled' : settled.cause,
          effectMayHaveExecuted: settled.effectMayHaveExecuted,
        });
      }
      return { outcome: 'cancelled', sequence };
    }
    const local = code === 'SNAPBACK_ACTION_STREAM_UPSTREAM_AMBIGUOUS'
      ? 'ambiguous'
      : code === 'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT' || code === 'SNAPBACK_ACTION_STREAM_TIMEOUT'
        ? 'timed_out'
        : 'failed';
    // The committed durable winner is authoritative over local inference
    // (LLP 0076 §Settlement and retry): return whatever the host recorded.
    const settled = await settleHost(local);
    const status = settled && settled.cause !== 'complete' ? settled.cause : local;
    await runReconciled(ctx, 'settleReply', {
      attemptId: args.attemptId,
      status,
      effectMayHaveExecuted: settled ? settled.effectMayHaveExecuted : null,
    });
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
