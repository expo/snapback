// LLP 0059 cross-context ownership: a context that missed (or has not yet
// received) the custody wakeup must reload durable custody at every
// publication/lifecycle gate. isCurrent() is only an in-memory hint — after a
// peer durably settles A -> B, the stale context's surface blanks/refuses
// before any observer or mount receives A data (ENG-24984).

import assert from 'node:assert/strict';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
  createSnapbackContractSurface,
} from './index.mjs';

const APP = 'snapback.test/missed-wakeup';
const INC_A = '018f0d90-7b21-7a22-8c33-445566778899';
const INC_B = '018f0d90-7b22-7a22-8c33-445566778899';
const INC_C = '018f0d90-7b23-7a22-8c33-445566778899';
const INC_D = '018f0d90-7b24-7a22-8c33-445566778899';

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
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('timed out waiting for deterministic test state');
};

const rowIds = (rows) => (rows ?? []).map((row) => row._id);

// A BroadcastChannel hub whose delivery can be deferred: messages queue until
// flush(). With no flush this is a lost wakeup; flushing late models delay.
class DeferredBroadcastHub {
  channels = new Map();
  queued = [];

  factory = (name) => {
    const channel = {
      name,
      onmessage: null,
      postMessage: (message) => {
        this.queued.push({ name, message: structuredClone(message), from: channel });
      },
      close: () => this.channels.get(name)?.delete(channel),
    };
    if (!this.channels.has(name)) this.channels.set(name, new Set());
    this.channels.get(name).add(channel);
    return channel;
  };

  flush() {
    const pending = this.queued;
    this.queued = [];
    for (const { name, message, from } of pending) {
      for (const peer of this.channels.get(name) ?? []) {
        if (peer !== from) peer.onmessage?.({ data: structuredClone(message) });
      }
    }
  }

  deliverPhases(phases) {
    const byPhase = new Map(this.queued.map((entry) => [entry.message.phase, entry]));
    for (const phase of phases) {
      const entry = byPhase.get(phase);
      assert.ok(entry, `missing queued ${phase} broadcast`);
      for (const peer of this.channels.get(entry.name) ?? []) {
        if (peer !== entry.from) peer.onmessage?.({ data: structuredClone(entry.message) });
      }
    }
  }
}

const uniquePermutations = (values) => {
  const permutations = new Map();
  const visit = (remaining, prefix = []) => {
    if (remaining.length === 0) {
      permutations.set(prefix.join(','), prefix);
      return;
    }
    for (let index = 0; index < remaining.length; index += 1) {
      visit(
        [...remaining.slice(0, index), ...remaining.slice(index + 1)],
        [...prefix, remaining[index]],
      );
    }
  };
  visit(values);
  return [...permutations.values()];
};

// Boundary mock that records every write so the test can prove a value was
// never exposed, not merely that it is gone by the time we look.
const makeRuntime = () => {
  const writesByKey = new Map();
  return {
    writesByKey,
    createContractMockQueryBoundary(initialRows) {
      const rows = new Map(Object.entries(initialRows));
      const listeners = new Map();
      for (const [key, value] of rows) {
        if (!writesByKey.has(key)) writesByKey.set(key, []);
        writesByKey.get(key).push(structuredClone(value));
      }
      return {
        current: (key) => rows.get(key) ?? [],
        query: (key, project = (value) => value) => project(rows.get(key) ?? []),
        write(key, update) {
          const next = update(rows.get(key) ?? []);
          rows.set(key, next);
          if (!writesByKey.has(key)) writesByKey.set(key, []);
          writesByKey.get(key).push(structuredClone(next));
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
          observer({ status: 'ready', rows: options.queries[name](args, boundary) });
          const boundaryKey = name === 'listTodos' ? 'todos' : name;
          const off = boundary.subscribe(boundaryKey, (rows) => {
            observer({ status: 'ready', rows });
          });
          return { dispose: off };
        },
      };
    },
    createProviderQueryHandle() {
      return { dispose() {} };
    },
    createProviderEphemeralHandle() {
      return { dispose() {} };
    },
    mount() {
      return { dispose() {} };
    },
  };
};

const manifest = {
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  schemaVersion: 'snapback.v0',
  inputsHash: 'missed-wakeup-inputs',
  schemaHash: 'missed-wakeup-schema',
  bundleHash: 'missed-wakeup-bundle',
  capabilities: {},
  queries: {
    listTodos: {
      name: 'listTodos',
      mode: 'live',
      defaultLive: true,
      reads: ['todos'],
    },
  },
  mutations: {
    changeTodo: { name: 'changeTodo' },
  },
};

