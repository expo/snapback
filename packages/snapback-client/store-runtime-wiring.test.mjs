import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SnapbackClient } from './index.mjs';
import {
  createMaterializationStore,
  decodeMaterializationRecordV1,
  encodeMaterializationRecordV1,
  materializationAddressKey,
} from './materialization-store.mjs';
import {
  createMemoryRqsResumeStore,
  createMemoryRqsStoreBacking,
} from './rqs-store-memory.mjs';
import { base64UrlNoPad, sha256 } from './rqs.mjs';
import { STORE_POLICY_CONSTANTS } from './store-policy.mjs';

const encoder = new TextEncoder();
const CLIENT_STORE_ID = 'shipped-store-runtime';
const partition = (character) => `sha256:${character.repeat(64)}`;
const qmk = (label) => `qmk1.${base64UrlNoPad(sha256(encoder.encode(label)))}`;
const generatedTestRef = (name) => ({
  artifactKind: 'functionReference',
  name,
  argsContract: { kind: 'object', fields: [] },
});

function authorityState() {
  return {
    query_instance_id: null,
    query_lifecycle: 'active',
    authority_generation: 1,
    query_generation: 1,
    authority_instance_id: 'authority',
    expected_boot_issuer: { issuer_id: 'issuer', boot_sequence: 1 },
    expected_authorization: { incarnation: 'inc', epoch: 1, version_stream: 'stream' },
    effective_disposition: 'retain',
    accepted: null,
    retired_issuer_frontier: { incarnation: 'inc', boot_sequence: 0 },
    retired_scope_frontier: null,
    pending_by_scope: {},
    scope_state: {},
  };
}

async function addRecord(handle, store, label, part = partition('a')) {
  const address = ['snapback:client-materialization-address:v1', CLIENT_STORE_ID, qmk(label)];
  let record = await store.initialize(address, {
    planHash: partition('1'),
    activationHash: partition('2'),
    argsDigest: partition('3'),
    authorityPartitionDigest: part,
    storageProfile: 'volatile-online-v1',
    authorityState: authorityState(),
  });
  const membership = {
    localRowHandle: `row-${label}`,
    materializationKey: address[2],
    pageIdentityDigest: partition('4'),
  };
  await handle.materializationTransaction('readwrite', (view) => {
    const key = materializationAddressKey(address);
    record = decodeMaterializationRecordV1(view.materializations.get(key));
    record.memberships.push(membership);
    view.memberships.set(`${label}:membership`, structuredClone(membership));
    view.materializations.set(key, encodeMaterializationRecordV1(record));
  });
  return { address, addressKey: address[2], record, part };
}

async function addEmptyRecord(store, label, part = partition('a')) {
  const address = ['snapback:client-materialization-address:v1', CLIENT_STORE_ID, qmk(label)];
  const record = await store.initialize(address, {
    planHash: partition('1'),
    activationHash: partition('2'),
    argsDigest: partition('3'),
    authorityPartitionDigest: part,
    storageProfile: 'volatile-online-v1',
    authorityState: authorityState(),
  });
  return { address, addressKey: address[2], record, part };
}

function registration({
  id,
  item,
  source = 'programmatic',
  contextId = 'context',
  retentionRequest = 'durable',
  idleTtlClass = 'default',
}) {
  return {
    format: 'snapback.query-registration.v1',
    registrationId: id,
    source,
    ownerContext: source === 'active'
      ? { kind: 'subscription', contextId }
      : { kind: 'api', label: null },
    functionReference: {
      name: `query-${id}`,
      materializationAddress: item.address,
      authorityPartitionDigest: item.part,
    },
    canonicalArgs: {},
    requestedScope: { kind: 'page', input: { kind: 'first' } },
    retentionRequest,
    idleTtlClass,
  };
}

function preparedBridge(item) {
  return {
    bridge: {
      address: item.address,
      addressKey: item.addressKey,
      authorityPartitionDigest: item.part,
      canonicalArgs: {},
      retentionRequested: true,
      retentionClass: 'opaque-authorized-snapshot-v1',
      localReadCoverage: null,
    },
    record: item.record,
  };
}

