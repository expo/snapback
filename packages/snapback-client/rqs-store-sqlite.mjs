// Module-neutral SQLite carrier for the one-domain RQS store. Expo supplies
// `expo-sqlite`; qualification and contract tests supply an API-compatible
// Node adapter. No platform module is reachable from this package.
//
// @ref LLP 0166#d1--one-store-domain — every resident section and the
//   predecessor fence is committed through one WAL database and connection.
// @ref LLP 0043#settlement-consumption-and-acknowledgement-lifecycle-2026-08-01 — outbox transitions and acknowledgement custody
//   cross the same durable transaction boundary as retained query state.
// @ref LLP 0166#d1--one-store-domain — authority wipes rotate the local handle key while
//   preserving monotone store high-waters and queued-intent custody.

import { hex, sha256 } from './rqs.mjs';
import {
  allOutboxRecords,
  createOutboxAuthorizationDispatchGate,
  emptyOutboxState,
  outboxOps,
  outboxAuthorizationStatus,
  pendingAcknowledgementsFor,
  pendingOutboxRecords,
  unresolvedOutboxRecords,
  validateOutboxState,
} from './outbox-shared.mjs';
import {
  prepareReactBindingReceipt,
  rqsEntryRecordBytes,
  rqsEvictionOrder,
  RQS_STORE_MAX_BYTES,
  RQS_STORE_MAX_ENTRIES,
} from './rqs-store.mjs';
import {
  allocateOfflineMutationReplayCapabilityObservationInMeta,
  allocateQueryInstanceIdInMeta,
  compareAndVersionOfflineMutationReplayCapabilityFact,
  createInitialStoreMeta,
  prepareOfflineMutationReplayCapabilityObservation,
  prepareStoreMeta,
  wipeStoreMeta,
} from './rqs-store-meta.mjs';

export const EXPO_SQLITE_STORE_SCHEMA_VERSION = 1;
export const EXPO_SQLITE_STORE_PROFILE = 'durable-fragments-v1';

const TABLES = Object.freeze([
  'store_meta',
  'entries',
  'materializations',
  'page_sets',
  'memberships',
  'outbox',
  'react_binding_receipt',
  'predecessor_fences',
]);
const tableSql = (table, { ifNotExists = false } = {}) => `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${table} (
  record_key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  format_version INTEGER NOT NULL CHECK (format_version = 1)
) WITHOUT ROWID`;
const EXPECTED_COLUMNS = Object.freeze([
  Object.freeze({ cid: 0, name: 'record_key', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1, hidden: 0 }),
  Object.freeze({ cid: 1, name: 'value_json', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0, hidden: 0 }),
  Object.freeze({ cid: 2, name: 'content_digest', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0, hidden: 0 }),
  Object.freeze({ cid: 3, name: 'format_version', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0, hidden: 0 }),
]);
const MAP_SECTIONS = Object.freeze({
  entries: 'entries',
  materializations: 'materializations',
  pageSets: 'page_sets',
  memberships: 'memberships',
});
const encoder = new TextEncoder();

function storeError(code, message, details = {}, cause = undefined) {
  const error = new Error(`${code}: ${message}`, cause === undefined ? undefined : { cause });
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
}

const closedError = () => storeError(
  'SNAPBACK_EXPO_SQLITE_STORE_CLOSED',
  'the Expo SQLite RQS store is closed',
);

const corruptError = (message = 'SQLite RQS store bytes failed validation', details = {}) => (
  storeError('SNAPBACK_EXPO_SQLITE_STORE_CORRUPT', message, details)
);

const isBusy = (error) => (
  error?.code === 'SQLITE_BUSY'
  || error?.code === 'SQLITE_LOCKED'
  || /\b(?:SQLITE_)?(?:BUSY|LOCKED)\b/iu.test(String(error?.message ?? ''))
);
const isFull = (error) => (
  error?.code === 'SQLITE_FULL'
  || /\bSQLITE_FULL\b|database or disk is full/iu.test(String(error?.message ?? ''))
);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const canonicalJson = (value) => JSON.stringify(canonicalize(value));
const digestFor = (table, key, json) => (
  `sha256:${hex(sha256(encoder.encode(`${table}\0${key}\0${json}`)))}`
);
const clone = (value) => structuredClone(value);
const firstValue = (row) => row == null ? null : Object.values(row)[0];
const normalizePragma = (value) => String(value ?? '').toLowerCase();
const normalizeSchemaSql = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();

const requireDatabaseApi = (database) => {
  for (const name of ['execAsync', 'runAsync', 'getFirstAsync', 'getAllAsync', 'closeAsync']) {
    if (typeof database?.[name] !== 'function') {
      throw storeError(
        'SNAPBACK_EXPO_SQLITE_NATIVE_API_UNAVAILABLE',
        `SQLite database is missing ${name}()`,
      );
    }
  }
};