const buildFixture = async ({ broadcastChannelFactory, firstIncarnation }) => {
  const state = { custody: {} };
  const coordinator = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory,
    hintStorage: null,
  });
  const captureA = await coordinator.establishAnonymous(anonymous(firstIncarnation));
  // A second context over the same durable custody. It owns transitions the
  // first context does not hear about (its wakeups are lost or delayed).
  const writer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory,
    hintStorage: null,
  });
  await writer.synchronize();

  const tagged = new WeakMap();
  const tag = (value, capture) => {
    if (value && typeof value === 'object') tagged.set(value, capture);
    return value;
  };
  const controls = {
    nextLive: null,
    liveCallbacks: [],
    liveSequence: 0,
    mutationCalls: [],
  };
  const makeHandle = (capture, label) => {
    const rows = tag([{ _id: label, title: label }], capture);
    return tag({
      rows,
      version: controls.liveSequence += 1,
      connection: 'live',
      dispose() {},
    }, capture);
  };
  const client = {
    authCoordinator: coordinator,
    async authSession() {},
    captureAuthority: () => coordinator.capture(),
    authorityCaptureFor: (value) => tagged.get(value) ?? null,
    registerAuthBarrierParticipant(participant) {
      return coordinator.registerParticipant(participant);
    },
    liveQuery(_name, options) {
      const capture = coordinator.capture();
      controls.liveCallbacks.push({ capture, onUpdate: options.onUpdate });
      if (controls.nextLive) {
        const waiting = controls.nextLive;
        controls.nextLive = null;
        return waiting.promise.then((label) => makeHandle(capture, label));
      }
      return Promise.resolve(makeHandle(capture, `snapshot-${capture.authorityEpoch}`));
    },
    query() {
      const capture = coordinator.capture();
      return Promise.resolve(tag({ rows: [{ _id: `query-${capture.authorityEpoch}` }] }, capture));
    },
    mutate(name, request) {
      const capture = coordinator.capture();
      controls.mutationCalls.push({ name, request, capture });
      return Promise.resolve(tag({ ok: true }, capture));
    },
  };

  const runtime = makeRuntime();
  const surface = await createSnapbackContractSurface({
    runtime,
    client,
    userId: null,
    manifest,
    queryName: 'listTodos',
    boundaryKey: 'todos',
    artifactIndex: { appId: APP },
    schemaManifest: { schemaHash: manifest.schemaHash, targetProfile: 'local-dev-sqlite-ibex' },
  });
  return { coordinator, writer, captureA, surface, runtime, controls, tag };
};

