import assert from 'node:assert/strict';
import test from 'node:test';

import { SnapbackClient } from './index.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';

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
      await check();
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
  const authorizationErrors = [];
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
      rqsStore: null,
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
      onAuthorizationError(error) {
        authorizationErrors.push(error);
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
    assert.deepEqual(authorizationErrors.map((error) => error?.code), []);
    await waitFor(
      () => assert.deepEqual(
        acknowledgements,
        ['ack_atomic_authorization_1'],
        JSON.stringify(authorizationErrors.map((error) => ({
          code: error?.code,
          message: error?.message,
        }))),
      ),
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

class AuthorizationInvalidationWebSocket {
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    this.listeners = new Map();
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ listener, once: options.once === true });
    this.listeners.set(type, listeners);
  }

  emit(type, event) {
    for (const entry of [...(this.listeners.get(type) ?? [])]) {
      entry.listener(event);
      if (entry.once) {
        const listeners = this.listeners.get(type) ?? [];
        const index = listeners.indexOf(entry);
        if (index !== -1) listeners.splice(index, 1);
      }
    }
  }

  send(encoded) {
    const frame = JSON.parse(encoded);
    if (frame.kind !== 'ping') return;
    queueMicrotask(() => this.emit('message', {
      data: JSON.stringify({ kind: 'pong', requestId: frame.requestId }),
    }));
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', { code, reason });
  }
}

const queuedReplayHandshake = {
  ...handshake,
  clientProtocols: {
    ...handshake.clientProtocols,
    authorityDescriptor: 1,
  },
  availability: {
    ...handshake.availability,
    queuedReplay: {
      available: true,
      minimumAuthorityDescriptorProtocol: 1,
      reason: null,
    },
  },
};

