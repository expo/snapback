import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { BROWSER_IR_LOCAL_EFFECT_CLASS } from '../snapback-client/ir-evaluator.mjs';
import { SnapbackClient as InspectingSnapbackClient } from '../snapback-client/index.mjs';
import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { hex, jcsBytes, sha256 } from '../snapback-client/rqs.mjs';
import { createFileRqsResumeStore } from '../snapback-client/rqs-store-file.mjs';
import { createMemoryRqsResumeStore } from '../snapback-client/rqs-store-memory.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackQueries,
} from './index.mjs';

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
const encoder = new TextEncoder();
const concat = (...parts) => {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};
const hashRecord = (domain, value) => (
  `sha256:${hex(sha256(concat(encoder.encode(domain), jcsBytes(value))))}`
);
const ACTIVATION = Object.freeze({
  schemaVersion: 'snapback.v1',
  appId: 'react-generated-optimistic-default',
  schemaHash: digest('1'),
  bundleHash: digest('2'),
  inputsHash: digest('3'),
});
const SCHEMA = Object.freeze({
  tables: Object.freeze([Object.freeze({
    name: 'cards',
    fields: Object.freeze(['title', 'position', 'archived', 'locked'].map(
      (name) => Object.freeze({ name }),
    )),
  })]),
});
const cardsContract = Object.freeze({
  kind: 'documents',
  table: 'cards',
  document: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({ name: '_id', required: true, value: Object.freeze({ kind: 'id', table: 'cards' }) }),
      Object.freeze({ name: 'title', required: true, value: Object.freeze({ kind: 'string', maxBytes: 64 }) }),
      Object.freeze({ name: 'position', required: true, value: Object.freeze({ kind: 'integer', min: 0, max: 100 }) }),
      Object.freeze({ name: 'archived', required: true, value: Object.freeze({ kind: 'boolean' }) }),
      Object.freeze({ name: 'locked', required: true, value: Object.freeze({ kind: 'boolean' }) }),
    ]),
    allowExtra: false,
  }),
});
const mutationContract = Object.freeze({ kind: 'value', value: Object.freeze({ kind: 'boolean' }) });
const ARGUMENT_PROPERTIES = Object.freeze({
  id: Object.freeze({ type: 'string' }),
  title: Object.freeze({ type: 'string' }),
  position: Object.freeze({ type: 'integer' }),
});
const argsContract = Object.freeze({
  kind: 'object',
  fields: Object.freeze([
    Object.freeze({ name: 'id', required: false, value: Object.freeze({ kind: 'string' }) }),
    Object.freeze({ name: 'title', required: false, value: Object.freeze({ kind: 'string' }) }),
    Object.freeze({ name: 'position', required: false, value: Object.freeze({ kind: 'integer' }) }),
  ]),
  allowExtra: false,
});

const baseReference = (name, kind, resultContract, required = []) => ({
  artifactKind: 'functionReference',
  schemaVersion: ACTIVATION.schemaVersion,
  appId: ACTIVATION.appId,
  id: `${ACTIVATION.appId}:${name}`,
  name,
  kind,
  implementationHash: digest(name.length.toString(16).slice(-1)),
  argsContractHash: digest('4'),
  argsContract,
  argumentSchema: Object.freeze({
    type: 'object', additionalProperties: false, properties: ARGUMENT_PROPERTIES,
    required: Object.freeze(required),
  }),
  resultContractHash: resultContractHash(resultContract),
  resultContract,
  expectedGeneration: ACTIVATION,
});

