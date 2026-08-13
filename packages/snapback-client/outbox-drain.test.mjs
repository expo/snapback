import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SnapbackClient } from './index.mjs';
import {
  createMemoryRqsResumeStore,
  createMemoryRqsStoreBacking,
} from './rqs-store-memory.mjs';

const originalFetch = globalThis.fetch;

const createDurableTestStore = (options = undefined) => {
  const store = createMemoryRqsResumeStore(options);
  store.durability = () => ({ implementation: 'memory-test-double', durable: true });
  return store;
};

const grant = (connectionId) => Response.json({
  connectionId,
  connectionToken: `sct_${connectionId}`,
  wireVersion: 'snapback.v1',
});

const settlement = (result = { ok: true }) => Response.json({
  version: 1,
  changed_count: 1,
  result,
});

const enqueue = (store, id = 'cm-drain') => store.outboxEnqueue({
  id,
  function: 'createThing',
  args: { id },
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(predicate, label = 'condition') {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await predicate();
    if (value) return value;
    await tick();
  }
  assert.fail(`timed out waiting for ${label}`);
}

class FakeTimers {
  nowMs = 10_000;
  nextId = 1;
  tasks = new Map();
  delays = [];

  setTimeout(callback, delayMs) {
    const id = this.nextId;
    this.nextId += 1;
    this.delays.push(delayMs);
    this.tasks.set(id, { callback, at: this.nowMs + delayMs, delayMs });
    return id;
  }

  clearTimeout(id) {
    this.tasks.delete(id);
  }

  now() {
    return this.nowMs;
  }

  random() {
    return 1;
  }

  get pendingCount() {
    return this.tasks.size;
  }

  async runNext() {
    const selected = [...this.tasks]
      .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
    assert(selected, 'expected a pending injected timer');
    const [id, task] = selected;
    this.tasks.delete(id);
    this.nowMs = task.at;
    await task.callback();
    await tick();
  }
}

async function installRetainedRegistration(store, name = 'listThings') {
  const meta = structuredClone(await store.readStoreMeta());
  meta.durableRegistrations = {
    retained: {
      'drain-registration': {
        format: 'snapback.query-registration.v1',
        registrationId: 'drain-registration',
        source: 'programmatic',
        ownerContext: { kind: 'api', label: 'outbox-drain-test' },
        functionReference: {
          artifactKind: 'functionReference',
          name,
          kind: 'LiveQuery',
          argumentSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
        canonicalArgs: {},
        requestedScope: { kind: 'page-set', from: 'first', through: 'terminal' },
        retentionRequest: 'durable',
        idleTtlClass: 'default',
      },
    },
  };
  assert.equal(await store.writeStoreMeta(meta), true);
}

const authHandshake = Object.freeze({
  protocolVersion: 1,
  serverStartupNonce: 'outbox-drain-auth',
  authorizationStreamIncarnation: '018f0d90-7d01-7a22-8c33-445566778899',
  transitionGeneration: 1,
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
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: { available: false, minimumAuthInvalidationProtocol: 1, reason: 'test' },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: 'test',
    },
    queuedReplay: { available: true, minimumAuthorityDescriptorProtocol: 1, reason: null },
  },
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: {
    kind: 'humanSession',
    userId: '018f0d90-7d02-7a22-8c33-445566778899',
    sessionId: '018f0d90-7d03-7a22-8c33-445566778899',
    isAuthenticated: true,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7d04-7a22-8c33-445566778899',
    sessionGeneration: 1,
  },
  deploymentIdentity: {
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: 'outbox-drain-test',
    schemaHash: `snapback.v1:sessions:schema:sha256:${'a'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`,
  },
  authorizedLease: null,
});

test('resync-before-replay: replay waits for the fresh authoritative barrier cut', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-barrier');
  await installRetainedRegistration(store);
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  let replayed = 0;
  let barrierRequested = false;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/live/listThings/subscribe') {
      barrierRequested = true;
      await barrier;
      return Response.json({
        subscription_id: 'sub-drain-barrier',
        snapshot: { version: 1, rows: [] },
      });
    }
    if (path === '/live/listThings/unsubscribe') return Response.json({ removed: true });
    if (path === '/mutation/createThing') {
      replayed += 1;
      return settlement();
    }
    throw new Error(`unexpected drain request ${path}`);
  };
  const client = new SnapbackClient('https://drain-barrier.test', { rqsStore: store });
  const controller = client.startOutboxDrain();
  t.after(() => controller.stop());

  await waitFor(() => barrierRequested, 'retained-query resync request');
  assert.equal(replayed, 0, 'transport is fenced while the barrier is pending');
  assert.equal(controller.status().drainPhase, 'waiting-barrier');
  releaseBarrier();
  await waitFor(() => replayed === 1, 'post-barrier replay');
  assert.equal((await client.mutationStatus('cm-barrier')).status, 'settled');
});

