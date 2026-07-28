import assert from 'node:assert/strict';
import React, { StrictMode, useMemo } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  canonicalizeClientValueV1,
} from '@snapback/client';
import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  observeSnapbackQueries,
  skip,
  useSnapbackConnection,
  useSnapbackMutation,
  useSnapbackQueries,
  useSnapbackQuery,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => new Promise((resolve) => setImmediate(resolve));

const queryResultContract = Object.freeze({
  kind: 'records',
  record: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({ name: 'id', required: true, value: { kind: 'string', maxBytes: 1_024 } }),
      Object.freeze({
        name: 'revision',
        required: true,
        value: { kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER },
      }),
    ]),
    allowExtra: false,
  }),
});
const mutationResultContract = Object.freeze({
  kind: 'value',
  value: Object.freeze({ kind: 'string', maxBytes: 1_024 }),
});
const reference = (name, kind, suffix) => {
  const resultContract = kind === 'Mutation' ? mutationResultContract : queryResultContract;
  return Object.freeze({
    artifactKind: 'functionReference',
    schemaVersion: 'snapback.v0',
    appId: 'react-fixture',
    id: `react-fixture:${name}`,
    name,
    kind,
    implementationHash: `sha256:implementation-${suffix}`,
    argsContractHash: `sha256:args-${suffix}`,
    resultContractHash: resultContractHash(resultContract),
    resultContract,
  });
};
const feed = reference('feed', 'LiveQuery', 'feed');
const details = reference('details', 'LiveQuery', 'details');
const publish = reference('publish', 'Mutation', 'publish');
const capacityFeeds = Object.freeze(
  Array.from({ length: 260 }, (_, index) => reference(
    `capacityFeed${index}`,
    'LiveQuery',
    `capacity-${index}`,
  )),
);
const generatedManifest = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'react-fixture',
  bundleHash: 'sha256:react-fixture-bundle',
  functions: Object.freeze([feed, details, publish, ...capacityFeeds]),
});

function createFakeClient() {
  const handles = new Set();
  const byFunction = new Map();
  let starts = 0;
  let mutations = 0;
  let bundleFetches = 0;
  let registeredStarts = 0;
  let ordinaryStarts = 0;
  const barriers = [];
  let barrierUnregistered = 0;
  const client = {
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:schema' },
        functions: generatedManifest,
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
      barriers.push(participant);
      return async () => { barrierUnregistered += 1; };
    },
    startLiveQuery(ref, options) {
      starts += 1;
      if (options.registeredSubscription) registeredStarts += 1;
      else ordinaryStarts += 1;
      let disposed = false;
      const rows = options.registeredSubscription?.rows
        ?? [{ id: `${ref.name}:${options.args?.id ?? 'root'}`, revision: 0 }];
      const current = {
        subscriptionId: options.registeredSubscription?.subscriptionId
          ?? `subscription-${starts}`,
        rows,
        connection: 'live',
      };
      const handle = {
        current,
        started: async () => {},
        dispose() {
          if (disposed) return;
          disposed = true;
          handles.delete(handle);
          byFunction.get(ref.id)?.delete(handle);
        },
        settled: async () => {},
        emit(nextRows, connection = 'live') {
          current.rows = nextRows;
          current.connection = connection;
          options.onUpdate?.(nextRows);
          options.onConnectionChange?.(connection);
        },
      };
      handles.add(handle);
      if (!byFunction.has(ref.id)) byFunction.set(ref.id, new Set());
      byFunction.get(ref.id).add(handle);
      return Object.freeze(handle);
    },
    async mutate(ref, { args }) {
      mutations += 1;
      return { result: `${ref.name}:${args.value}`, version: mutations };
    },
    async fetchBundle({ route, params, mode }) {
      bundleFetches += 1;
      assert.equal(route, '/workspace/:id');
      assert.equal(mode, 'register');
      return {
        commitVersion: 41,
        generation: 'generation-41',
        versionStream: 'stream-41',
        connection: {
          connectionId: 'registered-react-group',
          grant: '[adopted-by-client-owner]',
          attachDeadline: 10_000,
        },
        entries: [
          {
            function: 'feed',
            args: { id: params.id },
            rows: [{ id: `feed:${params.id}`, revision: 41 }],
            resume: null,
            subscriptionId: 'registered-feed',
          },
          {
            function: 'details',
            args: { id: params.id },
            rows: [{ id: `details:${params.id}`, revision: 41 }],
            resume: null,
            subscriptionId: 'registered-details',
          },
        ],
      };
    },
    emit(ref, rows, connection = 'live') {
      for (const handle of byFunction.get(ref.id) ?? []) handle.emit(rows, connection);
    },
    inspection() {
      return {
        starts,
        handles: handles.size,
        mutations,
        bundleFetches,
        registeredStarts,
        ordinaryStarts,
        barriers,
        barrierUnregistered,
      };
    },
  };
  return client;
}

