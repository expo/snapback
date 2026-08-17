// Public LLP 0039 logout -> LLP 0059 participant -> LLP 0166 resident wipe
// plus LLP 0043 queue reconciliation coverage. Carrier-local mechanics remain
// covered by the rqs-store suites; this file proves resident state clears and
// predecessor queue bytes privacy-delete before anonymous publication resumes.

import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';
import { IDBFactory } from 'fake-indexeddb';

import { SnapbackClient } from './index.mjs';
import { createFileRqsResumeStore } from './rqs-store-file.mjs';
import {
  createMemoryRqsResumeStore,
  createMemoryRqsStoreBacking,
} from './rqs-store-memory.mjs';
import { createIndexedDbRqsResumeStore } from './rqs-store.mjs';

const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const SESSION = '018f0d90-7b12-7a22-8c33-445566778899';
const USER = '018f0d90-7b13-7a22-8c33-445566778899';
const AUTHORITY_INSTANCE = '018f0d90-7b14-7a22-8c33-445566778899';
const BEARER = 'sbs_logout_v3_bridge_fixture';

const grantingLocks = {
  request: (_name, _options, callback) => Promise.resolve(callback({ mode: 'exclusive' })),
};

const deploymentIdentity = (appId) => ({
  schemaVersion: 'snapback.v1',
  authMode: 'sessions',
  appId,
  schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
  bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
  inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
});

const availability = Object.freeze({
  onlineRequestResponse: { available: true, reason: null },
  authScopedLive: {
    available: false,
    minimumAuthInvalidationProtocol: 1,
    reason: 'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_REQUIRED',
  },
  retainedReads: {
    available: false,
    minimumAuthInvalidationProtocol: 1,
    minimumAuthorizedLeaseProtocol: 1,
    reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE',
  },
  queuedReplay: {
    available: true,
    minimumAuthorityDescriptorProtocol: 1,
    reason: null,
  },
});

const handshake = (appId, authenticated) => ({
  protocolVersion: 1,
  serverStartupNonce: 'logout-v3-startup',
  authorizationStreamIncarnation: INCARNATION,
  transitionGeneration: 0,
  activeMode: 'sessions',
  desiredMode: 'sessions',
  modeState: 'settled',
  appDataAvailability: 'available',
  quarantineCode: null,
  clientProtocols: {
    authClient: 1,
    authInvalidation: null,
    authorityDescriptor: 1,
    authorizedLease: null,
  },
  availability,
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: authenticated
    ? { kind: 'humanSession', userId: USER, sessionId: SESSION, isAuthenticated: true }
    : { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: authenticated ? AUTHORITY_INSTANCE : INCARNATION,
    sessionGeneration: authenticated ? 1 : 0,
  },
  deploymentIdentity: deploymentIdentity(appId),
  authorizedLease: null,
});

const credential = () => ({
  tokenType: 'Bearer',
  token: BEARER,
  refreshAfter: Date.now() + 60_000,
  session: {
    id: SESSION,
    userId: USER,
    provider: 'email-code',
    createdAt: Date.now(),
    expiresAt: Date.now() + 120_000,
    absoluteExpiresAt: Date.now() + 240_000,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: AUTHORITY_INSTANCE,
    sessionGeneration: 1,
  },
});

const retainedEntry = Object.freeze({
  rows: [{ _id: 'logout-v3-retained', value: 'predecessor' }],
  meta: { opaque: 'logout-v3-retained' },
  token: 'logout-v3-token',
});

const populatedMeta = (meta) => ({
  ...meta,
  generationCounters: {
    writerGeneration: 9,
    authorityGenerationHighWater: 7,
    queryGenerationHighWater: 8,
  },
  durableRegistrations: { logout: { source: 'programmatic' } },
  policyBudgetFacts: { materializationBytes: 123 },
  brokerRoster: { context: { revision: 4 } },
  fenceHighWaters: { qmk: 11 },
  tombstoneHighWaters: { qmk: 12 },
  barrierHighWaters: { authority: 13 },
});

const assertWipedMeta = (before, after) => {
  assert.equal(after.clientStoreId, before.clientStoreId);
  assert.equal(after.formatVersion, before.formatVersion);
  assert.equal(after.queryInstanceIdHighWater, before.queryInstanceIdHighWater);
  assert.deepEqual(after.generationCounters, before.generationCounters);
  assert.deepEqual(after.fenceHighWaters, before.fenceHighWaters);
  assert.deepEqual(after.tombstoneHighWaters, before.tombstoneHighWaters);
  assert.deepEqual(after.barrierHighWaters, before.barrierHighWaters);
  assert.deepEqual(after.durableRegistrations, {});
  assert.deepEqual(after.policyBudgetFacts, {});
  assert.deepEqual(after.brokerRoster, {});
  assert.notEqual(after.handleKey, before.handleKey);
};

