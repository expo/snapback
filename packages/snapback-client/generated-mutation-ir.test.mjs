import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { SnapbackClient as InspectingSnapbackClient } from './index.mjs';
import { outboxNotWriterError } from './outbox-shared.mjs';
import { createFileRqsResumeStore } from './rqs-store-file.mjs';

class SnapbackClient extends InspectingSnapbackClient {
  constructor(baseUrl, options = {}) {
    super(baseUrl, {
      __offlineMutationReplayCapability: true,
      __outboxDrainLifecycle: false,
      ...options,
    });
  }
}

const digest = (character) => `sha256:${character.repeat(64)}`;
const activation = Object.freeze({
  schemaVersion: 'snapback.v1', appId: 'generated-ir-client-test',
  schemaHash: digest('1'), bundleHash: digest('2'), inputsHash: digest('3'),
});
const targetProfileId = 'generated-ir-client-test-profile';
const replayInspection = () => ({
  targetProfileId,
  schema: {
    schemaVersion: activation.schemaVersion,
    appId: activation.appId,
    schemaHash: activation.schemaHash,
    inputsHash: activation.inputsHash,
  },
  functions: {
    schemaVersion: activation.schemaVersion,
    appId: activation.appId,
    bundleHash: activation.bundleHash,
    inputsHash: activation.inputsHash,
  },
  capabilityManifest: {
    manifestVersion: 1,
    targetProfileId,
    supportedCapabilities: ['offline_mutation_replay'],
    capabilityGaps: [],
  },
});
const schema = Object.freeze({ tables: Object.freeze([Object.freeze({
  name: 'cards',
  fields: Object.freeze(['title', 'position', 'locked'].map((name) => Object.freeze({ name }))),
})]) });
const plan = Object.freeze({
  steps: Object.freeze([Object.freeze({ Insert: Object.freeze({
    table: 'cards',
    values: Object.freeze({
      title: Object.freeze({ Arg: 'title' }),
      position: Object.freeze({ Arg: 'position' }),
      locked: Object.freeze({ Literal: false }),
    }),
    bind_id_as: 'cardId',
  }) })]),
  return_value: Object.freeze({ Binding: 'cardId' }),
});
const reference = Object.freeze({
  artifactKind: 'functionReference', schemaVersion: 'snapback.v1',
  appId: 'generated-ir-client-test', id: 'generated-ir-client-test:createCard',
  name: 'createCard', kind: 'Mutation', implementationHash: digest('4'),
  argsContractHash: digest('5'), resultContractHash: digest('6'), expectedGeneration: activation,
  argumentSchema: Object.freeze({
    type: 'object', additionalProperties: false,
    properties: Object.freeze({
      title: Object.freeze({ type: 'string' }), position: Object.freeze({ type: 'integer' }),
    }),
    required: Object.freeze(['title', 'position']),
  }),
  mutationIr: Object.freeze({
    format: 'snapback.generated-mutation-ir.v1', operationHash: digest('7'),
    sourceIdentity: Object.freeze({
      functionId: 'generated-ir-client-test:createCard',
      implementationHash: digest('4'), activation,
    }),
    schemaIdentity: Object.freeze({
      schemaVersion: 'snapback.v1', appId: 'generated-ir-client-test', schemaHash: digest('1'),
    }),
    capabilityClass: 'local-executable',
    capabilityCode: 'SNAPBACK_GENERATED_IR_LOCAL_EXECUTABLE',
    declaredEffectClass: 'snapback.browser-ir.insert-get-guard-patch.v1',
    declaredReads: Object.freeze([]), localReadRequirements: Object.freeze([]),
    schema, plan, mintSites: Object.freeze(['plan/steps/0/insert/row-id']),
    usesRuntimeNow: false, boundedSkew: null,
  }),
});

const waitUntil = async (predicate) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail('condition did not become true');
};

