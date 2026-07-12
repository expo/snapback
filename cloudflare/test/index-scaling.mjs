// ENG-24361 strict acceptance: deterministic scaling evidence for both the
// manifest-declared row index and the internal fan-out selection index.
//
// @ref LLP 0007#index-contract — declared indexes are production query inputs.
// @ref LLP 0040#measurements — Worker synchronous wall time is not a valid
//   benchmark clock, so this gate uses exact query plans and materialized
//   candidate counts instead of machine-dependent timing thresholds.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import schemaManifest from '../../demos/all-aboard/snapback/generated/schema.manifest.json' with { type: 'json' };
import functionsManifest from '../../demos/all-aboard/snapback/generated/functions.manifest.json' with { type: 'json' };
import { HostContext, physicalIndexName } from '../src/host-ops.js';
import {
  compileSubscriptionSelection,
  SUBSCRIPTION_FUNCTION_INDEX,
} from '../src/subscription-selection.js';

const table = schemaManifest.tables.find((entry) => entry.name === 'stations');
assert.ok(table, 'the All Aboard manifest must retain the stations table');
const index = table.indexes.find((entry) => entry.name === 'by_order');
assert.ok(index, 'the All Aboard manifest must retain stations.by_order');
assert.deepEqual(index.fields, ['orderIndex']);
assert.ok(
  functionsManifest.functions.some((fn) => fn.name === 'liveDepartures' && fn.kind === 'LiveQuery'),
  'the fan-out fixture must use a deployed All Aboard live-query identity'
);
assert.deepEqual(
  compileSubscriptionSelection(['liveDepartures', 'feedState']),
  {
    sql: 'SELECT * FROM _snapback_subscriptions WHERE function_name IN (?, ?)',
    params: ['liveDepartures', 'feedState'],
  },
  'the extracted selector must preserve the production multi-function query exactly'
);
assert.throws(() => compileSubscriptionSelection([]), /at least one function/);

const physicalTable = `app_${table.name}`;
const declaredIndex = physicalIndexName(table.name, index.name);
const targetOrder = 7;
const matchingRows = 8;
const matchingSubscriptions = 8;
const series = [
  { rowCount: 64, subscriptionCount: 64 },
  { rowCount: 512, subscriptionCount: 512 },
  { rowCount: 4096, subscriptionCount: 2048 },
];

function createFixture({ rowCount, subscriptionCount }) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE ${physicalTable} (id TEXT PRIMARY KEY, row_json TEXT NOT NULL);
    CREATE INDEX ${declaredIndex}
      ON ${physicalTable} (json_extract(row_json, '$.orderIndex'));
    CREATE TABLE _snapback_subscriptions (
      subscription_id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      function_name TEXT NOT NULL,
      args_json TEXT NOT NULL,
      socket_session_id TEXT,
      UNIQUE(connection_id, function_name, args_json)
    );
    CREATE INDEX ${SUBSCRIPTION_FUNCTION_INDEX}
      ON _snapback_subscriptions (function_name);
  `);

  const insertRow = db.prepare(`INSERT INTO ${physicalTable} (id, row_json) VALUES (?, ?)`);
  const insertSubscription = db.prepare(`
    INSERT INTO _snapback_subscriptions
      (subscription_id, connection_id, function_name, args_json, socket_session_id)
    VALUES (?, ?, ?, '{}', NULL)
  `);
  db.exec('BEGIN');
  try {
    for (let position = 0; position < rowCount; position += 1) {
      const id = `row-${String(position).padStart(5, '0')}`;
      insertRow.run(
        id,
        JSON.stringify({
          _id: id,
          _version: 1,
          _createdAt: position,
          _updatedAt: position,
          stationId: `station-${position}`,
          name: `Station ${position}`,
          shortName: `S${position}`,
          orderIndex: position < matchingRows ? targetOrder : position + 100,
          minutesFromSf: position,
          zone: 1,
          lat: 37,
          lng: -122,
          photoUrl: `https://example.test/${position}.jpg`,
          photoAttribution: 'fixture',
        })
      );
    }
    for (let position = 0; position < subscriptionCount; position += 1) {
      const serial = String(position).padStart(5, '0');
      insertSubscription.run(
        `sub-${serial}`,
        `connection-${serial}`,
        position < matchingSubscriptions ? 'liveDepartures' : `unaffected_${position}`
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  db.exec('ANALYZE');
  return db;
}

function detailsFor(db, sql, params) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => String(row.detail));
}

