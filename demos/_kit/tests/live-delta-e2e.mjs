// DK-3 op-log delta, end to end through the real client (LLP 0008 §Decision
// DK-3 / LLP 0034 OQ1). The Rust side proves the server emits correct deltas
// and maintains membership; this proves demos/_kit/client.mjs's `applyDurable`
// live_delta branch applies them correctly over a real socket.
//
//   node demos/_kit/tests/live-delta-e2e.mjs
//
// Uses an inline HostPlan unordered filtered query (the analyzable subset that
// gets deltas — the shipped Ibex demos are ordered and fall back to replace).

import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { SnapbackClient, createFileRqsResumeStore } from '../client.mjs';
import { startServer } from '../server-process.mjs';
import { assert, assertEqual, createSuite } from '../harness.mjs';
import {
  effectiveResultContract,
  resultContractHash,
} from '../../../packages/snapback-codegen/result-contracts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const ADA = 'ada';
const FAST_STREAM = {
  heartbeatIntervalMs: 200,
  freshnessBudgetMs: 800,
  reconnectBaseDelayMs: 100,
  reconnectMaxDelayMs: 400,
};

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
        { name: 'parentId', field_type: 'String', optional: true },
        { name: 'replyCount', field_type: 'Integer', optional: false },
        { name: 'createdAt', field_type: 'Integer', optional: false },
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