// --- Lost wakeups: broadcastChannelFactory is null in both contexts. ---
{
  const { coordinator, writer, captureA, surface, runtime, controls, tag } = await buildFixture({
    broadcastChannelFactory: null,
    firstIncarnation: INC_A,
  });

  // A pre-transition observer sees the initial snapshot once the initial
  // durable confirmation completes (nothing changed, so it flows through).
  const earlyCells = [];
  const earlySubscription = surface.provider.subscribe('listTodos', {}, (cell) => earlyCells.push(cell));
  await waitFor(() => earlyCells.length > 0);
  assert.deepEqual(rowIds(earlyCells.at(-1).rows), ['snapshot-0']);
  assert.deepEqual(rowIds(surface.boundary.current('todos')), ['snapshot-0']);

  // Another context durably settles A -> B. This context misses every wakeup
  // and still reports A as current in memory: that hint must not authorize
  // any further publication.
  const oldLive = controls.liveCallbacks[0];
  controls.nextLive = deferred();
  const heldSuccessorLive = controls.nextLive;
  const captureB = await writer.transition(captureA, anonymous(INC_B), 'test-missed-a-to-b');
  assert.equal(coordinator.isCurrent(captureA), true, 'in-memory hint is stale by design here');

  // Mutation start is a mandatory durable gate too. The missed wakeup is
  // discovered before generic-client transport dispatch, and the predecessor
  // surface is blanked while successor resume remains held below.
  await assert.rejects(
    surface.links.changeTodo({ id: 'must-not-dispatch-under-a' }),
    { code: 'SNAPBACK_CLIENT_AUTHORITY_STALE' },
  );
  assert.equal(controls.mutationCalls.length, 0);
  await waitFor(() => surface.boundary.current('todos').length === 0);
  assert.equal(coordinator.isCurrent(captureA), false, 'durable mutation preflight adopted the successor');

  // Delayed public callback delivery after the cut remains harmless.
  oldLive.onUpdate(tag([{ _id: 'late-live-a' }], oldLive.capture), { version: 99 });
  const todoWrites = runtime.writesByKey.get('todos') ?? [];
  assert.equal(
    todoWrites.some((rows) => rowIds(rows).includes('late-live-a')),
    false,
    'a stale A update must never reach the boundary',
  );

  // Initial provider publication for a new observer waits for the durable
  // reload: no cell is delivered synchronously from the stale boundary.
  const lateCells = [];
  const lateSubscription = surface.provider.subscribe('listTodos', {}, (cell) => lateCells.push(cell));
  assert.equal(lateCells.length, 0, 'initial publication may not use the in-memory hint alone');

  // Mount refuses while the surface is blanked/paused for the successor.
  assert.throws(() => surface.mount({}), { code: 'SNAPBACK_CLIENT_AUTHORITY_STALE' });
  // Foreground resume reloads durable custody and refuses stale replay.
  await assert.rejects(surface.reconnect(), { code: 'SNAPBACK_CLIENT_AUTHORITY_STALE' });

  // The successor snapshot lands; observers resume with B data only.
  heldSuccessorLive.resolve('snapshot-b');
  await waitFor(() => rowIds(surface.boundary.current('todos')).includes('snapshot-b'));
  await surface.flush();
  assert.deepEqual(rowIds(surface.boundary.current('todos')), ['snapshot-b']);
  await waitFor(() => lateCells.length > 0 && rowIds(lateCells.at(-1).rows).includes('snapshot-b'));
  const lateSawPredecessor = lateCells.some((cell) => (
    rowIds(cell.rows).includes('snapshot-0') || rowIds(cell.rows).includes('late-live-a')
  ));
  assert.equal(lateSawPredecessor, false, 'the late observer never receives A data');
  const earlySawLateA = earlyCells.some((cell) => rowIds(cell.rows).includes('late-live-a'));
  assert.equal(earlySawLateA, false);
  assert.deepEqual(rowIds(earlyCells.at(-1).rows), ['snapshot-b']);
  assert.equal(captureB.authorityEpoch, 1);

  // Mount succeeds again once the successor is exposed.
  const handle = surface.mount({ compiled: true });
  handle.dispose();

  earlySubscription.dispose();
  lateSubscription.dispose();
  await surface.dispose();
  await coordinator.close();
  await writer.close();
}

// --- Delayed wakeups: a BroadcastChannel exists but delivers late. The gates
// must not wait for it, and the late (stale) delivery must be harmless. ---
{
  const hub = new DeferredBroadcastHub();
  const { coordinator, writer, captureA, surface, runtime, controls } = await buildFixture({
    broadcastChannelFactory: hub.factory,
    firstIncarnation: INC_C,
  });
  hub.queued = []; // Drop bootstrap-era messages; the transition is what matters.

  controls.nextLive = deferred();
  const heldSuccessorLive = controls.nextLive;
  const captureB = await writer.transition(captureA, anonymous(INC_D), 'test-delayed-a-to-b');
  assert.equal(coordinator.isCurrent(captureA), true, 'wakeup is still queued, hint is stale');
  assert.equal(hub.queued.length > 0, true, 'the transition queued undelivered wakeups');

  // A new observer's initial publication reloads durable custody instead of
  // waiting for the delayed wakeup, and therefore never sees A data.
  const lateCells = [];
  const lateSubscription = surface.provider.subscribe('listTodos', {}, (cell) => lateCells.push(cell));
  assert.equal(lateCells.length, 0);
  await waitFor(() => surface.boundary.current('todos').length === 0);
  assert.equal(coordinator.isCurrent(captureA), false);

  heldSuccessorLive.resolve('snapshot-delayed-b');
  await waitFor(() => rowIds(surface.boundary.current('todos')).includes('snapshot-delayed-b'));
  await surface.flush();

  // The delayed wakeups finally arrive; they are older than the adopted
  // durable record and must be ignored without disturbing the successor.
  hub.flush();
  await surface.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(rowIds(surface.boundary.current('todos')), ['snapshot-delayed-b']);
  const lateSawPredecessor = lateCells.some((cell) => rowIds(cell.rows).includes('snapshot-0'));
  assert.equal(lateSawPredecessor, false, 'the delayed-wakeup observer never receives A data');
  const todoWrites = runtime.writesByKey.get('todos') ?? [];
  assert.equal(
    todoWrites.some((rows) => rowIds(rows).includes('snapshot-0') && rows.length > 0)
      && rowIds(surface.boundary.current('todos')).includes('snapshot-0'),
    false,
  );
  assert.equal(captureB.authorityEpoch, 1);

  lateSubscription.dispose();
  await surface.dispose();
  await coordinator.close();
  await writer.close();
}