export async function createSqliteRqsResumeStore({
  sqlite,
  databaseName,
  now = () => Date.now(),
  maxBytes = RQS_STORE_MAX_BYTES,
  maxEntries = RQS_STORE_MAX_ENTRIES,
  clientStoreId = null,
  randomBytes = undefined,
  platformOperatingSystem = null,
  onBeforeStoreIdentityRotation = null,
  relaunchOutboxEmpty = null,
  faultInjector = null,
  qualificationMaxPageCount = null,
  runtimeKind = 'main-app',
} = {}) {
  if (runtimeKind !== 'main-app') {
    throw storeError(
      'SNAPBACK_EXPO_SQLITE_MULTI_PROCESS_HOST_UNSUPPORTED',
      'the EXCLUSIVE Expo SQLite carrier supports only the ordinary main-app runtime',
      { runtimeKind },
    );
  }
  if (typeof sqlite?.openDatabaseAsync !== 'function') {
    throw storeError(
      'SNAPBACK_EXPO_SQLITE_NATIVE_API_UNAVAILABLE',
      'SQLite namespace requires openDatabaseAsync()',
    );
  }
  if (typeof databaseName !== 'string' || databaseName.length === 0) {
    throw new TypeError('databaseName must be a non-empty string');
  }
  if (faultInjector !== null && typeof faultInjector !== 'function') {
    throw new TypeError('faultInjector must be a function or null');
  }

  let database;
  try {
    database = await sqlite.openDatabaseAsync(databaseName, { useNewConnection: true });
    requireDatabaseApi(database);
  } catch (error) {
    if (isBusy(error)) {
      throw storeError(
        'SNAPBACK_EXPO_SQLITE_STORE_OWNER_UNAVAILABLE',
        'another SQLite connection owns the RQS store',
        { databaseName },
        error,
      );
    }
    if (typeof error?.code === 'string' && error.code.startsWith('SNAPBACK_')) throw error;
    throw storeError(
      'SNAPBACK_EXPO_SQLITE_NATIVE_API_UNAVAILABLE',
      'the SQLite native bridge could not open a dedicated connection',
      { databaseName, causeCode: error?.code ?? null },
      error,
    );
  }

  let closed = false;
  let callbackActive = false;
  let chain = Promise.resolve();
  const writerLockListeners = new Set();
  const step = async (label, operation) => {
    await faultInjector?.(`${label}:before`);
    const result = await operation();
    await faultInjector?.(label);
    return result;
  };
  const exec = (sql, label = `sql:${sql}`) => step(label, () => database.execAsync(sql));
  const run = (sql, parameters, label) => (
    step(label ?? `sql:${sql}`, () => database.runAsync(sql, ...parameters))
  );
  const first = (sql, parameters = [], label) => (
    step(label ?? `sql:${sql}`, () => database.getFirstAsync(sql, ...parameters))
  );
  const all = (sql, parameters = [], label) => (
    step(label ?? `sql:${sql}`, () => database.getAllAsync(sql, ...parameters))
  );
  const requireOpen = () => {
    if (closed) throw closedError();
    if (callbackActive) {
      throw storeError(
        'SNAPBACK_EXPO_SQLITE_TRANSACTION_REENTRANT',
        'SQLite RQS materialization callbacks must not re-enter the store',
      );
    }
  };
  const serialized = (operation) => {
    requireOpen();
    const result = chain.then(() => {
      if (closed) throw closedError();
      return operation();
    });
    chain = result.then(() => {}, () => {});
    return result;
  };

  const rollback = async () => {
    try { await database.execAsync('ROLLBACK'); } catch { /* already rolled back */ }
  };
  const writeTransaction = async (label, operation) => {
    try {
      await exec('BEGIN IMMEDIATE', `${label}:begin-immediate`);
    } catch (error) {
      if (isBusy(error)) {
        throw storeError(
          'SNAPBACK_EXPO_SQLITE_STORE_OWNER_UNAVAILABLE',
          'the SQLite RQS writer owner is unavailable',
          { databaseName, phase: label },
          error,
        );
      }
      throw error;
    }
    try {
      const result = await operation();
      await exec('COMMIT', `${label}:commit`);
      return result;
    } catch (error) {
      await rollback();
      if (isFull(error)) {
        throw storeError(
          'SNAPBACK_EXPO_SQLITE_CAPACITY_EXCEEDED',
          'SQLite refused the complete transaction because its page limit was reached',
          { databaseName, phase: label },
          error,
        );
      }
      throw error;
    }
  };

  const readRecord = async (table, key) => {
    const row = await first(
      `SELECT value_json, content_digest, format_version FROM ${table} WHERE record_key = ?`,
      [key],
      `read:${table}:${key}`,
    );
    if (row == null) return null;
    if (row.format_version !== 1) {
      throw corruptError('SQLite RQS record has an unknown format version', { table, key });
    }
    if (digestFor(table, key, row.value_json) !== row.content_digest) {
      throw corruptError('SQLite RQS record digest mismatch', { table, key });
    }
    try { return JSON.parse(row.value_json); } catch {
      throw corruptError('SQLite RQS record is not valid JSON', { table, key });
    }
  };
  const writeRecord = async (table, key, value) => {
    const json = canonicalJson(value);
    await run(
      `INSERT OR REPLACE INTO ${table}
       (record_key, value_json, content_digest, format_version)
       VALUES (?, ?, ?, 1)`,
      [key, json, digestFor(table, key, json)],
      `write:${table}:${key}`,
    );
  };
  const deleteRecord = (table, key) => run(
    `DELETE FROM ${table} WHERE record_key = ?`,
    [key],
    `delete:${table}:${key}`,
  );
  const readMap = async (table) => {
    const rows = await all(
      `SELECT record_key, value_json, content_digest, format_version FROM ${table} ORDER BY record_key`,
      [],
      `read-map:${table}`,
    );
    const result = new Map();
    for (const row of rows) {
      if (
        row.format_version !== 1
        || digestFor(table, row.record_key, row.value_json) !== row.content_digest
      ) throw corruptError('SQLite RQS section digest mismatch', { table, key: row.record_key });
      try { result.set(String(row.record_key), JSON.parse(row.value_json)); } catch {
        throw corruptError('SQLite RQS section contains invalid JSON', { table, key: row.record_key });
      }
    }
    return result;
  };
  const replaceMap = async (table, values) => {
    if (!(values instanceof Map)) {
      throw corruptError('materialization transaction replaced a section with a non-Map', { table });
    }
    await exec(`DELETE FROM ${table}`, `replace:${table}:clear`);
    for (const [key, value] of values) await writeRecord(table, String(key), value);
  };
  const readMeta = async () => {
    const meta = prepareStoreMeta(await readRecord('store_meta', 'state'));
    if (meta === null) throw corruptError('SQLite RQS store metadata is invalid');
    return meta;
  };
  const readOutbox = async () => {
    const state = validateOutboxState(await readRecord('outbox', 'state'));
    if (state === null) throw corruptError('SQLite RQS outbox state is invalid');
    return state;
  };

  const validateVersionOneSchema = async () => {
    const schemaRows = await all(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
      [],
      'schema:validate:sqlite-schema',
    );
    if (schemaRows.length !== TABLES.length) {
      throw corruptError('SQLite RQS v1 schema has an unexpected object set', {
        expectedTables: TABLES,
        observed: schemaRows.map((row) => ({ type: row.type, name: row.name })),
      });
    }
    for (const table of TABLES) {
      const schema = schemaRows.find((row) => row.name === table);
      if (
        schema?.type !== 'table'
        || schema?.tbl_name !== table
        || normalizeSchemaSql(schema?.sql) !== normalizeSchemaSql(tableSql(table))
      ) {
        throw corruptError('SQLite RQS v1 table definition does not match the exact schema', {
          table,
          observedType: schema?.type ?? null,
          observedTable: schema?.tbl_name ?? null,
          observedSql: schema?.sql ?? null,
        });
      }
      const columns = await all(
        `PRAGMA table_xinfo(${table})`,
        [],
        `schema:validate:columns:${table}`,
      );
      const projected = columns.map((column) => ({
        cid: Number(column.cid),
        name: String(column.name),
        type: String(column.type),
        notnull: Number(column.notnull),
        dflt_value: column.dflt_value ?? null,
        pk: Number(column.pk),
        hidden: Number(column.hidden),
      }));
      if (canonicalJson(projected) !== canonicalJson(EXPECTED_COLUMNS)) {
        throw corruptError('SQLite RQS v1 table columns do not match the exact schema', {
          table,
          observed: projected,
        });
      }
    }
  };

  let facts;
  try {
    // The binding order is contractual: configure the connection, acquire an
    // EXCLUSIVE writer cut, then and only then inspect or create schema.
    await exec('PRAGMA locking_mode=EXCLUSIVE', 'pragma:set:locking_mode');
    await exec('PRAGMA journal_mode=WAL', 'pragma:set:journal_mode');
    await exec('PRAGMA synchronous=FULL', 'pragma:set:synchronous');
    await exec('PRAGMA foreign_keys=ON', 'pragma:set:foreign_keys');
    const apple = platformOperatingSystem === 'ios' || platformOperatingSystem === 'macos';
    if (apple) await exec('PRAGMA fullfsync=ON', 'pragma:set:fullfsync');
    if (qualificationMaxPageCount !== null) {
      if (!Number.isSafeInteger(qualificationMaxPageCount) || qualificationMaxPageCount < 1) {
        throw new TypeError('qualificationMaxPageCount must be a positive safe integer');
      }
      await exec(
        `PRAGMA max_page_count=${qualificationMaxPageCount}`,
        'pragma:set:max_page_count',
      );
    }
    await exec('BEGIN IMMEDIATE', 'pragma:ownership:begin-immediate');
    await exec('COMMIT', 'pragma:ownership:commit');

    const [lockingMode, journalMode, synchronous, foreignKeys, fullfsync, sqliteVersion,
      sqliteSourceId, compileOptions] = await Promise.all([
      first('PRAGMA locking_mode', [], 'pragma:read:locking_mode'),
      first('PRAGMA journal_mode', [], 'pragma:read:journal_mode'),
      first('PRAGMA synchronous', [], 'pragma:read:synchronous'),
      first('PRAGMA foreign_keys', [], 'pragma:read:foreign_keys'),
      apple ? first('PRAGMA fullfsync', [], 'pragma:read:fullfsync') : Promise.resolve(null),
      first('SELECT sqlite_version() AS value', [], 'engine:version'),
      first('SELECT sqlite_source_id() AS value', [], 'engine:source-id'),
      all('PRAGMA compile_options', [], 'engine:compile-options'),
    ]);
    const readbacks = Object.freeze({
      lockingMode: normalizePragma(firstValue(lockingMode)),
      journalMode: normalizePragma(firstValue(journalMode)),
      synchronous: Number(firstValue(synchronous)),
      foreignKeys: Number(firstValue(foreignKeys)),
      fullfsync: apple ? Number(firstValue(fullfsync)) : null,
    });
    if (
      readbacks.lockingMode !== 'exclusive'
      || readbacks.journalMode !== 'wal'
      || readbacks.synchronous !== 2
      || readbacks.foreignKeys !== 1
      || (apple && readbacks.fullfsync !== 1)
    ) {
      throw storeError(
        'SNAPBACK_EXPO_SQLITE_DURABILITY_PRAGMAS_UNAVAILABLE',
        'SQLite did not retain the required durability pragma profile',
        { databaseName, readbacks },
      );
    }
    const check = normalizePragma(firstValue(await first(
      'PRAGMA quick_check',
      [],
      'integrity:quick-check',
    )));
    if (check !== 'ok') throw corruptError('SQLite quick_check failed', { result: check });
    const userVersion = Number(firstValue(await first(
      'PRAGMA user_version',
      [],
      'schema:read:user-version',
    )));
    if (!Number.isSafeInteger(userVersion) || userVersion > EXPO_SQLITE_STORE_SCHEMA_VERSION) {
      throw corruptError('SQLite RQS schema is from an unsupported future version', { userVersion });
    }
    // A database that already advertises v1 is immutable evidence. Validate
    // its exact sqlite_schema and columns before any idempotent DDL can repair
    // a missing/corrupt durable section into an apparently empty successor.
    if (userVersion === EXPO_SQLITE_STORE_SCHEMA_VERSION) {
      await validateVersionOneSchema();
    } else {
      await exec(TABLES.map((table) => tableSql(table, { ifNotExists: true })).join(';'), 'schema:create:tables');
    }
    if (userVersion === 0) {
      await writeTransaction('schema-initialize', async () => {
        await writeRecord('store_meta', 'state', createInitialStoreMeta({
          clientStoreId,
          randomBytes,
        }));
        await writeRecord('store_meta', 'cleanup', { required: false });
        await writeRecord('outbox', 'state', emptyOutboxState());
        await exec(
          `PRAGMA user_version=${EXPO_SQLITE_STORE_SCHEMA_VERSION}`,
          'schema:set:user-version',
        );
      });
    }
    await readMeta();
    await readOutbox();
    // Boot validates every row before any retained fact or queued custody can
    // be exposed. Section-specific consumers perform their deeper validators
    // after this digest/format/JSON gate.
    for (const table of TABLES) await readMap(table);
    const cleanup = await readRecord('store_meta', 'cleanup');
    if (cleanup?.required === true) {
      await exec('PRAGMA wal_checkpoint(TRUNCATE)', 'boot-cleanup:checkpoint');
      await writeTransaction('boot-cleanup-clear', () => (
        writeRecord('store_meta', 'cleanup', { required: false })
      ));
    }
    facts = Object.freeze({
      profile: EXPO_SQLITE_STORE_PROFILE,
      schemaVersion: EXPO_SQLITE_STORE_SCHEMA_VERSION,
      databaseName,
      sqliteVersion: String(firstValue(sqliteVersion)),
      sqliteSourceId: String(firstValue(sqliteSourceId)),
      compileOptions: Object.freeze(compileOptions.map((row) => String(firstValue(row))).sort()),
      pragmas: readbacks,
    });
  } catch (error) {
    try { await database.closeAsync(); } catch { /* preserve original refusal */ }
    if (isBusy(error)) {
      throw storeError(
        'SNAPBACK_EXPO_SQLITE_STORE_OWNER_UNAVAILABLE',
        'another SQLite connection owns the RQS store',
        { databaseName },
        error,
      );
    }
    if (typeof error?.code === 'string' && error.code.startsWith('SNAPBACK_')) throw error;
    throw corruptError(
      'SQLite RQS database could not complete boot integrity/schema validation',
      { databaseName, causeCode: error?.code ?? null },
    );
  }

  const mutateOutbox = (label, operation) => serialized(() => writeTransaction(label, async () => {
    const applied = operation(await readOutbox());
    await writeRecord('outbox', 'state', applied.state);
    return clone(applied.result);
  }));
  const withAuthorizationDispatch = createOutboxAuthorizationDispatchGate();

  const wipeSections = async ({ preserveOutbox }) => {
    const meta = wipeStoreMeta(await readMeta(), { randomBytes });
    if (meta === null) return false;
    for (const table of ['entries', 'materializations', 'page_sets', 'memberships']) {
      await exec(`DELETE FROM ${table}`, `wipe:${table}`);
    }
    await exec('DELETE FROM react_binding_receipt', 'wipe:react-binding-receipt');
    if (!preserveOutbox) await writeRecord('outbox', 'state', emptyOutboxState());
    await writeRecord('store_meta', 'state', meta);
    await writeRecord('store_meta', 'cleanup', { required: true });
    return true;
  };
  const durableWipe = (preserveOutbox) => serialized(async () => {
    const wiped = await writeTransaction('authority-wipe', () => wipeSections({ preserveOutbox }));
    if (!wiped) return false;
    await exec('PRAGMA wal_checkpoint(TRUNCATE)', 'authority-wipe:checkpoint-truncate');
    await writeTransaction('authority-wipe-cleanup-confirm', () => (
      writeRecord('store_meta', 'cleanup', { required: false })
    ));
    return true;
  });
  const authorityTransitionWipeWithinDispatch = (
    authorityTransitionKey = null,
    authorityTransitionEpoch = null,
    options = undefined,
  ) => serialized(async () => {
    let authorityCurrent = false;
    const wiped = await writeTransaction('authority-wipe', async () => {
      const advanced = outboxOps.advanceAuthorizationAuthority(
        await readOutbox(),
        authorityTransitionKey,
        authorityTransitionEpoch,
        options,
      );
      if (advanced.result.status === 'authority-current') {
        authorityCurrent = true;
        return true;
      }
      const sectionsWiped = await wipeSections({ preserveOutbox: true });
      if (!sectionsWiped) return false;
      await writeRecord('outbox', 'state', advanced.state);
      return true;
    });
    if (!wiped || authorityCurrent) return wiped;
    await exec('PRAGMA wal_checkpoint(TRUNCATE)', 'authority-wipe:checkpoint-truncate');
    await writeTransaction('authority-wipe-cleanup-confirm', () => (
      writeRecord('store_meta', 'cleanup', { required: false })
    ));
    return true;
  });
  const authorityTransitionWipe = (...args) => withAuthorizationDispatch(
    () => authorityTransitionWipeWithinDispatch(...args),
  );

  const store = {
    isWriter() { return !closed; },
    whenLockSettled() { return Promise.resolve(); },
    withOutboxAuthorizationDispatch(operation, options = undefined) {
      return withAuthorizationDispatch(operation, options);
    },
    subscribeWriterLock(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      writerLockListeners.add(listener);
      return () => writerLockListeners.delete(listener);
    },
    durability() {
      return { implementation: 'expo-sqlite', durable: true };
    },
    qualificationFacts() { return facts; },
    qualificationIntegrityCheck() {
      return serialized(async () => normalizePragma(firstValue(await first(
        'PRAGMA integrity_check',
        [],
        'qualification:integrity-check',
      ))));
    },

    materializationTransaction(mode, operation) {
      if (mode !== 'readonly' && mode !== 'readwrite') {
        return Promise.reject(new TypeError('materialization transaction mode must be readonly or readwrite'));
      }
      if (typeof operation !== 'function') {
        return Promise.reject(new TypeError('materialization transaction operation must be a function'));
      }
      return serialized(async () => {
        const transact = async () => {
          const view = {
            materializations: await readMap('materializations'),
            pageSets: await readMap('page_sets'),
            memberships: await readMap('memberships'),
            entries: await readMap('entries'),
            outbox: clone(await readOutbox()),
            storeMeta: clone(await readMeta()),
          };
          callbackActive = true;
          let result;
          try { result = operation(view); } finally { callbackActive = false; }
          if (result && typeof result.then === 'function') {
            throw new TypeError('materialization transaction callbacks must be synchronous');
          }
          if (mode === 'readwrite') {
            const meta = prepareStoreMeta(view.storeMeta);
            const outbox = validateOutboxState(view.outbox);
            if (meta === null || outbox === null) {
              throw corruptError('materialization transaction produced invalid state');
            }
            await replaceMap('materializations', view.materializations);
            await replaceMap('page_sets', view.pageSets);
            await replaceMap('memberships', view.memberships);
            await replaceMap('entries', view.entries);
            await writeRecord('outbox', 'state', outbox);
            await writeRecord('store_meta', 'state', meta);
          }
          return result;
        };
        return mode === 'readwrite' ? writeTransaction('materialization', transact) : transact();
      });
    },

    outboxEmpty() {
      return serialized(async () => {
        if (relaunchOutboxEmpty !== null && (await relaunchOutboxEmpty()) !== true) return false;
        const outbox = await readOutbox();
        return unresolvedOutboxRecords(outbox).length === 0
          && outboxAuthorizationStatus(outbox).suspended === false;
      });
    },
    loadReactBindingReceipt() {
      return serialized(async () => clone(await readRecord('react_binding_receipt', 'state')));
    },
    commitReactBindingReceipt(receipt) {
      const stored = prepareReactBindingReceipt(receipt);
      if (stored === null) return Promise.resolve(false);
      return serialized(() => writeTransaction('react-binding-receipt', async () => {
        await writeRecord('react_binding_receipt', 'state', stored);
        return true;
      }));
    },
    readOfflineMutationReplayCapabilityFact() {
      return serialized(async () => clone(
        (await readMeta()).offlineMutationReplayCapabilityFact,
      ));
    },
    beginOfflineMutationReplayCapabilityObservation() {
      return serialized(() => writeTransaction(
        'offline-replay-capability-observation',
        async () => {
          const allocated = allocateOfflineMutationReplayCapabilityObservationInMeta(
            await readMeta(),
          );
          if (allocated === null) {
            throw corruptError('refusing invalid offline replay capability observation');
          }
          await writeRecord('store_meta', 'state', allocated.meta);
          return clone(allocated.observation);
        },
      ));
    },
    commitOfflineMutationReplayCapabilityFact(fact, observation = null) {
      if (observation === false) return Promise.resolve(false);
      return serialized(() => writeTransaction('offline-replay-capability-fact', async () => {
        const current = await readMeta();
        let workingMeta = current;
        let preparedObservation = prepareOfflineMutationReplayCapabilityObservation(observation);
        if (preparedObservation === null) {
          const allocated = allocateOfflineMutationReplayCapabilityObservationInMeta(current);
          if (allocated === null) {
            throw corruptError('refusing invalid offline replay capability observation');
          }
          workingMeta = allocated.meta;
          preparedObservation = allocated.observation;
        }
        if (
          preparedObservation.requestSequence
          > workingMeta.generationCounters.offlineReplayCapabilityRequestHighWater
        ) return false;
        const versioned = compareAndVersionOfflineMutationReplayCapabilityFact(
          current.offlineMutationReplayCapabilityFact,
          fact,
          preparedObservation,
        );
        if (versioned?.committed === false) return false;
        const replacement = versioned === null ? null : prepareStoreMeta({
          ...workingMeta,
          offlineMutationReplayCapabilityFact: versioned.fact,
        });
        if (replacement === null) {
          throw corruptError('refusing invalid offline replay capability fact');
        }
        await writeRecord('store_meta', 'state', replacement);
        return clone(versioned.fact);
      }));
    },
    readStoreMeta() { return serialized(async () => clone(await readMeta())); },
    writeStoreMeta(value) {
      return serialized(() => writeTransaction('store-meta-write', async () => {
        const replacement = prepareStoreMeta(value);
        if (replacement === null) throw corruptError('refusing invalid RQS store metadata');
        const current = await readMeta();
        if (
          replacement.clientStoreId !== current.clientStoreId
          || replacement.queryInstanceIdHighWater < current.queryInstanceIdHighWater
          || [
            'writerGeneration',
            'authorityGenerationHighWater',
            'queryGenerationHighWater',
            'offlineReplayCapabilityRequestHighWater',
          ]
            .some((field) => replacement.generationCounters[field] < current.generationCounters[field])
        ) {
          throw storeError(
            'SNAPBACK_RQS_STORE_META_REGRESSION',
            'store metadata cannot rotate identity or lower monotone high-waters',
          );
        }
        await writeRecord('store_meta', 'state', replacement);
        return true;
      }));
    },
    allocateQueryInstanceId() {
      return serialized(() => writeTransaction('allocate-query-instance', async () => {
        const allocated = allocateQueryInstanceIdInMeta(await readMeta());
        if (allocated === null) throw corruptError('RQS store metadata is invalid');
        await writeRecord('store_meta', 'state', allocated.meta);
        return allocated.queryInstanceId;
      }));
    },
    load(key) {
      if (typeof key !== 'string' || key.length === 0) return Promise.resolve(null);
      return serialized(async () => clone(await readRecord('entries', key)));
    },
    commit(key, { rows, meta, token }) {
      if (typeof key !== 'string' || key.length === 0) {
        return Promise.resolve({ persisted: false, reason: 'key' });
      }
      return serialized(async () => {
        const bytes = rqsEntryRecordBytes({ rows, meta, token });
        if (bytes > maxBytes) {
          await writeTransaction('entry-oversize-delete', () => deleteRecord('entries', key));
          return { persisted: false, reason: 'oversize' };
        }
        try {
          return await writeTransaction('entry-commit', async () => {
            const entries = await readMap('entries');
            const existing = entries.get(key);
            entries.set(key, { rows, meta, token, bytes, savedAt: now(), resumedAt: existing?.resumedAt ?? 0, inProgress: false });
            const candidates = [...entries.entries()]
              .filter(([candidate]) => candidate !== key)
              .map(([candidate, entry]) => ({ key: candidate, ...entry }))
              .sort(rqsEvictionOrder);
            let totalBytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
            const evicted = [];
            while ((totalBytes > maxBytes || entries.size > maxEntries) && candidates.length > 0) {
              const victim = candidates.shift();
              entries.delete(victim.key);
              totalBytes -= victim.bytes;
              evicted.push(victim.key);
            }
            await replaceMap('entries', entries);
            return { persisted: true, reason: null, bytes, evicted };
          });
        } catch (error) {
          if (error?.code === 'SNAPBACK_EXPO_SQLITE_CAPACITY_EXCEEDED') {
            return { persisted: false, reason: 'capacity' };
          }
          throw error;
        }
      });
    },
    markInProgress(key) {
      return serialized(() => writeTransaction('entry-mark-in-progress', async () => {
        const existing = await readRecord('entries', key);
        if (existing === null) return false;
        await writeRecord('entries', key, { ...existing, inProgress: true });
        return true;
      }));
    },
    markResumed(key, at = now()) {
      return serialized(() => writeTransaction('entry-mark-resumed', async () => {
        const existing = await readRecord('entries', key);
        if (existing === null) return false;
        await writeRecord('entries', key, { ...existing, resumedAt: at });
        return true;
      }));
    },
    remove(key) {
      return serialized(() => writeTransaction('entry-remove', async () => {
        await deleteRecord('entries', key);
        return true;
      }));
    },
    wipe() { return durableWipe(false); },
    wipeForAuthorityTransition: authorityTransitionWipe,
    wipeForAuthorityTransitionWithinDispatch: authorityTransitionWipeWithinDispatch,
    requestAuthorityTransitionWipe(...args) {
      requireOpen();
      return Object.freeze({
        settlement: Promise.resolve().then(() => store.wipeForAuthorityTransition(...args)),
      });
    },
    async resetCorruptStoreIdentity() {
      requireOpen();
      await onBeforeStoreIdentityRotation?.({ carrier: 'expo-sqlite', databaseName });
      return { reset: false, reason: 'not_corrupt' };
    },

    outboxEnqueue(record, expectedAuthorizationFence = null) {
      return mutateOutbox('outbox-enqueue', (state) => (
        outboxOps.enqueue(state, record, now(), expectedAuthorizationFence)
      ));
    },
    outboxEnqueueWithOperationIdentity(
      record,
      authorityCohortKey,
      range = null,
      expectedAuthorizationFence = null,
    ) {
      return mutateOutbox('outbox-enqueue-identity', (state) => (
        outboxOps.enqueueWithOperationIdentity(
          state,
          record,
          now(),
          authorityCohortKey,
          range,
          expectedAuthorizationFence,
        )
      ));
    },
    outboxAssignOperationIdentity(
      id,
      key,
      range = null,
      descriptor = undefined,
      principal = undefined,
      expectedAuthorizationFence = null,
    ) {
      return mutateOutbox('outbox-assign-identity', (state) => (
        outboxOps.assignOperationIdentity(
          state,
          id,
          now(),
          key,
          range,
          descriptor,
          principal,
          expectedAuthorizationFence,
        )
      ));
    },
    outboxOperationIdentityRange(key) {
      return serialized(async () => clone(outboxOps.operationIdentityRange(await readOutbox(), key).result));
    },
    outboxPending() { return serialized(async () => clone(pendingOutboxRecords(await readOutbox()))); },
    outboxAuthorizationStatus() {
      return serialized(async () => clone(outboxAuthorizationStatus(await readOutbox())));
    },
    outboxAuthorizationTransitionVisible(kind, payload, expectedAuthorityGeneration = null) {
      return serialized(async () => outboxOps.authorizationTransitionVisible(
        await readOutbox(), kind, payload, expectedAuthorityGeneration,
      ).result);
    },
    outboxApplyAuthorizationObligation(obligation, expectedAuthorityGeneration = null) {
      return mutateOutbox('outbox-authorization-obligation', (state) => (
        outboxOps.applyAuthorizationObligation(state, obligation, expectedAuthorityGeneration)
      ));
    },
    outboxResolveAuthorizationObligation(resolution, expectedAuthorityGeneration = null) {
      return mutateOutbox('outbox-authorization-resolution', (state) => (
        outboxOps.resolveAuthorizationObligation(state, resolution, expectedAuthorityGeneration)
      ));
    },
    outboxAcknowledgeAuthorizationResolution(resolution, expectedAuthorityGeneration = null) {
      return mutateOutbox('outbox-authorization-resolution-ack', (state) => (
        outboxOps.acknowledgeAuthorizationResolution(
          state, resolution, expectedAuthorityGeneration,
        )
      ));
    },
    outboxRetireAuthorizationScopes(scopes, expectedAuthorityGeneration = null) {
      return mutateOutbox('outbox-authorization-retire', (state) => (
        outboxOps.retireAuthorizationScopes(state, scopes, expectedAuthorityGeneration)
      ));
    },
    outboxPrepareSubmission(id, options = undefined) {
      return mutateOutbox('outbox-prepare-submission', (state) => outboxOps.prepareSubmission(
        state,
        id,
        { ...(options ?? {}), now: now() },
      ));
    },
    outboxRecords() { return serialized(async () => clone(allOutboxRecords(await readOutbox()))); },
    outboxSettle(id, expectedAuthorizationFence = null) {
      return mutateOutbox('outbox-settle', (state) => (
        outboxOps.settle(state, id, expectedAuthorizationFence)
      ));
    },
    outboxDurablyConsume(
      id,
      settlement,
      userId = null,
      confirmed = [],
      expectedAuthorizationFence = null,
    ) {
      return mutateOutbox('outbox-durably-consume', (state) => (
        outboxOps.durablyConsume(
          state, id, settlement, userId, now(), confirmed, expectedAuthorizationFence,
        )
      ));
    },
    outboxMarkFailed(id, failure, expectedAuthorizationFence = null) {
      return mutateOutbox('outbox-mark-failed', (state) => (
        outboxOps.markFailed(state, id, failure, expectedAuthorizationFence)
      ));
    },
    outboxMarkStranded(
      id,
      reason,
      predecessorPrincipalScope = null,
      expectedAuthorizationFence = null,
      effectProvenance = null,
    ) {
      return mutateOutbox('outbox-mark-stranded', (state) => (
        outboxOps.markStranded(
          state,
          id,
          reason,
          now(),
          predecessorPrincipalScope,
          expectedAuthorizationFence,
          effectProvenance,
        )
      ));
    },
    outboxReconcileCustody(
      principalScope,
      descriptor,
      custody,
      expectedAuthorityGeneration = null,
    ) {
      return mutateOutbox('outbox-reconcile-custody', (state) => (
        outboxOps.reconcileCustody(
          state,
          principalScope,
          descriptor,
          custody,
          now(),
          expectedAuthorityGeneration,
        )
      ));
    },
    outboxDiscardStranded(ids, principalScope, expectedAuthorizationFence = null) {
      return mutateOutbox('outbox-discard-stranded', (state) => (
        outboxOps.discardStranded(
          state,
          ids,
          principalScope,
          expectedAuthorizationFence,
        )
      ));
    },
    outboxMarkQuarantined(id, refusal, expectedAuthorizationFence = null) {
      return mutateOutbox('outbox-mark-quarantined', (state) => (
        outboxOps.markQuarantined(
          state,
          id,
          refusal,
          now(),
          expectedAuthorizationFence,
        )
      ));
    },
    outboxReenterQuarantined(expectedAuthorizationFence = null) {
      return mutateOutbox('outbox-reenter-quarantined', (state) => (
        outboxOps.reenterQuarantined(state, expectedAuthorizationFence)
      ));
    },
    outboxMarkResultGone(id, resultGone, expectedAuthorizationFence = null) {
      return mutateOutbox('outbox-result-gone', (state) => (
        outboxOps.markResultGone(state, id, resultGone, expectedAuthorizationFence)
      ));
    },
    outboxDiscard(id, expectedAuthorizationFence = null) {
      return mutateOutbox('outbox-discard', (state) => (
        outboxOps.discard(state, id, expectedAuthorizationFence)
      ));
    },
    outboxRecordAcknowledgement(id, userId = null, descriptor = null) {
      return mutateOutbox('outbox-record-ack', (state) => outboxOps.recordAck(state, id, userId, descriptor));
    },
    outboxPendingAcknowledgements(userId = null, limit = 64, descriptor = null) {
      return serialized(async () => pendingAcknowledgementsFor(await readOutbox(), userId, limit, descriptor));
    },
    outboxMarkAcknowledgementsReady(ids, userId = undefined, descriptor = undefined) {
      return mutateOutbox('outbox-acks-ready', (state) => outboxOps.markAcksReady(state, ids, userId, descriptor));
    },
    outboxConfirmAcknowledgements(
      ids,
      userId = undefined,
      descriptor = undefined,
      expectedAuthorizationFence = null,
    ) {
      return mutateOutbox('outbox-acks-confirmed', (state) => (
        outboxOps.confirmAcks(
          state,
          ids,
          userId,
          descriptor,
          expectedAuthorizationFence,
        )
      ));
    },

    predecessorFences() {
      return serialized(async () => clone([...await readMap('predecessor_fences').then((map) => map.values())]));
    },
    recordPredecessorFence(fence) {
      if (
        fence === null || typeof fence !== 'object'
        || typeof fence.predecessorClientStoreId !== 'string'
        || typeof fence.predecessorHandleKey !== 'string'
        || typeof fence.pathIdentity !== 'string'
      ) return Promise.reject(new TypeError('predecessor fence requires exact predecessor identity fields'));
      const key = `${fence.predecessorClientStoreId}:${fence.pathIdentity}`;
      return serialized(() => writeTransaction('predecessor-fence', async () => {
        const existingFence = await readRecord('predecessor_fences', key);
        if (existingFence !== null) return clone(existingFence);
        const occupied = (await Promise.all([
          readMap('entries'),
          readMap('materializations'),
          readMap('page_sets'),
          readMap('memberships'),
          readMap('predecessor_fences'),
        ])).some((section) => section.size !== 0)
          || allOutboxRecords(await readOutbox()).length !== 0;
        if (occupied) {
          throw corruptError('predecessor fence can only initialize an empty SQLite successor');
        }
        // Migration's exposed successor identity and its exact predecessor
        // fence land in this one transaction. The schema bootstrap identity
        // is never exposed and may be discarded here.
        const current = createInitialStoreMeta({ randomBytes });
        if (
          current.clientStoreId === fence.predecessorClientStoreId
          || current.handleKey === fence.predecessorHandleKey
        ) throw corruptError('fresh SQLite identity collides with its legacy predecessor');
        const stored = {
          schemaVersion: 1,
          disposition: 'discard-and-refetch',
          predecessorClientStoreId: fence.predecessorClientStoreId,
          predecessorHandleKey: fence.predecessorHandleKey,
          pathIdentity: fence.pathIdentity,
          pendingDelete: true,
          fencedAt: now(),
        };
        await writeRecord('store_meta', 'state', current);
        await writeRecord('predecessor_fences', key, stored);
        return clone(stored);
      }));
    },
    confirmPredecessorAbsent(predecessorClientStoreId, pathIdentity) {
      const key = `${predecessorClientStoreId}:${pathIdentity}`;
      return serialized(() => writeTransaction('predecessor-confirm-absent', async () => {
        const fence = await readRecord('predecessor_fences', key);
        if (fence === null) return false;
        await writeRecord('predecessor_fences', key, {
          ...fence,
          pendingDelete: false,
          confirmedAbsentAt: now(),
        });
        return true;
      }));
    },

    inspection() {
      return serialized(async () => {
        const entries = await readMap('entries');
        const outbox = await readOutbox();
        return Object.freeze({
          writer: true,
          corrupt: false,
          entries: entries.size,
          bytes: [...entries.values()].reduce((sum, entry) => sum + (entry?.bytes ?? 0), 0),
          maxBytes,
          maxEntries,
          facts,
          outbox: Object.freeze({
            pending: pendingOutboxRecords(outbox).length,
            failed: allOutboxRecords(outbox).filter((record) => record.status === 'failed').length,
            stranded: allOutboxRecords(outbox).filter((record) => record.status === 'stranded').length,
            quarantined: allOutboxRecords(outbox).filter((record) => record.status === 'quarantined').length,
            resultGone: allOutboxRecords(outbox).filter((record) => record.status === 'result-gone').length,
            pendingAcknowledgements: outbox.acks.length,
          }),
        });
      });
    },
    async close() {
      if (closed) return;
      const closing = chain.then(async () => {
        if (closed) return;
        try { await database.execAsync('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
        await database.closeAsync();
        closed = true;
        for (const listener of [...writerLockListeners]) {
          try { listener(false); } catch { /* observation only */ }
        }
        writerLockListeners.clear();
      });
      chain = closing.then(() => {}, () => {});
      await closing;
    },
  };

  return store;
}

// The Expo-facing name makes call sites and qualification receipts explicit;
// it is intentionally only an alias over the injected, module-neutral core.
export const createExpoSqliteRqsResumeStore = createSqliteRqsResumeStore;
