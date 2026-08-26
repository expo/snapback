import assert from 'node:assert/strict';

import React, { StrictMode } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { EphemeralOverlay, SnapbackClient } from '../snapback-client/index.mjs';
import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  isSnapbackDiagnosticError,
  useSnapbackActivityPresence,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((resolve) => setImmediate(resolve));
const codedError = (code, message = code) => {
  const error = new Error(message);
  error.code = code;
  error.diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message,
    details: Object.freeze({}),
  });
  return error;
};

const valueContract = Object.freeze({
  kind: 'object',
  fields: Object.freeze([
    Object.freeze({ name: 'userHandle', required: true, value: { kind: 'string', maxBytes: 32 } }),
    Object.freeze({ name: 'name', required: true, value: { kind: 'string', maxBytes: 32 } }),
  ]),
  allowExtra: false,
});
const scopeContract = Object.freeze({
  kind: 'object',
  fields: Object.freeze([
    Object.freeze({ name: 'roomId', required: true, value: { kind: 'string', maxBytes: 32 } }),
  ]),
  allowExtra: false,
});
const collection = Object.freeze({
  name: 'typing',
  scopeFields: ['roomId'],
  scopeContract,
  valueContract,
  keyMode: 'Connection',
  routingFields: ['roomId'],
  defaultTtlMs: 1_000,
  maxTtlMs: 5_000,
  withdrawalVisibilityDeadlineMs: 500,
  maxValueBytes: 256,
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
  appId: 'activity-presence-fixture',
  schemaHash: 'sha256:activity-presence-schema',
  ephemeralCollections: [collection],
  tables: [],
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'activity-presence-fixture',
  bundleHash: 'sha256:activity-presence-functions',
  functions: [],
});
const capabilityManifest = Object.freeze({
  artifactKind: 'capabilityManifest',
  schemaVersion: 'snapback.v0',
  targetProfileId: 'local-dev-sqlite-ibex',
  supportedCapabilities: ['live_subscriptions'],
});

