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
// @ref LLP 0034#d1--durable-push-to-the-browser — `liveQuery` gains a `stream`
//   transport over the managed shared live socket (one socket, both lanes) with
//   poll fallback, reconnect-by-fresh-subscribe, and the Exact LLP 0284 §2.2
//   connection axis.

// ---------------------------------------------------------------------------
// D1 freshness + reconnect policy (LLP 0034 §2.2/§2.3; Exact LLP 0284 §2.2).
//
// The server sends nothing on an idle-healthy socket, so freshness is a
// kit-derived policy with explicit timers: the client sends an app-level
// `{"type":"ping"}` every LIVE_HEARTBEAT_INTERVAL_MS while the socket is open
// (the server answers `{"kind":"pong"}` immediately — src/server.rs), and any
// received frame counts as socket activity. The freshness budget is
// LIVE_FRESHNESS_BUDGET_MS = 3x the heartbeat interval; silence past the
// budget is a missed budget: the socket is force-closed and reconnect begins.
//
// Connection-axis mapping (normative table, LLP 0034 §2.2):
//
//   | provider state                                              | value          |
//   |-------------------------------------------------------------|----------------|
//   | socket connecting / (re)subscribe in flight                 | 'connecting'   |
//   | socket open, subscription established, heartbeat in budget  | 'live'         |
//   | no socket; HTTP drain timer active at declared cadence      | 'polling'      |
//   | freshness budget missed while retry/backoff is in progress  | 'stale'        |
//   | closed with no retry scheduled; drain stopped               | 'disconnected' |
//
// Notes against the table as implemented:
// - With poll fallback enabled (the default), losing the socket goes straight
//   to 'polling' — the declared-cadence drain is a healthy declared transport,
//   not a degradation mystery. With fallback disabled, socket loss goes to
//   'stale' (last-known rows renderable, retry in progress).
// - transport:'poll' handles (the pre-D1 behavior, still the default) report
//   'polling' after establish: the cadence is caller-owned there, so the kit
//   claims no freshness budget for them.
//
// Reconnect (LLP 0034 §2.3, amended): the server drops a connection's durable
// subscriptions when its socket closes (src/server.rs live_stream ->
// LocalSnapback::disconnect), so there is nothing to resume across a socket
// loss. Reconnect therefore ALWAYS re-enters through a fresh subscribe_live —
// snapshot-with-subscribe, never a prime race — and emits a 'resubscribed'
// subscription event. `resume_live` is not used across socket loss; a
// subscription-survival grace window is future work.
// ---------------------------------------------------------------------------
export const LIVE_HEARTBEAT_INTERVAL_MS = 5_000;
export const LIVE_FRESHNESS_BUDGET_MS = LIVE_HEARTBEAT_INTERVAL_MS * 3;
export const LIVE_RECONNECT_BASE_DELAY_MS = 250;
export const LIVE_RECONNECT_MAX_DELAY_MS = 10_000;
// Provider poll floor: the declared HTTP outbox drain cadence used as the
// stream fallback and emitted by codegen as the manifest `pollCadenceMs`.
export const DEFAULT_POLL_CADENCE_MS = 1_500;
// Grace before the fallback path re-subscribes after a socket loss, so the
// server has processed the closing socket's disconnect (which drops the
// connection's subscriptions) before the fresh subscribe_live lands.
const RESUBSCRIBE_AFTER_LOSS_DELAY_MS = 300;

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
  // @ref LLP 0031#migration-plan — system writes moved from ungated root
  //   /admin/* aliases to the gated /_snapback/api/* namespace (D5). On loopback
  //   with no admin token these are open, so local demos are unaffected.
  loadSchema(manifest) { return this.#req('POST', '/_snapback/api/schema/load', manifest); }
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
  loadFunctions(manifest) { return this.#req('POST', '/_snapback/api/functions/load', manifest); }
  // app.reset folds seed in as an optional argument (LLP 0031 D5): reset() wipes,
  // reset(seed) / seed(seed) reset-then-seed. There is no seed-without-reset path.
  reset(seed) { return this.#req('POST', '/_snapback/api/app/reset', seed ? { seed } : {}); }
  seed(seed) { return this.#req('POST', '/_snapback/api/app/reset', { seed }); }

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

  // @ref LLP 0031#resolved-decisions — D2: connection teardown is system/control,
  //   moved under the gated /_snapback/api/* namespace.
  disconnect(connectionId) {
    return this.#req('POST', `/_snapback/api/connections/${connectionId}/disconnect`);
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

  // The shared managed live socket for one connection (LLP 0034 §2.1: a
  // connection opens at most one live socket; it carries durable deltas AND
  // ephemeral push). Created on first use; reference-counted by attached
  // consumers; reconnects with backoff while demand exists.
  liveStreamManager(connectionId, options = {}) {
    this.__liveStreamManagers ??= new Map();
    let manager = this.__liveStreamManagers.get(connectionId);
    if (!manager) {
      manager = new LiveStreamManager(this, connectionId, options, () => {
        this.__liveStreamManagers.delete(connectionId);
      });
      this.__liveStreamManagers.set(connectionId, manager);
    }
    return manager;
  }

  // The "current value + subscription" seam as a live handle: holds the latest
  // rows, starting from the authoritative snapshot (snapshot-with-subscribe,
  // one operation — LLP 0034 §1 / Exact LLP 0284 §2.1 rule 1).
  //
  // transport:'poll' (default, pre-D1 behavior): the caller drains updates
  // manually via handle.poll(); nothing else runs.
  //
  // transport:'stream' (LLP 0034 D1): updates are pushed over the managed
  // shared live socket; on socket loss the handle falls back to draining the
  // HTTP outbox at `pollCadenceMs` (unless fallbackToPoll:false) while the
  // socket retries with backoff; reconnect always re-enters through a fresh
  // subscribe_live and emits a 'resubscribed' subscription event.
  async liveQuery(ref, {
    connectionId,
    args = {},
    userId,
    transport = 'poll',
    pollCadenceMs = DEFAULT_POLL_CADENCE_MS,
    fallbackToPoll = true,
    onUpdate = null,
    onConnectionChange = null,
    onSubscriptionEvent = null,
    stream: streamOptions = {},
  } = {}) {
    const name = functionName(ref);
    const client = this;

    let connection = 'connecting';
    let disposed = false;
    let paused = false;
    let resubscribing = false;
    let fallbackTimer = null;
    let detachStream = null;
    let streamedSinceSubscribe = false;
    // True while the HTTP drain fallback owns delivery (socket down).
    let fellBack = false;
    // True when the server has (or may have) dropped this connection's durable
    // subscriptions — an OPEN socket's close triggers server-side disconnect —
    // and a fresh snapshot-with-subscribe has not landed yet.
    let needsResubscribe = false;

    const handle = {
      subscriptionId: null,
      version: 0,
      rows: [],
      get connection() {
        return connection;
      },
    };

    const setConnection = (next) => {
      if (disposed && next !== 'disconnected') return;
      if (connection === next) return;
      const previous = connection;
      connection = next;
      onConnectionChange?.(next, { previous });
    };

    // Minimal subscription events (LLP 0034 D1; the Exact LLP 0284 §2.6
    // SubscriptionReceipt 'event' vocabulary — full receipt fields are D2).
    // Versions are the server's durable commit versions carried on the
    // snapshot and every live_replace; the kit assigns no sequence of its own.
    const emitEvent = (event, extra = {}) => {
      onSubscriptionEvent?.({
        bindingId: handle.subscriptionId,
        event,
        transport: transport === 'stream' && streamedSinceSubscribe ? 'push' : 'poll',
        scope: { ...args },
        snapshotVersion: handle.version,
        lastDeltaVersion: handle.version,
        ...extra,
      });
    };

    const applyDurable = (update) => {
      if (disposed || paused || !update || typeof update !== 'object') return;
      if (update.kind === 'live_replace') {
        // Updates for a superseded (pre-resubscribe) subscription id are
        // ignored; versions are non-decreasing per subscription (the global
        // durable commit version assigned at fan-out).
        if (update.subscription_id !== handle.subscriptionId) return;
        if (typeof update.version === 'number' && update.version < handle.version) return;
        handle.rows = update.rows;
        handle.version = update.version;
        onUpdate?.(handle.rows, { version: handle.version, kind: 'live_replace' });
        return;
      }
      if (update.kind === 'resync_required') {
        // Connection-wide outbox overflow carries no subscription_id
        // (src/ephemeral.rs OutboundQueue::overflow); subscription-scoped
        // resyncs (permission epoch changes, fan-out failures) do. Either
        // way the recovery is the same: fresh snapshot-with-subscribe.
        if (update.subscription_id && update.subscription_id !== handle.subscriptionId) return;
        void resubscribe(resyncReason(update.reason));
      }
    };

    const subscribeFresh = async () => {
      const sub = await client.subscribeLive(name, { connectionId, args, userId });
      handle.subscriptionId = sub.subscription_id;
      handle.version = sub.snapshot.version;
      handle.rows = sub.snapshot.rows;
      return sub;
    };

    // Reconnect/resync re-entry: always a fresh subscribe_live (see the policy
    // block at the top of this file — the server drops a connection's durable
    // subscriptions on socket close, so there is nothing to resume). Note: on
    // in-band resyncs (overflow, permission epoch) the superseded subscription
    // may remain registered server-side until the connection disconnects or is
    // reaped; its updates are ignored by subscription-id filtering above.
    const resubscribe = async (reason) => {
      if (disposed || paused || resubscribing) return;
      resubscribing = true;
      try {
        await subscribeFresh();
        needsResubscribe = false;
        emitEvent('resubscribed', { reason });
        onUpdate?.(handle.rows, { version: handle.version, kind: 'snapshot' });
      } catch (error) {
        // Retry rides the transport's own cadence: the next poll tick or the
        // next socket regain re-enters here.
        onConnectionChange?.(connection, { previous: connection, error });
      } finally {
        resubscribing = false;
      }
    };

    const drainOnce = async () => {
      // HTTP outbox drain: one bounded queue per connection, durable lane
      // first, then resync, then coalesced ephemeral (OutboundQueue::drain —
      // durable-over-ephemeral priority, LLP 0013 §delivery-lanes). The kit
      // preserves arrival order and never reorders ephemeral ahead of durable.
      const updates = await client.drainUpdates(connectionId);
      for (const update of updates) applyDurable(update);
      return handle.rows;
    };

    const stopFallback = () => {
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const startFallback = () => {
      if (fallbackTimer || disposed || paused) return;
      fallbackTimer = setInterval(() => {
        drainOnce().catch(() => {
          // Poll failures while the socket also retries: budget missed.
          setConnection('stale');
        });
      }, pollCadenceMs);
      // Background timers never hold a headless process open (no-op in browsers).
      fallbackTimer.unref?.();
    };

    const attachStream = () => {
      const manager = client.liveStreamManager(connectionId, streamOptions);
      const offDurable = manager.onDurable(applyDurable);
      const offState = manager.onState((state, detail = {}) => {
        if (disposed || paused) return;
        if (state === 'open') {
          streamedSinceSubscribe = true;
          stopFallback();
          if (handle.subscriptionId === null) return; // establishment still in flight
          fellBack = false;
          if (needsResubscribe) {
            // The lost socket's server-side disconnect dropped this
            // connection's subscriptions and no fresh subscribe has landed
            // yet: re-enter through snapshot-with-subscribe.
            setConnection('connecting');
            void resubscribe('reconnect').then(() => {
              if (!disposed && !paused && manager.isOpen()) setConnection('live');
            });
          } else {
            // The current subscription is valid (re-created by the fallback
            // path, or the original if the socket never opened); the regained
            // socket drains the same connection outbox — no second snapshot.
            setConnection('live');
          }
          return;
        }
        if (state === 'lost') {
          streamedSinceSubscribe = false;
          if (detail.wasOpen) {
            // An OPEN socket's close makes the server drop this connection's
            // durable subscriptions (src/server.rs live_stream -> disconnect).
            // A socket that never opened dropped nothing.
            needsResubscribe = true;
          }
          if (fallbackToPoll) {
            setConnection('polling');
            fellBack = true;
            if (detail.wasOpen) {
              // Re-subscribe for the fallback path after a short grace so the
              // server has processed the close; if the socket reconnects
              // first, the 'open' handler resubscribes instead (guarded by
              // needsResubscribe, so exactly one fresh subscribe lands).
              setTimeout(() => {
                if (!disposed && !paused && needsResubscribe && handle.subscriptionId !== null) {
                  void resubscribe('reconnect');
                }
              }, RESUBSCRIBE_AFTER_LOSS_DELAY_MS).unref?.();
            }
            startFallback();
          } else {
            setConnection('stale');
          }
          return;
        }
        if (state === 'budget-missed') {
          setConnection('stale');
          return;
        }
        if (state === 'closed') {
          setConnection('disconnected');
        }
      });
      return () => {
        offDurable();
        offState();
      };
    };

    const establish = async () => {
      setConnection('connecting');
      if (transport === 'stream') {
        detachStream = attachStream();
      }
      await subscribeFresh();
      emitEvent('established');
      if (transport === 'stream') {
        const manager = client.liveStreamManager(connectionId, streamOptions);
        if (manager.isOpen()) {
          streamedSinceSubscribe = true;
          setConnection('live');
        }
        // Otherwise stay 'connecting': the socket is still in flight, and the
        // manager's first 'lost' event engages the poll fallback (or 'stale'
        // when fallback is disabled) if the connect fails.
      } else {
        setConnection('polling');
      }
    };

    handle.poll = async () => {
      if (disposed || paused) return handle.rows;
      return drainOnce();
    };

    // Host lifecycle is provider/kit policy, not view logic (Exact LLP 0284
    // §2.1 rule 4): pause quiesces this handle's transports (no retry is
    // scheduled -> 'disconnected'); resume re-enters through a fresh
    // snapshot-with-subscribe and a 'resubscribed' event.
    handle.pause = () => {
      if (disposed || paused) return;
      paused = true;
      stopFallback();
      detachStream?.();
      detachStream = null;
      setConnection('disconnected');
    };

    handle.resume = async () => {
      if (disposed || !paused) return;
      paused = false;
      setConnection('connecting');
      if (transport === 'stream') {
        detachStream = attachStream();
      }
      await subscribeFresh();
      emitEvent('resubscribed', { reason: 'resume' });
      const manager = transport === 'stream' ? client.liveStreamManager(connectionId, streamOptions) : null;
      if (manager?.isOpen()) {
        streamedSinceSubscribe = true;
        setConnection('live');
      } else if (transport === 'stream' && fallbackToPoll) {
        fellBack = true;
        setConnection('polling');
        startFallback();
      } else {
        setConnection(transport === 'stream' ? 'stale' : 'polling');
      }
    };

    handle.dispose = () => {
      if (disposed) return;
      emitEvent('disposed');
      disposed = true;
      stopFallback();
      detachStream?.();
      detachStream = null;
      setConnection('disconnected');
    };

    await establish();
    return handle;
  }
}

/// One managed WebSocket per connection, multiplexing durable live-query
/// updates and ephemeral push (the lanes the server's outbox already carries;
/// durable drains before ephemeral within each tick — LLP 0013
/// §delivery-lanes; the manager dispatches frames strictly in arrival order,
/// preserving that priority). Reference-counted by listeners; reconnects with
/// exponential backoff while demand exists; sends app-level pings to make the
/// Exact LLP 0284 §2.2 freshness budget observable.
///
/// @ref LLP 0034#21-one-socket-both-lanes
class LiveStreamManager {
  constructor(client, connectionId, options = {}, onRelease = () => {}) {
    this.client = client;
    this.connectionId = connectionId;
    this.onRelease = onRelease;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? LIVE_HEARTBEAT_INTERVAL_MS;
    this.freshnessBudgetMs = options.freshnessBudgetMs ?? LIVE_FRESHNESS_BUDGET_MS;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? LIVE_RECONNECT_BASE_DELAY_MS;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? LIVE_RECONNECT_MAX_DELAY_MS;

    this.durableListeners = new Set();
    this.ephemeralListeners = new Set();
    this.stateListeners = new Set();
    this.pendingRequests = new Map();

    this.ws = null;
    this.open = false;
    this.closed = false;
    this.attempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.lastActivityMs = Date.now();
    this.requestSeq = 0;
  }

  #demand() {
    return this.durableListeners.size + this.ephemeralListeners.size + this.stateListeners.size;
  }

  #listen(set, listener) {
    set.add(listener);
    this.#ensureSocket();
    return () => {
      set.delete(listener);
      if (this.#demand() === 0) this.close();
    };
  }

  onDurable(listener) {
    return this.#listen(this.durableListeners, listener);
  }

  onEphemeral(listener) {
    return this.#listen(this.ephemeralListeners, listener);
  }

  onState(listener) {
    return this.#listen(this.stateListeners, listener);
  }

  isOpen() {
    return this.open;
  }

  #emitState(state, detail = {}) {
    for (const listener of [...this.stateListeners]) listener(state, detail);
  }

  #ensureSocket() {
    if (this.closed || this.ws || this.reconnectTimer) return;
    this.#connect();
  }

  /// The stream endpoint as an absolute ws(s) URL. A browser surface may
  /// construct the client with a page-relative base (e.g. '/snapback' behind
  /// the Vite proxy, which needs `ws: true` to upgrade), which `new WebSocket`
  /// cannot take — resolve against the page origin first; headless clients
  /// always pass absolute bases.
  #socketUrl() {
    const base = this.client.baseUrl;
    const absolute = /^https?:/i.test(base) || !globalThis.location
      ? base
      : new URL(base, globalThis.location.href).toString().replace(/\/$/, '');
    return `${absolute.replace(/^http/, 'ws')}/live/${this.connectionId}/stream`;
  }

  #connect() {
    const url = this.#socketUrl();
    this.#emitState('connecting');
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      // Constructor failure (bad URL, blocked context) is a loss like any
      // other: let consumers engage their fallback on the first failure.
      if (this.attempts === 0) this.#emitState('lost', { wasOpen: false });
      this.#scheduleReconnect();
      return;
    }
    this.ws = ws;

    // Connect budget: a dangling upgrade (a proxy that swallows it, a dead
    // route) fires neither open nor close, which would otherwise leave
    // consumers in 'connecting' forever with no fallback. Treat it as a loss.
    const connectTimer = setTimeout(() => {
      if (this.ws === ws && !this.open) {
        try {
          ws.close();
        } catch {
          // close() on a connecting socket may throw; the close event follows.
        }
      }
    }, this.freshnessBudgetMs);
    connectTimer.unref?.();

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      clearTimeout(connectTimer);
      this.open = true;
      this.attempts = 0;
      this.lastActivityMs = Date.now();
      this.#startHeartbeat();
      this.#emitState('open');
    });
    ws.addEventListener('message', async (event) => {
      if (this.ws !== ws) return;
      this.lastActivityMs = Date.now();
      let frame;
      try {
        frame = JSON.parse(await websocketText(event.data));
      } catch {
        return;
      }
      this.#dispatch(frame);
    });
    const onLoss = () => {
      if (this.ws !== ws) return;
      clearTimeout(connectTimer);
      const wasOpen = this.open;
      this.open = false;
      this.ws = null;
      this.#stopHeartbeat();
      this.#failPendingRequests(new Error(`Snapback live stream lost: ${url}`));
      if (this.closed) return;
      // Emit on an open socket's loss and on the first failed connect (so
      // consumers can engage their fallback); silent on later retry failures.
      if (wasOpen || this.attempts === 0) this.#emitState('lost', { wasOpen });
      this.#scheduleReconnect();
    };
    ws.addEventListener('close', onLoss, { once: true });
    ws.addEventListener('error', () => {
      // 'close' follows 'error' in both browser and undici WebSockets; loss
      // handling is centralized in the close handler.
    });
  }

  #scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    if (this.#demand() === 0) return;
    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** this.attempts,
      this.reconnectMaxDelayMs,
    );
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed && this.#demand() > 0) this.#connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  #startHeartbeat() {
    this.#stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.open) return;
      if (Date.now() - this.lastActivityMs > this.freshnessBudgetMs) {
        // Freshness budget missed while the socket claims to be open: declare
        // it, then force the loss path so reconnect begins ('stale' is
        // budget-missed-while-retrying — LLP 0034 §2.2).
        this.#emitState('budget-missed');
        this.debugCloseSocket();
        return;
      }
      this.requestSeq += 1;
      const requestId = `ping_${this.requestSeq}`;
      try {
        this.ws?.send(JSON.stringify({ type: 'ping', requestId }));
      } catch {
        // Loss handling rides the close event.
      }
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  #stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  #dispatch(frame) {
    if (!frame || typeof frame !== 'object') return;
    if (frame.requestId && this.pendingRequests.has(frame.requestId)) {
      const pending = this.pendingRequests.get(frame.requestId);
      this.pendingRequests.delete(frame.requestId);
      pending.resolve(frame);
      return;
    }
    if (frame.kind === 'pong' || frame.kind === 'ephemeral_ack' || frame.kind === 'ephemeral_error') {
      return; // uncorrelated control frames only refresh lastActivityMs
    }
    if (frame.kind === 'ephemeral') {
      for (const listener of [...this.ephemeralListeners]) listener(frame);
      return;
    }
    // Durable-lane payloads arrive unwrapped: live_replace / resync_required.
    for (const listener of [...this.durableListeners]) listener(frame);
  }

  /// Send a live-socket request (ephemeral_subscribe/publish/delete or ping)
  /// and await its correlated response envelope.
  request(message, timeoutMs = 2_000) {
    if (!this.open || !this.ws) {
      return Promise.reject(new Error('Snapback live stream is not open'));
    }
    this.requestSeq += 1;
    const requestId = message.requestId ?? `req_${this.requestSeq}`;
    const promise = new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
    });
    this.ws.send(JSON.stringify({ ...message, requestId }));
    return withTimeout(promise, timeoutMs, `timed out waiting for live-socket response ${requestId}`).finally(() => {
      this.pendingRequests.delete(requestId);
    });
  }

  #failPendingRequests(error) {
    for (const [, pending] of this.pendingRequests) pending.reject(error);
    this.pendingRequests.clear();
  }

  /// Test hook (conformance check 3): force-close the underlying socket
  /// without releasing demand — the manager treats it as a loss and retries.
  debugCloseSocket() {
    const ws = this.ws;
    if (ws) {
      try {
        ws.close();
      } catch {
        // close() on a connecting socket may throw in some implementations.
      }
    }
  }

  close() {
    this.closed = true;
    this.#stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    this.open = false;
    if (ws) {
      try {
        ws.close();
      } catch {
        // best-effort teardown
      }
    }
    this.#failPendingRequests(new Error('Snapback live stream closed'));
    this.#emitState('closed');
    this.durableListeners.clear();
    this.ephemeralListeners.clear();
    this.stateListeners.clear();
    this.onRelease();
  }
}

function resyncReason(serverReason) {
  if (serverReason === 'outbox_overflow') return 'overflow';
  if (serverReason === 'permission_epoch_changed') return 'permission-epoch';
  return 'resync';
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