const queryObject = baseReference('cards', 'LiveQuery', cardsContract);
const queryNodePlan = Object.freeze({
  format: 'snapback.node-plan.v1', classId: 'single_table_v1', classVersion: 1,
  normalizedPlan: Object.freeze({
    format: 'snapback.single-table-plan.v1',
    query: Object.freeze({
      table: 'cards', filters: Object.freeze([]),
      membershipFilters: Object.freeze([]), limit: null,
    }),
  }),
});
const queryNormalizedCompositePlan = Object.freeze({
  format: 'snapback.normalized-composite-plan.v1',
  profileId: 'single-node.v1',
  nodes: Object.freeze([Object.freeze({
    position: 0,
    nodePlanHash: hashRecord('snapback:node-plan:v1:', queryNodePlan),
    nodePlan: queryNodePlan,
  })]),
  classification: Object.freeze({ retention: 'none' }),
});
queryObject.composition = Object.freeze({
  planHash: hashRecord('snapback:plan-hash:v1:', queryNormalizedCompositePlan),
  normalizedCompositePlan: queryNormalizedCompositePlan,
  resultContract: cardsContract,
});
Object.defineProperty(queryObject, 'artifacts', {
  enumerable: false,
  value: Object.freeze({
    trustedCompositionActivation: Object.freeze({
      format: 'snapback.trusted-composition-activation.v1',
      activation: Object.freeze({
        format: 'snapback.composition-activation.v1',
        databaseId: 'react-generated-optimistic-db',
        deploymentId: 'react-generated-optimistic-deployment',
        targetProfileId: 'local-dev-sqlite-ibex',
        authMode: 'dev', expectedGeneration: ACTIVATION,
        proofKeyManifestDigest: digest('7'),
      }),
      activationHash: digest('8'),
      proofKeys: Object.freeze({
        format: 'snapback.completeness-proof-keys.v1', keys: Object.freeze([]),
      }),
    }),
  }),
});
const cards = Object.freeze(queryObject);

const mutationReference = (name, plan, {
  required = [], reads = [], mintSites = [], capabilityClass = 'local-executable',
} = {}) => {
  const reference = baseReference(name, 'Mutation', mutationContract, required);
  reference.mutationIr = Object.freeze({
    format: 'snapback.generated-mutation-ir.v1',
    operationHash: digest(name.charCodeAt(name.length - 1).toString(16).slice(-1)),
    sourceIdentity: Object.freeze({
      functionId: reference.id, implementationHash: reference.implementationHash,
      activation: ACTIVATION,
    }),
    schemaIdentity: Object.freeze({
      schemaVersion: ACTIVATION.schemaVersion, appId: ACTIVATION.appId,
      schemaHash: ACTIVATION.schemaHash,
    }),
    capabilityClass,
    capabilityCode: capabilityClass === 'local-executable'
      ? 'SNAPBACK_GENERATED_IR_LOCAL_EXECUTABLE'
      : 'SNAPBACK_GENERATED_IR_SERVER_ONLY',
    declaredEffectClass: BROWSER_IR_LOCAL_EFFECT_CLASS,
    declaredReads: Object.freeze(reads.length === 0 ? [] : ['cards']),
    localReadRequirements: Object.freeze(reads),
    schema: SCHEMA,
    plan: Object.freeze(plan),
    mintSites: Object.freeze(mintSites),
    usesRuntimeNow: false,
    boundedSkew: null,
  });
  return Object.freeze(reference);
};
const pointRead = Object.freeze([Object.freeze({
  kind: 'point', table: 'cards', idArg: 'id', binding: 'card',
  requiredFields: Object.freeze(['_id']),
})]);
const getCard = Object.freeze({ Get: Object.freeze({
  table: 'cards', id: Object.freeze({ Arg: 'id' }), bind_as: 'card',
  else_error: 'CARD_NOT_FOUND',
}) });
const createCard = mutationReference('createCard', {
  steps: Object.freeze([Object.freeze({ Insert: Object.freeze({
    table: 'cards',
    values: Object.freeze({
      title: Object.freeze({ Arg: 'title' }),
      position: Object.freeze({ Arg: 'position' }),
      archived: Object.freeze({ Literal: false }),
      locked: Object.freeze({ Literal: false }),
    }),
    bind_id_as: 'cardId',
  }) })]),
  return_value: Object.freeze({ Binding: 'cardId' }),
}, { required: ['title', 'position'], mintSites: ['plan/steps/0/insert/row-id'] });
const patchMutation = (name, field, expression, required = []) => mutationReference(name, {
  steps: Object.freeze([
    getCard,
    Object.freeze({ Patch: Object.freeze({
      table: 'cards', id: Object.freeze({ Arg: 'id' }),
      values: Object.freeze({ [field]: Object.freeze(expression) }),
    }) }),
  ]),
  return_value: 'ChangedCount',
}, { required: ['id', ...required], reads: pointRead });
const editCard = patchMutation('editCard', 'title', { Arg: 'title' }, ['title']);
const archiveCard = patchMutation('archiveCard', 'archived', { Literal: true });
const reorderCard = patchMutation('reorderCard', 'position', { Arg: 'position' }, ['position']);
const deleteCard = mutationReference('deleteCard', {
  steps: Object.freeze([
    getCard,
    Object.freeze({ Delete: Object.freeze({ table: 'cards', id: Object.freeze({ Arg: 'id' }) }) }),
  ]),
  return_value: 'ChangedCount',
}, { required: ['id'], reads: pointRead });
const serverOnlyCard = mutationReference('serverOnlyCard', {
  steps: Object.freeze([]),
  return_value: Object.freeze({ Literal: true }),
}, { required: ['id'], capabilityClass: 'server-only' });

