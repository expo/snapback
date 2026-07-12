import assert from 'node:assert/strict';

import {
  createMemorySnapbackClientStore,
  createSnapbackContractSurface,
  snapbackAuthFingerprint,
} from './index.mjs';

const identity = {
  authFingerprint: snapbackAuthFingerprint('retained-user'),
  schemaHash: 'schema-retained',
  inputsHash: 'inputs-retained',
  targetProfileId: 'local-dev-sqlite-ibex',
  appId: 'retained-app',
  databaseId: 'database-a',
  versionStreamId: 'stream-a',
};

// Store-level compare-and-set: deliberately finish v2 before v1. The older
// completion must not overwrite the current retained cursor.
{
  const store = createMemorySnapbackClientStore();
  await store.scopeToAuth(identity.authFingerprint);
  await store.scopeToArtifacts(identity);
  let releaseOld;
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  const oldWrite = (async () => {
    await oldGate;
    return store.putRetainedQuery('q', {
      ...identity,
      rows: [{ version: 1 }],
      version: 1,
      cursor: { stream: identity.versionStreamId, version: 1 },
    });
  })();
  await store.putRetainedQuery('q', {
    ...identity,
    rows: [{ version: 2 }],
    version: 2,
    cursor: { stream: identity.versionStreamId, version: 2 },
  });
  releaseOld();
  await oldWrite;
  const retained = await store.getRetainedQuery('q', identity);
  assert.equal(retained.version, 2);
  assert.deepEqual(retained.rows, [{ version: 2 }]);
}

// Target and reset-stream transitions are invalidation boundaries, alongside
// app/database identity. scopeToArtifacts clears retained rows before a new
// target can observe them.
{
  const store = createMemorySnapbackClientStore();
  await store.scopeToAuth(identity.authFingerprint);
  await store.scopeToArtifacts(identity);
  await store.putRetainedQuery('q', {
    ...identity,
    rows: [{ secret: 'old-target' }],
    version: 4,
    cursor: { stream: identity.versionStreamId, version: 4 },
  });
  await store.scopeToArtifacts({ ...identity, targetProfileId: 'cloudflare-d1-workerd' });
  assert.equal(await store.getRetainedQuery('q', identity), null, 'target switch clears retained rows');

  const targetB = { ...identity, targetProfileId: 'cloudflare-d1-workerd' };
  await store.putRetainedQuery('q', {
    ...targetB,
    rows: [{ secret: 'pre-reset' }],
    version: 9,
    cursor: { stream: targetB.versionStreamId, version: 9 },
  });
  await store.scopeToArtifacts({ ...targetB, versionStreamId: 'stream-after-reset' });
  assert.equal(await store.getRetainedQuery('q', targetB), null, 'reset/version-stream switch clears retained rows');
}

const manifest = {
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  schemaVersion: 'snapback.v0',
  inputsHash: identity.inputsHash,
  schemaHash: identity.schemaHash,
  bundleHash: 'bundle-retained',
  capabilities: { derivedOptimisticOverlays: true, offlineReplay: true },
  queries: {
    listRows: { name: 'listRows', mode: 'live', defaultLive: true, reads: ['rows'] },
  },
  mutations: {
    patchRow: {
      optimistic: true,
      plan: {
        steps: [{ Patch: { table: 'rows', id: { Arg: 'id' }, values: { value: { Arg: 'value' } } } }],
        return_value: 'ChangedCount',
      },
    },
  },
};

const runtime = {
  createContractMockQueryBoundary(initialRows) {
    const cells = new Map(Object.entries(initialRows));
    return {
      query: (key, project = (value) => value) => project(cells.get(key) ?? []),
      write(key, update) {
        const next = update(cells.get(key) ?? []);
        cells.set(key, next);
        return next;
      },
    };
  },
  createBoundaryContractDataProvider(_manifest, boundary, options) {
    return { boundary, ...options };
  },
};

// Adapter-level serialization: hold the first persistence call open while
// newer live versions arrive. Later calls must not even enter the store until
// the older call settles, and flush waits for the final retained write.
{
  const baseStore = createMemorySnapbackClientStore();
  const calls = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const store = {
    ...baseStore,
    async putRetainedQuery(key, record) {
      calls.push(record.version);
      if (calls.length === 1) await firstGate;
      return baseStore.putRetainedQuery(key, record);
    },
  };
  let liveOptions;
  const client = {
    async liveQuery(_name, options) {
      liveOptions = options;
      return {
        rows: [{ _id: 'row', _version: 1, value: 1 }],
        version: 1,
        connection: 'live',
        dispose() {},
      };
    },
    async query() {
      return { rows: [], version: 0 };
    },
    async mutate() {
      return { changed: 0 };
    },
  };
  const surface = await createSnapbackContractSurface({
    runtime,
    client,
    clientStore: store,
    userId: 'retained-user',
    manifest,
    artifactIndex: { appId: identity.appId },
    schemaManifest: { schemaHash: identity.schemaHash, targetProfile: identity.targetProfileId },
    retainedIdentity: { databaseId: identity.databaseId, versionStreamId: identity.versionStreamId },
    queryName: 'listRows',
    boundaryKey: 'rows',
  });
  assert.equal(surface.capabilityClass, 'Parity');
  liveOptions.onUpdate([{ _id: 'row', _version: 2, value: 2 }], { version: 2 });
  liveOptions.onUpdate([{ _id: 'row', _version: 3, value: 3 }], { version: 3 });
  assert.deepEqual(calls, [1], 'newer writes wait behind the unresolved older write');
  releaseFirst();
  await surface.flush();
  assert.deepEqual(calls, [1, 2, 3]);
  const retained = await baseStore.getRetainedQuery('listRows:{}', identity);
  assert.equal(retained.version, 3);
  assert.equal(retained.cursor.stream, identity.versionStreamId);
  assert.equal(retained.appId, identity.appId);
  assert.equal(retained.databaseId, identity.databaseId);
  assert.equal(retained.targetProfileId, identity.targetProfileId);
  surface.dispose();
}

console.log('retained-identity.test.mjs: all assertions passed');
