import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BROKER_LIMITS, createDemandBroker, validateBrokerMessage } from './demand-broker.mjs';
import { createMemoryRqsResumeStore, createMemoryRqsStoreBacking } from './rqs-store-memory.mjs';
import { createInitialStoreMeta } from './rqs-store-meta.mjs';

const partition = (character) => `sha256:${character.repeat(64)}`;
const locks = {};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeChannelHub() {
  const endpoints = new Set();
  return {
    open() {
      const listeners = new Set();
      const endpoint = {
        postMessage(message) {
          for (const other of endpoints) {
            if (other === endpoint) continue;
            for (const listener of other.listeners) queueMicrotask(() => listener({ data: structuredClone(message) }));
          }
        },
        addEventListener(type, listener) { if (type === 'message') listeners.add(listener); },
        removeEventListener(type, listener) { if (type === 'message') listeners.delete(listener); },
        close() { endpoints.delete(endpoint); listeners.clear(); },
        listeners,
      };
      endpoints.add(endpoint);
      return endpoint;
    },
  };
}

const registration = ({ id, contextId = 'ctx', part = partition('a'), source = 'active' }) => ({
  format: 'snapback.query-registration.v1',
  registrationId: id,
  source,
  ownerContext: source === 'active'
    ? { kind: 'subscription', contextId }
    : { kind: 'api', label: null },
  functionReference: { addressKey: `qmk1.${id}`, authorityPartitionDigest: part },
  canonicalArgs: {},
  requestedScope: { kind: 'page', input: { kind: 'first' } },
  retentionRequest: 'durable',
  idleTtlClass: 'default',
});

const resolveRegistration = (entry) => ({
  addressKey: entry.functionReference.addressKey,
  authorityPartitionDigest: entry.functionReference.authorityPartitionDigest,
});

function fakeLedger() {
  const active = new Map();
  const durable = new Map();
  const calls = [];
  return {
    active, durable, calls,
    async applyContextDemands(input) {
      calls.push(['apply', structuredClone(input)]);
      active.set(`${input.contextId}:${input.authorityPartitionDigest}`, structuredClone(input.demands));
      return { applied: true };
    },
    async releaseContextDemands({ contextId }) {
      calls.push(['release-context', contextId]);
      for (const key of [...active.keys()]) if (key.startsWith(`${contextId}:`)) active.delete(key);
    },
    async registerDurable(entry) { durable.set(entry.registrationId, structuredClone(entry)); return { committed: true }; },
    async releaseDurable({ registrationId }) { durable.delete(registrationId); return { released: true }; },
    effectivePolicy() { return { retentionRequest: 'none', idleTtlClass: 'none', demandState: 'undemanded' }; },
    demandState() { return 'undemanded'; },
  };
}

function fastStoreHandle() {
  const view = {
    materializations: new Map(), pageSets: new Map(), memberships: new Map(),
    storeMeta: createInitialStoreMeta({ clientStoreId: 'fast-broker-store' }),
  };
  return {
    isWriter: () => true,
    materializationTransaction(_mode, operation) { return operation(view); },
  };
}

async function setup(t, options = {}) {
  const handle = createMemoryRqsResumeStore({ clientStoreId: 'broker-store' });
  await handle.whenLockSettled();
  t.after(() => handle.close());
  const ledger = options.ledger ?? fakeLedger();
  const broker = await createDemandBroker({
    storeHandle: handle,
    registrationLedger: ledger,
    resolveRegistration,
    lockManager: locks,
    contextId: options.contextId ?? 'writer',
    now: options.now,
    crashBeforeOutcome: options.crashBeforeOutcome,
  });
  t.after(() => broker.close());
  return { handle, ledger, broker };
}

test('closed broker records enforce UTF-8 identifier and serialized-message byte ceilings', () => {
  const part = partition('a');
  const base = {
    format: 'snapback.demand-announce.v1', contextId: 'ctx', revision: 1,
    authorityPartitionDigest: part, demands: [],
  };
  assert.equal(validateBrokerMessage({ ...base, extra: true }, { resolveRegistration }).refused.code,
    'SNAPBACK_BROKER_MESSAGE_INVALID');
  assert.equal(validateBrokerMessage({ ...base, contextId: 'é'.repeat(33) }, { resolveRegistration }).refused.code,
    'SNAPBACK_BROKER_MESSAGE_INVALID');
  const huge = registration({ id: 'huge', contextId: 'ctx', part });
  huge.canonicalArgs = { value: 'x'.repeat(BROKER_LIMITS.messageByteCeiling) };
  assert.equal(validateBrokerMessage({ ...base, demands: [huge] }, { resolveRegistration }).refused.code,
    'SNAPBACK_BROKER_MESSAGE_OVERSIZE');
});

