import assert from 'node:assert/strict';
import test from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import { SnapbackClient } from './index.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';
import { createIndexedDbRqsResumeStore } from './rqs-store.mjs';

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

const atomicSingleValueReference = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v1',
  appId: 'atomic-authorization-fixture',
  id: 'atomic-authorization-fixture:atomicTodos',
  name: 'atomicTodos',
  kind: 'LiveQuery',
  implementationHash: `sha256:${'a'.repeat(64)}`,
  argsContractHash: `sha256:${'b'.repeat(64)}`,
  argsContract: { fields: [] },
  resultContractHash: `sha256:${'c'.repeat(64)}`,
  resultContract: { kind: 'value', value: { kind: 'unknown' } },
});

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

const deferred = () => {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
};

function createLockManagerDouble() {
  const states = new Map();
  const stateFor = (name) => {
    const existing = states.get(name);
    if (existing) return existing;
    const created = { held: false, queue: [] };
    states.set(name, created);
    return created;
  };
  const pump = (name) => {
    const state = stateFor(name);
    if (state.held) return;
    const next = state.queue.shift();
    if (!next) return;
    state.held = true;
    Promise.resolve(next.callback({ name, mode: 'exclusive' }))
      .then(next.resolve, next.reject)
      .finally(() => {
        state.held = false;
        pump(name);
      });
  };
  return {
    request(name, options, callback) {
      const state = stateFor(name);
      if (options?.ifAvailable === true && state.held) {
        return Promise.resolve(callback(null));
      }
      return new Promise((resolve, reject) => {
        const entry = { callback, resolve, reject };
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            const index = state.queue.indexOf(entry);
            if (index !== -1) state.queue.splice(index, 1);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        }
        state.queue.push(entry);
        pump(name);
      });
    },
  };
}

test('typed single-value liveQuery resolves atomically and recovers from a quarantine blank', async () => {
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
      assert.ok(handle?.rows?.id === 'refreshed' || handle?.rows?.id === 'recovered');
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
    handle = await client.liveQuery(atomicSingleValueReference, {
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
    assert.deepEqual(handle.rows, { id: 'held' });
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
      updates.some((entry) => entry.rows === null),
      false,
      'same-envelope refresh published a blank value',
    );
    assert.deepEqual(handle.rows, { id: 'refreshed' });
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
    assert.equal(handle.rows, null);
    assert.equal(acknowledgements.includes('ack_stale_authorization'), false);

    boundaries.length = 0;
    updates.length = 0;
    const pendingWithoutResolution = obligation(scopeId, 4, 13);
    outbox.push([envelope({ pending: pendingWithoutResolution })]);
    await handle.poll();
    await waitFor(
      () => assert.deepEqual(
        boundaries.map((entry) => entry.kind),
        ['authorization_quarantine'],
      ),
      'no-resolution obligation did not quarantine immediately',
    );
    assert.equal(handle.rows, null);
    assert.equal(handle.authoritativeRows, null);
    assert.equal(handle.authorizationDisposition, 'quarantine');
    assert.deepEqual(updates.map((entry) => entry.rows), [null]);

    boundaries.length = 0;
    updates.length = 0;
    outbox.push([envelope({
      pending: pendingWithoutResolution,
      resolved: resolution(pendingWithoutResolution, 'ack_atomic_authorization_recovered'),
      version: 13,
      rows: [{ id: 'recovered' }],
    })]);
    await handle.poll();
    await waitFor(
      () => assert.equal(
        acknowledgements.at(-1),
        'ack_atomic_authorization_recovered',
      ),
      'authorization resnapshot was not acknowledged after the blank',
    );
    assert.deepEqual(handle.rows, { id: 'recovered' });
    assert.deepEqual(handle.authoritativeRows, { id: 'recovered' });
    assert.deepEqual(updates.map((entry) => entry.rows), [{ id: 'recovered' }]);
    assert.equal(handle.authorizationDisposition, 'retain');
  } finally {
    try { await handle?.dispose?.(); } catch { /* cleanup cannot mask assertions */ }
    globalThis.fetch = originalFetch;
  }
});

