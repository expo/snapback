import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import { createSnapbackReactProvider } from './index.mjs';

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
const privateRecords = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'auth-blocked-fixture',
  id: 'auth-blocked-fixture:privateRecords',
  name: 'privateRecords',
  kind: 'LiveQuery',
  authRequirement: 'authenticated',
  implementationHash: 'sha256:private-records-implementation',
  argsContractHash: 'sha256:private-records-args',
  argsContract: { kind: 'object', fields: [] },
  resultContractHash: resultContractHash(queryContract),
  resultContract: queryContract,
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'auth-blocked-fixture',
  bundleHash: 'sha256:auth-blocked-bundle',
  functions: [privateRecords],
});
const ROWS = Object.freeze([{ id: 'private-1' }, { id: 'private-2' }]);

function fakeClient({ initialAuthority = 'anonymous', raceToAnonymous = false } = {}) {
  const state = {
    authority: initialAuthority,
    attempts: 0,
    disposals: 0,
    participant: null,
    raceToAnonymous,
  };
  const coordinator = {
    capture() {
      return Object.freeze({
        authorityEpoch: state.authority === 'anonymous' ? 0 : 1,
        authorityKey: `authority:${state.authority}`,
        custodyRevision: 1,
      });
    },
    credentialFor() {
      return Object.freeze({
        authority: Object.freeze({
          kind: state.authority === 'anonymous' ? 'anonymous' : 'session',
        }),
      });
    },
  };
  const client = {
    state,
    authCoordinator: coordinator,
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:auth-blocked-schema' },
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
    captureAuthority() { return coordinator.capture(); },
    isAuthorityCaptureCurrent() { return true; },
    registerAuthBarrierParticipant(participant) {
      state.participant = participant;
      return async () => { state.participant = null; };
    },
    liveStreamManager() { return { async settled() {} }; },
    startLiveQuery(_reference, options) {
      state.attempts += 1;
      if (state.raceToAnonymous) {
        state.raceToAnonymous = false;
        state.authority = 'anonymous';
        const error = new Error('SNAPBACK_AUTH_REQUIRED: authentication is required');
        error.code = 'SNAPBACK_AUTH_REQUIRED';
        error.status = 401;
        error.diagnostic = {
          code: 'SNAPBACK_AUTH_REQUIRED',
          message: 'authentication is required',
        };
        const rejection = Promise.reject(error);
        rejection.catch(() => {});
        return Object.freeze({
          current: null,
          started: () => rejection,
          dispose() { state.disposals += 1; },
          settled: async () => {},
        });
      }
      const current = { rows: [...ROWS], connection: 'live', freshness: 'current' };
      const handle = {
        current,
        started: async () => {},
        dispose() { state.disposals += 1; },
        settled: async () => {},
      };
      queueMicrotask(() => options.onUpdate(current.rows, { freshness: 'current' }));
      return Object.freeze(handle);
    },
    async signIn() {
      const participant = state.participant;
      assert.ok(participant, 'React provider registered its authority barrier participant');
      await participant.quiesce({ reason: 'login' });
      participant.blank({ reason: 'login' });
      participant.clearMemory({ reason: 'login' });
      state.authority = 'session';
      await participant.resume({ reason: 'login' });
    },
  };
  return client;
}

async function mount(client) {
  const binding = await prepareReactBindingForClient(client, { generatedManifest: functions });
  const provider = createSnapbackReactProvider(binding, { connectionId: 'auth-blocked-test' });
  const registry = provider.registry;
  const descriptor = registry.descriptor(privateRecords, {});
  let flips = 0;
  const listener = () => { flips += 1; };
  let lease = registry.subscribe(descriptor, listener);
  await flush();
  return {
    provider,
    registry,
    descriptor,
    get lease() { return lease; },
    set lease(value) { lease = value; },
    listener,
    flips: () => flips,
  };
}

async function assertBlockedStability(mounted, client, expectedAttempts) {
  const blocked = mounted.registry.snapshot(mounted.descriptor);
  assert.deepEqual(blocked, {
    status: 'blocked',
    reason: 'authentication-required',
    data: undefined,
    error: null,
    connection: 'idle',
    freshness: 'unknown',
    retention: null,
  });
  const flipsAtBlocked = mounted.flips();
  for (let interval = 0; interval < 1_000; interval += 1) {
    mock.timers.tick(10_000);
    mounted.lease = mounted.registry.subscribe(
      mounted.descriptor,
      mounted.listener,
      mounted.lease,
    );
    assert.strictEqual(
      mounted.registry.snapshot(mounted.descriptor),
      blocked,
      `blocked snapshot identity is stable at interval/render ${interval}`,
    );
  }
  await flush();
  assert.equal(client.state.attempts, expectedAttempts);
  assert.equal(mounted.flips(), flipsAtBlocked, 'blocked state publishes no retry/render flips');
}

test('protected React live resources remain auth-blocked until barrier resume', async (t) => {
  await t.test('anonymous custody performs zero subscribe attempts across 1,000 intervals/renders', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const client = fakeClient();
    const mounted = await mount(client);
    try {
      await assertBlockedStability(mounted, client, 0);
      await client.signIn();
      await flush();
      const ready = mounted.registry.snapshot(mounted.descriptor);
      assert.equal(client.state.attempts, 1, 'sign-in creates one fresh authority-fenced instance');
      assert.equal(ready.status, 'ready');
      assert.deepEqual(ready.data, ROWS);
    } finally {
      mounted.lease.release();
      await mounted.provider.dispose();
      mock.timers.reset();
    }
  });

  await t.test('a raced server AUTH_REQUIRED becomes blocked without entering the retry ladder', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const client = fakeClient({ initialAuthority: 'session', raceToAnonymous: true });
    const mounted = await mount(client);
    try {
      await assertBlockedStability(mounted, client, 1);
      await client.signIn();
      await flush();
      assert.equal(client.state.attempts, 2, 'barrier resume constructs one successor instance');
      assert.equal(mounted.registry.snapshot(mounted.descriptor).status, 'ready');
    } finally {
      mounted.lease.release();
      await mounted.provider.dispose();
      mock.timers.reset();
    }
  });
});
