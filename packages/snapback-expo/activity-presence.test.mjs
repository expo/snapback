import assert from 'node:assert/strict';

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
} from '@expo/snapback-react';

import { useSnapbackActivityPresence } from './activity-presence.mjs';
import { SnapbackExpoLifecycleContextProvider } from './provider.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((resolve) => setImmediate(resolve));
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
  defaultTtlMs: 6_000,
  maxTtlMs: 10_000,
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
  appId: 'expo-activity-presence-fixture',
  schemaHash: 'sha256:expo-activity-presence-schema',
  ephemeralCollections: [collection],
  tables: [],
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'expo-activity-presence-fixture',
  bundleHash: 'sha256:expo-activity-presence-functions',
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
  let publishAttempts = 0;
  let deletes = 0;
  const published = [];
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
    registerEphemeralRepublisher() { return Object.freeze({ dispose() {} }); },
    startEphemeralRoom() {
      const listeners = new Set();
      let disposed = false;
      let selfEntry = null;
      let peerEntries = [];
      let snapshot = Object.freeze({
        status: 'pending',
        entries: Object.freeze([]),
        selfKey: null,
        diagnostic: null,
        connection: 'connecting',
        reason: null,
      });
      const notify = () => {
        snapshot = Object.freeze({
          ...snapshot,
          entries: Object.freeze([
            ...(selfEntry === null ? [] : [selfEntry]),
            ...peerEntries,
          ]),
        });
        for (const listener of [...listeners]) listener();
      };
      let settleStarted;
      const started = new Promise((resolve) => { settleStarted = resolve; });
      queueMicrotask(() => {
        if (disposed) return;
        snapshot = Object.freeze({
          ...snapshot,
          status: 'ready',
          selfKey: 'expo-self',
          connection: 'live',
        });
        notify();
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
          const retained = Object.freeze({ ...value });
          published.push(retained);
          selfEntry = Object.freeze({
            key: 'expo-self',
            value: retained,
            expiresAtMs: Date.now() + ttlMs,
            receivedAtMs: Date.now(),
            scopeEpoch: 1,
            entryVersion: publishAttempts,
          });
          notify();
          return { accepted: true, scope_epoch: 1, entry_version: publishAttempts };
        },
        async delete() {
          deletes += 1;
          selfEntry = null;
          notify();
          return { status: 'deleted' };
        },
        setPeers(entries) {
          peerEntries = entries;
          notify();
        },
        dispose() {
          disposed = true;
          listeners.clear();
          settleStarted();
        },
        async settled() {},
      });
    },
    inspection: () => ({ publishAttempts, deletes, published: [...published] }),
  };
}

function lifecycleSource(initialState) {
  const listeners = new Set();
  let subscriptions = 0;
  let attachTransition = null;
  return {
    currentState: initialState,
    addEventListener(type, listener) {
      assert.equal(type, 'change');
      subscriptions += 1;
      listeners.add(listener);
      attachTransition?.(this);
      return { remove: () => listeners.delete(listener) };
    },
    transition(next) {
      this.currentState = next;
      for (const listener of [...listeners]) listener(next);
    },
    duringAttach(transition) { attachTransition = transition; },
    inspection: () => ({ subscriptions, listeners: listeners.size }),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function createHarness({ context, value, onError = undefined }) {
  const client = fakeClient();
  const binding = await prepareReactBindingForClient(client, {
    generatedManifest: { functions, schema, capabilityManifest },
  });
  const provider = createSnapbackReactProvider(binding, {
    connectionId: `expo-activity-${Math.random().toString(36).slice(2)}`,
  });
  let current = null;
  function Probe() {
    current = useSnapbackActivityPresence(binding.ephemeral.typing, {
      scope: { roomId: 'room-one' },
      value,
      idleMs: 60_000,
      ...(onError === undefined ? {} : { onError }),
    });
    return null;
  }
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackExpoLifecycleContextProvider,
      { value: context },
      React.createElement(
        SnapbackProvider,
        { provider },
        React.createElement(Probe),
      ),
    ));
    await flush();
  });
  return {
    client,
    get current() { return current; },
    async unmount() {
      await act(async () => {
        renderer.unmount();
        await flush();
      });
      await provider.dispose();
    },
  };
}

