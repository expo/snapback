import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';

import {
  SnapbackClient as InspectingSnapbackClient,
  inspectionPseudonymV1,
} from './index.mjs';
import {
  createMemoryRqsResumeStore,
  createMemoryRqsStoreBacking,
} from './rqs-store-memory.mjs';

const DRAIN_TARGET_PROFILE = 'outbox-drain-target';
const DRAIN_GENERATION = Object.freeze({
  schemaVersion: 'snapback.v0',
  appId: 'snapback.internal-configured-replay-capability',
  schemaHash: `sha256:${'d'.repeat(64)}`,
  bundleHash: `sha256:${'e'.repeat(64)}`,
  inputsHash: `sha256:${'f'.repeat(64)}`,
});

const installDrainTarget = (store, baseUrl) => (
  store?.commitOfflineMutationReplayCapabilityFact?.({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin: new URL(baseUrl).origin,
    supported: true,
    reason: null,
    targetProfileId: DRAIN_TARGET_PROFILE,
    artifactGeneration: DRAIN_GENERATION,
  }) ?? Promise.resolve(false)
);

class SnapbackClient extends InspectingSnapbackClient {
  constructor(baseUrl, options = {}) {
    super(baseUrl, {
      __offlineMutationReplayCapability: true,
      ...options,
    });
    this.__drainTargetReady = installDrainTarget(options.rqsStore, baseUrl);
  }

  async mutate(...args) {
    await this.__drainTargetReady;
    return super.mutate(...args);
  }

  async replayQueuedMutations(...args) {
    await this.__drainTargetReady;
    return super.replayQueuedMutations(...args);
  }
}

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

const replayInspection = ({ supported = true } = {}) => ({
  targetProfileId: DRAIN_TARGET_PROFILE,
  schema: {
    schemaVersion: DRAIN_GENERATION.schemaVersion,
    appId: DRAIN_GENERATION.appId,
    schemaHash: DRAIN_GENERATION.schemaHash,
    inputsHash: DRAIN_GENERATION.inputsHash,
  },
  functions: {
    schemaVersion: DRAIN_GENERATION.schemaVersion,
    appId: DRAIN_GENERATION.appId,
    bundleHash: DRAIN_GENERATION.bundleHash,
    inputsHash: DRAIN_GENERATION.inputsHash,
  },
  capabilityManifest: {
    manifestVersion: 1,
    targetProfileId: DRAIN_TARGET_PROFILE,
    supportedCapabilities: supported ? ['offline_mutation_replay'] : [],
    capabilityGaps: supported ? [] : ['offline_mutation_replay'],
  },
});

const configuredReplayTarget = (baseUrl) => ({
  outboxRecordSchemaVersion: 2,
  enqueueTarget: {
    schemaVersion: 'snapback.outbox-enqueue-target.v1',
    canonicalOrigin: new URL(baseUrl).origin,
    targetProfileId: DRAIN_TARGET_PROFILE,
    artifactIdentity: {
      kind: 'app',
      appId: DRAIN_GENERATION.appId,
      generation: DRAIN_GENERATION,
    },
  },
});

const enqueue = async (store, id = 'cm-drain', baseUrl, record = {}) => {
  await installDrainTarget(store, baseUrl);
  return store.outboxEnqueue({
    id,
    function: 'createThing',
    args: { id },
    ...configuredReplayTarget(baseUrl),
    ...record,
  });
};

const mutationCostRecord = (client, clientMutationId) => (
  client.mutationPhaseCostInspection().records.find(
    (record) => record.clientMutationId === inspectionPseudonymV1(clientMutationId),
  ) ?? null
);

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

class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    let listeners = this.listeners.get(type);
    if (!listeners) this.listeners.set(type, listeners = new Set());
    listeners.add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  count(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

const installGlobalEventTarget = (t, target) => {
  const originalAdd = globalThis.addEventListener;
  const originalRemove = globalThis.removeEventListener;
  globalThis.addEventListener = target.addEventListener.bind(target);
  globalThis.removeEventListener = target.removeEventListener.bind(target);
  t.after(() => {
    if (originalAdd === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = originalAdd;
    if (originalRemove === undefined) delete globalThis.removeEventListener;
    else globalThis.removeEventListener = originalRemove;
  });
};

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

const anonymousAuthHandshake = Object.freeze({
  ...authHandshake,
  transitionGeneration: 0,
  authority: Object.freeze({
    kind: 'anonymous',
    userId: null,
    sessionId: null,
    isAuthenticated: false,
  }),
  authorityDescriptor: Object.freeze({
    ...authHandshake.authorityDescriptor,
    sessionGeneration: 0,
  }),
});

test('resync-before-replay: replay waits for the fresh authoritative barrier cut', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-barrier', 'https://drain-barrier.test');
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
  await enqueue(store, 'cm-cold-start', 'https://drain-cold.test');
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

test('foreground replay enters real transport while an earlier housekeeping transport hangs', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(
    store,
    'cm-held-housekeeping',
    'https://drain-lane-head-of-line.test',
    {
      function: 'slowHousekeeping',
      args: { generation: 1 },
      dispatchLane: 'housekeeping',
      housekeepingKey: 'slow-housekeeping',
    },
  );
  let releaseHousekeeping;
  const housekeepingHeld = new Promise((resolve) => { releaseHousekeeping = resolve; });
  let housekeepingEntered = false;
  let foregroundEntered = false;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/slowHousekeeping') {
      housekeepingEntered = true;
      await housekeepingHeld;
      return settlement({ lane: 'housekeeping' });
    }
    if (path === '/mutation/saveForeground') {
      foregroundEntered = true;
      return settlement({ lane: 'foreground' });
    }
    throw new Error(`unexpected head-of-line request ${path}`);
  };
  const client = new SnapbackClient('https://drain-lane-head-of-line.test', { rqsStore: store });
  const controller = client.startOutboxDrain();
  t.after(() => {
    releaseHousekeeping?.();
    controller.stop();
  });
  await waitFor(() => housekeepingEntered, 'held housekeeping transport');

  await enqueue(
    store,
    'cm-replayable-foreground',
    'https://drain-lane-head-of-line.test',
    {
      function: 'saveForeground',
      args: { value: 'user intent' },
      dispatchLane: 'foreground',
    },
  );
  const foregroundDrain = controller.drainNow();
  await waitFor(() => foregroundEntered, 'foreground transport beside held housekeeping');
  assert.equal(housekeepingEntered, true);
  assert.equal(
    (await client.mutationStatus('cm-replayable-foreground')).status,
    'settled',
  );
  await foregroundDrain;

  releaseHousekeeping();
  await waitFor(
    async () => (await client.mutationStatus('cm-held-housekeeping')).status === 'settled',
    'housekeeping settlement after release',
  );
});