const references = [
  cards, createCard, editCard, archiveCard, reorderCard, deleteCard, serverOnlyCard,
];
const functions = Object.freeze({
  artifactKind: 'functionManifest', schemaVersion: ACTIVATION.schemaVersion,
  appId: ACTIVATION.appId, bundleHash: ACTIVATION.bundleHash, inputsHash: ACTIVATION.inputsHash,
  functions: Object.freeze(references),
});
const descriptor = Object.freeze({
  format: 'snapback.app.v1',
  identity: Object.freeze({
    app: ACTIVATION.appId, schema: ACTIVATION.schemaHash,
    functions: ACTIVATION.bundleHash, descriptor: digest('9'),
  }),
  api: Object.freeze({
    queries: Object.freeze({ cards }),
    mutations: Object.freeze({
      createCard, editCard, archiveCard, reorderCard, deleteCard, serverOnlyCard,
    }),
    assets: Object.freeze({}), ephemeral: Object.freeze({}), queryGroups: Object.freeze({}),
  }),
  commands: Object.freeze({}), surfaces: Object.freeze({}),
  capabilities: Object.freeze({ required: Object.freeze([]) }),
});
const capabilityManifest = Object.freeze({
  artifactKind: 'capabilityManifest', schemaVersion: ACTIVATION.schemaVersion,
  targetProfileId: 'local-dev-sqlite-ibex', supportedCapabilities: Object.freeze(['live_subscriptions']),
});
const INITIAL_ROWS = Object.freeze([
  Object.freeze({ _id: 'card-1', title: 'One', position: 0, archived: false, locked: false }),
  Object.freeze({ _id: 'card-2', title: 'Two', position: 1, archived: false, locked: false }),
]);