// Persistent background at mount gates touch without publishing and clears the
// retained intent once the lifecycle source settles.
{
  const resolution = deferred();
  let resolverCalls = 0;
  const source = lifecycleSource('background');
  const harness = await createHarness({
    context: {
      source: null,
      environment: {
        resolveAppState() {
          resolverCalls += 1;
          return resolution.promise;
        },
      },
    },
    value: () => ({ userHandle: 'ada', name: 'Ada' }),
  });
  act(() => { harness.current.touch(); });
  assert.equal(harness.current.active, true, 'pending lifecycle retains local intent');
  assert.equal(harness.client.inspection().publishAttempts, 0);
  await act(async () => {
    resolution.resolve(source);
    await flush();
  });
  assert.equal(resolverCalls, 1);
  assert.equal(source.inspection().subscriptions, 1);
  assert.equal(harness.current.active, false);
  assert.equal(harness.client.inspection().publishAttempts, 0);
  await harness.unmount();
}

// A background/active bounce while resolution is pending is represented by
// the final listener-first sample. Foreground admission uses the value captured
// by touch, never a later thunk evaluation.
{
  const resolution = deferred();
  const source = lifecycleSource('background');
  let valueCalls = 0;
  let currentName = 'captured-before-resolution';
  const harness = await createHarness({
    context: { source: null, environment: { resolveAppState: () => resolution.promise } },
    value: () => {
      valueCalls += 1;
      return { userHandle: 'ada', name: currentName };
    },
  });
  act(() => { harness.current.touch(); });
  source.transition('background');
  source.transition('active');
  currentName = 'must-not-be-re-evaluated';
  await act(async () => {
    resolution.resolve(source);
    await flush();
    await flush();
  });
  assert.equal(valueCalls, 1);
  assert.deepEqual(harness.client.inspection().published, [
    { userHandle: 'ada', name: 'captured-before-resolution' },
  ]);
  await act(async () => {
    source.transition('background');
    await flush();
  });
  assert.equal(harness.current.active, false);
  assert.equal(harness.client.inspection().deletes, 1);
  await harness.unmount();
}

// If the source bounces through background while the listener itself is being
// attached, the background observation clears pending intent and the following
// active state cannot resurrect it.
{
  const resolution = deferred();
  const source = lifecycleSource('active');
  source.duringAttach((attached) => {
    attached.transition('background');
    attached.transition('active');
  });
  const harness = await createHarness({
    context: { source: null, environment: { resolveAppState: () => resolution.promise } },
    value: () => ({ userHandle: 'ada', name: 'Ada' }),
  });
  act(() => { harness.current.touch(); });
  await act(async () => {
    resolution.resolve(source);
    await flush();
    await flush();
  });
  assert.equal(harness.current.active, false);
  assert.equal(harness.client.inspection().publishAttempts, 0);
  await harness.unmount();
}

// The exact provider-resolved source wins over its environment, so wrapper and
// boot never attach to competing lifecycle objects.
{
  const source = lifecycleSource('active');
  let resolverCalls = 0;
  const harness = await createHarness({
    context: {
      source,
      environment: {
        resolveAppState() {
          resolverCalls += 1;
          return lifecycleSource('active');
        },
      },
    },
    value: () => ({ userHandle: 'ada', name: 'Ada' }),
  });
  act(() => { harness.current.touch(); });
  await act(async () => { await flush(); });
  assert.equal(resolverCalls, 0);
  assert.equal(source.inspection().subscriptions, 1);
  assert.equal(harness.client.inspection().publishAttempts, 1);
  await harness.unmount();
}

// Lifecycle resolution failure is one stable Expo error, permanently declines
// later touch calls, and leaves the canonical observer projection usable.
{
  const resolution = deferred();
  const errors = [];
  let valueCalls = 0;
  const harness = await createHarness({
    context: { source: null, environment: { resolveAppState: () => resolution.promise } },
    value: () => {
      valueCalls += 1;
      return { userHandle: 'ada', name: 'Ada' };
    },
    onError: (error) => errors.push(error),
  });
  act(() => { harness.current.touch(); });
  await act(async () => {
    resolution.reject(new Error('AppState unavailable'));
    await flush();
    await flush();
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'SNAPBACK_EXPO_ACTIVITY_LIFECYCLE_UNAVAILABLE');
  assert.equal(harness.current.lastError, errors[0]);
  assert.equal(harness.current.active, false);
  assert.equal(harness.current.status, 'ready');
  assert.deepEqual(harness.current.peers, []);
  act(() => { harness.current.touch(); });
  assert.equal(valueCalls, 1, 'failed lifecycle permanently declines later touch calls');
  assert.equal(harness.client.inspection().publishAttempts, 0);
  assert.equal(errors.length, 1);
  await harness.unmount();
}

console.log('activity-presence.test.mjs: Expo lifecycle gating, source sharing, retained admission, background withdrawal, and failure pass');