test('default lifecycle settles restored and newly queued work when connectivity returns', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const events = new FakeEventTarget();
  installGlobalEventTarget(t, events);
  const store = createDurableTestStore();
  await enqueue(store, 'cm-default-restored', 'https://drain-default.test');
  let connected = false;
  const submissions = [];
  globalThis.fetch = async (url, init = {}) => {
    if (!connected) throw new TypeError('offline until the connectivity event');
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      submissions.push(JSON.parse(init.body).clientMutationId);
      return settlement();
    }
    throw new Error(`unexpected default-lifecycle request ${path}`);
  };

  const client = new SnapbackClient('https://drain-default.test', { rqsStore: store });
  t.after(() => client.close());
  await waitFor(
    async () => (await client.outboxStatus()).drainPhase === 'backoff',
    'default restored-work backoff',
  );
  const queued = await client.mutate('createThing', {
    args: { id: 'cm-default-new' },
    clientMutationId: 'cm-default-new',
  });
  assert.equal(queued.status, 'queued');
  assert.equal((await client.outboxStatus()).drainMode, 'auto');

  await waitFor(
    async () => (await client.outboxStatus()).drainPhase === 'backoff',
    'post-enqueue backoff absorption',
  );

  connected = true;
  events.dispatch('online');
  await waitFor(
    async () => (
      (await client.mutationStatus('cm-default-restored')).status === 'settled'
      && (await client.mutationStatus('cm-default-new')).status === 'settled'
    ),
    'default restored and new settlement',
  );
  assert.deepEqual(submissions, ['cm-default-restored', 'cm-default-new']);
});

test('default lifecycle does not replay a durable record while foreground owns it', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  let releaseForeground;
  const foregroundResponse = new Promise((resolve) => { releaseForeground = resolve; });
  let mutationRequests = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/mutation/createThing') {
      mutationRequests += 1;
      await foregroundResponse;
      return settlement();
    }
    throw new Error(`unexpected foreground-fence request ${path}`);
  };

  const client = new SnapbackClient('https://drain-foreground-fence.test', { rqsStore: store });
  t.after(() => client.close());
  await waitFor(
    async () => (await client.outboxStatus()).drainMode === 'auto',
    'default foreground-fence lifecycle',
  );
  const foreground = client.mutate('createThing', {
    args: { id: 'cm-foreground-fence' },
    clientMutationId: 'cm-foreground-fence',
  });
  await waitFor(() => mutationRequests === 1, 'held foreground mutation request');
  await tick();
  await tick();
  assert.equal(
    mutationRequests,
    1,
    'the automatic drain cannot submit the foreground-owned durable record',
  );

  releaseForeground();
  assert.equal((await foreground).status, 'settled');
  await tick();
  assert.equal(mutationRequests, 1, 'foreground settlement produces exactly one mutation request');
});

test('enqueue during replay waits for the dispatch cut and re-arms the default lifecycle', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-replay-snapshot', 'https://drain-level-wake.test');
  let signalReplayStarted;
  const replayStarted = new Promise((resolve) => { signalReplayStarted = resolve; });
  let releaseReplay;
  const heldReplay = new Promise((resolve) => { releaseReplay = resolve; });
  const attempts = new Map();
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      const clientMutationId = JSON.parse(init.body).clientMutationId;
      const attempt = (attempts.get(clientMutationId) ?? 0) + 1;
      attempts.set(clientMutationId, attempt);
      if (clientMutationId === 'cm-replay-snapshot') {
        signalReplayStarted();
        await heldReplay;
        return settlement();
      }
      if (clientMutationId === 'cm-during-replay' && attempt === 1) {
        throw new TypeError('foreground request queued during replay');
      }
      return settlement();
    }
    throw new Error(`unexpected replay-level-wake request ${path}`);
  };

  const client = new SnapbackClient('https://drain-level-wake.test', { rqsStore: store });
  t.after(() => client.close());
  await replayStarted;
  const queuedTask = client.mutate('createThing', {
    args: { id: 'cm-during-replay' },
    clientMutationId: 'cm-during-replay',
  });
  await tick();
  assert.equal(
    attempts.has('cm-during-replay'),
    false,
    'foreground dispatch cannot split replay prepare from settlement',
  );
  releaseReplay();
  const queued = await queuedTask;
  assert.equal(queued.status, 'queued');

  await waitFor(
    async () => (
      (await client.mutationStatus('cm-replay-snapshot')).status === 'settled'
      && (await client.mutationStatus('cm-during-replay')).status === 'settled'
    ),
    'post-snapshot enqueue settlement',
  );
  assert.equal(attempts.get('cm-replay-snapshot'), 1);
  assert.equal(attempts.get('cm-during-replay'), 2);
});

