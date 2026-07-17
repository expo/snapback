// Checked lifecycle generations must never wrap into stale-equality. These
// tests seed the real adapter one cut from (or at) MAX_SAFE_INTEGER and retain
// predecessor callbacks across the terminal cut.

import assert from 'node:assert/strict';

import {
  __createSwappableEphemeralWiringForTests,
  createSnapbackContractSurface,
} from './index.mjs';

const MAX = Number.MAX_SAFE_INTEGER;
const EXHAUSTED = 'SNAPBACK_CONTRACT_LIFECYCLE_GENERATION_EXHAUSTED';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(`timed out waiting for ${label}`);
};

const createRuntime = (captured = {}) => ({
  createContractMockQueryBoundary(initialRows) {
    const rows = new Map(Object.entries(initialRows));
    return {
      current: (key) => rows.get(key) ?? [],
      query: (key, project = (value) => value) => project(rows.get(key) ?? []),
      write(key, update) {
        const next = update(rows.get(key) ?? []);
        rows.set(key, next);
        return next;
      },
    };
  },
  createBoundaryContractDataProvider(_manifest, boundary, options) {
    captured.ephemerals = options.ephemerals;
    return {
      subscribe(name, args, observer) {
        if (options.ephemerals?.[name]) {
          return { dispose: options.ephemerals[name](args, observer) };
        }
        observer({ status: 'ready', rows: options.queries[name](args, boundary) });
        return { dispose() {} };
      },
    };
  },
  createProviderQueryHandle() { return { dispose() {} }; },
  createProviderEphemeralHandle() { return { dispose() {} }; },
});

const createCoordinatorHarness = () => {
  const participants = [];
  let compareGate = null;
  const capture = Object.freeze({ authorityEpoch: 0, authorityKey: 'authority-a' });
  const coordinator = {
    authority: { kind: 'anonymous', authMode: 'dev' },
    capture: () => capture,
    isCurrent: (candidate) => (
      candidate?.authorityEpoch === capture.authorityEpoch
      && candidate?.authorityKey === capture.authorityKey
    ),
    async compareAndCommit(candidate, commit) {
      if (!this.isCurrent(candidate)) return { committed: false };
      if (compareGate) {
        const gate = compareGate;
        compareGate = null;
        gate.entered = true;
        await gate.promise;
      }
      return { committed: true, value: commit() };
    },
    registerParticipant(participant) {
      participants.push(participant);
      return async () => {};
    },
    async synchronize() {},
  };
  const queryCalls = [];
  const client = {
    authCoordinator: coordinator,
    captureAuthority: () => capture,
    registerAuthBarrierParticipant(participant) {
      participants.push(participant);
      return async () => {};
    },
    async query(name) {
      queryCalls.push(name);
      return { rows: [{ _id: `${name}-initial` }] };
    },
  };
  return {
    capture,
    client,
    coordinator,
    participants,
    queryCalls,
    deferNextCompare() {
      let resolve;
      const promise = new Promise((settle) => { resolve = settle; });
      const gate = { entered: false, promise, resolve };
      compareGate = gate;
      return gate;
    },
  };
};

const manifest = (queries) => ({
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  queries,
  mutations: {},
});

// Single-query resume: a timer already captured MAX. The next quiesce cannot
// allocate a distinct identity, so it must settle that timer, blank, and stay
// terminal rather than letting the equal-MAX predecessor publish.
{
  const harness = createCoordinatorHarness();
  const surface = await createSnapbackContractSurface({
    runtime: createRuntime(),
    client: harness.client,
    manifest: manifest({ alpha: {} }),
    queryName: 'alpha',
    boundaryKey: 'alpha',
    livePush: false,
    testLifecycleGenerationSeeds: { resume: MAX },
  });
  const participant = harness.participants.find((entry) => (
    entry.name.startsWith('snapback-contract-surface:')
  ));
  const finalCommit = harness.deferNextCompare();
  await participant.resume({ capture: harness.capture, authority: harness.coordinator.authority });
  await waitFor(() => finalCommit.entered, 'single resume final publication compare');
  participant.quiesce();
  participant.blank();
  participant.clearMemory();
  await participant.resume({ capture: harness.capture, authority: harness.coordinator.authority });
  finalCommit.resolve();
  await surface.flush();

  assert.deepEqual(surface.boundary.current('alpha'), []);
  assert.deepEqual(
    harness.queryCalls,
    ['alpha', 'alpha'],
    'the started predecessor reaches its final compare but cannot publish',
  );
  const diagnostic = surface.diagnostics.find((entry) => entry.code === EXHAUSTED);
  assert.equal(diagnostic?.details.axis, 'single-surface-resume');
  let firstError;
  try { surface.links.alpha(); } catch (error) { firstError = error; }
  assert.equal(firstError?.code, EXHAUSTED);
  assert.throws(() => surface.links.alpha(), (error) => error === firstError);
  const firstDispose = surface.dispose();
  assert.equal(surface.dispose(), firstDispose, 'terminal disposal is single-flight');
  await firstDispose;
}

