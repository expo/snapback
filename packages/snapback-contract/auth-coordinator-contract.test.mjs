// LLP 0059 item-5 Contract participation: delayed A work cannot alter B.

import assert from 'node:assert/strict';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
  createMemorySnapbackClientStore,
  createSnapbackContractSurface,
} from './index.mjs';

const APP = 'snapback.test/contract-barrier';
const INC_A = '018f0d90-7b11-7a22-8c33-445566778899';
const INC_B = '018f0d90-7b12-7a22-8c33-445566778899';
const INC_C = '018f0d90-7b13-7a22-8c33-445566778899';
const INC_D = '018f0d90-7b14-7a22-8c33-445566778899';

const anonymous = (incarnation) => ({
  kind: 'anonymous',
  authMode: 'dev',
  authorizationStreamIncarnation: incarnation,
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('timed out waiting for deterministic test state');
};

const runtime = {
  createContractMockQueryBoundary(initialRows) {
    const rows = new Map(Object.entries(initialRows));
    const listeners = new Map();
    return {
      current: (key) => rows.get(key) ?? [],
      query: (key, project = (value) => value) => project(rows.get(key) ?? []),
      write(key, update) {
        const next = update(rows.get(key) ?? []);
        rows.set(key, next);
        for (const listener of listeners.get(key) ?? []) listener(next);
        return next;
      },
      subscribe(key, listener) {
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(listener);
        return () => listeners.get(key)?.delete(listener);
      },
    };
  },
  createBoundaryContractDataProvider(_manifest, boundary, options) {
    return {
      boundary,
      subscribe(name, args, observer) {
        if (options.ephemerals?.[name]) {
          return { dispose: options.ephemerals[name](args, observer) };
        }
        observer({ status: 'ready', rows: options.queries[name](args, boundary) });
        const boundaryKey = name === 'listTodos' ? 'todos' : name;
        const off = boundary.subscribe(boundaryKey, (rows) => {
          observer({ status: 'ready', rows });
        });
        return { dispose: off };
      },
    };
  },
  createProviderEphemeralHandle() {
    return { dispose() {} };
  },
  createProviderQueryHandle() {
    return { dispose() {} };
  },
};

const manifest = {
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  schemaVersion: 'snapback.v0',
  inputsHash: 'contract-barrier-inputs',
  schemaHash: 'contract-barrier-schema',
  bundleHash: 'contract-barrier-bundle',
  capabilities: { derivedOptimisticOverlays: true, offlineReplay: true },
  queries: {
    listTodos: {
      name: 'listTodos',
      mode: 'live',
      defaultLive: true,
      reads: ['todos'],
    },
    presence: {
      name: 'presence',
      ephemeral: true,
      authorityIndependent: true,
      keyMode: 'User',
      scopeFields: [],
    },
  },
  mutations: {
    createTodo: {
      optimistic: true,
      plan: {
        steps: [{
          Insert: {
            table: 'todos',
            values: { title: { Arg: 'title' } },
            bind_id_as: 'todoId',
          },
        }],
        return_value: { Binding: 'todoId' },
      },
    },
  },
};

const coordinator = new AuthCoordinator({
  appId: APP,
  storage: createMemoryAuthCustodyStorage(),
  broadcastChannelFactory: null,
  hintStorage: null,
});
await coordinator.establishAnonymous(anonymous(INC_A));

const tagged = new WeakMap();
const tag = (value, capture) => {
  if (value && typeof value === 'object') tagged.set(value, capture);
  return value;
};
const registrations = [];
const participantResumeCounts = new Map();
const liveCallbacks = [];
const pendingMutations = [];
let nextLive = null;
let liveSequence = 0;

const makeHandle = (capture, label) => {
  const rows = tag([{ _id: label, title: label }], capture);
  const handle = {
    rows,
    version: liveSequence += 1,
    connection: 'live',
    disposed: false,
    dispose() { this.disposed = true; },
  };
  return tag(handle, capture);
};

const client = {
  authCoordinator: coordinator,
  async authSession() {},
  captureAuthority: () => coordinator.capture(),
  authorityCaptureFor: (value) => tagged.get(value) ?? null,
  registerAuthBarrierParticipant(participant) {
    registrations.push(participant);
    return coordinator.registerParticipant({
      ...participant,
      async resume(context) {
        participantResumeCounts.set(
          participant.name,
          (participantResumeCounts.get(participant.name) ?? 0) + 1,
        );
        return participant.resume?.(context);
      },
    });
  },
  liveQuery(name, options) {
    const capture = coordinator.capture();
    liveCallbacks.push({ name, capture, onUpdate: options.onUpdate });
    if (nextLive) {
      const waiting = nextLive;
      nextLive = null;
      return waiting.promise.then((label) => makeHandle(capture, label));
    }
    return Promise.resolve(makeHandle(capture, `snapshot-${capture.authorityEpoch}`));
  },
  query() {
    const capture = coordinator.capture();
    return Promise.resolve(tag({ rows: [{ _id: `query-${capture.authorityEpoch}` }] }, capture));
  },
  mutate() {
    const capture = coordinator.capture();
    const waiting = deferred();
    pendingMutations.push({ ...waiting, capture });
    return waiting.promise.then(
      (value) => tag(value, capture),
      (error) => { tag(error, capture); throw error; },
    );
  },
  liveStreamManager() {
    return { isOpen: () => true, onState: () => () => {} };
  },
  async subscribeEphemeral() {
    const capture = coordinator.capture();
    const listeners = new Set();
    return {
      currentEntries: () => [{
        key: `presence-${capture.authorityEpoch}`,
        value: { epoch: capture.authorityEpoch },
        receivedAtMs: 1,
        expiresAtMs: Date.now() + 60_000,
      }],
      onChange(listener) { listeners.add(listener); },
      dispose() { listeners.clear(); },
    };
  },
  async unsubscribeEphemeral() {},
  async publishEphemeral() {},
};

const physicalStore = createMemorySnapbackClientStore();
const oldRetainedWrite = deferred();
let oldRetainedWriteStarted = false;
let delayOneRetainedWrite = true;
const clientStore = {
  ...physicalStore,
  async putRetainedQuery(...args) {
    if (delayOneRetainedWrite) {
      delayOneRetainedWrite = false;
      oldRetainedWriteStarted = true;
      await oldRetainedWrite.promise;
    }
    return physicalStore.putRetainedQuery(...args);
  },
};

const surfaceOptions = {
  runtime,
  client,
  clientStore,
  userId: null,
  manifest,
  queryName: 'listTodos',
  boundaryKey: 'todos',
  artifactIndex: { appId: APP },
  schemaManifest: { schemaHash: manifest.schemaHash, targetProfile: 'local-dev-sqlite-ibex' },
  retainedIdentity: { databaseId: 'db-contract-barrier', versionStreamId: 'stream-contract-barrier' },
};

const surface = await createSnapbackContractSurface(surfaceOptions);
const providerCells = [];
const providerSubscription = surface.provider.subscribe(
  'listTodos',
  {},
  (cell) => providerCells.push(cell),
);
const presenceCells = [];
const presenceSubscription = surface.provider.subscribe(
  'presence',
  {},
  (cell) => presenceCells.push(cell),
);
await waitFor(() => oldRetainedWriteStarted);
assert.deepEqual(surface.boundary.current('todos').map((row) => row._id), ['snapshot-0']);
assert.equal(
  registrations.filter((participant) => participant.name === 'snapback-client-store').length,
  1,
);

// Delay mutation success and the retained tail under A. The B transition
// blanks synchronously and remains paused until its fresh live snapshot lands.
const mutationA = surface.links.createTodo({ title: 'late-success' });
await waitFor(() => pendingMutations.length === 1);
const oldLive = liveCallbacks[0];
nextLive = deferred();
const captureA = coordinator.capture();
const captureB = await coordinator.transition(captureA, anonymous(INC_B), 'test-a-to-b');
assert.deepEqual(surface.boundary.current('todos'), []);
assert.throws(() => surface.links.listTodos(), { code: 'SNAPBACK_CLIENT_AUTHORITY_STALE' });

pendingMutations[0].resolve({ ok: 'late-a' });
oldRetainedWrite.resolve();
nextLive.resolve('snapshot-b');
await assert.rejects(mutationA, { code: 'SNAPBACK_CLIENT_AUTHORITY_STALE' });
await surface.flush();
assert.deepEqual(surface.boundary.current('todos').map((row) => row._id), ['snapshot-b']);
assert.deepEqual(providerCells.at(-1).rows.map((row) => row._id), ['snapshot-b']);
assert.deepEqual(presenceCells.at(-1).entries.map((entry) => entry.key), ['presence-1']);
assert.equal((await physicalStore.snapshot()).authorityEpoch, captureB.authorityEpoch);
assert.deepEqual((await physicalStore.snapshot()).retained, {});

// A live callback retained by a hostile/buggy transport cannot republish A.
oldLive.onUpdate(tag([{ _id: 'late-live-a' }], oldLive.capture), { version: 99 });
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(surface.boundary.current('todos').map((row) => row._id), ['snapshot-b']);

// Repeat with a delayed failure under B; its rollback/diagnostic cannot alter C.
const mutationB = surface.links.createTodo({ title: 'late-failure' });
await waitFor(() => pendingMutations.length === 2);
nextLive = deferred();
const captureC = await coordinator.transition(captureB, anonymous(INC_C), 'test-b-to-c');
const lateFailure = new Error('late failure from B');
pendingMutations[1].reject(lateFailure);
nextLive.resolve('snapshot-c');
await assert.rejects(mutationB, { code: 'SNAPBACK_CLIENT_AUTHORITY_STALE' });
await surface.flush();
assert.deepEqual(surface.boundary.current('todos').map((row) => row._id), ['snapshot-c']);
assert.deepEqual(providerCells.at(-1).rows.map((row) => row._id), ['snapshot-c']);
assert.deepEqual(presenceCells.at(-1).entries.map((entry) => entry.key), ['presence-2']);
assert.equal((await physicalStore.snapshot()).authorityEpoch, captureC.authorityEpoch);
assert.equal(
  surface.diagnostics.some((diagnostic) => diagnostic.message.includes('late failure from B')),
  false,
);

// A mode transition to sessions cannot inherit the dev surface's Parity
// advertisement or revive retained reads / queued replay.
nextLive = deferred();
const captureD = await coordinator.transition(
  captureC,
  { ...anonymous(INC_D), authMode: 'sessions' },
  'test-dev-to-sessions',
);
nextLive.resolve('snapshot-sessions');
await surface.flush();
assert.equal(surface.capabilityClass, 'Online');
assert.deepEqual(await surface.reconnect(), { replayed: 0, failed: 0 });
assert.deepEqual((await physicalStore.snapshot()).retained, {});
assert.equal((await physicalStore.snapshot()).authorityEpoch, captureD.authorityEpoch);
assert.deepEqual(providerCells.at(-1).rows.map((row) => row._id), ['snapshot-sessions']);
assert.deepEqual(presenceCells.at(-1).entries.map((entry) => entry.key), ['presence-3']);

// A transition in the exact post-preflight window cannot let an optimistic A
// write overwrite the synchronous blank. The mutation transport is never
// invoked because the surface rechecks its barrier at the exposure turn.
const originalCompareAndCommit = coordinator.compareAndCommit.bind(coordinator);
const preflightEntered = deferred();
const releasePreflight = deferred();
let interceptPreflight = true;
coordinator.compareAndCommit = async (...args) => {
  const result = await originalCompareAndCommit(...args);
  if (interceptPreflight) {
    interceptPreflight = false;
    preflightEntered.resolve();
    await releasePreflight.promise;
  }
  return result;
};
const pendingBeforeRace = pendingMutations.length;
const racedOptimistic = surface.links.createTodo({ title: 'must-not-render' });
await preflightEntered.promise;
nextLive = deferred();
const captureE = await coordinator.transition(
  captureD,
  anonymous('018f0d90-7b15-7a22-8c33-445566778899'),
  'test-post-preflight-race',
);
assert.deepEqual(surface.boundary.current('todos'), []);
releasePreflight.resolve();
nextLive.resolve('snapshot-after-race');
await assert.rejects(racedOptimistic, { code: 'SNAPBACK_CLIENT_AUTHORITY_STALE' });
await surface.flush();
assert.equal(pendingMutations.length, pendingBeforeRace);
assert.deepEqual(surface.boundary.current('todos').map((row) => row._id), ['snapshot-after-race']);
assert.equal((await physicalStore.snapshot()).authorityEpoch, captureE.authorityEpoch);
coordinator.compareAndCommit = originalCompareAndCommit;

// Multi-live surfaces reopen every live handle and publish all successor
// boundaries behind the same blank gate; they do not silently degrade to
// one-shot polling after an authority change.
const multiManifest = {
  ...manifest,
  inputsHash: 'contract-barrier-multi-inputs',
  schemaHash: 'contract-barrier-multi-schema',
  bundleHash: 'contract-barrier-multi-bundle',
  capabilities: {},
  queries: {
    first: { name: 'first', mode: 'live', defaultLive: true, reads: ['first'] },
    second: { name: 'second', mode: 'live', defaultLive: true, reads: ['second'] },
  },
  mutations: {},
};
const multi = await createSnapbackContractSurface({
  runtime,
  client,
  userId: null,
  manifest: multiManifest,
  liveQueries: [{ name: 'first', args: {} }, { name: 'second', args: {} }],
  artifactIndex: { appId: APP },
  schemaManifest: {
    schemaHash: multiManifest.schemaHash,
    targetProfile: 'local-dev-sqlite-ibex',
  },
});
const firstCells = [];
const secondCells = [];
const firstSubscription = multi.provider.subscribe('first', {}, (cell) => firstCells.push(cell));
const secondSubscription = multi.provider.subscribe('second', {}, (cell) => secondCells.push(cell));
const liveCallsBeforeMultiTransition = liveCallbacks.length;
const resumesBeforeMultiTransition = new Map(participantResumeCounts);
const captureF = await coordinator.transition(
  captureE,
  anonymous('018f0d90-7b16-7a22-8c33-445566778899'),
  'test-multi-live-resume',
);
assert.deepEqual(multi.boundary.current('first'), []);
assert.deepEqual(multi.boundary.current('second'), []);
await multi.flush();
assert.deepEqual(
  liveCallbacks.slice(liveCallsBeforeMultiTransition).map(({ name }) => name),
  ['first', 'second'],
);
assert.deepEqual(
  [...participantResumeCounts]
    .filter(([name]) => name.startsWith('snapback-contract-'))
    .map(([name, count]) => [name, count - (resumesBeforeMultiTransition.get(name) ?? 0)]),
  [...participantResumeCounts]
    .filter(([name]) => name.startsWith('snapback-contract-'))
    .map(([name]) => [name, 1]),
  'each real Contract participant resumed exactly once',
);
assert.deepEqual(
  multi.boundary.current('first').map((row) => row._id),
  [`snapshot-${captureF.authorityEpoch}`],
);
assert.deepEqual(
  multi.boundary.current('second').map((row) => row._id),
  [`snapshot-${captureF.authorityEpoch}`],
);
assert.deepEqual(firstCells.at(-1).rows.map((row) => row._id), [`snapshot-${captureF.authorityEpoch}`]);
assert.deepEqual(secondCells.at(-1).rows.map((row) => row._id), [`snapshot-${captureF.authorityEpoch}`]);
firstSubscription.dispose();
secondSubscription.dispose();
await multi.dispose();

// A second surface over the same physical store/coordinator does not register
// another durable transition owner.
const second = await createSnapbackContractSurface(surfaceOptions);
assert.equal(
  registrations.filter((participant) => participant.name === 'snapback-client-store').length,
  1,
);
await second.dispose();
providerSubscription.dispose();
presenceSubscription.dispose();
await surface.dispose();

console.log('auth-coordinator-contract.test.mjs: all assertions passed');
