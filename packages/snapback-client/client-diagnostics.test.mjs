import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  attachOutboxDiagnosticsProducer,
  createClientDiagnosticsChannel,
  createClientDevConsoleReporter,
  positiveDevelopmentEnvironment,
  projectDiagnosticV1,
} from './client-diagnostics.mjs';
import { SnapbackClient as InspectingSnapbackClient } from './index.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';

class SnapbackClient extends InspectingSnapbackClient {
  constructor(baseUrl, options = {}) {
    super(baseUrl, {
      __offlineMutationReplayCapability: true,
      __outboxDrainLifecycle: false,
      ...options,
    });
  }
}

const event = (overrides = {}) => ({
  schemaVersion: 'snapback.client-diagnostic.v2',
  code: 'SNAPBACK_REACT_SUBSCRIPTION_CHURN',
  severity: 'warning',
  subsystem: 'react',
  message: 'Subscription stability rule violated: stabilize changing inputs; see guide/clients/react.md#use-inline-hook-inputs-without-subscription-churn.',
  details: { transitionCount: 8, windowMs: 2_000 },
  site: 'useSnapbackQuery@app/routes/home.tsx:42',
  ...overrides,
});

const durableMemoryStore = (options = {}) => {
  const store = createMemoryRqsResumeStore(options);
  store.durability = () => ({ implementation: 'diagnostics-test', durable: true });
  return store;
};

const testConsole = () => {
  const warn = [];
  const error = [];
  return {
    warn,
    error,
    console: {
      warn: (line) => warn.push(line),
      error: (line) => error.push(line),
    },
  };
};

const flushDiagnostics = async () => {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

function fakeClock(startAtMs = 1_000) {
  let nowMs = startAtMs;
  let nextHandle = 0;
  const timers = new Map();
  const cleared = [];
  return {
    now: () => nowMs,
    setTimeout(fn, delayMs) {
      nextHandle += 1;
      timers.set(nextHandle, { fn, dueAtMs: nowMs + delayMs, delayMs });
      return nextHandle;
    },
    clearTimeout(handle) {
      cleared.push(handle);
      timers.delete(handle);
    },
    timers,
    cleared,
    async fireNext() {
      const next = [...timers.entries()]
        .sort((left, right) => left[1].dueAtMs - right[1].dueAtMs)[0];
      assert.ok(next, 'expected an armed diagnostics deadline');
      const [handle, timer] = next;
      timers.delete(handle);
      nowMs = timer.dueAtMs;
      timer.fn();
      await flushDiagnostics();
    },
  };
}

function restoreNodeEnvironment(previous) {
  if (previous === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
}

test('history ring stays bounded and accounts for overwritten events', () => {
  let nowMs = 1_000;
  const channel = createClientDiagnosticsChannel({
    historyLimit: 2,
    cooldownMs: 0,
    now: () => nowMs,
  });
  channel.emit(event({ site: 'site-a' }));
  nowMs += 1;
  channel.emit(event({ site: 'site-b' }));
  nowMs += 1;
  channel.emit(event({ site: 'site-c' }));

  const snapshot = channel.snapshot();
  assert.deepEqual(snapshot.events.map((entry) => entry.site), ['site-b', 'site-c']);
  assert.deepEqual(snapshot.counters, { emitted: 3, coalesced: 0, dropped: 1 });
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.events));
  assert.ok(Object.isFrozen(snapshot.counters));
  assert.ok(snapshot.events.every(Object.isFrozen));
});

test('same code and site coalesce inside cooldown while a different site appends', () => {
  let nowMs = 5_000;
  const channel = createClientDiagnosticsChannel({
    cooldownMs: 100,
    now: () => nowMs,
  });
  channel.emit(event({ details: { transitionCount: 8 } }));
  nowMs += 50;
  channel.emit(event({ details: { transitionCount: 9 } }));

  let snapshot = channel.snapshot();
  assert.equal(snapshot.events.length, 1);
  assert.deepEqual(snapshot.events[0].occurrence, {
    firstAtMs: 5_000,
    lastAtMs: 5_050,
    count: 2,
  });
  assert.deepEqual(snapshot.counters, { emitted: 2, coalesced: 1, dropped: 0 });

  nowMs += 1;
  channel.emit(event({ site: 'useSnapbackQuery@app/routes/other.tsx:12' }));
  snapshot = channel.snapshot();
  assert.equal(snapshot.events.length, 2);
  assert.deepEqual(snapshot.counters, { emitted: 3, coalesced: 1, dropped: 0 });
});