const fake = createFakeClient();
const binding = await prepareReactBindingForClient(fake, { generatedManifest });
assert(Object.isFrozen(binding));
assert.equal(binding.appId, 'react-fixture');
assert.equal(binding.authMode, 'dev');
assert.match(binding.functionCatalogDigest, /^sha256:[0-9a-f]{64}$/);
assert.match(binding.capabilityDigest, /^sha256:[0-9a-f]{64}$/);
await assert.rejects(
  prepareReactBindingForClient(createFakeClient(), {
    generatedManifest: { ...generatedManifest, bundleHash: 'sha256:wrong' },
  }),
  (error) => error?.code === 'SNAPBACK_REACT_BINDING_MISMATCH',
);

assert.equal(canonicalizeClientValueV1({ b: -0, a: ['é'] }), '{"a":["é"],"b":0}');
assert.throws(
  () => canonicalizeClientValueV1(Object.defineProperty({}, 'value', { get() { return 1; }, enumerable: true })),
  (error) => error?.code === 'SNAPBACK_REACT_ARGS_INVALID',
);
assert.throws(
  () => canonicalizeClientValueV1(Array(1)),
  (error) => error?.code === 'SNAPBACK_REACT_ARGS_INVALID',
);
assert.equal(canonicalizeClientValueV1('x'.repeat(65_536)).length, 65_538);
assert.throws(
  () => canonicalizeClientValueV1('x'.repeat(65_537)),
  (error) => error?.code === 'SNAPBACK_REACT_ARGS_INVALID',
);
assert.doesNotThrow(() => canonicalizeClientValueV1(Array.from({ length: 1_024 }, () => null)));
assert.throws(
  () => canonicalizeClientValueV1(Array.from({ length: 1_025 }, () => null)),
  (error) => error?.code === 'SNAPBACK_REACT_ARGS_INVALID',
);
assert.doesNotThrow(() => canonicalizeClientValueV1(Object.fromEntries(
  Array.from({ length: 256 }, (_, index) => [`field${index}`, null]),
)));
assert.throws(
  () => canonicalizeClientValueV1(Object.fromEntries(
    Array.from({ length: 257 }, (_, index) => [`field${index}`, null]),
  )),
  (error) => error?.code === 'SNAPBACK_REACT_ARGS_INVALID',
);
const nested = (wrappers) => {
  let value = null;
  for (let index = 0; index < wrappers; index += 1) value = [value];
  return value;
};
assert.doesNotThrow(() => canonicalizeClientValueV1(nested(31)));
assert.throws(
  () => canonicalizeClientValueV1(nested(32)),
  (error) => error?.code === 'SNAPBACK_REACT_ARGS_INVALID',
);
const exactly4096Nodes = [
  ...Array.from({ length: 15 }, () => Array.from({ length: 271 }, () => null)),
  Array.from({ length: 14 }, () => null),
];
assert.doesNotThrow(() => canonicalizeClientValueV1(exactly4096Nodes));
exactly4096Nodes.at(-1).push(null);
assert.throws(
  () => canonicalizeClientValueV1(exactly4096Nodes),
  (error) => error?.code === 'SNAPBACK_REACT_ARGS_INVALID',
);
const exactly262144Bytes = [
  'x'.repeat(65_536),
  'x'.repeat(65_536),
  'x'.repeat(65_536),
  'x'.repeat(65_523),
];
assert.equal(
  new TextEncoder().encode(canonicalizeClientValueV1(exactly262144Bytes)).byteLength,
  262_144,
);
exactly262144Bytes[3] += 'x';
assert.throws(
  () => canonicalizeClientValueV1(exactly262144Bytes),
  (error) => error?.code === 'SNAPBACK_REACT_ARGS_INVALID',
);
assert.throws(
  () => canonicalizeClientValueV1('\ud800'),
  (error) => error?.code === 'SNAPBACK_REACT_ARGS_INVALID',
);
assert.throws(
  () => canonicalizeClientValueV1(new Proxy({}, {
    ownKeys() { throw new Error('proxy trap'); },
  })),
  (error) => error?.code === 'SNAPBACK_REACT_ARGS_INVALID',
);

