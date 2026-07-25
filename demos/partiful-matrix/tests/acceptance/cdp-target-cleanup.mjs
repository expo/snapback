import assert from 'node:assert/strict';

// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — target
// cleanup is outside every timed interval, but a close-response race must
// still be proven by a fresh browser connection before the next sample.

export async function freshBrowserCommand(
  url,
  method,
  params = {},
  timeoutMs = 15_000,
) {
  const socket = new WebSocket(url);
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      callback(value);
    };
    const timer = setTimeout(
      () => finish(reject, new Error(`fresh CDP timeout: ${method}`)),
      timeoutMs,
    );
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method, params }));
    }, { once: true });
    socket.addEventListener('error', () => {
      finish(reject, new Error(`fresh CDP connection failed: ${method}`));
    }, { once: true });
    socket.addEventListener('close', () => {
      if (!settled) {
        finish(reject, new Error(`fresh CDP connection closed: ${method}`));
      }
    }, { once: true });
    socket.addEventListener('message', async (event) => {
      const message = JSON.parse(
        typeof event.data === 'string' ? event.data : await event.data.text(),
      );
      if (message.id !== 1) return;
      if (message.error) {
        finish(reject, new Error(message.error.message));
      } else {
        finish(resolve, message.result ?? {});
      }
    });
  });
}

export async function closeTargetReliably({
  targetId,
  closeTarget,
  listTargetsFresh,
  closeTargetFresh,
}) {
  let originalError = null;
  try {
    const result = await closeTarget();
    assert.notEqual(result.success, false, `Chrome refused to close target ${targetId}`);
    return { recovered: false };
  } catch (error) {
    originalError = error;
  }

  let targets = await listTargetsFresh();
  if (!targets.some((target) => target.targetId === targetId)) {
    return { recovered: true, race: 'response-lost-after-close' };
  }

  try {
    const result = await closeTargetFresh();
    assert.notEqual(
      result.success,
      false,
      `fresh Chrome connection refused to close target ${targetId}`,
    );
  } catch {
    // The second close has the same response-loss race. The authoritative
    // fact is the following fresh target inventory, not either response.
  }
  targets = await listTargetsFresh();
  if (!targets.some((target) => target.targetId === targetId)) {
    return { recovered: true, race: 'original-connection-stalled' };
  }
  throw originalError;
}