test('cold-start drain: restored pending intent drains with no fresh external event', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-cold-start');
  let replayed = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      replayed += 1;
      return settlement();
    }
    throw new Error(`unexpected cold-start request ${path}`);
  };
  const client = new SnapbackClient('https://drain-cold.test', { rqsStore: store });
  const controller = client.startOutboxDrain();
  t.after(() => controller.stop());
  await waitFor(() => replayed === 1, 'cold-start replay');
  assert.equal((await client.mutationStatus('cm-cold-start')).status, 'settled');
});

test('transient-failure retry: connectivity replay failure retries on backoff without an event', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-transient');
  const timers = new FakeTimers();
  let attempts = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      attempts += 1;
      if (attempts === 1) throw new TypeError('offline once');
      return settlement();
    }
    throw new Error(`unexpected transient request ${path}`);
  };
  const client = new SnapbackClient('https://drain-transient.test', { rqsStore: store });
  const controller = client.startOutboxDrain({ timer: timers });
  t.after(() => controller.stop());
  await waitFor(() => controller.status().drainPhase === 'backoff', 'replay backoff');
  assert.equal(attempts, 1);
  assert.equal(timers.pendingCount, 1);
  await timers.runNext();
  await waitFor(() => attempts === 2, 'timer-owned replay retry');
  assert.equal((await client.mutationStatus('cm-transient')).status, 'settled');
});

test('no-mounted-query drain: controller resyncs retained registrations itself', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-no-mounted');
  await installRetainedRegistration(store, 'retainedThings');
  const order = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/live/retainedThings/subscribe') {
      order.push('barrier');
      return Response.json({
        subscription_id: 'sub-no-mounted',
        snapshot: { version: 2, rows: [] },
      });
    }
    if (path === '/live/retainedThings/unsubscribe') return Response.json({ removed: true });
    if (path === '/mutation/createThing') {
      order.push('replay');
      return settlement();
    }
    throw new Error(`unexpected retained resync request ${path}`);
  };
  const client = new SnapbackClient('https://drain-retained.test', { rqsStore: store });
  const controller = client.startOutboxDrain();
  t.after(() => controller.stop());
  await waitFor(() => order.includes('replay'), 'retained-registration replay');
  assert.deepEqual(order.slice(0, 2), ['barrier', 'replay']);
});

test('two-tab writer refusal + takeover: reader wakes on writer acquisition and projections converge', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const backing = createMemoryRqsStoreBacking();
  const writerStore = createDurableTestStore({ backing });
  const followerStore = createDurableTestStore({ backing });
  await enqueue(writerStore, 'cm-writer-settlement');
  let replayed = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      replayed += 1;
      return settlement();
    }
    throw new Error(`unexpected takeover request ${path}`);
  };
  const follower = new SnapbackClient('https://drain-takeover.test', { rqsStore: followerStore });
  const controller = follower.startOutboxDrain();
  t.after(async () => {
    controller.stop();
    await followerStore.close();
  });
  await waitFor(() => controller.status().blockedReason === 'not-writer', 'writer refusal');
  assert.equal(replayed, 0);
  assert.equal((await follower.mutationStatus('cm-writer-settlement')).status, 'pending');

  const writer = new SnapbackClient('https://drain-takeover.test', { rqsStore: writerStore });
  assert.equal((await writer.replayQueuedMutations()).replayed, 1);
  assert.equal(
    (await follower.mutationStatus('cm-writer-settlement')).status,
    'settled',
    'the reader projects settlement committed by the durable writer',
  );
  assert.equal((await follower.outboxStatus()).pending, 0);

  await enqueue(writerStore, 'cm-takeover');

  await writerStore.close();
  await waitFor(() => replayed === 2, 'writer takeover replay');
  assert.equal(followerStore.isWriter(), true);
  assert.equal((await follower.mutationStatus('cm-takeover')).status, 'settled');
  assert.equal((await follower.outboxStatus()).pending, 0);
});

test('auth replacement wake: successor bearer bind wakes a paused drain without another edge', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-auth-wake');
  let replayed = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') return Response.json(authHandshake);
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      replayed += 1;
      return settlement();
    }
    throw new Error(`unexpected auth-wake request ${path}`);
  };
  const client = new SnapbackClient('https://drain-auth.test', {
    rqsStore: store,
    authClientProtocol: 1,
    bearerToken: 'sbs_outbox_drain_predecessor',
  });
  const revoked = new Error('successor required');
  revoked.code = 'SNAPBACK_SESSION_REVOKED';
  client.handleTerminalAuthLoss(null, revoked);
  const controller = client.startOutboxDrain();
  t.after(() => controller.stop());
  await waitFor(
    () => controller.status().blockedReason?.startsWith('authority-unavailable:'),
    'terminal-authority pause',
  );
  assert.equal(replayed, 0);

  await client.replaceBearerToken('sbs_outbox_drain_successor');
  await waitFor(() => replayed === 1, 'successor-bind replay');
  assert.equal((await client.mutationStatus('cm-auth-wake')).status, 'settled');
});

