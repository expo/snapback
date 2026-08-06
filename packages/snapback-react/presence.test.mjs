import assert from 'node:assert/strict';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import {
  createSnapbackReactProvider,
  observeSnapbackPresence,
  skip,
} from './index.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const valueContract = {
  kind: 'object',
  fields: [
    { name: 'name', required: true, value: { kind: 'string', maxBytes: 32 } },
  ],
  allowExtra: false,
};
const scopeContract = {
  kind: 'object',
  fields: [
    { name: 'roomId', required: true, value: { kind: 'string', maxBytes: 32 } },
  ],
  allowExtra: false,
};
const collection = Object.freeze({
  name: 'presence',
  scopeFields: ['roomId'],
  scopeContract,
  valueContract,
  keyMode: 'Connection',
  routingFields: ['roomId'],
  defaultTtlMs: 1_000,
  maxTtlMs: 5_000,
  maxValueBytes: 128,
  hardMaxValueBytes: 4_096,
  sustainedHz: 4,
  burst: 8,
  dispatchMs: 33,
  publish: 'AllowAll',
  subscribe: 'AllowAll',
  maxPendingEphemeralKeys: 1_024,
});
const schema = Object.freeze({
  artifactKind: 'schemaManifest',
  schemaVersion: 'snapback.v0',
  appId: 'presence-fixture',
  schemaHash: 'sha256:presence-schema',
  ephemeralCollections: [collection],
  tables: [],
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'presence-fixture',
  bundleHash: 'sha256:presence-bundle',
  functions: [],
});
const capabilityManifest = Object.freeze({
  artifactKind: 'capabilityManifest',
  schemaVersion: 'snapback.v0',
  targetProfileId: 'local-dev-sqlite-ibex',
  supportedCapabilities: ['live_subscriptions'],
});

function fakeClient(profile = 'local-dev-sqlite-ibex', deployment = { schema, functions }) {
  let starts = 0;
  let publishes = 0;
  let deletes = 0;
  let handles = 0;
  let barriers = 0;
  return {
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: profile,
        target: profile,
        schema: deployment.schema,
        functions: deployment.functions,
        capabilityManifest: { ...capabilityManifest, targetProfileId: profile },
      };
    },
    async authSession() { return { activeMode: 'dev' }; },
    registerAuthBarrierParticipant() {
      barriers += 1;
      return async () => { barriers -= 1; };
    },
    liveStreamManager() {
      return { async settled() {} };
    },
    registerEphemeralRepublisher() {
      return Object.freeze({ dispose() {} });
    },
    startEphemeralRoom(_definition, scope) {
      starts += 1;
      handles += 1;
      const listeners = new Set();
      let disposed = false;
      let current = Object.freeze({
        status: 'pending',
        entries: Object.freeze([]),
        selfKey: null,
        diagnostic: null,
        connection: 'connecting',
        reason: null,
      });
      const notify = () => {
        for (const listener of [...listeners]) listener();
      };
      let settleStart;
      const started = new Promise((resolve) => { settleStart = resolve; });
      queueMicrotask(() => {
        if (disposed) return;
        current = Object.freeze({
          status: 'ready',
          entries: Object.freeze([]),
          selfKey: `granted-${starts}`,
          diagnostic: null,
          connection: 'live',
          reason: null,
        });
        notify();
        settleStart();
      });
      return Object.freeze({
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getSnapshot() { return current; },
        getServerSnapshot() { return current; },
        get grantedConnectionId() { return current.selfKey; },
        started: () => started,
        async publish(value, { ttlMs }) {
          publishes += 1;
          current = Object.freeze({
            ...current,
            entries: Object.freeze([Object.freeze({
              key: current.selfKey,
              value,
              expiresAtMs: 1_000 + ttlMs,
              receivedAtMs: 1_000,
              scopeEpoch: 1,
              entryVersion: publishes,
              scope,
            })]),
          });
          notify();
          return { accepted: true };
        },
        async delete() {
          deletes += 1;
          current = Object.freeze({ ...current, entries: Object.freeze([]) });
          notify();
          return { removed: true };
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          handles -= 1;
          listeners.clear();
          settleStart();
        },
        async settled() {},
        inspection() { return { disposed, listeners: listeners.size }; },
      });
    },
    inspection() {
      return { starts, publishes, deletes, handles, barriers };
    },
  };
}

const client = fakeClient();
const binding = await prepareReactBindingForClient(client, {
  generatedManifest: { functions, schema, capabilityManifest },
});
const ref = binding.ephemeral.presence;
const provider = createSnapbackReactProvider(binding, { connectionId: 'presence-test' });
const detachedDescriptor = provider.registry.presenceDescriptor(
  ref,
  { roomId: 'detached' },
  skip,
);
const detachedToken = provider.registry.createPresenceToken();
assert.equal(
  provider.registry.presenceSnapshot(detachedDescriptor, detachedToken),
  provider.registry.presenceSnapshot(detachedDescriptor, detachedToken),
  'the pre-subscribe snapshot required by useSyncExternalStore must be cached',
);
const states = [];
const observer = observeSnapbackPresence(
  provider,
  ref,
  { scope: { roomId: 'one' }, value: skip },
  (state) => states.push(state),
);
await flush();
assert.equal(observer.snapshot().status, 'ready');
assert.equal(client.inspection().starts, 1);
await observer.publish({ name: 'Ada' }, { ttlMs: 1_000 });
assert.equal(observer.snapshot().publisher.status, 'published');
assert.equal(observer.snapshot().entries[0].value.name, 'Ada');
assert(Object.isFrozen(observer.snapshot().entries[0].value));