function fakeClient() {
  const authorityCapture = Object.freeze({ revision: 1 });
  const handles = new Set();
  let starts = 0;
  let publishAttempts = 0;
  let publishes = 0;
  let deletes = 0;
  let activeHandles = 0;
  let failNextPublish = false;
  let dropNextPublishOffline = false;
  let failNextDelete = false;
  let dropNextDeleteOffline = false;
  return {
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
    registerAuthBarrierParticipant() { return async () => {}; },
    captureAuthority: () => authorityCapture,
    authorityCaptureFor: () => authorityCapture,
    isAuthorityCaptureCurrent: (capture) => capture === authorityCapture,
    liveStreamManager() { return { async settled() {} }; },
    registerEphemeralRepublisher() {
      return Object.freeze({ dispose() {} });
    },
    startEphemeralRoom(_definition, scope) {
      starts += 1;
      activeHandles += 1;
      const selfKey = `self-${starts}`;
      const listeners = new Set();
      let disposed = false;
      let ownEntry = null;
      let peerEntries = [];
      let snapshot = Object.freeze({
        status: 'pending',
        entries: Object.freeze([]),
        selfKey: null,
        diagnostic: null,
        connection: 'connecting',
        reason: null,
      });
      const publishSnapshot = () => {
        snapshot = Object.freeze({
          ...snapshot,
          entries: Object.freeze([
            ...(ownEntry === null ? [] : [ownEntry]),
            ...peerEntries,
          ]),
        });
        for (const listener of [...listeners]) listener();
      };
      let settleStarted;
      const started = new Promise((resolve) => { settleStarted = resolve; });
      const handle = {
        setPeers(entries) {
          peerEntries = entries.map((entry, index) => Object.freeze({
            key: entry.key,
            value: Object.freeze(entry.value),
            expiresAtMs: 10_000,
            receivedAtMs: 1_000,
            scopeEpoch: 1,
            entryVersion: 100 + index,
          }));
          publishSnapshot();
        },
        reconnect() {
          snapshot = Object.freeze({ ...snapshot, status: 'resyncing', connection: 'connecting' });
          publishSnapshot();
          queueMicrotask(() => {
            if (disposed) return;
            snapshot = Object.freeze({ ...snapshot, status: 'ready', connection: 'live' });
            publishSnapshot();
          });
        },
      };
      handles.add(handle);
      queueMicrotask(() => {
        if (disposed) return;
        snapshot = Object.freeze({
          ...snapshot,
          status: 'ready',
          selfKey,
          connection: 'live',
        });
        publishSnapshot();
        settleStarted();
      });
      return Object.freeze({
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getSnapshot: () => snapshot,
        getServerSnapshot: () => snapshot,
        get grantedConnectionId() { return snapshot.selfKey; },
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
                details: Object.freeze({ queued: false }),
              }),
            });
          }
          if (failNextPublish) {
            failNextPublish = false;
            throw codedError('SNAPBACK_REACT_QUERY_FAILED', 'simulated publish failure');
          }
          publishes += 1;
          ownEntry = Object.freeze({
            key: selfKey,
            value: Object.freeze({ ...value }),
            expiresAtMs: 1_000 + ttlMs,
            receivedAtMs: 1_000,
            scopeEpoch: 1,
            entryVersion: publishes,
            scope,
          });
          publishSnapshot();
          return { accepted: true, scope_epoch: 1, entry_version: publishes };
        },
        async delete() {
          deletes += 1;
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
          if (failNextDelete) {
            failNextDelete = false;
            throw codedError('SNAPBACK_REACT_PROVIDER_CLOSED', 'simulated withdrawal failure');
          }
          ownEntry = null;
          publishSnapshot();
          return { status: 'deleted' };
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          activeHandles -= 1;
          handles.delete(handle);
          listeners.clear();
          settleStarted();
        },
        async settled() {},
      });
    },
    controls: Object.freeze({
      failPublish() { failNextPublish = true; },
      dropPublishOffline() { dropNextPublishOffline = true; },
      dropDeleteOffline() { dropNextDeleteOffline = true; },
      failDelete() { failNextDelete = true; },
      reconnect() {
        for (const handle of handles) handle.reconnect();
      },
      setPeers(entries) {
        for (const handle of handles) handle.setPeers(entries);
      },
    }),
    inspection() {
      return { starts, publishAttempts, publishes, deletes, activeHandles };
    },
  };
}

function managedTerminalRoomClient() {
  const client = fakeClient();
  let managerListener = null;
  let managerOpen = true;
  let roomHandle = null;
  let roomOverlay = null;
  const manager = {
    onState(listener) {
      managerListener = listener;
      listener('open');
      return () => {
        if (managerListener === listener) managerListener = null;
      };
    },
    isOpen() { return managerOpen; },
    async waitUntilReady() {},
    async settled() {},
    emit(state, detail = {}) {
      managerOpen = state === 'open';
      managerListener?.(state, detail);
    },
  };
  client.authProtocols = {};
  client.registerEphemeralConsumer = () => () => {};
  client.liveStreamManager = () => manager;
  client.connectionGrant = async () => ({
    id: 'managed-self',
    ephemeralExpiryProtocol: 1,
  });
  client.subscribeEphemeral = async (ref, { connectionId, scope }) => {
    roomOverlay = new EphemeralOverlay(client, ref, {
      connectionId,
      scope,
      permissions: [],
    });
    roomOverlay.grantedConnectionId = 'managed-self';
    roomOverlay.applyInitialSnapshot({
      Snapshot: {
        room: {
          collection: ref.name,
          scope,
          routing_key: `room:${scope.roomId}`,
        },
        scope_epoch: 1,
        room_authority_generation: 1,
        high_water_version: 0,
        entries: [],
      },
    });
    return roomOverlay;
  };
  client.unsubscribeEphemeral = async () => ({ removed: true });
  client.startEphemeralRoom = (definition, scope) => {
    roomHandle = SnapbackClient.prototype.startEphemeralRoom.call(client, definition, scope);
    return roomHandle;
  };
  client.controls = Object.freeze({
    ...client.controls,
    applyPermissionDenied() {
      return roomOverlay.apply({
        Error: {
          room: roomOverlay.room,
          room_authority_generation: 2,
          error: { code: 'PermissionDenied', message: 'membership was revoked' },
        },
      });
    },
    emitManager(state, detail = {}) { manager.emit(state, detail); },
    roomSnapshot() { return roomHandle.getSnapshot(); },
  });
  return client;
}

