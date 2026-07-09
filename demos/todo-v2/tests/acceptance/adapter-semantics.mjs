// Todo v2 — Snapback Contract adapter semantics without a Snapback server.
//
// @ref LLP 0021#phase-2-ship-the-snapback-contract-adapter - rejected
//   optimistic mutations must republish authoritative rows, and runtime-link +
//   provider mutations must share one pending count.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveExact } from '../../../_kit/exact-resolver.mjs';
import { assert, assertEqual, createSuite } from '../../../_kit/harness.mjs';
import {
  createSnapbackContractSurface,
} from '../../../../packages/snapback-contract/index.mjs';
import {
  importExactContractRuntime,
} from '../../../../packages/snapback-contract/exact-package.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const gen = (file) => JSON.parse(readFileSync(join(backendDir, 'generated', file), 'utf8'));
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const ADA = 'user_ada';
const artifactIndex = gen('artifacts.json');
const schemaManifest = gen('schema.manifest.json');
const functionsManifest = gen('functions.manifest.json');
const contractDataManifest = gen('contract-data.manifest.json');
const demoManifest = readJson(join(here, '..', '..', 'demo.snapback.json'));
const seedRows = readJson(join(backendDir, 'seed.json')).tables.todos.map((row, index) => ({
  _version: 1,
  _createdAt: index + 1,
  _updatedAt: index + 1,
  ...row,
}));

const exact = resolveExact({ repoRoot });
if (exact.sourceKind === 'missing') {
  const expected = demoManifest.surfaces.contract;
  const report = {
    title: 'todo-v2 / adapter semantics',
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
  console.log(valid ? '\nSKIP (valid, expected_missing): todo-v2 / adapter semantics' : '\nFAIL: unexpected missing capability');
  process.exit(valid ? 0 : 1);
}

console.log(`Exact resolved via ${exact.sourceKind}@${exact.path} (commit ${exact.commit ?? 'n/a'})`);

const runtimeMod = await importExactContractRuntime({ exactRoot: exact.path });
const suite = createSuite('todo-v2 / adapter semantics');
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

try {
  await suite.check('rejected runtime-link mutation never strands rows (derived overlay predicts the rejection)', async () => {
    const client = createMemoryClient(seedRows, { holdMutations: true });
    const surface = await createSurface(client);
    const cells = [];
    const subscription = surface.provider.subscribe('listTodos', {}, (cell) => cells.push(cell));
    const title = 'Rejected no-priority todo';

    try {
      const task = surface.links.createTodo({ title });
      await settle();
      // Derived overlays (Exact LLP 0329 E-B): the plan's strict `priority`
      // arg fails to evaluate locally, so the overlay honestly predicts the
      // server rejection and publishes NO optimistic row — where the old
      // hand reducer showed a phantom row and relied on rollback. Rollback
      // of a published overlay on a server-only failure is covered by
      // packages/snapback-contract/derived-overlay-reconcile-failure.test.mjs.
      assert(
        !cells.at(-1).value.some((row) => row.title === title),
        'a locally-predictable rejection must not publish an optimistic row',
      );

    let rejected = null;
    try {
      await client.releaseAll();
      await task;
    } catch (error) {
      rejected = error;
      }
      assert(rejected, 'expected missing-priority mutation to reject');
      await settle();

      assert(!cells.at(-1).value.some((row) => row.title === title), 'rejected row was not rolled back');
      assert(!(await currentRows(client)).some((row) => row.title === title), 'rejected row persisted');
      const diagnostic = surface.diagnostics.find(
        (entry) => entry.code === 'SNAPBACK_CONTRACT_MUTATION_FAILED' && entry.details?.mutation === 'createTodo',
      );
      assert(diagnostic, `missing mutation diagnostic: ${JSON.stringify(surface.diagnostics)}`);
      assertEqual(surface.pendingCount(), 0, 'pending count after rejection');
      return { diagnostic: diagnostic.code, cells: cells.length };
    } finally {
      subscription.dispose();
      surface.dispose();
    }
  });

  await suite.check('runtime-link and provider mutations share one pending count', async () => {
    const client = createMemoryClient(seedRows, { holdMutations: true });
    const surface = await createSurface(client);

    try {
      const linkTask = surface.links.setPriority({ id: 'seed_todo_1', priority: 'low' });
      const providerTask = surface.provider.mutate('setPriority', { id: 'seed_todo_2', priority: 'normal' });
      assertEqual(client.pendingCount(), 2, 'held memory mutations');
      assertEqual(surface.pendingCount(), 2, 'combined pending count while mutations are held');

      await client.releaseAll();
      await Promise.all([linkTask, providerTask]);
      assertEqual(surface.pendingCount(), 0, 'combined pending count after release');
      const rows = await currentRows(client);
      assertEqual(rows.find((row) => row._id === 'seed_todo_1')?.priority, 'low', 'runtime-link priority');
      assertEqual(rows.find((row) => row._id === 'seed_todo_2')?.priority, 'normal', 'provider priority');
      return { heldMutations: 2 };
    } finally {
      surface.dispose();
    }
  });

  runtimeMod.reset?.();
  const report = suite.finish();
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify({ ...report, exact: { sourceKind: exact.sourceKind, commit: exact.commit } }));
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error('adapter semantics acceptance crashed:', error);
  process.exit(2);
}