test('full-set announces are pair-scoped, monotone, atomic, and heartbeat-reaped', async (t) => {
  let time = 1_000;
  const { handle, broker, ledger } = await setup(t, { now: () => time });
  const a = partition('a');
  const b = partition('b');
  assert.deepEqual(await broker.receive({
    format: 'snapback.demand-announce.v1', contextId: 'tab', revision: 1,
    authorityPartitionDigest: a, demands: [registration({ id: 'a1', contextId: 'tab', part: a })],
  }), { applied: true });
  await broker.receive({
    format: 'snapback.demand-announce.v1', contextId: 'tab', revision: 1,
    authorityPartitionDigest: b, demands: [registration({ id: 'b1', contextId: 'tab', part: b })],
  });
  assert.equal(ledger.active.size, 2, 'two partitions remain independently demanded');

  time += 10_000;
  const stale = await broker.receive({
    format: 'snapback.demand-announce.v1', contextId: 'tab', revision: 0,
    authorityPartitionDigest: a, demands: [],
  });
  assert.equal(stale.ignored, true);
  time += 44_000;
  await broker.maintenance();
  assert.equal(ledger.active.size, 2, 'well-formed stale revision refreshed the context heartbeat');
  time += 1_000;
  await broker.maintenance();
  assert.equal(ledger.active.size, 0);

  const ignored = await broker.receive({
    format: 'snapback.demand-announce.v1', contextId: 'tab', revision: 2,
    authorityPartitionDigest: a, demands: [registration({ id: 'late', contextId: 'tab', part: a })],
  });
  assert.equal(ignored.ignored, true, 'reaped context ids never revive');
  const restarted = await createDemandBroker({
    storeHandle: handle, registrationLedger: ledger, resolveRegistration,
    lockManager: locks, contextId: 'restarted-writer', now: () => time,
  });
  t.after(() => restarted.close());
  assert.equal((await restarted.receive({
    format: 'snapback.demand-announce.v1', contextId: 'tab', revision: 3,
    authorityPartitionDigest: a,
    demands: [registration({ id: 'restart-late', contextId: 'tab', part: a })],
  })).ignored, true, 'reaped-context memory survives writer restart');
});

test('malformed announce applies nothing and does not consume its revision', async (t) => {
  const { broker, ledger } = await setup(t);
  const part = partition('a');
  const malformed = await broker.receive({
    format: 'snapback.demand-announce.v1', contextId: 'tab', revision: 7,
    authorityPartitionDigest: part,
    demands: [
      registration({ id: 'good', contextId: 'tab', part }),
      registration({ id: 'bad', contextId: 'other', part }),
    ],
  });
  assert.equal(malformed.refused.code, 'SNAPBACK_BROKER_MESSAGE_INVALID');
  assert.equal(ledger.calls.length, 0);
  assert.deepEqual(await broker.receive({
    format: 'snapback.demand-announce.v1', contextId: 'tab', revision: 7,
    authorityPartitionDigest: part,
    demands: [registration({ id: 'good', contextId: 'tab', part })],
  }), { applied: true });
});