test('terminal refusal: typed replay refusal stops that record and remains observable', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-terminal');
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      return Response.json({
        diagnostic: { code: 'SNAPBACK_DRAIN_TERMINAL_TEST', message: 'typed refusal' },
      }, { status: 400 });
    }
    throw new Error(`unexpected terminal request ${path}`);
  };
  const client = new SnapbackClient('https://drain-terminal.test', { rqsStore: store });
  const controller = client.startOutboxDrain();
  t.after(() => controller.stop());
  await waitFor(
    () => controller.status().blockedReason === 'terminal-disposition:SNAPBACK_DRAIN_TERMINAL_TEST',
    'terminal drain disposition',
  );
  assert.deepEqual(await client.mutationStatus('cm-terminal'), {
    status: 'failed',
    failure: {
      code: 'SNAPBACK_DRAIN_TERMINAL_TEST',
      message: 'SNAPBACK_DRAIN_TERMINAL_TEST: typed refusal',
    },
  });
  assert.equal(
    (await client.outboxStatus()).blockedReason,
    'terminal-disposition:SNAPBACK_DRAIN_TERMINAL_TEST',
  );
});

test('bounded backoff: repeated transient failures never schedule beyond the cap', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-bounded');
  const timers = new FakeTimers();
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') throw new TypeError('still offline');
    throw new Error(`unexpected bounded-backoff request ${path}`);
  };
  const client = new SnapbackClient('https://drain-bounded.test', { rqsStore: store });
  const controller = client.startOutboxDrain({ timer: timers });
  t.after(() => controller.stop());
  await waitFor(() => controller.status().drainPhase === 'backoff', 'initial backoff');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await timers.runNext();
    await waitFor(() => controller.status().drainPhase === 'backoff', `backoff ${attempt + 2}`);
  }
  assert.equal(Math.max(...timers.delays), 30_000);
  assert(timers.delays.every((delay) => delay <= 30_000));
});

test('dedup/teardown: double start shares one controller and stop removes every listener/timer', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-dedup');
  const timers = new FakeTimers();
  let lockListeners = 0;
  const subscribeWriterLock = store.subscribeWriterLock.bind(store);
  store.subscribeWriterLock = (listener) => {
    lockListeners += 1;
    const unsubscribe = subscribeWriterLock(listener);
    return () => {
      lockListeners -= 1;
      unsubscribe();
    };
  };
  const onlineListeners = new Set();
  const eventTarget = {
    addEventListener(type, listener) {
      if (type === 'online') onlineListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'online') onlineListeners.delete(listener);
    },
  };
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') throw new TypeError('offline for teardown');
    throw new Error(`unexpected teardown request ${path}`);
  };
  const client = new SnapbackClient('https://drain-dedup.test', { rqsStore: store });
  const first = client.startOutboxDrain({ timer: timers, eventTarget });
  const second = client.startOutboxDrain({ timer: timers, eventTarget });
  assert.equal(first, second);
  await waitFor(() => first.status().drainPhase === 'backoff', 'teardown backoff');
  assert.equal(timers.pendingCount, 1);
  assert.equal(lockListeners, 1);
  assert.equal(onlineListeners.size, 1);

  first.stop();
  assert.equal(first.status().running, false);
  assert.equal(timers.pendingCount, 0);
  assert.equal(lockListeners, 0);
  assert.equal(onlineListeners.size, 0);

  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') {
      await barrier;
      return grant(JSON.parse(init.body).connectionId);
    }
    if (path === '/mutation/createThing') return settlement();
    throw new Error(`unexpected in-flight teardown request ${path}`);
  };
  const waiting = client.startOutboxDrain({ timer: timers, eventTarget });
  await waitFor(() => waiting.status().drainPhase === 'waiting-barrier', 'in-flight barrier');
  assert.equal(timers.pendingCount, 1, 'the barrier deadline is controller-owned');
  const waitingTask = waiting.drainNow();
  waiting.stop();
  await waitingTask;
  assert.equal(timers.pendingCount, 0, 'stop cancels the in-flight barrier deadline');
  assert.equal(lockListeners, 0);
  assert.equal(onlineListeners.size, 0);
  releaseBarrier();
  await tick();
});
