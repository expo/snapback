// Admin Contract bridge smoke test.
//
// @ref LLP 0021#phase-4-move-admin-and-demo-surfaces-onto-the-adapter - the
//   generated binding list and product-shaped system-surface adapter must stay
//   in sync.

import assert from 'node:assert/strict';

import { createAdminSurface } from '../admin-boundary.mjs';
import { adminContractBindings } from '../contract-bindings.mjs';

const runtime = createFakeRuntime();
const client = createFakeAdminClient();
const surface = await createAdminSurface({ runtime, client });

assert.deepEqual(
  Object.keys(surface.links).sort(),
  adminContractBindings.map((binding) => binding.name).sort(),
  'bridge links must match generated admin Contract bindings',
);

assert.equal(surface.queryRows('inspect')[0].id, 'inspect', 'inspect resource hydrates');
assert.equal(surface.queryRows('tableScan')[0].loaded, false, 'tableScan starts empty');
assert.equal(surface.queryRows('runResult')[0].ran, false, 'runResult starts empty');

await surface.links.loadTable({ table: 'todos', offset: 0 });
assert.equal(surface.queryRows('tableScan')[0].loaded, true, 'loadTable publishes scan state');
assert.equal(surface.queryRows('tableScan')[0].rows[0].cells[0].text, 'todo_1', 'scan row is shaped');

await surface.links.runFunction({ name: 'listTodos', argsText: '{}', userId: 'user_ada' });
assert.equal(surface.queryRows('runResult')[0].ok, true, 'runFunction publishes success state');
assert.match(surface.queryRows('runResult')[0].payload, /Read the Snapback explainer/, 'run payload is rendered');

await surface.links.refresh({});
assert.equal(surface.pendingCount(), 0, 'completed commands leave no pending work');

surface.dispose();
assert.throws(() => surface.links.inspect({}), /used after dispose/, 'disposed links fail closed');

console.log('admin contract bindings smoke: ok');

function createFakeRuntime() {
  return {
    createContractMockQueryBoundary(initialRows) {
      const state = { ...initialRows };
      return {
        query(key, selector) {
          return selector(state[key]);
        },
        write(key, updater) {
          state[key] = updater(state[key]);
        },
      };
    },
  };
}

function createFakeAdminClient() {
  return {
    async inspect() {
      return {
        target: 'local-dev-sqlite-ibex',
        server: {
          host: '127.0.0.1',
          port: 4287,
          loopback: true,
          uptime_ms: 1500,
          pid: 123,
          storage_mode: 'memory',
        },
        storage: {
          sqlite_path: null,
          version: 1,
        },
        runtime: {
          canonical_engine: 'ibex',
          ibex_cli: { available: true, version: 'test' },
        },
        admin: {
          writes_require_token: false,
        },
        capability_gaps: ['offline_mutation_replay'],
        schema: {
          schema_hash: 'sha256:test',
          tables: [
            {
              name: 'todos',
              syncable: true,
              fields: [
                { name: 'title', field_type: 'String' },
                { name: 'completed', field_type: 'Boolean' },
              ],
              indexes: [{ name: 'by_completed', fields: ['completed'] }],
            },
          ],
        },
        functions: {
          functions: [
            {
              name: 'listTodos',
              kind: 'LiveQuery',
              runtime: { HostPlan: { Query: { table: 'todos' } } },
            },
          ],
        },
        recent_diagnostics: [],
        ephemeral: {
          room_count: 0,
          entry_count: 0,
          subscriber_count: 0,
          resync_required: 0,
          rejected_publishes: 0,
          rate_limited_publishes: 0,
        },
      };
    },
    async scanTable(table, _limit, offset) {
      return {
        table,
        offset,
        total: 1,
        columns: ['_id', 'title'],
        rows: [{ _id: 'todo_1', title: 'Read the Snapback explainer' }],
      };
    },
    async runFunction(name) {
      return {
        ok: true,
        function: name,
        kind: 'LiveQuery',
        reads: ['todos'],
        writes: [],
        rows: [{ _id: 'todo_1', title: 'Read the Snapback explainer' }],
        elapsed_ms: 1,
      };
    },
  };
}
