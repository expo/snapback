import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import { createSqliteRqsResumeStore } from '../../../packages/snapback-client/rqs-store-sqlite.mjs';
import { createNodeSqliteNamespace } from '../node-sqlite-adapter.mjs';

const input = JSON.parse(process.argv[2]);
const publish = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
if (input.command !== 'probe') setInterval(() => {}, 60_000);
let cutBoundary = null;
let cutPublished = false;
const never = new Promise(() => {});
const enqueueTarget = Object.freeze({
  schemaVersion: 'snapback.outbox-enqueue-target.v1',
  canonicalOrigin: 'https://expo-carrier-qualification.invalid',
  targetProfileId: 'expo-sqlite-qualification',
  artifactIdentity: Object.freeze({
    kind: 'app',
    appId: 'expo-local-first-carrier-qualification',
    generation: Object.freeze({
      schemaVersion: 'snapback.v0',
      appId: 'expo-local-first-carrier-qualification',
      schemaHash: `sha256:${'a'.repeat(64)}`,
      bundleHash: `sha256:${'b'.repeat(64)}`,
      inputsHash: `sha256:${'c'.repeat(64)}`,
    }),
  }),
});

const breakStore = (store) => {
  if (input.storeImplementation !== 'drop-generation-membership-write') return store;
  return Object.freeze({
    ...store,
    materializationTransaction(mode, operation) {
      if (mode !== 'readwrite') return store.materializationTransaction(mode, operation);
      return store.materializationTransaction(mode, (view) => {
        const memberships = new Map(view.memberships);
        const set = memberships.set.bind(memberships);
        Object.defineProperty(memberships, 'set', {
          value(key, value) {
            if (key === 'generation') return memberships;
            return set(key, value);
          },
        });
        return operation({ ...view, memberships });
      });
    },
  });
};

const open = async () => breakStore(await createSqliteRqsResumeStore({
  sqlite: createNodeSqliteNamespace(input.directory),
  databaseName: input.databaseName,
  async faultInjector(boundary) {
    if (cutPublished || cutBoundary !== boundary) return;
    cutPublished = true;
    publish({ status: 'cut-ready', boundary, insideTransaction: boundary.endsWith(':commit:before') });
    await never;
  },
}));

const entry = (key, value) => ({
  rows: [{ generation: value, key }],
  meta: {},
  token: String(value),
  bytes: 1,
  savedAt: value,
  resumedAt: 0,
  inProgress: false,
});

const writeGeneration = (store, value, watermark = null) => store.materializationTransaction(
  'readwrite',
  (view) => {
    view.entries.set('generation', entry('generation', value));
    view.materializations.set('generation', { generation: value });
    view.pageSets.set('generation', { generation: value });
    view.memberships.set('generation', { generation: value });
    if (watermark !== null) view.entries.set(`host-watermark:${watermark}`, entry(watermark, value));
  },
);

const serverExecuteOnce = (id) => {
  const server = new DatabaseSync(join(input.directory, 'qualification-server.sqlite'));
  server.exec(`CREATE TABLE IF NOT EXISTS executions (
    client_mutation_id TEXT PRIMARY KEY NOT NULL,
    execution_count INTEGER NOT NULL,
    result_json TEXT NOT NULL
  ) WITHOUT ROWID`);
  let row = server.prepare(
    'SELECT execution_count, result_json FROM executions WHERE client_mutation_id = ?',
  ).get(id);
  if (row === undefined) {
    const result = { ok: true, clientMutationId: id };
    server.prepare(
      'INSERT INTO executions (client_mutation_id, execution_count, result_json) VALUES (?, 1, ?)',
    ).run(id, JSON.stringify(result));
    row = { execution_count: 1, result_json: JSON.stringify(result) };
  }
  server.close();
  return JSON.parse(row.result_json);
};

const hostWatermark = async (store, phase, generation = 1) => {
  await store.commit(`host-watermark:${phase}`, {
    rows: [{ phase, generation }],
    meta: {},
    token: phase,
  });
  publish({ status: 'committed', hostWatermark: phase });
};

