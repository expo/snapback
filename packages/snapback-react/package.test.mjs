import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import React, { StrictMode, useMemo } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  canonicalizeClientValueV1,
} from '@expo/snapback-client';
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
const plainDetails = reference('plainDetails', 'Query', 'plain-details');
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
  functions: Object.freeze([feed, details, plainDetails, publish, ...capacityFeeds]),
});

function createFakeClient({
  registeredBundleAvailable = true,
  mixedBundleAvailable = registeredBundleAvailable,
  attachDeadlineOffsetMs = 60_000,
  bundleError = null,
  authMode = 'dev',
  authInvalidationProtocol = 1,
  routeManifestHash = 'sha256:f5f932754bef8663f6097c5e1cb5135cabdb522f19e277a244d4e9646b7cd1c8',
  deferRegisteredFunction = null,
  managerSocketDemand = 0,
} = {}) {
  const handles = new Set();
  const byFunction = new Map();
  const durableConsumers = new Set();
  const startOptions = [];
  const mutationOptions = [];
  let starts = 0;
  let mutations = 0;
  let bundleFetches = 0;
  let registeredStarts = 0;
  let ordinaryStarts = 0;
  let namespaceSequence = 0;
  let disconnects = 0;
  let releases = 0;
  let managerCloses = 0;
  let registeredRetirements = 0;
  const serverRegistrations = new Set();
  const barriers = [];
  let barrierUnregistered = 0;
  const client = {
    authProtocols: authInvalidationProtocol === null
      ? {}
      : { authInvalidation: authInvalidationProtocol },
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:schema' },
        functions: generatedManifest,
        routeManifestHash,
        capabilityManifest: {
          artifactKind: 'capabilityManifest',
          schemaVersion: 'snapback.v0',
          targetProfileId: 'local-dev-sqlite-ibex',
          supportedCapabilities: [
            'live_subscriptions',
            ...(registeredBundleAvailable ? ['registered_bundle_boot_v1'] : []),
            ...(mixedBundleAvailable ? ['mixed_bundle_boot_v2'] : []),
          ],
        },
      };
    },
    async authSession() { return { activeMode: authMode }; },
    allocateLiveQueryNamespace(ref, args) {
      namespaceSequence += 1;
      return Object.freeze({
        clientStoreId: 'react-package-store',
        queryKey: `${ref.name}:${canonicalizeClientValueV1(args)}`,
        queryInstanceId: namespaceSequence,
      });
    },
    async disconnect() { disconnects += 1; },
    liveStreamManager() {
      return {
        close() { managerCloses += 1; },
        inspection() {
          return { socketDemand: managerSocketDemand + handles.size };
        },
      };
    },
    async releaseConnection(_connectionId, { ifIdle = false } = {}) {
      if (ifIdle && managerSocketDemand > 0) {
        return { released: false, reason: 'shared-demand' };
      }
      releases += 1;
      return { released: true, attached: true };
    },
    async unsubscribeLive(_ref, { subscriptionId } = {}) {
      if (serverRegistrations.delete(subscriptionId)) registeredRetirements += 1;
      return { removed: true };
    },
    registerAuthBarrierParticipant(participant) {
      barriers.push(participant);
      return async () => { barrierUnregistered += 1; };
    },
    registerDurableConsumer(_connectionId, consumer) {
      durableConsumers.add(consumer);
      return () => durableConsumers.delete(consumer);
    },
    startLiveQuery(ref, options) {
      starts += 1;
      startOptions.push(Object.freeze({
        function: ref.name,
        supersedesSubscriptionId: options.supersedesSubscriptionId ?? null,
        registered: options.registeredSubscription !== undefined,
        userId: options.userId ?? null,
      }));
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
      let resolveStarted = () => {};
      const started = deferRegisteredFunction === ref.name && options.registeredSubscription
        ? new Promise((resolve) => { resolveStarted = resolve; })
        : Promise.resolve();
      const handle = {
        current,
        started: () => started,
        dispose() {
          if (disposed) return;
          disposed = true;
          resolveStarted();
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
    async mutate(ref, { args, userId = null }) {
      mutations += 1;
      mutationOptions.push(Object.freeze({ function: ref.name, userId }));
      return { result: `${ref.name}:${args.value}`, version: mutations };
    },
    async fetchBundle({
      route,
      params,
      mode,
      authorizationNamespaces,
      authInvalidationProtocol: requestedAuthInvalidationProtocol,
      formatVersion,
      profile,
      planHash,
    }) {
      bundleFetches += 1;
      const mixed = route === '/mixed/:id';
      assert(['/workspace/:id', '/mixed/:id'].includes(route));
      assert.equal(mode, 'register');
      assert.equal(
        authorizationNamespaces.length,
        authMode === 'sessions' ? 2 : 0,
      );
      if (mixed) {
        assert.equal(formatVersion, 2);
        assert.equal(profile, 'mixed-route.v2');
        assert.equal(planHash, `sha256:${'a'.repeat(64)}`);
        const entries = [
          {
            function: 'feed',
            args: { id: params.id },
            rows: [{ id: `feed:${params.id}`, revision: 51 }],
            resume: null,
            subscriptionId: 'registered-mixed-feed',
            delivery: { kind: 'registered-live', nodePlanHash: `sha256:${'1'.repeat(64)}` },
          },
          {
            function: 'plainDetails',
            args: { id: params.id },
            rows: [{ id: `plain:${params.id}`, revision: 51 }],
            resume: null,
            delivery: { kind: 'read-only', nodePlanHash: `sha256:${'2'.repeat(64)}` },
          },
        ];
        serverRegistrations.add(entries[0].subscriptionId);
        return {
          formatVersion: 2,
          profile: 'mixed-route.v2',
          planHash,
          aggregate: {
            kind: 'mixed',
            weakest: 'read-only',
            liveChildren: 1,
            readOnlyChildren: 1,
          },
          commitVersion: 51,
          generation: 'generation-51',
          versionStream: 'stream-51',
          connection: {
            connectionId: 'registered-mixed-group',
            grant: '[adopted-mixed-owner]',
            attachDeadline: Date.now() + attachDeadlineOffsetMs,
          },
          entries,
        };
      }
      assert.equal(
        requestedAuthInvalidationProtocol,
        authMode === 'sessions' ? 1 : null,
      );
      if (bundleError !== null) throw bundleError;
      const entries = [
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
      ];
      for (const entry of entries) serverRegistrations.add(entry.subscriptionId);
      return {
        commitVersion: 41,
        generation: 'generation-41',
        versionStream: 'stream-41',
        connection: {
          connectionId: 'registered-react-group',
          grant: '[adopted-by-client-owner]',
          attachDeadline: Date.now() + attachDeadlineOffsetMs,
        },
        entries,
      };
    },
    emit(ref, rows, connection = 'live') {
      for (const handle of byFunction.get(ref.id) ?? []) handle.emit(rows, connection);
    },
    emitDurable(frame) {
      for (const consumer of durableConsumers) consumer(frame);
    },
    inspection() {
      return {
        starts,
        handles: handles.size,
        mutations,
        bundleFetches,
        registeredStarts,
        ordinaryStarts,
        namespaceSequence,
        disconnects,
        releases,
        managerCloses,
        registeredRetirements,
        serverRegistrations: serverRegistrations.size,
        barriers,
        barrierUnregistered,
        durableConsumers: durableConsumers.size,
        startOptions,
        mutationOptions,
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
    developmentSync: false,
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
assert.equal(fake.inspection().disconnects, 0, 'provider disposal never uses admin disconnect');
assert.equal(fake.inspection().releases, 1, 'final ordinary provider releases its idle grant');
await siblingProvider.dispose();

const primedFake = createFakeClient();
const routes = Object.freeze({
  formatVersion: 1,
  app: 'react-fixture',
  routes: Object.freeze([
    Object.freeze({
      route: '/workspace/:id',
      registerGroupEligible: true,
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
const ineligibleRoutes = Object.freeze({
  formatVersion: 1,
  app: 'react-fixture',
  routes: Object.freeze([
    Object.freeze({
      route: '/rank/:rank',
      queries: Object.freeze([
        Object.freeze({ function: 'feed', args: { id: { $param: 'rank' } } }),
      ]),
    }),
  ]),
});
const ineligibleRouteManifestHash = `sha256:${createHash('sha256')
  .update(canonicalizeClientValueV1(ineligibleRoutes))
  .digest('hex')}`;
const ineligibleBinding = await prepareReactBindingForClient(
  createFakeClient({ routeManifestHash: ineligibleRouteManifestHash }),
  { generatedManifest: { functions: generatedManifest, routes: ineligibleRoutes } },
);
assert.equal(
  Object.hasOwn(ineligibleBinding.groups, '/rank/:rank'),
  false,
  'the binding mirrors codegen eligibility instead of materializing non-string route params',
);
const mixedRoutes = Object.freeze({
  formatVersion: 1,
  app: 'react-fixture',
  routes: Object.freeze([
    Object.freeze({
      route: '/mixed/:id',
      mixedGroupEligible: true,
      mixedProfile: Object.freeze({
        formatVersion: 2,
        profile: 'mixed-route.v2',
        planHash: `sha256:${'a'.repeat(64)}`,
        normalizedCompositePlan: Object.freeze({
          nodes: Object.freeze([
            Object.freeze({
              nodePlan: Object.freeze({ capability: Object.freeze({ exportKind: 'LiveQuery' }) }),
              nodePlanHash: `sha256:${'1'.repeat(64)}`,
            }),
            Object.freeze({
              nodePlan: Object.freeze({ capability: Object.freeze({ exportKind: 'Query' }) }),
              nodePlanHash: `sha256:${'2'.repeat(64)}`,
            }),
          ]),
        }),
      }),
      queries: Object.freeze([
        Object.freeze({ function: 'feed', args: { id: { $param: 'id' } } }),
        Object.freeze({ function: 'plainDetails', args: { id: { $param: 'id' } } }),
      ]),
    }),
  ]),
});
const mixedRouteManifestHash = `sha256:${createHash('sha256')
  .update(canonicalizeClientValueV1(mixedRoutes))
  .digest('hex')}`;
const mixedFake = createFakeClient({ routeManifestHash: mixedRouteManifestHash });
const mixedBinding = await prepareReactBindingForClient(mixedFake, {
  generatedManifest: { functions: generatedManifest, routes: mixedRoutes },
});
const mixedReference = mixedBinding.groups['/mixed/:id'];
assert.equal(mixedReference.formatVersion, 2);
assert.deepEqual(mixedReference.queries.map((entry) => entry.ref.kind), ['LiveQuery', 'Query']);
assert.deepEqual(
  mixedReference.queries.map((entry) => entry.nodePlanHash),
  [`sha256:${'1'.repeat(64)}`, `sha256:${'2'.repeat(64)}`],
);
const mixedPrepared = await mixedBinding.prepareQueryGroup(
  mixedReference,
  { id: 'incident-51' },
);
const mixedProvider = createSnapbackReactProvider(mixedBinding, {
  preparedGroup: mixedPrepared,
});
let mixedSnapshot = null;
const mixedObserver = observeSnapbackQueries(
  mixedProvider,
  mixedPrepared,
  (snapshot) => { mixedSnapshot = snapshot; },
);
await flush();
assert.equal(mixedSnapshot.status, 'ready');
assert.equal(mixedSnapshot.queries.feed.data[0].revision, 51);
assert.equal(mixedSnapshot.queries.plainDetails.data[0].revision, 51);
assert.equal(mixedSnapshot.queries.feed.connection, 'live');
assert.equal(mixedSnapshot.queries.plainDetails.connection, 'idle');
assert.equal(mixedSnapshot.queries.plainDetails.freshness, 'snapshot');
assert.equal(mixedSnapshot.queries.feed.bootDelivery, 'registered-live');
assert.equal(mixedSnapshot.queries.plainDetails.bootDelivery, 'read-only');
assert.equal(mixedSnapshot.connection, 'idle', 'group reports its weakest child state');
assert.deepEqual(
  {
    profile: mixedSnapshot.boot.profile,
    weakest: mixedSnapshot.boot.weakest,
    liveChildren: mixedSnapshot.boot.liveChildren,
    readOnlyChildren: mixedSnapshot.boot.readOnlyChildren,
  },
  {
    profile: 'mixed-route.v2',
    weakest: 'read-only',
    liveChildren: 1,
    readOnlyChildren: 1,
  },
);
assert.deepEqual(
  {
    registeredStarts: mixedFake.inspection().registeredStarts,
    ordinaryStarts: mixedFake.inspection().ordinaryStarts,
    remainingRegistrations: mixedProvider.inspection().preparedRegistrations,
  },
  { registeredStarts: 1, ordinaryStarts: 0, remainingRegistrations: 0 },
  'only the identity-live child adopts a durable registration',
);
mixedObserver.dispose();
await flush();
await mixedProvider.dispose();

const mixedUnavailableFake = createFakeClient({
  mixedBundleAvailable: false,
  routeManifestHash: mixedRouteManifestHash,
});
const mixedUnavailableBinding = await prepareReactBindingForClient(mixedUnavailableFake, {
  generatedManifest: { functions: generatedManifest, routes: mixedRoutes },
});
await assert.rejects(
  mixedUnavailableBinding.prepareQueryGroup(
    mixedUnavailableBinding.groups['/mixed/:id'],
    { id: 'incident-no-mixed-capability' },
    { fallbackToLive: true },
  ),
  (error) => error?.code === 'SNAPBACK_REACT_GROUP_REGISTER_UNAVAILABLE',
  'a mixed group cannot pretend its ordinary Query child has a live fallback',
);
const duplicateRoutes = Object.freeze({
  formatVersion: 1,
  app: 'react-fixture',
  routes: Object.freeze([
    Object.freeze({
      route: '/duplicate/:id',
      registerGroupEligible: true,
      queries: Object.freeze([
        Object.freeze({ function: 'feed', args: { id: { $param: 'id' } } }),
        Object.freeze({ function: 'feed', args: { id: { $param: 'id' } } }),
      ]),
    }),
  ]),
});
const duplicateRouteManifestHash = `sha256:${createHash('sha256')
  .update(canonicalizeClientValueV1(duplicateRoutes))
  .digest('hex')}`;
const duplicateFake = createFakeClient({
  routeManifestHash: duplicateRouteManifestHash,
});
const duplicateBinding = await prepareReactBindingForClient(duplicateFake, {
  generatedManifest: { functions: generatedManifest, routes: duplicateRoutes },
});
await assert.rejects(
  duplicateBinding.prepareQueryGroup(
    duplicateBinding.groups['/duplicate/:id'],
    { id: 'same' },
  ),
  (error) => error?.code === 'SNAPBACK_REACT_GROUP_DUPLICATE_CHILD',
  'identical canonical children refuse before positional registrations can leak',
);
assert.equal(duplicateFake.inspection().bundleFetches, 0);
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
assert(
  Object.getOwnPropertySymbols(primedGroup)
    .every((symbol) => typeof primedGroup[symbol] !== 'object'),
  'reflection cannot discover the private preparation owner',
);
assert.deepEqual(primedGroup.boot, {
  source: 'registered-bundle',
  commitVersion: 41,
  generation: 'generation-41',
  versionStream: 'stream-41',
  attachDeadline: primedGroup.boot.attachDeadline,
});
assert.equal(
  Object.prototype.hasOwnProperty.call(primedGroup, 'connectionId'),
  false,
  'the public preparation does not expose its connection handle',
);
assert.deepEqual(
  primedGroup.entries.map((entry) => Object.keys(entry).sort()),
  [['args', 'name', 'ref'], ['args', 'name', 'ref']],
  'the public preparation exposes safe generated identity only',
);
assert.doesNotMatch(
  JSON.stringify(primedGroup),
  /registered-feed|registered-details|revision|authorization|resume/,
  'rows, subscriptions, authorization, and resume state remain private',
);
const primedProvider = createSnapbackReactProvider(primedBinding, {
  preparedGroup: primedGroup,
});
assert.equal(
  primedProvider.registry.preparedGroup,
  undefined,
  'the transferred preparation owner is not reachable through public provider properties',
);
assert.throws(
  () => createSnapbackReactProvider(primedBinding, { preparedGroup: primedGroup }),
  (error) => error?.code === 'SNAPBACK_REACT_GROUP_ALREADY_CONSUMED',
  'a prepared bundle capability transfers to exactly one provider',
);
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
assert.equal(primedFake.inspection().releases, 1);
assert.equal(
  primedFake.inspection().disconnects,
  0,
  'adopted registered provider disposal retires child handles without admin disconnect',
);

const unadoptedFake = createFakeClient();
const unadoptedBinding = await prepareReactBindingForClient(unadoptedFake, {
  generatedManifest: { functions: generatedManifest, routes },
});
const unadoptedGroup = await unadoptedBinding.prepareQueryGroup(
  unadoptedBinding.groups['/workspace/:id'],
  { id: 'incident-unadopted' },
);
const unadoptedProvider = createSnapbackReactProvider(unadoptedBinding, {
  preparedGroup: unadoptedGroup,
});
await unadoptedProvider.dispose();
assert.equal(unadoptedFake.inspection().releases, 1);
assert.equal(unadoptedFake.inspection().disconnects, 0);

const lazyRaceFake = createFakeClient();
const lazyRaceBinding = await prepareReactBindingForClient(lazyRaceFake, {
  generatedManifest: { functions: generatedManifest, routes },
});
const lazyRaceGroup = await lazyRaceBinding.prepareQueryGroup(
  lazyRaceBinding.groups['/workspace/:id'],
  { id: 'incident-lazy-race' },
);
const lazyRaceProvider = createSnapbackReactProvider(lazyRaceBinding, {
  preparedGroup: lazyRaceGroup,
});
lazyRaceFake.emitDurable({
  subscription_id: 'registered-details',
  update: { kind: 'Replace', rows: [{ id: 'details:newer', revision: 42 }] },
});
assert.equal(lazyRaceProvider.inspection().preparedGroupSource, 'live-recovery');
assert.equal(lazyRaceProvider.inspection().preparedGroupReason, 'unadopted-delta');
let lazyRaceSnapshot = null;
const lazyRaceObserver = observeSnapbackQueries(
  lazyRaceProvider,
  lazyRaceGroup,
  (snapshot) => { lazyRaceSnapshot = snapshot; },
);
await flush();
assert.equal(lazyRaceSnapshot.boot, null);
assert.equal(lazyRaceSnapshot.queries.feed.data[0].revision, 41);
assert.equal(
  lazyRaceSnapshot.queries.details.data[0].revision,
  0,
  'a dirty lazy child never publishes its stale bundle rows',
);
assert.equal(lazyRaceFake.inspection().registeredStarts, 1);
assert.equal(lazyRaceFake.inspection().ordinaryStarts, 1);
assert.deepEqual(
  lazyRaceFake.inspection().startOptions.find((entry) => entry.function === 'details'),
  {
    function: 'details',
    supersedesSubscriptionId: 'registered-details',
    registered: false,
    userId: null,
  },
  'the recovery subscription explicitly supersedes the dirty registration',
);
lazyRaceObserver.dispose();
await flush();
await lazyRaceProvider.dispose();
assert.equal(lazyRaceFake.inspection().durableConsumers, 0);

const claimedRaceFake = createFakeClient({ deferRegisteredFunction: 'details' });
const claimedRaceBinding = await prepareReactBindingForClient(claimedRaceFake, {
  generatedManifest: { functions: generatedManifest, routes },
});
const claimedRaceGroup = await claimedRaceBinding.prepareQueryGroup(
  claimedRaceBinding.groups['/workspace/:id'],
  { id: 'incident-claimed-race' },
);
const claimedRaceProvider = createSnapbackReactProvider(claimedRaceBinding, {
  preparedGroup: claimedRaceGroup,
});
let claimedRaceSnapshot = null;
const claimedRaceObserver = observeSnapbackQueries(
  claimedRaceProvider,
  claimedRaceGroup,
  (snapshot) => { claimedRaceSnapshot = snapshot; },
);
claimedRaceFake.emitDurable({
  subscription_id: 'registered-details',
  update: { kind: 'Replace', rows: [{ id: 'details:newer', revision: 42 }] },
});
await flush();
assert.equal(claimedRaceProvider.inspection().preparedGroupReason, 'unadopted-delta');
assert.equal(claimedRaceSnapshot.boot, null);
assert.equal(
  claimedRaceSnapshot.queries.details.data[0].revision,
  0,
  'a frame racing a claimed-but-unadopted child blocks stale publication',
);
assert.equal(claimedRaceFake.inspection().registeredStarts, 2);
assert.equal(claimedRaceFake.inspection().ordinaryStarts, 1);
assert.equal(
  claimedRaceFake.inspection().startOptions.at(-1).supersedesSubscriptionId,
  'registered-details',
);
claimedRaceObserver.dispose();
await flush();
await claimedRaceProvider.dispose();

const authorityRaceFake = createFakeClient();
const authorityRaceBinding = await prepareReactBindingForClient(authorityRaceFake, {
  generatedManifest: { functions: generatedManifest, routes },
});
const authorityRaceGroup = await authorityRaceBinding.prepareQueryGroup(
  authorityRaceBinding.groups['/workspace/:id'],
  { id: 'incident-authority-race' },
  { userId: 'dev-user-authority-a' },
);
const authorityRaceProvider = createSnapbackReactProvider(authorityRaceBinding, {
  preparedGroup: authorityRaceGroup,
});
await authorityRaceFake.inspection().barriers[0].quiesce({});
authorityRaceFake.inspection().barriers[0].blank({});
authorityRaceFake.inspection().barriers[0].clearMemory({});
await authorityRaceFake.inspection().barriers[0].resume({});
assert.equal(authorityRaceProvider.inspection().preparedGroupSource, 'live-recovery');
assert.equal(authorityRaceProvider.inspection().preparedGroupReason, 'authority-replaced');
let authorityRaceSnapshot = null;
const authorityRaceObserver = observeSnapbackQueries(
  authorityRaceProvider,
  authorityRaceGroup,
  (snapshot) => { authorityRaceSnapshot = snapshot; },
);
await flush();
assert.equal(authorityRaceSnapshot.boot, null);
assert.equal(authorityRaceFake.inspection().registeredStarts, 0);
assert.equal(authorityRaceFake.inspection().ordinaryStarts, 2);
assert(
  authorityRaceFake.inspection().startOptions.every(
    (entry) => entry.userId === 'dev-user-authority-a',
  ),
  'the admitted development identity survives authority recovery unchanged',
);
authorityRaceObserver.dispose();
await flush();
await authorityRaceProvider.dispose();

const fallbackFake = createFakeClient({ registeredBundleAvailable: false });
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

const devWriteFake = createFakeClient({ registeredBundleAvailable: false });
const devWriteBinding = await prepareReactBindingForClient(devWriteFake, {
  generatedManifest: { functions: generatedManifest, routes },
});
const devWriteGroup = await devWriteBinding.prepareQueryGroup(
  devWriteBinding.groups['/workspace/:id'],
  { id: 'dev-write' },
  { fallbackToLive: true, userId: 'dev-write-user' },
);
const devWriteProvider = createSnapbackReactProvider(devWriteBinding, {
  preparedGroup: devWriteGroup,
});
let devWriteMutation = null;
function DevWriteProbe() {
  devWriteMutation = useSnapbackMutation(publish);
  return React.createElement('output');
}
let devWriteRenderer;
await act(async () => {
  devWriteRenderer = TestRenderer.create(React.createElement(
    SnapbackProvider,
    { provider: devWriteProvider },
    React.createElement(DevWriteProbe),
  ));
  await flush();
});
assert.equal(await devWriteMutation({ value: 'bound' }), 'publish:bound');
assert.deepEqual(devWriteFake.inspection().mutationOptions, [
  { function: 'publish', userId: 'dev-write-user' },
]);
await act(async () => { devWriteRenderer.unmount(); await flush(); });
await devWriteProvider.dispose();

await assert.rejects(
  fallbackBinding.prepareQueryGroup(
    fallbackBinding.groups['/workspace/:id'],
    { id: 'incident-no-capability' },
  ),
  (error) => error?.code === 'SNAPBACK_REACT_GROUP_REGISTER_UNAVAILABLE',
  'an absent target capability refuses unless fallback is explicit',
);

const bundleFailure = Object.assign(new Error('SNAPBACK_BUNDLE_QUERY_FAILED: exact failure'), {
  code: 'SNAPBACK_BUNDLE_QUERY_FAILED',
});
const failureFake = createFakeClient({ bundleError: bundleFailure });
const failureBinding = await prepareReactBindingForClient(failureFake, {
  generatedManifest: { functions: generatedManifest, routes },
});
await assert.rejects(
  failureBinding.prepareQueryGroup(
    failureBinding.groups['/workspace/:id'],
    { id: 'incident-bundle-failure' },
    { fallbackToLive: true },
  ),
  (error) => error === bundleFailure,
  'a target that advertises register support never hides a bundle failure behind fallback',
);
assert.equal(failureFake.inspection().ordinaryStarts, 0);

const protocolMissingFake = createFakeClient({
  authMode: 'sessions',
  authInvalidationProtocol: null,
});
const protocolMissingBinding = await prepareReactBindingForClient(protocolMissingFake, {
  generatedManifest: { functions: generatedManifest, routes },
});
await assert.rejects(
  protocolMissingBinding.prepareQueryGroup(
    protocolMissingBinding.groups['/workspace/:id'],
    { id: 'incident-protocol-missing' },
  ),
  (error) => error?.code === 'SNAPBACK_REACT_GROUP_AUTH_INVALIDATION_REQUIRED',
  'sessions-mode registered boot refuses before I/O without protocol 1',
);
assert.equal(protocolMissingFake.inspection().bundleFetches, 0);

const projectionMissingFake = createFakeClient({ authMode: 'sessions' });
const projectionMissingBinding = await prepareReactBindingForClient(projectionMissingFake, {
  generatedManifest: { functions: generatedManifest, routes },
});
await assert.rejects(
  projectionMissingBinding.prepareQueryGroup(
    projectionMissingBinding.groups['/workspace/:id'],
    { id: 'incident-projection-missing' },
  ),
  (error) => error?.code === 'SNAPBACK_REACT_GROUP_BUNDLE_INVALID',
  'sessions-mode auth-scoped children fail closed when projections are omitted',
);
assert.equal(projectionMissingFake.inspection().releases, 1);
assert.equal(projectionMissingFake.inspection().disconnects, 0);

const abandonedFake = createFakeClient({ attachDeadlineOffsetMs: 50 });
const abandonedBinding = await prepareReactBindingForClient(abandonedFake, {
  generatedManifest: { functions: generatedManifest, routes },
});
const abandonedGroup = await abandonedBinding.prepareQueryGroup(
  abandonedBinding.groups['/workspace/:id'],
  { id: 'incident-abandoned' },
);
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(
  abandonedFake.inspection().releases,
  1,
  'an untransferred preparation cleans its connection at the attach deadline',
);
await abandonedGroup.dispose();
assert.equal(abandonedFake.inspection().releases, 1, 'deadline cleanup is idempotent');
assert.equal(abandonedFake.inspection().disconnects, 0);

const expiredFake = createFakeClient({ attachDeadlineOffsetMs: -1 });
const expiredBinding = await prepareReactBindingForClient(expiredFake, {
  generatedManifest: { functions: generatedManifest, routes },
});
const expiredGroup = await expiredBinding.prepareQueryGroup(
  expiredBinding.groups['/workspace/:id'],
  { id: 'incident-expired' },
);
const expiredProvider = createSnapbackReactProvider(expiredBinding, {
  preparedGroup: expiredGroup,
});
assert.equal(expiredProvider.inspection().preparedGroupSource, 'live-recovery');
assert.equal(expiredProvider.inspection().preparedGroupReason, 'attach-deadline-expired');
const expiredObserver = observeSnapbackQueries(expiredProvider, expiredGroup, () => {});
await flush();
assert.equal(expiredObserver.snapshot().boot, null);
assert.equal(expiredFake.inspection().registeredStarts, 0);
assert.equal(expiredFake.inspection().ordinaryStarts, 2);
assert.equal(expiredFake.inspection().releases, 1);
assert.equal(expiredFake.inspection().disconnects, 0);
expiredObserver.dispose();
await flush();
await expiredProvider.dispose();
assert.equal(expiredFake.inspection().disconnects, 0);

const sharedExpiredFake = createFakeClient({
  attachDeadlineOffsetMs: 20,
  managerSocketDemand: 1,
});
const sharedExpiredBinding = await prepareReactBindingForClient(sharedExpiredFake, {
  generatedManifest: { functions: generatedManifest, routes },
});
const sharedExpiredGroup = await sharedExpiredBinding.prepareQueryGroup(
  sharedExpiredBinding.groups['/workspace/:id'],
  { id: 'incident-shared-expired' },
);
const sharedExpiredSibling = createSnapbackReactProvider(sharedExpiredBinding, {
  connectionId: sharedExpiredGroup.connectionId,
});
const sharedExpiredSiblingObserver = observeSnapbackQueries(sharedExpiredSibling, {
  feed: { ref: feed, args: { id: 'incident-shared-expired' } },
}, () => {});
const sharedExpiredProvider = createSnapbackReactProvider(sharedExpiredBinding, {
  preparedGroup: sharedExpiredGroup,
});
await new Promise((resolve) => setTimeout(resolve, 30));
const sharedExpiredObserver = observeSnapbackQueries(
  sharedExpiredProvider,
  sharedExpiredGroup,
  () => {},
);
await flush();
assert.equal(sharedExpiredFake.inspection().releases, 0);
assert.equal(sharedExpiredFake.inspection().managerCloses, 0);
assert.equal(sharedExpiredFake.inspection().registeredRetirements, 2);
assert.equal(sharedExpiredFake.inspection().serverRegistrations, 0);
sharedExpiredFake.emit(feed, [{
  id: 'feed:incident-shared-expired',
  revision: 53,
}]);
await flush();
assert.equal(
  sharedExpiredSiblingObserver.snapshot().queries.feed.data[0].revision,
  53,
  'registered recovery must leave a same-connection sibling live',
);
sharedExpiredObserver.dispose();
sharedExpiredSiblingObserver.dispose();
await sharedExpiredProvider.dispose();
await sharedExpiredSibling.dispose();
assert.equal(sharedExpiredFake.inspection().releases, 0);
assert.equal(sharedExpiredFake.inspection().managerCloses, 0);

const sharedConnectionFake = createFakeClient();
const sharedConnectionBinding = await prepareReactBindingForClient(
  sharedConnectionFake,
  { generatedManifest },
);
const sharedConnectionA = createSnapbackReactProvider(sharedConnectionBinding, {
  connectionId: 'react-package-shared-connection',
});
const sharedConnectionB = createSnapbackReactProvider(sharedConnectionBinding, {
  connectionId: 'react-package-shared-connection',
});
const sharedConnectionObserverA = observeSnapbackQueries(sharedConnectionA, {
  feed: { ref: feed, args: { id: 'shared' } },
}, () => {});
const sharedConnectionObserverB = observeSnapbackQueries(sharedConnectionB, {
  feed: { ref: feed, args: { id: 'shared' } },
}, () => {});
await flush();
assert.equal(sharedConnectionFake.inspection().handles, 2);
await sharedConnectionA.dispose();
assert.equal(sharedConnectionFake.inspection().handles, 1);
assert.equal(sharedConnectionFake.inspection().releases, 0);
sharedConnectionFake.emit(feed, [{ id: 'feed:shared', revision: 52 }]);
await flush();
assert.equal(sharedConnectionObserverB.snapshot().queries.feed.data[0].revision, 52);
assert.equal(sharedConnectionB.inspection().serverSubscriptions, 1);
sharedConnectionObserverA.dispose();
sharedConnectionObserverB.dispose();
await sharedConnectionB.dispose();
assert.equal(sharedConnectionFake.inspection().disconnects, 0);
assert.equal(
  sharedConnectionFake.inspection().releases,
  1,
  'the final shared provider releases the idle grant after sibling demand ends',
);

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
