import assert from 'node:assert/strict';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  createSnapbackReactProvider,
  observeSnapbackOptimisticCreate,
} from './index.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const emittedWarnings = [];
const originalWarn = console.warn;
console.warn = (...args) => emittedWarnings.push(args);

const cardsContract = {
  kind: 'documents',
  table: 'cards',
  document: {
    kind: 'object',
    fields: [
      { name: '_id', required: true, value: { kind: 'id', table: 'cards' } },
      { name: '_version', required: true, value: { kind: 'integer', min: 0, max: 1_000 } },
      { name: '_createdAt', required: true, value: { kind: 'integer', min: 0, max: 1_000 } },
      { name: '_updatedAt', required: true, value: { kind: 'integer', min: 0, max: 1_000 } },
      { name: 'title', required: true, value: { kind: 'string', maxBytes: 64 } },
      { name: 'column', required: true, value: { kind: 'string', maxBytes: 16 } },
    ],
    allowExtra: false,
  },
};
const createResultContract = {
  kind: 'value',
  value: { kind: 'id', table: 'cards' },
};
const reference = (name, kind, resultContract, extra = {}) => Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'react-optimistic-create-fixture',
  id: `react-optimistic-create-fixture:${name}`,
  name,
  kind,
  implementationHash: `sha256:${name}-implementation`,
  argsContractHash: `sha256:${name}-args`,
  argumentSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      column: { type: 'string' },
    },
  },
  resultContractHash: resultContractHash(resultContract),
  resultContract,
  ...extra,
});
const cards = reference('cards', 'LiveQuery', cardsContract);
const createCard = reference('createCard', 'Mutation', createResultContract, {
  mutationIr: {
    format: 'snapback.generated-mutation-ir.v1',
    capabilityClass: 'local-executable',
    plan: { steps: [{ Insert: { table: 'cards' } }] },
  },
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'react-optimistic-create-fixture',
  bundleHash: 'sha256:react-optimistic-create-bundle',
  functions: [cards, createCard],
});

const canonical = (id, title, column = 'todo', version = 1) => Object.freeze({
  _id: id,
  _version: version,
  _createdAt: version,
  _updatedAt: version,
  title,
  column,
});