const residentSnapshot = async (store) => ({
  entry: await store.load('logout-v3-entry'),
  pendingOutbox: await store.outboxPending(),
  receipt: await store.loadReactBindingReceipt(),
  sections: await store.materializationTransaction('readonly', (view) => ({
    materializations: view.materializations.size,
    pageSets: view.pageSets.size,
    memberships: view.memberships.size,
  })),
});

const assertPopulated = (snapshot) => {
  assert.notEqual(snapshot.entry, null);
  assert.deepEqual(snapshot.pendingOutbox.map((record) => record.id), ['logout-v3-pending']);
  assert.notEqual(snapshot.receipt, null);
  assert.deepEqual(snapshot.sections, { materializations: 1, pageSets: 1, memberships: 1 });
};

const assertCleared = (snapshot) => {
  assert.equal(snapshot.entry, null);
  assert.deepEqual(snapshot.pendingOutbox, []);
  assert.equal(snapshot.receipt, null);
  assert.deepEqual(snapshot.sections, { materializations: 0, pageSets: 0, memberships: 0 });
};

const assertResidentClearedBeforeQueueReconcile = (snapshot) => {
  assert.equal(snapshot.entry, null);
  assert.deepEqual(snapshot.pendingOutbox.map((record) => record.id), ['logout-v3-pending']);
  assert.equal(snapshot.receipt, null);
  assert.deepEqual(snapshot.sections, { materializations: 0, pageSets: 0, memberships: 0 });
};

async function seedPredecessorState(store) {
  assert.equal(await store.allocateQueryInstanceId(), 1);
  assert.equal(await store.allocateQueryInstanceId(), 2);
  await store.writeStoreMeta(populatedMeta(await store.readStoreMeta()));
  assert.equal((await store.commit('logout-v3-entry', retainedEntry)).persisted, true);
  await store.outboxEnqueue({
    id: 'logout-v3-pending',
    function: 'writePredecessor',
    authorityDescriptor: {
      descriptorVersion: 1,
      authorityInstanceId: AUTHORITY_INSTANCE,
      sessionGeneration: 1,
    },
    principalScope: {
      authMode: 'sessions',
      authorizationStreamIncarnation: INCARNATION,
      userId: USER,
    },
    custody: { authorityEpoch: 1, authorityKey: 'logout-v3-predecessor' },
  });
  assert.equal(await store.commitReactBindingReceipt({ binding: 'logout-v3' }), true);
  await store.materializationTransaction('readwrite', (view) => {
    view.materializations.set('logout-v3-materialization', { occupied: true });
    view.pageSets.set('logout-v3-page-set', { occupied: true });
    view.memberships.set('logout-v3-membership', { occupied: true });
  });
}

async function exercisePublicLogout({
  label,
  store,
  prepareStore = () => store.whenLockSettled(),
  afterSeed = null,
  afterLogout = null,
}) {
  await prepareStore();
  assert.equal(store.isWriter(), true, `${label}: store writer acquired`);

  let wipeCalls = 0;
  const injectedStore = Object.create(store);
  injectedStore.wipeForAuthorityTransition = async () => {
    wipeCalls += 1;
    return store.wipeForAuthorityTransition();
  };

  const appId = `snapback.test/logout-v3-${label}`;
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient('https://logout-v3.test', {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: injectedStore,
    offlineQueue: false,
  });

  const originalFetch = globalThis.fetch;
  let logoutPosted = false;
  let anonymousResumeObserved = false;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const headers = new Headers(init.headers);
    if (path === '/auth/session') {
      const authenticated = headers.get('authorization') === `Bearer ${BEARER}`;
      if (logoutPosted) {
        assert.equal(authenticated, false, `${label}: logout resumes without predecessor bearer`);
        assertResidentClearedBeforeQueueReconcile(await residentSnapshot(store));
        anonymousResumeObserved = true;
      }
      return Response.json(handshake(appId, authenticated));
    }
    if (path === '/auth/exchange') return Response.json(credential());
    if (path === '/auth/logout') {
      assert.equal(headers.get('authorization'), `Bearer ${BEARER}`);
      logoutPosted = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`${label}: unexpected auth request ${init.method ?? 'GET'} ${path}`);
  };

  try {
    await client.authExchange({ challengeId: 'logout-v3-challenge', code: '123456' });
    await seedPredecessorState(store);
    await afterSeed?.();
    const before = await store.readStoreMeta();
    assertPopulated(await residentSnapshot(store));
    const wipeCallsBeforeLogout = wipeCalls;

    assert.equal(await client.authLogout(), null);
    assert.equal(
      wipeCalls,
      wipeCallsBeforeLogout + 1,
      `${label}: logout invokes one authority-transition wipe`,
    );
    assert.equal(anonymousResumeObserved, true, `${label}: wipe finishes before anonymous resume`);
    assertCleared(await residentSnapshot(store));
    const after = await store.readStoreMeta();
    assertWipedMeta(before, after);
    assert.equal(await store.allocateQueryInstanceId(), 3, `${label}: allocator never reuses`);
    await afterLogout?.();
  } finally {
    globalThis.fetch = originalFetch;
    await client.closeAuth();
    await store.close();
  }
}

