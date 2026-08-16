import assert from 'node:assert/strict';
import { mock } from 'node:test';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  LIVE_RECONNECT_BASE_DELAY_MS,
  LIVE_RECONNECT_MAX_DELAY_MS,
} from '../snapback-client/index.mjs';
import { createSnapbackReactProvider } from './index.mjs';

// Regression: the RN carrier subscribe retry storm
// (issues/closed/20260803-rn-carrier-bricked-tosorted-registration-ledger.md,
// LLP 0114 §Bounded subscribe-failure window — 2026-08-04). When a live-query
// subscribe fails synchronously (the handle's started() rejects before any
// transport exists), the provider used to re-attempt on every render-driven
// re-subscribe — ~21,800 provider snapshots in ~3 minutes on the captured
// evidence, starving the JS thread. The store must instead hold the error
// snapshot behind a bounded failure window: attempts follow the client's
// 250ms→10s reconnect ladder (held at the cap while demanded), and render
// cadence never drives attempt cadence.

const flush = () => new Promise((resolve) => setImmediate(resolve));
const queryContract = {
  kind: 'records',
  record: {
    kind: 'object',
    fields: [
      { name: 'id', required: true, value: { kind: 'string', maxBytes: 32 } },
    ],
    allowExtra: false,
  },
};
const records = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'retry-fixture',
  id: 'retry-fixture:records',
  name: 'records',
  kind: 'LiveQuery',
  implementationHash: 'sha256:records-implementation',
  argsContractHash: 'sha256:records-args',
  argsContract: { kind: 'object', fields: [] },
  resultContractHash: resultContractHash(queryContract),
  resultContract: queryContract,
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'retry-fixture',
  bundleHash: 'sha256:retry-bundle',
  functions: [records],
});

const ROWS = [{ id: 'rec-1' }, { id: 'rec-2' }];

function fakeClient({
  failureCode = 'SNAPBACK_CLIENT_DEMAND_REGISTRATION_FAILED',
  failureStatus = undefined,
} = {}) {
  const state = {
    attempts: 0,
    failing: true,
  };
  return {
    state,
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:retry-schema' },
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
    registerAuthBarrierParticipant() { return async () => {}; },
    liveStreamManager() { return { async settled() {} }; },
    startLiveQuery(_reference, options) {
      state.attempts += 1;
      if (state.failing) {
        const error = new Error(`${failureCode}: live subscribe refused`);
        error.code = failureCode;
        error.diagnostic = Object.freeze({
          schemaVersion: 'snapback.client-diagnostic.v1',
          code: failureCode,
          severity: 'error',
          subsystem: 'client',
          message: error.message,
          details: Object.freeze({}),
        });
        if (failureStatus !== undefined) error.status = failureStatus;
        const rejection = Promise.reject(error);
        rejection.catch(() => {});
        return Object.freeze({
          current: null,
          options,
          started: () => rejection,
          dispose() {},
          settled: async () => {},
        });
      }
      const current = { rows: [...ROWS], connection: 'live' };
      const handle = {
        current,
        options,
        started: async () => {},
        dispose() {},
        settled: async () => {},
      };
      queueMicrotask(() => options.onUpdate(current.rows, {}));
      return Object.freeze(handle);
    },
  };
}

const client = fakeClient();
const binding = await prepareReactBindingForClient(client, { generatedManifest: functions });
const provider = createSnapbackReactProvider(binding, { connectionId: 'retry-test' });

// The failure window is timer-owned; drive it deterministically.
mock.timers.enable({ apis: ['setTimeout'] });
const registry = provider.registry;
const descriptor = registry.descriptor(records, {});
const listener = () => {};

// Mimic exactly what useSnapbackQuery's subscribe callback does per identity
// change: a superseding registry.subscribe carrying the previous lease.
let lease = registry.subscribe(descriptor, listener);
await flush();

// (a/b) One mount, one attempt; the failure is a held, renderable snapshot.
assert.equal(client.state.attempts, 1, 'the mount subscribe attempts exactly once');
let snapshot = registry.snapshot(descriptor);
assert.equal(snapshot.status, 'error', 'the synchronous failure is surfaced');
assert.equal(snapshot.error?.code, 'SNAPBACK_CLIENT_DEMAND_REGISTRATION_FAILED');

