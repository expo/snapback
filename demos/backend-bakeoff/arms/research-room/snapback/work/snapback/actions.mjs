function fail(code, message) {
  throw new Error(`${code}: ${message}`);
}

function safeCode(error) {
  const match = String(error?.message ?? error).match(/SNAPBACK_[A-Z0-9_]+/);
  return match ? match[0] : 'SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED';
}

function ascii(bytes) {
  let text = '';
  for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]);
  return text;
}

async function reconciled(ctx, name, args) {
  for (let remaining = 3; ; remaining -= 1) {
    try {
      return await ctx.runMutation(name, args);
    } catch (error) {
      if (remaining <= 1 || safeCode(error) !== 'SNAPBACK_MUTATION_CONFLICT') throw error;
    }
  }
}

async function streamAnswer(ctx, args) {
  let reader = null;
  let sequence = 0;
  let pending = '';
  let reads = 0;
  const attempt = await ctx.streamAttempt.start(`research:${args.attemptId}`);
  if (attempt.terminal) {
    const mirror = attempt.terminal.cause === 'complete' ? 'failed' : attempt.terminal.cause;
    await reconciled(ctx, 'settleAnswer', {
      attemptId: args.attemptId,
      status: mirror,
      effectMayHaveExecuted: attempt.terminal.effectMayHaveExecuted,
    });
    return { outcome: attempt.terminal.cause, replayedWinner: true, sequence: 0 };
  }
  const settleHost = async (cause) => {
    try {
      return await ctx.streamAttempt.settle(attempt.attemptToken, cause);
    } catch {
      return null;
    }
  };
  try {
    const token = ctx.secrets.get('researchProviderToken').expose();
    const response = await ctx.fetchStream({
      url: args.streamUrl,
      method: args.method,
      body: args.method === 'GET' ? null : '{}',
      headers: { Authorization: `Bearer ${token}` },
      attemptToken: attempt.attemptToken,
    });
    if (!response.ok) fail('SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED', 'upstream returned failure');
    reader = response.body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += ascii(chunk.value);
      reads += 1;
      if (reads >= 2) {
        sequence += 1;
        const progress = await reconciled(ctx, 'applyAnswerProgress', {
          attemptId: args.attemptId,
          sequence,
          delta: pending,
        });
        if (progress.terminal) {
          await reader.cancel();
          const host = await settleHost(progress.status === 'complete' ? 'complete' : progress.status);
          if (host && host.cause !== 'complete') {
            await reconciled(ctx, 'settleAnswer', {
              attemptId: args.attemptId,
              status: host.cause,
              effectMayHaveExecuted: host.effectMayHaveExecuted,
            });
          }
          return { outcome: progress.status, sequence: progress.sequence };
        }
        pending = '';
        reads = 0;
      }
    }
    const terminalSequence = sequence + (pending.length > 0 ? 1 : 0);
    const completed = await reconciled(ctx, 'completeAnswer', {
      attemptId: args.attemptId,
      sequence: terminalSequence,
      tail: pending,
    });
    const host = await settleHost(completed.status === 'complete' ? 'complete' : completed.status);
    return {
      outcome: host?.cause ?? completed.status,
      sequence: completed.sequence,
    };
  } catch (error) {
    if (reader) {
      try { await reader.cancel(); } catch {}
    }
    const code = safeCode(error);
    const inferred = code === 'SNAPBACK_ACTION_STREAM_UPSTREAM_AMBIGUOUS'
      ? 'ambiguous'
      : code === 'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT' || code === 'SNAPBACK_ACTION_STREAM_TIMEOUT'
        ? 'timed_out'
        : 'failed';
    const host = await settleHost(inferred);
    const status = host && host.cause !== 'complete' ? host.cause : inferred;
    await reconciled(ctx, 'settleAnswer', {
      attemptId: args.attemptId,
      status,
      effectMayHaveExecuted: host?.effectMayHaveExecuted,
    });
    return { outcome: status, sequence, code };
  }
}

async function refreshScheduledSource(ctx) {
  const token = ctx.secrets.get('researchProviderToken').expose();
  const response = await fetch('http://127.0.0.1:20440/refresh', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) fail('SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED', 'refresh fetch failed');
  const payload = await response.json();
  return await ctx.runMutation('applyScheduledRefresh', payload);
}

globalThis.__snapbackHandlers = {
  streamAnswer,
  refreshScheduledSource,
};