test('details normalization structurally excludes payloads and unsafe values', () => {
  const channel = createClientDiagnosticsChannel({ cooldownMs: 0 });
  const error = new Error('transport unavailable');
  error.code = 'SNAPBACK_TRANSPORT_UNAVAILABLE';
  channel.emit(event({
    details: {
      scalar: true,
      long: 'x'.repeat(700),
      array: Object.freeze(['safe', 3, false, null, { hidden: 'value' }]),
      nested: { queueDepth: 2, timing: { ageMs: 30, deeper: { raw: 'hidden' } } },
      deep: { level1: { level2: { level3: 'never' } } },
      fn: () => 'raw',
      promise: Promise.resolve('raw'),
      error,
      mutationArgs: { title: 'RAW_MUTATION_SENTINEL', credential: 'secret' },
      rawMutationArgs: { title: 'RAW_MUTATION_SENTINEL' },
      payload: { title: 'RAW_MUTATION_SENTINEL' },
      presenceValue: { cursor: 'RAW_MUTATION_SENTINEL' },
      credentials: { token: 'RAW_MUTATION_SENTINEL' },
      authToken: 'RAW_MUTATION_SENTINEL',
      apiKey: 'RAW_MUTATION_SENTINEL',
      hashedCanonicalInputIdentity: 'sha256:payload-safe-identity',
    },
  }));

  const details = channel.snapshot().events[0].details;
  assert.equal(details.scalar, true);
  assert.equal(details.long.length, 512);
  assert.deepEqual(details.array, ['safe', 3, false, null, '[Object]']);
  assert.deepEqual(details.nested, { queueDepth: 2, timing: '[Object]' });
  assert.deepEqual(details.deep, { level1: '[Object]' });
  assert.deepEqual(details.error, {
    code: 'SNAPBACK_TRANSPORT_UNAVAILABLE',
    message: 'transport unavailable',
  });
  assert.equal(Object.hasOwn(details, 'fn'), false);
  assert.equal(Object.hasOwn(details, 'promise'), false);
  assert.equal(Object.hasOwn(details, 'mutationArgs'), false);
  assert.equal(Object.hasOwn(details, 'rawMutationArgs'), false);
  assert.equal(Object.hasOwn(details, 'payload'), false);
  assert.equal(Object.hasOwn(details, 'presenceValue'), false);
  assert.equal(Object.hasOwn(details, 'credentials'), false);
  assert.equal(Object.hasOwn(details, 'authToken'), false);
  assert.equal(Object.hasOwn(details, 'apiKey'), false);
  assert.equal(details.hashedCanonicalInputIdentity, 'sha256:payload-safe-identity');
  assert.doesNotMatch(JSON.stringify(details), /RAW_MUTATION_SENTINEL/u);
  assert.ok(Object.isFrozen(details));
  assert.ok(Object.isFrozen(details.array));
  assert.ok(Object.isFrozen(details.nested));
  assert.ok(Object.isFrozen(details.error));
});

test('active conditions update and clear independently from history', () => {
  let nowMs = 10_000;
  const channel = createClientDiagnosticsChannel({
    historyLimit: 1,
    activeConditionLimit: 2,
    cooldownMs: 0,
    now: () => nowMs,
  });
  channel.emit(event({ site: 'history-only' }));
  channel.setActiveCondition('queue-head:mut_1', event({
    code: 'SNAPBACK_REACT_MUTATION_QUEUE_WEDGED',
    subsystem: 'outbox',
    site: 'queue-head:mut_1',
    details: { queueDepth: 2, ageMs: 30_000 },
  }));
  nowMs += 500;
  channel.setActiveCondition('queue-head:mut_1', event({
    code: 'SNAPBACK_REACT_MUTATION_QUEUE_WEDGED',
    subsystem: 'outbox',
    site: 'queue-head:mut_1',
    details: { queueDepth: 3, ageMs: 30_500 },
  }));

  let snapshot = channel.snapshot();
  assert.equal(snapshot.events.length, 1, 'active updates never consume ring capacity');
  assert.equal(snapshot.events[0].site, 'history-only');
  assert.equal(snapshot.activeConditions['queue-head:mut_1'].occurrence.count, 2);
  assert.equal(snapshot.activeConditions['queue-head:mut_1'].details.queueDepth, 3);
  assert.ok(Object.isFrozen(snapshot.activeConditions));
  assert.equal(channel.clearActiveCondition('queue-head:mut_1'), true);
  assert.equal(channel.clearActiveCondition('queue-head:mut_1'), false);
  snapshot = channel.snapshot();
  assert.deepEqual(snapshot.activeConditions, {});
  assert.equal(snapshot.events.length, 1);

  channel.setActiveCondition('queue-head:mut_2', event({ site: 'queue-head:mut_2' }));
  channel.setActiveCondition('queue-head:mut_3', event({ site: 'queue-head:mut_3' }));
  channel.setActiveCondition('queue-head:mut_4', event({ site: 'queue-head:mut_4' }));
  snapshot = channel.snapshot();
  assert.deepEqual(Object.keys(snapshot.activeConditions), [
    'queue-head:mut_3',
    'queue-head:mut_4',
  ]);
  assert.equal(snapshot.counters.dropped, 1, 'active-condition eviction is explicit');
  assert.equal(snapshot.events.length, 1, 'condition eviction does not touch history');
});