test('resync publication cut refuses a predecessor authorization task held in its queue', async () => {
  const originalFetch = globalThis.fetch;
  const outbox = [];
  const updates = [];
  const acknowledgements = [];
  const connectionErrors = [];
  const queueEntered = deferred();
  const releaseQueue = deferred();
  const successorEntered = deferred();
  const releaseSuccessor = deferred();
  let subscribeAttempts = 0;
  let scopeId = null;
  let handle = null;

  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') return response(handshake);
    if (path === '/connection/open') {
      return response({
        connectionId: 'authorization-publication-cut',
        connectionToken: 'sct_authorization_publication_cut',
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
      subscribeAttempts += 1;
      const body = JSON.parse(init.body);
      const predecessorScope = scopeId;
      scopeId = {
        kind: 'subscription',
        issuerId,
        namespace: body.authorizationNamespace,
        scopeSequence: subscribeAttempts,
        connectionGeneration: 2,
        subscriptionId: subscribeAttempts === 1
          ? 'sub_atomic_authorization'
          : `sub_atomic_authorization_${subscribeAttempts}`,
      };
      if (subscribeAttempts === 2) {
        successorEntered.resolve();
        await releaseSuccessor.promise;
      }
      return response({
        subscription_id: scopeId.subscriptionId,
        snapshot: {
          version: 9 + subscribeAttempts,
          rows: [{ id: subscribeAttempts === 1 ? 'predecessor' : 'successor' }],
        },
        permission_epochs: {},
        authorizationScope: scopeId,
        ...(predecessorScope === null ? {} : {
          superseded: predecessorScope.subscriptionId,
          scopeRetirements: [{
            issuerId,
            namespace: predecessorScope.namespace,
            retireThroughScopeSequence: predecessorScope.scopeSequence,
            authorizationExpectation: authorization,
            mac: 'A'.repeat(43),
          }],
        }),
      });
    }
    if (path === '/outbox/authorization-publication-cut') {
      return response(outbox.shift() ?? []);
    }
    if (path === '/live/authorization-invalidation/acknowledge') {
      acknowledgements.push(JSON.parse(init.body).ackToken);
      return response({ outcome: 'discharged' });
    }
    if (path === '/live/atomicTodos/unsubscribe') {
      return response({ subscription_id: scopeId?.subscriptionId, disposed: true });
    }
    throw new Error(`unexpected authorization publication-cut request: ${path}`);
  };

  try {
    const client = new SnapbackClient('http://authorization-publication-cut.test', {
      bearerToken: 'session-atomic-authorization',
      authInvalidationProtocol: 1,
      clientStoreId: 'store_authorization_publication_cut',
      rqsStore: null,
    });
    handle = await client.liveQuery(atomicSingleValueReference, {
      connectionId: 'authorization-publication-cut',
      persistResume: false,
      authorizationQueue: {
        async applyObligation() {
          queueEntered.resolve();
          await releaseQueue.promise;
        },
      },
      onUpdate(rows, detail) {
        updates.push({ kind: detail.kind, rows: structuredClone(rows) });
      },
      onConnectionChange(_connection, detail) {
        if (detail?.error) connectionErrors.push(detail.error);
      },
    });
    updates.length = 0;

    const pending = obligation(scopeId, 1, 11);
    outbox.push([envelope({
      pending,
      resolved: resolution(pending, 'ack_must_not_cross_resync'),
      version: 11,
      rows: [{ id: 'must-not-publish-after-resync' }],
    })]);
    await handle.poll();
    await queueEntered.promise;

    outbox.push([{
      Durable: {
        payload: JSON.stringify({
          kind: 'resync_required',
          function: 'atomicTodos',
          subscription_id: 'sub_atomic_authorization',
          reason: 'watch_reload',
        }),
      },
    }]);
    await handle.poll();
    await successorEntered.promise;
    assert.equal(handle.connection, 'stale');

    releaseQueue.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      updates.some((entry) => entry.rows?.id === 'must-not-publish-after-resync'),
      false,
    );
    assert.deepEqual(acknowledgements, []);

    releaseSuccessor.resolve();
    await waitFor(
      () => assert.equal(
        handle.subscriptionId,
        'sub_atomic_authorization_2',
        JSON.stringify(connectionErrors.map((error) => ({
          code: error?.code,
          message: error?.message,
        }))),
      ),
      'authorization successor did not install after the held predecessor task was refused',
    );
    assert.deepEqual(handle.rows, { id: 'successor' });
    await client.close();
  } finally {
    releaseQueue.resolve();
    releaseSuccessor.resolve();
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
      const late = await client.mutate('queuedWrite', {
        args: { id: `${transport}-late` },
        clientMutationId: `late-${transport}`,
        queue: true,
      });
      assert.equal(late.status, 'queued');
      assert.equal(late.authorizationDisposition, 'authorization-suspended');
      assert.equal(
        mutationAttempts,
        mutationAttemptsBeforeReplay,
        `${transport}: foreground dispatch crossed a root already in force`,
      );
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
        () => assert.equal(mutationAttempts, mutationAttemptsBeforeReplay + 2),
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

test('offlineQueue:false persists live roots and fences foreground dispatch until exact proof', async () => {
  const originalFetch = globalThis.fetch;
  const durableStore = createMemoryRqsResumeStore();
  durableStore.durability = () => ({ implementation: 'authorization-test', durable: true });
  const outbox = [];
  const acknowledgements = [];
  let mutationAttempts = 0;
  let scopeId = null;
  let handle = null;
  let client = null;

  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') return response(queuedReplayHandshake);
    if (path === '/connection/open') {
      return response({
        connectionId: 'offline-queue-false-authorization',
        connectionToken: 'sct-offline-queue-false-authorization',
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
        subscriptionId: 'sub_offline_queue_false',
      };
      return response({
        subscription_id: scopeId.subscriptionId,
        snapshot: { version: 10, rows: [{ id: 'held' }] },
        permission_epochs: {},
        authorizationScope: scopeId,
      });
    }
    if (path === '/outbox/offline-queue-false-authorization') {
      return response(outbox.shift() ?? []);
    }
    if (path === '/live/authorization-invalidation/acknowledge') {
      acknowledgements.push(JSON.parse(init.body).ackToken);
      return response({ outcome: 'discharged' });
    }
    if (path === '/mutation/foregroundWrite') {
      mutationAttempts += 1;
      return response({ result: { ok: true }, version: 11 });
    }
    if (path === '/live/atomicTodos/unsubscribe') {
      return response({ subscription_id: scopeId?.subscriptionId, disposed: true });
    }
    throw new Error(`unexpected offlineQueue:false authorization request: ${path}`);
  };

  try {
    client = new SnapbackClient('http://offline-queue-false-authorization.test', {
      bearerToken: 'session-atomic-authorization',
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      clientStoreId: 'store_offline_queue_false_authorization',
      rqsStore: durableStore,
      offlineQueue: false,
      __outboxDrainLifecycle: false,
    });
    handle = await client.liveQuery('atomicTodos', {
      connectionId: 'offline-queue-false-authorization',
      persistResume: false,
    });
    const pending = obligation(scopeId, 1, 11);
    outbox.push([envelope({ pending })]);
    await handle.poll();
    await waitFor(
      async () => assert.equal((await durableStore.outboxAuthorizationStatus()).suspended, true),
      'offlineQueue:false client did not persist its live root',
    );
    await assert.rejects(
      () => client.mutate('foregroundWrite', {
        args: { protected: true },
        queue: false,
      }),
      (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED',
    );
    assert.equal(mutationAttempts, 0, 'foreground transport crossed the unproved live root');

    const proof = resolution(pending, 'ack_offline_queue_false_authorization');
    outbox.push([envelope({
      pending,
      resolved: proof,
      version: 11,
      rows: [{ id: 'released' }],
    })]);
    await handle.poll();
    await waitFor(
      () => assert.deepEqual(acknowledgements, [proof.ackToken]),
      'offlineQueue:false proof was not acknowledged after its custody commit',
    );
    const settled = await client.mutate('foregroundWrite', {
      args: { protected: true },
      queue: false,
    });
    assert.equal(settled.status, 'settled');
    assert.equal(mutationAttempts, 1, 'exact proof releases one foreground dispatch');
  } finally {
    try { await handle?.dispose?.(); } catch { /* cleanup cannot mask assertions */ }
    try { await client?.close?.(); } catch { /* cleanup cannot mask assertions */ }
    try { await durableStore.close(); } catch { /* cleanup cannot mask assertions */ }
    globalThis.fetch = originalFetch;
  }
});

test('an unrelated shared root cannot satisfy reader-tab persistence or permit ACK', async () => {
  const originalFetch = globalThis.fetch;
  const durableStore = createMemoryRqsResumeStore();
  durableStore.durability = () => ({ implementation: 'authorization-test', durable: true });
  const applyAuthorizationObligation = durableStore.outboxApplyAuthorizationObligation
    .bind(durableStore);
  const outbox = [];
  const authorizationErrors = [];
  let acknowledgementAttempts = 0;
  let resolutionWriteAttempts = 0;
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
    await applyAuthorizationObligation(
      obligation({
        ...scopeId,
        subscriptionId: 'sub_unrelated_authorization',
        namespace: {
          ...scopeId.namespace,
          queryInstanceId: scopeId.namespace.queryInstanceId + 100,
        },
      }, 1, 11),
      (await durableStore.outboxAuthorizationStatus()).authorityGeneration,
    );
    durableStore.outboxApplyAuthorizationObligation = async () => {
      const error = new Error('reader does not hold the shared writer');
      error.code = 'SNAPBACK_OUTBOX_NOT_WRITER';
      throw error;
    };
    const pending = obligation(scopeId, 1, 11);
    outbox.push([envelope({
      pending,
      resolved: resolution(pending, 'ack_queue_persistence_refusal'),
      version: 11,
      rows: [{ id: 'must-not-ack' }],
    })]);
    await handle.poll();
    await waitFor(
      () => assert.deepEqual(handle.rows, []),
      'reader deferral did not commit the fail-closed blank',
    );
    assert.deepEqual(authorizationErrors, [], 'writer deferral is not a store fault');
    assert.equal(acknowledgementAttempts, 0);
    assert.deepEqual(handle.rows, []);

    durableStore.outboxApplyAuthorizationObligation = applyAuthorizationObligation;
    const resolveAuthorizationObligation = durableStore.outboxResolveAuthorizationObligation
      .bind(durableStore);
    durableStore.outboxResolveAuthorizationObligation = async () => {
      resolutionWriteAttempts += 1;
      const error = new Error('reader cannot persist the exact proof token');
      error.code = 'SNAPBACK_OUTBOX_NOT_WRITER';
      throw error;
    };
    const nextPending = obligation(scopeId, 2, 12);
    outbox.push([envelope({
      pending: nextPending,
      resolved: resolution(nextPending, 'ack_queue_resolution_refusal'),
      version: 12,
      rows: [{ id: 'still-must-not-ack' }],
    })]);
    await handle.poll();
    await waitFor(
      () => assert.equal(resolutionWriteAttempts, 1),
      'reader did not attempt the exact proof transition',
    );
    assert.equal(resolutionWriteAttempts, 1);
    assert.deepEqual(authorizationErrors, [], 'proof deferral is not a store fault');
    assert.equal(acknowledgementAttempts, 0);
    assert.deepEqual(handle.rows, []);
    durableStore.outboxResolveAuthorizationObligation = resolveAuthorizationObligation;
  } finally {
    try { await handle?.dispose?.(); } catch { /* cleanup cannot mask assertions */ }
    try { await client?.close?.(); } catch { /* cleanup cannot mask assertions */ }
    try { await durableStore.close(); } catch { /* cleanup cannot mask assertions */ }
    globalThis.fetch = originalFetch;
  }
});

test('reader-tab live query commits shared queue custody while writer tab holds drain lock', async () => {
  const originalFetch = globalThis.fetch;
  const indexedDB = new IDBFactory();
  const lockManager = createLockManagerDouble();
  const databaseName = `snapback-reader-authorization-${Math.random()}`;
  const writerTab = createIndexedDbRqsResumeStore({ indexedDB, lockManager, databaseName });
  const readerTab = createIndexedDbRqsResumeStore({ indexedDB, lockManager, databaseName });
  const outbox = [];
  const acknowledgements = [];
  const authorizationErrors = [];
  let readerForegroundAttempts = 0;
  let readerGeneratedEnqueueAttempts = 0;
  let scopeId = null;
  let handle = null;
  let client = null;

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(writerTab.isWriter(), true);
  assert.equal(readerTab.isWriter(), false);
  const readerOutboxEnqueue = readerTab.outboxEnqueue.bind(readerTab);
  readerTab.outboxEnqueue = async (...args) => {
    readerGeneratedEnqueueAttempts += 1;
    return readerOutboxEnqueue(...args);
  };
  await writerTab.outboxEnqueue({
    id: 'cm-writer-tab-pending',
    function: 'queuedWrite',
    args: { secret: 'held-by-writer' },
  });

  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') return response(queuedReplayHandshake);
    if (path === '/connection/open') {
      return response({
        connectionId: 'reader-tab-live-query',
        connectionToken: 'sct-reader-tab-live-query',
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
        subscriptionId: 'sub_reader_tab',
      };
      return response({
        subscription_id: 'sub_reader_tab',
        snapshot: { version: 10, rows: [{ id: 'reader-owned' }] },
        permission_epochs: {},
        authorizationScope: scopeId,
      });
    }
    if (path === '/mutation/readerForegroundWrite') {
      readerForegroundAttempts += 1;
      return response({ result: true, version: 11 });
    }
    if (path === '/outbox/reader-tab-live-query') return response(outbox.shift() ?? []);
    if (path === '/live/authorization-invalidation/acknowledge') {
      assert.equal(
        (await writerTab.outboxAuthorizationStatus()).suspended,
        false,
        'ACK follows the proof commit observed by the lock-holding writer tab',
      );
      acknowledgements.push(JSON.parse(init.body).ackToken);
      return response({ outcome: 'discharged' });
    }
    if (path === '/live/atomicTodos/unsubscribe') {
      return response({ subscription_id: 'sub_reader_tab', disposed: true });
    }
    throw new Error(`unexpected reader-tab request: ${path}`);
  };

  try {
    client = new SnapbackClient('http://reader-tab-authorization.test', {
      bearerToken: 'session-atomic-authorization',
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      clientStoreId: 'store_reader_tab_authorization',
      rqsStore: readerTab,
      __offlineMutationReplayCapability: true,
      __outboxDrainLifecycle: false,
    });
    const storeRuntimeInvoke = client.__storeRuntimeInvoke.bind(client);
    client.__storeRuntimeInvoke = async (name, ...args) => {
      if (name !== 'prepareGeneratedMutation') return storeRuntimeInvoke(name, ...args);
      const [{ clientMutationId }] = args;
      return {
        generatedMutation: { operationHash: `sha256:${'d'.repeat(64)}` },
        clientMutationId,
        optimisticOperation: null,
        ctxLedger: null,
        settlementLane: 'replay-accept',
        settlementIdentity: null,
        settlementClaims: null,
        boundedSkew: null,
      };
    };
    handle = await client.liveQuery('atomicTodos', {
      connectionId: 'reader-tab-live-query',
      persistResume: false,
      onAuthorizationError(error) { authorizationErrors.push(error); },
    });
    const pending = obligation(scopeId, 1, 11);
    outbox.push([envelope({ pending })]);
    await handle.poll();
    await waitFor(
      async () => assert.equal((await writerTab.outboxAuthorizationStatus()).suspended, true),
      'reader tab did not commit the shared authorization root',
    );
    assert.deepEqual(handle.rows, []);
    assert.deepEqual(authorizationErrors, []);
    assert.equal(
      (await writerTab.outboxPrepareSubmission('cm-writer-tab-pending')).status,
      'authorization-suspended',
      'writer drain observes the reader-owned live-query root',
    );
    const generatedReaderMutation = {
      artifactKind: 'functionReference',
      kind: 'Mutation',
      id: 'reader-tab-test:readerForegroundWrite',
      name: 'readerForegroundWrite',
      argumentSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { protected: { type: 'boolean' } },
        required: ['protected'],
      },
      mutationIr: {
        format: 'snapback.generated-mutation-ir.v1',
        capabilityClass: 'local-executable',
        operationHash: `sha256:${'d'.repeat(64)}`,
        plan: { steps: [] },
      },
    };
    await assert.rejects(
      () => client.mutate(generatedReaderMutation, { args: { protected: true } }),
      (error) => error.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED',
    );
    assert.equal(
      readerGeneratedEnqueueAttempts,
      1,
      'generated reader first relinquishes non-writer enqueue custody',
    );
    assert.equal(
      readerForegroundAttempts,
      0,
      'the reader-owned foreground path defers to shared root custody without POSTing',
    );

    const proof = resolution(pending, 'ack_reader_tab_authorization');
    outbox.push([envelope({
      pending,
      resolved: proof,
      version: 11,
      rows: [{ id: 'reader-released' }],
    })]);
    await handle.poll();
    await waitFor(
      () => assert.deepEqual(acknowledgements, [proof.ackToken]),
      'reader-tab proof was not acknowledged',
    );
    assert.deepEqual(handle.rows, [{ id: 'reader-released' }]);
    assert.deepEqual(authorizationErrors, []);
  } finally {
    try { await handle?.dispose?.(); } catch { /* cleanup cannot mask assertions */ }
    try { await client?.close?.(); } catch { /* cleanup cannot mask assertions */ }
    try { await readerTab.close(); } catch { /* cleanup cannot mask assertions */ }
    try { await writerTab.close(); } catch { /* cleanup cannot mask assertions */ }
    globalThis.fetch = originalFetch;
  }
});

test('reader retirement defers successor publication until the exact queue root retires', async () => {
  const originalFetch = globalThis.fetch;
  const durableStore = createMemoryRqsResumeStore();
  durableStore.durability = () => ({ implementation: 'authorization-test', durable: true });
  const outbox = [];
  const updates = [];
  const authorizationErrors = [];
  let subscribeAttempts = 0;
  let retirementAttempts = 0;
  let currentScope = null;
  let handle = null;
  let client = null;

  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') return response(queuedReplayHandshake);
    if (path === '/connection/open') {
      return response({
        connectionId: 'reader-retirement',
        connectionToken: 'sct-reader-retirement',
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
      subscribeAttempts += 1;
      const body = JSON.parse(init.body);
      const predecessor = currentScope;
      currentScope = {
        kind: 'subscription',
        issuerId,
        namespace: body.authorizationNamespace,
        scopeSequence: subscribeAttempts,
        connectionGeneration: 2,
        subscriptionId: `sub_reader_retirement_${subscribeAttempts}`,
      };
      return response({
        subscription_id: currentScope.subscriptionId,
        snapshot: {
          version: 9 + subscribeAttempts,
          rows: [{ id: subscribeAttempts === 1 ? 'predecessor' : 'must-not-publish' }],
        },
        permission_epochs: {},
        authorizationScope: currentScope,
        ...(predecessor === null ? {} : {
          superseded: predecessor.subscriptionId,
          scopeRetirements: [{
            issuerId,
            namespace: predecessor.namespace,
            retireThroughScopeSequence: predecessor.scopeSequence,
            authorizationExpectation: authorization,
            mac: 'A'.repeat(43),
          }],
        }),
      });
    }
    if (path === '/outbox/reader-retirement') return response(outbox.shift() ?? []);
    if (path === '/live/atomicTodos/unsubscribe') {
      return response({ subscription_id: currentScope?.subscriptionId, disposed: true });
    }
    throw new Error(`unexpected reader-retirement request: ${path}`);
  };

  try {
    client = new SnapbackClient('http://reader-retirement.test', {
      bearerToken: 'session-atomic-authorization',
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      clientStoreId: 'store_reader_retirement',
      rqsStore: durableStore,
      __offlineMutationReplayCapability: true,
      __outboxDrainLifecycle: false,
    });
    handle = await client.liveQuery('atomicTodos', {
      connectionId: 'reader-retirement',
      persistResume: false,
      onUpdate(rows) { updates.push(structuredClone(rows)); },
      onAuthorizationError(error) { authorizationErrors.push(error); },
    });
    const pending = obligation(currentScope, 1, 11);
    outbox.push([envelope({ pending })]);
    await handle.poll();
    await waitFor(
      async () => assert.equal((await durableStore.outboxAuthorizationStatus()).suspended, true),
      'predecessor root was not installed',
    );
    assert.deepEqual(handle.rows, []);

    const retireAuthorizationScopes = durableStore.outboxRetireAuthorizationScopes
      .bind(durableStore);
    durableStore.outboxRetireAuthorizationScopes = async () => {
      retirementAttempts += 1;
      const error = new Error('reader cannot retire the shared queue root');
      error.code = 'SNAPBACK_OUTBOX_NOT_WRITER';
      throw error;
    };
    outbox.push([{
      Durable: {
        payload: JSON.stringify({
          kind: 'resync_required',
          reason: 'authorization_scope_retired',
          subscription_id: currentScope.subscriptionId,
          clear_retained: false,
        }),
      },
    }]);
    await handle.poll();
    await waitFor(
      () => assert.equal(subscribeAttempts, 2),
      'reader retirement resubscribe did not start',
    );
    await waitFor(
      () => assert.equal(retirementAttempts, 1),
      'reader did not attempt exact durable retirement',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(subscribeAttempts, 2);
    assert.deepEqual(handle.rows, [], 'successor rows cannot precede exact root retirement');
    assert.equal(
      updates.some((rows) => rows.some((row) => row.id === 'must-not-publish')),
      false,
    );
    assert.deepEqual(authorizationErrors, [], 'retirement deferral is not a store fault');
    assert.equal((await durableStore.outboxAuthorizationStatus()).suspended, true);
    durableStore.outboxRetireAuthorizationScopes = retireAuthorizationScopes;
  } finally {
    try { await handle?.dispose?.(); } catch { /* cleanup cannot mask assertions */ }
    try { await client?.close?.(); } catch { /* cleanup cannot mask assertions */ }
    try { await durableStore.close(); } catch { /* cleanup cannot mask assertions */ }
    globalThis.fetch = originalFetch;
  }
});
