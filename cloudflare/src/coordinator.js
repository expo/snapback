// The app coordinator Durable Object for the LLP 0040 Cloudflare narrow proof.
//
// It owns, in one object and one embedded SQLite database (LLP 0014
// §Resolution — everything on Durable Objects):
//   - the app instance and its tables (app_*),
//   - the DK-2 commit-version counter (the per-app version authority),
//   - the change journal,
//   - the storage-backed subscription registry (one-way door 4),
//   - every server-held WebSocket, through the Hibernation API.
//
// A committed mutation allocates the next version and writes all affected rows
// plus the journal append in ONE `storage.transactionSync`, so LLP 0007's
// gap-free visibility holds by construction (LLP 0040 §Version contract). The
// live path pushes from that commit, never from a timer — the object uses no
// setTimeout/setInterval, so it can hibernate while holding live sockets
// (LLP 0040 §Idle economics).
//
// Handler code runs in a SEPARATE, globally stripped isolate — the
// single-sourced LLP 0048 harness Worker (HANDLER binding) — reached over an
// async, RPC-shaped seam. Handlers touch storage only through the `ctx`
// surface served back here as host calls; they never receive a Durable Object
// storage handle, env, or ambient global (LLP 0009, verified by the
// ambient-power denial test).

import { HostContext } from './host-ops.js';
import { schema, functions } from '../app/notes.app.js';

const APP_SCHEMA_HASH = schema.schemaHash;