test('v2 error projection is exact and v2 warnings are filtered from frozen v1', () => {
  const channel = createClientDiagnosticsChannel({ cooldownMs: 0 });
  const errorEvent = channel.emit(event({
    code: 'SNAPBACK_OFFLINE_MUTATION_QUEUE_REFUSED',
    severity: 'error',
    subsystem: 'outbox',
    message: 'Outbox custody rule violated: retry after authority settles; see guide/sync/offline-and-retention.md#enable-the-complete-client-store-contract.',
  }));
  const warningEvent = channel.emit(event());

  assert.match(errorEvent.message, /rule violated/u);
  assert.match(errorEvent.message, /guide\/sync\/offline-and-retention\.md#/u);
  assert.deepEqual(projectDiagnosticV1(errorEvent), {
    schemaVersion: 'snapback.client-diagnostic.v1',
    severity: 'error',
    code: 'SNAPBACK_OFFLINE_MUTATION_QUEUE_REFUSED',
    message: errorEvent.message,
    details: errorEvent.details,
  });
  assert.equal(projectDiagnosticV1(warningEvent), null);
  assert.equal(projectDiagnosticV1({ ...errorEvent, schemaVersion: 'snapback.client-diagnostic.v1' }), null);
  assert.ok(channel.snapshot().events.every(
    (entry) => entry.schemaVersion === 'snapback.client-diagnostic.v2',
  ));
  assert.throws(
    () => channel.emit({ ...event(), schemaVersion: 'snapback.client-diagnostic.v1' }),
    /must use snapback\.client-diagnostic\.v2/u,
  );
});

test('the single deadline scheduler re-arms and dispose cancels its only handle', () => {
  let nowMs = 0;
  let nextHandle = 0;
  const timers = new Map();
  const cleared = [];
  const fired = [];
  const channel = createClientDiagnosticsChannel({
    now: () => nowMs,
    setTimeout(fn, delayMs) {
      nextHandle += 1;
      timers.set(nextHandle, { fn, delayMs });
      return nextHandle;
    },
    clearTimeout(handle) {
      cleared.push(handle);
      timers.delete(handle);
    },
  });

  channel.emit(event());
  assert.equal(timers.size, 0, 'ordinary emission owns no timer');
  channel.scheduleDeadline(100, () => fired.push('old'));
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delayMs, 100);
  channel.scheduleDeadline(40, () => fired.push('replacement'));
  assert.deepEqual(cleared, [1]);
  assert.equal(timers.size, 1, 're-arm replaces instead of duplicates');
  assert.equal([...timers.values()][0].delayMs, 40);

  nowMs = 40;
  const replacement = timers.get(2);
  timers.delete(2);
  replacement.fn();
  assert.deepEqual(fired, ['replacement']);

  channel.scheduleDeadline(90, () => fired.push('leaked'));
  assert.equal(timers.size, 1);
  channel.dispose();
  assert.equal(timers.size, 0);
  assert.deepEqual(cleared, [1, 3]);
  assert.deepEqual(channel.snapshot().activeConditions, {});
  channel.scheduleDeadline(100, () => fired.push('disposed'));
  assert.equal(timers.size, 0);
});