// Storm reproduction: hammer render-driven re-subscribes and snapshot reads
// far faster than any plausible render cadence. Zero further attempts may
// occur — attempt cadence belongs to the window timer alone.
for (let render = 0; render < 500; render += 1) {
  lease = registry.subscribe(descriptor, listener, lease);
  const read = registry.snapshot(descriptor);
  assert.equal(read.status, 'error', 'renders during the window read the held failure');
  assert.equal(read.error?.code, 'SNAPBACK_CLIENT_DEMAND_REGISTRATION_FAILED');
}
await flush();
assert.equal(client.state.attempts, 1, '500 re-subscribing renders trigger zero new attempts');

// The schedule is the client's reconnect ladder: 250ms, 500ms, 1s, 2s, ...
// Just before each boundary nothing fires; at it, exactly one attempt.
let expectedAttempts = 1;
for (const delay of [250, 500, 1000, 2000, 4000, 8000]) {
  assert.equal(delay, Math.min(
    LIVE_RECONNECT_BASE_DELAY_MS * 2 ** (expectedAttempts - 1),
    LIVE_RECONNECT_MAX_DELAY_MS,
  ), 'test ladder mirrors the client constants');
  mock.timers.tick(delay - 1);
  await flush();
  assert.equal(client.state.attempts, expectedAttempts, `no attempt before the ${delay}ms boundary`);
  mock.timers.tick(1);
  await flush();
  expectedAttempts += 1;
  assert.equal(client.state.attempts, expectedAttempts, `one attempt at the ${delay}ms boundary`);
  lease = registry.subscribe(descriptor, listener, lease);
  await flush();
  assert.equal(client.state.attempts, expectedAttempts, 'a mid-window re-subscribe stays inert');
}

// At the cap the store holds the failure and keeps retrying at 10s — the
// LiveStreamManager convention for demanded-but-unreachable state. Over a
// simulated 60s, attempts are bounded by the ladder, not by render count.
const attemptsAtCapEntry = client.state.attempts;
for (let tick = 0; tick < 60; tick += 1) {
  mock.timers.tick(1000);
  for (let render = 0; render < 25; render += 1) {
    lease = registry.subscribe(descriptor, listener, lease);
  }
  await flush();
}
const cappedAttempts = client.state.attempts - attemptsAtCapEntry;
assert.equal(cappedAttempts, 6, 'held at the 10s cap: six attempts across a simulated minute');
snapshot = registry.snapshot(descriptor);
assert.equal(snapshot.status, 'error', 'the failure snapshot is stable across the whole window');

// (c) Recovery: the next scheduled attempt under a healthy backend succeeds,
// clears the window, and delivers authoritative rows.
client.state.failing = false;
mock.timers.tick(LIVE_RECONNECT_MAX_DELAY_MS);
await flush();
snapshot = registry.snapshot(descriptor);
assert.equal(snapshot.status, 'ready', 'a successful subscribe clears the failure window');
assert.deepEqual(snapshot.data, ROWS);
assert.equal(snapshot.error, null);
const attemptsAfterRecovery = client.state.attempts;

// (d) Healthy path untouched: further renders and time neither re-subscribe
// nor schedule anything.
for (let render = 0; render < 100; render += 1) {
  lease = registry.subscribe(descriptor, listener, lease);
}
mock.timers.tick(120_000);
await flush();
assert.equal(client.state.attempts, attemptsAfterRecovery, 'the healthy store never re-attempts');
assert.equal(registry.snapshot(descriptor).status, 'ready');

// A fresh failure after recovery restarts the ladder at its base (attempts
// were reset by the successful subscribe): release to idle, remount failing.
lease.release();
await flush();
await flush();
client.state.failing = true;
const attemptsBeforeRemount = client.state.attempts;
lease = registry.subscribe(descriptor, listener);
await flush();
assert.equal(client.state.attempts, attemptsBeforeRemount + 1, 'the remount attempts once');
mock.timers.tick(LIVE_RECONNECT_BASE_DELAY_MS - 1);
await flush();
assert.equal(client.state.attempts, attemptsBeforeRemount + 1, 'the restarted ladder waits its base delay');
mock.timers.tick(1);
await flush();
assert.equal(client.state.attempts, attemptsBeforeRemount + 2, 'the restarted ladder begins at 250ms again');