async function createHarness({
  roomId = 'room-one',
  idleMs = 300,
  ttlMs = undefined,
  excludeSelf = undefined,
  value = () => ({ userHandle: 'ada', name: 'Ada' }),
  onError = undefined,
  strict = false,
  client: suppliedClient = null,
} = {}) {
  const client = suppliedClient ?? fakeClient();
  const binding = await prepareReactBindingForClient(client, {
    generatedManifest: { functions, schema, capabilityManifest },
  });
  const provider = createSnapbackReactProvider(binding, {
    connectionId: `activity-${Math.random().toString(36).slice(2)}`,
  });
  let current = null;
  let renderer = null;
  let props = { roomId, idleMs, ttlMs, excludeSelf, value, onError };
  function Probe(next) {
    current = useSnapbackActivityPresence(binding.ephemeral.typing, {
      scope: { roomId: next.roomId },
      value: next.value,
      idleMs: next.idleMs,
      ...(next.ttlMs === undefined ? {} : { ttlMs: next.ttlMs }),
      ...(next.excludeSelf === undefined ? {} : { excludeSelf: next.excludeSelf }),
      ...(next.onError === undefined ? {} : { onError: next.onError }),
    });
    return null;
  }
  const tree = () => React.createElement(
    strict ? StrictMode : React.Fragment,
    null,
    React.createElement(
      SnapbackProvider,
      { provider },
      React.createElement(Probe, props),
    ),
  );
  await act(async () => {
    renderer = TestRenderer.create(tree());
    await flush();
  });
  return {
    binding,
    client,
    provider,
    get current() { return current; },
    async update(next) {
      props = { ...props, ...next };
      await act(async () => {
        renderer.update(tree());
        await flush();
      });
    },
    async unmount() {
      if (renderer !== null) {
        await act(async () => {
          renderer.unmount();
          await flush();
        });
        renderer = null;
      }
      await provider.dispose();
    },
  };
}

// @ref LLP 0257#result-and-error-surface — activity presence is an exact
// base-state projection: terminal denial stays distinct from an empty ready room.
{
  const client = managedTerminalRoomClient();
  const harness = await createHarness({ client });
  act(() => {
    assert.equal(client.controls.applyPermissionDenied(), 'terminal_error');
  });
  const diagnostic = client.controls.roomSnapshot().diagnostic;
  assert.equal(harness.current.status, 'error');
  assert.equal(harness.current.diagnostic, diagnostic);
  assert.deepEqual(harness.current.peers, []);
  assert.equal(harness.current.lastError, null, 'base terminal state is passthrough, not a helper action failure');

  const transportError = codedError('NETWORK_LOST', 'socket was lost');
  act(() => { client.controls.emitManager('lost', { error: transportError }); });
  assert.equal(client.controls.roomSnapshot().status, 'error');
  assert.equal(client.controls.roomSnapshot().diagnostic, diagnostic);
  assert.equal(client.controls.roomSnapshot().connection, 'stale');
  assert.equal(client.controls.roomSnapshot().reason, 'auth_revoked');
  assert.equal(harness.current.status, 'error');
  assert.equal(
    harness.current.diagnostic,
    diagnostic,
    'React/activity preserves the terminal diagnostic identity after transport noise',
  );
  assert.equal(harness.current.diagnostic.code, 'SNAPBACK_AUTH_PERMISSION_DENIED');
  assert.equal(harness.current.connection, 'stale');
  await harness.unmount();
}

function captureActivityTimer(run) {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false, unref() {} };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => { timer.cleared = true; };
  try {
    run();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
  assert.equal(timers.length, 1, 'one helper-owned idle timer is scheduled');
  return timers[0];
}

