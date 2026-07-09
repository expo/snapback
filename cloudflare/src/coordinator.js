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
// Durable Objects interleave requests at await points, and the handler seam is
// an await — so every invocation-bearing entry point (query, mutation,
// subscribe) runs under one coordinator-local mutex (`runExclusive`). One
// handler executes, commits, and fans out at a time; captured read sets are
// recorded but not yet validated, so serialization is what enforces the
// isolation the manifest declares (`coordinator-serialized-invocations`,
// ENG-23575). The re-entrant /host-call path deliberately stays OUTSIDE the
// mutex: it is how the invocation holding the mutex makes progress.
//
// Handler code runs in a SEPARATE, globally stripped isolate — the
// single-sourced LLP 0048 harness Worker (HANDLER binding) — reached over an
// async, RPC-shaped seam. Handlers touch storage only through the `ctx`
// surface served back here as host calls; they never receive a Durable Object
// storage handle, env, or ambient global (LLP 0009, verified by the
// ambient-power denial test).

import { HostContext, physicalTableName } from './host-ops.js';
import { parseHandlerEnvelope } from '../../packages/snapback-harness/envelope.mjs';
// The deploy-time app selector (LLP 0049 Phase 0): 'snapback-app' is an
// aliased module specifier — wrangler config `alias` (and the Miniflare
// harness's esbuild alias) resolve it to exactly one checked-in app bundle
// (../app/notes.app.js or ../app/all-aboard.app.js) at build time. The
// Workers runtime forbids dynamic evaluation, so selection is a build fact,
// never a runtime flag.
import {
  appMeta,
  bundleHash,
  schema,
  functions,
  seed as appSeed,
  config as appConfig,
  cron as appCron,
} from 'snapback-app';

const APP_SCHEMA_HASH = schema.schemaHash;
const APP_BUNDLE_HASH = bundleHash;
const APP_TABLES = new Set(schema.tables.map((table) => table.name));
const CHANGE_JOURNAL_RETAIN_VERSIONS = 1000;

