import {
  defineAction,
  defineJsMutation,
  results,
  v,
} from '@expo/snapback-codegen/define';

// A5 arm probe: is the documented streamed-action surface
// (guide/backend/streamed-actions.md) reachable on packaged 0.1.7?
// probeAttempt exercises ONLY the ctx.streamAttempt control plane (no
// fetchStream, so no bounded_response_stream_v1 requirement from the AST
// detector); probeFetchStream is added in phase 2 to test admission + the
// reader path.

export const recordProbe = defineJsMutation({
  args: { key: v.string(), note: v.string() },
  reads: ['probeRows'],
  writes: ['probeRows'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('probeRows').withIndex('by_key').eq('key', args.key).collect();
    if (existing.length > 0) {
      await ctx.db.patch('probeRows', existing[0]._id, { note: args.note, at: ctx.runtime.now() });
      return 2;
    }
    await ctx.db.insert('probeRows', { key: args.key, note: args.note, payload: { list: [1, 2, 3], nested: { ok: true } }, at: ctx.runtime.now() });
    return 1;
  },
});

export const probeAttempt = defineAction({
  args: { key: v.string() },
  result: results.value(v.object({
    startOutcome: v.string(),
    startShape: v.string(),
    settleOutcome: v.string(),
    rejoinOutcome: v.string(),
  })),
  writes: ['probeRows'],
  handler: async (ctx, args) => {
    let startOutcome = '';
    let startShape = '';
    let settleOutcome = '';
    let rejoinOutcome = '';
    let attempt = null;
    try {
      attempt = await ctx.streamAttempt.start(`a5-probe-${args.key}`);
      startOutcome = 'ok';
      startShape = `keys=${Object.keys(attempt ?? {}).sort().join(',')} terminal=${JSON.stringify(attempt && attempt.terminal ? attempt.terminal : null)}`;
    } catch (error) {
      startOutcome = `error: ${String(error && error.message ? error.message : error).slice(0, 200)}`;
    }
    if (attempt && attempt.attemptToken) {
      try {
        const settled = await ctx.streamAttempt.settle(attempt.attemptToken, 'complete');
        settleOutcome = `ok: ${JSON.stringify(settled).slice(0, 200)}`;
      } catch (error) {
        settleOutcome = `error: ${String(error && error.message ? error.message : error).slice(0, 200)}`;
      }
      try {
        const rejoin = await ctx.streamAttempt.start(`a5-probe-${args.key}`);
        rejoinOutcome = `terminal=${JSON.stringify(rejoin && rejoin.terminal ? rejoin.terminal : null).slice(0, 160)}`;
      } catch (error) {
        rejoinOutcome = `error: ${String(error && error.message ? error.message : error).slice(0, 200)}`;
      }
    }
    await ctx.runMutation('recordProbe', { key: args.key, note: `${startOutcome} | ${settleOutcome}` });
    return { startOutcome, startShape, settleOutcome, rejoinOutcome };
  },
});

export const probeFetchStream = defineAction({
  args: { url: v.string() },
  result: results.value(v.object({
    outcome: v.string(),
    reads: v.integer(),
    totalBytes: v.integer(),
    text: v.string(),
  })),
  writes: ['probeRows'],
  handler: async (ctx, args) => {
    let outcome = '';
    let reads = 0;
    let totalBytes = 0;
    let text = '';
    try {
      const attempt = await ctx.streamAttempt.start(`a5-fs-${args.url.length}`);
      const response = await ctx.fetchStream({
        url: args.url,
        method: 'GET',
        headers: { authorization: 'Bearer probe-token-abc', 'x-probe': 'a5' },
        body: null,
        idempotencyKey: null,
        attemptToken: attempt.attemptToken,
      });
      if (!response.ok) {
        outcome = `upstream-status-${response.status}`;
      } else {
        const reader = response.body.getReader();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          reads += 1;
          totalBytes += chunk.value.byteLength;
          let piece = '';
          for (const byte of chunk.value) piece += String.fromCharCode(byte);
          text += piece;
        }
        outcome = 'ok';
      }
      try { await ctx.streamAttempt.settle(attempt.attemptToken, 'complete'); } catch (error) { outcome += ` (settle: ${String(error && error.message ? error.message : error).slice(0, 80)})`; }
    } catch (error) {
      outcome = `error: ${String(error && error.message ? error.message : error).slice(0, 220)}`;
    }
    await ctx.runMutation('recordProbe', { key: 'fetchstream', note: outcome.slice(0, 200) });
    return { outcome, reads, totalBytes, text: text.slice(0, 120) };
  },
});
