// Admin Contract bridge smoke test.
//
// @ref LLP 0021#phase-4-move-admin-and-demo-surfaces-onto-the-adapter - the
//   generated binding list and product-shaped system-surface adapter must stay
//   in sync.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAdminSurface } from '../admin-boundary.mjs';
import { adminContractBindings } from '../contract-bindings.mjs';
import { generateAdminContractBindings } from '../generate-contract-bindings.mjs';

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const generatedBefore = snapshotGeneratedBindings(adminRoot);
await generateAdminContractBindings({ root: adminRoot, cacheBust: true });
assert.deepEqual(
  snapshotGeneratedBindings(adminRoot),
  generatedBefore,
  'admin Contract binding generation must be byte-idempotent',
);

const runtime = createFakeRuntime();
const client = createFakeAdminClient();
const surface = await createAdminSurface({ runtime, client });

assert.deepEqual(
  Object.keys(surface.links).sort(),
  adminContractBindings.map((binding) => binding.name).sort(),
  'bridge links must match generated admin Contract bindings',
);

const view = surface.queryRows('inspect')[0];
assert.equal(view.id, 'inspect', 'inspect resource hydrates');
// The flattened view model the .contract renders (correct casing — schema.schemaHash,
// not schema_hash — and the capability-manifest surface the rebuild added).
assert.equal(view.ui.schemaHash, 'sha256:test', 'schema hash reads the camelCase key');
assert.equal(view.ui.tiles.length, 4, 'overview exposes four dashboard tiles');
assert.equal(view.ui.cap.storageEngine, 'sqlite', 'capability manifest is flattened');
assert.ok(view.ui.cap.flags.some((f) => f.label === 'Live subscriptions' && f.on), 'capability flags shape');
assert.equal(view.ui.functions[0].auth, 'optional-user', 'function auth metadata is surfaced');
assert.equal(view.ui.functions[0].kindLabel, 'live query', 'LiveQuery renders a friendly kind label');
assert.equal(surface.queryRows('tableScan')[0].loaded, false, 'tableScan starts empty');
assert.equal(surface.queryRows('runResult')[0].ran, false, 'runResult starts empty');

await surface.links.loadTable({ table: 'todos', offset: 0 });
assert.equal(surface.queryRows('tableScan')[0].loaded, true, 'loadTable publishes scan state');
assert.equal(surface.queryRows('tableScan')[0].rows[0].cells[0].text, 'todo_1', 'scan row is shaped');

await surface.links.runFunction({ name: 'listTodos', argsText: '{}', userId: 'user_ada' });
assert.equal(surface.queryRows('runResult')[0].ok, true, 'runFunction publishes success state');
assert.match(surface.queryRows('runResult')[0].payload, /Read the Snapback explainer/, 'run payload is rendered');

await surface.links.cleanup({});
assert.equal(surface.queryRows('inspect')[0].id, 'inspect', 'cleanup republishes a fresh inspect view');

await surface.links.refresh({});
assert.equal(surface.pendingCount(), 0, 'completed commands leave no pending work');

surface.dispose();
assert.throws(() => surface.links.inspect({}), /used after dispose/, 'disposed links fail closed');

console.log('admin contract bindings smoke: ok');

function snapshotGeneratedBindings(root) {
  const generatedRoot = join(root, 'generated', 'contract');
  return Object.fromEntries(
    readdirSync(generatedRoot)
      .sort()
      .map((file) => [file, readFileSync(join(generatedRoot, file), 'utf8')]),
  );
}

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
          host_plan_runtime: true,
          ibex_ctx_db_host_bridge: 'Available',
          async_handler_completion: 'Available',
          sqlite_lock_held_across_async: 'Unavailable',
        },
        admin: {
          console: true,
          data_explorer: true,
          function_runner: true,
          ephemeral_cleanup: true,
          direct_data_edit: false,
          raw_sql: false,
          token_configured: false,
          writes_require_token: false,
        },
        capability_gaps: ['offline_mutation_replay'],
        capabilityManifest: {
          storageEngine: 'sqlite',
          runtimeEngine: 'ibex',
          mutationIsolationMode: 'handler-captured-read-set-validation',
          liveSubscriptions: true,
          syncableLiveQueries: true,
          resourceLimits: [{ name: 'cpu_budget', status: 'Missing' }],
          supportedQueryForms: ['host-plan-single-table-eq'],
          capabilityGaps: ['postgres'],
        },
        subscriptions: [],
        liveDelivery: { total_fanout_attempts: 0, total_deliveries: 0, total_skipped: 0 },
        // schema carries the camelCase schemaHash the live server actually emits.
        schema: {
          schemaHash: 'sha256:test',
          appId: 'todo-test',
          tables: [
            {
              name: 'todos',
              syncable: true,
              fields: [
                { name: 'title', field_type: 'String', optional: false },
                { name: 'completed', field_type: 'Boolean', optional: false },
              ],
              indexes: [{ name: 'by_completed', fields: ['completed'] }],
            },
          ],
        },
        functions: {
          bundleHash: 'sha256:fns',
          functions: [
            {
              name: 'listTodos',
              kind: 'LiveQuery',
              authRequirement: 'optional-user',
              syncabilityClass: 'syncable-live',
              requiredCapabilities: ['live_subscriptions', 'host_plan_runtime'],
              readSetSummary: { tables: ['todos'] },
              writeSetSummary: { tables: [] },
              runtime: { HostPlan: { Query: { table: 'todos', indexed_by: 'by_user', filters: [] } } },
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
    async cleanupEphemeral() {
      return null;
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