const waitUntil = async (predicate, label) => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(`${label} did not become true`);
};
const fakeStreamManager = () => {
  const listeners = new Set();
  let open = true;
  return {
    isOpen: () => open,
    isReady: () => open,
    waitUntilReady: async () => {},
    onState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    settled: async () => {},
    inspection: () => ({ socketDemand: listeners.size }),
    emit(state, detail = {}) {
      if (state === 'open') open = true;
      if (state === 'lost' || state === 'closed') open = false;
      for (const listener of [...listeners]) listener(state, detail);
    },
  };
};
const prepareHost = async (store, rows = INITIAL_ROWS) => {
  const client = new SnapbackClient('https://react-generated-optimistic.test', {
    rqsStore: store, offlineQueue: true,
  });
  client.inspect = async () => ({
    targetProfileId: 'local-dev-sqlite-ibex', target: 'local-dev-sqlite-ibex',
    schema: { schemaHash: ACTIVATION.schemaHash, ephemeralCollections: [] },
    functions, capabilityManifest,
  });
  client.authSession = async () => ({ activeMode: 'dev', clientProtocols: {} });
  client.currentAuthorizationScope = async () => ({
    principalScope: {
      authMode: 'dev', authorizationStreamIncarnation: 'react-generated-incarnation', userId: null,
    },
    authorityDescriptor: {
      descriptorVersion: 1, authorityInstanceId: 'react-generated-authority', sessionGeneration: 1,
    },
  });
  client.subscribeLive = async () => ({
    subscription_id: 'react-generated-cards', snapshot: { rows: structuredClone(rows), version: 1 },
  });
  client.unsubscribeLive = async () => ({ disposed: true });
  const manager = fakeStreamManager();
  client.liveStreamManager = () => manager;
  let liveStart = null;
  const startLiveQuery = client.startLiveQuery.bind(client);
  client.startLiveQuery = (...args) => {
    liveStart = startLiveQuery(...args);
    return liveStart;
  };
  const binding = await prepareReactBindingForClient(client, { generatedManifest: descriptor });
  assert.equal(Object.prototype.propertyIsEnumerable.call(cards, 'artifacts'), false);
  assert.ok(binding.references.cards.artifacts?.trustedCompositionActivation);
  const provider = createSnapbackReactProvider(binding, { connectionId: 'react-generated-default' });
  const observer = observeSnapbackQueries(
    provider,
    { cards: { ref: binding.references.cards, args: {} } },
    () => {},
  );
  await waitUntil(() => observer.snapshot().queries.cards.status === 'ready', 'React query ready');
  return {
    client,
    binding,
    provider,
    observer,
    manager,
    get handle() { return liveStart?.current ?? null; },
  };
};

test('prepared React binding deep-freezes trusted composition and artifact clones', async () => {
  const store = createMemoryRqsResumeStore({ clientStoreId: 'react-generated-frozen-binding' });
  const host = await prepareHost(store);
  const admitted = host.binding.references.cards;
  const catalogDigest = host.binding.functionCatalogDigest;
  const table = admitted.composition.normalizedCompositePlan.nodes[0]
    .nodePlan.normalizedPlan.query.table;
  const databaseId = admitted.artifacts.trustedCompositionActivation.activation.databaseId;

  assert.equal(Object.isFrozen(admitted.composition), true);
  assert.equal(Object.isFrozen(admitted.composition.normalizedCompositePlan.nodes[0]), true);
  assert.equal(Object.isFrozen(admitted.artifacts), true);
  assert.equal(Object.isFrozen(admitted.artifacts.trustedCompositionActivation.activation), true);
  assert.throws(() => {
    admitted.composition.normalizedCompositePlan.nodes[0]
      .nodePlan.normalizedPlan.query.table = 'labels';
  }, TypeError);
  assert.throws(() => {
    admitted.artifacts.trustedCompositionActivation.activation.databaseId = 'mutated-db';
  }, TypeError);
  assert.equal(
    admitted.composition.normalizedCompositePlan.nodes[0].nodePlan.normalizedPlan.query.table,
    table,
  );
  assert.equal(
    admitted.artifacts.trustedCompositionActivation.activation.databaseId,
    databaseId,
  );
  assert.equal(host.binding.functionCatalogDigest, catalogDigest);

  host.observer.dispose();
  await host.provider.dispose();
  await store.close();
});

