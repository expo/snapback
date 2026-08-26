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
  withdrawalVisibilityDeadlineMs: 500,
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

function fakeClient(
  profile = 'local-dev-sqlite-ibex',
  deployment = { schema, functions },
  {
    failNextPublish = false,
    delayNextDelete = false,
    dropNextPublishOffline = false,
    dropNextDeleteOffline = false,
  } = {},
) {
  let starts = 0;
  let publishAttempts = 0;
  let publishes = 0;
  let deletes = 0;
  let handles = 0;
  let barriers = 0;
  const deleteCalls = [];
  const authorityCapture = Object.freeze({ revision: 1 });
  let barrierParticipant = null;
  let settleDelayedDelete = null;
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
    registerAuthBarrierParticipant(participant) {
      barriers += 1;
      barrierParticipant = participant;
      return async () => { barriers -= 1; barrierParticipant = null; };
    },
    captureAuthority: () => authorityCapture,
    authorityCaptureFor: () => authorityCapture,
    isAuthorityCaptureCurrent: (capture) => capture === authorityCapture,
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
          publishAttempts += 1;
          if (dropNextPublishOffline) {
            dropNextPublishOffline = false;
            return Object.freeze({
              status: 'dropped',
              reason: 'offline',
              queued: false,
              diagnostic: Object.freeze({
                schemaVersion: 'snapback.client-diagnostic.v1',
                code: 'SNAPBACK_EPHEMERAL_OFFLINE_DROPPED',
                severity: 'error',
                message: 'ephemeral best-effort write was dropped because the transport is offline',
                details: Object.freeze({ operation: 'publish', queued: false }),
              }),
            });
          }
          if (failNextPublish) {
            failNextPublish = false;
            throw new Error('simulated connectivity loss');
          }
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
          return { accepted: true, scope_epoch: 1, entry_version: publishes };
        },
        async delete(options = {}) {
          deletes += 1;
          deleteCalls.push(options);
          if (dropNextDeleteOffline) {
            dropNextDeleteOffline = false;
            return Object.freeze({
              status: 'dropped',
              reason: 'offline',
              queued: false,
              diagnostic: Object.freeze({
                schemaVersion: 'snapback.client-diagnostic.v1',
                code: 'SNAPBACK_EPHEMERAL_OFFLINE_DROPPED',
                severity: 'error',
                message: 'ephemeral best-effort write was dropped because the transport is offline',
                details: Object.freeze({ operation: 'delete', queued: false }),
              }),
            });
          }
          if (delayNextDelete) {
            delayNextDelete = false;
            return new Promise((resolve) => {
              settleDelayedDelete = (settlement = { status: 'superseded' }) => {
                if (settlement.status === 'deleted') {
                  current = Object.freeze({ ...current, entries: Object.freeze([]) });
                  notify();
                }
                settleDelayedDelete = null;
                resolve(settlement);
              };
            });
          }
          current = Object.freeze({ ...current, entries: Object.freeze([]) });
          notify();
          return { status: 'deleted' };
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
      return {
        starts,
        publishAttempts,
        publishes,
        deletes,
        deleteCalls,
        handles,
        barriers,
        barrierParticipant,
        settleDelayedDelete,
      };
    },
    controls: Object.freeze({
      dropPublishOffline() { dropNextPublishOffline = true; },
      dropDeleteOffline() { dropNextDeleteOffline = true; },
    }),
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
assert.equal(client.inspection().deletes, 0, 'never-published skip sends no withdrawal');
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

const recoveringClient = fakeClient(
  'local-dev-sqlite-ibex',
  { schema, functions },
  { failNextPublish: true },
);
const recoveringBinding = await prepareReactBindingForClient(recoveringClient, {
  generatedManifest: { functions, schema, capabilityManifest },
});
const recoveringProvider = createSnapbackReactProvider(recoveringBinding);
const recoveringObserver = observeSnapbackPresence(
  recoveringProvider,
  recoveringBinding.ephemeral.presence,
  { scope: { roomId: 'recovering' }, value: skip },
  () => {},
);
await flush();
await recoveringObserver.publish({ name: 'Ada' }, { ttlMs: 1_000 });
assert.equal(recoveringObserver.snapshot().publisher.status, 'publish-error');
await recoveringProvider.pause();
await recoveringProvider.resume();
await flush();
await flush();
assert.equal(recoveringObserver.snapshot().publisher.status, 'published');
assert.equal(recoveringClient.inspection().starts, 2);
assert.equal(recoveringClient.inspection().publishAttempts, 2);
assert.equal(recoveringClient.inspection().publishes, 1);
await recoveringObserver.dispose();
await recoveringProvider.dispose();