export class Coordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    // Live invocations keyed by host-call token, so a re-entrant /host-call
    // (routed back from the handler isolate) finds its HostContext. Purely
    // in-memory and request-scoped: nothing across eviction depends on it.
    this.activeInvocations = new Map();
    this.ensureSchema();
  }

  ensureSchema() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS _snapback_meta (key TEXT PRIMARY KEY, value TEXT)`);
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)`
    );
    this.sql.exec(`INSERT OR IGNORE INTO _snapback_version (id, version) VALUES (1, 0)`);
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_changes (
         seq INTEGER PRIMARY KEY AUTOINCREMENT,
         version INTEGER NOT NULL,
         table_name TEXT NOT NULL,
         row_id TEXT NOT NULL,
         op TEXT NOT NULL,
         row_json TEXT,
         changed_at_ms INTEGER NOT NULL
       )`
    );
    // Storage-backed subscription registry (one-way door 4): query identity,
    // args, cursor, connection id — rehydrated lazily on wake. In-memory
    // registries die at eviction while their sockets live on.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_subscriptions (
         subscription_id TEXT PRIMARY KEY,
         connection_id TEXT NOT NULL,
         function_name TEXT NOT NULL,
         args_json TEXT NOT NULL,
         last_version INTEGER NOT NULL,
         auth_epoch INTEGER NOT NULL
       )`
    );
    for (const table of schema.tables) {
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS app_${table.name} (id TEXT PRIMARY KEY, row_json TEXT NOT NULL)`
      );
    }
    this.sql.exec(
      `INSERT OR REPLACE INTO _snapback_meta (key, value) VALUES ('schema_hash', ?)`,
      APP_SCHEMA_HASH
    );
  }

  currentVersion() {
    for (const record of this.sql.exec('SELECT version FROM _snapback_version WHERE id = 1')) {
      return Number(record.version);
    }
    return 0;
  }

  newId() {
    return crypto.randomUUID();
  }

  functionByName(name) {
    return functions.find((fn) => fn.name === name);
  }

  // --- HTTP + WebSocket routing ------------------------------------------

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/host-call') {
      return this.serveHostCall(request);
    }
    if (path === '/health') {
      return json(200, { ok: true, version: this.currentVersion(), schemaHash: APP_SCHEMA_HASH });
    }
    if (path === '/reset') {
      return this.reset();
    }
    if (path === '/query') {
      return this.handleQuery(await request.json());
    }
    if (path === '/mutation') {
      return this.handleMutation(await request.json());
    }
    if (path === '/live/stream') {
      return this.acceptLiveSocket(request);
    }
    if (path === '/evict') {
      // CI surrogate for real eviction (LLP 0040 §Acceptance): discard all
      // in-memory state so the next commit must rehydrate from storage.
      this.activeInvocations.clear();
      return json(200, { evicted: true });
    }
    return json(404, { error: 'not found' });
  }

  // --- handler invocation across the RPC seam ----------------------------

  async invokeHandler(fnName, mode, args, authEpoch) {
    const fn = this.functionByName(fnName);
    if (!fn) {
      return { ok: false, code: 'SNAPBACK_HANDLER_EXPORT_MISSING', message: `no function ${fnName}` };
    }
    const token = crypto.randomUUID();
    const epoch = `${Date.now()}-${token}`;
    const host = new HostContext({
      sql: this.sql,
      mode,
      nowMs: Date.now(),
      epoch,
      newId: () => this.newId(),
    });
    this.activeInvocations.set(token, host);
    try {
      const response = await this.env.HANDLER.fetch('http://handler/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          export: fn.export,
          argsJson: JSON.stringify(args || {}),
          authJson: JSON.stringify({}),
          mode,
          runJson: null,
          secretsJson: null,
          epoch,
          token,
          // The host-routing header entry.mjs echoes onto every host call so
          // the gateway routes it back to THIS coordinator object.
          hostHeaders: { 'x-snapback-do-id': this.ctx.id.toString() },
        }),
      });
      const result = await response.json();
      if (result.fatal) {
        return { ok: false, code: 'SNAPBACK_V8_RUNNER_INVOKE_FAILED', message: result.fatal };
      }
      if (result.unhandledRejections && result.unhandledRejections.length > 0) {
        return {
          ok: false,
          code: 'SNAPBACK_HANDLER_UNHANDLED_REJECTION',
          message: 'handler completed with unhandled promise rejection(s)',
        };
      }
      const parsed = parseEnvelope(result.envelope);
      return { ...parsed, host };
    } finally {
      this.activeInvocations.delete(token);
    }
  }

  // The re-entrant host-call endpoint: the handler isolate's ctx host calls
  // land here (routed by the gateway using x-snapback-do-id). Reads and
  // buffering only — the commit happens after the handler settles.
  async serveHostCall(request) {
    const token = request.headers.get('x-snapback-host-token') || '';
    const body = await request.json();
    const host = this.activeInvocations.get(token);
    if (!host) {
      return json(200, {
        ok: false,
        code: 'SNAPBACK_HANDLER_HOST_CALL_WITHOUT_CONTEXT',
        message: 'no live invocation for this host-call token',
      });
    }
    const rawOp = String(body.rawOp || '');
    const sep = rawOp.indexOf('|');
    if (sep < 0) {
      return json(200, { ok: false, code: 'SNAPBACK_HANDLER_HOST_CALL_MALFORMED', message: 'host call not issued through ctx' });
    }
    const callEpoch = rawOp.slice(0, sep);
    const op = rawOp.slice(sep + 1);
    if (callEpoch !== host.epoch) {
      return json(200, {
        ok: false,
        code: 'SNAPBACK_HANDLER_STALE_CONTINUATION',
        message: 'a continuation from a prior invocation attempted a host call; rejected',
      });
    }
    let args = {};
    try {
      args = JSON.parse(body.argsJson || '{}');
    } catch (_) {
      return json(200, { ok: false, code: 'SNAPBACK_HANDLER_HOST_CALL_INVALID_JSON', message: 'bad args json' });
    }
    return json(200, host.handle(op, args));
  }

  // --- query -------------------------------------------------------------

  async handleQuery(payload) {
    const result = await this.invokeHandler(payload.name, 'query', payload.args, 0);
    if (!result.ok) return json(200, { ok: false, code: result.code, message: result.message });
    return json(200, { ok: true, version: this.currentVersion(), rows: result.value });
  }

  // --- mutation + commit -------------------------------------------------

  async handleMutation(payload) {
    const result = await this.invokeHandler(payload.name, 'mutation', payload.args, 0);
    if (!result.ok) return json(200, { ok: false, code: result.code, message: result.message });
    const commit = this.commit(result.host);
    // Push from the commit path — no timer, no polling (LLP 0040 §Version
    // contract). Rehydrates subscriptions from storage first, so a woken or
    // freshly-evicted object still delivers.
    this.fanOut(commit);
    return json(200, { ok: true, version: commit.version, changedCount: commit.changes.length, result: result.value });
  }

  // Version allocation + row writes + journal append as ONE local
  // transaction (LLP 0007 gap-free visibility by construction). An empty
  // changeset does not advance the version.
  commit(host) {
    if (host.writes.length === 0) {
      return { version: this.currentVersion(), changes: [] };
    }
    const nowMs = Date.now();
    let version = this.currentVersion();
    const changes = [];
    this.ctx.storage.transactionSync(() => {
      version = this.currentVersion() + 1;
      for (const write of host.writes) {
        const table = `app_${write.table}`;
        if (write.kind === 'insert') {
          const row = { _id: write.id, _version: version, _createdAt: nowMs, _updatedAt: nowMs, ...write.values };
          this.sql.exec(`INSERT INTO ${table} (id, row_json) VALUES (?, ?)`, write.id, JSON.stringify(row));
          this.recordChange(version, write.table, write.id, 'insert', row, nowMs);
          changes.push({ table: write.table, id: write.id, op: 'insert' });
        } else if (write.kind === 'patch') {
          const existing = this.readRow(table, write.id);
          if (existing) {
            const row = { ...existing, ...write.values, _id: write.id, _version: version, _updatedAt: nowMs };
            this.sql.exec(`UPDATE ${table} SET row_json = ? WHERE id = ?`, JSON.stringify(row), write.id);
            this.recordChange(version, write.table, write.id, 'patch', row, nowMs);
            changes.push({ table: write.table, id: write.id, op: 'patch' });
          }
        } else if (write.kind === 'delete') {
          this.sql.exec(`DELETE FROM ${table} WHERE id = ?`, write.id);
          this.recordChange(version, write.table, write.id, 'delete', null, nowMs);
          changes.push({ table: write.table, id: write.id, op: 'delete' });
        }
      }
      this.sql.exec('UPDATE _snapback_version SET version = ? WHERE id = 1', version);
    });
    return { version, changes };
  }

  readRow(table, id) {
    for (const record of this.sql.exec(`SELECT row_json FROM ${table} WHERE id = ?`, id)) {
      return JSON.parse(record.row_json);
    }
    return null;
  }

  recordChange(version, tableName, rowId, op, row, nowMs) {
    this.sql.exec(
      `INSERT INTO _snapback_changes (version, table_name, row_id, op, row_json, changed_at_ms) VALUES (?, ?, ?, ?, ?, ?)`,
      version,
      tableName,
      rowId,
      op,
      row ? JSON.stringify(row) : null,
      nowMs
    );
  }

  // --- live subscriptions ------------------------------------------------

  acceptLiveSocket(request) {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const connectionId = crypto.randomUUID();
    // Hibernation API: acceptWebSocket (NOT server.accept()) so the object can
    // be evicted while holding the socket (LLP 0040 §Hibernation). The
    // per-socket attachment carries only connection identity and auth epoch
    // (≤16 KB) — the subscription registry lives in SQLite.
    this.ctx.acceptWebSocket(server, [connectionId]);
    server.serializeAttachment({ connectionId, authEpoch: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }

  connectionIdFor(ws) {
    const attachment = ws.deserializeAttachment();
    return attachment && attachment.connectionId;
  }

  async webSocketMessage(ws, message) {
    let parsed;
    try {
      parsed = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch (_) {
      return;
    }
    const connectionId = this.connectionIdFor(ws);
    if (parsed.type === 'subscribe') {
      await this.subscribe(ws, connectionId, parsed);
    } else if (parsed.type === 'unsubscribe') {
      this.sql.exec('DELETE FROM _snapback_subscriptions WHERE subscription_id = ?', parsed.subscriptionId);
    } else if (parsed.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  }

  async subscribe(ws, connectionId, parsed) {
    const fn = this.functionByName(parsed.name);
    if (!fn || fn.kind !== 'LiveQuery') {
      ws.send(JSON.stringify({ type: 'error', code: 'SNAPBACK_LIVE_NOT_A_LIVE_QUERY', name: parsed.name }));
      return;
    }
    // Authoritative initial snapshot BEFORE any delta (LLP 0040 §Acceptance):
    // run the query, record the subscription at the resulting version, then
    // send the snapshot tagged with that version.
    const result = await this.invokeHandler(parsed.name, 'query', parsed.args, 0);
    if (!result.ok) {
      ws.send(JSON.stringify({ type: 'error', code: result.code, message: result.message }));
      return;
    }
    const version = this.currentVersion();
    const subscriptionId = `sub_${crypto.randomUUID()}`;
    this.sql.exec(
      `INSERT INTO _snapback_subscriptions (subscription_id, connection_id, function_name, args_json, last_version, auth_epoch)
       VALUES (?, ?, ?, ?, ?, ?)`,
      subscriptionId,
      connectionId,
      parsed.name,
      JSON.stringify(parsed.args || {}),
      version,
      0
    );
    ws.send(
      JSON.stringify({
        type: 'snapshot',
        subscriptionId,
        function: parsed.name,
        version,
        rows: result.value,
        connectionKey: connectionId,
      })
    );
  }

  // Fan out a commit to affected subscriptions. Rehydrates from storage
  // (never an in-memory registry), re-runs each subscription's query, and
  // pushes a live_replace tagged with the new version — a re-query fallback
  // that is correct across eviction because the registry is durable.
  fanOut(commit) {
    if (commit.changes.length === 0) return;
    const changedTables = new Set(commit.changes.map((change) => change.table));
    const affectedFunctions = new Set(
      functions
        .filter((fn) => fn.kind === 'LiveQuery')
        .filter((fn) => changedTables.has(tableForFunction(fn)))
        .map((fn) => fn.name)
    );
    const sockets = this.ctx.getWebSockets();
    const byConnection = new Map();
    for (const ws of sockets) {
      const id = this.connectionIdFor(ws);
      if (id) byConnection.set(id, ws);
    }
    const subs = [];
    for (const record of this.sql.exec('SELECT * FROM _snapback_subscriptions')) {
      subs.push(record);
    }
    for (const sub of subs) {
      if (!affectedFunctions.has(sub.function_name)) continue;
      const ws = byConnection.get(sub.connection_id);
      if (!ws) continue;
      // A woken object may have no live HostContext; re-run the query
      // synchronously through a fresh query invocation. Because handler
      // execution is async (RPC seam), schedule it and let it push.
      this.pushReplace(ws, sub, commit.version);
    }
  }

  async pushReplace(ws, sub, version) {
    const result = await this.invokeHandler(sub.function_name, 'query', JSON.parse(sub.args_json), sub.auth_epoch);
    if (!result.ok) return;
    this.sql.exec('UPDATE _snapback_subscriptions SET last_version = ? WHERE subscription_id = ?', version, sub.subscription_id);
    try {
      ws.send(
        JSON.stringify({
          type: 'live_replace',
          subscriptionId: sub.subscription_id,
          function: sub.function_name,
          version,
          rows: result.value,
        })
      );
    } catch (_) {
      // socket gone; the disconnect handler prunes the registry
    }
  }

  webSocketClose(ws) {
    const connectionId = this.connectionIdFor(ws);
    if (connectionId) {
      this.sql.exec('DELETE FROM _snapback_subscriptions WHERE connection_id = ?', connectionId);
    }
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }

  reset() {
    this.sql.exec('DELETE FROM _snapback_changes');
    this.sql.exec('UPDATE _snapback_version SET version = 0 WHERE id = 1');
    this.sql.exec('DELETE FROM _snapback_subscriptions');
    for (const table of schema.tables) {
      this.sql.exec(`DELETE FROM app_${table.name}`);
    }
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ type: 'resync_required', reason: 'reset' }));
      } catch (_) {}
    }
    return json(200, { reset: true });
  }
}

function tableForFunction(fn) {
  // The proof's single-table live query maps to the app's one syncable table.
  return schema.tables[0].name;
}

function parseEnvelope(envelope) {
  try {
    const parsed = JSON.parse(envelope);
    if (parsed && parsed.r && typeof parsed.r === 'object') {
      const r = parsed.r;
      if (r.__snapbackOk === true) return { ok: true, value: r.value };
      if (r.__snapbackOk === false) {
        return { ok: false, code: r.code || 'SNAPBACK_HANDLER_FAILED', message: r.message || 'handler failed' };
      }
    }
  } catch (_) {}
  return { ok: false, code: 'SNAPBACK_HANDLER_DID_NOT_SETTLE', message: 'handler produced no tagged envelope' };
}

function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}