// Releasing the last consumer clears the pending retry timer: no orphan
// attempts fire after the store goes idle.
lease.release();
await flush();
await flush();
const attemptsAtRelease = client.state.attempts;
mock.timers.tick(120_000);
await flush();
assert.equal(client.state.attempts, attemptsAtRelease, 'idle release cancels the scheduled retry');

// Protocol/profile negotiation 400s are a closed configuration-refusal set.
// Every member renders once and remains timer-free; similarly named legacy,
// readiness, conflict, and transport neighbors retain the retry ladder.
const terminalCodes = [
  'SNAPBACK_AUTHORIZED_LEASE_CLIENT_UNSUPPORTED',
  'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED',
  'SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED',
  'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_UNSUPPORTED',
  'SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED',
  'SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED',
  'SNAPBACK_EPHEMERAL_AUTHORITY_PROTOCOL_MISMATCH',
  'SNAPBACK_EPHEMERAL_EXPIRY_PROTOCOL_MISMATCH',
  'SNAPBACK_WIRE_VERSION_MISMATCH',
  'SNAPBACK_WIRE_VERSION_REQUIRED',
  'SNAPBACK_WIRE_VERSION_UNSUPPORTED',
];

for (const [index, failureCode] of terminalCodes.entries()) {
  const terminalClient = fakeClient({ failureCode, failureStatus: 400 });
  const terminalBinding = await prepareReactBindingForClient(terminalClient, {
    generatedManifest: functions,
  });
  const terminalProvider = createSnapbackReactProvider(terminalBinding, {
    connectionId: `terminal-protocol-test-${index}`,
  });
  const terminalDescriptor = terminalProvider.registry.descriptor(records, {});
  let terminalLease = terminalProvider.registry.subscribe(terminalDescriptor, listener);
  await flush();
  assert.equal(terminalClient.state.attempts, 1, `${failureCode}: attempts once`);
  const terminalSnapshot = terminalProvider.registry.snapshot(terminalDescriptor);
  assert.equal(terminalSnapshot.status, 'error', `${failureCode}: renderable`);
  assert.equal(terminalSnapshot.error?.code, failureCode);
  assert.equal(terminalProvider.inspection().diagnostics.at(-1)?.code, failureCode);
  for (let render = 0; render < 25; render += 1) {
    terminalLease = terminalProvider.registry.subscribe(
      terminalDescriptor,
      listener,
      terminalLease,
    );
  }
  mock.timers.tick(120_000);
  await flush();
  assert.equal(terminalClient.state.attempts, 1, `${failureCode}: never retries`);
  terminalLease.release();
  await terminalProvider.dispose();
}

const retryableNeighbors = [
  ['SNAPBACK_REQUEST_JSON_INVALID', 400, 'legacy probe'],
  ['SNAPBACK_AUTH_POLICY_UNAVAILABLE', 503, 'readiness'],
  ['SNAPBACK_WIRE_VERSION_UNSUPPORTED', 409, 'conflict'],
  ['SNAPBACK_CLIENT_REFUSED', undefined, 'transport'],
];
for (const [failureCode, failureStatus, label] of retryableNeighbors) {
  const retryClient = fakeClient({ failureCode, failureStatus });
  const retryBinding = await prepareReactBindingForClient(retryClient, {
    generatedManifest: functions,
  });
  const retryProvider = createSnapbackReactProvider(retryBinding, {
    connectionId: `retryable-neighbor-${label}`,
  });
  const retryDescriptor = retryProvider.registry.descriptor(records, {});
  const retryLease = retryProvider.registry.subscribe(retryDescriptor, listener);
  await flush();
  assert.equal(retryClient.state.attempts, 1, `${label}: first attempt`);
  mock.timers.tick(LIVE_RECONNECT_BASE_DELAY_MS);
  await flush();
  assert.equal(retryClient.state.attempts, 2, `${label}: retry remains enabled`);
  retryLease.release();
  await retryProvider.dispose();
}

await provider.dispose();
mock.timers.reset();
console.log('snapback-react subscribe retry window tests: ok');