const provider = createSnapbackReactProvider(binding, { connectionId: 'react-package-test' });
const siblingProvider = createSnapbackReactProvider(binding, { connectionId: 'react-package-test-2' });
assert.notEqual(provider.providerInstanceId, siblingProvider.providerInstanceId);

let latestSingle = null;
let latestGroup = null;
let latestConnection = null;
let mutate = null;

function Probe({ id }) {
  const query = useSnapbackQuery(feed, { id });
  latestSingle = query;
  return React.createElement('output', {
    kind: 'single',
    status: query.status,
    value: query.status === 'ready' || query.status === 'refreshing'
      ? query.data[0]?.id
      : 'none',
  });
}

function Group({ id, skipDetails = false }) {
  const entries = useMemo(() => ({
    feed: { ref: feed, args: { id } },
    details: { ref: details, args: skipDetails ? skip : { id } },
  }), [id, skipDetails]);
  latestGroup = useSnapbackQueries(entries);
  latestConnection = useSnapbackConnection();
  mutate = useSnapbackMutation(publish);
  return React.createElement('output', {
    kind: 'group',
    status: latestGroup.status,
    connection: latestGroup.connection,
    active: latestConnection.activeSubscriptions,
  });
}

function App({ id = 'a', skipDetails = false }) {
  return React.createElement(
    SnapbackProvider,
    { provider },
    React.createElement(Probe, { id }),
    React.createElement(Group, { id, skipDetails }),
  );
}

let renderer;
await act(async () => {
  renderer = TestRenderer.create(React.createElement(StrictMode, null, React.createElement(App)));
  await flush();
});
assert.equal(latestSingle.status, 'ready');
assert.equal(latestGroup.status, 'ready');
assert.equal(fake.inspection().handles, 2, 'single and group share the feed upstream');
assert.equal(provider.inspection().consumers, 3, 'one hook plus two non-skipped group children');
assert.equal(provider.inspection().serverSubscriptions, 2);
assert.equal(latestConnection.activeSubscriptions, 2);

await act(async () => {
  fake.emit(feed, [{ id: 'feed:a', revision: 1 }], 'stale');
  await flush();
});
assert.equal(latestSingle.status, 'refreshing');
assert.equal(latestSingle.connection, 'stale');
assert.equal(latestGroup.status, 'refreshing');

assert.equal(await mutate({ value: 'changed' }), 'publish:changed');
assert.equal(fake.inspection().mutations, 1);

await act(async () => {
  renderer.update(React.createElement(StrictMode, null, React.createElement(App, {
    id: 'b',
    skipDetails: true,
  })));
  await flush();
});
assert.equal(latestGroup.queries.details.status, 'skipped');
assert.equal(provider.inspection().consumers, 2);
assert.equal(provider.inspection().serverSubscriptions, 1);

await act(async () => {
  await fake.inspection().barriers[0].quiesce({});
  fake.inspection().barriers[0].blank({});
  await flush();
});
assert.equal(latestSingle.status, 'pending');
assert.equal(latestSingle.data, undefined);
await act(async () => {
  await fake.inspection().barriers[0].resume({});
  await flush();
});
assert.equal(provider.inspection().serverSubscriptions, 1);

await act(async () => {
  renderer.unmount();
  await flush();
});
await provider.dispose();
assert.deepEqual(
  {
    stores: provider.inspection().stores,
    consumers: provider.inspection().consumers,
    subscriptions: provider.inspection().serverSubscriptions,
    leases: provider.inspection().leases,
    timers: provider.inspection().timers,
    listeners: provider.inspection().listeners,
  },
  { stores: 0, consumers: 0, subscriptions: 0, leases: 0, timers: 0, listeners: 0 },
);
assert.equal(fake.inspection().handles, 0);
assert.equal(fake.inspection().barrierUnregistered, 1);
await siblingProvider.dispose();

