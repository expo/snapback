// Regression for the asset external store's LLP 0053 integration: the
// production watcher must apply through SnapbackClient.liveQuery so witnessed
// snapshots commit before ACK, exact redelivery re-ACKs without reapplying,
// and a failed external-store publication cannot discharge the obligation.

import assert from 'node:assert/strict';

import { SnapbackClient } from './index.mjs';
import { SnapbackAssetClient } from './assets.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';

const originalFetch = globalThis.fetch;
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const issuerId = {
  authorizationIncarnation: INCARNATION,
  bootSequence: 7,
  bootNonce: 'ABCDEFGHIJKLMNOPQRSTUV',
};
const authorization = { incarnation: INCARNATION, epoch: 4 };

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const handshake = {
  protocolVersion: 1,
  serverStartupNonce: 'startup-asset-watch-ack',
  authorizationStreamIncarnation: INCARNATION,
  transitionGeneration: 1,
  activeMode: 'sessions',
  desiredMode: 'sessions',
  modeState: 'settled',
  appDataAvailability: 'available',
  quarantineCode: null,
  clientProtocols: {
    authClient: 1,
    authInvalidation: 1,
    authorityDescriptor: null,
    authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: { available: true, minimumAuthInvalidationProtocol: 1, reason: null },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: null,
    },
    queuedReplay: {
      available: false,
      minimumAuthorityDescriptorProtocol: 1,
      reason: null,
    },
  },
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: { userId: 'user_asset', sessionId: 'session_asset', isAuthenticated: true },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: INCARNATION,
    sessionGeneration: 1,
  },
  authorizedLease: null,
};

const witness = (version) => ({
  authorization,
  data: { versionStream: 'stream-assets', minCommitVersion: version },
});

const obligation = (scopeId, revision, version) => ({
  protocolVersion: 1,
  scopeId,
  revision,
  maxDisposition: 'quarantine',
  witness: witness(version),
  retryEpisodeId: null,
  ownerContinuityId: 'owner_asset_watch',
});

const resolution = (pending, ackToken) => ({
  protocolVersion: 1,
  kind: 'snapshot',
  scopeId: pending.scopeId,
  revision: pending.revision,
  witness: pending.witness,
  maxDisposition: pending.maxDisposition,
  ackToken,
  ownerContinuityId: pending.ownerContinuityId,
});

const frame = (pending, ackToken, availability, version) => ({
  Durable: {
    payload: JSON.stringify({
      kind: 'authorization_invalidation',
      obligation: pending,
      resolution: resolution(pending, ackToken),
      snapshot: {
        subscriptionId: 'sub_asset_watch',
        function: '_snapback.assetRecord',
        version,
        rows: [{ assetId: 'asset_ack', availability }],
      },
    }),
  },
});