test('replay-latched enqueue survives terminal pause without an external wake', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(
    store,
    'cm-terminal-replay-head',
    'https://drain-terminal-replay-wake.test',
  );
  const originalMarkFailed = store.outboxMarkFailed.bind(store);
  let signalFailureMarkStarted;
  const failureMarkStarted = new Promise((resolve) => { signalFailureMarkStarted = resolve; });
  let releaseFailureMark;
  const heldFailureMark = new Promise((resolve) => { releaseFailureMark = resolve; });
  t.after(() => releaseFailureMark());
  store.outboxMarkFailed = async (...args) => {
    signalFailureMarkStarted();
    await heldFailureMark;
    return originalMarkFailed(...args);
  };
  let signalReplayStarted;
  const replayStarted = new Promise((resolve) => { signalReplayStarted = resolve; });
  let releaseReplay;
  const heldReplay = new Promise((resolve) => { releaseReplay = resolve; });
  const attempts = new Map();
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      const clientMutationId = JSON.parse(init.body).clientMutationId;
      const attempt = (attempts.get(clientMutationId) ?? 0) + 1;
      attempts.set(clientMutationId, attempt);
      if (clientMutationId === 'cm-terminal-replay-head') {
        signalReplayStarted();
        await heldReplay;
        return Response.json({
          diagnostic: {
            code: 'SNAPBACK_DRAIN_TERMINAL_TEST',
            message: 'terminal head after a successor relinquishes',
          },
        }, { status: 400 });
      }
      if (clientMutationId === 'cm-terminal-replay-successor' && attempt === 1) {
        throw new TypeError('foreground successor queued during replay');
      }
      return settlement();
    }
    throw new Error(`unexpected terminal-replay-wake request ${path}`);
  };

  const client = new SnapbackClient('https://drain-terminal-replay-wake.test', {
    rqsStore: store,
  });
  t.after(() => client.close());
  const controller = client.startOutboxDrain();
  const phases = [];
  const unsubscribe = client.subscribeOutbox(() => phases.push(controller.status().drainPhase));
  t.after(unsubscribe);
  await replayStarted;
  const queuedTask = client.mutate('createThing', {
    args: { id: 'cm-terminal-replay-successor' },
    clientMutationId: 'cm-terminal-replay-successor',
  });
  await tick();
  assert.equal(
    attempts.has('cm-terminal-replay-successor'),
    false,
    'successor foreground dispatch waits for the replay terminal commit',
  );
  releaseReplay();
  await failureMarkStarted;
  await tick();
  assert.equal(
    attempts.has('cm-terminal-replay-successor'),
    false,
    'an answered replay refusal retains dispatch custody through its durable failure mark',
  );
  releaseFailureMark();
  const queued = await queuedTask;
  assert.equal(queued.status, 'queued');

  await waitFor(
    async () => (
      (await client.mutationStatus('cm-terminal-replay-successor')).status === 'settled'
    ),
    'replay-latched successor settlement after terminal pause',
  );
  assert.equal((await client.mutationStatus('cm-terminal-replay-head')).status, 'failed');
  assert.equal(mutationCostRecord(client, 'cm-terminal-replay-head')?.disposition, 'failed');
  assert(phases.includes('paused'), 'the terminal replay exits through the paused phase');
  assert.equal(attempts.get('cm-terminal-replay-head'), 1);
  assert.equal(attempts.get('cm-terminal-replay-successor'), 2);
});

test('fenced default lifecycle settles restored work after synchronize with no other wake', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const storage = createMemoryAuthCustodyStorage();
  const appId = 'snapback.test/default-drain-custody-wake';
  const seed = new AuthCoordinator({
    appId,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const seedCapture = await seed.establishAnonymous({
    kind: 'anonymous',
    authMode: 'sessions',
    authorizationStreamIncarnation: authHandshake.authorizationStreamIncarnation,
  });
  await seed.close();

  const store = createDurableTestStore();
  await enqueue(
    store,
    'cm-restored-custody-wake',
    'https://drain-custody-wake.test',
    {
      authorityDescriptor: anonymousAuthHandshake.authorityDescriptor,
      principalScope: {
        authMode: 'sessions',
        authorizationStreamIncarnation: authHandshake.authorizationStreamIncarnation,
        userId: null,
      },
      custody: {
        authorityEpoch: seedCapture.authorityEpoch,
        authorityKey: seedCapture.authorityKey,
      },
    },
  );
  const coordinator = new AuthCoordinator({
    appId,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  let replayed = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') {
      return Response.json({
        ...anonymousAuthHandshake,
        deploymentIdentity: {
          ...anonymousAuthHandshake.deploymentIdentity,
          appId,
        },
      });
    }
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      replayed += 1;
      return settlement();
    }
    throw new Error(`unexpected custody-settlement-wake request ${path}`);
  };
  const client = new SnapbackClient('https://drain-custody-wake.test', {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: store,
  });
  t.after(() => client.closeAuth());
  // Do not wait for the drain to publish its pause: synchronize may settle
  // custody in the exact capture-failed -> pause window from the review trace.
  await coordinator.synchronize();
  await waitFor(
    async () => (await client.mutationStatus('cm-restored-custody-wake')).status === 'settled',
    'synchronize-only restored settlement',
  );
  assert.equal(replayed, 1);
  const restoredCost = mutationCostRecord(client, 'cm-restored-custody-wake');
  assert.equal(restoredCost?.disposition, 'settled');
  assert.equal(Number.isFinite(restoredCost?.queueWaitMs), true);
});