for (const transport of ['poll', 'stream']) {
  test(`client-owned outbox suspension fences ${transport} invalidation before ACK`, async () => {
    const originalFetch = globalThis.fetch;
    const originalWebSocket = globalThis.WebSocket;
    const durableStore = createMemoryRqsResumeStore();
    durableStore.durability = () => ({ implementation: 'authorization-test', durable: true });
    const connectionId = `queue-authorization-${transport}`;
    const outbox = [];
    const acknowledgements = [];
    let mutationAttempts = 0;
    let mutationOnline = false;
    let mutationAttemptsBeforeReplay = 0;
    let scopeId = null;
    let handle = null;
    let client = null;

    globalThis.WebSocket = AuthorizationInvalidationWebSocket;
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/auth/session') return response(queuedReplayHandshake);
      if (path === '/connection/open') {
        return response({
          connectionId,
          connectionToken: `sct-${transport}`,
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
      if (path === `/outbox/${connectionId}`) return response(outbox.shift() ?? []);
      if (path === '/live/authorization-invalidation/acknowledge') {
        assert.equal(
          mutationAttempts,
          mutationAttemptsBeforeReplay,
          `${transport}: queued mutation crossed before authorization ACK`,
        );
        const body = JSON.parse(init.body);
        acknowledgements.push(body.ackToken);
        return response({ outcome: 'discharged' });
      }
      if (path === '/mutation/queuedWrite') {
        mutationAttempts += 1;
        if (!mutationOnline) throw new TypeError('offline before queued replay');
        return response({ result: { ok: true }, version: 12 });
      }
      if (path === '/live/atomicTodos/unsubscribe') {
        return response({ subscription_id: 'sub_atomic_authorization', disposed: true });
      }
      throw new Error(`unexpected ${transport} authorization queue request: ${path}`);
    };

    try {
      client = new SnapbackClient('http://authorization-queue.test', {
        bearerToken: 'session-atomic-authorization',
        authInvalidationProtocol: 1,
        authorityDescriptorProtocol: 1,
        clientStoreId: `store_queue_authorization_${transport}`,
        rqsStore: durableStore,
        __offlineMutationReplayCapability: true,
        __outboxDrainLifecycle: false,
      });
      handle = await client.liveQuery('atomicTodos', {
        connectionId,
        persistResume: false,
        transport,
        fallbackToPoll: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const queued = await client.mutate('queuedWrite', {
        args: { id: transport },
        queue: true,
      });
      assert.equal(queued.status, 'queued');
      mutationAttemptsBeforeReplay = mutationAttempts;
      mutationOnline = true;

      const pending = obligation(scopeId, 1, 11);
      const pendingFrame = envelope({ pending });
      if (transport === 'poll') {
        outbox.push([pendingFrame]);
        await handle.poll();
      } else {
        await waitFor(
          () => assert.equal(client.liveStreamManager(connectionId).inspection().open, true),
          'stream did not open',
        );
        await client.liveStreamManager(connectionId).debugInjectFrame(
          JSON.parse(pendingFrame.Durable.payload),
        );
      }
      await waitFor(
        async () => assert.equal(
          (await durableStore.outboxAuthorizationStatus()).suspended,
          true,
        ),
        `${transport}: obligation was not persisted`,
      );
      assert.deepEqual(acknowledgements, []);
      const blocked = await client.replayQueuedMutations();
      assert.equal(blocked.stopped, true);
      assert.equal(
        mutationAttempts,
        mutationAttemptsBeforeReplay,
        `${transport}: replay crossed the persisted root`,
      );

      const proof = resolution(pending, `ack_queue_authorization_${transport}`);
      const resolvedFrame = envelope({
        pending,
        resolved: proof,
        version: 11,
        rows: [{ id: 'released' }],
      });
      if (transport === 'poll') {
        outbox.push([resolvedFrame]);
        await handle.poll();
      } else {
        await client.liveStreamManager(connectionId).debugInjectFrame(
          JSON.parse(resolvedFrame.Durable.payload),
        );
      }
      await waitFor(
        () => assert.deepEqual(acknowledgements, [proof.ackToken]),
        `${transport}: satisfying proof was not acknowledged`,
      );
      assert.equal((await durableStore.outboxAuthorizationStatus()).suspended, false);
      await client.replayQueuedMutations();
      await waitFor(
        () => assert.equal(mutationAttempts, mutationAttemptsBeforeReplay + 1),
        `${transport}: satisfying proof did not release replay`,
      );
    } finally {
      try { await handle?.dispose?.(); } catch { /* cleanup cannot mask assertions */ }
      try { await client?.close?.(); } catch { /* cleanup cannot mask assertions */ }
      try { await durableStore.close(); } catch { /* cleanup cannot mask assertions */ }
      globalThis.fetch = originalFetch;
      globalThis.WebSocket = originalWebSocket;
    }
  });
}

test('authorization invalidation refuses ACK when outbox suspension cannot persist', async () => {
  const originalFetch = globalThis.fetch;
  const durableStore = createMemoryRqsResumeStore();
  durableStore.durability = () => ({ implementation: 'authorization-test', durable: true });
  durableStore.outboxApplyAuthorizationObligation = undefined;
  const outbox = [];
  const authorizationErrors = [];
  let acknowledgementAttempts = 0;
  let scopeId = null;
  let handle = null;
  let client = null;

  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') return response(queuedReplayHandshake);
    if (path === '/connection/open') {
      return response({
        connectionId: 'queue-persistence-refusal',
        connectionToken: 'sct-queue-persistence-refusal',
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
    if (path === '/outbox/queue-persistence-refusal') return response(outbox.shift() ?? []);
    if (path === '/live/authorization-invalidation/acknowledge') {
      acknowledgementAttempts += 1;
      return response({ outcome: 'discharged' });
    }
    if (path === '/live/atomicTodos/unsubscribe') {
      return response({ subscription_id: 'sub_atomic_authorization', disposed: true });
    }
    throw new Error(`unexpected queue persistence refusal request: ${path}`);
  };

  try {
    client = new SnapbackClient('http://authorization-persistence.test', {
      bearerToken: 'session-atomic-authorization',
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      clientStoreId: 'store_queue_persistence_refusal',
      rqsStore: durableStore,
      __offlineMutationReplayCapability: true,
      __outboxDrainLifecycle: false,
    });
    handle = await client.liveQuery('atomicTodos', {
      connectionId: 'queue-persistence-refusal',
      persistResume: false,
      onAuthorizationError(error) { authorizationErrors.push(error); },
    });
    const pending = obligation(scopeId, 1, 11);
    outbox.push([envelope({
      pending,
      resolved: resolution(pending, 'ack_queue_persistence_refusal'),
      version: 11,
      rows: [{ id: 'must-not-ack' }],
    })]);
    await handle.poll();
    await waitFor(
      () => assert.equal(
        authorizationErrors.at(-1)?.code,
        'SNAPBACK_RQS_STORE_UNAVAILABLE',
      ),
      'queue persistence refusal did not surface',
    );
    assert.equal(acknowledgementAttempts, 0);
    assert.deepEqual(handle.rows, []);
  } finally {
    try { await handle?.dispose?.(); } catch { /* cleanup cannot mask assertions */ }
    try { await client?.close?.(); } catch { /* cleanup cannot mask assertions */ }
    try { await durableStore.close(); } catch { /* cleanup cannot mask assertions */ }
    globalThis.fetch = originalFetch;
  }
});
