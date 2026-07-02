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

  static auth(userId, { permissions = [] } = {}) {
    return { principal: userId ?? null, session_id: null, user_id: userId ?? null, permissions };
  }

  static roomPermission(prefix, scope) {
    return `${prefix}:${normalizedScopeKey(scope)}`;
  }

  async #req(method, path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    // @ref LLP 0032#confirmed-defect-register — S5.D3: check status before
    //   trusting the body as JSON, so a proxy 502 HTML page surfaces as a
    //   structured diagnostic instead of a bare SyntaxError.
    let json = null;
    let parseError = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (error) {
        parseError = error;
      }
    }
    if (!res.ok) {
      const diag = json && json.diagnostic
        ? json.diagnostic
        : parseError
          ? { code: 'SNAPBACK_HTTP_ERROR', message: `HTTP ${res.status} with non-JSON body: ${bodySnippet(text)}` }
          : { code: `HTTP_${res.status}`, message: text };
      const error = new Error(`${diag.code}: ${diag.message ?? ''}`);
      error.diagnostic = diag;
      error.status = res.status;
      throw error;
    }
    if (parseError) {
      const diag = { code: 'SNAPBACK_RESPONSE_NOT_JSON', message: `HTTP ${res.status} response is not JSON: ${bodySnippet(text)}` };
      const error = new Error(`${diag.code}: ${diag.message}`);
      error.diagnostic = diag;
      error.status = res.status;
      throw error;
    }
    return json;
  }

  health() { return this.#req('GET', '/health'); }
  inspect() { return this.#req('GET', '/inspect'); }
  loadSchema(manifest) { return this.#req('POST', '/admin/schema', manifest); }
  ensureEphemeralCollections(manifestOrCollections) {
    const collections = Array.isArray(manifestOrCollections)
      ? manifestOrCollections
      : manifestOrCollections?.ephemeralCollections ?? manifestOrCollections?.collections ?? [];
    return this.#req('POST', '/ephemeral/collections/ensure', {
      collections,
      schemaHash: manifestOrCollections?.schemaHash ?? null,
      inputsHash: manifestOrCollections?.inputsHash ?? null,
    });
  }
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

  subscribeEphemeral(ref, { connectionId, scope = {}, userId, permissions = [] } = {}) {
    const collection = collectionName(ref);
    return this.#req('POST', '/ephemeral/subscribe', {
      collection,
      scope,
      connection_id: connectionId,
      auth: SnapbackClient.auth(userId, { permissions }),
    }).then((snapshot) => new EphemeralOverlay(this, ref, { connectionId, scope, userId, permissions, snapshot }));
  }

  publishEphemeral(ref, { connectionId, scope = {}, value, ttlMs = null, userId, permissions = [], sessionId = null, ownerUserId = null, customKey = null } = {}) {
    return this.#req('POST', '/ephemeral/publish', {
      collection: collectionName(ref),
      scope,
      connection_id: connectionId,
      session_id: sessionId,
      user_id: ownerUserId,
      custom_key: customKey,
      value: encodeEphemeralValue(value),
      ttl_ms: ttlMs,
      auth: SnapbackClient.auth(userId, { permissions }),
    });
  }

  deleteEphemeral(ref, { connectionId, scope = {}, userId, permissions = [], sessionId = null, ownerUserId = null, customKey = null } = {}) {
    return this.#req('POST', '/ephemeral/delete', {
      collection: collectionName(ref),
      scope,
      connection_id: connectionId,
      session_id: sessionId,
      user_id: ownerUserId,
      custom_key: customKey,
      auth: SnapbackClient.auth(userId, { permissions }),
    });
  }

  disconnect(connectionId) {
    return this.#req('POST', `/connections/${connectionId}/disconnect`);
  }

  async drainEnvelopes(connectionId) {
    return this.#req('GET', `/outbox/${connectionId}`);
  }

  // Drains a connection's outbox and decodes durable live-query updates.
  async drainUpdates(connectionId) {
    const envelopes = await this.drainEnvelopes(connectionId);
    const updates = [];
    for (const env of envelopes) {
      if (env && env.Durable) {
        const text = decodeDurablePayload(env.Durable.payload);
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
      streamError ??= error; // first failure wins; a later close never masks it
      while (waiters.length > 0) waiters.shift().reject(streamError);
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
    // @ref LLP 0032#confirmed-defect-register — S5.D7: latch unconditionally on
    //   close (not just when waiters are pending) so a later nextUpdate() rejects
    //   immediately instead of hanging until its timeout.
    ws.addEventListener('close', () => fail(new Error(`Snapback live stream closed: ${url}`)), { once: true });

    return {
      ready: new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', () => reject(new Error(`Snapback live stream failed: ${url}`)), { once: true });
      }),
      close: () => ws.close(),
      sendJson: (message) => ws.send(JSON.stringify(message)),
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

export class EphemeralOverlay {
  // @ref LLP 0013#client-overlay-store — generated clients keep ephemeral
  // entries in memory, apply scope/version checks, and prune by server TTL.
  constructor(client, ref, { connectionId, scope, userId, permissions, snapshot }) {
    this.client = client;
    this.ref = ref;
    this.connectionId = connectionId;
    this.scope = scope;
    this.userId = userId;
    this.permissions = permissions;
    this.scopeEpoch = null;
    this.entries = new Map();
    this.needsResync = false;
    if (snapshot) this.apply(snapshot);
  }

  publish(value, options = {}) {
    return this.client.publishEphemeral(this.ref, {
      connectionId: options.connectionId ?? this.connectionId,
      scope: this.scope,
      value,
      ttlMs: options.ttlMs ?? null,
      userId: options.userId ?? this.userId,
      permissions: options.permissions ?? this.permissions,
      sessionId: options.sessionId ?? null,
      ownerUserId: options.ownerUserId ?? null,
      customKey: options.customKey ?? null,
    });
  }

  delete(options = {}) {
    return this.client.deleteEphemeral(this.ref, {
      connectionId: options.connectionId ?? this.connectionId,
      scope: this.scope,
      userId: options.userId ?? this.userId,
      permissions: options.permissions ?? this.permissions,
      sessionId: options.sessionId ?? null,
      ownerUserId: options.ownerUserId ?? null,
      customKey: options.customKey ?? null,
    });
  }

  async drain() {
    const envelopes = await this.client.drainEnvelopes(this.connectionId);
    const applied = [];
    for (const envelope of envelopes) {
      const result = this.apply(envelope);
      if (result !== 'not_ephemeral') applied.push(result);
    }
    return applied;
  }

  apply(input) {
    const message = unwrapEphemeralMessage(input);
    if (!message) return 'not_ephemeral';
    if (message.Snapshot) {
      this.scopeEpoch = message.Snapshot.scope_epoch;
      this.entries.clear();
      for (const entry of message.Snapshot.entries ?? []) {
        this.entries.set(entry.key, normalizeEntry(entry));
      }
      this.needsResync = false;
      return 'applied';
    }
    if (message.Upsert) {
      const entry = normalizeEntry(message.Upsert.entry);
      if (this.scopeEpoch !== entry.scopeEpoch) {
        this.needsResync = true;
        return 'needs_resync';
      }
      const current = this.entries.get(entry.key);
      if (current && current.entryVersion >= entry.entryVersion) return 'ignored_stale';
      this.entries.set(entry.key, entry);
      return 'applied';
    }
    if (message.Remove) {
      const remove = message.Remove;
      if (this.scopeEpoch !== remove.scope_epoch) {
        this.needsResync = true;
        return 'needs_resync';
      }
      const current = this.entries.get(remove.key);
      if (current && current.entryVersion > remove.entry_version) return 'ignored_stale';
      this.entries.delete(remove.key);
      return 'applied';
    }
    if (message.ResyncRequired) {
      this.entries.clear();
      this.needsResync = true;
      return 'needs_resync';
    }
    return 'not_ephemeral';
  }

  pruneExpired(nowMs = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs <= nowMs) this.entries.delete(key);
    }
  }

  currentEntries({ prune = true } = {}) {
    if (prune) this.pruneExpired();
    return [...this.entries.values()].map((entry) => ({
      key: entry.key,
      value: entry.value,
      expiresAtMs: entry.expiresAtMs,
      receivedAtMs: entry.receivedAtMs,
      scopeEpoch: entry.scopeEpoch,
      entryVersion: entry.entryVersion,
    }));
  }
}

