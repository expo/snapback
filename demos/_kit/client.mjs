// Headless Snapback client adapter — the shared bridge, not per-demo glue.
//
// @ref LLP 0012#contract-artifacts — the bridge is a first-class
//   adapter (one shared client), not ~200 lines re-copied per demo as in Valet.
// @ref LLP 0012#runtime-state — subscribing returns the authoritative initial
//   snapshot *and* the live stream as one "current value + subscription" seam, so
//   no adapter races a manual prime against later updates.
// @ref LLP 0012#react-and-expo-requirements — this is an Online-class adapter
//   (speaks the wire protocol, server-authoritative mutations); it does NOT run
//   handlers locally, so it makes no local-first/Parity claim.

export class SnapbackClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  static auth(userId) {
    return { principal: userId ?? null, session_id: null, user_id: userId ?? null };
  }

  async #req(method, path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const diag = json && json.diagnostic ? json.diagnostic : { code: `HTTP_${res.status}`, message: text };
      const error = new Error(`${diag.code}: ${diag.message ?? ''}`);
      error.diagnostic = diag;
      error.status = res.status;
      throw error;
    }
    return json;
  }

  health() { return this.#req('GET', '/health'); }
  inspect() { return this.#req('GET', '/inspect'); }
  loadSchema(manifest) { return this.#req('POST', '/admin/schema', manifest); }
  loadFunctions(manifest) { return this.#req('POST', '/admin/functions', manifest); }
  reset() { return this.#req('POST', '/admin/reset'); }
  seed(seed) { return this.#req('POST', '/admin/seed', seed); }

  query(ref, { args = {}, userId, readSet = [] } = {}) {
    const name = functionName(ref);
    return this.#req('POST', `/query/${name}`, { args, auth: SnapbackClient.auth(userId), read_set: readSet });
  }

  mutate(ref, { args = {}, userId, readSet = [] } = {}) {
    const name = functionName(ref);
    return this.#req('POST', `/mutation/${name}`, { args, auth: SnapbackClient.auth(userId), read_set: readSet });
  }

  async subscribeLive(ref, { connectionId, args = {}, userId } = {}) {
    const name = functionName(ref);
    return this.#req('POST', `/live/${name}/subscribe`, {
      connection_id: connectionId,
      input: { args, auth: SnapbackClient.auth(userId), read_set: [] },
    });
  }

  // Drains a connection's outbox and decodes durable live-query updates.
  async drainUpdates(connectionId) {
    const envelopes = await this.#req('GET', `/outbox/${connectionId}`);
    const updates = [];
    for (const env of envelopes) {
      if (env && env.Durable) {
        const text = Buffer.from(env.Durable.payload).toString('utf8');
        updates.push(JSON.parse(text));
      }
    }
    return updates;
  }

  openLiveStream(connectionId) {
    const url = `${this.baseUrl.replace(/^http/, 'ws')}/live/${connectionId}/stream`;
    const ws = new WebSocket(url);
    const queue = [];
    const waiters = [];
    let streamError = null;
    const fail = (error) => {
      streamError = error;
      while (waiters.length > 0) waiters.shift().reject(error);
    };
    ws.addEventListener('message', async (event) => {
      try {
        const update = JSON.parse(await websocketText(event.data));
        const waiter = waiters.shift();
        if (waiter) waiter.resolve(update);
        else queue.push(update);
      } catch (error) {
        fail(error);
      }
    });
    ws.addEventListener('error', () => fail(new Error(`Snapback live stream failed: ${url}`)), { once: true });
    ws.addEventListener('close', () => {
      if (waiters.length > 0) fail(new Error(`Snapback live stream closed: ${url}`));
    });

    return {
      ready: new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', () => reject(new Error(`Snapback live stream failed: ${url}`)), { once: true });
      }),
      close: () => ws.close(),
      nextUpdate: (timeoutMs = 2_000) => {
        if (queue.length > 0) return Promise.resolve(queue.shift());
        if (streamError) return Promise.reject(streamError);
        return withTimeout(
          new Promise((resolve, reject) => waiters.push({ resolve, reject })),
          timeoutMs,
          `timed out waiting for Snapback live stream update on ${connectionId}`,
        );
      },
    };
  }

  // The "current value + subscription" seam as a small live handle: holds the
  // latest rows, starting from the authoritative snapshot, and applies
  // live_replace deltas drained from the outbox.
  async liveQuery(ref, { connectionId, args = {}, userId } = {}) {
    const name = functionName(ref);
    const sub = await this.subscribeLive(name, { connectionId, args, userId });
    const handle = {
      subscriptionId: sub.subscription_id,
      version: sub.snapshot.version,
      rows: sub.snapshot.rows,
      poll: async () => {
        const updates = await this.drainUpdates(connectionId);
        for (const u of updates) {
          if (u.subscription_id === handle.subscriptionId) {
            handle.rows = u.rows;
            handle.version = u.version;
          }
        }
        return handle.rows;
      },
    };
    return handle;
  }
}

function functionName(ref) {
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref.name === 'string') return ref.name;
  throw new TypeError(`Snapback function reference must be a string or generated ref, got ${JSON.stringify(ref)}`);
}

async function websocketText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data && typeof data.text === 'function') return data.text();
  return String(data);
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