async function fireTimerAt(timer, now) {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    await act(async () => {
      timer.callback();
      await flush();
    });
  } finally {
    Date.now = originalNow;
  }
}

// First touch admits once. Repeated unchanged touches re-arm only the helper
// deadline while the canonical base publisher performs its unchanged-pair no-op.
{
  let valueCalls = 0;
  const harness = await createHarness({
    value: () => {
      valueCalls += 1;
      return { userHandle: 'ada', name: 'Ada' };
    },
  });
  assert.equal(harness.current.status, 'ready');
  const firstNow = Date.now();
  let firstTimer;
  act(() => {
    firstTimer = captureActivityTimer(() => harness.current.touch());
  });
  await act(async () => { await flush(); });
  assert.equal(valueCalls, 1);
  assert.equal(harness.client.inspection().publishes, 1, 'first touch publishes');
  assert.equal(harness.current.active, true);
  assert.equal(harness.current.publisher.status, 'published');
  assert.equal(harness.current.connection, 'live');

  const secondNow = Date.now();
  let secondTimer;
  act(() => {
    secondTimer = captureActivityTimer(() => harness.current.touch());
  });
  await act(async () => { await flush(); });
  assert.equal(valueCalls, 2, 'the thunk is sampled on every touch');
  assert.equal(harness.client.inspection().publishes, 1, 'unchanged value/TTL is a base no-op');

  await fireTimerAt(firstTimer, firstNow + 1_000);
  assert.equal(
    harness.client.inspection().deletes,
    0,
    'a canceled-but-queued predecessor timer cannot withdraw a newer generation',
  );
  assert.equal(harness.current.active, true);

  await fireTimerAt(secondTimer, secondNow + 1_000);
  assert.equal(harness.current.active, false);
  assert.equal(harness.client.inspection().deletes, 1, 'idle expiry withdraws');

  let thirdTimer;
  act(() => { thirdTimer = captureActivityTimer(() => harness.current.touch()); });
  await act(async () => { await flush(); });
  assert.equal(harness.current.active, true);
  await act(async () => { await harness.current.withdraw(); });
  assert.equal(typeof thirdTimer.callback, 'function');
  assert.equal(harness.current.active, false);
  assert.equal(harness.client.inspection().deletes, 2, 'explicit withdrawal is immediate');

  act(() => { captureActivityTimer(() => harness.current.touch()); });
  await act(async () => { await flush(); });
  act(() => {
    harness.client.controls.setPeers([
      { key: 'same-user-other-device', value: { userHandle: 'ada', name: 'Ada phone' } },
      { key: 'peer-grace', value: { userHandle: 'grace', name: 'Grace' } },
    ]);
  });
  assert.deepEqual(
    harness.current.peers.map((entry) => entry.key),
    ['same-user-other-device', 'peer-grace'],
    'self filtering removes selfKey only, not same-user values from another device',
  );
  await harness.update({ excludeSelf: false });
  assert.equal(
    harness.current.peers.some((entry) => entry.key.startsWith('self-')),
    true,
    'excludeSelf false retains the granted connection entry',
  );
  await harness.unmount();
}

// A true room identity change withdraws the predecessor through the base token
// release and never carries the activity generation into the successor room.
{
  const harness = await createHarness();
  act(() => { captureActivityTimer(() => harness.current.touch()); });
  await act(async () => { await flush(); });
  assert.equal(harness.client.inspection().publishes, 1);
  await harness.update({ roomId: 'room-two' });
  await act(async () => { await flush(); });
  assert.equal(harness.current.active, false);
  assert.equal(harness.client.inspection().starts, 2);
  assert.equal(harness.client.inspection().publishes, 1, 'new room stays withdrawn');
  assert.equal(harness.client.inspection().deletes, 1, 'old room intent is withdrawn');
  await harness.unmount();
}