function fakeClient(initialRows) {
  const handles = new Set();
  const views = new Set();
  const attempts = [];
  const layers = [];
  const settled = [];
  let rows = initialRows;
  let sequence = 0;
  let authorityEpoch = 1;
  let barrier = null;
  let viewCreates = 0;

  const rebuildView = (entry) => {
    const retired = entry.retired;
    const active = layers.filter((layer) => !retired.has(layer.clientMutationId));
    entry.snapshot = Object.freeze({
      format: 'snapback.optimistic-rebase-snapshot.v1',
      revision: entry.snapshot.revision + 1,
      authoritativeRows: Object.freeze({ cards: entry.authoritativeRows }),
      visibleRows: Object.freeze({
        cards: Object.freeze([
          ...entry.authoritativeRows,
          ...active.map((layer) => layer.layer.writes[0].row),
        ]),
      }),
      layers: Object.freeze(active.map((layer) => Object.freeze({
        ...layer,
        layerStatus: layer.status === 'settled' ? 'bridging' : 'pending',
      }))),
      queuedOnly: Object.freeze([]),
      lastRebase: null,
    });
    for (const listener of [...entry.listeners]) listener();
  };
  const rebuildViews = () => {
    for (const view of views) rebuildView(view);
  };
  const removeLayer = (id) => {
    const index = layers.findIndex((layer) => layer.clientMutationId === id);
    if (index !== -1) layers.splice(index, 1);
    rebuildViews();
  };

  const client = {
    liveQuery() {},
    authorityFence: {
      capture: () => authorityEpoch,
      isCurrent: (capture) => capture === authorityEpoch,
    },
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:react-optimistic-create-schema' },
        functions,
        capabilityManifest: {
          artifactKind: 'capabilityManifest',
          schemaVersion: 'snapback.v0',
          targetProfileId: 'local-dev-sqlite-ibex',
          supportedCapabilities: ['live_subscriptions'],
        },
      };
    },
    async authSession() { return { activeMode: 'dev' }; },
    registerAuthBarrierParticipant(participant) {
      barrier = participant;
      return async () => { if (barrier === participant) barrier = null; };
    },
    liveStreamManager() { return { inspection: () => ({ socketDemand: 0 }), async settled() {} }; },
    startLiveQuery(_reference, options) {
      const handle = {
        current: { rows, connection: 'live' },
        started: async () => {},
        settled: async () => {},
        dispose() { handles.delete(handle); },
        emit(next) {
          rows = next;
          handle.current.rows = next;
          options.onUpdate(next);
        },
      };
      handles.add(handle);
      queueMicrotask(() => options.onUpdate(rows));
      return Object.freeze(handle);
    },
    async createOptimisticMutationView({ authoritativeRows }) {
      viewCreates += 1;
      const entry = {
        authoritativeRows: authoritativeRows.cards,
        retired: new Set(),
        listeners: new Set(),
        snapshot: {
          revision: 0,
          layers: [],
          queuedOnly: [],
          visibleRows: { cards: authoritativeRows.cards },
        },
      };
      const view = Object.freeze({
        getSnapshot: () => entry.snapshot,
        subscribe(listener) { entry.listeners.add(listener); return () => entry.listeners.delete(listener); },
        async rebase({ authoritativeRows: next = null, retiredSettlementIdentities = [] } = {}) {
          if (next?.cards) entry.authoritativeRows = next.cards;
          for (const id of retiredSettlementIdentities) entry.retired.add(id);
          rebuildView(entry);
          return {};
        },
        async refresh() { rebuildView(entry); return {}; },
        close() { views.delete(entry); entry.listeners.clear(); },
      });
      views.add(entry);
      rebuildView(entry);
      return view;
    },
    mutate(_reference, { args }) {
      const clientMutationId = `mut_${++sequence}`;
      const speculative = `spec_${sequence}`;
      const layer = {
        clientMutationId,
        sequence,
        status: 'pending',
        layer: {
          writes: [{
            operation: 'insert',
            table: 'cards',
            id: speculative,
            row: { _id: speculative, title: args.title, column: args.column },
          }],
        },
      };
      layers.push(layer);
      rebuildViews();
      let resolvePromise;
      let rejectPromise;
      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      const attempt = {
        args,
        clientMutationId,
        speculative,
        resolve(authoritative = `card_${sequence}`) {
          layer.status = 'settled';
          const settlement = {
            status: 'settled',
            result: authoritative,
            version: sequence,
            changed_count: 1,
            authorityDescriptor: { descriptorVersion: 1, authorityInstanceId: 'fixture', sessionGeneration: 1 },
            clientMutationId,
            receipt: { idMap: [{ speculative, authoritative, disposition: 'mapped' }] },
          };
          settled.push({ clientMutationId, settlement });
          rebuildViews();
          resolvePromise(settlement);
        },
        reject(code = 'SNAPBACK_CREATE_REFUSED') {
          removeLayer(clientMutationId);
          const error = new Error(code);
          error.code = code;
          rejectPromise(error);
        },
        queue() {
          resolvePromise({
            status: 'queued', queued: true, presentation: 'installed',
            clientMutationId, sequence,
          });
        },
        replay(authoritative) {
          layer.status = 'settled';
          const settlement = {
            result: authoritative,
            version: sequence,
            changed_count: 1,
            authorityDescriptor: { descriptorVersion: 1, authorityInstanceId: 'fixture', sessionGeneration: 1 },
            clientMutationId,
            receipt: { idMap: [{ speculative, authoritative, disposition: 'mapped' }] },
          };
          settled.push({ clientMutationId, settlement });
          rebuildViews();
        },
      };
      attempts.push(attempt);
      return promise;
    },
    settledMutations: async () => settled,
    emit(next) { for (const handle of handles) handle.emit(next); },
    async cutAuthority() {
      await barrier.quiesce();
      authorityEpoch += 1;
      barrier.blank();
      barrier.clearMemory();
      await barrier.resume();
    },
    inspection: () => ({
      attempts,
      handles: handles.size,
      views: views.size,
      viewCreates,
    }),
  };
  return client;
}

const client = fakeClient([canonical('card_0', 'Existing', 'todo')]);
const binding = await prepareReactBindingForClient(client, { generatedManifest: functions });
const provider = createSnapbackReactProvider(binding, { connectionId: 'optimistic-create-test' });
const select = (entities) => entities
  .filter((entity) => entity.fields.column === 'todo')
  .map((entity) => Object.freeze({ ...entity, columnTitle: 'To do' }))
  .sort((left, right) => left.fields.title.localeCompare(right.fields.title));
let observer = observeSnapbackOptimisticCreate(
  provider,
  createCard,
  { query: cards, args: {}, select },
  () => {},
);
await flush();
assert.equal(observer.snapshot().status, 'ready');
assert.deepEqual(observer.snapshot().data.map((entry) => entry.identity.kind), ['canonical']);

// Response before query: confirmation keeps the intent-keyed row bridged.
const responseFirst = observer.create({ title: 'Bravo', column: 'todo' });
await flush();
assert.deepEqual(
  observer.snapshot().data.map((entry) => [entry.identity.kind, entry.fields.title]),
  [['provisional', 'Bravo'], ['canonical', 'Existing']],
);
assert.equal(observer.snapshot().data[0].identity.id, 'mut_1');
assert.equal(Object.hasOwn(observer.snapshot().data[0].fields, '_id'), false);
client.inspection().attempts[0].resolve('card_1');
assert.deepEqual(await responseFirst, { status: 'settled', result: 'card_1' });
assert.equal(observer.snapshot().data[0].identity.kind, 'provisional');
client.emit([
  canonical('card_1', 'Bravo', 'todo', 2),
  canonical('card_0', 'Existing', 'todo'),
]);
await flush();
assert.deepEqual(observer.snapshot().data.map((entry) => entry.identity.kind), ['canonical', 'canonical']);

