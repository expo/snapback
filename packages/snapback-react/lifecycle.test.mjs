import assert from 'node:assert/strict';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import {
  createSnapbackReactProvider,
  observeSnapbackPresence,
} from './index.mjs';

// @ref LLP 0106#resync-authority-and-lifecycle — React must project the
// headless room's stale/resyncing/ready transitions without retaining a
// predecessor-authority snapshot or creating a second reconnect owner.
// @ref LLP 0102#strict-mode-hmr-replacement-and-late-work — provider
// replacement must leave exactly the successor room/barrier alive.

const flush = () => new Promise((resolve) => setImmediate(resolve));
const valueContract = Object.freeze({
  kind: 'object',
  fields: Object.freeze([
    Object.freeze({
      name: 'name',
      required: true,
      value: Object.freeze({ kind: 'string', maxBytes: 32 }),
    }),
  ]),
  allowExtra: false,
});
const scopeContract = Object.freeze({
  kind: 'object',
  fields: Object.freeze([
    Object.freeze({
      name: 'roomId',
      required: true,
      value: Object.freeze({ kind: 'string', maxBytes: 32 }),
    }),
  ]),
  allowExtra: false,
});
const collection = Object.freeze({
  name: 'presence',
  scopeFields: Object.freeze(['roomId']),
  scopeContract,
  valueContract,
  keyMode: 'Connection',
  routingFields: Object.freeze(['roomId']),
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
  appId: 'react-lifecycle-fixture',
  schemaHash: 'sha256:react-lifecycle-schema',
  ephemeralCollections: Object.freeze([collection]),
  tables: Object.freeze([]),
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'react-lifecycle-fixture',
  bundleHash: 'sha256:react-lifecycle-bundle',
  functions: Object.freeze([]),
});
const capabilityManifest = Object.freeze({
  artifactKind: 'capabilityManifest',
  schemaVersion: 'snapback.v0',
  targetProfileId: 'local-dev-sqlite-ibex',
  supportedCapabilities: Object.freeze(['live_subscriptions']),
});

function lifecycleClient() {
  const barriers = new Set();
  const activeHandles = new Set();
  const handles = [];
  let starts = 0;
  let deletes = 0;
  let republishers = 0;
  const client = {
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema,
        functions,
        capabilityManifest,
      };
    },
    async authSession() { return { activeMode: 'dev' }; },
    registerAuthBarrierParticipant(participant) {
      barriers.add(participant);
      return async () => { barriers.delete(participant); };
    },
    liveStreamManager() {
      return Object.freeze({ close() {}, async settled() {} });
    },
    registerEphemeralRepublisher() {
      republishers += 1;
      let disposed = false;
      return Object.freeze({
        dispose() {
          if (disposed) return;
          disposed = true;
          republishers -= 1;
        },
      });
    },
    startEphemeralRoom(_definition, scope) {
      starts += 1;
      const ordinal = starts;
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
      const transition = (next) => {
        if (disposed) return;
        current = Object.freeze({
          status: next.status,
          entries: Object.freeze(next.entries ?? []),
          selfKey: next.selfKey ?? null,
          diagnostic: null,
          connection: next.connection,
          reason: next.reason ?? null,
        });
        notify();
      };
      const ready = (name = `member-${ordinal}`) => transition({
        status: 'ready',
        connection: 'live',
        selfKey: `connection-${ordinal}`,
        entries: [
          Object.freeze({
            key: `peer-${ordinal}`,
            value: Object.freeze({ name }),
            expiresAtMs: 10_000,
            receivedAtMs: 1_000,
            scopeEpoch: ordinal,
            entryVersion: ordinal,
            scope,
          }),
        ],
      });
      const handle = Object.freeze({
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getSnapshot() { return current; },
        getServerSnapshot() { return current; },
        get grantedConnectionId() { return current.selfKey; },
        started: () => started,
        async publish() { return { accepted: true }; },
        async delete() {
          deletes += 1;
          transition({
            status: 'ready',
            connection: 'live',
            selfKey: current.selfKey,
            entries: [],
          });
          return { removed: true };
        },
        transition,
        ready,
        dispose() {
          if (disposed) return;
          disposed = true;
          activeHandles.delete(handle);
          listeners.clear();
          settleStart();
        },
        async settled() {},
        inspection() {
          return Object.freeze({ disposed, listeners: listeners.size, snapshot: current });
        },
      });
      handles.push(handle);
      activeHandles.add(handle);
      queueMicrotask(() => {
        if (disposed) return;
        ready();
        settleStart();
      });
      return handle;
    },
    async disconnect() {},
    inspection() {
      return Object.freeze({
        barriers: barriers.size,
        barrierList: Object.freeze([...barriers]),
        activeHandles: activeHandles.size,
        handles: Object.freeze([...handles]),
        starts,
        deletes,
        republishers,
      });
    },
  };
  return client;
}

