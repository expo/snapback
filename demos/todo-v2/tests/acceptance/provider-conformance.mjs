// Todo v2 — Exact-owned DataProvider conformance against the Snapback adapter.
//
// @ref LLP 0021#phase-2-ship-the-snapback-contract-adapter - this imports
//   Exact's provider conformance suite and points it at Snapback's live provider,
//   instead of replacing the Exact-owned gate with a Snapback-local harness.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { resolveExact } from '../../../_kit/exact-resolver.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import {
  createSnapbackContractSurface,
} from '../../../../packages/snapback-contract/index.mjs';
import {
  discoverExactProviderConformance,
} from '../../../../packages/snapback-contract/exact-conformance.mjs';
import {
  importExactContractConformance,
  importExactContractRuntime,
} from '../../../../packages/snapback-contract/exact-package.mjs';
import { todoOptimisticReducers } from '../../surfaces/contract/optimistic.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const gen = (file) => JSON.parse(readFileSync(join(backendDir, 'generated', file), 'utf8'));
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const ADA = 'user_ada';
const SUBSCRIPTION_UPDATE_TITLE = 'Exact conformance subscription update';
const MUTATION_PRIORITY = 'low';

const artifactIndex = gen('artifacts.json');
const schemaManifest = gen('schema.manifest.json');
const functionsManifest = gen('functions.manifest.json');
const contractDataManifest = gen('contract-data.manifest.json');
const seed = readJson(join(backendDir, 'seed.json'));
const demoManifest = readJson(join(here, '..', '..', 'demo.snapback.json'));

const exact = resolveExact({ repoRoot });
if (exact.sourceKind === 'missing') {
  const expected = demoManifest.surfaces.contract;
  const report = {
    title: 'todo-v2 / provider conformance',
    skipped: true,
    reason: 'SNAPBACK_CAPABILITY_EXACT_MISSING',
    requirement: expected.requirement,
    expectedDiagnostic: expected.expectedDiagnostic,
    diagnostics: exact.diagnostics,
  };
  console.log(JSON.stringify(report, null, 2));
  const valid =
    ['optional', 'expected_missing', 'blocked'].includes(expected.requirement) &&
    expected.expectedDiagnostic === 'SNAPBACK_CAPABILITY_EXACT_MISSING';
  console.log(valid ? '\nSKIP (valid, expected_missing): todo-v2 / provider conformance' : '\nFAIL: unexpected missing capability');
  process.exit(valid ? 0 : 1);
}

const conformanceDiscovery = discoverExactProviderConformance({ exactRoot: exact.path });
if (!conformanceDiscovery.runnable) {
  console.log(JSON.stringify({
    title: 'todo-v2 / provider conformance',
    ok: false,
    exact: { sourceKind: exact.sourceKind, commit: exact.commit },
    conformance: conformanceDiscovery,
  }, null, 2));
  process.exit(1);
}

console.log(`Exact resolved via ${exact.sourceKind}@${exact.path} (commit ${exact.commit ?? 'n/a'})`);
console.log(`  provider conformance: ${conformanceDiscovery.exactVerify.check.id}`);

const runtimeMod = await importExactContractRuntime({ exactRoot: exact.path });
const conformanceMod = await importExactContractConformance({ exactRoot: exact.path });

let server = null;
let surface = null;

try {
  server = await startServer({ port: 4405, db: ':memory:', cwd: repoRoot });
  const db = new SnapbackClient(server.baseUrl);
  await db.loadSchema(schemaManifest);
  await db.loadFunctions(functionsManifest);
  await db.reset();
  await db.seed(seed);

  // Presence for the ephemeral probe (ENG-22479): two viewers, keyed by
  // their publishing connections — the gate's snapshot asserts these keys in
  // ascending order.
  for (const viewer of ['viewer_a', 'viewer_b']) {
    await db.publishEphemeral('todoPresence', {
      connectionId: viewer,
      scope: { listId: 'inbox' },
      userId: ADA,
      value: { name: viewer },
    });
  }

  const fixture = createTodoV2ProviderFixture({ runtime: runtimeMod, client: db });
  const report = await conformanceMod.assertDataProviderConformance(fixture);

  console.log('\nPASS todo-v2 / provider conformance');
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify({
    ...report,
    exact: { sourceKind: exact.sourceKind, commit: exact.commit },
  }));
  process.exitCode = 0;
} catch (error) {
  console.error('provider conformance crashed:', error);
  if (error?.report) {
    console.error(JSON.stringify(error.report, null, 2));
  }
  process.exitCode = 2;
} finally {
  surface?.dispose?.();
  runtimeMod.reset?.();
  await server?.stop?.();
}