async function createSurface(client) {
  return createSnapbackContractSurface({
    queryName: 'listTodos',
    boundaryKey: 'todos',
    // Derived overlays (Exact LLP 0329 E-B): plan-derived defaults.
    runtime: runtimeMod,
    client,
    userId: ADA,
    manifest: contractDataManifest,
    artifactIndex,
    schemaManifest,
    functionManifest: functionsManifest,
  });
}

async function currentRows(client) {
  return (await client.query('listTodos', { userId: ADA })).rows;
}

function createMemoryClient(seed, { holdMutations = false } = {}) {
  let rows = seed.map((row) => ({ ...row }));
  let counter = 0;
  const pending = [];

  const applyMutation = (name, { args = {}, userId } = {}) => {
    if (name === 'createTodo') {
      if (typeof args.priority !== 'string') {
        throw new Error('priority is required');
      }
      const id = `memory_${++counter}`;
      rows = [
        ...rows,
        {
          _id: id,
          _version: 1,
          _createdAt: Date.now(),
          _updatedAt: Date.now(),
          title: args.title,
          priority: args.priority,
          completed: false,
          userId,
        },
      ];
      return { id };
    }
    if (name === 'setPriority') {
      rows = rows.map((row) => row._id === args.id ? { ...row, priority: args.priority, _version: row._version + 1 } : row);
      return { changed: 1 };
    }
    if (name === 'setCompleted') {
      rows = rows.map((row) => row._id === args.id ? { ...row, completed: args.completed, _version: row._version + 1 } : row);
      return { changed: 1 };
    }
    if (name === 'deleteTodo') {
      rows = rows.filter((row) => row._id !== args.id);
      return { changed: 1 };
    }
    throw new Error(`unknown mutation ${name}`);
  };

  return {
    async query(_name, { userId } = {}) {
      return { rows: rows.filter((row) => row.userId === userId).map((row) => ({ ...row })) };
    },
    mutate(name, request) {
      if (!holdMutations) {
        return Promise.resolve().then(() => applyMutation(name, request));
      }
      return new Promise((resolve, reject) => {
        pending.push({ name, request, resolve, reject });
      });
    },
    pendingCount: () => pending.length,
    async releaseAll() {
      while (pending.length > 0) {
        const job = pending.shift();
        try {
          job.resolve(applyMutation(job.name, job.request));
        } catch (error) {
          job.reject(error);
        }
      }
    },
  };
}
