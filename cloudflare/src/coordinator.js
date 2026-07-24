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

import { HostContext, physicalIndexName, physicalTableName, validateWriteValues } from './host-ops.js';
import { nextNominalAfter } from './cron-utils.js';
import { SUBSCRIPTION_LIMITS, SUBSCRIPTION_TEST_CEILINGS } from './limits.js';
import { compileSubscriptionSelection, SUBSCRIPTION_FUNCTION_INDEX } from './subscription-selection.js';
import {
  DEFAULT_MAX_PENDING_INVOCATIONS,
  classifyHandlerPlatformFailure,
  classifyPlatformError,
  overloadedFailure,
  platformFailureError,
  platformFailureResponse,
  valueTooLargeFailure,
} from './platform-errors.js';
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
  capabilityManifest,
  schema,
  functions,
  seed as appSeed,
  config as appConfig,
  cron as appCron,
  deploymentIdentity,
} from 'snapback-app';

const APP_SCHEMA_HASH = schema.schemaHash;
const APP_BUNDLE_HASH = bundleHash;
const APP_TABLES = new Set(schema.tables.map((table) => table.name));
const APP_SCHEMA_TABLES = new Map(schema.tables.map((table) => [table.name, table]));
const CHANGE_JOURNAL_RETAIN_VERSIONS = 1000;
const MAX_ROW_BYTES = Number(capabilityManifest.runtimeFacts.maxRowBytes);
const MAX_REQUEST_BYTES = Math.max(4_000_000, MAX_ROW_BYTES * 2);
const MAX_HOST_RESPONSE_BYTES = 1_000_000;
// The closed v1 target-capability registry (LLP 0058; nine ids). Only ids
// this registry knows participate in admission: an unknown string is a
// grammar problem for codegen, never silent target authority.
const KNOWN_TARGET_CAPABILITY_IDS = new Set([
  'auth.sessions.v1',
  'bounded_response_stream_v1',
  'cron',
  'cron_action_run_mutation',
  'host_plan_runtime',
  'ibex_ctx_db_host_bridge',
  'live_subscriptions',
  'mutation_read_set_validation',
  'permission_epoch_resync',
]);
const SUPPORTED_TARGET_CAPABILITIES = new Set(capabilityManifest.supportedCapabilities || []);
const ACTION_STREAM_TOTAL_BYTES_MAX = 1024 * 1024;
const ACTION_STREAM_BUFFER_BYTES_MAX = 64 * 1024;
const ACTION_STREAM_CHUNK_BYTES_MAX = 16 * 1024;
const ACTION_STREAM_WALL_MS = 30_000;
const ACTION_STREAM_IDLE_MS = 5_000;
const ACTION_STREAM_OPEN_MAX = 4;
const DEFAULT_ACTION_TIMEOUT_MS = 30_000;
const MAX_ACTION_TIMEOUT_MS = 15 * 60 * 1000;
const SUBSCRIPTION_SCHEMA_VERSION = 3;
const CRON_CLAIM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CONNECTION_GRANT_LIMIT = 1024;
const MAX_CONNECTION_GRANT_LIMIT = 4096;
const DEFAULT_CONNECTION_GRANT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONNECTION_OPEN_RATE_PER_MINUTE = 120;
const MAX_CONNECTION_ID_BYTES = 128;
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const UTF8_ENCODER = new TextEncoder();
const MAX_LIVE_SOCKET_FRAME_BYTES = 64 * 1024;
const MAX_CRON_DIAGNOSTIC_BYTES = 1024;
const CRON_STATUS_RESPONSE_HEADERS = Object.freeze({
  'cache-control': 'private, no-store',
  vary: 'x-snapback-admin-token',
});
// Public cron status is deliberately a closed classification surface. The
// retained/operator diagnostic may carry scrubbed bounded detail, but
// arbitrary handler or exception text must never mint a new code.
const PUBLIC_CRON_ERROR_CODES = new Set([
  'SNAPBACK_ACTION_MUTATION_UNKNOWN',
  'SNAPBACK_ACTION_RATE_LIMITED',
  'SNAPBACK_ACTION_REPLAY_DIVERGED',
  'SNAPBACK_ACTION_RESET_ABORTED',
  'SNAPBACK_ACTION_TIMEOUT',
  'SNAPBACK_ACTION_UNKNOWN',
  'SNAPBACK_FUNCTION_KIND_MISMATCH',
]);
const FAN_OUT_FAILURE_CODES = Object.freeze([
  'SNAPBACK_LIVE_FANOUT_QUERY_FAILED',
  'SNAPBACK_LIVE_FANOUT_SERIALIZATION_FAILED',
  'SNAPBACK_LIVE_FANOUT_SEND_FAILED',
  'SNAPBACK_LIVE_FANOUT_INTERNAL_FAILED',
]);