test('durable forwarding/release is partition-safe, replayable, and generation-fenced', async (t) => {
  const { broker, ledger } = await setup(t);
  const a = partition('a');
  const programmatic = registration({ id: 'durable', source: 'programmatic', part: a });
  const generation = broker.writerGeneration();
  const committed = await broker.receive({
    format: 'snapback.register-forward.v1', contextId: 'tab-a', requestId: 'req-1',
    writerGeneration: generation, authorityPartitionDigest: a, registration: programmatic,
  });
  assert.equal(committed.outcome.kind, 'committed');
  assert.equal(ledger.durable.has('durable'), true);

  const wrong = await broker.receive({
    format: 'snapback.register-release.v1', contextId: 'tab-a', requestId: 'req-2',
    writerGeneration: generation, authorityPartitionDigest: partition('b'), registrationId: 'durable',
  });
  assert.equal(wrong.outcome.code, 'SNAPBACK_BROKER_PARTITION_MISMATCH');
  const released = await broker.receive({
    format: 'snapback.register-release.v1', contextId: 'tab-a', requestId: 'req-3',
    writerGeneration: generation, authorityPartitionDigest: a, registrationId: 'durable',
  });
  assert.equal(released.outcome.kind, 'released');
  const duplicate = await broker.receive({
    format: 'snapback.register-forward.v1', contextId: 'tab-a', requestId: 'req-1',
    writerGeneration: generation, authorityPartitionDigest: a, registration: programmatic,
  });
  assert.equal(duplicate.outcome.kind, 'committed', 'consumed forward replays its original outcome');
  const fresh = await broker.receive({
    format: 'snapback.register-forward.v1', contextId: 'tab-a', requestId: 'req-4',
    writerGeneration: generation, authorityPartitionDigest: a, registration: programmatic,
  });
  assert.equal(fresh.outcome.code, 'SNAPBACK_REGISTRATION_RELEASED');
  const stale = await broker.receive({
    format: 'snapback.register-forward.v1', contextId: 'tab-a', requestId: 'req-5',
    writerGeneration: generation - 1, authorityPartitionDigest: a,
    registration: registration({ id: 'stale', source: 'programmatic', part: a }),
  });
  assert.equal(stale.outcome.code, 'SNAPBACK_BROKER_STALE_WRITER_GENERATION');
});

test('a pre-broker durable registration keeps its owner partition on release', async (t) => {
  const { handle, broker } = await setup(t);
  const a = partition('a');
  const existing = registration({ id: 'pre-broker', source: 'programmatic', part: a });
  await handle.materializationTransaction('readwrite', (view) => {
    view.storeMeta.durableRegistrations[existing.functionReference.addressKey] = {
      [existing.registrationId]: structuredClone(existing),
    };
  });
  const generation = broker.writerGeneration();
  const wrong = await broker.receive({
    format: 'snapback.register-release.v1',
    contextId: 'tab-a',
    requestId: 'pre-broker-wrong',
    writerGeneration: generation,
    authorityPartitionDigest: partition('b'),
    registrationId: existing.registrationId,
  });
  assert.equal(wrong.outcome.code, 'SNAPBACK_BROKER_PARTITION_MISMATCH');
  const released = await broker.receive({
    format: 'snapback.register-release.v1',
    contextId: 'tab-a',
    requestId: 'pre-broker-release',
    writerGeneration: generation,
    authorityPartitionDigest: a,
    registrationId: existing.registrationId,
  });
  assert.equal(released.outcome.kind, 'released');
});

test('release-before-forward tombstones are partition-keyed and evict at 1,025 total', async (t) => {
  const broker = await createDemandBroker({
    storeHandle: fastStoreHandle(), registrationLedger: fakeLedger(), resolveRegistration,
    lockManager: locks, contextId: 'writer',
  });
  t.after(() => broker.close());
  const a = partition('a');
  const b = partition('b');
  const generation = broker.writerGeneration();
  const releaseUnknown = async (registrationId, requestId, part = a) => broker.receive({
    format: 'snapback.register-release.v1', contextId: 'tab', requestId,
    writerGeneration: generation, authorityPartitionDigest: part, registrationId,
  });
  assert.equal((await releaseUnknown('target', 'r-target')).outcome.kind, 'released');
  const sameIdOtherPartition = await broker.receive({
    format: 'snapback.register-forward.v1', contextId: 'tab', requestId: 'other-part',
    writerGeneration: generation, authorityPartitionDigest: b,
    registration: registration({ id: 'target', source: 'programmatic', part: b }),
  });
  assert.equal(sameIdOtherPartition.outcome.kind, 'committed');
  for (let index = 0; index < 1_023; index += 1) await releaseUnknown(`new-${index}`, `r-${index}`);
  const stillBlocked = await broker.receive({
    format: 'snapback.register-forward.v1', contextId: 'tab', requestId: 'at-1024',
    writerGeneration: generation, authorityPartitionDigest: a,
    registration: registration({ id: 'target', source: 'programmatic', part: a }),
  });
  assert.equal(stillBlocked.outcome.code, 'SNAPBACK_REGISTRATION_RELEASED');
  await releaseUnknown('new-1023', 'r-1023');
  const recreated = await broker.receive({
    format: 'snapback.register-forward.v1', contextId: 'tab', requestId: 'at-1025',
    writerGeneration: generation, authorityPartitionDigest: a,
    registration: registration({ id: 'target', source: 'programmatic', part: a }),
  });
  assert.equal(recreated.outcome.kind, 'committed');
});