test('uncovered-range queued transition arms one wedge and one deduplicated line with status facts', async () => {
  const clock = fakeClock(10_000);
  const output = testConsole();
  const channel = createClientDiagnosticsChannel({
    cooldownMs: 0,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  let fact = {
    head: null,
    pending: 0,
    oldestPendingAtMs: null,
    blockedReason: null,
    drainPhase: 'idle',
    nextRetryAtMs: null,
  };
  let outboxListener = null;
  const producer = attachOutboxDiagnosticsProducer({
    channel,
    subscribeOutbox(listener) {
      outboxListener = listener;
      return () => { outboxListener = null; };
    },
    readHeadFact: async () => fact,
    queuedMutationWedgeWarningMs: 25,
    now: clock.now,
  });
  const reporter = createClientDevConsoleReporter(channel, { console: output.console });

  try {
    await flushDiagnostics();
    assert.equal(clock.timers.size, 0, 'startup sees no durable head');

    fact = {
      head: {
        clientMutationId: 'mut_uncovered',
        sequence: 7,
        status: 'pending',
        function: 'createThing',
        enqueuedAtMs: 9_950,
      },
      pending: 1,
      oldestPendingAtMs: 8_000,
      blockedReason: 'not-writer',
      drainPhase: 'idle',
      nextRetryAtMs: null,
    };
    channel.emit(event({
      code: 'SNAPBACK_OPERATION_RANGE_UNCOVERED_QUEUED',
      subsystem: 'outbox',
      details: { clientMutationId: 'mut_uncovered', mutation: 'createThing' },
      site: 'createThing',
    }));
    channel.emit(event({
      code: 'SNAPBACK_REACT_MUTATION_QUEUED',
      subsystem: 'react',
      details: { clientMutationId: 'mut_uncovered', mutation: 'createThing' },
      site: 'createThing',
    }));
    await flushDiagnostics();

    assert.equal(clock.timers.size, 1, 'the landed RANGE transition arms the wedge');
    assert.equal([...clock.timers.values()][0].delayMs, 25);
    assert.equal(output.warn.length, 1, 'the queued compatibility pair prints once');
    assert.match(output.warn[0], /SNAPBACK_OPERATION_RANGE_UNCOVERED_QUEUED/u);
    assert.equal(output.error.length, 0);
    assert.equal(
      channel.snapshot().events.some(
        (entry) => entry.code === 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
      ),
      false,
      'the RANGE transition does not synthesize the canonical code',
    );

    await clock.fireNext();
    let conditions = channel.snapshot().activeConditions;
    const [conditionKey] = Object.keys(conditions);
    assert.equal(conditionKey, 'queue-head:mut_uncovered:7');
    assert.equal(
      conditions[conditionKey].details.oldestPendingAgeMs,
      2_025,
      'status-level oldestPendingAtMs wins over the newer head timestamp',
    );
    assert.equal(conditions[conditionKey].details.blockedReason, 'not-writer');
    assert.equal(conditions[conditionKey].details.drainPhase, 'idle');
    assert.equal(conditions[conditionKey].details.nextRetryAtMs, null);
    assert.match(conditions[conditionKey].message, /not-writer/u);
    assert.match(conditions[conditionKey].message, /another tab\/process owns the queue/u);
    assert.match(output.warn.at(-1), /another tab\/process owns the queue/u);

    fact = { ...fact, blockedReason: 'custody-unsettled' };
    outboxListener();
    await flushDiagnostics();
    conditions = channel.snapshot().activeConditions;
    assert.equal(conditions[conditionKey].details.blockedReason, 'custody-unsettled');
    assert.match(conditions[conditionKey].message, /custody must reconcile first/u);
  } finally {
    producer.dispose();
    reporter.dispose();
    channel.dispose();
  }
});

test('SnapbackClient bridges queued outbox diagnostics into its owned v2 channel', async () => {
  const originalFetch = globalThis.fetch;
  const store = createMemoryRqsResumeStore();
  store.durability = () => ({ implementation: 'diagnostics-test', durable: true });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  const channel = client.diagnosticsChannel();
  try {
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const queued = await client.mutate('createThing', {
      args: { title: 'RAW_CLIENT_MUTATION_ARGUMENT' },
    });
    assert.equal(queued.status, 'queued');
    assert.equal(client.outboxDiagnostics.at(-1).code, 'SNAPBACK_OFFLINE_MUTATION_QUEUED');

    const bridged = channel.snapshot().events.find(
      (entry) => entry.code === 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
    );
    assert.equal(bridged.schemaVersion, 'snapback.client-diagnostic.v2');
    assert.equal(bridged.severity, 'warning');
    assert.equal(bridged.subsystem, 'outbox');
    assert.equal(bridged.details.mutation, 'createThing');
    assert.equal(bridged.details.sequence, 1);
    assert.doesNotMatch(JSON.stringify(bridged), /RAW_CLIENT_MUTATION_ARGUMENT/u);

    await client.closeAuth();
    const countersBeforeDisposedEmit = channel.snapshot().counters;
    assert.equal(channel.emit(event()), null, 'client close disposes its channel');
    assert.deepEqual(channel.snapshot().counters, {
      emitted: countersBeforeDisposedEmit.emitted + 1,
      coalesced: countersBeforeDisposedEmit.coalesced,
      dropped: countersBeforeDisposedEmit.dropped + 1,
    });
  } finally {
    globalThis.fetch = originalFetch;
    await client.closeAuth();
  }
});

test('SnapbackClient bridges uncovered-range queued diagnostics as warnings', async () => {
  const originalFetch = globalThis.fetch;
  const client = new SnapbackClient('https://operation-range-diagnostics.example', {
    rqsStore: durableMemoryStore(),
    operationIdentityProtocol: 1,
    devDiagnosticsReporter: false,
  });
  try {
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const queued = await client.mutate('createThing', {
      args: { title: 'RAW_UNCOVERED_RANGE_ARGUMENT' },
      userId: 'user-a',
    });
    assert.equal(queued.status, 'queued');
    assert.equal(queued.operationCoverageDisposition, 'uncovered-range-exhausted');

    // @ref LLP 0219#producers-pilot-scoped-detectors — LLP 0218 §4.4's landed
    // relinquishment helper emits the CANONICAL queued code for every
    // foreground relinquishment (including uncovered range, with its reason
    // class); the record-cut bridge never adds a second queued channel event,
    // so the RANGE code stays in the outbox ring only.
    const bridged = client.diagnosticsChannel().snapshot().events.find(
      (entry) => entry.code === 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
    );
    assert.equal(bridged.severity, 'warning');
    assert.equal(bridged.subsystem, 'outbox');
    assert.equal(bridged.details.clientMutationId, queued.clientMutationId);
    assert.equal(typeof bridged.details.queueReasonClass, 'string');
    assert.doesNotMatch(JSON.stringify(bridged), /RAW_UNCOVERED_RANGE_ARGUMENT/u);
    assert.equal(
      client.diagnosticsChannel().snapshot().events.some(
        (entry) => entry.code === 'SNAPBACK_OPERATION_RANGE_UNCOVERED_QUEUED',
      ),
      false,
    );
    assert.ok(
      client.outboxDiagnostics.some(
        (entry) => entry.code === 'SNAPBACK_OPERATION_RANGE_UNCOVERED_QUEUED',
      ),
      'the range fact stays on the bounded outbox ring',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await client.closeAuth();
  }
});

test('positive dev gating enables the default reporter and production absence stays silent', async () => {
  const originalFetch = globalThis.fetch;
  const previousNodeEnvironment = process.env.NODE_ENV;
  let devClient = null;
  let productionClient = null;
  try {
    delete process.env.NODE_ENV;
    assert.equal(positiveDevelopmentEnvironment(), false);

    process.env.NODE_ENV = 'development';
    assert.equal(positiveDevelopmentEnvironment(), true);
    const devOutput = testConsole();
    devClient = new SnapbackClient('http://127.0.0.1:9', {
      rqsStore: durableMemoryStore(),
      __devDiagnosticsReporterOptions: { console: devOutput.console },
    });
    restoreNodeEnvironment(previousNodeEnvironment);
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const queued = await devClient.mutate('createThing', {
      args: { title: 'RAW_DEV_REPORTER_ARGUMENT' },
    });
    assert.equal(queued.status, 'queued');
    assert.equal(devOutput.warn.length, 1);
    assert.match(devOutput.warn[0], /QUEUED — ACTION REQUIRED/u);
    assert.match(devOutput.warn[0], /SNAPBACK_OFFLINE_MUTATION_QUEUED/u);
    assert.match(devOutput.warn[0], /useSnapbackOutbox\(\)\.drainNow\(\)/u);
    assert.match(devOutput.warn[0], /guide\/sync\/offline-and-retention\.md#/u);
    assert.doesNotMatch(devOutput.warn[0], /RAW_DEV_REPORTER_ARGUMENT/u);

    // The compatibility projection is a second structured event, but the
    // reporter's clientMutationId key makes it the same console occurrence.
    devClient.diagnosticsChannel().emit({
      code: 'SNAPBACK_REACT_MUTATION_QUEUED',
      severity: 'warning',
      subsystem: 'react',
      message: 'Compatibility queued projection; see guide/sync/offline-and-retention.md.',
      details: { clientMutationId: queued.clientMutationId, mutation: 'createThing' },
      site: 'createThing',
    });
    assert.equal(devOutput.warn.length, 1, 'queued compatibility pair prints once');
    assert.equal(
      devClient.diagnosticsChannel().snapshot().events
        .filter((entry) => entry.code === 'SNAPBACK_OFFLINE_MUTATION_QUEUED').length,
      1,
      'the durable enqueue cut emits one canonical event',
    );

    delete process.env.NODE_ENV;
    const productionOutput = testConsole();
    productionClient = new SnapbackClient('http://127.0.0.1:9', {
      rqsStore: durableMemoryStore(),
      __devDiagnosticsReporterOptions: { console: productionOutput.console },
    });
    assert.equal(positiveDevelopmentEnvironment(), false);
    restoreNodeEnvironment(previousNodeEnvironment);
    const productionQueued = await productionClient.mutate('createThing', {
      args: { title: 'still structured' },
    });
    assert.equal(productionQueued.status, 'queued');
    assert.equal(productionOutput.warn.length, 0, 'no positive marker means no console default');
    assert.equal(productionOutput.error.length, 0);
    assert.ok(productionClient.diagnosticsChannel().snapshot().events.some(
      (entry) => entry.code === 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
    ), 'production silence does not disable the structured channel');
  } finally {
    globalThis.fetch = originalFetch;
    restoreNodeEnvironment(previousNodeEnvironment);
    await devClient?.closeAuth();
    await productionClient?.closeAuth();
  }
});

test('wedged condition is per durable head and unchanged replay notifications do not clear it', async () => {
  const originalFetch = globalThis.fetch;
  const previousNodeEnvironment = process.env.NODE_ENV;
  const clock = fakeClock();
  const output = testConsole();
  const store = durableMemoryStore({ now: clock.now });
  let client = null;
  try {
    process.env.NODE_ENV = 'development';
    client = new SnapbackClient('http://127.0.0.1:9', {
      rqsStore: store,
      queuedMutationWedgeWarningMs: 25,
      __clientDiagnosticsOptions: {
        cooldownMs: 0,
        now: clock.now,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
      },
      __devDiagnosticsReporterOptions: { console: output.console },
    });
    restoreNodeEnvironment(previousNodeEnvironment);
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const first = await client.mutate('createThing', { args: { title: 'first' } });
    await flushDiagnostics();
    assert.equal(clock.timers.size, 1);
    assert.equal([...clock.timers.values()][0].delayMs, 25);

    await clock.fireNext();
    let conditions = client.diagnosticsChannel().snapshot().activeConditions;
    let keys = Object.keys(conditions);
    assert.equal(keys.length, 1);
    assert.match(keys[0], new RegExp(first.clientMutationId, 'u'));
    assert.equal(conditions[keys[0]].details.queueDepth, 1);
    assert.equal(conditions[keys[0]].details.headSequence, 1);
    assert.equal(conditions[keys[0]].details.mutationFunction, 'createThing');
    assert.equal(conditions[keys[0]].details.oldestPendingAgeMs, 25);
    assert.equal(
      output.warn.filter((line) => line.includes('SNAPBACK_REACT_MUTATION_QUEUE_WEDGED')).length,
      1,
    );

    // A failed replay fires the outbox seam repeatedly but leaves the durable
    // head unchanged, so neither the condition nor its reporter line clears.
    await client.replayQueuedMutations();
    await flushDiagnostics();
    conditions = client.diagnosticsChannel().snapshot().activeConditions;
    assert.deepEqual(Object.keys(conditions), keys);
    assert.equal(clock.timers.size, 0, 'failed replay does not restart the head window');
    assert.equal(
      output.warn.filter((line) => line.includes('SNAPBACK_REACT_MUTATION_QUEUE_WEDGED')).length,
      1,
    );

    const second = await client.mutate('updateThing', { args: { title: 'second' } });
    await flushDiagnostics();
    conditions = client.diagnosticsChannel().snapshot().activeConditions;
    assert.equal(conditions[keys[0]].details.queueDepth, 2);
    assert.equal(clock.timers.size, 0, 'a queued successor cannot extend an active head');

    let replayCalls = 0;
    globalThis.fetch = async () => {
      replayCalls += 1;
      if (replayCalls === 1) {
        return Response.json({ result: { ok: true }, version: 1 });
      }
      throw new TypeError('successor remains offline');
    };
    await client.replayQueuedMutations();
    await flushDiagnostics();
    assert.equal(replayCalls, 2);
    assert.deepEqual(
      client.diagnosticsChannel().snapshot().activeConditions,
      {},
      'durable head advance clears the predecessor condition',
    );
    assert.equal(clock.timers.size, 1, 'pending successor gets a fresh head window');

    await clock.fireNext();
    conditions = client.diagnosticsChannel().snapshot().activeConditions;
    keys = Object.keys(conditions);
    assert.equal(keys.length, 1);
    assert.match(keys[0], new RegExp(second.clientMutationId, 'u'));
    assert.equal(conditions[keys[0]].details.headSequence, 2);
    assert.equal(
      output.warn.filter((line) => line.includes('SNAPBACK_REACT_MUTATION_QUEUE_WEDGED')).length,
      2,
      'the reporter logs once for each distinct head activation',
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreNodeEnvironment(previousNodeEnvironment);
    await client?.closeAuth();
  }
});

test('result-gone keeps the same head active and switches to acknowledge recovery', async () => {
  const originalFetch = globalThis.fetch;
  const previousNodeEnvironment = process.env.NODE_ENV;
  const clock = fakeClock(5_000);
  const output = testConsole();
  const store = durableMemoryStore({ now: clock.now });
  let client = null;
  try {
    process.env.NODE_ENV = 'development';
    client = new SnapbackClient('http://127.0.0.1:9', {
      rqsStore: store,
      queuedMutationWedgeWarningMs: 10,
      __clientDiagnosticsOptions: {
        cooldownMs: 0,
        now: clock.now,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
      },
      __devDiagnosticsReporterOptions: { console: output.console },
    });
    restoreNodeEnvironment(previousNodeEnvironment);
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const queued = await client.mutate('createThing', { args: { title: 'known outcome' } });
    await flushDiagnostics();
    await clock.fireNext();
    const [conditionKey] = Object.keys(
      client.diagnosticsChannel().snapshot().activeConditions,
    );

    await store.outboxMarkResultGone(queued.clientMutationId, {
      outcome: 'committed',
      receiptDigest: `sha256:${'e'.repeat(64)}`,
    });
    await client.replayQueuedMutations();
    await flushDiagnostics();

    const conditions = client.diagnosticsChannel().snapshot().activeConditions;
    assert.deepEqual(Object.keys(conditions), [conditionKey]);
    assert.equal(conditions[conditionKey].details.headStatus, 'result-gone');
    assert.equal(conditions[conditionKey].details.queueDepth, 0);
    assert.match(
      conditions[conditionKey].details.recoveryPath,
      /acknowledgeResultGoneMutations/u,
    );
    assert.equal(
      output.warn.filter((line) => line.includes('SNAPBACK_REACT_MUTATION_QUEUE_WEDGED')).length,
      1,
      'recovery-path refresh is not a second head activation',
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreNodeEnvironment(previousNodeEnvironment);
    await client?.closeAuth();
  }
});

test('client close clears active conditions and cancels an armed wedge deadline', async () => {
  const originalFetch = globalThis.fetch;
  const clock = fakeClock(9_000);
  const store = durableMemoryStore({ now: clock.now });
  const client = new SnapbackClient('http://127.0.0.1:9', {
    rqsStore: store,
    devDiagnosticsReporter: false,
    queuedMutationWedgeWarningMs: 50,
    __clientDiagnosticsOptions: {
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    },
  });
  const channel = client.diagnosticsChannel();
  try {
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    await client.mutate('createThing', { args: { title: 'close-before-deadline' } });
    await flushDiagnostics();
    assert.equal(clock.timers.size, 1);
    await client.closeAuth();
    assert.equal(clock.timers.size, 0);
    assert.ok(clock.cleared.length >= 1, 'channel disposal clears its timer handle');
    assert.deepEqual(channel.snapshot().activeConditions, {});
  } finally {
    globalThis.fetch = originalFetch;
    await client.closeAuth();
  }
});

console.log('snapback client diagnostics tests pass');
