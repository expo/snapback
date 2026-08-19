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
import { HostContext, applyPlan, physicalIndexName } from '../src/host-ops.js';
import { compileHostPlanStorageQuery } from '../src/rqs-host.mjs';
import {
  compileSubscriptionSelection,
  compileSubscriptionSelections,
  SUBSCRIPTION_FUNCTION_INDEX,
  SUBSCRIPTION_SELECTION_MAX_FUNCTIONS,
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
const chunkedFunctionNames = Array.from(
  { length: SUBSCRIPTION_SELECTION_MAX_FUNCTIONS + 1 },
  (_, index) => `live_${index}`,
);
const chunkedSelections = compileSubscriptionSelections(chunkedFunctionNames);
assert.equal(chunkedSelections.length, 2, 'large manifests must use bounded indexed selectors');
assert.equal(chunkedSelections[0].params.length, SUBSCRIPTION_SELECTION_MAX_FUNCTIONS);
assert.equal(chunkedSelections[1].params.length, 1);
assert.deepEqual(
  chunkedSelections.flatMap((selection) => selection.params),
  chunkedFunctionNames,
  'selector chunking must preserve every live function exactly once',
);

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

function captureProductionRowQuery(plan, schemaTable = table) {
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
    tables: new Set([schemaTable.name]),
    schemaTables: new Map([[schemaTable.name, schemaTable]]),
  });
  assert.deepEqual(host.storageQuery(physicalTable, plan), []);
  assert.equal(calls.length, 1, 'storageQuery must execute one SQLite statement');
  return calls[0];
}

function executeProductionRowQuery(db, plan) {
  const host = new HostContext({
    sql: {
      exec(sql, ...params) {
        return db.prepare(sql).all(...params);
      },
    },
    mode: 'query',
    nowMs: 0,
    epoch: 'query-ordering-acceptance',
    newId: () => 'unused',
    tables: new Set([table.name]),
    schemaTables: new Map([[table.name, table]]),
  });
  return host.storageQuery(physicalTable, plan);
}

// Native HostPlan evaluation must compile its admitted Eq filter and limit
// into the same indexed SQLite query as ctx.db.query, not materialize the
// entire table for a second JS pass.
{
  const compiled = compileHostPlanStorageQuery({
    table: table.name,
    indexed_by: index.name,
    filters: [{ field: index.fields[0], op: 'Eq', value: { Arg: 'targetOrder' } }],
    order: [],
    limit: 3,
  }, { targetOrder });
  assert.equal(compiled?.empty, false);
  const captured = captureProductionRowQuery(compiled.plan);
  assert.match(captured.sql, new RegExp(`INDEXED BY ${declaredIndex}`));
  assert.match(captured.sql, /WHERE json_extract\(row_json, '\$\.orderIndex'\) = \? LIMIT \?$/);
  assert.deepEqual(captured.params, [targetOrder, 3]);
}

