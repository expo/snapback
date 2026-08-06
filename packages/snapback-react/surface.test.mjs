import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { StrictMode } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import {
  createSnapbackReactProvider,
  observeSnapbackQueries,
  observeSnapbackSurface,
  SnapbackProvider,
  useSnapbackQuery,
  useSurface,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fixtureRoot = new URL('../../demos/expo-golden-path-fixture/snapback/generated/', import.meta.url);
const app = JSON.parse(readFileSync(new URL('app.descriptor.json', fixtureRoot)));
const functions = JSON.parse(readFileSync(new URL('functions.manifest.json', fixtureRoot)));
const schema = JSON.parse(readFileSync(new URL('schema.manifest.json', fixtureRoot)));
const capabilityManifest = JSON.parse(readFileSync(new URL('capability.manifest.json', fixtureRoot)));
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeClient() {
  const queryHandles = new Set();
  const roomHandles = new Set();
  const starts = [];
  const rooms = [];
  const mutations = [];
  const barriers = [];
  let querySequence = 0;
  return {
    authProtocols: { authInvalidation: 1 },
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema,
        functions,
        capabilityManifest,
        routeManifestHash: null,
      };
    },
    async authSession() { return { activeMode: 'sessions' }; },
    allocateLiveQueryNamespace(reference, args) {
      querySequence += 1;
      return {
        clientStoreId: 'surface-test',
        queryKey: `${reference.id}:${JSON.stringify(args)}`,
        queryInstanceId: querySequence,
      };
    },
    registerAuthBarrierParticipant(participant) {
      barriers.push(participant);
      return async () => barriers.splice(barriers.indexOf(participant), 1);
    },
    registerDurableConsumer() { return () => {}; },
    registerEphemeralRepublisher() { return Object.freeze({ dispose() {} }); },
    liveStreamManager() {
      return { inspection: () => ({ socketDemand: queryHandles.size }) };
    },
    async releaseConnection() { return { released: true }; },
    startLiveQuery(reference, options) {
      starts.push({ name: reference.name, args: structuredClone(options.args) });
      const conversationId = options.args.conversationId;
      const rows = reference.name === 'conversationMessages'
        ? [{
            _id: `message-${conversationId}`,
            _version: 1,
            _createdAt: 1,
            _updatedAt: 1,
            conversationId,
            body: `message for ${conversationId}`,
            reaction: null,
          }]
        : [{
            _id: conversationId,
            _version: 1,
            _createdAt: 1,
            _updatedAt: 1,
            title: `details for ${conversationId}`,
          }];
      let disposed = false;
      const handle = {
        current: { rows, connection: 'live', freshness: 'current' },
        started: async () => {},
        settled: async () => {},
        dispose() {
          if (disposed) return;
          disposed = true;
          queryHandles.delete(handle);
        },
      };
      queryHandles.add(handle);
      return Object.freeze(handle);
    },
    async mutate(reference, options) {
      mutations.push({ name: reference.name, args: structuredClone(options.args) });
      return {
        result: reference.name === 'reactToMessage'
          ? { messageId: options.args.messageId, emoji: options.args.emoji }
          : null,
        version: 1,
      };
    },
    startEphemeralRoom(_definition, scope) {
      rooms.push(structuredClone(scope));
      const listeners = new Set();
      let current = Object.freeze({
        status: 'pending',
        entries: Object.freeze([]),
        selfKey: null,
        diagnostic: null,
        connection: 'connecting',
        reason: null,
      });
      let disposed = false;
      const notify = () => { for (const listener of [...listeners]) listener(); };
      let settleStart;
      const started = new Promise((resolve) => { settleStart = resolve; });
      queueMicrotask(() => {
        if (disposed) return;
        current = Object.freeze({
          ...current,
          status: 'ready',
          selfKey: 'session-connection',
          connection: 'live',
        });
        notify();
        settleStart();
      });
      const handle = {
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        getSnapshot: () => current,
        getServerSnapshot: () => current,
        get grantedConnectionId() { return current.selfKey; },
        started: () => started,
        settled: async () => {},
        async publish(value) {
          current = Object.freeze({
            ...current,
            entries: Object.freeze([Object.freeze({
              key: current.selfKey,
              value: Object.freeze(structuredClone(value)),
              expiresAtMs: 5_000,
              receivedAtMs: 1,
              scopeEpoch: 1,
              entryVersion: 1,
              scope,
            })]),
          });
          notify();
          return { accepted: true };
        },
        async delete() { current = Object.freeze({ ...current, entries: Object.freeze([]) }); notify(); },
        dispose() {
          if (disposed) return;
          disposed = true;
          listeners.clear();
          roomHandles.delete(handle);
          settleStart();
        },
      };
      roomHandles.add(handle);
      return Object.freeze(handle);
    },
    metrics() {
      return {
        starts: [...starts],
        rooms: [...rooms],
        mutations: [...mutations],
        queryHandles: queryHandles.size,
        roomHandles: roomHandles.size,
        barriers: [...barriers],
      };
    },
  };
}

const client = fakeClient();
const prepared = await prepareReactBindingForClient(client, { generatedManifest: app });
assert.strictEqual(prepared.surfaces.conversation.id, app.surfaces.conversation.id);
const provider = createSnapbackReactProvider(prepared, { connectionId: 'surface-test' });

