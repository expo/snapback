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
import { initialTab } from '../theme.ts';

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
assert.equal(view.ui.tiles.length, 5, 'overview exposes five dashboard tiles');
assert.equal(view.ui.cap.storageEngine, 'sqlite', 'capability manifest is flattened');
assert.ok(view.ui.cap.flags.some((f) => f.label === 'Live subscriptions' && f.on), 'capability flags shape');
assert.equal(view.ui.functions[0].auth, 'optional-user', 'function auth metadata is surfaced');
assert.equal(view.ui.functions[0].kindLabel, 'live query', 'LiveQuery renders a friendly kind label');
assert.equal(view.ui.subscriptions[0].connection, 'conn_a', 'Realtime tab accepts camelCase connectionId');
assert.equal(view.ui.delivery.find((entry) => entry.key === 'lfs').value, '2', 'Realtime delivery counters accept camelCase');
assert.equal(surface.queryRows('tableScan')[0].loaded, false, 'tableScan starts empty');
assert.equal(surface.queryRows('runResult')[0].ran, false, 'runResult starts empty');

// The Secrets surface: the LLP 0036 status primitive shaped for rendering —
// names and states only; the view model must never carry a value field.
const config = view.ui.config;
assert.equal(config.available, true, 'config status hydrates');
assert.equal(config.appProvisioned, true, 'appProvisioned is surfaced');
assert.equal(config.declaredCount, 2, 'declared entries are counted');
assert.equal(config.missingCount, 1, 'required missing is surfaced');
assert.equal(view.ui.showConfigAlert, true, 'missing required config raises the strip badge');
assert.ok(view.ui.tiles.some((t) => t.key === 'config' && t.value === '2' && t.alert), 'overview shows the config tile with an alert');
const feed = config.entries.find((e) => e.name === 'caltrainFeed');
assert.equal(feed.setLabel, 'set (2 keys)', 'pooled set state renders member count');
assert.equal(feed.verifiedLabel.startsWith('verified'), true, 'verification state renders');
assert.deepEqual(feed.usedBy.map((u) => u.label), ['refreshFeed'], 'uses grants join into used-by');
assert.equal(feed.canVerify, true, 'probe-backed set entries can verify');
const directions = config.entries.find((e) => e.name === 'directionsKey');
assert.equal(directions.setLabel, 'not set', 'unset entries render as not set');
assert.equal(directions.setTone, 'warn', 'missing required entries warn');
assert.equal(directions.canVerify, false, 'unset entries cannot verify');
assert.equal(JSON.stringify(config).includes('sekret-value'), false, 'no value ever reaches the view model');

client.configAppProvisioned = false;
client.configEntries = [];
client.configMissing = [];
await surface.links.refresh({});
const unprovisionedConfig = surface.queryRows('inspect')[0].ui.config;
assert.equal(unprovisionedConfig.appProvisioned, false, 'appProvisioned=false is preserved');
assert.match(unprovisionedConfig.emptyTitle, /No app.*provisioned/i, 'Secrets empty state distinguishes unprovisioned apps');
client.configAppProvisioned = true;
client.configEntries = null;
client.configMissing = null;
await surface.links.refresh({});

await surface.links.verifyConfig({ entry: 'caltrainFeed' });
const verifiedView = surface.queryRows('inspect')[0];
const verifiedFeed = verifiedView.ui.config.entries.find((e) => e.name === 'caltrainFeed');
assert.equal(verifiedFeed.verifyRan, true, 'verify outcome is folded into the entry');
assert.equal(verifiedFeed.verifyOk, true, 'verify outcome reports the probe result');
assert.equal(
  JSON.stringify(verifiedView).includes('HANDLER_CONTROLLED_VERIFY_SENTINEL'),
  false,
  'handler-controlled verify text cannot enter the AdminRead view model',
);

await surface.links.loadTable({ table: 'todos', offset: 0 });
assert.equal(surface.queryRows('tableScan')[0].loaded, true, 'loadTable publishes scan state');
assert.equal(surface.queryRows('tableScan')[0].rows[0].cells[0].text, 'todo_1', 'scan row is shaped');
await surface.links.loadTable({ table: 'todos', offset: -50 });
assert.equal(client.scanOffsets.at(-1), 0, 'negative offsets clamp to zero before scan');
assert.equal(surface.queryRows('tableScan')[0].prevOffset, 0, 'previous offset cannot go negative');
await surface.links.loadTable({ table: 'todos', offset: 999 });
assert.deepEqual(client.scanOffsets.slice(-2), [999, 100], 'oversized offset refetches the final page');
assert.equal(surface.queryRows('tableScan')[0].offset, 100, 'final page offset is published');
assert.equal(surface.queryRows('tableScan')[0].rangeLabel, '101–125 of 125', 'range reflects the clamped final page');

await surface.links.runFunction({ name: 'listTodos', argsText: '{}' });
assert.equal(surface.queryRows('runResult')[0].ok, true, 'runFunction publishes success state');
assert.match(surface.queryRows('runResult')[0].payload, /Read the Snapback explainer/, 'run payload is rendered');
assert.deepEqual(
  client.lastRunInput,
  { args: {} },
  'browser runner never manufactures app identity or replay authority',
);

await surface.links.cleanup({});
assert.equal(surface.queryRows('inspect')[0].id, 'inspect', 'cleanup republishes a fresh inspect view');