// LLP 0007 ordering conformance: Durable Object SQLite and the buffered
// in-memory overlay both put null last in either direction and use `_id` as
// the stable final tie-break. Limits therefore select the same rows before
// and after a buffered commit.
{
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ${physicalTable} (id TEXT PRIMARY KEY, row_json TEXT NOT NULL)`);
  const rows = [
    { _id: 'n', orderIndex: null },
    { _id: 'b', orderIndex: 1 },
    { _id: 'a', orderIndex: 1 },
    { _id: 'z', orderIndex: 2 },
  ];
  const insert = db.prepare(`INSERT INTO ${physicalTable} (id, row_json) VALUES (?, ?)`);
  for (const row of rows) insert.run(row._id, JSON.stringify(row));
  try {
    for (const [direction, expected] of [
      ['Asc', ['a', 'b', 'z', 'n']],
      ['Desc', ['z', 'a', 'b', 'n']],
    ]) {
      const plan = {
        table: table.name,
        filters: [],
        order: [{ field: 'orderIndex', direction }],
        limit: null,
        indexed_by: null,
      };
      const compiled = captureProductionRowQuery(plan);
      assert.match(compiled.sql, /NULLS LAST, id ASC LIMIT \?$/);
      assert.equal(compiled.params.at(-1), 1024);
      assert.deepEqual(
        executeProductionRowQuery(db, plan).map((row) => row._id),
        expected,
        `${direction} SQL ordering`,
      );
      assert.deepEqual(
        applyPlan(rows, plan).map((row) => row._id),
        expected,
        `${direction} buffered-overlay ordering`,
      );
      assert.deepEqual(
        executeProductionRowQuery(db, { ...plan, limit: 2 }).map((row) => row._id),
        expected.slice(0, 2),
        `${direction} limited SQL ordering`,
      );
      assert.deepEqual(
        applyPlan(rows, { ...plan, limit: 2 }).map((row) => row._id),
        expected.slice(0, 2),
        `${direction} limited buffered-overlay ordering`,
      );
    }
  } finally {
    db.close();
  }
}

// Absence of take() is still bounded. In values have their own cumulative cap,
// and every filter operand also shares one total portable bind budget.
{
  const rows = Array.from({ length: 1025 }, (_, index) => ({
    _id: `row-${String(index).padStart(4, '0')}`,
    orderIndex: index,
  }));
  assert.equal(applyPlan(rows, { table: table.name, filters: [], order: [], limit: null }).length, 1024);
  assert.throws(
    () => applyPlan(rows, {
      table: table.name,
      filters: [
        { field: 'orderIndex', op: 'In', value: { Literal: Array(300).fill(1) } },
        { field: 'orderIndex', op: 'In', value: { Literal: Array(300).fill(2) } },
      ],
      order: [],
      limit: null,
    }),
    (error) => error?.snapbackCode === 'SNAPBACK_QUERY_IN_ITEMS_EXCEEDED',
  );
  const atBindCap = {
    table: table.name,
    filters: [
      { field: 'orderIndex', op: 'In', value: { Literal: Array(499).fill(1) } },
      { field: 'orderIndex', op: 'Eq', value: { Literal: 2 } },
    ],
    order: [],
    limit: null,
  };

  for (const limit of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, 1025]) {
    const invalidLimitPlan = {
      table: table.name,
      filters: [],
      order: [],
      limit,
    };
    for (const evaluate of [
      () => applyPlan(rows, invalidLimitPlan),
      () => captureProductionRowQuery(invalidLimitPlan),
    ]) {
      assert.throws(
        evaluate,
        (error) => error?.snapbackCode === 'SNAPBACK_QUERY_LIMIT_INVALID',
        `invalid query limit ${String(limit)} must fail with the portable diagnostic`,
      );
    }
  }

  assert.equal(captureProductionRowQuery(atBindCap).params.length, 501, '500 filter binds plus LIMIT');

  const overBindCap = {
    ...atBindCap,
    filters: [
      { field: 'orderIndex', op: 'In', value: { Literal: Array(500).fill(1) } },
      { field: 'orderIndex', op: 'Eq', value: { Literal: 2 } },
    ],
  };
  for (const evaluate of [
    () => applyPlan(rows, overBindCap),
    () => captureProductionRowQuery(overBindCap),
  ]) {
    assert.throws(
      evaluate,
      (error) => error?.snapbackCode === 'SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED',
    );
  }
}

// Declared scalar fields and system fields accept the same filter values at
// the Cloudflare SQL boundary as the Rust storage boundary.
{
  const scalarTable = {
    ...table,
    fields: [...table.fields, { name: 'active', field_type: 'Boolean', optional: true }],
  };
  const plan = (field, op, value) => ({
    table: table.name,
    filters: [{ field, op, value: { Literal: value } }],
    order: [],
    limit: null,
  });

  for (const [field, op, value] of [
    ['name', 'Eq', 'station'],
    ['orderIndex', 'Eq', -Number.MAX_SAFE_INTEGER],
    ['lat', 'Eq', 1.5],
    ['active', 'Eq', true],
    ['active', 'Eq', null],
    ['_id', 'Eq', 'station-1'],
    ['_version', 'Eq', 0],
    ['_createdAt', 'Eq', Number.MAX_SAFE_INTEGER],
  ]) {
    assert.doesNotThrow(() => captureProductionRowQuery(plan(field, op, value), scalarTable));
  }

  for (const [field, op, value] of [
    ['name', 'Eq', 1],
    ['name', 'Eq', null],
    ['orderIndex', 'Eq', Number.MAX_SAFE_INTEGER + 1],
    ['lat', 'Eq', '1.5'],
    ['active', 'Eq', 'true'],
    ['_id', 'Eq', 1],
    ['_version', 'Eq', -1],
    ['_updatedAt', 'Eq', 'now'],
    ['name', 'In', ['station', 1]],
  ]) {
    assert.throws(
      () => captureProductionRowQuery(plan(field, op, value), scalarTable),
      (error) => error?.snapbackCode === 'SNAPBACK_QUERY_FILTER_VALUE_INVALID',
      `invalid ${field} filter must fail with the portable type diagnostic`,
    );
  }
}

// Buffered delete overfetch is exact top-N but bounded to limit + writes.
{
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ${physicalTable} (id TEXT PRIMARY KEY, row_json TEXT NOT NULL)`);
  db.exec('CREATE TABLE _snapback_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)');
  db.exec('INSERT INTO _snapback_version(id, version) VALUES (1, 1)');
  const rows = [
    { _id: 'a', orderIndex: 1 },
    { _id: 'b', orderIndex: 2 },
    { _id: 'c', orderIndex: 3 },
  ];
  const insert = db.prepare(`INSERT INTO ${physicalTable} (id, row_json) VALUES (?, ?)`);
  for (const row of rows) insert.run(row._id, JSON.stringify(row));
  const host = new HostContext({
    sql: { exec(sql, ...params) { return db.prepare(sql).all(...params); } },
    mode: 'mutation',
    nowMs: 0,
    epoch: 'bounded-buffered-query',
    newId: () => 'unused',
    tables: new Set([table.name]),
    schemaTables: new Map([[table.name, table]]),
  });
  assert.equal(host.handle('db.delete', { table: table.name, id: 'a' }).ok, true);
  const result = host.handle('db.query', {
    plan: {
      table: table.name,
      filters: [],
      order: [{ field: 'orderIndex', direction: 'Asc' }],
      limit: 2,
      indexed_by: null,
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.rows.map((row) => row._id), ['b', 'c']);
  db.close();
}

// SQLite BINARY and Rust string ordering follow Unicode scalar values; JS's
// native `<` follows UTF-16 code units and reverses this astral/BMP pair. The
// Cloudflare overlay must use the portable scalar comparator too.
{
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ${physicalTable} (id TEXT PRIMARY KEY, row_json TEXT NOT NULL)`);
  const rows = [
    { _id: 'a-astral', name: '\u{10000}' },
    { _id: 'b-bmp', name: '\uE000' },
  ];
  const insert = db.prepare(`INSERT INTO ${physicalTable} (id, row_json) VALUES (?, ?)`);
  for (const row of rows) insert.run(row._id, JSON.stringify(row));
  try {
    for (const [direction, expected] of [
      ['Asc', ['b-bmp', 'a-astral']],
      ['Desc', ['a-astral', 'b-bmp']],
    ]) {
      const plan = {
        table: table.name,
        filters: [],
        order: [{ field: 'name', direction }],
        limit: null,
        indexed_by: null,
      };
      assert.deepEqual(executeProductionRowQuery(db, plan).map((row) => row._id), expected);
      assert.deepEqual(applyPlan(rows, plan).map((row) => row._id), expected);
    }
  } finally {
    db.close();
  }
}

// Json arrays/objects have no declared portable order. Reject the field type
// before any SQL or buffered-overlay work rather than letting each engine
// invent a different coercion/text order.
{
  const jsonTable = {
    name: 'json_items',
    fields: [{ name: 'metadata', field_type: 'Json', optional: true }],
    indexes: [],
  };
  let sqlCalls = 0;
  const host = new HostContext({
    sql: { exec() { sqlCalls += 1; return []; } },
    mode: 'query',
    nowMs: 0,
    epoch: 'json-order-rejection',
    newId: () => 'unused',
    tables: new Set([jsonTable.name]),
    schemaTables: new Map([[jsonTable.name, jsonTable]]),
  });
  assert.throws(
    () => host.storageQuery('app_json_items', {
      table: jsonTable.name,
      filters: [],
      order: [{ field: 'metadata', direction: 'Asc' }],
      limit: 1,
      indexed_by: null,
    }),
    (error) => error?.snapbackCode === 'SNAPBACK_QUERY_ORDER_UNSUPPORTED_FIELD_TYPE',
  );
  assert.equal(sqlCalls, 0, 'unsupported Json ordering fails before storage execution');
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
