import assert from 'node:assert/strict';
import test from 'node:test';

import { SnapbackClient } from './index.mjs';

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
  serverStartupNonce: 'startup-atomic-authorization',
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
    authScopedLive: {
      available: true,
      minimumAuthInvalidationProtocol: 1,
      reason: null,
    },
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
  authority: {
    userId: 'user_atomic_authorization',
    sessionId: 'session_atomic_authorization',
    isAuthenticated: true,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: INCARNATION,
    sessionGeneration: 1,
  },
  authorizedLease: null,
};

const witness = (version) => ({
  authorization,
  data: { versionStream: 'stream-atomic-authorization', minCommitVersion: version },
});

const obligation = (scopeId, revision, version) => ({
  protocolVersion: 1,
  scopeId,
  revision,
  maxDisposition: 'quarantine',
  witness: witness(version),
  retryEpisodeId: null,
  ownerContinuityId: 'owner_atomic_authorization',
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

const envelope = ({ pending, resolved = null, rows = null, version = null }) => ({
  Durable: {
    payload: JSON.stringify({
      kind: 'authorization_invalidation',
      obligation: pending,
      ...(resolved === null ? {} : { resolution: resolved }),
      ...(rows === null ? {} : {
        snapshot: {
          subscriptionId: 'sub_atomic_authorization',
          function: 'atomicTodos',
          version,
          rows,
        },
      }),
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

test('liveQuery applies same-envelope authorization resolution without a blank boundary', async () => {
  const originalFetch = globalThis.fetch;
  const outbox = [];
  const acknowledgements = [];
  const boundaries = [];
  const updates = [];
  let scopeId = null;
  let handle = null;

  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') return response(handshake);
    if (path === '/connection/open') {
      return response({
        connectionId: 'granted-atomic-authorization',
        connectionToken: 'sct_atomic_authorization',
        ephemeralExpiryProtocol: 1,
        wireVersion: 'snapback.v1',
        authorizationInvalidation: {
          protocolVersion: 1,
          issuerId,
          connectionGeneration: 2,
          authorization,
          versionStream: 'stream-atomic-authorization',
        },
      });
    }
    if (path === '/live/atomicTodos/subscribe') {
      const body = JSON.parse(init.body);
      scopeId = {
        kind: 'subscription',
        issuerId,
        namespace: body.authorizationNamespace,
        scopeSequence: 1,
        connectionGeneration: 2,
        subscriptionId: 'sub_atomic_authorization',
      };
      return response({
        subscription_id: 'sub_atomic_authorization',
        snapshot: { version: 10, rows: [{ id: 'held' }] },
        permission_epochs: {},
        authorizationScope: scopeId,
      });
    }
    if (path === '/live/authorization-invalidation/acknowledge') {
      const { ackToken } = JSON.parse(init.body);
      assert.equal(boundaries.at(-1)?.kind, 'authorization_snapshot');
      assert.deepEqual(handle?.rows, [{ id: 'refreshed' }]);
      acknowledgements.push(ackToken);
      return response({ outcome: 'discharged' });
    }
    if (path === '/outbox/granted-atomic-authorization') {
      return response(outbox.shift() ?? []);
    }
    if (path === '/live/atomicTodos/unsubscribe') {
      return response({ subscription_id: 'sub_atomic_authorization', disposed: true });
    }
    throw new Error(`unexpected atomic authorization request: ${path}`);
  };

  try {
    const client = new SnapbackClient('http://atomic-authorization.test', {
      bearerToken: 'session-atomic-authorization',
      authInvalidationProtocol: 1,
      clientStoreId: 'store_atomic_authorization',
    });
    handle = await client.liveQuery('atomicTodos', {
      connectionId: 'atomic-authorization-label',
      persistResume: false,
      onAuthorizationBoundary(rows, detail) {
        boundaries.push({ kind: detail.kind, rows: structuredClone(rows) });
      },
      onUpdate(rows, detail) {
        updates.push({ kind: detail.kind, rows: structuredClone(rows) });
      },
    });
    assert.deepEqual(handle.rows, [{ id: 'held' }]);
    boundaries.length = 0;
    updates.length = 0;

    const pending = obligation(scopeId, 1, 11);
    outbox.push([envelope({
      pending,
      resolved: resolution(pending, 'ack_atomic_authorization_1'),
      version: 11,
      rows: [{ id: 'refreshed' }],
    })]);
    await handle.poll();
    await waitFor(
      () => assert.deepEqual(acknowledgements, ['ack_atomic_authorization_1']),
      'same-envelope resolution was not acknowledged',
    );
    assert.deepEqual(boundaries.map((entry) => entry.kind), ['authorization_snapshot']);
    assert.equal(
      boundaries.some((entry) => entry.kind === 'authorization_quarantine'),
      false,
    );
    assert.equal(
      updates.some((entry) => entry.rows.length === 0),
      false,
      'same-envelope refresh published a blank row set',
    );
    assert.deepEqual(handle.rows, [{ id: 'refreshed' }]);
    assert.equal(handle.authorizationDisposition, 'retain');

    boundaries.length = 0;
    updates.length = 0;
    const pendingWithStaleResolution = obligation(scopeId, 3, 12);
    outbox.push([envelope({
      pending: pendingWithStaleResolution,
      resolved: {
        ...resolution(pendingWithStaleResolution, 'ack_stale_authorization'),
        revision: 2,
      },
      version: 12,
      rows: [{ id: 'must-not-publish' }],
    })]);
    await handle.poll();
    await waitFor(
      () => assert.deepEqual(
        boundaries.map((entry) => entry.kind),
        ['authorization_quarantine'],
      ),
      'stale same-envelope resolution did not repair to quarantine',
    );
    assert.deepEqual(handle.rows, []);
    assert.equal(acknowledgements.includes('ack_stale_authorization'), false);

    boundaries.length = 0;
    updates.length = 0;
    outbox.push([envelope({ pending: obligation(scopeId, 4, 13) })]);
    await handle.poll();
    await waitFor(
      () => assert.deepEqual(
        boundaries.map((entry) => entry.kind),
        ['authorization_quarantine'],
      ),
      'no-resolution obligation did not quarantine immediately',
    );
    assert.deepEqual(handle.rows, []);
    assert.equal(handle.authorizationDisposition, 'quarantine');
    assert.deepEqual(updates.map((entry) => entry.rows), [[]]);
  } finally {
    try { await handle?.dispose?.(); } catch { /* cleanup cannot mask assertions */ }
    globalThis.fetch = originalFetch;
  }
});