const filteredHostQuery = (name, filters, limit = null, order = []) => {
  const runtime = {
    HostPlan: {
      Query: {
        table: 'todos',
        filters,
        order,
        limit,
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
    filteredHostQuery(
      'postById',
      [{ field: '_id', op: 'Eq', value: { Arg: 'id' } }],
      1,
    ),
    filteredHostQuery(
      'repliesForPostUnordered',
      [{ field: 'parentId', op: 'Eq', value: { Arg: 'parentId' } }],
    ),
    filteredHostQuery(
      'repliesForPost',
      [{ field: 'parentId', op: 'Eq', value: { Arg: 'parentId' } }],
      null,
      [{ field: 'createdAt', direction: 'Asc' }],
    ),
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
                  values: {
                    title: { Arg: 'title' },
                    userId: { Arg: 'userId' },
                    replyCount: { Arg: 'replyCount' },
                    createdAt: { Arg: 'createdAt' },
                  },
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
      id: 'live-delta-e2e:writePost',
      name: 'writePost',
      kind: 'Mutation',
      runtime: {
        HostPlan: {
          Mutation: {
            steps: [
              {
                Insert: {
                  table: 'todos',
                  values: {
                    title: { Arg: 'title' },
                    userId: { Arg: 'userId' },
                    parentId: { Arg: 'parentId' },
                    replyCount: { Arg: 'replyCount' },
                    createdAt: { Arg: 'createdAt' },
                  },
                  bind_id_as: 'id',
                },
              },
              {
                Patch: {
                  table: 'todos',
                  id: { Arg: 'parentId' },
                  values: { replyCount: { Arg: 'nextReplyCount' } },
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
  const wireFrames = [];
  const waiters = new Set();
  const poke = () => {
    for (const w of [...waiters]) if (w.predicate()) { waiters.delete(w); clearTimeout(w.timer); w.resolve(); }
  };
  return {
    updates,
    wireFrames,
    onUpdate: (rows, meta) => {
      updates.push({
        kind: meta.kind,
        ids: rows.map((row) => row._id).sort(),
        rows: structuredClone(rows),
        meta: structuredClone(meta),
      });
      poke();
    },
    onWire: (frame) => {
      wireFrames.push(structuredClone(frame));
      poke();
    },
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
    stream: FAST_STREAM,
    onUpdate: rec.onUpdate,
  });

  try {
    await suite.check('a matching insert arrives as a live_delta add (not a replace)', async () => {
      const created = await db.mutate('createTodo', {
        args: { title: 'mine', userId: ADA, replyCount: 0, createdAt: 10 },
        userId: ADA,
      });
      const id = created.result;
      await rec.waitFor(() => handle.rows.some((r) => r._id === id), 'matching insert delivered');
      const delta = rec.updates.find((u) => u.kind === 'live_delta');
      assert(delta, `expected a live_delta update; saw kinds ${rec.updates.map((u) => u.kind)}`);
      assertEqual(handle.rows.length, 1, 'one row after the matching insert');
      return { id, kinds: rec.updates.map((u) => u.kind) };
    });

    await suite.check('a non-matching insert produces no update for this subscription', async () => {
      const before = rec.updates.length;
      await db.mutate('createTodo', {
        args: { title: 'theirs', userId: 'bob', replyCount: 0, createdAt: 11 },
        userId: 'bob',
      });
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

  const parentId = 'post_parent';
  const canonicalId = 'post_reply';
  // `SnapbackProvisionalId<'todos'>` is the durable outbox intent identity,
  // not the canonical row address produced by the replay ledger.
  /** @type {import('../../../packages/snapback-client/index.d.mts').SnapbackProvisionalId<'todos'>} */
  const provisionalId = 'mut_live_query_provisional';
  const parent = await db.mutate('createTodo', {
    args: { title: 'parent', userId: ADA, replyCount: 0, createdAt: 1 },
    userId: ADA,
    ctxLedger: { version: 1, ids: [parentId], now: 1_785_758_399_000 },
  });
  assertEqual(parent.result, parentId, 'the thread parent uses the canonical fixture id');

  const writerStoreDirectory = mkdtempSync(join(tmpdir(), 'snapback-live-delta-outbox-'));
  const writerStore = createFileRqsResumeStore({
    directory: writerStoreDirectory,
    clientStoreId: 'live-delta-e2e-writer',
  });
  await writerStore.whenLockSettled();
  const writer = new SnapbackClient(server.baseUrl, {
    ...server.clientOptions,
    rqsStore: writerStore,
    offlineQueue: true,
  });
  const subscriber = new SnapbackClient(server.baseUrl, server.clientOptions);
  const connectionId = 'delta_characterization_subscriber';
  const wireRec = recorder();
  const stopWireCapture = subscriber
    .liveStreamManager(connectionId, FAST_STREAM)
    .onDurable(wireRec.onWire);
  const pointRec = recorder();
  const parentRec = recorder();
  const orderedParentRec = recorder();
  const provisionalPointRec = recorder();
  const pointHandle = await subscriber.liveQuery('postById', {
    args: { id: canonicalId },
    connectionId,
    userId: ADA,
    transport: 'stream',
    stream: FAST_STREAM,
    onUpdate: pointRec.onUpdate,
  });
  const parentHandle = await subscriber.liveQuery('repliesForPostUnordered', {
    args: { parentId },
    connectionId,
    userId: ADA,
    transport: 'stream',
    stream: FAST_STREAM,
    onUpdate: parentRec.onUpdate,
  });
  const orderedParentHandle = await subscriber.liveQuery('repliesForPost', {
    args: { parentId },
    connectionId,
    userId: ADA,
    transport: 'stream',
    stream: FAST_STREAM,
    onUpdate: orderedParentRec.onUpdate,
  });
  const provisionalPointHandle = await subscriber.liveQuery('postById', {
    args: { id: provisionalId },
    connectionId,
    userId: ADA,
    transport: 'stream',
    stream: FAST_STREAM,
    onUpdate: provisionalPointRec.onUpdate,
  });

  try {
    await suite.check('matcher characterization: second-client socket preserves identity and operation payloads', async () => {
      assertEqual(provisionalId === canonicalId, false, 'provisional and canonical identities are distinct');
      assertEqual(pointHandle.rows, [], 'canonical point snapshot starts empty before insert');
      assertEqual(parentHandle.rows, [], 'unordered parent snapshot starts empty before insert');
      assertEqual(orderedParentHandle.rows, [], 'ordered parent snapshot starts empty before insert');
      assertEqual(provisionalPointHandle.rows, [], 'provisional point snapshot is not a row address');

      const created = await writer.mutate('writePost', {
        args: {
          title: 'reply',
          userId: ADA,
          parentId,
          replyCount: 0,
          nextReplyCount: 1,
          createdAt: 2,
        },
        userId: ADA,
        clientMutationId: provisionalId,
        queue: true,
        ctxLedger: { version: 1, ids: [canonicalId], now: 1_785_758_400_000 },
      });
      assertEqual(created.result, canonicalId, 'settlement returns the canonical row id');
      assertEqual(created.status, 'settled', 'the outbox-identified write settled online');
      assertEqual(
        (await writer.mutationStatus(provisionalId)).status,
        'settled',
        'the provisional identity remains the settled outbox identity',
      );

      await wireRec.waitFor(
        () => wireRec.wireFrames.some((frame) => (
          frame.kind === 'live_delta'
          && frame.subscription_id === pointHandle.subscriptionId
        )),
        'canonical point Add frame',
      );
      await wireRec.waitFor(
        () => wireRec.wireFrames.some((frame) => (
          frame.kind === 'live_delta'
          && frame.subscription_id === parentHandle.subscriptionId
        )),
        'parent-list Add frame',
      );
      await orderedParentRec.waitFor(
        () => orderedParentHandle.rows.some((row) => row._id === canonicalId),
        'ordered parent replacement',
      );
      await provisionalPointRec.waitFor(
        () => provisionalPointRec.updates.some((update) => update.kind === 'current_as_of'),
        'provisional point convergence watermark',
      );

      assertEqual(
        pointRec.updates.map((update) => update.kind),
        ['snapshot', 'live_delta'],
        'canonical point delivery orders snapshot before Add',
      );
      assertEqual(
        pointRec.updates.map((update) => update.ids),
        [[], [canonicalId]],
        'canonical point recorder retains the snapshot and delta row payloads',
      );
      assertEqual(
        parentRec.updates.map((update) => update.kind),
        ['snapshot', 'live_delta'],
        'parent delivery orders snapshot before Add',
      );
      assertEqual(
        parentRec.updates.map((update) => update.ids),
        [[], [canonicalId]],
        'parent recorder retains the snapshot and delta row payloads',
      );
      assertEqual(
        orderedParentRec.updates.map((update) => update.kind),
        ['snapshot', 'live_replace'],
        'ordered parent list conservatively replaces and keeps the child',
      );
      assertEqual(
        provisionalPointRec.updates.map((update) => update.kind),
        ['snapshot', 'current_as_of'],
        'provisional point filter remains empty and converges without an Add',
      );

      // The authoritative snapshot is the subscribe response; the later Add
      // is the durable socket frame. The recorder assertions above bind their
      // delivery order, while these raw frames retain the exact operation.
      for (const [label, handle, expectedRow] of [
        ['point', pointHandle, pointHandle.rows[0]],
        ['parent', parentHandle, parentHandle.rows[0]],
      ]) {
        const frames = wireRec.wireFrames.filter(
          (candidate) => candidate.subscription_id === handle.subscriptionId,
        );
        assertEqual(
          frames.map((frame) => frame.kind),
          ['live_delta'],
          `${label} raw durable socket carries exactly one Add frame`,
        );
        assertEqual(
          frames[0].ops,
          [{ op: 'add', id: canonicalId, row: expectedRow }],
          `${label} raw Add payload`,
        );
      }
      assertEqual(pointHandle.rows.map((row) => row._id), [canonicalId], 'point keeps the canonical row');
      assertEqual(parentHandle.rows.map((row) => row._id), [canonicalId], 'parent keeps the canonical child');
      assertEqual(orderedParentHandle.rows.map((row) => row._id), [canonicalId], 'ordered parent keeps the child');
      assertEqual(provisionalPointHandle.rows, [], 'provisional point never aliases the canonical row');
      return {
        provisionalId,
        canonicalId,
        pointKinds: pointRec.updates.map((update) => update.kind),
        parentKinds: parentRec.updates.map((update) => update.kind),
        orderedParentKinds: orderedParentRec.updates.map((update) => update.kind),
        wireOps: wireRec.wireFrames
          .filter((frame) => frame.kind === 'live_delta')
          .map((frame) => frame.ops),
      };
    });

    await suite.check('matcher characterization: post-insert canonical subscribe snapshots the row', async () => {
      const freshRec = recorder();
      const freshHandle = await subscriber.liveQuery('postById', {
        args: { id: canonicalId },
        connectionId,
        userId: ADA,
        transport: 'stream',
        stream: FAST_STREAM,
        onUpdate: freshRec.onUpdate,
      });
      try {
        assertEqual(freshRec.updates.map((update) => update.kind), ['snapshot'], 'fresh subscribe starts with snapshot');
        assertEqual(freshHandle.rows.map((row) => row._id), [canonicalId], 'canonical snapshot contains the row');
        return { canonicalId, kinds: freshRec.updates.map((update) => update.kind) };
      } finally {
        freshHandle.dispose();
      }
    });
  } finally {
    pointHandle.dispose();
    parentHandle.dispose();
    orderedParentHandle.dispose();
    provisionalPointHandle.dispose();
    stopWireCapture();
    await writerStore.close();
    rmSync(writerStoreDirectory, { recursive: true, force: true });
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