export class Coordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    // Live invocations keyed by host-call token, so a re-entrant /host-call
    // (routed back from the handler isolate) finds its HostContext. Purely
    // in-memory and request-scoped: nothing across eviction depends on it.
    this.activeInvocations = new Map();
    // The invocation mutex (ENG-23575): chains every invocation-bearing
    // request so handler execution + commit + fan-out (and subscription
    // snapshot + registration) are one critical section each.
    this.invocationChain = Promise.resolve();
    // Fresh per in-memory instance, never persisted: lets a remote client
    // observe a real platform eviction (the marker changes across a quiet
    // window) — the LLP 0040 decisive-evidence run reads it off /health.
    this.bootMarker = crypto.randomUUID();
    this.startupError = null;
    this.ensureSchema();
  }

  // Serialize `task` behind every previously queued invocation. Failures
  // propagate to the caller but never poison the chain.
  runExclusive(task) {
    const run = this.invocationChain.then(() => task());
    this.invocationChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
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
    // args, and connection id — rehydrated lazily on wake. In-memory
    // registries die at eviction while their sockets live on. The identity
    // uniqueness is the idempotence contract for React StrictMode/retry paths.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_subscriptions (
         subscription_id TEXT PRIMARY KEY,
         connection_id TEXT NOT NULL,
         function_name TEXT NOT NULL,
         args_json TEXT NOT NULL,
         UNIQUE(connection_id, function_name, args_json)
       )`
    );
    this.migrateSubscriptionsSchema();
    // Connection grants for the kit wire protocol (ENG-23442 shape): ids are
    // server-granted capabilities paired with a bearer token. Durable, so a
    // grant survives eviction/hibernation exactly like the subscriptions
    // that reference it.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_connections (
         connection_id TEXT PRIMARY KEY,
         token TEXT NOT NULL,
         opened_at_ms INTEGER NOT NULL
       )`
    );
    // Pool rotation cursors (LLP 0049 §Config And Secrets, OQ1): coordinator-
    // local durable metadata, NEVER values. Applied modulo the current member
    // count at grant time, so a pool edit can never strand a cursor out of
    // range. Deliberately not cleared by destructive reset — config metadata
    // is deployment state, not app data.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_config_cursors (
         entry_name TEXT PRIMARY KEY,
         cursor INTEGER NOT NULL
       )`
    );
    // Durable cron state (LLP 0028 §Scheduler state / LLP 0049 Phase 3):
    // per-job activation + nominal schedule + last-run ledger summary, and
    // the claim table whose stable idempotency key (jobName, scheduledAt)
    // makes DO-alarm auto-retry safe — a duplicate wakeup for an
    // already-claimed slot must not double-fetch or double-commit.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_cron_state (
         job_name TEXT PRIMARY KEY,
         armed INTEGER NOT NULL DEFAULT 0,
         next_nominal_at_ms INTEGER,
         last_run_id TEXT,
         last_scheduled_at_ms INTEGER,
         last_trigger TEXT,
         last_outcome TEXT,
         last_duration_ms INTEGER,
         last_error TEXT,
         last_finished_at_ms INTEGER
       )`
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_cron_claims (
         idempotency_key TEXT PRIMARY KEY,
         job_name TEXT NOT NULL,
         scheduled_at_ms INTEGER NOT NULL,
         run_id TEXT NOT NULL,
         claimed_at_ms INTEGER NOT NULL,
         state TEXT NOT NULL
       )`
    );
    for (const table of schema.tables) {
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS ${this.physicalTable(table.name)} (id TEXT PRIMARY KEY, row_json TEXT NOT NULL)`
      );
    }
    this.startupError = this.validateDeploymentMetadata();
    if (!this.startupError) this.writeDeploymentMetadata();
  }

  migrateSubscriptionsSchema() {
    this.sql.exec('DROP TABLE IF EXISTS _snapback_subscriptions_next');
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_subscriptions_next (
         subscription_id TEXT PRIMARY KEY,
         connection_id TEXT NOT NULL,
         function_name TEXT NOT NULL,
         args_json TEXT NOT NULL,
         UNIQUE(connection_id, function_name, args_json)
       )`
    );
    this.sql.exec(
      `INSERT OR IGNORE INTO _snapback_subscriptions_next (subscription_id, connection_id, function_name, args_json)
       SELECT subscription_id, connection_id, function_name, args_json
       FROM _snapback_subscriptions
       ORDER BY subscription_id`
    );
    this.sql.exec('DROP TABLE _snapback_subscriptions');
    this.sql.exec('ALTER TABLE _snapback_subscriptions_next RENAME TO _snapback_subscriptions');
  }

  expectedMetadata() {
    return {
      schema_hash: APP_SCHEMA_HASH,
      bundle_hash: APP_BUNDLE_HASH,
    };
  }

  readMeta(key) {
    for (const record of this.sql.exec('SELECT value FROM _snapback_meta WHERE key = ?', key)) {
      return String(record.value);
    }
    return null;
  }

  hasPersistentAppState() {
    if (this.currentVersion() > 0) return true;
    for (const table of schema.tables) {
      for (const record of this.sql.exec(`SELECT COUNT(*) AS count FROM ${this.physicalTable(table.name)}`)) {
        if (Number(record.count) > 0) return true;
      }
    }
    for (const record of this.sql.exec('SELECT COUNT(*) AS count FROM _snapback_changes')) {
      if (Number(record.count) > 0) return true;
    }
    for (const record of this.sql.exec('SELECT COUNT(*) AS count FROM _snapback_subscriptions')) {
      if (Number(record.count) > 0) return true;
    }
    return false;
  }

  validateDeploymentMetadata() {
    const expected = this.expectedMetadata();
    const nonEmpty = this.hasPersistentAppState();
    for (const [key, expectedValue] of Object.entries(expected)) {
      const storedValue = this.readMeta(key);
      if (storedValue == null && nonEmpty) {
        return staleArtifact(
          'SNAPBACK_STALE_CLOUDFLARE_ARTIFACT_METADATA',
          `stored app state has no ${key}; reset or migrate before serving this deployment`,
          { key, expected: expectedValue, actual: null }
        );
      }
      if (storedValue != null && storedValue !== expectedValue) {
        return staleArtifact(
          key === 'schema_hash' ? 'SNAPBACK_STALE_CLOUDFLARE_SCHEMA_HASH' : 'SNAPBACK_STALE_CLOUDFLARE_BUNDLE_HASH',
          `stored ${key} does not match this deployment; reset or migrate before serving it`,
          { key, expected: expectedValue, actual: storedValue }
        );
      }
    }
    return null;
  }

  writeDeploymentMetadata() {
    for (const [key, value] of Object.entries(this.expectedMetadata())) {
      this.sql.exec(
        `INSERT INTO _snapback_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        key,
        value
      );
    }
  }

  // Every table name that reaches SQL identifier position goes through the
  // manifest-derived gate, even schema-sourced ones (ENG-23578).
  physicalTable(table) {
    const physical = physicalTableName(table, APP_TABLES);
    if (!physical) {
      throw new Error(`SNAPBACK_HANDLER_HOST_CALL_INVALID: table "${table}" is not declared in the app schema`);
    }
    return physical;
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

    // A deployment/state mismatch refuses the data plane (fail closed) but
    // leaves /health for diagnosis, /reset for recovery, and /config/status
    // for operator config diagnosis (deployment config, not app data).
    if (
      this.startupError &&
      path !== '/health' &&
      path !== '/reset' &&
      path !== '/__test/corrupt-meta' &&
      path !== '/config/status'
    ) {
      return json(409, this.startupError);
    }
    if (path === '/config/status') {
      return this.configStatus();
    }
    if (path === '/cron/status') {
      return this.cronStatus();
    }
    // Admin-gated manual run trigger on the existing SNAPBACK_ADMIN_TOKEN
    // POST surface (LLP 0049 §Warm Polling / ENG-23587) — never a public
    // run-now route. Manual runs claim a unique key; they never consume a
    // scheduled slot.
    if (path === '/cron/run') {
      return this.adminGated(request, async () => {
        const payload = await request.json().catch(() => ({}));
        const job = this.alarmJobs().find((entry) => entry.name === String(payload.job || ''));
        if (!job) {
          return json(404, { ok: false, code: 'SNAPBACK_CRON_JOB_UNKNOWN', message: `no alarm job ${payload.job}` });
        }
        const runId = crypto.randomUUID();
        const outcome = await this.runCronJob(job, 'manual', Date.now(), `manual:${runId}`);
        return json(200, { ok: true, ...outcome });
      });
    }
    if (path === '/host-call') {
      return this.serveHostCall(request);
    }
    if (path === '/health') {
      if (this.startupError) {
        return json(409, { ...this.startupError, version: this.currentVersion() });
      }
      return json(200, {
        ok: true,
        version: this.currentVersion(),
        schemaHash: APP_SCHEMA_HASH,
        bundleHash: APP_BUNDLE_HASH,
        objectBoot: this.bootMarker,
        // Deploy-probe surface (ENG-23732): a live gateway serving the
        // bootstrap pass (services stripped) reports handler:false here, so
        // deploy.sh can detect it instead of every query 500ing later.
        bindings: {
          handler: Boolean(this.env.HANDLER),
          actionHandler: Boolean(this.env.ACTION_HANDLER),
        },
      });
    }
    if (path === '/reset') {
      // Destructive admin surface: token-gated and POST-only (ENG-23587),
      // and under the invocation mutex — a reset interleaving with an
      // in-flight mutation would let pre-reset buffered writes commit into
      // the freshly reset store (ENG-23575's rationale applies here too).
      return this.adminGated(request, () => this.runExclusive(() => this.reset()));
    }
    if (path === '/__test/corrupt-meta') {
      return this.testingGated(request, async () => this.corruptMetaForTest(await request.json()));
    }
    // Testing-only action invocation (LLP 0049 Phase 1): exercises the
    // action grant path — descriptor construction, fail-closed handles,
    // MISSING/UNDECLARED codes — before Phase 2 lands the public action
    // route with host-mediated egress. Never available without
    // SNAPBACK_TESTING=1; the capability manifest keeps outbound_actions as
    // a declared gap.
    if (path === '/__test/action') {
      return this.testingGated(request, async () => {
        const payload = await request.json();
        const outcome = await this.executeAction(payload.name, payload.args || {}, 'test');
        if (!outcome.ok) return json(200, { ok: false, code: outcome.diagnostic.code, message: outcome.diagnostic.message });
        return json(200, { ok: true, result: outcome.result });
      });
    }
    // Testing-only alarm trigger: fires the dispatcher exactly as a DO alarm
    // wakeup would, so the Miniflare acceptance can exercise duplicate-slot
    // claims and no-demand early-outs deterministically.
    if (path === '/__test/alarm') {
      return this.testingGated(request, async () => {
        await this.alarm();
        return json(200, { fired: true });
      });
    }
    // Testing-only payload echo: the exact secretsJson the coordinator would
    // attach for a function — the descriptors-only fact is asserted by test,
    // not by convention (LLP 0049 Phase 1 exit evidence).
    if (path === '/__test/secrets-payload') {
      return this.testingGated(request, async () => {
        const payload = await request.json();
        const fn = this.functionByName(payload.name);
        if (!fn) return json(404, { error: `no function ${payload.name}` });
        const mode = payload.mode || (fn.kind === 'Action' ? 'action' : 'query');
        const secretsJson = mode === 'action' ? this.buildActionGrantsJson(fn, { advance: false }) : null;
        return json(200, { name: fn.name, mode, secretsJson });
      });
    }
    if (path === '/query') {
      const payload = await request.json();
      return this.runExclusive(() => this.handleQuery(payload));
    }
    if (path === '/mutation') {
      const payload = await request.json();
      return this.runExclusive(() => this.handleMutation(payload));
    }
    if (path === '/live/stream') {
      return this.acceptLiveSocket(request);
    }
    // --- kit wire protocol (LLP 0049 Phase 0) -----------------------------
    // The generated Contract surface speaks the local server's protocol
    // through demos/_kit/client.mjs; these routes are that protocol's
    // Cloudflare projection, so the browser surface runs on generated
    // bindings with no hand-written data path (§Realtime And Browser
    // Surface). Proof-protocol routes above stay untouched — they are
    // LLP 0040's pinned regression surface.
    {
      const kitQuery = path.match(/^\/query\/([A-Za-z0-9_-]+)$/);
      if (kitQuery) {
        const payload = await request.json();
        return this.runExclusive(() => this.kitQuery(kitQuery[1], payload));
      }
      const kitMutation = path.match(/^\/mutation\/([A-Za-z0-9_-]+)$/);
      if (kitMutation) {
        const payload = await request.json();
        return this.runExclusive(() => this.kitMutation(kitMutation[1], payload));
      }
      // The generated client.action transport (LLP 0049 Phase 2). NOT wrapped
      // in runExclusive: executeAction stages under the mutex, runs the
      // handler and its external fetch off it, and reacquires per mutation
      // commit — a slow 511 round-trip must never stall this object's
      // queries, mutations, or live pushes.
      const kitAction = path.match(/^\/action\/([A-Za-z0-9_-]+)$/);
      if (kitAction) {
        const payload = await request.json();
        const outcome = await this.executeAction(kitAction[1], (payload && payload.args) || {}, 'manual');
        return json(200, outcome);
      }
      if (path === '/connection/open') {
        const payload = await request.json();
        return this.runExclusive(() => this.kitOpenConnection(payload));
      }
      if (path === '/app/ensure') {
        const payload = await request.json();
        return this.runExclusive(() => this.kitEnsureApp(payload));
      }
      const kitSubscribe = path.match(/^\/live\/([A-Za-z0-9_-]+)\/subscribe$/);
      if (kitSubscribe) {
        const payload = await request.json();
        const denied = this.verifyConnection(payload.connection_id, request.headers.get('x-snapback-connection-token'));
        if (denied) return denied;
        return this.runExclusive(() => this.kitSubscribe(kitSubscribe[1], payload));
      }
      const kitUnsubscribe = path.match(/^\/live\/([A-Za-z0-9_-]+)\/unsubscribe$/);
      if (kitUnsubscribe) {
        const payload = await request.json();
        const denied = this.verifyConnection(payload.connection_id, request.headers.get('x-snapback-connection-token'));
        if (denied) return denied;
        return this.runExclusive(() => this.kitUnsubscribe(payload));
      }
      const kitStream = path.match(/^\/live\/([A-Za-z0-9_.-]+)\/stream$/);
      if (kitStream) {
        return this.acceptKitSocket(request, decodeURIComponent(kitStream[1]), url);
      }
      const kitOutbox = path.match(/^\/outbox\/([A-Za-z0-9_.-]+)$/);
      if (kitOutbox) {
        const denied = this.verifyConnection(
          decodeURIComponent(kitOutbox[1]),
          request.headers.get('x-snapback-connection-token')
        );
        if (denied) return denied;
        // No durable outbox on this target: socket loss recovers through the
        // kit's fresh snapshot-with-subscribe, and the HTTP poll fallback
        // drains empty. Declared in the capability manifest, not silent.
        return json(200, []);
      }
    }
    if (path === '/evict') {
      // CI surrogate for real eviction (LLP 0040 §Acceptance): discard all
      // in-memory state so the next commit must rehydrate from storage.
      // Admin-gated: an open /evict lets any client invalidate a
      // decisive-evidence measurement run (ENG-23587).
      return this.adminGated(request, () =>
        this.runExclusive(() => {
          this.activeInvocations.clear();
          return json(200, { evicted: true });
        })
      );
    }
    return json(404, { error: 'not found' });
  }

  // The shared-secret gate for the destructive admin endpoints, the same
  // pattern /host-call uses for its per-invocation token (ENG-23587). Fails
  // closed: no configured token means no admin surface at all.
  adminGated(request, run) {
    if (request.method !== 'POST') {
      return json(405, { ok: false, code: 'SNAPBACK_ADMIN_METHOD_NOT_ALLOWED', message: 'admin endpoints are POST-only' });
    }
    const expected = this.env.SNAPBACK_ADMIN_TOKEN;
    if (typeof expected !== 'string' || expected.length === 0) {
      return json(403, {
        ok: false,
        code: 'SNAPBACK_ADMIN_DISABLED',
        message: 'no SNAPBACK_ADMIN_TOKEN is configured; the admin surface is disabled',
      });
    }
    const presented = request.headers.get('x-snapback-admin-token') || '';
    if (presented !== expected) {
      return json(403, { ok: false, code: 'SNAPBACK_ADMIN_TOKEN_INVALID', message: 'missing or invalid admin token' });
    }
    return run();
  }

  testingGated(request, run) {
    if (this.env.SNAPBACK_TESTING !== '1') {
      return json(404, { error: 'not found' });
    }
    if (request.method !== 'POST') {
      return json(405, { ok: false, code: 'SNAPBACK_TEST_METHOD_NOT_ALLOWED', message: 'test endpoints are POST-only' });
    }
    return run();
  }

  corruptMetaForTest(payload) {
    this.sql.exec(
      `INSERT INTO _snapback_meta (key, value) VALUES ('schema_hash', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      payload.schemaHash || 'stale-schema'
    );
    this.sql.exec(
      `INSERT INTO _snapback_meta (key, value) VALUES ('bundle_hash', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      payload.bundleHash || APP_BUNDLE_HASH
    );
    this.sql.exec('UPDATE _snapback_version SET version = 1 WHERE id = 1');
    this.startupError = this.validateDeploymentMetadata();
    return json(200, { startupError: this.startupError });
  }

  // --- config / secrets backend (LLP 0049 Phase 1, LLP 0036 deploy-time-binding)

  // Mechanical, app-scoped binding name: caltrainFeed on all-aboard maps to
  // SNAPBACK_SECRET_ALL_ABOARD_CALTRAIN_FEED. The binding name is not an app
  // API — app code still asks for ctx.secrets.rotating('caltrainFeed').
  secretBindingName(entryName) {
    const upper = (value) =>
      String(value)
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .toUpperCase();
    return `SNAPBACK_SECRET_${upper(appMeta.name)}_${upper(entryName)}`;
  }

  // Pool member count for a declared entry, from the gateway Worker's secret
  // bindings (OQ2: the Coordinator's env IS the gateway env). One JSON-array
  // Worker secret per pooled entry (OQ1); a bare string counts as a
  // single-member pool. Never returns values to callers that report state.
  poolMembers(entryName) {
    const raw = this.env[this.secretBindingName(entryName)];
    if (typeof raw !== 'string' || raw.length === 0) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((value) => typeof value === 'string' && value.length > 0);
    } catch (_) {
      // Not JSON: treat the raw string as a single-member pool.
    }
    return [raw];
  }

  configGeneration() {
    const raw = this.env.SNAPBACK_CONFIG_GENERATION;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  }

  // The rotation cursor advances once per grant construction (per action
  // invocation that uses the entry) and is applied modulo the CURRENT member
  // count, so pool edits cannot strand it (LLP 0049 OQ1). `advance: false`
  // peeks without consuming — observation surfaces (status, the testing
  // payload echo) must not rotate the pool.
  nextRotationCursor(entryName, { advance = true } = {}) {
    let cursor = 0;
    for (const record of this.sql.exec(
      'SELECT cursor FROM _snapback_config_cursors WHERE entry_name = ?',
      entryName
    )) {
      cursor = Number(record.cursor);
    }
    if (advance) {
      this.sql.exec(
        `INSERT INTO _snapback_config_cursors (entry_name, cursor) VALUES (?, ?)
         ON CONFLICT(entry_name) DO UPDATE SET cursor = excluded.cursor`,
        entryName,
        cursor + 1
      );
    }
    return cursor;
  }

  declaredConfigEntry(entryName) {
    return (appConfig || []).find((entry) => entry.name === entryName) || null;
  }

  // Action-only redacted grant descriptors (LLP 0049 §Config And Secrets):
  // entry names, set/missing state, member count, and rotation cursor —
  // NEVER values. The handler isolate's ctx.secrets builds fail-closed
  // descriptor handles from this (descriptorsOnly), and the local
  // values-in-secretsJson shape never ports to this profile.
  buildActionGrantsJson(fn, { advance = true } = {}) {
    const uses = Array.isArray(fn.uses) ? fn.uses : [];
    const entries = {};
    for (const entryName of uses) {
      if (!this.declaredConfigEntry(entryName)) continue;
      const members = this.poolMembers(entryName);
      entries[entryName] = {
        set: members.length > 0,
        memberCount: members.length,
        cursor: members.length > 0 ? this.nextRotationCursor(entryName, { advance }) % members.length : 0,
      };
    }
    return JSON.stringify({ descriptorsOnly: true, entries });
  }

  // The value-resolution boundary (Phase 2 host-mediated fetch unwraps
  // through this, and ONLY this): descriptor -> value, coordinator-side.
  resolveSecretValue(entryName, cursor) {
    const members = this.poolMembers(entryName);
    if (members.length === 0) return null;
    const index = Number.isInteger(cursor) ? ((cursor % members.length) + members.length) % members.length : 0;
    return members[index];
  }

  // GET /config/status — declarations, set/missing state, grant
  // relationships, pool member counts, rotation cursors, the active config
  // generation (the SNAPBACK_CONFIG_GENERATION attestation carrier), and the
  // declaration hash. Values never appear here (asserted by acceptance).
  async configStatus() {
    const declarations = [];
    for (const entry of appConfig || []) {
      const members = this.poolMembers(entry.name);
      let cursor = 0;
      for (const record of this.sql.exec(
        'SELECT cursor FROM _snapback_config_cursors WHERE entry_name = ?',
        entry.name
      )) {
        cursor = Number(record.cursor);
      }
      declarations.push({
        name: entry.name,
        description: entry.description || null,
        required: !!entry.required,
        pool: !!entry.pool,
        binding: this.secretBindingName(entry.name),
        state: members.length > 0 ? 'set' : 'missing',
        poolMembers: members.length,
        rotationCursor: members.length > 0 ? cursor % members.length : 0,
      });
    }
    const grants = {};
    for (const fn of functions) {
      if (fn.kind === 'Action' && Array.isArray(fn.uses) && fn.uses.length > 0) {
        grants[fn.name] = [...fn.uses];
      }
    }
    const declarationText = JSON.stringify(
      (appConfig || []).map((entry) => ({ name: entry.name, required: !!entry.required, pool: !!entry.pool }))
    );
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(declarationText));
    const declarationHash = [...new Uint8Array(digest)]
      .slice(0, 8)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return json(200, {
      backend: 'deploy-time-binding',
      profile: 'cloudflare-do-sqlite-v8',
      generation: this.configGeneration(),
      declarationHash: `sha256:${declarationHash}`,
      // The platform version/deployment identifier is reported when the
      // platform exposes one to the running Worker; the Workers runtime has
      // no ambient self-version API today, so this is honestly null.
      platformVersionId: null,
      declarations,
      grants,
    });
  }

  // --- action execution (LLP 0049 Phase 2) --------------------------------

  // Execute one action: stage under the serialization mutex (the fn/state
  // checks), run the handler OFF it, reacquire per host call — runMutation
  // re-enters through runExclusive, and host fetch rides the un-chained
  // /host-call path — with wall-clock watchdog parity to the local
  // SNAPBACK_ACTION_TIMEOUT posture. No Durable Object transaction is ever
  // held across the external fetch: transactionSync appears only inside
  // commit(), which runs under the mutex after the fetch settled.
  async executeAction(name, args, trigger) {
    const staged = await this.runExclusive(() => {
      const fn = this.functionByName(name);
      if (!fn || fn.kind !== 'Action') {
        return { error: { code: 'SNAPBACK_ACTION_UNKNOWN', message: `${name} is not an action on this app` } };
      }
      return { fn };
    });
    if (staged.error) {
      return { ok: false, function: name, kind: 'Action', diagnostic: staged.error };
    }
    const timeoutMs = this.actionTimeoutMs();
    let timer = null;
    const watchdog = new Promise((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            ok: false,
            code: 'SNAPBACK_ACTION_TIMEOUT',
            message: `action ${name} exceeded the ${timeoutMs}ms wall-clock budget; the invocation failed`,
          }),
        timeoutMs
      );
    });
    let result;
    try {
      result = await Promise.race([this.invokeHandler(name, 'action', args, { trigger }), watchdog]);
    } finally {
      clearTimeout(timer);
    }
    if (!result.ok) {
      return {
        ok: false,
        function: name,
        kind: 'Action',
        diagnostic: { code: result.code, message: result.message, ...(result.details ? { details: result.details } : {}) },
      };
    }
    return { ok: true, function: name, kind: 'Action', result: result.value };
  }

  actionTimeoutMs() {
    const raw = Number(this.env.SNAPBACK_ACTION_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
  }

  // The action's durable leg: a FULL nested mutation invocation — handler,
  // commit, fan-out — executed under the invocation mutex (the caller wraps
  // this in runExclusive). Returns the mutation handler's value; a failure
  // carries its code back into the action as a coded error.
  async runMutationForAction(name, args) {
    const fn = this.functionByName(name);
    if (!fn || fn.kind !== 'Mutation') {
      return { ok: false, code: 'SNAPBACK_ACTION_MUTATION_UNKNOWN', message: `${name} is not a mutation on this app` };
    }
    const result = await this.invokeHandler(name, 'mutation', args);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    const commit = this.commit(result.host);
    await this.fanOut(commit);
    return { ok: true, value: result.value };
  }

  // The host-mediated fetch boundary (LLP 0049 §Action Egress): descriptors
  // unwrap to values HERE and only here; placement slots cover query-param
  // (511's api_key) and header (directions' Authorization); and every
  // diagnostic that re-enters the isolate — error messages, the final URL,
  // even the upstream body — is redacted first. The coordinator owns the
  // scrub; handler-side redaction remains defense in depth, not the line.
  // Destination allowlisting is not yet implemented on this profile — a
  // named manifest fact (runtimeFacts.egress), not a silent difference.
  async hostActionFetch(request) {
    const urlText = String(request.url || '');
    let url;
    try {
      url = new URL(urlText);
    } catch (_) {
      return { ok: false, code: 'SNAPBACK_HOST_FETCH_INVALID', message: 'host fetch requires an absolute URL' };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, code: 'SNAPBACK_HOST_FETCH_INVALID', message: `unsupported protocol ${url.protocol}` };
    }
    const headers = {};
    for (const [key, value] of Object.entries(request.headers || {})) {
      headers[String(key)] = String(value);
    }
    const resolvedValues = [];
    for (const slot of request.secretSlots || []) {
      const descriptor = slot && slot.secret;
      if (!descriptor || typeof descriptor.name !== 'string') {
        return { ok: false, code: 'SNAPBACK_HOST_FETCH_SLOT_INVALID', message: 'a secret slot carried no descriptor' };
      }
      if (!this.declaredConfigEntry(descriptor.name)) {
        return {
          ok: false,
          code: 'SNAPBACK_CONFIG_UNDECLARED',
          message: `${descriptor.name} is not a declared config entry`,
        };
      }
      const value = this.resolveSecretValue(descriptor.name, descriptor.cursor);
      if (value == null) {
        return { ok: false, code: 'SNAPBACK_CONFIG_MISSING', message: `${descriptor.name} has no value set` };
      }
      resolvedValues.push(value);
      if (slot.placement === 'query-param') {
        url.searchParams.set(String(slot.name), value);
      } else if (slot.placement === 'header') {
        headers[String(slot.name)] = value;
      } else {
        return {
          ok: false,
          code: 'SNAPBACK_HOST_FETCH_SLOT_INVALID',
          message: `unsupported secret placement ${slot.placement}`,
        };
      }
    }
    const redact = (text) => {
      let out = String(text ?? '');
      for (const value of resolvedValues) {
        if (value.length > 0) out = out.split(value).join('[redacted]');
      }
      return out;
    };
    const timeoutMs = Math.min(
      Number.isFinite(Number(request.timeoutMs)) && Number(request.timeoutMs) > 0
        ? Number(request.timeoutMs)
        : 15_000,
      this.actionTimeoutMs()
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('SNAPBACK_HOST_FETCH_TIMEOUT'), timeoutMs);
    try {
      const response = await fetch(url.toString(), {
        method: String(request.method || 'GET'),
        headers,
        body: request.body == null ? undefined : String(request.body),
        signal: controller.signal,
      });
      const bodyText = await response.text();
      return {
        ok: true,
        value: {
          status: response.status,
          ok: response.ok,
          url: redact(url.toString()),
          bodyText: redact(bodyText),
        },
      };
    } catch (error) {
      return {
        ok: false,
        code: 'SNAPBACK_HOST_FETCH_FAILED',
        message: `host fetch to ${redact(url.toString())} failed: ${redact((error && error.message) || error)}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // --- warm polling: demand-armed DO alarm + hardened durable runner ------
  // (LLP 0049 Phase 3 / LLP 0028): subscribe arms the alarm, last-unsubscribe
  // cancels it, so an idle deployment takes ZERO warm-poll wakeups — the
  // ratified supersession of the minute-static-wakeup default. One alarm per
  // object (LLP 0014): alarm() is a dispatcher over every armed job's next
  // nominal time. No setInterval, no always-awake loop; the alarm and the
  // hibernating sockets coexist. No last-subscriber linger window — LLP 0028
  // does not define one, and this implementation does not introduce one.

  alarmJobs() {
    return (appCron || []).filter(
      (job) => job.enabled !== false && job.targetWakeup && job.targetWakeup.kind === 'DynamicAlarm'
    );
  }

  jobIntervalMs(job) {
    // Testing-only cadence override so the Miniflare acceptance can observe
    // scheduled ticks without real 60s waits; never read on real deploys.
    if (this.env.SNAPBACK_TESTING === '1') {
      const override = Number(this.env.SNAPBACK_CRON_INTERVAL_OVERRIDE_MS);
      if (Number.isFinite(override) && override > 0) return override;
    }
    return Number(job.schedule && job.schedule.everyMs) || 60_000;
  }

  cronDemand(job) {
    const whileLive = (job.activation && job.activation.whileLive) || [];
    if (job.activation && job.activation.kind !== 'WhileLive') return 1;
    if (whileLive.length === 0) return 0;
    const placeholders = whileLive.map(() => '?').join(', ');
    for (const record of this.sql.exec(
      `SELECT COUNT(*) AS count FROM _snapback_subscriptions WHERE function_name IN (${placeholders})`,
      ...whileLive
    )) {
      return Number(record.count);
    }
    return 0;
  }

  readCronState(jobName) {
    for (const record of this.sql.exec('SELECT * FROM _snapback_cron_state WHERE job_name = ?', jobName)) {
      return record;
    }
    return null;
  }

  writeCronState(jobName, fields) {
    this.sql.exec('INSERT OR IGNORE INTO _snapback_cron_state (job_name, armed) VALUES (?, 0)', jobName);
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const assignments = keys.map((key) => `${key} = ?`).join(', ');
    this.sql.exec(
      `UPDATE _snapback_cron_state SET ${assignments} WHERE job_name = ?`,
      ...keys.map((key) => fields[key]),
      jobName
    );
  }

  // Reconcile activation with current demand, then recompute the single
  // object alarm. Called from every subscribe/unsubscribe/close/reset seam.
  async reconcileCronActivation() {
    const nowMs = Date.now();
    for (const job of this.alarmJobs()) {
      const state = this.readCronState(job.name);
      const armed = state ? Number(state.armed) === 1 : false;
      const demand = this.cronDemand(job);
      if (demand > 0 && !armed) {
        // First subscriber after idle: run a catch-up poll promptly when the
        // data is already stale (LLP 0028's missed-ticks → run once on
        // recovery), otherwise wait out the remainder of the interval.
        const interval = this.jobIntervalMs(job);
        const lastFinished = state ? Number(state.last_finished_at_ms || 0) : 0;
        const stale = nowMs - lastFinished >= interval;
        const nextNominal = stale ? nowMs : lastFinished + interval;
        this.writeCronState(job.name, { armed: 1, next_nominal_at_ms: nextNominal });
      } else if (demand === 0 && armed) {
        this.writeCronState(job.name, { armed: 0, next_nominal_at_ms: null });
      }
    }
    await this.recomputeAlarm();
  }

  // The one-alarm-per-object dispatcher's arming half: the object alarm is
  // min(next nominal) over armed jobs, or absent when none is armed.
  async recomputeAlarm() {
    let next = null;
    for (const job of this.alarmJobs()) {
      const state = this.readCronState(job.name);
      if (!state || Number(state.armed) !== 1 || state.next_nominal_at_ms == null) continue;
      const nominal = Number(state.next_nominal_at_ms);
      if (next === null || nominal < next) next = nominal;
    }
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1));
    }
  }

  // The DO alarm handler — the dispatcher's firing half. A wakeup with no
  // work (demand vanished, or nothing due yet) early-outs without any
  // external fetch; a due armed job runs through the claimed runner.
  async alarm() {
    const nowMs = Date.now();
    for (const job of this.alarmJobs()) {
      const state = this.readCronState(job.name);
      if (!state || Number(state.armed) !== 1 || state.next_nominal_at_ms == null) continue;
      if (this.cronDemand(job) === 0) {
        this.writeCronState(job.name, { armed: 0, next_nominal_at_ms: null });
        continue;
      }
      const nominal = Number(state.next_nominal_at_ms);
      if (nominal > nowMs + 50) continue; // not due: spurious/early wakeup
      await this.runCronJob(job, 'scheduled', nominal);
    }
    await this.reconcileCronActivation();
  }

  // The hardened durable runner (LLP 0028 §Scheduler state): claim the slot
  // by its stable idempotency key (jobName, scheduledAt) BEFORE executing.
  // DO-alarm auto-retry re-runs the whole handler, so a duplicate wakeup for
  // an already-claimed slot advances the schedule without fetching or
  // committing again. Manual runs claim a unique per-run key — they never
  // consume a scheduled slot.
  async runCronJob(job, trigger, scheduledAtMs, idempotencyKey = null) {
    const runId = crypto.randomUUID();
    const key = idempotencyKey || `${job.name}@${scheduledAtMs}`;
    this.sql.exec(
      `INSERT OR IGNORE INTO _snapback_cron_claims (idempotency_key, job_name, scheduled_at_ms, run_id, claimed_at_ms, state)
       VALUES (?, ?, ?, ?, ?, 'claimed')`,
      key,
      job.name,
      scheduledAtMs,
      runId,
      Date.now()
    );
    let claimedBy = null;
    for (const record of this.sql.exec(
      'SELECT run_id FROM _snapback_cron_claims WHERE idempotency_key = ?',
      key
    )) {
      claimedBy = String(record.run_id);
    }
    const interval = this.jobIntervalMs(job);
    if (claimedBy !== runId) {
      // Already claimed (duplicate wakeup / alarm retry): advance past the
      // slot so the dispatcher re-arms for the NEXT nominal, execute nothing.
      this.advanceNominal(job, scheduledAtMs, interval);
      return { duplicate: true, idempotencyKey: key };
    }
    const startedAt = Date.now();
    let outcome = 'ok';
    let errorText = '';
    // Testing-only upstream override so the Miniflare acceptance can point
    // scheduled runs at a local mock 511; never read on real deploys.
    const args = { trigger: 'cron' };
    if (this.env.SNAPBACK_TESTING === '1' && typeof this.env.SNAPBACK_TEST_FEED_URL === 'string') {
      args.feedUrl = this.env.SNAPBACK_TEST_FEED_URL;
      // Short synthetic cadences (SNAPBACK_CRON_INTERVAL_OVERRIDE_MS) would
      // otherwise be swallowed by the app's 180s upstream-poll budget
      // (ENG-23642) — relax it for testing runs only. The app clamps this to
      // its production ceiling, so it can never RAISE the budget.
      args.pollBudgetMs = 0;
    }
    try {
      const result = await this.executeAction(job.action, args, trigger);
      if (!result.ok) {
        outcome = 'failed';
        errorText = `${result.diagnostic.code}: ${result.diagnostic.message}`;
      }
    } catch (error) {
      outcome = 'failed';
      errorText = String((error && error.message) || error);
    }
    const finishedAt = Date.now();
    this.sql.exec(
      `UPDATE _snapback_cron_claims SET state = ? WHERE idempotency_key = ?`,
      outcome === 'ok' ? 'done' : 'failed',
      key
    );
    this.writeCronState(job.name, {
      last_run_id: runId,
      last_scheduled_at_ms: scheduledAtMs,
      last_trigger: trigger,
      last_outcome: outcome,
      last_duration_ms: finishedAt - startedAt,
      last_error: errorText,
      last_finished_at_ms: finishedAt,
    });
    if (!idempotencyKey) {
      this.advanceNominal(job, scheduledAtMs, interval);
    }
    return { duplicate: false, runId, outcome, idempotencyKey: key };
  }

  // Advance to the next FUTURE nominal slot: one catch-up run per recovery,
  // never a stampede of missed ticks (LLP 0028).
  advanceNominal(job, fromNominalMs, intervalMs) {
    const nowMs = Date.now();
    let next = fromNominalMs + intervalMs;
    if (next <= nowMs) {
      const behind = Math.ceil((nowMs - next) / intervalMs) + 1;
      next = fromNominalMs + intervalMs * (behind + 1);
    }
    this.writeCronState(job.name, { next_nominal_at_ms: next });
  }

  // GET /cron/status — the ledger fields the local target exposes: last run
  // (id, nominal, trigger, outcome, duration, failure), next run, activation
  // state, and demand. No values, no secrets.
  cronStatus() {
    const jobs = [];
    for (const job of this.alarmJobs()) {
      const state = this.readCronState(job.name);
      const demand = this.cronDemand(job);
      jobs.push({
        name: job.name,
        action: job.action,
        everyMs: this.jobIntervalMs(job),
        wakeup: 'durable-object-alarm',
        activation: {
          kind: (job.activation && job.activation.kind) || 'AlwaysOn',
          whileLive: (job.activation && job.activation.whileLive) || [],
          state: state && Number(state.armed) === 1 ? 'armed' : 'inactive:no-demand',
          demand,
        },
        nextRun:
          state && Number(state.armed) === 1 && state.next_nominal_at_ms != null
            ? { nominalAtMs: Number(state.next_nominal_at_ms) }
            : null,
        lastRun:
          state && state.last_run_id
            ? {
                runId: String(state.last_run_id),
                scheduledAtMs: Number(state.last_scheduled_at_ms),
                trigger: String(state.last_trigger || ''),
                outcome: String(state.last_outcome || ''),
                durationMs: Number(state.last_duration_ms || 0),
                error: String(state.last_error || ''),
                finishedAtMs: Number(state.last_finished_at_ms || 0),
              }
            : null,
      });
    }
    return json(200, { jobs });
  }

  // --- handler invocation across the RPC seam ----------------------------

  // The invocation settlement budget (ENG-23605): how long the handler
  // server waits for the handler's completion envelope before reporting
  // didNotSettle. Deployment-tunable via the SNAPBACK_SETTLEMENT_TIMEOUT_MS
  // binding (the twin harness lowers it to keep the hangForever corpus case
  // fast); the default mirrors the local twin's posture of always having a
  // deadline rather than trusting handlers to settle. Actions legitimately
  // park on external fetches, and their wall-clock authority is the
  // executeAction watchdog (actionTimeoutMs) — the settlement deadline sits
  // just above it so it only catches the never-settling shape, never
  // slow-but-legal egress.
  settlementTimeoutMs(mode) {
    const configured = Number(this.env.SNAPBACK_SETTLEMENT_TIMEOUT_MS);
    const base = Number.isFinite(configured) && configured > 0 ? configured : 10_000;
    return mode === 'action' ? Math.max(base, this.actionTimeoutMs() + 1_000) : base;
  }

  async invokeHandler(fnName, mode, args, options = {}) {
    const fn = this.functionByName(fnName);
    if (!fn) {
      return { ok: false, code: 'SNAPBACK_HANDLER_EXPORT_MISSING', message: `no function ${fnName}` };
    }
    // Grants are action-only (LLP 0036): queries and mutations receive
    // secretsJson null and therefore no ctx.secrets at all.
    const secretsJson = mode === 'action' ? this.buildActionGrantsJson(fn) : null;
    const runJson =
      mode === 'action'
        ? JSON.stringify({
            runId: crypto.randomUUID(),
            trigger: options.trigger || 'manual',
            jobName: options.jobName || null,
          })
        : null;
    const token = crypto.randomUUID();
    const epoch = `${Date.now()}-${token}`;
    const host = new HostContext({
      sql: this.sql,
      mode,
      nowMs: Date.now(),
      epoch,
      newId: () => this.newId(),
      tables: APP_TABLES,
      // Action-only host capabilities (LLP 0049 Phase 2). runMutation
      // reacquires the invocation mutex per commit — the ENG-23324 pattern:
      // the action itself executes OFF the mutex, so a slow external fetch
      // never stalls queries, mutations, or live pushes on this object.
      runMutation:
        mode === 'action'
          ? (name, mutationArgs) => this.runExclusive(() => this.runMutationForAction(name, mutationArgs))
          : null,
      hostFetch: mode === 'action' ? (request) => this.hostActionFetch(request) : null,
    });
    this.activeInvocations.set(token, host);
    // Actions run on their own handler Worker when the deploy carries one
    // (ACTION_HANDLER): the handler server chains invocations per isolate
    // for rejection-ledger attribution (ENG-23585), so an action parked on a
    // slow host fetch would otherwise queue every query/mutation/fan-out
    // invocation behind it — the Cloudflare analogue of the local DK-4
    // fresh-VM action fence.
    const handlerService = mode === 'action' && this.env.ACTION_HANDLER ? this.env.ACTION_HANDLER : this.env.HANDLER;
    try {
      const response = await handlerService.fetch('http://handler/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          export: fn.export,
          argsJson: JSON.stringify(args || {}),
          authJson: JSON.stringify({}),
          mode,
          runJson,
          secretsJson,
          epoch,
          token,
          // The handler server's settlement deadline (ENG-23605). Without
          // it a never-settling handler parks this fetch forever AND wedges
          // the handler isolate's invocation chain — every later invocation
          // on that isolate queues behind the hang. The local twin has
          // always passed one (src/workerd_exec.rs); this closes the same
          // hole on the deployed path, and the twin corpus's hangForever
          // case now converges to SNAPBACK_HANDLER_DID_NOT_SETTLE here.
          settlementTimeoutMs: this.settlementTimeoutMs(mode),
          // The host-routing header entry.mjs echoes onto every host call so
          // the gateway routes it back to THIS coordinator object.
          hostHeaders: { 'x-snapback-do-id': this.ctx.id.toString() },
        }),
      });
      const result = await response.json();
      // The checks below mirror src/workerd_exec.rs order for the twin leg:
      // fatal → unhandled rejections → detection support → envelope.
      if (result.fatal) {
        return { ok: false, code: 'SNAPBACK_V8_RUNNER_INVOKE_FAILED', message: result.fatal };
      }
      if (result.didNotSettle) {
        return {
          ok: false,
          code: 'SNAPBACK_HANDLER_DID_NOT_SETTLE',
          message: 'handler did not settle before the harness deadline; the invocation failed and committed no writes',
        };
      }
      if (result.unhandledRejections && result.unhandledRejections.length > 0) {
        return {
          ok: false,
          code: 'SNAPBACK_HANDLER_UNHANDLED_REJECTION',
          message: 'handler completed with unhandled promise rejection(s) — the invocation failed and committed no writes',
          details: { rejections: result.unhandledRejections },
        };
      }
      if (result.rejectionDetectionSupported === false) {
        // Fail closed exactly as the twin does (ENG-23586): without rejection
        // detection, a detached chain's partial writes could commit unseen
        // (the ENG-23361 hole), so the invocation is refused instead.
        return {
          ok: false,
          code: 'SNAPBACK_V8_REJECTION_DETECTION_UNAVAILABLE',
          message:
            'the handler isolate could not install unhandled-rejection detection; the LLP 0009 conformance floor requires it on every engine',
        };
      }
      const parsed = parseHandlerEnvelope(result.envelope);
      return { ...parsed, host, observedVersion: host.observedVersion || this.currentVersion() };
    } finally {
      this.activeInvocations.delete(token);
    }
  }

  // The re-entrant host-call endpoint: the handler isolate's ctx host calls
  // land here (routed by the gateway using x-snapback-do-id). Reads and
  // buffering only — the commit happens after the handler settles. Never
  // behind the invocation mutex: the invocation holding the mutex progresses
  // through these calls.
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
    // Awaited: the action-only ops (host.fetch, action.runMutation) are
    // async — the external fetch runs OUTSIDE the invocation mutex on this
    // un-chained path, and runMutation reacquires the mutex itself.
    return json(200, await host.handle(op, args));
  }

  // --- query -------------------------------------------------------------

  async handleQuery(payload) {
    const result = await this.invokeHandler(payload.name, 'query', payload.args);
    if (!result.ok) return json(200, failure(result));
    return json(200, { ok: true, version: result.observedVersion ?? this.currentVersion(), rows: result.value });
  }

  // --- mutation + commit -------------------------------------------------

  async handleMutation(payload) {
    const result = await this.invokeHandler(payload.name, 'mutation', payload.args);
    if (!result.ok) return json(200, failure(result));
    const commit = this.commit(result.host);
    // Push from the commit path — no timer, no polling (LLP 0040 §Version
    // contract). Rehydrates subscriptions from storage first, so a woken or
    // freshly-evicted object still delivers. Awaited: floating work after the
    // response is not a delivery contract on real Workers (ENG-23576).
    await this.fanOut(commit);
    return json(200, { ok: true, version: commit.version, changedCount: commit.changes.length, result: result.value });
  }

  // Version allocation + row writes + journal append as ONE local
  // transaction (LLP 0007 gap-free visibility by construction). The version
  // advances only when the EFFECTIVE changeset is non-empty — a mutation
  // whose writes all degrade to no-ops (patch on a missing row, empty-values
  // patch, delete of a missing row) keeps the current version, matching
  // src/storage.rs (ENG-23583).
  commit(host) {
    if (host.writes.length === 0) {
      return { version: this.currentVersion(), changes: [] };
    }
    const nowMs = Date.now();
    const currentVersion = this.currentVersion();
    const nextVersion = currentVersion + 1;
    const changes = [];
    this.ctx.storage.transactionSync(() => {
      for (const write of host.writes) {
        const table = this.physicalTable(write.table);
        if (write.kind === 'insert') {
          const row = { _id: write.id, _version: nextVersion, _createdAt: nowMs, _updatedAt: nowMs, ...write.values };
          this.sql.exec(`INSERT INTO ${table} (id, row_json) VALUES (?, ?)`, write.id, JSON.stringify(row));
          this.recordChange(nextVersion, write.table, write.id, 'insert', row, nowMs);
          changes.push({ table: write.table, id: write.id, op: 'insert' });
        } else if (write.kind === 'patch') {
          // Empty-values patches are no-ops on the local target
          // (src/storage.rs); they must not journal or advance the version
          // here either.
          if (Object.keys(write.values).length === 0) continue;
          const existing = this.readRow(table, write.id);
          if (existing) {
            const row = { ...existing, ...write.values, _id: write.id, _version: nextVersion, _updatedAt: nowMs };
            this.sql.exec(`UPDATE ${table} SET row_json = ? WHERE id = ?`, JSON.stringify(row), write.id);
            this.recordChange(nextVersion, write.table, write.id, 'patch', row, nowMs);
            changes.push({ table: write.table, id: write.id, op: 'patch' });
          }
        } else if (write.kind === 'delete') {
          // A delete of a missing row is a no-op change-wise, as on the local
          // target (delete_document returns false → nothing journaled).
          const existing = this.readRow(table, write.id);
          if (existing) {
            this.sql.exec(`DELETE FROM ${table} WHERE id = ?`, write.id);
            this.recordChange(nextVersion, write.table, write.id, 'delete', null, nowMs);
            changes.push({ table: write.table, id: write.id, op: 'delete' });
          }
        }
      }
      if (changes.length > 0) {
        this.sql.exec('UPDATE _snapback_version SET version = ? WHERE id = 1', nextVersion);
        // Bounded journal (delta consumers beyond the retention window get a
        // resync, not unbounded storage growth).
        this.sql.exec(
          'DELETE FROM _snapback_changes WHERE version <= ?',
          nextVersion - CHANGE_JOURNAL_RETAIN_VERSIONS
        );
      }
    });
    return { version: changes.length > 0 ? nextVersion : currentVersion, changes };
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

  // --- kit wire protocol handlers (LLP 0049 Phase 0) ----------------------

  // Fail-closed connection-token gate for connection-scoped kit operations.
  // Returns a diagnostic Response when denied, null when the grant is valid —
  // the same code the kit client keys its grant-refresh recovery on.
  verifyConnection(connectionId, presentedToken) {
    if (!connectionId || typeof connectionId !== 'string') {
      return kitError(400, 'SNAPBACK_CONNECTION_ID_REQUIRED', 'a connection id is required');
    }
    const stored = this.readConnectionToken(connectionId);
    if (!stored || !presentedToken || presentedToken !== stored) {
      return kitError(
        401,
        'SNAPBACK_CONNECTION_TOKEN_INVALID',
        'connection-scoped operations require the connection token issued by POST /connection/open'
      );
    }
    return null;
  }

  readConnectionToken(connectionId) {
    for (const record of this.sql.exec(
      'SELECT token FROM _snapback_connections WHERE connection_id = ?',
      connectionId
    )) {
      return String(record.token);
    }
    return null;
  }

  // POST /connection/open (ENG-23442 shape): adopt the caller's readable id
  // when it is free or when the caller presents the id's current token (the
  // idempotent re-open a restarted client performs); mint a fresh wire id on
  // a collision with a live grant so one browser tab can never hijack
  // another's subscriptions.
  kitOpenConnection(payload) {
    const suggested = typeof payload.connectionId === 'string' && payload.connectionId.length > 0
      ? payload.connectionId
      : `conn_${crypto.randomUUID()}`;
    const previousToken = typeof payload.previousToken === 'string' ? payload.previousToken : null;
    const stored = this.readConnectionToken(suggested);
    if (stored && previousToken === stored) {
      return json(200, { connectionId: suggested, connectionToken: stored });
    }
    const connectionId = stored ? `conn_${crypto.randomUUID()}` : suggested;
    const token = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO _snapback_connections (connection_id, token, opened_at_ms) VALUES (?, ?, ?)
       ON CONFLICT(connection_id) DO UPDATE SET token = excluded.token, opened_at_ms = excluded.opened_at_ms`,
      connectionId,
      token,
      Date.now()
    );
    return json(200, { connectionId, connectionToken: token });
  }

  // POST /app/ensure (LLP 0034 §5 semantics, Cloudflare projection): app code
  // is deploy-time compiled, so provisioning different artifacts is
  // impossible — a hash match reports 'matched', a mismatch reports 'gated'
  // (the honest "this profile cannot provision what you posted"), and the
  // seed half seeds only when every seed target table is empty.
  kitEnsureApp(payload) {
    const posted = payload || {};
    const schemaState = !posted.schema
      ? 'skipped-absent'
      : posted.schema.schemaHash === APP_SCHEMA_HASH
        ? 'matched'
        : 'gated';
    const functionsState = !posted.functions
      ? 'skipped-absent'
      : posted.functions.bundleHash === APP_BUNDLE_HASH
        ? 'matched'
        : 'gated';
    let seedState = 'skipped-absent';
    const seedSource = posted.seed || appSeed;
    if (seedSource && schemaState !== 'gated' && functionsState !== 'gated') {
      seedState = this.seedIfEmpty(seedSource) ? 'seeded' : 'skipped-nonempty';
    }
    return json(200, {
      schema: schemaState,
      functions: functionsState,
      seed: seedState,
      profile: 'cloudflare-do-sqlite-v8',
    });
  }

  // Host-side deterministic seeding (LLP 0049 Phase 0): seed rows carry
  // explicit ids (the demo's generated seed.json), inserted in one local
  // transaction at version 1 — mutation handlers address these rows by
  // stable id (patch-shaped upserts), so the seed is the schema's ground
  // state, not an app mutation.
  seedIfEmpty(seedSource) {
    const tables = (seedSource && seedSource.tables) || {};
    const names = Object.keys(tables).filter((name) => APP_TABLES.has(name));
    if (names.length === 0) return false;
    for (const name of names) {
      for (const record of this.sql.exec(`SELECT COUNT(*) AS count FROM ${this.physicalTable(name)}`)) {
        if (Number(record.count) > 0) return false;
      }
    }
    const nowMs = Date.now();
    this.ctx.storage.transactionSync(() => {
      for (const name of names) {
        const physical = this.physicalTable(name);
        for (const row of tables[name]) {
          const id = String(row._id || this.newId());
          const stored = { ...row, _id: id, _version: 1, _createdAt: nowMs, _updatedAt: nowMs };
          this.sql.exec(`INSERT INTO ${physical} (id, row_json) VALUES (?, ?)`, id, JSON.stringify(stored));
        }
      }
      const current = this.currentVersion();
      if (current < 1) {
        this.sql.exec('UPDATE _snapback_version SET version = 1 WHERE id = 1');
      }
    });
    return true;
  }

  // POST /query/:name — the kit's QueryOutput shape { version, rows }.
  async kitQuery(name, payload) {
    const result = await this.invokeHandler(name, 'query', (payload && payload.args) || {});
    if (!result.ok) return kitFailure(result);
    return json(200, { version: result.observedVersion ?? this.currentVersion(), rows: result.value });
  }

  // POST /mutation/:name — the kit's MutationOutput shape
  // { version, changed_count, result }.
  async kitMutation(name, payload) {
    const result = await this.invokeHandler(name, 'mutation', (payload && payload.args) || {});
    if (!result.ok) return kitFailure(result);
    const commit = this.commit(result.host);
    await this.fanOut(commit);
    return json(200, { version: commit.version, changed_count: commit.changes.length, result: result.value });
  }

  // POST /live/:name/subscribe — snapshot-with-subscribe under the invocation
  // mutex (the ENG-23575 rationale: the snapshot, the version read, and the
  // registry insert must not interleave with a commit). The registry row is
  // keyed by the granted connection id, so a kit socket for that connection
  // receives this subscription's fan-out.
  async kitSubscribe(name, payload) {
    const fn = this.functionByName(name);
    if (!fn || fn.kind !== 'LiveQuery') {
      return kitError(400, 'SNAPBACK_LIVE_NOT_A_LIVE_QUERY', `${name} is not a live query`);
    }
    const args = (payload && payload.input && payload.input.args) || {};
    const result = await this.invokeHandler(name, 'query', args);
    if (!result.ok) return kitFailure(result);
    const version = result.observedVersion ?? this.currentVersion();
    const argsJson = canonicalJson(args);
    const connectionId = payload.connection_id;
    if (payload.supersedes) {
      this.sql.exec(
        'DELETE FROM _snapback_subscriptions WHERE subscription_id = ? AND connection_id = ?',
        String(payload.supersedes),
        connectionId
      );
    }
    this.sql.exec(
      `INSERT INTO _snapback_subscriptions (subscription_id, connection_id, function_name, args_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(connection_id, function_name, args_json) DO NOTHING`,
      `sub_${crypto.randomUUID()}`,
      connectionId,
      name,
      argsJson
    );
    let subscriptionId = null;
    for (const record of this.sql.exec(
      'SELECT subscription_id FROM _snapback_subscriptions WHERE connection_id = ? AND function_name = ? AND args_json = ?',
      connectionId,
      name,
      argsJson
    )) {
      subscriptionId = String(record.subscription_id);
    }
    // Subscribe arms the demand-gated warm poll (LLP 0049 Phase 3).
    await this.reconcileCronActivation();
    return json(200, {
      subscription_id: subscriptionId,
      snapshot: { version, rows: result.value },
      permission_epochs: {},
    });
  }

  async kitUnsubscribe(payload) {
    this.sql.exec(
      'DELETE FROM _snapback_subscriptions WHERE subscription_id = ? AND connection_id = ?',
      String(payload.subscription_id || ''),
      String(payload.connection_id || '')
    );
    // Last-unsubscribe cancels the warm-poll alarm (LLP 0049 Phase 3).
    await this.reconcileCronActivation();
    return json(200, { removed: true });
  }

  // GET /live/:connectionId/stream — the kit's managed shared socket. The
  // token gate runs BEFORE the upgrade (browser WebSockets cannot set
  // headers, so the token rides the `snapback.connection-token.<token>`
  // subprotocol or the query string), and the accepted socket echoes
  // `snapback.v1` — a browser fails the connection when it offered
  // subprotocols and the server echoed none.
  acceptKitSocket(request, connectionId, url) {
    if (request.headers.get('upgrade') !== 'websocket') {
      return kitError(426, 'SNAPBACK_UPGRADE_REQUIRED', 'expected websocket upgrade');
    }
    const protocols = (request.headers.get('sec-websocket-protocol') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const tokenProtocol = protocols.find((value) => value.startsWith('snapback.connection-token.'));
    const presented =
      request.headers.get('x-snapback-connection-token') ||
      url.searchParams.get('connection_token') ||
      (tokenProtocol ? tokenProtocol.slice('snapback.connection-token.'.length) : null);
    const denied = this.verifyConnection(connectionId, presented);
    if (denied) return denied;
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [connectionId]);
    server.serializeAttachment({ connectionId, protocol: 'kit' });
    const headers = protocols.includes('snapback.v1') ? { 'sec-websocket-protocol': 'snapback.v1' } : undefined;
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  // --- live subscriptions ------------------------------------------------

  acceptLiveSocket(request) {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const connectionId = crypto.randomUUID();
    // Hibernation API: acceptWebSocket (NOT server.accept()) so the object can
    // be evicted while holding the socket (LLP 0040 §Hibernation). The
    // per-socket attachment carries only connection identity (≤16 KB) — the
    // subscription registry lives in SQLite.
    this.ctx.acceptWebSocket(server, [connectionId]);
    server.serializeAttachment({ connectionId, protocol: 'proof' });
    return new Response(null, { status: 101, webSocket: client });
  }

  connectionIdFor(ws) {
    const attachment = ws.deserializeAttachment();
    return attachment && attachment.connectionId;
  }

  socketProtocolFor(ws) {
    const attachment = ws.deserializeAttachment();
    // Sockets accepted before the kit protocol existed carry no tag; they are
    // proof-protocol by construction.
    return (attachment && attachment.protocol) || 'proof';
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
      // Under the invocation mutex: the snapshot query, the version read, and
      // the registry insert must not interleave with a commit, or the rows
      // the snapshot carried predate a commit whose fan-out never saw the
      // registration — a silently skipped delta (ENG-23575).
      await this.runExclusive(() => this.subscribe(ws, connectionId, parsed));
      await this.reconcileCronActivation();
    } else if (parsed.type === 'unsubscribe') {
      this.sql.exec('DELETE FROM _snapback_subscriptions WHERE subscription_id = ?', parsed.subscriptionId);
      await this.reconcileCronActivation();
    } else if (parsed.type === 'ping') {
      // The kit heartbeat expects the local server's `kind` field (any frame
      // refreshes its freshness budget); the proof protocol pins `type`.
      if (this.socketProtocolFor(ws) === 'kit') {
        ws.send(JSON.stringify({ kind: 'pong', requestId: parsed.requestId }));
      } else {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
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
    const result = await this.invokeHandler(parsed.name, 'query', parsed.args);
    if (!result.ok) {
      ws.send(JSON.stringify({ type: 'error', code: result.code, message: result.message }));
      return;
    }
    const version = result.observedVersion ?? this.currentVersion();
    const argsJson = canonicalJson(parsed.args || {});
    // Subscription identity is (connection, function, args) — a re-subscribe
    // from React StrictMode or a client retry reuses the existing row and id
    // instead of double-registering (the UNIQUE constraint above).
    this.sql.exec(
      `INSERT INTO _snapback_subscriptions (subscription_id, connection_id, function_name, args_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(connection_id, function_name, args_json) DO NOTHING`,
      `sub_${crypto.randomUUID()}`,
      connectionId,
      parsed.name,
      argsJson
    );
    let subscriptionId = null;
    for (const record of this.sql.exec(
      'SELECT subscription_id FROM _snapback_subscriptions WHERE connection_id = ? AND function_name = ? AND args_json = ?',
      connectionId,
      parsed.name,
      argsJson
    )) {
      subscriptionId = String(record.subscription_id);
    }
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
  // that is correct across eviction because the registry is durable. Awaited
  // by the mutation path: every push settles (or records its failure) before
  // the mutation response returns (ENG-23576).
  async fanOut(commit) {
    if (commit.changes.length === 0) return;
    const changedTables = new Set(commit.changes.map((change) => change.table));
    const affectedFunctions = new Set(
      functions
        .filter((fn) => fn.kind === 'LiveQuery')
        .filter((fn) => functionTables(fn).some((table) => changedTables.has(table)))
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
    const groups = new Map();
    for (const sub of subs) {
      if (!affectedFunctions.has(sub.function_name)) continue;
      const ws = byConnection.get(sub.connection_id);
      if (!ws) continue;
      const key = `${sub.function_name}\0${sub.args_json}`;
      let group = groups.get(key);
      if (!group) {
        group = { functionName: String(sub.function_name), argsJson: String(sub.args_json), members: [] };
        groups.set(key, group);
      }
      group.members.push({
        ws,
        subscriptionId: String(sub.subscription_id),
        protocol: this.socketProtocolFor(ws),
      });
    }
    const pushes = [];
    for (const group of groups.values()) {
      // A woken object may have no live HostContext; re-run the query through
      // a fresh query invocation and share the result across identical
      // subscription shapes.
      pushes.push(this.pushReplaceGroup(group));
    }
    await Promise.all(pushes);
  }

  async pushReplaceGroup(group) {
    try {
      const result = await this.invokeHandler(group.functionName, 'query', JSON.parse(group.argsJson));
      if (!result.ok) {
        console.warn('snapback fan-out query failed', group.functionName, result.code);
        return;
      }
      const version = result.observedVersion ?? this.currentVersion();
      for (const member of group.members) {
        // Per-member isolation: one dead socket (a hibernation socket can
        // race its close event) must not suppress delivery to the rest of
        // the group.
        try {
          // Frame shape follows the socket's wire protocol: the kit client
          // consumes the local server's snake_case `kind` frames; the proof
          // acceptance suite pins the original camelCase `type` frames.
          const frame =
            member.protocol === 'kit'
              ? {
                  kind: 'live_replace',
                  subscription_id: member.subscriptionId,
                  function: group.functionName,
                  version,
                  rows: result.value,
                }
              : {
                  type: 'live_replace',
                  subscriptionId: member.subscriptionId,
                  function: group.functionName,
                  version,
                  rows: result.value,
                };
          member.ws.send(JSON.stringify(frame));
        } catch (error) {
          console.warn('snapback fan-out send failed', member.subscriptionId, String(error));
        }
      }
    } catch (error) {
      // Diagnostics, never control flow: a failed push must not fail the
      // committed mutation. A dead socket is pruned by the disconnect handler.
      console.warn('snapback fan-out push failed', group.functionName, String(error));
    }
  }

  async webSocketClose(ws) {
    const connectionId = this.connectionIdFor(ws);
    if (connectionId) {
      this.sql.exec('DELETE FROM _snapback_subscriptions WHERE connection_id = ?', connectionId);
      // A departing socket may have been the last live subscriber: cancel
      // the warm-poll alarm so the idle object hibernates with zero wakeups.
      await this.reconcileCronActivation();
    }
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }

  async reset() {
    this.sql.exec('DELETE FROM _snapback_changes');
    this.sql.exec('UPDATE _snapback_version SET version = 0 WHERE id = 1');
    this.sql.exec('DELETE FROM _snapback_subscriptions');
    // App-state reset also resets cron runtime state (claims + ledger) and
    // disarms via the reconcile below; configured secrets and rotation
    // cursors are deployment config and deliberately survive.
    this.sql.exec('DELETE FROM _snapback_cron_claims');
    this.sql.exec('DELETE FROM _snapback_cron_state');
    for (const table of schema.tables) {
      this.sql.exec(`DELETE FROM ${this.physicalTable(table.name)}`);
    }
    // A reset empties the persistent state, so this deployment's metadata is
    // now authoritative — recover from a stale-artifact refusal.
    this.writeDeploymentMetadata();
    this.startupError = null;
    // Bundles that ship deterministic seed data (All Aboard) return to the
    // seeded ground state — the local reset(seed) semantics; the notes
    // fixture (seed: null) keeps its start-empty reset.
    let seeded = false;
    if (appSeed) {
      seeded = this.seedIfEmpty(appSeed);
    }
    // Subscriptions and cron state are gone: drop any armed object alarm.
    await this.reconcileCronActivation();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const frame =
          this.socketProtocolFor(ws) === 'kit'
            ? { kind: 'resync_required', reason: 'reset' }
            : { type: 'resync_required', reason: 'reset' };
        ws.send(JSON.stringify(frame));
      } catch (_) {}
    }
    return json(200, { reset: true, seeded });
  }
}

// A stale-deployment refusal (SNAPBACK_STALE_CLOUDFLARE_*): served on every
// data-plane request until the operator resets or migrates, never silently
// served over mismatched persistent state.
function staleArtifact(code, message, details) {
  return { ok: false, code, message, details };
}

function functionTables(fn) {
  if (Array.isArray(fn.tables) && fn.tables.length > 0) return fn.tables;
  return [schema.tables[0].name];
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value ?? {}));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJson(value[key]);
  }
  return sorted;
}

function failure(result) {
  const body = { ok: false, code: result.code, message: result.message };
  if (result.details) body.details = result.details;
  return body;
}

// Kit-protocol errors carry the local server's ApiError envelope — a non-2xx
// status with a structured `diagnostic` — which demos/_kit/client.mjs turns
// into its coded Error (and keys grant refresh on).
function kitError(status, code, message) {
  return json(status, { diagnostic: { code, message } });
}

function kitFailure(result) {
  const body = { diagnostic: { code: result.code, message: result.message } };
  if (result.details) body.diagnostic.details = result.details;
  return json(500, body);
}

function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}