test('previously-consumed-forward replay requires both 1,025-entry windows to evict', async (t) => {
  const broker = await createDemandBroker({
    storeHandle: fastStoreHandle(), registrationLedger: fakeLedger(), resolveRegistration,
    lockManager: locks, contextId: 'writer',
  });
  t.after(() => broker.close());
  const part = partition('a');
  const generation = broker.writerGeneration();
  const target = registration({ id: 'replay-target', source: 'programmatic', part });
  const forward = {
    format: 'snapback.register-forward.v1', contextId: 'tab', requestId: 'target-forward',
    writerGeneration: generation, authorityPartitionDigest: part, registration: target,
  };
  assert.equal((await broker.receive(forward)).outcome.kind, 'committed');
  const release = async (index) => broker.receive({
    format: 'snapback.register-release.v1', contextId: 'tab', requestId: `overflow-${index}`,
    writerGeneration: generation, authorityPartitionDigest: part,
    registrationId: index === 'target' ? 'replay-target' : `overflow-registration-${index}`,
  });
  await release('target');
  for (let index = 0; index < 1_022; index += 1) await release(index);
  assert.equal((await broker.receive(forward)).outcome.kind, 'committed', 'target outcome is entry 1 of 1,024');
  await release(1_022);
  assert.equal(
    (await broker.receive(forward)).outcome.code,
    'SNAPBACK_REGISTRATION_RELEASED',
    'forward outcome evicted at 1,025 but target tombstone is still within its own window',
  );
  await release(1_023);
  assert.equal(
    (await broker.receive(forward)).outcome.code,
    'SNAPBACK_REGISTRATION_RELEASED',
    'evicting the tombstone alone cannot bypass the newly consumed refusal outcome',
  );
  for (let index = 1_024; index < 2_047; index += 1) await release(index);
  assert.equal(
    (await broker.receive(forward)).outcome.kind,
    'committed',
    'only eviction from both memories exposes the documented recreate-and-recover residue',
  );
});

test('writer crash before outcome retries from durable consumed state', async (t) => {
  let crash = true;
  const { handle, ledger, broker } = await setup(t, {
    crashBeforeOutcome() { if (crash) { crash = false; throw new Error('simulated writer crash'); } },
  });
  const part = partition('a');
  const message = {
    format: 'snapback.register-forward.v1', contextId: 'tab', requestId: 'crash-request',
    writerGeneration: broker.writerGeneration(), authorityPartitionDigest: part,
    registration: registration({ id: 'crash-registration', source: 'programmatic', part }),
  };
  await assert.rejects(broker.receive(message), /simulated writer crash/);
  const restarted = await createDemandBroker({
    storeHandle: handle, registrationLedger: ledger, resolveRegistration,
    lockManager: locks, contextId: 'replacement-writer',
  });
  t.after(() => restarted.close());
  const replay = await restarted.receive(message);
  assert.equal(replay.outcome.kind, 'committed');
});

test('handoff reconciliation is pair-scoped and the 129th pair refuses', async (t) => {
  let time = 10;
  const { handle, ledger, broker } = await setup(t, { now: () => time });
  const a = partition('a');
  const b = partition('b');
  for (const [part, id] of [[a, 'a'], [b, 'b']]) await broker.receive({
    format: 'snapback.demand-announce.v1', contextId: 'multi', revision: 1,
    authorityPartitionDigest: part, demands: [registration({ id, contextId: 'multi', part })],
  });
  const replacement = await createDemandBroker({
    storeHandle: handle, registrationLedger: ledger, resolveRegistration,
    lockManager: locks, contextId: 'replacement', now: () => time,
  });
  t.after(() => replacement.close());
  assert.equal(await replacement.suppressionActive(), true);
  await replacement.receive({
    format: 'snapback.demand-announce.v1', contextId: 'multi', revision: 2,
    authorityPartitionDigest: a, demands: [registration({ id: 'a', contextId: 'multi', part: a })],
  });
  time += BROKER_LIMITS.heartbeatExpiryMs;
  await replacement.maintenance();
  assert.equal(await replacement.suppressionActive(), false);
  assert.equal(ledger.active.has(`multi:${a}`), true);
  assert.deepEqual(ledger.active.get(`multi:${b}`), []);

  const freshHandle = createMemoryRqsResumeStore({ clientStoreId: 'cap-store' });
  await freshHandle.whenLockSettled();
  t.after(() => freshHandle.close());
  const capBroker = await createDemandBroker({
    storeHandle: freshHandle, registrationLedger: fakeLedger(), resolveRegistration,
    lockManager: locks, contextId: 'cap-writer',
  });
  t.after(() => capBroker.close());
  for (let index = 0; index < BROKER_LIMITS.livePairCeiling; index += 1) {
    const part = `sha256:${index.toString(16).padStart(64, '0')}`;
    const result = await capBroker.receive({
      format: 'snapback.demand-announce.v1', contextId: `c${Math.floor(index / 2)}`,
      revision: 1, authorityPartitionDigest: part,
      demands: [registration({ id: `id-${index}`, contextId: `c${Math.floor(index / 2)}`, part })],
    });
    assert.equal(result.applied, true);
  }
  const overflowPart = `sha256:${'f'.repeat(64)}`;
  const contextOverflow = await capBroker.receive({
    format: 'snapback.demand-announce.v1', contextId: 'c64', revision: 1,
    authorityPartitionDigest: overflowPart,
    demands: [registration({ id: 'context-overflow', contextId: 'c64', part: overflowPart })],
  });
  assert.equal(contextOverflow.refused.code, 'SNAPBACK_BROKER_CONTEXT_FULL');
  const overflow = await capBroker.receive({
    format: 'snapback.demand-announce.v1', contextId: 'c0', revision: 1,
    authorityPartitionDigest: overflowPart,
    demands: [registration({ id: 'overflow', contextId: 'c0', part: overflowPart })],
  });
  assert.equal(overflow.refused.code, 'SNAPBACK_BROKER_PAIR_FULL');
});