test('generated mutate owns IR preparation, paints before settlement, and replays once on boot', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-ir-client-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const openStore = (storeDirectory = directory) => createFileRqsResumeStore({
    directory: storeDirectory, clientStoreId: 'generated-ir-client-store',
  });

  const store = openStore();
  await store.whenLockSettled();
  const client = new SnapbackClient('http://generated-ir.invalid', {
    rqsStore: store, offlineQueue: true, __offlineMutationReplayCapability: null,
  });
  const view = await client.createOptimisticMutationView({
    authoritativeRows: { cards: [] }, connected: true,
  });

  let requestBody = null;
  let releaseResponse;
  const responseGate = new Promise((resolve) => { releaseResponse = resolve; });
  globalThis.fetch = async (url, init) => {
    if (new URL(url).pathname === '/inspect') return Response.json(replayInspection());
    requestBody = JSON.parse(init.body);
    await responseGate;
    return Response.json({ result: 'card_authoritative', version: 1 });
  };
  const pending = client.mutate(reference, {
    args: { title: 'Painted from IR', position: 3 },
  });
  await waitUntil(() => view.getSnapshot().layers.length === 1 && requestBody !== null);
  const optimisticRow = view.getSnapshot().visibleRows.cards[0];
  assert.equal(optimisticRow.title, 'Painted from IR');
  assert.equal(optimisticRow.position, 3);
  assert.equal(requestBody.ctx_ledger, undefined);
  assert.equal(requestBody.settlementLane, 're-derive');
  assert.equal(requestBody.settlementClaims.mints[0].claimed, optimisticRow._id);
  assert.equal(requestBody.settlementClaims.mints[0].site, 'plan/steps/0/insert/row-id');
  assert.equal(requestBody.settlementIdentity.implementationHash, reference.implementationHash);

  releaseResponse();
  const settlement = await pending;
  assert.equal(settlement.clientMutationId, requestBody.clientMutationId);
  assert.equal(settlement.optimistic.operationHash, reference.mutationIr.operationHash);
  assert.equal(view.getSnapshot().layers[0].layerStatus, 'bridging');
  await view.rebase({
    authoritativeRows: { cards: [{
      _id: 'card_authoritative', title: 'Painted from IR', position: 3, locked: false,
    }] },
    retiredSettlementIdentities: [settlement.clientMutationId], connected: true,
  });
  assert.equal(view.getSnapshot().layers.length, 0);
  assert.equal(view.getSnapshot().visibleRows.cards[0]._id, 'card_authoritative');

  await assert.rejects(
    () => client.mutate(reference, {
      args: { title: 'duplicate', position: 4 },
      optimisticOperation: { appReducer: true },
    }),
    (error) => error.code === 'SNAPBACK_GENERATED_IR_DUPLICATE_TRANSFORM',
  );
  view.close();
  await store.close();

  const pendingDirectory = await mkdtemp(join(tmpdir(), 'snapback-generated-ir-pending-'));
  t.after(() => rm(pendingDirectory, { recursive: true, force: true }));
  const pendingStore = openStore(pendingDirectory);
  await pendingStore.whenLockSettled();
  const pendingClient = new SnapbackClient('http://generated-ir.invalid', {
    rqsStore: pendingStore, offlineQueue: true, __offlineMutationReplayCapability: null,
  });
  const pendingView = await pendingClient.createOptimisticMutationView({
    authoritativeRows: { cards: [] },
  });
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname === '/inspect') return Response.json(replayInspection());
    throw new TypeError('fetch failed');
  };
  const queued = await pendingClient.mutate(reference, {
    args: { title: 'Survives kill', position: 9 },
  });
  assert.equal(queued.status, 'queued');
  assert.equal(pendingView.getSnapshot().visibleRows.cards.length, 1);
  pendingView.close();
  await pendingStore.close();

  const relaunchedStore = openStore(pendingDirectory);
  await relaunchedStore.whenLockSettled();
  const relaunchedClient = new SnapbackClient('http://generated-ir.invalid', {
    rqsStore: relaunchedStore, offlineQueue: true, __offlineMutationReplayCapability: null,
  });
  const relaunchedView = await relaunchedClient.createOptimisticMutationView({
    authoritativeRows: { cards: [] },
  });
  assert.equal(relaunchedView.getSnapshot().layers.length, 1);
  assert.equal(relaunchedView.getSnapshot().visibleRows.cards.length, 1);
  assert.equal(relaunchedView.getSnapshot().visibleRows.cards[0].title, 'Survives kill');
  assert.equal(relaunchedView.getSnapshot().layers[0].clientMutationId, queued.clientMutationId);
  relaunchedView.close();
  await relaunchedStore.close();
});