for (const [name, invoke] of [
  ['refresh', () => surface.links.refresh({})],
  ['cleanup', () => surface.links.cleanup({})],
  ['verifyConfig', () => surface.links.verifyConfig({ entry: 'caltrainFeed' })],
]) {
  client.failInspect = true;
  await invoke();
  const failedView = surface.queryRows('inspect')[0];
  assert.equal(failedView.ui.hasInspectError, true, `${name} renders inspect failures instead of throwing`);
  assert.equal(failedView.ui.diagnostics[0].code, 'SNAPBACK_ADMIN_INSPECT_FAILED', `${name} diagnostic code`);
  assert.equal(surface.pendingCount(), 0, `${name} leaves no pending command on inspect failure`);
  client.failInspect = false;
  await surface.links.refresh({});
}

await surface.links.refresh({});
assert.equal(surface.pendingCount(), 0, 'completed commands leave no pending work');
assert.equal(
  surface.queryRows('inspect')[0].ui.config.entries.find((e) => e.name === 'caltrainFeed').verifyRan,
  false,
  'refresh drops the transient probe-result note',
);

surface.dispose();
assert.throws(() => surface.links.inspect({}), /used after dispose/, 'disposed links fail closed');

globalThis.location = { hash: '#%E0%A4%A' };
assert.equal(initialTab(), 'Overview', 'malformed hash falls back without throwing');
globalThis.location = { hash: '#Realtime' };
assert.equal(initialTab(), 'Realtime', 'valid hash still selects the tab');
delete globalThis.location;

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
  const client = {
    failInspect: false,
    scanOffsets: [],
    configAppProvisioned: true,
    configEntries: null,
    configMissing: null,
    async inspect() {
      if (client.failInspect) {
        throw new Error('inspect transport failed');
      }
      return {
        target: 'local-dev-sqlite-ibex',
        server: {
          host: '127.0.0.1',
          port: 4287,
          loopback: true,
          uptimeMs: 1500,
          pid: 123,
          storageMode: 'memory',
        },
        storage: {
          sqlitePath: null,
          version: 1,
        },
        runtime: {
          canonicalEngine: 'ibex',
          ibexCli: { available: true, version: 'test' },
          hostPlanRuntime: true,
          ibexCtxDbHostBridge: 'Available',
          asyncHandlerCompletion: 'Available',
          sqliteLockHeldAcrossAsync: 'Unavailable',
        },
        admin: {
          console: true,
          dataExplorer: true,
          functionRunner: true,
          ephemeralCleanup: true,
          directDataEdit: false,
          rawSql: false,
          tokenConfigured: false,
          writesRequireToken: false,
        },
        capabilityGaps: ['offline_mutation_replay'],
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
        subscriptions: [{ id: 'sub_a', connectionId: 'conn_a', function: 'listTodos' }],
        liveDelivery: {
          totalFanoutAttempts: 4,
          totalDeliveries: 3,
          totalSkipped: 1,
          lastFanoutSubscriptions: 2,
          lastDeliveries: 2,
          lastSkipped: 0,
        },
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
            {
              name: 'refreshFeed',
              kind: 'Action',
              authRequirement: 'none',
              syncabilityClass: 'action',
              requiredCapabilities: ['outbound_actions'],
              readSetSummary: { tables: [] },
              writeSetSummary: { tables: [] },
              uses: ['caltrainFeed'],
              runtime: { IbexModule: { export: 'refreshFeed', source: 'export const refreshFeed = 1;' } },
            },
          ],
        },
        recentDiagnostics: [{ code: 'snapback_info', severity: 'info', subsystem: 'test', message: 'lowercase severity' }],
        ephemeral: {
          roomCount: 0,
          entryCount: 0,
          subscriberCount: 0,
          resyncRequired: 0,
          rejectedPublishes: 0,
          rateLimitedPublishes: 0,
        },
      };
    },
    async cleanupEphemeral() {
      return null;
    },
    // LLP 0036 config.status fixture: names and states only. The fake value
    // string below exists only to prove the shaping never touches values —
    // it is deliberately not part of the status payload shape.
    async configStatus() {
      const defaultEntries = [
        {
          name: 'caltrainFeed',
          description: '511.org Open Data API key',
          purpose: 'Fetches the Caltrain GTFS-Realtime feed',
          secret: true,
          required: false,
          pool: true,
          probe: 'verifyCaltrainKey',
          howToGet: 'Request a free key at https://511.org/open-data/token.',
          set: true,
          memberCount: 2,
          lastChangedMs: 1750000000000,
          source: 'wizard',
          verified: { ok: true, atMs: 1750000300000 },
          applyState: 'applied',
        },
        {
          name: 'directionsKey',
          description: 'Directions provider key',
          secret: true,
          required: true,
          pool: false,
          set: false,
          memberCount: 0,
          applyState: 'applied',
          // A rogue field a buggy server might add: the shaping must drop
          // anything value-shaped rather than pass entries through wholesale.
          value: 'sekret-value',
        },
      ];
      return {
        generation: 3,
        backendClass: 'local-file-immediate',
        appProvisioned: client.configAppProvisioned,
        requiredMissing: client.configMissing ?? ['directionsKey'],
        entries: client.configEntries ?? defaultEntries,
      };
    },
    async verifyConfigEntry(entry) {
      return {
        entry,
        ok: true,
        verified: {
          ok: true,
          atMs: 1750000400000,
          diagnostic: 'HANDLER_CONTROLLED_VERIFY_SENTINEL',
        },
        generation: 3,
      };
    },
    async scanTable(table, _limit, offset) {
      client.scanOffsets.push(offset);
      const total = 125;
      const rows = offset < total
        ? Array.from({ length: Math.min(_limit, total - offset) }, (_, i) => ({
            _id: `todo_${offset + i + 1}`,
            title: offset + i === 0 ? 'Read the Snapback explainer' : `Todo ${offset + i + 1}`,
          }))
        : [];
      return {
        table,
        offset,
        total,
        columns: ['_id', 'title'],
        rows,
      };
    },
    async runFunction(name, input) {
      client.lastRunInput = input;
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
  return client;
}