// Publisher diagnostics belong to the token whose best-effort operation
// failed. A same-room `value: skip` sibling observes entries only and never
// inherits either the publisher's failed send or failed withdrawal.
{
  const scopedClient = fakeClient();
  const scopedBinding = await prepareReactBindingForClient(scopedClient, {
    generatedManifest: { functions, schema, capabilityManifest },
  });
  const scopedProvider = createSnapbackReactProvider(scopedBinding, {
    connectionId: 'presence-token-scoped-diagnostic',
  });
  const publisher = observeSnapbackPresence(
    scopedProvider,
    scopedBinding.ephemeral.presence,
    { scope: { roomId: 'token-scoped-diagnostic' }, value: skip },
    () => {},
  );
  const siblingObserver = observeSnapbackPresence(
    scopedProvider,
    scopedBinding.ephemeral.presence,
    { scope: { roomId: 'token-scoped-diagnostic' }, value: skip },
    () => {},
  );
  await flush();
  scopedClient.controls.dropPublishOffline();
  await publisher.publish({ name: 'Ada' }, { ttlMs: 1_000 });
  await flush();
  assert.equal(publisher.snapshot().publisher.status, 'publish-error');
  assert.equal(
    publisher.snapshot().publisher.diagnostic.code,
    'SNAPBACK_EPHEMERAL_OFFLINE_DROPPED',
  );
  assert.deepEqual(
    siblingObserver.snapshot().publisher,
    { status: 'observing', diagnostic: null },
    'a skip sibling does not inherit the originating token publish failure',
  );

  await publisher.publish({ name: 'Ada' }, { ttlMs: 1_000 });
  assert.equal(publisher.snapshot().publisher.status, 'published');
  scopedClient.controls.dropDeleteOffline();
  await assert.rejects(
    publisher.delete(),
    (error) => error?.code === 'SNAPBACK_EPHEMERAL_OFFLINE_DROPPED',
  );
  assert.equal(publisher.snapshot().publisher.status, 'publish-error');
  assert.equal(publisher.snapshot().publisher.diagnostic.details.operation, 'delete');
  assert.deepEqual(
    siblingObserver.snapshot().publisher,
    { status: 'observing', diagnostic: null },
    'a skip sibling does not inherit the originating token withdrawal failure',
  );
  await publisher.dispose();
  await siblingObserver.dispose();
  await scopedProvider.dispose();
}

// @ref LLP 0247#d3-presence-has-explicit-active-and-withdrawn-states — declarative
// published→skip keeps the read room but withdraws the exact acknowledged
// epoch/version pair within the generated visibility deadline.
const skipClient = fakeClient();
const skipBinding = await prepareReactBindingForClient(skipClient, {
  generatedManifest: { functions, schema, capabilityManifest },
});
const skipProvider = createSnapbackReactProvider(skipBinding, { connectionId: 'presence-skip' });
const skipObserver = observeSnapbackPresence(
  skipProvider,
  skipBinding.ephemeral.presence,
  { scope: { roomId: 'skip-room' }, value: { name: 'Ada' }, ttlMs: 1_000 },
  () => {},
);
await flush();
await flush();
assert.equal(skipObserver.snapshot().publisher.status, 'published');
const skipStartedAt = Date.now();
skipObserver.update({ scope: { roomId: 'skip-room' }, value: skip });
await flush();
assert.equal(skipClient.inspection().deletes, 1);
assert.deepEqual(skipClient.inspection().deleteCalls[0], {
  expectedScopeEpoch: 1,
  expectedEntryVersion: 1,
  authorityCapture: skipClient.captureAuthority(),
});
assert(
  Date.now() - skipStartedAt <= collection.withdrawalVisibilityDeadlineMs,
  'published→skip dispatches withdrawal within withdrawalVisibilityDeadlineMs',
);
assert.equal(skipObserver.snapshot().status, 'ready', 'skip retains the read room');
assert.equal(skipClient.inspection().handles, 1, 'skip does not dispose the room handle');
await skipObserver.dispose();
await skipProvider.dispose();

// A predecessor withdrawal is independent from successor publication. Its
// eventual superseded settlement is idempotent success and cannot blank the
// successor entry.
const supersededClient = fakeClient(
  'local-dev-sqlite-ibex',
  { schema, functions },
  { delayNextDelete: true },
);
const supersededBinding = await prepareReactBindingForClient(supersededClient, {
  generatedManifest: { functions, schema, capabilityManifest },
});
const supersededProvider = createSnapbackReactProvider(supersededBinding, {
  connectionId: 'presence-superseded',
});
const supersededObserver = observeSnapbackPresence(
  supersededProvider,
  supersededBinding.ephemeral.presence,
  { scope: { roomId: 'same-room' }, value: { name: 'Ada' }, ttlMs: 1_000 },
  () => {},
);
await flush();
await flush();
supersededObserver.update({ scope: { roomId: 'same-room' }, value: skip });
supersededObserver.update({
  scope: { roomId: 'same-room' },
  value: { name: 'Grace' },
  ttlMs: 1_000,
});
await flush();
await flush();
assert.equal(supersededClient.inspection().publishes, 2, 'republish is not serialized behind withdrawal');
assert.equal(typeof supersededClient.inspection().settleDelayedDelete, 'function');
supersededClient.inspection().settleDelayedDelete({ status: 'superseded' });
await flush();
assert.equal(supersededObserver.snapshot().entries[0].value.name, 'Grace');
await supersededObserver.dispose();
await supersededProvider.dispose();

// The auth barrier owns remote connection cleanup. React quiescence must
// blank/dispose locally without issuing an app delete under lost authority.
const authorityClient = fakeClient();
const authorityBinding = await prepareReactBindingForClient(authorityClient, {
  generatedManifest: { functions, schema, capabilityManifest },
});
const authorityProvider = createSnapbackReactProvider(authorityBinding, {
  connectionId: 'presence-authority-loss',
});
const authorityObserver = observeSnapbackPresence(
  authorityProvider,
  authorityBinding.ephemeral.presence,
  { scope: { roomId: 'authority-room' }, value: { name: 'Ada' }, ttlMs: 1_000 },
  () => {},
);
await flush();
await flush();
assert.equal(authorityObserver.snapshot().publisher.status, 'published');
const authorityBarrier = authorityClient.inspection().barrierParticipant;
await authorityBarrier.quiesce();
authorityBarrier.blank();
assert.equal(authorityClient.inspection().deletes, 0, 'authority loss issues no app delete');
await authorityObserver.dispose();
await authorityProvider.dispose();

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
  scopeContract,
  valueContract,
  routingFields: ['roomId'],
  defaultTtlMs: 1_000,
  maxTtlMs: 5_000,
  withdrawalVisibilityDeadlineMs: 500,
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