// Multi-query resume has the same terminal contract, including settlement of
// the predecessor timer and an all-boundary synchronous blank.
{
  const harness = createCoordinatorHarness();
  const surface = await createSnapbackContractSurface({
    runtime: createRuntime(),
    client: harness.client,
    manifest: manifest({ alpha: {}, beta: {} }),
    liveQueries: ['alpha', 'beta'],
    livePush: false,
    testLifecycleGenerationSeeds: { resume: MAX },
  });
  const participant = harness.participants.find((entry) => (
    entry.name.startsWith('snapback-contract-multi-surface:')
  ));
  await participant.resume({ capture: harness.capture, authority: harness.coordinator.authority });
  participant.quiesce();
  participant.blank();
  participant.clearMemory();
  await participant.resume({ capture: harness.capture, authority: harness.coordinator.authority });
  await surface.flush();

  assert.deepEqual(surface.boundary.current('alpha'), []);
  assert.deepEqual(surface.boundary.current('beta'), []);
  assert.deepEqual(harness.queryCalls, ['alpha', 'beta']);
  const diagnostic = surface.diagnostics.find((entry) => entry.code === EXHAUSTED);
  assert.equal(diagnostic?.details.axis, 'multi-surface-resume');
  assert.throws(() => surface.links.alpha(), { code: EXHAUSTED });
  const firstDispose = surface.dispose();
  assert.equal(surface.dispose(), firstDispose, 'multi terminal disposal is single-flight');
  await firstDispose;
}

// A terminal swappable lane terminalizes its owning Contract surface too; the
// durable boundary cannot reopen while its ephemeral half is permanently
// detached under the same auth-barrier participant.
{
  const harness = createCoordinatorHarness();
  const managerListeners = new Set();
  const overlayCallbacks = new Set();
  Object.assign(harness.client, {
    liveStreamManager: () => ({
      isOpen: () => true,
      onState(callback) {
        managerListeners.add(callback);
        return () => managerListeners.delete(callback);
      },
    }),
    async subscribeEphemeral() {
      return {
        currentEntries: () => [{
          key: 'predecessor',
          value: {},
          receivedAtMs: 1,
          expiresAtMs: Date.now() + 60_000,
        }],
        onChange(callback) { overlayCallbacks.add(callback); },
        dispose() {},
      };
    },
    async unsubscribeEphemeral() {},
    async publishEphemeral() {},
  });
  const surface = await createSnapbackContractSurface({
    runtime: createRuntime(),
    client: harness.client,
    manifest: manifest({
      alpha: {},
      presence: {
        ephemeral: true,
        keyMode: 'Connection',
        scopeFields: [],
      },
    }),
    queryName: 'alpha',
    boundaryKey: 'alpha',
    livePush: false,
    testLifecycleGenerationSeeds: { ephemeralWiring: MAX },
  });
  const cells = [];
  const subscription = surface.provider.subscribe('presence', {}, (cell) => cells.push(cell));
  assert.equal(cells.at(-1).entries[0].key, 'predecessor');
  const participant = harness.participants.find((entry) => (
    entry.name.startsWith('snapback-contract-surface:')
  ));
  participant.quiesce();
  participant.blank();
  participant.clearMemory();
  await participant.resume({ capture: harness.capture, authority: harness.coordinator.authority });
  await surface.flush();

  assert.deepEqual(surface.boundary.current('alpha'), []);
  assert.deepEqual(cells.at(-1).entries, []);
  const diagnostic = surface.diagnostics.find((entry) => entry.code === EXHAUSTED);
  assert.equal(diagnostic?.details.axis, 'ephemeral-wiring');
  assert.throws(() => surface.links.alpha(), { code: EXHAUSTED });
  subscription.dispose();
  await surface.dispose();
}