const primedFake = createFakeClient();
const routes = Object.freeze({
  formatVersion: 1,
  app: 'react-fixture',
  routes: Object.freeze([
    Object.freeze({
      route: '/workspace/:id',
      queries: Object.freeze([
        Object.freeze({ function: 'feed', args: { id: { $param: 'id' } } }),
        Object.freeze({ function: 'details', args: { id: { $param: 'id' } } }),
      ]),
    }),
  ]),
});
const primedBinding = await prepareReactBindingForClient(primedFake, {
  generatedManifest: { functions: generatedManifest, routes },
});
const generatedGroup = primedBinding.groups['/workspace/:id'];
assert.equal(generatedGroup.artifactKind, 'queryGroupReference');
assert.match(generatedGroup.definitionHash, /^sha256:[0-9a-f]{64}$/);
await assert.rejects(
  primedBinding.prepareQueryGroup(
    { ...generatedGroup, definitionHash: 'sha256:forged-group' },
    { id: 'incident-41' },
  ),
  (error) => error?.code === 'SNAPBACK_REACT_GROUP_REFERENCE_INVALID',
);
await assert.rejects(
  primedBinding.prepareQueryGroup(generatedGroup, {}),
  (error) => error?.code === 'SNAPBACK_REACT_GROUP_PARAMS_INVALID',
);
const primedGroup = await primedBinding.prepareQueryGroup(
  generatedGroup,
  { id: 'incident-41' },
);
assert.equal(primedGroup.source, 'registered-bundle');
assert.deepEqual(primedGroup.boot, {
  source: 'registered-bundle',
  commitVersion: 41,
  generation: 'generation-41',
  versionStream: 'stream-41',
});
const primedProvider = createSnapbackReactProvider(primedBinding, {
  preparedGroup: primedGroup,
});
let primedSnapshot = null;
const primedObserver = observeSnapbackQueries(
  primedProvider,
  primedGroup,
  (snapshot) => { primedSnapshot = snapshot; },
);
await flush();
assert.equal(primedSnapshot.status, 'ready');
assert.equal(primedSnapshot.queries.feed.data[0].revision, 41);
assert.equal(primedSnapshot.queries.details.data[0].revision, 41);
assert.equal(primedSnapshot.boot, primedGroup.boot);
assert.deepEqual(
  {
    bundleFetches: primedFake.inspection().bundleFetches,
    registeredStarts: primedFake.inspection().registeredStarts,
    ordinaryStarts: primedFake.inspection().ordinaryStarts,
    remainingRegistrations: primedProvider.inspection().preparedRegistrations,
  },
  {
    bundleFetches: 1,
    registeredStarts: 2,
    ordinaryStarts: 0,
    remainingRegistrations: 0,
  },
  'one register-mode bundle primes both children and no prime/subscribe race opens ordinary starts',
);
primedObserver.dispose();
await flush();
await primedProvider.dispose();

const fallbackFake = createFakeClient();
fallbackFake.fetchBundle = async () => {
  const error = new Error('register-mode bundles are unavailable on this target');
  error.code = 'SNAPBACK_BUNDLE_REGISTER_UNAVAILABLE';
  throw error;
};
const fallbackBinding = await prepareReactBindingForClient(fallbackFake, {
  generatedManifest: { functions: generatedManifest, routes },
});
const fallbackGroup = await fallbackBinding.prepareQueryGroup(
  fallbackBinding.groups['/workspace/:id'],
  { id: 'incident-fallback' },
  { fallbackToLive: true },
);
assert.equal(fallbackGroup.source, 'live-fallback');
assert.equal(fallbackGroup.boot, null);
const fallbackProvider = createSnapbackReactProvider(fallbackBinding, {
  preparedGroup: fallbackGroup,
});
const fallbackObserver = observeSnapbackQueries(
  fallbackProvider,
  fallbackGroup,
  () => {},
);
await flush();
assert.equal(fallbackObserver.snapshot().status, 'ready');
assert.equal(fallbackObserver.snapshot().boot, null);
assert.equal(fallbackFake.inspection().registeredStarts, 0);
assert.equal(fallbackFake.inspection().ordinaryStarts, 2);
fallbackObserver.dispose();
await flush();
await fallbackProvider.dispose();