const sibling = observeSnapbackPresence(
  provider,
  ref,
  { scope: { roomId: 'one' }, value: { name: 'Ada' }, ttlMs: 1_000 },
  () => {},
);
await flush();
assert.equal(client.inspection().starts, 1, 'same room shares one headless handle');
assert.throws(
  () => observeSnapbackPresence(
    provider,
    ref,
    { scope: { roomId: 'one' }, value: { name: 'Grace' }, ttlMs: 1_000 },
    () => {},
  ),
  (error) => error?.code === 'SNAPBACK_REACT_PRESENCE_VALUE_CONFLICT',
);
assert.throws(
  () => observeSnapbackPresence(
    provider,
    ref,
    { scope: { roomId: 'two' }, value: { name: 'Ada' }, ttlMs: 499 },
    () => {},
  ),
  (error) => error?.code === 'SNAPBACK_REACT_PRESENCE_HEARTBEAT_UNSUPPORTED',
);
await assert.rejects(
  sibling.publish({ name: 'Ada' }),
  (error) => error?.code === 'SNAPBACK_REACT_PRESENCE_ACTION_CONFLICT',
);
await observer.delete();
assert.equal(observer.snapshot().publisher.status, 'observing');
assert.equal(
  client.inspection().deletes,
  0,
  'one imperative lease cannot delete the connection-scoped entry retained by a sibling',
);
assert.equal(sibling.snapshot().publisher.status, 'published');
assert.equal(sibling.snapshot().entries[0].value.name, 'Ada');

await sibling.dispose();
await flush();
assert.equal(client.inspection().deletes, 1, 'the final publisher release deletes the shared entry');
await observer.dispose();
await flush();
await provider.dispose();
assert.deepEqual(
  {
    stores: provider.inspection().presenceStores,
    consumers: provider.inspection().presenceConsumers,
    subscriptions: provider.inspection().presenceSubscriptions,
    publishers: provider.inspection().publishers,
    timers: provider.inspection().presenceTimers,
    listeners: provider.inspection().presenceListeners,
    handles: client.inspection().handles,
    barriers: client.inspection().barriers,
  },
  {
    stores: 0,
    consumers: 0,
    subscriptions: 0,
    publishers: 0,
    timers: 0,
    listeners: 0,
    handles: 0,
    barriers: 0,
  },
);

const hosted = fakeClient('hosted-postgres');
const hostedBinding = await prepareReactBindingForClient(hosted, {
  generatedManifest: {
    functions,
    schema,
    capabilityManifest: { ...capabilityManifest, targetProfileId: 'hosted-postgres' },
  },
});
const hostedProvider = createSnapbackReactProvider(hostedBinding);
const hostedObserver = observeSnapbackPresence(
  hostedProvider,
  hostedBinding.ephemeral.presence,
  { scope: { roomId: 'one' }, value: skip },
  () => {},
);
assert.equal(hostedObserver.snapshot().status, 'unsupported');
assert.equal(hosted.inspection().starts, 0, 'hosted refusal performs no room work');
await hostedObserver.dispose();
await hostedProvider.dispose();

// Regression (0137 A2 f2): sessions-mode manifests carry the carrier grammar
// (`snapback.v1`) while generated api.mjs stamps every reference with the
// public reference grammar (`snapback.v0`). The binding must reconstruct its
// ephemeral references in the reference grammar so the documented
// `api.ephemeral.<name>` path admits unchanged — fail-closed canonical
// comparison intact.
const sessionsSchema = Object.freeze({ ...schema, schemaVersion: 'snapback.v1' });
const sessionsFunctions = Object.freeze({ ...functions, schemaVersion: 'snapback.v1' });
const sessionsClient = fakeClient('local-dev-sqlite-ibex', {
  schema: sessionsSchema,
  functions: sessionsFunctions,
});
const sessionsBinding = await prepareReactBindingForClient(sessionsClient, {
  generatedManifest: {
    functions: sessionsFunctions,
    schema: sessionsSchema,
    capabilityManifest,
  },
});
// Byte-for-byte the reference codegen's renderApiModule emits for this
// collection on a sessions app.
const generatedApiReference = Object.freeze({
  artifactKind: 'ephemeralCollectionReference',
  schemaVersion: 'snapback.v0',
  appId: 'presence-fixture',
  id: 'presence-fixture:ephemeral:presence',
  name: 'presence',
  keyMode: 'Connection',
  scopeFields: ['roomId'],
  routingFields: ['roomId'],
  defaultTtlMs: 1_000,
  maxTtlMs: 5_000,
  maxValueBytes: 128,
  publishRate: { sustainedHz: 4, burst: 8 },
  deliveryMode: 'latest',
});
assert.deepEqual(
  JSON.parse(JSON.stringify(sessionsBinding.ephemeral.presence)),
  JSON.parse(JSON.stringify(generatedApiReference)),
  'binding.ephemeral.* must stay byte-identical to the generated api.ephemeral.* reference',
);
const sessionsProvider = createSnapbackReactProvider(sessionsBinding, {
  connectionId: 'presence-sessions',
});
const sessionsObserver = observeSnapbackPresence(
  sessionsProvider,
  generatedApiReference,
  { scope: { roomId: 'one' }, value: skip },
  () => {},
);
await flush();
assert.equal(
  sessionsObserver.snapshot().status,
  'ready',
  'the generated api.ephemeral reference must be admitted on a sessions binding',
);
await sessionsObserver.dispose();
await sessionsProvider.dispose();

console.log('presence.test.mjs: shared rooms, managed intent, conflicts, refusal, api-reference admission, and cleanup pass');