try {
  if (input.command === 'probe') {
    try {
      const store = await open();
      publish({ status: 'acquired', sqliteSourceId: store.qualificationFacts().sqliteSourceId });
      await store.close();
    } catch (error) {
      publish({ status: 'refused', code: error?.code ?? null });
    }
    process.exit(0);
  }

  const store = await open();
  if (input.command === 'hold') {
    publish({ status: 'ready', sqliteSourceId: store.qualificationFacts().sqliteSourceId });
  } else if (input.command === 'wal-candidate') {
    publish({ status: 'armed', phase: 'wal-candidate', sqliteSourceId: store.qualificationFacts().sqliteSourceId });
    await writeGeneration(store, 2, 'wal-candidate');
    publish({ status: 'committed', hostWatermark: 'wal-candidate' });
    publish({ status: 'cut-ready', boundary: 'wal-candidate-committed', insideTransaction: false });
    await never;
  } else if (input.command === 'phase') {
    const id = `phase-${input.phase}`;
    const predecessorKey = `predecessor-${input.phase}`;
    await store.commit(predecessorKey, {
      rows: [{ predecessor: true }], meta: {}, token: 'predecessor',
    });
    const predecessorMeta = await store.readStoreMeta();
    await store.wipeForAuthorityTransition();
    const successorMeta = await store.readStoreMeta();
    await writeGeneration(store, 1);
    await store.outboxEnqueue({
      id,
      function: 'qualificationMutation',
      args: { phase: input.phase },
      outboxRecordSchemaVersion: 2,
      enqueueTarget,
    });

    if (input.phase === 'consumed-before-ack' || input.phase === 'ack-proof-before-local-removal') {
      const result = serverExecuteOnce(id);
      await store.outboxDurablyConsume(id, { result }, 'qualification-user');
    }

    publish({
      status: 'armed',
      phase: input.phase,
      sqliteSourceId: store.qualificationFacts().sqliteSourceId,
      clientMutationId: id,
      predecessorKey,
      predecessorHandleKey: input.phase === 'authority-wipe-before-successor'
        ? successorMeta.handleKey
        : predecessorMeta.handleKey,
      initialSuccessorHandleKey: successorMeta.handleKey,
      enqueueTarget,
    });

    if (input.phase === 'pending-durable-before-delivery') {
      publish({ status: 'cut-ready', boundary: 'pending-durable-before-delivery', insideTransaction: false });
      await never;
    } else if (input.phase === 'server-result-before-local-settlement') {
      serverExecuteOnce(id);
      publish({ status: 'cut-ready', boundary: 'server-result-held-local-settlement-uncommitted', insideTransaction: false });
      await never;
    } else if (input.phase === 'commit-loop') {
      cutBoundary = 'materialization:commit:before';
      await writeGeneration(store, 2, input.phase);
    } else if (input.phase === 'committed-before-callback') {
      await writeGeneration(store, 2, input.phase);
      publish({ status: 'committed', hostWatermark: input.phase });
      publish({ status: 'cut-ready', boundary: 'commit-resolved-before-host-callback', insideTransaction: false });
      await never;
    } else if (input.phase === 'consumed-before-ack') {
      await hostWatermark(store, input.phase);
      publish({ status: 'cut-ready', boundary: 'settlement-consumed-before-ack-ready', insideTransaction: false });
      await never;
    } else if (input.phase === 'ack-proof-before-local-removal') {
      await store.outboxMarkAcknowledgementsReady([id], undefined, undefined, null, enqueueTarget);
      await hostWatermark(store, input.phase);
      publish({ status: 'cut-ready', boundary: 'ack-proof-before-local-removal', insideTransaction: false });
      await never;
    } else if (input.phase === 'authority-wipe-before-successor') {
      cutBoundary = 'authority-wipe:checkpoint-truncate:before';
      await store.wipeForAuthorityTransition(null, null, { rebaseUnscopedPending: true });
    } else {
      throw new Error(`unknown phase ${input.phase}`);
    }
  } else {
    throw new Error(`unknown command ${input.command}`);
  }
} catch (error) {
  publish({ status: 'error', code: error?.code ?? null, message: String(error?.message ?? error) });
  process.exit(1);
}