test('default controller quarantines an upgrade-incompatible restored intent', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(
    store,
    'cm-default-quarantine',
    'https://drain-default-quarantine.test',
  );
  let submissions = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      submissions += 1;
      return Response.json({
        diagnostic: {
          code: 'SNAPBACK_MIGRATION_UPGRADE_REQUIRED',
          message: 'default-controller quarantine fixture',
        },
      }, { status: 409 });
    }
    throw new Error(`unexpected default-quarantine request ${path}`);
  };
  const client = new SnapbackClient('https://drain-default-quarantine.test', { rqsStore: store });
  t.after(() => client.close());
  await waitFor(
    async () => (await client.mutationStatus('cm-default-quarantine')).status === 'quarantined',
    'default-controller quarantine',
  );
  assert.equal(submissions, 1);
  assert.equal((await client.outboxStatus()).quarantined, 1);
  assert.equal(mutationCostRecord(client, 'cm-default-quarantine')?.disposition, 'quarantined');
});

test('default controller strands a server-stale restored intent', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-default-strand', 'https://drain-default-strand.test');
  const markStranded = store.outboxMarkStranded.bind(store);
  store.outboxMarkStranded = (clientMutationId, reason, predecessorPrincipalScope) => (
    markStranded(clientMutationId, reason, predecessorPrincipalScope ?? {
      authMode: 'sessions',
      authorizationStreamIncarnation: authHandshake.authorizationStreamIncarnation,
      userId: null,
    })
  );
  let submissions = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      submissions += 1;
      return Response.json({
        diagnostic: {
          code: 'SNAPBACK_AUTH_STALE_RESULT',
          message: 'default-controller strand fixture',
        },
      }, { status: 409 });
    }
    throw new Error(`unexpected default-strand request ${path}`);
  };
  const client = new SnapbackClient('https://drain-default-strand.test', { rqsStore: store });
  t.after(() => client.close());
  await waitFor(
    async () => (await client.mutationStatus('cm-default-strand')).status === 'stranded',
    'default-controller strand',
  );
  assert.equal(submissions, 1);
  assert.equal((await client.outboxStatus()).stranded, 1);
  assert.equal(mutationCostRecord(client, 'cm-default-strand')?.disposition, 'stranded');
});

test('default controller preserves result-gone and stops before successors', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(
    store,
    'cm-default-result-gone',
    'https://drain-default-result-gone.test',
  );
  await enqueue(
    store,
    'cm-default-result-gone-successor',
    'https://drain-default-result-gone.test',
  );
  const submissions = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      submissions.push(JSON.parse(init.body).clientMutationId);
      return Response.json({
        diagnostic: {
          code: 'SNAPBACK_OPERATION_RESULT_EXPIRED',
          message: 'default-controller result-gone fixture',
          details: {
            disposition: 'result-expired',
            outcome: 'committed',
            receiptDigest: `sha256:${'e'.repeat(64)}`,
          },
        },
      }, { status: 410 });
    }
    throw new Error(`unexpected default-result-gone request ${path}`);
  };
  const client = new SnapbackClient('https://drain-default-result-gone.test', { rqsStore: store });
  t.after(() => client.close());
  await waitFor(
    async () => (await client.mutationStatus('cm-default-result-gone')).status === 'resultGone',
    'default-controller result-gone',
  );
  assert.deepEqual(submissions, ['cm-default-result-gone']);
  assert.equal(
    (await client.mutationStatus('cm-default-result-gone-successor')).status,
    'pending',
  );
  assert.equal(mutationCostRecord(client, 'cm-default-result-gone')?.disposition, 'resultGone');
});

test('restored terminal scan is exact after detail eviction and status rereads', async (t) => {
  const store = createDurableTestStore();
  for (let index = 0; index < 513; index += 1) {
    const id = `cm-restored-terminal-${index}`;
    await enqueue(store, id, 'https://restored-terminal-costs.test');
    const consumed = await store.outboxDurablyConsume(id, {
      version: index + 1,
      changed_count: 1,
      result: { ok: true },
      timing: { authorizedAtMs: 10, executedAtMs: 11, committedAtMs: 12 },
    });
    assert.equal(consumed.status, 'settled');
  }
  const client = new SnapbackClient('https://restored-terminal-costs.test', {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  t.after(() => client.close());
  await waitFor(
    () => client.mutationPhaseCostInspection().counters[0]?.count === 513,
    'restored terminal cost scan',
  );
  const before = client.mutationPhaseCostInspection();
  assert.equal(before.records.length, 512);
  assert.equal(before.droppedRecords, 1);
  assert.equal(before.counters[0].count, 513);
  assert.equal((await client.mutationStatus('cm-restored-terminal-0')).status, 'settled');
  assert.equal((await client.mutationStatus('cm-restored-terminal-0')).status, 'settled');
  const after = client.mutationPhaseCostInspection();
  assert.equal(after.counters[0].count, 513, 'status observation never re-counts a terminal event');
  assert.equal(after.droppedRecords, 1);
});

test('close tears down the default lifecycle and no replay starts afterward', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const events = new FakeEventTarget();
  installGlobalEventTarget(t, events);
  const store = createDurableTestStore();
  await enqueue(store, 'cm-close-fence', 'https://drain-close.test');
  let releaseReadiness;
  const heldReadiness = new Promise((resolve) => { releaseReadiness = resolve; });
  let readinessRequested = false;
  let replayed = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') {
      readinessRequested = true;
      await heldReadiness;
      return grant(JSON.parse(init.body).connectionId);
    }
    if (path === '/mutation/createThing') {
      replayed += 1;
      return settlement();
    }
    throw new Error(`unexpected close-fence request ${path}`);
  };

  const client = new SnapbackClient('https://drain-close.test', { rqsStore: store });
  await waitFor(() => readinessRequested, 'default readiness barrier');
  assert.equal(events.count('online'), 1);
  await client.close();
  assert.equal(events.count('online'), 0);
  await enqueue(store, 'cm-after-close', 'https://drain-close.test');
  events.dispatch('online');
  releaseReadiness();
  await tick();
  await tick();
  assert.equal(replayed, 0);
  await assert.rejects(
    () => client.replayQueuedMutations(),
    (error) => error?.code === 'SNAPBACK_CLIENT_CLOSED',
  );
});

