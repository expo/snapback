// DK-3 op-log delta, end to end through the real client (LLP 0008 §Decision
// DK-3 / LLP 0034 OQ1). The Rust side proves the server emits correct deltas
// and maintains membership; this proves demos/_kit/client.mjs's `applyDurable`
// live_delta branch applies them correctly over a real socket.
//
//   node demos/_kit/tests/live-delta-e2e.mjs
//
// Uses an inline HostPlan unordered filtered query (the analyzable subset that
// gets deltas — the shipped Ibex demos are ordered and fall back to replace).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SnapbackClient } from '../client.mjs';
import { startServer } from '../server-process.mjs';
import { assert, assertEqual, createSuite } from '../harness.mjs';
import {
  effectiveResultContract,
  resultContractHash,
} from '../../../packages/snapback-codegen/result-contracts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const ADA = 'ada';

const schema = {
  artifactKind: 'schemaManifest',
  schemaVersion: 'snapback.v0',
  appId: 'live-delta-e2e',
  tables: [
    {
      name: 'todos',
      fields: [
        { name: 'title', field_type: 'String', optional: false },
        { name: 'userId', field_type: 'String', optional: false },
      ],
      indexes: [],
      syncable: true,
      // @ref LLP 0264#d2-v1-default-write-posture-by-policy-kind — userId is
      // the delta matcher under test, not ownership authority.
      visibility: { kind: 'public-read' },
    },
  ],
};

const hostQuery = (name, order) => {
  const runtime = {
    HostPlan: {
      Query: {
        table: 'todos',
        filters: [{ field: 'userId', op: 'Eq', value: 'AuthUserId' }],
        order,
        limit: null,
        indexed_by: null,
      },
    },
  };
  const resultContract = effectiveResultContract({
    def: null,
    functionKind: 'LiveQuery',
    runtime,
    tables: Object.fromEntries(schema.tables.map((table) => [table.name, table])),
  });
  return {
    id: `live-delta-e2e:${name}`,
    name,
    kind: 'LiveQuery',
    runtime,
    resultContract,
    resultContractHash: resultContractHash(resultContract),
    requiredCapabilities: ['result_contract_v1'],
  };
};

const functions = {
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'live-delta-e2e',
  bundleHash: 'live-delta-e2e',
  inputsHash: 'live-delta-e2e',
  acknowledgedExperimentalCapabilities: ['result_contract_v1'],
  functions: [
    hostQuery('listMine', []),
    {
      id: 'live-delta-e2e:createTodo',
      name: 'createTodo',
      kind: 'Mutation',
      runtime: {
        HostPlan: {
          Mutation: {
            steps: [
              {
                Insert: {
                  table: 'todos',
                  values: { title: { Arg: 'title' }, userId: { Arg: 'userId' } },
                  bind_id_as: 'id',
                },
              },
            ],
            return_value: { Binding: 'id' },
          },
        },
      },
    },
    {
      id: 'live-delta-e2e:setUser',
      name: 'setUser',
      kind: 'Mutation',
      runtime: {
        HostPlan: {
          Mutation: {
            steps: [
              { Patch: { table: 'todos', id: { Arg: 'id' }, values: { userId: { Arg: 'userId' } } } },
            ],
            return_value: 'ChangedCount',
          },
        },
      },
    },
    {
      id: 'live-delta-e2e:deleteTodo',
      name: 'deleteTodo',
      kind: 'Mutation',
      runtime: {
        HostPlan: { Mutation: { steps: [{ Delete: { table: 'todos', id: { Arg: 'id' } } }], return_value: 'ChangedCount' } },
      },
    },
  ],
};

const server = await startServer({ port: 4419, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
const suite = createSuite('live_delta end to end (LLP 0034 OQ1 / DK-3)');

function recorder() {
  const updates = [];
  const waiters = new Set();
  const poke = () => {
    for (const w of [...waiters]) if (w.predicate()) { waiters.delete(w); clearTimeout(w.timer); w.resolve(); }
  };
  return {
    updates,
    onUpdate: (rows, meta) => { updates.push({ kind: meta.kind, ids: rows.map((r) => r._id).sort() }); poke(); },
    waitFor(predicate, label, timeoutMs = 5000) {
      if (predicate()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const w = { predicate, resolve, timer: setTimeout(() => { waiters.delete(w); reject(new Error(`timed out waiting for ${label}`)); }, timeoutMs) };
        waiters.add(w);
      });
    },
  };
}

try {
  await db.loadSchema(schema);
  const loaded = await db.loadFunctions(functions);
  assertEqual(
    loaded.diagnostics.filter((diagnostic) => ['Error', 'Fatal'].includes(diagnostic.severity)),
    [],
    'function manifest loads before live subscription',
  );
  await db.reset();

  const rec = recorder();
  const handle = await db.liveQuery('listMine', {
    connectionId: 'delta_conn',
    userId: ADA,
    transport: 'stream',
    stream: { heartbeatIntervalMs: 200, freshnessBudgetMs: 800, reconnectBaseDelayMs: 100, reconnectMaxDelayMs: 400 },
    onUpdate: rec.onUpdate,
  });

  try {
    await suite.check('a matching insert arrives as a live_delta add (not a replace)', async () => {
      const created = await db.mutate('createTodo', { args: { title: 'mine', userId: ADA }, userId: ADA });
      const id = created.result;
      await rec.waitFor(() => handle.rows.some((r) => r._id === id), 'matching insert delivered');
      const delta = rec.updates.find((u) => u.kind === 'live_delta');
      assert(delta, `expected a live_delta update; saw kinds ${rec.updates.map((u) => u.kind)}`);
      assertEqual(handle.rows.length, 1, 'one row after the matching insert');
      return { id, kinds: rec.updates.map((u) => u.kind) };
    });

    await suite.check('a non-matching insert produces no update for this subscription', async () => {
      const before = rec.updates.length;
      await db.mutate('createTodo', { args: { title: 'theirs', userId: 'bob' }, userId: 'bob' });
      // Phase 1 (LLP 0200): the skipped subscription converges through a
      // rows-free `current_as_of` watermark instead of silence. Wait for the
      // watermark — the deterministic "this commit's fan-out pass ran"
      // signal — then assert nothing row-bearing was delivered.
      await rec.waitFor(
        () => rec.updates.slice(before).some((u) => u.kind === 'current_as_of'),
        'convergence watermark for the non-matching commit',
      );
      assertEqual(
        rec.updates.slice(before).filter((u) => u.kind !== 'current_as_of'),
        [],
        'no row update for a non-matching commit',
      );
      assertEqual(handle.rows.length, 1, 'still one row');
      return { updates: rec.updates.length };
    });

    await suite.check('deleting the member arrives as a live_delta remove; rows converge to empty', async () => {
      const id = handle.rows[0]._id;
      await db.mutate('deleteTodo', { args: { id }, userId: ADA });
      await rec.waitFor(() => handle.rows.length === 0, 'member removed via delta');
      const last = rec.updates[rec.updates.length - 1];
      assertEqual(last.kind, 'live_delta', 'the removal is a delta, not a replace');
      return { finalRows: handle.rows.length, lastKind: last.kind };
    });
  } finally {
    handle.dispose();
  }

  const report = suite.finish();
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  await server.stop?.();
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error(error);
  await server.stop?.();
  process.exit(1);
}