// --- Multi-live mutation parity: unlike the single-query path, this mode has
// no optimistic publication comparison before transport. Its explicit durable
// preflight must still discover a lost wakeup and refuse generic-client
// dispatch under the predecessor capture. ---
{
  const state = { custody: {} };
  const appId = `${APP}/multi-mutation-preflight`;
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const captureA = await coordinator.establishAnonymous(anonymous(INC_A));
  const writer = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await writer.synchronize();

  const tagged = new WeakMap();
  const tag = (value, capture) => {
    if (value && typeof value === 'object') tagged.set(value, capture);
    return value;
  };
  let mutationCalls = 0;
  const client = {
    authCoordinator: coordinator,
    captureAuthority: () => coordinator.capture(),
    authorityCaptureFor: (value) => tagged.get(value) ?? null,
    query() {
      const capture = coordinator.capture();
      return Promise.resolve(tag({
        rows: [{ _id: `multi-${capture.authorityEpoch}` }],
      }, capture));
    },
    mutate() {
      mutationCalls += 1;
      const capture = coordinator.capture();
      return Promise.resolve(tag({ ok: true }, capture));
    },
  };
  const runtime = makeRuntime();
  const surface = await createSnapbackContractSurface({
    runtime,
    client,
    userId: null,
    manifest,
    livePush: false,
    liveQueries: ['listTodos'],
    artifactIndex: { appId },
  });

  await writer.transition(captureA, anonymous(INC_B), 'multi-mutation-missed-wakeup');
  assert.equal(coordinator.isCurrent(captureA), true);
  await assert.rejects(
    surface.links.changeTodo({ id: 'multi-must-not-dispatch-under-a' }),
    { code: 'SNAPBACK_CLIENT_AUTHORITY_STALE' },
  );
  assert.equal(mutationCalls, 0);
  assert.equal(coordinator.isCurrent(captureA), false);
  assert.equal(
    (runtime.writesByKey.get('listTodos') ?? []).some((rows) => rows.length === 0),
    true,
    'multi-live predecessor boundary was blanked by the mandatory reload',
  );

  await surface.flush();
  await surface.dispose();
  await coordinator.close();
  await writer.close();
}

// @ref LLP 0059#coordinator-and-two-context-races — exhaust the meaningful
// clearing/settled wakeup schedules: either message may be dropped, delayed,
// reversed, or duplicated in every unique two-of-each ordering. Broadcast is
// never authority; the lifecycle gate converges from the settled durable row.
{
  const deliveryPlans = [
    [],
    ['clearing'],
    ['settled'],
    ['clearing', 'settled'],
    ['settled', 'clearing'],
    ...uniquePermutations(['clearing', 'clearing', 'settled', 'settled']),
  ];
  for (const [index, plan] of deliveryPlans.entries()) {
    const state = { custody: {} };
    const hub = new DeferredBroadcastHub();
    const appId = `${APP}/broadcast-matrix/${index}`;
    const writer = new AuthCoordinator({
      appId,
      storage: createMemoryAuthCustodyStorage({ state }),
      broadcastChannelFactory: hub.factory,
      hintStorage: null,
    });
    const captureA = await writer.establishAnonymous(anonymous(INC_A));
    const receiver = new AuthCoordinator({
      appId,
      storage: createMemoryAuthCustodyStorage({ state }),
      broadcastChannelFactory: hub.factory,
      hintStorage: null,
    });
    await receiver.synchronize();
    hub.queued = [];

    const captureB = await writer.transition(
      captureA,
      anonymous(INC_B),
      `broadcast_matrix_${index}`,
    );
    assert.deepEqual(
      [...new Set(hub.queued.map((entry) => entry.message.phase))].sort(),
      ['clearing', 'settled'],
      'one transition emits both secret-free wakeup phases',
    );
    hub.deliverPhases(plan);
    const adopted = await receiver.synchronize();
    assert.equal(adopted.authorityEpoch, captureB.authorityEpoch, plan.join(' -> ') || 'drop all');
    assert.equal(
      receiver.settledView().authority.authorizationStreamIncarnation,
      INC_B,
      plan.join(' -> ') || 'drop all',
    );
    assert.equal(receiver.isCurrent(captureA), false, plan.join(' -> ') || 'drop all');
    await receiver.close();
    await writer.close();
  }
}

console.log('auth-coordinator-missed-wakeup.test.mjs: all assertions passed');