test('manual constructor policy is explicit, observable, diagnostic, and safety-gated', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const diagnostics = [];
  let connected = false;
  let requests = 0;
  globalThis.fetch = async (url, init = {}) => {
    requests += 1;
    if (!connected) throw new TypeError('manual fixture offline');
    const path = new URL(url).pathname;
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') return settlement();
    throw new Error(`unexpected manual request ${path}`);
  };
  const client = new SnapbackClient('https://drain-manual.test', {
    rqsStore: store,
    outboxDrain: 'manual',
    devDiagnosticsChannel: { emit: (event) => diagnostics.push(event) },
  });
  t.after(() => client.close());
  await waitFor(async () => (await client.outboxStatus()).drainMode === 'manual', 'manual mode');
  assert.equal(client.outboxDrainPolicy, 'manual');
  const queued = await client.mutate('createThing', {
    args: { id: 'cm-manual' },
    clientMutationId: 'cm-manual',
  });
  assert.equal(queued.status, 'queued');
  assert.equal(diagnostics.at(-1)?.drainMode, 'manual');
  const afterForeground = requests;
  await tick();
  assert.equal(requests, afterForeground, 'manual mode schedules no background cycle');

  connected = true;
  const outcome = await client.replayQueuedMutations();
  assert.equal(outcome.replayed, 1);
  assert.equal((await client.mutationStatus(queued.clientMutationId)).status, 'settled');
  assert.throws(
    () => new SnapbackClient('https://drain-manual-invalid.test', {
      rqsStore: null,
      outboxDrain: false,
    }),
    /outboxDrain must be 'auto' or 'manual'/u,
  );
});

test('shared writer store has one replay engine and transfers it to the surviving client', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const events = new FakeEventTarget();
  installGlobalEventTarget(t, events);
  const store = createDurableTestStore();
  await enqueue(store, 'cm-shared-first', 'https://drain-shared.test');
  let connected = true;
  let readinessRequests = 0;
  const submissions = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (!connected) throw new TypeError('shared-store successor is offline');
    if (path === '/connection/open') {
      readinessRequests += 1;
      return grant(JSON.parse(init.body).connectionId);
    }
    if (path === '/mutation/createThing') {
      submissions.push(JSON.parse(init.body).clientMutationId);
      return settlement();
    }
    throw new Error(`unexpected shared-store request ${path}`);
  };

  const first = new SnapbackClient('https://drain-shared.test', { rqsStore: store });
  const second = new SnapbackClient('https://drain-shared.test', { rqsStore: store });
  t.after(() => second.close());
  await waitFor(
    async () => (await first.mutationStatus('cm-shared-first')).status === 'settled',
    'single shared-store settlement',
  );
  assert.deepEqual(submissions, ['cm-shared-first']);
  assert.equal(readinessRequests, 1, 'one effective engine establishes one barrier');

  connected = false;
  const queuedByNonOwner = await second.mutate('createThing', {
    args: { id: 'cm-shared-non-owner' },
    clientMutationId: 'cm-shared-non-owner',
  });
  assert.equal(queuedByNonOwner.status, 'queued');
  await waitFor(
    async () => (await first.outboxStatus()).drainPhase === 'backoff',
    'non-owner queue wake reaches the shared engine',
  );
  connected = true;
  events.dispatch('online');
  await waitFor(
    async () => (await second.mutationStatus('cm-shared-non-owner')).status === 'settled',
    'non-owner queued work settlement',
  );
  assert.deepEqual(submissions, ['cm-shared-first', 'cm-shared-non-owner']);

  await first.close();
  connected = false;
  const queued = await second.mutate('createThing', {
    args: { id: 'cm-shared-successor' },
    clientMutationId: 'cm-shared-successor',
  });
  assert.equal(queued.status, 'queued');
  connected = true;
  events.dispatch('online');
  await waitFor(
    async () => (await second.mutationStatus('cm-shared-successor')).status === 'settled',
    'surviving-client ownership transfer',
  );
  assert.deepEqual(submissions, [
    'cm-shared-first',
    'cm-shared-non-owner',
    'cm-shared-successor',
  ]);
  assert.equal(readinessRequests, 3, 'the successor establishes a fresh barrier after handoff');
});