test('carrier qualification reports browser proof and file honest degradation', async (t) => {
  const { broker } = await setup(t);
  assert.equal(broker.qualification().qualified, false, 'no injected channel means browser is not qualified');
  const handle = createMemoryRqsResumeStore({ clientStoreId: 'file-degrade' });
  await handle.whenLockSettled();
  t.after(() => handle.close());
  const file = await createDemandBroker({
    storeHandle: handle, registrationLedger: fakeLedger(), resolveRegistration,
    carrier: 'file', contextId: 'file-context',
  });
  t.after(() => file.close());
  assert.equal(file.qualification().profile, 'volatile-online-v1');
});

test('BroadcastChannel-shaped browser carrier protects a non-writer tab demand', async (t) => {
  const backing = createMemoryRqsStoreBacking({ clientStoreId: 'two-tab' });
  const writerHandle = createMemoryRqsResumeStore({ backing });
  const readerHandle = createMemoryRqsResumeStore({ backing });
  await writerHandle.whenLockSettled();
  const hub = fakeChannelHub();
  const ledger = fakeLedger();
  const writer = await createDemandBroker({
    storeHandle: writerHandle, registrationLedger: ledger, resolveRegistration,
    channel: hub.open(), lockManager: locks, contextId: 'writer-tab',
  });
  const reader = await createDemandBroker({
    storeHandle: readerHandle, registrationLedger: fakeLedger(), resolveRegistration,
    channel: hub.open(), lockManager: locks, contextId: 'reader-tab',
  });
  t.after(async () => {
    await reader.close();
    await writer.close();
    await readerHandle.close();
    await writerHandle.close();
  });
  const part = partition('a');
  await reader.announce({
    authorityPartitionDigest: part, revision: 1,
    demands: [registration({ id: 'reader-demand', contextId: 'reader-tab', part })],
  });
  await tick();
  assert.equal(ledger.active.has(`reader-tab:${part}`), true);
  assert.equal(writer.qualification().qualified, true);
  assert.equal(reader.qualification().qualified, true);
});