// A render after a host-suspended timer's absolute deadline synchronously
// clears local activity and schedules the fenced withdrawal without waiting
// for that timer callback to run.
{
  const harness = await createHarness();
  const touchedAt = Date.now();
  act(() => { captureActivityTimer(() => harness.current.touch()); });
  await act(async () => { await flush(); });
  const originalNow = Date.now;
  Date.now = () => touchedAt + 1_000;
  try {
    await act(async () => {
      harness.client.controls.setPeers([
        { key: 'peer-grace', value: { userHandle: 'grace', name: 'Grace' } },
      ]);
      await flush();
    });
  } finally {
    Date.now = originalNow;
  }
  assert.equal(harness.current.active, false);
  assert.equal(harness.client.inspection().deletes, 1, 'render backstop withdraws expired intent');
  await harness.unmount();
}

// Strict Mode effect replay does not duplicate publication, while real unmount
// withdraws the final admitted generation and leaves no room handles.
{
  const harness = await createHarness({ strict: true });
  act(() => { captureActivityTimer(() => harness.current.touch()); });
  await act(async () => { await flush(); });
  assert.equal(harness.client.inspection().publishes, 1);
  await harness.unmount();
  assert.equal(harness.client.inspection().deletes, 1);
  assert.equal(harness.client.inspection().activeHandles, 0);
}

// Four React-side error classes share onError/lastError and recover by the
// next successful admission or withdrawal.
{
  const errors = [];
  let throwValue = true;
  let currentName = 'Ada';
  const harness = await createHarness({
    onError: (error) => errors.push(error),
    value: () => {
      if (throwValue) throw new Error('thunk exploded');
      return { userHandle: 'ada', name: currentName };
    },
  });
  act(() => { harness.current.touch(); });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'SNAPBACK_REACT_ACTIVITY_VALUE_FAILED');
  assert.equal(harness.current.lastError, errors[0]);
  assert.equal(harness.client.inspection().publishAttempts, 0);

  throwValue = false;
  act(() => { captureActivityTimer(() => harness.current.touch()); });
  await act(async () => { await flush(); });
  assert.equal(harness.current.lastError, null, 'successful admission clears thunk failure');

  throwValue = true;
  const attemptsBeforeFailedRefresh = harness.client.inspection().publishAttempts;
  act(() => { harness.current.touch(); });
  assert.equal(harness.current.active, true, 'a failed refresh preserves prior unexpired intent');
  assert.equal(harness.client.inspection().publishAttempts, attemptsBeforeFailedRefresh);
  throwValue = false;
  act(() => { captureActivityTimer(() => harness.current.touch()); });
  await act(async () => { await flush(); });
  assert.equal(harness.current.lastError, null);

  await harness.update({ ttlMs: 499 });
  act(() => { captureActivityTimer(() => harness.current.touch()); });
  await act(async () => { await flush(); });
  assert.equal(errors.at(-1).code, 'SNAPBACK_REACT_PRESENCE_HEARTBEAT_UNSUPPORTED');
  assert.equal(harness.current.lastError?.code, 'SNAPBACK_REACT_PRESENCE_HEARTBEAT_UNSUPPORTED');

  await harness.update({ ttlMs: 1_000 });
  currentName = 'Ada changed';
  harness.client.controls.failPublish();
  act(() => { captureActivityTimer(() => harness.current.touch()); });
  await act(async () => { await flush(); await flush(); });
  assert.equal(harness.current.publisher.status, 'publish-error');
  assert.equal(errors.at(-1).code, 'SNAPBACK_REACT_QUERY_FAILED');
  const transportReports = errors.filter(
    (error) => error.code === 'SNAPBACK_REACT_QUERY_FAILED',
  );
  assert.equal(transportReports.length, 1, 'one observed publish-error transition reports once');

  act(() => { captureActivityTimer(() => harness.current.touch()); });
  await act(async () => { await flush(); await flush(); });
  assert.equal(harness.current.publisher.status, 'published');
  assert.equal(harness.current.lastError, null);

  harness.client.controls.failDelete();
  await act(async () => {
    await assert.doesNotReject(harness.current.withdraw());
    await flush();
  });
  assert.equal(errors.at(-1).code, 'SNAPBACK_REACT_PROVIDER_CLOSED');
  assert.equal(harness.current.lastError?.code, 'SNAPBACK_REACT_PROVIDER_CLOSED');
  await act(async () => { await harness.current.withdraw(); });
  assert.equal(harness.current.lastError, null, 'successful withdrawal clears the error');
  await harness.unmount();
}