// Socket-loss resubscribe: the first loss consumes the final exact identity;
// a fresh subscribe is then in flight at MAX. The second loss terminalizes the
// room, and that late fresh resolve is disposed without publication or retry.
{
  const managerListeners = new Set();
  let managerOpen = true;
  const manager = {
    isOpen: () => managerOpen,
    onState(listener) {
      managerListeners.add(listener);
      return () => managerListeners.delete(listener);
    },
    emit(state, detail = {}) {
      managerOpen = state === 'open';
      for (const listener of [...managerListeners]) listener(state, detail);
    },
  };
  const overlay = (key) => {
    const callbacks = new Set();
    return {
      key,
      disposed: false,
      needsResync: false,
      currentEntries: () => [{
        key,
        value: { key },
        receivedAtMs: 1,
        expiresAtMs: Date.now() + 60_000,
      }],
      onChange(callback) { callbacks.add(callback); },
      dispose() { this.disposed = true; },
    };
  };
  const firstOverlay = overlay('predecessor');
  const lateOverlay = overlay('late-successor');
  let lateResolve;
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  const client = {
    async query() { return { rows: [] }; },
    liveStreamManager: () => manager,
    subscribeEphemeral() {
      subscribeCalls += 1;
      if (subscribeCalls === 1) return Promise.resolve(firstOverlay);
      return new Promise((resolve) => { lateResolve = () => resolve(lateOverlay); });
    },
    async unsubscribeEphemeral() { unsubscribeCalls += 1; },
    async publishEphemeral() {},
  };
  const captured = {};
  const surface = await createSnapbackContractSurface({
    runtime: createRuntime(captured),
    client,
    manifest: manifest({
      alpha: {},
      presence: {
        ephemeral: true,
        keyMode: 'Connection',
        scopeFields: [],
      },
    }),
    queryName: 'alpha',
    boundaryKey: 'alpha',
    livePush: false,
    testLifecycleGenerationSeeds: { socketLoss: MAX - 1 },
  });
  const cells = [];
  const off = captured.ephemerals.presence({}, (cell) => cells.push(cell));
  assert.equal(cells.at(-1).entries[0].key, 'predecessor');

  manager.emit('lost', { wasOpen: true }); // MAX is consumed exactly once.
  manager.emit('open'); // Subscribe at epoch MAX remains in flight.
  assert.equal(subscribeCalls, 2);
  manager.emit('lost', { wasOpen: true }); // No successor identity: terminal.
  assert.deepEqual(cells.at(-1), {
    status: 'ready',
    entries: [],
    connection: 'disconnected',
  });
  assert.equal(managerListeners.size, 0, 'terminal room detaches socket demand');
  const diagnostic = surface.diagnostics.find((entry) => entry.code === EXHAUSTED);
  assert.equal(diagnostic?.details.axis, 'ephemeral-socket-loss');

  lateResolve();
  await tick();
  assert.equal(lateOverlay.disposed, true, 'late resubscribe is consumed and disposed');
  assert.equal(
    unsubscribeCalls,
    2,
    'terminal cut and late registration each dispatch server-side cleanup',
  );
  assert.equal(subscribeCalls, 2, 'terminal room never starts another resubscribe');
  assert.deepEqual(cells.at(-1).entries, []);
  off();
  await surface.dispose();
}

// Swappable wiring: a hostile predecessor retains its callback after detach.
// At terminal MAX the callback's captured generation equals the stored value,
// so only the permanent terminal gate can prevent republication.
{
  let predecessorEmit;
  let predecessorDisposals = 0;
  let detaches = 0;
  const predecessor = {
    descriptors: [['presence', { ephemeral: true }]],
    sources: {
      presence(_args, emit) {
        predecessorEmit = emit;
        emit({ status: 'ready', entries: [{ key: 'predecessor' }], connection: 'live' });
        return () => { detaches += 1; };
      },
    },
    prewarm: () => Promise.resolve(),
    prewarmScope: () => Promise.resolve(),
    buildLinks: () => ({}),
    dispose() { predecessorDisposals += 1; },
  };
  const terminalErrors = [];
  const wiring = __createSwappableEphemeralWiringForTests(predecessor, {
    generationSeed: MAX,
    onLifecycleTerminal: (error) => terminalErrors.push(error),
  });
  const cells = [];
  wiring.sources.presence({}, (cell) => cells.push(cell));
  assert.equal(cells.at(-1).entries[0].key, 'predecessor');

  wiring.quiesce();
  assert.equal(terminalErrors.length, 1);
  assert.equal(terminalErrors[0].code, EXHAUSTED);
  assert.equal(terminalErrors[0].diagnostic.details.axis, 'ephemeral-wiring');
  assert.deepEqual(cells.at(-1).entries, []);
  const terminalCellCount = cells.length;
  predecessorEmit({ status: 'ready', entries: [{ key: 'hostile-late' }], connection: 'live' });
  assert.equal(cells.length, terminalCellCount, 'equal-MAX predecessor callback is refused');

  let successorDisposals = 0;
  wiring.prepare({ dispose() { successorDisposals += 1; } });
  wiring.expose();
  wiring.dispose();
  wiring.dispose();
  assert.equal(detaches, 1);
  assert.equal(predecessorDisposals, 1);
  assert.equal(successorDisposals, 1, 'terminal prepare consumes its unowned successor');
}

console.log('lifecycle-generation-exhaustion.test.mjs: all assertions passed');