// Query before response: the new canonical row is held until idMap arrives,
// so no frame contains both it and its provisional predecessor.
const queryFirst = observer.create({ title: 'Alpha', column: 'todo' });
await flush();
client.emit([
  canonical('card_2', 'Alpha', 'todo', 3),
  canonical('card_1', 'Bravo', 'todo', 2),
  canonical('card_0', 'Existing', 'todo'),
]);
assert.equal(observer.snapshot().data.filter((entry) => entry.fields.title === 'Alpha').length, 1);
assert.equal(observer.snapshot().data[0].identity.kind, 'provisional');
client.inspection().attempts[1].resolve('card_2');
assert.deepEqual(await queryFirst, { status: 'settled', result: 'card_2' });
await flush();
assert.equal(observer.snapshot().data.filter((entry) => entry.fields.title === 'Alpha').length, 1);
assert.equal(observer.snapshot().data[0].identity.kind, 'canonical');

// Rejection retires only its own layer while the overlapping create remains.
const rejected = observer.create({ title: 'Delta', column: 'todo' });
const surviving = observer.create({ title: 'Charlie', column: 'todo' });
await flush();
assert.equal(observer.snapshot().data.filter((entry) => entry.identity.kind === 'provisional').length, 2);
client.inspection().attempts[2].reject('SNAPBACK_CARD_LOCKED');
await assert.rejects(rejected, (error) => error.code === 'SNAPBACK_CARD_LOCKED');
assert.deepEqual(
  observer.snapshot().data.filter((entry) => entry.identity.kind === 'provisional')
    .map((entry) => entry.fields.title),
  ['Charlie'],
);
client.inspection().attempts[3].resolve('card_4');
assert.deepEqual(await surviving, { status: 'settled', result: 'card_4' });
client.emit([
  canonical('card_2', 'Alpha', 'todo', 3),
  canonical('card_1', 'Bravo', 'todo', 2),
  canonical('card_4', 'Charlie', 'todo', 4),
  canonical('card_0', 'Existing', 'todo'),
]);
await flush();

// Strict Mode's release/remount microtask shares the provider view.
const sharedViewCreates = client.inspection().viewCreates;
observer.dispose();
observer = observeSnapbackOptimisticCreate(
  provider,
  createCard,
  { query: cards, args: {}, select },
  () => {},
);
await flush();
assert.equal(client.inspection().viewCreates, sharedViewCreates);

// Response-loss keeps one intent. Recovery observes the bridging settlement
// and consumes its exact idMap instead of minting a second provisional row.
const queued = observer.create({ title: 'Echo', column: 'todo' });
await flush();
client.inspection().attempts[4].queue();
assert.deepEqual(await queued, {
  status: 'queued',
  queued: true,
  presentation: 'installed',
  clientMutationId: 'mut_5',
  sequence: 5,
});
assert.equal(observer.snapshot().data.filter((entry) => entry.fields.title === 'Echo').length, 1);
client.emit([
  canonical('card_5', 'Echo', 'todo', 5),
  canonical('card_2', 'Alpha', 'todo', 3),
  canonical('card_1', 'Bravo', 'todo', 2),
  canonical('card_4', 'Charlie', 'todo', 4),
  canonical('card_0', 'Existing', 'todo'),
]);
client.inspection().attempts[4].replay('card_5');
await flush();
await flush();
assert.equal(observer.snapshot().data.filter((entry) => entry.fields.title === 'Echo').length, 1);
assert.equal(
  observer.snapshot().data.find((entry) => entry.fields.title === 'Echo').identity.kind,
  'canonical',
);

// Authority replacement closes predecessor projection ownership. A late
// response cannot republish it into the successor partition.
const stale = observer.create({ title: 'Foxtrot', column: 'todo' });
await flush();
await client.cutAuthority();
client.inspection().attempts[5].resolve('card_6');
await assert.rejects(stale, (error) => error.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE');
assert.equal(provider.inspection().provisionalCreates, 0);

observer.dispose();
await flush();
assert.equal(provider.inspection().optimisticCreateConsumers, 0);
await provider.dispose();
assert.equal(client.inspection().views, 0);
assert.equal(client.inspection().handles, 0);
assert.equal(
  emittedWarnings.some(([message]) => (
    String(message).includes('SNAPBACK_REACT_OPTIMISTIC_REPLAY_DIVERGENT')
  )),
  false,
  'the paved optimistic-create path must not emit the generic append-reducer advisory',
);
console.warn = originalWarn;

console.log('optimistic-create.test.mjs: typed provider projection, ordering, settlement, replay, authority, Strict Mode, and cleanup pass');