async function registerProgrammatic(client, {
  id,
  item,
  retentionRequest = 'durable',
  idleTtlClass = 'default',
}) {
  client.__prepareGeneratedMaterializationBridge = async () => preparedBridge(item);
  return client.registerQuery(generatedTestRef(`query_${id.replaceAll('-', '_')}`), {
    registrationId: id,
    args: {},
    label: null,
    requestedScope: { kind: 'page', input: { kind: 'first' } },
    retentionRequest,
    idleTtlClass,
  });
}

function assertRegisterOutcome(result, kind) {
  assert.equal(result.format, 'snapback.register-outcome.v1');
  assert.equal(typeof result.contextId, 'string');
  assert.equal(typeof result.requestId, 'string');
  assert.deepEqual(result.outcome, { kind });
}

function controlledRuntime({
  at = 1_000,
  contextId,
  carrier = 'file',
  policyLimits = null,
  channelFactory = null,
} = {}) {
  let now = at;
  let sequence = 0;
  const scheduled = new Map();
  const intervals = new Map();
  const control = {
    scheduleCalls: 0,
    channelAllocations: 0,
    now: () => now,
    advance(milliseconds) { now += milliseconds; },
    set(value) { now = value; },
    schedule(callback, delayMs) {
      control.scheduleCalls += 1;
      const id = ++sequence;
      scheduled.set(id, { callback, dueAt: now + delayMs });
      return id;
    },
    cancel(id) { scheduled.delete(id); },
    setIntervalFn(callback, intervalMs) {
      const id = { value: ++sequence, unref() {} };
      intervals.set(id, { callback, intervalMs });
      return id;
    },
    clearIntervalFn(id) { intervals.delete(id); },
    async runDue(client) {
      const due = [...scheduled.entries()]
        .filter(([, entry]) => entry.dueAt <= now)
        .sort((a, b) => a[1].dueAt - b[1].dueAt || a[0] - b[0]);
      for (const [id, entry] of due) {
        scheduled.delete(id);
        entry.callback();
        await client.__runStoreMaintenance();
      }
    },
    async fireIntervals() {
      for (const entry of [...intervals.values()]) entry.callback();
      await Promise.resolve();
      await Promise.resolve();
    },
    pendingScheduled: () => scheduled.size,
    nextScheduledDelay: () => scheduled.size === 0
      ? null
      : Math.min(...[...scheduled.values()].map((entry) => entry.dueAt - now)),
    options: null,
  };
  control.options = {
    contextId,
    carrier,
    now: control.now,
    schedule: control.schedule,
    cancel: control.cancel,
    setIntervalFn: control.setIntervalFn,
    clearIntervalFn: control.clearIntervalFn,
    lockManager: carrier === 'browser' ? {} : null,
    broadcastChannelFactory: channelFactory === null ? null : (name) => {
      control.channelAllocations += 1;
      return channelFactory(name);
    },
    ...(policyLimits === null ? {} : { policyLimits }),
  };
  return control;
}

function controlledChannelHub() {
  const channels = new Map();
  const deliveries = [];
  return {
    factory(name) {
      const endpoints = channels.get(name) ?? new Set();
      channels.set(name, endpoints);
      const listeners = new Set();
      const endpoint = {
        postMessage(message) {
          for (const other of endpoints) {
            if (other === endpoint) continue;
            for (const listener of other.listeners) deliveries.push(() => {
              if (other.listeners.has(listener)) listener({ data: structuredClone(message) });
            });
          }
        },
        addEventListener(type, listener) {
          if (type === 'message') listeners.add(listener);
        },
        removeEventListener(type, listener) {
          if (type === 'message') listeners.delete(listener);
        },
        close() {
          endpoints.delete(endpoint);
          listeners.clear();
        },
        listeners,
      };
      endpoints.add(endpoint);
      return endpoint;
    },
    async flush() {
      // Message listeners are intentionally fire-and-forget like the platform
      // carrier. Give their transaction awaits enough deterministic turns to
      // enqueue any response before declaring the channel quiescent.
      for (let round = 0; round < 64; round += 1) {
        while (deliveries.length > 0) deliveries.shift()();
        await Promise.resolve();
        await Promise.resolve();
      }
      if (deliveries.length === 0) return;
      throw new Error('controlled BroadcastChannel did not quiesce');
    },
    pendingDeliveries: () => deliveries.length,
  };
}