test('a seam-refused registration refuses the whole announce without consuming the revision (LLP 0166 §D2)', async (t) => {
  const backing = createMemoryRqsStoreBacking({ clientStoreId: 'refusal-rollback' });
  const writerHandle = createMemoryRqsResumeStore({ backing });
  await writerHandle.whenLockSettled();
  const hub = fakeChannelHub();
  const ledger = fakeLedger();
  const refusalCode = 'SNAPBACK_QUERY_REGISTRATION_ADDRESS_INVALID';
  let refuseNext = true;
  const refusingLedger = {
    ...ledger,
    async applyContextDemands(input) {
      if (refuseNext) {
        refuseNext = false;
        const error = new Error(`${refusalCode}: fixture refusal`);
        error.code = refusalCode;
        throw error;
      }
      return ledger.applyContextDemands(input);
    },
  };
  const writer = await createDemandBroker({
    storeHandle: writerHandle, registrationLedger: refusingLedger, resolveRegistration,
    channel: hub.open(), lockManager: locks, contextId: 'writer-tab',
  });
  const reader = await createDemandBroker({
    storeHandle: createMemoryRqsResumeStore({ backing }), registrationLedger: fakeLedger(), resolveRegistration,
    channel: hub.open(), lockManager: locks, contextId: 'reader-tab',
  });
  t.after(async () => {
    await reader.close();
    await writer.close();
    await writerHandle.close();
  });
  const part = partition('a');
  const demands = [registration({ id: 'reader-demand', contextId: 'reader-tab', part })];
  // First announce: the seam refuses -> whole message refused, writer alive,
  // revision NOT consumed, nothing applied.
  await reader.announce({ authorityPartitionDigest: part, revision: 1, demands });
  await tick();
  assert.equal(ledger.active.has(`reader-tab:${part}`), false, 'refused announce applies nothing');
  // Same revision retries after the refusal cause clears: it must apply,
  // proving the refused announce consumed no revision.
  await reader.announce({ authorityPartitionDigest: part, revision: 1, demands });
  await tick();
  assert.equal(ledger.active.has(`reader-tab:${part}`), true, 'same-revision retry applies after refusal');
  assert.equal(writer.qualification().qualified, true, 'writer survives the refusal');
});

test('a REAL BroadcastChannel delivers announces and handoff confirmations (fake-vs-real regression)', async (t) => {
  // Locks the three carrier-exit catches: MessageEvent#data is a prototype
  // getter (never an own property); a released context re-announces its last
  // revision legitimately after handoff; the new writer self-reconciles.
  const backing = createMemoryRqsStoreBacking({ clientStoreId: 'real-channel' });
  const writerHandle = createMemoryRqsResumeStore({ backing });
  await writerHandle.whenLockSettled();
  const ledger = fakeLedger();
  const name = `real-broker-${Math.random().toString(36).slice(2)}`;
  const chanWriter = new BroadcastChannel(name);
  const chanReader = new BroadcastChannel(name);
  const writer = await createDemandBroker({
    storeHandle: writerHandle, registrationLedger: ledger, resolveRegistration,
    channel: chanWriter, lockManager: locks, contextId: 'writer-tab',
  });
  const reader = await createDemandBroker({
    storeHandle: createMemoryRqsResumeStore({ backing }), registrationLedger: fakeLedger(), resolveRegistration,
    channel: chanReader, lockManager: locks, contextId: 'reader-tab',
  });
  t.after(async () => {
    await reader.close();
    await writer.close();
    await writerHandle.close();
  });
  const part = partition('a');
  await reader.announce({
    authorityPartitionDigest: part, revision: 1,
    demands: [registration({ id: 'reader-demand', contextId: 'reader-tab', part })],
  });
  const deadline = Date.now() + 5000;
  while (!ledger.active.has(`reader-tab:${part}`) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(ledger.active.has(`reader-tab:${part}`), true, 'real-channel announce applies at the writer');
});

test('integration regression: a broker constructed as reader promotes through writer handoff', async (t) => {
  const backing = createMemoryRqsStoreBacking({ clientStoreId: 'late-writer' });
  const firstHandle = createMemoryRqsResumeStore({ backing });
  const nextHandle = createMemoryRqsResumeStore({ backing });
  await firstHandle.whenLockSettled();
  const first = await createDemandBroker({
    storeHandle: firstHandle,
    registrationLedger: fakeLedger(),
    resolveRegistration,
    lockManager: locks,
    contextId: 'first-writer',
  });
  const next = await createDemandBroker({
    storeHandle: nextHandle,
    registrationLedger: fakeLedger(),
    resolveRegistration,
    lockManager: locks,
    contextId: 'next-writer',
  });
  t.after(async () => {
    await next.close();
    await nextHandle.close();
  });
  const part = partition('a');
  await first.receive({
    format: 'snapback.demand-announce.v1',
    contextId: 'peer',
    revision: 1,
    authorityPartitionDigest: part,
    demands: [registration({ id: 'peer-demand', contextId: 'peer', part })],
  });
  const priorGeneration = next.writerGeneration();
  await first.close();
  await firstHandle.close();
  await nextHandle.whenLockSettled();
  await next.maintenance();
  assert.equal(next.writerGeneration(), priorGeneration + 1);
  assert.equal(await next.suppressionActive(), true, 'the persisted peer pair awaits reconciliation');
});