function captureProductionRowQuery(plan) {
  const calls = [];
  const host = new HostContext({
    sql: {
      exec(sql, ...params) {
        calls.push({ sql, params });
        return [];
      },
    },
    mode: 'query',
    nowMs: 0,
    epoch: 'index-scaling-acceptance',
    newId: () => 'unused',
    tables: new Set([table.name]),
    schemaTables: new Map([[table.name, table]]),
  });
  assert.deepEqual(host.storageQuery(physicalTable, plan), []);
  assert.equal(calls.length, 1, 'storageQuery must execute one SQLite statement');
  return calls[0];
}

function assertSearchesIndex(details, expectedIndex) {
  assert.equal(details.length, 1, `expected one query-plan operation: ${JSON.stringify(details)}`);
  assert.match(details[0], /^SEARCH /, `expected indexed SEARCH, got ${JSON.stringify(details)}`);
  assert.ok(details[0].includes(expectedIndex), `expected ${expectedIndex}, got ${JSON.stringify(details)}`);
  assert.doesNotMatch(details[0], /^SCAN /);
}

function measure(point) {
  const db = createFixture(point);
  try {
    const rowPlan = {
      table: table.name,
      filters: [{ field: index.fields[0], op: 'Eq', value: { Literal: targetOrder } }],
      order: [],
      limit: null,
      indexed_by: index.name,
    };
    const compiledRows = captureProductionRowQuery(rowPlan);
    const rowDetails = detailsFor(db, compiledRows.sql, compiledRows.params);
    const rows = db.prepare(compiledRows.sql).all(...compiledRows.params);
    assertSearchesIndex(rowDetails, declaredIndex);
    assert.equal(rows.length, matchingRows);

    const compiledSubscriptions = compileSubscriptionSelection(['liveDepartures']);
    const subscriptionDetails = detailsFor(db, compiledSubscriptions.sql, compiledSubscriptions.params);
    const subscriptions = db.prepare(compiledSubscriptions.sql).all(...compiledSubscriptions.params);
    assertSearchesIndex(subscriptionDetails, SUBSCRIPTION_FUNCTION_INDEX);
    assert.equal(subscriptions.length, matchingSubscriptions);

    return {
      ...point,
      rowQuery: {
        queryPlanOperations: rowDetails.length,
        queryPlan: rowDetails,
        rowRecordsMaterialized: rows.length,
      },
      fanOutSelection: {
        queryPlanOperations: subscriptionDetails.length,
        queryPlan: subscriptionDetails,
        subscriptionRecordsMaterialized: subscriptions.length,
      },
    };
  } finally {
    db.close();
  }
}

const measurements = series.map(measure);
assert.deepEqual(
  measurements.map((entry) => entry.rowQuery.rowRecordsMaterialized),
  series.map(() => matchingRows),
  'declared-index candidate work must depend on matches, not total row count'
);
assert.deepEqual(
  measurements.map((entry) => entry.fanOutSelection.subscriptionRecordsMaterialized),
  series.map(() => matchingSubscriptions),
  'fan-out candidate work must depend on affected subscriptions, not registry size'
);

// Sensitivity controls: the gate must reject each pre-fix failure mode rather
// than merely printing a favorable result. The declared withIndex query fails
// closed when its index is absent; the internal selector becomes a table scan
// and is rejected by the same plan assertion when its index is absent.
{
  const db = createFixture(series[0]);
  try {
    const rowPlan = {
      table: table.name,
      filters: [{ field: index.fields[0], op: 'Eq', value: { Literal: targetOrder } }],
      order: [],
      limit: null,
      indexed_by: index.name,
    };
    const compiledRows = captureProductionRowQuery(rowPlan);
    db.exec(`DROP INDEX ${declaredIndex}`);
    assert.throws(() => db.prepare(compiledRows.sql), /no such index/i);

    db.exec(`DROP INDEX ${SUBSCRIPTION_FUNCTION_INDEX}`);
    const compiledSubscriptions = compileSubscriptionSelection(['liveDepartures']);
    const scanDetails = detailsFor(db, compiledSubscriptions.sql, compiledSubscriptions.params);
    assert.match(scanDetails[0], /^SCAN /);
    assert.throws(
      () => assertSearchesIndex(scanDetails, SUBSCRIPTION_FUNCTION_INDEX),
      /expected indexed SEARCH/
    );
  } finally {
    db.close();
  }
}

console.log(JSON.stringify({
  benchmark: 'cloudflare-index-scaling-v1',
  method: 'SQLite query-plan operations and materialized candidate records; no wall-clock thresholds',
  declaredIndex: `${table.name}.${index.name}`,
  internalIndex: SUBSCRIPTION_FUNCTION_INDEX,
  matchingRows,
  matchingSubscriptions,
  measurements,
  sensitivityControls: {
    missingDeclaredIndex: 'query preparation rejected',
    missingSubscriptionIndex: 'table scan detected and rejected',
  },
}, null, 2));