test('React preserves predicted presentation through pause stale and reconnect republishes', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createMemoryRqsResumeStore({ clientStoreId: 'react-generated-connection-predicted' });
  const host = await prepareHost(store);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    await gate;
    return Response.json({ result: true, version: 2 });
  };
  const dispatch = invokeSnapbackMutation(host.provider, host.binding.references.editCard, {
    id: 'card-1', title: 'Connection-stable prediction',
  });
  await waitUntil(
    () => host.observer.snapshot().queries.cards.optimisticPresentation?.status === 'predicted',
    'React predicted presentation',
  );
  const assertPredicted = (connection) => {
    const query = host.observer.snapshot().queries.cards;
    assert.equal(query.connection, connection);
    assert.equal(query.optimisticPresentation.status, 'predicted');
    assert.equal(query.answerClass, 'optimistic');
    assert.equal(query.data.find((row) => row._id === 'card-1').title, 'Connection-stable prediction');
  };

  await host.handle.pause();
  assertPredicted('disconnected');
  await host.handle.resume();
  await waitUntil(
    () => host.observer.snapshot().queries.cards.connection === 'live',
    'React predicted resume republish',
  );
  assertPredicted('live');
  host.manager.emit('lost');
  await waitUntil(
    () => host.observer.snapshot().queries.cards.connection === 'stale',
    'React predicted stale republish',
  );
  assertPredicted('stale');
  host.manager.emit('open');
  await waitUntil(
    () => host.observer.snapshot().queries.cards.connection === 'live',
    'React predicted reconnect republish',
  );
  assertPredicted('live');

  release();
  await dispatch;
  host.observer.dispose();
  await host.provider.dispose();
  await store.close();
});

test('React preserves pending-without-prediction through pause stale and reconnect republishes', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createMemoryRqsResumeStore({ clientStoreId: 'react-generated-connection-pending' });
  const host = await prepareHost(store);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    await gate;
    return Response.json({ result: true, version: 2 });
  };
  const dispatch = invokeSnapbackMutation(
    host.provider,
    host.binding.references.serverOnlyCard,
    { id: 'card-1' },
  );
  await waitUntil(
    () => host.observer.snapshot().queries.cards.optimisticPresentation?.status
      === 'pending-without-prediction',
    'React pending-without-prediction presentation',
  );
  const assertPending = (connection) => {
    const query = host.observer.snapshot().queries.cards;
    assert.equal(query.connection, connection);
    assert.equal(query.optimisticPresentation.status, 'pending-without-prediction');
    assert.equal(query.optimisticPresentation.queuedOnly.length, 1);
    assert.equal(query.answerClass, 'pending-without-prediction');
    assert.deepEqual(query.data, INITIAL_ROWS);
  };

  await host.handle.pause();
  assertPending('disconnected');
  await host.handle.resume();
  await waitUntil(
    () => host.observer.snapshot().queries.cards.connection === 'live',
    'React pending resume republish',
  );
  assertPending('live');
  host.manager.emit('lost');
  await waitUntil(
    () => host.observer.snapshot().queries.cards.connection === 'stale',
    'React pending stale republish',
  );
  assertPending('stale');
  host.manager.emit('open');
  await waitUntil(
    () => host.observer.snapshot().queries.cards.connection === 'live',
    'React pending reconnect republish',
  );
  assertPending('live');

  release();
  await dispatch;
  host.observer.dispose();
  await host.provider.dispose();
  await store.close();
});

