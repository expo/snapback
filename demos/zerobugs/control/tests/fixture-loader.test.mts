import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import {
  LOAD_ORDER,
  canonicalJson,
  fixtureLoadPlan,
  normalizeObservedRows,
  prepareFixtureRows,
  readCompiledFixture,
  verifyObservedFixture,
  type FixtureRow,
  type FixtureTables,
  type JsonValue,
} from '../scripts/load-fixture.mts';

const CONTROL_ROOT = resolve(import.meta.dirname, '..');

async function generatedIngestHandler(): Promise<(
  ctx: unknown,
  args: {table: string; rows: unknown},
) => Promise<unknown>> {
  const manifest = JSON.parse(
    await readFile(join(CONTROL_ROOT, 'snapback/generated/functions.manifest.json'), 'utf8'),
  ) as {
    functions: Array<{
      name: string;
      runtime: {IbexModule: {source: string; export: string}};
    }>;
  };
  const generated = manifest.functions.find(item => item.name === 'fixtureIngestBatch');
  assert(generated, 'generate must emit fixtureIngestBatch before this test runs');
  const sandbox: {__snapbackHandlers?: Record<string, unknown>} = {};
  vm.runInNewContext(generated.runtime.IbexModule.source, sandbox, {
    filename: 'fixtureIngestBatch.generated.mjs',
  });
  const handler = sandbox.__snapbackHandlers?.[generated.runtime.IbexModule.export];
  assert.equal(typeof handler, 'function');
  return handler as (
    ctx: unknown,
    args: {table: string; rows: unknown},
  ) => Promise<unknown>;
}

function mockContext(options: {
  completed?: boolean;
  users?: Array<{id: string; role: string}>;
} = {}) {
  let nextID = 0;
  return {
    auth: {userId: 'principal_fixture_test'},
    db: {
      query(table: string) {
        return {
          take() {
            return this;
          },
          async collect() {
            if (table === 'searchEpoch') return options.completed ? [{epoch: 0}] : [];
            if (table === 'user') return options.users ?? [];
            return [];
          },
        };
      },
      async insert() {
        nextID += 1;
        return `runtime_${nextID}`;
      },
    },
  };
}

test('compiler and loader pipeline is deterministic and digest-preserving', async () => {
  const {tables, digests} = await readCompiledFixture();
  const firstPlan = fixtureLoadPlan(tables);
  const secondPlan = fixtureLoadPlan(tables);
  assert.equal(canonicalJson(firstPlan as unknown as JsonValue), canonicalJson(secondPlan as unknown as JsonValue));
  assert(firstPlan.every(batch => batch.rows.length <= 900));
  assert.deepEqual([...new Set(firstPlan.map(batch => batch.table))], LOAD_ORDER.filter(
    table => tables[table].length > 0,
  ));

  const placeholderToActual = new Map<string, string>();
  const actualToPlaceholder = new Map<string, string>();
  const runtimeRows = Object.fromEntries(LOAD_ORDER.map(table => [table, []])) as Record<
    (typeof LOAD_ORDER)[number],
    Array<Record<string, JsonValue>>
  >;
  for (const batch of firstPlan) {
    const payload = prepareFixtureRows(batch.table, batch.rows, placeholderToActual);
    for (let index = 0; index < batch.rows.length; index += 1) {
      const placeholder = batch.rows[index]._id;
      const actual = `runtime_${placeholder}`;
      placeholderToActual.set(placeholder, actual);
      actualToPlaceholder.set(actual, placeholder);
      runtimeRows[batch.table].push({
        _id: actual,
        _version: 1,
        _createdAt: 1,
        _updatedAt: 1,
        ...payload[index],
      });
    }
  }

  const normalized = {} as FixtureTables;
  for (const table of LOAD_ORDER) {
    normalized[table] = normalizeObservedRows(table, runtimeRows[table], actualToPlaceholder);
  }
  const first = verifyObservedFixture(normalized, tables, digests);
  const second = verifyObservedFixture(normalized, tables, digests);
  assert.deepEqual(first, second);
  assert.equal(first.overallDigest, digests.overall.contentDigest);
});

test('generated fixtureIngestBatch refuses oversized and unknown batches', async () => {
  const handler = await generatedIngestHandler();
  await assert.rejects(
    () => handler(mockContext(), {table: 'user', rows: Array.from({length: 901}, () => ({}))}),
    /at most 900 rows/,
  );
  await assert.rejects(
    () => handler(mockContext(), {table: 'notARealTable', rows: []}),
    /unknown fixture table/,
  );
});

test('generated fixtureIngestBatch applies W-ENUM role and visibility guards', async () => {
  const handler = await generatedIngestHandler();
  await assert.rejects(
    () => handler(mockContext(), {table: 'user', rows: [{id: 'bad', role: 'owner'}]}),
    /role must be crew or user/,
  );
  await assert.rejects(
    () => handler(mockContext(), {table: 'issue', rows: [{visibility: 'secret'}]}),
    /visibility must be internal or public/,
  );
});

test('generated fixtureIngestBatch closes after completion and on foreign users', async () => {
  const handler = await generatedIngestHandler();
  await assert.rejects(
    () => handler(mockContext({completed: true}), {table: 'project', rows: []}),
    /closed after fixture completion/,
  );
  await assert.rejects(
    () => handler(mockContext({users: [{id: 'foreign', role: 'crew'}]}), {table: 'project', rows: []}),
    /outside the frozen fixture/,
  );
});
