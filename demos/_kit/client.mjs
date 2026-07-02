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
// @ref LLP 0034#2-d0--d1--a-liveness-signal-then-durable-push-to-the-browser — `liveQuery` gains a `stream`
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
// Kit receipt ring bound — mirrors the server-side retention cap (LLP 0034 §3).
const RECEIPT_RING_CAP = 256;

export class SnapbackClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    // Receipt retention, kit half (LLP 0034 §3 / ENG-22478): a bounded ring
    // of every receipt this client observed (mutation receipts riding
    // responses, subscription receipts emitted by live handles, ephemeral
    // publish receipts), surfaced to the adapter via receipts()/onReceipt.
    this.__receiptRing = [];
    this.__receiptListeners = new Set();
    // Cross-lane drain routing (LLP 0034 §10.1 residual): per-connection
    // consumer registries so one connection's durable and ephemeral lanes
    // never destructively discard each other's envelopes on drain.
    this.__laneConsumers = new Map();
  }

  /// Record a receipt into the bounded kit ring and notify listeners.
  recordReceipt(receipt) {
    if (!receipt || typeof receipt !== 'object') return receipt;
    this.__receiptRing.push(receipt);
    while (this.__receiptRing.length > RECEIPT_RING_CAP) this.__receiptRing.shift();
    for (const listener of [...this.__receiptListeners]) {
      // A throwing app listener must never turn a committed operation into a
      // client-side failure (ENG-22478 review fix G).
      try {
        listener(receipt);
      } catch {
        // Listener errors are the listener's problem, not the operation's.
      }
    }
    return receipt;
  }

  /// The receipts this client has observed, oldest first (bounded ring).
  receipts() {
    return [...this.__receiptRing];
  }

  onReceipt(listener) {
    this.__receiptListeners.add(listener);
    return () => this.__receiptListeners.delete(listener);
  }

  #laneConsumersFor(connectionId) {
    let consumers = this.__laneConsumers.get(connectionId);
    if (!consumers) {
      consumers = { durable: new Set(), ephemeral: new Set() };
      this.__laneConsumers.set(connectionId, consumers);
    }
    return consumers;
  }

  registerDurableConsumer(connectionId, consumer) {
    const consumers = this.#laneConsumersFor(connectionId);
    consumers.durable.add(consumer);
    return () => consumers.durable.delete(consumer);
  }

  registerEphemeralConsumer(connectionId, consumer) {
    const consumers = this.#laneConsumersFor(connectionId);
    consumers.ephemeral.add(consumer);
    return () => consumers.ephemeral.delete(consumer);
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
      if (json?.receipt) error.receipt = json.receipt;
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

  async mutate(ref, { args = {}, userId, readSet = [], correlation = null } = {}) {
    const name = functionName(ref);
    const body = { args, auth: SnapbackClient.auth(userId), read_set: readSet };
    // Opaque adapter correlation (LLP 0034 §3.2): sent verbatim, echoed on
    // the receipt; the provider never interprets it.
    if (correlation) body.correlation = correlation;
    try {
      const json = await this.#req('POST', `/mutation/${name}`, body);
      if (json?.receipt) this.recordReceipt(json.receipt);
      return json;
    } catch (error) {
      // A REJECTED mutation still produced its receipt (it rides the error
      // envelope) — retain it before rethrowing.
      if (error?.receipt) this.recordReceipt(error.receipt);
      throw error;
    }
  }

  async subscribeLive(ref, { connectionId, args = {}, userId, correlation = null, supersedes = null } = {}) {
    const name = functionName(ref);
    const input = { args, auth: SnapbackClient.auth(userId), read_set: [] };
    if (correlation) input.correlation = correlation;
    const body = { connection_id: connectionId, input };
    // Explicit supersession (ENG-22478 review fix A): name the subscription
    // this fresh subscribe replaces (the kit's own resubscribe paths only);
    // the server disposes exactly that id. Never inferred — plain duplicate
    // subscribes coexist.
    if (supersedes) body.supersedes = supersedes;
    const response = await this.#req('POST', `/live/${name}/subscribe`, body);
    if (response?.receipt) this.recordReceipt(response.receipt);
    return response;
  }

  /// Explicit unsubscribe (LLP 0034 §10.1 residual / ENG-22478): dispose one
  /// live subscription; ownership mirrors resume_live.
  async unsubscribeLive(ref, { subscriptionId, connectionId, userId } = {}) {
    const name = functionName(ref);
    const response = await this.#req('POST', `/live/${name}/unsubscribe`, {
      subscription_id: subscriptionId,
      connection_id: connectionId,
      auth: SnapbackClient.auth(userId),
    });
    if (response?.receipt) this.recordReceipt(response.receipt);
    return response;
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

  async publishEphemeral(ref, { connectionId, scope = {}, value, ttlMs = null, userId, permissions = [], sessionId = null, ownerUserId = null, customKey = null } = {}) {
    const collection = collectionName(ref);
    try {
      const outcome = await this.#req('POST', '/ephemeral/publish', {
        collection,
        scope,
        connection_id: connectionId,
        session_id: sessionId,
        user_id: ownerUserId,
        custom_key: customKey,
        value: encodeEphemeralValue(value),
        ttl_ms: ttlMs,
        auth: SnapbackClient.auth(userId, { permissions }),
      });
      // Ephemeral one-version story (LLP 0034 §3.1): snapshotVersion is the
      // entryVersion, valid WITHIN a scopeEpoch; the epoch rides in the
      // snapback-namespaced field. Privacy (§3.3): never the payload value.
      this.recordReceipt({
        kind: 'ephemeral-publish',
        collection,
        outcome: 'confirmed',
        snapshotVersion: outcome.entry_version,
        snapback: { scopeEpoch: outcome.scope_epoch, key: outcome.key },
        receivedAtMs: Date.now(),
      });
      return outcome;
    } catch (error) {
      this.recordReceipt({
        kind: 'ephemeral-publish',
        collection,
        outcome: 'rejected',
        rollbackReason: error?.diagnostic?.code ?? 'SNAPBACK_EPHEMERAL_PUBLISH_FAILED',
        receivedAtMs: Date.now(),
      });
      throw error;
    }
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

  // The shared drain choke point (LLP 0034 §10.1 residual / ENG-22478): a
  // connection's outbox is ONE queue carrying both lanes, so every drain
  // routes each envelope to the registered consumers of ITS lane instead of
  // destructively discarding the other lane's traffic. Returns the decoded
  // durable updates and the raw ephemeral envelopes of this drain.
  async drainConnection(connectionId) {
    const envelopes = await this.drainEnvelopes(connectionId);
    const consumers = this.__laneConsumers.get(connectionId);
    const durable = [];
    const ephemeral = [];
    for (const env of envelopes) {
      if (env && env.Durable) {
        const update = JSON.parse(decodeDurablePayload(env.Durable.payload));
        durable.push(update);
        for (const consumer of [...(consumers?.durable ?? [])]) consumer(update);
      } else if (env) {
        ephemeral.push(env);
        for (const consumer of [...(consumers?.ephemeral ?? [])]) consumer(env);
      }
    }
    return { durable, ephemeral };
  }

  // Drains a connection's outbox and decodes durable live-query updates.
  // Ephemeral envelopes in the same drain are ROUTED to registered ephemeral
  // consumers (e.g. an EphemeralOverlay on this connection), never discarded.
  async drainUpdates(connectionId) {
    return (await this.drainConnection(connectionId)).durable;
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
    correlation = null,
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
    let pendingResubscribeReason = 'reconnect';
    let resubscribeRetryTimer = null;
    let resubscribeAttempts = 0;
    // The 'established' receipt is emitted once, AFTER the transport settles
    // (ENG-22478 review fix E): a stream binding whose subscribe POST beats
    // the socket open must not claim transport 'poll' on its receipt.
    let establishedEmitted = false;
    let establishTimer = null;

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

    // Full SubscriptionReceipts (LLP 0034 §3.2 / ENG-22478): the kit is the
    // provider half that knows the actual transport; scope is REQUIRED (the
    // subscription's routing/scope args); versions are the server's durable
    // commit versions (§3.1 — one version story, nothing invented); the
    // adapter's opaque correlation is echoed verbatim. Receipts are retained
    // in the client ring and handed to onSubscriptionEvent.
    const emitEvent = (event, extra = {}) => {
      const receipt = {
        kind: 'subscription',
        bindingId: handle.subscriptionId,
        subscriptionId: handle.subscriptionId,
        event,
        transport: transport === 'stream' && streamedSinceSubscribe ? 'push' : 'poll',
        scope: { ...args },
        snapshotVersion: handle.version,
        lastDeltaVersion: handle.version,
        correlation: cappedCorrelation(correlation),
        receivedAtMs: Date.now(),
        ...extra,
      };
      client.recordReceipt(receipt);
      onSubscriptionEvent?.(receipt);
    };

    const emitEstablishedOnce = () => {
      if (establishedEmitted || disposed || handle.subscriptionId === null) return;
      establishedEmitted = true;
      if (establishTimer) {
        clearTimeout(establishTimer);
        establishTimer = null;
      }
      emitEvent('established');
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
      // This handle's OWN previous subscription (reconnect/resync/resume
      // paths) is explicitly superseded; the first establish has none.
      const supersedes = handle.subscriptionId ?? null;
      const sub = await client.subscribeLive(name, { connectionId, args, userId, correlation, supersedes });
      // Any successful fresh subscribe satisfies an outstanding need — clear
      // it here so every path (establish, resume, resubscribe) agrees.
      needsResubscribe = false;
      resubscribeAttempts = 0;
      clearResubscribeRetry();
      handle.subscriptionId = sub.subscription_id;
      handle.version = sub.snapshot.version;
      handle.rows = sub.snapshot.rows;
      return sub;
    };

    // After a successful (re)subscribe, settle the connection value from the
    // actual transport state — never promote to 'live' on hope.
    const settleConnectionAfterSubscribe = () => {
      if (disposed || paused) return;
      if (transport !== 'stream') {
        setConnection('polling');
        return;
      }
      const manager = client.liveStreamManager(connectionId, streamOptions);
      if (manager.isOpen()) {
        streamedSinceSubscribe = true;
        setConnection('live');
      } else if (fellBack) {
        setConnection('polling');
      } else if (!fallbackToPoll) {
        setConnection('stale');
      }
      // else: the socket is still in flight; stay 'connecting' until the
      // manager reports open/lost.
    };

    const clearResubscribeRetry = () => {
      if (resubscribeRetryTimer) {
        clearTimeout(resubscribeRetryTimer);
        resubscribeRetryTimer = null;
      }
    };

    // Retry while the need persists (LLP 0034 review fix 2): a failed
    // re-subscribe schedules a bounded-backoff retry, and the drain path
    // below ALSO re-enters on every poll tick — a transient server error can
    // never strand the handle without a subscription.
    const scheduleResubscribeRetry = (reason) => {
      if (disposed || paused || resubscribeRetryTimer || !needsResubscribe) return;
      const delay = Math.min(
        LIVE_RECONNECT_BASE_DELAY_MS * 2 ** resubscribeAttempts,
        LIVE_RECONNECT_MAX_DELAY_MS,
      );
      resubscribeAttempts += 1;
      resubscribeRetryTimer = setTimeout(() => {
        resubscribeRetryTimer = null;
        if (!disposed && !paused && needsResubscribe) void resubscribe(reason);
      }, delay);
      resubscribeRetryTimer.unref?.();
    };

    // Reconnect/resync re-entry: always a fresh subscribe_live (see the policy
    // block at the top of this file — the server drops a connection's durable
    // subscriptions on socket close, so there is nothing to resume). Returns
    // whether the fresh subscribe LANDED; a failure keeps needsResubscribe set
    // and schedules a retry — the connection value is only ever promoted after
    // a success (via settleConnectionAfterSubscribe). Note: on in-band resyncs
    // (overflow, permission epoch) the superseded subscription may remain
    // registered server-side until the connection disconnects or is reaped;
    // its updates are ignored by subscription-id filtering above.
    const resubscribe = async (reason) => {
      if (disposed || paused || resubscribing) return false;
      resubscribing = true;
      needsResubscribe = true;
      pendingResubscribeReason = reason;
      try {
        await subscribeFresh();
        emitEvent('resubscribed', { reason });
        onUpdate?.(handle.rows, { version: handle.version, kind: 'snapshot' });
        settleConnectionAfterSubscribe();
        return true;
      } catch (error) {
        onConnectionChange?.(connection, { previous: connection, error });
        scheduleResubscribeRetry(reason);
        return false;
      } finally {
        resubscribing = false;
      }
    };

    const drainOnce = async () => {
      // A broken subscription drains nothing (a disconnect-destroyed outbox
      // returns [] and looks healthy): re-enter the fresh subscribe on every
      // drain tick until it lands (LLP 0034 review fix 2, polling variant).
      if (needsResubscribe && !resubscribing) {
        await resubscribe(pendingResubscribeReason);
      }
      // HTTP outbox drain through the shared choke point: one bounded queue
      // per connection, durable lane first, then resync, then coalesced
      // ephemeral (OutboundQueue::drain — durable-over-ephemeral priority,
      // LLP 0013 §delivery-lanes). Routing applies durable updates to this
      // handle via its registered consumer AND delivers both lanes to every
      // other registered consumer on the connection — no cross-lane or
      // cross-handle discards (LLP 0034 §10.1 / ENG-22478).
      await client.drainConnection(connectionId);
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
      // Durable socket frames arrive through the connection's lane registry
      // (this handle registered applyDurable there), the same path HTTP
      // drains use — one delivery pipeline for both transports (ENG-22478
      // review: mixed-transport unification).
      const offState = manager.onState((state, detail = {}) => {
        if (disposed || paused) return;
        if (state === 'open') {
          streamedSinceSubscribe = true;
          stopFallback();
          if (handle.subscriptionId === null) return; // establishment still in flight
          emitEstablishedOnce(); // transport settled: push
          fellBack = false;
          if (needsResubscribe) {
            // The lost socket's server-side disconnect dropped this
            // connection's subscriptions and no fresh subscribe has landed
            // yet: re-enter through snapshot-with-subscribe. Promotion to
            // 'live' happens INSIDE resubscribe, only on success; on failure
            // the handle stays 'connecting' and the retry loop re-enters.
            setConnection('connecting');
            void resubscribe('reconnect');
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
          emitEstablishedOnce(); // transport settled: poll fallback
          if (detail.wasOpen) {
            // An OPEN socket's close makes the server drop this connection's
            // durable subscriptions (src/server.rs live_stream -> disconnect;
            // when a reconnect superseded this socket server-side the
            // generation guard skips the drop, and the fresh subscribe below
            // is merely redundant). A socket that never opened dropped
            // nothing.
            needsResubscribe = true;
            pendingResubscribeReason = 'reconnect';
          }
          if (fallbackToPoll) {
            setConnection('polling');
            fellBack = true;
            if (detail.wasOpen) {
              // First re-subscribe attempt after a short grace so the server
              // has processed the close; failures are covered by the retry
              // loop AND every fallback drain tick (needsResubscribe gates
              // all of them, so exactly one fresh subscribe lands).
              setTimeout(() => {
                if (!disposed && !paused && needsResubscribe && handle.subscriptionId !== null) {
                  void resubscribe('reconnect');
                }
              }, RESUBSCRIBE_AFTER_LOSS_DELAY_MS).unref?.();
            }
            startFallback();
          } else {
            // Fallback disabled: hold at 'stale' with last-known rows; the
            // fresh subscribe re-enters on socket regain (open handler), and
            // a failure there is covered by the retry loop.
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
        offState();
      };
    };

    // Drained durable updates reach this handle through the connection's
    // lane router (covers manual poll(), the fallback timer, AND any other
    // consumer's drain on the same connection — the pre-D2 "whoever drains
    // first steals the updates" gap).
    const unregisterDurable = client.registerDurableConsumer(connectionId, applyDurable);

    // On subscribe failure the attached stream must not leak (LLP 0034 review
    // fix 5): detach (dropping manager demand closes the shared socket when
    // this was its only consumer), mark the handle disposed, and rethrow —
    // liveQuery() fails loudly and leaves nothing running.
    const establish = async () => {
      setConnection('connecting');
      if (transport === 'stream') {
        detachStream = attachStream();
      }
      try {
        await subscribeFresh();
      } catch (error) {
        stopFallback();
        clearResubscribeRetry();
        unregisterDurable();
        detachStream?.();
        detachStream = null;
        disposed = true;
        setConnection('disconnected');
        throw error;
      }
      if (transport === 'stream') {
        const manager = client.liveStreamManager(connectionId, streamOptions);
        if (manager.isOpen()) {
          streamedSinceSubscribe = true;
          setConnection('live');
          emitEstablishedOnce(); // push, deterministically
        } else if (fellBack) {
          emitEstablishedOnce(); // the socket already failed: poll fallback
        } else {
          // Socket still in flight: defer the receipt until it settles
          // (open -> push, lost -> poll), with the freshness budget as the
          // bound so the receipt cannot dangle on a swallowed connect.
          const budget = streamOptions.freshnessBudgetMs ?? LIVE_FRESHNESS_BUDGET_MS;
          establishTimer = setTimeout(() => {
            establishTimer = null;
            emitEstablishedOnce();
          }, budget);
          establishTimer.unref?.();
        }
      } else {
        setConnection('polling');
        emitEstablishedOnce();
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
      clearResubscribeRetry();
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
      try {
        await subscribeFresh();
      } catch (error) {
        // Do not leak the re-attached stream (LLP 0034 review fix 5): return
        // to the paused state so the caller may retry resume() later.
        detachStream?.();
        detachStream = null;
        paused = true;
        setConnection('disconnected');
        throw error;
      }
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
      emitEvent('resubscribed', { reason: 'resume' });
    };

    handle.dispose = () => {
      if (disposed) return;
      emitEstablishedOnce(); // receipt ordering: established before disposed
      emitEvent('disposed');
      const staleSubscriptionId = handle.subscriptionId;
      disposed = true;
      stopFallback();
      clearResubscribeRetry();
      if (establishTimer) {
        clearTimeout(establishTimer);
        establishTimer = null;
      }
      unregisterDurable();
      detachStream?.();
      detachStream = null;
      setConnection('disconnected');
      // Best-effort server-side disposal (ENG-22478 review fix F): without
      // this, unmounting a handle while the connection lives leaves the
      // §10.1 zombie fanning out until connection teardown.
      if (staleSubscriptionId) {
        void client
          .unsubscribeLive(name, { subscriptionId: staleSubscriptionId, connectionId, userId })
          .catch(() => {
            // Best-effort: the subscription may already be gone (disconnect,
            // supersession) or the server unreachable — the reaper covers it.
          });
      }
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
/// @ref LLP 0034#22-one-socket-both-lanes--with-the-priority-invariant
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
      // The lane registry is transport-agnostic (LLP 0034 §10.1 / ENG-22478):
      // when the socket owns the connection's outbox, registered ephemeral
      // consumers (EphemeralOverlays) still receive their lane's frames.
      const consumers = this.client.__laneConsumers?.get(this.connectionId);
      for (const consumer of [...(consumers?.ephemeral ?? [])]) consumer(frame);
      return;
    }
    // Durable-lane payloads arrive unwrapped (live_replace / resync_required)
    // and route through the SAME lane registry HTTP drains use, so a
    // poll-transport handle sharing this connection is never starved by the
    // socket owning the outbox (ENG-22478 review: mixed-transport
    // unification). liveQuery handles consume durable traffic ONLY via the
    // registry — onDurable is for external socket-frame listeners and must
    // not be combined with a registry registration (double delivery).
    for (const listener of [...this.durableListeners]) listener(frame);
    const consumers = this.client.__laneConsumers?.get(this.connectionId);
    for (const consumer of [...(consumers?.durable ?? [])]) consumer(frame);
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

// Cap the correlation echoed on kit receipts (ENG-22478 review fix H): the
// ring is count-bounded; an unbounded echo could still pin large payloads.
const CORRELATION_ECHO_MAX_BYTES = 4_096;
function cappedCorrelation(correlation) {
  if (correlation == null) return correlation;
  let size = Infinity;
  try {
    size = JSON.stringify(correlation).length;
  } catch {
    // Unserializable correlation: keep the honest marker.
  }
  return size > CORRELATION_ECHO_MAX_BYTES ? { correlationTruncated: true, bytes: size } : correlation;
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
    this.room = null; // captured from OUR subscribe snapshot (room identity)
    this.__drainCaptures = new Set();
    this.__changeListeners = new Set();
    // Cross-lane routing (LLP 0034 §10.1 / ENG-22478): the overlay is this
    // connection's registered ephemeral consumer, so a durable drain on the
    // same connection routes ephemeral envelopes here instead of dropping
    // them (and this overlay's drain routes durable envelopes to the durable
    // consumers symmetrically). The same registry receives socket-delivered
    // ephemeral frames when a live stream owns the connection's outbox.
    this.__unregister = client.registerEphemeralConsumer(connectionId, (envelope) => {
      const result = this.apply(envelope);
      for (const capture of this.__drainCaptures) capture.push(result);
    });
    if (snapshot) this.apply(snapshot);
  }

  /// Detach from the connection's lane router.
  dispose() {
    this.__unregister?.();
    this.__unregister = null;
    this.__changeListeners.clear();
  }

  /// Observe state changes (applied snapshots/upserts/removes and resync
  /// boundaries) — the hook the Contract adapter's ephemeral source uses to
  /// re-emit EphemeralMapCells (ENG-22479).
  onChange(listener) {
    this.__changeListeners.add(listener);
    return () => this.__changeListeners.delete(listener);
  }

  #notifyChange(result) {
    for (const listener of [...this.__changeListeners]) {
      try {
        listener(result, this);
      } catch {
        // Observer errors never poison the overlay's apply path.
      }
    }
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
    // Drain through the shared choke point: this overlay's registered
    // consumer applies the ephemeral envelopes (captured for the return
    // value; captures are re-entrant — overlapping drains each collect what
    // was applied while they were in flight), while durable envelopes in the
    // same drain are routed to the connection's durable consumers instead of
    // being discarded.
    const capture = [];
    this.__drainCaptures.add(capture);
    try {
      await this.client.drainConnection(this.connectionId);
      return capture.filter((result) => result !== 'not_ephemeral');
    } finally {
      this.__drainCaptures.delete(capture);
    }
  }

  apply(input) {
    const message = unwrapEphemeralMessage(input);
    if (!message) return 'not_ephemeral';
    // Room isolation (ENG-22478 review fix B): a connection's outbox carries
    // EVERY room's traffic, and the lane registry fans it to every overlay —
    // so each message must match THIS overlay's room identity (captured from
    // our own subscribe snapshot). A foreign room's snapshot/upsert/remove
    // must never contaminate this overlay's entries or scopeEpoch.
    const room = messageRoom(message);
    if (this.room && room && !sameRoom(this.room, room)) return 'foreign_room';
    if (message.Snapshot) {
      if (!this.room && message.Snapshot.room) this.room = message.Snapshot.room;
      const previousEpoch = this.scopeEpoch;
      this.scopeEpoch = message.Snapshot.scope_epoch;
      this.entries.clear();
      for (const entry of message.Snapshot.entries ?? []) {
        this.entries.set(entry.key, normalizeEntry(entry));
      }
      this.needsResync = false;
      // Ephemeral one-version story (LLP 0034 §3.1): entry versions are valid
      // WITHIN a scopeEpoch; an epoch bump is a resubscription boundary and
      // is receipted as such. The first snapshot is the establishment.
      // Privacy (§3.3): scope/epoch/keys only — never entry values.
      this.client.recordReceipt?.({
        kind: 'subscription',
        lane: 'ephemeral',
        // The binding id for an ephemeral map IS the collection name — the
        // adapter joins overlay receipts to bindings by it (ENG-22479).
        bindingId: collectionName(this.ref),
        collection: collectionName(this.ref),
        event: previousEpoch === null ? 'established' : 'resubscribed',
        ...(previousEpoch === null ? {} : { reason: 'resync' }),
        scope: { ...this.scope },
        snapback: { scopeEpoch: this.scopeEpoch },
        receivedAtMs: Date.now(),
      });
      this.#notifyChange('applied');
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
      this.#notifyChange('applied');
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
      this.#notifyChange('applied');
      return 'applied';
    }
    if (message.ResyncRequired) {
      this.entries.clear();
      this.needsResync = true;
      this.#notifyChange('needs_resync');
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

function messageRoom(message) {
  return (
    message.Snapshot?.room
    ?? message.Upsert?.room
    ?? message.Remove?.room
    ?? message.ResyncRequired?.room
    ?? null
  );
}

function sameRoom(a, b) {
  return a.collection === b.collection && a.routing_key === b.routing_key;
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