async function waitFor(predicate, message) {
  for (let turn = 0; turn < 128; turn += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(message);
}

async function settlesOnThisTurn(task, message) {
  const pending = Symbol('pending');
  const result = await Promise.race([
    task,
    new Promise((resolve) => setImmediate(() => resolve(pending))),
  ]);
  assert.notEqual(result, pending, message);
  return result;
}

async function clientFixture(t, {
  backing = null,
  control = null,
  policyLimits = null,
  contextId = 'writer',
  preloadBootPayload = null,
} = {}) {
  const actualBacking = backing ?? createMemoryRqsStoreBacking({ clientStoreId: CLIENT_STORE_ID });
  const handle = createMemoryRqsResumeStore({ backing: actualBacking });
  if (handle.isWriter()) await handle.whenLockSettled();
  const materializations = await createMaterializationStore(handle);
  const runtime = control ?? controlledRuntime({ contextId, policyLimits });
  const client = new SnapbackClient('http://snapback.test', {
    clientStoreId: CLIENT_STORE_ID,
    rqsStore: handle,
    __materializationStore: materializations,
    __authorityPartitionDigestResolver: async () => partition('a'),
    __preloadBootPayload: preloadBootPayload,
    __storeRuntimeOptions: runtime.options,
  });
  t.after(async () => {
    try { await client.closeAuth(); } catch { /* a handoff leg may already close it */ }
    await handle.close();
  });
  return { backing: actualBacking, handle, materializations, runtime, client };
}

// @ref LLP 0166#executable-acceptance — this uses the shipped client construction,
// broker, ledger hydration, and boot producer for the three-source restart
// matrix; it does not call the ledger producer directly.
test('shipped boot reaps active, reloads programmatic, and re-derives preload registrations', async (t) => {
  const backing = createMemoryRqsStoreBacking({ clientStoreId: CLIENT_STORE_ID });
  const first = await clientFixture(t, {
    backing,
    contextId: 'restart-first',
    preloadBootPayload: {
      route: '/triage',
      generation: 'routes-v1',
      entries: [{ function: 'preloadInbox', args: { status: 'open' } }],
    },
  });
  const programmaticItem = await addRecord(
    first.handle, first.materializations, 'restart-programmatic',
  );
  const activeItem = await addRecord(first.handle, first.materializations, 'restart-active');
  assert.equal((await first.client.__replacePreloadRouteBoot(
    first.client.__inlinePreloadBootPayload,
    { functionReferences: { preloadInbox: { name: 'preloadInbox' } } },
  )).committed, true);
  assertRegisterOutcome(await registerProgrammatic(first.client, {
    id: 'restart-programmatic', item: programmaticItem,
  }), 'committed');
  await first.client.__registerActiveQueryDemand(
    { name: 'restart-active' }, {}, true, preparedBridge(activeItem),
  );
  assert.deepEqual(
    (await first.client.__registrationLedgerPromise).registrations()
      .map((entry) => entry.registration.source).sort(),
    ['active', 'preload', 'programmatic'],
  );
  await first.client.closeAuth();
  await first.handle.close();

  const second = await clientFixture(t, {
    backing,
    contextId: 'restart-second',
    preloadBootPayload: {
      route: '/triage',
      generation: 'routes-v2',
      entries: [{ function: 'preloadAssigned', args: { owner: 'me' } }],
    },
  });
  const preloadOutcome = await second.client.__replacePreloadRouteBoot(
    second.client.__inlinePreloadBootPayload,
    { functionReferences: { preloadAssigned: { name: 'preloadAssigned' } } },
  );
  assert.equal(preloadOutcome.committed, true);
  const registrations = (await second.client.__registrationLedgerPromise).registrations()
    .map((entry) => entry.registration);
  assert.deepEqual(registrations.map((entry) => entry.source).sort(), [
    'preload', 'programmatic',
  ]);
  assert.equal(
    registrations.some((entry) => entry.functionReference.name === 'restart-active'),
    false,
  );
  assert.equal(
    registrations.find((entry) => entry.source === 'preload').functionReference.name,
    'preloadAssigned',
  );
});

test('shipped route boot projects each concrete generated query into owner-partitioned qmk1 preload demand', async (t) => {
  const fixture = await clientFixture(t, { contextId: 'generated-preload' });
  const first = await addRecord(fixture.handle, fixture.materializations, 'preload-first');
  const second = await addRecord(fixture.handle, fixture.materializations, 'preload-second');
  fixture.client.__prepareGeneratedMaterializationBridge = async (_ref, args) => (
    preparedBridge(args.page === 1 ? first : second)
  );
  const currentBoot = {
    route: '/inbox/:page',
    generation: 'generated-routes-v1',
    entries: [
      { function: 'routeInbox', args: { page: 1 } },
      { function: 'routeInbox', args: { page: 2 } },
    ],
  };
  const routesManifest = {
    formatVersion: 1,
    app: 'preload-test',
    routes: [
      {
        route: '/home', registerGroupEligible: true,
        queries: [{ function: 'routeInbox', args: { page: 1 } }],
      },
      {
        route: '/inbox/:page',
        registerGroupEligible: true,
        queries: [{ function: 'routeInbox', args: { page: { $param: 'page' } } }],
      },
      {
        route: '/one-shot',
        queries: [{ function: 'routeInbox', args: { page: 99 } }],
      },
    ],
  };
  const outcome = await fixture.client.__replacePreloadManifestInForce(
    routesManifest,
    currentBoot,
    {
    functionReferences: { routeInbox: { name: 'routeInbox' } },
    },
  );
  assert.deepEqual(outcome, {
    committed: true, added: 3, retired: 0, duplicate: false,
  });
  const preloads = (await fixture.client.__registrationLedgerPromise).registrations()
    .map((entry) => entry.registration)
    .filter((entry) => entry.source === 'preload');
  assert.deepEqual(
    preloads.map((entry) => entry.functionReference.materializationAddress[2]).sort(),
    [first.addressKey, first.addressKey, second.addressKey].sort(),
  );
  assert.equal(preloads.every(
    (entry) => entry.functionReference.authorityPartitionDigest === partition('a'),
  ), true);
  const removed = await fixture.client.__replacePreloadManifestInForce({
    ...routesManifest,
    routes: routesManifest.routes.slice(1),
  }, currentBoot, {
    functionReferences: { routeInbox: { name: 'routeInbox' } },
  });
  assert.deepEqual(removed, {
    committed: true, added: 0, retired: 1, duplicate: false,
  });
  assert.equal(
    (await fixture.client.__registrationLedgerPromise).registrations()
      .filter((entry) => entry.registration.source === 'preload').length,
    2,
  );
});

// @ref LLP 0166#release-grace-ttl — release is the clock anchor and the
// shipped deadline scheduler invokes the writer pass at grace expiry.
test('shipped runtime starts release grace and deadline-scheduled GC compacts at expiry', async (t) => {
  const fixture = await clientFixture(t);
  const item = await addRecord(fixture.handle, fixture.materializations, 'grace');
  assertRegisterOutcome(await registerProgrammatic(fixture.client, {
    id: 'grace-registration', item,
  }), 'committed');
  await fixture.client.__runStoreMaintenance();
  assertRegisterOutcome(
    await fixture.client.releaseQueryRegistration('grace-registration'),
    'released',
  );
  const refused = await fixture.client.registerQuery(generatedTestRef('query_limit'), {
    registrationId: 'x'.repeat(65),
    args: {},
  });
  assert.equal(refused.format, 'snapback.register-outcome.v1');
  assert.deepEqual(refused.outcome, {
    kind: 'refused', code: 'SNAPBACK_BROKER_MESSAGE_INVALID',
  });
  assertRegisterOutcome(
    await fixture.client.releaseQueryRegistration('grace-registration'),
    'released',
  );
  await fixture.client.__runStoreMaintenance();
  let inspected = await fixture.client.storePolicyInspection({
    authorityPartitionDigest: item.part,
  });
  assert.equal(
    inspected.addresses[0].retainingReason.graceDeadline,
    fixture.runtime.now() + STORE_POLICY_CONSTANTS.graceDefaultMs,
  );
  assert.equal(inspected.addresses[0].compacted, false);

  fixture.runtime.advance(STORE_POLICY_CONSTANTS.graceDefaultMs);
  assert.equal(fixture.runtime.pendingScheduled() > 0, true, 'grace owns a future deadline');
  await fixture.runtime.runDue(fixture.client);
  inspected = await fixture.client.storePolicyInspection({ authorityPartitionDigest: item.part });
  assert.equal(inspected.addresses[0].compacted, true);
});

// @ref LLP 0166#release-grace-ttl — expiry over an already-empty stub still
// consumes the durable grace fact; otherwise the past deadline reschedules a
// zero-delay maintenance pass forever.
test('expired release grace over an empty record clears the deadline without a zero-delay loop', async (t) => {
  const fixture = await clientFixture(t);
  const item = await addEmptyRecord(fixture.materializations, 'empty-grace');
  assertRegisterOutcome(await registerProgrammatic(fixture.client, {
    id: 'empty-grace-registration', item,
  }), 'committed');
  assertRegisterOutcome(
    await fixture.client.releaseQueryRegistration('empty-grace-registration'),
    'released',
  );
  await fixture.client.__runStoreMaintenance();
  fixture.runtime.advance(STORE_POLICY_CONSTANTS.graceDefaultMs);
  await fixture.runtime.runDue(fixture.client);
  await fixture.runtime.runDue(fixture.client);

  const inspected = await fixture.client.storePolicyInspection({
    authorityPartitionDigest: item.part,
  });
  assert.deepEqual(inspected.addresses[0].retainingReason, { kind: 'instance-bookkeeping' });
  assert.equal(inspected.addresses[0].compacted, true);
  const nextDelay = fixture.runtime.nextScheduledDelay();
  assert.equal(
    nextDelay === null || nextDelay > 0,
    true,
    'the consumed deadline schedules no immediate retry',
  );
});

// @ref LLP 0166#compaction-eviction--payload-custody-only — construction uses
// the module's exact three-step pressure order and active refusal.
test('shipped runtime pressure-compacts undemanded then idle and refuses demanded-active', async (t) => {
  const limits = {
    materializationByteCeiling: 0,
    materializationRecordCeiling: 256,
    materializationFragmentCeiling: 1_024,
  };
  const fixture = await clientFixture(t, { policyLimits: limits });
  const undemanded = await addRecord(fixture.handle, fixture.materializations, 'pressure-undemanded');
  const idle = await addRecord(fixture.handle, fixture.materializations, 'pressure-idle');
  const active = await addRecord(fixture.handle, fixture.materializations, 'pressure-active');
  assertRegisterOutcome(await registerProgrammatic(fixture.client, {
    id: 'released', item: undemanded,
  }), 'committed');
  assertRegisterOutcome(await fixture.client.releaseQueryRegistration('released'), 'released');
  assertRegisterOutcome(await registerProgrammatic(fixture.client, {
    id: 'idle', item: idle,
  }), 'committed');
  await fixture.client.__registerActiveQueryDemand(
    { name: 'active-query' },
    {},
    true,
    preparedBridge(active),
  );
  const activeRegistration = (await fixture.client.__registrationLedgerPromise)
    .registrations()
    .find((entry) => entry.registration.source === 'active').registration;
  assert.equal(activeRegistration.functionReference.authorityPartitionDigest, active.part);
  assert.notEqual(
    activeRegistration.functionReference.authorityPartitionDigest,
    `sha256:${'0'.repeat(64)}`,
  );
  const pass = await fixture.client.__runStoreMaintenance();
  assert.deepEqual(pass.policy.compacted, [undemanded.addressKey, idle.addressKey]);
  assert.equal(pass.policy.refused, true);
  const inspected = await fixture.client.storePolicyInspection({ authorityPartitionDigest: partition('a') });
  const byKey = new Map(inspected.addresses.map((entry) => [entry.addressKey, entry]));
  assert.equal(byKey.get(undemanded.addressKey).compacted, true);
  assert.equal(byKey.get(idle.addressKey).compacted, true);
  assert.equal(byKey.get(active.addressKey).demandState, 'demanded-active');
  assert.equal(byKey.get(active.addressKey).compacted, false);
});

// @ref LLP 0166#the-multi-context-demand-broker — the real shipped client
// construction announces a reader context over its BroadcastChannel carrier;
// writer maintenance owns heartbeat reaping.
test('second shipped context demand protects custody until heartbeat expiry reaps it', async (t) => {
  const hub = controlledChannelHub();
  const backing = createMemoryRqsStoreBacking({ clientStoreId: CLIENT_STORE_ID });
  const writerControl = controlledRuntime({
    contextId: 'writer-tab', carrier: 'browser', channelFactory: (name) => hub.factory(name),
  });
  const readerControl = controlledRuntime({
    contextId: 'reader-tab', carrier: 'browser', channelFactory: (name) => hub.factory(name),
  });
  const writer = await clientFixture(t, { backing, control: writerControl });
  const item = await addRecord(writer.handle, writer.materializations, 'remote-demand');
  await writer.client.storePolicyInspection({ authorityPartitionDigest: item.part });
  const reader = await clientFixture(t, { backing, control: readerControl });
  assert.equal((await reader.client.storePolicyInspection({
    authorityPartitionDigest: item.part,
  })).format, 'snapback.store-policy-inspection.v1', 'inspection stays read-only on a non-writer');
  await reader.client.__registerActiveQueryDemand(
    { name: 'remote-query' }, {}, true, preparedBridge(item),
  );
  await hub.flush();
  await writer.client.__runStoreMaintenance();
  let inspected = await writer.client.storePolicyInspection({ authorityPartitionDigest: item.part });
  assert.equal(inspected.addresses[0].demandState, 'demanded-active');

  reader.client.__prepareGeneratedMaterializationBridge = async () => preparedBridge(item);
  const registerTask = reader.client.registerQuery(generatedTestRef('query_remote_programmatic'), {
    registrationId: 'remote-programmatic',
    args: {},
    label: null,
  });
  await hub.flush();
  assertRegisterOutcome(await registerTask, 'committed');
  const releaseTask = reader.client.releaseQueryRegistration('remote-programmatic');
  await hub.flush();
  assertRegisterOutcome(await releaseTask, 'released');
  const outcomeMemory = await writer.handle.materializationTransaction('readonly', (view) => (
    structuredClone(view.storeMeta.brokerRoster)
  ));
  assert.equal(
    outcomeMemory.consumedRequests.some((entry) => entry.outcome.kind === 'committed'),
    true,
  );
  assert.equal(
    outcomeMemory.releasedRegistrations.some(
      (entry) => entry.registrationId === 'remote-programmatic',
    ),
    true,
  );

  writerControl.advance(STORE_POLICY_CONSTANTS.heartbeatExpiryMs);
  readerControl.advance(STORE_POLICY_CONSTANTS.heartbeatExpiryMs);
  await writer.client.__runStoreMaintenance();
  inspected = await writer.client.storePolicyInspection({ authorityPartitionDigest: item.part });
  assert.equal(inspected.addresses[0].demandState, 'undemanded');
  assert.equal(inspected.addresses[0].compacted, false, 'fresh release grace retains the payload');
});

// @ref LLP 0166#the-multi-context-demand-broker — the requesting context
// retries the same request id after writer death. The durable consumed-request
// memory makes the replay exact whether the predecessor committed or died
// before it observed the request.
test('reader-forwarded register and release outcomes replay across writer death', async (t) => {
  const hub = controlledChannelHub();
  const backing = createMemoryRqsStoreBacking({ clientStoreId: CLIENT_STORE_ID });
  const writer = await clientFixture(t, {
    backing,
    control: controlledRuntime({
      contextId: 'outcome-writer', carrier: 'browser', channelFactory: (name) => hub.factory(name),
    }),
  });
  const item = await addRecord(writer.handle, writer.materializations, 'outcome-replay');
  await writer.client.storePolicyInspection({ authorityPartitionDigest: item.part });
  const registering = await clientFixture(t, {
    backing,
    control: controlledRuntime({
      contextId: 'outcome-registering', carrier: 'browser', channelFactory: (name) => hub.factory(name),
    }),
  });
  registering.client.__prepareGeneratedMaterializationBridge = async () => preparedBridge(item);

  const registerTask = registering.client.registerQuery(generatedTestRef('outcomeReplay'), {
    registrationId: 'outcome-replay-registration',
    args: {},
  });
  await waitFor(
    () => hub.pendingDeliveries() > 0,
    'the register forward never reached the channel',
  );
  await writer.client.closeAuth();
  await writer.handle.close();
  await registering.handle.whenLockSettled();
  await registering.client.__runStoreMaintenance();
  assertRegisterOutcome(
    await settlesOnThisTurn(registerTask, 'register outcome hung after predecessor writer death'),
    'committed',
  );

  const releasing = await clientFixture(t, {
    backing,
    control: controlledRuntime({
      contextId: 'outcome-releasing', carrier: 'browser', channelFactory: (name) => hub.factory(name),
    }),
  });
  const releaseTask = releasing.client.releaseQueryRegistration('outcome-replay-registration');
  await waitFor(
    () => hub.pendingDeliveries() > 0,
    'the release forward never reached the channel',
  );
  await registering.client.closeAuth();
  await registering.handle.close();
  await releasing.handle.whenLockSettled();
  await releasing.client.__runStoreMaintenance();
  assertRegisterOutcome(
    await settlesOnThisTurn(releaseTask, 'release outcome hung after predecessor writer death'),
    'released',
  );
});

test('writer handoff keeps policy suppression active until every roster pair reconciles', async (t) => {
  const hub = controlledChannelHub();
  const backing = createMemoryRqsStoreBacking({ clientStoreId: CLIENT_STORE_ID });
  const writerControl = controlledRuntime({
    contextId: 'writer', carrier: 'browser', channelFactory: (name) => hub.factory(name),
  });
  const successorControl = controlledRuntime({
    contextId: 'successor', carrier: 'browser', channelFactory: (name) => hub.factory(name),
    policyLimits: { materializationByteCeiling: 0 },
  });
  const peerControl = controlledRuntime({
    contextId: 'peer', carrier: 'browser', channelFactory: (name) => hub.factory(name),
  });
  const writer = await clientFixture(t, { backing, control: writerControl });
  const item = await addRecord(writer.handle, writer.materializations, 'handoff');
  await writer.client.storePolicyInspection({ authorityPartitionDigest: item.part });
  const successor = await clientFixture(t, { backing, control: successorControl });
  const peer = await clientFixture(t, { backing, control: peerControl });
  const successorDemand = await successor.client.__registerActiveQueryDemand(
    { name: 'successor-query' }, {}, true, preparedBridge(item),
  );
  await peer.client.__registerActiveQueryDemand(
    { name: 'peer-query' }, {}, true, preparedBridge(item),
  );
  await hub.flush();
  await writer.client.__runStoreMaintenance();

  await writer.client.closeAuth();
  await writer.handle.close();
  await successor.handle.whenLockSettled();
  const promoted = await successor.client.__runStoreMaintenance();
  assert.equal(promoted.policy.suppressionActive, true);
  let inspected = await successor.client.storePolicyInspection({ authorityPartitionDigest: item.part });
  assert.equal(inspected.broker.suppressionActive, true);
  assert.equal(inspected.addresses[0].compacted, false, 'pressure is suspended during handoff');

  await hub.flush();
  await successor.client.__runStoreMaintenance();
  inspected = await successor.client.storePolicyInspection({ authorityPartitionDigest: item.part });
  assert.equal(inspected.broker.suppressionActive, false);
  assert.equal(inspected.addresses[0].demandState, 'demanded-active');
  await successorDemand.release();
});

test('retentionRequest downgrade compacts at the next shipped maintenance pass', async (t) => {
  const fixture = await clientFixture(t);
  const item = await addRecord(fixture.handle, fixture.materializations, 'downgrade');
  assertRegisterOutcome(await registerProgrammatic(fixture.client, {
    id: 'durable', item, retentionRequest: 'durable',
  }), 'committed');
  assertRegisterOutcome(await registerProgrammatic(fixture.client, {
    id: 'volatile', item, retentionRequest: 'none',
  }), 'committed');
  assertRegisterOutcome(await fixture.client.releaseQueryRegistration('durable'), 'released');
  const pass = await fixture.client.__runStoreMaintenance();
  assert.deepEqual(pass.policy.compacted, [item.addressKey]);
  const inspected = await fixture.client.storePolicyInspection({ authorityPartitionDigest: item.part });
  assert.equal(inspected.addresses[0].demandState, 'demanded-idle');
  assert.equal(inspected.addresses[0].effectiveRetentionRequest, 'none');
  assert.equal(inspected.addresses[0].compacted, true);
});

test('quiet shipped client allocates no broker/channel/timer when no qmk1 policy facts exist', async (t) => {
  const backing = createMemoryRqsStoreBacking({ clientStoreId: CLIENT_STORE_ID });
  const handle = createMemoryRqsResumeStore({ backing });
  await handle.whenLockSettled();
  const control = controlledRuntime({ contextId: 'quiet', carrier: 'browser' });
  const client = new SnapbackClient('http://snapback.test', {
    clientStoreId: CLIENT_STORE_ID,
    rqsStore: handle,
    __authorityPartitionDigestResolver: async () => partition('a'),
    __storeRuntimeOptions: control.options,
  });
  t.after(async () => {
    await client.closeAuth();
    await handle.close();
  });
  assert.equal(client.__storeRuntimeModulePromise, null, 'quiet construction does not load store runtime');
  const legacyOnly = await client.__registerActiveQueryDemand(
    { name: 'legacy-only-query' }, {}, false, null,
  );
  assert.equal(legacyOnly.registrationId, null);
  assert.equal(client.__storeRuntimeModulePromise, null, 'legacy-only demand stays outside store runtime');
  await legacyOnly.release();
  assert.deepEqual(client.__storePolicyRuntimeInspection(), {
    constructed: false, scheduled: false, running: false, lastErrorCode: null,
  });
  assert.equal(control.scheduleCalls, 0);
  assert.equal(control.channelAllocations, 0);
  assert.equal(control.pendingScheduled(), 0);
});

test('idle non-writer runtime does not wake every heartbeat interval', async (t) => {
  const hub = controlledChannelHub();
  const backing = createMemoryRqsStoreBacking({ clientStoreId: CLIENT_STORE_ID });
  await clientFixture(t, {
    backing,
    control: controlledRuntime({
      contextId: 'idle-writer', carrier: 'browser', channelFactory: (name) => hub.factory(name),
    }),
  });
  const readerControl = controlledRuntime({
    contextId: 'idle-reader', carrier: 'browser', channelFactory: (name) => hub.factory(name),
  });
  const reader = await clientFixture(t, { backing, control: readerControl });
  await reader.client.storePolicyInspection({ authorityPartitionDigest: partition('a') });
  await reader.client.__runStoreMaintenance();
  assert.equal(readerControl.pendingScheduled(), 0);
});

test('legacy-only inline preload boot stays outside the Full store-runtime chunk', async (t) => {
  const client = new SnapbackClient('http://snapback.test', {
    rqsStore: false,
    offlineQueue: false,
    __preloadBootPayload: {
      route: '/legacy', generation: 'legacy-v1', entries: [],
    },
  });
  t.after(() => client.closeAuth());
  assert.deepEqual(await client.__preloadRegistrationPromise, {
    committed: true, added: 0, retired: 0, duplicate: true, grandfatheredLegacy: true,
  });
  assert.equal(client.__storeRuntimeModulePromise, null, 'constructor boot does not import store-runtime');
  assert.deepEqual(await client.__replacePreloadRouteBoot({
    route: '/legacy', generation: 'legacy-v2', entries: [],
  }), {
    committed: true, added: 0, retired: 0, duplicate: true, grandfatheredLegacy: true,
  });
  assert.equal(client.__storeRuntimeModulePromise, null, 'legacy fetchBundle wrapper remains a no-op');
});

test('store runtime initialization preserves the constructor boot promise', async (t) => {
  const client = new SnapbackClient('http://snapback.test', {
    rqsStore: false,
    offlineQueue: false,
  });
  t.after(() => client.closeAuth());
  const bootPromise = Promise.resolve({ marker: 'constructor-owned' });
  client.__preloadRegistrationPromise = bootPromise;
  await client.__ensureStoreRuntimeModule();
  assert.equal(client.__preloadRegistrationPromise, bootPromise);
  assert.deepEqual(await client.__preloadRegistrationPromise, { marker: 'constructor-owned' });
});