test('public authLogout runs the v3 client-wide wipe on memory, IndexedDB, and file carriers', async (t) => {
  await t.test('memory', async () => {
    const backing = createMemoryRqsStoreBacking({ clientStoreId: 'logout-v3-memory' });
    await exercisePublicLogout({
      label: 'memory',
      store: createMemoryRqsResumeStore({ backing }),
    });
  });

  await t.test('indexeddb', async () => {
    const store = createIndexedDbRqsResumeStore({
      indexedDB: new IDBFactory(),
      lockManager: grantingLocks,
      databaseName: 'logout-v3-indexeddb',
      clientStoreId: 'logout-v3-indexeddb',
    });
    await exercisePublicLogout({
      label: 'indexeddb',
      store,
      // The IndexedDB carrier holds the Web Lock callback until close, so
      // readiness is the first successful store read rather than settlement
      // of that lifetime promise.
      prepareStore: () => store.readStoreMeta(),
    });
  });

  await t.test('file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'snapback-logout-v3-file-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    let siblingStoreId = null;
    await exercisePublicLogout({
      label: 'file',
      store: createFileRqsResumeStore({
        directory,
        identity: 'logout-owner',
        clientStoreId: 'logout-v3-file',
      }),
      afterSeed: async () => {
        const sibling = createFileRqsResumeStore({
          directory,
          identity: 'logout-sibling',
          clientStoreId: 'logout-v3-file-sibling',
        });
        await sibling.whenLockSettled();
        siblingStoreId = (await sibling.readStoreMeta()).clientStoreId;
        assert.equal((await sibling.commit('sibling-entry', retainedEntry)).persisted, true);
        await sibling.outboxEnqueue({ id: 'sibling-pending', function: 'writeSibling' });
        await sibling.close();
        assert.equal((await readdir(directory)).filter((name) => name.endsWith('.v1.json')).length, 2);
      },
      afterLogout: async () => {
        assert.equal(
          (await readdir(directory)).filter((name) => name.endsWith('.v1.json')).length,
          1,
          'file: authority-transition wipe sweeps sibling identity blobs',
        );
        const reopenedSibling = createFileRqsResumeStore({
          directory,
          identity: 'logout-sibling',
        });
        await reopenedSibling.whenLockSettled();
        assert.notEqual((await reopenedSibling.readStoreMeta()).clientStoreId, siblingStoreId);
        assert.equal(await reopenedSibling.load('sibling-entry'), null);
        assert.deepEqual(await reopenedSibling.outboxPending(), []);
        await reopenedSibling.close();
      },
    });
  });
});

test('logout fails closed when the v3 wipe cannot advance queue authority', async () => {
  const backing = createMemoryRqsStoreBacking({ clientStoreId: 'logout-v3-availability' });
  const store = createMemoryRqsResumeStore({ backing });
  await store.whenLockSettled();
  let failWipe = false;
  const injectedStore = Object.create(store);
  injectedStore.wipeForAuthorityTransition = async () => {
    if (failWipe) throw new Error('fixture wipe failure');
    return store.wipeForAuthorityTransition();
  };
  const appId = 'snapback.test/logout-v3-availability';
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient('https://logout-v3.test', {
    authCoordinator: coordinator,
    rqsStore: injectedStore,
    offlineQueue: false,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') {
      return Response.json(handshake(
        appId,
        new Headers(init.headers).get('authorization') === `Bearer ${BEARER}`,
      ));
    }
    if (path === '/auth/exchange') return Response.json(credential());
    if (path === '/auth/logout') return new Response(null, { status: 204 });
    throw new Error(`unexpected auth request ${path}`);
  };
  try {
    await client.authExchange({ challengeId: 'logout-v3-challenge', code: '123456' });
    await seedPredecessorState(store);
    failWipe = true;
    await assert.rejects(
      () => client.authLogout(),
      (error) => error.code === 'SNAPBACK_AUTH_TRANSITION_FAILED',
    );
    assert.equal(coordinator.authority, null, 'failed durable transition remains fail-closed');
    const retained = await residentSnapshot(store);
    assert.notEqual(retained.entry, null);
    assert.deepEqual(
      retained.pendingOutbox.map((record) => record.id),
      ['logout-v3-pending'],
      'predecessor intent remains hidden in the store when the transition cannot disposition it',
    );
    assert.notEqual(retained.receipt, null);
    assert.deepEqual(retained.sections, { materializations: 1, pageSets: 1, memberships: 1 });
  } finally {
    globalThis.fetch = originalFetch;
    await client.closeAuth();
    await store.close();
  }
});