function functionName(ref) {
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref.name === 'string') return ref.name;
  throw new TypeError(`Snapback function reference must be a string or generated ref, got ${JSON.stringify(ref)}`);
}

function collectionName(ref) {
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref.name === 'string') return ref.name;
  throw new TypeError(`Snapback ephemeral collection reference must be a string or generated ref, got ${JSON.stringify(ref)}`);
}

function encodeEphemeralValue(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  return [...bytes];
}

function decodeEphemeralValue(bytes) {
  const text = new TextDecoder().decode(Uint8Array.from(bytes ?? []));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function decodeDurablePayload(payload) {
  if (typeof payload === 'string') return payload;
  return new TextDecoder().decode(Uint8Array.from(payload ?? []));
}

function unwrapEphemeralMessage(input) {
  if (!input) return null;
  if (input.Ephemeral) return input.Ephemeral;
  if (input.kind === 'ephemeral') return input.message;
  if (input.message) return input.message;
  if (input.Snapshot || input.Upsert || input.Remove || input.ResyncRequired || input.Error) return input;
  return null;
}

function normalizeEntry(entry) {
  return {
    key: entry.key,
    value: decodeEphemeralValue(entry.value),
    receivedAtMs: entry.received_at_ms,
    expiresAtMs: entry.expires_at_ms,
    scopeEpoch: entry.scope_epoch,
    entryVersion: entry.entry_version,
  };
}

function normalizedScopeKey(scope) {
  return Object.entries(scope)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${String(key).length}:${key}=${String(value).length}:${value}`)
    .join('|');
}

function bodySnippet(text, limit = 200) {
  const collapsed = String(text ?? '').replace(/\s+/g, ' ').trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…`;
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