function createTodoV2ProviderFixture({ runtime, client }) {
  let provider = null;

  const primaryQuery = {
    name: 'listTodos',
    args: {},
    initial: { status: 'ready', empty: false },
    afterSubscriptionUpdate: { status: 'ready', empty: false },
    applySubscriptionUpdate: async () => {
      if (!provider) throw new Error('provider conformance fixture used before provider creation');
      const result = await provider.mutate('createTodo', {
        title: SUBSCRIPTION_UPDATE_TITLE,
        priority: 'normal',
      });
      if (!result.ok) {
        throw new Error(`subscription update mutation failed: ${result.error.message}`);
      }
    },
  };

  const mutation = {
    name: 'setPriority',
    args: { id: 'seed_todo_3', priority: MUTATION_PRIORITY },
    expectedResult: { ok: true },
    afterMutation: { status: 'ready', empty: false },
  };

  const rowSyncState = {
    table: 'todos',
    rowId: 'seed_todo_1',
    expected: null,
  };

  const forceState = {
    state: { status: 'ready', value: [], empty: true },
    expected: { status: 'ready', value: [], empty: true },
  };

  return {
    name: 'snapback-todo-v2-provider',
    capabilities: contractDataManifest.capabilities,
    async createProvider() {
      surface = await createSnapbackContractSurface({
        queryName: 'listTodos',
        boundaryKey: 'todos',
        optimisticReducers: todoOptimisticReducers,
        runtime,
        client,
        userId: ADA,
        manifest: contractDataManifest,
        artifactIndex,
        schemaManifest,
        functionManifest: functionsManifest,
      });
      // Subscribe the probe's presence room up front so the gate's
      // subscribeEphemeral delivers its ready snapshot within settle()
      // (the source reads the shared prewarmed overlay synchronously).
      await surface.prewarmEphemeral('todoPresence', { listId: 'inbox' });

      primaryQuery.initial.value = await currentRows(client);
      const syncedRow = primaryQuery.initial.value.find((row) => row._id === rowSyncState.rowId);
      rowSyncState.expected = syncedRow
        ? { syncedVersion: syncedRow._version, approxSyncedAt: null, pendingMutations: false }
        : null;

      provider = wrapProviderForDynamicExpectations(surface.provider, {
        client,
        primaryQuery,
        mutation,
      });
      return provider;
    },
    primaryQuery,
    mutation,
    failedMutation: {
      name: 'createTodo',
      args: { title: 'Missing priority should fail' },
    },
    forceState,
    rowSyncState,
    serverRunnableQuery: {
      name: 'listTodos',
      args: {},
      expected: { status: 'ready' },
    },
    // LLP 0284 §2.5 ephemeral probes (ENG-22479): snapshot, ascending order,
    // and the ENG-22453 force plane (force-reaches-live, LOCAL-ONLY with the
    // source-start counter, dispose-restores).
    ephemeral: {
      name: 'todoPresence',
      args: { listId: 'inbox' },
      initialKeys: ['viewer_a', 'viewer_b'],
      forcedState: {
        status: 'ready',
        entries: [
          {
            key: 'ghost_viewer',
            value: { name: 'Ghost (forced)' },
            updatedAt: 1,
            sourceClientId: 'ghost_viewer',
            self: false,
          },
        ],
      },
      sourceStarts: () => surface.ephemeralSourceStarts('todoPresence'),
    },
  };
}

function wrapProviderForDynamicExpectations(provider, { client, primaryQuery, mutation }) {
  const mutate = provider.mutate.bind(provider);
  return {
    ...provider,
    async mutate(name, args = {}) {
      const result = await mutate(name, args);
      if (result.ok) {
        const rows = await currentRows(client);
        if (name === 'createTodo' && args.title === SUBSCRIPTION_UPDATE_TITLE) {
          primaryQuery.afterSubscriptionUpdate.value = rows;
        }
        if (name === mutation.name && args.id === mutation.args.id) {
          mutation.afterMutation.value = rows;
        }
      }
      return result;
    },
  };
}

async function currentRows(client) {
  return (await client.query('listTodos', { userId: ADA })).rows;
}