const waitFor = async (check, label) => {
  const deadline = Date.now() + 1_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? 'timed out'}`);
};

const runWatcher = async ({ failAvailability = null } = {}) => {
  const outbox = [];
  const acknowledgements = [];
  let namespace = null;
  let scopeId = null;
  let store = null;
  const queueStore = createMemoryRqsResumeStore();
  queueStore.durability = () => ({ implementation: 'asset-watch-test', durable: true });
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') return response(handshake);
    if (path === '/connection/open') {
      return response({
        connectionId: 'granted-asset-watch',
        connectionToken: 'sct_asset_watch',
        ephemeralExpiryProtocol: 1,
        wireVersion: 'snapback.v1',
        authorizationInvalidation: {
          protocolVersion: 1,
          issuerId,
          connectionGeneration: 2,
          authorization,
          versionStream: 'stream-assets',
        },
      });
    }
    if (path === '/live/_snapback.assetRecord/subscribe') {
      const body = JSON.parse(init.body);
      namespace = body.authorizationNamespace;
      scopeId = {
        kind: 'subscription',
        issuerId,
        namespace,
        scopeSequence: 1,
        connectionGeneration: 2,
        subscriptionId: 'sub_asset_watch',
      };
      const pending = obligation(scopeId, 1, 10);
      return response({
        subscription_id: 'sub_asset_watch',
        snapshot: {
          version: 10,
          rows: [{ assetId: 'asset_ack', availability: 'pending' }],
        },
        permission_epochs: {},
        authorizationScope: scopeId,
        authorizationInvalidation: {
          obligation: pending,
          resolution: resolution(pending, 'ack_asset_1'),
        },
      });
    }
    if (path === '/live/authorization-invalidation/acknowledge') {
      const { ackToken } = JSON.parse(init.body);
      // The external-store commit is the publication point that must precede
      // the wire ACK. A future refactor that ACKs from the raw lane fails here.
      assert.equal(store?.getSnapshot().status, 'ready');
      acknowledgements.push(ackToken);
      return response({
        outcome: acknowledgements.filter((token) => token === ackToken).length === 1
          ? 'discharged'
          : 'duplicate',
      });
    }
    if (path === '/outbox/granted-asset-watch') return response(outbox.shift() ?? []);
    if (path === '/live/_snapback.assetRecord/unsubscribe') {
      return response({ subscription_id: 'sub_asset_watch', disposed: true });
    }
    throw new Error(`unexpected asset watch request: ${path}`);
  };

  const client = new SnapbackClient('http://asset-watch.test', {
    bearerToken: 'session-asset-watch',
    authInvalidationProtocol: 1,
    clientStoreId: 'store_asset_watch',
    rqsStore: queueStore,
  });
  const manager = {
    onState: () => () => {},
    isOpen: () => true,
    isReady: () => true,
    waitUntilReady: async () => {},
  };
  client.liveStreamManager = () => manager;
  store = new SnapbackAssetClient(client).watchStore('asset_ack', {
    userId: 'user_asset',
    connectionId: 'asset-watch-label',
  });
  const publications = [];
  store.subscribe((snapshot) => {
    publications.push(snapshot.record?.availability ?? snapshot.status);
    if (snapshot.record?.availability === failAvailability) {
      throw new Error('injected external-store apply failure');
    }
  });
  await waitFor(
    () => assert.equal(store.getSnapshot().record?.availability, 'pending'),
    'asset watcher establishment did not publish',
  );
  await waitFor(
    () => assert.deepEqual(acknowledgements, ['ack_asset_1']),
    'asset watcher establishment did not ACK after publication',
  );
  assert.equal(
    publications.filter((value) => value === 'pending').length,
    1,
    'authorization establishment publishes the asset snapshot exactly once',
  );
  assert.equal(namespace.clientStoreId, 'store_asset_watch');
  assert.equal(namespace.queryKey, '_snapback.assetRecord:{"assetId":"asset_ack"}');
  assert(Number.isSafeInteger(namespace.queryInstanceId) && namespace.queryInstanceId > 0);
  return {
    acknowledgements,
    client,
    namespace,
    outbox,
    publications,
    queueStore,
    scopeId,
    store,
  };
};

try {
  let firstQueryInstanceId = null;
  // Same-turn duplicates share one resolution task. Delayed exact redelivery
  // re-ACKs the original token without publishing the snapshot a second time.
  {
    const harness = await runWatcher();
    firstQueryInstanceId = harness.namespace.queryInstanceId;
    const pending = obligation(harness.scopeId, 2, 11);
    const update = frame(pending, 'ack_asset_2', 'ready', 11);
    harness.outbox.push([update, structuredClone(update)]);
    await harness.client.drainConnection('asset-watch-label');
    await waitFor(
      () => assert.equal(
        harness.acknowledgements.filter((token) => token === 'ack_asset_2').length,
        1,
      ),
      'same-turn asset redelivery did not share one ACK task',
    );
    assert.equal(
      harness.publications.filter((value) => value === 'ready').length,
      1,
      'same-turn duplicate reapplied the asset snapshot',
    );

    harness.outbox.push([structuredClone(update)]);
    await harness.client.drainConnection('asset-watch-label');
    await waitFor(
      () => assert.equal(
        harness.acknowledgements.filter((token) => token === 'ack_asset_2').length,
        2,
      ),
      'delayed asset redelivery did not re-ACK its exact token',
    );
    assert.equal(
      harness.publications.filter((value) => value === 'ready').length,
      1,
      'delayed exact redelivery reapplied an already committed asset snapshot',
    );
    harness.store.dispose();
    await harness.client.closeAuth();
    await harness.queueStore.close();
  }

  // The synchronous authorization boundary is fallible. If its external-store
  // publication throws, liveQuery rolls back and no transport ACK is emitted.
  {
    const harness = await runWatcher({ failAvailability: 'apply-fails' });
    assert(
      harness.namespace.queryInstanceId > firstQueryInstanceId,
      'a later asset watcher allocates a never-reused LLP 0053 query identity',
    );
    const pending = obligation(harness.scopeId, 2, 11);
    harness.outbox.push([frame(pending, 'ack_apply_failure', 'apply-fails', 11)]);
    await harness.client.drainConnection('asset-watch-label');
    await waitFor(
      () => assert.equal(harness.store.getSnapshot().status, 'blank'),
      'failed asset publication did not fail closed',
    );
    assert.equal(
      harness.acknowledgements.includes('ack_apply_failure'),
      false,
      'failed asset publication discharged its obligation prematurely',
    );
    harness.store.dispose();
    await harness.client.closeAuth();
    await harness.queueStore.close();
  }

  console.log('assets-watch-authorization.test.mjs passed');
} finally {
  globalThis.fetch = originalFetch;
}