const client = lifecycleClient();
const binding = await prepareReactBindingForClient(client, {
  generatedManifest: { functions, schema, capabilityManifest },
});
const reference = binding.ephemeral.presence;
const firstProvider = createSnapbackReactProvider(binding, {
  connectionId: 'react-lifecycle-first',
});
const firstStates = [];
const first = observeSnapbackPresence(
  firstProvider,
  reference,
  {
    scope: { roomId: 'incident-1' },
    value: { name: 'Ada' },
    ttlMs: 1_000,
  },
  (state) => firstStates.push(state),
);
await flush();
assert.equal(first.snapshot().status, 'ready');
assert.equal(client.inspection().activeHandles, 1);
assert.equal(client.inspection().barriers, 1);

const firstHandle = client.inspection().handles[0];
firstHandle.transition({
  status: 'stale',
  connection: 'stale',
  selfKey: 'connection-1',
  entries: firstHandle.inspection().snapshot.entries,
  reason: 'socket_lost',
});
assert.equal(first.snapshot().status, 'stale', 'disconnect projects retained presence as stale');
assert.equal(first.snapshot().entries[0].value.name, 'member-1');
firstHandle.transition({
  status: 'resyncing',
  connection: 'connecting',
  selfKey: null,
  entries: [],
  reason: 'socket_reconnect',
});
assert.equal(first.snapshot().status, 'resyncing', 'reconnect blanks before resnapshot');
assert.deepEqual(first.snapshot().entries, []);
firstHandle.ready('member-reconnected');
assert.equal(first.snapshot().status, 'ready');
assert.equal(first.snapshot().entries[0].value.name, 'member-reconnected');
assert.deepEqual(
  firstProvider.inspection().resyncReasons,
  ['socket_lost', 'socket_reconnect'],
);

const firstBarrier = client.inspection().barrierList[0];
await firstBarrier.quiesce({});
firstBarrier.blank({});
assert.equal(first.snapshot().status, 'pending', 'auth revocation blanks synchronously');
assert.deepEqual(first.snapshot().entries, []);
assert.equal(client.inspection().activeHandles, 0);
await firstBarrier.resume({});
await flush();
assert.equal(first.snapshot().status, 'ready');
assert.equal(client.inspection().starts, 2, 'successor authority receives a fresh headless room');
assert.equal(client.inspection().activeHandles, 1);

// HMR-like replacement constructs the successor before releasing the
// predecessor. Each provider has isolated ownership; disposing the old module
// drains only its room/barrier and leaves the successor live.
const successorProvider = createSnapbackReactProvider(binding, {
  connectionId: 'react-lifecycle-successor',
});
const successor = observeSnapbackPresence(
  successorProvider,
  reference,
  { scope: { roomId: 'incident-1' }, value: { name: 'Grace' }, ttlMs: 1_000 },
  () => {},
);
await flush();
assert.equal(successor.snapshot().status, 'ready');
assert.equal(client.inspection().activeHandles, 2);
assert.equal(client.inspection().barriers, 2);
await first.dispose();
await firstProvider.dispose();
assert.equal(successor.snapshot().status, 'ready');
assert.equal(client.inspection().activeHandles, 1);
assert.equal(client.inspection().barriers, 1);
assert.equal(client.inspection().republishers, 1);

await successor.dispose();
await successorProvider.dispose();
assert.deepEqual(
  {
    activeHandles: client.inspection().activeHandles,
    barriers: client.inspection().barriers,
    republishers: client.inspection().republishers,
    successorPresenceStores: successorProvider.inspection().presenceStores,
    successorPresenceConsumers: successorProvider.inspection().presenceConsumers,
    successorPresenceSubscriptions: successorProvider.inspection().presenceSubscriptions,
    successorPresenceListeners: successorProvider.inspection().presenceListeners,
  },
  {
    activeHandles: 0,
    barriers: 0,
    republishers: 0,
    successorPresenceStores: 0,
    successorPresenceConsumers: 0,
    successorPresenceSubscriptions: 0,
    successorPresenceListeners: 0,
  },
  'reconnect, auth revocation, and HMR-like replacement leave no React-owned resources',
);
assert(firstStates.some((state) => state.status === 'stale'));
assert(firstStates.some((state) => state.status === 'resyncing'));

console.log('lifecycle.test.mjs: reconnect, auth revocation, HMR replacement, and zero-leak cleanup pass');