const lowLevel = observeSnapbackQueries(provider, {
  messages: {
    ref: app.api.queries.conversationMessages,
    args: { conversationId: 'conversation-one' },
  },
}, () => {});
const surface = observeSnapbackSurface(
  provider,
  app.surfaces.conversation,
  { conversationId: 'conversation-one' },
  { presence: { typing: {} } },
  () => {},
);
await flush();
await new Promise((resolve) => setTimeout(resolve, 10));

assert.equal(client.metrics().starts.filter((entry) => entry.name === 'conversationMessages').length, 1);
assert.equal(client.metrics().starts.filter((entry) => entry.name === 'conversationDetails').length, 1);
assert.equal(client.metrics().rooms.length, 1);
assert.strictEqual(
  surface.snapshot().state.messages,
  lowLevel.snapshot().queries.messages,
  'surface and low-level reads observe the exact same LLP 0114 store snapshot',
);
assert.strictEqual(surface.snapshot().data.messages, surface.snapshot().state.messages.data);
assert.equal(surface.snapshot().presence.typing.members.length, 1);
assert.deepEqual(surface.snapshot().presence.typing.members[0].value, {});
const directMessages = [];
const stopDirectMessages = surface.reads.messages.subscribe((state) => {
  directMessages.push(state);
});

await surface.mutations.react({ messageId: 'message-one', emoji: '👍' });
assert.deepEqual(client.metrics().mutations.at(-1), {
  name: 'reactToMessage',
  args: { conversationId: 'conversation-one', messageId: 'message-one', emoji: '👍' },
});
assert.throws(
  () => provider.surface(
    app.surfaces.conversation,
    { conversationId: 'conversation-one' },
    { presence: { typing: { userId: 'forged' } } },
  ),
  (error) => error?.code === 'SNAPBACK_REACT_SURFACE_PRESENCE_IDENTITY_INPUT',
);

surface.update(
  { conversationId: 'conversation-two' },
  { presence: { typing: {} } },
);
assert.equal(surface.snapshot().data.messages, undefined, 'parameter replacement cannot leak predecessor rows');
await flush();
assert.equal(surface.snapshot().data.messages[0].conversationId, 'conversation-two');
assert.equal(directMessages.at(-1).data[0].conversationId, 'conversation-two');
assert.deepEqual(client.metrics().rooms, [
  { conversationId: 'conversation-one' },
  { conversationId: 'conversation-two' },
]);
assert.equal(provider.inspection().presenceStores, 1, 'predecessor room is released after successor adoption');

const barrier = client.metrics().barriers[0];
barrier.blank();
assert.equal(surface.snapshot().data.messages, undefined, 'authority replacement blanks compact data');
assert.equal(surface.snapshot().state.messages.status, 'pending');
assert.deepEqual(surface.snapshot().presence.typing.members, []);

stopDirectMessages();
await surface.dispose();
await flush();
assert.equal(client.metrics().queryHandles, 1, 'surface cleanup retains the low-level sibling owner only');
assert.equal(client.metrics().roomHandles, 0);
lowLevel.dispose();
await flush();
await provider.dispose();
assert.equal(client.metrics().queryHandles, 0);
assert.equal(provider.inspection().stores, 0);
assert.equal(provider.inspection().presenceStores, 0);

// React's Strict Mode mounts the named projection beside an equivalent
// low-level hook. Both edges converge on one store/room and the simulated
// setup-cleanup-setup cycle leaves no child owner behind.
const reactClient = fakeClient();
const reactPrepared = await prepareReactBindingForClient(reactClient, { generatedManifest: app });
const reactProvider = createSnapbackReactProvider(reactPrepared, { connectionId: 'surface-react-test' });
let latest = null;
function Probe({ conversationId }) {
  const low = useSnapbackQuery(app.api.queries.conversationMessages, { conversationId });
  const projected = useSurface(
    app.surfaces.conversation,
    { conversationId },
    { presence: { typing: {} } },
  );
  latest = { low, projected };
  return null;
}
let renderer;
await act(async () => {
  renderer = TestRenderer.create(
    React.createElement(
      StrictMode,
      null,
      React.createElement(
        SnapbackProvider,
        { provider: reactProvider },
        React.createElement(Probe, { conversationId: 'react-one' }),
      ),
    ),
  );
  await flush();
});
assert.strictEqual(latest.low, latest.projected.state.messages);
assert.equal(
  reactClient.metrics().starts.filter((entry) => entry.name === 'conversationMessages').length,
  1,
  'Strict Mode plus the low-level sibling still owns one upstream message subscription',
);
assert.equal(reactClient.metrics().rooms.length, 1);
const predecessorMutation = latest.projected.mutations.react;
await act(async () => {
  renderer.update(
    React.createElement(
      StrictMode,
      null,
      React.createElement(
        SnapbackProvider,
        { provider: reactProvider },
        React.createElement(Probe, { conversationId: 'react-two' }),
      ),
    ),
  );
  await flush();
});
assert.equal(latest.projected.data.messages[0].conversationId, 'react-two');
assert.throws(
  () => predecessorMutation({ messageId: 'stale-message', emoji: '⛔' }),
  (error) => error?.code === 'SNAPBACK_REACT_SURFACE_GENERATION_STALE',
  'a captured mutation callable cannot act for a retired parameter generation',
);
await act(async () => {
  renderer.unmount();
  await flush();
});
await reactProvider.dispose();
assert.equal(reactClient.metrics().queryHandles, 0);
assert.equal(reactClient.metrics().roomHandles, 0);
assert.equal(reactProvider.inspection().listeners, 0);

console.log('snapback-react surface tests passed');