test('transient-failure retry: connectivity replay failure retries on backoff without an event', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-transient', 'https://drain-transient.test');
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

test('production drain bounds persistent 502 inspection retries and recovers on the capped timer', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const origin = 'https://drain-cycle-inspection-502.test';
  const store = createDurableTestStore();
  await enqueue(store, 'cm-cycle-inspection-502', origin);
  const timers = new FakeTimers();
  let inspectionRequests = 0;
  let mutationPosts = 0;
  let inspectionAvailable = false;
  let controller = null;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      inspectionRequests += 1;
      if (inspectionAvailable) {
        return Response.json(replayInspection());
      }
      if (inspectionRequests === 8 && timers.delays.length === 0) controller?.stop();
      return Response.json({
        diagnostic: { code: 'HTTP_502', message: 'proxy inspection unavailable' },
      }, { status: 502 });
    }
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      mutationPosts += 1;
      return settlement();
    }
    throw new Error(`unexpected cycle inspection request ${path}`);
  };
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(DRAIN_GENERATION.appId);
  controller = client.startOutboxDrain({ timer: timers });
  t.after(() => controller.stop());

  await waitFor(
    () => controller.status().drainPhase === 'backoff' || inspectionRequests === 8,
    'first 502 backoff',
  );
  for (let index = 0; index < 20; index += 1) await tick();
  assert.equal(inspectionRequests, 1, 'a queued wake cannot outrun the 250 ms retry timer');
  assert.equal(timers.pendingCount, 1);
  assert.equal(timers.delays[0], 250);
  assert.equal(controller.status().drainPhase, 'backoff');
  assert.equal(mutationPosts, 0, 'no mutation POST is sent while inspection is unavailable');
  assert.equal((await client.mutationStatus('cm-cycle-inspection-502')).status, 'pending');
  assert.equal(
    (await store.readOfflineMutationReplayCapabilityFact()).supported,
    true,
    'answered 502 observations never replace the durable positive fact',
  );
  assert.deepEqual((await client.outboxStatus()).offlineMutationReplayInspection, {
    status: 'unavailable',
    reason: 'answered-unavailable',
    code: 'HTTP_502',
    httpStatus: 502,
  });

  for (let retry = 0; retry < 7; retry += 1) {
    const before = inspectionRequests;
    await timers.runNext();
    await waitFor(() => inspectionRequests === before + 1, `502 retry ${retry + 1}`);
    await waitFor(() => timers.delays.length === retry + 2, `502 timer ${retry + 2}`);
    assert.equal(mutationPosts, 0);
  }
  assert.deepEqual(
    timers.delays.slice(0, 8),
    [250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000],
    'exponential retry delay is capped at 30 seconds',
  );
  assert.equal(timers.pendingCount, 1);

  inspectionAvailable = true;
  await timers.runNext();
  await waitFor(() => mutationPosts === 1, 'timer-owned replay after inspection recovery');
  assert.equal((await client.mutationStatus('cm-cycle-inspection-502')).status, 'settled');
});

test('an initial 502 inspect is a local unavailable observation and commits no durable fact', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const origin = 'https://drain-initial-inspection-502.test';
  const store = createDurableTestStore();
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, '/inspect');
    return Response.json({
      diagnostic: { code: 'HTTP_502', message: 'proxy inspection unavailable' },
    }, { status: 502 });
  };
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });

  await assert.rejects(
    () => client.inspect(),
    (error) => error?.status === 502,
  );
  assert.deepEqual(await store.readOfflineMutationReplayCapabilityFact(), {});
  assert.deepEqual((await client.outboxStatus()).offlineMutationReplayInspection, {
    status: 'unavailable',
    reason: 'answered-unavailable',
    code: 'HTTP_502',
    httpStatus: 502,
  });
});

test("a 502 and transport loss preserve positive enqueue-only evidence for queue:'auto'", async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const origin = 'https://drain-enqueue-inspection-unavailable.test';
  const store = createDurableTestStore();
  let inspectMode = 'positive';
  let mutationPosts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      if (inspectMode === 'positive') return Response.json(replayInspection());
      if (inspectMode === '502') {
        return Response.json({
          diagnostic: { code: 'HTTP_502', message: 'proxy inspection unavailable' },
        }, { status: 502 });
      }
      throw new TypeError('backend offline after proxy loss');
    }
    if (path === '/mutation/createThing') {
      mutationPosts += 1;
      throw new TypeError('mutation transport must stay enqueue-only');
    }
    throw new Error(`unexpected enqueue inspection request ${path}`);
  };
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(DRAIN_GENERATION.appId);
  await client.inspect();
  inspectMode = '502';
  await assert.rejects(() => client.inspect(), (error) => error?.status === 502);
  inspectMode = 'offline';

  const queued = await client.mutate('createThing', {
    args: { id: 'cm-enqueue-inspection-unavailable' },
    clientMutationId: 'cm-enqueue-inspection-unavailable',
    queue: 'auto',
  });
  assert.equal(queued.status, 'queued');
  assert.equal(mutationPosts, 0);
  assert.deepEqual(
    (await store.outboxPending()).map((record) => record.id),
    ['cm-enqueue-inspection-unavailable'],
  );
  assert.equal((await store.readOfflineMutationReplayCapabilityFact()).supported, true);
  assert.deepEqual((await client.outboxStatus()).offlineMutationReplayInspection, {
    status: 'unavailable',
    reason: 'transport-loss',
    code: 'SNAPBACK_CLIENT_REFUSED',
    httpStatus: null,
  });
});