const capacityProvider = createSnapbackReactProvider(binding, {
  connectionId: 'react-package-capacity-test',
});
const entries = (indexes) => Object.fromEntries(indexes.map((index) => [
  `entry${index}`,
  { ref: capacityFeeds[index], args: {} },
]));
assert.throws(
  () => observeSnapbackQueries(
    capacityProvider,
    entries(Array.from({ length: 65 }, (_, index) => index)),
    () => {},
  ),
  (error) => error?.code === 'SNAPBACK_REACT_GROUP_CAPACITY',
  'a 65-entry group must refuse before attachment',
);
assert.equal(capacityProvider.inspection().serverSubscriptions, 0);

const fullGroup = observeSnapbackQueries(
  capacityProvider,
  entries(Array.from({ length: 64 }, (_, index) => index)),
  () => {},
);
await flush();
assert.equal(capacityProvider.inspection().serverSubscriptions, 64);

const oneForOne = entries(Array.from({ length: 64 }, (_, index) => index));
delete oneForOne.entry63;
oneForOne.entry64 = { ref: capacityFeeds[64], args: {} };
fullGroup.update(oneForOne);
await flush();
assert.equal(capacityProvider.inspection().serverSubscriptions, 64);

const multiReplacement = { ...oneForOne };
delete multiReplacement.entry61;
delete multiReplacement.entry62;
multiReplacement.entry65 = { ref: capacityFeeds[65], args: {} };
multiReplacement.entry66 = { ref: capacityFeeds[66], args: {} };
assert.throws(
  () => fullGroup.update(multiReplacement),
  (error) => error?.code === 'SNAPBACK_REACT_GROUP_CAPACITY',
  'a saturated multi-entry replacement must refuse atomically',
);
assert.equal(capacityProvider.inspection().serverSubscriptions, 64);
assert.equal(fullGroup.snapshot().queries.entry61.status, 'ready');

const shared = observeSnapbackQueries(capacityProvider, {
  shared: { ref: capacityFeeds[60], args: {} },
}, () => {});
const sharedReplacement = { ...oneForOne };
delete sharedReplacement.entry60;
sharedReplacement.entry67 = { ref: capacityFeeds[67], args: {} };
assert.throws(
  () => fullGroup.update(sharedReplacement),
  (error) => error?.code === 'SNAPBACK_REACT_GROUP_CAPACITY',
  'a saturated shared-predecessor replacement must refuse atomically',
);
assert.equal(capacityProvider.inspection().serverSubscriptions, 64);
shared.dispose();
fullGroup.dispose();
await flush();
await capacityProvider.dispose();

const consumerProvider = createSnapbackReactProvider(binding, {
  connectionId: 'react-package-consumer-cap-test',
});
const sameDescriptor = consumerProvider.registry.descriptor(capacityFeeds[0], {});
const consumerLeases = Array.from(
  { length: 1_024 },
  () => consumerProvider.registry.subscribe(sameDescriptor, () => {}),
);
assert.equal(consumerProvider.inspection().consumers, 1_024);
assert.throws(
  () => consumerProvider.registry.subscribe(sameDescriptor, () => {}),
  (error) => error?.code === 'SNAPBACK_REACT_STORE_CAPACITY',
  'the 1,025th committed consumer must refuse',
);
assert.equal(consumerProvider.inspection().consumers, 1_024);
for (const lease of consumerLeases) lease.release();
await flush();
await consumerProvider.dispose();

const storeProvider = createSnapbackReactProvider(binding, {
  connectionId: 'react-package-store-cap-test',
});
await fake.inspection().barriers.at(-1).quiesce({});
const storeLeases = Array.from({ length: 256 }, (_, index) => {
  const descriptor = storeProvider.registry.descriptor(capacityFeeds[0], { index });
  return storeProvider.registry.subscribe(descriptor, () => {});
});
assert.equal(storeProvider.inspection().stores, 256);
assert.throws(
  () => storeProvider.registry.subscribe(
    storeProvider.registry.descriptor(capacityFeeds[0], { index: 256 }),
    () => {},
  ),
  (error) => error?.code === 'SNAPBACK_REACT_STORE_CAPACITY',
  'the 257th distinct cached store must refuse before attachment',
);
assert.equal(storeProvider.inspection().stores, 256);
for (const lease of storeLeases) lease.release();
await flush();
await storeProvider.dispose();

console.log('package.test.mjs: prepared binding, provider registry, exact caps, groups, mutation, custody blanking, and cleanup pass');