export class Coordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    // Live invocations keyed by host-call token, so a re-entrant /host-call
    // (routed back from the handler isolate) finds its HostContext. Purely
    // in-memory and request-scoped: nothing across eviction depends on it.
    this.activeInvocations = new Map();
    // The invocation mutex (ENG-23575): queue each invocation-bearing request
    // so handler execution + commit + fan-out (and subscription snapshot +
    // registration) are one critical section each. The tail returns to null
    // when idle instead of becoming a permanent cross-request Promise chain;
    // the old chain inherited request context until Cloudflare's service-
    // binding depth limit surfaced under parallel bursts (ENG-23849).
    this.invocationTail = null;
    this.pendingInvocations = 0;
    this.maxPendingInvocations = configuredPendingInvocationLimit(env);
    // Fresh per in-memory instance, never persisted: lets a remote client
    // observe a real platform eviction (the marker changes across a quiet
    // window) — the LLP 0040 decisive-evidence run reads it off /health.
    this.bootMarker = crypto.randomUUID();
    this.startupError = null;
    this.testCronStopAfterClaimRemaining = env.SNAPBACK_TEST_CRON_STOP_AFTER_CLAIM === '1' ? 1 : 0;
    this.testCronInterruptDuringActionRemaining = env.SNAPBACK_TEST_CRON_INTERRUPT_DURING_ACTION === '1' ? 1 : 0;
    this.testCronStopBeforeFinishRemaining = env.SNAPBACK_TEST_CRON_STOP_BEFORE_FINISH === '1' ? 1 : 0;
    this.testCronStopAfterTerminalUpdateRemaining =
      env.SNAPBACK_TEST_CRON_STOP_AFTER_TERMINAL_UPDATE === '1' ? 1 : 0;
    this.testFanOutQueryFailuresRemaining = configuredTestFailureCount(env.SNAPBACK_TEST_FANOUT_QUERY_FAILURES, env);
    this.testFanOutSerializationFailuresRemaining = configuredTestFailureCount(
      env.SNAPBACK_TEST_FANOUT_SERIALIZATION_FAILURES,
      env
    );
    this.testFanOutSendFailuresRemaining = configuredTestFailureCount(env.SNAPBACK_TEST_FANOUT_SEND_FAILURES, env);
    this.fanOutFailureCounters = Object.fromEntries(FAN_OUT_FAILURE_CODES.map((code) => [code, 0]));
    this.testSocketLimitOverrides = null;
    this.initializeSchema();
    // Hibernated sockets survive Worker deployments. Reconcile pre-cap state
    // at construction as well as on HTTP requests so a socket-originated wake
    // cannot keep an old over-limit registry alive indefinitely.
    this.socketLimitError = this.reconcileAcceptedSocketBounds();
  }

  // Serialize `task` behind every previously queued invocation. Bound the
  // accepted queue below Cloudflare's request-chain limit so excess work gets
  // a stable retryable result instead of a late platform exception. Failures
  // propagate to the caller but never poison the tail.
  runExclusive(task) {
    if (this.pendingInvocations >= this.maxPendingInvocations) {
      return Promise.reject(
        platformFailureError(
          overloadedFailure({
            reason: 'coordinator_admission_limit',
            pendingInvocations: this.pendingInvocations,
            maxPendingInvocations: this.maxPendingInvocations,
          })
        )
      );
    }

    this.pendingInvocations += 1;
    let run;
    if (this.invocationTail === null) {
      // Invoke directly in the new request's context whenever the mutex was
      // idle. Promise.resolve().then(task) would create another inherited
      // continuation — the failure mode measured in LLP 0050.
      try {
        run = Promise.resolve(task());
      } catch (error) {
        run = Promise.reject(error);
      }
    } else {
      run = this.invocationTail.then(() => task());
    }
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    this.invocationTail = settled;
    return run.finally(() => {
      this.pendingInvocations -= 1;
      if (this.invocationTail === settled) this.invocationTail = null;
    });
  }

  // Startup is intentionally two-phase. The metadata table is the only DDL
  // allowed before deployment identity and system-schema versions have been
  // inspected. In particular, a newly-declared UNIQUE index must not throw in
  // the constructor before /health can explain the stale deployment and
  // authenticated /reset can rebuild it.
  initializeSchema() {
    try {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS _snapback_meta (key TEXT PRIMARY KEY, value TEXT)`);
      this.startupError =
        this.validateDeploymentMetadata() ||
        this.validateSubscriptionsSchemaVersion() ||
        // Legacy v0-v2 registries can predate all hosted subscription caps.
        // Refuse over-limit common rows before migrateSubscriptionsSchema()
        // performs its copy; health/reset must remain available even when the
        // old table is far too large to migrate safely.
        this.validatePersistedSubscriptionBounds();
    } catch (error) {
      // Foundational table drift must not prevent the Durable Object from
      // constructing. /health explains the refusal and authenticated /reset
      // rebuilds the owned schema even when readMeta()/currentVersion() cannot
      // interpret an unknown future layout.
      this.startupError = staleArtifact(
        (error && error.snapbackCode) || 'SNAPBACK_CLOUDFLARE_FOUNDATION_SCHEMA_INVALID',
        'the durable metadata/version schema is incompatible; inspect health and reset or migrate before serving this deployment',
        { cause: String((error && error.message) || error) }
      );
      return;
    }
    if (this.startupError) return;
    try {
      this.ensureCurrentSchema();
      this.startupError = this.validatePersistedSubscriptionBounds();
      if (this.startupError) return;
      this.writeDeploymentMetadata();
    } catch (error) {
      this.startupError = staleArtifact(
        (error && error.snapbackCode) || 'SNAPBACK_CLOUDFLARE_SCHEMA_RECONCILIATION_FAILED',
        'the durable schema could not be reconciled; inspect health and reset or migrate before serving this deployment',
        { cause: String((error && error.message) || error) }
      );
    }
  }

  ensureCurrentSchema() {
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
    // Fixed-cardinality post-commit delivery diagnostics. The code set is
    // closed in FAN_OUT_FAILURE_CODES, so a failing stream cannot create an
    // unbounded label/key space. Recording is best effort and never changes
    // the already-committed mutation outcome.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_fanout_diagnostics (
         code TEXT PRIMARY KEY,
         count INTEGER NOT NULL,
         last_at_ms INTEGER NOT NULL
       )`
    );
    // Storage-backed subscription registry (one-way door 4): query identity,
    // args, and connection id — rehydrated lazily on wake. In-memory
    // registries die at eviction while their sockets live on. The identity
    // uniqueness is the idempotence contract for React StrictMode/retry paths.
    // Connection grants for the kit wire protocol (ENG-23442 shape): ids are
    // server-granted capabilities paired with a bearer token. Durable, so a
    // grant survives eviction/hibernation exactly like the subscriptions
    // that reference it.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_connections (
         connection_id TEXT PRIMARY KEY,
         token TEXT NOT NULL,
         opened_at_ms INTEGER NOT NULL,
         socket_session_id TEXT
       )`
    );
    this.ensureColumn('_snapback_connections', 'socket_session_id', 'TEXT');
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_connection_admission (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         window_started_at_ms INTEGER NOT NULL,
         count INTEGER NOT NULL
       )`
    );
    const hadSubscriptions = this.tableExists('_snapback_subscriptions');
    if (!hadSubscriptions) {
      this.createSubscriptionsTable('_snapback_subscriptions');
      this.writeMeta('subscriptions_schema_version', String(SUBSCRIPTION_SCHEMA_VERSION));
    } else {
      this.migrateSubscriptionsSchema();
    }
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS ${SUBSCRIPTION_FUNCTION_INDEX} ON _snapback_subscriptions (function_name)`
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
         last_error_code TEXT,
         last_error TEXT,
         last_finished_at_ms INTEGER
       )`
    );
    this.ensureColumn('_snapback_cron_state', 'last_error_code', 'TEXT');
    this.migrateCronDiagnostics();
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_cron_claims (
         idempotency_key TEXT PRIMARY KEY,
         job_name TEXT NOT NULL,
         scheduled_at_ms INTEGER NOT NULL,
         run_id TEXT NOT NULL,
         claimed_at_ms INTEGER NOT NULL,
         state TEXT NOT NULL,
         lease_expires_at_ms INTEGER,
         attempt INTEGER NOT NULL DEFAULT 1
       )`
    );
    this.ensureColumn('_snapback_cron_claims', 'lease_expires_at_ms', 'INTEGER');
    this.ensureColumn('_snapback_cron_claims', 'attempt', 'INTEGER NOT NULL DEFAULT 1');
    this.sql.exec('CREATE INDEX IF NOT EXISTS idx_snapback_cron_claims_job ON _snapback_cron_claims (job_name, scheduled_at_ms)');
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_action_limits (
         action_name TEXT PRIMARY KEY,
         window_started_at_ms INTEGER NOT NULL,
         count INTEGER NOT NULL
      )`
    );
    // @ref LLP 0028#scheduler-state-and-run-ledger — stable scheduled
    // idempotency reaches each nested mutation's commit transaction.
    // Stable results for nested mutations issued by retryable scheduled
    // actions. The row is inserted in the SAME transaction as the mutation
    // commit, closing the crash-after-commit/before-cron-finish gap: a retry
    // replays the prior result instead of committing the mutation twice.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS _snapback_action_mutation_results (
         action_idempotency_key TEXT NOT NULL,
         sequence INTEGER NOT NULL,
         mutation_name TEXT NOT NULL,
         args_json TEXT NOT NULL,
         result_json TEXT NOT NULL,
         commit_version INTEGER NOT NULL,
         PRIMARY KEY (action_idempotency_key, sequence)
       )`
    );
    for (const table of schema.tables) {
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS ${this.physicalTable(table.name)} (id TEXT PRIMARY KEY, row_json TEXT NOT NULL)`
      );
      this.ensureDeclaredIndexes(table);
    }
  }

  createSubscriptionsTable(name) {
    this.sql.exec(
      `CREATE TABLE ${name} (
         subscription_id TEXT PRIMARY KEY,
         connection_id TEXT NOT NULL,
         function_name TEXT NOT NULL,
         args_json TEXT NOT NULL,
         socket_session_id TEXT,
         UNIQUE(connection_id, function_name, args_json)
       )`
    );
  }

  validateSubscriptionsSchemaVersion() {
    if (!this.tableExists('_snapback_subscriptions')) return null;
    const raw = this.readMeta('subscriptions_schema_version');
    if (raw == null) return null; // legacy v0 is a known migration source
    if (!/^[0-9]+$/.test(raw) || Number(raw) > SUBSCRIPTION_SCHEMA_VERSION) {
      return staleArtifact(
        'SNAPBACK_SUBSCRIPTION_SCHEMA_UNSUPPORTED',
        'the durable subscription registry has an unknown schema version; reset or migrate before serving it',
        { expectedAtMost: SUBSCRIPTION_SCHEMA_VERSION, actual: raw }
      );
    }
    return null;
  }

  migrateSubscriptionsSchema() {
    const current = Number(this.readMeta('subscriptions_schema_version') || 0);
    if (current === SUBSCRIPTION_SCHEMA_VERSION) {
      if (!this.tableHasColumn('_snapback_subscriptions', 'socket_session_id')) {
        throw codedError(
          'SNAPBACK_SUBSCRIPTION_SCHEMA_INVALID',
          `subscription schema v${SUBSCRIPTION_SCHEMA_VERSION} is missing socket_session_id`
        );
      }
      return;
    }
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DROP TABLE IF EXISTS _snapback_subscriptions_next');
      this.testSubscriptionMigrationFault('after-drop-next');
      this.createSubscriptionsTable('_snapback_subscriptions_next');
      this.testSubscriptionMigrationFault('after-create-next');
      this.sql.exec(
        `INSERT OR IGNORE INTO _snapback_subscriptions_next
           (subscription_id, connection_id, function_name, args_json, socket_session_id)
         SELECT s.subscription_id, s.connection_id, s.function_name, s.args_json, c.socket_session_id
         FROM _snapback_subscriptions s
         LEFT JOIN _snapback_connections c ON c.connection_id = s.connection_id
         WHERE c.connection_id IS NULL OR c.socket_session_id IS NOT NULL
         ORDER BY subscription_id`
      );
      this.testSubscriptionMigrationFault('after-copy');
      this.sql.exec('DROP TABLE _snapback_subscriptions');
      this.testSubscriptionMigrationFault('after-drop-source');
      this.sql.exec('ALTER TABLE _snapback_subscriptions_next RENAME TO _snapback_subscriptions');
      this.testSubscriptionMigrationFault('after-rename');
      this.sql.exec(
        `CREATE INDEX IF NOT EXISTS ${SUBSCRIPTION_FUNCTION_INDEX} ON _snapback_subscriptions (function_name)`
      );
      this.testSubscriptionMigrationFault('after-index');
      this.writeMeta('subscriptions_schema_version', String(SUBSCRIPTION_SCHEMA_VERSION));
      this.testSubscriptionMigrationFault('after-version');
    });
  }

  validatePersistedSubscriptionBounds() {
    if (!this.tableExists('_snapback_subscriptions')) return null;
    const columns = new Set(
      [...this.sql.exec('PRAGMA table_info(_snapback_subscriptions)')].map((record) => String(record.name))
    );
    const missingCommonColumns = ['subscription_id', 'connection_id', 'function_name', 'args_json'].filter(
      (column) => !columns.has(column)
    );
    if (missingCommonColumns.length > 0) {
      return staleArtifact(
        'SNAPBACK_SUBSCRIPTION_SCHEMA_INVALID',
        'the durable subscription registry is missing columns common to every supported schema version; reset or migrate before serving it',
        { missingColumns: missingCommonColumns }
      );
    }
    const globalLimit = this.subscriptionGlobalLimit();
    const globalCount = Number(
      [...this.sql.exec('SELECT COUNT(*) AS count FROM _snapback_subscriptions')][0]?.count || 0
    );
    if (globalCount > globalLimit) {
      return staleArtifact(
        'SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT_EXCEEDED',
        'the persisted subscription registry exceeds this deployment\'s enforced global limit; reset or migrate before serving it',
        { limit: globalLimit, actual: globalCount }
      );
    }
    const connectionLimit = this.subscriptionPerConnectionLimit();
    const oversizedConnections = [...this.sql.exec(
      `SELECT connection_id, COUNT(*) AS count FROM _snapback_subscriptions
       GROUP BY connection_id HAVING COUNT(*) > ? ORDER BY count DESC LIMIT 1`,
      connectionLimit
    )];
    if (oversizedConnections.length > 0) {
      return staleArtifact(
        'SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT_EXCEEDED',
        'a persisted connection exceeds this deployment\'s enforced subscription limit; reset or migrate before serving it',
        {
          connectionId: String(oversizedConnections[0].connection_id),
          limit: connectionLimit,
          actual: Number(oversizedConnections[0].count),
        }
      );
    }
    const argsLimit = this.subscriptionArgsBytesLimit();
    const oversizedRawArgs = [...this.sql.exec(
      `SELECT subscription_id, length(CAST(args_json AS BLOB)) AS actual_bytes
       FROM _snapback_subscriptions
       WHERE length(CAST(args_json AS BLOB)) > ?
       ORDER BY subscription_id LIMIT 1`,
      argsLimit
    )];
    if (oversizedRawArgs.length > 0) {
      return staleArtifact(
        'SNAPBACK_SUBSCRIPTION_ARGS_LIMIT_EXCEEDED',
        'a persisted subscription exceeds this deployment\'s enforced argument limit; reset or migrate before serving it',
        {
          subscriptionId: String(oversizedRawArgs[0].subscription_id),
          limitBytes: argsLimit,
          actualBytes: Number(oversizedRawArgs[0].actual_bytes),
        }
      );
    }
    for (const row of this.sql.exec('SELECT subscription_id, args_json FROM _snapback_subscriptions ORDER BY subscription_id')) {
      const raw = String(row.args_json);
      let canonical;
      try {
        canonical = canonicalJson(JSON.parse(raw));
      } catch (_) {
        return staleArtifact(
          'SNAPBACK_SUBSCRIPTION_ARGS_INVALID',
          'a persisted subscription carries invalid JSON arguments; reset or migrate before serving it',
          { subscriptionId: String(row.subscription_id) }
        );
      }
      const actualBytes = Math.max(UTF8_ENCODER.encode(raw).byteLength, UTF8_ENCODER.encode(canonical).byteLength);
      if (actualBytes > argsLimit) {
        return staleArtifact(
          'SNAPBACK_SUBSCRIPTION_ARGS_LIMIT_EXCEEDED',
          'a persisted subscription exceeds this deployment\'s enforced argument limit; reset or migrate before serving it',
          { subscriptionId: String(row.subscription_id), limitBytes: argsLimit, actualBytes }
        );
      }
    }
    return null;
  }

  testSubscriptionMigrationFault(step) {
    if (this.env.SNAPBACK_TESTING === '1' && this.testSubscriptionMigrationFailureAt === step) {
      throw codedError('SNAPBACK_TEST_SUBSCRIPTION_MIGRATION_FAILURE', `injected subscription migration failure at ${step}`);
    }
  }

  tableExists(name) {
    return [...this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", name)].length > 0;
  }

  ensureColumn(table, column, declaration) {
    const columns = [...this.sql.exec(`PRAGMA table_info(${table})`)];
    if (columns.some((record) => String(record.name) === column)) return;
    this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  }

  tableHasColumn(table, column) {
    if (!this.tableExists(table)) return false;
    return [...this.sql.exec(`PRAGMA table_info(${table})`)].some((record) => String(record.name) === column);
  }

  ensureDeclaredIndexes(table) {
    const fields = new Set((table.fields || []).map((field) => field.name));
    for (const index of table.indexes || []) {
      if (!index || !Array.isArray(index.fields) || index.fields.length === 0) {
        throw new Error(`SNAPBACK_SCHEMA_EMPTY_INDEX: ${table.name}.${index && index.name}`);
      }
      const expressions = index.fields.map((field) => {
        if (field !== '_id' && !fields.has(field)) {
          throw new Error(`SNAPBACK_UNKNOWN_FIELD: index ${table.name}.${index.name} references ${field}`);
        }
        return field === '_id' ? 'id' : `json_extract(row_json, '$.${field}')`;
      });
      const unique = index.unique ? 'UNIQUE ' : '';
      const name = physicalIndexName(table.name, index.name);
      const expectedSql = `CREATE ${unique}INDEX ${name} ON ${this.physicalTable(table.name)} (${expressions.join(', ')})`;
      let existingSql = null;
      for (const record of this.sql.exec("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?", name)) {
        existingSql = record.sql == null ? null : String(record.sql);
      }
      if (existingSql !== null && normalizeSqlDefinition(existingSql) !== normalizeSqlDefinition(expectedSql)) {
        this.sql.exec(`DROP INDEX ${name}`);
        existingSql = null;
      }
      if (existingSql === null) this.sql.exec(expectedSql);
    }
  }

  storageLayoutForTest() {
    let subscriptionRootPage = null;
    let temporaryTablePresent = false;
    for (const record of this.sql.exec(
      "SELECT name, rootpage FROM sqlite_master WHERE type = 'table' AND name IN ('_snapback_subscriptions', '_snapback_subscriptions_next')"
    )) {
      if (String(record.name) === '_snapback_subscriptions') subscriptionRootPage = Number(record.rootpage);
      if (String(record.name) === '_snapback_subscriptions_next') temporaryTablePresent = true;
    }
    let subscriptionCount = 0;
    for (const record of this.sql.exec('SELECT COUNT(*) AS count FROM _snapback_subscriptions')) {
      subscriptionCount = Number(record.count);
    }
    const indexes = [...this.sql.exec(
      "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )].map((record) => ({ name: String(record.name), table: String(record.tbl_name) }));
    return {
      subscriptionSchemaVersion: Number(this.readMeta('subscriptions_schema_version') || 0),
      subscriptionRootPage,
      subscriptionCount,
      temporaryTablePresent,
      indexes,
    };
  }

  indexPlanForTest(payload) {
    const table = APP_SCHEMA_TABLES.get(String(payload.table || ''));
    if (!table) return kitError(400, 'SNAPBACK_UNKNOWN_TABLE', `unknown table ${payload.table}`);
    const index = (table.indexes || []).find((entry) => entry.name === String(payload.index || ''));
    if (!index) return kitError(400, 'SNAPBACK_QUERY_UNKNOWN_INDEX', `unknown index ${table.name}.${payload.index}`);
    const field = index.fields[0];
    const expression = field === '_id' ? 'id' : `json_extract(row_json, '$.${field}')`;
    const details = [];
    for (const record of this.sql.exec(
      `EXPLAIN QUERY PLAN SELECT row_json FROM ${this.physicalTable(table.name)}
       INDEXED BY ${physicalIndexName(table.name, index.name)} WHERE ${expression} = ?`,
      payload.value == null ? '' : payload.value
    )) {
      details.push(String(record.detail || ''));
    }
    return json(200, { table: table.name, index: index.name, details });
  }

  schemaHardeningForTest(payload) {
    const operation = String(payload.operation || '');
    const indexedTable = schema.tables.find((table) => (table.indexes || []).length > 0) || null;
    const declaredIndex = indexedTable && indexedTable.indexes[0];
    const indexName = declaredIndex ? physicalIndexName(indexedTable.name, declaredIndex.name) : null;
    if (operation === 'corrupt-index') {
      if (!indexName) return json(400, { ok: false, code: 'SNAPBACK_TEST_INDEX_UNAVAILABLE' });
      this.sql.exec(`DROP INDEX IF EXISTS ${indexName}`);
      this.sql.exec(
        `CREATE UNIQUE INDEX ${indexName} ON ${this.physicalTable(indexedTable.name)}
           (id, json_extract(row_json, '$.${declaredIndex.fields[0]}'))`
      );
    } else if (operation === 'reconcile-index') {
      if (!indexedTable) return json(400, { ok: false, code: 'SNAPBACK_TEST_INDEX_UNAVAILABLE' });
      this.ensureDeclaredIndexes(indexedTable);
    } else if (operation === 'create-retired-table') {
      this.sql.exec('CREATE TABLE IF NOT EXISTS app_retired_fixture (id TEXT PRIMARY KEY, row_json TEXT NOT NULL)');
      this.sql.exec("INSERT OR REPLACE INTO app_retired_fixture (id, row_json) VALUES ('retired', '{\"secret\":true}')");
    } else if (operation === 'future-subscriptions') {
      this.writeMeta('subscriptions_schema_version', String(SUBSCRIPTION_SCHEMA_VERSION + 100));
      this.startupError = this.validateSubscriptionsSchemaVersion();
    } else if (operation === 'corrupt-foundation-meta') {
      this.sql.exec('DROP TABLE _snapback_meta');
      this.sql.exec('CREATE TABLE _snapback_meta (future_key TEXT PRIMARY KEY, future_value TEXT)');
      this.initializeSchema();
      return json(200, { ok: true, startupError: this.startupError });
    } else if (operation === 'corrupt-foundation-version') {
      this.sql.exec('DROP TABLE _snapback_version');
      this.sql.exec('CREATE TABLE _snapback_version (id INTEGER PRIMARY KEY, future_version INTEGER NOT NULL)');
      this.initializeSchema();
      return json(200, { ok: true, startupError: this.startupError });
    } else if (operation === 'reinitialize') {
      this.initializeSchema();
    } else if (operation === 'create-socketless-kit-orphan') {
      this.sql.exec(
        `INSERT OR REPLACE INTO _snapback_connections
           (connection_id, token, opened_at_ms, socket_session_id) VALUES ('orphan-kit', 'orphan-token', ?, NULL)`,
        Date.now()
      );
      this.sql.exec(
        `INSERT OR REPLACE INTO _snapback_subscriptions
           (subscription_id, connection_id, function_name, args_json, socket_session_id)
         VALUES ('orphan-sub', 'orphan-kit', ?, '{}', NULL)`,
        this.alarmJobs()[0]?.activation?.whileLive?.[0] || functions.find((fn) => fn.kind === 'LiveQuery')?.name || 'missing'
      );
    } else if (operation === 'insert-legacy-subscription') {
      this.sql.exec(
        `INSERT INTO _snapback_subscriptions
           (subscription_id, connection_id, function_name, args_json, socket_session_id)
         VALUES (?, ?, ?, ?, NULL)`,
        String(payload.subscriptionId || `legacy_${crypto.randomUUID()}`),
        String(payload.connectionId || 'legacy-proof'),
        String(payload.functionName || functions.find((fn) => fn.kind === 'LiveQuery')?.name || 'missing'),
        String(payload.argsJson || '{}')
      );
      if (payload.schemaVersion != null) {
        this.writeMeta('subscriptions_schema_version', String(payload.schemaVersion));
      }
    }
    const indexSql = indexName
      ? [...this.sql.exec("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?", indexName)]
          .map((record) => String(record.sql || ''))[0] || null
      : null;
    const ownedTables = [...this.sql.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'app\\_%' ESCAPE '\\' ORDER BY name"
    )].map((record) => String(record.name));
    return json(200, {
      ok: true,
      startupError: this.startupError,
      indexSql,
      ownedTables,
      orphanPresent: [...this.sql.exec(
        "SELECT 1 FROM _snapback_subscriptions WHERE subscription_id = 'orphan-sub'"
      )].length > 0,
      subscriptionSchemaVersion: Number(this.readMeta('subscriptions_schema_version') || 0),
    });
  }

  expectedMetadata() {
    return {
      schema_hash: deploymentIdentity.schemaHash,
      bundle_hash: deploymentIdentity.bundleHash,
      inputs_hash: deploymentIdentity.inputsHash,
    };
  }

  readMeta(key) {
    const records = [...this.sql.exec('SELECT value FROM _snapback_meta WHERE key = ?', key)];
    return records.length === 0 ? null : String(records[0].value);
  }

  writeMeta(key, value) {
    this.sql.exec(
      `INSERT INTO _snapback_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      String(value)
    );
  }

  hasPersistentAppState() {
    if (this.currentVersion() > 0) return true;
    const owned = [...this.sql.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'app\\_%' ESCAPE '\\' OR name IN ('_snapback_changes', '_snapback_subscriptions'))"
    )];
    for (const record of owned) {
      const name = String(record.name);
      if (!/^(?:app_[A-Za-z_][A-Za-z0-9_]*|_snapback_changes|_snapback_subscriptions)$/.test(name)) continue;
      const counts = [...this.sql.exec(`SELECT COUNT(*) AS count FROM "${name}"`)];
      if (counts.some((count) => Number(count.count) > 0)) return true;
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
          key === 'schema_hash'
            ? 'SNAPBACK_STALE_CLOUDFLARE_SCHEMA_HASH'
            : key === 'bundle_hash'
              ? 'SNAPBACK_STALE_CLOUDFLARE_BUNDLE_HASH'
              : 'SNAPBACK_STALE_CLOUDFLARE_INPUTS_HASH',
          `stored ${key} does not match this deployment; reset or migrate before serving it`,
          { key, expected: expectedValue, actual: storedValue }
        );
      }
    }
    return null;
  }

  writeDeploymentMetadata() {
    for (const [key, value] of Object.entries(this.expectedMetadata())) {
      this.writeMeta(key, value);
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
    if (!this.tableExists('_snapback_version')) return 0;
    const records = [...this.sql.exec('SELECT version FROM _snapback_version WHERE id = 1')];
    return records.length === 0 ? 0 : Number(records[0].version);
  }

  healthVersion() {
    try {
      return this.currentVersion();
    } catch (_) {
      return null;
    }
  }

  appGeneration() {
    const raw = this.readMeta('app_generation');
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  nextResetGeneration() {
    try {
      const next = this.appGeneration() + 1;
      return Number.isSafeInteger(next) && next > 0 ? next : 1;
    } catch (_) {
      return 1;
    }
  }

  newId() {
    return crypto.randomUUID();
  }

  functionByName(name) {
    const fn = functions.find((entry) => entry.name === name);
    if (!fn) return null;
    if (fn.testingOnly === true && this.env.SNAPBACK_TESTING !== '1') return null;
    // @ref LLP 0076#target-contract — capability admission resolves against
    // the SAME served instance manifest this deployment publishes, before
    // any handler code can run. This target is deploy-time compiled, so
    // function resolution is its loader seam: /app/ensure only hash-gates
    // posted artifacts and never installs them, which is why the check
    // lives here rather than in kitEnsureApp.
    for (const capability of fn.requiredCapabilities || []) {
      if (
        KNOWN_TARGET_CAPABILITY_IDS.has(capability)
        && !SUPPORTED_TARGET_CAPABILITIES.has(capability)
      ) {
        throw codedError(
          'SNAPBACK_CAPABILITY_UNSUPPORTED',
          `${name} requires capability ${capability}, which the served instance manifest does not support`
        );
      }
    }
    return fn;
  }

  // --- HTTP + WebSocket routing ------------------------------------------

  async fetch(request) {
    const path = new URL(request.url).pathname;
    try {
      return await this.route(request);
    } catch (error) {
      // A thrown coded refusal (e.g. capability admission at function
      // resolution) surfaces as a typed diagnostic, never a bare 500.
      if (error && typeof error.snapbackCode === 'string') {
        return json(error.snapbackCode === 'SNAPBACK_CAPABILITY_UNSUPPORTED' ? 503 : 400, {
          ok: false,
          diagnostic: {
            code: error.snapbackCode,
            severity: 'error',
            subsystem: 'runtime',
            message: String(error.message || 'coded refusal'),
          },
        });
      }
      const failure = classifyPlatformError(error, { maxRowBytes: MAX_ROW_BYTES });
      if (failure) return platformFailureResponse(path, failure);
      throw error;
    }
  }

  async route(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (this.socketLimitError) {
      this.socketLimitError = this.reconcileAcceptedSocketBounds();
    }
    const startupRefusal = this.startupError || this.socketLimitError;

    // A deployment/state mismatch refuses the data plane (fail closed) but
    // leaves /health for diagnosis, /reset for recovery, and /config/status
    // for operator config diagnosis (deployment config, not app data).
    if (
      startupRefusal &&
      path !== '/health' &&
      path !== '/reset' &&
      path !== '/__test/corrupt-meta' &&
      path !== '/__test/schema-hardening' &&
      path !== '/__test/connection-state' &&
      path !== '/__test/socket-limit-upgrade' &&
      path !== '/config/status'
    ) {
      return json(409, startupRefusal);
    }
    if (path === '/config/status') {
      return this.adminReadGated(request, () => this.configStatus());
    }
    if (path === '/cron/status') {
      return this.cronStatus(request);
    }
    // Admin-gated manual run trigger on the existing SNAPBACK_ADMIN_TOKEN
    // POST surface (LLP 0049 §Warm Polling / ENG-23587) — never a public
    // run-now route. Manual runs are ordinary one-shot actions: they neither
    // consume a scheduled slot nor allocate recoverable claim/replay rows.
    if (path === '/cron/run') {
      return this.adminGated(request, () => this.withJsonObject(request, async (payload) => {
        const job = this.alarmJobs().find((entry) => entry.name === String(payload.job || ''));
        if (!job) {
          return json(404, { ok: false, code: 'SNAPBACK_CRON_JOB_UNKNOWN', message: `no alarm job ${payload.job}` });
        }
        const outcome = await this.runCronJob(job, 'manual', Date.now());
        return json(200, { ok: true, ...outcome });
      }));
    }
    if (path === '/host-call') {
      return this.serveHostCall(request);
    }
    if (path === '/health') {
      if (startupRefusal) {
        return json(409, {
          ...startupRefusal,
          version: this.healthVersion(),
          // Deployment verification must still be able to distinguish a
          // fully bound new version from a stripped bootstrap version while
          // the data plane is correctly refusing stale persistent state.
          bindings: {
            handler: Boolean(this.env.HANDLER),
            actionHandler: Boolean(this.env.ACTION_HANDLER),
          },
          workerVersion: workerVersionMetadata(this.env),
        });
      }
      return json(200, {
        ok: true,
        version: this.currentVersion(),
        schemaHash: deploymentIdentity.schemaHash,
        bundleHash: deploymentIdentity.bundleHash,
        clientArtifactIdentity: { schemaHash: APP_SCHEMA_HASH, bundleHash: APP_BUNDLE_HASH },
        objectBoot: this.bootMarker,
        // Deploy-probe surface (ENG-23732): a live gateway serving the
        // bootstrap pass (services stripped) reports handler:false here, so
        // deploy.sh can detect it instead of every query 500ing later.
        bindings: {
          handler: Boolean(this.env.HANDLER),
          actionHandler: Boolean(this.env.ACTION_HANDLER),
        },
        workerVersion: workerVersionMetadata(this.env),
      });
    }
    if (path === '/reset') {
      // Destructive admin surface: token-gated and POST-only (ENG-23587),
      // and under the invocation mutex — a reset interleaving with an
      // in-flight mutation would let pre-reset buffered writes commit into
      // the freshly reset store (ENG-23575's rationale applies here too).
      return this.adminGated(request, () =>
        this.runExclusive(async () => {
          try {
            return await this.reset();
          } catch (error) {
            return json(500, {
              ok: false,
              code: (error && error.snapbackCode) || 'SNAPBACK_RESET_FAILED',
              message: 'the atomic reset failed; the previous state was preserved',
              ...(this.env.SNAPBACK_TESTING === '1'
                ? { details: { cause: String((error && error.message) || error) } }
                : {}),
            });
          }
        })
      );
    }
    if (path === '/__test/corrupt-meta') {
      return this.testingGated(request, () =>
        this.withJsonObject(request, (payload) => this.corruptMetaForTest(payload))
      );
    }
    // Testing-only action invocation (LLP 0049 Phase 1): exercises the
    // action grant path — descriptor construction, fail-closed handles,
    // MISSING/UNDECLARED codes — before Phase 2 lands the public action
    // route with host-mediated egress. Never available without
    // SNAPBACK_TESTING=1; the capability manifest keeps outbound_actions as
    // a declared gap.
    if (path === '/__test/action') {
      return this.testingGated(request, () => this.withJsonObject(request, async (payload) => {
        const outcome = await this.executeAction(payload.name, payload.args || {}, 'test');
        if (!outcome.ok) return json(200, { ok: false, code: outcome.diagnostic.code, message: outcome.diagnostic.message });
        return json(200, { ok: true, result: outcome.result });
      }));
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
    if (path === '/__test/run-cron') {
      return this.testingGated(request, () => this.withJsonObject(request, async (payload) => {
        const job = this.alarmJobs().find((entry) => entry.name === String(payload.job || 'warmPoll'));
        if (!job) return json(404, { ok: false, code: 'SNAPBACK_CRON_JOB_UNKNOWN' });
        // ENG-24365 test seam: cron functions are deploy-time declarations,
        // so the exhaustive function-kind matrix needs a testing-only way to
        // substitute the action target while retaining the real cron runner.
        // The enclosing testingGated boundary makes this unavailable on a
        // production deployment.
        let selectedJob = typeof payload.actionOverride === 'string'
          ? { ...job, action: payload.actionOverride }
          : job;
        if (typeof payload.rawErrorOverride === 'string') {
          selectedJob = { ...selectedJob, testThrowMessage: payload.rawErrorOverride };
        }
        const trigger = payload.trigger === 'scheduled' ? 'scheduled' : 'manual';
        const scheduledAtMs = Number.isSafeInteger(payload.scheduledAtMs) && payload.scheduledAtMs >= 0
          ? payload.scheduledAtMs
          : Date.now();
        const outcome = await this.runCronJob(selectedJob, trigger, scheduledAtMs);
        return json(200, { ok: true, ...outcome });
      }, { allowEmpty: true }));
    }
    if (path === '/__test/cron-claims') {
      return this.testingGated(request, () => {
        const claims = [...this.sql.exec('SELECT * FROM _snapback_cron_claims ORDER BY scheduled_at_ms, idempotency_key')];
        let mutationResults = 0;
        for (const record of this.sql.exec('SELECT COUNT(*) AS count FROM _snapback_action_mutation_results')) {
          mutationResults = Number(record.count);
        }
        const cronState = [...this.sql.exec('SELECT * FROM _snapback_cron_state ORDER BY job_name')];
        return json(200, { claims, mutationResults, cronState });
      });
    }
    if (path === '/__test/migrate-legacy-cron-diagnostic') {
      return this.testingGated(request, () => this.withJsonObject(request, (payload) => {
        const job = this.alarmJobs()[0];
        if (!job) return json(404, { ok: false, code: 'SNAPBACK_TEST_CRON_JOB_MISSING' });
        this.writeCronState(job.name, {
          last_run_id: crypto.randomUUID(),
          last_scheduled_at_ms: Date.now(),
          last_trigger: 'scheduled',
          last_outcome: 'failed',
          last_duration_ms: 1,
          last_error_code: payload.errorCode ?? null,
          last_error: String(payload.error ?? ''),
          last_finished_at_ms: Date.now(),
        });
        this.migrateCronDiagnostics();
        return json(200, { ok: true, state: this.readCronState(job.name) });
      }));
    }
    if (path === '/__test/fanout-diagnostics') {
      return this.testingGated(request, () => json(200, this.fanOutDiagnostics()));
    }
    // @ref LLP 0028#scheduler-state-and-run-ledger — deterministic test
    // evidence must cross the durable nominal-state and DO-alarm seam, not
    // stop at the pure next-slot arithmetic helper.
    if (path === '/__test/cron-nominal-reconciliation') {
      return this.testingGated(request, () =>
        this.withJsonObject(request, (payload) => this.cronNominalReconciliationForTest(payload))
      );
    }
    if (path === '/__test/expire-cron-claims') {
      return this.testingGated(request, () => {
        this.sql.exec("UPDATE _snapback_cron_claims SET lease_expires_at_ms = 0 WHERE state = 'claimed'");
        return json(200, { expired: true });
      });
    }
    // @ref LLP 0028#scheduler-state-and-run-ledger — retention may remove
    // terminal claims and their replay rows, never a stale lease that still
    // represents recoverable work. Advance only the pruning clock so the
    // acceptance can prove both sides without a seven-day sleep.
    if (path === '/__test/prune-cron-claims') {
      return this.testingGated(request, () => {
        const simulatedNowMs = Date.now() + CRON_CLAIM_RETENTION_MS + 1_000;
        this.pruneCronClaims(simulatedNowMs);
        return json(200, { pruned: true, simulatedNowMs });
      });
    }
    if (path === '/__test/storage-layout') {
      return this.testingGated(request, () => json(200, this.storageLayoutForTest()));
    }
    if (path === '/__test/schema-hardening') {
      return this.testingGated(request, () => this.withJsonObject(request, (payload) => this.schemaHardeningForTest(payload)));
    }
    if (path === '/__test/connection-state') {
      return this.testingGated(request, () => json(200, {
        connections: [...this.sql.exec('SELECT connection_id, opened_at_ms, socket_session_id FROM _snapback_connections ORDER BY connection_id')],
        subscriptions: [...this.sql.exec(
          `SELECT subscription_id, connection_id, socket_session_id, function_name, args_json
           FROM _snapback_subscriptions ORDER BY subscription_id`,
        )],
        acceptedSocketCount: this.ctx.getWebSockets().length,
      }));
    }
    if (path === '/__test/socket-limit-upgrade') {
      return this.testingGated(request, () => this.withJsonObject(request, (payload) => {
        const requested = {
          acceptedSockets: Number(payload.acceptedSockets),
          legacyProofSockets: Number(payload.legacyProofSockets),
          socketsPerConnection: Number(payload.socketsPerConnection),
        };
        for (const [key, value] of Object.entries(requested)) {
          if (!Number.isSafeInteger(value) || value <= 0 || value > SUBSCRIPTION_TEST_CEILINGS[key]) {
            return json(400, { ok: false, code: 'SNAPBACK_TEST_SOCKET_LIMIT_INVALID', key });
          }
        }
        this.testSocketLimitOverrides = requested;
        this.socketLimitError = this.reconcileAcceptedSocketBounds();
        return json(200, {
          ok: this.socketLimitError === null,
          socketLimitError: this.socketLimitError,
          acceptedSocketCount: this.ctx.getWebSockets().length,
        });
      }));
    }
    if (path === '/__test/subscription-linearization') {
      return this.testingGated(request, () => this.withJsonObject(request, (payload) => {
        const functionName = String(
          payload.functionName || functions.find((fn) => fn.kind === 'LiveQuery')?.name || 'missing'
        );
        const candidate = {
          connectionId: 'linearization-candidate',
          functionName,
          argsJson: canonicalJson({ boardId: 'candidate' }),
        };
        const stagedAdmission = this.subscriptionAdmission(candidate);
        if (!stagedAdmission.ok) {
          return json(409, { ok: false, stage: 'admission', stagedAdmission });
        }
        this.sql.exec(
          `INSERT INTO _snapback_subscriptions
             (subscription_id, connection_id, function_name, args_json, socket_session_id)
           VALUES ('linearization-filler', 'linearization-filler', ?, ?, NULL)`,
          functionName,
          canonicalJson({ boardId: 'filler' })
        );
        const persisted = this.persistSubscription(candidate);
        const rows = [...this.sql.exec(
          `SELECT subscription_id FROM _snapback_subscriptions
           WHERE connection_id IN ('linearization-candidate', 'linearization-filler')
           ORDER BY subscription_id`
        )].map((record) => String(record.subscription_id));
        return json(200, { ok: true, stagedAdmission, persisted, rows });
      }, { allowEmpty: true }));
    }
    if (path === '/__test/expire-connections') {
      return this.testingGated(request, async () => {
        this.sql.exec('UPDATE _snapback_connections SET opened_at_ms = 0 WHERE socket_session_id IS NULL');
        const reaped = this.reapExpiredConnections();
        await this.reconcileCronActivation();
        return json(200, { reaped, remaining: this.connectionCount() });
      });
    }
    if (path === '/__test/age-connections') {
      return this.testingGated(request, () => {
        this.sql.exec('UPDATE _snapback_connections SET opened_at_ms = 0 WHERE socket_session_id IS NULL');
        return json(200, { aged: true });
      });
    }
    if (path === '/__test/index-plan') {
      return this.testingGated(request, () => this.withJsonObject(request, (payload) => this.indexPlanForTest(payload)));
    }
    if (path === '/__test/subscription-migration') {
      return this.testingGated(request, () => this.withJsonObject(request, (payload) => {
        if (payload.forceLegacy !== false) {
          this.writeMeta('subscriptions_schema_version', String(SUBSCRIPTION_SCHEMA_VERSION - 1));
        }
        this.testSubscriptionMigrationFailureAt = payload.failAt || null;
        let error = null;
        try {
          this.migrateSubscriptionsSchema();
        } catch (caught) {
          error = {
            code: caught.snapbackCode || 'SNAPBACK_TEST_SUBSCRIPTION_MIGRATION_FAILED',
            message: String(caught.message || caught),
          };
        } finally {
          this.testSubscriptionMigrationFailureAt = null;
        }
        return json(200, { ok: error === null, error, layout: this.storageLayoutForTest() });
      }));
    }
    // Testing-only payload echo: the exact secretsJson the coordinator would
    // attach for a function — the descriptors-only fact is asserted by test,
    // not by convention (LLP 0049 Phase 1 exit evidence).
    if (path === '/__test/secrets-payload') {
      return this.testingGated(request, () => this.withJsonObject(request, async (payload) => {
        const fn = this.functionByName(payload.name);
        if (!fn) return json(404, { error: `no function ${payload.name}` });
        const mode = payload.mode || (fn.kind === 'Action' ? 'action' : 'query');
        const secretsJson = mode === 'action' ? this.buildActionGrantsJson(fn, { advance: false }) : null;
        return json(200, { name: fn.name, mode, secretsJson });
      }));
    }
    if (path === '/query') {
      return this.withJsonObject(request, (payload) => this.runExclusive(() => this.handleQuery(payload)));
    }
    if (path === '/mutation') {
      return this.withJsonObject(request, (payload) => this.runExclusive(() => this.handleMutation(payload)));
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
        return this.withJsonObject(request, (payload) => this.runExclusive(() => this.kitQuery(kitQuery[1], payload)));
      }
      const kitMutation = path.match(/^\/mutation\/([A-Za-z0-9_-]+)$/);
      if (kitMutation) {
        return this.withJsonObject(request, (payload) => this.runExclusive(() => this.kitMutation(kitMutation[1], payload)));
      }
      // The generated client.action transport (LLP 0049 Phase 2). NOT wrapped
      // in runExclusive: executeAction stages under the mutex, runs the
      // handler and its external fetch off it, and reacquires per mutation
      // commit — a slow 511 round-trip must never stall this object's
      // queries, mutations, or live pushes.
      const kitAction = path.match(/^\/action\/([A-Za-z0-9_-]+)$/);
      if (kitAction) {
        return this.withJsonObject(request, async (payload) => {
          const outcome = await this.executeAction(kitAction[1], (payload && payload.args) || {}, 'manual');
          return json(outcome.diagnostic?.code === 'SNAPBACK_FUNCTION_KIND_MISMATCH' ? 400 : 200, outcome);
        });
      }
      if (path === '/connection/open') {
        return this.withJsonObject(request, (payload) => this.runExclusive(() => this.kitOpenConnection(payload)));
      }
      if (path === '/app/ensure') {
        return this.withJsonObject(request, (payload) => this.runExclusive(() => this.kitEnsureApp(payload)));
      }
      const kitSubscribe = path.match(/^\/live\/([A-Za-z0-9_-]+)\/subscribe$/);
      if (kitSubscribe) {
        return this.withJsonObject(request, (payload) => {
          const denied = this.verifyConnection(payload.connection_id, request.headers.get('x-snapback-connection-token'));
          if (denied) return denied;
          return this.runExclusive(() => this.kitSubscribe(kitSubscribe[1], payload));
        });
      }
      const kitUnsubscribe = path.match(/^\/live\/([A-Za-z0-9_-]+)\/unsubscribe$/);
      if (kitUnsubscribe) {
        return this.withJsonObject(request, (payload) => {
          const denied = this.verifyConnection(payload.connection_id, request.headers.get('x-snapback-connection-token'));
          if (denied) return denied;
          return this.runExclusive(() => this.kitUnsubscribe(payload));
        });
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

  adminReadGated(request, run) {
    if (request.method !== 'GET') {
      return json(405, { ok: false, code: 'SNAPBACK_ADMIN_METHOD_NOT_ALLOWED', message: 'admin reads are GET-only' });
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

  hasAdminReadAuthority(request) {
    const expected = this.env.SNAPBACK_ADMIN_TOKEN;
    if (typeof expected !== 'string' || expected.length === 0) return false;
    return (request.headers.get('x-snapback-admin-token') || '') === expected;
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

  async withJsonObject(request, run, options = {}) {
    const parsed = await parseJsonObjectRequest(request, options);
    if (!parsed.ok) return parsed.response;
    return run(parsed.value);
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
      payload.bundleHash || deploymentIdentity.bundleHash
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
  // entry names, set/missing state, member count, and fresh opaque capability
  // ids — NEVER values or forgeable rotation cursors. The cursor-to-value
  // authority stays in the invocation-scoped coordinator map; the handler
  // isolate's ctx.secrets builds fail-closed descriptor handles from the
  // opaque ids (descriptorsOnly), and the local values-in-secretsJson shape
  // never ports to this profile.
  buildActionGrants(fn, { advance = true } = {}) {
    // @ref LLP 0036#runtime-exposure-d5-d8 — grants are invocation-scoped
    // opaque capabilities, not forgeable config-entry descriptors.
    const uses = Array.isArray(fn.uses) ? fn.uses : [];
    const entries = {};
    const capabilities = new Map();
    for (const entryName of uses) {
      if (!this.declaredConfigEntry(entryName)) continue;
      const members = this.poolMembers(entryName);
      const rotatingCursor = members.length > 0 ? this.nextRotationCursor(entryName, { advance }) % members.length : 0;
      const firstCapabilityId = `sec_${crypto.randomUUID()}`;
      const rotatingCapabilityId = `sec_${crypto.randomUUID()}`;
      capabilities.set(firstCapabilityId, { entryName, cursor: 0 });
      capabilities.set(rotatingCapabilityId, { entryName, cursor: rotatingCursor });
      entries[entryName] = {
        set: members.length > 0,
        memberCount: members.length,
        firstCapabilityId,
        rotatingCapabilityId,
      };
    }
    return { secretsJson: JSON.stringify({ descriptorsOnly: true, entries }), capabilities };
  }

  buildActionGrantsJson(fn, options = {}) {
    return this.buildActionGrants(fn, options).secretsJson;
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
      if (fn.testingOnly === true && this.env.SNAPBACK_TESTING !== '1') continue;
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
  async executeAction(name, args, trigger, options = {}) {
    const staged = await this.runExclusive(() => {
      const fn = this.functionByName(name);
      if (!fn) {
        return { error: { code: 'SNAPBACK_ACTION_UNKNOWN', message: `${name} is not an action on this app` } };
      }
      if (fn.kind !== 'Action') {
        return {
          error: {
            code: 'SNAPBACK_FUNCTION_KIND_MISMATCH',
            message: `${name} is declared ${fn.kind}, not action`,
            details: { function: name, declaredKind: fn.kind, requestedMode: 'action' },
          },
        };
      }
      const limited = this.claimActionBudget(name, trigger);
      if (limited) return { error: limited };
      return { fn, appGeneration: this.appGeneration() };
    });
    if (staged.error) {
      return { ok: false, function: name, kind: 'Action', diagnostic: staged.error };
    }
    const timeoutMs = this.actionTimeoutMs();
    const control = {
      abandoned: false,
      code: null,
      message: null,
      host: null,
      abortController: new AbortController(),
      appGeneration: staged.appGeneration,
    };
    let timer = null;
    const watchdog = new Promise((resolve) => {
      timer = setTimeout(
        () => {
          const message = `action ${name} exceeded the ${timeoutMs}ms wall-clock budget; the invocation failed`;
          control.abandoned = true;
          control.code = 'SNAPBACK_ACTION_TIMEOUT';
          control.message = message;
          if (control.host) control.host.abandon(control.code, message);
          control.abortController.abort(control.code);
          resolve({
            ok: false,
            code: 'SNAPBACK_ACTION_TIMEOUT',
            message,
          });
        },
        timeoutMs
      );
    });
    let result;
    try {
      const sanitizedArgs = { ...(args || {}) };
      if (this.env.SNAPBACK_TESTING !== '1') {
        delete sanitizedArgs.pollBudgetMs;
        delete sanitizedArgs.feedUrl;
        delete sanitizedArgs.baseUrl;
        delete sanitizedArgs.timeoutMs;
        delete sanitizedArgs.url;
        delete sanitizedArgs.source;
        sanitizedArgs.trigger = trigger === 'scheduled' ? 'cron' : 'manual';
      }
      result = await Promise.race([
        this.invokeHandler(name, 'action', sanitizedArgs, {
          trigger,
          control,
          jobName: options.jobName || null,
          // Only retryable scheduler claims get a durable replay identity.
          // Public/manual actions are single attempts and must not leave an
          // unbounded result ledger behind.
          actionIdempotencyKey: options.idempotencyKey || null,
        }),
        watchdog,
      ]);
    } finally {
      clearTimeout(timer);
    }
    const resetFailure = this.actionGenerationFailure(control);
    if (resetFailure) result = resetFailure;
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
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_ACTION_TIMEOUT_MS;
    return Math.min(Math.floor(raw), MAX_ACTION_TIMEOUT_MS);
  }

  actionGenerationFailure(control) {
    if (!control || control.appGeneration === this.appGeneration()) return null;
    const message = 'the app was reset while this action was running; its buffered work was discarded';
    control.abandoned = true;
    control.code = 'SNAPBACK_ACTION_RESET_ABORTED';
    control.message = message;
    if (control.host) control.host.abandon(control.code, message);
    if (!control.abortController.signal.aborted) control.abortController.abort(control.code);
    return { ok: false, code: control.code, message };
  }

  claimActionBudget(name, trigger) {
    if (trigger === 'scheduled') return null;
    const configured = Number(this.env.SNAPBACK_ACTION_RATE_LIMIT_PER_MINUTE);
    const limit = Number.isSafeInteger(configured) && configured > 0 ? Math.min(configured, 600) : 60;
    const nowMs = Date.now();
    const windowMs = 60_000;
    let row = null;
    for (const record of this.sql.exec('SELECT * FROM _snapback_action_limits WHERE action_name = ?', name)) row = record;
    const windowStartedAt = row ? Number(row.window_started_at_ms) : nowMs;
    const inWindow = nowMs - windowStartedAt >= 0 && nowMs - windowStartedAt < windowMs;
    const count = inWindow && row ? Number(row.count) : 0;
    if (count >= limit) {
      return {
        code: 'SNAPBACK_ACTION_RATE_LIMITED',
        message: `action ${name} exceeded the ${limit}-per-minute public invocation budget`,
        details: { retryable: true, retryAfterMs: Math.max(1, windowMs - (nowMs - windowStartedAt)) },
      };
    }
    this.sql.exec(
      `INSERT INTO _snapback_action_limits (action_name, window_started_at_ms, count) VALUES (?, ?, ?)
       ON CONFLICT(action_name) DO UPDATE SET window_started_at_ms = excluded.window_started_at_ms, count = excluded.count`,
      name,
      inWindow ? windowStartedAt : nowMs,
      count + 1
    );
    return null;
  }

  // The action's durable leg: a FULL nested mutation invocation — handler,
  // commit, fan-out — executed under the invocation mutex (the caller wraps
  // this in runExclusive). Returns the mutation handler's value; a failure
  // carries its code back into the action as a coded error.
  async runMutationForAction(name, args, parentHost = null, replay = null) {
    const resetFailure = parentHost && this.actionGenerationFailure(parentHost.control);
    if (resetFailure) return resetFailure;
    const fn = this.functionByName(name);
    if (!fn) {
      return { ok: false, code: 'SNAPBACK_ACTION_MUTATION_UNKNOWN', message: `${name} is not a mutation on this app` };
    }
    if (fn.kind !== 'Mutation') {
      return {
        ok: false,
        code: 'SNAPBACK_FUNCTION_KIND_MISMATCH',
        message: `${name} is declared ${fn.kind}, not mutation`,
      };
    }
    const argsJson = canonicalJson(args || {});
    if (replay && replay.actionIdempotencyKey != null) {
      const replays = [...this.sql.exec(
        `SELECT mutation_name, args_json, result_json
         FROM _snapback_action_mutation_results
         WHERE action_idempotency_key = ? AND sequence = ?`,
        replay.actionIdempotencyKey,
        replay.sequence
      )];
      for (const record of replays) {
        if (String(record.mutation_name) !== name) {
          return {
            ok: false,
            code: 'SNAPBACK_ACTION_REPLAY_DIVERGED',
            message: `scheduled action replay diverged at mutation ${replay.sequence}`,
          };
        }
        // The retry may have re-fetched fresher bytes and therefore derive
        // different mutation arguments. The stable action key + sequence is
        // the idempotency authority: return the already-committed result and
        // never apply a second write. Keep the original args for diagnosis.
        if (String(record.args_json) !== argsJson) {
          console.warn('snapback scheduled action replay reused prior mutation result with changed args', name, replay.sequence);
        }
        return { ok: true, value: JSON.parse(String(record.result_json)) };
      }
    }
    const result = await this.invokeHandler(name, 'mutation', args);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    // Deterministic test seam for the watchdog/commit race: hold a completed
    // nested mutation immediately before its synchronous commit boundary.
    // Production has no delay; the abandonment recheck below is the rule.
    const testDelayMs = this.env.SNAPBACK_TESTING === '1'
      ? Number(this.env.SNAPBACK_TEST_NESTED_COMMIT_DELAY_MS)
      : 0;
    if (Number.isFinite(testDelayMs) && testDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, testDelayMs));
    }
    // This check and commit execute in the same runExclusive critical
    // section with no await between them. If the parent watchdog won while
    // the nested handler was pending, its writes are discarded atomically.
    const abandoned = parentHost && (this.actionGenerationFailure(parentHost.control) || parentHost.abandonedFailure());
    if (abandoned) return abandoned;
    const resultJson = canonicalJson(result.value);
    const commit = this.commit(result.host, replay && replay.actionIdempotencyKey != null
      ? (committed) => {
          this.sql.exec(
            `INSERT INTO _snapback_action_mutation_results
               (action_idempotency_key, sequence, mutation_name, args_json, result_json, commit_version)
             VALUES (?, ?, ?, ?, ?, ?)`,
            replay.actionIdempotencyKey,
            replay.sequence,
            name,
            argsJson,
            resultJson,
            committed.version
          );
        }
      : null);
    await this.fanOut(commit);
    return { ok: true, value: result.value };
  }

  // @ref LLP 0076#target-contract — the Cloudflare adapter owns response
  // readers in the trusted coordinator; the stripped action isolate sees
  // only opaque ids and one pull-bounded Uint8Array per host call.
  createActionResponseStreams(control, capabilities) {
    const streams = new Map();
    const closed = new Map();
    // Invocation-wide host-retained byte accounting (LLP 0076 §Surface): the
    // carry-over slices stashed across pulls, summed over every cursor.
    // Kernel/network buffers are excluded by definition; the visible handoff
    // chunk is bounded separately at 16 KiB.
    const scope = { bufferedBytes: 0 };
    return {
      hasOpen: () => streams.size > 0,
      open: (request) => this.openActionResponseStream(request, control, streams, capabilities, scope),
      read: (streamId) => this.readActionResponseStream(streamId, streams, closed, scope),
      cancel: (streamId) => this.cancelActionResponseStream(streamId, streams, closed),
      closeAll: async () => {
        const pending = [...streams.values()].map((stream) => this.closeActionResponseStream(stream));
        streams.clear();
        await Promise.allSettled(pending);
      },
    };
  }

  actionStreamFailure(code, operation, message, details = {}) {
    return {
      ok: false,
      code,
      message,
      details: {
        operation,
        repair: 'guide/backend/actions-and-fetch#stream-a-response',
        ...details,
      },
    };
  }

  async openActionResponseStream(request, control, streams, capabilities, scope) {
    if (streams.size >= ACTION_STREAM_OPEN_MAX) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED',
        'open',
        'the action already owns the maximum number of open response streams',
        { limit: ACTION_STREAM_OPEN_MAX, received: 'additional stream' },
      );
    }
    // @ref LLP 0076#settlement-and-retry — the StreamAttemptV1 control plane
    // (lease, terminalizer, durable pre-mark) is not implemented on this
    // target yet. Refusing a presented attempt token fails closed: an author
    // must never believe the late-effect fence holds where it does not.
    if (request.attemptToken != null) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'open',
        'the stream attempt control plane is not available on this target',
        { expected: 'no attemptToken on this target profile', received: 'a stream attempt token' },
      );
    }
    const urlText = String(request.url || '');
    let url;
    try { url = new URL(urlText); } catch (_) { url = null; }
    if (!url || !['http:', 'https:'].includes(url.protocol) || urlText.length > 4096) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'open',
        'ctx.fetchStream requires a bounded absolute HTTP(S) URL',
        { expected: 'absolute http(s) URL <= 4096 bytes', received: 'invalid URL shape' },
      );
    }
    const method = String(request.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'open',
        'ctx.fetchStream received an unsupported HTTP method',
        { expected: 'GET|HEAD|POST|PUT|PATCH|DELETE', received: 'unsupported method' },
      );
    }
    const headerEntries = Object.entries(request.headers || {});
    if (
      headerEntries.length > 64
      || headerEntries.some(([name, value]) => (
        !name || name.length > 256 || String(value).length > 8192
        || /[\u0000-\u001f\u007f]/.test(name) || /[\r\n]/.test(String(value))
      ))
    ) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'open',
        'ctx.fetchStream headers exceeded the safe shape',
        { expected: 'at most 64 bounded single-line headers', received: 'invalid header shape' },
      );
    }
    const body = request.body == null ? null : String(request.body);
    if (
      request.idempotencyKey != null
      && (
        String(request.idempotencyKey).length === 0
        || UTF8_ENCODER.encode(String(request.idempotencyKey)).byteLength > 8192
        || /[\r\n]/.test(String(request.idempotencyKey))
      )
    ) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'open',
        'ctx.fetchStream received an invalid idempotency key',
        { expected: 'a non-empty single-line key <= 8192 bytes', received: 'invalid idempotency key shape' },
      );
    }
    if (body && UTF8_ENCODER.encode(body).byteLength > ACTION_STREAM_TOTAL_BYTES_MAX) {
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED',
        'open',
        'ctx.fetchStream request body exceeded the v1 byte limit',
        { limitBytes: ACTION_STREAM_TOTAL_BYTES_MAX, received: 'oversized body' },
      );
    }
    const headers = Object.fromEntries(headerEntries.map(([name, value]) => [name, String(value)]));
    if (request.idempotencyKey != null && !headerEntries.some(([name]) => name.toLowerCase() === 'idempotency-key')) {
      headers['Idempotency-Key'] = String(request.idempotencyKey);
    }
    // @ref LLP 0036#runtime-exposure-d5-d8 — the same opaque placement seam
    // as ordinary host-mediated fetch (LLP 0049 §Action Egress): descriptors
    // unwrap to values HERE and only here, into the query-param or header the
    // slot names. The opened metadata below returns the handler-authored URL,
    // never the host-substituted one, so no resolved value re-enters the
    // isolate; stream refusal details are static and value-free by shape.
    for (const slot of request.secretSlots || []) {
      const descriptor = slot && slot.secret;
      const capabilityId = descriptor && descriptor.capabilityId;
      const capability = typeof capabilityId === 'string' && capabilities instanceof Map
        ? capabilities.get(capabilityId)
        : null;
      if (!capability) {
        return this.actionStreamFailure(
          'SNAPBACK_ACTION_STREAM_INVALID',
          'open',
          'a stream secret slot carried no resolvable descriptor',
          { expected: 'an invocation-scoped secret descriptor', received: 'unresolvable slot' },
        );
      }
      const value = this.resolveSecretValue(capability.entryName, capability.cursor);
      if (value == null) {
        return this.actionStreamFailure(
          'SNAPBACK_CONFIG_MISSING',
          'open',
          `${capability.entryName} has no value set`,
          { expected: 'a configured secret value', received: 'unset entry' },
        );
      }
      if (slot.placement === 'query-param') {
        url.searchParams.set(String(slot.name), value);
      } else if (slot.placement === 'header') {
        headers[String(slot.name)] = value;
      } else {
        return this.actionStreamFailure(
          'SNAPBACK_ACTION_STREAM_INVALID',
          'open',
          'unsupported stream secret placement',
          { expected: 'query-param|header', received: 'unsupported placement kind' },
        );
      }
    }
    const controller = new AbortController();
    const abortForAction = () => controller.abort(control?.code || 'SNAPBACK_ACTION_TIMEOUT');
    if (control?.abortController?.signal.aborted) abortForAction();
    else control?.abortController?.signal.addEventListener('abort', abortForAction, { once: true });
    const metadataTimer = setTimeout(() => controller.abort('SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT'), ACTION_STREAM_IDLE_MS);
    let response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers,
        body: body == null ? undefined : body,
        signal: controller.signal,
      });
    } catch (_) {
      clearTimeout(metadataTimer);
      control?.abortController?.signal.removeEventListener('abort', abortForAction);
      const timedOut = controller.signal.aborted && controller.signal.reason === 'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT';
      // @ref LLP 0076#author-decisions--2026-07-23 — decision 5: safe
      // methods are idempotent by grammar; a bare authored idempotency key
      // no longer confers retry semantics, and this host cannot prove a
      // pre-send failure through fetch(), so every non-safe transport loss
      // stays at the fail-safe ambiguous classification.
      const retrySafe = method === 'GET' || method === 'HEAD';
      return this.actionStreamFailure(
        timedOut
          ? 'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT'
          : retrySafe
            ? 'SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED'
            : 'SNAPBACK_ACTION_STREAM_UPSTREAM_AMBIGUOUS',
        'open',
        timedOut
          ? 'the upstream did not produce response metadata within the idle limit'
          : retrySafe
            ? 'the upstream request failed before response metadata was available'
            : 'the non-idempotent upstream request lost transport after initiation',
        { received: 'transport failure', retrySafe },
      );
    }
    clearTimeout(metadataTimer);
    const streamId = crypto.randomUUID();
    let reader = null;
    let byob = false;
    if (response.body) {
      try {
        reader = response.body.getReader({ mode: 'byob' });
        byob = true;
      } catch (_) {
        reader = response.body.getReader();
      }
    }
    const now = Date.now();
    streams.set(streamId, {
      reader,
      byob,
      controller,
      abortForAction,
      actionSignal: control?.abortController?.signal || null,
      openedAt: now,
      lastByteAt: now,
      totalBytes: 0,
      buffered: new Uint8Array(0),
      pulling: false,
      scope,
    });
    const responseHeaders = {};
    let headerCount = 0;
    for (const [name, value] of response.headers.entries()) {
      if (headerCount >= 64) break;
      responseHeaders[name] = String(value).slice(0, 8192);
      headerCount += 1;
    }
    return {
      ok: true,
      value: {
        streamId,
        status: response.status,
        statusText: response.statusText,
        // The handler-authored URL, never the host-substituted one: the
        // latter is a secret-bearing representation even when encoded.
        url: urlText,
        headers: responseHeaders,
      },
    };
  }

  // The pre/post-pull leg of the per-read authority fence on this target
  // (LLP 0076 §Authority and lifecycle): the action-abandonment signal is
  // revalidated before the pull is dispatched and again after bytes arrive,
  // so a terminalization that lands during a blocked pull discards the late
  // bytes rather than handing them to the isolate.
  actionStreamAbandonRefusal(stream, when) {
    if (!stream.actionSignal || !stream.actionSignal.aborted) return null;
    const reason = stream.actionSignal.reason;
    const code = typeof reason === 'string' && reason.startsWith('SNAPBACK_')
      ? reason
      : 'SNAPBACK_ACTION_TIMEOUT';
    return this.actionStreamFailure(
      code,
      'read',
      'the action invocation was terminalized; stream bytes are discarded',
      { received: when },
    );
  }

  async readActionResponseStream(streamId, streams, closed, scope) {
    const stream = streams.get(streamId);
    if (!stream) {
      if (closed.has(streamId)) {
        return {
          ok: true,
          value: { done: true, bytes: [], totalBytes: closed.get(streamId), elapsedMs: 0, deltaMs: 0 },
        };
      }
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'read',
        'the response stream id is unknown to this action invocation',
        { expected: 'an open invocation-local stream', received: 'unknown stream id' },
      );
    }
    const preAbandoned = this.actionStreamAbandonRefusal(stream, 'terminalized before pull');
    if (preAbandoned) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return preAbandoned;
    }
    // One in-flight pull per cursor (LLP 0076 §Surface): the shared bridge
    // reader serializes read(), and the host refuses an overlap structurally.
    if (stream.pulling) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_INVALID',
        'read',
        'the response stream already has a pull in flight',
        { expected: 'one in-flight pull per cursor', received: 'overlapping pull' },
      );
    }
    const now = Date.now();
    if (now - stream.openedAt >= ACTION_STREAM_WALL_MS) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_TIMEOUT',
        'read',
        'the response stream exceeded its wall-clock limit',
        { limitMs: ACTION_STREAM_WALL_MS, received: 'wall limit elapsed' },
      );
    }
    if (now - stream.lastByteAt >= ACTION_STREAM_IDLE_MS) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT',
        'read',
        'the response stream exceeded its idle limit',
        { limitMs: ACTION_STREAM_IDLE_MS, received: 'idle limit elapsed' },
      );
    }
    if (stream.buffered.byteLength > 0) {
      const deltaMs = Date.now() - stream.lastByteAt;
      const visible = stream.buffered.slice(0, ACTION_STREAM_CHUNK_BYTES_MAX);
      stream.buffered = stream.buffered.slice(visible.byteLength);
      scope.bufferedBytes -= visible.byteLength;
      stream.totalBytes += visible.byteLength;
      stream.lastByteAt = Date.now();
      return this.actionStreamChunk(streamId, stream, visible, streams, closed, deltaMs);
    }
    if (!stream.reader) {
      const elapsedMs = Date.now() - stream.openedAt;
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return { ok: true, value: { done: true, bytes: [], totalBytes: stream.totalBytes, elapsedMs, deltaMs: 0 } };
    }
    const wallRemaining = Math.max(1, ACTION_STREAM_WALL_MS - (Date.now() - stream.openedAt));
    const waitMs = Math.min(ACTION_STREAM_IDLE_MS, wallRemaining);
    let timer;
    const timed = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timeout: true }), waitMs);
    });
    stream.pulling = true;
    let outcome;
    try {
      const reading = (stream.byob
        ? stream.reader.read(new Uint8Array(ACTION_STREAM_CHUNK_BYTES_MAX))
        : stream.reader.read())
        .then((value) => ({ value }), () => ({ failed: true }));
      outcome = await Promise.race([reading, timed]);
    } finally {
      stream.pulling = false;
      clearTimeout(timer);
    }
    if (outcome.timeout) {
      const wallExpired = Date.now() - stream.openedAt >= ACTION_STREAM_WALL_MS;
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        wallExpired ? 'SNAPBACK_ACTION_STREAM_TIMEOUT' : 'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT',
        'read',
        wallExpired
          ? 'the response stream exceeded its wall-clock limit'
          : 'the upstream produced no response bytes within the idle limit',
        wallExpired
          ? { limitMs: ACTION_STREAM_WALL_MS, received: 'read timeout' }
          : { limitMs: ACTION_STREAM_IDLE_MS, received: 'read timeout' },
      );
    }
    if (outcome.failed) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED',
        'read',
        'the upstream response stream failed while reading',
        { received: 'transport read failure' },
      );
    }
    // Post-pull revalidation: late bytes from a pull that was blocked across
    // an action terminalization are discarded, never handed to the isolate.
    const postAbandoned = this.actionStreamAbandonRefusal(stream, 'terminalized during pull');
    if (postAbandoned) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return postAbandoned;
    }
    if (outcome.value.done) {
      const elapsedMs = Date.now() - stream.openedAt;
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return { ok: true, value: { done: true, bytes: [], totalBytes: stream.totalBytes, elapsedMs, deltaMs: 0 } };
    }
    const bytes = new Uint8Array(
      outcome.value.value.buffer,
      outcome.value.value.byteOffset,
      outcome.value.value.byteLength,
    );
    if (bytes.byteLength > ACTION_STREAM_BUFFER_BYTES_MAX) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED',
        'read',
        'the upstream produced a chunk larger than the v1 buffer ceiling',
        { limitBytes: ACTION_STREAM_BUFFER_BYTES_MAX, received: 'oversized upstream chunk' },
      );
    }
    const deltaMs = Date.now() - stream.lastByteAt;
    const visible = bytes.slice(0, ACTION_STREAM_CHUNK_BYTES_MAX);
    stream.buffered = bytes.slice(visible.byteLength);
    scope.bufferedBytes += stream.buffered.byteLength;
    stream.totalBytes += visible.byteLength;
    stream.lastByteAt = Date.now();
    // Invocation-wide host-retained accounting (LLP 0076 §Surface): the sum
    // of carry-over slices across every cursor stays under the 64 KiB
    // application-visible ceiling; kernel/network buffers are out of scope.
    if (scope.bufferedBytes > ACTION_STREAM_BUFFER_BYTES_MAX) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED',
        'read',
        'host-retained stream bytes exceeded the v1 buffered ceiling',
        { limitBytes: ACTION_STREAM_BUFFER_BYTES_MAX, received: 'invocation-wide buffered overflow' },
      );
    }
    return this.actionStreamChunk(streamId, stream, visible, streams, closed, deltaMs);
  }

  async actionStreamChunk(streamId, stream, bytes, streams, closed, deltaMs) {
    if (stream.totalBytes > ACTION_STREAM_TOTAL_BYTES_MAX) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return this.actionStreamFailure(
        'SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED',
        'read',
        'the upstream response exceeded the v1 total-byte limit',
        { limitBytes: ACTION_STREAM_TOTAL_BYTES_MAX, received: 'oversized response' },
      );
    }
    return {
      ok: true,
      value: {
        done: false,
        bytes: Array.from(bytes),
        totalBytes: stream.totalBytes,
        // @ref LLP 0076#author-decisions--2026-07-23 — decision 6: the
        // host-owned monotonic progress clock on every read result.
        elapsedMs: Date.now() - stream.openedAt,
        deltaMs,
      },
    };
  }

  async finishActionResponseStream(streamId, stream, streams, closed) {
    if (stream.scope && stream.buffered) {
      stream.scope.bufferedBytes -= stream.buffered.byteLength;
      stream.buffered = new Uint8Array(0);
    }
    streams.delete(streamId);
    closed.set(streamId, stream.totalBytes);
    await this.closeActionResponseStream(stream);
  }

  async closeActionResponseStream(stream) {
    stream.actionSignal?.removeEventListener('abort', stream.abortForAction);
    try { await stream.reader?.cancel(); } catch (_) {}
    try { stream.controller.abort('SNAPBACK_ACTION_STREAM_CANCELLED'); } catch (_) {}
  }

  async cancelActionResponseStream(streamId, streams, closed) {
    const stream = streams.get(streamId);
    if (stream) {
      await this.finishActionResponseStream(streamId, stream, streams, closed);
      return { ok: true, value: null };
    }
    if (closed.has(streamId)) return { ok: true, value: null };
    return this.actionStreamFailure(
      'SNAPBACK_ACTION_STREAM_INVALID',
      'cancel',
      'the response stream id is unknown to this action invocation',
      { expected: 'an invocation-local stream', received: 'unknown stream id' },
    );
  }

  // The host-mediated fetch boundary (LLP 0049 §Action Egress): descriptors
  // unwrap to values HERE and only here; placement slots cover query-param
  // (511's api_key) and header (directions' Authorization); and every
  // diagnostic that re-enters the isolate — error messages, the final URL,
  // even the upstream body — is redacted first. The coordinator owns the
  // scrub; handler-side redaction remains defense in depth, not the line.
  // Destination allowlisting is not yet implemented on this profile — a
  // named manifest fact (runtimeFacts.egress), not a silent difference.
  async hostActionFetch(request, capabilities, control) {
    if (control && control.abandoned) {
      return { ok: false, code: control.code || 'SNAPBACK_ACTION_TIMEOUT', message: control.message || 'action abandoned' };
    }
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
      const capabilityId = descriptor && descriptor.capabilityId;
      const capability = typeof capabilityId === 'string' && capabilities instanceof Map
        ? capabilities.get(capabilityId)
        : null;
      if (!capability) {
        return { ok: false, code: 'SNAPBACK_HOST_FETCH_SLOT_INVALID', message: 'a secret slot carried no descriptor' };
      }
      const value = this.resolveSecretValue(capability.entryName, capability.cursor);
      if (value == null) {
        return { ok: false, code: 'SNAPBACK_CONFIG_MISSING', message: `${capability.entryName} has no value set` };
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
        for (const pattern of secretRedactionPatterns(value)) out = out.replace(pattern, '[redacted]');
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
    const abortForAction = () => controller.abort(control && control.code ? control.code : 'SNAPBACK_ACTION_TIMEOUT');
    if (control && control.abortController) {
      if (control.abortController.signal.aborted) abortForAction();
      else control.abortController.signal.addEventListener('abort', abortForAction, { once: true });
    }
    try {
      const response = await fetch(url.toString(), {
        method: String(request.method || 'GET'),
        headers,
        body: request.body == null ? undefined : String(request.body),
        signal: controller.signal,
      });
      const boundedBody = await readBoundedTextStream(response.body, MAX_HOST_RESPONSE_BYTES);
      if (!boundedBody.ok) {
        return {
          ok: false,
          code: boundedBody.code,
          message: boundedBody.message,
        };
      }
      const bodyText = boundedBody.text;
      return {
        ok: true,
        value: {
          status: response.status,
          ok: response.ok,
          // Return the handler-authored URL, never the host-substituted URL.
          // The latter is a secret-bearing representation even when encoded.
          url: urlText,
          bodyText: redact(bodyText),
        },
      };
    } catch (error) {
      return {
        ok: false,
        code: 'SNAPBACK_HOST_FETCH_FAILED',
        message: `host fetch to ${urlText} failed: ${redact((error && error.message) || error)}`,
      };
    } finally {
      clearTimeout(timer);
      if (control && control.abortController) {
        control.abortController.signal.removeEventListener('abort', abortForAction);
      }
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
    const counts = [...this.sql.exec(
      `SELECT COUNT(*) AS count
       FROM _snapback_subscriptions s
       LEFT JOIN _snapback_connections c ON c.connection_id = s.connection_id
       WHERE s.function_name IN (${placeholders})
         AND (
           (c.connection_id IS NULL AND s.socket_session_id IS NULL) OR
           (s.socket_session_id IS NOT NULL AND s.socket_session_id = c.socket_session_id)
         )`,
      ...whileLive
    )];
    return counts.length === 0 ? 0 : Number(counts[0].count);
  }

  readCronState(jobName) {
    const records = [...this.sql.exec('SELECT * FROM _snapback_cron_state WHERE job_name = ?', jobName)];
    return records.length === 0 ? null : records[0];
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

  migrateCronDiagnostics() {
    for (const state of this.sql.exec(
      'SELECT job_name, last_error_code, last_error FROM _snapback_cron_state',
    )) {
      const previousError = String(state.last_error || '');
      const error = this.sanitizeCronDiagnostic(previousError);
      let errorCode = this.sanitizeCronDiagnosticCode(state.last_error_code);
      if (error.length === 0) errorCode = null;
      else if (errorCode === null) errorCode = 'SNAPBACK_CRON_ACTION_FAILED';
      if (error !== previousError || errorCode !== (state.last_error_code ?? null)) {
        this.sql.exec(
          `UPDATE _snapback_cron_state
           SET last_error_code = ?, last_error = ?
           WHERE job_name = ?`,
          errorCode,
          error,
          String(state.job_name),
        );
      }
    }
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
  async recomputeAlarm(nowMs = Date.now()) {
    let next = null;
    for (const job of this.alarmJobs()) {
      const state = this.readCronState(job.name);
      if (!state || Number(state.armed) !== 1 || state.next_nominal_at_ms == null) continue;
      const nominal = Number(state.next_nominal_at_ms);
      let wakeAt = nominal;
      const key = `${job.name}@${nominal}`;
      for (const claim of this.sql.exec(
        'SELECT state, lease_expires_at_ms FROM _snapback_cron_claims WHERE idempotency_key = ?',
        key
      )) {
        if (String(claim.state) === 'claimed' && Number(claim.lease_expires_at_ms || 0) > nowMs) {
          wakeAt = Number(claim.lease_expires_at_ms);
        }
      }
      if (next === null || wakeAt < next) next = wakeAt;
    }
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
      return null;
    } else {
      const alarmAtMs = Math.max(next, nowMs + 1);
      await this.ctx.storage.setAlarm(alarmAtMs);
      return alarmAtMs;
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
  // committing again. Manual run-now is deliberately outside this durable
  // replay protocol: it is one ordinary action attempt and leaves no orphaned
  // claim or nested-mutation replay rows after a client/request failure.
  async runCronJob(job, trigger, scheduledAtMs, idempotencyKey = null) {
    if (trigger === 'manual') return this.runManualCronJob(job, scheduledAtMs);
    const runGeneration = this.appGeneration();
    const runId = crypto.randomUUID();
    const key = idempotencyKey || `${job.name}@${scheduledAtMs}`;
    const claim = this.claimCronSlot(job, key, scheduledAtMs, runId);
    const interval = this.jobIntervalMs(job);
    if (claim.terminal) {
      if (!idempotencyKey) this.advanceNominal(job, scheduledAtMs, interval);
      return { duplicate: true, terminal: true, idempotencyKey: key };
    }
    if (!claim.acquired) {
      // A live lease is not completion. Keep the nominal slot in place; the
      // alarm dispatcher re-arms at the lease boundary and recovers it if the
      // owning attempt never reaches a terminal update.
      return { duplicate: true, inFlight: true, leaseExpiresAtMs: claim.leaseExpiresAtMs, idempotencyKey: key };
    }
    if (this.env.SNAPBACK_TESTING === '1' && this.testCronStopAfterClaimRemaining > 0) {
      this.testCronStopAfterClaimRemaining -= 1;
      return { duplicate: false, claimedOnly: true, runId, idempotencyKey: key };
    }
    const startedAt = Date.now();
    let outcome = 'ok';
    let errorCode = null;
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
      const result = await this.executeAction(job.action, args, trigger, {
        idempotencyKey: `cron:${key}`,
        jobName: job.name,
      });
      if (!result.ok) {
        if (
          this.env.SNAPBACK_TESTING === '1' &&
          result.diagnostic.code === 'SNAPBACK_TEST_CRON_ACTION_INTERRUPTED'
        ) {
          return { duplicate: false, interruptedDuringAction: true, runId, idempotencyKey: key };
        }
        outcome = 'failed';
        errorCode = result.diagnostic.code;
        errorText = `${result.diagnostic.code}: ${result.diagnostic.message}`;
      }
    } catch (error) {
      outcome = 'failed';
      errorCode = 'SNAPBACK_CRON_ACTION_FAILED';
      errorText = String((error && error.message) || error);
    }
    if (this.appGeneration() !== runGeneration) {
      return { duplicate: false, runId, outcome: 'reset', resetAbandoned: true, idempotencyKey: key };
    }
    if (this.env.SNAPBACK_TESTING === '1' && this.testCronStopBeforeFinishRemaining > 0) {
      this.testCronStopBeforeFinishRemaining -= 1;
      return { duplicate: false, interruptedBeforeFinish: true, runId, outcome, idempotencyKey: key };
    }
    const finishedAt = Date.now();
    const completion = this.commitCronCompletion({
      job,
      trigger,
      scheduledAtMs,
      idempotencyKey,
      key,
      runId,
      interval,
      outcome,
      errorCode,
      errorText,
      startedAt,
      finishedAt,
    });
    if (completion.interruptedAfterTerminalUpdate) {
      return {
        duplicate: false,
        interruptedAfterTerminalUpdate: true,
        runId,
        outcome,
        idempotencyKey: key,
      };
    }
    if (!completion.committed) {
      return {
        duplicate: false,
        supersededClaim: true,
        runId,
        outcome: 'superseded',
        idempotencyKey: key,
      };
    }
    return { duplicate: false, runId, outcome, idempotencyKey: key };
  }

  // @ref LLP 0028#scheduler-state-and-run-ledger — a terminal claim is
  // observable completion only together with its run summary and next
  // nominal. A crash at any statement boundary must roll back all three.
  commitCronCompletion({
    job,
    trigger,
    scheduledAtMs,
    idempotencyKey,
    key,
    runId,
    interval,
    outcome,
    errorCode,
    errorText,
    startedAt,
    finishedAt,
  }) {
    const retainedError = this.sanitizeCronDiagnostic(errorText);
    const retainedErrorCode = this.sanitizeCronDiagnosticCode(errorCode);
    let committed = false;
    let interruptedAfterTerminalUpdate = false;
    try {
      this.ctx.storage.transactionSync(() => {
        const claim = [...this.sql.exec(
          'SELECT state, run_id FROM _snapback_cron_claims WHERE idempotency_key = ?',
          key,
        )][0];
        if (!claim || String(claim.state) !== 'claimed' || String(claim.run_id) !== runId) return;

        this.sql.exec(
          `UPDATE _snapback_cron_claims SET state = ?, lease_expires_at_ms = NULL
           WHERE idempotency_key = ? AND run_id = ?`,
          outcome === 'ok' ? 'done' : 'failed',
          key,
          runId,
        );
        if (
          this.env.SNAPBACK_TESTING === '1' &&
          this.testCronStopAfterTerminalUpdateRemaining > 0
        ) {
          this.testCronStopAfterTerminalUpdateRemaining -= 1;
          const fault = new Error('injected interruption after terminal claim update');
          fault.code = 'SNAPBACK_TEST_CRON_STOP_AFTER_TERMINAL_UPDATE';
          throw fault;
        }
        this.writeCronState(job.name, {
          last_run_id: runId,
          last_scheduled_at_ms: scheduledAtMs,
          last_trigger: trigger,
          last_outcome: outcome,
          last_duration_ms: finishedAt - startedAt,
          last_error_code: retainedErrorCode,
          last_error: retainedError,
          last_finished_at_ms: finishedAt,
        });
        if (!idempotencyKey) {
          this.advanceNominal(job, scheduledAtMs, interval, finishedAt);
        }
        this.pruneCronClaims(finishedAt);
        committed = true;
      });
    } catch (error) {
      if (error?.code !== 'SNAPBACK_TEST_CRON_STOP_AFTER_TERMINAL_UPDATE') throw error;
      interruptedAfterTerminalUpdate = true;
    }
    return { committed, interruptedAfterTerminalUpdate };
  }

  async runManualCronJob(job, scheduledAtMs) {
    const runGeneration = this.appGeneration();
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    let outcome = 'ok';
    let errorCode = null;
    let errorText = '';
    try {
      if (
        this.env.SNAPBACK_TESTING === '1'
        && typeof job.testThrowMessage === 'string'
      ) {
        throw new Error(job.testThrowMessage);
      }
      const result = await this.executeAction(job.action, this.cronActionArgs(), 'manual', { jobName: job.name });
      if (!result.ok) {
        outcome = 'failed';
        errorCode = result.diagnostic.code;
        errorText = `${result.diagnostic.code}: ${result.diagnostic.message}`;
      }
    } catch (error) {
      outcome = 'failed';
      errorCode = 'SNAPBACK_CRON_ACTION_FAILED';
      errorText = String((error && error.message) || error);
    }
    if (this.appGeneration() !== runGeneration) {
      return { duplicate: false, runId, outcome: 'reset', resetAbandoned: true };
    }
    const finishedAt = Date.now();
    const retainedError = this.sanitizeCronDiagnostic(errorText);
    const retainedErrorCode = this.sanitizeCronDiagnosticCode(errorCode);
    this.writeCronState(job.name, {
      last_run_id: runId,
      last_scheduled_at_ms: scheduledAtMs,
      last_trigger: 'manual',
      last_outcome: outcome,
      last_duration_ms: finishedAt - startedAt,
      last_error_code: retainedErrorCode,
      last_error: retainedError,
      last_finished_at_ms: finishedAt,
    });
    return { duplicate: false, runId, outcome };
  }

  cronActionArgs() {
    const args = { trigger: 'cron' };
    if (this.env.SNAPBACK_TESTING === '1' && typeof this.env.SNAPBACK_TEST_FEED_URL === 'string') {
      args.feedUrl = this.env.SNAPBACK_TEST_FEED_URL;
      args.pollBudgetMs = 0;
    }
    return args;
  }

  cronLeaseMs() {
    const configured = Number(this.env.SNAPBACK_CRON_CLAIM_LEASE_MS);
    if (this.env.SNAPBACK_TESTING === '1' && Number.isFinite(configured) && configured > 0) return configured;
    return Math.max(60_000, this.actionTimeoutMs() + 5_000);
  }

  claimCronSlot(job, key, scheduledAtMs, runId) {
    const nowMs = Date.now();
    const leaseExpiresAtMs = nowMs + this.cronLeaseMs();
    let result = null;
    this.ctx.storage.transactionSync(() => {
      let existing = null;
      for (const record of this.sql.exec('SELECT * FROM _snapback_cron_claims WHERE idempotency_key = ?', key)) {
        existing = record;
      }
      if (!existing) {
        this.sql.exec(
          `INSERT INTO _snapback_cron_claims
             (idempotency_key, job_name, scheduled_at_ms, run_id, claimed_at_ms, state, lease_expires_at_ms, attempt)
           VALUES (?, ?, ?, ?, ?, 'claimed', ?, 1)`,
          key,
          job.name,
          scheduledAtMs,
          runId,
          nowMs,
          leaseExpiresAtMs
        );
        result = { acquired: true, terminal: false, leaseExpiresAtMs, attempt: 1 };
        return;
      }
      const state = String(existing.state);
      if (state === 'done' || state === 'failed') {
        result = { acquired: false, terminal: true, state };
        return;
      }
      const currentLease = Number(existing.lease_expires_at_ms || 0);
      if (state === 'claimed' && currentLease > nowMs) {
        result = { acquired: false, terminal: false, leaseExpiresAtMs: currentLease };
        return;
      }
      const attempt = Math.max(1, Number(existing.attempt || 1)) + 1;
      this.sql.exec(
        `UPDATE _snapback_cron_claims
         SET run_id = ?, claimed_at_ms = ?, state = 'claimed', lease_expires_at_ms = ?, attempt = ?
         WHERE idempotency_key = ?`,
        runId,
        nowMs,
        leaseExpiresAtMs,
        attempt,
        key
      );
      result = { acquired: true, terminal: false, leaseExpiresAtMs, attempt };
    });
    return result;
  }

  pruneCronClaims(nowMs) {
    this.sql.exec(
      `DELETE FROM _snapback_action_mutation_results
       WHERE action_idempotency_key IN (
         SELECT 'cron:' || idempotency_key FROM _snapback_cron_claims
         WHERE state IN ('done', 'failed') AND claimed_at_ms < ?
       )`,
      nowMs - CRON_CLAIM_RETENTION_MS
    );
    this.sql.exec(
      `DELETE FROM _snapback_cron_claims
       WHERE state IN ('done', 'failed') AND claimed_at_ms < ?`,
      nowMs - CRON_CLAIM_RETENTION_MS
    );
  }

  // Advance to the next FUTURE nominal slot: one catch-up run per recovery,
  // never a stampede of missed ticks (LLP 0028).
  advanceNominal(job, fromNominalMs, intervalMs, nowMs = Date.now()) {
    const next = nextNominalAfter(fromNominalMs, intervalMs, nowMs);
    this.writeCronState(job.name, { next_nominal_at_ms: next });
    return next;
  }

  async cronNominalReconciliationForTest(payload) {
    const job = this.alarmJobs()[0];
    if (!job) {
      return json(404, { ok: false, code: 'SNAPBACK_TEST_CRON_JOB_MISSING' });
    }
    const previousNominalMs = payload.previousNominalMs;
    const intervalMs = payload.intervalMs;
    const nowMs = payload.nowMs;
    if (
      !Number.isSafeInteger(previousNominalMs) ||
      previousNominalMs < 0 ||
      !Number.isSafeInteger(intervalMs) ||
      intervalMs <= 0 ||
      !Number.isSafeInteger(nowMs) ||
      nowMs < 0
    ) {
      return json(400, {
        ok: false,
        code: 'SNAPBACK_TEST_CRON_NOMINAL_INVALID',
        message: 'previousNominalMs, intervalMs, and nowMs must be non-negative safe integers; intervalMs must be positive',
      });
    }

    this.writeCronState(job.name, { armed: 1, next_nominal_at_ms: previousNominalMs });
    const nextNominalAtMs = this.advanceNominal(job, previousNominalMs, intervalMs, nowMs);
    if (!Number.isSafeInteger(nextNominalAtMs)) {
      return json(400, {
        ok: false,
        code: 'SNAPBACK_TEST_CRON_NOMINAL_INVALID',
        message: 'the resulting nominal time must be a safe integer',
      });
    }
    const scheduledAlarmAtMs = await this.recomputeAlarm(nowMs);
    const persisted = this.readCronState(job.name);
    const storedAlarmAtMs = await this.ctx.storage.getAlarm();
    return json(200, {
      ok: true,
      job: job.name,
      previousNominalMs,
      intervalMs,
      nowMs,
      nextNominalAtMs,
      persistedNextNominalAtMs: Number(persisted.next_nominal_at_ms),
      scheduledAlarmAtMs,
      storedAlarmAtMs,
    });
  }

  // GET /cron/status has a public operational projection and a more useful
  // admin-token projection. Public callers see only bounded classifications;
  // the gateway forwards the original headers so an operator can see the
  // scrubbed, bounded detail retained here.
  // @ref LLP 0060#diagnostics-and-observability — public diagnostics never
  // expose credentials or unbounded application failure text.
  cronStatus(request) {
    if (request.method !== 'GET') {
      return json(405, {
        ok: false,
        code: 'SNAPBACK_CRON_STATUS_METHOD_NOT_ALLOWED',
        message: 'cron status is GET-only',
      }, CRON_STATUS_RESPONSE_HEADERS);
    }
    const includeOperatorDetail = this.hasAdminReadAuthority(request);
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
        lastRun: state && state.last_run_id
          ? this.cronLastRunProjection(state, includeOperatorDetail)
          : null,
      });
    }
    return json(200, { jobs }, CRON_STATUS_RESPONSE_HEADERS);
  }

  cronLastRunProjection(state, includeOperatorDetail) {
    const error = this.sanitizeCronDiagnostic(state.last_error || '');
    const retainedCode = this.sanitizeCronDiagnosticCode(state.last_error_code);
    const errorCode = error.length === 0
      ? null
      : PUBLIC_CRON_ERROR_CODES.has(retainedCode)
        ? retainedCode
        : 'SNAPBACK_CRON_ACTION_FAILED';
    const projected = {
      scheduledAtMs: Number(state.last_scheduled_at_ms),
      trigger: String(state.last_trigger || ''),
      outcome: String(state.last_outcome || ''),
      durationMs: Number(state.last_duration_ms || 0),
      errorCode,
      finishedAtMs: Number(state.last_finished_at_ms || 0),
    };
    if (includeOperatorDetail) {
      projected.runId = String(state.last_run_id);
      projected.errorCode = retainedCode || errorCode;
      projected.error = error;
    }
    return projected;
  }

  sanitizeCronDiagnostic(value) {
    let text = String(value || '');
    const sensitive = new Set();
    if (typeof this.env.SNAPBACK_ADMIN_TOKEN === 'string') sensitive.add(this.env.SNAPBACK_ADMIN_TOKEN);
    for (const entry of appConfig || []) {
      for (const member of this.poolMembers(entry.name)) sensitive.add(member);
    }
    for (const secret of sensitive) {
      if (!secret) continue;
      for (const pattern of secretRedactionPatterns(secret)) text = text.replace(pattern, '[redacted]');
    }
    // Redact against the exact configured bytes before normalizing controls;
    // otherwise a secret containing a newline or tab changes shape first and
    // evades every raw/escaped redaction pattern.
    text = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
    return boundUtf8Text(text, MAX_CRON_DIAGNOSTIC_BYTES);
  }

  sanitizeCronDiagnosticCode(value) {
    const code = String(value || '');
    if (code.length === 0) return null;
    return PUBLIC_CRON_ERROR_CODES.has(code) || code === 'SNAPBACK_CRON_ACTION_FAILED'
      ? code
      : 'SNAPBACK_CRON_ACTION_FAILED';
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
    if (!functionKindMatchesMode(fn.kind, mode)) {
      return {
        ok: false,
        code: 'SNAPBACK_FUNCTION_KIND_MISMATCH',
        message: `${fnName} is declared ${fn.kind}, not ${mode}`,
        details: { function: fnName, declaredKind: fn.kind, requestedMode: mode },
      };
    }
    // Grants are action-only (LLP 0036): queries and mutations receive
    // secretsJson null and therefore no ctx.secrets at all.
    const grants = mode === 'action' ? this.buildActionGrants(fn) : { secretsJson: null, capabilities: new Map() };
    const secretsJson = grants.secretsJson;
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
    let host;
    const hostStreams = mode === 'action'
      ? this.createActionResponseStreams(options.control || null, grants.capabilities)
      : null;
    const control = options.control || null;
    const actionIdempotencyKey = mode === 'action' && options.actionIdempotencyKey != null
      ? String(options.actionIdempotencyKey)
      : null;
    let actionMutationSequence = 0;
    host = new HostContext({
      sql: this.sql,
      mode,
      nowMs: Date.now(),
      epoch,
      newId: () => this.newId(),
      tables: APP_TABLES,
      schemaTables: APP_SCHEMA_TABLES,
      control,
      // Action-only host capabilities (LLP 0049 Phase 2). runMutation
      // reacquires the invocation mutex per commit — the ENG-23324 pattern:
      // the action itself executes OFF the mutex, so a slow external fetch
      // never stalls queries, mutations, or live pushes on this object.
      runMutation:
        mode === 'action'
          ? (name, mutationArgs) =>
              this.runExclusive(() => {
                if (
                  options.trigger === 'scheduled' &&
                  this.env.SNAPBACK_TESTING === '1' &&
                  this.testCronInterruptDuringActionRemaining > 0
                ) {
                  this.testCronInterruptDuringActionRemaining -= 1;
                  return {
                    ok: false,
                    code: 'SNAPBACK_TEST_CRON_ACTION_INTERRUPTED',
                    message: 'injected cron interruption during action execution',
                  };
                }
                const abandoned = this.actionGenerationFailure(control) || host.abandonedFailure();
                if (abandoned) return abandoned;
                const sequence = actionMutationSequence;
                actionMutationSequence += 1;
                return this.runMutationForAction(name, mutationArgs, host, {
                  actionIdempotencyKey,
                  sequence,
                });
              })
          : null,
      hostFetch: mode === 'action' ? (request) => this.hostActionFetch(request, grants.capabilities, control) : null,
      hostStreams,
    });
    if (control) {
      control.host = host;
      this.actionGenerationFailure(control);
      if (control.abandoned) host.abandon(control.code, control.message);
    }
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
      const parsed = classifyHandlerPlatformFailure(parseHandlerEnvelope(result.envelope), { maxRowBytes: MAX_ROW_BYTES });
      return { ...parsed, host, observedVersion: host.observedVersion || this.currentVersion() };
    } finally {
      await host?.closeResponseStreams();
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
    const parsedBody = await parseJsonObjectRequest(request);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.value;
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
    if (!result.ok) return json(result.code === 'SNAPBACK_FUNCTION_KIND_MISMATCH' ? 400 : 200, failure(result));
    return json(200, { ok: true, version: result.observedVersion ?? this.currentVersion(), rows: result.value });
  }

  // --- mutation + commit -------------------------------------------------

  async handleMutation(payload) {
    const result = await this.invokeHandler(payload.name, 'mutation', payload.args);
    if (!result.ok) return json(result.code === 'SNAPBACK_FUNCTION_KIND_MISMATCH' ? 400 : 200, failure(result));
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
  commit(host, transactionTail = null) {
    if (host.writes.length === 0 && typeof transactionTail !== 'function') {
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
          const rowJson = this.serializeRow(write.table, row);
          this.sql.exec(`INSERT INTO ${table} (id, row_json) VALUES (?, ?)`, write.id, rowJson);
          this.recordChange(nextVersion, write.table, write.id, 'insert', rowJson, nowMs);
          changes.push({ table: write.table, id: write.id, op: 'insert' });
        } else if (write.kind === 'patch') {
          // Empty-values patches are no-ops on the local target
          // (src/storage.rs); they must not journal or advance the version
          // here either.
          if (Object.keys(write.values).length === 0) continue;
          const existing = this.readRow(table, write.id);
          if (existing) {
            const row = { ...existing, ...write.values, _id: write.id, _version: nextVersion, _updatedAt: nowMs };
            const rowJson = this.serializeRow(write.table, row);
            this.sql.exec(`UPDATE ${table} SET row_json = ? WHERE id = ?`, rowJson, write.id);
            this.recordChange(nextVersion, write.table, write.id, 'patch', rowJson, nowMs);
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
      if (typeof transactionTail === 'function') {
        transactionTail({ version: changes.length > 0 ? nextVersion : currentVersion, changes });
      }
    });
    return { version: changes.length > 0 ? nextVersion : currentVersion, changes };
  }

  serializeRow(table, row) {
    const rowJson = JSON.stringify(row);
    const actualBytes = UTF8_ENCODER.encode(rowJson).byteLength;
    if (actualBytes > MAX_ROW_BYTES) {
      throw platformFailureError(valueTooLargeFailure({ limitBytes: MAX_ROW_BYTES, actualBytes, table }));
    }
    return rowJson;
  }

  readRow(table, id) {
    const records = [...this.sql.exec(`SELECT row_json FROM ${table} WHERE id = ?`, id)];
    return records.length === 0 ? null : JSON.parse(records[0].row_json);
  }

  recordChange(version, tableName, rowId, op, rowJson, nowMs) {
    this.sql.exec(
      `INSERT INTO _snapback_changes (version, table_name, row_id, op, row_json, changed_at_ms) VALUES (?, ?, ?, ?, ?, ?)`,
      version,
      tableName,
      rowId,
      op,
      rowJson,
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
    const grant = this.readConnectionGrant(connectionId);
    const expired = Boolean(
      grant && grant.socketSessionId === null && grant.openedAtMs <= Date.now() - this.connectionGrantTtlMs()
    );
    if (expired) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM _snapback_subscriptions WHERE connection_id = ?', connectionId);
        this.sql.exec('DELETE FROM _snapback_connections WHERE connection_id = ? AND socket_session_id IS NULL', connectionId);
      });
      if (typeof this.ctx.waitUntil === 'function') this.ctx.waitUntil(this.reconcileCronActivation());
    }
    const stored = grant && !expired ? grant.token : null;
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
    const grant = this.readConnectionGrant(connectionId);
    return grant && grant.token;
  }

  readConnectionGrant(connectionId) {
    const records = [...this.sql.exec(
      'SELECT token, opened_at_ms, socket_session_id FROM _snapback_connections WHERE connection_id = ?',
      connectionId
    )];
    if (records.length === 0) return null;
    return {
      token: String(records[0].token),
      openedAtMs: Number(records[0].opened_at_ms),
      socketSessionId: records[0].socket_session_id == null ? null : String(records[0].socket_session_id),
    };
  }

  connectionGrantLimit() {
    const configured = Number(this.env.SNAPBACK_CONNECTION_GRANT_LIMIT);
    if (this.env.SNAPBACK_TESTING === '1' && Number.isSafeInteger(configured) && configured > 0) {
      return Math.min(configured, MAX_CONNECTION_GRANT_LIMIT);
    }
    return DEFAULT_CONNECTION_GRANT_LIMIT;
  }

  connectionGrantTtlMs() {
    const configured = Number(this.env.SNAPBACK_CONNECTION_GRANT_TTL_MS);
    if (this.env.SNAPBACK_TESTING === '1' && Number.isFinite(configured) && configured > 0) return configured;
    return DEFAULT_CONNECTION_GRANT_TTL_MS;
  }

  subscriptionGlobalLimit() {
    return this.testingBoundedLimit(
      'SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT',
      SUBSCRIPTION_LIMITS.globalCount,
      SUBSCRIPTION_TEST_CEILINGS.globalCount
    );
  }

  subscriptionPerConnectionLimit() {
    return this.testingBoundedLimit(
      'SNAPBACK_SUBSCRIPTION_PER_CONNECTION_LIMIT',
      SUBSCRIPTION_LIMITS.perConnectionCount,
      SUBSCRIPTION_TEST_CEILINGS.perConnectionCount
    );
  }

  subscriptionArgsBytesLimit() {
    return this.testingBoundedLimit(
      'SNAPBACK_SUBSCRIPTION_ARGS_BYTES',
      SUBSCRIPTION_LIMITS.canonicalArgsBytes,
      SUBSCRIPTION_TEST_CEILINGS.canonicalArgsBytes
    );
  }

  legacyProofSocketLimit() {
    if (this.env.SNAPBACK_TESTING === '1' && this.testSocketLimitOverrides?.legacyProofSockets) {
      return this.testSocketLimitOverrides.legacyProofSockets;
    }
    return this.testingBoundedLimit(
      'SNAPBACK_LEGACY_PROOF_SOCKET_LIMIT',
      SUBSCRIPTION_LIMITS.legacyProofSockets,
      SUBSCRIPTION_TEST_CEILINGS.legacyProofSockets
    );
  }

  acceptedSocketLimit() {
    if (this.env.SNAPBACK_TESTING === '1' && this.testSocketLimitOverrides?.acceptedSockets) {
      return this.testSocketLimitOverrides.acceptedSockets;
    }
    return this.testingBoundedLimit(
      'SNAPBACK_ACCEPTED_SOCKET_LIMIT',
      SUBSCRIPTION_LIMITS.acceptedSockets,
      SUBSCRIPTION_TEST_CEILINGS.acceptedSockets
    );
  }

  socketsPerConnectionLimit() {
    if (this.env.SNAPBACK_TESTING === '1' && this.testSocketLimitOverrides?.socketsPerConnection) {
      return this.testSocketLimitOverrides.socketsPerConnection;
    }
    return this.testingBoundedLimit(
      'SNAPBACK_SOCKETS_PER_CONNECTION_LIMIT',
      SUBSCRIPTION_LIMITS.socketsPerConnection,
      SUBSCRIPTION_TEST_CEILINGS.socketsPerConnection
    );
  }

  testingBoundedLimit(binding, fallback, ceiling) {
    const configured = Number(this.env[binding]);
    if (this.env.SNAPBACK_TESTING === '1' && Number.isSafeInteger(configured) && configured > 0) {
      return Math.min(configured, ceiling);
    }
    return fallback;
  }

  reconcileAcceptedSocketBounds() {
    const sockets = this.ctx.getWebSockets();
    const staleKitSockets = [];
    const proofSockets = [];
    const physicalKitCounts = new Map();
    for (const socket of sockets) {
      let protocol = 'proof';
      let connectionId = null;
      let socketSessionId = null;
      try {
        protocol = this.socketProtocolFor(socket);
        connectionId = this.connectionIdFor(socket);
        socketSessionId = this.socketSessionFor(socket);
      } catch (_) {
        staleKitSockets.push(socket);
        continue;
      }
      if (protocol !== 'kit') {
        proofSockets.push(socket);
        continue;
      }
      if (connectionId) {
        physicalKitCounts.set(connectionId, (physicalKitCounts.get(connectionId) || 0) + 1);
      }
      let currentSession = null;
      try {
        currentSession = connectionId ? this.currentSocketSession(connectionId) : null;
      } catch (_) {}
      if (!connectionId || !socketSessionId || socketSessionId !== currentSession) {
        staleKitSockets.push(socket);
        continue;
      }
    }

    // Session-replaced kit sockets are never legitimate demand. Ask the
    // platform to retire them first even when aggregate counts are in range.
    for (const socket of staleKitSockets) {
      try { socket.close(1008, 'socket session replaced'); } catch (_) {}
    }

    const proofLimit = this.legacyProofSocketLimit();
    const perConnectionLimit = this.socketsPerConnectionLimit();
    const totalLimit = this.acceptedSocketLimit();
    const overConnection = [...physicalKitCounts.entries()]
      .filter(([, count]) => count > perConnectionLimit)
      .sort(([left], [right]) => left.localeCompare(right));
    const violated =
      sockets.length > totalLimit ||
      proofSockets.length > proofLimit ||
      overConnection.length > 0;
    if (!violated) return null;

    // Upgrade policy: if an older deployment left ANY category over its new
    // hard bound, close the complete hibernation registry. A partial keep-set
    // cannot be chosen authoritatively for legacy proof sockets; disconnect +
    // normal client reconnect is deterministic and leaves no hidden excess.
    for (const socket of sockets) {
      try { socket.close(1012, 'socket limits changed; reconnect'); } catch (_) {}
    }
    return staleArtifact(
      'SNAPBACK_SOCKET_LIMIT_RECONCILIATION_PENDING',
      'hibernated sockets from an older deployment exceed the enforced limits; all were closed and clients may retry after cleanup completes',
      {
        policy: 'close-all-and-retry',
        actualAcceptedSockets: sockets.length,
        maxAcceptedSockets: totalLimit,
        actualLegacyProofSockets: proofSockets.length,
        maxLegacyProofSockets: proofLimit,
        maxSocketsPerConnection: perConnectionLimit,
        overLimitConnections: overConnection.map(([connectionId, count]) => ({ connectionId, count })),
      }
    );
  }

  async testSubscriptionStageDelay() {
    if (this.env.SNAPBACK_TESTING !== '1') return;
    const delayMs = Number(this.env.SNAPBACK_TEST_SUBSCRIPTION_STAGE_DELAY_MS);
    if (Number.isFinite(delayMs) && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 1000)));
    }
  }

  subscriptionAdmission({ connectionId, functionName, argsJson, supersedes = null, socketSessionId = null }) {
    const argsBytes = UTF8_ENCODER.encode(argsJson).byteLength;
    const argsLimit = this.subscriptionArgsBytesLimit();
    if (argsBytes > argsLimit) {
      return {
        ok: false,
        status: 413,
        code: 'SNAPBACK_SUBSCRIPTION_ARGS_TOO_LARGE',
        message: `canonical subscription arguments exceed the ${argsLimit}-byte durable limit`,
        details: { limitBytes: argsLimit, actualBytes: argsBytes },
      };
    }

    const existing = [...this.sql.exec(
      `SELECT subscription_id FROM _snapback_subscriptions
       WHERE connection_id = ? AND function_name = ? AND args_json = ?`,
      connectionId,
      functionName,
      argsJson
    )];
    if (existing.length > 0) {
      return { ok: true, existingId: String(existing[0].subscription_id), argsBytes };
    }

    let releasesSlot = false;
    if (typeof supersedes === 'string' && supersedes.length > 0) {
      const replaced = socketSessionId == null
        ? [...this.sql.exec(
            `SELECT 1 FROM _snapback_subscriptions
             WHERE subscription_id = ? AND connection_id = ?`,
            supersedes,
            connectionId
          )]
        : [...this.sql.exec(
            `SELECT 1 FROM _snapback_subscriptions
             WHERE subscription_id = ? AND connection_id = ? AND socket_session_id = ?`,
            supersedes,
            connectionId,
            socketSessionId
          )];
      releasesSlot = replaced.length > 0;
    }

    const globalCount = Number(
      [...this.sql.exec('SELECT COUNT(*) AS count FROM _snapback_subscriptions')][0]?.count || 0
    );
    const connectionCount = Number(
      [...this.sql.exec(
        'SELECT COUNT(*) AS count FROM _snapback_subscriptions WHERE connection_id = ?',
        connectionId
      )][0]?.count || 0
    );
    const release = releasesSlot ? 1 : 0;
    const globalLimit = this.subscriptionGlobalLimit();
    if (globalCount - release >= globalLimit) {
      return {
        ok: false,
        status: 429,
        code: 'SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT',
        message: `the durable subscription registry is limited to ${globalLimit} rows`,
        details: { limit: globalLimit },
      };
    }
    const connectionLimit = this.subscriptionPerConnectionLimit();
    if (connectionCount - release >= connectionLimit) {
      return {
        ok: false,
        status: 429,
        code: 'SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT',
        message: `one connection is limited to ${connectionLimit} durable subscriptions`,
        details: { limit: connectionLimit },
      };
    }
    return { ok: true, existingId: null, argsBytes };
  }

  persistSubscription({ connectionId, functionName, argsJson, supersedes = null, socketSessionId = null }) {
    let outcome = null;
    this.ctx.storage.transactionSync(() => {
      // Re-run admission at the write linearization point. runExclusive
      // already serializes every ordinary subscribe path, but this closes the
      // invariant locally if a future caller stages its snapshot elsewhere.
      const admission = this.subscriptionAdmission({
        connectionId,
        functionName,
        argsJson,
        supersedes,
        socketSessionId,
      });
      if (!admission.ok) {
        outcome = admission;
        return;
      }
      if (typeof supersedes === 'string' && supersedes.length > 0) {
        if (socketSessionId == null) {
          this.sql.exec(
            'DELETE FROM _snapback_subscriptions WHERE subscription_id = ? AND connection_id = ?',
            supersedes,
            connectionId
          );
        } else {
          this.sql.exec(
            'DELETE FROM _snapback_subscriptions WHERE subscription_id = ? AND connection_id = ? AND socket_session_id = ?',
            supersedes,
            connectionId,
            socketSessionId
          );
        }
      }
      this.sql.exec(
        `INSERT INTO _snapback_subscriptions
           (subscription_id, connection_id, function_name, args_json, socket_session_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, function_name, args_json)
         DO UPDATE SET socket_session_id = excluded.socket_session_id`,
        `sub_${crypto.randomUUID()}`,
        connectionId,
        functionName,
        argsJson,
        socketSessionId
      );
      const rows = [...this.sql.exec(
        'SELECT subscription_id FROM _snapback_subscriptions WHERE connection_id = ? AND function_name = ? AND args_json = ?',
        connectionId,
        functionName,
        argsJson
      )];
      outcome = { ok: true, subscriptionId: String(rows[0].subscription_id) };
    });
    return outcome;
  }

  reapExpiredConnections(nowMs = Date.now()) {
    const cutoff = nowMs - this.connectionGrantTtlMs();
    const expired = [];
    for (const record of this.sql.exec(
      'SELECT connection_id FROM _snapback_connections WHERE socket_session_id IS NULL AND opened_at_ms <= ?',
      cutoff
    )) expired.push(String(record.connection_id));
    if (expired.length === 0) return 0;
    this.ctx.storage.transactionSync(() => {
      for (const connectionId of expired) {
        this.sql.exec('DELETE FROM _snapback_subscriptions WHERE connection_id = ?', connectionId);
        this.sql.exec(
          'DELETE FROM _snapback_connections WHERE connection_id = ? AND socket_session_id IS NULL AND opened_at_ms <= ?',
          connectionId,
          cutoff
        );
      }
    });
    return expired.length;
  }

  connectionCount() {
    const records = [...this.sql.exec('SELECT COUNT(*) AS count FROM _snapback_connections')];
    return records.length === 0 ? 0 : Number(records[0].count);
  }

  claimConnectionOpenBudget() {
    const configured = Number(this.env.SNAPBACK_CONNECTION_OPEN_RATE_PER_MINUTE);
    const limit = this.env.SNAPBACK_TESTING === '1' && Number.isSafeInteger(configured) && configured > 0
      ? Math.min(configured, 600)
      : DEFAULT_CONNECTION_OPEN_RATE_PER_MINUTE;
    const nowMs = Date.now();
    const rows = [...this.sql.exec('SELECT window_started_at_ms, count FROM _snapback_connection_admission WHERE id = 1')];
    const row = rows[0] || null;
    const inWindow = Boolean(row && nowMs - Number(row.window_started_at_ms) >= 0 && nowMs - Number(row.window_started_at_ms) < 60_000);
    const count = inWindow ? Number(row.count) : 0;
    if (count >= limit) {
      return kitError(
        429,
        'SNAPBACK_CONNECTION_OPEN_RATE_LIMIT',
        `new connection grants are limited to ${limit} per minute; reuse an existing bearer or retry later`
      );
    }
    this.sql.exec(
      `INSERT INTO _snapback_connection_admission (id, window_started_at_ms, count) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET window_started_at_ms = excluded.window_started_at_ms, count = excluded.count`,
      inWindow ? Number(row.window_started_at_ms) : nowMs,
      count + 1
    );
    return null;
  }

  // POST /connection/open (ENG-23442 shape): tests/local fixtures adopt a free
  // caller-readable label, while production always mints the wire id. In every
  // profile a caller presenting a granted id's current token reopens it
  // idempotently; a collision never rotates another connection's bearer.
  async kitOpenConnection(payload) {
    const requested = typeof payload.connectionId === 'string' && payload.connectionId.length > 0
      ? payload.connectionId
      : null;
    if (
      requested !== null &&
      (!CONNECTION_ID_PATTERN.test(requested) || UTF8_ENCODER.encode(requested).byteLength > MAX_CONNECTION_ID_BYTES)
    ) {
      return kitError(
        400,
        'SNAPBACK_CONNECTION_ID_INVALID',
        `connection ids must use only ASCII letters, digits, underscores, or hyphens and fit in ${MAX_CONNECTION_ID_BYTES} UTF-8 bytes`
      );
    }
    const reaped = this.reapExpiredConnections();
    if (reaped > 0) await this.reconcileCronActivation();
    const previousToken = typeof payload.previousToken === 'string' ? payload.previousToken : null;
    const requestedToken = requested === null ? null : this.readConnectionToken(requested);
    if (requestedToken && previousToken === requestedToken) {
      this.sql.exec('UPDATE _snapback_connections SET opened_at_ms = ? WHERE connection_id = ?', Date.now(), requested);
      return json(200, { connectionId: requested, connectionToken: requestedToken });
    }
    if (this.connectionCount() >= this.connectionGrantLimit()) {
      return kitError(
        429,
        'SNAPBACK_CONNECTION_GRANT_LIMIT',
        'the durable connection-grant budget is full; close/reuse a grant or retry after idle grants expire'
      );
    }
    const rateLimited = this.claimConnectionOpenBudget();
    if (rateLimited) return rateLimited;
    // Trusted tests/local fixtures retain readable labels. Hosted production
    // always mints an unguessable wire id; a returned minted id can still be
    // reopened idempotently with its bearer through the branch above.
    const suggested = this.env.SNAPBACK_TESTING === '1' && requested !== null
      ? requested
      : `conn_${crypto.randomUUID()}`;
    const stored = this.readConnectionToken(suggested);
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
    // @ref LLP 0034#5 —
    // production provisioning is identity-gated and host-owned.
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
    if (posted.seed && (!appSeed || canonicalJson(posted.seed) !== canonicalJson(appSeed))) {
      return kitError(
        403,
        'SNAPBACK_UNTRUSTED_SEED',
        'the Cloudflare production profile accepts only its compiled deployment seed'
      );
    }
    const identityMatched = schemaState === 'matched' && functionsState === 'matched';
    const testingProfile = this.env.SNAPBACK_TESTING === '1';
    if (appSeed && (identityMatched || testingProfile)) {
      // Caller bytes are never the seed source: even when an older generated
      // client posts the same seed for compatibility, the host uses the
      // compiled artifact after proving equality above.
      seedState = this.seedIfEmpty(appSeed) ? 'seeded' : 'skipped-nonempty';
    } else if (posted.seed || appSeed) {
      seedState = 'gated';
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
    const prepared = this.prepareSeed(seedSource);
    if (prepared.length === 0) return false;
    const names = [...new Set(prepared.map((entry) => entry.table))];
    for (const name of names) {
      const counts = [...this.sql.exec(`SELECT COUNT(*) AS count FROM ${this.physicalTable(name)}`)];
      if (counts.some((record) => Number(record.count) > 0)) return false;
    }
    this.ctx.storage.transactionSync(() => {
      this.applyPreparedSeed(prepared, Date.now());
    });
    return true;
  }

  prepareSeed(seedSource) {
    const tables = seedSource && seedSource.tables;
    if (!tables || typeof tables !== 'object' || Array.isArray(tables)) return [];
    const prepared = [];
    for (const [name, rows] of Object.entries(tables)) {
      if (!APP_TABLES.has(name)) {
        throw codedError('SNAPBACK_UNKNOWN_TABLE', `seed references unknown table ${name}`);
      }
      if (!Array.isArray(rows)) {
        throw codedError('SNAPBACK_SEED_INVALID', `seed table ${name} must be an array`);
      }
      for (const input of rows) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          throw codedError('SNAPBACK_SEED_INVALID', `seed row for ${name} must be an object`);
        }
        let id = this.newId();
        if (Object.hasOwn(input, '_id')) {
          if (typeof input._id !== 'string' || input._id.length === 0) {
            throw codedError(
              'SNAPBACK_SEED_INVALID',
              `seed _id for ${name} must be a nonempty string`
            );
          }
          id = input._id;
        }
        const values = { ...input };
        delete values._id;
        const validated = validateWriteValues(APP_SCHEMA_TABLES, name, values, { insert: true });
        if (!validated.ok) throw codedError(validated.code, validated.message, validated.details);
        prepared.push({ table: name, id, values: validated.values });
      }
    }
    return prepared;
  }

  applyPreparedSeed(prepared, nowMs) {
    for (const entry of prepared) {
      const physical = this.physicalTable(entry.table);
      const stored = {
        ...entry.values,
        _id: entry.id,
        _version: 1,
        _createdAt: nowMs,
        _updatedAt: nowMs,
      };
      this.sql.exec(
        `INSERT INTO ${physical} (id, row_json) VALUES (?, ?)`,
        entry.id,
        this.serializeRow(entry.table, stored)
      );
    }
    if (prepared.length > 0 && this.currentVersion() < 1) {
      this.sql.exec('UPDATE _snapback_version SET version = 1 WHERE id = 1');
    }
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
    if (!fn) {
      return kitError(400, 'SNAPBACK_LIVE_NOT_A_LIVE_QUERY', `${name} is not a live query`);
    }
    if (fn.kind !== 'LiveQuery') {
      return kitError(400, 'SNAPBACK_FUNCTION_KIND_MISMATCH', `${name} is declared ${fn.kind}, not live query`);
    }
    const args = (payload && payload.input && payload.input.args) || {};
    const connectionId = String(payload.connection_id || '');
    const socketSessionId = this.currentSocketSession(connectionId);
    if (!socketSessionId) {
      return kitError(
        409,
        'SNAPBACK_CONNECTION_SOCKET_REQUIRED',
        'a current authenticated WebSocket session is required before subscribing'
      );
    }
    const argsJson = canonicalJson(args);
    const admission = this.subscriptionAdmission({
      connectionId,
      functionName: name,
      argsJson,
      supersedes: typeof payload.supersedes === 'string' ? payload.supersedes : null,
      socketSessionId,
    });
    if (!admission.ok) {
      return kitError(admission.status, admission.code, admission.message, admission.details);
    }
    await this.testSubscriptionStageDelay();
    const result = await this.invokeHandler(name, 'query', args);
    if (!result.ok) return kitFailure(result);
    if (this.currentSocketSession(connectionId) !== socketSessionId) {
      return kitError(
        409,
        'SNAPBACK_CONNECTION_SESSION_REPLACED',
        'the WebSocket session was replaced while the subscription snapshot was loading; retry on the current session'
      );
    }
    const version = result.observedVersion ?? this.currentVersion();
    const persisted = this.persistSubscription({
      connectionId,
      functionName: name,
      argsJson,
      supersedes: typeof payload.supersedes === 'string' ? payload.supersedes : null,
      socketSessionId,
    });
    if (!persisted.ok) {
      return kitError(persisted.status, persisted.code, persisted.message, persisted.details);
    }
    // Subscribe arms the demand-gated warm poll (LLP 0049 Phase 3).
    await this.reconcileCronActivation();
    return json(200, {
      subscription_id: persisted.subscriptionId,
      snapshot: { version, rows: result.value },
      permission_epochs: {},
    });
  }

  async kitUnsubscribe(payload) {
    const connectionId = String(payload.connection_id || '');
    const socketSessionId = this.currentSocketSession(connectionId);
    if (!socketSessionId) {
      return kitError(
        409,
        'SNAPBACK_CONNECTION_SOCKET_REQUIRED',
        'a current authenticated WebSocket session is required before unsubscribing'
      );
    }
    this.sql.exec(
      'DELETE FROM _snapback_subscriptions WHERE subscription_id = ? AND connection_id = ? AND socket_session_id = ?',
      String(payload.subscription_id || ''),
      connectionId,
      socketSessionId
    );
    // Last-unsubscribe cancels the warm-poll alarm (LLP 0049 Phase 3).
    await this.reconcileCronActivation();
    return json(200, { removed: true });
  }

  // GET /live/:connectionId/stream — the kit's managed shared socket. The
  // token gate runs BEFORE the upgrade. Browser WebSockets cannot set
  // headers, so their token rides only the
  // `snapback.connection-token.<token>` subprotocol; non-browser clients may
  // use the explicit header. Query credentials are refused. The socket echoes
  // `snapback.v1` — a browser fails the connection when it offered
  // subprotocols and the server echoed none.
  async acceptKitSocket(request, connectionId, url) {
    // @ref LLP 0031#connection-capability-grants — browser bearer transport
    // is the subprotocol; URL credentials are outside the grant contract.
    if (request.headers.get('upgrade') !== 'websocket') {
      return kitError(426, 'SNAPBACK_UPGRADE_REQUIRED', 'expected websocket upgrade');
    }
    const protocols = (request.headers.get('sec-websocket-protocol') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const tokenProtocol = protocols.find((value) => value.startsWith('snapback.connection-token.'));
    const queryToken = url.searchParams.get('connection_token');
    if (queryToken && !request.headers.get('x-snapback-connection-token') && !tokenProtocol) {
      return kitError(
        401,
        'SNAPBACK_CONNECTION_TOKEN_QUERY_FORBIDDEN',
        'WebSocket connection tokens must use the connection-token header or snapback.connection-token subprotocol'
      );
    }
    const presented =
      request.headers.get('x-snapback-connection-token') ||
      (tokenProtocol ? tokenProtocol.slice('snapback.connection-token.'.length) : null);
    const denied = this.verifyConnection(connectionId, presented);
    if (denied) return denied;
    const connectionSocketLimit = this.socketsPerConnectionLimit();
    const priorConnectionSockets = this.ctx.getWebSockets(connectionId).filter((socket) => {
      try {
        return this.socketProtocolFor(socket) === 'kit';
      } catch (_) {
        return false;
      }
    });
    // A reconnect is a replacement, not an additional resource claim. Close
    // every older tagged socket before checking the physical fail-safe caps;
    // otherwise undetected network loss can strand a grant at its cap and
    // permanently reject legitimate reconnects.
    for (const socket of priorConnectionSockets) {
      try {
        socket.close(1008, 'socket session replaced');
      } catch (_) {}
    }
    // Count everything the runtime still reports after close requests. Some
    // runtimes unregister synchronously and others do so after this handler;
    // the latter get a retryable 429 for this attempt, never a soft cap that
    // admits limit + 1 physical sockets.
    const connectionSockets = this.ctx.getWebSockets(connectionId).filter((socket) => {
      try {
        return this.socketProtocolFor(socket) === 'kit';
      } catch (_) {
        return false;
      }
    }).length;
    if (connectionSockets >= connectionSocketLimit) {
      return kitError(
        429,
        'SNAPBACK_CONNECTION_SOCKET_LIMIT',
        `one connection grant is limited to ${connectionSocketLimit} accepted WebSockets`,
        { limit: connectionSocketLimit }
      );
    }
    const socketLimit = this.acceptedSocketLimit();
    if (this.ctx.getWebSockets().length >= socketLimit) {
      return kitError(
        429,
        'SNAPBACK_ACCEPTED_SOCKET_LIMIT',
        `the coordinator is limited to ${socketLimit} accepted WebSockets`,
        { limit: socketLimit }
      );
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const socketSessionId = `wss_${crypto.randomUUID()}`;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        'UPDATE _snapback_connections SET socket_session_id = ?, opened_at_ms = ? WHERE connection_id = ?',
        socketSessionId,
        Date.now(),
        connectionId
      );
      // A replacement socket owns a new session. Rows from the obsolete
      // session cannot represent demand and must not survive until its close
      // event (which may never arrive after hibernation/network loss).
      this.sql.exec(
        'DELETE FROM _snapback_subscriptions WHERE connection_id = ? AND socket_session_id IS NOT NULL AND socket_session_id <> ?',
        connectionId,
        socketSessionId
      );
    });
    this.ctx.acceptWebSocket(server, [connectionId]);
    server.serializeAttachment({ connectionId, protocol: 'kit', socketSessionId });
    await this.reconcileCronActivation();
    const headers = protocols.includes('snapback.v1') ? { 'sec-websocket-protocol': 'snapback.v1' } : undefined;
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  // --- live subscriptions ------------------------------------------------

  acceptLiveSocket(request) {
    const proofSockets = this.ctx.getWebSockets().filter((socket) => {
      try {
        return this.socketProtocolFor(socket) === 'proof';
      } catch (_) {
        return false;
      }
    }).length;
    const socketLimit = this.legacyProofSocketLimit();
    if (proofSockets >= socketLimit) {
      return requestDiagnostic(
        429,
        'SNAPBACK_LEGACY_PROOF_SOCKET_LIMIT',
        `the legacy proof WebSocket surface is limited to ${socketLimit} live sockets`,
        { limit: socketLimit }
      );
    }
    const totalSocketLimit = this.acceptedSocketLimit();
    if (this.ctx.getWebSockets().length >= totalSocketLimit) {
      return requestDiagnostic(
        429,
        'SNAPBACK_ACCEPTED_SOCKET_LIMIT',
        `the coordinator is limited to ${totalSocketLimit} accepted WebSockets`,
        { limit: totalSocketLimit }
      );
    }
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

  socketSessionFor(ws) {
    const attachment = ws.deserializeAttachment();
    return attachment && attachment.socketSessionId;
  }

  currentSocketSession(connectionId) {
    const records = [...this.sql.exec(
      'SELECT socket_session_id FROM _snapback_connections WHERE connection_id = ?',
      connectionId
    )];
    return records.length === 0 || records[0].socket_session_id == null
      ? null
      : String(records[0].socket_session_id);
  }

  async webSocketMessage(ws, message) {
    if (this.socketLimitError) {
      try { ws.close(1013, 'socket limits reconciling'); } catch (_) {}
      return;
    }
    // @ref LLP 0013#transport-contract — refuse over-limit or open-shaped
    // frames at the socket boundary before parsing or touching storage.
    const decoded = decodeLiveSocketFrame(message);
    if (!decoded.ok) {
      closeSocketWithDiagnostic(ws, decoded.closeCode, decoded.code);
      return;
    }
    const validated = validateLiveSocketFrame(decoded.value);
    if (!validated.ok) {
      closeSocketWithDiagnostic(ws, 1008, validated.code);
      return;
    }
    const parsed = validated.value;
    try {
      const connectionId = this.connectionIdFor(ws);
      if (this.socketProtocolFor(ws) === 'kit') {
        const socketSessionId = this.socketSessionFor(ws);
        if (!socketSessionId || socketSessionId !== this.currentSocketSession(connectionId)) {
          try { ws.close(1008, 'socket session replaced'); } catch (_) {}
          return;
        }
      }
      if (parsed.type === 'subscribe') {
        // Under the invocation mutex: the snapshot query, the version read, and
        // the registry insert must not interleave with a commit, or the rows
        // the snapshot carried predate a commit whose fan-out never saw the
        // registration — a silently skipped delta (ENG-23575).
        const socketSessionId = this.socketProtocolFor(ws) === 'kit' ? this.socketSessionFor(ws) : null;
        await this.runExclusive(() => {
          if (socketSessionId && socketSessionId !== this.currentSocketSession(connectionId)) return;
          return this.subscribe(ws, connectionId, parsed, socketSessionId);
        });
        await this.reconcileCronActivation();
      } else if (parsed.type === 'unsubscribe') {
        if (this.socketProtocolFor(ws) === 'kit') {
          this.sql.exec(
            'DELETE FROM _snapback_subscriptions WHERE subscription_id = ? AND connection_id = ? AND socket_session_id = ?',
            parsed.subscriptionId,
            connectionId,
            this.socketSessionFor(ws)
          );
        } else {
          this.sql.exec('DELETE FROM _snapback_subscriptions WHERE subscription_id = ? AND connection_id = ?', parsed.subscriptionId, connectionId);
        }
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
    } catch (_) {
      closeSocketWithDiagnostic(ws, 1011, 'SNAPBACK_LIVE_FRAME_PROCESSING_FAILED');
    }
  }

  async subscribe(ws, connectionId, parsed, socketSessionId = null) {
    const fn = this.functionByName(parsed.name);
    if (!fn) {
      ws.send(JSON.stringify({ type: 'error', code: 'SNAPBACK_LIVE_NOT_A_LIVE_QUERY', name: parsed.name }));
      return;
    }
    // @ref LLP 0040#whole-codebase-review-hardening-2026-07-12-eng-24341eng-24369--eng-24387eng-24388 —
    // every invocation boundary reports the same stable diagnostic for a
    // known function whose declared kind is incompatible with the route.
    if (fn.kind !== 'LiveQuery') {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'SNAPBACK_FUNCTION_KIND_MISMATCH',
        message: `${parsed.name} is declared ${fn.kind}, not live query`,
        details: { function: parsed.name, declaredKind: fn.kind, requestedMode: 'live-query' },
        name: parsed.name,
      }));
      return;
    }
    const argsJson = canonicalJson(parsed.args || {});
    const admission = this.subscriptionAdmission({
      connectionId,
      functionName: parsed.name,
      argsJson,
      supersedes: typeof parsed.supersedes === 'string' ? parsed.supersedes : null,
      socketSessionId,
    });
    if (!admission.ok) {
      ws.send(JSON.stringify({
        type: 'error',
        code: admission.code,
        message: admission.message,
        ...(admission.details ? { details: admission.details } : {}),
      }));
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
    if (socketSessionId && socketSessionId !== this.currentSocketSession(connectionId)) return;
    const version = result.observedVersion ?? this.currentVersion();
    const persisted = this.persistSubscription({
      connectionId,
      functionName: parsed.name,
      argsJson,
      supersedes: typeof parsed.supersedes === 'string' ? parsed.supersedes : null,
      socketSessionId,
    });
    if (!persisted.ok) {
      ws.send(JSON.stringify({
        type: 'error',
        code: persisted.code,
        message: persisted.message,
        ...(persisted.details ? { details: persisted.details } : {}),
      }));
      return;
    }
    ws.send(
      JSON.stringify({
        type: 'snapshot',
        subscriptionId: persisted.subscriptionId,
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
    // @ref LLP 0008#realtime-delivery — post-commit positive-data loss tears
    // down the affected socket and recovers through a fresh reconnect snapshot.
    try {
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
        if (!id) continue;
        if (this.socketProtocolFor(ws) === 'kit') {
          const session = this.socketSessionFor(ws);
          if (!session || session !== this.currentSocketSession(id)) continue;
        }
        byConnection.set(id, ws);
      }
      const subs = [];
      const affectedNames = [...affectedFunctions];
      if (affectedNames.length === 0) return;
      const selection = compileSubscriptionSelection(affectedNames);
      for (const record of this.sql.exec(selection.sql, ...selection.params)) {
        subs.push(record);
      }
      const groups = new Map();
      for (const sub of subs) {
        if (!affectedFunctions.has(sub.function_name)) continue;
        const ws = byConnection.get(sub.connection_id);
        if (!ws) continue;
        if (
          this.socketProtocolFor(ws) === 'kit' &&
          String(sub.socket_session_id || '') !== String(this.socketSessionFor(ws) || '')
        ) continue;
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
          connectionId: String(sub.connection_id),
          socketSessionId: sub.socket_session_id == null ? null : String(sub.socket_session_id),
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
    } catch (_) {
      try { this.recordFanOutFailure('SNAPBACK_LIVE_FANOUT_INTERNAL_FAILED'); } catch (_) {}
      try {
        for (const ws of this.ctx.getWebSockets()) {
          closeSocketWithDiagnostic(ws, 1011, 'SNAPBACK_LIVE_FANOUT_INTERNAL_FAILED');
        }
      } catch (_) {}
    }
  }

  async pushReplaceGroup(group) {
    let result;
    try {
      if (this.testFanOutQueryFailuresRemaining > 0) {
        this.testFanOutQueryFailuresRemaining -= 1;
        throw codedError('SNAPBACK_TEST_FANOUT_QUERY_FAILED', 'injected fan-out query failure');
      }
      result = await this.invokeHandler(group.functionName, 'query', JSON.parse(group.argsJson));
    } catch (_) {
      this.recoverFanOutGroup(group, 'SNAPBACK_LIVE_FANOUT_QUERY_FAILED');
      return;
    }
    if (!result.ok) {
      this.recoverFanOutGroup(group, 'SNAPBACK_LIVE_FANOUT_QUERY_FAILED');
      return;
    }

    const version = result.observedVersion ?? this.currentVersion();
    let encodedMembers;
    try {
      if (this.testFanOutSerializationFailuresRemaining > 0) {
        this.testFanOutSerializationFailuresRemaining -= 1;
        throw codedError('SNAPBACK_TEST_FANOUT_SERIALIZATION_FAILED', 'injected fan-out serialization failure');
      }
      encodedMembers = this.currentFanOutMembers(group.members).map((member) => {
        // Frame shape follows the socket's wire protocol: the kit client
        // consumes the local server's snake_case `kind` frames; the proof
        // acceptance suite pins the original camelCase `type` frames.
        const frame = member.protocol === 'kit'
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
        return { member, encoded: JSON.stringify(frame) };
      });
    } catch (_) {
      this.recoverFanOutGroup(group, 'SNAPBACK_LIVE_FANOUT_SERIALIZATION_FAILED');
      return;
    }

    for (const { member, encoded } of encodedMembers) {
      // Per-member isolation: one dead socket (a hibernation socket can race
      // its close event) must not suppress delivery to the rest of the group.
      if (!this.currentFanOutMembers([member]).length) continue;
      try {
        if (this.testFanOutSendFailuresRemaining > 0) {
          this.testFanOutSendFailuresRemaining -= 1;
          throw codedError('SNAPBACK_TEST_FANOUT_SEND_FAILED', 'injected fan-out send failure');
        }
        member.ws.send(encoded);
      } catch (_) {
        this.recordFanOutFailure('SNAPBACK_LIVE_FANOUT_SEND_FAILED');
        closeSocketWithDiagnostic(member.ws, 1011, 'SNAPBACK_LIVE_FANOUT_SEND_FAILED');
      }
    }
  }

  currentFanOutMembers(members) {
    return members.filter((member) =>
      member.protocol !== 'kit' ||
      member.socketSessionId === this.currentSocketSession(member.connectionId)
    );
  }

  recoverFanOutGroup(group, code) {
    this.recordFanOutFailure(code);
    for (const member of this.currentFanOutMembers(group.members)) {
      closeSocketWithDiagnostic(member.ws, 1011, code);
    }
  }

  recordFanOutFailure(code) {
    if (!Object.hasOwn(this.fanOutFailureCounters, code)) return;
    let persisted = false;
    try {
      this.sql.exec(
        `INSERT INTO _snapback_fanout_diagnostics (code, count, last_at_ms) VALUES (?, 1, ?)
         ON CONFLICT(code) DO UPDATE SET
           count = CASE WHEN count < ? THEN count + 1 ELSE count END,
           last_at_ms = excluded.last_at_ms`,
        code,
        Date.now(),
        Number.MAX_SAFE_INTEGER
      );
      persisted = true;
    } catch (_) {}
    if (!persisted) {
      this.fanOutFailureCounters[code] = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.fanOutFailureCounters[code] + 1
      );
    }
    try { console.warn('snapback live fan-out recovery', code); } catch (_) {}
  }

  fanOutDiagnostics() {
    const counters = { ...this.fanOutFailureCounters };
    try {
      for (const record of this.sql.exec('SELECT code, count FROM _snapback_fanout_diagnostics')) {
        const code = String(record.code);
        if (!Object.hasOwn(counters, code)) continue;
        counters[code] = Math.min(Number.MAX_SAFE_INTEGER, counters[code] + Number(record.count || 0));
      }
    } catch (_) {}
    return {
      counters,
      total: Math.min(
        Number.MAX_SAFE_INTEGER,
        Object.values(counters).reduce((sum, count) => sum + count, 0)
      ),
    };
  }

  async webSocketClose(ws) {
    const connectionId = this.connectionIdFor(ws);
    if (connectionId) {
      if (this.socketProtocolFor(ws) === 'kit') {
        const closingSession = this.socketSessionFor(ws);
        const currentSession = this.currentSocketSession(connectionId);
        if (currentSession && closingSession !== currentSession) return;
        this.sql.exec(
          'UPDATE _snapback_connections SET socket_session_id = NULL, opened_at_ms = ? WHERE connection_id = ? AND socket_session_id = ?',
          Date.now(),
          connectionId,
          closingSession
        );
        this.sql.exec(
          'DELETE FROM _snapback_subscriptions WHERE connection_id = ? AND socket_session_id = ?',
          connectionId,
          closingSession
        );
      } else {
        this.sql.exec('DELETE FROM _snapback_subscriptions WHERE connection_id = ?', connectionId);
      }
      // A departing socket may have been the last live subscriber: cancel
      // the warm-poll alarm so the idle object hibernates with zero wakeups.
      await this.reconcileCronActivation();
    }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  abandonActionsForReset() {
    for (const host of this.activeInvocations.values()) {
      if (host.mode !== 'action' || !host.control) continue;
      const message = 'the app was reset while this action was running; its buffered work was discarded';
      host.abandon('SNAPBACK_ACTION_RESET_ABORTED', message);
      if (host.control.abortController && !host.control.abortController.signal.aborted) {
        host.control.abortController.abort('SNAPBACK_ACTION_RESET_ABORTED');
      }
    }
  }

  resetOwnedTables() {
    const systemTables = [
      '_snapback_meta',
      '_snapback_changes',
      '_snapback_fanout_diagnostics',
      '_snapback_version',
      '_snapback_subscriptions_next',
      '_snapback_subscriptions',
      '_snapback_connections',
      '_snapback_connection_admission',
      '_snapback_cron_state',
      '_snapback_cron_claims',
      '_snapback_action_limits',
      '_snapback_action_mutation_results',
    ];
    const appTables = [...this.sql.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'app\\_%' ESCAPE '\\'"
    )].map((record) => String(record.name));
    for (const table of systemTables) {
      try {
        this.sql.exec(`DROP TABLE IF EXISTS ${table}`);
      } catch (error) {
        throw codedError('SNAPBACK_RESET_SCHEMA_REBUILD_FAILED', `could not drop ${table}: ${String(error && error.message || error)}`);
      }
    }
    for (const name of appTables) {
      if (!/^app_[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw codedError('SNAPBACK_RESET_OWNED_TABLE_INVALID', 'an owned app table has an invalid identifier');
      }
      try {
        this.sql.exec(`DROP TABLE "${name}"`);
      } catch (error) {
        throw codedError('SNAPBACK_RESET_SCHEMA_REBUILD_FAILED', `could not drop ${name}: ${String(error && error.message || error)}`);
      }
    }
  }

  async reset() {
    // Validate and serialize the compiled seed before the destructive
    // boundary. Any invalid artifact leaves the complete pre-reset state.
    const preparedSeed = appSeed ? this.prepareSeed(appSeed) : [];
    let seeded = false;
    const nextGeneration = this.nextResetGeneration();
    // @ref LLP 0028#scheduler-state-and-run-ledger — reset is an action
    // abandonment boundary; its generation is checked again at nested commit.
    this.ctx.storage.transactionSync(() => {
      this.resetOwnedTables();
      this.testResetFault('after-journal');
      this.sql.exec(`CREATE TABLE _snapback_meta (key TEXT PRIMARY KEY, value TEXT)`);
      // Recreate every known runtime table from this deployment. This does not
      // interpret an unknown future subscription schema and cannot retain a
      // retired app_* table or stale same-name index definition. Config cursor
      // state is deployment-owned and intentionally survives app reset.
      this.ensureCurrentSchema();
      this.testResetFault('after-runtime-state');
      this.testResetFault('after-app-rows');
      this.writeDeploymentMetadata();
      this.writeMeta('app_generation', String(nextGeneration));
      if (preparedSeed.length > 0) {
        this.applyPreparedSeed(preparedSeed, Date.now());
        seeded = true;
      }
      this.testResetFault('after-seed');
    });
    // Actions execute off the coordinator mutex. Publish abandonment only
    // after the SQL reset commits (a rolled-back reset must not kill valid
    // work). No await separates the commit from this loop, and queued nested
    // commits cannot enter until this reset releases the mutex. The persisted
    // generation also catches staged-but-not-yet-registered actions.
    this.abandonActionsForReset();
    // Only publish the recovered startup posture after the transaction
    // commits; a rolled-back reset must retain its stale refusal too.
    this.startupError = null;
    // Subscriptions and cron state are gone: drop any armed object alarm.
    const cleanupWarnings = [];
    try {
      if (this.env.SNAPBACK_TESTING === '1' && this.env.SNAPBACK_TEST_RESET_POST_COMMIT_ALARM_FAILURE === '1') {
        throw codedError('SNAPBACK_RESET_ALARM_CLEANUP_FAILED', 'injected post-commit alarm cleanup failure');
      }
      await this.reconcileCronActivation();
    } catch (error) {
      // The SQL transaction above is the reset linearization point. Alarm
      // cleanup is recoverable (a stale alarm wakes once, observes no armed
      // state, and disarms); it must never turn a committed reset into a 500
      // that falsely promises the old state survived.
      cleanupWarnings.push({
        code: (error && error.snapbackCode) || 'SNAPBACK_RESET_ALARM_CLEANUP_DEFERRED',
        message: 'reset committed, but alarm cleanup was deferred to the next coordinator wake',
      });
      console.warn('snapback reset post-commit alarm cleanup deferred', String((error && error.message) || error));
    }
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const frame =
          this.socketProtocolFor(ws) === 'kit'
            ? { kind: 'resync_required', reason: 'reset' }
            : { type: 'resync_required', reason: 'reset' };
        ws.send(JSON.stringify(frame));
      } catch (_) {}
    }
    return json(200, {
      reset: true,
      seeded,
      cleanup: cleanupWarnings.length === 0 ? 'complete' : 'deferred',
      ...(cleanupWarnings.length > 0 ? { warnings: cleanupWarnings } : {}),
    });
  }

  testResetFault(step) {
    if (this.env.SNAPBACK_TESTING === '1' && this.env.SNAPBACK_TEST_RESET_FAIL_AFTER === step) {
      throw codedError('SNAPBACK_RESET_INJECTED_FAILURE', `injected reset failure at ${step}`);
    }
  }
}

// A stale-deployment refusal (SNAPBACK_STALE_CLOUDFLARE_*): served on every
// data-plane request until the operator resets or migrates, never silently
// served over mismatched persistent state.
function staleArtifact(code, message, details) {
  return { ok: false, code, message, details };
}

function codedError(code, message, details = null) {
  const error = new Error(`${code}: ${message}`);
  error.snapbackCode = code;
  error.snapbackDetails = details;
  return error;
}

function functionTables(fn) {
  if (Array.isArray(fn.tables) && fn.tables.length > 0) return fn.tables;
  return [schema.tables[0].name];
}

function functionKindMatchesMode(kind, mode) {
  if (mode === 'query') return kind === 'Query' || kind === 'LiveQuery';
  if (mode === 'mutation') return kind === 'Mutation';
  if (mode === 'action') return kind === 'Action';
  return false;
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value ?? {}));
}

function decodeLiveSocketFrame(message) {
  let text;
  if (typeof message === 'string') {
    if (utf8ByteLengthExceeds(message, MAX_LIVE_SOCKET_FRAME_BYTES)) {
      return { ok: false, closeCode: 1009, code: 'SNAPBACK_LIVE_FRAME_TOO_LARGE' };
    }
    text = message;
  } else {
    let bytes;
    if (message instanceof ArrayBuffer) {
      bytes = new Uint8Array(message);
    } else if (ArrayBuffer.isView(message)) {
      bytes = new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
    } else {
      return { ok: false, closeCode: 1003, code: 'SNAPBACK_LIVE_FRAME_TYPE_UNSUPPORTED' };
    }
    if (bytes.byteLength > MAX_LIVE_SOCKET_FRAME_BYTES) {
      return { ok: false, closeCode: 1009, code: 'SNAPBACK_LIVE_FRAME_TOO_LARGE' };
    }
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_) {
      return { ok: false, closeCode: 1007, code: 'SNAPBACK_LIVE_FRAME_INVALID_UTF8' };
    }
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (_) {
    return { ok: false, closeCode: 1007, code: 'SNAPBACK_LIVE_FRAME_INVALID_JSON' };
  }
  return { ok: true, value };
}

function utf8ByteLengthExceeds(value, limitBytes) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x7f) {
      bytes += 1;
    } else if (unit <= 0x7ff) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      // BMP code points and unpaired surrogates both occupy three bytes under
      // TextEncoder's well-formed replacement behavior.
      bytes += 3;
    }
    if (bytes > limitBytes) return true;
  }
  return false;
}

function validateLiveSocketFrame(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'SNAPBACK_LIVE_FRAME_INVALID' };
  }
  const keys = Object.keys(value);
  const hasClosedKeys = (required, optional = []) => {
    const allowed = new Set([...required, ...optional]);
    return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key));
  };
  if (value.type === 'subscribe') {
    if (
      !hasClosedKeys(['type', 'name', 'args'], ['supersedes']) ||
      typeof value.name !== 'string' ||
      value.name.length === 0 ||
      !value.args ||
      typeof value.args !== 'object' ||
      Array.isArray(value.args) ||
      (Object.hasOwn(value, 'supersedes') && (typeof value.supersedes !== 'string' || value.supersedes.length === 0))
    ) {
      return { ok: false, code: 'SNAPBACK_LIVE_FRAME_INVALID' };
    }
    return { ok: true, value };
  }
  if (value.type === 'unsubscribe') {
    if (
      !hasClosedKeys(['type', 'subscriptionId']) ||
      typeof value.subscriptionId !== 'string' ||
      value.subscriptionId.length === 0
    ) {
      return { ok: false, code: 'SNAPBACK_LIVE_FRAME_INVALID' };
    }
    return { ok: true, value };
  }
  if (value.type === 'ping') {
    if (
      !hasClosedKeys(['type'], ['requestId']) ||
      (Object.hasOwn(value, 'requestId') && typeof value.requestId !== 'string')
    ) {
      return { ok: false, code: 'SNAPBACK_LIVE_FRAME_INVALID' };
    }
    return { ok: true, value };
  }
  return { ok: false, code: 'SNAPBACK_LIVE_FRAME_INVALID' };
}

function closeSocketWithDiagnostic(ws, closeCode, diagnosticCode) {
  try { ws.close(closeCode, diagnosticCode); } catch (_) {}
}

function configuredTestFailureCount(value, env) {
  if (env.SNAPBACK_TESTING !== '1') return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 10) : 0;
}

function boundUtf8Text(value, limitBytes) {
  const text = String(value || '');
  const encoded = UTF8_ENCODER.encode(text);
  if (encoded.byteLength <= limitBytes) return text;
  const suffix = '...[truncated]';
  const suffixBytes = UTF8_ENCODER.encode(suffix).byteLength;
  let end = Math.max(0, limitBytes - suffixBytes);
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
  return `${new TextDecoder().decode(encoded.subarray(0, end))}${suffix}`;
}

function secretRedactionPatterns(value) {
  const raw = String(value || '');
  if (!raw) return [];
  const normalized = new Set([raw]);
  try { normalized.add(raw.normalize('NFC')); } catch (_) {}
  try { normalized.add(raw.normalize('NFD')); } catch (_) {}
  const patterns = [];

  // Match one whole normalized secret while permitting each UTF-16 code unit
  // to appear either raw or as a JSON Unicode escape. Building the alternation
  // per unit covers full and partially escaped strings, surrogate-pair escapes
  // for astral characters, and mixed hex casing (the regexp is insensitive)
  // without ever redacting a mere prefix of the secret.
  for (const candidate of normalized) {
    const units = [];
    for (let index = 0; index < candidate.length; index += 1) {
      const unit = candidate.charCodeAt(index);
      const alternatives = [
        regexEscape(candidate[index]),
        jsonBackslashEscapePattern(`u${unit.toString(16).padStart(4, '0')}`),
      ];
      const shortEscape = jsonShortEscape(unit);
      if (shortEscape) alternatives.push(jsonBackslashEscapePattern(shortEscape.slice(1)));
      units.push(`(?:${alternatives.join('|')})`);
    }
    patterns.push(new RegExp(units.join(''), 'gi'));
  }

  const variants = new Set(normalized);
  // Include two reversible URL/form encoding layers; proxies and JSON APIs
  // commonly echo an already-encoded query value after encoding it again.
  for (let round = 0; round < 2; round += 1) {
    for (const candidate of [...variants]) {
      try { variants.add(encodeURIComponent(candidate)); } catch (_) {}
      try {
        const params = new URLSearchParams();
        params.set('v', candidate);
        variants.add(params.toString().slice(2));
      } catch (_) {}
    }
  }
  for (const encoded of [...variants].sort((left, right) => right.length - left.length)) {
    if (encoded.length > 0 && !normalized.has(encoded)) patterns.push(new RegExp(regexEscape(encoded), 'gi'));
  }
  return patterns;
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function jsonBackslashEscapePattern(suffix) {
  // `\\+` in the regexp means one-or-more literal backslashes. A JSON body
  // that itself carries a textual `\uXXXX` escape doubles that backslash;
  // accepting either depth (and further reversible JSON wrapping) prevents
  // the encoding layer from becoming a redaction bypass.
  return `\\\\+${regexEscape(suffix)}`;
}

function jsonShortEscape(unit) {
  if (unit === 0x08) return '\\b';
  if (unit === 0x09) return '\\t';
  if (unit === 0x0a) return '\\n';
  if (unit === 0x0c) return '\\f';
  if (unit === 0x0d) return '\\r';
  if (unit === 0x22) return '\\"';
  if (unit === 0x2f) return '\\/';
  if (unit === 0x5c) return '\\\\';
  return null;
}

function normalizeSqlDefinition(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function workerVersionMetadata(env) {
  const metadata = env && env.SNAPBACK_VERSION_METADATA;
  if (!metadata || typeof metadata !== 'object' || typeof metadata.id !== 'string' || metadata.id.length === 0) {
    return null;
  }
  return {
    id: metadata.id,
    tag: typeof metadata.tag === 'string' ? metadata.tag : '',
    timestamp: typeof metadata.timestamp === 'string' ? metadata.timestamp : '',
  };
}

async function readBoundedTextStream(stream, limitBytes) {
  if (stream === null) return { ok: true, text: '' };
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limitBytes) {
        await reader.cancel('SNAPBACK_HOST_FETCH_RESPONSE_TOO_LARGE');
        return {
          ok: false,
          code: 'SNAPBACK_HOST_FETCH_RESPONSE_TOO_LARGE',
          message: `host fetch response exceeded ${limitBytes} bytes`,
        };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } catch (_) {
    try { await reader.cancel('SNAPBACK_HOST_FETCH_RESPONSE_INVALID_UTF8'); } catch (_) {}
    return {
      ok: false,
      code: 'SNAPBACK_HOST_FETCH_RESPONSE_INVALID_UTF8',
      message: 'host fetch response was not valid UTF-8',
    };
  }
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  // A normal object's magic __proto__ setter can swallow an owned JSON key,
  // making the persisted subscription args differ from the initial query.
  // Null-prototype output preserves every JSON-owned key through stringify.
  const sorted = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJson(value[key]);
  }
  return sorted;
}

function configuredPendingInvocationLimit(env) {
  const configured = Number(env.SNAPBACK_MAX_PENDING_INVOCATIONS);
  // A zero-capacity queue is a deterministic testing seam for the admission
  // envelope. Production always accepts at least one invocation, and no
  // override may raise the cap above the request-chain-safe default.
  if (env.SNAPBACK_TESTING === '1' && configured === 0) return 0;
  if (Number.isSafeInteger(configured) && configured > 0) {
    return Math.min(configured, DEFAULT_MAX_PENDING_INVOCATIONS);
  }
  return DEFAULT_MAX_PENDING_INVOCATIONS;
}

function failure(result) {
  const body = { ok: false, code: result.code, message: result.message };
  if (result.details) body.details = result.details;
  return body;
}

// Kit-protocol errors carry the local server's ApiError envelope — a non-2xx
// status with a structured `diagnostic` — which demos/_kit/client.mjs turns
// into its coded Error (and keys grant refresh on).
function kitError(status, code, message, details = null) {
  return json(status, { diagnostic: { code, message, ...(details ? { details } : {}) } });
}

function kitFailure(result) {
  const body = { diagnostic: { code: result.code, message: result.message } };
  if (result.details) body.diagnostic.details = result.details;
  return json(clientFailureCode(result.code) ? 400 : 500, body);
}

function clientFailureCode(code) {
  return new Set([
    'SNAPBACK_FUNCTION_KIND_MISMATCH',
    'SNAPBACK_UNKNOWN_TABLE',
    'SNAPBACK_UNKNOWN_FIELD',
    'SNAPBACK_QUERY_UNKNOWN_INDEX',
    'SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED',
    'SNAPBACK_QUERY_FILTER_VALUE_INVALID',
    'SNAPBACK_QUERY_IN_ITEMS_EXCEEDED',
    'SNAPBACK_QUERY_LIMIT_INVALID',
    'SNAPBACK_FIELD_MISSING',
    'SNAPBACK_FIELD_TYPE_MISMATCH',
    'SNAPBACK_SYSTEM_FIELD_WRITE',
  ]).has(code);
}

function requestDiagnostic(status, code, message, details = null) {
  const diagnostic = { code, message, ...(details ? { details } : {}) };
  // Keep both the proof protocol's top-level code and the kit protocol's
  // diagnostic envelope so every JSON endpoint has one stable 4xx shape.
  return json(status, { ok: false, code, message, diagnostic });
}

async function parseJsonObjectRequest(request, { allowEmpty = false } = {}) {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return {
      ok: false,
      response: requestDiagnostic(
        413,
        'SNAPBACK_REQUEST_TOO_LARGE',
        `JSON request body exceeds the ${MAX_REQUEST_BYTES}-byte limit`,
        { limitBytes: MAX_REQUEST_BYTES }
      ),
    };
  }

  const contentType = (request.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    if (allowEmpty && request.body === null) return { ok: true, value: {} };
    return {
      ok: false,
      response: requestDiagnostic(
        415,
        'SNAPBACK_CONTENT_TYPE_UNSUPPORTED',
        'JSON endpoints require Content-Type: application/json'
      ),
    };
  }

  let text = '';
  let totalBytes = 0;
  if (request.body !== null) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_REQUEST_BYTES) {
          await reader.cancel('SNAPBACK_REQUEST_TOO_LARGE');
          return {
            ok: false,
            response: requestDiagnostic(
              413,
              'SNAPBACK_REQUEST_TOO_LARGE',
              `JSON request body exceeds the ${MAX_REQUEST_BYTES}-byte limit`,
              { limitBytes: MAX_REQUEST_BYTES }
            ),
          };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch (_) {
      try {
        await reader.cancel('SNAPBACK_UTF8_INVALID');
      } catch (_) {}
      return {
        ok: false,
        response: requestDiagnostic(400, 'SNAPBACK_UTF8_INVALID', 'request body is not valid UTF-8'),
      };
    }
  }
  if (text.trim().length === 0) {
    if (allowEmpty) return { ok: true, value: {} };
    return {
      ok: false,
      response: requestDiagnostic(400, 'SNAPBACK_JSON_BODY_REQUIRED', 'a JSON object request body is required'),
    };
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch (_) {
    return {
      ok: false,
      response: requestDiagnostic(400, 'SNAPBACK_JSON_INVALID', 'request body is not valid JSON'),
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      response: requestDiagnostic(400, 'SNAPBACK_JSON_OBJECT_REQUIRED', 'request body must be a JSON object'),
    };
  }
  return { ok: true, value };
}

function json(status, value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