for (const status of [408, 425, 429]) {
  test(`retryable HTTP ${status} at enqueue inspection preserves positive enqueue-only evidence`, async (t) => {
    t.after(() => { globalThis.fetch = originalFetch; });
    const origin = `https://drain-enqueue-inspection-${status}.test`;
    const store = createDurableTestStore();
    let inspectMode = 'positive';
    let mutationPosts = 0;
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/inspect') {
        if (inspectMode === 'positive') return Response.json(replayInspection());
        if (inspectMode === 'retryable') {
          return Response.json({
            diagnostic: { code: `HTTP_${status}`, message: 'retryable inspect response' },
          }, { status });
        }
        throw new TypeError('backend offline after retryable inspect');
      }
      if (path === '/mutation/createThing') {
        mutationPosts += 1;
        throw new TypeError('mutation transport must stay enqueue-only');
      }
      throw new Error(`unexpected retryable enqueue request ${path}`);
    };
    const client = new InspectingSnapbackClient(origin, {
      rqsStore: store,
      __outboxDrainLifecycle: false,
    });
    client.__registerInspectionAppId(DRAIN_GENERATION.appId);
    await client.inspect();
    inspectMode = 'retryable';
    await assert.rejects(() => client.inspect(), (error) => error?.status === status);
    inspectMode = 'offline';

    const queued = await client.mutate('createThing', {
      args: { id: `cm-enqueue-inspection-${status}` },
      clientMutationId: `cm-enqueue-inspection-${status}`,
      queue: 'auto',
    });
    assert.equal(queued.status, 'queued');
    assert.equal(mutationPosts, 0);
    assert.equal((await store.readOfflineMutationReplayCapabilityFact()).supported, true);
  });
}

for (const status of [408, 425, 429]) {
  test(`retryable HTTP ${status} at replay cycle start preserves the positive and backs off`, async (t) => {
    t.after(() => { globalThis.fetch = originalFetch; });
    const origin = `https://drain-cycle-inspection-${status}.test`;
    const store = createDurableTestStore();
    await enqueue(store, `cm-cycle-inspection-${status}`, origin);
    const timers = new FakeTimers();
    let mutationPosts = 0;
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/inspect') {
        return Response.json({
          diagnostic: { code: `HTTP_${status}`, message: 'retryable inspect response' },
        }, { status });
      }
      if (path === '/mutation/createThing') {
        mutationPosts += 1;
        return settlement();
      }
      throw new Error(`unexpected retryable cycle-start request ${path}`);
    };
    const client = new InspectingSnapbackClient(origin, {
      rqsStore: store,
      __outboxDrainLifecycle: false,
    });
    client.__registerInspectionAppId(DRAIN_GENERATION.appId);
    const controller = client.startOutboxDrain({ timer: timers });
    t.after(() => controller.stop());

    await waitFor(() => controller.status().drainPhase === 'backoff', `${status} cycle-start backoff`);
    assert.equal(mutationPosts, 0);
    assert.equal(timers.delays.at(-1), 250);
    assert.equal((await store.readOfflineMutationReplayCapabilityFact()).supported, true);
  });
}

for (const status of [408, 425, 429]) {
  test(`retryable HTTP ${status} at final pre-POST inspection preserves the positive and backs off`, async (t) => {
    t.after(() => { globalThis.fetch = originalFetch; });
    const origin = `https://drain-final-inspection-${status}.test`;
    const store = createDurableTestStore();
    await enqueue(store, `cm-final-inspection-${status}`, origin);
    const timers = new FakeTimers();
    let inspectRequests = 0;
    let mutationPosts = 0;
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/inspect') {
        inspectRequests += 1;
        if (inspectRequests === 3) {
          return Response.json({
            diagnostic: { code: `HTTP_${status}`, message: 'retryable inspect response' },
          }, { status });
        }
        return Response.json(replayInspection());
      }
      if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
      if (path === '/mutation/createThing') {
        mutationPosts += 1;
        return settlement();
      }
      throw new Error(`unexpected retryable final-inspect request ${path}`);
    };
    const client = new InspectingSnapbackClient(origin, {
      rqsStore: store,
      __outboxDrainLifecycle: false,
    });
    client.__registerInspectionAppId(DRAIN_GENERATION.appId);
    const controller = client.startOutboxDrain({ timer: timers });
    t.after(() => controller.stop());

    await waitFor(() => controller.status().drainPhase === 'backoff', `${status} final-inspect backoff`);
    assert.equal(mutationPosts, 0);
    assert.equal(timers.delays.at(-1), 250);
    assert.equal((await store.readOfflineMutationReplayCapabilityFact()).supported, true);
  });
}

test("a final 502 replay inspect records unavailability and leaves cached auto enqueue usable", async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const origin = 'https://drain-final-inspection-502.test';
  const store = createDurableTestStore();
  await enqueue(store, 'cm-final-inspection-502-replay', origin);
  const timers = new FakeTimers();
  let inspectRequests = 0;
  let inspectMode = 'replay';
  let mutationPosts = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      inspectRequests += 1;
      if (inspectMode === 'offline') throw new TypeError('backend offline after final inspect');
      if (inspectRequests === 3) {
        return Response.json({
          diagnostic: { code: 'HTTP_502', message: 'proxy inspection unavailable' },
        }, { status: 502 });
      }
      return Response.json(replayInspection());
    }
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      mutationPosts += 1;
      return settlement();
    }
    throw new Error(`unexpected final-502 request ${path}`);
  };
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(DRAIN_GENERATION.appId);
  const controller = client.startOutboxDrain({ timer: timers });
  t.after(() => controller.stop());
  await waitFor(() => controller.status().drainPhase === 'backoff', 'final 502 backoff');
  controller.stop();
  assert.equal(mutationPosts, 0);
  assert.equal((await store.readOfflineMutationReplayCapabilityFact()).supported, true);
  assert.deepEqual((await client.outboxStatus()).offlineMutationReplayInspection, {
    status: 'unavailable',
    reason: 'answered-unavailable',
    code: 'HTTP_502',
    httpStatus: 502,
  });

  inspectMode = 'offline';
  const queued = await client.mutate('createThing', {
    args: { id: 'cm-after-final-inspection-502' },
    clientMutationId: 'cm-after-final-inspection-502',
    queue: 'auto',
  });
  assert.equal(queued.status, 'queued');
  assert.equal(mutationPosts, 0);
});