test('React real SnapbackClient paints generated create, edit, archive, delete, and reorder without reducers', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createMemoryRqsResumeStore({ clientStoreId: 'react-generated-real-paint' });
  const host = await prepareHost(store);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    await gate;
    return Response.json({ result: true, version: 2 });
  };

  const calls = [];
  calls.push(invokeSnapbackMutation(host.provider, host.binding.references.createCard, {
    title: 'Created', position: 2,
  }));
  await waitUntil(
    () => host.observer.snapshot().queries.cards.data?.some((row) => row.title === 'Created'),
    'React generated create paint',
  );
  calls.push(invokeSnapbackMutation(host.provider, host.binding.references.editCard, {
    id: 'card-1', title: 'Edited',
  }));
  await waitUntil(
    () => host.observer.snapshot().queries.cards.data.find((row) => row._id === 'card-1').title === 'Edited',
    'React generated edit paint',
  );
  calls.push(invokeSnapbackMutation(host.provider, host.binding.references.archiveCard, { id: 'card-2' }));
  await waitUntil(
    () => host.observer.snapshot().queries.cards.data.find((row) => row._id === 'card-2').archived,
    'React generated archive paint',
  );
  calls.push(invokeSnapbackMutation(host.provider, host.binding.references.reorderCard, {
    id: 'card-1', position: 9,
  }));
  await waitUntil(
    () => host.observer.snapshot().queries.cards.data.find((row) => row._id === 'card-1').position === 9,
    'React generated reorder paint',
  );
  calls.push(invokeSnapbackMutation(host.provider, host.binding.references.deleteCard, { id: 'card-2' }));
  await waitUntil(
    () => !host.observer.snapshot().queries.cards.data.some((row) => row._id === 'card-2'),
    'React generated delete paint',
  );
  const query = host.observer.snapshot().queries.cards;
  assert.equal(query.optimisticPresentation.status, 'predicted');
  assert.equal(query.freshness, 'current');
  assert.equal(query.answerClass, 'optimistic');
  release();
  await Promise.all(calls);
  host.observer.dispose();
  await host.provider.dispose();
  await store.close();
});

test('React real SnapbackClient gives an app-authored reducer precedence over generated projection', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createMemoryRqsResumeStore({ clientStoreId: 'react-generated-real-reducer' });
  const host = await prepareHost(store);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    await gate;
    return Response.json({ result: true, version: 2 });
  };
  const dispatch = invokeSnapbackMutation(
    host.provider,
    host.binding.references.editCard,
    { id: 'card-1', title: 'Generated must not paint' },
    {
      optimistic: {
        query: host.binding.references.cards,
        args: {},
        update: (rows) => rows.map((row) => (
          row._id === 'card-1' ? { ...row, title: 'App reducer wins' } : row
        )),
        isAuthoritative: (rows) => rows.some((row) => row.title === 'App reducer wins'),
      },
    },
  );
  await waitUntil(
    () => host.observer.snapshot().queries.cards.data.find((row) => row._id === 'card-1').title
      === 'App reducer wins',
    'app reducer paint',
  );
  assert.notEqual(host.observer.snapshot().queries.cards.optimisticPresentation?.status, 'predicted');
  assert.equal(host.observer.snapshot().queries.cards.answerClass, 'optimistic');
  release();
  await dispatch;
  host.observer.dispose();
  await host.provider.dispose();
  await store.close();
});

test('React real SnapbackClient reconstructs the same generated layer after restart', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-react-generated-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const openStore = () => createFileRqsResumeStore({
    directory, clientStoreId: 'react-generated-real-restart',
  });
  globalThis.fetch = async () => { throw new TypeError('offline restart fixture'); };

  const firstStore = openStore();
  await firstStore.whenLockSettled();
  const first = await prepareHost(firstStore, []);
  const queued = await invokeSnapbackMutation(first.provider, first.binding.references.createCard, {
    title: 'Survives restart', position: 5,
  });
  assert.equal(queued.status, 'queued');
  await waitUntil(
    () => first.observer.snapshot().queries.cards.data?.length === 1,
    'first React provisional paint',
  );
  const beforeRestart = structuredClone(first.observer.snapshot().queries.cards.data);
  first.observer.dispose();
  await first.provider.dispose();
  await firstStore.close();

  const secondStore = openStore();
  await secondStore.whenLockSettled();
  const second = await prepareHost(secondStore, []);
  await waitUntil(
    () => second.observer.snapshot().queries.cards.data?.length === 1,
    'restarted React provisional replay',
  );
  assert.deepEqual(second.observer.snapshot().queries.cards.data, beforeRestart);
  assert.equal(
    second.observer.snapshot().queries.cards.optimisticPresentation.layers[0].clientMutationId,
    queued.clientMutationId,
  );
  second.observer.dispose();
  await second.provider.dispose();
  await secondStore.close();
});