test('generated mutate derives online projection without durable outbox custody', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const args = { title: 'Server delegated', position: 11 };
  const mockedSettlement = { result: 'card_authoritative', version: 1 };
  const assertDerivedBody = (body) => {
    assert.deepEqual(body.args, args);
    assert.deepEqual(body.expectedGeneration, activation);
    assert.equal(body.settlementLane, 're-derive');
    assert.deepEqual(body.settlementIdentity, {
      implementationHash: reference.implementationHash,
      activation,
    });
    assert.equal(body.settlementClaims.mints.length, 1);
    assert.equal(Object.hasOwn(body, 'ctx_ledger'), false);
    assert.equal(Object.hasOwn(body, 'optimisticOperation'), false);
  };
  const assertDerivedSettlement = (settlement, body) => {
    assert.deepEqual(settlement, {
      ...mockedSettlement,
      status: 'settled',
      clientMutationId: body.clientMutationId,
      optimistic: {
        operationHash: reference.mutationIr.operationHash,
        settlementIdentity: body.clientMutationId,
      },
    });
  };

  let calls = 0;
  let requestBody = null;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    requestBody = JSON.parse(init.body);
    return Response.json(mockedSettlement);
  };
  const previousStoreSwitch = process.env.SNAPBACK_CLIENT_RQS_STORE;
  process.env.SNAPBACK_CLIENT_RQS_STORE = 'off';
  const storelessClient = new SnapbackClient('http://generated-ir.invalid', {
    offlineQueue: false,
  });
  if (previousStoreSwitch === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
  else process.env.SNAPBACK_CLIENT_RQS_STORE = previousStoreSwitch;
  const settlement = await storelessClient.mutate(reference, { args });
  assert.equal(calls, 1, 'store-less generated mutation dispatches');
  assertDerivedBody(requestBody);
  assertDerivedSettlement(settlement, requestBody);
  assert.equal((await storelessClient.mutationStatus(requestBody.clientMutationId)).status, 'settled');
  const ephemeralCost = storelessClient.mutationPhaseCostInspection();
  assert.equal(ephemeralCost.records.length, 1);
  assert.equal(ephemeralCost.records[0].disposition, 'settled');
  assert.equal(ephemeralCost.counters[0].count, 1);

  calls = 0;
  await assert.rejects(
    () => storelessClient.mutate(reference, { args, queue: true }),
    (error) => error.code === 'SNAPBACK_OFFLINE_QUEUE_DISABLED',
  );
  assert.equal(calls, 0, 'explicit queue requirement refuses before dispatch');

  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-ir-server-only-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const durableStore = createFileRqsResumeStore({
    directory,
    clientStoreId: 'generated-ir-server-only-store',
  });
  await durableStore.whenLockSettled();
  const durableClient = new SnapbackClient('http://generated-ir.invalid', {
    rqsStore: durableStore,
  });
  requestBody = null;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return Response.json(mockedSettlement);
  };
  const queueDisabledSettlement = await durableClient.mutate(reference, { args, queue: false });
  assertDerivedBody(requestBody);
  assertDerivedSettlement(queueDisabledSettlement, requestBody);
  assert.deepEqual(await durableStore.outboxRecords(), []);
  await durableStore.close();

  const custodyStore = {
    outboxEnqueue: async () => { throw outboxNotWriterError(); },
    outboxEnqueueWithOperationIdentity: async () => { throw outboxNotWriterError(); },
    outboxPending: async () => [],
    outboxPrepareSubmission: async () => ({ status: 'ready', record: null }),
    outboxRecords: async () => [],
    outboxMarkAcknowledgementsReady: async () => {},
    outboxDurablyConsume: async () => null,
    outboxMarkResultGone: async () => null,
    outboxPendingAcknowledgements: async () => [],
    durability: () => ({ durable: true, implementation: 'fake' }),
  };
  const custodyClient = new SnapbackClient('http://generated-ir.invalid', {
    rqsStore: custodyStore,
  });
  requestBody = null;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return Response.json(mockedSettlement);
  };
  const custodySettlement = await custodyClient.mutate(reference, { args });
  assertDerivedBody(requestBody);
  assertDerivedSettlement(custodySettlement, requestBody);

  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(
    () => storelessClient.mutate(reference, { args }),
    /fetch failed/,
  );

  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json(mockedSettlement);
  };
  await assert.rejects(
    () => storelessClient.mutate(reference, {
      args,
      optimisticOperation: { appReducer: true },
    }),
    (error) => error.code === 'SNAPBACK_GENERATED_IR_DUPLICATE_TRANSFORM',
  );
  assert.equal(calls, 0, 'duplicate transform refuses before dispatch');
});