// An expected offline best-effort outcome is state, not a rejected activity
// action. Provider-memory desired intent survives the drop and republishes on
// reconnect before the idle deadline.
{
  const errors = [];
  const harness = await createHarness({ onError: (error) => errors.push(error) });
  harness.client.controls.dropPublishOffline();
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    act(() => { captureActivityTimer(() => harness.current.touch()); });
    await act(async () => { await flush(); await flush(); });
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.equal(unhandled.length, 0);
  assert.equal(harness.current.active, true);
  assert.equal(harness.current.publisher.status, 'publish-error');
  assert.equal(harness.current.publisher.diagnostic.code, 'SNAPBACK_EPHEMERAL_OFFLINE_DROPPED');
  assert.equal(harness.current.publisher.diagnostic.details.queued, false);
  assert.equal(errors.at(-1).code, 'SNAPBACK_EPHEMERAL_OFFLINE_DROPPED');
  assert.equal(harness.provider.inspection().publishers, 1, 'provider desired-state survives the drop');
  await act(async () => {
    harness.client.controls.reconnect();
    await flush();
    await flush();
  });
  assert.equal(harness.current.active, true);
  assert.equal(harness.client.inspection().publishAttempts, 2);
  assert.equal(harness.client.inspection().publishes, 1, 'reconnect republishes retained intent');
  assert.equal(harness.provider.inspection().publishers, 1);
  assert.equal(harness.current.publisher.status, 'published');
  await harness.unmount();
}

// A classified dropped DELETE is an observable withdrawal failure. It must
// not be mistaken for the successful withdrawal that clears publisher state
// and activity lastError.
{
  const errors = [];
  const harness = await createHarness({ onError: (error) => errors.push(error) });
  act(() => { captureActivityTimer(() => harness.current.touch()); });
  await act(async () => { await flush(); });
  harness.client.controls.dropDeleteOffline();
  await act(async () => {
    await assert.doesNotReject(harness.current.withdraw());
    await flush();
  });
  assert.equal(harness.current.active, false);
  assert.equal(harness.current.publisher.status, 'publish-error');
  assert.equal(harness.current.publisher.diagnostic.code, 'SNAPBACK_EPHEMERAL_OFFLINE_DROPPED');
  assert.equal(harness.current.publisher.diagnostic.details.operation, 'delete');
  assert.equal(harness.current.lastError?.code, 'SNAPBACK_EPHEMERAL_OFFLINE_DROPPED');
  assert.equal(errors.at(-1), harness.current.lastError);
  assert.equal(harness.client.inspection().deletes, 1);
  await harness.unmount();
}

// idleMs is always admitted during hook render and uses the public typed
// diagnostic carrier in every build.
{
  const client = fakeClient();
  const binding = await prepareReactBindingForClient(client, {
    generatedManifest: { functions, schema, capabilityManifest },
  });
  const provider = createSnapbackReactProvider(binding);
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    for (const idleMs of [0, 249, -1, Number.NaN, Number.POSITIVE_INFINITY, 250.5, 2_147_483_648]) {
      function InvalidProbe() {
        useSnapbackActivityPresence(binding.ephemeral.typing, {
          scope: { roomId: 'invalid' },
          value: () => ({ userHandle: 'ada', name: 'Ada' }),
          idleMs,
        });
        return null;
      }
      await assert.rejects(
        Promise.resolve(act(async () => {
          TestRenderer.create(React.createElement(
            SnapbackProvider,
            { provider },
            React.createElement(InvalidProbe),
          ));
        })),
        (error) => isSnapbackDiagnosticError(error)
          && error.code === 'SNAPBACK_REACT_ACTIVITY_IDLE_MS_INVALID',
        String(idleMs),
      );
    }
  } finally {
    console.error = originalConsoleError;
  }
  await provider.dispose();
}

console.log('activity-presence.test.mjs: activity deadlines, fences, errors, filtering, room reset, Strict Mode, and cleanup pass');