test("a final manifest gap commits a durable negative and refuses later cached auto enqueue", async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const origin = 'https://drain-final-inspection-gap.test';
  const store = createDurableTestStore();
  await enqueue(store, 'cm-final-inspection-gap-replay', origin);
  const timers = new FakeTimers();
  let inspectRequests = 0;
  let inspectMode = 'replay';
  let mutationPosts = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/inspect') {
      inspectRequests += 1;
      if (inspectMode === 'offline') throw new TypeError('backend offline after manifest gap');
      return Response.json(replayInspection({ supported: inspectRequests !== 3 }));
    }
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      mutationPosts += 1;
      return settlement();
    }
    throw new Error(`unexpected final-gap request ${path}`);
  };
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(DRAIN_GENERATION.appId);
  const controller = client.startOutboxDrain({ timer: timers });
  t.after(() => controller.stop());
  await waitFor(() => controller.status().drainPhase === 'paused', 'final gap pause');
  assert.equal(mutationPosts, 0);
  assert.equal(inspectRequests, 3, 'cycle-start, replay-core, and final-cut inspect exactly once');
  assert.equal(timers.pendingCount, 0, 'a durable gap is a stable pause, not a retry timer');
  for (let index = 0; index < 20; index += 1) await tick();
  assert.equal(inspectRequests, 3, 'the negative fact commit cannot self-wake the paused drain');
  controller.stop();
  const negative = await store.readOfflineMutationReplayCapabilityFact();
  assert.equal(negative.supported, false);
  assert.equal(negative.reason, 'not-advertised');

  inspectMode = 'offline';
  await assert.rejects(
    () => client.mutate('createThing', {
      args: { id: 'cm-after-final-inspection-gap' },
      clientMutationId: 'cm-after-final-inspection-gap',
      queue: 'auto',
    }),
    (error) => error?.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED',
  );
  assert.equal(mutationPosts, 0);
});

test('a live client drains after a backend restart on connectivity backoff without an online event', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const origin = 'https://drain-server-restart.test';
  const store = createDurableTestStore();
  await enqueue(store, 'cm-server-restart', origin);
  const timers = new FakeTimers();
  let backendOnline = false;
  let mutationPosts = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (!backendOnline) throw new TypeError('local backend stopped');
    if (path === '/inspect') return Response.json(replayInspection());
    if (path === '/connection/open') return grant(JSON.parse(init.body).connectionId);
    if (path === '/mutation/createThing') {
      mutationPosts += 1;
      return settlement();
    }
    throw new Error(`unexpected restart request ${path}`);
  };
  const client = new InspectingSnapbackClient(origin, {
    rqsStore: store,
    __outboxDrainLifecycle: false,
  });
  client.__registerInspectionAppId(DRAIN_GENERATION.appId);
  const controller = client.startOutboxDrain({ timer: timers });
  t.after(() => controller.stop());
  await waitFor(() => controller.status().drainPhase === 'backoff', 'restart connectivity backoff');
  assert.equal(controller.status().nextRetryAtMs, timers.nowMs + 250);
  assert.equal(mutationPosts, 0);

  backendOnline = true;
  await timers.runNext();
  await waitFor(() => mutationPosts === 1, 'replay after backend restart');
  assert.equal((await client.mutationStatus('cm-server-restart')).status, 'settled');
});

test('no-mounted-query drain: controller resyncs retained registrations itself', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-no-mounted', 'https://drain-retained.test');
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
  await enqueue(writerStore, 'cm-writer-settlement', 'https://drain-takeover.test');
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

  await enqueue(writerStore, 'cm-takeover', 'https://drain-takeover.test');

  await writerStore.close();
  await waitFor(() => replayed === 2, 'writer takeover replay');
  assert.equal(followerStore.isWriter(), true);
  assert.equal((await follower.mutationStatus('cm-takeover')).status, 'settled');
  assert.equal((await follower.outboxStatus()).pending, 0);
});

test('auth replacement wake: successor bearer bind wakes a paused drain without another edge', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-auth-wake', 'https://drain-auth.test');
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
  await enqueue(store, 'cm-terminal', 'https://drain-terminal.test');
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
  const terminalStatus = await client.mutationStatus('cm-terminal');
  assert.deepEqual({
    status: terminalStatus.status,
    failure: terminalStatus.failure,
  }, {
    status: 'failed',
    failure: {
      code: 'SNAPBACK_DRAIN_TERMINAL_TEST',
      message: 'SNAPBACK_DRAIN_TERMINAL_TEST: typed refusal',
    },
  });
  assert.equal(Number.isInteger(terminalStatus.timing.enqueuedAtMs), true);
  assert.equal(Number.isInteger(terminalStatus.timing.dispatchedAtMs), true);
  assert.equal(terminalStatus.timing.authorizedAtMs, null);
  assert.equal(terminalStatus.timing.executedAtMs, null);
  assert.equal(terminalStatus.timing.committedAtMs, null);
  assert.equal(
    (await client.outboxStatus()).blockedReason,
    'terminal-disposition:SNAPBACK_DRAIN_TERMINAL_TEST',
  );
});

test('bounded backoff: repeated transient failures never schedule beyond the cap', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await enqueue(store, 'cm-bounded', 'https://drain-bounded.test');
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
  await enqueue(store, 'cm-dedup', 'https://drain-dedup.test');
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
